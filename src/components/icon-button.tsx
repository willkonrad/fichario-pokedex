import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps } from 'react';
import { Pressable, StyleSheet, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, semantic, TOUCH } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** O react-native-web também informa o mouse por cima (hovered), que os tipos do React Native não têm. */
export type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

/**
 * Botão só com ícone, com alvo de 48 × 48 px em todas as plataformas (padding, não hitSlop, que a web ignora).
 * `label` é obrigatório: é o que o leitor de tela diz ("Fechar", "Limpar a busca").
 */
export function IconButton({
  icon,
  label,
  onPress,
  size = 20,
  color = colors.text,
  disabled,
  tone = 'plain',
  style,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  size?: number;
  color?: string;
  disabled?: boolean;
  /** 'plain': transparente; 'soft': fundo grafite; 'onBrand': fundo translúcido sobre a barra preta do topo. */
  tone?: 'plain' | 'soft' | 'onBrand';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      role="button"
      accessibilityLabel={label}
      aria-disabled={disabled || !onPress}
      style={(state) => {
        const { pressed, hovered } = state as PressState;
        return [
          styles.button,
          tone === 'soft' && styles.soft,
          tone === 'onBrand' && styles.onBrand,
          hovered && !disabled && (tone === 'onBrand' ? styles.onBrandHover : styles.hover),
          pressed && { opacity: 0.6 },
          disabled && { opacity: 0.35 },
          style,
        ];
      }}>
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  soft: { backgroundColor: colors.surfaceAlt },
  onBrand: { backgroundColor: semantic.brand.soft },
  hover: { backgroundColor: semantic.hover.onLight },
  onBrandHover: { backgroundColor: semantic.hover.onBrand },
});
