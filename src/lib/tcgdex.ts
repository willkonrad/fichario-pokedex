import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSpecies } from '@/data/pokedex';
import { catalogByName, catalogByTcgdexIds, catalogNumber, catalogProduct, stampVariant, type CatalogRow } from './catalog';
import type { CardLang, Variant } from './types';
import { versionOptions } from './variants';

const API = 'https://api.tcgdex.net/v2';
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 dias
/** Listas de cartas e coleções: 1 dia, para promos e coleções novas aparecerem logo. */
const LIST_TTL = 1000 * 60 * 60 * 24;

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
  /**
   * Versão com selo da carta (ex.: Bulbasaur Megaevolução 133 com o selo da coleção, da Booster Box), mostrada
   * como uma carta à parte na lista, como a Liga faz ("133b"). Escolher já marca a variação e o selo.
   */
  stamp?: { variant: Variant; label: string; keys: string[] };
  /** Foto completa da carta (TCGplayer, via catálogo do TCGCSV), quando não há imagem da TCGdex. */
  imageUrl?: string;
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
  /** Foto completa da carta, para cartas que só existem no catálogo do TCGCSV. */
  imageUrl?: string;
};

type SetBrief = { id: string; name: string; logo?: string };

export async function cached<T>(key: string, load: () => Promise<T>, ttl = CACHE_TTL): Promise<T> {
  try {
    const hit = await AsyncStorage.getItem(key);
    if (hit) {
      const { at, data } = JSON.parse(hit) as { at: number; data: T };
      if (Date.now() - at < ttl) return data;
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
const CACHE_PREFIXES = ['tcgdex:', 'ptcg:', 'scrydex:', 'zukan:'];

/** Chaves de versões antigas do cache, que nunca mais são lidas. */
const STALE_CACHE = [/^tcgdex:dex:v[1-9]:/, /^tcgdex:search:v[12]:/, /^scrydex:(?!v5:)/, /^tcgdex:abbr:/];

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
  return cached(`tcgdex:sets:${lang}`, () => getJson<SetBrief[]>(`${API}/${lang}/sets`), LIST_TTL);
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

/**
 * O catálogo em português não tem a imagem de muitas cartas (ex.: quase todas as promos SWSH e SM), mas o inglês
 * tem, com o mesmo id: usa a imagem em inglês (a arte é a mesma).
 */
function withEnglishImages(list: { id: string; image?: string }[], en: RawCard[]) {
  const enImage = new Map(en.filter((c) => c.image).map((c) => [c.id, c.image]));
  for (const c of list) if (!c.image) c.image = enImage.get(c.id);
}

/** Coleções recentes (Escarlate e Violeta, Megaevolução, 30 anos), onde as promos com selo da coleção existem. */
const STAMP_ERA = /^(sv|me|30th)/i;

/**
 * Versões com selo das cartas da lista (uma carta à parte para cada selo), pela ficha em inglês da TCGdex
 * (que lista as impressões). Só nas coleções recentes, para não abrir a ficha de centenas de cartas antigas.
 */
async function stampedVersions(list: CardBrief[]): Promise<CardBrief[]> {
  const todo = list.filter((c) => STAMP_ERA.test(c.setId));
  const out: CardBrief[] = [];
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8);
    const details = await Promise.all(batch.map((c) => cardDetail(c.id, 'en').catch(() => null)));
    batch.forEach((c, k) => {
      for (const o of versionOptions(details[k], details[k])) {
        if (o.stamp) out.push({ ...c, stamp: { variant: o.variant, label: o.stamp, keys: o.stampKeys ?? [] } });
      }
    });
  }
  return out;
}

const plainWords = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Junta o catálogo do TCGCSV (base principal) com a lista da TCGdex (secundária):
 *   - carta do catálogo ligada à TCGdex: usa os dados da TCGdex (nome e imagem em português, variações, preços);
 *   - carta só do catálogo (ex.: coleção lançada ontem): id "tcgp-<produto>", com a foto da TCGplayer;
 *   - versão com selo do catálogo: carta à parte, com a foto própria;
 *   - da TCGdex entram também as cartas e versões com selo que o catálogo não tem (ex.: selo da Booster Box).
 */
function withCatalog(list: CardBrief[], rows: CatalogRow[], lang: CardLang): CardBrief[] {
  if (!rows.length) return list;
  const byId = new Map(list.filter((c) => !c.stamp).map((c) => [c.id, c]));
  // Ordem das coleções que só existem no catálogo: logo depois da coleção ligada de id anterior (a TCGplayer
  // numera as coleções em ordem de lançamento).
  const groupOrder = new Map<number, number>();
  for (const r of rows) {
    const b = r.tcgdex_id ? byId.get(r.tcgdex_id) : undefined;
    if (b) groupOrder.set(r.group_id, Math.max(groupOrder.get(r.group_id) ?? -1, b.setOrder));
  }
  const known = [...groupOrder.entries()].sort((a, b) => a[0] - b[0]);
  const orderOf = (g: number) => groupOrder.get(g) ?? known.reduce((o, [id, ord]) => (id <= g ? ord : o), -1) + 0.5;

  const seen = new Set<string>();
  const out: CardBrief[] = [];
  const catalogStamps = new Map<string, string[][]>();
  const unique = new Map(rows.map((r) => [r.product_id, r]));
  for (const r of unique.values()) {
    const base = r.tcgdex_id ? byId.get(r.tcgdex_id) : undefined;
    const group = r.tcg_groups?.name ?? '';
    const common: CardBrief = base ?? {
      id: r.tcgdex_id ?? `tcgp-${r.product_id}`,
      localId: catalogNumber(r.number),
      name: r.name,
      lang,
      dataLang: 'en',
      setId: `tcgp${r.group_id}`,
      setName: group,
      setNameEn: group,
      setOrder: orderOf(r.group_id),
    };
    if (r.stamp) {
      out.push({ ...common, image: undefined, imageUrl: r.image, stamp: { variant: stampVariant(r.stamp), label: r.stamp, keys: [] } });
      catalogStamps.set(common.id, [...(catalogStamps.get(common.id) ?? []), plainWords(r.stamp)]);
    } else if (!seen.has(common.id)) {
      seen.add(common.id);
      out.push({ ...common, imageUrl: common.image ? undefined : r.image });
    }
  }
  for (const c of list) {
    if (!c.stamp) {
      if (!seen.has(c.id)) out.push(c);
      continue;
    }
    // Versão com selo da TCGdex que o catálogo já tem (com foto): fica só a do catálogo.
    const w = plainWords(c.stamp.label);
    if (!(catalogStamps.get(c.id) ?? []).some((s) => s.some((x) => x.length > 3 && w.includes(x)))) out.push(c);
  }
  return out;
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
  return cached(`tcgdex:dex:v10:${lang}:${dex}`, async () => {
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
      withEnglishImages(list, en);
      for (const c of en) if (isPhysical(c) && !ptIds.has(c.id)) list.push(toBrief(c, 'en'));
    }

    // Cartas que a TCGdex ainda não tem (ex.: promos novas como a Nidorina MEP 101): completa com o catálogo do Zukan.
    if (lang !== 'ja') {
      const have = new Set(list.map((c) => c.id));
      for (const z of await zukanCardsFor(dex, lang)) {
        const setId = z.id.slice(0, z.id.length - z.localId.length - 1);
        if (have.has(z.id) || !z.id.endsWith(`-${z.localId}`) || digital.includes(setId)) continue;
        list.push({
          id: z.id,
          localId: z.localId,
          name: z.name,
          lang,
          setId,
          setName: names.get(setId) ?? z.setNamePt ?? setId,
          setNameEn: enNames.get(setId) ?? setId,
          setOrder: order.get(setId) ?? -1,
        });
      }
    }

    if (lang !== 'ja') list.push(...(await stampedVersions(list)));

    // Base principal: o catálogo do TCGCSV (cartas pelo nome do Pokémon e as ligadas às cartas da TCGdex acima).
    let all = list;
    const species = getSpecies(dex)?.name;
    if (lang !== 'ja' && species) {
      const rows = await Promise.all([catalogByName(species), catalogByTcgdexIds(list.map((c) => c.id))])
        .then(([byName, byId]) => [...byName.filter((r) => nameMatches(r.name, species, 'en')), ...byId])
        .catch(() => []);
      all = withCatalog(list, rows, lang);
    }
    return all.sort(
      (a, b) => b.setOrder - a.setOrder || a.localId.localeCompare(b.localId, undefined, { numeric: true }) || Number(!!a.stamp) - Number(!!b.stamp),
    );
  }, LIST_TTL);
}

