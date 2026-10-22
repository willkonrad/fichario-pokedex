import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CardImage } from '@/components/card-image';
import { OwnedBadge, useOwnedCards } from '@/components/owned-badge';
import type { CardBrief } from '@/lib/tcgdex';
import { CARD_RATIO, colors, MAX_WIDTH, radius, shadow } from '@/theme';

const GAP = 10;

/** Grade de cartas para escolher (3 colunas no celular, 4–5 em telas largas), com o selo "tenho". */
export function CardGrid({
  cards,
  dex,
  onPick,
}: {
  cards: CardBrief[];
  /** Pokémon das cartas (arte reserva quando não há imagem). */
  dex?: number;
  onPick: (card: CardBrief) => void;
}) {
  const { width } = useWindowDimensions();
  const owned = useOwnedCards();
  const contentWidth = Math.min(width, MAX_WIDTH) - 32;
  const cols = contentWidth >= 600 ? 5 : contentWidth >= 460 ? 4 : 3;
  const itemWidth = Math.floor((contentWidth - GAP * (cols - 1)) / cols);

  return (
    <FlatList
      key={cols}
      data={cards}
      keyExtractor={(c) => `${c.id}|${c.lang}|${c.stamp?.label ?? ''}|${c.imageUrl ?? ''}`}
      numColumns={cols}
      columnWrapperStyle={{ gap: GAP }}
      contentContainerStyle={[styles.list, { width: contentWidth + 32 }]}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={18}
      windowSize={7}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [{ width: itemWidth }, pressed && { opacity: 0.75, transform: [{ scale: 0.97 }] }]}
          onPress={() => onPick(item)}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${item.setName}, número ${item.localId}${item.stamp ? `, com selo ${item.stamp.label}` : ''}`}>
          <View style={[styles.thumb, { height: itemWidth / CARD_RATIO }]}>
            <CardImage
              image={item.image}
              imageUrl={item.imageUrl}
              cardId={item.lang === 'ja' ? undefined : item.id}
              nameEn={item.lang === 'en' || item.dataLang === 'en' ? item.name : undefined}
              setNameEn={item.setNameEn}
              localId={item.localId}
              dex={dex}
              stampKeys={item.stamp?.keys}
            />
            {owned.has(`${item.id}|${item.lang}`) ? <OwnedBadge /> : null}
            {item.stamp ? (
              <View style={styles.stampTag}>
                <Text style={styles.stampTagText}>Selo</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.set} numberOfLines={1}>
            {item.setName} · {item.localId}
          </Text>
          {item.stamp ? (
            <Text style={styles.stamp} numberOfLines={2}>
              {item.stamp.label}
            </Text>
          ) : null}
          {item.dataLang ? (
            <Text style={styles.note} numberOfLines={1}>
              ficha em inglês
            </Text>
          ) : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 16, alignSelf: 'center' },
  thumb: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceAlt, ...shadow },
  name: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 6 },
  set: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  stamp: { color: colors.warning, fontSize: 10, fontWeight: '700', marginTop: 1 },
  stampTag: { position: 'absolute', right: 4, bottom: 4, backgroundColor: colors.yellow, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  stampTagText: { color: colors.text, fontSize: 10, fontWeight: '900' },
  note: { color: colors.blue, fontSize: 10, fontWeight: '700', marginTop: 1 },
});
