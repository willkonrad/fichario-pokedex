// O que o campo único da Consulta entende (seção 7.4 da especificação). Função pura: os dados vêm por `ctx`.

import { searchSpeciesRanked, speciesKey, splitNameAffixes, type Species, type SpeciesHit } from '@/data/pokedex';
import { parseCardCode } from '@/lib/add-card';
import { numberKey } from '@/lib/lookup-format';
import type { LookupFilters, LookupLang, ParsedQuery, VariantFilter } from '@/lib/lookup-types';

export type QueryContext = {
  hpsOf: (dex: number) => Set<number>;
  countOf: (dex: number) => number;
  abbrsOf: (dex: number) => Set<string>;
  /** Opcional: a palavra é sigla de coleção? Desempata "MEG 133" de "Meganium 133". */
  isSetAbbr?: (abbr: string) => boolean;
  /** Opcional: quantos treinadores e energias têm todas estas palavras ("dark patch" não é Darkrai sem "patch"). */
  trainerCount?: (words: string) => number;
  /** Opcional: quantas cartas da espécie passam nestes filtros. Com 0, "MEW 199" vira a sigla MEW. */
  matchCount?: (dex: number, filters: LookupFilters) => number;
  /** Opcional: quantas cartas a sigla + número acha. */
  codeCount?: (abbr: string, number: string) => number;
};

/** Filtro por "sem o dado" (raridade e número): nunca colide com um código ou número de verdade. */
export const NO_VALUE = 'none';

export const emptyFilters = (): LookupFilters => ({
  lang: null,
  hp: null,
  year: null,
  number: null,
  rarity: null,
  variant: null,
  setKey: null,
  cardType: null,
  stage: null,
  nameTerms: [],
});

/** Códigos impressos da seção 7.5 e os nomes da fonte de cada um. */
const RARITY_NAMES: Record<string, string[]> = {
  C: ['Common'],
  U: ['Uncommon'],
  R: ['Rare'],
  RR: ['Double Rare'],
  RRR: ['Triple Rare'],
  AR: ['Art Rare', 'Illustration Rare'],
  SAR: ['Special Art Rare', 'Special Illustration Rare'],
  SR: ['Super Rare', 'Super Rare Holo'],
  HR: ['Hyper Rare'],
  UR: ['Ultra Rare'],
  CHR: ['Character Rare'],
  CSR: ['Character Super Rare'],
  S: ['Shiny Rare'],
  SSR: ['Shiny Secret Rare'],
  ACE: ['ACE Rare', 'ACE SPEC Rare'],
  TR: ['Trainer Rare'],
  PR: ['Promo'],
};
const CODE_OF_NAME = new Map(Object.entries(RARITY_NAMES).flatMap(([code, names]) => names.map((n) => [n.toLowerCase(), code] as const)));

/** Código impresso da raridade; fora da tabela, o nome da fonte; `None` e vazio, null. */
export function rarityCode(rarity: string | undefined): string | null {
  const r = rarity?.trim();
  if (!r || r.toLowerCase() === 'none') return null;
  return CODE_OF_NAME.get(r.toLowerCase()) ?? r;
}

/** Texto do chip: "SAR · Special Art Rare"; fora da tabela, o nome da fonte. */
export function rarityLabel(code: string): string {
  const name = RARITY_NAMES[code]?.[0];
  return name ? `${code} · ${name}` : code;
}

// Map, e não objeto: "constructor" digitado não pode virar idioma.
const LANG_WORDS = new Map<string, LookupLang>([
  ['pt', 'pt'],
  ['en', 'en'],
  ['jp', 'ja'],
  ['ja', 'ja'],
  ['ko', 'ko'],
  ['kr', 'ko'],
  ['zh', 'zh'],
  ['cn', 'zh'],
  ['tw', 'zh'],
]);

const VARIANT_WORDS = new Map<string, VariantFilter>([
  ['holo', 'holo'],
  ['rev', 'reverse'],
  ['reverse', 'reverse'],
  ['1ed', 'firstEdition'],
  ['selo', 'stamp'],
  ['promo', 'stamp'],
  ['staff', 'staff'],
  ['pokeball', 'pokeball'],
  ['masterball', 'masterball'],
  ['mirror', 'mirror'],
]);

/** Partes de nome que também existem como sigla (Expedition é "EX"): valem como nome. */
const NAME_WORDS = new Set(['ex', 'gx', 'v', 'vmax', 'vstar', 'mega']);

const typedLang = (tok: string) => LANG_WORDS.get(tok.toLowerCase()) ?? null;
const typedRarity = (tok: string) => {
  const code = tok.toUpperCase();
  return code.length >= 2 && RARITY_NAMES[code] ? code : null;
};
const typedVariant = (tok: string) => VARIANT_WORDS.get(speciesKey(tok)) ?? null;

