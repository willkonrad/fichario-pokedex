import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSpecies, POKEDEX, speciesInCardName } from '@/data/pokedex';
import {
  catalogByName,
  catalogByTcgdexIds,
  catalogGroupSet,
  catalogGroupYears,
  catalogNumber,
  catalogProduct,
  ENGLISH,
  normNumber,
  plainName,
  sameStampVersion,
  stampVariant,
  type CatalogRow,
} from './catalog';
import type { CardLang, Variant } from './types';
import { versionOptions } from './variants';

const API = 'https://api.tcgdex.net/v2';
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 dias
/** Listas de cartas e coleções: 1 dia, para promos e coleções novas aparecerem logo. */
const LIST_TTL = 1000 * 60 * 60 * 24;
/** Lista montada com alguma fonte fora do ar: guardada só por 5 minutos (depois tenta completar). */
const PARTIAL_TTL = 1000 * 60 * 5;

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

/**
 * Lista de cartas com a situação das fontes: `partial` = alguma fonte (catálogo, selos, inglês, Zukan) não respondeu e
 * a lista pode estar incompleta (a tela avisa "Algumas fontes não responderam" e oferece buscar de novo).
 */
export type CardListResult = {
  cards: CardBrief[];
  partial: boolean;
  /** Busca ampla cortada nas CARD_SEARCH_MAX cartas mais novas. */
  truncated?: boolean;
  /** Número reconhecido no fim da busca ("Charizard 4/102" → "4") e se alguma carta tem esse número. */
  number?: string;
  numberMatched?: boolean;
};

export type CardListOptions = {
  /** Ignora a lista guardada e busca de novo (botão "Buscar de novo"). */
  force?: boolean;
  /**
   * Cancela a busca por nome (ex.: a pessoa continuou digitando). A lista de um Pokémon não é cancelada: ela termina e
   * fica guardada para a próxima abertura.
   */
  signal?: AbortSignal;
  /** Lista base pronta, antes das versões com selo (para a tela mostrar algo enquanto o resto chega). */
  onProgress?: (cards: CardBrief[]) => void;
};

type SetBrief = { id: string; name: string; logo?: string };

// ---------- Cache (AsyncStorage + memória) ----------

/** Cópia guardada: quando foi baixada e por quanto tempo vale. */
type Stored<T> = { at: number; data: T; ttl?: number };
/** Últimas leituras em memória (evita reler e decodificar o AsyncStorage a cada miniatura). */
const memory = new Map<string, Stored<unknown>>();
const MEMORY_MAX = 300;
/** Buscas em andamento, para várias telas/miniaturas pedindo a mesma coisa esperarem uma só requisição. */
const inflight = new Map<string, Promise<unknown>>();

const isFresh = (e: Stored<unknown>, ttl: number) => Date.now() - e.at < Math.min(e.ttl ?? ttl, ttl);

function remember(key: string, e: Stored<unknown>) {
  memory.delete(key);
  memory.set(key, e);
  if (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next();
    if (!oldest.done) memory.delete(oldest.value);
  }
}

export type CacheOptions<T> = {
  /** Validade conforme o resultado (0 = não guarda), ex.: lista incompleta guardada só por alguns minutos. */
  ttlFor?: (data: T) => number;
  /** Busca de novo mesmo com a cópia em dia (o resultado novo substitui a cópia; sem rede, vale a cópia). */
  force?: boolean;
  /**
   * A busca de `load` pode ser cancelada por este sinal: ela não é dividida com outras chamadas iguais (o cancelamento
   * de uma tela não pode derrubar a busca de outra). Ela ainda aproveita uma busca igual já em andamento sem sinal.
   */
  signal?: AbortSignal;
};

/**
 * Dado baixado e guardado por `ttl`. Chamadas iguais ao mesmo tempo esperam uma só busca; sem rede (ou com a fonte fora
 * do ar), vale a cópia vencida, se houver.
 */
export function cached<T>(key: string, load: () => Promise<T>, ttl = CACHE_TTL, opts: CacheOptions<T> = {}): Promise<T> {
  if (!opts.force) {
    const hit = memory.get(key);
    if (hit && isFresh(hit, ttl)) {
      remember(key, hit);
      return Promise.resolve(hit.data as T);
    }
    const running = inflight.get(key);
    if (running) return running as Promise<T>;
  }
  if (opts.signal) return readThrough(key, load, ttl, opts);
  const p: Promise<T> = readThrough(key, load, ttl, opts).finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

async function readStored<T>(key: string): Promise<Stored<T> | undefined> {
  const m = memory.get(key);
  if (m) return m as Stored<T>;
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Stored<T>) : undefined;
  } catch {
    return undefined;
  }
}

async function readThrough<T>(key: string, load: () => Promise<T>, ttl: number, opts: CacheOptions<T>): Promise<T> {
  // Com `force`, a cópia guardada não é usada se estiver em dia, mas continua sendo a reserva se a busca falhar.
  const saved = await readStored<T>(key);
  if (!opts.force && saved && isFresh(saved, ttl)) {
    remember(key, saved);
    return saved.data;
  }
  if (opts.signal?.aborted) throw abortError();
  let data: T;
  try {
    data = await load();
  } catch (e) {
    // Sem rede ou fonte fora do ar: a cópia vencida é melhor que nada (é buscada de novo na próxima vez).
    if (saved && !isAbort(e) && !opts.signal?.aborted) return saved.data;
    throw e;
  }
  const keep = opts.ttlFor ? opts.ttlFor(data) : ttl;
  if (keep > 0) await store(key, { at: Date.now(), data, ttl: keep });
  return data;
}

