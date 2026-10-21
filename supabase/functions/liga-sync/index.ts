// Edge Function: cotação automática da Liga para todas as cartas dos fichários.
// Chamada pelo pg_cron a cada 10 min (ver supabase/schema.sql). Cada chamada:
//   1. recolhe o resultado da execução anterior da Apify (se terminou) e grava os preços nas cartas;
//   2. dentro de uma das 3 janelas do dia (6h, 13h e 20h de Brasília), dispara UMA execução com até 100
//      cartas: primeiro as sem valor, depois as com valor atualizado há mais tempo.
// As janelas cabem no plano grátis do scraper (no máximo 3 execuções por 24 h, 30 min entre elas).
// Trabalha de forma assíncrona porque uma execução com muitas cartas passa do limite de tempo da função.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ACTOR = 'getascraper~ligapokemon-scraper';
/** Janelas de cotação, em UTC: 9h, 16h e 23h = 6h, 13h e 20h de Brasília (sem horário de verão). Uma execução por janela. */
const WINDOW_UTC_HOURS = [9, 16, 23];
/** Plano grátis do scraper: no mínimo 30 min entre execuções. */
const MIN_MINUTES_BETWEEN_RUNS = 31;
/** Plano grátis do scraper: no máximo 3 execuções por 24 h (janela móvel). */
const MAX_RUNS_PER_24H = 3;
/** Recusas do scraper ("not started"): não contam como execução feita. */
const REFUSED = /not started/i;
/** Recusa por cota de 24 h: espera mais antes de tentar de novo (cada tentativa também é uma execução na Apify). */
const QUOTA_REFUSED = /maximum \d+ runs/i;
const MINUTES_AFTER_QUOTA_REFUSAL = 60;
/** O scraper aceita até 100 buscas por execução. */
const MAX_QUERIES_PER_RUN = 100;

