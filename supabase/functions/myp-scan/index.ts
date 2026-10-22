// Edge Function: valor das cartas no MYP Cards (mypcards.com) por estado, idioma e versão, lido das páginas públicas
// do site. Chamada pelo pg_cron a cada 10 min.
//
// Por que ler a página: o preço que vinha do Zukan é o MENOR anúncio da carta em qualquer estado e versão (ex.:
// Alakazam-EX a R$ 6,99 de um anúncio SP, com o NM a R$ 30). A página do produto mostra cada oferta com estado,
// idioma, acabamento e preço, e é o que a carta do usuário vale de verdade.
//
// Boas práticas seguidas (robots.txt do MYP libera as páginas de produto e de busca):
//   - User-Agent próprio, com link do projeto;
//   - 3 s entre consultas e poucas por chamada; cada carta é relida 1×/semana (cartas novas e alteradas primeiro);
//   - só a página do produto: a lista extra de ofertas (/produto/outros-resultados) e a /api/ ficam de fora,
//     como pede o robots.txt;
//   - o app mostra "MYP Cards" com link para a página do produto em todo valor.
// Quando a API oficial do MYP for liberada (chave MYP_API_TOKEN), ela pode substituir esta leitura.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { FINISHES_FOR_VARIANT, lastPage, num, parseCode, parseEditions, parseList, parseOffers, summarize } from './myp.ts';

const SITE = 'https://mypcards.com';
const USER_AGENT = 'FicharioPokedex/1.0 (+https://github.com/willkonrad/fichario-pokedex)';
const PAUSE_MS = 3000;
/** Consultas ao MYP por chamada (≈ 1 busca + 1 página por carta nova; 1 página por carta já ligada). */
const REQUESTS_PER_RUN = 24;
const REFRESH_DAYS = 6;
const DAY = 86_400_000;

type MypScan = {
  cardId: string;
  lang: string;
  variant: string;
  note?: string;
  productId?: number;
  /** Caminho da página do produto no MYP e o endereço completo (link mostrado no app). */
  path?: string;
  url?: string;
  /** Produto próprio da versão com selo (vale qualquer acabamento). */
  ownVersion?: boolean;
  /** Menor preço e unidades por estado do MYP (NM, SP, MP, HP, DM), no idioma e na versão da carta. */
  byCondition?: Record<string, { min: number; count: number }>;
  /** Ofertas que entraram na conta / ofertas da página. */
  offers?: number;
  total?: number;
  notFound?: string;
  checkedAt: string;
};
type EntryData = { cardId?: string; lang?: string; variant?: string; variantNote?: string; localId?: string; cardName?: string; mypOffers?: MypScan };
type Row = { user_id: string; id: string; data: EntryData };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

