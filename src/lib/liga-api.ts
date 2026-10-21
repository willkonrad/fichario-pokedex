import type { Price } from './types';

/** Uma edição devolvida pela Edge Function liga-price (dados da Apify). */
export type LigaItem = {
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
  /** Faixa de preço por acabamento, ex.: { Normal: {...}, "Reverse Foil": {...} }. */
  priceByFinish?: Record<string, { min?: number; avg?: number; max?: number }>;
  listingCount?: number;
  sellerCount?: number;
  byLanguage?: Record<string, number>;
  lastSaleDate?: string;
  lastSalePriceMid?: number;
};

// Nomes de acabamento usados pela Liga para cada variação do app.
const FINISH_BY_VARIANT: Record<string, RegExp> = {
  normal: /^normal$/i,
  holo: /^(foil|holo)/i,
  reverse: /^reverse/i,
  pokeball: /pok[eé]\s?ball/i,
  masterball: /master\s?ball/i,
  wPromo: /promo/i,
  staff: /(pre.?release|staff)/i,
};

/**
 * Preço de outra variação a partir do quadro de acabamentos já cotado (sem nova cotação).
 * Se a Liga não tiver esse acabamento, devolve undefined e a cotação automática refaz.
 */
export function priceFromFinishes(
  finishes: Record<string, { min?: number; avg?: number; max?: number }> | undefined,
  variant: string,
  base?: Price,
): Price | undefined {
  const match = finishes && Object.entries(finishes).find(([name]) => finishMatchesVariant(name, variant));
  if (!match || !base) return undefined;
  return { ...base, min: match[1].min, avg: match[1].avg, max: match[1].max };
}

/** O acabamento da Liga (ex.: "Reverse Foil") corresponde à variação da carta? */
export function finishMatchesVariant(finish: string, variant: string) {
  return !!FINISH_BY_VARIANT[variant]?.test(finish);
}

/** Preço do acabamento que corresponde à variação da carta; senão, a faixa geral. */
export function priceForVariant(item: LigaItem, variant: string) {
  const re = FINISH_BY_VARIANT[variant];
  const match = re && item.priceByFinish ? Object.entries(item.priceByFinish).find(([name]) => re.test(name)) : undefined;
  if (match) return { ...match[1], finish: match[0] };
  return { min: item.priceMin, avg: item.priceAvg, max: item.priceMax, finish: undefined };
}

/**
 * Número como a Liga mostra: o número da carta exatamente como a TCGdex guarda (que segue a impressão),
 * e o total com os mesmos zeros à esquerda só quando o número tem.
 * Ex.: XY/SWSH "25/124", "1/264"; SV/ME "011/094", "133/132".
 */
export function ligaNumber(localId: string, setTotal: number) {
  const total = /^0/.test(localId) ? String(setTotal).padStart(localId.length, '0') : String(setTotal);
  return `${localId}/${total}`;
}

/** Monta a busca de edição exata, ex.: "Alakazam EX (25/124)", "Charmander (011/094)". */
export function ligaQuery(name: string, localId?: string, setTotal?: number) {
  if (!localId || !setTotal) return name;
  return `${name} (${ligaNumber(localId, setTotal)})`;
}

/** Siglas de coleção que a Liga escreve diferente da sigla oficial (TCGdex). */
const LIGA_EDITION: Record<string, string> = { '30th-c': '30C-C', cel25cc: 'CCC' };

/**
 * Coleções em que a Liga numera diferente da TCGdex (fora as que usam a numeração da pokemontcg.io,
 * ver `ligaNumbering` em ptcg.ts). Ex.: Celebrations Classic Collection: TCGdex "CC005" → Liga "05/25".
 */
export function ligaNumberOverride(setId: string, localId: string, setTotal?: number) {
  if (setId.toLowerCase() === 'cel25cc') {
    const n = localId.replace(/^CC/i, '').replace(/^0+(?=\d)/, '');
    return { number: n.padStart(2, '0'), total: String(setTotal ?? 25) };
  }
  return undefined;
}

/**
 * Link direto da página da carta na Liga (a busca por nome às vezes abre outra carta):
 * ?view=cards/card&card=<nome (número)>&ed=<sigla>&num=<número>.
 */
export function ligaCardUrl(query: string, setId: string, abbreviation: string | undefined, number: string) {
  const ed = LIGA_EDITION[setId.toLowerCase()] ?? abbreviation;
  if (!ed) return undefined;
  const p = new URLSearchParams({ view: 'cards/card', card: query, ed, num: number });
  return `https://www.ligapokemon.com.br/?${p.toString().replace(/\+/g, '%20')}`;
}
