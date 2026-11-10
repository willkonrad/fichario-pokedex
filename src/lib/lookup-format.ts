// Formato 1 do índice da Consulta (ver lookup_build no banco): cabeçalho JSON na 1ª linha, seções "@<dex>" e uma carta
// por linha, com colunas separadas por TAB. Funções puras: sem rede, sem disco.

import type { LookupCard, LookupHeader, LookupLang, LookupPrint, LookupSet, PrintCode, VariantFilter, YearInfo } from '@/lib/lookup-types';

type RawSet = [string?, string?, string?, (string | null)?, (number | null)?, number?, number?, string?];
type RawHeader = {
  v?: number;
  prices?: string;
  fx?: [string?, number?];
  sets?: Record<string, RawSet>;
  td?: Record<string, string>;
  only?: [string?, string?, (string | null)?, (number | null)?][];
  limits?: { ko?: string; zh?: string };
};

const SET_LANGS = new Set<LookupSet['lang']>(['en', 'ja', 'pt', 'zh-tw', 'zh-cn']);
const PRINT_CODES = new Set<string>(['N', 'H', 'R', '1', '1H', 'U', 'UH']);

function toSet(key: string, raw: RawSet): LookupSet {
  const [lang, name, abbr, date, total, from, to, pricesDay] = raw;
  const yearFrom = from || null;
  return {
    key,
    lang: SET_LANGS.has(lang as LookupSet['lang']) ? (lang as LookupSet['lang']) : 'en',
    name: name ?? '',
    abbr: abbr ?? '',
    date: date || null,
    total: total || null,
    yearFrom,
    // Faixa com fim 0: até hoje.
    yearTo: yearFrom ? to || new Date().getFullYear() : null,
    pricesDay: pricesDay || null,
  };
}

/**
 * Coleções sem lista de cartas, uma por nome em cada língua. A TCGdex repete às vezes o mesmo nome em várias coleções
 * (em 11/2026, 17 coleções coreanas e 17 chinesas com o nome de Triplet Beat): a lista não repete a linha, e a
 * quantidade de cartas some quando as repetidas não concordam (não dá para saber qual é a certa).
 */
function onlyList(raw: NonNullable<RawHeader['only']>): LookupHeader['only'] {
  const out: LookupHeader['only'] = [];
  const seen = new Map<string, LookupHeader['only'][number]>();
  for (const [lang, name, date, total] of raw) {
    const row = { lang: lang ?? '', name: name ?? '', date: date || null, total: total || null };
    const key = `${row.lang}:${row.name}`;
    const first = seen.get(key);
    if (!first) {
      seen.set(key, row);
      out.push(row);
    } else if (first.total !== row.total) {
      first.total = null;
    }
  }
  return out;
}

/**
 * Lê a 1ª linha do arquivo. JSON quebrado lança erro; formato maior que o conhecido devolve `v` para quem chamou
 * decidir (a linha pode trazer campos que este app não sabe ler).
 */
export function parseHeader(firstLine: string): LookupHeader {
  const h = JSON.parse(firstLine) as RawHeader;
  if (typeof h?.v !== 'number') throw new Error('Índice sem versão no cabeçalho');
  const sets = new Map<string, LookupSet>();
  for (const [key, raw] of Object.entries(h.sets ?? {})) sets.set(key, toSet(key, raw));
  return {
    v: h.v,
    pricesDay: h.prices ?? '',
    fxDay: h.fx?.[0] ?? '',
    fxSell: h.fx?.[1] ?? 0,
    sets,
    tdAbbr: new Map(Object.entries(h.td ?? {})),
    only: onlyList(h.only ?? []),
    limits: h.limits ?? {},
  };
}

/** Onde começa e termina cada seção "@<dex>" (sem a linha do título), na ordem do arquivo. */
export function sectionTable(body: string): Map<number, { start: number; end: number }> {
  const out = new Map<number, { start: number; end: number }>();
  let at = body.indexOf('\n@');
  while (at >= 0) {
    const eol = body.indexOf('\n', at + 1);
    const dex = Number(body.slice(at + 2, eol < 0 ? undefined : eol));
    if (eol < 0) {
      out.set(dex, { start: body.length, end: body.length });
      break;
    }
    const next = body.indexOf('\n@', eol);
    const start = eol + 1;
    const end = next < 0 ? body.length : next;
    out.set(dex, end < start ? { start: end, end } : { start, end });
    at = next;
  }
  return out;
}

const cents = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function parsePrints(raw: string | undefined): LookupPrint[] {
  if (!raw) return [];
  const out: LookupPrint[] = [];
  for (const part of raw.split('|')) {
    const [code, low, mid, market] = part.split(':');
    if (PRINT_CODES.has(code)) out.push({ code: code as PrintCode, low: cents(low), mid: cents(mid), market: cents(market) });
  }
  return out;
}

const ORIGIN = { n: 'name', o: 'original', j: 'japan' } as const;

