import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '@/components/layout';
import { NATIVE_DRIVER, useReducedMotion } from '@/components/motion';
import { elevation, radius, semantic, space, TOUCH } from '@/theme';

const WEB = Platform.OS === 'web';

/** Rótulo da ação que desfaz; na web, ela também responde ao Ctrl+Z (⌘Z no Mac). */
const UNDO = 'Desfazer';

export type ToastOptions = {
  /** Uma linha curta: "Charizard removido", "Pikachu ex colocado · pág. 2, bolso 5". */
  message: string;
  /** Ação do aviso: "Desfazer", "Ver". */
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Tempo na tela em ms (padrão: 4 s; 6 s quando há ação). O tempo para com o mouse por cima ou o foco no aviso; com
   * leitor de tela (VoiceOver, TalkBack), o aviso com ação só sai quando a pessoa fecha ou chega outro aviso.
   */
  duration?: number;
  /** 'error' é anunciado na hora e ganha a faixa vermelha. */
  tone?: 'neutral' | 'error';
};

type ToastEntry = ToastOptions & { id: number; leaving: boolean };

// Um aviso por vez: o novo substitui o anterior. Fica fora do React para que o store e as telas que acabaram de
// fechar (dismissTo) também possam avisar.
let current: ToastEntry | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return current;
}

/** Mostra um aviso no rodapé; devolve o id (para `hideToast(id)`). Pode ser chamado fora de componentes. */
export function showToast(options: ToastOptions) {
  current = { ...options, id: ++seq, leaving: false };
  emit();
  return current.id;
}

/** Esconde o aviso (só o de `id`, se informado). */
export function hideToast(id?: number) {
  if (!current || current.leaving || (id != null && current.id !== id)) return;
  current = { ...current, leaving: true };
  emit();
}

/**
 * Aciona a ação do aviso `id` uma vez só: um 2º toque durante a saída (ou um clique duplo) não repete o "Desfazer",
 * que numa troca de lugar trocaria as cartas de novo.
 */
export function runToastAction(id: number) {
  const entry = current;
  if (!entry || entry.id !== id || entry.leaving) return;
  hideToast(id);
  entry.onAction?.();
}

function removeToast(id: number) {
  if (current?.id !== id) return;
  current = null;
  emit();
}

const TOAST_API = { show: showToast, hide: hideToast };

/** `const toast = useToast(); toast.show({ message: 'Charizard removido', actionLabel: 'Desfazer', onAction })`. */
export function useToast() {
  return TOAST_API;
}

/**
 * Leitor de tela ligado (VoiceOver, TalkBack). Na web não dá para saber (o react-native-web sempre responde "sim"):
 * lá valem a pausa com o mouse e o foco e o Ctrl+Z.
 */
function useScreenReader() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (WEB) return;
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => {
        if (alive) setOn(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v: boolean) => setOn(v));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

/** Campo de texto, onde o Ctrl+Z desfaz a digitação (e não o aviso). */
function isTextField(target: EventTarget | null) {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !/^(checkbox|radio|button|submit|reset|range|color|file)$/.test(target.type);
}

