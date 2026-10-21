// Edge Function: preços de mercado das cartas, de fontes que autorizam esse uso. Chamada pelo pg_cron a cada 10 min.
//
// 1) VENDAS REAIS por idioma e estado, do "Quanto vale minha carta?" (quantovaleminhacarta.com.br, da Leilomania).
// 2) MENOR ANÚNCIO no MYP Cards por idioma, pelo servidor MCP público do Zukan (zukan.com.br/mcp), feito para
//    apps e assistentes consultarem preços.
// 3) TCGplayer (US$) e Cardmarket (€) da variante da carta, pela API pública da TCGdex; câmbio do BCE.
// 4) CardTrader: menor anúncio no estado e idioma da carta, pela API oficial (só com a chave CARDTRADER_TOKEN).
// (A LigaPokemon é cotada à parte, pelo liga-sync.)
//
// O site publica a mediana de vendas finalizadas e pagas, em reais, separada por idioma (PT/EN/JP) e
// estado (M, NM, SP, MP, HP, D), e autoriza apps e agentes a ler as páginas de carta (HTML público,
// renderizado no servidor), pedindo só que a fonte seja citada (ver /llms.txt do site). A /api/ do site
// é fechada e não é usada. Para não sobrecarregar o site: poucas páginas por chamada, com pausa entre elas,
// cache compartilhado por impressão e cada carta só é relida depois de REFRESH_DAYS.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = 'https://quantovaleminhacarta.com.br';
const USER_AGENT = 'FicharioPokedex/1.0 (app de colecionador; cita quantovaleminhacarta.com.br)';
/** Páginas lidas por chamada e pausa entre elas. 20 a cada 10 min cobre 1.000 cartas em menos de um dia. */
const PAGES_PER_RUN = 20;
const DELAY_MS = 1500;
/** Cada carta é relida a cada 7 dias (o site recalcula de hora em hora, mas vendas não mudam tão rápido). */
const REFRESH_DAYS = 7;
const DAY = 86_400_000;

/** Idioma da carta no app → idioma na URL do site. */
const SITE_LANG: Record<string, string> = { pt: 'pt', en: 'en', ja: 'jp' };
const CONDITIONS = ['M', 'NM', 'SP', 'MP', 'HP', 'D'] as const;

type CondValue = { value?: number; count: number };
export type SoldInfo = {
  /** Página da carta no site (para citar a fonte). */
  url?: string;
  /** Mediana de vendas reais por estado (da variante destacada na página). */
  byCondition?: Partial<Record<(typeof CONDITIONS)[number], CondValue>>;
  /** Variante a que os valores se referem (ex.: "Normal") e as variantes com vendas. */
  variant?: string;
  variants?: { name: string; count: number }[];
  lastSale?: { price: number; daysAgo: number };
  /** Vendas recentes listadas na página (mais recente primeiro). */
  sales?: { daysAgo: number; condition?: string; lang?: string; price: number }[];
  /** Frase-resumo do site (período usado, número de vendas). */
  summary?: string;
  /** O site avisa que há poucas vendas (1 ou 2): referência inicial, não valor firme. */
  lowConfidence?: boolean;
  /** Sem página no site para esta impressão/idioma, ou id não encontrado. */
  notFound?: string;
  checkedAt: string;
};
/** Menor anúncio no MYP Cards no idioma da carta (via Zukan). */
export type MypInfo = {
  /** Menor anúncio no idioma da carta. */
  price?: number;
  label?: string;
  /** Menor anúncio em português e NM em inglês, para comparar idiomas. */
  pt?: number;
  en?: number;
  /** Histórico de 30 dias (BRL): t = data ISO, p = preço, k = idioma. */
  history?: { t: string; p: number; k: 'pt' | 'en' }[];
  checkedAt: string;
};
/**
 * Preços internacionais da carta (na variante dela), já com o câmbio do dia para converter em reais:
 * TCGplayer (EUA, US$) e Cardmarket (Europa, €) pela TCGdex; CardTrader (anúncios, por estado e idioma)
 * pela API oficial, quando houver a chave CARDTRADER_TOKEN.
 */
