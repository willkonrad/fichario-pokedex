import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PressState } from '@/components/icon-button';
import { radioGroupKeys, radioTabIndex, SELECTED_FOCUS, spaceToPress } from '@/components/ui';
import { IN_SUM, RANGE_LABELS, USE_IN_SUM, type RangeSource } from '@/lib/copy';
import { formatBRL, formatBRLTight } from '@/lib/format';
import type { ValueBasis } from '@/lib/types';
import type { ValueRange } from '@/lib/valuation';
import { colors, radius, semantic, space, TOUCH, typography } from '@/theme';

const ORDER: ValueBasis[] = ['min', 'avg', 'max'];
/** Piso do valor: o texto encolhe para caber, mas não abaixo disto. */
const MIN_MONEY_SIZE = 11;

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
 * Hierarquia: a coluna `emphasis` (o valor que conta na soma; null = nenhuma) fica grande, em branco; as outras ficam
 * menores e mais apagadas. Com `onSelect`, as colunas viram as partes de um controle segmentado ("Usar na soma"): a
 * escolhida fica branca com texto preto e a legenda "na soma". `quiet` deixa todas discretas (faixa de referência abaixo do valor); `columns`
 * escolhe quais aparecem (ex.: sem o maior anúncio nos totais).
 */
export function ValueRangeRow({
  range,
  emphasis = 'avg',
  onSelect,
  size = 'md',
  source,
  labels,
  columns = ORDER,
  quiet = false,
}: {
  range: ValueRange;
  emphasis?: ValueBasis | null;
  onSelect?: (basis: ValueBasis) => void;
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
  // No controle segmentado (trilho e folga entre as partes), cabe um caractere a menos.
  const mainSize = main ? fit(big ? 32 : 26, text[main].length, big ? 7 : onSelect ? 7 : 8) : 0;
  const sideBase = quiet ? 16 : main ? (big ? 16 : 15) : big ? 18 : 16;
  const sideSize = others.length ? fit(sideBase, Math.max(...others), 8) : sideBase;
  const label = (id: ValueBasis) => labels?.[id] ?? names[id].short;
  const longLabel = (id: ValueBasis) => labels?.[id] ?? names[id].long;

  const cells = shown.map((id, i) => {
    const isMain = id === main;
    // Com opções, a coluna em destaque é a escolhida: fundo branco, texto preto.
    const selected = !!onSelect && isMain;
    const color = selected ? semantic.selected.fg : isMain || !(main || quiet) ? semantic.money.fg : semantic.money.fgMuted;
    const content = (
      <>
        <Text style={[styles.label, isMain && styles.labelMain, selected && styles.labelSelected]} numberOfLines={2}>
          {label(id)}
        </Text>
        <Text
          style={[isMain ? styles.main : big ? styles.sideLg : styles.sideMd, { fontSize: isMain ? mainSize : sideSize, color }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={Math.max(0.6, MIN_MONEY_SIZE / (isMain ? mainSize : sideSize))}>
          {text[id]}
        </Text>
        {selected ? <Text style={styles.inSum}>{IN_SUM}</Text> : null}
      </>
    );
    const style = [styles.col, isMain && styles.mainCol, i > 0 && !onSelect && styles.divider];
    return onSelect ? (
      <Pressable
        key={id}
        onPress={() => onSelect(id)}
        style={(s) => {
          const { pressed, hovered } = s as PressState;
          return [...style, styles.option, isMain && styles.optionOn, isMain && SELECTED_FOCUS, hovered && !isMain && styles.optionHover, pressed && { opacity: 0.75 }];
        }}
        role="radio"
        // aria-checked chega ao leitor de tela no celular e na versão web (accessibilityState não chega à web).
        aria-checked={isMain}
        accessibilityLabel={`${longLabel(id)}: ${formatBRL(range[id])}${isMain ? `, ${IN_SUM}` : ''}`}
        // Na web, a barra de espaço marca (como o Enter) e só a marcada entra no Tab: as setas andam entre as opções.
        {...spaceToPress(() => onSelect(id))}
        {...radioTabIndex(isMain, !!main)}>
        {content}
      </Pressable>
    ) : (
      <View key={id} style={style}>
        {content}
      </View>
    );
  });
  return onSelect ? (
    <View style={[styles.row, styles.options]} role="radiogroup" accessibilityLabel={USE_IN_SUM} {...radioGroupKeys()}>
      {cells}
    </View>
  ) : (
    <View style={styles.row} accessible accessibilityLabel={shown.map((id) => `${longLabel(id)}: ${formatBRL(range[id])}`).join(', ')}>
      {cells}
    </View>
  );
}

/** Tamanho da fonte para `length` caracteres caberem onde cabem `chars` no tamanho `base` (no mínimo 60%, e nunca abaixo do piso). */
function fit(base: number, length: number, chars: number) {
  return length <= chars ? base : Math.max(MIN_MONEY_SIZE, Math.round(base * 0.6), Math.floor((base * chars) / length));
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  // Trilho único, um degrau acima do quadro de preço (surface): as partes não têm caixa própria.
  options: { alignItems: 'stretch', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: space.xxs, gap: space.xxs },
  col: { flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: 'center', paddingHorizontal: 4 },
  mainCol: { flexGrow: 1.5 },
  option: { justifyContent: 'center', paddingVertical: space.sm, borderRadius: radius.md - space.xxs, minHeight: TOUCH },
  // Escolhida: branca com texto preto (a cor da seleção; sem vermelho nem âmbar, que parecem aviso).
  optionOn: { backgroundColor: semantic.selected.bg },
  optionHover: { backgroundColor: semantic.hover.onLight },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  label: { color: colors.textMuted, fontSize: 12, lineHeight: 15, fontWeight: '600', textAlign: 'center' },
  labelMain: { color: colors.text, fontWeight: '700' },
  labelSelected: { color: semantic.selected.fg },
  main: { ...typography.tabular, fontWeight: '800', marginTop: 2 },
  sideMd: { ...typography.tabular, fontWeight: '700', marginTop: 2, marginBottom: 3 },
  sideLg: { ...typography.tabular, fontWeight: '700', marginTop: 2, marginBottom: 4 },
  inSum: { color: semantic.selected.fg, fontSize: 11, fontWeight: '600', marginTop: 1 },
});
