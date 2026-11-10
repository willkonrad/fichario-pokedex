import { useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, Platform, TextInput, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space } from '@/theme';

const ANDROID = Platform.OS === 'android';
/** Folga entre o campo em foco e o topo do teclado. */
const GAP = space.lg;
/** No iOS, o próprio ScrollView abre espaço para o teclado e mostra o campo em foco. */
const SCROLL_PROPS = Platform.OS === 'ios' ? { automaticallyAdjustKeyboardInsets: true } : {};

/**
 * Espaço no fim da rolagem: `base` ou, com o teclado aberto, o bastante para o fim do conteúdo ficar acima dele. No
 * Android a altura do teclado vem sem a barra de navegação (`insetBottom`), que também fica embaixo dele.
 */
export function keyboardBottomPad(base: number, keyboard: number, insetBottom: number) {
  return keyboard > 0 ? Math.max(base, keyboard + insetBottom + space.xxl) : base;
}

/** Rola até o campo em foco se ele estiver embaixo do teclado (topo do teclado em `top`, na janela). */
function revealFocused(scrollRef: RefObject<ScrollViewInstance | null>, top: RefObject<number | null>) {
  // Depois do quadro: o espaço do teclado no fim da rolagem já está na tela (senão a rolagem para antes do campo).
  requestAnimationFrame(() => {
    const kbTop = top.current;
    const input = TextInput.State.currentlyFocusedInput();
    const scroll = scrollRef.current;
    if (kbTop == null || !input || !scroll) return;
    input.measureInWindow((_x, y, _w, h) => {
      if (y + h + GAP <= kbTop) return;
      // A conta do ScrollView supõe a rolagem no alto da janela: o deslocamento dela (abaixo do cabeçalho) vai junto.
      scroll.measureInWindow((_sx, sy) => scroll.scrollResponderScrollNativeHandleToKeyboard(input, GAP + sy, true));
    });
  });
}

/**
 * Teclado sobre uma tela com rolagem. No Android de ponta a ponta a janela não encolhe com o teclado (ver
 * `useKeyboardHeight`): o campo do fim da tela ficava embaixo dele, sem rolagem que o tirasse de lá. `bottomPad` dá o
 * espaço no fim da rolagem e `onFocus` (em cada campo) rola até o campo em foco; o teclado abrindo também rola. No
 * iOS, `scrollProps` liga o ajuste do próprio ScrollView; na web, nada muda.
 */
export function useKeyboardAvoid(scrollRef: RefObject<ScrollViewInstance | null>) {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(() => (ANDROID && Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0));
  const top = useRef<number | null>(null);
  useEffect(() => {
    if (!ANDROID) return;
    top.current = Keyboard.isVisible() ? (Keyboard.metrics()?.screenY ?? null) : null;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      top.current = e.endCoordinates.screenY;
      setHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      top.current = null;
      setHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // O teclado abriu ou mudou de altura (outro tipo de teclado): o campo em foco sai de baixo dele.
  useEffect(() => {
    if (height) revealFocused(scrollRef, top);
  }, [height, scrollRef]);
  return {
    bottomPad: (base: number) => keyboardBottomPad(base, height, insets.bottom),
    onFocus: () => {
      if (ANDROID) revealFocused(scrollRef, top);
    },
    scrollProps: SCROLL_PROPS,
  };
}
