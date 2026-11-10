import { catalogByTcgdexIds, catalogProducts, categoryOf, ENGLISH, isOversize, JAPANESE, plainName, stampVariant, type CatalogRow } from './catalog';
import { japaneseCandidates, japaneseSlotRows } from './ja-catalog';
import { supabase } from './supabase';
import { cardDetail } from './tcgdex';
import type { CardLang, Entry, TcgplayerPrice, ValueBasis, Variant } from './types';
import { onlyStampedPrintings } from './variants';

/**
 * Preço das cartas em inglês e em japonês pela TCGplayer (EUA). O servidor copia 1×/dia os preços do TCGCSV (tabela
 * tcg_prices: menor anúncio, mediana e valor de mercado de cada produto e impressão, em US$) e a PTAX do dólar
 * (fx_rates); o app só lê essas tabelas — nunca chama o TCGCSV — e grava o resultado na carta.
 *
 * Cada idioma usa só o produto do seu catálogo (categoryOf): a carta em inglês, o da categoria 3; a japonesa, o da 85
 * (o produto japonês, nunca o preço da carta em inglês). Na dúvida (mais de um produto possível), sem preço.
 *
 * Em reais, pela PTAX: mínimo = menor anúncio, média = valor de mercado (vendas recentes), máximo = mediana dos
 * anúncios (a faixa sempre contém o mercado; ver tcgplayerColumns). Near Mint (a cópia do TCGCSV não separa por
 * estado). Carta sem vendas recentes fica sem preço (o app não estima).
 */

/** A TCGplayer é a fonte das cartas em inglês e em japonês (as em português ficam com o MYP Cards). */
export function tcgplayerCovers(lang: string | null | undefined) {
  return lang === 'en' || lang === 'ja';
}

/** A coleção tem carta com preço da TCGplayer (inglês ou japonês)? Sem nenhuma, a busca nem consulta o banco. */
export function hasTcgplayerCards(entries: Iterable<Pick<Entry, 'lang'>>) {
  for (const e of entries) if (tcgplayerCovers(e.lang)) return true;
  return false;
}

/**
 * Selo ou versão da carta que importa para achar o produto: o de promo/staff e também o das versões do catálogo com
 * holo ou reverse especial (Cosmos Holo, Cracked Ice Holo, Reverse Cosmos da Costco…), que a TCGplayer vende à parte.
 */
export function tcgplayerNote(e: Entry) {
  return (e.variantNote ?? '').trim();
}

/** O preço guardado é desta carta, versão e selo? */
export function tcgplayerFor(e: Entry): TcgplayerPrice | undefined {
  const s = e.tcgplayer;
  if (!s?.checkedAt || s.cardId !== e.cardId || s.variant !== e.variant || (s.note ?? '') !== tcgplayerNote(e)) return undefined;
  return s;
}

const HOUR = 3_600_000;

/**
 * Carta em inglês ou japonês que precisa de preço novo: sem preço desta carta/versão/selo, ou de uma cópia anterior do
 * TCGCSV. O servidor copia as coleções aos poucos (40 a cada 10 min), então a carta de uma coleção que ainda não foi
 * copiada de novo — ou sem nenhum preço do produto — é olhada de novo no máximo a cada hora.
 */
export function tcgplayerDue(e: Entry, latestBuild: string | undefined, now: number) {
  if (!tcgplayerCovers(e.lang)) return false;
  const s = tcgplayerFor(e);
  if (!s) return true;
  const age = now - new Date(s.checkedAt).getTime();
  if (!s.builtAt) return age > HOUR;
  if (latestBuild) return s.builtAt < latestBuild && age > HOUR;
  return age > 24 * HOUR;
}

/**
 * Colunas da faixa da TCGplayer que têm preço próprio. A faixa sempre contém o mercado (mínimo ≤ média ≤ máximo, aqui,
 * no servidor e no histórico): com a mediana abaixo do mercado (ou sem mediana), o "máximo" é o próprio mercado, e com
 * o menor anúncio acima dele (ou sem menor anúncio), o "mínimo" também. Essas colunas ficam de fora, para não mostrar o
 * mercado com o nome de mediana ou de menor anúncio. Sem os valores em dólar (preço antigo), vale a faixa em reais.
 */
