import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IN_SUM, RANGE_LABELS, USE_IN_SUM, type RangeSource } from '@/lib/copy';
import { formatBRL, formatBRLTight } from '@/lib/format';
import type { ValueBasis } from '@/lib/types';
import type { ValueRange } from '@/lib/valuation';
import { colors, radius } from '@/theme';

const ORDER: ValueBasis[] = ['min', 'avg', 'max'];

/** Rótulos sem fonte conhecida (telas antigas). */
const GENERIC: Record<ValueBasis, { short: string; long: string }> = {
  min: { short: 'Mínimo', long: 'Mínimo' },
  avg: { short: 'Média', long: 'Média' },
  max: { short: 'Máximo', long: 'Máximo' },
};

/**
 * Mínimo, média e máximo lado a lado, com os rótulos verdadeiros da fonte (`source`): no MYP, "Menor anúncio · Média
 * dos anúncios · Maior anúncio"; na TCGplayer, "Menor anúncio · Mercado · Mediana"; na soma da coleção, "Pelo menor
 * anúncio · Pela média · Pelo maior anúncio".
 *
 * Hierarquia: a coluna `emphasis` (o valor que conta na soma; null = nenhuma) fica grande, em tinta; as outras ficam
 * menores e mais claras. Com `onSelect`, as colunas viram as opções de "Usar na soma": a escolhida ganha borda de
 * tinta e a legenda "na soma" (sem cor de alerta). `quiet` deixa todas discretas (faixa de referência abaixo do
 * valor); `columns` escolhe quais aparecem (ex.: sem o maior anúncio nos totais). `onPrimary` desenha sobre o fundo
 * vermelho (Minha coleção).
 */
export function ValueRangeRow({
  range,
  emphasis = 'avg',
  emphasisColor,
  onSelect,
  onPrimary = false,
  size = 'md',
  source,
  labels,
  columns = ORDER,
  quiet = false,
}: {
  range: ValueRange;
  emphasis?: ValueBasis | null;
  /** @deprecated o dinheiro fica sempre em tinta neutra; a cor da confiança some (fica só para as telas antigas). */
  emphasisColor?: string;
  onSelect?: (basis: ValueBasis) => void;
  onPrimary?: boolean;
  size?: 'md' | 'lg';
  /** De onde é a faixa, para os rótulos. Sem ela: Mínimo/Média/Máximo. */
  source?: RangeSource;
  /** Rótulos próprios (passam por cima dos da fonte). */
  labels?: Partial<Record<ValueBasis, string>>;
  /** Colunas mostradas, na ordem mínimo → máximo. */
  columns?: ValueBasis[];
  quiet?: boolean;
}) {
  const big = size === 'lg';
  const names = source ? RANGE_LABELS[source] : GENERIC;
  const shown = ORDER.filter((id) => columns.includes(id));
  // Destaque só numa coluna que aparece (nos totais sem o máximo, um máximo escolhido não muda os tamanhos).
  const main = !quiet && emphasis && shown.includes(emphasis) ? emphasis : null;
  // A fonte diminui com o tamanho do texto ("R$ 12.345"): adjustsFontSizeToFit não existe na versão web, e a coluna
  // em destaque tem cerca de 120 px num celular de 375 px.
  const text = { min: formatBRLTight(range.min), avg: formatBRLTight(range.avg), max: formatBRLTight(range.max) };
  const others = shown.filter((id) => id !== main).map((id) => text[id].length);
  // Com botões (bordas e espaço entre eles), cabe um caractere a menos.
  const mainSize = main ? fit(big ? 32 : 26, text[main].length, big ? 7 : onSelect ? 7 : 8) : 0;
  const sideBase = quiet ? 16 : main ? (big ? 16 : 15) : big ? 18 : 16;
  const sideSize = others.length ? fit(sideBase, Math.max(...others), 8) : sideBase;
  const label = (id: ValueBasis) => labels?.[id] ?? names[id].short;
  const longLabel = (id: ValueBasis) => labels?.[id] ?? names[id].long;

  const cells = shown.map((id, i) => {
    const isMain = id === main;
    const color = onPrimary ? colors.onPrimary : isMain ? (emphasisColor ?? colors.text) : main || quiet ? colors.textMuted : colors.text;
    const content = (
      <>
        <Text style={[styles.label, onPrimary && styles.labelOn, isMain && !onPrimary && styles.labelMain]} numberOfLines={2}>
          {label(id)}
        </Text>
        <Text
          style={[isMain ? styles.main : big ? styles.sideLg : styles.sideMd, { fontSize: isMain ? mainSize : sideSize, color }, onPrimary && !isMain && styles.sideOn]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}>
          {text[id]}
        </Text>
        {onSelect && isMain ? <Text style={styles.inSum}>{IN_SUM}</Text> : null}
      </>
    );
    const style = [styles.col, isMain && styles.mainCol, i > 0 && !onSelect && (onPrimary ? styles.dividerOn : styles.divider)];
    return onSelect ? (
      <Pressable
        key={id}
        onPress={() => onSelect(id)}
        style={({ pressed }) => [...style, styles.option, isMain && styles.optionOn, pressed && { opacity: 0.75 }]}
        accessibilityRole="radio"
        // aria-checked chega ao leitor de tela no celular e na versão web (accessibilityState não chega à web).
        aria-checked={isMain}
        accessibilityLabel={`${longLabel(id)}: ${formatBRL(range[id])}${isMain ? `, ${IN_SUM}` : ''}`}>
        {content}
      </Pressable>
    ) : (
      <View key={id} style={style}>
        {content}
      </View>
    );
  });
  return onSelect ? (
    <View style={[styles.row, styles.options]} accessibilityRole="radiogroup" accessibilityLabel={USE_IN_SUM}>
      {cells}
    </View>
  ) : (
    <View style={styles.row} accessible accessibilityLabel={shown.map((id) => `${longLabel(id)}: ${formatBRL(range[id])}`).join(', ')}>
      {cells}
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
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  // Escolhida: borda de tinta (sem vermelho nem âmbar, que parecem aviso).
  optionOn: { borderColor: colors.text },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  dividerOn: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(255,255,255,0.35)' },
  label: { color: colors.textMuted, fontSize: 12, lineHeight: 15, fontWeight: '600', textAlign: 'center' },
  labelMain: { color: colors.text, fontWeight: '700' },
  labelOn: { color: 'rgba(255,255,255,0.85)' },
  main: { fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  sideMd: { fontWeight: '700', marginTop: 2, marginBottom: 3, fontVariant: ['tabular-nums'] },
  sideLg: { fontWeight: '700', marginTop: 2, marginBottom: 4, fontVariant: ['tabular-nums'] },
  sideOn: { opacity: 0.92 },
  inSum: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 1 },
});
