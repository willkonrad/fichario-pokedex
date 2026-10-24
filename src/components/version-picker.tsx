import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';

import { Button, gridColumns } from '@/components/ui';
import { VARIANTS } from '@/lib/types';
import type { VersionOption } from '@/lib/variants';
import { CARD_RATIO, colors, elevation, radius, semantic, space, typography } from '@/theme';

const GAP = space.md;
/** Na web, o título vira <h2> (sem o nível, o react-native-web faz <h1>, e o <h1> da página é o nome da carta). */
const HEADING_LEVEL_2 = (Platform.OS === 'web' ? { 'aria-level': 2 } : {}) as object;

export const versionLabel = (o: VersionOption) => VARIANTS.find((v) => v.id === o.variant)?.label ?? o.variant;

/**
 * "Qual é a sua versão?": as versões da carta lado a lado — as da TCGdex (a mesma imagem, com o brilho, a marca ou o
 * selo de cada versão desenhados por cima) e as do catálogo, com a foto oficial —, para o colecionador tocar na que tem.
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
  /** Versão salva; só fica destacada quando bate exatamente com uma opção (variação e selo). */
  selected?: Pick<VersionOption, 'variant' | 'stamp'>;
  /** Imagem da carta na versão (a foto oficial da versão com selo, quando existir). */
  image: (o: VersionOption) => ReactNode;
  onPick: (o: VersionOption) => void;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  // Muitas versões no computador: caixa mais larga, com mais colunas.
  const boxWidth = Math.min(width - space.xxl, options.length > 6 ? 760 : 560);
  const inner = boxWidth - space.xl * 2;
  const cols = options.length <= 2 ? 2 : Math.min(options.length, gridColumns(inner, { cell: 120, gap: GAP, min: 3, max: 5 }));
  const tileWidth = Math.floor((inner - GAP * (cols - 1)) / cols);
  const same = (o: VersionOption) => !!selected && selected.variant === o.variant && (selected.stamp ?? '') === (o.stamp ?? '');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.box, { width: boxWidth }]} role="dialog" aria-modal aria-label="Qual é a sua versão?">
          <Text style={styles.title} role="heading" {...HEADING_LEVEL_2}>
            Qual é a sua versão?
          </Text>
          <Text style={styles.text}>
            {options.length === 1 ? '1 versão' : `${options.length} versões`} no catálogo. Toque na que você tem (dá para mudar depois).
          </Text>
          <ScrollView contentContainerStyle={styles.grid} role="radiogroup" aria-label="Versões da carta">
            {options.map((o) => {
              const on = same(o);
              return (
                <Pressable
                  key={`${o.variant}|${o.stamp ?? ''}`}
                  style={({ pressed }) => [{ width: tileWidth }, pressed && styles.pressed]}
                  onPress={() => onPick(o)}
                  role="radio"
                  aria-checked={on}
                  accessibilityLabel={`${versionLabel(o)}${o.stamp ? `, selo ${o.stamp}` : ''}${o.photo ? ', com foto oficial' : ''}`}>
                  <View style={[styles.thumb, { height: tileWidth / CARD_RATIO }, on && styles.thumbSelected]}>
                    {image(o)}
                    {o.photo ? null : <VersionEffect option={o} />}
                    {on ? (
                      <View style={styles.check} aria-hidden>
                        <Ionicons name="checkmark" size={14} color={semantic.selected.fg} />
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.label, on && styles.labelSelected]} numberOfLines={2}>
                    {versionLabel(o)}
                  </Text>
                  {o.stamp ? (
                    <Text style={styles.stamp} numberOfLines={3}>
                      {o.stamp}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Button title="Escolher depois" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/** Área da ilustração na carta (proporções de uma carta Pokémon comum). */
const ART = { x: 0.08, y: 0.11, w: 0.84, h: 0.4 };

/** Cores do brilho holográfico desenhado sobre a imagem (ilustração, não interface). */
const SHEEN = ['#ff6ec7', '#ffe46b', '#6bffb8', '#6bb8ff', '#c46bff'];
/** Roxo da Master Ball, no selo da versão. */
const MASTER_BALL = '#7B3FC4';

/** Desenho por cima da imagem: brilho holo na ilustração, brilho reverse fora dela, marcas e selos. */
function VersionEffect({ option }: { option: VersionOption }) {
  const v = option.variant;
  const sheen = v === 'holo' ? 'art' : v === 'reverse' || v === 'pokeball' || v === 'masterball' ? 'frame' : null;
  const mark =
    v === 'firstEdition' ? '1ª ED' : v === 'shadowless' ? 'Shadowless' : v === 'pokeball' ? 'Poké Ball' : v === 'masterball' ? 'Master Ball' : null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.noTouch]} aria-hidden>
      {sheen ? (
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
              {SHEEN.map((c, i) => (
                <Stop key={c} offset={String(i / (SHEEN.length - 1))} stopColor={c} stopOpacity={i % 2 ? 0.26 : 0.3} />
              ))}
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
        <View style={[styles.mark, v === 'firstEdition' && styles.markLeft]}>
          {v === 'pokeball' || v === 'masterball' ? (
            <Ionicons name="radio-button-on" size={10} color={v === 'masterball' ? MASTER_BALL : colors.primary} />
          ) : null}
          <Text style={styles.markText}>{mark}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  box: { maxHeight: '92%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.xl, gap: space.md, ...elevation[2] },
  title: { ...typography.title, color: colors.text },
  text: { ...typography.caption, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingVertical: space.xs },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  thumb: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceAlt, borderWidth: 2, borderColor: 'transparent' },
  // Escolhida: borda grafite (a cor da seleção), sem vermelho.
  thumbSelected: { borderColor: semantic.selected.border },
  check: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: semantic.selected.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...typography.caption, fontWeight: '600', color: colors.text, marginTop: space.xs },
  labelSelected: { fontWeight: '800' },
  stamp: { ...typography.caption, fontSize: 12, lineHeight: 16, color: colors.textMuted },
  noTouch: { pointerEvents: 'none' },
  mark: {
    position: 'absolute',
    right: 6,
    top: '53%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  markLeft: { left: 6, right: undefined },
  markText: { color: colors.text, fontSize: 11, fontWeight: '800' },
});
