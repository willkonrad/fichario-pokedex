import AsyncStorage from '@react-native-async-storage/async-storage';

import { getSpecies, POKEDEX, speciesInCardName } from '@/data/pokedex';
import {
  catalogByName,
  catalogByTcgdexIds,
  catalogGroupSet,
  catalogGroupYears,
  catalogNumber,
  catalogProduct,
  catalogYear,
  ENGLISH,
  isBoxStamp,
  isOversize,
  isPrereleaseStamp,
  JAPANESE,
  normNumber,
  plainName,
  sameStampVersion,
  stampVariant,
  type CatalogRow,
} from './catalog';
import { timedFetch } from './fetch-timeout';
import { japaneseProducts, nameHasSpecies, type JaCardRef } from './ja-catalog';
import type { CardLang, Variant } from './types';
import { logoOnlyLabel, versionOptions } from './variants';

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
  /** Série da coleção quando ela não sai do id (cartas japonesas: pela época de lançamento). Ver seriesOf. */
  series?: string;
  /** Produto da TCGplayer japonesa que é a mesma carta da TCGdex japonesa com este id (para o "tenho" das já salvas). */
  tcgdexId?: string;
  /** Versão vista na Consulta (impressão escolhida, 1ª edição, coleção "(Shadowless)"): o "Adicionar" já a marca. */
  version?: Variant;
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
  variants_detailed?: {
    type: string;
    subtype?: string;
    size?: string;
    foil?: string;
    stamp?: string[];
    /** Produto da TCGplayer desta impressão (nas japonesas, da categoria 85). */
    thirdParty?: { tcgplayer?: number };
  }[];
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
  /**
   * Lista base pronta (para a tela mostrar algo enquanto o resto chega), com o que ainda falta buscar, para o "buscando
   * …" da tela: "versões com selo" (PT e EN) ou "mais cartas" (japonês: a reserva da TCGdex japonesa).
   */
  onProgress?: (cards: CardBrief[], pending: string) => void;
};

type SetBrief = { id: string; name: string; logo?: string; cardCount?: { total?: number; official?: number } };

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
  /^tcgdex:dex:v(?:[1-9]|1[0-5]):/,
  /^tcgdex:search:v[1-9]:/,
  /^tcgdex:set-years:v1$/,
  /^tcgdex:code-cat:v1:/,
  /^scrydex:(?!v5:)/,
  /^tcgdex:abbr:/,
  /^tcgdex:groupset:/,
  /^tcgdex:group-set:v1:/,
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

/** JSON da TCGdex, com tempo máximo até o fim da leitura (uma conexão muda vira erro e o "Tentar de novo" aparece). */
function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return timedFetch<T>(
    url,
    (res) => {
      if (!res.ok) throw new Error(`TCGdex ${res.status}`);
      return res.json() as Promise<T>;
    },
    { signal },
  );
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
 * data do TCGCSV, em inglês e em japonês, com a correção de GROUP_YEARS). Guardado por 7 dias; se a TCGdex não
 * responder, nada é guardado (tenta de novo depois). A v2 trouxe as coleções japonesas.
 *
 * Lista em japonês (`lang` 'ja'): a consulta da TCGdex só tem as coleções em inglês, e algumas japonesas da reserva
 * repetem o id delas com outra data (neo1–neo4: Neo Discovery é de 2001, 遺跡をこえて... de 2000). Então ficam só os anos
 * do catálogo e, para as coleções da reserva em `setIds`, o ano da própria coleção japonesa (ver japaneseSetYear).
 */
export async function setReleaseYears(lang?: CardLang, setIds: string[] = []): Promise<Record<string, number>> {
  const all = await allSetYears();
  const out: Record<string, number> = {};
  for (const [id, year] of Object.entries(all)) if (lang !== 'ja' || id.startsWith('tcgp')) out[id] = year;
  for (const [group, [from]] of Object.entries(GROUP_YEARS)) if (out[`tcgp${group}`]) out[`tcgp${group}`] = from;
  if (lang !== 'ja') return out;
  const reserve = [...new Set(setIds.filter((id) => id && !id.startsWith('tcgp')))];
  const years = await mapPool(reserve, 4, (id) => japaneseSetYear(id).catch(() => null));
  reserve.forEach((id, i) => {
    const year = years[i];
    if (year) out[id] = year;
  });
  return out;
}

/** Ano de uma coleção da TCGdex japonesa, pela ficha dela (a lista de coleções não traz a data). Guardado por 4 semanas. */
function japaneseSetYear(setId: string) {
  return cached(
    `tcgdex:ja-set-year:v1:${setId}`,
    async () => {
      const set = await getJson<{ releaseDate?: string | null }>(`${API}/ja/sets/${encodeURIComponent(setId)}`).catch((e) => {
        if (notFound(e)) return null;
        throw e;
      });
      return catalogYear(set?.releaseDate) ?? null;
    },
    CACHE_TTL * 4,
    { ttlFor: (year) => (year ? CACHE_TTL * 4 : LIST_TTL) },
  );
}

