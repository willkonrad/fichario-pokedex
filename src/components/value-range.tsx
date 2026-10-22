import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatBRL, formatBRLTight } from '@/lib/quotes';
import { VALUE_BASIS_LABEL, type ValueBasis } from '@/lib/types';
import type { ValueRange } from '@/lib/valuation';
import { colors, radius } from '@/theme';

const COLUMNS = [
  { id: 'min', label: 'Mín' },
  { id: 'avg', label: 'Média' },
  { id: 'max', label: 'Máx' },
] as const;

/**
 * Mínimo, média e máximo lado a lado: o valor da carta (ou da coleção) como a API do MYP informa. A coluna `emphasis`
 * (o valor que conta na soma; null = nenhuma) fica em destaque. Com `onSelect`, as colunas viram botões para escolher
 * esse valor. `onPrimary` desenha sobre o fundo vermelho (Minha coleção).
 */
export function ValueRangeRow({
  range,
  emphasis = 'avg',
  emphasisColor,
  onSelect,
  onPrimary = false,
  size = 'md',
}: {
  range: ValueRange;
  emphasis?: ValueBasis | null;
  /** Cor do valor em destaque (ex.: a cor da confiança). */
  emphasisColor?: string;
  onSelect?: (basis: ValueBasis) => void;
  onPrimary?: boolean;
  size?: 'md' | 'lg';
}) {
  const big = size === 'lg';
  // A fonte diminui com o tamanho do texto ("R$ 12.345"): adjustsFontSizeToFit não existe na versão web, e a coluna
  // em destaque tem cerca de 120 px num celular de 375 px.
  const text = { min: formatBRLTight(range.min), avg: formatBRLTight(range.avg), max: formatBRLTight(range.max) };
  const others = COLUMNS.filter((c) => c.id !== emphasis).map((c) => text[c.id].length);
  // Com botões (bordas e espaço entre eles), cabe um caractere a menos.
  const mainSize = emphasis ? fit(big ? 32 : 26, text[emphasis].length, big ? 7 : onSelect ? 7 : 8) : 0;
  const sideSize = fit(big ? 18 : 16, Math.max(...others), 8);
  const columns = COLUMNS.map((c, i) => {
    const main = c.id === emphasis;
    const color = onPrimary ? colors.onPrimary : main ? (emphasisColor ?? colors.text) : colors.text;
    const content = (
      <>
        <Text style={[styles.label, onPrimary && styles.labelOn, main && !onPrimary && { color }]}>{c.label}</Text>
        <Text
          style={[main ? styles.main : big ? styles.sideLg : styles.sideMd, { fontSize: main ? mainSize : sideSize, color }, onPrimary && !main && styles.sideOn]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}>
          {text[c.id]}
        </Text>
      </>
    );
    const style = [styles.col, main && styles.mainCol, i > 0 && !onSelect && (onPrimary ? styles.dividerOn : styles.divider)];
    return onSelect ? (
      <Pressable
        key={c.id}
        onPress={() => onSelect(c.id)}
        style={({ pressed }) => [...style, styles.option, main && styles.optionOn, pressed && { opacity: 0.75 }]}
        accessibilityRole="radio"
        // aria-checked chega ao leitor de tela no celular e na versão web (accessibilityState não chega à web).
        aria-checked={main}
        accessibilityLabel={`${VALUE_BASIS_LABEL[c.id]} ${formatBRL(range[c.id])}${main ? ', entra na soma' : ''}`}>
        {content}
      </Pressable>
    ) : (
      <View key={c.id} style={style}>
        {content}
      </View>
    );
  });
  return onSelect ? (
    <View style={[styles.row, styles.options]} accessibilityRole="radiogroup" accessibilityLabel="Valor que entra na soma">
      {columns}
    </View>
  ) : (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Mínimo ${formatBRL(range.min)}, média ${formatBRL(range.avg)}, máximo ${formatBRL(range.max)}`}>
      {columns}
    </View>
  );
}

/** Tamanho da fonte para `length` caracteres caberem onde cabem `chars` no tamanho `base` (no mínimo 60%). */
function fit(base: number, length: number, chars: number) {
  return length <= chars ? base : Math.max(Math.round(base * 0.6), Math.floor((base * chars) / length));
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  options: { alignItems: 'stretch', gap: 6 },
  col: { flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: 'center', paddingHorizontal: 4 },
  mainCol: { flexGrow: 1.5 },
  option: {
    justifyContent: 'flex-end',
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    minHeight: 44,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  dividerOn: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(255,255,255,0.35)' },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  labelOn: { color: 'rgba(255,255,255,0.8)' },
  main: { fontWeight: '900', marginTop: 2 },
  sideMd: { fontWeight: '800', marginTop: 2, marginBottom: 3 },
  sideLg: { fontWeight: '800', marginTop: 2, marginBottom: 4 },
  sideOn: { opacity: 0.92 },
});
