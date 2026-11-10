// Filtros, facetas, grupos por ano e ponte para o resto do app. Funções puras sobre as linhas do índice.

import { catalogNumber, ENGLISH, JAPANESE, plainName, stampVariant, tcgplayerImageUrl } from '@/lib/catalog';
import { allowsLang, numberKey, numberKeys, numberLeft, stampKind } from '@/lib/lookup-format';
import { NO_VALUE, rarityCode } from '@/lib/lookup-query';
import type { LookupCard, LookupFilters, LookupLang, VariantFilter } from '@/lib/lookup-types';
import { catalogPublishedOn, dateOrder, japaneseSeries, type CardBrief } from '@/lib/tcgdex';

const LANGS: LookupLang[] = ['pt', 'en', 'ja', 'ko', 'zh'];
const VARIANT_ORDER: VariantFilter[] = ['holo', 'reverse', 'firstEdition', 'stamp', 'staff', 'pokeball', 'masterball', 'mirror', 'noPrints'];
const HOLO_PRINTS = new Set(['H', 'UH', '1H']);
const FIRST_PRINTS = new Set(['1', '1H']);

const variantsCache = new WeakMap<LookupCard, VariantFilter[]>();

/** Versões que a carta atende: pelas impressões e pelo selo. */
function variantsOf(c: LookupCard): VariantFilter[] {
  const cached = variantsCache.get(c);
  if (cached) return cached;
  const set = new Set<VariantFilter>();
  if (!c.prints.length) set.add('noPrints');
  for (const p of c.prints) {
    if (HOLO_PRINTS.has(p.code)) set.add('holo');
    if (p.code === 'R') set.add('reverse');
    if (FIRST_PRINTS.has(p.code)) set.add('firstEdition');
  }
  const kind = c.stamp ? stampKind(c.stamp) : null;
  if (kind) set.add(kind);
  const out = [...set];
  variantsCache.set(c, out);
  return out;
}

const wordsCache = new WeakMap<LookupCard, string[]>();

function nameWords(c: LookupCard): string[] {
  let words = wordsCache.get(c);
  if (!words) {
    words = plainName([c.name, c.ptName, c.qualifier, c.stamp].filter(Boolean).join(' '))
      .split(' ')
      .filter(Boolean);
    wordsCache.set(c, words);
  }
  return words;
}

/** Termo curto ("ex", "gx", "v") só como palavra inteira; os outros, em qualquer parte. Chinês compara o texto. */
function matchesName(c: LookupCard, term: string): boolean {
  const plain = plainName(term);
  if (!plain) return `${c.name} ${c.ptName ?? ''}`.includes(term);
  return plain.length < 3 ? nameWords(c).includes(plain) : nameWords(c).some((w) => w.includes(plain));
}

function yearsOf(c: LookupCard): (number | 'none')[] {
  if (c.year.kind === 'none') return ['none'];
  if (c.year.kind === 'year') return [c.year.year];
  const out: number[] = [];
  for (let y = c.year.from; y <= c.year.to; y++) out.push(y);
  return out;
}

function matchesYear(c: LookupCard, year: number | 'none'): boolean {
  if (year === 'none') return c.year.kind === 'none';
  if (c.year.kind === 'year') return c.year.year === year;
  return c.year.kind === 'range' && year >= c.year.from && year <= c.year.to;
}

function matchesNumber(c: LookupCard, filter: string): boolean {
  const keys = numberKeys(c);
  if (filter === NO_VALUE) return !keys.length;
  const wanted = numberKey(filter);
  if (!wanted) return false;
  return wanted.includes('/') ? keys.includes(wanted) : keys.some((k) => numberLeft(k) === wanted);
}

const matchesSet = (c: LookupCard, wanted: string) => c.set.key === wanted || c.set.abbr.toLowerCase() === wanted.toLowerCase();
const rarityOf = (c: LookupCard) => rarityCode(c.rarity) ?? NO_VALUE;

type Dim = 'lang' | 'hp' | 'year' | 'number' | 'rarity' | 'variant' | 'set' | 'type' | 'stage' | 'name';

/** Só os filtros ligados, cada um com o seu teste. */
function activeTests(f: LookupFilters): [Dim, (c: LookupCard) => boolean][] {
  const tests: [Dim, (c: LookupCard) => boolean][] = [];
  if (f.lang) tests.push(['lang', (c) => allowsLang(c, f.lang!)]);
  if (f.hp != null) tests.push(['hp', (c) => c.hp === f.hp]);
  if (f.year != null) tests.push(['year', (c) => matchesYear(c, f.year!)]);
  if (f.number != null) tests.push(['number', (c) => matchesNumber(c, f.number!)]);
  if (f.rarity != null) tests.push(['rarity', (c) => rarityOf(c) === f.rarity]);
  if (f.variant) tests.push(['variant', (c) => variantsOf(c).includes(f.variant!)]);
  if (f.setKey != null) tests.push(['set', (c) => matchesSet(c, f.setKey!)]);
  if (f.cardType != null) tests.push(['type', (c) => (c.cardType ?? NO_VALUE) === f.cardType]);
  if (f.stage != null) tests.push(['stage', (c) => (c.stage ?? NO_VALUE) === f.stage]);
  if (f.nameTerms.length) tests.push(['name', (c) => f.nameTerms.every((t) => matchesName(c, t))]);
  return tests;
}