async function store(key: string, entry: Stored<unknown>) {
  remember(key, entry);
  const value = JSON.stringify(entry);
  try {
    await AsyncStorage.setItem(key, value);
    return;
  } catch {}
  // Armazenamento cheio (no Android o limite é ~6 MB): libera primeiro as listas e as fichas, depois o resto do cache.
  // Nunca toca nas cartas e configurações do usuário, só no que pode ser baixado de novo.
  await freeCatalogCache();
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    await clearCatalogCache();
    await AsyncStorage.setItem(key, value).catch(() => {});
  }
  remember(key, entry);
}

/** Prefixos das chaves de cache (dados que podem ser baixados de novo). */
const CACHE_PREFIXES = ['tcgdex:', 'ptcg:', 'scrydex:', 'zukan:'];

/** Chaves de versões antigas do cache, que nunca mais são lidas. */
const STALE_CACHE = [
  /^tcgdex:dex:v(?:[1-9]|1[0-2]):/,
  /^tcgdex:search:v[1-6]:/,
  /^scrydex:(?!v5:)/,
  /^tcgdex:abbr:/,
  /^tcgdex:stampimg:v1:/,
  /^tcgdex:en-name:/,
  /^tcgdex:digital-sets$/,
];

/** Partes maiores do cache (listas e fichas), as primeiras a sair quando o armazenamento enche. */
const BULKY_CACHE = [/^tcgdex:dex:/, /^tcgdex:search:/, /^tcgdex:card:/, /^tcgdex:recent:/];

/** Cópia vencida há mais que isto é apagada (até lá serve de reserva sem internet). */
const EXPIRED_GRACE = 1000 * 60 * 60 * 24 * 7;
const PRUNED_AT_KEY = 'tcgdex:pruned-at';

/**
 * Limpeza do cache (chamada ao abrir o app): apaga as chaves de versões antigas e, 1×/dia, as cópias vencidas há mais
 * de uma semana.
 */
export async function pruneStaleCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => STALE_CACHE.some((re) => re.test(k)));
    if (stale.length) await AsyncStorage.multiRemove(stale);
    const last = Number(await AsyncStorage.getItem(PRUNED_AT_KEY)) || 0;
    if (Date.now() - last < 1000 * 60 * 60 * 24) return;
    await AsyncStorage.setItem(PRUNED_AT_KEY, String(Date.now()));
    const removed = new Set(stale);
    const cacheKeys = keys.filter((k) => !removed.has(k) && CACHE_PREFIXES.some((p) => k.startsWith(p)));
    const expired: string[] = [];
    for (let i = 0; i < cacheKeys.length; i += 40) {
      for (const [k, v] of await AsyncStorage.multiGet(cacheKeys.slice(i, i + 40))) {
        try {
          const e = v ? (JSON.parse(v) as Partial<Stored<unknown>>) : null;
          // Marcadores e índices (sem "at") ficam.
          if (e && typeof e.at === 'number' && Date.now() - e.at > (e.ttl ?? CACHE_TTL) + EXPIRED_GRACE) expired.push(k);
        } catch {
          expired.push(k);
        }
      }
    }
    if (expired.length) await AsyncStorage.multiRemove(expired);
  } catch {}
}

/** Apaga as listas e as fichas guardadas (a parte maior do cache), quando o armazenamento enche. */
export async function freeCatalogCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const bulky = keys.filter((k) => BULKY_CACHE.some((re) => re.test(k)));
    for (const k of bulky) memory.delete(k);
    if (bulky.length) await AsyncStorage.multiRemove(bulky);
    return bulky.length;
  } catch {
    return 0;
  }
}

/** Apaga todo o cache de catálogo e imagens reserva. */
export async function clearCatalogCache() {
  memory.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => CACHE_PREFIXES.some((p) => k.startsWith(p)));
    if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
    return cacheKeys.length;
  } catch {
    return 0;
  }
}

/** Listas guardadas mais recentes (Pokémon e buscas): as mais antigas saem, para o cache não crescer sem limite. */
const RECENT = {
  dex: { key: 'tcgdex:recent:dex', max: 40 },
  search: { key: 'tcgdex:recent:search', max: 10 },
};
let recentChain: Promise<void> = Promise.resolve();

function trackRecent(kind: keyof typeof RECENT, key: string) {
  const { key: indexKey, max } = RECENT[kind];
  recentChain = recentChain.then(async () => {
    try {
      const raw = await AsyncStorage.getItem(indexKey);
      const list = [key, ...((raw ? (JSON.parse(raw) as string[]) : []).filter((k) => k !== key))];
      const drop = list.slice(max);
      await AsyncStorage.setItem(indexKey, JSON.stringify(list.slice(0, max)));
      if (drop.length) {
        for (const k of drop) memory.delete(k);
        await AsyncStorage.multiRemove(drop);
      }
    } catch {}
  });
}

// ---------- Rede ----------

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`TCGdex ${res.status}`);
  return res.json() as Promise<T>;
}

const notFound = (e: unknown) => /\b404\b/.test(String(e instanceof Error ? e.message : e));
const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';
/** Busca cancelada (a pessoa continuou digitando): não é falha de fonte e o resultado não é guardado. */
const abortError = () => Object.assign(new Error('Busca cancelada'), { name: 'AbortError' });

/**
 * Fontes secundárias: a falha vira o valor reserva e marca a lista como incompleta. Cancelamento continua erro, inclusive
 * quando a fonte o devolve como erro comum (o Supabase devolve `{ error }`, sem o nome AbortError).
 */
type Soft = <T>(p: Promise<T>, fallback: T) => Promise<T>;
function softly(track: { partial: boolean }, signal?: AbortSignal): Soft {
  return (p, fallback) =>
    p.catch((e) => {
      if (signal?.aborted) throw abortError();
      if (isAbort(e)) throw e;
      track.partial = true;
      return fallback;
    });
}

