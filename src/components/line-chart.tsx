import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Polyline, Stop, Text as SvgText } from 'react-native-svg';

import { colors } from '@/theme';

/** Gráfico de linha com área preenchida (ex.: valor da coleção por dia). `t` em milissegundos. */
export function LineChart({
  points,
  color = colors.primary,
  height = 170,
  format,
}: {
  points: { t: number; v: number }[];
  color?: string;
  height?: number;
  /** Rótulo do eixo de valores (ex.: "R$ 1,2 mil"). */
  format: (v: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const H = height;
  const left = 58;
  const right = 10;
  const top = 10;
  const bottom = 22;
  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const start = Math.min(...ts);
  const end = Math.max(...ts);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const pad = (max - min) * 0.15 || max * 0.1 || 1;
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const x = (t: number) => left + (end === start ? 0.5 : (t - start) / (end - start)) * (width - left - right);
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const coords = points.map((p) => `${x(p.t)},${y(p.v)}`).join(' ');
  const area = points.length
    ? `M${x(points[0].t)},${H - bottom} L${points.map((p) => `${x(p.t)},${y(p.v)}`).join(' L')} L${x(points[points.length - 1].t)},${H - bottom} Z`
    : '';
  const date = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const last = points[points.length - 1];

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: H }}>
      {width > 0 && points.length ? (
        <Svg width={width} height={H}>
          <Defs>
            <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.22} />
              <Stop offset="1" stopColor={color} stopOpacity={0.02} />
            </LinearGradient>
          </Defs>
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <Line key={v} x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={1} />
          ))}
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <SvgText key={`l${v}`} x={left - 6} y={y(v) + 4} fontSize={10} fill={colors.textFaint} textAnchor="end">
              {format(v)}
            </SvgText>
          ))}
          {points.length > 1 ? <Path d={area} fill="url(#area)" /> : null}
          {points.length > 1 ? <Polyline points={coords} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" /> : null}
          {last ? <Circle cx={x(last.t)} cy={y(last.v)} r={4.5} fill={color} stroke={colors.surface} strokeWidth={2} /> : null}
          <SvgText x={left} y={H - 6} fontSize={10} fill={colors.textFaint}>
            {date(start)}
          </SvgText>
          <SvgText x={width - right} y={H - 6} fontSize={10} fill={colors.textFaint} textAnchor="end">
            {date(end)}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}
