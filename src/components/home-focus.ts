import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';

const WEB = Platform.OS === 'web';

/**
 * Android: enquanto `active` (camada aberta numa tela que está na frente), o voltar chama `onClose` e para ali, em vez
 * de tirar o app da tela. O primeiro voltar com o teclado aberto só fecha o teclado (é do sistema).
 */
export function useCloseOnBack(active: boolean, onClose: () => void) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!active || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [active]);
}

/** Web: o elemento com foco de teclado agora (o do clique do mouse, não: o anel apareceria sozinho na volta). */
export function keyboardFocus(): HTMLElement | null {
  if (!WEB || typeof document === 'undefined') return null;
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return null;
  try {
    return el.matches(':focus-visible') ? el : null;
  } catch {
    return el;
  }
}

/** Esperas para devolver o foco: a tela coberta fica com display: none e só aceita foco depois de aparecer. */
const RETURN_TRIES_MS = [0, 250];

/**
 * Web: volta o foco ao controle que abriu outra tela (o bolso da carta, por exemplo) quando esta tela volta à frente.
 * Sem isto, o foco caía no `body` e o Tab seguinte recomeçava no topo da página. Guarda o controle acionado pelo
 * teclado (Enter, espaço ou o clique que o Enter gera num link) enquanto a tela está na frente.
 */
export function useFocusReturn(focused: boolean) {
  const last = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!WEB || !focused) return;
    const el = last.current;
    last.current = null;
    const note = (e: Event) => {
      if (e.type === 'click' || (e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') last.current = keyboardFocus();
    };
    window.addEventListener('click', note, true);
    window.addEventListener('keydown', note, true);
    const timers = el
      ? RETURN_TRIES_MS.map((ms) =>
          setTimeout(() => {
            const now = document.activeElement;
            if (el.isConnected && (!now || now === document.body)) el.focus({ preventScroll: true });
          }, ms),
        )
      : [];
    return () => {
      window.removeEventListener('click', note, true);
      window.removeEventListener('keydown', note, true);
      timers.forEach(clearTimeout);
    };
  }, [focused]);
}

/** O valor depois de `ms` sem mudar (o leitor de tela lê quando a pessoa para de digitar). */
export function useDebounced<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
