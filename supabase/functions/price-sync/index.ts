// Edge Function: preços das cartas, de duas fontes que autorizam esse uso. Chamada pelo pg_cron a cada 10 min.
//
// 1) MYP Cards (https://mypcards.com): menor anúncio por idioma, com histórico de 30 dias, pelo servidor MCP
//    público do Zukan (zukan.com.br/mcp), feito para apps consultarem preços. Carta com preço: a cada 6 dias
//    (nunca fica com mais de uma semana); sem preço: todo dia. Quando a API oficial do MYP for liberada
//    (chave MYP_API_TOKEN), ela entra aqui. Se o MYP passar do "Meu valor" da carta, o "Meu valor" é apagado e o
//    app volta a usar o MYP.
// 2) Quanto vale minha carta? (quantovaleminhacarta.com.br, da Leilomania): mediana de VENDAS REAIS finalizadas
//    e pagas, por idioma e estado. O /llms.txt do site declara o conteúdo público e citável e pede: citar a
//    fonte, dizer que são vendas reais, preservar idioma e estado e repassar o aviso de poucas vendas (o app
//    faz tudo isso). A /api/ do site é fechada e não é usada. Cada carta é relida 1×/semana, com pausa entre
//    páginas e cache compartilhado (tabela qvmc_cache).

import { createClient } from 'npm:@supabase/supabase-js@2';

const ZUKAN_MCP = 'https://www.zukan.com.br/mcp';
const SITE = 'https://quantovaleminhacarta.com.br';
const USER_AGENT =
  'FicharioPokedex/1.0 (app de colecionador; cita MYP Cards e quantovaleminhacarta.com.br; https://github.com/willkonrad/fichario-pokedex)';
/** Impressões lidas por chamada. 15 a cada 10 min cobre 1.000 cartas em pouco mais de 11 horas. */
const CARDS_PER_RUN = 15;
/** Pausa entre páginas do "Quanto vale minha carta?". */
const DELAY_MS = 1500;
const REFRESH_DAYS = 7;
/** MYP: a cada 6 dias, para o preço nunca ter mais de uma semana. */
const MYP_REFRESH_DAYS = 6;
const DAY = 86_400_000;

/** Idioma da carta no app → idioma na URL do "Quanto vale minha carta?". */
const SITE_LANG: Record<string, string> = { pt: 'pt', en: 'en', ja: 'jp' };
const CONDITIONS = ['M', 'NM', 'SP', 'MP', 'HP', 'D'] as const;

