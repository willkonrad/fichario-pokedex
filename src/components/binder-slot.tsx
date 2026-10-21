import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDex, getSpecies, spriteUrl } from '@/data/pokedex';
import { CardImage } from '@/components/card-image';
import { CONFIDENCE_LABEL, pricePending, valuation } from '@/lib/valuation';
import type { Entry } from '@/lib/types';
import { binderColors as B, CARD_RATIO, colors, confidenceColors, mono, radius } from '@/theme';

const SPECIAL = new Set(['holo', 'reverse', 'firstEdition', 'pokeball', 'masterball', 'wPromo', 'shadowless', 'staff']);

/** Altura reservada para o preço embaixo de cada bolso (vazio ou não), para as linhas ficarem alinhadas. */
function priceBlockHeight(width: number) {
  return width < 80 ? 18 : 22;
}

/** Um bolso da página do fichário (página escura): a carta, ou o Pokémon/número do bolso quando vazio. */
export function BinderSlot({
  dex,
  pocket,
  width,
  entry,
  highlighted,
  showPrices = true,
  free = false,
  onPress,
}: {
  /** Fichário Pokédex: Pokémon deste espaço (mostra o sprite quando vazio). */
  dex?: number;
  /** Fichário livre: número do bolso mostrado quando vazio (omitido = não mostra). */
  pocket?: number;
  width: number;
  entry?: Entry;
  highlighted?: boolean;
  /** Reserva o espaço e mostra o preço embaixo da carta. */
  showPrices?: boolean;
  /** Bolso livre do fichário Pokédex (sobra da última página, para cartas especiais). */
  free?: boolean;
  onPress: () => void;
}) {
  const species = dex ? getSpecies(dex) : undefined;
  const height = Math.floor(width / CARD_RATIO);
  const small = width < 80;
  const tiny = width < 66;
  const special = entry && SPECIAL.has(entry.variant);

  return (
    <View style={{ width }}>
      {entry ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${entry.cardName}, ${entry.setName}${pocket != null ? `, bolso ${pocket}` : ''}`}
          style={({ pressed }) => [
            styles.slot,
            { width, height },
            special && styles.special,
            pressed && styles.pressed,
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
            dark
            stampKeys={entry.stampKeys}
          />
        </Pressable>
      ) : !dex ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={free ? 'Bolso livre para carta especial, escolher carta' : pocket != null ? `Bolso ${pocket} vazio, escolher carta` : 'Bolso vazio, escolher carta'}
          style={({ pressed }) => [styles.slot, styles.pocket, free && styles.free, { width, height }, pressed && styles.pressed, highlighted && styles.highlight]}>
          {pocket != null ? <Text style={[styles.dex, styles.pocketNumber, small && { fontSize: 9 }]}>{pocket}</Text> : null}
          <Ionicons name={free ? 'star-outline' : 'add'} size={small ? 18 : 24} color={free ? colors.yellow : B.textFaint} />
          {free && !tiny ? <Text style={[styles.freeText, small && { fontSize: 9 }]}>bolso livre</Text> : null}
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
            pressed && styles.pressed,
            highlighted && styles.highlight,
          ]}>
          <Text style={[styles.dex, small && { fontSize: 9 }]}>{formatDex(dex)}</Text>
          <Image
            source={spriteUrl(dex)}
            style={{ width: width * (small ? 0.55 : 0.65), height: width * (small ? 0.55 : 0.65), opacity: 0.4 }}
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
        <View style={{ height: priceBlockHeight(width), paddingTop: 3 }}>{entry ? <SlotPrice entry={entry} small={small} /> : null}</View>
      ) : null}
    </View>
  );
}

/** Valor da carta numa cápsula; a cor diz a confiança. Sem valor: "buscando" ou "sem preço". */
function SlotPrice({ entry, small }: { entry: Entry; small: boolean }) {
  const size = small ? 8 : 10;
  const ref = valuation(entry);
  const h = small ? 15 : 18;
  if (ref.value == null || !ref.confidence) {
    // Buscando = o servidor ainda não consultou nenhuma fonte de preço para esta carta.
    const pending = pricePending(entry);
    return (
      <View style={[styles.pill, styles.pillPending, { height: h }]}>
        <Text style={[styles.pendingText, { fontSize: size }]} numberOfLines={1}>
          {pending ? 'buscando…' : 'sem preço'}
        </Text>
      </View>
    );
  }
  const tone = confidenceColors.dark[ref.confidence];
  return (
    <View
      style={[styles.pill, { height: h, backgroundColor: tone.bg }]}
      accessibilityLabel={`Valor ${ref.value.toFixed(2)} reais, ${CONFIDENCE_LABEL[ref.confidence]}`}>
      <Text style={[styles.priceText, { fontSize: size, color: tone.fg }]} numberOfLines={1}>
        <Text style={{ fontSize: size - 2, fontWeight: '700' }}>R$ </Text>
        {formatCompact(ref.value)}
      </Text>
    </View>
  );
}

/** Valor curto para caber na cápsula: "0,80", "83", "1,2 mil". */
function formatCompact(n: number) {
  if (n < 10) return n.toFixed(2).replace('.', ',');
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1).replace('.', ',')} mil`;
}

const styles = StyleSheet.create({
  slot: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: B.pocket, borderWidth: 1, borderColor: B.pocketBorder },
  special: { borderColor: colors.yellow, borderWidth: 2 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  empty: { alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 3 },
  // Destaque de busca/"Vazio": ciano de seleção do Nintendo Switch (diferente do amarelo das cartas especiais).
  highlight: { borderColor: '#2EE6F2', borderWidth: 3 },
  pocket: { borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  pocketNumber: { position: 'absolute', top: 6, right: 4 },
  free: { borderColor: 'rgba(255, 203, 5, 0.45)', gap: 4 },
  freeText: { color: B.textMuted, fontSize: 11, fontWeight: '700' },
  dex: { alignSelf: 'flex-end', color: B.textFaint, fontFamily: mono, fontSize: 12, paddingRight: 3 },
  names: { alignItems: 'center', width: '100%' },
  name: { color: B.textMuted, fontWeight: '700', fontSize: 13 },
  sub: { color: B.textFaint, fontSize: 10, marginTop: 1 },
  pill: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  pillPending: { backgroundColor: 'rgba(255,255,255,0.05)' },
  pendingText: { color: B.textFaint, fontStyle: 'italic' },
  priceText: { fontWeight: '800', includeFontPadding: false },
});
