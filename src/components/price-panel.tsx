import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';

import { formatBRL, formatBRLShort, formatWhen } from '@/lib/quotes';
import { CONDITIONS, LANG_LABEL, VARIANTS, type Condition, type Entry, type MypCondition } from '@/lib/types';
import {
  CONFIDENCE_LABEL,
  mypCondition,
  mypCovers,
  mypFitsVariant,
  mypScanFor,
  soldMatchesVariant,
  valuation,
  type Confidence,
  type SourceId,
} from '@/lib/valuation';
import { colors, confidenceColors, radius, shadow } from '@/theme';

const LINE = { pt: colors.success, en: colors.blue };
const CONFIDENCE_COLOR: Record<Confidence, string> = confidenceColors.light;
const MYP_URL = 'https://mypcards.com';
const QVMC_URL = 'https://quantovaleminhacarta.com.br';

/**
 * Cartão de preço da carta: valor (Meu valor, vendas reais ou MYP Cards), de onde ele vem, as vendas reais por
 * estado e o histórico de 30 dias do MYP.
 */
export function PricePanel({
  entry,
  condition,
  myValue,
  ligaUrl,
}: {
  /** Carta salva (os preços chegam pelo servidor depois de salvar). */
  entry?: Entry;
  condition: Condition;
  /** "Meu valor" digitado agora na tela (ainda não salvo). */
  myValue?: number;
  /** Página da carta na LigaPokemon (só o link; o valor vem do MYP e das vendas reais). */
  ligaUrl?: string;
}) {
  const myp = entry?.myp;
  const sold = entry?.sold;
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
        <Text style={styles.label}>Valor da carta</Text>
        <Text style={styles.muted}>Depois de colocar a carta no fichário, o preço chega em alguns minutos.</Text>
        <StoreLinks mypUrl={MYP_URL} ligaUrl={ligaUrl} />
      </View>
    );
  }

  const urlOf = (id: SourceId) =>
    id === 'manual' ? undefined : id === 'sold' ? (sold?.url ?? QVMC_URL) : (id === 'mypOffer' && entry.mypOffers?.url) || MYP_URL;
  const soldHere = sold?.byCondition?.[condition];
  // Leitura das ofertas do MYP desta carta, idioma e versão (com o estado escolhido agora na tela).
  const scan = mypScanFor({ ...entry, condition });
  const versionLabel = VARIANTS.find((v) => v.id === entry.variant)?.label ?? entry.variant;
  const tone = ref?.confidence ? CONFIDENCE_COLOR[ref.confidence] : colors.textMuted;
  const subtitle =
    ref?.basis === 'manual'
      ? 'meu valor · digitado por você'
      : ref?.basis === 'mypOffer'
        ? `${CONFIDENCE_LABEL.alta} · menor oferta no MYP no seu estado, idioma e versão`
        : ref?.basis === 'sold'
          ? `${ref.confidence ? CONFIDENCE_LABEL[ref.confidence] : ''} · mediana de ${soldHere?.count ?? 0} ${soldHere?.count === 1 ? 'venda real finalizada' : 'vendas reais finalizadas'} em ${condition}, sem anúncio no MYP${ref.confidence === 'baixa' ? ' (poucas vendas: referência inicial)' : ''}`
          : `${CONFIDENCE_LABEL.media} · menor anúncio no MYP no idioma da carta, de qualquer estado`;

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.card}>
        <Text style={styles.label}>Valor da carta</Text>
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
            {!myp?.checkedAt && !sold?.checkedAt && !scan
              ? 'Buscando o preço… chega em alguns minutos.'
              : scan?.notFound
                ? `Não achei esta carta no MYP Cards (${scan.notFound}) nem vendas registradas dela neste estado. Você pode preencher "Meu valor".`
              : scan
                ? `Sem oferta no MYP Cards em ${mypCondition(condition)} desta versão (${versionLabel}) em ${LANG_LABEL[entry.lang].toLowerCase()}, nem vendas registradas. Veja os outros estados abaixo ou preencha "Meu valor".`
              : !mypFitsVariant(entry.variant)
                ? 'Sem preço desta versão: o MYP Cards (via Zukan) só informa o preço da versão comum, e não há vendas registradas desta versão. Preencha "Meu valor" com o valor que você conferiu.'
                : mypCovers(entry.lang)
                ? 'Sem anúncio no MYP Cards nem vendas registradas desta carta neste estado. Você pode preencher "Meu valor".'
                : 'Sem vendas registradas desta carta neste estado (o MYP Cards não informa preço de cartas japonesas). Você pode preencher "Meu valor".'}
          </Text>
        )}

        {/* Versão especial: o preço do MYP é da versão comum, então aparece só como referência. */}
        {!scan && myp?.price != null && !mypFitsVariant(entry.variant) ? (
          <Text style={styles.note}>
            Versão comum no MYP Cards: {formatBRL(myp.price)}. Não entra no valor: a sua versão ({VARIANTS.find((v) => v.id === entry.variant)?.label ?? entry.variant}) vale outra coisa.
          </Text>
        ) : null}

        {/* Com mais de um valor (ex.: vendas reais e o MYP), lista cada um; o que vale fica destacado. */}
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

        {/* Ofertas do MYP em cada estado, no idioma e na versão da carta. */}
        {scan?.byCondition && Object.keys(scan.byCondition).length ? (
          <>
            <Pressable onPress={() => scan.url && WebBrowser.openBrowserAsync(scan.url)} accessibilityRole="link" disabled={!scan.url}>
              <Text style={[styles.label, { marginTop: 6 }]}>
                Ofertas no MYP por estado · {LANG_LABEL[entry.lang].toLowerCase()}, {versionLabel.toLowerCase()}
                {scan.url ? <Text style={styles.srcLink}> ↗</Text> : null}
              </Text>
            </Pressable>
            <View style={styles.conds}>
              {(['NM', 'SP', 'MP', 'HP', 'DM'] as MypCondition[]).map((id) => {
                const c = scan.byCondition?.[id];
                const active = id === mypCondition(condition);
                return (
                  <View key={id} style={[styles.cond, active && styles.condActive]} accessibilityLabel={`${id}: ${c ? formatBRL(c.min) : 'sem oferta'}`}>
                    <Text style={[styles.condId, active && { color: colors.primary }]}>{id}</Text>
                    <Text style={styles.condValue} numberOfLines={1}>
                      {c ? formatBRLShort(c.min) : '—'}
                    </Text>
                    <Text style={styles.condCount}>{c?.count ? `${c.count} un.` : ''}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        {/* Vendas reais em cada estado, no idioma da carta (o site pede para preservar idioma e estado). */}
        {sold?.byCondition && Object.values(sold.byCondition).some((c) => c?.value != null) ? (
          <>
            <Text style={[styles.label, { marginTop: 6 }]}>
              Vendas reais por estado{sold.variant ? ` · ${sold.variant}` : ''}
            </Text>
            {!soldMatchesVariant(entry.variant, sold.variant) ? (
              <Text style={styles.note}>
                São vendas da versão {sold.variant}; a sua é {VARIANTS.find((v) => v.id === entry.variant)?.label ?? entry.variant}, então elas não
                entram no valor (só referência).
              </Text>
            ) : null}
            <View style={styles.conds}>
              {CONDITIONS.map(({ id }) => {
                const c = sold.byCondition?.[id];
                if (!c) return null;
                const active = id === condition;
                return (
                  <View key={id} style={[styles.cond, active && styles.condActive]} accessibilityLabel={`${id}: ${c.value != null ? formatBRL(c.value) : 'sem vendas'}`}>
                    <Text style={[styles.condId, active && { color: colors.primary }]}>{id}</Text>
                    <Text style={styles.condValue} numberOfLines={1}>
                      {c.value != null ? formatBRLShort(c.value) : '—'}
                    </Text>
                    <Text style={styles.condCount}>{c.count ? `${c.count}×` : ''}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : sold?.checkedAt ? (
          // Já consultado, mas o site não tem venda finalizada desta carta neste idioma (comum em cartas novas ou raras).
          <Text style={styles.muted}>
            Vendas reais: nenhuma venda finalizada registrada desta carta neste idioma no Quanto vale minha carta? (consultado em{' '}
            {formatWhen(sold.checkedAt)}).
          </Text>
        ) : null}

        <StoreLinks mypUrl={(ref?.basis === 'mypOffer' && entry.mypOffers?.url) || MYP_URL} ligaUrl={ligaUrl} />

        <Text style={styles.source}>
          Anúncios do{' '}
          <Text style={styles.sourceLink} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(MYP_URL)}>
            MYP Cards
          </Text>{' '}
          e vendas reais finalizadas do{' '}
          <Text style={styles.sourceLink} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(sold?.url ?? QVMC_URL)}>
            Quanto vale minha carta?
          </Text>
          {(entry.mypOffers?.checkedAt ?? myp?.checkedAt) ? ` · atualizado em ${formatWhen((entry.mypOffers?.checkedAt ?? myp?.checkedAt)!)}` : ''}
        </Text>
      </View>

      <PriceHistory history={myp?.history} />
    </View>
  );
}

/** Botões para ver a carta nas lojas: anúncios no MYP Cards (fonte do valor) e na LigaPokemon. */
function StoreLinks({ mypUrl, ligaUrl }: { mypUrl: string; ligaUrl?: string }) {
  return (
    <View style={styles.storeRow}>
      <Pressable
        onPress={() => WebBrowser.openBrowserAsync(mypUrl)}
        style={({ pressed }) => [styles.storeButton, pressed && { opacity: 0.8 }]}
        accessibilityRole="link"
        accessibilityLabel="Ver anúncios da carta no MYP Cards">
        <Text style={styles.storeButtonText} numberOfLines={1}>
          MYP Cards ↗
        </Text>
      </Pressable>
      {ligaUrl ? (
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync(ligaUrl)}
          style={({ pressed }) => [styles.storeButton, pressed && { opacity: 0.8 }]}
          accessibilityRole="link"
          accessibilityLabel="Ver a carta na Liga Pokémon">
          <Text style={styles.storeButtonText} numberOfLines={1}>
            Liga Pokémon ↗
          </Text>
          </Pressable>
      ) : null}
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
  conds: { flexDirection: 'row', gap: 4, marginTop: 2 },
  note: { color: colors.warning, fontSize: 12, lineHeight: 16 },
  cond: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 5,
    alignItems: 'center',
  },
  condActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  condId: { color: colors.textMuted, fontSize: 11, fontWeight: '900' },
  condValue: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 1 },
  condCount: { color: colors.textFaint, fontSize: 10, minHeight: 13 },
  storeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  storeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(47, 91, 211, 0.08)',
    flex: 1,
    paddingHorizontal: 8,
  },
  storeButtonText: { color: colors.blue, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  source: { color: colors.textFaint, fontSize: 11, lineHeight: 15 },
  sourceLink: { color: colors.blue, fontWeight: '700', textDecorationLine: 'underline' },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chartTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  legend: { flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textMuted, fontSize: 12 },
});
