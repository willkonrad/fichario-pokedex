import { supabase } from './supabase';
import type { Variant } from './types';

/**
 * Catálogo de cartas do TCGCSV (catálogo da TCGplayer), copiado 1×/dia pelo servidor (Edge Function catalog-sync)
 * para a tabela tcg_catalog. É a base principal das listas de cartas: tem as coleções novas e as versões com selo
 * vendidas à parte (Pokémon Center, campeonatos…), com a foto de cada uma. O app nunca chama o TCGCSV direto.
 */
export type CatalogRow = {
  product_id: number;
  category: number;
  group_id: number;
  /** Nome da carta, sem número e complementos (igual em inglês e português para os Pokémon). */
  name: string;
  full_name: string;
  number: string | null;
  rarity: string | null;
  /** Foto da carta na TCGplayer (em inglês). */
  image: string;
  /** Complemento que distingue a versão ("Pokemon Center Exclusive"); null na versão comum. */
  stamp: string | null;
  /** Id da mesma carta na TCGdex (ficha em português, variações, preços), quando ela existe lá. */
  tcgdex_id: string | null;
  tcg_groups: { name: string; abbr: string | null } | null;
};

const COLUMNS = 'product_id, category, group_id, name, full_name, number, rarity, image, stamp, tcgdex_id, tcg_groups(name, abbr)';
/** 3 = Pokémon em inglês (as cartas em português são as mesmas, com o mesmo nome). */
export const ENGLISH = 3;

/** Cartas cujo nome contém `name` (em páginas de 1.000, limite da API). */
export async function catalogByName(name: string, category = ENGLISH): Promise<CatalogRow[]> {
  if (!supabase) return [];
  const pattern = `%${name.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const out: CatalogRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('tcg_catalog')
      .select(COLUMNS)
      .eq('category', category)
      .ilike('name', pattern)
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as CatalogRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Cartas ligadas a estes ids da TCGdex (pega as de nome diferente, ex.: "Nidoran♀"). */
export async function catalogByTcgdexIds(ids: string[]): Promise<CatalogRow[]> {
  if (!supabase || !ids.length) return [];
  const out: CatalogRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('tcg_catalog').select(COLUMNS).in('tcgdex_id', ids.slice(i, i + 200));
    if (error) throw error;
    out.push(...((data ?? []) as unknown as CatalogRow[]));
  }
  return out;
}

export async function catalogProduct(productId: number): Promise<CatalogRow | undefined> {
  if (!supabase) return undefined;
  const { data, error } = await supabase.from('tcg_catalog').select(COLUMNS).eq('product_id', productId).maybeSingle();
  if (error) throw error;
  return (data as unknown as CatalogRow) ?? undefined;
}

/** "133/132" → "133". */
export const catalogNumber = (n?: string | null) => (n ?? '').split('/')[0].trim();

/** Variação do app para uma versão do catálogo ("Cosmos Holo" → holo, "Pokemon Center Exclusive" → promo/selo). */
export function stampVariant(stamp: string): Variant {
  if (/staff|prerelease/i.test(stamp)) return 'staff';
  if (/master ?ball/i.test(stamp)) return 'masterball';
  if (/pok[eé] ?ball/i.test(stamp)) return 'pokeball';
  if (/reverse/i.test(stamp)) return 'reverse';
  if (/cosmos|holo/i.test(stamp)) return 'holo';
  if (/1st edition/i.test(stamp)) return 'firstEdition';
  return 'wPromo';
}

/** Foto da TCGplayer no tamanho pedido (a lista usa a pequena). */
export function catalogImage(url: string, quality: 'low' | 'high') {
  return quality === 'low' ? url.replace('_in_1000x1000.jpg', '_200w.jpg') : url;
}
