import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, semantic } from '@/theme';

/**
 * Conteúdo de um <Text> com cada "✎" trocado pelo ícone de lápis (o glifo muda de cara conforme a fonte do aparelho).
 * Só o desenho muda: o texto salvo e as frases de lib/copy.ts continuam com o ✎. O ícone fica escondido do leitor de tela.
 */
export function withMarkIcons(text: string, { size, color }: { size: number; color: string }): ReactNode {
  const parts = text.split(semantic.myValue.mark);
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) => [i > 0 && <Ionicons key={i} name="pencil" size={size} color={color} allowFontScaling aria-hidden />, part]).filter(Boolean);
}

/**
 * Poké Ball em SVG (D1): substitui o ícone "pokeball" da MaterialCommunityIcons, que trazia a fonte inteira
 * (1,3 MB) só para ele. Decorativa por padrão; com `label`, vira imagem com nome para o leitor de tela.
 */
export function PokeballIcon({
  size = 24,
  color = colors.text,
  label,
  style,
}: {
  size?: number;
  color?: string;
  /** Nome lido pelo leitor de tela; sem ele, o ícone fica escondido (é enfeite). */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden={!label}
      role={label ? 'img' : undefined}
      aria-label={label}>
      <Circle cx={12} cy={12} r={9.1} stroke={color} strokeWidth={2.1} fill="none" />
      <Path d="M2.9 12H8.7M15.3 12H21.1" stroke={color} strokeWidth={2.1} />
      <Circle cx={12} cy={12} r={3.3} stroke={color} strokeWidth={2.1} fill="none" />
    </Svg>
  );
}