type MypInfo = {
  price?: number;
  label?: string;
  pt?: number;
  en?: number;
  history?: { t: string; p: number; k: 'pt' | 'en' }[];
  checkedAt: string;
};
type SoldInfo = {
  /** Página da carta no site (para citar a fonte). */
  url?: string;
  /** Mediana de vendas reais por estado (da variante destacada na página). */
  byCondition?: Partial<Record<(typeof CONDITIONS)[number], { value?: number; count: number }>>;
  variant?: string;
  variants?: { name: string; count: number }[];
  lastSale?: { price: number; daysAgo: number };
  sales?: { daysAgo: number; condition?: string; lang?: string; price: number }[];
  summary?: string;
  lowConfidence?: boolean;
  notFound?: string;
  checkedAt: string;
};
type EntryData = {
  cardId?: string;
  lang?: string;
  localId?: string;
  condition?: string;
  ptcgId?: string;
  myp?: MypInfo;
  mypOffers?: { min?: number; condition?: string; lang?: string };
  myValue?: { value: number; setAt?: string } | null;
  sold?: SoldInfo;
};
type Row = { user_id: string; id: string; data: EntryData };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const time = (iso?: string) => (iso ? new Date(iso).getTime() : 0);

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Só o cron (que conhece a chave guardada no Vault) chama esta função.
  const key = req.headers.get('x-sync-key') ?? '';
  const { data: allowed } = await admin.rpc('check_liga_sync_key', { k: key });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);

  // Cartas agrupadas por impressão + idioma (a mesma carta em vários fichários é lida uma vez).
  const { data: rows } = await admin.from('entries').select('user_id, id, data');
  const groups = new Map<string, Row[]>();
  for (const row of (rows ?? []) as Row[]) {
    const { cardId, lang } = row.data;
    if (!cardId || !lang || !SITE_LANG[lang]) continue;
    const k = `${lang}:${cardId}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const now = Date.now();
  // MYP (só PT e EN): com preço, a cada 6 dias; sem preço, todo dia (pode ter ganhado anúncio).
  const mypDue = (g: Row[]) => {
    if (g[0].data.lang !== 'pt' && g[0].data.lang !== 'en') return false;
    const days = g.some((r) => r.data.myp?.price != null) ? MYP_REFRESH_DAYS : 1;
    return now - Math.min(...g.map((r) => time(r.data.myp?.checkedAt))) > days * DAY;
  };
  // Vendas reais: 1×/semana (vendas não mudam tão rápido).
  const soldDue = (g: Row[]) => now - Math.min(...g.map((r) => time(r.data.sold?.checkedAt))) > REFRESH_DAYS * DAY;
  const age = (g: Row[]) => Math.min(...g.map((r) => Math.min(time(r.data.myp?.checkedAt), time(r.data.sold?.checkedAt))));
  const due = [...groups.values()].filter((g) => mypDue(g) || soldDue(g)).sort((a, b) => age(a) - age(b));
  if (!due.length) return json({ next: 'nada para atualizar', groups: groups.size });

  const report = { cards: 0, myp: 0, mypPriced: 0, sold: 0, soldPriced: 0, failed: 0, entriesUpdated: 0 };
  for (const group of due.slice(0, CARDS_PER_RUN)) {
    const { cardId, lang, localId } = group[0].data;
    const fields: Record<string, unknown> = {};
    report.cards++;

    if (mypDue(group)) {
      const myp = await zukanPrice(cardId!, lang!).catch(() => undefined);
      if (myp) {
        fields.myp = myp;
        report.myp++;
        if (myp.price != null) report.mypPriced++;
      } else report.failed++;
    }

    if (soldDue(group)) {
      const ptcgId =
        group.find((r) => r.data.ptcgId)?.data.ptcgId ?? (await resolvePtcgId(cardId!, lang!, localId).catch(() => undefined));
      let sold: SoldInfo | undefined;
      if (!ptcgId) {
        sold = { notFound: 'carta não encontrada no catálogo do site', checkedAt: new Date().toISOString() };
      } else {
        fields.ptcgId = ptcgId;
        const cacheKey = `${SITE_LANG[lang!]}:${ptcgId}`;
        const { data: cached } = await admin.from('qvmc_cache').select('data, fetched_at').eq('key', cacheKey).maybeSingle();
        if (cached && now - time(cached.fetched_at) < REFRESH_DAYS * DAY) {
          sold = cached.data as SoldInfo;
        } else {
          // Falha momentânea do site: as vendas ficam na fila para a próxima rodada.
          sold = await readCardPage(SITE_LANG[lang!], ptcgId).catch(() => undefined);
          if (sold) await admin.from('qvmc_cache').upsert({ key: cacheKey, data: sold, fetched_at: new Date().toISOString() });
          await sleep(DELAY_MS);
        }
      }
      if (sold) {
        fields.sold = sold;
        report.sold++;
        if (Object.values(sold.byCondition ?? {}).some((c) => c?.value != null)) report.soldPriced++;
      } else report.failed++;
    }

    if (!Object.keys(fields).length) continue;
    for (const row of group) {
      const { error } = await admin.rpc('set_entry_fields', { p_user: row.user_id, p_id: row.id, p_fields: { ...fields, ...replaceMyValue(row.data, fields.myp as MypInfo | undefined) } });
      if (!error) report.entriesUpdated++;
    }
  }
  return json({ ...report, pending: Math.max(0, due.length - CARDS_PER_RUN) });
});

/**
 * O MYP passou do "Meu valor"? Então o "Meu valor" é apagado (o app volta a usar o MYP) e fica o registro da troca,
 * mostrado na tela da carta. Vale o mesmo preço do MYP que o app usaria: a oferta no estado e idioma da carta, se
 * houver; senão, o menor anúncio no idioma.
 */
function replaceMyValue(data: EntryData, myp?: MypInfo): Record<string, unknown> {
  const mine = data.myValue?.value;
  if (mine == null || !myp) return {};
  const offer = data.mypOffers;
  const mypValue = offer?.min != null && offer.condition === data.condition && offer.lang === data.lang ? offer.min : myp.price;
  if (mypValue == null || mypValue <= mine) return {};
  return { myValue: null, myValueReplaced: { value: mine, mypValue, at: new Date().toISOString() } };
}

// ---------- MYP Cards (via Zukan) ----------

type ZukanCard = { price?: number | null; priceHistory30d?: { recordedAt: string; price: number; priceType: string }[] };

/**
 * Menor anúncio no MYP Cards no idioma da carta. O Zukan usa os ids da TCGdex (os mesmos do app).
 * PT: campo `price` (BRL). EN: o registro mais recente "brl_nm_en" (NM em inglês).
 */
async function zukanPrice(cardId: string, lang: string): Promise<MypInfo> {
  let card: ZukanCard | undefined;
  for (const id of zukanIds(cardId)) {
    card = await zukanCard(id);
    if (card) break;
  }
  const checkedAt = new Date().toISOString();
  if (!card) return { checkedAt };
  const history = (card.priceHistory30d ?? [])
    .filter((h) => h.priceType === 'brl' || h.priceType === 'brl_nm_en')
    .map((h) => ({ t: h.recordedAt, p: h.price, k: (h.priceType === 'brl' ? 'pt' : 'en') as 'pt' | 'en' }))
    .sort((a, b) => a.t.localeCompare(b.t));
  const pt = card.price ?? undefined;
  const en = [...history].reverse().find((h) => h.k === 'en')?.p;
  // Coleções antigas só em inglês não têm o registro "NM em inglês": vale o menor anúncio geral (`price`).
  const mine = lang === 'pt' ? pt : (en ?? pt);
  return {
    price: mine,
    label:
      mine == null
        ? undefined
        : lang === 'pt'
          ? 'menor anúncio no MYP Cards (português)'
          : en != null
            ? 'menor anúncio NM no MYP Cards (inglês)'
            : 'menor anúncio no MYP Cards',
    pt,
    en,
    history: history.length ? history : undefined,
    checkedAt,
  };
}

/**
 * Ids da carta no Zukan. A TCGdex separa as Galerias de Treinador/Galar em coleções próprias ("swsh11tg-TG06",
 * "swsh12.5gg-GG01"); o Zukan as deixa na coleção principal ("swsh11-TG06", "swsh12.5-GG01").
 */
function zukanIds(cardId: string) {
  const m = cardId.match(/^(.+?)(tg|gg)-(.+)$/i);
  return m ? [cardId, `${m[1]}-${m[3]}`] : [cardId];
}

/** Carta no Zukan (undefined = não encontrada). Erro de rede ou do servidor propaga (a carta fica na fila). */
async function zukanCard(id: string): Promise<ZukanCard | undefined> {
  const res = await fetch(ZUKAN_MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_card', arguments: { id, lang: 'pt' } } }),
  });
  if (!res.ok) throw new Error(`Zukan ${res.status}`);
  const body = await res.json();
  if (body?.result?.isError) return undefined;
  return body?.result?.structuredContent ?? safeJson(body?.result?.content?.[0]?.text);
}

function safeJson(s?: string) {
  try {
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

// ---------- Quanto vale minha carta? (vendas reais) ----------

async function readCardPage(siteLang: string, ptcgId: string): Promise<SoldInfo> {
  const checkedAt = new Date().toISOString();
  const res = await fetch(`${SITE}/cartas/${siteLang}/${encodeURIComponent(ptcgId)}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'follow',
  });
  if (res.status === 404) return { notFound: 'sem página no site', checkedAt };
  if (!res.ok) throw new Error(`QVMC ${res.status}`);
  return { ...parseCardPage(await res.text()), url: res.url, checkedAt };
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** "R$ 1.234,50" → 1234.5; sem número → undefined. */
const brl = (s: string) => {
  const m = s.match(/R\$\s*([\d.]+(?:,\d+)?)/);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : undefined;
};