export type IntlInfo = {
  tcgplayer?: { market?: number; low?: number; mid?: number; finish?: string; productId?: number };
  cardmarket?: { trend?: number; avg?: number; low?: number; avg30?: number; idProduct?: number };
  cardtrader?: { min?: number; currency?: string; count: number; blueprintId: number; condition?: string; language?: string };
  /** Reais por 1 US$ e por 1 € (BCE), na data indicada. */
  fx?: { usd: number; eur: number; date: string };
  checkedAt: string;
};
type EntryData = {
  cardId?: string;
  lang?: string;
  localId?: string;
  ptcgId?: string;
  variant?: string;
  condition?: string;
  sold?: SoldInfo;
};
type Row = { user_id: string; id: string; data: EntryData };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Mesma proteção do liga-sync: só o cron (que conhece a chave do Vault) chama esta função.
  const key = req.headers.get('x-sync-key') ?? '';
  const { data: allowed } = await admin.rpc('check_liga_sync_key', { k: key });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);

  // 1) Cartas agrupadas por impressão + idioma; vencidas = nunca lidas ou lidas há mais de REFRESH_DAYS.
  const { data: rows } = await admin.from('entries').select('user_id, id, data');
  const groups = new Map<string, Row[]>();
  for (const row of (rows ?? []) as Row[]) {
    const { cardId, lang } = row.data;
    if (!cardId || !lang || !SITE_LANG[lang]) continue;
    const k = `${lang}:${cardId}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  // Última leitura da carta: a mais antiga entre vendas reais e MYP (PT/EN têm as duas fontes).
  const time = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
  const rowAge = (d: EntryData & { myp?: MypInfo; intl?: IntlInfo }) =>
    Math.min(
      time(d.sold?.checkedAt),
      time(d.intl?.checkedAt),
      d.lang === 'pt' || d.lang === 'en' ? time(d.myp?.checkedAt) : Infinity,
    );
  const age = (g: Row[]) => Math.min(...g.map((r) => rowAge(r.data)));
  const due = [...groups.values()]
    .filter((g) => Date.now() - age(g) > REFRESH_DAYS * DAY)
    .sort((a, b) => age(a) - age(b)) // nunca lidas (0) primeiro, depois as mais antigas
    .slice(0, PAGES_PER_RUN);
  if (!due.length) return json({ next: 'nada para atualizar', groups: groups.size });

  const report = { read: 0, fromCache: 0, notFound: 0, myp: 0, intl: 0, entriesUpdated: 0 };
  const fx = await exchangeRates().catch(() => undefined);
  for (const group of due) {
    const { cardId, lang, localId } = group[0].data;
    const siteLang = SITE_LANG[lang!];
    const ptcgId = group.find((r) => r.data.ptcgId)?.data.ptcgId ?? (await resolvePtcgId(cardId!, lang!, localId));
    let sold: SoldInfo;
    if (!ptcgId) {
      sold = { notFound: 'carta não encontrada no catálogo da pokemontcg.io', checkedAt: new Date().toISOString() };
      report.notFound++;
    } else {
      const cacheKey = `${siteLang}:${ptcgId}`;
      const { data: cached } = await admin.from('qvmc_cache').select('data, fetched_at').eq('key', cacheKey).maybeSingle();
      if (cached && Date.now() - new Date(cached.fetched_at).getTime() < REFRESH_DAYS * DAY) {
        sold = cached.data as SoldInfo;
        report.fromCache++;
      } else {
        // Falha momentânea do site: pula só esta carta (ela continua na fila para a próxima rodada).
        const page = await readCardPage(siteLang, ptcgId).catch(() => null);
        if (!page) continue;
        sold = page;
        await admin.from('qvmc_cache').upsert({ key: cacheKey, data: sold, fetched_at: new Date().toISOString() });
        report.read++;
        if (sold.notFound) report.notFound++;
        await sleep(DELAY_MS);
      }
    }
    const myp = await zukanPrice(cardId!, lang!).catch(() => undefined);
    if (myp?.price != null) report.myp++;
    const shared = { sold, ...(ptcgId ? { ptcgId } : {}), ...(myp ? { myp } : {}) };
    // Preços internacionais dependem da variante e do estado de cada carta (podem diferir dentro do grupo).
    const intlCache = new Map<string, IntlInfo | undefined>();
    for (const row of group) {
      const k = `${row.data.variant ?? 'normal'}|${row.data.condition ?? 'NM'}`;
      if (!intlCache.has(k)) {
        intlCache.set(k, await intlPrices(cardId!, lang!, row.data.variant, row.data.condition, fx).catch(() => undefined));
      }
      const intl = intlCache.get(k);
      if (intl?.tcgplayer || intl?.cardmarket || intl?.cardtrader) report.intl++;
      const fields = { ...shared, ...(intl ? { intl } : {}) };
      const { error } = await admin.rpc('set_entry_fields', { p_user: row.user_id, p_id: row.id, p_fields: fields });
      if (!error) report.entriesUpdated++;
    }
  }
  return json({ ...report, pending: Math.max(0, [...groups.values()].filter((g) => Date.now() - age(g) > REFRESH_DAYS * DAY).length - due.length) });
});

// ---------- Preços internacionais: TCGplayer e Cardmarket (TCGdex), CardTrader (API oficial) ----------

/** Câmbio do dia (Banco Central Europeu, via frankfurter.dev, gratuito e sem chave). */
async function exchangeRates(): Promise<IntlInfo['fx']> {
  const [usd, eur] = await Promise.all(
    ['USD', 'EUR'].map((base) =>
      fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=BRL`).then((r) => {
        if (!r.ok) throw new Error(`câmbio ${r.status}`);
        return r.json() as Promise<{ date: string; rates: { BRL: number } }>;
      }),
    ),
  );
  return { usd: usd.rates.BRL, eur: eur.rates.BRL, date: usd.date };
}

