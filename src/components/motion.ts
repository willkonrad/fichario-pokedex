import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** O Animated do React Native só usa o driver nativo fora da web. */
export const NATIVE_DRIVER = Platform.OS !== 'web';

// "Reduzir movimento" do sistema (no navegador, prefers-reduced-motion): lido uma vez e acompanhado depois.
let reduced = false;
const listeners = new Set<() => void>();
let started = false;

function start() {
  if (started) return;
  started = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((v) => {
      reduced = v;
      listeners.forEach((l) => l());
    })
    .catch(() => {});
  try {
    AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      reduced = v;
      listeners.forEach((l) => l());
    });
  } catch {
    // Plataforma sem o evento: fica o valor lido no início.
  }
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Se o sistema pede menos movimento (fora de componentes, sem acompanhar mudanças). */
export function prefersReducedMotion() {
  start();
  return reduced;
}

// Leitura pura para o React (quem começa a acompanhar é o subscribe).
function getSnapshot() {
  return reduced;
}

/** Se o sistema pede menos movimento: as animações viram só um esmaecer rápido (ou nada). */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
