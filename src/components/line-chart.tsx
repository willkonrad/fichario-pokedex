import { useId, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Line, LinearGradient, Path, Polyline, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { formatBRL, formatBRLAxis, formatDay } from '@/lib/format';
import { colors } from '@/theme';

/** Rótulos dos eixos e datas (A9): 11 px (o menor tamanho da escala), em cinza de apoio. */
const AXIS_FONT = 11;
const AXIS_COLOR = colors.textMuted;

/**
 * Gráfico de linha com área preenchida (ex.: valor da coleção por dia). `t` em milissegundos. O eixo segue a linha de
 * `v`, com folga, para uma variação pequena aparecer (antes, a faixa de mínimo a máximo achatava a linha). Com `band` e
 * `lo`/`hi` nos pontos, desenha também a faixa entre eles, recortada na área do gráfico. Os rótulos do eixo ganham
 * casas quando a variação é pequena (senão se repetem: "R$ 6,0 mil" três vezes).
 */
export function LineChart({
  points,
  color = colors.text,
  height = 170,
  format,
  band = false,
  accessibilityLabel,
}: {
  points: { t: number; v: number; lo?: number; hi?: number }[];
  /** Cor da linha (padrão: tinta neutra; verde e vermelho ficam para a variação). */
  color?: string;
  height?: number;
  /** Rótulo do eixo de valores (ex.: "R$ 1,2 mil"); sem ele, reais com as casas que a variação pede. */
  format?: (v: number) => string;
  /** Desenhar a faixa entre `lo` e `hi` (recortada; o eixo continua pela linha). */
  band?: boolean;
  /** Resumo para leitor de tela (padrão: período e primeiro e último valor). */
  accessibilityLabel?: string;
}) {
  const [width, setWidth] = useState(0);
  // Ids únicos: na web, os ids do SVG valem para a página inteira (dois gráficos na mesma tela).
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const H = height;
  const right = 10;
  const top = 10;
  const bottom = 22;
  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const start = Math.min(...ts);
  const end = Math.max(...ts);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  // Folga de 15% da variação (no mínimo 5 centavos, para os rótulos não se repetirem); com um valor só, 5% dele.
  const pad = max > min ? Math.max((max - min) * 0.15, 0.05) : Math.abs(max) * 0.05 || 1;
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const ticks = [lo, (lo + hi) / 2, hi];
  // Mesmo formato nos três rótulos (decidido pelo maior).
  const precise = ticks.map((v) => formatBRLAxis(v, hi - lo, Math.abs(hi)));
  const custom = format ? ticks.map(format) : precise;
  const tickLabels = new Set(custom).size === ticks.length ? custom : precise;
  // Margem do eixo pelo rótulo mais comprido (~6,6 px por caractere em 11 px).
  const left = Math.max(44, Math.ceil(Math.max(...tickLabels.map((l) => l.length)) * 6.6) + 10);
  const x = (t: number) => left + (end === start ? 0.5 : (t - start) / (end - start)) * (width - left - right);
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const coords = points.map((p) => `${x(p.t)},${y(p.v)}`).join(' ');
  const area = points.length
    ? `M${x(points[0].t)},${H - bottom} L${points.map((p) => `${x(p.t)},${y(p.v)}`).join(' L')} L${x(points[points.length - 1].t)},${H - bottom} Z`
    : '';
  const withBand = band && points.length > 1 && points.some((p) => p.lo != null && p.hi != null && p.hi > p.lo);
  // Faixa: borda de cima pelos máximos (esquerda → direita), volta pela de baixo pelos mínimos.
  const bandPath = withBand
    ? `M${points.map((p) => `${x(p.t)},${y(p.hi ?? p.v)}`).join(' L')} L${[...points]
        .reverse()
        .map((p) => `${x(p.t)},${y(p.lo ?? p.v)}`)
        .join(' L')} Z`
    : '';
  const first = points[0];
  const last = points[points.length - 1];
  const valueText = format ?? formatBRL;
  const summary =
    accessibilityLabel ??
    (first && last
      ? points.length > 1
        ? `Gráfico de ${formatDay(start)} a ${formatDay(end)}: de ${valueText(first.v)} a ${valueText(last.v)}`
        : `Gráfico com um dia, ${formatDay(start)}: ${valueText(last.v)}`
      : 'Gráfico sem dados');

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: H }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}>
      {width > 0 && points.length ? (
        <Svg width={width} height={H}>
          <Defs>
            <LinearGradient id={`area${uid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.16} />
              <Stop offset="1" stopColor={color} stopOpacity={0.01} />
            </LinearGradient>
            <ClipPath id={`clip${uid}`}>
              <Rect x={left} y={top} width={Math.max(0, width - left - right)} height={H - top - bottom} />
            </ClipPath>
          </Defs>
          {/* Grade pontilhada e discreta: quem aparece é a linha do valor. */}
          {ticks.map((v, i) => (
            <Line key={`g${i}`} x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={1} strokeDasharray="2 6" />
          ))}
          {ticks.map((v, i) => (
            <SvgText key={`l${i}`} x={left - 6} y={y(v) + 4} fontSize={AXIS_FONT} fill={AXIS_COLOR} textAnchor="end">
              {tickLabels[i]}
            </SvgText>
          ))}
          {withBand ? <Path d={bandPath} fill={color} fillOpacity={0.1} clipPath={`url(#clip${uid})`} /> : null}
          {points.length > 1 ? <Path d={area} fill={`url(#area${uid})`} /> : null}
          {points.length > 1 ? <Polyline points={coords} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" /> : null}
          {last ? <Circle cx={x(last.t)} cy={y(last.v)} r={4.5} fill={color} stroke={colors.surface} strokeWidth={2} /> : null}
          <SvgText x={left} y={H - 6} fontSize={AXIS_FONT} fill={AXIS_COLOR}>
            {formatDay(start)}
          </SvgText>
          <SvgText x={width - right} y={H - 6} fontSize={AXIS_FONT} fill={AXIS_COLOR} textAnchor="end">
            {formatDay(end)}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}
