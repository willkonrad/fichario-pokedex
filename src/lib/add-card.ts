// Fluxo "+ Carta" (H2): achar a carta pelo código impresso, sugerir o bolso e montar a carta para salvar sem abrir o
// formulário inteiro. Usado só pelas telas de escolher carta (search.tsx e pokemon/[dex].tsx).

import { formatDex, getSpecies, speciesInCardName } from '@/data/pokedex';
import { customEntryId, entryId } from '@/store/collection';

import { customTotalSlots, extraSlots, indexOfDex, indexOfExtra, inDexRange, physicalPosition } from './binder';
import { catalogNumber, ENGLISH, stampVariant } from './catalog';
import { supabase } from './supabase';
import { cached, cardDetail, matchesNumber, searchCardsResult, type CardBrief, type CardDetail, type CardListResult } from './tcgdex';
import { VARIANTS, type BinderSettings, type CardLang, type Condition, type CustomBinder, type Entry, type Variant } from './types';
import { availableVariants, cardVersions, versionOptions, type VersionOption } from './variants';

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

/** JSON da TCGdex; 404 vira null (coleção ou carta que não existe naquele idioma). */
async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TCGdex ${res.status}`);
  return (await res.json()) as T;
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

type CodeRow = { product_id: number; group_id: number; name: string; number: string | null; image: string; stamp: string | null; tcgdex_id: string | null; group: string };

/** Cartas das coleções do catálogo (TCGCSV) com esta sigla ("SWSH12", "MEP", "PFL"), guardadas por 1 dia. */
function catalogRowsByAbbr(abbr: string) {
  return cached(
    `tcgdex:code-cat:v1:${abbr}`,
    async () => {
      const client = supabase;
      if (!client) return [] as CodeRow[];
      const like = abbr.replace(/[%_\\]/g, (c) => `\\${c}`);
      const groups = await client.from('tcg_groups').select('group_id, name').eq('category', ENGLISH).ilike('abbr', like);
      if (groups.error) throw groups.error;
      const names = new Map((groups.data ?? []).map((g) => [g.group_id as number, g.name as string]));
      if (!names.size) return [] as CodeRow[];
      const { data, error } = await client
        .from('tcg_catalog')
        .select('product_id, group_id, name, number, image, stamp, tcgdex_id')
        .in('group_id', [...names.keys()])
        .not('number', 'is', null)
        .order('product_id')
        .limit(1000);
      if (error) throw error;
      return ((data ?? []) as Omit<CodeRow, 'group'>[]).map((r) => ({ ...r, group: names.get(r.group_id) ?? '' }));
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

/** Pelo catálogo do TCGCSV (siglas da TCGplayer, ex.: "SWSH12 186", e promos que a TCGdex não tem). */
async function fromCatalog(abbr: string, number: string, lang: CardLang): Promise<CardBrief[]> {
  const rows = (await catalogRowsByAbbr(abbr)).filter((r) => matchesNumber(catalogNumber(r.number), number));
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
 * Cartas pelo código (ver parseCardCode): primeiro pela TCGdex (sigla oficial ou id da coleção), depois pelo catálogo.
 * Carta japonesa só pelo id da TCGdex (as siglas são das coleções em inglês).
 */
export async function cardsByCode(code: CardCode, lang: CardLang): Promise<CardListResult> {
  if (code.kind === 'id') {
    const cards = await fromSet(code.set.toLowerCase(), code.number, lang);
    if (cards.length || lang === 'ja') return { cards, partial: false };
    return cardsByCode({ kind: 'set', abbr: code.set.toUpperCase(), number: code.number }, lang);
  }
  if (lang === 'ja') return { cards: [], partial: false };
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
  const versions =
    card.lang === 'ja' ? versionOptions(detail, null) : await cardVersions(card.id, detail, enDetail).catch(() => versionOptions(detail, enDetail));
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

/** Versão já marcada: a com selo escolhida na lista ou a comum (primeira sem selo). */
export function defaultVersion(versions: VersionOption[], card: CardBrief) {
  const s = card.stamp;
  if (s) return versions.find((o) => o.variant === s.variant && o.stamp === s.label) ?? null;
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
}): Omit<Entry, 'id' | 'updatedAt'> {
  const { card, dest } = o;
  const detail = o.facts?.detail ?? null;
  const enDetail = o.facts?.enDetail ?? null;
  const dataLang = card.dataLang ?? card.lang;
  const variant: Variant = o.version?.variant ?? card.stamp?.variant ?? availableVariants(detail, enDetail).ids[0] ?? 'normal';
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
    setTotal: detail?.set.cardCount?.official || detail?.set.cardCount?.total || undefined,
    rarity: detail?.rarity,
    image,
    imageUrl: image ? undefined : (detail?.imageUrl ?? (card.stamp ? undefined : card.imageUrl)),
    stampPhoto: note ? (o.version?.photo ?? (card.stamp?.label === note ? card.imageUrl : undefined)) : undefined,
    variant,
    variantNote: note?.trim() || undefined,
    stampKeys,
    condition: o.condition,
  };
}
