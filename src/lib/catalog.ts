import { supabase } from './supabase';
import type { CardLang, Variant } from './types';

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
  /** Foto da carta na TCGplayer (na 3, da carta em inglês; na 85, da carta japonesa). */
  image: string;
  /** Complemento que distingue a versão ("Pokemon Center Exclusive"); null na versão comum. */
  stamp: string | null;
  /** Id da mesma carta na TCGdex (ficha em português, variações, preços), quando ela existe lá. */
  tcgdex_id: string | null;
  /** Coleção (grupo) da TCGplayer; `published_on` = data de lançamento (nula quando a fonte não tem). */
  tcg_groups: { name: string; abbr: string | null; published_on?: string | null } | null;
};

const COLUMNS = 'product_id, category, group_id, name, full_name, number, rarity, image, stamp, tcgdex_id, tcg_groups(name, abbr, published_on)';
/** 3 = Pokémon em inglês (as cartas em português são as mesmas, com o mesmo nome). */
export const ENGLISH = 3;
/** 85 = Pokémon em japonês (cartas japonesas de todas as épocas, inclusive as "Pocket Monsters" antigas). */
export const JAPANESE = 85;

/** Categoria do catálogo de uma carta: japonesa só na 85; português e inglês na 3 (nunca o produto de outro idioma). */
export function categoryOf(lang: CardLang): number {
  return lang === 'ja' ? JAPANESE : ENGLISH;
}

/** Foto 1000×1000 de um produto da TCGplayer (a mesma URL que o catalog-sync grava; catalogImage reduz). */
export function tcgplayerImageUrl(productId: number): string {
  return `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;
}

/**
 * Foto a mostrar de uma carta salva sem imagem da TCGdex: a gravada (`imageUrl`) ou, numa carta japonesa com o produto da
 * TCGplayer já ligado pelo preço (ex.: as da TCGdex japonesa, que não têm foto), a foto desse produto. Só o preço desta
 * carta (`tcgplayer.cardId` = `cardId`): logo depois de uma troca no bolso, o preço ainda pode ser o da carta anterior.
 */
export function entryImageUrl(e: {
  imageUrl?: string;
  lang: CardLang;
  cardId: string;
  tcgplayer?: { productId?: number; cardId: string } | null;
}): string | undefined {
  if (e.imageUrl != null) return e.imageUrl;
  const p = e.tcgplayer;
  return e.lang === 'ja' && p?.productId && p.cardId === e.cardId ? tcgplayerImageUrl(p.productId) : undefined;
}

/**
 * Nome para a busca: minúsculas, sem acento, ♀/♂ → f/m, ☆ → star, ◇ → prism star, δ → delta species, sem apóstrofo
 * (' ou ’) e só letras e números. "Farfetch’d" → "farfetchd", "Nidoran♀" → "nidoran f", "Poção" → "pocao".
 * É a mesma regra da coluna tcg_catalog.name_plain (função catalog_plain no banco): mude as duas juntas.
 */
export function plainName(s: string) {
  // Tira o acento antes das minúsculas, como o banco (lower() do Postgres pode não conhecer "É" conforme o locale).
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/♀/g, ' f ')
    .replace(/♂/g, ' m ')
    .replace(/[☆★]/g, ' star ')
    .replace(/◇/g, ' prism star ')
    .replace(/δ/g, ' delta species ')
    .replace(/['’‘`´ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Palavras sem acento, com "Pokémon Day" (TCGplayer) e "Pokeday" (TCGdex) escritos do mesmo jeito, e também "Prerelease"
 * (TCGplayer) e "pre-release" (TCGdex) — selos e coleções.
 */
export const plainWords = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/pokemon\s*day/g, 'pokeday')
    .replace(/pre[\s-]?release/g, 'prerelease')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Carta gigante (Jumbo/Oversize): tem a mesma arte com outra moldura, nunca é a mesma versão da carta. */
export const isOversize = (stamp: string | null | undefined) => {
  const w = plainWords(stamp ?? '');
  return w.includes('jumbo') || w.includes('oversize');
};

/**
 * A versão com selo da TCGdex (chaves "set-logo", "pokemon-center"… e o rótulo) é a mesma versão do catálogo, que tem a
 * foto oficial? Mesmo selo (palavra em comum com as chaves da TCGdex, que são em inglês como a TCGplayer), ou só o selo
 * da Booster Box (logo da coleção), que a TCGplayer chama de "<Coleção> Stamped" (ou "Stamp"). Jumbo nunca é, e o
 * produto de Staff só é a versão de Staff ("Prerelease" sozinho não é o "Staff Prerelease").
 */