/** Trecho do HTML entre o marcador e o fim do grupo de botões. */
function section(html: string, marker: string) {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  const end = html.indexOf('</div>', at);
  return html.slice(at, end < 0 ? undefined : end);
}

function parseCardPage(html: string): Omit<SoldInfo, 'checkedAt' | 'url'> {
  const byCondition: SoldInfo['byCondition'] = {};
  const tiles = section(html, 'aria-label="Condição"');
  for (const m of tiles.matchAll(/<b>(M|NM|SP|MP|HP|D)<\/b><span class="qc-cond-v">([^<]*)<\/span><span class="qc-cond-n">([^<]*)<\/span>/g)) {
    const value = brl(m[2]);
    byCondition[m[1] as keyof typeof byCondition] = { value, count: value == null ? 0 : Number(m[3].match(/\d+/)?.[0] ?? 0) };
  }
  const variants: { name: string; count: number }[] = [];
  let variant: string | undefined;
  const chips = section(html, 'data-kind="variant"');
  for (const m of chips.matchAll(/aria-checked="(true|false)"[^>]*><b>([^<]+)<\/b><span class="qc-cond-v">([^<]*)<\/span>/g)) {
    const name = text(m[2]);
    variants.push({ name, count: Number(m[3].match(/\d+/)?.[0] ?? 0) });
    if (m[1] === 'true') variant = name;
  }
  const summary = text(html.match(/<p class="qc-summary">([\s\S]*?)<\/p>/)?.[1] ?? '') || undefined;
  const body = text(html.replace(/<script[\s\S]*?<\/script>/g, ''));
  const last = body.match(/Última venda: R\$\s*([\d.]+(?:,\d+)?) há (\d+) dias?/);
  // Vendas recentes: cada <li class="... qc-sale"> tem "N dias", o estado (data-c), o idioma e o preço.
  const sales: NonNullable<SoldInfo['sales']> = [];
  for (const li of html.matchAll(/<li[^>]*class="[^"]*qc-sale[^"]*"[^>]*>([\s\S]*?)<\/li>/g)) {
    const t = text(li[1]);
    const price = brl(t);
    const days = t.match(/(\d+)\s+dias?/) ?? (/hoje/i.test(t) ? ['', '0'] : null);
    if (price == null || !days) continue;
    sales.push({
      daysAgo: Number(days[1]),
      condition: li[1].match(/data-c="([A-Z]+)"/)?.[1],
      lang: li[1].match(/title="([A-Z]{2}(?:-[A-Z]{2})?)" class="qv-lang"/)?.[1],
      price,
    });
    if (sales.length >= 20) break;
  }
  return {
    byCondition,
    variant,
    variants: variants.length ? variants : undefined,
    lastSale: last ? { price: Number(last[1].replace(/\./g, '').replace(',', '.')), daysAgo: Number(last[2]) } : undefined,
    sales: sales.length ? sales : undefined,
    summary,
    lowConfidence: /Poucas vendas/i.test(body) || undefined,
  };
}

