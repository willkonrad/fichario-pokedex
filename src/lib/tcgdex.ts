import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSpecies } from '@/data/pokedex';
import type { CardLang } from './types';

const API = 'https://api.tcgdex.net/v2';
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 dias

export type CardBrief = {
  id: string;
  localId: string;
  name: string;
  image?: string;
  lang: CardLang;
  setId: string;
  setName: string;
  setOrder: number;
  /** Nome da coleção em inglês (para cruzar com outras bases, ex.: imagem reserva). */
  setNameEn: string;
  /** Idioma de onde vêm os dados/imagem, quando a coleção não existe no catálogo do idioma escolhido. */
  dataLang?: CardLang;
};

export type CardDetail = {
  id: string;
  localId: string;
  name: string;
  image?: string;
  rarity?: string;
  illustrator?: string;
  /** Números da Pokédex dos Pokémon da carta (vazio para treinadores e energias). */
  dexId?: number[];
  category?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  evolveFrom?: string;
  description?: string;
  abilities?: { type?: string; name: string; effect?: string }[];
  attacks?: { cost?: string[]; name: string; effect?: string; damage?: number | string }[];
  weaknesses?: { type: string; value?: string }[];
  resistances?: { type: string; value?: string }[];
  retreat?: number;
  regulationMark?: string;
  /**
   * Impressões que existem da carta (no catálogo em inglês os valores são estáveis):
   * type normal|holo|reverse, foil (pokeball, masterball, cosmos…), stamp (1st-edition, set-logo…), subtype (shadowless…).
   */
  variants_detailed?: { type: string; subtype?: string; size?: string; foil?: string; stamp?: string[] }[];
  set: { id: string; name: string; cardCount?: { official?: number; total?: number } };
  variants?: Partial<Record<'normal' | 'reverse' | 'holo' | 'firstEdition' | 'wPromo', boolean>>;
};

type SetBrief = { id: string; name: string };

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await AsyncStorage.getItem(key);
    if (hit) {
      const { at, data } = JSON.parse(hit) as { at: number; data: T };
      if (Date.now() - at < CACHE_TTL) return data;
    }
  } catch {}
  const data = await load();
  const value = JSON.stringify({ at: Date.now(), data });
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Armazenamento cheio (no Android o limite é ~6 MB): apaga o cache e tenta de novo.
    // Nunca toca nas cartas e configurações do usuário, só no que pode ser baixado de novo.
    await clearCatalogCache();
    await AsyncStorage.setItem(key, value).catch(() => {});
  }
  return data;
}

/** Prefixos das chaves de cache (dados que podem ser baixados de novo). */
const CACHE_PREFIXES = ['tcgdex:', 'ptcg:', 'scrydex:'];

/** Chaves de versões antigas do cache, que nunca mais são lidas. */
const STALE_CACHE = [/^tcgdex:dex:v[1-3]:/, /^scrydex:(?!v4:)/, /^tcgdex:abbr:/];

/** Apaga as chaves de cache de versões antigas (chamada ao abrir o app). */
export async function pruneStaleCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => STALE_CACHE.some((re) => re.test(k)));
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch {}
}