export function tcgplayerColumns(p: Pick<TcgplayerPrice, 'usdLow' | 'usdMid' | 'usdMarket' | 'min' | 'avg' | 'max'>): ValueBasis[] {
  const m = p.usdMarket;
  const low = m != null && p.usdLow != null ? p.usdLow <= m : p.min != null && p.avg != null && p.avg - p.min >= 0.005;
  const mid = m != null && p.usdMid != null ? p.usdMid >= m : p.max != null && p.avg != null && p.max - p.avg >= 0.005;
  return [...(low ? (['min'] as const) : []), 'avg', ...(mid ? (['max'] as const) : [])];
}

/** Motivo de não ter preço, sem repetir o nome da loja (para frases que já dizem "na TCGplayer"). */
export function tcgplayerReason(notFound?: string) {
  return (notFound ?? '').replace(/ (na|da) TCGplayer$/, '');
}

const PRICE_FIELDS = [
  'productId', 'subType', 'url', 'usdLow', 'usdMid', 'usdMarket', 'fx', 'fxDay', 'min', 'avg', 'max', 'base', 'builtAt', 'notFound',
] as const;

/** O preço buscado é igual ao guardado na carta (fora a hora da busca)? Aí não precisa gravar de novo. */
export function sameTcgplayerPrice(e: Entry, p: TcgplayerPrice) {
  const s = tcgplayerFor(e);
  if (!s || s.cardId !== p.cardId || s.variant !== p.variant || (s.note ?? '') !== (p.note ?? '')) return false;
  return PRICE_FIELDS.every((k) => (s[k] ?? null) === (p[k] ?? null));
}

/** Versão mais recente dos preços copiados do TCGCSV (para saber quando renovar). */
export async function latestPriceBuild() {
  if (!supabase) return undefined;
  const { data } = await supabase.from('tcg_prices').select('built_at').order('built_at', { ascending: false }).limit(1).maybeSingle();
  return (data?.built_at as string | undefined) ?? undefined;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/pokemon\s*day/g, 'pokeday')
    .replace(/pre[\s-]?release/g, 'prerelease')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Impressões da TCGplayer (subTypeName) de cada variação do app, na ordem de preferência. */
const SUBTYPES: Partial<Record<Variant, string[]>> = {
  normal: ['Normal', 'Unlimited'],
  holo: ['Holofoil', 'Unlimited Holofoil'],
  reverse: ['Reverse Holofoil'],
  firstEdition: ['1st Edition Holofoil', '1st Edition'],
  shadowless: ['Unlimited Holofoil', 'Unlimited'],
};

/** Coleções de 30 anos da TCGdex: a única impressão de cada carta tem o selo. */
const ONLY_STAMPED_SET = /^30th/i;

/** Produto escolhido: a linha do catálogo e se é o da carta base (`base`: versão sem produto próprio, valor parecido). */
export type ProductPick = { row: CatalogRow; base: boolean };
/** Mais de um produto pode ser a carta: sem preço (nunca o primeiro achado). */
export type AmbiguousPick = { ambiguous: true };

/**
 * Produto da carta na TCGplayer, entre as linhas do catálogo do idioma dela (as cartas japonesas: pickJapanese):
 *   - versão escolhida no catálogo (o selo salvo é exatamente o de um produto, da mesma variação): esse produto;
 *   - Poké Ball / Master Ball: o produto "Poke Ball Pattern" / "Master Ball Pattern";
 *   - promo/staff com selo: o produto com o selo (mesmas palavras; o selo só do logo é o "<Coleção> Stamped" da Booster
 *     Box ou, sem ele, o "Prerelease"); sem ele, a carta base (`base`, valor parecido);
 *   - 1ª edição / Shadowless: o produto da coleção "(Shadowless)" quando existe;
 *   - as outras: o produto comum (sem selo), fora da coleção "(Shadowless)".
 * Mais de um produto possível (ex.: o mesmo Pikachu na "WoTC Promo" e na "Pikachu World Collection"): sem preço, nunca
 * o primeiro achado. Carta gigante (Jumbo) só com o selo exato do produto dela; nunca vale pelo preço da carta comum.
 * `stampOnly`: a carta só existe com selo (onlyStampedPrintings), então o produto sem selo é a própria versão com selo.
 */