/**
 * Busca cartas por nome em qualquer Pokémon, treinador ou energia (fichários livres).
 * Mesmas regras do fichário Pokédex: sem TCG Pocket e, em PT, completa com o catálogo em inglês.
 */
export async function searchCards(query: string, lang: CardLang): Promise<CardBrief[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return cached(`tcgdex:search:v3:${lang}:${q.toLowerCase()}`, async () => {
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
      withEnglishImages(list, en);
      for (const c of en) if (isPhysical(c) && !ids.has(c.id)) list.push(toBrief(c, 'en'));
    }
    const rows = lang === 'ja' ? [] : await catalogByName(q).catch(() => []);
    return withCatalog(list, rows, lang)
      .sort((a, b) => b.setOrder - a.setOrder || a.localId.localeCompare(b.localId, undefined, { numeric: true }))
      .slice(0, 300);
  }, LIST_TTL);
}

export function cardDetail(id: string, lang: CardLang) {
  return cached(`tcgdex:card:${lang}:${id}`, async () => {
    // Carta que só existe no catálogo do TCGCSV ("tcgp-<produto>"): ficha básica com a foto da TCGplayer.
    if (id.startsWith('tcgp-')) {
      const r = await catalogProduct(Number(id.slice(5)));
      if (!r) throw new Error('TCGCSV 404');
      return {
        id,
        localId: catalogNumber(r.number),
        name: r.name,
        rarity: r.rarity ?? undefined,
        set: { id: `tcgp${r.group_id}`, name: r.tcg_groups?.name ?? '' },
        imageUrl: r.image,
      } satisfies CardDetail;
    }
    try {
      return await getJson<CardDetail>(`${API}/${lang}/cards/${encodeURIComponent(id)}`);
    } catch (e) {
      // Carta que a TCGdex ainda não tem: a ficha básica do Zukan (a imagem vem da reserva pelo id).
      if (lang === 'ja' || !/404/.test(String(e))) throw e;
      const z = await zukanCard(id, lang).catch(() => undefined);
      if (!z) throw e;
      return z;
    }
  });
}