/** Executa `fn` em no máximo `size` itens ao mesmo tempo, mantendo a ordem dos resultados. */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

/**
 * Fotos em português da TCGdex tiradas de uma cópia com selo (ex.: o selo da Liga Pokémon no Machop 44/111 de Punhos
 * Furiosos): a carta comum parecia ser a versão promocional. Nelas vale a foto em inglês, que é da carta comum. Caminho
 * da imagem sem o idioma ("<série>/<coleção>/<número>").
 */
const STAMPED_PT_SCANS = new Set(['xy/xy3/44']);

/**
 * Ano de lançamento de cada coleção, para mostrar ao lado do nome ("Realeza Absoluta Galeria de Galar · 2023"): as da
 * TCGdex numa consulta só (GraphQL, todas as coleções com a data) e as que só existem no catálogo ("tcgp<grupo>", pela
 * data do TCGCSV). Guardado por 7 dias; se a TCGdex não responder, nada é guardado (tenta de novo depois).
 */
export function setReleaseYears(): Promise<Record<string, number>> {
  return cached(
    'tcgdex:set-years:v1',
    async () => {
      const res = await fetch(`${API}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ sets { id releaseDate } }' }),
      });
      if (!res.ok) throw new Error(`TCGdex ${res.status}`);
      const body = (await res.json()) as { data?: { sets?: { id: string; releaseDate?: string | null }[] } };
      const out: Record<string, number> = await catalogGroupYears().catch(() => ({}));
      for (const s of body.data?.sets ?? []) {
        const year = Number(String(s.releaseDate ?? '').slice(0, 4));
        if (year > 1990) out[s.id] = year;
      }
      return out;
    },
    CACHE_TTL,
  );
}

/** Sufixo de qualidade exigido pelas imagens da TCGdex (e a foto em inglês no lugar das fotos em português com selo). */
export function cardImage(base: string | undefined, quality: 'low' | 'high' = 'low') {
  if (!base) return undefined;
  const pt = /^(https:\/\/assets\.tcgdex\.net\/)pt\/(.+)$/.exec(base);
  const url = pt && STAMPED_PT_SCANS.has(pt[2]) ? `${pt[1]}en/${pt[2]}` : base;
  return `${url}/${quality}.webp`;
}

function setsFor(lang: CardLang) {
  return cached(`tcgdex:sets:${lang}`, () => getJson<SetBrief[]>(`${API}/${lang}/sets`), LIST_TTL);
}

type RawCard = { id: string; localId: string; name: string; image?: string };

/** Pokémon cujo nome contém o nome de outro como palavra ("Porygon-Z" contém "Porygon"). */
function longerSpecies(species: string) {
  const p = ` ${plainName(species)} `;
  return POKEDEX.map((s) => plainName(s.name)).filter((n) => n !== p.trim() && ` ${n} `.includes(p));
}

/**
 * O nome da carta é deste Pokémon? ("Mega Charizard X ex" sim; "Mewtwo" não é "Mew"; "Porygon-Z" não é "Porygon").
 * Sem depender de acento, apóstrofo ou símbolo ("Farfetch'd" = "Farfetch’d", "Nidoran F" = "Nidoran♀").
 */
function nameMatches(cardName: string, species: string, lang: CardLang, longer: string[] = []) {
  if (lang === 'ja') {
    const esc = species.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Japonês não tem espaços: evita que ミュウ (Mew) case com ミュウツー (Mewtwo).
    return new RegExp(`${esc}(?![ァ-ヴー])`).test(cardName);
  }
  const card = ` ${plainName(cardName)} `;
  return card.includes(` ${plainName(species)} `) && !longer.some((n) => card.includes(` ${n} `));
}

/**
 * Trecho do nome para a busca por nome da TCGdex, que depende da grafia exata: sem ♀/♂ e, com apóstrofo (' ou ’, cada
 * carta usa um), só o trecho mais longo sem ele ("Farfetch’d" → "Farfetch"). O resultado é conferido depois pelo nome.
 */
function tcgdexStem(name: string) {
  const parts = name
    .replace(/[♀♂☆★◇δ]/g, '|')
    .split(/['’‘`´ʼ|]/)
    .map((s) => s.replace(/\s+/g, ' ').trim());
  return parts.reduce((a, b) => (b.length > a.length ? b : a), '');
}

/** Pokémon com acento no nome (ex.: Flabébé), para quem digita sem acento. */
const ACCENTED = POKEDEX.filter((s) => /[À-ɏ]/.test(s.name)).map((s) => ({ name: s.name, plain: plainName(s.name) }));

/**
 * A TCGdex só acha o nome com o acento certo ("pokemon catcher" dá 0; "pokémon catcher" acha): a forma acentuada
 * provável do que foi digitado (Pokémon, Poké, Pokémon com acento no nome e, em português, -ção/-ções/-ão).
 */
function accentGuess(q: string, lang: CardLang) {
  const plain = plainName(q);
  const species = ACCENTED.find((s) => s.plain === plain || (plain.length >= 4 && s.plain.startsWith(plain)));
  if (species) return species.name;
  let out = q.replace(/pokemon/gi, 'Pokémon').replace(/\bpoke(?!mon|é)/gi, 'Poké');
  if (lang === 'pt') out = out.replace(/cao\b/gi, 'ção').replace(/coes\b/gi, 'ções').replace(/([^cç])ao\b/gi, '$1ão');
  return out;
}

/** Buscas a fazer na TCGdex para um nome: o trecho digitado e, se for diferente, a forma acentuada provável. */
function tcgdexQueries(name: string, lang: CardLang) {
  if (lang === 'ja') return [name.trim()].filter((q) => q.length >= 1);
  const stem = tcgdexStem(name);
  return [...new Set([stem, accentGuess(stem, lang)])].filter((q) => q.length >= 2);
}

/**
 * Cartas de um Pokémon num idioma: pelo número da Pokédex E pelo nome, porque várias cartas
 * (ex.: coleções recentes como a de 30 anos, e muitas japonesas) vêm da TCGdex sem o número.
 */
async function rawCardsFor(dex: number, lang: CardLang, soft: Soft): Promise<RawCard[]> {
  const species = getSpecies(dex);
  const name = species ? (lang === 'ja' ? species.ja : species.name) : undefined;
  const query = name ? (lang === 'ja' ? name : tcgdexStem(name)) : '';
  const [byDex, byName] = await Promise.all([
    getJson<RawCard[]>(`${API}/${lang}/cards?dexId=eq:${dex}`),
    query ? soft(getJson<RawCard[]>(`${API}/${lang}/cards?name=${encodeURIComponent(query)}`), []) : Promise.resolve([]),
  ]);
  const longer = name && lang !== 'ja' ? longerSpecies(name) : [];
  const all = new Map(byDex.map((c) => [c.id, c]));
  for (const c of byName) if (!all.has(c.id) && name && nameMatches(c.name, name, lang, longer)) all.set(c.id, c);
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
 * (que lista as impressões). Só nas coleções recentes, para não abrir a ficha de centenas de cartas antigas, e no
 * máximo `max` cartas (as das coleções mais novas). Até 8 fichas baixando ao mesmo tempo.
 */
async function stampedVersions(list: CardBrief[], max = Infinity, onFail?: () => void): Promise<CardBrief[]> {
  const todo = list
    .filter((c) => STAMP_ERA.test(c.setId) && !c.stamp)
    .sort((a, b) => b.setOrder - a.setOrder)
    .slice(0, max);
  const details = await mapPool(todo, 8, (c) =>
    cardDetail(c.id, 'en').catch((e) => {
      // 404: carta que a TCGdex não tem em inglês (normal); outro erro: a lista pode estar sem alguns selos.
      if (!notFound(e)) onFail?.();
      return null;
    }),
  );
  const out: CardBrief[] = [];
  todo.forEach((c, k) => {
    for (const o of versionOptions(details[k], details[k])) {
      if (o.stamp) out.push({ ...c, stamp: { variant: o.variant, label: o.stamp, keys: o.stampKeys ?? [] } });
    }
  });
  return out;
}

type Stamped = CardBrief & { stamp: NonNullable<CardBrief['stamp']> };

/** Id da coleção a partir do id da carta ("svp-027" → "svp", "30th-c-011" → "30th-c"). */
const setOfId = (id: string) => id.slice(0, id.lastIndexOf('-'));

/**
 * Coleção da TCGdex de uma coleção do catálogo (todas as cartas ligadas dela são de uma só), guardada por 1 semana; sem
 * resposta (coleção ainda sem cartas ligadas), por 1 dia, para pegar logo a ligação feita pelo catalog-sync.
 */
function groupTcgdexSet(groupId: number) {
  return cached(
    `tcgdex:group-set:v1:${groupId}`,
    async () => {
      const ids = await catalogGroupSet(groupId);
      const sets = new Set(ids.map(setOfId));
      return sets.size === 1 ? [...sets][0] : null;
    },
    CACHE_TTL,
    { ttlFor: (set) => (set ? CACHE_TTL : LIST_TTL) },
  );
}

/** Coleções da TCGdex das coleções do catálogo com cartas ainda sem ligação (para juntar com as do Zukan, ex.: MEP 101). */
async function groupSetsFor(rows: CatalogRow[], soft: Soft) {
  const groups = [...new Set(rows.filter((r) => !r.tcgdex_id && r.number).map((r) => r.group_id))].slice(0, 16);
  const sets = await Promise.all(groups.map((g) => soft(groupTcgdexSet(g), null)));
  const out = new Map<number, string>();
  groups.forEach((g, i) => {
    const s = sets[i];
    if (s) out.set(g, s);
  });
  return out;
}

/**
 * Junta o catálogo do TCGCSV (base principal) com a lista da TCGdex (secundária):
 *   - carta do catálogo ligada à TCGdex: usa os dados da TCGdex (nome e imagem em português, variações, preços);
 *   - carta do catálogo ainda sem ligação, mas que está na lista com o id da TCGdex (vinda do Zukan, ex.: promos MEP
 *     089–110): mesma coleção (pelas cartas ligadas dela), mesmo número e mesmo nome = a mesma carta, com a foto;
 *   - carta só do catálogo (ex.: coleção lançada ontem): id "tcgp-<produto>", com a foto da TCGplayer;
 *   - versão com selo do catálogo: carta à parte, com a foto própria;
 *   - da TCGdex entram também as cartas e versões com selo que o catálogo não tem (ex.: selo da Booster Box).
 */
function withCatalog(
  list: CardBrief[],
  rows: CatalogRow[],
  lang: CardLang,
  opts: { species?: string; groupSets?: Map<number, string> } = {},
): CardBrief[] {
  if (!rows.length) return list;
  const byId = new Map(list.filter((c) => !c.stamp).map((c) => [c.id, c]));
  // Cartas da lista por coleção e número (para as linhas do catálogo ainda sem ligação).
  const byNumber = new Map<string, CardBrief[]>();
  for (const c of byId.values()) {
    const k = `${c.setId}|${normNumber(c.localId)}`;
    byNumber.set(k, [...(byNumber.get(k) ?? []), c]);
  }
  const sameName = (a: string, b: string) =>
    plainName(a) === plainName(b) || (!!opts.species && nameMatches(a, opts.species, 'en') && nameMatches(b, opts.species, 'en'));
  const baseOf = (r: CatalogRow) => {
    if (r.tcgdex_id) return byId.get(r.tcgdex_id);
    const setId = opts.groupSets?.get(r.group_id);
    if (!setId || !r.number) return undefined;
    return (byNumber.get(`${setId}|${normNumber(r.number)}`) ?? []).find((c) => sameName(c.name, r.name));
  };

  // Ordem das coleções que só existem no catálogo: logo depois da coleção ligada de id anterior (a TCGplayer
  // numera as coleções em ordem de lançamento).
  const groupOrder = new Map<number, number>();
  for (const r of rows) {
    const b = baseOf(r);
    if (b) groupOrder.set(r.group_id, Math.max(groupOrder.get(r.group_id) ?? -1, b.setOrder));
  }
  const known = [...groupOrder.entries()].sort((a, b) => a[0] - b[0]);
  const orderOf = (g: number) => groupOrder.get(g) ?? known.reduce((o, [id, ord]) => (id <= g ? ord : o), -1) + 0.5;

  const seen = new Set<string>();
  const out: CardBrief[] = [];
  // Versões com selo da TCGdex de cada carta (para usar o nome e o selo dela na versão igual do catálogo).
  const tcgdexStamps = new Map<string, Stamped[]>();
  for (const c of list) if (c.stamp) tcgdexStamps.set(c.id, [...(tcgdexStamps.get(c.id) ?? []), c as Stamped]);
  const matched = new Set<CardBrief>();
  // Ordem fixa (a API não garante uma): a mesma carta vira sempre o mesmo bolso, com a mesma foto.
  const unique = [...new Map(rows.map((r) => [r.product_id, r])).values()].sort((a, b) => a.product_id - b.product_id);
  for (const r of unique) {
    const base = baseOf(r);
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
      // Mesma versão com selo na TCGdex: fica uma só, com a foto do catálogo e o selo da TCGdex (nome em português e
      // a chave do selo, como nas cartas já salvas).
      const twin = (tcgdexStamps.get(common.id) ?? []).find(
        (c) => !matched.has(c) && sameStampVersion(c.stamp.keys, c.stamp.label, c.setNameEn ?? '', r.stamp!),
      );
      if (twin) matched.add(twin);
      const stamp = twin?.stamp ?? { variant: stampVariant(r.stamp), label: r.stamp, keys: [] };
      out.push({ ...common, image: undefined, imageUrl: r.image, stamp });
    } else if (!seen.has(common.id)) {
      seen.add(common.id);
      out.push({ ...common, imageUrl: common.image ? undefined : r.image });
    }
  }
  for (const c of list) {
    if (!c.stamp) {
      if (!seen.has(c.id)) out.push(c);
    } else if (!matched.has(c)) out.push(c);
  }
  return out;
}

const setIdOf = (c: RawCard) => c.id.slice(0, c.id.length - c.localId.length - 1); // id = "<setId>-<localId>"

/** Nomes e ordem das coleções (no idioma da lista e em inglês), para montar as cartas da lista. */
type SetInfo = { names: Map<string, string>; enNames: Map<string, string>; order: Map<string, number> };

/** Cartas do Zukan que a lista ainda não tem (fora as do TCG Pocket), no formato da lista. */
function zukanBriefs(zukan: ZukanBrief[], list: CardBrief[], lang: CardLang, digital: string[], sets: SetInfo): CardBrief[] {
  const have = new Set(list.map((c) => c.id));
  const out: CardBrief[] = [];
  for (const z of zukan) {
    const setId = z.id.slice(0, z.id.length - z.localId.length - 1);
    if (have.has(z.id) || !z.id.endsWith(`-${z.localId}`) || digital.includes(setId)) continue;
    have.add(z.id);
    out.push({
      id: z.id,
      localId: z.localId,
      name: z.name,
      lang,
      setId,
      setName: sets.names.get(setId) ?? z.setNamePt ?? setId,
      setNameEn: sets.enNames.get(setId) ?? setId,
      setOrder: sets.order.get(setId) ?? -1,
    });
  }
  return out;
}

/**
 * Coleções do TCG Pocket (jogo digital): não existem em papel, então ficam fora do fichário. Um idioma sem a série
 * (404, ex.: japonês) não tem coleções; qualquer outra falha não é guardada (vale a cópia anterior, se houver).
 */
function digitalSets() {
  return cached('tcgdex:digital-sets:v2', async () => {
    const series = await Promise.all(
      (['en', 'pt', 'ja'] as CardLang[]).map((l) =>
        getJson<{ sets?: SetBrief[] }>(`${API}/${l}/series/tcgp`).catch((e) => {
          if (notFound(e)) return { sets: [] as SetBrief[] };
          throw e;
        }),
      ),
    );
    return [...new Set(series.flatMap((s) => (s.sets ?? []).map((x) => x.id)))];
  });
}

/** Mais nova primeiro; na mesma coleção, pelo número; a versão com selo depois da comum. */
const byNewest = (a: CardBrief, b: CardBrief) =>
  b.setOrder - a.setOrder || a.localId.localeCompare(b.localId, undefined, { numeric: true }) || Number(!!a.stamp) - Number(!!b.stamp);

/**
 * Todas as cartas de um Pokémon (número da Pokédex nacional) num idioma, da coleção mais nova para a mais antiga, com a
 * situação das fontes. As buscas independentes correm juntas; a lista base vai para `onProgress` antes das versões
 * com selo. Lista completa: guardada por 1 dia; incompleta: por 5 minutos.
 */
export async function cardsForDexResult(dex: number, lang: CardLang, opts: CardListOptions = {}): Promise<CardListResult> {
  const key = `tcgdex:dex:v13:${lang}:${dex}`;
  const result = await cached(key, () => loadDexCards(dex, lang, opts.onProgress), LIST_TTL, {
    force: opts.force,
    ttlFor: (r) => (r.partial ? PARTIAL_TTL : LIST_TTL),
  });
  trackRecent('dex', key);
  return result;
}

/** Todas as cartas de um Pokémon num idioma (ver cardsForDexResult, que diz também se a lista está completa). */
export async function cardsForDex(dex: number, lang: CardLang): Promise<CardBrief[]> {
  return (await cardsForDexResult(dex, lang)).cards;
}

async function loadDexCards(dex: number, lang: CardLang, onProgress?: (cards: CardBrief[]) => void): Promise<CardListResult> {
  const track = { partial: false };
  const soft = softly(track);
  const latin = lang !== 'ja';
  const speciesEn = getSpecies(dex)?.name;
  // Tudo que não depende de outra resposta, junto: cartas no idioma e em inglês, coleções, Zukan e catálogo.
  const [raw, sets, enSets, digital, enRaw, zukan, nameRows] = await Promise.all([
    rawCardsFor(dex, lang, soft),
    setsFor(lang),
    setsFor('en'),
    soft(digitalSets(), [] as string[]),
    lang === 'pt' ? soft(rawCardsFor(dex, 'en', soft), [] as RawCard[]) : Promise.resolve([] as RawCard[]),
    latin ? soft(zukanCardsFor(dex, lang), [] as ZukanBrief[]) : Promise.resolve([] as ZukanBrief[]),
    latin && speciesEn ? soft(catalogByName(speciesEn), [] as CatalogRow[]) : Promise.resolve([] as CatalogRow[]),
  ]);
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
    withEnglishImages(list, enRaw);
    for (const c of enRaw) if (isPhysical(c) && !ptIds.has(c.id)) list.push(toBrief(c, 'en'));
  }

  // Cartas que a TCGdex ainda não tem (ex.: promos novas como a Nidorina MEP 101): completa com o catálogo do Zukan.
  if (latin) list.push(...zukanBriefs(zukan, list, lang, digital, { names, enNames, order }));

  // Catálogo pelo nome do Pokémon (base principal), sem "Porygon" pegar "Porygon-Z".
  const longer = speciesEn ? longerSpecies(speciesEn) : [];
  const byName = speciesEn ? nameRows.filter((r) => nameMatches(r.name, speciesEn, 'en', longer)) : [];
  // Lista base para a tela: só com as cartas do catálogo já ligadas (as sem ligação podem ser do Zukan, ver withCatalog).
  if (onProgress) onProgress([...withCatalog(list, byName.filter((r) => r.tcgdex_id), lang, { species: speciesEn })].sort(byNewest));
  if (!latin) return { cards: list.sort(byNewest), partial: track.partial };

  // Versões com selo da TCGdex e as cartas do catálogo ligadas às da lista, juntas.
  const [stamped, byId] = await Promise.all([
    stampedVersions(list, Infinity, () => {
      track.partial = true;
    }),
    speciesEn ? soft(catalogByTcgdexIds(list.map((c) => c.id)), [] as CatalogRow[]) : Promise.resolve([] as CatalogRow[]),
  ]);
  list.push(...stamped);
  if (!speciesEn) return { cards: list.sort(byNewest), partial: track.partial };
  const rows = [...byName, ...byId];
  const groupSets = await groupSetsFor(rows, soft);
  return { cards: withCatalog(list, rows, lang, { species: speciesEn, groupSets }).sort(byNewest), partial: track.partial };
}