export function pickProduct(e: Entry, rows: CatalogRow[], stampOnly = false): ProductPick | AmbiguousPick | undefined {
  if (categoryOf(e.lang) === JAPANESE) return pickJapanese(e, rows);
  const usable = rows.filter((r) => !isOversize(r.stamp));
  const shadowless = (r: CatalogRow) => /shadowless/i.test(r.tcg_groups?.name ?? '');
  const plain = usable.filter((r) => !r.stamp);
  // Carta comum: a sem selo fora da coleção "(Shadowless)" (sem ela, a da "(Shadowless)").
  const commons = plain.some((r) => !shadowless(r)) ? plain.filter((r) => !shadowless(r)) : plain;
  const stamped = (want: (w: string[]) => boolean) => usable.filter((r) => r.stamp && want(words(r.stamp)));
  // A variação também precisa bater: um selo que sobrou depois de trocar de variação não escolhe outra impressão.
  const note = tcgplayerNote(e);
  // Sobre todas as linhas: a carta salva como Jumbo usa o produto Jumbo (sem preço próprio, fica sem preço).
  const exact = note ? rows.filter((r) => r.stamp != null && r.stamp.trim() === note && stampVariant(r.stamp) === e.variant) : [];
  if (exact.length) return onlyOne(exact, false);
  // Selo de carta gigante sem o produto: nunca o preço da carta comum.
  if (isOversize(note)) return undefined;
  switch (e.variant) {
    case 'pokeball': {
      const own = stamped((w) => w.includes('poke') && w.includes('ball'));
      return own.length ? onlyOne(own, false) : onlyOne(commons, true);
    }
    case 'masterball': {
      const own = stamped((w) => w.includes('master') && w.includes('ball'));
      return own.length ? onlyOne(own, false) : onlyOne(commons, true);
    }
    case 'wPromo':
    case 'staff': {
      const keys = (e.stampKeys ?? []).filter((k) => k !== 'set-logo' && k !== '1st-edition');
      const want = (keys.length ? keys.flatMap(words) : words(tcgplayerNote(e))).filter((w) => w.length > 3 && !/^\d+(st|nd|rd|th)?$/.test(w));
      // Selo da Booster Box: "<Coleção> Stamped", com uma palavra do nome da coleção da carta comum.
      const setWords = commons.flatMap((r) => words(r.tcg_groups?.name ?? '')).filter((w) => w.length > 2);
      // O produto de Staff só serve para o selo de Staff ("Prerelease" sozinho não é o "Staff Prerelease").
      const byWords = want.length ? stamped((w) => want.every((x) => w.includes(x)) && (want.includes('staff') || !w.includes('staff'))) : [];
      const boosterBox = () => stamped((w) => (w.includes('stamped') || w.includes('stamp')) && w.some((x) => setWords.includes(x)));
      // Selo só do logo, sem "<Coleção> Stamped": é a promo de Prerelease da coleção. Com outro selo junto (Staff…), não.
      const setLogo = () => {
        const box = boosterBox();
        return box.length ? box : stamped((w) => w.includes('prerelease') && !w.includes('staff'));
      };
      const own = byWords.length ? byWords : e.stampKeys?.includes('set-logo') && !keys.length ? setLogo() : [];
      if (own.length) return onlyOne(own, false);
      // Promo de coleção de promos sem selo marcado: o produto comum é a própria carta. Nas coleções de 30 anos, e em
      // toda carta que só existe com selo, a TCGplayer vende essa impressão sem selo no nome: também é a própria carta.
      return onlyOne(commons, !stampOnly && !ONLY_STAMPED_SET.test(e.setId ?? '') && (!!want.length || !!e.stampKeys?.length));
    }
    case 'firstEdition':
    case 'shadowless': {
      const own = plain.filter(shadowless);
      return onlyOne(own.length ? own : commons, false);
    }
    default:
      // "Outra" versão: o preço da carta comum é só aproximado.
      return onlyOne(commons, e.variant === 'other');
  }
}