export function sameStampVersion(keys: string[], label: string, setNameEn: string, catalogStamp: string) {
  const words = plainWords(catalogStamp);
  if (words.includes('jumbo') || words.includes('oversize')) return false;
  const rest = keys.filter((k) => k !== 'set-logo');
  if (keys.includes('set-logo') && !rest.length) return isBoxStamp(catalogStamp, setNameEn);
  const w = rest.length ? rest.flatMap(plainWords) : plainWords(label);
  if (words.includes('staff') !== w.includes('staff')) return false;
  return words.some((x) => x.length > 3 && w.includes(x));
}

/** Selo da Booster Box no catálogo: "<Coleção> Stamped" (ou "Stamp"), com uma palavra do nome da coleção. */
export function isBoxStamp(catalogStamp: string, setNameEn: string) {
  const words = plainWords(catalogStamp);
  const set = plainWords(setNameEn).filter((w) => w.length > 2);
  return (words.includes('stamped') || words.includes('stamp')) && words.some((w) => set.includes(w));
}

/** Promo de Prerelease no catálogo, fora a de Staff (outra versão, com produto próprio). */
export function isPrereleaseStamp(catalogStamp: string) {
  const words = plainWords(catalogStamp);
  return words.includes('prerelease') && !words.includes('staff');
}

/** Coluna que ainda não existe no banco (migração do name_plain não aplicada). */
const missingColumn = (e: { code?: string; message?: string }) => e.code === '42703' || /name_plain/.test(e.message ?? '');
/** Banco ainda sem a coluna name_plain: a busca volta a ser pelo nome, como antes. */
let plainColumn = true;

/**
 * Cartas cujo nome contém `name`, sem depender de acento, apóstrofo ou símbolo (coluna name_plain), em páginas de 1.000
 * (limite da API, em ordem fixa), até `max` cartas.
 */
export async function catalogByName(name: string, category = ENGLISH, opts: { max?: number; signal?: AbortSignal } = {}): Promise<CatalogRow[]> {
  const client = supabase;
  const plain = plainName(name);
  if (!client || !plain) return [];
  const escape = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);
  const max = opts.max ?? Infinity;
  const page = (from: number) => {
    let query = client
      .from('tcg_catalog')
      .select(COLUMNS)
      .eq('category', category)
      .ilike(plainColumn ? 'name_plain' : 'name', `%${escape(plainColumn ? plain : name.trim())}%`)
      .order('product_id')
      .range(from, Math.min(from + 999, max - 1));
    if (opts.signal) query = query.abortSignal(opts.signal);
    return query;
  };
  const out: CatalogRow[] = [];
  for (let from = 0; from < max; from += 1000) {
    let { data, error } = await page(from);
    if (error && plainColumn && missingColumn(error)) {
      plainColumn = false;
      ({ data, error } = await page(from));
    }
    if (error) throw error;
    out.push(...((data ?? []) as unknown as CatalogRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Cartas ligadas a estes ids da TCGdex (pega as de nome diferente, ex.: "Nidoran♀"), em blocos de 200 em paralelo, só da
 * categoria pedida: os ids da TCGdex japonesa repetem os ingleses ("neo1-…", "SM6-…").
 */
export async function catalogByTcgdexIds(ids: string[], category = ENGLISH, opts: { signal?: AbortSignal } = {}): Promise<CatalogRow[]> {
  const client = supabase;
  if (!client || !ids.length) return [];
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 200) chunks.push(unique.slice(i, i + 200));
  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      let query = client.from('tcg_catalog').select(COLUMNS).eq('category', category).in('tcgdex_id', chunk);
      if (opts.signal) query = query.abortSignal(opts.signal);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as CatalogRow[];
    }),
  );
  return pages.flat();
}

/** Ano de uma data do catálogo ("1996-10-20" → 1996); sem data ou com data inválida, undefined. */
export function catalogYear(publishedOn?: string | null): number | undefined {
  const year = Number(String(publishedOn ?? '').slice(0, 4));
  return year > 1990 ? year : undefined;
}

/**
 * Ano de lançamento das coleções do catálogo em inglês e em japonês (publishedOn do TCGCSV), pela chave que as listas
 * usam para a coleção que só existe no catálogo ("tcgp<grupo>"; o group_id é único nas duas categorias). Coleção sem
 * data fica de fora. Banco sem a coluna ainda: nenhum ano.
 */
export async function catalogGroupYears(): Promise<Record<string, number>> {
  if (!supabase) return {};
  const { data, error } = await supabase
    .from('tcg_groups')
    .select('group_id, published_on')
    .in('category', [ENGLISH, JAPANESE])
    .not('published_on', 'is', null);
  if (error) {
    if (error.code === '42703') return {};
    throw error;
  }
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { group_id: number; published_on: string | null }[]) {
    const year = catalogYear(r.published_on);
    if (year) out[`tcgp${r.group_id}`] = year;
  }
  return out;
}

