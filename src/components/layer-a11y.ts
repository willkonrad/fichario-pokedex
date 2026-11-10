// Acessibilidade das camadas da Consulta (folha da carta, filtros) e dos títulos: o nível do título na web e o foco que
// entra na camada, fica dentro dela e volta para quem a abriu.
import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

const WEB = Platform.OS === 'web';

/** Papel de título com nível; na web vira <h1>, <h2>… (sem `aria-level`, o react-native-web faz todo título virar <h1>). */
export function heading(level: 1 | 2 | 3) {
  return { role: 'heading' as const, ...((WEB ? { 'aria-level': level } : {}) as object) };
}

/** Dá o foco a um nó: na web, o do navegador; no celular, o do leitor de tela. Sem nó, nada. */
export function focusNode(node: unknown) {
  if (!node) return;
  if (WEB) (node as { focus?: () => void }).focus?.();
  else AccessibilityInfo.sendAccessibilityEvent?.(node as never, 'focus');
}

/**
 * Quem abriu a camada, para o foco voltar a ele: o nó tocado (a célula, o botão) ou, na web, o que tinha o foco. Campo
 * de texto não conta: devolver o foco a ele abriria o teclado de novo.
 */
export function openerOf(node?: unknown): unknown {
  if (node) return node;
  if (!WEB || typeof document === 'undefined') return null;
  const el = document.activeElement;
  return el && el !== document.body && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' ? el : null;
}

export type FocusReturn = {
  /** A camada abriu a partir deste nó (a célula, o botão; sem ele, na web, o que tinha o foco). */
  from: (node?: unknown) => void;
  /** A pessoa fechou a camada: o foco volta para quem a abriu quando `open` virar falso. */
  back: () => void;
  /** A camada deu lugar a outra coisa (outra folha, outra tela): o foco não volta. */
  forget: () => void;
};

/**
 * Foco de volta para quem abriu uma camada. Volta só depois de `open` virar falso, quando o que fica atrás já voltou a
 * valer (`inert` na web, `importantForAccessibility` no Android): antes disso, o nó não aceitaria o foco.
 */
export function useFocusReturn(open: boolean): FocusReturn {
  const opener = useRef<unknown>(null);
  const pending = useRef<unknown>(null);
  useEffect(() => {
    if (open || !pending.current) return;
    const node = pending.current;
    pending.current = null;
    focusNode(node);
  }, [open]);
  return useMemo(
    () => ({
      from: (node) => {
        opener.current = openerOf(node);
      },
      back: () => {
        pending.current = opener.current;
        opener.current = null;
      },
      forget: () => {
        opener.current = null;
      },
    }),
    [],
  );
}

/** Web: com uma camada aberta, o que fica atrás sai do Tab, do clique e do leitor de tela. */
export function inertWhen(hidden: boolean) {
  return (WEB && hidden ? { inert: true } : {}) as object;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
// Valores de Node.compareDocumentPosition.
const PRECEDING = 2;
const FOLLOWING = 4;

type TabEvent = { key: string; shiftKey?: boolean; currentTarget: unknown; preventDefault: () => void };

/** Web: Tab e Shift+Tab dão a volta dentro da camada (`onKeyDown` dela); o foco nunca cai no que está atrás. */
export function keepTabInside(e: TabEvent) {
  // O evento da web chega pelo react-native-web (os tipos do React Native descrevem o do Android).
  if (e.key !== 'Tab' || typeof document === 'undefined') return;
  const box = e.currentTarget as HTMLElement;
  const list = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (!list.length) return;
  const at = document.activeElement as HTMLElement | null;
  const target = e.shiftKey ? list[list.length - 1] : list[0];
  if (!at || !box.contains(at)) {
    e.preventDefault();
    target.focus();
    return;
  }
  const next = list.some((el) => at.compareDocumentPosition(el) & (e.shiftKey ? PRECEDING : FOLLOWING));
  if (!next) {
    e.preventDefault();
    target.focus();
  }
}

/** Props da camada (folha, filtros) para o Tab dar a volta dentro dela, só na web. */
export const TAB_INSIDE = (WEB ? { onKeyDown: keepTabInside } : {}) as object;
