import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDex, getSpecies, spriteUrl } from '@/data/pokedex';
import { CardImage } from '@/components/card-image';
import { entryRange } from '@/lib/quotes';
import { CONFIDENCE_LABEL, valuation } from '@/lib/valuation';
import type { Entry } from '@/lib/types';
import { CARD_RATIO, colors, mono, radius } from '@/theme';

const SPECIAL = new Set(['holo', 'reverse', 'firstEdition', 'pokeball', 'masterball', 'wPromo', 'shadowless', 'staff']);

// Cores da cápsula de preços (mesmas do quadro da carta): menor, médio, maior.
const SEGMENT = {
  min: { bg: 'rgba(139, 214, 107, 0.16)', fg: '#9BE07C' },
  avg: { bg: 'rgba(232, 194, 90, 0.26)', fg: '#F2CF6B' },
  max: { bg: 'rgba(224, 215, 168, 0.12)', fg: '#D9D0A2' },
};

// Valor de referência: a cor diz a confiança (verde alta, âmbar média, cinza baixa).
const TONE = {
  alta: { bg: 'rgba(76, 195, 138, 0.18)', fg: '#5FD69C' },
  media: { bg: 'rgba(232, 194, 90, 0.18)', fg: '#F2CF6B' },
  baixa: { bg: 'rgba(138, 138, 147, 0.16)', fg: '#A8A8B0' },
};

/** Altura reservada para os preços embaixo de cada espaço (vazio ou não), para as linhas ficarem alinhadas. */
export function priceBlockHeight(width: number) {
  return width < 80 ? 18 : 22;
}

export function BinderSlot({
  dex,
  pocket,
  width,
  entry,
  highlighted,
  showPrices = true,
  onPress,
}: {
  /** Fichário Pokédex: Pokémon deste espaço (mostra o sprite quando vazio). */
  dex?: number;
  /** Fichário livre: número do bolso mostrado quando vazio (omitido = não mostra). */
  pocket?: number;
  width: number;
  entry?: Entry;
  highlighted?: boolean;
  /** Reserva o espaço e mostra a cápsula de preços embaixo da carta. */
  showPrices?: boolean;
  onPress: () => void;
}) {
  const species = dex ? getSpecies(dex) : undefined;
  const height = Math.floor(width / CARD_RATIO);
  const small = width < 80;
  const tiny = width < 66;

  return (
    <View style={{ width }}>
      {entry ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${entry.cardName}, ${entry.setName}${pocket != null ? `, bolso ${pocket}` : ''}`}
          style={({ pressed }) => [
            styles.slot,
            {
              width,
              height,
              borderColor: SPECIAL.has(entry.variant) ? colors.gold : colors.border,
              borderWidth: SPECIAL.has(entry.variant) ? 2 : 1,
            },
            pressed && { opacity: 0.75 },
            highlighted && styles.highlight,
          ]}>
          <CardImage
            image={entry.image}
            imageUrl={entry.imageUrl ?? entry.ligaImage}
            cardId={entry.lang === 'ja' ? undefined : entry.cardId}
            localId={entry.localId}
            label={entry.cardName}
            dex={entry.dex || undefined}
            compact
          />
        </Pressable>
      ) : !dex ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={pocket != null ? `Bolso ${pocket} vazio, escolher carta` : 'Bolso vazio, escolher carta'}
          style={({ pressed }) => [
            styles.slot,
            styles.pocket,
            { width, height },
            pressed && { opacity: 0.6 },
            highlighted && styles.highlight,
          ]}>
          {pocket != null ? <Text style={[styles.dex, styles.pocketNumber, small && { fontSize: 9 }]}>{pocket}</Text> : null}
          <Ionicons name="add" size={small ? 18 : 24} color={colors.textFaint} />
        </Pressable>
      ) : (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${formatDex(dex)} ${species?.name ?? ''}, vazio, escolher carta`}
          style={({ pressed }) => [
            styles.slot,
            styles.empty,
            { width, height, paddingVertical: small ? 4 : 8 },
            pressed && { opacity: 0.6 },
            highlighted && styles.highlight,
          ]}>
          <Text style={[styles.dex, small && { fontSize: 9 }]}>{formatDex(dex)}</Text>
          <Image
            source={spriteUrl(dex)}
            style={{ width: width * (small ? 0.5 : 0.6), height: width * (small ? 0.5 : 0.6), opacity: 0.35 }}
            contentFit="contain"
          />
          <View style={styles.names}>
            <Text style={[styles.name, small && { fontSize: 10 }]} numberOfLines={1}>
              {species?.name}
            </Text>
            {tiny ? null : (
              <Text style={[styles.sub, small && { fontSize: 8 }]} numberOfLines={1}>
                {species?.ja}
              </Text>
            )}
          </View>
        </Pressable>
      )}
      {showPrices ? (
        <View style={{ height: priceBlockHeight(width), paddingTop: 3 }}>{entry ? <SlotPrices entry={entry} small={small} /> : null}</View>
      ) : null}
    </View>
  );
}