// ---------- Zukan (zukan.com.br/mcp): catálogo público, com as cartas mais novas que a TCGdex ainda não tem ----------

const ZUKAN_MCP = 'https://www.zukan.com.br/mcp';
type ZukanBrief = { id: string; localId: string; name: string; setNamePt?: string };

async function zukan<T>(tool: string, args: Record<string, unknown>): Promise<T | undefined> {
  const res = await fetch(ZUKAN_MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  if (!res.ok) throw new Error(`Zukan ${res.status}`);
  const body = await res.json();
  if (body?.result?.isError) return undefined;
  return body?.result?.structuredContent ?? JSON.parse(body?.result?.content?.[0]?.text ?? 'null') ?? undefined;
}

/** Cartas de um Pokémon no Zukan (lista vazia se o Zukan estiver fora do ar: a TCGdex continua valendo). */
async function zukanCardsFor(dex: number, lang: CardLang): Promise<ZukanBrief[]> {
  const r = await zukan<{ cards?: ZukanBrief[] }>('get_pokemon', { query: String(dex), lang: lang === 'en' ? 'en' : 'pt' }).catch(() => undefined);
  return r?.cards ?? [];
}

/**
 * Imagem da carta no Zukan: última reserva, para cartas sem arte na TCGdex, na pokemontcg.io e na Scrydex
 * (ex.: coleção me06, que só o Zukan tem). O Zukan só tem a imagem grande dessas cartas.
 */
export function zukanImage(cardId: string) {
  return cached(`zukan:image:v1:${cardId}`, async () => {
    const z = await zukan<{ image?: string }>('get_card', { id: cardId, lang: 'pt' });
    return z?.image ? { small: z.image, large: z.image } : null;
  });
}

/** Ficha básica de uma carta pelo Zukan, no formato da TCGdex. */
async function zukanCard(id: string, lang: CardLang): Promise<CardDetail | undefined> {
  const z = await zukan<{ id: string; localId: string; name: string; setNamePt?: string; rarity?: string; illustrator?: string; hp?: string; types?: string; stage?: string }>(
    'get_card',
    { id, lang: lang === 'en' ? 'en' : 'pt' },
  );
  if (!z?.id) return undefined;
  const setId = z.id.slice(0, z.id.length - z.localId.length - 1);
  return {
    id: z.id,
    localId: z.localId,
    name: z.name,
    rarity: z.rarity,
    illustrator: z.illustrator,
    category: z.hp ? 'Pokemon' : undefined,
    hp: z.hp ? Number(z.hp) : undefined,
    types: z.types ? [z.types] : undefined,
    stage: z.stage,
    set: { id: setId, name: z.setNamePt ?? setId },
  };
}