/** Exatamente um produto: ele; mais de um: ambíguo (sem preço); nenhum: nada. */
function onlyOne(list: CatalogRow[], base: boolean): ProductPick | AmbiguousPick | undefined {
  return list.length === 1 ? { row: list[0], base } : list.length ? { ambiguous: true } : undefined;
}

/** Na 85 estas versões são produtos à parte, com selo: "Mirror Holofoil"/"Reverse Holofoil", "Poke Ball Pattern"… */
const JA_OWN_PRODUCT: Variant[] = ['reverse', 'pokeball', 'masterball'];

/**
 * Produto da carta japonesa (categoria 85, onde o Mirror/Reverse e as Poké Ball/Master Ball são produtos à parte):
 *   - o selo salvo é exatamente o de um produto, da mesma variação: esse produto;
 *   - reverse / Poké Ball / Master Ball: o produto com o selo da versão ("Mirror …"/"Reverse …", "… Ball Pattern");
 *     sem ele, a carta comum como carta base (`base`, "≈ Aproximado");
 *   - promo/staff com selo marcado e "Outra": a carta comum como carta base;
 *   - as outras (normal, holo, 1ª edição…): a carta comum (sem selo).
 * Mais de um produto possível (ex.: o catálogo repete a carta com o mesmo número): sem preço. Jumbo nunca entra.
 */
function pickJapanese(e: Entry, rows: CatalogRow[]): ProductPick | AmbiguousPick | undefined {
  const usable = rows.filter((r) => r.category === JAPANESE && !isOversize(r.stamp));
  const note = tcgplayerNote(e);
  const inCategory = rows.filter((r) => r.category === JAPANESE);
  const exact = note ? inCategory.filter((r) => r.stamp != null && r.stamp.trim() === note && stampVariant(r.stamp, JAPANESE) === e.variant) : [];
  if (exact.length) return onlyOne(exact, false);
  if (isOversize(note)) return undefined;
  if (JA_OWN_PRODUCT.includes(e.variant)) {
    const own = usable.filter((r) => r.stamp != null && stampVariant(r.stamp, JAPANESE) === e.variant);
    if (own.length) return onlyOne(own, false);
  }
  const marked = (e.variant === 'wPromo' || e.variant === 'staff') && (!!note || !!e.stampKeys?.length);
  return onlyOne(
    usable.filter((r) => !r.stamp),
    JA_OWN_PRODUCT.includes(e.variant) || marked || e.variant === 'other',
  );
}

export type PriceRow = { product_id: number; sub_type: string; low: number | null; mid: number | null; market: number | null; built_at: string };

/** Tipo de impressão: o reverse e a 1ª edição têm preço próprio; o resto (normal, holo, unlimited) é a impressão comum. */
const printKind = (subType: string) => (/reverse/i.test(subType) ? 'reverse' : /1st edition/i.test(subType) ? 'firstEdition' : 'plain');
const variantKind = (v: Variant) => (v === 'reverse' ? 'reverse' : v === 'firstEdition' ? 'firstEdition' : 'plain');

/**
 * Impressão do produto que vale para a variação da carta: a única, ou a da variação (nunca a de outra impressão). A
 * única só vale quando é da mesma espécie (o reverse e a 1ª edição não ficam com o preço da comum, nem a comum com o
 * do reverse), a não ser no produto próprio da versão (`own`, ex.: o "Mirror Holofoil" japonês, cuja impressão é
 * "Holofoil") e na carta base.
 */