type TcgdexPrinting = {
  type: string;
  foil?: string;
  stamp?: string[];
  subtype?: string;
  thirdParty?: { cardmarket?: number; tcgplayer?: number; cardtrader?: number };
  pricing?: TcgdexPricing;
};
type TcgdexPricing = {
  cardmarket?: Record<string, number | string | null> | null;
  tcgplayer?: Record<string, { lowPrice?: number; midPrice?: number; marketPrice?: number; productId?: number } | string> | null;
};

/** Impressão da TCGdex que corresponde à variação da carta no app (normal, holo, reverse, Poké Ball, selo…). */
function matchPrinting(printings: TcgdexPrinting[], variant = 'normal') {
  const stamped = (p: TcgdexPrinting) => (p.stamp ?? []).length > 0;
  const want = (p: TcgdexPrinting) => {
    const foil = p.foil?.toLowerCase();
    switch (variant) {
      case 'pokeball':
        return foil === 'pokeball';
      case 'masterball':
        return foil === 'masterball';
      case 'firstEdition':
        return (p.stamp ?? []).includes('1st-edition');
      case 'shadowless':
        return p.subtype === 'shadowless';
      case 'wPromo':
      case 'staff':
        return stamped(p);
      default:
        return p.type === variant && !stamped(p) && foil !== 'pokeball' && foil !== 'masterball';
    }
  };
  return printings.find(want) ?? printings.find((p) => !stamped(p)) ?? printings[0];
}

/** Acabamento do TCGplayer que corresponde à variação (holofoil, reverseHolofoil, normal…). */
const TCGPLAYER_FINISH: Record<string, string[]> = {
  normal: ['normal', 'unlimited'],
  holo: ['holofoil', 'unlimitedHolofoil', 'unlimited-holofoil'],
  reverse: ['reverseHolofoil', 'reverse-holofoil'],
  pokeball: ['reverseHolofoil', 'reverse-holofoil'],
  masterball: ['reverseHolofoil', 'reverse-holofoil'],
  firstEdition: ['1stEditionHolofoil', '1st-edition-holofoil', '1stEditionNormal', '1st-edition-normal'],
};

const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);

/** Nomes de estado do CardTrader (inglês) → sigla do app. */
const CT_CONDITION: Record<string, string> = {
  mint: 'M',
  'near mint': 'NM',
  'slightly played': 'SP',
  'moderately played': 'MP',
  'heavily played': 'HP',
  played: 'HP',
  poor: 'D',
  damaged: 'D',
};