function parseYear(raw: string | undefined, set: LookupSet): YearInfo {
  if (raw === '-') return { kind: 'none' };
  const m = raw ? /^(\d{4})([noj]?)$/.exec(raw) : null;
  if (m) return { kind: 'year', year: Number(m[1]), origin: m[2] ? ORIGIN[m[2] as keyof typeof ORIGIN] : 'set' };
  if (set.yearFrom != null) {
    const to = set.yearTo ?? set.yearFrom;
    return to > set.yearFrom ? { kind: 'range', from: set.yearFrom, to } : { kind: 'year', year: set.yearFrom, origin: 'set' };
  }
  const year = Number(set.date?.slice(0, 4));
  return year > 1990 ? { kind: 'year', year, origin: 'set' } : { kind: 'none' };
}

/** Coleção citada numa linha e que o cabeçalho não traz: a carta continua legível, sem dados da coleção. */
const unknownSet = (key: string): LookupSet => ({ key, lang: 'en', name: '', abbr: '', date: null, total: null, yearFrom: null, yearTo: null, pricesDay: null });

/** Uma linha do arquivo; `dex` é a seção em que ela foi lida. As colunas vazias no fim vêm cortadas. */
export function parseRow(line: string, dex: number, header: LookupHeader): LookupCard {
  const c = line.split('\t');
  const set = header.sets.get(c[1]) ?? unknownSet(c[1] ?? '');
  const hp = c[8] ? /^(\d+)(j?)$/.exec(c[8]) : null;
  const twin = c[15] ? Number(c[15]) : undefined;
  return {
    key: c[0],
    productId: /^\d+$/.test(c[0]) ? Number(c[0]) : null,
    set,
    name: c[2] ?? '',
    ptName: c[14] || undefined,
    number: c[3] ?? '',
    altNumber: c[4] || undefined,
    rarity: c[5] || undefined,
    stamp: c[6] || undefined,
    qualifier: c[7] || undefined,
    hp: hp ? Number(hp[1]) : null,
    hpFromTwin: hp?.[2] === 'j',
    cardType: c[9] || undefined,
    stage: c[10] || undefined,
    tcgdexId: c[11] || undefined,
    prints: parsePrints(c[12]),
    marks: c[13] ?? '',
    twinProductId: twin && Number.isFinite(twin) ? twin : undefined,
    year: parseYear(c[16], set),
    imagePath: c[17] || undefined,
    dex,
  };
}

const numberSide = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9!?]/g, '')
    .replace(/^([a-z]*)0+(?=\d)/, '$1');

/**
 * Forma de comparar de um número: "070/108" → "70/108", "TG05/TG30" → "tg5/tg30", "101/078 SAR" → "101/78",
 * "056/184 (Top Left)" → "56/184", "PW 7" → "pw7". null quando não é número ("WAT", "N/A", "ONE", "SV-P").
 */
export function numberKey(text: string): string | null {
  const raw = text.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s*\/\s*/g, '/').trim();
  if (!raw) return null;
  const glued = /^([a-z]+)\s+(\d+[a-z]?)$/i.exec(raw);
  const piece = glued ? `${glued[1]}${glued[2]}` : raw.split(/\s+/)[0];
  const key = piece.split('/').map(numberSide).join('/');
  return /\d/.test(key) ? key : null;
}

/** Só o número da carta, sem o total: "70/108" → "70". */
export const numberLeft = (key: string) => key.split('/')[0];

/** Junções de duas cartas num número só: "099/102 & 100/102", "101/102 + 102/102", "071/076 / 072/076". */
const JOINED = /\s*[&+]\s*|\s+\/\s+(?=\S*\/)/;

/**
 * Chaves de comparação da carta (número exibido e segunda chave), sem repetir: separa "A & B", tira sufixos, descarta
 * o que não é número e normaliza zeros. Carta sem número: lista vazia.
 */
export function numberKeys(card: Pick<LookupCard, 'number' | 'altNumber'>): string[] {
  const out: string[] = [];
  for (const field of [card.number, card.altNumber]) {
    if (!field) continue;
    for (const piece of field.split(JOINED)) {
      const key = numberKey(piece);
      if (key && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

const LANG_MARKS: Record<LookupLang, string> = { pt: 'pu', en: 'e', ja: 'j', ko: 'ki', zh: 'tc' };

/** A carta existe neste idioma? PT conta "não confirmada" (`u`); KO, "pela coleção" (`i`); ZH, as duas escritas. */
export function allowsLang(card: LookupCard, lang: LookupLang): boolean {
  const marks = LANG_MARKS[lang];
  return card.marks.includes(marks[0]) || (marks.length > 1 && card.marks.includes(marks[1]));
}

/** Que tipo de versão o selo descreve; null nos que não mudam a versão ("Non-Holo"). */
export function stampKind(stamp: string): VariantFilter | null {
  if (/staff|prerelease/i.test(stamp)) return 'staff';
  if (/master ?ball/i.test(stamp)) return 'masterball';
  if (/pok[eé] ?ball/i.test(stamp)) return 'pokeball';
  if (/mirror/i.test(stamp)) return 'mirror';
  if (/non[- ]?holo/i.test(stamp)) return null;
  if (/reverse/i.test(stamp)) return 'reverse';
  if (/cosmos|holo/i.test(stamp)) return 'holo';
  if (/1st edition/i.test(stamp)) return 'firstEdition';
  return 'stamp';
}