// ---------- Busca por nome (fichários livres e "+ Carta") ----------

/** Busca ampla ("energy", "pikachu"): guarda até estas cartas, as mais novas (a tela corta só na exibição). */
export const CARD_SEARCH_MAX = 1200;
/** Linhas do catálogo lidas numa busca. */
const SEARCH_CATALOG_MAX = 3000;
/** Pokémon com cartas sem ligação numa busca cujas cartas do Zukan são lidas (ex.: "Nidorina" → MEP 101). */
const SEARCH_ZUKAN_MAX = 3;

/**
 * Separa o número no fim da busca: "Charizard 4/102" → { name: "Charizard", number: "4" }, "Gengar TG06" →
 * { name: "Gengar", number: "TG06" }, "Pikachu SWSH020", "Mew #151". Sem número, só o nome.
 */
export function parseCardQuery(query: string): { name: string; number?: string } {
  const q = query.trim().replace(/\s+/g, ' ');
  const m = q.match(/^(.+?)\s+(?:n[º°o.]?\s*|#)?([a-z]{0,6}\d{1,4}[a-z]?)(?:\s*\/\s*[a-z]{0,6}\d{1,4})?$/i);
  if (m && plainName(m[1]).length >= 2) return { name: m[1].trim(), number: m[2] };
  return { name: q };
}

/** O número da carta é o buscado? "025" = "25", "TG06" = "tg6"; "6" também acha "TG06" (prefixo de letras). */
export function matchesNumber(localId: string, number: string) {
  const a = normNumber(localId);
  const b = normNumber(number);
  if (!a || !b) return false;
  return a === b || (/^\d+[a-z]?$/.test(b) && a.replace(/^[a-z]+/, '') === b);
}

/**
 * Filtro da lista de cartas (texto livre): cada palavra tem de aparecer no nome, na coleção (PT ou EN) ou no selo,
 * sem depender de acento; palavra com número também acha pelo número da carta ("151 25", "tg06").
 */
export function filterCards(cards: CardBrief[], text: string) {
  const raw = text.trim().toLowerCase();
  if (!raw) return cards;
  const words = plainName(text).split(' ').filter(Boolean);
  // Texto sem letras latinas nem números (ex.: japonês): procura como foi digitado.
  if (!words.length) return cards.filter((c) => `${c.name} ${c.setName} ${c.stamp?.label ?? ''}`.toLowerCase().includes(raw));
  return cards.filter((c) => {
    const hay = ` ${plainName(`${c.name} ${c.setName} ${c.setNameEn} ${c.stamp?.label ?? ''}`)} `;
    return words.every((w) => hay.includes(w) || (/\d/.test(w) && matchesNumber(c.localId, w)));
  });
}

export type CardOrder = 'newest' | 'oldest' | 'number';
export const CARD_ORDER_LABEL: Record<CardOrder, string> = { newest: 'Mais novas', oldest: 'Mais antigas', number: 'Nº' };

/** Ordena a lista: coleção mais nova ou mais antiga primeiro, ou pelo número da carta. */
export function sortCards(cards: CardBrief[], order: CardOrder = 'newest') {
  const num = (a: CardBrief, b: CardBrief) => a.localId.localeCompare(b.localId, undefined, { numeric: true });
  const stampLast = (a: CardBrief, b: CardBrief) => Number(!!a.stamp) - Number(!!b.stamp);
  const cmp =
    order === 'oldest'
      ? (a: CardBrief, b: CardBrief) => a.setOrder - b.setOrder || num(a, b) || stampLast(a, b)
      : order === 'number'
        ? (a: CardBrief, b: CardBrief) => num(a, b) || b.setOrder - a.setOrder || stampLast(a, b)
        : byNewest;
  return [...cards].sort(cmp);
}

/** Agrupa a lista por coleção, na ordem em que as coleções aparecem. */
export function groupCardsBySet(cards: CardBrief[]) {
  const groups = new Map<string, { setId: string; setName: string; cards: CardBrief[] }>();
  for (const c of cards) {
    const g = groups.get(c.setId) ?? { setId: c.setId, setName: c.setName, cards: [] };
    g.cards.push(c);
    groups.set(c.setId, g);
  }
  return [...groups.values()];
}

/** Série da coleção pelo id da TCGdex (para atalhos por série na escolha da carta). */
const SERIES: [RegExp, string][] = [
  [/^me/i, 'Megaevolução'],
  [/^30th/i, '30 anos'],
  [/^sv/i, 'Escarlate e Violeta'],
  [/^(swsh|cel25|fut20)/i, 'Espada e Escudo'],
  [/^(sm|det1)/i, 'Sol e Lua'],
  [/^(xy|g1)/i, 'XY'],
  [/^(bw|dv1|rc)/i, 'Preto e Branco'],
  [/^(hgss|col1)/i, 'HeartGold e SoulSilver'],
  [/^(pl|dp|pop)/i, 'Diamante e Pérola'],
  [/^ex/i, 'EX'],
  [/^(base|gym|neo|lc|ecard|si1|np|wp)/i, 'Clássicas'],
  [/^tcgp/i, 'Só no catálogo'],
];
export function cardSeries(setId: string) {
  return SERIES.find(([re]) => re.test(setId))?.[1] ?? 'Outras';
}

/**
 * Busca cartas por nome em qualquer Pokémon, treinador ou energia (fichários livres), com a situação das fontes.
 * Mesmas regras do fichário Pokédex: sem TCG Pocket e, em PT, completa com o catálogo em inglês. Não depende de
 * acento nem de apóstrofo e reconhece um número no fim ("Charizard 4/102", "Gengar TG06"): a lista guardada é a do
 * nome, e o número filtra depois (sem nenhuma carta com o número, volta a lista do nome com numberMatched = false).
 */
export async function searchCardsResult(query: string, lang: CardLang, opts: CardListOptions = {}): Promise<CardListResult> {
  const { name, number } = parseCardQuery(query);
  const plain = lang === 'ja' ? name.trim() : plainName(name);
  if (plain.length < 2) return { cards: [], partial: false };
  // A chave leva também as buscas que vão para a TCGdex, que só acha a grafia exata: "mr mime" (0 cartas) e "Mr. Mime"
  // (40) têm o mesmo nome sem pontuação, mas não podem dividir a mesma lista guardada.
  const key = `tcgdex:search:v7:${lang}:${plain.toLowerCase()}|${tcgdexQueries(name, lang).join('|').toLowerCase()}`;
  const result = await cached(key, () => loadSearch(name, lang, opts.signal), LIST_TTL, {
    force: opts.force,
    signal: opts.signal,
    ttlFor: (r) => (r.partial ? PARTIAL_TTL : LIST_TTL),
  });
  trackRecent('search', key);
  if (!number) return result;
  const hits = result.cards.filter((c) => matchesNumber(c.localId, number));
  return { ...result, cards: hits.length ? hits : result.cards, number, numberMatched: hits.length > 0 };
}

/** Busca cartas por nome (ver searchCardsResult, que diz também se a lista está completa e trata o número). */
export async function searchCards(query: string, lang: CardLang): Promise<CardBrief[]> {
  return (await searchCardsResult(query, lang)).cards;
}

async function loadSearch(name: string, lang: CardLang, signal?: AbortSignal): Promise<CardListResult> {
  const track = { partial: false };
  const soft = softly(track, signal);
  const plain = plainName(name);
  const byName = async (l: CardLang) => {
    const queries = tcgdexQueries(name, l);
    const lists = await Promise.all(
      queries.map((q, i) => {
        const p = getJson<RawCard[]>(`${API}/${l}/cards?name=like:${encodeURIComponent(q)}`, signal);
        return i === 0 ? p : soft(p, []);
      }),
    );
    const all = new Map(lists.flat().map((c) => [c.id, c]));
    // O trecho buscado pode ser mais amplo que o digitado ("Farfetch" por "Farfetch’d"): confere o nome inteiro.
    return [...all.values()].filter((c) => l === 'ja' || plainName(c.name).includes(plain));
  };
  // Com 2 letras a busca no catálogo traria milhares de cartas: fica só a da TCGdex.
  const useCatalog = lang !== 'ja' && plain.replace(/ /g, '').length >= 3;
  const [raw, sets, enSets, digital, en, rows] = await Promise.all([
    byName(lang),
    setsFor(lang),
    setsFor('en'),
    soft(digitalSets(), [] as string[]),
    lang === 'pt' ? soft(byName('en'), [] as RawCard[]) : Promise.resolve([] as RawCard[]),
    useCatalog ? soft(catalogByName(name, ENGLISH, { max: SEARCH_CATALOG_MAX, signal }), [] as CatalogRow[]) : Promise.resolve([] as CatalogRow[]),
  ]);
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
    withEnglishImages(list, en);
    for (const c of en) if (isPhysical(c) && !ids.has(c.id)) list.push(toBrief(c, 'en'));
  }
  // Versões com selo da TCGdex (ex.: logo da coleção na Booster Box), como no fichário Pokédex; numa busca ampla,
  // só as das coleções mais novas. Junto, as coleções das cartas do catálogo ainda sem ligação.
  const [stamped, groupSets] = await Promise.all([
    lang !== 'ja'
      ? stampedVersions(list, 60, () => {
          track.partial = true;
        })
      : Promise.resolve([]),
    groupSetsFor(rows, soft),
  ]);
  list.push(...stamped);
  // Cartas do catálogo ainda sem ligação, de uma coleção conhecida, sem a carta na lista (ex.: Nidorina MEP 101, que a
  // TCGdex ainda não tem): completa com as cartas do Pokémon no Zukan, como no fichário Pokédex, para a carta ficar com
  // o mesmo id da lista do Pokémon (e o "tenho" bater). No máximo SEARCH_ZUKAN_MAX Pokémon.
  if (lang !== 'ja') {
    const slots = new Set(list.map((c) => `${c.setId}|${normNumber(c.localId)}`));
    const missing = new Set(
      rows
        .filter((r) => !r.tcgdex_id && r.number && groupSets.has(r.group_id) && !slots.has(`${groupSets.get(r.group_id)}|${normNumber(r.number)}`))
        .map((r) => r.name),
    );
    const dexes = [...new Set([...missing].map((n) => speciesInCardName(n)?.id).filter((d): d is number => !!d))].slice(0, SEARCH_ZUKAN_MAX);
    const zukan = (await Promise.all(dexes.map((d) => soft(zukanCardsFor(d, lang), [] as ZukanBrief[])))).flat();
    // Só as que batem com o nome buscado, como as da TCGdex.
    const named = zukan.filter((z) => plainName(z.name).includes(plain));
    list.push(...zukanBriefs(named, list, lang, digital, { names, enNames, order }));
  }
  // Cancelada no meio: a lista pode ter perdido partes por causa do cancelamento, então não é devolvida nem guardada.
  if (signal?.aborted) throw abortError();
  const all = withCatalog(list, rows, lang, { groupSets }).sort(byNewest);
  return {
    cards: all.slice(0, CARD_SEARCH_MAX),
    partial: track.partial,
    truncated: all.length > CARD_SEARCH_MAX || undefined,
  };
}

// ---------- Ficha da carta ----------

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
      if (lang === 'ja' || !notFound(e)) throw e;
      const z = await zukanCard(id, lang).catch(() => undefined);
      if (!z) throw e;
      return z;
    }
  });
}

