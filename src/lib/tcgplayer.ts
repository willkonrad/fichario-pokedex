import { catalogByTcgdexIds, catalogProduct, stampVariant, type CatalogRow } from './catalog';
import { supabase } from './supabase';
import type { Entry, TcgplayerPrice, Variant } from './types';

/**
 * Preço das cartas em inglês pela TCGplayer (EUA), o principal mercado de cartas em inglês. O servidor copia 1×/dia
 * os preços do TCGCSV (tabela tcg_prices: menor anúncio, mediana e valor de mercado de cada produto e impressão, em
 * US$) e a PTAX do dólar (fx_rates); o app só lê essas tabelas — nunca chama o TCGCSV — e grava o resultado na carta.
 *
 * Em reais, pela PTAX: mínimo = menor anúncio, média = valor de mercado (vendas recentes), máximo = mediana dos
 * anúncios. Todos os estados juntos (a TCGplayer não separa por produto). Carta sem vendas recentes fica sem preço
 * (o app não estima).
 */

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
 * Carta em inglês que precisa de preço novo: sem preço desta carta/versão/selo, ou de uma cópia anterior do TCGCSV.
 * O servidor copia as coleções aos poucos (40 a cada 10 min), então a carta de uma coleção que ainda não foi copiada
 * de novo — ou sem nenhum preço do produto — é olhada de novo no máximo a cada hora.
 */
