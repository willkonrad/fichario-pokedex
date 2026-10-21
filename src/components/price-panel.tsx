import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';

import { formatBRL, formatWhen } from '@/lib/quotes';
import type { Condition, Entry } from '@/lib/types';
import { CONFIDENCE_LABEL, mypCovers, valuation, type Confidence, type SourceId } from '@/lib/valuation';
import { colors, confidenceColors, radius, shadow } from '@/theme';

const LINE = { pt: colors.success, en: colors.blue };
const CONFIDENCE_COLOR: Record<Confidence, string> = confidenceColors.light;
const MYP_URL = 'https://mypcards.com';

/** Cartão de preço da carta: valor no MYP Cards (ou "Meu valor"), de onde ele vem e o histórico de 30 dias. */
export function PricePanel({
  entry,
  condition,
  myValue,
}: {
  /** Carta salva (os preços chegam pelo servidor depois de salvar). */
  entry?: Entry;
  condition: Condition;
  /** "Meu valor" digitado agora na tela (ainda não salvo). */
  myValue?: number;
}) {
  const myp = entry?.myp;
  // Valor com o estado e o "Meu valor" escolhidos agora na tela.
  const here = entry
    ? {
        ...entry,
        condition,
        myValue: myValue != null ? { value: myValue, setAt: entry.myValue?.setAt ?? new Date().toISOString() } : undefined,
      }
    : undefined;
  const ref = here ? valuation(here) : undefined;

  if (!entry) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Valor no MYP Cards</Text>
        <Text style={styles.muted}>Depois de colocar a carta no fichário, o preço chega em alguns minutos.</Text>
      </View>
    );
  }

  const urlOf = (id: SourceId) => (id === 'manual' ? undefined : (id === 'mypOffer' && entry.mypOffers?.url) || MYP_URL);
  const tone = ref?.confidence ? CONFIDENCE_COLOR[ref.confidence] : colors.textMuted;
  const subtitle =
    ref?.basis === 'manual'
      ? 'meu valor · digitado por você'
      : ref?.basis === 'mypOffer'
        ? `${CONFIDENCE_LABEL.alta} · menor oferta no seu estado e idioma`
        : `${CONFIDENCE_LABEL.media} · menor anúncio no idioma da carta, de qualquer estado`;

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.card}>
        <Text style={styles.label}>Valor no MYP Cards</Text>
        {ref?.value != null ? (
          <>
            <Text style={[styles.main, { color: tone }]}>{formatBRL(ref.value)}</Text>
            <View style={styles.confRow}>
              <View style={[styles.confDot, { backgroundColor: tone }]} />
              <Text style={styles.mainSource}>{subtitle}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.muted}>
            {!mypCovers(entry.lang)
              ? 'O MYP Cards não informa preço de cartas japonesas. Preencha "Meu valor" com o valor que você conferiu.'
              : myp?.checkedAt
                ? 'Sem anúncio desta carta no MYP Cards agora. Você pode preencher "Meu valor".'
                : 'Buscando o preço no MYP Cards… chega em alguns minutos.'}
          </Text>
        )}

        {/* Com mais de um valor (ex.: "Meu valor" e o MYP), lista cada um; o que vale fica destacado. */}
        {ref && ref.sources.length > 1 ? (
          <View style={styles.table}>
            {ref.sources.map((r) => {
              const url = urlOf(r.id);
              return (
                <Pressable
                  key={r.id}
                  disabled={!url}
                  onPress={() => url && WebBrowser.openBrowserAsync(url)}
                  style={({ pressed }) => [styles.srcRow, pressed && { opacity: 0.7 }]}
                  accessibilityRole={url ? 'link' : undefined}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.srcName}>
                      {r.label}
                      {url ? <Text style={styles.srcLink}> ↗</Text> : null}
                    </Text>
                    <Text style={styles.srcDetail}>{r.detail}</Text>
                  </View>
                  <Text style={[styles.srcValue, !r.used && styles.srcRef]}>{formatBRL(r.brl)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Pressable
          onPress={() => WebBrowser.openBrowserAsync((ref?.basis === 'mypOffer' && entry.mypOffers?.url) || MYP_URL)}
          style={({ pressed }) => [styles.mypButton, pressed && { opacity: 0.8 }]}
          accessibilityRole="link">
          <Ionicons name="storefront-outline" size={16} color={colors.blue} />
          <Text style={styles.mypButtonText}>Ver anúncios no MYP Cards</Text>
          <Ionicons name="open-outline" size={14} color={colors.blue} />
        </Pressable>

        <Text style={styles.source}>
          Preços do{' '}
          <Text style={styles.sourceLink} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(MYP_URL)}>
            MYP Cards
          </Text>
          .{(entry.mypOffers?.checkedAt ?? myp?.checkedAt) ? ` Atualizado em ${formatWhen((entry.mypOffers?.checkedAt ?? myp?.checkedAt)!)}.` : ''}
        </Text>
      </View>

      <PriceHistory history={myp?.history} />
    </View>
  );
}

/** Histórico de 30 dias do menor anúncio no MYP Cards (PT e EN). */
function PriceHistory({ history }: { history?: { t: string; p: number; k: 'pt' | 'en' }[] }) {
  const [width, setWidth] = useState(0);
  // Momento de referência do gráfico ("hoje"), fixado ao abrir a tela.
  const [now] = useState(() => Date.now());
  if (!history?.length) return null;
  const start = Math.min(...history.map((h) => new Date(h.t).getTime()));
  const end = now;
  const prices = history.map((h) => h.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.15 || max * 0.1 || 1;
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const H = 150;
  const left = 54;
  const right = 8;
  const top = 8;
  const bottom = 22;
  const x = (t: number) => left + ((t - start) / Math.max(1, end - start)) * (width - left - right);
  const y = (p: number) => top + (1 - (p - lo) / (hi - lo)) * (H - top - bottom);
  const line = (k: 'pt' | 'en') => {
    const pts = history.filter((h) => h.k === k);
    if (!pts.length) return null;
    // Degraus: o preço vale até a próxima mudança (e até hoje no último ponto).
    const coords: string[] = [];
    pts.forEach((h, i) => {
      const t = new Date(h.t).getTime();
      const next = i + 1 < pts.length ? new Date(pts[i + 1].t).getTime() : end;
      coords.push(`${x(t)},${y(h.p)}`, `${x(next)},${y(h.p)}`);
    });
    return <Polyline points={coords.join(' ')} fill="none" stroke={LINE[k]} strokeWidth={2} />;
  };
  const fmt = (n: number) => (n >= 1000 ? `R$ ${(n / 1000).toFixed(1).replace('.', ',')}k` : `R$ ${Math.round(n)}`);
  const date = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hasEn = history.some((h) => h.k === 'en');
  const hasPt = history.some((h) => h.k === 'pt');

  return (
    <View style={styles.card} onLayout={(e) => setWidth(e.nativeEvent.layout.width - 28)}>
      <View style={styles.chartHead}>
        <Text style={styles.chartTitle}>Histórico de preço</Text>
        <View style={styles.legend}>
          {hasPt ? <Legend color={LINE.pt} label="PT" /> : null}
          {hasEn ? <Legend color={LINE.en} label="EN" /> : null}
        </View>
      </View>
      {width > 0 ? (
        <Svg width={width} height={H}>
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <Line key={v} x1={left} x2={width - right} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth={1} />
          ))}
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <SvgText key={`l${v}`} x={left - 6} y={y(v) + 4} fontSize={10} fill={colors.textFaint} textAnchor="end">
              {fmt(v)}
            </SvgText>
          ))}
          {line('pt')}
          {line('en')}
          <SvgText x={left} y={H - 6} fontSize={10} fill={colors.textFaint}>
            {date(start)}
          </SvgText>
          <SvgText x={width - right} y={H - 6} fontSize={10} fill={colors.textFaint} textAnchor="end">
            hoje
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height: H }} />
      )}
      <Text style={styles.source}>
        Menor anúncio no{' '}
        <Text style={styles.sourceLink} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync('https://mypcards.com')}>
          MYP Cards
        </Text>{' '}
        nos últimos 30 dias (via Zukan).
      </Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 8, ...shadow },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  main: { color: colors.success, fontSize: 34, fontWeight: '900' },
  mainSource: { color: colors.textMuted, fontSize: 12, marginTop: -4 },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -2 },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  table: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginTop: 4 },
  srcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  srcName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  srcLink: { color: colors.blue, fontSize: 13 },
  srcDetail: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  srcValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  srcRef: { color: colors.textMuted, fontWeight: '600' },
  mypButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(47, 91, 211, 0.08)',
    marginTop: 4,
  },
  mypButtonText: { color: colors.blue, fontSize: 14, fontWeight: '800' },
  source: { color: colors.textFaint, fontSize: 11, lineHeight: 15 },
  sourceLink: { color: colors.blue, fontWeight: '700', textDecorationLine: 'underline' },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chartTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  legend: { flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 12 },
});
