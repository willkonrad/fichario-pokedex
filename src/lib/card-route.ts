import { TOTAL_SPECIES } from '@/data/pokedex';
import { VARIANTS, type CardLang, type Variant } from '@/lib/types';

/**
 * Parâmetros da tela da carta vindos do endereço. Nenhuma tela do app monta um endereço errado, mas um link externo ou
 * digitado pode: "slot=abc" gravava a carta com bolso NaN (o envio para a nuvem falhava sempre, `entries.slot` é
 * NOT NULL) e "lang=ko" derrubava a tela. Com algo inválido, a tela mostra "Bolso vazio" e nada é gravado.
 */
export type CardRoute = {
  /** Fichário livre (sem ele, o fichário Pokédex). */
  binder?: string;
  /** Pokémon do bolso no fichário Pokédex (0 = bolso extra). No fichário livre, 0 (o Pokémon vem da carta). */
  dex: number;
  slot: number;
  lang?: CardLang;
  dataLang?: CardLang;
  /** Variação conhecida pelo app; outra qualquer é ignorada. */
  variant?: Variant;
};

/** Maior valor da coluna `int` do Postgres (`entries.dex` e `entries.slot`). */
const MAX_INT = 2_147_483_647;
const LANGS: readonly string[] = ['pt', 'en', 'ja'] satisfies CardLang[];

/** Inteiro não negativo escrito só com algarismos ("12"); "abc", "1.5", "-1", "", lista ou ausente: null. */
export function routeInt(v: unknown, max = MAX_INT): number | null {
  if (typeof v !== 'string' || !/^\d{1,10}$/.test(v)) return null;
  const n = Number(v);
  return n <= max ? n : null;
}

/** Idioma do endereço: ausente = undefined; um que o app não tem = null. */
function routeLang(v: unknown): CardLang | undefined | null {
  if (v == null || v === '') return undefined;
  return typeof v === 'string' && LANGS.includes(v) ? (v as CardLang) : null;
}

export function cardRoute(p: { binder?: unknown; dex?: unknown; slot?: unknown; lang?: unknown; dataLang?: unknown; variant?: unknown }): CardRoute | null {
  const binder = typeof p.binder === 'string' && p.binder ? p.binder : undefined;
  const slot = routeInt(p.slot);
  // No fichário Pokédex o bolso é do Pokémon do endereço; no livre, o dex do endereço não conta.
  const dex = binder ? 0 : routeInt(p.dex, TOTAL_SPECIES);
  const lang = routeLang(p.lang);
  const dataLang = routeLang(p.dataLang);
  if (slot == null || dex == null || lang === null || dataLang === null) return null;
  const variant = VARIANTS.some((v) => v.id === p.variant) ? (p.variant as Variant) : undefined;
  return { binder, dex, slot, lang, dataLang, variant };
}