/**
 * Cartas que passam nos filtros. Com filtro de HP, a carta sem HP conhecido (e que passa no resto) fica em `withoutHp`:
 * nunca some em silêncio.
 */
export function applyFilters(cards: LookupCard[], f: LookupFilters): { shown: LookupCard[]; withoutHp: LookupCard[] } {
  const tests = activeTests(f).filter(([dim]) => dim !== 'hp');
  const shown: LookupCard[] = [];
  const withoutHp: LookupCard[] = [];
  for (const c of cards) {
    if (!tests.every(([, test]) => test(c))) continue;
    if (f.hp == null || c.hp === f.hp) shown.push(c);
    else if (c.hp == null) withoutHp.push(c);
  }
  return { shown, withoutHp };
}

const add = <K,>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);
const byCount = <K,>(map: Map<K, number>) => [...map].sort((a, b) => b[1] - a[1]);

/**
 * Valores que têm resultado, cada faceta contando os outros filtros ativos (o próprio filtro não limita a faceta dele).
 * Na raridade, no tipo e no estágio, `NO_VALUE` é o chip "Sem raridade", "Sem tipo" e "Sem estágio"; nos anos, 'none' é
 * "Sem ano"; nas variações, 'noPrints' é a linha sem impressões: carta sem o dado nunca some em silêncio.
 */
export function facets(cards: LookupCard[], f: LookupFilters) {
  const tests = activeTests(f);
  const langs: Record<LookupLang, number> = { pt: 0, en: 0, ja: 0, ko: 0, zh: 0 };
  const hps = new Map<number, number>();
  const years = new Set<number | 'none'>();
  const rarities = new Map<string, number>();
  const variants = new Map<VariantFilter, number>();
  const sets = new Map<string, number>();
  const types = new Map<string, number>();
  const stages = new Map<string, number>();
  for (const c of cards) {
    let fails = 0;
    let failed: Dim | null = null;
    for (const [dim, test] of tests) {
      if (test(c)) continue;
      failed = dim;
      if (++fails > 1) break;
    }
    if (fails > 1) continue;
    const counts = (dim: Dim) => fails === 0 || failed === dim;
    if (counts('lang')) for (const l of LANGS) if (allowsLang(c, l)) langs[l] += 1;
    if (counts('hp') && c.hp != null) add(hps, c.hp);
    if (counts('year')) for (const y of yearsOf(c)) years.add(y);
    if (counts('rarity')) add(rarities, rarityOf(c));
    if (counts('variant')) for (const v of variantsOf(c)) add(variants, v);
    if (counts('set')) add(sets, c.set.key);
    if (counts('type')) add(types, c.cardType ?? NO_VALUE);
    if (counts('stage')) add(stages, c.stage ?? NO_VALUE);
  }
  return {
    langs,
    hps: [...hps].sort((a, b) => a[0] - b[0]),
    years: [...years].sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : b - a)),
    rarities: byCount(rarities),
    variants: VARIANT_ORDER.filter((v) => variants.has(v)).map((v): [VariantFilter, number] => [v, variants.get(v)!]),
    sets: [...sets],
    types: byCount(types),
    stages: byCount(stages),
  };
}

export type YearGroup = { key: string; title: string; from: number | null; to: number | null; cards: LookupCard[] };

/** Do mais novo ao mais antigo; a faixa de promos logo depois do seu ano final; "Sem ano" no fim. */
export function groupByYear(cards: LookupCard[]): YearGroup[] {
  const groups = new Map<string, YearGroup & { order: number }>();
  for (const c of cards) {
    const y = c.year;
    const key = y.kind === 'year' ? `y${y.year}` : y.kind === 'range' ? `r${y.from}-${y.to}` : 'none';
    let g = groups.get(key);
    if (!g) {
      g =
        y.kind === 'year'
          ? { key, title: String(y.year), from: y.year, to: y.year, cards: [], order: y.year }
          : y.kind === 'range'
            ? { key, title: `Promos ${y.from}–${y.to}`, from: y.from, to: y.to, cards: [], order: y.to - 0.5 }
            : { key, title: 'Sem ano', from: null, to: null, cards: [], order: -Infinity };
      groups.set(key, g);
    }
    g.cards.push(c);
  }
  return [...groups.values()]
    .sort((a, b) => b.order - a.order || (b.from ?? 0) - (a.from ?? 0))
    .map(({ key, title, from, to, cards: list }) => ({ key, title, from, to, cards: list }));
}

