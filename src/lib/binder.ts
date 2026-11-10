import { TOTAL_SPECIES } from '@/data/pokedex';

import type { BinderSettings, CustomBinder, Entry } from './types';

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

/** Posição (índice corrido) de uma carta do fichário Pokédex: espaço do Pokémon ou bolso livre (`dex` 0). */
export function indexOfEntry(s: BinderSettings, e: Pick<Entry, 'dex' | 'slot'>) {
  return e.dex === 0 ? indexOfExtra(s, e.slot) : indexOfDex(s, e.dex, e.slot);
}

// ---------- Cartas fora do fichário (F2) ----------

/**
 * A carta do fichário Pokédex aparece na configuração atual? Fica de fora (continua salva e somada, mas sem bolso)
 * quando o Pokémon saiu da faixa, quando o espaço passou de "Espaços por Pokémon" ou quando sobraram menos bolsos
 * livres na última página.
 */
export function isPlaced(s: BinderSettings, e: Pick<Entry, 'dex' | 'slot'>) {
  if (e.slot < 0) return false;
  if (e.dex === 0) return e.slot < extraSlots(s);
  return inDexRange(s, e.dex) && e.slot < s.slotsPerPokemon;
}

/** A carta do fichário livre cabe nas páginas dele (diminuir as páginas deixa as do fim de fora). */
export function isPlacedCustom(b: CustomBinder, e: Pick<Entry, 'slot'>) {
  return e.slot >= 0 && e.slot < customTotalSlots(b);
}

// ---------- Regiões (régua da home) ----------

/** Regiões da Pokédex nacional, na ordem dos jogos. */
export const REGIONS = [
  { id: 'kanto', label: 'Kanto', from: 1, to: 151 },
  { id: 'johto', label: 'Johto', from: 152, to: 251 },
  { id: 'hoenn', label: 'Hoenn', from: 252, to: 386 },
  { id: 'sinnoh', label: 'Sinnoh', from: 387, to: 493 },
  { id: 'unova', label: 'Unova', from: 494, to: 649 },
  { id: 'kalos', label: 'Kalos', from: 650, to: 721 },
  { id: 'alola', label: 'Alola', from: 722, to: 809 },
  { id: 'galar', label: 'Galar', from: 810, to: 905 },
  { id: 'paldea', label: 'Paldea', from: 906, to: TOTAL_SPECIES },
] as const;

export type Region = { id: string; label: string; from: number; to: number; count: number };

/** Regiões que o fichário Pokédex cobre, cortadas na faixa dele (ex.: #100–#200 → Kanto 100–151 e Johto 152–200). */
export function regionsIn(s: BinderSettings): Region[] {
  const { from, to } = dexRange(s);
  return REGIONS.filter((r) => r.to >= from && r.from <= to).map((r) => {
    const a = Math.max(r.from, from);
    const b = Math.min(r.to, to);
    return { id: r.id, label: r.label, from: a, to: b, count: b - a + 1 };
  });
}

/** Região de um Pokémon (pelo número). */
export function regionOf(dex: number) {
  return REGIONS.find((r) => dex >= r.from && dex <= r.to);
}

// ---------- Posição física (folha, frente/verso, bolso e volume) ----------

export type PhysicalPosition = {
  page: number;
  sheet: number;
  side: 'frente' | 'verso' | null;
  pocket: number;
  /**
   * Com as folhas do fichário físico informadas (`sheets`): em qual fichário físico a página cai (1, 2…) e a folha
   * dentro dele. A Pokédex completa em 3×3 frente e verso precisa de 57 folhas, mais que um fichário de 40.
   */
  volume?: number;
  volumeSheet?: number;
};

/** Posição física: folha, frente/verso e bolso (e o volume, com `sheets`) — útil para achar a carta no fichário. */
export function physicalPosition(s: Grid & { sheets?: number }, index: number): PhysicalPosition {
  const size = pageSize(s);
  const page = Math.floor(index / size);
  const pocket = (index % size) + 1;
  const sheet = s.doubleSided ? Math.floor(page / 2) + 1 : page + 1;
  const side = s.doubleSided ? (page % 2 === 0 ? 'frente' : 'verso') : null;
  const pos: PhysicalPosition = { page: page + 1, sheet, side, pocket };
  if (s.sheets && s.sheets > 0) {
    pos.volume = Math.floor((sheet - 1) / s.sheets) + 1;
    pos.volumeSheet = ((sheet - 1) % s.sheets) + 1;
  }
  return pos;
}

