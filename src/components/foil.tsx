import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { foil } from '@/theme';

/**
 * Filete foil em volta da carta especial (1ª edição, staff, promos com selo, raras altas): o brilho metálico do visual,
 * reservado a ela. Fica por fora do conteúdo: o `radius` é o do filete, e o conteúdo usa `radius - width`.
 */
export function FoilRing({
  radius,
  width = 2,
  style,
  children,
}: {
  radius: number;
  width?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <LinearGradient colors={foil} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ padding: width, borderRadius: radius }, style]}>
      {children}
    </LinearGradient>
  );
}
