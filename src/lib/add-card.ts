// Fluxo "+ Carta" (H2): achar a carta pelo código impresso, sugerir o bolso e montar a carta para salvar sem abrir o
// formulário inteiro. Usado só pelas telas de escolher carta (search.tsx e pokemon/[dex].tsx).

import { formatDex, getSpecies, speciesInCardName } from '@/data/pokedex';
import { customEntryId, entryId } from '@/store/collection';

import { customTotalSlots, extraSlots, indexOfDex, indexOfExtra, inDexRange, physicalPosition } from './binder';
import { catalogNumber, categoryOf, ENGLISH, JAPANESE, stampVariant } from './catalog';
import { timedFetch } from './fetch-timeout';
import { supabase } from './supabase';
import {
  cached,
  cardDetail,
  catalogPublishedOn,
  dateOrder,
  japaneseSeries,
  matchesNumber,
  searchCardsResult,
  type CardBrief,
  type CardDetail,
  type CardListResult,
} from './tcgdex';
import { catalogOnlyVariant } from './tcgplayer';
import { VARIANTS, type BinderSettings, type CardLang, type Condition, type CustomBinder, type Entry, type Variant } from './types';
import { availableVariants, cardVersions, sameStamp, sameVersion, versionOptions, type VersionOption } from './variants';

const API = 'https://api.tcgdex.net/v2';
const DAY = 1000 * 60 * 60 * 24;
const WEEK = DAY * 7;

// ---------- Código da carta ----------

/** Código lido da carta: id da TCGdex ("swsh12-186") ou sigla da coleção e número ("MEG 133"). */
export type CardCode = { kind: 'id'; set: string; number: string } | { kind: 'set'; abbr: string; number: string };

const NUM = '([a-z]{0,4}\\d{1,4}[a-z]?)';
const TOTAL = '(?:\\s*\\/\\s*[a-z]{0,4}\\d{1,4})?';
/** "swsh12-186", "sv03.5-025", "30th-c-011" (sem espaços; o número é o último trecho). */
const ID_RE = new RegExp(`^([a-z0-9.-]+)-${NUM}$`, 'i');
/** "MEG 133", "MEG 133/132", "SWSH12 186", "MEG: 133". */
const ABBR_FIRST = new RegExp(`^([a-z0-9]{2,8})[\\s:]+#?${NUM}${TOTAL}$`, 'i');
/** "MEG133" (sigla só de letras, colada no número). */
const ABBR_GLUED = new RegExp(`^([a-z]{2,6})(\\d{1,4}[a-z]?)${TOTAL}$`, 'i');
/** "133/132 MEG", "133 MEG". */
const NUMBER_FIRST = new RegExp(`^#?${NUM}${TOTAL}\\s+([a-z0-9]{2,8})$`, 'i');

/**
 * Lê o código impresso no canto da carta: "MEG 133", "133/132 MEG", "MEG133", "SVI 25" ou o id da TCGdex
 * ("swsh12-186"). null se não parecer um código.
 */
export function parseCardCode(text: string): CardCode | null {
  const q = text.trim().replace(/\s+/g, ' ');
  if (!q) return null;
  const hasLetter = (s: string) => /[a-z]/i.test(s);
  let m = !q.includes(' ') ? ID_RE.exec(q) : null;
  if (m && hasLetter(m[1])) return { kind: 'id', set: m[1], number: m[2] };
  m = ABBR_FIRST.exec(q) ?? ABBR_GLUED.exec(q);
  if (m && hasLetter(m[1])) return { kind: 'set', abbr: m[1].toUpperCase(), number: m[2] };
  m = NUMBER_FIRST.exec(q);
  if (m && hasLetter(m[2])) return { kind: 'set', abbr: m[2].toUpperCase(), number: m[1] };
  return null;
}

type SetListing = {
  id: string;
  name: string;
  cards?: { id: string; localId: string; name: string; image?: string }[];
};

