import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';

import { Button } from '@/components/ui';
import { VARIANTS } from '@/lib/types';
import type { VersionOption } from '@/lib/variants';
import { CARD_RATIO, colors, radius, shadow } from '@/theme';

const GAP = 12;

export const versionLabel = (o: VersionOption) => VARIANTS.find((v) => v.id === o.variant)?.label ?? o.variant;

/**
 * "Qual é a sua versão?": as versões visuais da carta lado a lado (a mesma imagem, com o brilho, a marca ou o selo
 * de cada versão desenhados por cima), para o colecionador tocar na que tem.
 */
export function VersionPicker({
  visible,
  options,
  selected,
  image,
  onPick,
  onClose,
}: {
  visible: boolean;
  options: VersionOption[];
  selected?: VersionOption;
  /** Imagem da carta (a TCGdex tem uma imagem por carta, não por versão). */
  image: () => ReactNode;
  onPick: (o: VersionOption) => void;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const boxWidth = Math.min(width - 32, 560);
  const cols = options.length <= 2 ? 2 : 3;
  const tileWidth = Math.floor((boxWidth - 40 - GAP * (cols - 1)) / cols);
  const exact = (o: VersionOption) => selected?.variant === o.variant && (selected.stamp ?? '') === (o.stamp ?? '');
  // Sem a versão exata (ex.: promo salva sem o nome do selo), destaca a primeira da mesma variação.
  const fallback = options.some(exact) ? undefined : options.find((o) => o.variant === selected?.variant);
  const same = (o: VersionOption) => exact(o) || o === fallback;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.box, { width: boxWidth }]}>
          <Text style={styles.title}>Qual é a sua versão?</Text>
          <Text style={styles.text}>Esta carta tem {options.length} versões. Toque na que você tem; dá para mudar depois em &quot;Variação&quot;.</Text>
          <ScrollView contentContainerStyle={styles.grid}>
            {options.map((o) => (
              <Pressable
                key={`${o.variant}|${o.stamp ?? ''}`}
                style={({ pressed }) => [{ width: tileWidth }, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
                onPress={() => onPick(o)}
                accessibilityRole="button"
                accessibilityState={{ selected: same(o) }}
                accessibilityLabel={`${versionLabel(o)}${o.stamp ? `, selo ${o.stamp}` : ''}`}>
                <View style={[styles.thumb, { height: tileWidth / CARD_RATIO }, same(o) && styles.thumbSelected]}>
                  {image()}
                  <VersionEffect option={o} />
                </View>
                <Text style={[styles.label, same(o) && { color: colors.primary }]} numberOfLines={2}>
                  {versionLabel(o)}
                </Text>
                {o.stamp ? (
                  <Text style={styles.stamp} numberOfLines={3}>
                    Selo: {o.stamp}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
          <Button title="Escolher depois" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** Área da ilustração na carta (proporções de uma carta Pokémon comum). */
const ART = { x: 0.08, y: 0.11, w: 0.84, h: 0.4 };

/** Desenho por cima da imagem: brilho holo na ilustração, brilho reverse fora dela, marcas e selos. */
function VersionEffect({ option }: { option: VersionOption }) {
  const v = option.variant;
  const sheen = v === 'holo' ? 'art' : v === 'reverse' || v === 'pokeball' || v === 'masterball' ? 'frame' : null;
  const mark =
    v === 'firstEdition' ? '1ª ED' : v === 'shadowless' ? 'Shadowless' : v === 'pokeball' ? 'Poké Ball' : v === 'masterball' ? 'Master Ball' : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {sheen ? (
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#ff6ec7" stopOpacity="0.3" />
              <Stop offset="0.3" stopColor="#ffe46b" stopOpacity="0.26" />
              <Stop offset="0.55" stopColor="#6bffb8" stopOpacity="0.26" />
              <Stop offset="0.8" stopColor="#6bb8ff" stopOpacity="0.3" />
              <Stop offset="1" stopColor="#c46bff" stopOpacity="0.3" />
            </LinearGradient>
            <Mask id="frame">
              <Rect x="0" y="0" width="100" height="100" fill="#fff" />
              <Rect x={ART.x * 100} y={ART.y * 100} width={ART.w * 100} height={ART.h * 100} fill="#000" />
            </Mask>
          </Defs>
          {sheen === 'art' ? (
            <Rect x={ART.x * 100} y={ART.y * 100} width={ART.w * 100} height={ART.h * 100} fill="url(#sheen)" />
          ) : (
            <Rect x="0" y="0" width="100" height="100" fill="url(#sheen)" mask="url(#frame)" />
          )}
        </Svg>
      ) : null}
      {mark ? (
        <View style={[styles.mark, v === 'firstEdition' && { left: 6, right: undefined }]}>
          {v === 'pokeball' || v === 'masterball' ? (
            <Ionicons name="radio-button-on" size={10} color={v === 'masterball' ? '#7B3FC4' : colors.primary} />
          ) : null}
          <Text style={styles.markText}>{mark}</Text>
        </View>
      ) : null}
      {option.stamp ? (
        <View style={styles.stampBadge}>
          <Ionicons name="ribbon" size={11} color={colors.text} />
          <Text style={styles.stampBadgeText} numberOfLines={1}>
            Selo
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { maxHeight: '92%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, gap: 12, ...shadow },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  text: { color: colors.textMuted, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingVertical: 4 },
  thumb: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceAlt, borderWidth: 2, borderColor: 'transparent' },
  thumbSelected: { borderColor: colors.primary },
  label: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 6 },
  stamp: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  mark: {
    position: 'absolute',
    right: 6,
    top: '53%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  markText: { color: colors.text, fontSize: 10, fontWeight: '900' },
  stampBadge: {
    position: 'absolute',
    right: 6,
    top: '42%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.yellow,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stampBadgeText: { color: colors.text, fontSize: 10, fontWeight: '900' },
});
