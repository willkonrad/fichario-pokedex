// Edge Function: menor anúncio no MYP Cards NO ESTADO E IDIOMA da carta, via scraper da Apify
// (gio21/mypcards-scraper, que lê a lista de ofertas pública das páginas de produto). Chamada pelo pg_cron
// a cada 30 min; cada carta é relida uma vez por semana.
//
// Custo (Apify, pago por evento): US$ 0,005 por execução + US$ 0,004 por oferta devolvida. Para gastar pouco:
// uma execução por impressão + idioma + estado, ofertas já filtradas por idioma e estado e no máximo MAX_ITEMS.
// No plano grátis da Apify o scraper só devolve um registro de amostra (isSample): nada é gravado e a função
// espera SAMPLE_BACKOFF_HOURS antes de tentar de novo.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ACTOR = 'gio21~mypcards-scraper';
/** Impressões consultadas por chamada (cada uma é uma execução da Apify, ~3–10 s). */
const GROUPS_PER_RUN = 4;
const MAX_PRODUCTS = 3;
const MAX_ITEMS = 10;
const REFRESH_DAYS = 7;
const SAMPLE_BACKOFF_HOURS = 24;
const DAY = 86_400_000;
const STATE_KEY = 'myp-sync:sample-backoff';

/** Idioma da carta no app → filtro do scraper. */
const LANGUAGE: Record<string, string> = { pt: 'portuguese', en: 'english', ja: 'japanese' };
/** Estado da carta no app → filtro do scraper (o MYP não separa M de NM). */
const CONDITION: Record<string, string> = { M: 'nm', NM: 'nm', SP: 'sp', MP: 'mp', HP: 'hp', D: 'dm' };

type MypOffers = {
  /** Menor oferta (R$) no estado e idioma da carta; ausente se não há oferta. */
  min?: number;
  /** Ofertas encontradas no estado e idioma. */
  count: number;
  /** Estado e idioma consultados (ex.: "NM", "pt"). */
  condition: string;
  lang: string;
  /** Página do produto no MYP. */
  url?: string;
  notFound?: string;
  checkedAt: string;
};
type EntryData = {
  cardName?: string;
  cardId?: string;
  lang?: string;
  localId?: string;
  setTotal?: number;
  condition?: string;
  ligaQuery?: string;
  mypOffers?: MypOffers;
};
type Row = { user_id: string; id: string; data: EntryData };
type Offer = {
  name?: string;
  number?: string;
  language?: string;
  conditionCode?: string;
  grade?: string;
  price?: number;
  currency?: string;
  url?: string;
  isSample?: boolean;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const numOf = (s?: string) => (s ?? '').replace(/^0+(?=\d)/, '').toLowerCase();

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Mesma proteção do liga-sync: só o cron (que conhece a chave do Vault) chama esta função.
  const key = req.headers.get('x-sync-key') ?? '';
  const { data: allowed } = await admin.rpc('check_liga_sync_key', { k: key });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);

  const token = Deno.env.get('APIFY_TOKEN');
  if (!token) return json({ skipped: 'APIFY_TOKEN não configurado' });

  // Plano grátis da Apify detectado há pouco: não gasta execuções à toa.
  const { data: backoff } = await admin.from('qvmc_cache').select('fetched_at').eq('key', STATE_KEY).maybeSingle();
  if (backoff && Date.now() - new Date(backoff.fetched_at).getTime() < SAMPLE_BACKOFF_HOURS * 3_600_000) {
    return json({ skipped: 'plano grátis da Apify: o scraper do MYP só devolve amostra', since: backoff.fetched_at });
  }

  // Cartas agrupadas por impressão + idioma + estado; vencidas = nunca lidas ou lidas há mais de REFRESH_DAYS.
  const { data: rows } = await admin.from('entries').select('user_id, id, data');
  const groups = new Map<string, Row[]>();
  for (const row of (rows ?? []) as Row[]) {
    const { cardId, lang, condition } = row.data;
    if (!cardId || !lang || !LANGUAGE[lang] || !CONDITION[condition ?? 'NM']) continue;
    const k = `${cardId}|${lang}|${condition ?? 'NM'}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const age = (g: Row[]) => Math.min(...g.map((r) => (r.data.mypOffers?.checkedAt ? new Date(r.data.mypOffers.checkedAt).getTime() : 0)));
  const due = [...groups.values()].filter((g) => Date.now() - age(g) > REFRESH_DAYS * DAY).sort((a, b) => age(a) - age(b));
  if (!due.length) return json({ next: 'nada para atualizar', groups: groups.size });

  const report = { read: 0, found: 0, notFound: 0, entriesUpdated: 0, failed: 0 };
  for (const group of due.slice(0, GROUPS_PER_RUN)) {
    const d = group[0].data;
    const { name, number, total } = searchTerms(d);
    if (!name) continue;
    const condition = d.condition ?? 'NM';
    const input = {
      query: name,
      game: 'pokemon',
      language: LANGUAGE[d.lang!],
      condition: CONDITION[condition],
      includeOffers: true,
      maxProducts: MAX_PRODUCTS,
      maxItems: MAX_ITEMS,
    };
    const res = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=60`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    }).catch(() => null);
    if (!res?.ok) {
      report.failed++;
      continue; // continua na fila para a próxima chamada
    }
    const offers = ((await res.json().catch(() => [])) ?? []) as Offer[];
    if (offers.some((o) => o.isSample)) {
      await admin.from('qvmc_cache').upsert({ key: STATE_KEY, data: { reason: 'sample' }, fetched_at: new Date().toISOString() });
      return json({ ...report, stopped: 'plano grátis da Apify: só amostra; nada gravado' });
    }
    report.read++;

    // Só ofertas da MESMA carta (número e, quando houver, total) e sem graduação (PSA, CGC…).
    const mine = offers.filter((o) => {
      const [n, t] = (o.number ?? '').split('/');
      if (!number || numOf(n) !== number) return false;
      if (total && t && numOf(t) !== total) return false;
      return !o.grade && typeof o.price === 'number' && o.price > 0 && (o.currency ?? 'BRL') === 'BRL';
    });
    const best = mine.reduce<Offer | undefined>((a, o) => (!a || o.price! < a.price! ? o : a), undefined);
    const mypOffers: MypOffers = best
      ? { min: best.price, count: mine.length, condition, lang: d.lang!, url: best.url, checkedAt: new Date().toISOString() }
      : {
          count: 0,
          condition,
          lang: d.lang!,
          notFound: offers.length ? 'nenhuma oferta desta carta no estado e idioma' : 'nenhuma oferta no estado e idioma',
          checkedAt: new Date().toISOString(),
        };
    if (best) report.found++;
    else report.notFound++;
    for (const row of group) {
      const { error } = await admin.rpc('set_entry_fields', { p_user: row.user_id, p_id: row.id, p_fields: { mypOffers } });
      if (!error) report.entriesUpdated++;
    }
  }
  return json({ ...report, pending: Math.max(0, due.length - GROUPS_PER_RUN) });
});

/** Nome em inglês e número da carta, da busca da Liga ("Gengar ex (154/128)"), ou do próprio cadastro. */
function searchTerms(d: EntryData) {
  const m = d.ligaQuery?.match(/^(.*?)\s*\(([^/)]+)\/([^)]+)\)\s*$/);
  if (m) return { name: m[1], number: numOf(m[2]), total: numOf(m[3]) };
  return { name: d.cardName, number: numOf(d.localId), total: d.setTotal ? String(d.setTotal) : undefined };
}
