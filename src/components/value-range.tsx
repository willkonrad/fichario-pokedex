import { StyleSheet, Text, View } from 'react-native';

import { formatBRL, formatBRLTight } from '@/lib/quotes';
import type { ValueRange } from '@/lib/valuation';
import { colors } from '@/theme';

const COLUMNS = [
  { id: 'min', label: 'Mín' },
  { id: 'avg', label: 'Média' },
  { id: 'max', label: 'Máx' },
] as const;

/**
 * Mínimo, média e máximo lado a lado, com a média em destaque: o valor da carta (ou da coleção) como a API do MYP
 * informa. `onPrimary` desenha sobre o fundo vermelho (Minha coleção).
 */
export function ValueRangeRow({
  range,
  avgColor,
  onPrimary = false,
  size = 'md',
}: {
  range: ValueRange;
  /** Cor da média (ex.: a cor da confiança). */
  avgColor?: string;
  onPrimary?: boolean;
  size?: 'md' | 'lg';
}) {
  const big = size === 'lg';
  // A fonte diminui com o tamanho do texto ("R$ 12.345"): adjustsFontSizeToFit não existe na versão web, e a coluna
  // da média tem cerca de 120 px num celular de 375 px.
  const text = { min: formatBRLTight(range.min), avg: formatBRLTight(range.avg), max: formatBRLTight(range.max) };
  const sideLen = Math.max(text.min.length, text.max.length);
  const avgSize = fit(big ? 32 : 26, text.avg.length, big ? 7 : 8);
  const sideSize = fit(big ? 18 : 16, sideLen, 8);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Mínimo ${formatBRL(range.min)}, média ${formatBRL(range.avg)}, máximo ${formatBRL(range.max)}`}>
      {COLUMNS.map((c, i) => {
        const avg = c.id === 'avg';
        return (
          <View key={c.id} style={[styles.col, avg && styles.avgCol, i > 0 && (onPrimary ? styles.dividerOn : styles.divider)]}>
            <Text style={[styles.label, onPrimary && styles.labelOn, avg && !onPrimary && { color: avgColor ?? colors.text }]}>{c.label}</Text>
            <Text
              style={[
                avg ? styles.avg : big ? styles.sideLg : styles.sideMd,
                { fontSize: avg ? avgSize : sideSize, color: onPrimary ? colors.onPrimary : avg ? (avgColor ?? colors.text) : colors.text },
                onPrimary && !avg && styles.sideOn,
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}>
              {text[c.id]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Tamanho da fonte para `length` caracteres caberem onde cabem `chars` no tamanho `base` (no mínimo 60%). */
function fit(base: number, length: number, chars: number) {
  return length <= chars ? base : Math.max(Math.round(base * 0.6), Math.floor((base * chars) / length));
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  col: { flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: 'center', paddingHorizontal: 4 },
  avgCol: { flexGrow: 1.5 },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  dividerOn: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(255,255,255,0.35)' },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  labelOn: { color: 'rgba(255,255,255,0.8)' },
  avg: { fontWeight: '900', marginTop: 2 },
  sideMd: { fontWeight: '800', marginTop: 2, marginBottom: 3 },
  sideLg: { fontWeight: '800', marginTop: 2, marginBottom: 4 },
  sideOn: { opacity: 0.92 },
});