let requests = 0;
async function page(path: string) {
  if (requests > 0) await sleep(PAUSE_MS);
  requests++;
  const res = await fetch(`${SITE}${path}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`MYP ${res.status} ${path}`);
  return res.text();
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const key = req.headers.get('x-sync-key') ?? '';
  const { data: allowed } = await admin.rpc('check_liga_sync_key', { k: key });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);
  requests = 0;
  const report = { editions: 0, cards: 0, priced: 0, notFound: 0, failed: 0, entriesUpdated: 0, pending: 0 };

  // 1) Edições do MYP (número interno e sigla), renovadas 1×/semana.
  const { data: edRows } = await admin.from('myp_editions').select('id, sigla, synced_at');
  const edFresh = (edRows ?? []).length && Date.now() - Math.min(...edRows!.map((e: { synced_at: string }) => new Date(e.synced_at).getTime())) < 7 * DAY;
  if (!edFresh) {
    const first = await page('/pokemon/edicoes?page=1&per-page=48');
    const all = parseEditions(first);
    for (let p = 2; p <= lastPage(first); p++) all.push(...parseEditions(await page(`/pokemon/edicoes?page=${p}&per-page=48`)));
    const now = new Date().toISOString();
    const { error } = await admin.from('myp_editions').upsert(all.map((e) => ({ ...e, synced_at: now })), { onConflict: 'id' });
    if (error) throw error;
    report.editions = all.length;
  }
  const { data: editions } = await admin.from('myp_editions').select('id, sigla');
  const editionBySigla = new Map<string, number>((editions ?? []).map((e: { sigla: string; id: number }) => [e.sigla.toLowerCase(), e.id]));

  // 2) Cartas a atualizar: sem valor do MYP ainda, com versão/idioma alterados ou lidas há mais de 6 dias.
  const { data: rows } = await admin.from('entries').select('user_id, id, data');
  const groups = new Map<string, Row[]>();
  for (const row of (rows ?? []) as Row[]) {
    const d = row.data;
    if (!d.cardId || !d.lang) continue;
    const note = d.variant === 'wPromo' || d.variant === 'staff' ? (d.variantNote ?? '') : '';
    const k = `${d.cardId}|${d.lang}|${d.variant}|${note}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const stale = (g: Row[]) => {
    const d = g[0].data;
    const note = d.variant === 'wPromo' || d.variant === 'staff' ? (d.variantNote ?? '') : '';
    return g.some((r) => {
      const s = r.data.mypOffers;
      if (!s?.checkedAt || s.cardId !== d.cardId || s.lang !== d.lang || s.variant !== d.variant || (s.note ?? '') !== note) return true;
      return Date.now() - new Date(s.checkedAt).getTime() > REFRESH_DAYS * DAY;
    });
  };
  const age = (g: Row[]) => Math.min(...g.map((r) => (r.data.mypOffers?.cardId === g[0].data.cardId ? new Date(r.data.mypOffers?.checkedAt ?? 0).getTime() : 0)));
  const due = [...groups.values()].filter(stale).sort((a, b) => age(a) - age(b));
  if (!due.length) return json({ ...report, next: 'nada para atualizar' });

  const { data: tcgdexSets } = await admin.from('tcgdex_sets').select('id, abbr, cards');
  type TcgdexSet = { id: string; abbr: string | null; cards: { id: string; localId: string; name: string }[] };
  const setById = new Map<string, TcgdexSet>((tcgdexSets ?? []).map((s: TcgdexSet) => [s.id, s]));

  let done = 0;
  for (const group of due) {
    if (requests >= REQUESTS_PER_RUN - 1) break;
    const d = group[0].data;
    const cardId = d.cardId!;
    const lang = d.lang!;
    const variant = d.variant ?? 'normal';
    const note = variant === 'wPromo' || variant === 'staff' ? (d.variantNote ?? '') : '';
    const scan: MypScan = { cardId, lang, variant, note: note || undefined, checkedAt: new Date().toISOString() };
    report.cards++;
    done++;
    try {
      // Produto do MYP: o já ligado (mesma carta e versão) ou pela busca na edição (sigla + número + nome).
      const prev = group
        .map((r) => r.data.mypOffers)
        .find((s) => s?.cardId === cardId && s.variant === variant && (s.note ?? '') === note && s.productId && s.path);
      let productId = prev?.productId;
      let path = prev?.path;
      let ownVersion = !!prev?.ownVersion;
      if (!productId) {
        const found = await findProduct(cardId, d, variant, note, setById, editionBySigla);
        if (typeof found === 'string') scan.notFound = found;
        else ({ productId, url: path, ownVersion } = found);
      }
      if (productId && path) {
        const offers = parseOffers(await page(path));
        // Produto próprio da versão (ex.: "Pokemon Day 2026"): qualquer acabamento; senão, o acabamento da versão.
        const finishes = ownVersion ? null : (FINISHES_FOR_VARIANT[variant] ?? []);
        const s = summarize(offers, lang, finishes);
        Object.assign(scan, {
          productId,
          path,
          url: `${SITE}${path}`,
          ownVersion: ownVersion || undefined,
          byCondition: s.byCondition,
          offers: s.offers,
          total: s.total,
        });
        if (Object.keys(s.byCondition).length) report.priced++;
      }
      if (scan.notFound) report.notFound++;
    } catch (e) {
      report.failed++;
      console.error(cardId, String(e));
      continue; // falha momentânea: a carta fica na fila para a próxima rodada
    }
    for (const row of group) {
      const { error } = await admin.rpc('set_entry_fields', { p_user: row.user_id, p_id: row.id, p_fields: { mypOffers: scan } });
      if (!error) report.entriesUpdated++;
    }
  }
  report.pending = due.length - done;
  return json(report);
});

/**
 * Acha o produto da carta no MYP: edição pela sigla oficial da coleção (a mesma da TCGdex), busca pelo nome em
 * inglês na edição e escolhe o produto de mesmo número. Para a versão com selo, prefere o produto próprio da versão
 * ("Bulbasaur (Pokemon Day 2026)", código terminado em p1) quando o nome do selo bate; senão, o produto comum (a versão
 * fica pelo acabamento "Promo"/"Staff" das ofertas).
 */
async function findProduct(
  cardId: string,
  d: EntryData,
  variant: string,
  note: string,
  setById: Map<string, { abbr: string | null; cards: { id: string; localId: string; name: string }[] }>,
  editionBySigla: Map<string, number>,
): Promise<{ productId: number; url: string; ownVersion: boolean } | string> {
  const cut = cardId.lastIndexOf('-');
  const setId = cardId.slice(0, cut);
  const set = setById.get(setId);
  const card = set?.cards?.find((c) => c.id === cardId);
  const abbr = (set?.abbr ?? (d.lang === 'ja' ? setId : '')).toLowerCase();
  const localId = card?.localId ?? d.localId ?? cardId.slice(cut + 1);
  const name = card?.name ?? d.cardName ?? '';
  const edition = editionBySigla.get(abbr);
  if (!edition) return `edição "${abbr || setId}" não encontrada no MYP`;
  if (!name) return 'nome da carta desconhecido';

  const q = new URLSearchParams({ 'ProdutoSearch[edicoesSelecionadas][]': String(edition), 'ProdutoSearch[query]': name });
  const items = parseList(await page(`/pokemon?${q}`))
    .map((i) => ({ ...i, code: parseCode(i.code) }))
    .filter((i) => i.code && i.code.sigla === abbr && i.code.number === num(localId));
  if (!items.length) return `carta ${name} ${localId} não encontrada na edição ${abbr.toUpperCase()} do MYP`;

  const base = items.find((i) => !i.code!.version);
  if (variant === 'wPromo' || variant === 'staff') {
    const want = words(note);
    const own = items.find((i) => i.code!.version && words(i.title.replace(/\([^)]*\/[^)]*\)\s*$/, '')).some((w) => want.includes(w)));
    if (own) return { productId: own.productId, url: own.url, ownVersion: true };
  }
  const pick = base ?? items[0];
  return { productId: pick.productId, url: pick.url, ownVersion: false };
}