function allSetYears(): Promise<Record<string, number>> {
  return cached(
    'tcgdex:set-years:v2',
    async () => {
      const body = await timedFetch(
        `${API}/graphql`,
        (res) => {
          if (!res.ok) throw new Error(`TCGdex ${res.status}`);
          return res.json() as Promise<{ data?: { sets?: { id: string; releaseDate?: string | null }[] } }>;
        },
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ sets { id releaseDate } }' }) },
      );
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
  if (lang === 'ja') return jaNameHas(cardName, species);
  const card = ` ${plainName(cardName)} `;
  return card.includes(` ${plainName(species)} `) && !longer.some((n) => card.includes(` ${n} `));
}

/** Nomes japoneses mais longos que contêm cada nome ("コイル" → レアコイル, ジバコイル), calculados quando pedidos. */
const longerJa = new Map<string, string[]>();
function longerJaNames(ja: string) {
  let out = longerJa.get(ja);
  if (!out) {
    out = POKEDEX.map((s) => s.ja).filter((n) => !!n && n.length > ja.length && n.includes(ja));
    longerJa.set(ja, out);
  }
  return out;
}

/**
 * O nome japonês `ja` está no nome da carta como o próprio Pokémon. Japonês não tem espaços: não pode vir seguido de
 * katakana (ミュウ não é ミュウツー) nem estar dentro do nome de outro Pokémon (コイル não está em レアコイル nem em
 * ジバコイル; ニューラ não está em マニューラ). A carta de dois Pokémon ("ピカチュウ&ゼクロムGX") vale para os dois.
 */
function jaNameHas(cardName: string, ja: string): boolean {
  if (!ja) return false;
  const longer = longerJaNames(ja);
  for (let at = cardName.indexOf(ja); at >= 0; at = cardName.indexOf(ja, at + 1)) {
    if (/[ァ-ヴー]/.test(cardName[at + ja.length] ?? '')) continue;
    const inside = longer.some((n) => {
      for (let k = n.indexOf(ja); k >= 0; k = n.indexOf(ja, k + 1)) if (at >= k && cardName.startsWith(n, at - k)) return true;
      return false;
    });
    if (!inside) return true;
  }
  return false;
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
 * máximo `max` cartas (as das coleções mais novas). Até 8 fichas baixando ao mesmo tempo. `only`: as cartas cujas
 * impressões são todas com selo (ex.: as 30 da Coleção Clássica de 30 anos, só com o selo 30th Anniversary): a carta
 * comum não existe, então a lista mostra só a versão com selo (ver withoutPlain e withCatalog).
 */
async function stampedVersions(list: CardBrief[], max = Infinity, onFail?: () => void): Promise<{ cards: CardBrief[]; only: Set<string> }> {
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
  const only = new Set<string>();
  todo.forEach((c, k) => {
    const options = versionOptions(details[k], details[k]);
    const stamped = options.filter((o) => o.stamp);
    for (const o of stamped) out.push({ ...c, stamp: { variant: o.variant, label: o.stamp!, keys: o.stampKeys ?? [] } });
    if (stamped.length && stamped.length === options.length && details[k]?.variants_detailed?.length) only.add(c.id);
  });
  return { cards: out, only };
}

/** Sem a carta comum das que só existem com selo (ver stampedVersions): fica só a versão com selo. */
const withoutPlain = (list: CardBrief[], only: Set<string>) => (only.size ? list.filter((c) => !!c.stamp || !only.has(c.id)) : list);

type Stamped = CardBrief & { stamp: NonNullable<CardBrief['stamp']> };

/** Id da coleção a partir do id da carta ("svp-027" → "svp", "30th-c-011" → "30th-c"). */
const setOfId = (id: string) => id.slice(0, id.lastIndexOf('-'));

/**
 * Coleção da TCGdex de uma coleção do catálogo (todas as cartas ligadas dela são de uma só), guardada por 1 semana; sem
 * resposta (coleção ainda sem cartas ligadas), por 1 dia, para pegar logo a ligação feita pelo catalog-sync. A v2 veio
 * com a regra 7 de ligação do catalog-sync, que tirou ligações erradas (ex.: "ME06: Delta Reign" → Delta Species).
 */
function groupTcgdexSet(groupId: number) {
  return cached(
    `tcgdex:group-set:v2:${groupId}`,
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
 * Na japonesa (`category` 85): as cartas só do catálogo têm os dados da própria carta japonesa (`dataLang` vazio), a
 * ordem e a série pela data de lançamento da coleção, e "Mirror" é o reverse.
 */
function withCatalog(
  list: CardBrief[],
  rows: CatalogRow[],
  lang: CardLang,
  opts: {
    species?: string;
    groupSets?: Map<number, string>;
    category?: number;
    /** Idioma dos dados das cartas só do catálogo: 'en' na 3 (padrão); na 85, vazio (são da própria carta). */
    dataLang?: CardLang;
    /** Produto → id da mesma carta na TCGdex japonesa (ver CardBrief.tcgdexId). */
    aliases?: Map<number, string>;
    /** Cartas que só existem com selo (ver stampedVersions): o produto sem selo delas não vira uma carta comum. */
    stampOnly?: Set<string>;
  } = {},
): CardBrief[] {
  const only = opts.stampOnly ?? new Set<string>();
  if (!rows.length) return withoutPlain(list, only);
  const category = opts.category ?? ENGLISH;
  const japanese = category === JAPANESE;
  const rowDataLang = 'dataLang' in opts ? opts.dataLang : 'en';
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

  // Ordem das coleções ligadas: a da coleção da TCGdex das cartas delas.
  const groupOrder = new Map<number, number>();
  const groupSetIds = new Map<number, Set<string>>();
  const groupDay = new Map<number, string>();
  for (const r of rows) {
    const b = baseOf(r);
    if (!b) continue;
    groupOrder.set(r.group_id, Math.max(groupOrder.get(r.group_id) ?? -1, b.setOrder));
    groupSetIds.set(r.group_id, (groupSetIds.get(r.group_id) ?? new Set<string>()).add(b.setId));
    const day = isoDay(groupPublishedOn(r));
    if (day) groupDay.set(r.group_id, day);
  }
  // Coleções ligadas com data e de uma coleção só da TCGdex (as "de tudo um pouco" não dizem nada da época).
  const anchors = [...groupOrder]
    .filter(([g]) => groupDay.has(g) && groupSetIds.get(g)!.size === 1)
    .map(([g, ord]) => ({ day: groupDay.get(g)!, ord }));
  const byGroupId = [...groupOrder.entries()].sort((a, b) => a[0] - b[0]);
  // Coleção que só existe no catálogo: logo depois da coleção ligada mais recente lançada até a data dela (a fração da
  // data põe duas delas na ordem certa entre si). Sem data, depois da ligada de id anterior (a TCGplayer numera mais ou
  // menos na ordem de lançamento, mas não sempre: EX Battle Stadium, de 2004, é o grupo 1853).
  const orderOf = (r: CatalogRow) => {
    const own = groupOrder.get(r.group_id);
    if (own != null) return own;
    const day = isoDay(groupPublishedOn(r));
    if (day && anchors.length) {
      let best: { day: string; ord: number } | undefined;
      for (const a of anchors) if (a.day <= day && (!best || a.day > best.day || (a.day === best.day && a.ord > best.ord))) best = a;
      return (best?.ord ?? -1) + 0.5 + dateOrder(day) / 1e10;
    }
    return byGroupId.reduce((o, [id, ord]) => (id <= r.group_id ? ord : o), -1) + 0.5;
  };

  const seen = new Set<string>();
  const out: CardBrief[] = [];
  // Versões com selo da TCGdex de cada carta (para usar o nome e o selo dela na versão igual do catálogo).
  const tcgdexStamps = new Map<string, Stamped[]>();
  for (const c of list) if (c.stamp) tcgdexStamps.set(c.id, [...(tcgdexStamps.get(c.id) ?? []), c as Stamped]);
  const matched = new Set<CardBrief>();
  // Foto do produto sem selo de uma carta que só existe com selo: é a da versão com selo (ver stampOnly).
  const onlyPhoto = new Map<string, string>();
  // Ordem fixa (a API não garante uma): a mesma carta vira sempre o mesmo bolso, com a mesma foto.
  const unique = [...new Map(rows.map((r) => [r.product_id, r])).values()].sort((a, b) => a.product_id - b.product_id);
  // Selo só do logo, como na lista de versões (withCatalogVersions): sem o "<Coleção> Stamped" no catálogo da carta, o
  // par dele é o produto "Prerelease" (fora o de Staff), e o nome é o que o catálogo da carta prova (logoOnlyLabel). Assim
  // o nome na lista é o mesmo do "Qual é a sua versão?" e o "Adicionar" não ganha uma versão repetida.
  const rowsOfCard = new Map<string, CatalogRow[]>();
  for (const r of unique) {
    const id = japanese ? `tcgp-${r.product_id}` : (baseOf(r)?.id ?? r.tcgdex_id ?? `tcgp-${r.product_id}`);
    rowsOfCard.set(id, [...(rowsOfCard.get(id) ?? []), r]);
  }
  const logoOnly = (c: Stamped) => c.stamp.keys.length === 1 && c.stamp.keys[0] === 'set-logo';
  const hasBox = (c: CardBrief) =>
    (rowsOfCard.get(c.id) ?? []).some((x) => !!x.stamp && !isOversize(x.stamp) && isBoxStamp(x.stamp, c.setNameEn ?? ''));
  const logoStamp = (c: Stamped): Stamped['stamp'] =>
    logoOnly(c) ? { ...c.stamp, label: logoOnlyLabel(c.setId, rowsOfCard.get(c.id) ?? [], c.setNameEn ?? '') } : c.stamp;
  for (const r of unique) {
    const base = japanese ? undefined : baseOf(r);
    const group = r.tcg_groups?.name ?? '';
    const published = groupPublishedOn(r);
    const common: CardBrief = base ?? {
      // Na 85 o id é sempre o do produto (os ids da TCGdex japonesa repetem os ingleses).
      id: japanese ? `tcgp-${r.product_id}` : (r.tcgdex_id ?? `tcgp-${r.product_id}`),
      localId: catalogNumber(r.number),
      name: r.name,
      lang,
      dataLang: rowDataLang,
      setId: `tcgp${r.group_id}`,
      setName: group,
      setNameEn: group,
      setOrder: japanese ? dateOrder(published) : orderOf(r),
      ...(japanese ? { series: japaneseSeries(published) } : {}),
    };
    if (r.stamp) {
      // Mesma versão com selo na TCGdex: fica uma só, com a foto do catálogo e o selo da TCGdex (nome em português e
      // a chave do selo, como nas cartas já salvas).
      const own = tcgdexStamps.get(common.id) ?? [];
      const twin =
        own.find((c) => !matched.has(c) && sameStampVersion(c.stamp.keys, c.stamp.label, c.setNameEn ?? '', r.stamp!)) ??
        (!isOversize(r.stamp) && isPrereleaseStamp(r.stamp) && !hasBox(common) ? own.find((c) => !matched.has(c) && logoOnly(c)) : undefined);
      if (twin) matched.add(twin);
      const stamp = twin ? logoStamp(twin) : { variant: stampVariant(r.stamp, category), label: r.stamp, keys: [] };
      out.push({ ...common, image: undefined, imageUrl: r.image, stamp });
    } else if (!seen.has(common.id)) {
      seen.add(common.id);
      // Carta só com selo: o produto sem selo dela é a própria versão com selo (a TCGplayer não repete o selo no nome).
      if (only.has(common.id)) {
        if (r.image) onlyPhoto.set(common.id, r.image);
        continue;
      }
      const alias = opts.aliases?.get(r.product_id);
      out.push({ ...common, imageUrl: common.image ? undefined : r.image, ...(alias ? { tcgdexId: alias } : {}) });
    }
  }
  for (const c of list) {
    if (!c.stamp) {
      if (!seen.has(c.id) && !only.has(c.id)) out.push(c);
    } else if (!matched.has(c)) {
      // A foto do produto só serve quando a carta tem uma versão com selo só (com duas, não se sabe de qual é).
      const photo = !c.image && tcgdexStamps.get(c.id)?.length === 1 ? onlyPhoto.get(c.id) : undefined;
      const stamp = logoStamp(c as Stamped);
      out.push(photo || stamp !== c.stamp ? { ...c, stamp, ...(photo ? { imageUrl: photo } : {}) } : c);
    }
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

// ---------- Cartas japonesas: TCGplayer japonesa (catálogo 85) como base, TCGdex japonesa só de reserva ----------

/**
 * Épocas das cartas japonesas, da mais nova: a partir de qual data de lançamento ("AAAA-MM-DD") cada uma vale. Datas
 * conferidas nas coleções da 85 (primeiro produto de cada época; o último da anterior entre parênteses).
 */
const JA_ERAS: [string, string][] = [
  ['2025-08-01', 'Megaevolução (2025–)'], // m1L/m1S: 01/08/2025 (SV11B: 06/06/2025)
  ['2023-01-01', 'Escarlate e Violeta (2023–2025)'], // SV1S/SV1V: 20/01/2023 (S12a: 02/12/2022)
  ['2019-11-01', 'Espada e Escudo (2019–2022)'], // sA: 29/11/2019, S1W: 06/12/2019 (SM12a: 04/10/2019)
  ['2016-11-01', 'Sol e Lua (2016–2019)'], // SM-P: 01/11/2016, SM1S: 09/12/2016 (CP6: 16/09/2016)
  ['2013-08-01', 'XY (2013–2016)'], // XY-P: 01/08/2013, Collection X: 13/12/2013 (EBB: 13/07/2013)
  ['2010-09-01', 'Preto e Branco (2010–2013)'], // BW1: 18/09/2010 (L3: 08/07/2010)
  ['2006-10-01', 'Diamante e Pérola (2006–2010)'], // DP1: 27/10/2006, com Pt e LEGEND (PCG: 15/07/2006)
  ['2001-12-01', 'e-Card, ADV e PCG (2001–2006)'], // Base Expansion Pack: 01/12/2001 (Pokemon Web: 20/10/2001)
  ['', 'Pocket Monsters (1996–2001)'], // Expansion Pack: 20/10/1996, com neo, VS e web
];
const JA_NO_DATE = 'Sem data';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Dia "AAAA-MM-DD" de uma data do catálogo (undefined sem data). */
const isoDay = (d?: string | null) => {
  const day = String(d ?? '').slice(0, 10);
  return ISO_DAY.test(day) ? day : undefined;
};

/**
 * Coleções do catálogo com a data errada no TCGCSV: grupo → anos de lançamento de verdade. A mesma correção do
 * lookup_overrides (year_range) da Consulta, na migração 20261109c_cd_promo.sql.
 */
const GROUP_YEARS: Record<number, [number, number]> = {
  // Japanese CD Promo (Charizard, Blastoise, Venusaur, Misty's Treatment): o TCGCSV diz 2025-12-01; são de 1998–1999.
  24568: [1998, 1999],
};

/** Data de lançamento de uma coleção do catálogo, com a correção de GROUP_YEARS (o começo dos anos de verdade). */
export function catalogPublishedOn(groupId: number, publishedOn?: string | null): string | null | undefined {
  const fix = GROUP_YEARS[groupId];
  return fix ? `${fix[0]}-01-01` : publishedOn;
}

const groupPublishedOn = (r: Pick<CatalogRow, 'group_id' | 'tcg_groups'>) => catalogPublishedOn(r.group_id, r.tcg_groups?.published_on);

/** Série de uma coleção japonesa pela data de lançamento ("1996-10-20" → "Pocket Monsters (1996–2001)"). */
export function japaneseSeries(publishedOn?: string | null) {
  const d = String(publishedOn ?? '').slice(0, 10);
  if (!ISO_DAY.test(d)) return JA_NO_DATE;
  return JA_ERAS.find(([from]) => d >= from)![1];
}

/** Ordem pela data de lançamento ("2025-01-24" → 20250124); sem data, -1 (no fim, nas mais novas primeiro). */
export function dateOrder(publishedOn?: string | null) {
  const d = String(publishedOn ?? '').slice(0, 10);
  return ISO_DAY.test(d) ? Number(d.replace(/-/g, '')) : -1;
}

/** Série da carta da lista: a da época (japonesas) ou a do id da coleção. */
export const seriesOf = (c: Pick<CardBrief, 'setId' | 'series'>) => c.series ?? cardSeries(c.setId);

/**
 * Início aproximado da época de cada coleção da TCGdex japonesa, pelo id (a lista de coleções dela não traz a data). As
 * CS* (chinesas) e outras sem par ficam sem data.
 */
const JA_TCGDEX_ERAS: [RegExp, string][] = [
  [/^PMCG/i, '1996-10-20'],
  [/^neo/i, '2000-02-04'],
  [/^(VS|web)\d/i, '2001-07-01'],
  [/^E\d/i, '2001-12-01'],
  [/^ADV/i, '2003-07-18'],
  [/^PCG/i, '2004-01-01'],
  [/^(DP|Pt)\d/i, '2006-10-27'],
  [/^L(\d|L)/i, '2009-07-10'],
  [/^BW/i, '2010-09-18'],
  [/^(XY|CP)/i, '2013-12-06'],
  [/^SM/i, '2016-12-09'],
  [/^SV/i, '2023-01-20'],
  [/^S(\d|P|-P|[A-Z]$)/i, '2019-12-06'],
  [/^(M\d|M-P|MC$)/i, '2025-08-01'],
];

/** Texto em japonês (kana ou kanji): a busca vai para a TCGdex japonesa; texto latino, para o catálogo 85 pelo nome. */
export const isJapaneseText = (s: string) => /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/.test(s);

/**
 * Dá para buscar este nome: pelo menos 2 letras (o texto em japonês como foi digitado). Em japonês com letras latinas
 * (o nome em inglês no catálogo 85), pelo menos 3 sem contar os espaços: com 2, a busca traria milhares de cartas.
 */
export function canSearchName(text: string, lang: CardLang) {
  if (lang === 'ja' && isJapaneseText(text)) return text.trim().length >= 2;
  const plain = plainName(text);
  return lang === 'ja' ? plain.replace(/ /g, '').length >= 3 : plain.length >= 2;
}

/** Opções do withCatalog para a TCGplayer japonesa: dados da própria carta (sem "só em inglês"), ordem pela data. */
const JA_CATALOG = { category: JAPANESE, dataLang: undefined };

/**
 * Cartas da TCGdex japonesa no formato da lista (reserva: quase todas sem foto), com a ordem e a série estimadas pela
 * época do id da coleção e pela posição dela na lista de coleções (que é cronológica).
 */
function jaTcgdexBriefs(raw: RawCard[], sets: SetBrief[]): CardBrief[] {
  const info = new Map(sets.map((s, i) => [s.id, { name: s.name, index: i }]));
  return raw.map((c) => {
    const setId = setIdOf(c);
    const s = info.get(setId);
    const start = JA_TCGDEX_ERAS.find(([re]) => re.test(setId))?.[1];
    return {
      ...c,
      lang: 'ja' as const,
      setId,
      setName: s?.name ?? setId,
      setNameEn: setId,
      setOrder: start ? dateOrder(start) + ((s?.index ?? 0) + 1) / 1000 : -1,
      series: start ? japaneseSeries(start) : 'Outras',
    };
  });
}

/** Pokémon de um nome em japonês (o nome mais longo que bate, para "ミュウツー" não ser "ミュウ"). */
function speciesOfJaName(name: string) {
  let best: { id: number; ja: string } | undefined;
  for (const s of POKEDEX) {
    if (!s.ja || !name.includes(s.ja) || (best && s.ja.length <= best.ja.length)) continue;
    if (nameMatches(name, s.ja, 'ja')) best = s;
  }
  return best?.id;
}

/** Total impresso de cada coleção da TCGdex japonesa (o "081" de "088/081"). */
const setTotals = (sets: SetBrief[]) => new Map(sets.map((s) => [s.id, s.cardCount?.official || s.cardCount?.total || undefined]));

/** Cartas da TCGdex japonesa que são um produto da 85 (ver japaneseProducts): id da carta → produto. */
async function matchJapanese(list: CardBrief[], sets: SetBrief[], dexOf: (c: CardBrief) => number | undefined, soft: Soft, signal?: AbortSignal) {
  if (!list.length) return new Map<string, CatalogRow>();
  const totals = setTotals(sets);
  const refs: JaCardRef[] = list.map((c) => ({ cardId: c.id, setId: c.setId, localId: c.localId, setTotal: totals.get(c.setId), dex: dexOf(c) }));
  return soft(japaneseProducts(refs, { signal }), new Map<string, CatalogRow>());
}

/** Sigla comparável: sem caixa nem espaço, "+" = "p" (a TCGdex escreve "SM4p"; a TCGplayer, "SM4+"). */
const abbrKey = (s?: string | null) => (s ?? '').toLowerCase().replace(/\s+/g, '').replace(/\+/g, 'p');

/**
 * Pares prováveis da carta da reserva entre os produtos da 85 do mesmo Pokémon (`rows`): mesmo número e coleção
 * equivalente — a mesma sigla ("SM4+" = "SM4p"), a sigla no lugar do total ("001/SV-P") ou, no grupo sem sigla, o
 * mesmo total impresso ("060/742" = coleção MC de 742). É a mesma carta que a ligação exata (japaneseProducts) não
 * achou (promo, sigla escrita de outro jeito, total diferente na TCGdex). Devolve as linhas do par (comum e selos).
 */
function probablePairs(c: CardBrief, total: number | undefined, rows: CatalogRow[]): CatalogRow[] {
  const number = normNumber(c.localId);
  const set = abbrKey(c.setId);
  if (!number || !set) return [];
  return rows.filter((r) => {
    if (!r.number || normNumber(r.number) !== number) return false;
    const tail = r.number.split('/')[1]?.trim() ?? '';
    const abbr = abbrKey(r.tcg_groups?.abbr);
    if (abbr === set || abbrKey(tail) === set) return true;
    return !abbr && !!total && /^\d+$/.test(tail) && Number(tail) === total;
  });
}

/**
 * Junta os produtos da 85 (`rows`, os que a lista mostra) com a reserva da TCGdex japonesa:
 *   - a carta da TCGdex que é um produto da 85 (`matched`) vira esse produto, com o id dela (`tcgdexId`, para o "tenho"
 *     e a tela da carta acharem as cópias já salvas com ele);
 *   - a que tem exatamente um par provável sem selo entre os produtos do Pokémon dela (`pool`, ver probablePairs) vira
 *     esse produto do mesmo jeito (na busca, o produto entra no lugar dela);
 *   - a que tem outro par provável (só com selo, ou mais de um) sai quando o par já está na lista;
 *   - as outras entram como estão.
 * Duas cartas da reserva com o mesmo par: o produto fica sem `tcgdexId` (na dúvida, nenhum). A carta antiga sem número
 * impresso (`links`, ver tcgplayerLinks) tem como par os produtos que a própria TCGdex liga a ela, e o comum é o da
 * impressão sem subtipo.
 */
function withJapanese(
  rows: CatalogRow[],
  reserve: CardBrief[],
  matched: Map<string, CatalogRow>,
  sets: SetBrief[],
  pool: (c: CardBrief) => CatalogRow[] = () => rows,
  links: Map<string, number[]> = new Map(),
): CardBrief[] {
  const aliases = new Map([...matched].map(([id, r]) => [r.product_id, id]));
  const totals = setTotals(sets);
  const shown = new Set(rows.map((r) => r.product_id));
  const paired = new Map<number, { row: CatalogRow; ids: string[] }>();
  const rest: CardBrief[] = [];
  for (const c of reserve) {
    if (matched.has(c.id)) continue;
    const link = links.get(c.id);
    const pairs = link ? pool(c).filter((r) => link.includes(r.product_id)) : probablePairs(c, totals.get(c.setId), pool(c));
    const common = pairs.filter((r) => !r.stamp && (!link || r.product_id === link[0]));
    if (common.length === 1) {
      const p = paired.get(common[0].product_id) ?? { row: common[0], ids: [] };
      p.ids.push(c.id);
      paired.set(common[0].product_id, p);
    } else if (!pairs.some((r) => shown.has(r.product_id))) rest.push(c);
  }
  for (const [productId, p] of paired) if (!aliases.has(productId) && p.ids.length === 1) aliases.set(productId, p.ids[0]);
  const extra = [...paired.values()].map((p) => p.row).filter((r) => !shown.has(r.product_id));
  return withCatalog(rest, [...rows, ...matched.values(), ...extra], 'ja', { ...JA_CATALOG, aliases }).sort(byNewest);
}

/**
 * Cartas de um Pokémon em japonês: os produtos da TCGplayer japonesa (85) com o nome em inglês do Pokémon (com foto,
 * coleção e ano; versões Mirror, Poké Ball… como cartas à parte), mais as da TCGdex japonesa que a 85 não tem.
 */
async function loadJaDexCards(dex: number, onProgress?: CardListOptions['onProgress']): Promise<CardListResult> {
  const track = { partial: false };
  const soft = softly(track);
  const speciesEn = getSpecies(dex)?.name;
  const [rows, raw, sets, digital] = await Promise.all([
    speciesEn ? jaSpeciesRows(speciesEn, soft) : Promise.resolve([] as CatalogRow[]),
    soft(rawCardsFor(dex, 'ja', soft), [] as RawCard[]),
    soft(setsFor('ja'), [] as SetBrief[]),
    soft(digitalSets(), [] as string[]),
  ]);
  // Enquanto liga a reserva da TCGdex japonesa aos produtos (não há versões com selo a buscar no japonês).
  if (onProgress && rows.length) onProgress(withCatalog([], rows, 'ja', JA_CATALOG).sort(byNewest), 'mais cartas');
  const reserve = jaTcgdexBriefs(
    raw.filter((c) => !digital.includes(setIdOf(c))),
    sets,
  );
  const matched = await matchJapanese(reserve, sets, () => dex, soft);
  const links = await tcgplayerLinks(reserve, matched, sets, () => rows, soft);
  return { cards: withJapanese(rows, reserve, matched, sets, () => rows, links), partial: track.partial };
}

/**
 * Produtos da 85 de um Pokémon pelo nome em inglês, também com as palavras juntas, como o catálogo escreve algumas
 * ("NidoranM" = "Nidoran♂", "MrMime" = "Mr. Mime"), sem os de um nome mais longo ("Porygon" não pega "Porygon-Z").
 */
async function jaSpeciesRows(speciesEn: string, soft: Soft, signal?: AbortSignal): Promise<CatalogRow[]> {
  const plain = plainName(speciesEn);
  const glued = plain.replace(/ /g, '');
  const opts = signal ? { signal } : undefined;
  const [spaced, joined] = await Promise.all([
    soft(catalogByName(speciesEn, JAPANESE, opts), [] as CatalogRow[]),
    glued !== plain ? soft(catalogByName(glued, JAPANESE, opts), [] as CatalogRow[]) : Promise.resolve([] as CatalogRow[]),
  ]);
  const longer = longerSpecies(speciesEn);
  const seen = new Set<number>();
  return [...spaced, ...joined].filter((r) => {
    if (seen.has(r.product_id)) return false;
    seen.add(r.product_id);
    return nameHasSpecies(r.name, speciesEn) && !longer.some((n) => nameHasSpecies(r.name, n));
  });
}

/** Cartas antigas sem número impresso: as da reserva até esta data (Expansion Pack, neo, VS, web…). */
const NUMBERLESS_UNTIL = dateOrder('2001-12-01');
/** Fichas da reserva lidas numa lista para achar o produto delas (ver tcgplayerLinks). */
const LINKS_MAX = 40;

/** Produtos da TCGplayer que a TCGdex liga às impressões da carta, o da impressão sem subtipo nem selo primeiro. */
function tcgplayerIdsOf(d: CardDetail | null | undefined): number[] {
  const printings = d?.variants_detailed ?? [];
  const plain = (p: (typeof printings)[number]) => !p.subtype && !p.stamp?.length && !p.foil;
  const ids = [...printings.filter(plain), ...printings.filter((p) => !plain(p))].map((p) => p.thirdParty?.tcgplayer);
  return [...new Set(ids.filter((id): id is number => Number.isInteger(id) && id! > 0))];
}

/**
 * Carta antiga da reserva sem par provável (o produto da 85 não tem número impresso e o grupo, sigla: ex.: PMCG1-021
 * リザードン e o produto 575604 do Expansion Pack): o produto vem da ficha dela na TCGdex japonesa, que liga cada impressão
 * ao produto da TCGplayer (`thirdParty.tcgplayer`). Só quando o Pokémon tem produto sem número; no máximo LINKS_MAX
 * fichas, 8 ao mesmo tempo. Ficha que não veio: a carta fica como está (e a lista, incompleta).
 */
async function tcgplayerLinks(
  reserve: CardBrief[],
  matched: Map<string, CatalogRow>,
  sets: SetBrief[],
  pool: (c: CardBrief) => CatalogRow[],
  soft: Soft,
): Promise<Map<string, number[]>> {
  const totals = setTotals(sets);
  const todo = reserve
    .filter((c) => {
      if (matched.has(c.id) || c.setOrder <= 0 || c.setOrder >= NUMBERLESS_UNTIL) return false;
      const rows = pool(c);
      return rows.some((r) => !r.number) && !probablePairs(c, totals.get(c.setId), rows).length;
    })
    .slice(0, LINKS_MAX);
  const details = await mapPool(todo, 8, (c) => soft(cardDetail(c.id, 'ja'), null));
  const out = new Map<string, number[]>();
  todo.forEach((c, i) => {
    const ids = tcgplayerIdsOf(details[i]);
    if (ids.length && pool(c).some((r) => ids.includes(r.product_id))) out.set(c.id, ids);
  });
  return out;
}

/**
 * Todas as cartas de um Pokémon (número da Pokédex nacional) num idioma, da coleção mais nova para a mais antiga, com a
 * situação das fontes. As buscas independentes correm juntas; a lista base vai para `onProgress` antes das versões
 * com selo. Lista completa: guardada por 1 dia; incompleta: por 5 minutos.
 */
export async function cardsForDexResult(dex: number, lang: CardLang, opts: CardListOptions = {}): Promise<CardListResult> {
  // v14: a lista japonesa passou a vir da TCGplayer japonesa (85), com a TCGdex japonesa de reserva; v15: o produto
  // com par provável na reserva guarda o id dela (tcgdexId); v16: carta só com selo numa célula só, coleção só do catálogo
  // pela data, Nidoran do catálogo com as palavras juntas e a carta antiga sem número ligada pela TCGdex.
  const key = `tcgdex:dex:v16:${lang}:${dex}`;
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

async function loadDexCards(dex: number, lang: CardLang, onProgress?: CardListOptions['onProgress']): Promise<CardListResult> {
  if (lang === 'ja') return loadJaDexCards(dex, onProgress);
  const track = { partial: false };
  const soft = softly(track);
  const speciesEn = getSpecies(dex)?.name;
  // Tudo que não depende de outra resposta, junto: cartas no idioma e em inglês, coleções, Zukan e catálogo.
  const [raw, sets, enSets, digital, enRaw, zukan, nameRows] = await Promise.all([
    rawCardsFor(dex, lang, soft),
    setsFor(lang),
    setsFor('en'),
    soft(digitalSets(), [] as string[]),
    lang === 'pt' ? soft(rawCardsFor(dex, 'en', soft), [] as RawCard[]) : Promise.resolve([] as RawCard[]),
    soft(zukanCardsFor(dex, lang), [] as ZukanBrief[]),
    speciesEn ? soft(catalogByName(speciesEn), [] as CatalogRow[]) : Promise.resolve([] as CatalogRow[]),
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
  list.push(...zukanBriefs(zukan, list, lang, digital, { names, enNames, order }));

  // Catálogo pelo nome do Pokémon (base principal), sem "Porygon" pegar "Porygon-Z".
  const longer = speciesEn ? longerSpecies(speciesEn) : [];
  const byName = speciesEn ? nameRows.filter((r) => nameMatches(r.name, speciesEn, 'en', longer)) : [];
  // Lista base para a tela: só com as cartas do catálogo já ligadas (as sem ligação podem ser do Zukan, ver withCatalog).
  if (onProgress) onProgress([...withCatalog(list, byName.filter((r) => r.tcgdex_id), lang, { species: speciesEn })].sort(byNewest), 'versões com selo');

  // Versões com selo da TCGdex e as cartas do catálogo ligadas às da lista, juntas.
  const [stamped, byId] = await Promise.all([
    stampedVersions(list, Infinity, () => {
      track.partial = true;
    }),
    speciesEn ? soft(catalogByTcgdexIds(list.map((c) => c.id)), [] as CatalogRow[]) : Promise.resolve([] as CatalogRow[]),
  ]);
  list.push(...stamped.cards);
  if (!speciesEn) return { cards: withoutPlain(list, stamped.only).sort(byNewest), partial: track.partial };
  const rows = [...byName, ...byId];
  const groupSets = await groupSetsFor(rows, soft);
  return {
    cards: withCatalog(list, rows, lang, { species: speciesEn, groupSets, stampOnly: stamped.only }).sort(byNewest),
    partial: track.partial,
  };
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
  // Coleção sem ordem conhecida (-1, ex.: japonesa sem data de lançamento) fica no fim também nas mais antigas.
  const unknownLast = (a: CardBrief, b: CardBrief) => Number(a.setOrder === -1) - Number(b.setOrder === -1);
  const cmp =
    order === 'oldest'
      ? (a: CardBrief, b: CardBrief) => unknownLast(a, b) || a.setOrder - b.setOrder || num(a, b) || stampLast(a, b)
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
  // Japonês com letras latinas ("Pikachu") é buscado como o inglês, pelo nome no catálogo 85.
  const plain = lang === 'ja' && isJapaneseText(name) ? name.trim() : plainName(name);
  if (plain.length < 2) return { cards: [], partial: false };
  // A chave leva também as buscas que vão para a TCGdex, que só acha a grafia exata: "mr mime" (0 cartas) e "Mr. Mime"
  // (40) têm o mesmo nome sem pontuação, mas não podem dividir a mesma lista guardada. v8: japonês pela TCGplayer (85);
  // v9: a reserva com par provável vira o produto; v10: carta só com selo numa célula só, e a reserva sem outro Pokémon.
  const key = `tcgdex:search:v10:${lang}:${plain.toLowerCase()}|${tcgdexQueries(name, lang).join('|').toLowerCase()}`;
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
  if (lang === 'ja') return loadJaSearch(name, signal);
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
    return [...all.values()].filter((c) => plainName(c.name).includes(plain));
  };
  // Com 2 letras a busca no catálogo traria milhares de cartas: fica só a da TCGdex.
  const useCatalog = plain.replace(/ /g, '').length >= 3;
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
    stampedVersions(list, 60, () => {
      track.partial = true;
    }),
    groupSetsFor(rows, soft),
  ]);
  list.push(...stamped.cards);
  // Cartas do catálogo ainda sem ligação, de uma coleção conhecida, sem a carta na lista (ex.: Nidorina MEP 101, que a
  // TCGdex ainda não tem): completa com as cartas do Pokémon no Zukan, como no fichário Pokédex, para a carta ficar com
  // o mesmo id da lista do Pokémon (e o "tenho" bater). No máximo SEARCH_ZUKAN_MAX Pokémon.
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
  // Cancelada no meio: a lista pode ter perdido partes por causa do cancelamento, então não é devolvida nem guardada.
  if (signal?.aborted) throw abortError();
  const all = withCatalog(list, rows, lang, { groupSets, stampOnly: stamped.only }).sort(byNewest);
  return {
    cards: all.slice(0, CARD_SEARCH_MAX),
    partial: track.partial,
    truncated: all.length > CARD_SEARCH_MAX || undefined,
  };
}

/** Pokémon cujos produtos da 85 são lidos numa busca em japonês, para os pares prováveis da reserva. */
const SEARCH_PAIR_MAX = 3;

/**
 * Produtos da 85 de cada Pokémon (os de mais cartas primeiro, no máximo SEARCH_PAIR_MAX), pelo nome em inglês, como na
 * lista do Pokémon (ver jaSpeciesRows). Os Pokémon em paralelo.
 */
async function speciesPools(dexes: (number | undefined)[], soft: Soft, signal?: AbortSignal) {
  const count = new Map<number, number>();
  for (const d of dexes) if (d) count.set(d, (count.get(d) ?? 0) + 1);
  const top = [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, SEARCH_PAIR_MAX)
    .map(([d]) => d);
  const out = new Map<number, CatalogRow[]>();
  await Promise.all(
    top.map(async (d) => {
      const name = getSpecies(d)?.name;
      if (name) out.set(d, await jaSpeciesRows(name, soft, signal));
    }),
  );
  return out;
}

/**
 * Busca em japonês. Texto latino ("Pikachu", "Charizard ex"): pelo nome em inglês no catálogo da TCGplayer japonesa
 * (85), como no inglês. Texto em japonês ("ピカチュウ"): pela TCGdex japonesa, e as cartas dela que são um produto da 85
 * (ligação exata ou par provável sem selo, ver withJapanese) viram esse produto (com foto).
 */
async function loadJaSearch(name: string, signal?: AbortSignal): Promise<CardListResult> {
  const track = { partial: false };
  const soft = softly(track, signal);
  let all: CardBrief[];
  if (!isJapaneseText(name)) {
    // Com 2 letras a busca no catálogo traria milhares de cartas (a tela pede 3: ver canSearchName).
    const rows = canSearchName(name, 'ja') ? await catalogByName(name, JAPANESE, { max: SEARCH_CATALOG_MAX, signal }) : [];
    if (signal?.aborted) throw abortError();
    all = withCatalog([], rows, 'ja', JA_CATALOG).sort(byNewest);
  } else {
    const [raw, sets, digital] = await Promise.all([
      getJson<RawCard[]>(`${API}/ja/cards?name=like:${encodeURIComponent(name.trim())}`, signal),
      soft(setsFor('ja'), [] as SetBrief[]),
      soft(digitalSets(), [] as string[]),
    ]);
    const reserve = jaTcgdexBriefs(
      raw.filter((c) => !digital.includes(setIdOf(c))),
      sets,
    );
    const dexOf = new Map(reserve.map((c) => [c.id, speciesOfJaName(c.name)]));
    const matched = await matchJapanese(reserve, sets, (c) => dexOf.get(c.id), soft, signal);
    // Produtos da 85 dos Pokémon das cartas que a ligação exata não achou: para trocar a carta da reserva pelo par
    // provável dela (ver withJapanese).
    const pools = await speciesPools(
      reserve.filter((c) => !matched.has(c.id) && normNumber(c.localId)).map((c) => dexOf.get(c.id)),
      soft,
      signal,
    );
    const poolOf = (c: CardBrief) => pools.get(dexOf.get(c.id) ?? 0) ?? [];
    const links = await tcgplayerLinks(reserve, matched, sets, poolOf, soft);
    if (signal?.aborted) throw abortError();
    all = withJapanese([], reserve, matched, sets, poolOf, links);
  }
  return { cards: all.slice(0, CARD_SEARCH_MAX), partial: track.partial, truncated: all.length > CARD_SEARCH_MAX || undefined };
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
 * carta, em inglês (quem mostra reduz para o tamanho do fichário com catalogImage). Só da categoria pedida: os ids da
 * TCGdex japonesa repetem os ingleses (a 3 mantém a chave antiga do cache).
 */
export function catalogPhoto(cardId: string, category = ENGLISH) {
  return cached(
    category === ENGLISH ? `tcgdex:catalog-photo:v1:${cardId}` : `tcgdex:catalog-photo:v1:c${category}:${cardId}`,
    async () => {
      if (cardId.startsWith('tcgp-')) return null;
      const rows = await catalogByTcgdexIds([cardId], category);
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
  const body = await timedFetch(
    ZUKAN_MCP,
    (res) => {
      if (!res.ok) throw new Error(`Zukan ${res.status}`);
      return res.json();
    },
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
    },
  );
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

/**
 * Imagem no Zukan de uma carta só do catálogo ("tcgp-<produto>") de uma coleção que a TCGdex ainda não tem e cuja foto a
 * TCGplayer ainda não publicou (ex.: "ME06: Delta Reign" na semana do lançamento). O id do Zukan (o mesmo da TCGdex) sai
 * do prefixo da coleção do TCGCSV e do número ("ME06: Delta Reign" 003/103 → "me06-003"), conferido pelo nome: em
 * português e, se for outro (treinadores, energias), em inglês. Sem a carta, null guardado por 1 dia (o Zukan pode
 * publicar depois); com ela, guardada por 7 dias.
 */
export function zukanCatalogImage(cardId: string) {
  return cached(
    `zukan:catalog-image:v1:${cardId}`,
    async () => {
      const productId = Number(cardId.slice(5));
      if (!cardId.startsWith('tcgp-') || !productId) return null;
      const row = await catalogProduct(productId);
      const set = /^([a-z]{1,4}\d{1,3}(?:\.\d)?):/i.exec(row?.tcg_groups?.name ?? '')?.[1]?.toLowerCase();
      const localId = catalogNumber(row?.number);
      if (!row || !set || !localId) return null;
      const id = `${set}-${localId}`;
      const same = (name?: string) => !!name && plainName(name) === plainName(row.name);
      const pt = await zukan<{ name?: string; image?: string }>('get_card', { id, lang: 'pt' });
      if (!pt?.image) return null;
      if (!same(pt.name) && !same((await zukan<{ name?: string }>('get_card', { id, lang: 'en' }))?.name)) return null;
      return { small: pt.image, large: pt.image };
    },
    CACHE_TTL,
    { ttlFor: (img) => (img ? CACHE_TTL : LIST_TTL) },
  );
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