/** "Outras versões": outras linhas com o mesmo id da TCGdex ou a mesma coleção e número, no mesmo idioma de catálogo. */
export function siblings(card: LookupCard, section: LookupCard[]): LookupCard[] {
  const keys = new Set(numberKeys(card));
  return section.filter((c) => {
    if (c.key === card.key || c.set.lang !== card.set.lang) return false;
    if (card.tcgdexId && c.tcgdexId === card.tcgdexId) return true;
    return c.set.key === card.set.key && keys.size > 0 && numberKeys(c).some((k) => keys.has(k));
  });
}

/** Idiomas em que a linha existe. */
export function languagesOf(card: LookupCard): LookupLang[] {
  return LANGS.filter((l) => allowsLang(card, l));
}

const ownLang = (card: LookupCard): LookupLang => {
  const lang = card.set.lang;
  return lang === 'zh-tw' || lang === 'zh-cn' ? 'zh' : lang;
};

/** Idioma ao abrir a folha: o do chip; em "Todos", PT se a carta tem `p`, senão o da própria linha. */
export function defaultSheetLang(card: LookupCard, active: LookupLang | null): LookupLang {
  if (active && allowsLang(card, active)) return active;
  return card.marks.includes('p') ? 'pt' : ownLang(card);
}

const TCGDEX_ASSETS = 'https://assets.tcgdex.net';

/** Carta no formato das listas do app, com os mesmos ids (o "tenho" e as cartas já salvas batem). */
export function toBrief(card: LookupCard, lang: 'pt' | 'en' | 'ja'): CardBrief {
  const japanese = lang === 'ja';
  const pid = card.productId;
  const td = card.tcgdexId;
  const catalogOnly = japanese ? pid != null : !td;
  const id = catalogOnly ? `tcgp-${pid}` : (td ?? card.key);
  const cut = td ? td.lastIndexOf('-') : -1;
  const usesTd = !catalogOnly && cut > 0;
  // Data com as correções do app (GROUP_YEARS, ex.: a "Japanese CD Promo" é de 1998–1999): a mesma época das listas.
  const published = catalogPublishedOn(Number(card.set.key), card.set.date);
  return {
    id,
    localId: usesTd ? td!.slice(cut + 1) : catalogNumber(card.number),
    name: lang === 'pt' ? (card.ptName ?? card.name) : card.name,
    image: lang === 'pt' && card.imagePath && !card.stamp ? `${TCGDEX_ASSETS}/${card.imagePath}` : undefined,
    lang,
    dataLang: lang === 'pt' && !card.marks.includes('p') ? 'en' : undefined,
    setId: usesTd ? td!.slice(0, cut) : `tcgp${card.set.key}`,
    setName: card.set.name,
    setNameEn: card.set.name,
    setOrder: dateOrder(published),
    ...(japanese ? { series: japaneseSeries(published) } : {}),
    imageUrl: pid != null ? tcgplayerImageUrl(pid) : undefined,
    ...(japanese && td ? { tcgdexId: td } : {}),
    ...(card.stamp ? { stamp: { variant: stampVariant(card.stamp, japanese ? JAPANESE : ENGLISH), label: card.stamp, keys: [] } } : {}),
  };
}

type PhotoSize = 'grid' | 'large' | 'full';
type PhotoTag = 'Foto JP' | 'Foto EN' | 'Sem foto';

const TCG_SUFFIX: Record<PhotoSize, string> = { grid: '_200w.jpg', large: '_in_600x600.jpg', full: '_in_1000x1000.jpg' };
const tcgPhoto = (productId: number, size: PhotoSize) => tcgplayerImageUrl(productId).replace('_in_1000x1000.jpg', TCG_SUFFIX[size]);
const tdPhoto = (path: string, size: PhotoSize) => `${TCGDEX_ASSETS}/${path}/${size === 'grid' ? 'low' : 'high'}.webp`;

const NO_PHOTO = { url: null, tag: 'Sem foto' as const };

/** Foto da carta por idioma. Na grade, quem tem produto usa sempre a TCGplayer (rápida e já em cache). */
export function cardPhoto(card: LookupCard, lang: LookupLang, size: PhotoSize): { url: string | null; tag?: PhotoTag } {
  const pid = card.productId;
  const own = card.imagePath ? tdPhoto(card.imagePath, size) : null;
  if (size === 'grid') {
    if (pid != null) return { url: tcgPhoto(pid, size) };
    if (own) return { url: own };
    return card.twinProductId != null ? { url: tcgPhoto(card.twinProductId, size), tag: 'Foto JP' } : NO_PHOTO;
  }
  switch (lang) {
    case 'pt':
      if (own) return { url: own };
      return pid != null ? { url: tcgPhoto(pid, size), tag: 'Foto EN' } : NO_PHOTO;
    case 'ko':
      return pid != null ? { url: tcgPhoto(pid, size), tag: 'Foto JP' } : NO_PHOTO;
    case 'zh':
      if (card.set.lang === 'zh-cn') return NO_PHOTO;
      if (own) return { url: own };
      return card.twinProductId != null ? { url: tcgPhoto(card.twinProductId, size), tag: 'Foto JP' } : NO_PHOTO;
    default:
      if (pid != null) return { url: tcgPhoto(pid, size) };
      return own ? { url: own } : NO_PHOTO;
  }
}
