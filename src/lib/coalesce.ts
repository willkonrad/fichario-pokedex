import type { Entry } from '@/lib/types';

/** Fonte com aviso de mudança (o store da coleção, por exemplo). */
type Source<T> = { get: () => T; subscribe: (fn: () => void) => () => void };

/**
 * Filtro para o useSyncExternalStore: a mudança que `canWait` aprova espera até `windowMs` e entra junto com as que
 * chegarem nesse tempo (uma rajada desenha no máximo uma vez por janela). A que ele recusa passa na hora, levando junto
 * o que esperava.
 */
export function coalesce<T>(source: Source<T>, canWait: (shown: T, live: T) => boolean, windowMs: number) {
  const listeners = new Set<() => void>();
  // Lido só ao desenhar ou ao ligar (a fonte pode ainda não existir quando o módulo abre).
  let shown!: T;
  let stop: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const live = source.get();
    if (live === shown) return;
    shown = live;
    listeners.forEach((listener) => listener());
  }

  function onChange() {
    const live = source.get();
    if (live === shown) return;
    if (!canWait(shown, live)) flush();
    else if (timer === undefined) timer = setTimeout(flush, windowMs);
  }

  return {
    // Sem ninguém ouvindo, nada avisa das mudanças: vale o valor de agora.
    getSnapshot: () => (stop ? shown : (shown = source.get())),
    subscribe(listener: () => void) {
      if (!stop) {
        shown = source.get();
        stop = source.subscribe(onChange);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        stop?.();
        stop = undefined;
        clearTimeout(timer);
        timer = undefined;
      };
    },
  };
}

/** O que a busca de preço grava na carta: o preço de cada fonte, a regra do "Meu valor" e a data. */
const PRICE_FIELDS = new Set<string>(['mypApi', 'tcgplayer', 'myValue', 'myValueReplaced', 'updatedAt']);

function samePriceless(a: Entry, b: Entry) {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (PRICE_FIELDS.has(k) || x[k] === y[k]) continue;
    // Listas (selos) chegam do banco como objeto novo: compara o conteúdo.
    if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) return false;
  }
  return true;
}

/**
 * Só o preço mudou: os mesmos bolsos, e cada carta alterada mudou só no que a busca de preço grava. Carta que entra,
 * sai, troca de bolso, de versão ou de imagem não espera.
 */
export function onlyPricesChanged(before: Record<string, Entry>, after: Record<string, Entry>) {
  const ids = Object.keys(after);
  if (ids.length !== Object.keys(before).length) return false;
  return ids.every((id) => {
    const a = before[id];
    const b = after[id];
    return a === b || (!!a && samePriceless(a, b));
  });
}