export function tcgplayerDue(e: Entry, latestBuild: string | undefined, now: number) {
  if (e.lang !== 'en') return false;
  const s = tcgplayerFor(e);
  if (!s) return true;
  const age = now - new Date(s.checkedAt).getTime();
  if (!s.builtAt) return age > HOUR;
  if (latestBuild) return s.builtAt < latestBuild && age > HOUR;
  return age > 24 * HOUR;
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

/**
 * Produto da carta na TCGplayer, entre as linhas do catálogo ligadas a ela:
 *   - versão escolhida no catálogo (o selo salvo é exatamente o de um produto, da mesma variação): esse produto;
 *   - Poké Ball / Master Ball: o produto "Poke Ball Pattern" / "Master Ball Pattern";
 *   - promo/staff com selo: o produto com o selo (mesmas palavras; o da Booster Box é "<Coleção> Stamped"); sem ele,
 *     a carta base (`base`, valor parecido);
 *   - 1ª edição / Shadowless: o produto da coleção "(Shadowless)" quando existe;
 *   - as outras: o produto comum (sem selo), fora da coleção "(Shadowless)".
 * Cartas gigantes (Jumbo) nunca entram.
 */
function pickProduct(e: Entry, rows: CatalogRow[]): { row: CatalogRow; base: boolean } | undefined {
  const usable = rows.filter((r) => !/jumbo|oversize/i.test(r.stamp ?? ''));
  const shadowless = (r: CatalogRow) => /shadowless/i.test(r.tcg_groups?.name ?? '');
  const plain = usable.filter((r) => !r.stamp);
  const common = plain.find((r) => !shadowless(r)) ?? plain[0];
  const stamped = (want: (w: string[]) => boolean) => usable.find((r) => r.stamp && want(words(r.stamp)));
  // A variação também precisa bater: um selo que sobrou depois de trocar de variação não escolhe outra impressão.
  const note = tcgplayerNote(e);
  const exact = note ? usable.find((r) => r.stamp != null && r.stamp.trim() === note && stampVariant(r.stamp) === e.variant) : undefined;
  if (exact) return { row: exact, base: false };
  switch (e.variant) {
    case 'pokeball': {
      const own = stamped((w) => w.includes('poke') && w.includes('ball'));
      return own ? { row: own, base: false } : common ? { row: common, base: true } : undefined;
    }
    case 'masterball': {
      const own = stamped((w) => w.includes('master') && w.includes('ball'));
      return own ? { row: own, base: false } : common ? { row: common, base: true } : undefined;
    }
    case 'wPromo':
    case 'staff': {
      const keys = (e.stampKeys ?? []).filter((k) => k !== 'set-logo' && k !== '1st-edition');
      const want = (keys.length ? keys.flatMap(words) : words(tcgplayerNote(e))).filter((w) => w.length > 3 && !/^\d+(st|nd|rd|th)?$/.test(w));
      // Selo da Booster Box: "<Coleção> Stamped", com uma palavra do nome da coleção da carta comum.
      const setWords = words(common?.tcg_groups?.name ?? '').filter((w) => w.length > 2);
      const own =
        (want.length ? stamped((w) => want.every((x) => w.includes(x))) : undefined) ??
        (e.stampKeys?.includes('set-logo') ? stamped((w) => (w.includes('stamped') || w.includes('stamp')) && w.some((x) => setWords.includes(x))) : undefined);
      // Promo de coleção de promos sem selo marcado: o produto comum é a própria carta.
      return own ? { row: own, base: false } : common ? { row: common, base: !!want.length || !!e.stampKeys?.length } : undefined;
    }
    case 'firstEdition':
    case 'shadowless': {
      const row = plain.find(shadowless) ?? common;
      return row ? { row, base: false } : undefined;
    }
    default:
      return common ? { row: common, base: false } : undefined;
  }
}

type PriceRow = { product_id: number; sub_type: string; low: number | null; mid: number | null; market: number | null; built_at: string };

/** Impressão do produto que vale para a variação da carta: a única, ou a da variação (nunca a de outra impressão). */
function pickSubType(e: Entry, rows: PriceRow[], base: boolean) {
  if (rows.length === 1) return rows[0];
  const want = base || !SUBTYPES[e.variant] ? ['Holofoil', 'Normal'] : SUBTYPES[e.variant]!;
  for (const name of want) {
    const hit = rows.find((r) => r.sub_type === name);
    if (hit) return hit;
  }
  return undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Preços da TCGplayer das cartas em inglês (de uma vez, só leituras no banco): produto e impressão de cada carta,
 * preços da cópia do TCGCSV e câmbio do dia. Devolve um resultado por carta (com `notFound` quando não há preço).
 */
export async function fetchTcgplayerPrices(entries: Entry[]): Promise<Map<string, TcgplayerPrice>> {
  const out = new Map<string, TcgplayerPrice>();
  if (!supabase || !entries.length) return out;
  const client = supabase;

  // Catálogo: linhas ligadas a cada carta da TCGdex; cartas só do catálogo ("tcgp-<produto>") pelo próprio produto.
  const tcgdexIds = [...new Set(entries.filter((e) => !e.cardId.startsWith('tcgp-')).map((e) => e.cardId))];
  const rowsByCard = new Map<string, CatalogRow[]>();
  for (const r of await catalogByTcgdexIds(tcgdexIds)) {
    if (r.tcgdex_id) rowsByCard.set(r.tcgdex_id, [...(rowsByCard.get(r.tcgdex_id) ?? []), r]);
  }
  for (const id of new Set(entries.filter((e) => e.cardId.startsWith('tcgp-')).map((e) => e.cardId))) {
    const r = await catalogProduct(Number(id.slice(5)));
    if (r) rowsByCard.set(id, [r]);
  }
  const picks = new Map(entries.map((e) => [e.id, pickProduct(e, rowsByCard.get(e.cardId) ?? [])]));

  // Preços dos produtos escolhidos (em blocos de 200) e câmbio mais recente.
  const productIds = [...new Set([...picks.values()].filter((p) => !!p).map((p) => p!.row.product_id))];
  const prices = new Map<number, PriceRow[]>();
  for (let i = 0; i < productIds.length; i += 200) {
    const { data, error } = await client
      .from('tcg_prices')
      .select('product_id, sub_type, low, mid, market, built_at')
      .in('product_id', productIds.slice(i, i + 200));
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
  const fx = fxRow ? Number(fxRow.sell) : undefined;

  const checkedAt = new Date().toISOString();
  for (const e of entries) {
    const note = tcgplayerNote(e);
    const base = { cardId: e.cardId, variant: e.variant, note: note || undefined, checkedAt };
    const pick = picks.get(e.id);
    if (!pick) {
      out.set(e.id, { ...base, notFound: 'carta fora do catálogo da TCGplayer' });
      continue;
    }
    const product = { productId: pick.row.product_id, url: `https://www.tcgplayer.com/product/${pick.row.product_id}`, base: pick.base || undefined };
    const rows = prices.get(pick.row.product_id) ?? [];
    const row = pickSubType(e, rows, pick.base);
    if (!row) {
      out.set(e.id, { ...base, ...product, builtAt: rows[0]?.built_at, notFound: rows.length ? 'sem preço desta impressão na TCGplayer' : 'nenhum preço do produto na TCGplayer' });
      continue;
    }
    const usd = { usdLow: row.low ?? undefined, usdMid: row.mid ?? undefined, usdMarket: row.market ?? undefined };
    if (row.market == null || !fx) {
      out.set(e.id, { ...base, ...product, ...usd, subType: row.sub_type, builtAt: row.built_at, notFound: row.market == null ? 'sem vendas recentes na TCGplayer' : 'sem câmbio do dia' });
      continue;
    }
    const market = Number(row.market);
    out.set(e.id, {
      ...base,
      ...product,
      ...usd,
      subType: row.sub_type,
      fx,
      fxDay: fxRow?.day as string | undefined,
      min: round2(Math.min(Number(row.low ?? market), market) * fx),
      avg: round2(market * fx),
      max: round2(Math.max(Number(row.mid ?? market), market) * fx),
      builtAt: row.built_at,
    });
  }
  return out;
}
