import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';

import { IconButton, type PressState } from '@/components/icon-button';
import { colors, radius, semantic, shadow, space, TOUCH, typography } from '@/theme';

const WEB = Platform.OS === 'web';
/** Largura da janela abaixo da qual o paginador fica compacto. */
const COMPACT_BELOW = 420;

/**
 * Paginador (H5): ‹ | "Pág. 13 de 52" com a faixa e quantos bolsos têm carta ("#241–#260 · 15/20") | › | "Próxima
 * falta". Tocar no número abre "Ir para a página". A página nova é anunciada pelo leitor de tela (A7).
 */
export function HomePager({
  label,
  pages,
  detail,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onGoTo,
  onNextEmpty,
  nextEmptyLabel,
}: {
  /** "Pág. 13" ou "Págs. 12–13". */
  label: string;
  pages: number;
  /** Segunda linha: faixa e preenchimento. */
  detail?: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: () => void;
  onNextEmpty?: () => void;
  /** "Próxima falta" (Pokédex) ou "Próximo vazio" (fichário livre). */
  nextEmptyLabel: string;
}) {
  // Celular estreito (375 px): sem o ícone e com menos respiro no "Próxima falta", para "Pág. 113 de 114" e a faixa
  // "#1009–#1017 · 5/9" caberem no meio sem reticências.
  const compact = useWindowDimensions().width < COMPACT_BELOW;
  return (
    <View style={[styles.pager, compact && styles.pagerCompact]}>
      <IconButton icon="chevron-back" label="Página anterior" onPress={onPrev} disabled={!canPrev} size={22} tone="soft" style={styles.arrow} />
      <Pressable
        onPress={onGoTo}
        role="button"
        accessibilityLabel={`${label} de ${pages}${detail ? `, ${detail}` : ''}. Ir para outra página`}
        style={(s) => {
          const { pressed, hovered } = s as PressState;
          return [styles.mid, hovered && styles.midHover, pressed && { opacity: 0.7 }];
        }}>
        {/* Região "ao vivo": a página nova é lida ao folhear (Android e web; o iOS anuncia à parte). */}
        <Text style={styles.title} numberOfLines={1} aria-live={WEB ? 'polite' : undefined} accessibilityLiveRegion="polite">
          {label} <Text style={styles.of}>de {pages}</Text>
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </Pressable>
      <IconButton icon="chevron-forward" label="Próxima página" onPress={onNext} disabled={!canNext} size={22} tone="soft" style={styles.arrow} />
      {onNextEmpty ? (
        <Pressable
          onPress={onNextEmpty}
          role="button"
          accessibilityLabel={`Ir para: ${nextEmptyLabel.toLowerCase()}`}
          style={(s) => {
            const { pressed, hovered } = s as PressState;
            return [styles.next, compact && styles.nextCompact, hovered && styles.nextHover, pressed && { opacity: 0.8 }];
          }}>
          {compact ? null : <Ionicons name="arrow-redo-outline" size={15} color={colors.text} />}
          <Text style={styles.nextText} numberOfLines={1}>
            {nextEmptyLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export type RegionChip = { id: string; label: string; filled: number; count: number; active: boolean; onPress: () => void };

/**
 * Régua de regiões (H5): "Kanto 31/151" com uma barrinha de progresso; a da página aberta fica marcada e o toque leva
 * à região. `vertical`: lista com barras, para o painel do computador.
 */
export function RegionRuler({ regions, vertical = false }: { regions: RegionChip[]; vertical?: boolean }) {
  const scroll = useRef<ScrollViewInstance>(null);
  const xs = useRef<Record<string, number>>({});
  const activeId = regions.find((r) => r.active)?.id;

  // A região da página aberta fica à vista na régua (ao folhear para outra região, a régua acompanha).
  useEffect(() => {
    const x = activeId ? xs.current[activeId] : undefined;
    if (!vertical && x != null) scroll.current?.scrollTo({ x: Math.max(0, x - space.lg), animated: true });
  }, [activeId, vertical]);

  const chips = regions.map((r) => {
    const done = r.filled >= r.count;
    const pct = `${Math.min(100, (r.filled / Math.max(1, r.count)) * 100)}%` as const;
    return (
      <Pressable
        key={r.id}
        onPress={r.onPress}
        onLayout={(e) => {
          xs.current[r.id] = e.nativeEvent.layout.x;
          if (r.active && !vertical) scroll.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - space.lg), animated: false });
        }}
        role="button"
        accessibilityLabel={`${r.label}: ${r.filled} de ${r.count}${done ? ', completa' : ''}${r.active ? ', página aberta' : ''}`}
        style={(s) => {
          const { pressed, hovered } = s as PressState;
          return [vertical ? styles.regionRow : styles.chip, r.active && styles.chipActive, hovered && !r.active && styles.chipHover, pressed && { opacity: 0.75 }];
        }}>
        <View style={styles.chipHead}>
          {done ? <Ionicons name="checkmark-circle" size={14} color={r.active ? semantic.selected.fg : semantic.success.fg} /> : null}
          <Text style={[styles.chipLabel, r.active && styles.chipLabelActive]} numberOfLines={1}>
            {r.label}
          </Text>
          <Text style={[styles.chipCount, r.active && styles.chipLabelActive, vertical && styles.countEnd]}>
            {r.filled}/{r.count}
          </Text>
        </View>
        <View style={[styles.bar, r.active && styles.barActive]}>
          <View style={[styles.barFill, { width: pct }]} />
        </View>
      </Pressable>
    );
  });

  if (vertical) return <View style={styles.regionList}>{chips}</View>;
  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ruler} role="toolbar" aria-label="Regiões">
      {chips}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pager: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingVertical: space.xs },
  pagerCompact: { gap: space.xs },
  arrow: { backgroundColor: colors.surface, ...shadow },
  mid: { flex: 1, minWidth: 0, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  midHover: { backgroundColor: semantic.hover.onLight },
  title: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '800', ...typography.tabular },
  of: { color: colors.textMuted, fontWeight: '600' },
  detail: { ...typography.caption, fontSize: 12, lineHeight: 16, color: colors.textMuted, ...typography.tabular },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    flexShrink: 0,
  },
  nextCompact: { paddingHorizontal: space.sm },
  nextHover: { borderColor: colors.borderStrong },
  nextText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  ruler: { gap: space.sm, paddingVertical: space.xs },
  regionList: { gap: space.xs },
  chip: {
    minWidth: 92,
    minHeight: 40,
    paddingHorizontal: space.md,
    paddingTop: 6,
    paddingBottom: 7,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    justifyContent: 'center',
    gap: 4,
  },
  regionRow: { minHeight: TOUCH, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm, justifyContent: 'center', gap: 4 },
  chipActive: { backgroundColor: semantic.selected.bg, borderColor: semantic.selected.border },
  chipHover: { borderColor: colors.borderStrong, backgroundColor: semantic.hover.onLight },
  chipHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chipLabel: { color: colors.text, fontSize: 13, lineHeight: 16, fontWeight: '700' },
  chipLabelActive: { color: semantic.selected.fg },
  chipCount: { color: colors.textMuted, fontSize: 12, lineHeight: 16, fontWeight: '600', ...typography.tabular },
  countEnd: { marginLeft: 'auto' },
  bar: { height: 3, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  barActive: { backgroundColor: semantic.brand.track },
  barFill: { height: 3, borderRadius: 2, backgroundColor: semantic.special.fill },
});
