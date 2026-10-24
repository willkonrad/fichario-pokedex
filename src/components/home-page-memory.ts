import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

// Lembranças da home neste aparelho: a última página de cada fichário (H5) e quantas vezes cada dica já apareceu.
// Conveniência por aparelho: se o armazenamento falhar, a home abre na página 1 e mostra a dica, sem aviso.

const PAGES_KEY = 'home:pages';
const HINTS_KEY = 'home:hints';
const WRITE_DELAY_MS = 500;

let pages: Record<string, number> = {};
let hints: Record<string, number> = {};
let ready = false;
let started = false;
const listeners = new Set<() => void>();

function parseCounts(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isInteger(n) && n >= 0) out[k] = n;
    return out;
  } catch {
    return {};
  }
}

function start() {
  if (started) return;
  started = true;
  (async () => {
    try {
      for (const [k, v] of await AsyncStorage.multiGet([PAGES_KEY, HINTS_KEY])) {
        if (k === PAGES_KEY) pages = { ...parseCounts(v), ...pages };
        if (k === HINTS_KEY) hints = { ...parseCounts(v), ...hints };
      }
    } catch {
      // Sem armazenamento (janela anônima, bloqueado): fica a página 1.
    }
    ready = true;
    listeners.forEach((l) => l());
  })();
}

/** Grava sem deixar o erro subir (armazenamento cheio ou bloqueado). */
function save(key: string, value: unknown) {
  try {
    AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
  } catch {
    // idem
  }
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getReady = () => ready;

/** A home espera a leitura (rápida) para abrir já na página lembrada, sem pular depois. */
export function usePageMemoryReady() {
  return useSyncExternalStore(subscribe, getReady, getReady);
}

/** Última página (a partir de 0) aberta no fichário, neste aparelho. */
export function rememberedPage(binderId: string): number | undefined {
  return pages[binderId];
}

let pagesTimer: ReturnType<typeof setTimeout> | undefined;

/** Guarda a página aberta (gravada meio segundo depois da última troca, para não gravar a cada página folheada). */
export function rememberPage(binderId: string, page: number) {
  if (pages[binderId] === page) return;
  pages = { ...pages, [binderId]: page };
  clearTimeout(pagesTimer);
  pagesTimer = setTimeout(() => save(PAGES_KEY, pages), WRITE_DELAY_MS);
}

/** Quantas aberturas do app já mostraram a dica. */
export function hintSeen(name: string) {
  return hints[name] ?? 0;
}

const countedThisSession = new Set<string>();

/** Conta mais uma abertura com a dica (uma vez por abertura do app); `done` = não mostrar mais. */
export function markHint(name: string, done = false) {
  if (!done && countedThisSession.has(name)) return;
  countedThisSession.add(name);
  hints = { ...hints, [name]: done ? 99 : (hints[name] ?? 0) + 1 };
  save(HINTS_KEY, hints);
}