const HP_WORD = /^(?:hp|ps)$/i;
const HP_TERM = /^(?:(?:hp|ps)(\d{2,3})|(\d{2,3})(?:hp|ps))$/i;
// Com zero à esquerda é sempre número: "070" vem de "070/108", não existe HP assim.
const looksLikeHp = (digits: string) => /^[1-9]\d{1,2}$/.test(digits) && Number(digits) % 10 === 0;
const isYear = (digits: string) => {
  if (!/^\d{4}$/.test(digits)) return false;
  const year = Number(digits);
  return year >= 1996 && year <= new Date().getFullYear();
};

/** Nunca começa um nome de Pokémon: tem barra ou é HP/número. */
const notAName = (tok: string) => tok.includes('/') || /^#?\d+$/.test(tok) || HP_TERM.test(tok);
/** Termos que podem vir antes do nome: "jp umbreon", "mega char", "hp 120 char". */
const canPrecedeName = (tok: string) => !!typedLang(tok) || !!typedRarity(tok) || !!typedVariant(tok) || HP_WORD.test(tok) || NAME_WORDS.has(tok.toLowerCase());

type Found = { start: number; end: number; hits: SpeciesHit[] };

/**
 * Maior trecho igual a uma espécie, em qualquer posição ("Mr Mime", "Porygon Z", "Type Null"; "mega charizard" não é
 * Meganium). Sem nenhum igual, o que começa com o texto ou o contém, a partir do primeiro termo que pode ser nome.
 */
function findSpecies(tokens: string[]): Found | null {
  for (let start = 0; start < tokens.length; start++) {
    if (notAName(tokens[start])) continue;
    for (let n = Math.min(3, tokens.length - start); n >= 1; n--) {
      const hits = searchSpeciesRanked(tokens.slice(start, start + n).join(' '), 24);
      if (hits[0]?.rank === 0) return { start, end: start + n, hits };
    }
  }
  for (let start = 0; start < tokens.length; start++) {
    if (notAName(tokens[start])) continue;
    // Sozinha pode ser o começo de um nome ("ko" de Koffing); com outro termo, é filtro.
    if (canPrecedeName(tokens[start]) && tokens.length > 1) continue;
    for (let n = Math.min(3, tokens.length - start); n >= 1; n--) {
      const part = tokens.slice(start, start + n);
      if (part.some(notAName)) continue;
      const hits = searchSpeciesRanked(part.join(' '), 24);
      if (hits.length) return { start, end: start + n, hits };
    }
    return null;
  }
  return null;
}

/** Nome exato, depois quem começa com o texto, depois quem contém; dentro de cada um, mais cartas primeiro. */
function rankSuggestions(hits: SpeciesHit[], ctx: QueryContext): { species: Species; count: number }[] {
  const band = (h: SpeciesHit) => (h.rank === 0 ? 0 : h.rank === 3 ? 2 : 1);
  return hits
    .map((h) => ({ h, count: ctx.countOf(h.species.id) }))
    .sort((a, b) => band(a.h) - band(b.h) || b.count - a.count || a.h.species.id - b.h.species.id)
    .slice(0, 12)
    .map(({ h, count }) => ({ species: h.species, count }));
}

/** Classifica os termos que sobram, na ordem da gramática. */
function classify(tokens: string[], dex: number | null, ctx: QueryContext, filters: LookupFilters): string | undefined {
  let hpOrNumber: string | undefined;
  // Número solto à espera do total: "70 108" é 70/108, e o segundo não apaga o primeiro.
  let bare: string | null = null;
  const abbrs = dex != null ? [...ctx.abbrsOf(dex)] : [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.includes('/')) {
      filters.number = numberKey(tok) ?? filters.number;
      continue;
    }
    const hpTerm = HP_TERM.exec(tok);
    if (hpTerm) {
      filters.hp = Number(hpTerm[1] ?? hpTerm[2]);
      continue;
    }
    if (HP_WORD.test(tok) && /^\d{2,3}$/.test(tokens[i + 1] ?? '')) {
      filters.hp = Number(tokens[++i]);
      continue;
    }
    if (isYear(tok)) {
      filters.year = Number(tok);
      continue;
    }
    if (looksLikeHp(tok) && dex != null && ctx.hpsOf(dex).has(Number(tok))) {
      filters.hp = Number(tok);
      hpOrNumber = tok;
      continue;
    }
    if (/^#?\d+$/.test(tok)) {
      const digits = /^\d+$/.test(tok);
      const withTotal: string | null = bare != null && digits ? numberKey(`${bare}/${tok}`) : null;
      filters.number = withTotal ?? numberKey(tok.replace('#', ''));
      bare = !withTotal && digits ? tok : null;
      continue;
    }
    const lower = tok.toLowerCase();
    const lang = typedLang(tok);
    if (lang) {
      filters.lang = lang;
      continue;
    }
    const rarity = typedRarity(tok);
    if (rarity) {
      filters.rarity = rarity;
      continue;
    }
    const variant = typedVariant(tok);
    if (variant) {
      filters.variant = variant;
      continue;
    }
    const abbr = NAME_WORDS.has(lower) ? undefined : abbrs.find((a) => a.toLowerCase() === lower);
    if (abbr) {
      filters.setKey = abbr;
      continue;
    }
    // "TG05", "SWSH248": número com letras.
    if (!NAME_WORDS.has(lower) && /^[a-z]{1,5}\d{1,4}[a-z]?$/i.test(tok)) {
      filters.number = numberKey(tok);
      continue;
    }
    filters.nameTerms.push(tok);
  }
  return hpOrNumber;
}