/**
 * Menor / médio / maior reais da carta na Liga (do acabamento dela), numa cápsula segmentada:
 * verde (menor), dourado (médio, em destaque com "R$") e bege (maior).
 */
function SlotPrices({ entry, small }: { entry: Entry; small: boolean }) {
  const r = entryRange(entry);
  const size = small ? 7.5 : 10;
  // Valor de referência (todas as fontes cruzadas); a cor diz a confiança.
  const ref = valuation(entry);
  if (ref.value != null && ref.confidence) {
    const tone = TONE[ref.confidence];
    return (
      <View
        style={[styles.pill, styles.single, { height: small ? 14 : 18, backgroundColor: tone.bg }]}
        accessibilityLabel={`Valor de referência ${ref.value.toFixed(2)} reais, ${CONFIDENCE_LABEL[ref.confidence]}`}>
        <View style={[styles.dot, { backgroundColor: tone.fg }]} />
        <Text style={[styles.segmentText, styles.segmentAvg, { fontSize: size, color: tone.fg }]} numberOfLines={1}>
          <Text style={{ fontSize: size - 2, fontWeight: '600' }}>R$</Text>
          {formatCompact(ref.value)}
        </Text>
      </View>
    );
  }
  if (!r) {
    return (
      <View style={[styles.pill, styles.pillPending, { height: small ? 14 : 18 }]}>
        <Text style={[styles.pendingText, { fontSize: size }]} numberOfLines={1}>
          {entry.ligaNotFound ? 'sem cotação' : 'na fila'}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.pill, { height: small ? 14 : 18 }]}>
      {(['min', 'avg', 'max'] as const).map((k, i) => (
        <View
          key={k}
          style={[
            styles.segment,
            { backgroundColor: SEGMENT[k].bg, flexGrow: k === 'avg' ? 1.8 : 1 },
            i > 0 && styles.segmentDivider,
          ]}>
          <Text
            style={[styles.segmentText, { fontSize: size, color: SEGMENT[k].fg }, k === 'avg' && styles.segmentAvg]}
            numberOfLines={1}>
            {k === 'avg' ? <Text style={{ fontSize: size - 2, fontWeight: '600' }}>R$</Text> : null}
            {formatCompact(r[k])}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Valor curto para caber na cápsula: "0,8", "83", "1,2k". */
function formatCompact(n?: number) {
  if (n == null) return '—';
  if (n < 10) return n.toFixed(1).replace('.', ',');
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1).replace('.', ',')}k`;
}

const styles = StyleSheet.create({
  slot: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface },
  empty: {
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 3,
  },
  highlight: { borderColor: colors.accent, borderWidth: 2 },
  pocket: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pocketNumber: { position: 'absolute', top: 6, right: 4 },
  dex: { alignSelf: 'flex-end', color: colors.textFaint, fontFamily: mono, fontSize: 12, paddingRight: 3 },
  names: { alignItems: 'center', width: '100%' },
  name: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  sub: { color: colors.textFaint, fontSize: 10, marginTop: 1 },
  pill: {
    flexDirection: 'row',
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pillPending: { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pendingText: { color: colors.textFaint, fontStyle: 'italic' },
  segment: { flexBasis: 0, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0.5 },
  single: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  segmentDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: 'rgba(0,0,0,0.45)' },
  segmentText: { fontWeight: '600', includeFontPadding: false },
  segmentAvg: { fontWeight: '800' },
});
