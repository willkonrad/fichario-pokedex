import { useEffect } from 'react';
import { Animated, Easing, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { NATIVE_DRIVER, prefersReducedMotion, useReducedMotion } from '@/components/motion';
import { binderColors, CARD_RATIO, colors, radius as radii } from '@/theme';

// Um pulso só para todos os esqueletos da tela: ficam em sincronia e custam uma animação.
const pulse = new Animated.Value(1);
let users = 0;
let loop: Animated.CompositeAnimation | null = null;

function acquire() {
  users += 1;
  if (loop || prefersReducedMotion()) return;
  loop = Animated.loop(
    Animated.sequence([
      Animated.timing(pulse, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
    ]),
  );
  loop.start();
}

function release() {
  users = Math.max(0, users - 1);
  if (users === 0 && loop) {
    loop.stop();
    loop = null;
    pulse.setValue(1);
  }
}

/**
 * Bloco grafite no lugar de algo que ainda está carregando (H1): imagem, linha de texto, valor. O pulso só escurece
 * o bloco: nada de clarão sobre o preto. `tone="dark"` para a folha do fichário; `"light"`, para o resto do app.
 * Fica escondido do leitor de tela.
 */
export function Skeleton({
  width,
  height,
  radius = radii.sm,
  tone = 'light',
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  tone?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    acquire();
    return release;
  }, []);
  return (
    <Animated.View
      aria-hidden
      style={[
        { width, height, borderRadius: radius, backgroundColor: tone === 'dark' ? binderColors.pocketBorder : colors.surfaceAlt },
        { opacity: reduceMotion ? 0.8 : pulse },
        style,
      ]}
    />
  );
}

/** Esqueleto na proporção de uma carta (63 × 88): dê a largura, ou deixe ocupar a largura do pai. */
export function CardSkeleton({ width, tone, style }: { width?: number; tone?: 'light' | 'dark'; style?: StyleProp<ViewStyle> }) {
  return (
    <Skeleton
      width={width ?? '100%'}
      height={width != null ? width / CARD_RATIO : undefined}
      radius={radii.card}
      tone={tone}
      style={[width == null && { aspectRatio: CARD_RATIO }, style]}
    />
  );
}

/** Linhas de texto em esqueleto (a última mais curta). */
export function TextSkeleton({ lines = 2, lineHeight = 14, tone }: { lines?: number; lineHeight?: number; tone?: 'light' | 'dark' }) {
  return (
    <>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? '60%' : '100%'} height={lineHeight} radius={lineHeight / 2} tone={tone} style={{ marginVertical: 3 }} />
      ))}
    </>
  );
}
