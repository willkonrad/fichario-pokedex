import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useCollection } from '@/store/collection';
import { colors } from '@/theme';

/** Cartas que o usuário já colocou em algum fichário, como "<id da carta>|<idioma>". */
export function useOwnedCards() {
  const { entries } = useCollection();
  return useMemo(() => new Set(Object.values(entries).map((e) => `${e.cardId}|${e.lang}`)), [entries]);
}

/** Selo "tenho" sobre a miniatura da carta. */
export function OwnedBadge() {
  return (
    <View style={styles.badge} accessibilityLabel="Você já tem esta carta">
      <Ionicons name="checkmark" size={11} color="#0B0B0D" />
      <Text style={styles.text}>tenho</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.success,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: { color: '#0B0B0D', fontSize: 10, fontWeight: '800' },
});