/** Onde os avisos aparecem: montado uma vez no _layout, por cima de tudo (no iOS, também dos modais). */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const reduceMotion = useReducedMotion();
  const screenReader = useScreenReader();
  const [progress] = useState(() => new Animated.Value(0));
  // Mouse por cima e foco dentro do aviso (web): enquanto durarem, o tempo não corre.
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (!toast) return;
    if (toast.leaving) {
      const exit = Animated.timing(progress, { toValue: 0, duration: 140, useNativeDriver: NATIVE_DRIVER });
      exit.start(() => {
        // O aviso sai da tela sem "mouseleave" nem "blur": o próximo começa com o tempo correndo.
        setHover(false);
        setFocus(false);
        removeToast(toast.id);
      });
      return () => exit.stop();
    }
    Animated.timing(progress, { toValue: 1, duration: reduceMotion ? 0 : 180, useNativeDriver: NATIVE_DRIVER }).start();
    // O iOS não lê regiões "ao vivo": o aviso é anunciado à parte.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(toast.message);
  }, [toast, progress, reduceMotion]);

  // Tempo na tela: para com o mouse por cima ou o foco no aviso, e recomeça inteiro ao sair. Com leitor de tela, o
  // aviso com ação não some sozinho: o "Desfazer" é a única volta de uma remoção, e achá-lo leva tempo (WCAG 2.2.1).
  const held = hover || focus || (screenReader && !!toast?.actionLabel);
  useEffect(() => {
    if (!toast || toast.leaving || held) return;
    const timer = setTimeout(() => hideToast(toast.id), toast.duration ?? (toast.actionLabel ? 6000 : 4000));
    return () => clearTimeout(timer);
  }, [toast, held]);

  // Na web, Ctrl+Z (⌘Z) fora de um campo de texto aciona o "Desfazer": o aviso é o último na ordem do Tab, e com uma
  // folha aberta o foco nem chega a ele.
  useEffect(() => {
    if (!WEB || !toast || toast.leaving || toast.actionLabel !== UNDO) return;
    const id = toast.id;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || isTextField(e.target)) return;
      e.preventDefault();
      runToastAction(id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toast]);

  const ios = Platform.OS === 'ios';
  // No iOS, sem aviso, nada fica montado (o overlay é uma janela por cima do app).
  if (!toast && ios) return null;
  const error = toast?.tone === 'error';
  const translateY = reduceMotion ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  // Na web e no Android, a região "ao vivo" fica sempre montada (vazia sem aviso): o leitor de tela só anuncia o
  // que muda dentro de uma região que já existia. O iOS não lê regiões "ao vivo" (o aviso é anunciado à parte).
  const live = ios ? undefined : error ? 'assertive' : 'polite';
  // Acima do teclado aberto (ex.: "Adicionar por código", que reabre o campo para a próxima carta). No iOS, a altura do
  // teclado já cobre a área segura; no Android, vem sem a barra de navegação, que fica por baixo dele.
  const bottom = Platform.OS === 'android' ? insets.bottom + keyboard : Math.max(insets.bottom, keyboard);
  // Na web: mouse por cima e foco dentro seguram o aviso; Esc fecha (com o foco nele).
  const webHold = toast && WEB
    ? ({
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onFocus: () => setFocus(true),
        onBlur: (e: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocus(false);
        },
        onKeyDown: (e: { key: string }) => {
          if (e.key === 'Escape') hideToast(toast.id);
        },
      } as object)
    : null;
  const undoShortcut = WEB && toast?.actionLabel === UNDO ? ({ 'aria-keyshortcuts': 'Control+Z Meta+Z' } as object) : null;

  const content = (
    <View
      style={[styles.layer, { paddingBottom: bottom + space.lg }]}
      role={ios ? undefined : 'status'}
      aria-live={live}
      accessibilityLiveRegion={live}>
      {toast ? (
        <Animated.View
          {...webHold}
          style={[
            styles.toast,
            !toast.actionLabel && { paddingRight: space.lg },
            error && styles.toastError,
            { opacity: progress, transform: [{ translateY }] },
          ]}>
          <Pressable
            style={styles.body}
            onPress={() => hideToast(toast.id)}
            accessibilityLabel={toast.message}
            accessibilityHint="Toque para fechar o aviso">
            <Text style={styles.message} numberOfLines={3}>
              {toast.message}
            </Text>
          </Pressable>
          {toast.actionLabel ? (
            <Pressable
              onPress={() => runToastAction(toast.id)}
              role="button"
              accessibilityLabel={toast.actionLabel}
              {...undoShortcut}
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}>
              <Text style={styles.actionText}>{toast.actionLabel}</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );

  // No iOS, os modais (Minha coleção, Meus fichários) ficam numa janela por cima: o overlay sobe junto. Sem o modo
  // modal de acessibilidade, o VoiceOver continua vendo o app enquanto o aviso está na tela (o anúncio já lê o aviso).
  return ios ? <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>{content}</FullWindowOverlay> : content;
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    zIndex: 1000,
    pointerEvents: 'box-none',
  },
  toast: {
    width: '100%',
    maxWidth: 560,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: semantic.inverse.bg,
    borderRadius: radius.md,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    ...elevation[2],
  },
  toastError: { borderLeftWidth: 4, borderLeftColor: semantic.danger.solid },
  body: { flex: 1, paddingVertical: space.md, justifyContent: 'center', minHeight: TOUCH },
  message: { color: semantic.inverse.fg, fontSize: 15, lineHeight: 20, fontWeight: '500' },
  action: { minHeight: TOUCH, minWidth: TOUCH, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  actionText: { color: semantic.inverse.action, fontSize: 15, fontWeight: '700' },
});