/** "hp 60", "ps60", "120hp": a gramática lê HP antes de sigla (já "HP 60/110" continua sendo a coleção HP). */
const writesHp = (pair: string[]) => pair.some((t) => HP_TERM.test(t)) || (HP_WORD.test(pair[0] ?? '') && /^\d{2,3}$/.test(pair[1] ?? ''));

function codeOf(tokens: string[], ctx: QueryContext): { abbr: string; number: string; rest: string[] } | null {
  // Número sozinho, com barra: "TG05/TG30" não é a sigla TG.
  if (tokens.length === 1 && tokens[0].includes('/')) return null;
  const pair = tokens.slice(0, 2);
  if (writesHp(pair)) return null;
  // Idioma, variação e raridade são filtros, não sigla: "070/108 jp". Raridade que é mesmo sigla de coleção continua sigla.
  if (pair.some((t) => typedLang(t) || typedVariant(t) || (typedRarity(t) && !ctx.isSetAbbr?.(t)))) return null;
  const code = parseCardCode(pair.join(' '));
  const rest = tokens.slice(2);
  if (code?.kind === 'set') return { abbr: code.abbr, number: code.number, rest };
  if (code?.kind === 'id') return { abbr: code.set, number: code.number, rest };
  return null;
}

/** "charizard-gx" é "charizard gx"; "070 / 108", "070/108" (só com algarismo: "Pikachu / Zekrom" fica). */
const tidy = (text: string) =>
  text.replace(/-(ex|gx)\b/gi, ' $1').replace(/([\w-]+)\s*\/\s*([\w-]+)/g, (all, a: string, b: string) => (/\d/.test(a + b) ? `${a}/${b}` : all));

/**
 * Pedaço de nome seguido de palavras que não são de nome: "dark patch" é o treinador, não Darkrai sem "patch"; "great
 * ball", a Great Ball, não as Great Tusk com selo de Poké Ball. Só se houver treinador com todas as palavras.
 */
function trainerReading(tokens: string[], found: Found, ctx: QueryContext): { text: string; filters: LookupFilters } | null {
  if (!ctx.trainerCount) return null;
  const filters = emptyFilters();
  classify([...tokens.slice(0, found.start), ...tokens.slice(found.end)], null, ctx, filters);
  // "pika v" continua Pikachu V: ex, V, VMAX… são parte de nome de Pokémon.
  if (!filters.nameTerms.some((t) => !NAME_WORDS.has(t.toLowerCase()))) return null;
  const words = tokens.filter((t, i) => (i >= found.start && i < found.end) || filters.nameTerms.includes(t));
  const text = words.join(' ');
  if (ctx.trainerCount(text) <= 0) return null;
  filters.nameTerms = words;
  return { text, filters };
}

/**
 * Espécie que também é sigla, com número ("MEW" é Mew e a coleção 151): fica a espécie, a não ser que ela não tenha
 * carta assim e a sigla tenha. "MEW 199" é o Charizard ex 199/165; "mew 6" segue sendo o Mew ex 006/044.
 */
function codeReading(tokens: string[], found: Found, dex: number, ctx: QueryContext, filters: LookupFilters) {
  if (found.end - found.start !== 1 || !ctx.matchCount || !ctx.codeCount || !ctx.isSetAbbr?.(tokens[found.start])) return null;
  const code = codeOf(tokens, ctx);
  if (!code || ctx.matchCount(dex, filters) > 0 || ctx.codeCount(code.abbr, code.number) <= 0) return null;
  const own = emptyFilters();
  classify(code.rest, null, ctx, own);
  return { code: { abbr: code.abbr, number: code.number }, filters: own };
}