/**
 * Foto da TCGplayer da versão comum da carta, pelo id da TCGdex (null = o catálogo não tem a carta; guardado por 1 dia,
 * para a carta ligada depois pelo catalog-sync ganhar a foto logo). Primeira reserva da imagem: é a foto oficial da
 * carta, em inglês (quem mostra reduz para o tamanho do fichário com catalogImage).
 */
export function catalogPhoto(cardId: string) {
  return cached(
    `tcgdex:catalog-photo:v1:${cardId}`,
    async () => {
      if (cardId.startsWith('tcgp-')) return null;
      const rows = await catalogByTcgdexIds([cardId]);
      const common = rows.filter((r) => !r.stamp).sort((a, b) => a.product_id - b.product_id)[0];
      return common?.image ?? null;
    },
    CACHE_TTL,
    { ttlFor: (url) => (url ? CACHE_TTL : LIST_TTL) },
  );
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

/** Cartas de um Pokémon no Zukan (erro de rede propaga: quem chama marca a lista como incompleta). */
async function zukanCardsFor(dex: number, lang: CardLang): Promise<ZukanBrief[]> {
  const r = await zukan<{ cards?: ZukanBrief[] }>('get_pokemon', { query: String(dex), lang: lang === 'en' ? 'en' : 'pt' });
  return r?.cards ?? [];
}

/**
 * Imagem da carta no Zukan: última reserva, para cartas sem arte na TCGdex, no catálogo, na pokemontcg.io e na Scrydex
 * (ex.: coleção me06, que só o Zukan tem). O Zukan só tem a imagem grande dessas cartas.
 */
export function zukanImage(cardId: string) {
  return cached(`zukan:image:v1:${cardId}`, async () => {
    if (cardId.startsWith('tcgp-')) return null;
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