/**
 * Lado da lombada e dos furos da página (`page` a partir de 0). Frente e verso: a frente (pág. 1, 3, 5…) fura à esquerda
 * e o verso (pág. 2, 4, 6…), à direita. Só frente: sempre à esquerda.
 */
export function spineSide(doubleSided: boolean, page: number): 'left' | 'right' {
  return doubleSided && page % 2 === 1 ? 'right' : 'left';
}

/**
 * Páginas abertas lado a lado (índices a partir de 0): [0] com a capa à esquerda, [1, 2], [3, 4]… e a última sozinha
 * com a contracapa à direita, se cair à esquerda. A da esquerda é sempre verso e a da direita, frente (`spineSide`).
 */
export function spreadOf(page: number, pages: number) {
  if (page <= 0) return [0];
  const left = page % 2 === 1 ? page : page - 1;
  return left + 1 < pages ? [left, left + 1] : [left];
}

// ---------- Encaixe da folha na tela ----------

export type PocketFit = {
  /** Largura do bolso. */
  width: number;
  /** Altura das linhas da página, com os vãos entre elas. */
  height: number;
  /** Nem no bolso mínimo a página cabe na altura: só a área dela rola. */
  overflow: boolean;
};

/**
 * Largura do bolso para a página caber na largura E na altura livres (`width` e `height`: o espaço das colunas e das
 * linhas, já sem margens e lombada). Encolhe até `min`; se nem assim couber, sobra na altura (`overflow`), nunca na
 * largura. `priceHeight(w)`: bloco de preço embaixo do bolso de largura `w` (0 sem preços). `ratio`: largura ÷ altura.
 */
export function fitPocket({
  width,
  height,
  rows,
  cols,
  gap,
  ratio,
  priceHeight,
  min,
  max = Infinity,
}: {
  width: number;
  height: number;
  rows: number;
  cols: number;
  gap: number;
  ratio: number;
  priceHeight: (w: number) => number;
  min: number;
  max?: number;
}): PocketFit {
  const byWidth = Math.max(1, Math.floor((width - gap * (cols - 1)) / cols));
  const rowRoom = (height - gap * (rows - 1)) / rows;
  const byRow = (w: number) => Math.floor((rowRoom - priceHeight(w)) * ratio);
  // O bloco de preço diminui no bolso pequeno: a conta é refeita com a largura achada.
  const first = byRow(byWidth);
  const second = byRow(first);
  const byHeight = priceHeight(second) === priceHeight(first) ? second : first;
  const pocket = Math.max(1, Math.min(byWidth, max, Math.max(min, byHeight)));
  const total = rows * (Math.floor(pocket / ratio) + priceHeight(pocket)) + gap * (rows - 1);
  return { width: pocket, height: total, overflow: total > height };
}

/** Com a busca aberta no celular, encolher mais que isto (px) é o teclado; menos, um aviso ou dica que entrou na tela. */
export const KEYBOARD_MIN = 120;

/**
 * A área da folha encolheu por causa do teclado (então a folha guarda a altura de antes). Compara a área, e não a janela:
 * no Android, o teclado encolhe a tela do app sem mudar a medida da janela. `keyboard`: altura avisada pelo sistema (0 na web).
 */
export function squeezedByKeyboard(heldHeight: number, height: number, keyboard: number) {
  return keyboard > 0 || heldHeight - height > KEYBOARD_MIN;
}

/** Folhas que o fichário Pokédex ocupa (com os bolsos livres da última página). */
export function sheetsNeeded(s: BinderSettings) {
  return Math.ceil(totalPages(s) / (s.doubleSided ? 2 : 1));
}

/** Quantos fichários físicos a Pokédex ocupa, com as folhas informadas (1 sem elas). */
export function volumesNeeded(s: BinderSettings) {
  return s.sheets && s.sheets > 0 ? Math.max(1, Math.ceil(sheetsNeeded(s) / s.sheets)) : 1;
}

