// Arrastar cartas nos fichários livres: as contas do gesto, sem nada de tela.

/** Retângulo de um bolso, nas mesmas coordenadas do dedo. */
export type PocketRect = { slot: number; x: number; y: number; width: number; height: number };

/** Menos que isto (px) ainda é "segurou sem mexer". */
export const DRAG_SLOP = 8;
/** Faixa (px) junto das bordas de cima e de baixo da área visível que faz a folha rolar. */
export const AUTO_SCROLL_EDGE = 72;
/** Passo máximo da rolagem automática (px por quadro). */
export const AUTO_SCROLL_MAX = 14;
/** Faixa (px) em volta das bordas esquerda e direita da folha que vira a página. */
export const FLIP_EDGE = 36;
/** Tempo (ms) com o dedo nessa faixa para a página virar. */
export const FLIP_HOLD_MS = 600;

/** O dedo já andou o bastante para contar como arraste. */
export function movedEnough(dx: number, dy: number) {
  return Math.hypot(dx, dy) >= DRAG_SLOP;
}

/**
 * Bolso sob o dedo, ou null. `tolerance`: metade do vão entre os bolsos; no vão, vale o bolso mais perto, só até o meio
 * dele. Dentro de um bolso, vale sempre esse bolso.
 */
export function pocketAt(rects: readonly PocketRect[], x: number, y: number, tolerance = 0): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const r of rects) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.width));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.height));
    if (dx > tolerance || dy > tolerance) continue;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = r.slot;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Passo da rolagem automática: negativo sobe, positivo desce, 0 fica parada. Quanto mais perto da borda, mais rápido.
 * Numa área baixa, a faixa encolhe para sobrar um meio onde a folha não rola.
 */
export function autoScrollStep(y: number, top: number, bottom: number) {
  const edge = Math.min(AUTO_SCROLL_EDGE, (bottom - top) / 3);
  if (edge <= 0) return 0;
  const speed = (distance: number) => Math.max(1, Math.round((AUTO_SCROLL_MAX * (edge - Math.max(0, distance))) / edge));
  if (y - top < edge) return -speed(y - top);
  if (bottom - y < edge) return speed(bottom - y);
  return 0;
}

/** Lado para virar a página: -1 (anterior), 1 (próxima) ou 0, com o dedo a menos de `FLIP_EDGE` da borda da folha. */
export function edgeFlipDirection(x: number, sheetLeft: number, sheetRight: number): -1 | 0 | 1 {
  const edge = Math.min(FLIP_EDGE, (sheetRight - sheetLeft) / 3);
  if (Math.abs(x - sheetLeft) < edge) return -1;
  if (Math.abs(x - sheetRight) < edge) return 1;
  return 0;
}

/** O que fazer ao soltar: espiar a carta (não mexeu), devolver ao bolso dela ou mudar de lugar. */
export function dropOutcome(moved: boolean, source: number, over: number | null): 'peek' | 'cancel' | 'move' {
  if (!moved) return 'peek';
  return over == null || over === source ? 'cancel' : 'move';
}