/** Apaga todo o cache de catálogo e imagens reserva. */
export async function clearCatalogCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => CACHE_PREFIXES.some((p) => k.startsWith(p)));
    if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
    return cacheKeys.length;
  } catch {
    return 0;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TCGdex ${res.status}`);
  return res.json() as Promise<T>;
}

/** Sufixo de qualidade exigido pelas imagens da TCGdex. */
export function cardImage(base: string | undefined, quality: 'low' | 'high' = 'low') {
  return base ? `${base}/${quality}.webp` : undefined;
}

function setsFor(lang: CardLang) {
  return cached(`tcgdex:sets:${lang}`, () => getJson<SetBrief[]>(`${API}/${lang}/sets`));
}

type RawCard = { id: string; localId: string; name: string; image?: string };

/** O nome da carta é deste Pokémon? ("Mega Charizard X ex" sim; "Mewtwo" não é "Mew"). */
function nameMatches(cardName: string, species: string, lang: CardLang) {
  const esc = species.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Japonês não tem espaços: evita que ミュウ (Mew) case com ミュウツー (Mewtwo).
  const re = lang === 'ja' ? new RegExp(`${esc}(?![ァ-ヴー])`) : new RegExp(`(^|[^\\p{L}])${esc}(?![\\p{L}])`, 'iu');
  return re.test(cardName);
}

/**
 * Cartas de um Pokémon num idioma: pelo número da Pokédex E pelo nome, porque várias cartas
 * (ex.: coleções recentes como a de 30 anos, e muitas japonesas) vêm da TCGdex sem o número.
 */
async function rawCardsFor(dex: number, lang: CardLang): Promise<RawCard[]> {
  const species = getSpecies(dex);
  const name = species ? (lang === 'ja' ? species.ja : species.name) : undefined;
  const [byDex, byName] = await Promise.all([
    getJson<RawCard[]>(`${API}/${lang}/cards?dexId=eq:${dex}`),
    name ? getJson<RawCard[]>(`${API}/${lang}/cards?name=${encodeURIComponent(name)}`).catch(() => []) : Promise.resolve([]),
  ]);
  const all = new Map(byDex.map((c) => [c.id, c]));
  for (const c of byName) if (!all.has(c.id) && name && nameMatches(c.name, name, lang)) all.set(c.id, c);
  return [...all.values()];
}

const setIdOf = (c: RawCard) => c.id.slice(0, c.id.length - c.localId.length - 1); // id = "<setId>-<localId>"

/** Coleções do TCG Pocket (jogo digital): não existem em papel, então ficam fora do fichário. */
function digitalSets() {
  return cached('tcgdex:digital-sets', async () => {
    const series = await Promise.all(
      (['en', 'pt', 'ja'] as CardLang[]).map((l) => getJson<{ sets?: SetBrief[] }>(`${API}/${l}/series/tcgp`).catch(() => ({ sets: [] }))),
    );
    return [...new Set(series.flatMap((s) => (s.sets ?? []).map((x) => x.id)))];
  });
}

/** Todas as cartas de um Pokémon (número da Pokédex nacional) num idioma, da coleção mais nova para a mais antiga. */
export async function cardsForDex(dex: number, lang: CardLang): Promise<CardBrief[]> {
  return cached(`tcgdex:dex:v4:${lang}:${dex}`, async () => {
    const [raw, sets, enSets, digital] = await Promise.all([rawCardsFor(dex, lang), setsFor(lang), setsFor('en'), digitalSets()]);
    const isPhysical = (c: RawCard) => !digital.includes(setIdOf(c));
    const cards = raw.filter(isPhysical);
    // A ordem cronológica vem da lista em inglês, que é a mais completa.
    const order = new Map(enSets.map((s, i) => [s.id, i]));
    const names = new Map([...enSets, ...sets].map((s) => [s.id, s.name]));
    const enNames = new Map(enSets.map((s) => [s.id, s.name]));
    const toBrief = (c: RawCard, dataLang?: CardLang): CardBrief => {
      const setId = setIdOf(c);
      return {
        ...c,
        lang,
        dataLang,
        setId,
        setName: names.get(setId) ?? setId,
        setNameEn: enNames.get(setId) ?? names.get(setId) ?? setId,
        setOrder: order.get(setId) ?? -1,
      };
    };
    const list = cards.map((c) => toBrief(c));

    // O catálogo em português é incompleto: faltam coleções inteiras (antigas e promos) e também cartas
    // de coleções que existem em PT (ex.: 71 Pikachus, como os da coleção de 30 anos). Completa com
    // toda carta do catálogo em inglês que não veio em PT — PT e EN usam o mesmo id na TCGdex.
    if (lang === 'pt') {
      const ptIds = new Set(cards.map((c) => c.id));
      const en = await rawCardsFor(dex, 'en').catch(() => []);
      for (const c of en) if (isPhysical(c) && !ptIds.has(c.id)) list.push(toBrief(c, 'en'));
    }

    return list.sort((a, b) => b.setOrder - a.setOrder || a.localId.localeCompare(b.localId, undefined, { numeric: true }));
  });
}

/**
 * Busca cartas por nome em qualquer Pokémon, treinador ou energia (fichários livres).
 * Mesmas regras do fichário Pokédex: sem TCG Pocket e, em PT, completa com o catálogo em inglês.
 */
export async function searchCards(query: string, lang: CardLang): Promise<CardBrief[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return cached(`tcgdex:search:v1:${lang}:${q.toLowerCase()}`, async () => {
    const byName = (l: CardLang) => getJson<RawCard[]>(`${API}/${l}/cards?name=like:${encodeURIComponent(q)}`);
    const [raw, sets, enSets, digital] = await Promise.all([byName(lang), setsFor(lang), setsFor('en'), digitalSets()]);
    const order = new Map(enSets.map((s, i) => [s.id, i]));
    const names = new Map([...enSets, ...sets].map((s) => [s.id, s.name]));
    const enNames = new Map(enSets.map((s) => [s.id, s.name]));
    const isPhysical = (c: RawCard) => !digital.includes(setIdOf(c));
    const toBrief = (c: RawCard, dataLang?: CardLang): CardBrief => {
      const setId = setIdOf(c);
      return {
        ...c,
        lang,
        dataLang,
        setId,
        setName: names.get(setId) ?? setId,
        setNameEn: enNames.get(setId) ?? names.get(setId) ?? setId,
        setOrder: order.get(setId) ?? -1,
      };
    };
    const list = raw.filter(isPhysical).map((c) => toBrief(c));
    if (lang === 'pt') {
      const ids = new Set(list.map((c) => c.id));
      const en = await byName('en').catch(() => []);
      for (const c of en) if (isPhysical(c) && !ids.has(c.id)) list.push(toBrief(c, 'en'));
    }
    return list
      .sort((a, b) => b.setOrder - a.setOrder || a.localId.localeCompare(b.localId, undefined, { numeric: true }))
      .slice(0, 300);
  });
}

export function cardDetail(id: string, lang: CardLang) {
  return cached(`tcgdex:card:${lang}:${id}`, () =>
    getJson<CardDetail>(`${API}/${lang}/cards/${encodeURIComponent(id)}`),
  );
}
