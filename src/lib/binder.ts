import { TOTAL_SPECIES } from '@/data/pokedex';

import type { BinderSettings, CustomBinder } from './types';

export type SlotRef = { dex: number; slot: number; index: number };

/** O que todo fichário tem: grade da página e se as folhas são frente e verso. */
type Grid = { rows: number; cols: number; doubleSided: boolean };

export function pageSize(s: Pick<Grid, 'rows' | 'cols'>) {
  return s.rows * s.cols;
}

/** Faixa da Pokédex coberta pelo fichário Pokédex (padrão: todos). */
export function dexRange(s: BinderSettings) {
  const from = Math.min(Math.max(1, s.dexFrom ?? 1), TOTAL_SPECIES);
  const to = Math.max(from, Math.min(TOTAL_SPECIES, s.dexTo ?? TOTAL_SPECIES));
  return { from, to, count: to - from + 1 };
}

export function inDexRange(s: BinderSettings, dex: number) {
  const { from, to } = dexRange(s);
  return dex >= from && dex <= to;
}

export function totalSlots(s: BinderSettings) {
  return dexRange(s).count * s.slotsPerPokemon;
}

export function totalPages(s: BinderSettings) {
  return Math.max(1, Math.ceil(totalSlots(s) / pageSize(s)));
}

/** Quantos bolsos o fichário físico tem (null se o usuário não informou as folhas). */
export function capacity(s: BinderSettings) {
  return s.sheets ? s.sheets * pageSize(s) * (s.doubleSided ? 2 : 1) : null;
}

export function slotAt(s: BinderSettings, index: number): SlotRef | null {
  if (index < 0 || index >= totalSlots(s)) return null;
  return { dex: dexRange(s).from + Math.floor(index / s.slotsPerPokemon), slot: index % s.slotsPerPokemon, index };
}

/** Posição (índice corrido) de um espaço do fichário Pokédex. */
export function indexOfDex(s: BinderSettings, dex: number, slot = 0) {
  return (dex - dexRange(s).from) * s.slotsPerPokemon + slot;
}

export function pageOfDex(s: BinderSettings, dex: number) {
  return Math.floor(indexOfDex(s, dex) / pageSize(s));
}

export function slotsOnPage(s: BinderSettings, page: number): SlotRef[] {
  const size = pageSize(s);
  const out: SlotRef[] = [];
  for (let i = page * size; i < (page + 1) * size; i++) {
    const ref = slotAt(s, i);
    if (ref) out.push(ref);
  }
  return out;
}

/**
 * Bolsos livres do fichário Pokédex: os que sobram na última página depois do último Pokémon
 * (ex.: 151 Pokémon em páginas de 20 → 9 bolsos livres), para cartas especiais.
 * A carta de um bolso livre é guardada com `dex: 0` e `slot` = número do bolso livre (0, 1, 2…).
 */
export function extraSlots(s: BinderSettings) {
  const size = pageSize(s);
  return (size - (totalSlots(s) % size)) % size;
}

/** Bolsos livres que aparecem na página (só na última). */
export function extraOnPage(s: BinderSettings, page: number) {
  return page === totalPages(s) - 1 ? Array.from({ length: extraSlots(s) }, (_, k) => k) : [];
}

/** Posição (índice corrido) de um bolso livre, logo depois do último Pokémon. */
export function indexOfExtra(s: BinderSettings, k: number) {
  return totalSlots(s) + k;
}

/** Posição física: folha, frente/verso e bolso — útil para achar a carta no fichário. */
export function physicalPosition(s: Grid, index: number) {
  const size = pageSize(s);
  const page = Math.floor(index / size);
  const pocket = (index % size) + 1;
  if (!s.doubleSided) return { page: page + 1, sheet: page + 1, side: null, pocket };
  return { page: page + 1, sheet: Math.floor(page / 2) + 1, side: page % 2 === 0 ? 'frente' : 'verso', pocket };
}

// ---------- Fichários livres ----------

export function customTotalSlots(b: CustomBinder) {
  return b.pages * pageSize(b);
}

/** Índices dos bolsos de uma página do fichário livre. */
export function customSlotsOnPage(b: CustomBinder, page: number) {
  const size = pageSize(b);
  return Array.from({ length: size }, (_, i) => page * size + i);
}

/** Folhas físicas de um fichário livre. */
export function customSheets(b: CustomBinder) {
  return b.doubleSided ? Math.ceil(b.pages / 2) : b.pages;
}

export function newBinderId() {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
