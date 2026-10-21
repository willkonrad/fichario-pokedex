import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { formatBRL, formatWhen } from '@/lib/quotes';
import { CONDITIONS, LANG_SHORT, type CardLang, type Condition, type Entry, type Price } from '@/lib/types';
import { CONFIDENCE_LABEL, valuation, type Confidence, type SourceId, type SourceRow } from '@/lib/valuation';
import { colors, radius } from '@/theme';

const LINE = { pt: '#5FD69C', en: '#6BB8FF', sale: '#F2CF6B' };
const CONFIDENCE_COLOR: Record<Confidence, string> = { alta: '#5FD69C', media: '#F2CF6B', baixa: '#A8A8B0' };

/**
 * Cartão de preço da carta: valor de referência (todas as fontes cruzadas, com grau de confiança), o valor
 * de cada fonte em reais com link, vendas reais por estado, gráfico de 30 dias e últimas vendas.
 */
export function PricePanel({
  entry,
  condition,
  lang,
  ligaPrice,
  ligaUrl,
  myValue,
}: {
  /** Carta salva (os preços chegam pelo servidor depois de salvar). */
  entry?: Entry;
  condition: Condition;
  lang: CardLang;
  ligaPrice?: Price;
  ligaUrl: string;
  /** "Meu valor" digitado agora na tela (ainda não salvo). */
  myValue?: number;
}) {
  const myp = entry?.myp;
  const sold = entry?.sold;
  // Valor de referência com o estado e o "Meu valor" escolhidos agora na tela (todas as fontes cruzadas).
  const here = entry
    ? {
        ...entry,
        condition,
        price: ligaPrice ?? entry.price,
        myValue: myValue != null ? { value: myValue, setAt: entry.myValue?.setAt ?? new Date().toISOString() } : undefined,
      }
    : undefined;
  const ref = here ? valuation(here) : undefined;
  const sourceRows = ref?.sources.filter((r) => r.id !== 'manual') ?? [];
  // Com valor manual ou da Liga, as outras fontes só conferem; sem Liga, as fora da curva ficam riscadas.
  const isReference = (r: SourceRow) => !r.used && ref?.basis !== 'median';
  const detailOf = (r: SourceRow) => (r.used || isReference(r) ? r.detail : 'fora da curva, não entrou no cálculo');
  const subtitle =
    ref?.basis === 'manual'
      ? 'meu valor · as fontes abaixo ficam só de referência'
      : ref?.basis === 'mypOffer'
        ? `${ref.confidence ? CONFIDENCE_LABEL[ref.confidence] : ''} · menor oferta no MYP no seu estado e idioma${entry?.mypOffers?.checkedAt ? ` (${formatWhen(entry.mypOffers.checkedAt)})` : ''}`
        : ref?.basis === 'brasil'
        ? `${ref.confidence ? CONFIDENCE_LABEL[ref.confidence] : ''} · vendas reais e anúncios no Brasil concordam acima do menor anúncio da Liga (provavelmente uma cópia jogada)`
        : ref?.basis === 'liga'
        ? `${ref.confidence ? CONFIDENCE_LABEL[ref.confidence] : ''} · menor anúncio na Liga${ref.check != null ? `, conferido por ${sourceRows.length - 1} ${sourceRows.length - 1 === 1 ? 'fonte' : 'fontes'} (${formatBRL(ref.check)})` : ''}`
        : `${ref?.confidence ? CONFIDENCE_LABEL[ref.confidence] : ''} · sem anúncio na Liga: mediana de ${sourceRows.filter((r) => r.used).length} de ${sourceRows.length} fontes`;

  if (!entry) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Valor de referência</Text>
        <Text style={styles.muted}>Depois de colocar a carta no fichário, os preços chegam em alguns minutos.</Text>
      </View>
    );
  }

  // Link de cada fonte, quando ela tem página para a carta.
  const urlOf = (id: SourceId) =>
    id === 'liga'
      ? ligaUrl
      : id === 'mypOffer' || id === 'myp'
        ? (id === 'mypOffer' && entry.mypOffers?.url) || 'https://mypcards.com'
      : id === 'sold'
        ? sold?.url
        : id === 'tcgplayer' && entry.intl?.tcgplayer?.productId
          ? `https://www.tcgplayer.com/product/${entry.intl.tcgplayer.productId}`
          : id === 'cardtrader' && entry.intl?.cardtrader?.blueprintId
            ? `https://www.cardtrader.com/cards/${entry.intl.cardtrader.blueprintId}`
            : undefined;
  const tone = ref?.confidence ? CONFIDENCE_COLOR[ref.confidence] : colors.textMuted;

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.card}>
        <Text style={styles.label}>Valor de referência</Text>
        {ref?.value != null ? (
          <>
            <Text style={[styles.main, { color: tone }]}>{formatBRL(ref.value)}</Text>
            <View style={styles.confRow}>
              <View style={[styles.confDot, { backgroundColor: tone }]} />
              <Text style={styles.mainSource}>{subtitle}</Text>
            </View>
            {ref.suspect ? (
              <Text style={styles.warn}>
                As outras fontes indicam cerca de {formatBRL(ref.check ?? 0)}: o menor anúncio na Liga pode ser de uma carta jogada ou
                danificada. Confira o menor anúncio no seu estado na Liga e preencha &quot;Meu valor&quot;.
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.muted}>Buscando preços… chegam em até algumas horas.</Text>
        )}

        {/* Cada fonte, já em reais; as descartadas (fora da curva) aparecem riscadas. */}
        {ref?.sources.length ? (
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
                    <Text style={styles.srcDetail}>{detailOf(r)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text
                      style={[
                        styles.srcValue,
                        isReference(r) && styles.srcRef,
                        !r.used && !isReference(r) && styles.srcOut,
                      ]}>
                      {formatBRL(r.brl)}
                    </Text>
                    {r.original ? <Text style={styles.srcDetail}>{r.original}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Vendas reais em cada estado. */}
        {sold?.byCondition && Object.values(sold.byCondition).some((c) => c?.value != null) ? (
          <>
            <Text style={[styles.label, { marginTop: 6 }]}>Vendas reais por estado ({LANG_SHORT[lang]})</Text>
            <View style={styles.conds}>
              {CONDITIONS.map(({ id }) => {
                const c = sold.byCondition?.[id];
                if (!c) return null;
                const active = id === condition;
                return (
                  <View key={id} style={[styles.cond, active && styles.condActive]}>
                    <Text style={[styles.condId, active && { color: colors.accent }]}>{id}</Text>
                    <Text style={styles.condValue}>{c.value != null ? formatBRL(c.value) : '—'}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.source}>
          Valor = menor oferta no MYP no seu estado e idioma, quando houver; senão, menor anúncio na Liga (padrão no Brasil), a não ser que vendas reais e anúncios no Brasil concordem num
          valor acima dele; as fontes de fora só conferem. Sem Liga, mediana das fontes.
          Valores de fora convertidos pelo câmbio do dia
          {entry.intl?.fx ? ` (US$ 1 = ${formatBRL(entry.intl.fx.usd)}, € 1 = ${formatBRL(entry.intl.fx.eur)})` : ''}.
          {myp?.checkedAt ? ` Atualizado em ${formatWhen(myp.checkedAt)}.` : ''}
        </Text>
      </View>

      <PriceHistory history={myp?.history} sales={sold?.sales} />
      <RecentSales sales={sold?.sales} />
    </View>
  );
}

/** Histórico de 30 dias do menor anúncio no MYP (PT e EN) e vendas reais no mesmo período. */
function PriceHistory({ history, sales }: { history?: { t: string; p: number; k: 'pt' | 'en' }[]; sales?: { daysAgo: number; price: number }[] }) {
  const [width, setWidth] = useState(0);
  // Momento de referência do gráfico ("hoje"), fixado ao abrir a tela.
  const [now] = useState(() => Date.now());
  if (!history?.length) return null;
  const start = Math.min(...history.map((h) => new Date(h.t).getTime()));
  const end = now;
  const salePoints = (sales ?? [])
    .map((s) => ({ t: now - s.daysAgo * 86_400_000, p: s.price }))
    .filter((s) => s.t >= start);
  const prices = [...history.map((h) => h.p), ...salePoints.map((s) => s.p)];
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
          {salePoints.length ? <Legend color={LINE.sale} label="vendas" /> : null}
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
          {salePoints.map((s, i) => (
            <Circle key={i} cx={x(s.t)} cy={y(s.p)} r={3.5} fill={LINE.sale} />
          ))}
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
        nos últimos 30 dias (via Zukan). Pontos: vendas reais no período.
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

/** Últimas vendas reais (data, estado, idioma, preço). */
function RecentSales({ sales }: { sales?: { daysAgo: number; condition?: string; lang?: string; price: number }[] }) {
  if (!sales?.length) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.chartTitle}>Últimas vendas</Text>
      {sales.slice(0, 8).map((s, i) => (
        <View key={i} style={[styles.saleRow, i > 0 && styles.saleBorder]}>
          <Text style={styles.saleWhen}>{s.daysAgo === 0 ? 'hoje' : `há ${s.daysAgo} ${s.daysAgo === 1 ? 'dia' : 'dias'}`}</Text>
          <View style={styles.saleTags}>
            {s.condition ? <Text style={styles.tag}>{s.condition}</Text> : null}
            {s.lang ? <Text style={styles.tag}>{s.lang}</Text> : null}
          </View>
          <Text style={styles.salePrice}>{formatBRL(s.price)}</Text>
        </View>
      ))}
      <Text style={styles.source}>Vendas finalizadas e pagas no Brasil (Quanto vale minha carta?).</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  label: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  main: { color: colors.success, fontSize: 30, fontWeight: '800' },
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
  srcLink: { color: colors.accent, fontSize: 13 },
  srcDetail: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  srcValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  srcOut: { color: colors.textFaint, textDecorationLine: 'line-through' },
  srcRef: { color: colors.textMuted, fontWeight: '600' },
  warn: { color: '#F2CF6B', fontSize: 12, lineHeight: 17 },
  conds: { flexDirection: 'row', gap: 4, marginTop: 4 },
  cond: { flexGrow: 1, flexBasis: 0, minWidth: 0, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingVertical: 5, alignItems: 'center' },
  condActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  condId: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
  condValue: { color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 1 },
  source: { color: colors.textFaint, fontSize: 11, lineHeight: 15 },
  sourceLink: { color: colors.accent, textDecorationLine: 'underline' },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chartTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  legend: { flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 12 },
  saleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  saleBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  saleWhen: { color: colors.textMuted, fontSize: 13, width: 92 },
  saleTags: { flex: 1, flexDirection: 'row', gap: 4 },
  tag: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  salePrice: { color: colors.text, fontSize: 14, fontWeight: '800' },
});