/** JSON da TCGdex, com tempo máximo até o fim da leitura; 404 vira null (coleção ou carta que não existe naquele idioma). */
function getJson<T>(url: string): Promise<T | null> {
  return timedFetch<T | null>(url, (res) => {
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TCGdex ${res.status}`);
    return res.json() as Promise<T>;
  });
}

/** Coleções da TCGdex com esta sigla oficial ("MEG" → me01, "SIT" → swsh12, "MEW" → sv03.5). */
function setsByAbbr(abbr: string) {
  return cached(
    `tcgdex:code-abbr:v1:${abbr}`,
    async () => ((await getJson<{ id: string }[]>(`${API}/en/sets?abbreviation.official=eq:${encodeURIComponent(abbr)}`)) ?? []).map((s) => s.id),
    WEEK,
    { ttlFor: (ids) => (ids.length ? WEEK : DAY) },
  );
}

/** Cartas de uma coleção da TCGdex num idioma (null = a coleção não existe nele). */
function setListing(setId: string, lang: CardLang) {
  return cached(`tcgdex:code-set:v1:${lang}:${setId}`, () => getJson<SetListing>(`${API}/${lang}/sets/${encodeURIComponent(setId)}`), DAY);
}

function briefOf(c: { id: string; localId: string; name: string; image?: string }, set: { id: string; name: string }, lang: CardLang, dataLang?: CardLang): CardBrief {
  return { id: c.id, localId: c.localId, name: c.name, image: c.image, lang, dataLang, setId: set.id, setName: set.name, setNameEn: set.name, setOrder: 0 };
}

/** Cartas com este número numa coleção da TCGdex; em português, sem a coleção ou a carta, a ficha em inglês. */
async function fromSet(setId: string, number: string, lang: CardLang): Promise<CardBrief[]> {
  const own = await setListing(setId, lang);
  const hits = (own?.cards ?? []).filter((c) => matchesNumber(c.localId, number));
  if (own && hits.length) return hits.map((c) => briefOf(c, own, lang));
  if (lang !== 'pt') return [];
  const en = await setListing(setId, 'en');
  return en ? (en.cards ?? []).filter((c) => matchesNumber(c.localId, number)).map((c) => briefOf(c, en, lang, 'en')) : [];
}

type CodeRow = {
  product_id: number;
  group_id: number;
  name: string;
  number: string | null;
  image: string;
  stamp: string | null;
  tcgdex_id: string | null;
  group: string;
  /** Data de lançamento da coleção (ordem e série das cartas japonesas). */
  published?: string | null;
};

/**
 * Cartas das coleções do catálogo (TCGCSV) com esta sigla ("SWSH12", "MEP", "PFL"; na japonesa, 85: "M5", "SV2a"),
 * guardadas por 1 dia. A sigla não diferencia maiúsculas.
 */
export function catalogRowsByAbbr(abbr: string, category = ENGLISH) {
  return cached(
    `tcgdex:code-cat:v2:${category}:${abbr.toLowerCase()}`,
    async () => {
      const client = supabase;
      if (!client) return [] as CodeRow[];
      const like = abbr.replace(/[%_\\]/g, (c) => `\\${c}`);
      const groups = await client.from('tcg_groups').select('group_id, name, published_on').eq('category', category).ilike('abbr', like);
      if (groups.error) throw groups.error;
      const names = new Map((groups.data ?? []).map((g) => [g.group_id as number, g.name as string]));
      const dates = new Map((groups.data ?? []).map((g) => [g.group_id as number, (g.published_on as string | null) ?? null]));
      if (!names.size) return [] as CodeRow[];
      const { data, error } = await client
        .from('tcg_catalog')
        .select('product_id, group_id, name, number, image, stamp, tcgdex_id')
        .in('group_id', [...names.keys()])
        .not('number', 'is', null)
        .order('product_id')
        .limit(1000);
      if (error) throw error;
      return ((data ?? []) as Omit<CodeRow, 'group'>[]).map((r) => ({ ...r, group: names.get(r.group_id) ?? '', published: dates.get(r.group_id) ?? null }));
    },
    DAY,
  );
}

/** Ficha da carta no idioma pedido; em português, sem ela, a em inglês. */
async function detailFor(id: string, lang: CardLang): Promise<{ d: CardDetail; dataLang?: CardLang } | null> {
  const own = await cardDetail(id, lang).catch(() => null);
  if (own) return { d: own };
  if (lang !== 'pt') return null;
  const en = await cardDetail(id, 'en').catch(() => null);
  return en ? { d: en, dataLang: 'en' } : null;
}

/**
 * Pelo catálogo do TCGCSV (siglas da TCGplayer, ex.: "SWSH12 186", e promos que a TCGdex não tem). Carta japonesa: só a
 * TCGplayer japonesa (85), cada produto como carta "tcgp-" com a foto dele (Mirror = reverse, Poké Ball…).
 */
async function fromCatalog(abbr: string, number: string, lang: CardLang): Promise<CardBrief[]> {
  const category = categoryOf(lang);
  const rows = (await catalogRowsByAbbr(abbr, category)).filter((r) => matchesNumber(catalogNumber(r.number), number));
  if (category === JAPANESE) return rows.map(japaneseBrief);
  const out: CardBrief[] = [];
  const seen = new Set<string>();
  // Cartas ligadas à TCGdex: os dados de lá (nome e imagem em português); as versões com selo aparecem na escolha da
  // versão. As sem ligação: a ficha do catálogo, com a foto da TCGplayer.
  for (const r of rows) {
    if (r.tcgdex_id) {
      if (seen.has(r.tcgdex_id)) continue;
      seen.add(r.tcgdex_id);
      const found = await detailFor(r.tcgdex_id, lang);
      if (found) {
        const { d, dataLang } = found;
        // Foto da versão comum (sem selo), para a carta sem imagem na TCGdex.
        const photo = rows.find((x) => x.tcgdex_id === r.tcgdex_id && !x.stamp)?.image;
        out.push({ ...briefOf(d, d.set, lang, dataLang), imageUrl: d.image ? undefined : photo });
        continue;
      }
    }
    // Sem ligação: a busca pelo nome junta o catálogo com o Zukan (ex.: promos MEP novas) e reconhece a mesma carta pela
    // foto do catálogo; assim ela fica com o mesmo id da lista do Pokémon (e o "tenho" e as repetidas batem).
    const named = await searchCardsResult(`${r.name} ${number}`, lang).catch(() => null);
    const twin = named?.cards.find((c) => c.imageUrl === r.image && !!c.stamp === !!r.stamp);
    if (twin) {
      if (!out.some((c) => c.id === twin.id && c.stamp?.label === twin.stamp?.label)) out.push(twin);
      continue;
    }
    const id = r.tcgdex_id ?? `tcgp-${r.product_id}`;
    const base: CardBrief = {
      id,
      localId: catalogNumber(r.number),
      name: r.name,
      lang,
      dataLang: lang === 'en' ? undefined : 'en',
      setId: `tcgp${r.group_id}`,
      setName: r.group,
      setNameEn: r.group,
      setOrder: 0,
      imageUrl: r.image,
    };
    out.push(r.stamp ? { ...base, stamp: { variant: stampVariant(r.stamp), label: r.stamp, keys: [] } } : base);
  }
  return out;
}

/**
 * Produto da TCGplayer japonesa como carta da lista: dados e foto da própria carta japonesa (sem "só em inglês"); a
 * versão com selo como carta à parte ("Mirror Holofoil" = reverse, "Poke Ball Pattern" = Poké Ball…).
 */
function japaneseBrief(r: CodeRow): CardBrief {
  // Com a data corrigida das coleções que o TCGCSV data errado (ex.: Japanese CD Promo, de 1998, como 2025).
  const published = catalogPublishedOn(r.group_id, r.published);
  const base: CardBrief = {
    id: `tcgp-${r.product_id}`,
    localId: catalogNumber(r.number),
    name: r.name,
    lang: 'ja',
    setId: `tcgp${r.group_id}`,
    setName: r.group,
    setNameEn: r.group,
    setOrder: dateOrder(published),
    series: japaneseSeries(published),
    imageUrl: r.image,
  };
  return r.stamp ? { ...base, stamp: { variant: stampVariant(r.stamp, JAPANESE), label: r.stamp, keys: [] } } : base;
}

/**
 * Carta japonesa pelo código: sigla da coleção na TCGplayer japonesa e número ("M5 088", "M5 088/081", "M5-088",
 * "SV2a 025"), com foto; sem nenhuma, a reserva da TCGdex japonesa pelo id da coleção (sem foto, nome em japonês).
 */
async function japaneseByCode(code: CardCode): Promise<CardListResult> {
  const set = code.kind === 'id' ? code.set : code.abbr;
  let partial = false;
  const failed = () => {
    partial = true;
    return [] as CardBrief[];
  };
  const cards = await fromCatalog(set, code.number, 'ja').catch(failed);
  if (cards.length) return { cards, partial };
  return { cards: await fromSet(set, code.number, 'ja').catch(failed), partial };
}

/**
 * Cartas pelo código (ver parseCardCode): primeiro pela TCGdex (sigla oficial ou id da coleção), depois pelo catálogo.
 * Carta japonesa: primeiro a TCGplayer japonesa pela sigla (com foto), depois a TCGdex japonesa (ver japaneseByCode).
 */
export async function cardsByCode(code: CardCode, lang: CardLang): Promise<CardListResult> {
  if (lang === 'ja') return japaneseByCode(code);
  if (code.kind === 'id') {
    const cards = await fromSet(code.set.toLowerCase(), code.number, lang);
    if (cards.length) return { cards, partial: false };
    return cardsByCode({ kind: 'set', abbr: code.set.toUpperCase(), number: code.number }, lang);
  }
  const sets = await setsByAbbr(code.abbr).catch(() => [] as string[]);
  // Sem a sigla na TCGdex, a sigla pode ser o próprio id da coleção ("sv01 25", "swsh12 186").
  const ids = sets.length ? sets : [code.abbr.toLowerCase()];
  const lists = await Promise.all(ids.map((s) => fromSet(s, code.number, lang).catch(() => [] as CardBrief[])));
  const cards = lists.flat();
  if (cards.length) return { cards, partial: false };
  try {
    return { cards: await fromCatalog(code.abbr, code.number, lang), partial: false };
  } catch {
    return { cards: [], partial: true };
  }
}

// ---------- Idioma escolhido (lote de cartas) ----------

/** Último idioma tocado na escolha de carta, nesta sessão (em memória: ao abrir o app, volta ao padrão). */
let sessionLang: CardLang | undefined;

/**
 * Idioma inicial da escolha de carta: o último escolhido nesta sessão (para um lote de japonesas não voltar a PT a cada
 * Pokémon), se for um dos permitidos; senão, o padrão da tela.
 */
export function initialCardLang(fallback: CardLang, allowed?: readonly CardLang[]): CardLang {
  return sessionLang && (!allowed || allowed.includes(sessionLang)) ? sessionLang : fallback;
}

/** Guarda o idioma tocado pela pessoa (no bolso do Pokédex e no "+ Carta"). */
export function rememberCardLang(lang: CardLang) {
  sessionLang = lang;
}

/**
 * Idioma inicial da busca de carta (search.tsx): no bolso de um fichário livre, o idioma configurado nele (`pocketLang`)
 * vale primeiro; no "+ Carta" e sem idioma no fichário, o último escolhido nesta sessão, e depois o do fichário
 * preferido (`preferredLang`) ou o padrão.
 */
export function searchStartLang(o: { pocketLang?: CardLang; preferredLang?: CardLang; fallback: CardLang }): CardLang {
  return o.pocketLang ?? initialCardLang(o.preferredLang ?? o.fallback);
}

// ---------- A mesma carta japonesa com dois ids ----------

/** Versões que a 85 vende como produto à parte (o preço delas vem do produto com selo, não do comum). */
const JA_STAMPED: string[] = ['reverse', 'pokeball', 'masterball'];

/**
 * Produto comum da TCGplayer japonesa ("tcgp-<id>") que é esta carta da TCGdex japonesa salva (ex.: M5-088 →
 * "tcgp-695039"), pelo preço ligado a ela (lib/ja-catalog.ts). Só com o preço da carta atual e do produto sem selo (o
 * de uma versão reverse, Poké Ball ou Master Ball é o produto do selo, salvo o "≈ aproximado" da comum).
 */
export function japaneseProductOf(e: Pick<Entry, 'cardId' | 'lang' | 'tcgplayer'>): string | undefined {
  const p = e.tcgplayer;
  if (e.lang !== 'ja' || e.cardId.startsWith('tcgp-') || !p?.productId || p.cardId !== e.cardId) return undefined;
  if (JA_STAMPED.includes(p.variant) && !p.base) return undefined;
  return `tcgp-${p.productId}`;
}

/** Cartas da TCGdex japonesa salvas, por produto comum da TCGplayer japonesa (ver japaneseProductOf). */
export function japaneseAliases(entries: Iterable<Entry>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of entries) {
    const product = japaneseProductOf(e);
    if (!product) continue;
    const ids = out.get(product) ?? [];
    if (!ids.includes(e.cardId)) out.set(product, [...ids, e.cardId]);
  }
  return out;
}

/** Carta da lista (ou da tela da carta) comparada com as cópias salvas. */
export type SameCardRef = Pick<CardBrief, 'id' | 'lang' | 'tcgdexId'> & {
  stamp?: unknown;
  /** Carta da TCGdex japonesa: o produto comum dela (japaneseProductOf da carta salva), para achar as "tcgp-". */
  product?: string;
};

/**
 * Outros ids com que esta carta da lista pode estar salva: no produto comum da TCGplayer japonesa, a carta da TCGdex
 * japonesa que é ele (ex.: tcgp-695039 = M5-088), pelo id que a lista ligou (`tcgdexId`) ou pelo preço da carta salva
 * (`aliases`, de japaneseAliases). Nas outras cartas, nenhum.
 */
export function savedAliasIds(card: SameCardRef, aliases: Map<string, string[]>): string[] {
  if (card.lang !== 'ja' || card.stamp || !card.id.startsWith('tcgp-')) return [];
  return [...new Set([card.tcgdexId, ...(aliases.get(card.id) ?? [])])].filter((id): id is string => !!id && id !== card.id);
}

/**
 * A cópia salva é esta carta? Mesmo id e idioma; na japonesa sem selo, também a mesma carta salva com o outro id (o
 * produto da TCGplayer japonesa e a carta da TCGdex japonesa que é ele: ver savedAliasIds e `product`).
 */
export function isCopyOf(e: Pick<Entry, 'cardId' | 'lang' | 'tcgplayer'>, card: SameCardRef): boolean {
  if (e.lang !== card.lang) return false;
  if (e.cardId === card.id) return true;
  if (card.lang !== 'ja' || card.stamp) return false;
  if (!card.id.startsWith('tcgp-')) return !!card.product && (e.cardId === card.product || japaneseProductOf(e) === card.product);
  return e.cardId === card.tcgdexId || japaneseProductOf(e) === card.id;
}

/**
 * Parâmetros da tela da carta para a carta tocada na lista, no bolso que tem `pocket`: quando a carta do bolso é esta
 * mesma salva com outro id (ex.: o produto tcgp-695039 e a M5-088 salva; ver isCopyOf), abre com o id salvo. Assim a
 * tela mostra a carta do bolso ("Esta carta já está neste bolso"), sem "Substituir" e sem mudar a chave da carta.
 */
export function pickParams(card: CardBrief, pocket?: Entry) {
  const params = cardParams(card);
  return pocket && pocket.cardId !== card.id && isCopyOf(pocket, card) ? { ...params, cardId: pocket.cardId } : params;
}

// ---------- Ficha e versões para o "Adicionar" ----------

export type CardFacts = {
  detail: CardDetail | null;
  /** Ficha em inglês (descreve as impressões que existem); a mesma `detail` quando os dados já são em inglês. */
  enDetail: CardDetail | null;
  /** Versões da carta (holo, reverse, selos…), com a escolhida na lista sempre entre elas. */
  versions: VersionOption[];
};

/** Ficha da carta, a em inglês e as versões (TCGdex + catálogo). Sem internet, o que der (a carta salva assim mesmo). */
export async function loadCardFacts(card: CardBrief): Promise<CardFacts> {
  const dataLang = card.dataLang ?? card.lang;
  const [detail, en] = await Promise.all([
    cardDetail(card.id, dataLang).catch(() => null),
    card.lang === 'ja' || dataLang === 'en' ? Promise.resolve(null) : cardDetail(card.id, 'en').catch(() => null),
  ]);
  const enDetail = dataLang === 'en' ? detail : en;
  // Carta japonesa: só as versões da própria ficha (o catálogo do TCGCSV é o das cartas em inglês), como na tela da carta.
  let versions =
    card.lang === 'ja' ? versionOptions(detail, null) : await cardVersions(card.id, detail, enDetail).catch(() => versionOptions(detail, enDetail));
  // Carta japonesa só do catálogo, sem versões na ficha: a variação das impressões do produto (holo, 1ª edição), para
  // salvar a impressão que tem preço em vez da normal. Fora dela (TCGdex, selo, sem internet), nada muda.
  if (card.lang === 'ja' && !versions.length) {
    const v = await catalogOnlyVariant(card);
    if (v) versions = [{ variant: v }];
  }
  return { detail, enDetail, versions: withPicked(versions, card) };
}

/** A versão com selo escolhida na lista entra nas opções (com a foto dela), mesmo que a ficha não a liste. */
function withPicked(versions: VersionOption[], card: CardBrief): VersionOption[] {
  const s = card.stamp;
  if (!s) return versions;
  const photo = card.imageUrl;
  const i = versions.findIndex((o) => o.variant === s.variant && o.stamp === s.label);
  if (i >= 0) return versions.map((o, k) => (k === i && !o.photo && photo ? { ...o, photo } : o));
  return [...versions, { variant: s.variant, stamp: s.label, stampKeys: s.keys.length ? s.keys : undefined, photo, fromCatalog: !s.keys.length }];
}

export const versionKey = (o: Pick<VersionOption, 'variant' | 'stamp'>) => `${o.variant}|${o.stamp ?? ''}`;

/**
 * Versão já marcada: a com selo escolhida na lista, a vista na Consulta (`card.version`, quando está entre as sem selo)
 * ou a comum (primeira sem selo).
 */
export function defaultVersion(versions: VersionOption[], card: CardBrief) {
  const s = card.stamp;
  if (s) return versions.find((o) => o.variant === s.variant && o.stamp === s.label) ?? null;
  if (card.version) {
    const seen = versions.find((o) => !o.stamp && o.variant === card.version);
    if (seen) return seen;
  }
  return versions.find((o) => !o.stamp) ?? versions[0] ?? null;
}

/** Nome da versão no botão: o selo ("Pokémon Center") ou a variação ("Reverse Foil"). */
export function versionLabel(o: Pick<VersionOption, 'variant' | 'stamp'>) {
  return o.stamp ?? VARIANTS.find((v) => v.id === o.variant)?.label ?? o.variant;
}

/** Pokémon da carta (para o espaço dele no fichário Pokédex); treinador e energia não têm. */
export function speciesOfCard(card: CardBrief, detail?: CardDetail | null): number | undefined {
  if (detail?.dexId?.length) return detail.dexId[0];
  if (detail?.category && /trainer|treinador|energ/i.test(detail.category)) return undefined;
  return speciesInCardName(detail?.name ?? card.name)?.id;
}

// ---------- Onde colocar ----------

export type Destination = {
  key: string;
  /** dex: espaço do Pokémon no fichário Pokédex; binder: fichário livre; extra: bolso livre do Pokédex; replace: troca. */
  kind: 'dex' | 'binder' | 'extra' | 'replace';
  binderId?: string;
  dex: number;
  slot: number;
  /** "#025 Pikachu", "Trocas", "Bolso livre", "Substituir Pikachu V". */
  title: string;
  /** "Fichário Pokédex · pág. 2, bolso 5". */
  detail: string;
  /** "pág. 2, bolso 5". */
  where: string;
  /** Carta que sai do bolso (Substituir), para o Desfazer. */
  replaces?: Entry;
};

const whereText = (p: { page: number; pocket: number }) => `pág. ${p.page}, bolso ${p.pocket}`;

/**
 * Bolsos sugeridos para a carta, o melhor primeiro: o fichário livre aberto na tela inicial (se tiver espaço), o espaço
 * vazio do Pokémon no fichário Pokédex, o 1º bolso vazio de cada fichário livre, o bolso livre do Pokédex e, com o
 * espaço do Pokémon ocupado, substituir a carta que está lá.
 */
export function destinationsFor(o: {
  dex?: number;
  settings: BinderSettings | null;
  binders: CustomBinder[];
  entries: Record<string, Entry>;
  activeBinderId?: string;
}): Destination[] {
  const { settings, binders, entries, dex } = o;
  const pokedexName = settings?.name || 'Fichário Pokédex';

  const custom: Destination[] = [];
  for (const b of binders) {
    const total = customTotalSlots(b);
    let slot = -1;
    for (let i = 0; i < total && slot < 0; i++) if (!entries[customEntryId(b.id, i)]) slot = i;
    if (slot < 0) continue;
    const where = whereText(physicalPosition(b, slot));
    custom.push({ key: `binder:${b.id}`, kind: 'binder', binderId: b.id, dex: 0, slot, title: b.name || 'Fichário sem nome', detail: where, where });
  }

  let own: Destination | undefined;
  let replace: Destination | undefined;
  const species = dex ? getSpecies(dex) : undefined;
  if (settings && dex && species && inDexRange(settings, dex)) {
    const title = `${formatDex(dex)} ${species.name}`;
    let free = -1;
    for (let s = 0; s < settings.slotsPerPokemon && free < 0; s++) if (!entries[entryId(dex, s)]) free = s;
    if (free >= 0) {
      const where = whereText(physicalPosition(settings, indexOfDex(settings, dex, free)));
      own = { key: 'dex', kind: 'dex', dex, slot: free, title, detail: `${pokedexName} · ${where}`, where };
    } else {
      const old = entries[entryId(dex, 0)];
      const where = whereText(physicalPosition(settings, indexOfDex(settings, dex, 0)));
      replace = { key: 'replace', kind: 'replace', dex, slot: 0, title: `Substituir ${old?.cardName || 'a carta'}`, detail: `${title} · ${where}`, where, replaces: old };
    }
  }

  let extra: Destination | undefined;
  if (settings) {
    const n = extraSlots(settings);
    for (let k = 0; k < n && !extra; k++) {
      if (entries[entryId(0, k)]) continue;
      const where = whereText(physicalPosition(settings, indexOfExtra(settings, k)));
      extra = { key: 'extra', kind: 'extra', dex: 0, slot: k, title: 'Bolso livre', detail: `${pokedexName} · ${where}`, where };
    }
  }

  const active = custom.find((d) => d.binderId === o.activeBinderId);
  return [active, own, ...custom.filter((d) => d !== active), extra, replace].filter((d): d is Destination => !!d);
}

/**
 * A carta que o "Substituir" tiraria do bolso (`old`) é a escolhida, na mesma versão? A mesma regra da tela da carta
 * (card.tsx, `pickIsSaved`): a mesma carta (isCopyOf, inclusive a japonesa salva com o outro id), o mesmo selo e, quando
 * a versão foi escolhida (ou a carta da lista é a versão com selo), a mesma variação. `picked` = a versão que a pessoa
 * tocou na folha (null enquanto vale a marcada sozinha). O selo salvo com o nome de uma versão anterior do app ("Logo da
 * coleção (Booster Box)", "Pre Release") é o mesmo da lista (sameVersion): não oferece substituir a carta por ela mesma.
 */
export function alreadyInPocket(
  old: Entry | undefined,
  card: CardBrief,
  picked?: Pick<VersionOption, 'variant' | 'stamp' | 'stampKeys'> | null,
): boolean {
  if (!old || !isCopyOf(old, card)) return false;
  const variant = picked ? picked.variant : card.stamp?.variant;
  const listed = picked ? { stamp: picked.stamp, keys: picked.stampKeys } : { stamp: card.stamp?.label, keys: card.stamp?.keys };
  const inPocket = { variant: old.variant, stamp: old.variantNote, keys: old.stampKeys };
  return variant == null ? sameStamp(listed, inPocket) : sameVersion({ variant, ...listed }, inPocket);
}

/**
 * Bolsos para a carta (destinationsFor), sem o "Substituir" quando a carta do bolso já é ela (ver alreadyInPocket):
 * `here` é esse bolso, para a folha dizer "Esta carta já está neste bolso" em vez de oferecer a troca.
 */
export function placeOptions(
  o: Parameters<typeof destinationsFor>[0] & { card: CardBrief; picked?: Pick<VersionOption, 'variant' | 'stamp' | 'stampKeys'> | null },
): { dests: Destination[]; here?: Destination } {
  const all = destinationsFor(o);
  const here = all.find((d) => d.kind === 'replace' && alreadyInPocket(d.replaces, o.card, o.picked));
  return here ? { dests: all.filter((d) => d !== here), here } : { dests: all };
}

/** Parâmetros da tela da carta para este destino (ex.: "Mais detalhes"). */
export function destinationParams(d: Destination) {
  return d.kind === 'binder' ? { binder: d.binderId!, slot: d.slot } : { dex: d.dex, slot: d.slot };
}

/**
 * Aviso depois de colocar (sem concordância de gênero, que depende da carta): "Pikachu em Fichário Pokédex · pág. 2,
 * bolso 5", "Pesquisa do Professor em Trocas · pág. 1, bolso 3", "Pikachu entrou no lugar de Pikachu V".
 */
export function placedText(name: string, d: Destination) {
  const card = name || 'Carta';
  if (d.kind === 'replace') return `${card} entrou no lugar de ${d.replaces?.cardName || 'outra carta'}`;
  if (d.kind === 'binder') return `${card} em ${d.title} · ${d.where}`;
  if (d.kind === 'extra') return `${card} no bolso livre · ${d.where}`;
  return `${card} em ${d.detail}`;
}

/** Parâmetros da tela da carta para uma carta da lista (versão com selo, foto do catálogo, ficha básica). */
export function cardParams(card: CardBrief, version?: VersionOption | null) {
  const v = version ?? (card.stamp ? { variant: card.stamp.variant, stamp: card.stamp.label, photo: card.imageUrl } : null);
  return {
    cardId: card.id,
    lang: card.lang,
    dataLang: card.dataLang ?? card.lang,
    variant: v?.variant,
    stamp: v?.stamp,
    photo: v?.stamp ? v.photo : undefined,
    // Imagem da TCGdex que a lista já tem: sem internet, a carta colocada não fica sem ela (T5).
    image: card.image || undefined,
    // Carta sem imagem da TCGdex: a foto do catálogo, para a tela da carta guardar (C3).
    imageUrl: !card.image && !card.stamp ? card.imageUrl : undefined,
    // Ficha básica da lista: sem internet, a tela da carta ainda consegue colocar a carta (T5).
    name: card.name || undefined,
    setName: card.setName || undefined,
    localId: card.localId || undefined,
    // Produto da TCGplayer japonesa que é uma carta da TCGdex japonesa: para a tela da carta achar as cópias salvas com ela.
    tcgdexId: card.tcgdexId || undefined,
  };
}

/**
 * A carta nova pronta para salvar, com os mesmos campos que a tela da carta grava: dados da ficha (ou da lista, sem
 * internet), a versão e o estado escolhidos e o bolso.
 */
export function buildNewEntry(o: {
  card: CardBrief;
  facts: CardFacts | null;
  version: VersionOption | null;
  condition: Condition;
  dest: Destination;
  /** Sem ficha (`facts` null, lote pela câmera): o que o índice da Consulta já sabe da carta. */
  known?: { rarity?: string; setTotal?: number; variant?: Variant };
}): Omit<Entry, 'id' | 'updatedAt'> {
  const { card, dest } = o;
  const detail = o.facts?.detail ?? null;
  const enDetail = o.facts?.enDetail ?? null;
  const known = o.facts ? undefined : o.known;
  const dataLang = card.dataLang ?? card.lang;
  const variant: Variant =
    o.version?.variant ?? card.stamp?.variant ?? card.version ?? known?.variant ?? availableVariants(detail, enDetail).ids[0] ?? 'normal';
  const note = o.version ? o.version.stamp : card.stamp?.label;
  const stampKeys = (variant === 'wPromo' || variant === 'staff') && o.version?.stampKeys?.length ? o.version.stampKeys : undefined;
  const image = detail?.image ?? enDetail?.image ?? card.image;
  const dex = dest.kind === 'dex' || dest.kind === 'replace' ? dest.dex : dest.kind === 'extra' ? 0 : (speciesOfCard(card, detail) ?? 0);
  return {
    binderId: dest.kind === 'binder' ? dest.binderId : undefined,
    dex,
    slot: dest.slot,
    cardId: card.id,
    lang: card.lang,
    dataLang: dataLang !== card.lang ? dataLang : undefined,
    cardName: detail?.name ?? card.name,
    setName: detail?.set.name ?? card.setName,
    setId: detail?.set.id ?? card.setId,
    localId: detail?.localId ?? card.localId,
    setTotal: detail?.set.cardCount?.official || detail?.set.cardCount?.total || known?.setTotal || undefined,
    rarity: detail?.rarity ?? known?.rarity,
    image,
    imageUrl: image ? undefined : (detail?.imageUrl ?? (card.stamp ? undefined : card.imageUrl)),
    stampPhoto: note ? (o.version?.photo ?? (card.stamp?.label === note ? card.imageUrl : undefined)) : undefined,
    variant,
    variantNote: note?.trim() || undefined,
    stampKeys,
    condition: o.condition,
  };
}