/**
 * Lê o que foi digitado. `text` é o texto sem as pontas; no modo 'trainer', só as palavras do nome, para `searchTrainers`.
 * `filters.setKey`, quando vem digitado, é a sigla da coleção (applyFilters aceita a sigla ou a chave).
 */
export function parseLookupQuery(text: string, ctx: QueryContext): ParsedQuery {
  const trimmed = text.trim();
  const filters = emptyFilters();
  const base = { text: trimmed, dex: null, suggestions: [], filters };
  if (!trimmed) return { ...base, mode: 'empty' };

  if (/^#?\d+$/.test(trimmed)) {
    const hits = searchSpeciesRanked(trimmed, 1);
    if (hits.length) return { ...base, mode: 'species', dex: hits[0].species.id, suggestions: rankSuggestions(hits, ctx) };
    filters.number = numberKey(trimmed.replace('#', ''));
    return { ...base, mode: 'number' };
  }

  // O que vem colado no nome em japonês, coreano ou chinês ("リザードンex", "メガリザードンXex", "리자몽V") vira palavra à
  // parte: ex, V, X, mega e radiant são filtros de nome, como na grafia com espaço.
  const tokens = splitNameAffixes(tidy(trimmed)).split(/\s+/);
  const found = findSpecies(tokens);
  const exact = found?.hits[0].rank === 0;
  // Pedaço de nome que é sigla só vira sigla com o número junto: "MEG 133" e "133/132 MEG", mas "pal" segue sendo Palkia.
  const code = !found || (!exact && ctx.isSetAbbr?.(tokens[found.start])) ? codeOf(tokens, ctx) : null;

  if (found && !code) {
    const suggestions = rankSuggestions(found.hits, ctx);
    const dex = suggestions[0]?.species.id ?? null;
    const hpOrNumber = classify([...tokens.slice(0, found.start), ...tokens.slice(found.end)], dex, ctx, filters);
    const trainer = exact ? null : trainerReading(tokens, found, ctx);
    if (trainer) return { ...base, ...trainer, mode: 'trainer' };
    const byCode = exact && dex != null ? codeReading(tokens, found, dex, ctx, filters) : null;
    if (byCode) return { ...base, ...byCode, mode: 'code' };
    return { ...base, mode: 'species', dex, suggestions, ...(hpOrNumber ? { hpOrNumber } : {}) };
  }

  if (code) {
    classify(code.rest, null, ctx, filters);
    return { ...base, mode: 'code', code: { abbr: code.abbr, number: code.number } };
  }

  classify(tokens, null, ctx, filters);
  if (filters.number && (filters.number.includes('/') || !filters.nameTerms.length)) return { ...base, mode: 'number' };
  const words = filters.nameTerms.join(' ');
  if (speciesKey(words).length >= 3 || /[^\u0000-ɏ]/.test(words)) return { ...base, text: words, mode: 'trainer' };
  return { ...base, mode: 'empty' };
}

/** Mesma forma de um termo: "hp120", "ps120", "120hp" e "120" são o mesmo HP; "rev" e "reverse", a mesma variação. */
const canonical = (tok: string) => {
  const hp = HP_TERM.exec(tok);
  return hp ? (hp[1] ?? hp[2]) : (typedVariant(tok) ?? typedRarity(tok) ?? tok.toLowerCase());
};

/** Termos em que só um vale de cada vez: o chip novo tira o anterior. */
function termKind(tok: string): 'hp' | 'year' | 'rarity' | 'variant' | null {
  if (HP_TERM.test(tok) || looksLikeHp(tok)) return 'hp';
  if (isYear(tok)) return 'year';
  if (typedRarity(tok)) return 'rarity';
  if (typedVariant(tok)) return 'variant';
  return null;
}

/**
 * Chip tocado: põe o termo no texto ou tira, se já estava. Com `parse`, dígitos soltos só contam como HP se a leitura do
 * texto disser ("charizard 30" sem HP 30 é o número 30: o chip de HP não pode apagar).
 */
export function toggleTerm(text: string, term: string, parse?: (t: string) => ParsedQuery): string {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const t = term.trim();
  const same = (tok: string) => canonical(tok) === canonical(t);
  if (tokens.some(same)) return tokens.filter((tok) => !same(tok)).join(' ');
  const kind = termKind(t);
  const readHp = parse?.(text).filters.hp;
  const kindOf = (tok: string) => (parse && looksLikeHp(tok) && readHp !== Number(tok) ? null : termKind(tok));
  return [...(kind ? tokens.filter((tok) => kindOf(tok) !== kind) : tokens), t].join(' ');
}

/** "HP 120 · trocar para nº": o termo passa a valer como número ("charizard 120" → "charizard #120"). */
export function hpTermToNumber(text: string, value: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((tok) => (canonical(tok) === value ? `#${value}` : tok))
    .join(' ');
}
