import { useEffect, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';

import { breakpoints, gutterFor, widths } from '@/theme';

export type LayoutSize = 'phone' | 'tablet' | 'desktop' | 'wide';

/** Tipo de tela pela largura da janela (W7). */
export function layoutSize(width: number): LayoutSize {
  return width >= breakpoints.wide ? 'wide' : width >= breakpoints.desktop ? 'desktop' : width >= breakpoints.tablet ? 'tablet' : 'phone';
}

/**
 * Colunas de uma grade de cartas: quantas células de ~`cell` px cabem em `width`, entre `min` e `max`.
 * Ex.: na lista de versões, `gridColumns(w)` dá 3 no celular e até 8 numa tela de 1440 px.
 */
export function gridColumns(width: number, { cell = 150, gap = 12, min = 3, max = 8 }: { cell?: number; gap?: number; min?: number; max?: number } = {}) {
  return Math.min(max, Math.max(min, Math.floor((width + gap) / (cell + gap))));
}

/**
 * Medidas da tela para montar o layout: tipo de tela, margem lateral e a largura útil para um tipo de
 * conteúdo (`contentWidth('form')`, `contentWidth('wide')`…), já descontadas as margens.
 */
export function useLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const size = layoutSize(width);
  const gutter = gutterFor(width);
  return {
    width,
    height,
    fontScale,
    size,
    gutter,
    isPhone: size === 'phone',
    /** Computador (≥ 960 px): duas colunas, barra única no topo. */
    isDesktop: size === 'desktop' || size === 'wide',
    contentWidth: (kind: keyof typeof widths = 'reading') => Math.max(0, Math.min(width - gutter * 2, widths[kind])),
  };
}

/**
 * Altura do teclado aberto (celular), para o que fica preso ao rodapé subir junto: no iOS e no Android (de ponta a
 * ponta) a tela não encolhe com o teclado. No iOS, a altura já cobre a área segura de baixo; no Android, vem sem a
 * barra de navegação (some `insets.bottom`). Na web, 0.
 */
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
