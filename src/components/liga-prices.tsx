import { StyleSheet, Text, View } from 'react-native';

import { finishMatchesVariant } from '@/lib/liga-api';
import { formatBRLTight } from '@/lib/quotes';
import type { Price } from '@/lib/types';
import { colors, radius } from '@/theme';

type Range = { min?: number; avg?: number; max?: number };

// Largura de cada coluna de valor; cabe "R$ 9.999,90" em 12px.
const CELL = 66;
// Cores das barrinhas, no estilo do quadro da Liga: menor, médio, maior.
const BAR = { min: '#8BD66B', avg: '#E8C25A', max: '#E0D7A8' };

/**
 * Quadro de preços da Liga por acabamento (Normal, Foil, Reverse Foil…),
 * com menor / médio / maior em cada linha e a linha da variação da carta destacada.
 */
export function LigaPrices({
  finishes,
  price,
  variant,
}: {
  finishes?: Record<string, Range>;
  price?: Price;
  variant: string;
}) {
  const rows: [string, Range][] = finishes && Object.keys(finishes).length ? Object.entries(finishes) : price ? [['Geral', price]] : [];

  return (
    <View style={styles.table}>
      <Text style={styles.title}>Preços anunciados por acabamento</Text>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }} />
        <Text style={styles.headerCol}>Menor</Text>
        <Text style={styles.headerCol}>Médio</Text>
        <Text style={styles.headerCol}>Maior</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.empty}>—</Text>
      ) : (
        rows.map(([name, r]) => {
          const mine = name === 'Geral' || finishMatchesVariant(name, variant);
          return (
            <View key={name} style={[styles.row, mine && styles.rowMine]}>
              <View style={styles.finish}>
                <View style={[styles.badge, mine && styles.badgeMine]}>
                  <Text style={[styles.badgeText, mine && { color: colors.accent }]}>{name[0]?.toUpperCase()}</Text>
                </View>
                <Text style={[styles.finishName, mine && { color: colors.text }]} numberOfLines={1}>
                  {name}
                </Text>
              </View>
              <Cell value={r.min} bar={BAR.min} />
              <Cell value={r.avg} bar={BAR.avg} />
              <Cell value={r.max} bar={BAR.max} />
            </View>
          );
        })
      )}
    </View>
  );
}

function Cell({ value, bar }: { value?: number; bar: string }) {
  return (
    <View style={[styles.cell, { borderLeftColor: bar }]}>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {formatBRLTight(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  table: { backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 13, fontWeight: '700', paddingHorizontal: 10, paddingTop: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 4, paddingBottom: 2, gap: 4 },
  headerCol: { width: CELL, color: colors.textMuted, fontSize: 11, paddingLeft: 7 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 9, gap: 4 },
  rowMine: { backgroundColor: colors.accentSoft },
  finish: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeMine: { borderColor: colors.accent },
  badgeText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  finishName: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  cell: { width: CELL, borderLeftWidth: 3, paddingLeft: 5 },
  value: { color: colors.text, fontSize: 12 },
  empty: { color: colors.textMuted, paddingHorizontal: 12, paddingVertical: 10 },
});
