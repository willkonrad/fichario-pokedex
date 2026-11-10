import type { Species } from '@/data/pokedex';
import type { CardKeys } from '@/lib/myp-api';
import type { Condition, Variant } from '@/lib/types';

export const LOOKUP_FORMAT = 1;

/** Idioma mostrado e filtrado na Consulta. ZH junta tradicional e simplificado. */
export type LookupLang = 'pt' | 'en' | 'ja' | 'ko' | 'zh';
export type PrintCode = 'N' | 'H' | 'R' | '1' | '1H' | 'U' | 'UH';
/** Centavos de dólar. */
export type LookupPrint = { code: PrintCode; low: number | null; mid: number | null; market: number | null };

export type LookupSet = {
  key: string;
  lang: 'en' | 'ja' | 'pt' | 'zh-tw' | 'zh-cn';
  name: string;
  abbr: string;
  date: string | null;
  total: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  pricesDay: string | null;
};

export type LookupHeader = {
  v: number;
  pricesDay: string;
  fxDay: string;
  fxSell: number;
  sets: Map<string, LookupSet>;
  tdAbbr: Map<string, string>;
  only: { lang: string; name: string; date: string | null; total: number | null }[];
  limits: { ko?: string; zh?: string };
};

export type YearInfo =
  | { kind: 'year'; year: number; origin: 'set' | 'name' | 'original' | 'japan' }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'none' };

export type LookupCard = {
  key: string;                 // coluna id
  productId: number | null;
  set: LookupSet;
  name: string;
  ptName?: string;
  number: string;              // exibido; '' se não tem
  altNumber?: string;
  rarity?: string;
  stamp?: string;
  qualifier?: string;
  hp: number | null;
  hpFromTwin: boolean;
  cardType?: string;
  stage?: string;
  tcgdexId?: string;
  prints: LookupPrint[];
  marks: string;               // coluna langs
  twinProductId?: number;
  year: YearInfo;
  imagePath?: string;
  dex: number;                 // seção em que a linha foi lida
};

/** `noPrints`: linha sem impressões no índice; ninguém sabe se é holo ou reverse, e ela não pode sumir em silêncio. */
export type VariantFilter = 'holo' | 'reverse' | 'firstEdition' | 'stamp' | 'staff' | 'pokeball' | 'masterball' | 'mirror' | 'noPrints';

export type LookupFilters = {
  lang: LookupLang | null;
  hp: number | null;
  year: number | 'none' | null;
  number: string | null;
  rarity: string | null;       // código da seção 7.5
  variant: VariantFilter | null;
  setKey: string | null;
  cardType: string | null;
  stage: string | null;
  nameTerms: string[];
};

export type ParsedQuery = {
  text: string;
  mode: 'empty' | 'species' | 'number' | 'code' | 'trainer';
  dex: number | null;
  suggestions: { species: Species; count: number }[];
  filters: LookupFilters;
  /** "120" que existe como HP e como número: vale HP; a tela oferece trocar. */
  hpOrNumber?: string;
  code?: { abbr: string; number: string };
};

export type PriceKind = 'market' | 'listing' | 'none';
export type RefFrom = 'en' | 'ja' | null;
export type CellPrice = { kind: PriceKind; brl: number | null; ref: RefFrom; morePrints: number };
export type PriceBlock = {
  kind: PriceKind;
  ref: RefFrom;
  printCode: PrintCode | null;
  brl: number | null;
  usd: number | null;
  lowBrl: number | null;
  midBrl: number | null;
  prints: { code: PrintCode; label: string; brl: number | null; kind: PriceKind }[];
  /** De que versão vêm os preços de `prints`, mesmo quando a impressão escolhida não tem preço. */
  printsRef: RefFrom;
  pricesDay: string;
  fxDay: string;
  fxSell: number;
};

export type PortalLink = { id: string; label: string; url: string };
export type LinkContext = { card: LookupCard; lang: LookupLang; condition: Condition; mypUrl?: string };

export type MypKeys = CardKeys & { cardId: string; variant: Variant; note: string };
export type MypNow =
  | { status: 'idle' | 'loading' }
  | { status: 'ok'; min: number | null; avg: number | null; max: number | null; qty?: number; url?: string; at: string }
  | { status: 'notFound' }
  // by: 'myp' é a pausa pedida pelo MYP (429); 'app', o limite de consultas do próprio app. Sem by, a do MYP.
  | { status: 'limited'; retryInS: number; by?: 'myp' | 'app' }
  | { status: 'unavailable'; reason: 'web' | 'language' | 'offline' | 'error' };