// ---------- Id da carta na pokemontcg.io (o site usa esses ids) ----------

/** Coleções com id diferente entre TCGdex e pokemontcg.io (mesma tabela do app: src/lib/ptcg.ts). */
const SET_ALIASES: Record<string, string[]> = {
  '30th-c': ['me55c'],
  '30th': ['me55'], // 30th Celebration
  hgssp: ['hsp'], // HGSS Black Star Promos
  cel25cc: ['cel25c'],
  lc: ['base6'],
  fut2020: ['fut20'],
  'sv10.5w': ['rsv10pt5'],
  'sv10.5b': ['zsv10pt5'],
};
function ptcgSetIds(tcgdexSetId: string) {
  const id = tcgdexSetId.toLowerCase();
  const plain = id.replace(/(\D)0+(\d)/g, '$1$2');
  return [...new Set([...(SET_ALIASES[id] ?? []), plain.replace('.', 'pt'), plain.replace('.', ''), id])];
}

const setCache = new Map<string, { id: string; name: string; number: string }[] | null>();
async function setCards(ptcgSetId: string) {
  if (!setCache.has(ptcgSetId)) {
    const res = await fetch(`https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/${ptcgSetId}.json`);
    setCache.set(ptcgSetId, res.ok ? ((await res.json()) as { id: string; name: string; number: string }[]) : null);
  }
  return setCache.get(ptcgSetId) ?? null;
}

const sameName = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9δ]+/g, '');
  return norm(a) === norm(b);
};

/**
 * Id da pokemontcg.io conferido pelo NOME da carta (nunca só pelo número: algumas coleções são numeradas
 * de outro jeito, ex.: 30th-c-011 Crobat G = me55c-47). Japonesas: o site usa o código japonês da coleção.
 */
async function resolvePtcgId(cardId: string, lang: string, localId?: string): Promise<string | undefined> {
  const cut = cardId.lastIndexOf('-');
  if (cut <= 0) return undefined;
  if (lang === 'ja') return cardId.toLowerCase();
  const setId = cardId.slice(0, cut);
  const num = (localId ?? cardId.slice(cut + 1)).replace(/^0+(?=\w)/, '').toLowerCase();
  const name = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d?.name as string | undefined)
    .catch(() => undefined);
  if (!name) return undefined;
  let anySet = false;
  for (const set of ptcgSetIds(setId)) {
    const cards = await setCards(set);
    if (!cards) continue;
    anySet = true;
    const sameNumber = cards.find((c) => c.number.toLowerCase() === num && sameName(c.name, name));
    if (sameNumber) return sameNumber.id;
    // Número diferente: só aceita se o nome for único na coleção (senão seria um chute).
    const byName = cards.filter((c) => sameName(c.name, name));
    if (byName.length === 1) return byName[0].id;
  }
  // Coleção que ainda não está nos dados do GitHub (ex.: promos recentes "mep"): usa o número, que nessas
  // coleções segue a regra geral. Nunca para coleções de numeração diferente (SET_ALIASES).
  if (!anySet && !SET_ALIASES[setId.toLowerCase()]) return `${ptcgSetIds(setId)[0]}-${num}`;
  return undefined;
}