export function pickSubType(e: Entry, rows: PriceRow[], base: boolean, own = false) {
  const ja = categoryOf(e.lang) === JAPANESE;
  if (rows.length === 1 && (base || own || printKind(rows[0].sub_type) === variantKind(e.variant))) return rows[0];
  const byVariant = SUBTYPES[e.variant];
  // Produto com as duas impressões (Prize Pack) e nada que diga qual é a da carta: na dúvida, sem preço.
  if (!base && !byVariant && rows.some((r) => r.sub_type === 'Holofoil') && rows.some((r) => r.sub_type === 'Normal')) return undefined;
  const fallback = ['Holofoil', 'Normal', 'Unlimited Holofoil', 'Unlimited'];
  const want = base || !byVariant ? fallback : ja && own ? [...byVariant, ...fallback] : byVariant;
  for (const name of want) {
    const hit = rows.find((r) => r.sub_type === name);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Variação padrão de uma carta japonesa só do catálogo, pelas impressões do produto: 1ª edição quando só há 1ª edição,
 * holo quando todas são holofoil. Nos outros casos, nada (fica a normal).
 */
export function variantFromPrints(subTypes: string[]): Variant | undefined {
  if (!subTypes.length) return undefined;
  if (subTypes.every((s) => /^1st edition/i.test(s))) return 'firstEdition';
  if (subTypes.every((s) => /holofoil/i.test(s) && !/reverse/i.test(s))) return 'holo';
  return undefined;
}

/** Impressões do produto na cópia do TCGCSV (para a variação padrão da carta só do catálogo). */
export async function productPrints(productId: number): Promise<string[]> {
  if (!supabase || !productId) return [];
  const { data, error } = await supabase.from('tcg_prices').select('sub_type').eq('product_id', productId);
  if (error) throw error;
  return ((data ?? []) as { sub_type: string }[]).map((r) => r.sub_type);
}

/**
 * Variação padrão ao salvar uma carta japonesa só do catálogo ("tcgp-<produto>", sem selo): a das impressões do produto
 * (variantFromPrints). Outra carta, produto sem impressões ou sem internet: undefined (fica a regra de sempre).
 */
export async function catalogOnlyVariant(card: { id: string; lang: CardLang; stamp?: unknown }): Promise<Variant | undefined> {
  if (card.lang !== 'ja' || card.stamp || !card.id.startsWith('tcgp-')) return undefined;
  const prints = await productPrints(Number(card.id.slice(5))).catch(() => [] as string[]);
  return variantFromPrints(prints);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Câmbio usado na conta (PTAX de venda do dólar). */
export type FxRow = { day: string; sell: number };

/** Motivos de não ter preço (o painel tira o " na TCGplayer" do fim: tcgplayerReason). */
export const TCG_NOT_FOUND = {
  offCatalog: 'carta fora do catálogo da TCGplayer',
  otherLanguage: 'produto de outro idioma na TCGplayer',
  noVersion: 'sem o produto desta versão na TCGplayer',
  ambiguous: 'mais de um produto na TCGplayer',
  noPrint: 'sem preço desta impressão na TCGplayer',
  noProductPrice: 'nenhum preço do produto na TCGplayer',
  noSales: 'sem vendas recentes na TCGplayer',
  noFx: 'sem câmbio do dia',
} as const;

/**
 * Preço de cada carta a partir do que foi lido do banco (função pura): `rowsByEntry` = linhas do catálogo que podem ser
 * a carta (id da carta → linhas), `prices` = impressões de cada produto, `fx` = câmbio mais recente. Confere a categoria
 * do produto contra o idioma da carta: produto de outro idioma não dá preço. `stampOnly` = ids das cartas que só
 * existem com selo (ver stampOnlyCards).
 */
export function tcgplayerPricesFrom(
  entries: Entry[],
  rowsByEntry: Map<string, CatalogRow[]>,
  prices: Map<number, PriceRow[]>,
  fx: FxRow | undefined,
  checkedAt: string,
  stampOnly: ReadonlySet<string> = new Set(),
): Map<string, TcgplayerPrice> {
  const out = new Map<string, TcgplayerPrice>();
  const rate = fx ? Number(fx.sell) : undefined;
  for (const e of entries) {
    const note = tcgplayerNote(e);
    const base = { cardId: e.cardId, variant: e.variant, note: note || undefined, checkedAt };
    const rows = rowsByEntry.get(e.id) ?? [];
    const fits = rows.filter((r) => r.category === categoryOf(e.lang));
    const pick = fits.length ? pickProduct(e, fits, stampOnly.has(e.cardId)) : undefined;
    if (!pick || 'ambiguous' in pick) {
      const why = !rows.length
        ? TCG_NOT_FOUND.offCatalog
        : !fits.length
          ? TCG_NOT_FOUND.otherLanguage
          : pick
            ? TCG_NOT_FOUND.ambiguous
            : TCG_NOT_FOUND.noVersion;
      out.set(e.id, { ...base, notFound: why });
      continue;
    }
    const product = { productId: pick.row.product_id, url: `https://www.tcgplayer.com/product/${pick.row.product_id}`, base: pick.base || undefined };
    const printRows = prices.get(pick.row.product_id) ?? [];
    const row = pickSubType(e, printRows, pick.base, !pick.base && !!pick.row.stamp);
    if (!row) {
      out.set(e.id, { ...base, ...product, builtAt: printRows[0]?.built_at, notFound: printRows.length ? TCG_NOT_FOUND.noPrint : TCG_NOT_FOUND.noProductPrice });
      continue;
    }
    const usd = { usdLow: row.low ?? undefined, usdMid: row.mid ?? undefined, usdMarket: row.market ?? undefined };
    if (row.market == null || !rate) {
      out.set(e.id, { ...base, ...product, ...usd, subType: row.sub_type, builtAt: row.built_at, notFound: row.market == null ? TCG_NOT_FOUND.noSales : TCG_NOT_FOUND.noFx });
      continue;
    }
    const market = Number(row.market);
    out.set(e.id, {
      ...base,
      ...product,
      ...usd,
      subType: row.sub_type,
      fx: rate,
      fxDay: fx?.day,
      min: round2(Math.min(Number(row.low ?? market), market) * rate),
      avg: round2(market * rate),
      max: round2(Math.max(Number(row.mid ?? market), market) * rate),
      builtAt: row.built_at,
    });
  }
  return out;
}

/**
 * Linhas do catálogo que podem ser cada carta (id da carta → linhas), em lote: as cartas só do catálogo
 * ("tcgp-<produto>") numa consulta pelos produtos; as da TCGdex em inglês pela ligação à TCGdex (categoria 3); as da
 * TCGdex japonesa pela coleção, número e Pokémon na 85 (lib/ja-catalog.ts). Carta japonesa com os dados da TCGdex em
 * inglês (`dataLang` 'en') não tem como achar o produto japonês: fica sem linhas.
 *
 * Carta "tcgp-" da 85 numa versão que o próprio produto não é (ex.: a comum trocada para reverse, ou o Mirror trocado
 * para normal): também os produtos irmãos — mesma coleção, número e nome, de outra versão (o Mirror, a Poké Ball, a
 * comum) —, lidos em lote, para achar o produto da versão (sem ele, a carta base). A comum é sempre o próprio produto.
 */
async function catalogRowsFor(entries: Entry[]): Promise<Map<string, CatalogRow[]>> {
  const out = new Map<string, CatalogRow[]>();
  const catalogOnly = entries.filter((e) => e.cardId.startsWith('tcgp-'));
  const english = entries.filter((e) => !e.cardId.startsWith('tcgp-') && e.lang === 'en');
  const japanese = entries.filter((e) => !e.cardId.startsWith('tcgp-') && e.lang === 'ja' && e.dataLang !== 'en');
  const [products, linked, candidates] = await Promise.all([
    catalogProducts(catalogOnly.map((e) => Number(e.cardId.slice(5)))),
    catalogByTcgdexIds([...new Set(english.map((e) => e.cardId))], ENGLISH),
    japaneseCandidates(japanese),
  ]);
  const byProduct = new Map(products.map((r) => [r.product_id, r]));
  const byTcgdex = new Map<string, CatalogRow[]>();
  for (const r of linked) if (r.tcgdex_id) byTcgdex.set(r.tcgdex_id, [...(byTcgdex.get(r.tcgdex_id) ?? []), r]);
  const needSiblings: [Entry, CatalogRow][] = [];
  for (const e of catalogOnly) {
    const r = byProduct.get(Number(e.cardId.slice(5)));
    if (!r) continue;
    out.set(e.id, [r]);
    if (r.category === JAPANESE && categoryOf(e.lang) === JAPANESE && r.number && !ownProductFits(e, r)) needSiblings.push([e, r]);
  }
  if (needSiblings.length) {
    const wanted = new Map<number, Set<string>>();
    for (const [, r] of needSiblings) wanted.set(r.group_id, (wanted.get(r.group_id) ?? new Set()).add(r.number!));
    const slots = await japaneseSlotRows(wanted);
    for (const [e, r] of needSiblings) {
      const name = plainName(r.name);
      const siblings = slots.filter(
        (s) =>
          s.product_id !== r.product_id &&
          s.category === JAPANESE &&
          s.group_id === r.group_id &&
          s.number === r.number &&
          plainName(s.name) === name &&
          // A carta comum é o próprio produto: outra comum com o mesmo número não entra (não fica ambíguo).
          (!!r.stamp || !!s.stamp),
      );
      out.set(e.id, [r, ...siblings]);
    }
  }
  for (const e of english) out.set(e.id, byTcgdex.get(e.cardId) ?? []);
  for (const e of japanese) out.set(e.id, candidates.get(e.cardId) ?? []);
  return out;
}

/**
 * Cartas em inglês salvas com selo cujo produto é só o sem selo (a carta base) e que só existem com selo: todas as
 * impressões da ficha em inglês da TCGdex têm selo (onlyStampedPrintings, a mesma regra da lista de escolha). Esse
 * produto é a própria carta com selo: o preço vale sem "≈ Aproximado". Só lê a ficha dessas cartas (guardada no
 * aparelho); sem ela (sem internet), fica a carta base.
 */
async function stampOnlyCards(entries: Entry[], rowsByEntry: Map<string, CatalogRow[]>): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const e of entries) {
    if (categoryOf(e.lang) !== ENGLISH || e.cardId.startsWith('tcgp-') || (e.variant !== 'wPromo' && e.variant !== 'staff')) continue;
    const pick = pickProduct(e, (rowsByEntry.get(e.id) ?? []).filter((r) => r.category === ENGLISH));
    if (pick && !('ambiguous' in pick) && pick.base && !pick.row.stamp) ids.add(e.cardId);
  }
  const list = [...ids];
  const details = await Promise.all(list.map((id) => cardDetail(id, 'en').catch(() => null)));
  return new Set(list.filter((_, i) => onlyStampedPrintings(details[i])));
}

/** O próprio produto da carta "tcgp-" já é o da versão dela (não a carta base, nem outra versão)? */
function ownProductFits(e: Entry, r: CatalogRow) {
  const pick = pickProduct(e, [r]);
  return !!pick && !('ambiguous' in pick) && !pick.base;
}

/**
 * Preços da TCGplayer das cartas em inglês e japonês (de uma vez, só leituras no banco): produto e impressão de cada
 * carta, preços da cópia do TCGCSV e câmbio do dia. Devolve um resultado por carta (com `notFound` quando não há preço).
 */
export async function fetchTcgplayerPrices(entries: Entry[]): Promise<Map<string, TcgplayerPrice>> {
  const list = entries.filter((e) => tcgplayerCovers(e.lang));
  if (!supabase || !list.length) return new Map();
  const client = supabase;

  const rowsByEntry = await catalogRowsFor(list);
  // Produtos que podem dar preço (o do idioma da carta), para ler as impressões de uma vez (em blocos de 200).
  const productIds = new Set<number>();
  for (const e of list) {
    const pick = pickProduct(e, (rowsByEntry.get(e.id) ?? []).filter((r) => r.category === categoryOf(e.lang)));
    if (pick && !('ambiguous' in pick)) productIds.add(pick.row.product_id);
  }
  const ids = [...productIds];
  const prices = new Map<number, PriceRow[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await client.from('tcg_prices').select('product_id, sub_type, low, mid, market, built_at').in('product_id', ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as PriceRow[]) prices.set(r.product_id, [...(prices.get(r.product_id) ?? []), r]);
  }
  const { data: fxRow, error: fxError } = await client
    .from('fx_rates')
    .select('day, sell')
    .eq('currency', 'USD')
    .order('day', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fxError) throw fxError;
  const stampOnly = await stampOnlyCards(list, rowsByEntry);
  return tcgplayerPricesFrom(list, rowsByEntry, prices, (fxRow as FxRow | null) ?? undefined, new Date().toISOString(), stampOnly);
}
