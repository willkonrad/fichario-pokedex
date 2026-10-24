import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardImage } from '@/components/card-image';
import type { PressState } from '@/components/icon-button';
import { entrySummary } from '@/lib/lists';
import { mypPtImage } from '@/lib/myp-api';
import type { Entry } from '@/lib/types';
import { CARD_RATIO, colors, radius, semantic, space, typography } from '@/theme';

const THUMB = 44;

/**
 * Carta salva numa lista (busca na coleção, "Tenho repetida"): miniatura, nome, coleção e versão, e onde ela está no
 * fichário (a linha que a pessoa procura). À direita, opcionalmente, o valor. A linha inteira abre a carta.
 */
export function EntryRow({
  entry,
  place,
  note,
  right,
  rightLabel,
  onPress,
}: {
  entry: Entry;
  /** "Fichário Pokédex · pág. 2, bolso 5". */
  place: string;
  /** Selo curto ao lado do nome ("3 cópias"). */
  note?: string;
  right?: ReactNode;
  /** O que o leitor de tela diz do `right` (ex.: o preço, com o motivo do "≈"); a linha inteira é um botão só. */
  rightLabel?: string;
  onPress: () => void;
}) {
  const details = entrySummary(entry);
  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityLabel={`${entry.cardName}${note ? `, ${note}` : ''}, ${details}, ${place}${rightLabel ? `, ${rightLabel}` : ''}`}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [styles.row, hovered && { backgroundColor: semantic.hover.onLight }, pressed && { opacity: 0.7 }];
      }}>
      <View style={styles.thumb}>
        <CardImage
          image={entry.image}
          imageUrl={entry.imageUrl}
          cardId={entry.lang === 'ja' ? undefined : entry.cardId}
          localId={entry.localId}
          dex={entry.dex || undefined}
          compact
          stampKeys={entry.stampKeys}
          photo={entry.stampPhoto}
          ptImage={mypPtImage(entry)}
          recyclingKey={entry.id}
        />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {entry.cardName}
          </Text>
          {note ? <Text style={styles.note}>{note}</Text> : null}
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {details}
        </Text>
        <View style={styles.placeRow}>
          <Ionicons name="location-outline" size={13} color={colors.textMuted} />
          <Text style={styles.place} numberOfLines={2}>
            {place}
          </Text>
        </View>
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs, borderRadius: radius.sm },
  thumb: { width: THUMB, height: THUMB / CARD_RATIO, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  body: { flex: 1, minWidth: 0, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { ...typography.bodyStrong, color: colors.text, flexShrink: 1 },
  note: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600',
    color: semantic.tag.fg,
    backgroundColor: semantic.tag.bg,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    overflow: 'hidden',
  },
  sub: { ...typography.caption, color: colors.textMuted },
  placeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  place: { ...typography.caption, color: colors.text, flex: 1 },
});