/** Para o setup: "Cabe em 2 fichários de 40 folhas" (só quando passa de um). */
export function volumesText(s: BinderSettings) {
  const n = volumesNeeded(s);
  return n > 1 && s.sheets ? `Cabe em ${n} fichários de ${s.sheets} folhas` : undefined;
}

/**
 * Posição física em texto: "Pág. 3 · folha 2 (frente) · bolso 4" e, quando a Pokédex ocupa mais de um fichário físico
 * (`volumes` > 1), "Fichário 2 · folha 5 (frente) · bolso 8".
 */
export function physicalLabel(pos: PhysicalPosition, volumes = 1) {
  if (volumes > 1 && pos.volume != null) {
    return `Fichário ${pos.volume} · folha ${pos.volumeSheet}${pos.side ? ` (${pos.side})` : ''} · bolso ${pos.pocket}`;
  }
  return `Pág. ${pos.page}${pos.side ? ` · folha ${pos.sheet} (${pos.side})` : ''} · bolso ${pos.pocket}`;
}

/**
 * "pág. 2, bolso 5": a página e o bolso dentro dela (`index` corrido, a partir de 0). "Bolso" é sempre a posição na
 * página, a física (como na tela da carta, no "+ Carta" e na busca na coleção).
 */
export function pagePocketText(s: Pick<Grid, 'rows' | 'cols'>, index: number) {
  const size = pageSize(s);
  return `pág. ${Math.floor(index / size) + 1}, bolso ${(index % size) + 1}`;
}

/**
 * Bolso do fichário livre em texto: "pág. 2, bolso 5 · nº 25". O "nº" é o número corrido do bolso no fichário (o que
 * aparece no bolso, a busca da home procura e o "Mover para…" pede), para não se confundir com o bolso da página.
 */
export function customPlaceText(b: Pick<Grid, 'rows' | 'cols'>, slot: number) {
  return `${pagePocketText(b, slot)} · nº ${slot + 1}`;
}

/**
 * Mesmo lugar no fichário físico: mesma folha, lado e bolso (folha só de frente = o lado da frente). O volume só conta
 * quando as duas configurações informam as folhas.
 */
const samePlace = (a: PhysicalPosition, b: PhysicalPosition) =>
  a.sheet === b.sheet &&
  (a.side ?? 'frente') === (b.side ?? 'frente') &&
  a.pocket === b.pocket &&
  (a.volume == null || b.volume == null || (a.volume === b.volume && a.volumeSheet === b.volumeSheet));

/**
 * Quantas cartas do fichário Pokédex mudam de lugar no fichário físico (página ou bolso; ou de volume, com as folhas)
 * ao trocar a configuração `before` por `after`, quantas ficam de fora por causa da troca (`hidden`) e quantas que
 * estavam fora voltam a ter bolso (`shown`) (F7: o setup avisa antes de salvar). As que já estavam fora e continuam fora
 * não entram em nenhuma conta.
 */
export function physicalMoves(before: BinderSettings, after: BinderSettings, entries: Pick<Entry, 'binderId' | 'dex' | 'slot'>[]) {
  let moved = 0;
  let hidden = 0;
  let shown = 0;
  for (const e of entries) {
    if (e.binderId) continue;
    if (!isPlaced(before, e)) {
      if (isPlaced(after, e)) shown++;
      continue;
    }
    if (!isPlaced(after, e)) {
      hidden++;
      continue;
    }
    if (!samePlace(physicalPosition(before, indexOfEntry(before, e)), physicalPosition(after, indexOfEntry(after, e)))) moved++;
  }
  return { moved, hidden, shown };
}

/** O mesmo para um fichário livre (grade, frente e verso ou páginas): cartas que mudam de lugar, saem e voltam. */
export function customPhysicalMoves(before: CustomBinder, after: CustomBinder, entries: Pick<Entry, 'binderId' | 'slot'>[]) {
  let moved = 0;
  let hidden = 0;
  let shown = 0;
  for (const e of entries) {
    if (e.binderId !== before.id) continue;
    if (!isPlacedCustom(before, e)) {
      if (isPlacedCustom(after, e)) shown++;
      continue;
    }
    if (!isPlacedCustom(after, e)) {
      hidden++;
      continue;
    }
    if (!samePlace(physicalPosition(before, e.slot), physicalPosition(after, e.slot))) moved++;
  }
  return { moved, hidden, shown };
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