type Finish = { min?: number; avg?: number; max?: number };
type LigaRow = {
  recordType?: string;
  query?: string;
  name?: string;
  edition?: string;
  editionCode?: string;
  cardNumber?: string;
  rarity?: string;
  imageUrl?: string;
  url?: string;
  priceMin?: number;
  priceAvg?: number;
  priceMax?: number;
  priceByFinish?: Record<string, Finish>;
  listingCount?: number;
  sellerCount?: number;
  byLanguage?: Record<string, number>;
  lastSaleDate?: string;
  lastSalePriceMid?: number;
};
type Price = { min?: number; avg?: number; max?: number; last?: number; currency: 'BRL'; source: 'site' | 'manual'; updatedAt: string };
type EntryData = {
  id: string;
  cardName: string;
  localId?: string;
  setTotal?: number;
  variant?: string;
  ligaQuery?: string;
  price?: Price;
  ligaUrl?: string;
  ligaNotFound?: string;
  ligaCheckedAt?: string;
  updatedAt: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const cacheKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Só o cron (que conhece a chave guardada no Vault) pode chamar esta função.
  const key = req.headers.get('x-sync-key') ?? '';
  const { data: allowed } = await admin.rpc('check_liga_sync_key', { k: key });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);

  const report: Record<string, unknown> = {};

  const token = Deno.env.get('APIFY_TOKEN');
  if (!token) return json({ skipped: 'APIFY_TOKEN não configurado' });
  const apify = (path: string, init?: RequestInit) =>
    fetch(`https://api.apify.com/v2${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });

  // 1) Recolhe a execução pendente.
  const { data: pending } = await admin
    .from('liga_sync_runs')
    .select('*')
    .is('finished_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pending) {
    const run = await apify(`/actor-runs/${pending.run_id}`).then((r) => r.json());
    const status: string = run?.data?.status ?? 'UNKNOWN';
    if (['READY', 'RUNNING'].includes(status)) {
      return json({ waiting: pending.run_id, status });
    }
    let rows: LigaRow[] = [];
    if (status === 'SUCCEEDED') {
      rows = await apify(`/datasets/${pending.dataset_id}/items?clean=true`).then((r) => r.json());
      rows = rows.filter((r) => r.recordType !== 'summary' && (r.priceAvg != null || r.priceMin != null));
    }
    const written = await applyResults(admin, rows);
    // Buscas que a Liga respondeu sem nenhum resultado: marca as cartas, para o app mostrar "sem cotação".
    if (status === 'SUCCEEDED' && !REFUSED.test(run?.data?.statusMessage ?? '')) {
      const found = new Set(rows.map((r) => cacheKey(r.query ?? '')));
      const notFound = ((pending.queries ?? []) as string[]).filter((q) => !found.has(cacheKey(q)));
      report.notFound = await markNotFound(admin, notFound);
    }
    await admin
      .from('liga_sync_runs')
      .update({ finished_at: new Date().toISOString(), status, items: rows.length, status_message: run?.data?.statusMessage ?? null })
      .eq('run_id', pending.run_id);
    report.collected = { run: pending.run_id, status, rows: rows.length, entriesUpdated: written };
  }

  // 2) Cartas a cotar, por prioridade (cartas já verificadas nesta janela ficam de fora):
  //    0 — sem valor: as nunca verificadas primeiro, depois as verificadas há mais tempo;
  //    1 — com valor: as atualizadas há mais tempo primeiro;
  //    2 — sem valor e que a Liga não achou (ou devolveu outra carta) nas últimas 24 h: só se sobrar espaço,
  //        para não ocuparem toda execução e travarem a atualização das outras.
  const windowStart = currentWindowStart().getTime();
  const dayAgo = Date.now() - 24 * 3_600_000;
  const rankByQuery = new Map<string, [number, number]>();
  const { data: entries } = await admin.from('entries').select('data');
  for (const { data } of (entries ?? []) as { data: EntryData }[]) {
    if (data.price?.source === 'manual') continue;
    const q = queryFor(data);
    if (!q) continue;
    const checked = lastChecked(data);
    if (checked >= windowStart) continue;
    const group = data.price ? 1 : data.ligaNotFound && checked > dayAgo ? 2 : 0;
    const rank: [number, number] = [group, checked];
    const prev = rankByQuery.get(q);
    if (!prev || rank[0] < prev[0] || (rank[0] === prev[0] && rank[1] < prev[1])) rankByQuery.set(q, rank);
  }
  if (!rankByQuery.size) return json({ ...report, next: 'nada para cotar' });
  const all = [...rankByQuery].sort(([, a], [, b]) => a[0] - b[0] || a[1] - b[1]).map(([q]) => q);
  report.queue = { semValor: all.filter((q) => rankByQuery.get(q)![0] !== 1).length, comValor: all.filter((q) => rankByQuery.get(q)![0] === 1).length };

  // 3) Usa o que já foi buscado nesta janela (ex.: a mesma carta em outro fichário) antes de gastar execução.
  const { data: fresh } = await admin
    .from('liga_price_cache')
    .select('query, items, fetched_at')
    .in('query', all.map(cacheKey))
    .gte('fetched_at', new Date(windowStart).toISOString());
  const usable = (fresh ?? []).filter((c) => Array.isArray(c.items) && c.items.length > 0);
  if (usable.length) {
    const rows = usable.flatMap((c) => (c.items as LigaRow[]).map((i) => ({ ...i, query: c.query, fetchedAt: c.fetched_at })));
    report.fromCache = await applyResults(admin, rows);
  }
  const cachedKeys = new Set(usable.map((c) => c.query));
  const toRun = all.filter((q) => !cachedKeys.has(cacheKey(q))).slice(0, MAX_QUERIES_PER_RUN);
  if (!toRun.length) return json(report);

  // 4) Uma execução por janela (6h, 13h, 20h de Brasília), dentro dos limites do plano grátis.
  //    O cache acima já foi aplicado; o que sobrar espera a próxima janela.
  const { data: recent } = await admin
    .from('liga_sync_runs')
    .select('started_at, status_message')
    .gte('started_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
    .order('started_at', { ascending: false });
  const attempts = (recent ?? []) as { started_at: string; status_message: string | null }[];
  const accepted = attempts.filter((r) => !REFUSED.test(r.status_message ?? ''));
  const waiting = { ...report, waiting: toRun.length, nextWindow: nextWindowStart().toISOString() };
  if (accepted.some((r) => new Date(r.started_at) >= currentWindowStart())) {
    return json({ ...waiting, next: 'janela atual já usada' });
  }
  const gap = QUOTA_REFUSED.test(attempts[0]?.status_message ?? '') ? MINUTES_AFTER_QUOTA_REFUSAL : MIN_MINUTES_BETWEEN_RUNS;
  if (attempts[0] && Date.now() - new Date(attempts[0].started_at).getTime() < gap * 60_000) {
    return json({ ...waiting, next: 'aguardando intervalo mínimo' });
  }
  if (accepted.length >= MAX_RUNS_PER_24H) {
    return json({ ...waiting, next: 'cota de 24 h do scraper ainda cheia' });
  }

  // 5) Dispara a execução (assíncrona); o resultado é recolhido na próxima chamada.
  const res = await apify(`/acts/${ACTOR}/runs`, {
    method: 'POST',
    body: JSON.stringify({
      queries: toRun,
      maxProductsPerQuery: 1,
      maxItems: toRun.length * 2,
      fetchDetails: true,
      includeLastSale: true,
      includeOffers: false,
      convertTo: 'none',
    }),
  });
  const started = await res.json();
  if (!res.ok) return json({ ...report, error: 'Apify não iniciou', detail: started }, 502);
  await admin.from('liga_sync_runs').insert({
    run_id: started.data.id,
    dataset_id: started.data.defaultDatasetId,
    queries: toRun,
    started_at: new Date().toISOString(),
  });
  return json({ ...report, started: started.data.id, queries: toRun.length });
});

/** Última vez que a Liga foi consultada para a carta (0 = nunca), qualquer que tenha sido o resultado. */
function lastChecked(e: EntryData) {
  const times = [e.ligaCheckedAt, e.price?.updatedAt, e.ligaNotFound].map((t) => (t ? new Date(t).getTime() : 0));
  return Math.max(0, ...times.filter((t) => !Number.isNaN(t)));
}

/** Inícios das janelas de cotação de ontem, hoje e amanhã (UTC). */
function windowStarts(now: Date) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return [-1, 0, 1].flatMap((d) => WINDOW_UTC_HOURS.map((h) => day + d * 86_400_000 + h * 3_600_000));
}

/** Início da janela atual: a última das 6h, 13h ou 20h de Brasília que já passou. */
function currentWindowStart(now = new Date()) {
  return new Date(Math.max(...windowStarts(now).filter((t) => t <= now.getTime())));
}

function nextWindowStart(now = new Date()) {
  return new Date(Math.min(...windowStarts(now).filter((t) => t > now.getTime())));
}

function queryFor(e: EntryData) {
  if (e.ligaQuery) return e.ligaQuery;
  if (!e.cardName) return undefined;
  if (!e.localId || !e.setTotal) return e.cardName;
  // Mesmo formato da Liga (src/lib/liga-api.ts → ligaNumber): o número como a TCGdex guarda e o total com
  // zeros só quando o número tem. Ex.: "Alakazam EX (25/124)", "Charmander (011/094)".
  const total = /^0/.test(e.localId) ? String(e.setTotal).padStart(e.localId.length, '0') : String(e.setTotal);
  return `${e.cardName} (${e.localId}/${total})`;
}

// Mesmo mapeamento do app (src/lib/liga-api.ts).
const FINISH_BY_VARIANT: Record<string, RegExp> = {
  normal: /^normal$/i,
  holo: /^(foil|holo)/i,
  reverse: /^reverse/i,
  pokeball: /pok[eé]\s?ball/i,
  masterball: /master\s?ball/i,
  wPromo: /promo/i,
  staff: /(pre.?release|staff)/i,
};

function priceForVariant(row: LigaRow, variant = 'normal'): Finish {
  const re = FINISH_BY_VARIANT[variant];
  const match = re && row.priceByFinish ? Object.entries(row.priceByFinish).find(([name]) => re.test(name)) : undefined;
  return match ? match[1] : { min: row.priceMin, avg: row.priceAvg, max: row.priceMax };
}

/** Grava o cache e atualiza o preço da Liga em todas as cartas que usam cada busca. */
// deno-lint-ignore no-explicit-any
async function applyResults(admin: any, rows: (LigaRow & { fetchedAt?: string })[]) {
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  const byQuery = new Map<string, LigaRow & { fetchedAt?: string }>();
  for (const r of rows) if (r.query && !byQuery.has(cacheKey(r.query))) byQuery.set(cacheKey(r.query), r);

  await admin.from('liga_price_cache').upsert(
    [...byQuery].filter(([, r]) => !r.fetchedAt).map(([q, r]) => ({ query: q, items: [stripQuery(r)], fetched_at: now })),
  );

  const { data: entries } = await admin.from('entries').select('user_id, id, data');
  let updated = 0;
  for (const row of (entries ?? []) as { user_id: string; id: string; data: EntryData }[]) {
    const q = queryFor(row.data);
    const hit = q ? byQuery.get(cacheKey(q)) : undefined;
    if (!hit || row.data.price?.source === 'manual') continue;
    const checkedAt = hit.fetchedAt ?? now;
    // Nunca grava preço/link de outra carta: o resultado precisa bater número, coleção e ter preços coerentes.
    const problem = await mismatchReason(row.data, q!, hit);
    if (problem) {
      const now = new Date().toISOString();
      // Já tinha preço conferido: mantém o último preço válido e só registra a verificação.
      // Sem preço: fica "sem cotação" com o motivo (nunca usa preço de outra carta).
      const data = row.data.price
        ? { ...row.data, ligaCheckedAt: checkedAt, updatedAt: now }
        : { ...row.data, ligaNotFound: now, ligaMismatch: problem, ligaCheckedAt: checkedAt, updatedAt: now };
      await admin.from('entries').update({ data, updated_at: now }).eq('user_id', row.user_id).eq('id', row.id);
      continue;
    }
    const range = priceForVariant(hit, row.data.variant);
    const price: Price = {
      min: range.min,
      avg: range.avg,
      max: range.max,
      last: hit.lastSalePriceMid,
      currency: 'BRL',
      source: 'site',
      updatedAt: checkedAt,
    };
    const data = {
      ...row.data,
      price,
      ligaUrl: hit.url,
      ligaFinishes: hit.priceByFinish,
      // Imagem da carta na Liga: reserva para quando a TCGdex e a pokemontcg.io não têm foto.
      ligaImage: hit.imageUrl,
      ligaNotFound: undefined,
      ligaMismatch: undefined,
      ligaCheckedAt: checkedAt,
      updatedAt: now,
    };
    await admin.from('entries').update({ data, updated_at: now }).eq('user_id', row.user_id).eq('id', row.id);
    updated++;
  }
  return updated;
}

// ---------- Conferência do resultado da Liga ----------

const decodeHtml = (s: string) =>
  s
    .replace(/&([a-z])(acute|grave|circ|tilde|uml|cedil);/gi, (_m, l) => l)
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');

// Palavras que não identificam uma coleção.
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'the', 'of', 'and', 'a', 'o', 'pokemon', 'tcg', 'ex', 'set']);

const tokens = (s: string) =>
  new Set(
    decodeHtml(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '') // tira os acentos
      .split(/[^a-z0-9]+/)
      .filter((t) => t && !STOP.has(t)),
  );

const numOf = (s?: string) => (s ?? '').replace(/^0+(?=\d)/, '').toLowerCase();

// Nome da coleção em inglês, pela TCGdex (a Liga às vezes usa o nome em inglês).
const enSetNames = new Map<string, string | undefined>();
async function enSetName(cardId: string) {
  if (!enSetNames.has(cardId)) {
    const name = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.set?.name as string | undefined)
      .catch(() => undefined);
    enSetNames.set(cardId, name);
  }
  return enSetNames.get(cardId);
}

/**
 * Por que o resultado da Liga NÃO é a carta do fichário (undefined = confere).
 * Prefere ficar sem cotação a mostrar preço ou link de outra carta.
 */
async function mismatchReason(e: EntryData & { setName?: string; cardId?: string }, query: string, hit: LigaRow) {
  // 1) Número: o da carta na Liga tem de ser o que foi buscado ("Kakuna (002/086)" → 2).
  const wanted = numOf(query.match(/\(([^/)]+)\//)?.[1]);
  if (wanted && hit.cardNumber && numOf(hit.cardNumber) !== wanted) return `número ${hit.cardNumber} ≠ ${wanted}`;

  // 2) Preços coerentes.
  const { priceMin: mn, priceAvg: av, priceMax: mx } = hit;
  if (mn != null && mx != null && mn > mx) return 'menor > maior';
  if (av != null && ((mn != null && av < mn) || (mx != null && av > mx))) return 'médio fora da faixa';

  // 3) Coleção: o nome da edição na Liga precisa corresponder ao da coleção da carta (PT ou EN).
  if (!hit.edition) return 'Liga não informou a edição';
  const liga = tokens(hit.edition);
  const names = [e.setName, e.cardId ? await enSetName(e.cardId) : undefined].filter(Boolean) as string[];
  const matches = names.some((n) => {
    const mine = tokens(n);
    const shared = [...mine].filter((t) => liga.has(t)).length;
    return shared > 0 && shared / Math.min(mine.size, liga.size || 1) >= 0.5;
  });
  if (!matches) return `edição "${decodeHtml(hit.edition)}" ≠ "${names.join(' / ')}"`;
  return undefined;
}

// deno-lint-ignore no-explicit-any
async function markNotFound(admin: any, queries: string[]) {
  if (!queries.length) return 0;
  const keys = new Set(queries.map(cacheKey));
  const { data: entries } = await admin.from('entries').select('user_id, id, data');
  let marked = 0;
  for (const row of (entries ?? []) as { user_id: string; id: string; data: EntryData }[]) {
    const q = queryFor(row.data);
    if (!q || !keys.has(cacheKey(q))) continue;
    const now = new Date().toISOString();
    // Com valor anterior: mantém o valor e só registra a verificação; sem valor: marca "sem cotação".
    const data = { ...row.data, ...(row.data.price ? {} : { ligaNotFound: now }), ligaCheckedAt: now, updatedAt: now };
    await admin
      .from('entries')
      .update({ data, updated_at: now })
      .eq('user_id', row.user_id)
      .eq('id', row.id);
    marked++;
  }
  return marked;
}

function stripQuery(r: LigaRow & { fetchedAt?: string }) {
  const { query: _q, fetchedAt: _f, recordType: _t, ...rest } = r;
  return rest;
}