async function intlPrices(
  cardId: string,
  lang: string,
  variant?: string,
  condition = 'NM',
  fx?: IntlInfo['fx'],
): Promise<IntlInfo | undefined> {
  const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`);
  if (!res.ok) return undefined;
  const card = (await res.json()) as { pricing?: TcgdexPricing; variants_detailed?: TcgdexPrinting[] };
  const printing = matchPrinting(card.variants_detailed ?? [], variant);
  const pricing = printing?.pricing ?? card.pricing ?? {};
  const checkedAt = new Date().toISOString();

  // TCGplayer: preço de mercado do acabamento da carta.
  let tcgplayer: IntlInfo['tcgplayer'];
  const tp = pricing.tcgplayer;
  if (tp) {
    const keys = [...(TCGPLAYER_FINISH[variant ?? 'normal'] ?? []), ...Object.keys(tp)];
    for (const k of keys) {
      const p = tp[k];
      if (p && typeof p === 'object' && (p.marketPrice || p.midPrice || p.lowPrice)) {
        tcgplayer = { market: num(p.marketPrice), low: num(p.lowPrice), mid: num(p.midPrice), finish: k, productId: p.productId };
        break;
      }
    }
  }

  // Cardmarket: nos campos "-holo" fica o preço da versão reverse/holo da carta.
  let cardmarket: IntlInfo['cardmarket'];
  const cm = pricing.cardmarket;
  if (cm) {
    const h = variant === 'reverse' || variant === 'pokeball' || variant === 'masterball' ? '-holo' : '';
    const pick = (f: string) => num(cm[`${f}${h}`]) ?? num(cm[f]);
    cardmarket = { trend: pick('trend'), avg: pick('avg'), low: pick('low'), avg30: pick('avg30'), idProduct: num(cm.idProduct) };
    if (!cardmarket.trend && !cardmarket.avg && !cardmarket.low) cardmarket = undefined;
  }

  // CardTrader: menor anúncio no estado e idioma da carta (só com a chave da conta do usuário).
  let cardtrader: IntlInfo['cardtrader'];
  const blueprintId = printing?.thirdParty?.cardtrader;
  const token = Deno.env.get('CARDTRADER_TOKEN');
  if (token && blueprintId) cardtrader = await cardTraderMin(token, blueprintId, condition, lang).catch(() => undefined);

  if (!tcgplayer && !cardmarket && !cardtrader) return { fx, checkedAt };
  return { tcgplayer, cardmarket, cardtrader, fx, checkedAt };
}

type CtProduct = {
  price_cents?: number;
  price_currency?: string;
  price?: { cents?: number; currency?: string };
  properties_hash?: Record<string, unknown>;
};

/** Menor anúncio ativo no CardTrader no estado e idioma da carta (API oficial, limite de uso respeitado). */
async function cardTraderMin(token: string, blueprintId: number, condition: string, lang: string) {
  const res = await fetch(`https://api.cardtrader.com/api/v2/marketplace/products?blueprint_id=${blueprintId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`CardTrader ${res.status}`);
  const body = (await res.json()) as Record<string, CtProduct[]>;
  const products = Object.values(body).flat();
  const wantLang = lang === 'ja' ? 'jp' : lang;
  const offers = products
    .map((p) => {
      const props = p.properties_hash ?? {};
      const cond = CT_CONDITION[String(props.condition ?? '').toLowerCase()];
      const pl = String(props.pokemon_language ?? '').toLowerCase();
      return { cents: p.price_cents ?? p.price?.cents, currency: p.price_currency ?? p.price?.currency, cond, lang: pl };
    })
    .filter((o) => o.cents && o.cond === condition && o.lang === wantLang);
  if (!offers.length) return { count: 0, blueprintId, condition, language: wantLang };
  const best = offers.reduce((a, b) => (a.cents! <= b.cents! ? a : b));
  return { min: best.cents! / 100, currency: best.currency, count: offers.length, blueprintId, condition, language: wantLang };
}

// ---------- Zukan (MCP público): menor anúncio no MYP Cards ----------

const ZUKAN_MCP = 'https://www.zukan.com.br/mcp';
type ZukanCard = { price?: number | null; priceHistory30d?: { recordedAt: string; price: number; priceType: string }[] };

/**
 * Menor anúncio no MYP Cards no idioma da carta. O Zukan usa os ids da TCGdex (os mesmos do app).
 * PT: campo `price` (BRL). EN: o registro mais recente "brl_nm_en" (NM em inglês). JP: não tem.
 */
async function zukanPrice(cardId: string, lang: string): Promise<MypInfo | undefined> {
  if (lang !== 'pt' && lang !== 'en') return undefined;
  const res = await fetch(ZUKAN_MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_card', arguments: { id: cardId, lang: 'pt' } } }),
  });
  if (!res.ok) throw new Error(`Zukan ${res.status}`);
  const body = await res.json();
  const card: ZukanCard | undefined = body?.result?.structuredContent ?? safeJson(body?.result?.content?.[0]?.text);
  const checkedAt = new Date().toISOString();
  if (!card) return { checkedAt };
  const history = (card.priceHistory30d ?? [])
    .filter((h) => h.priceType === 'brl' || h.priceType === 'brl_nm_en')
    .map((h) => ({ t: h.recordedAt, p: h.price, k: (h.priceType === 'brl' ? 'pt' : 'en') as 'pt' | 'en' }))
    .sort((a, b) => a.t.localeCompare(b.t));
  const pt = card.price ?? undefined;
  const en = [...history].reverse().find((h) => h.k === 'en')?.p;
  const mine = lang === 'pt' ? pt : en;
  return {
    price: mine,
    label: mine == null ? undefined : lang === 'pt' ? 'menor anúncio no MYP Cards (português)' : 'menor anúncio NM no MYP Cards (inglês)',
    pt,
    en,
    history: history.length ? history : undefined,
    checkedAt,
  };
}

function safeJson(s?: string) {
  try {
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

// ---------- Leitura da página da carta ----------

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

export function parseCardPage(html: string): Omit<SoldInfo, 'checkedAt' | 'url'> {
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