/** Ids da TCGdex de algumas cartas já ligadas de uma coleção do catálogo (para saber de qual coleção da TCGdex ela é). */
export async function catalogGroupSet(groupId: number): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('tcg_catalog').select('tcgdex_id').eq('group_id', groupId).not('tcgdex_id', 'is', null).limit(60);
  if (error) throw error;
  return (data ?? []).map((r) => (r as { tcgdex_id: string }).tcgdex_id);
}

export async function catalogProduct(productId: number): Promise<CatalogRow | undefined> {
  if (!supabase) return undefined;
  const { data, error } = await supabase.from('tcg_catalog').select(COLUMNS).eq('product_id', productId).maybeSingle();
  if (error) throw error;
  return (data as unknown as CatalogRow) ?? undefined;
}

/** Vários produtos de uma vez (uma consulta por bloco de 200, em paralelo), de qualquer categoria. */
export async function catalogProducts(productIds: number[]): Promise<CatalogRow[]> {
  const client = supabase;
  const unique = [...new Set(productIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!client || !unique.length) return [];
  const chunks: number[][] = [];
  for (let i = 0; i < unique.length; i += 200) chunks.push(unique.slice(i, i + 200));
  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await client.from('tcg_catalog').select(COLUMNS).in('product_id', chunk);
      if (error) throw error;
      return (data ?? []) as unknown as CatalogRow[];
    }),
  );
  return pages.flat();
}

/** "133/132" → "133". */
export const catalogNumber = (n?: string | null) => (n ?? '').split('/')[0].trim();

/** Número para comparar: "007/165", "SWSH001", "TG06", "#25" → "7", "swsh1", "tg6", "25". */
export const normNumber = (n?: string | null) =>
  catalogNumber(n)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^([a-z]*)0+(?=\d)/, '$1');

/**
 * Variação do app para uma versão do catálogo ("Cosmos Holo" → holo, "Pokemon Center Exclusive" → promo/selo). Na
 * japonesa (85), "Mirror Holofoil"/"Reverse Holofoil" é o reverse (vendido como produto à parte), não a holo.
 */
export function stampVariant(stamp: string, category = ENGLISH): Variant {
  if (/staff|prerelease/i.test(stamp)) return 'staff';
  if (/master ?ball/i.test(stamp)) return 'masterball';
  if (/pok[eé] ?ball/i.test(stamp)) return 'pokeball';
  if (category === JAPANESE && /mirror|reverse/i.test(stamp)) return 'reverse';
  // "Non-Holo" (de deck, Target, DVD…) é a versão normal, sem brilho.
  if (/non[- ]?holo/i.test(stamp)) return 'normal';
  if (/reverse/i.test(stamp)) return 'reverse';
  if (/cosmos|holo/i.test(stamp)) return 'holo';
  if (/1st edition/i.test(stamp)) return 'firstEdition';
  return 'wPromo';
}

/**
 * Imagem no tamanho pedido: a lista e o fichário usam a pequena. Reduz as fotos da TCGplayer (1000×1000 → 200w), da
 * Scrydex (/large → /small) e da pokemontcg.io (_hires.png → .png), inclusive as já salvas nas cartas.
 */
export function catalogImage(url: string, quality: 'low' | 'high') {
  if (quality === 'high') return url;
  return url
    .replace('_in_1000x1000.jpg', '_200w.jpg')
    .replace(/^(https:\/\/images\.scrydex\.com\/.+)\/large$/, '$1/small')
    .replace(/^(https:\/\/images\.pokemontcg\.io\/.+)_hires\.png$/, '$1.png');
}

/** Última execução do catalog-sync e a idade do catálogo, dos preços da TCGplayer e da PTAX (tela "Sobre"). */
export type CatalogSyncStatus = {
  last?: { startedAt: string; finishedAt?: string; status: 'ok' | 'partial' | 'error'; error?: string | null };
  lastOkAt?: string;
  runs24h: number;
  failures24h: number;
  catalogAt?: string;
  pricesAt?: string;
  fxDay?: string;
};

/**
 * Situação do catálogo no servidor (só com a conta aberta; undefined sem conta, sem a migração ou sem internet).
 * Ex.: "Catálogo atualizado há 2 h · última execução ok às 14:32".
 */
export async function catalogSyncStatus(): Promise<CatalogSyncStatus | undefined> {
  if (!supabase) return undefined;
  try {
    const { data, error } = await supabase.rpc('catalog_sync_status');
    if (error || !data) return undefined;
    const s = data as Partial<CatalogSyncStatus> & { last?: CatalogSyncStatus['last'] | null };
    return {
      last: s.last ?? undefined,
      lastOkAt: s.lastOkAt ?? undefined,
      runs24h: Number(s.runs24h ?? 0),
      failures24h: Number(s.failures24h ?? 0),
      catalogAt: s.catalogAt ?? undefined,
      pricesAt: s.pricesAt ?? undefined,
      fxDay: s.fxDay ?? undefined,
    };
  } catch {
    return undefined;
  }
}
