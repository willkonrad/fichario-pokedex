import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, type PressState } from '@/components/icon-button';
import { breakpoints, colors, radius, semantic, space, TOUCH, typography, widths } from '@/theme';

/**
 * Barra do topo da home, fixa e na cor da capa do fichário (AR3, H4): menu, nome do fichário (troca de fichário) com
 * o progresso, busca e personalizar, e um traço de progresso embaixo. No computador, uma barra só com a busca no
 * meio e o "+ Carta". Com `onFind`, um botão "Buscar na coleção" (E2) ao lado da busca (tablet) ou do "+ Carta"
 * (no celular, não: o nome do fichário ficaria cortado).
 */
export function HomeTopBar({
  title,
  subtitle,
  cover,
  ink,
  progress,
  desktop,
  gutter,
  contentWidth,
  search,
  searchOpen,
  onToggleSearch,
  onMenu,
  onSwitch,
  onEdit,
  onAdd,
  onFind,
  onHeight,
}: {
  title: string;
  /** "48 de 1.025 Pokémon". */
  subtitle: string;
  cover: string;
  /** Texto e ícones sobre a capa (branco ou tinta escura, o que tiver mais contraste). */
  ink: string;
  /** 0 a 1. */
  progress: number;
  desktop: boolean;
  gutter: number;
  /** Computador: largura do fichário (páginas + painel), para a barra alinhar com ele. */
  contentWidth?: number;
  /** O campo de busca (no computador fica sempre na barra; no celular, abre embaixo dela). */
  search: ReactNode;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onMenu: () => void;
  onSwitch: () => void;
  onEdit: () => void;
  onAdd: () => void;
  /** Busca na coleção inteira (E2), em todos os fichários. Sem ele, o botão não aparece. */
  onFind?: () => void;
  onHeight: (h: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Ícone diferente da lupa da busca no fichário, que fica ao lado no tablet. No celular não cabe um 4º ícone sem cortar
  // o nome do fichário: lá a busca na coleção fica na "Minha coleção" e na busca ao vivo ("Procurar em toda a coleção").
  const findButton =
    onFind && (desktop || width >= breakpoints.tablet) ? <IconButton icon="library-outline" label="Buscar na coleção" tone="onBrand" color={ink} onPress={onFind} /> : null;
  // Progresso em amarelo-foil na capa vermelha da marca; nas outras capas, na cor do texto (o amarelo some no amarelo).
  const fill = cover.toUpperCase() === semantic.brand.bg ? semantic.special.fill : ink;
  const pct = `${Math.max(1.5, Math.min(100, progress * 100))}%` as const;

  const titleButton = (
    <Pressable
      onPress={onSwitch}
      role="button"
      accessibilityLabel={`${title}, ${subtitle}. Trocar de fichário`}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [styles.titleBtn, desktop && styles.titleBtnDesktop, hovered && styles.titleHover, pressed && { opacity: 0.7 }];
      }}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, desktop && styles.titleDesktop, { color: ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Ionicons name="chevron-down" size={18} color={ink} />
      </View>
      <Text style={[styles.subtitle, { color: ink }]} numberOfLines={1}>
        {subtitle}
      </Text>
    </Pressable>
  );

  return (
    <View
      style={[styles.bar, { backgroundColor: cover, paddingTop: insets.top }]}
      onLayout={(e: LayoutChangeEvent) => onHeight(e.nativeEvent.layout.height)}>
      {desktop ? (
        <View style={[styles.row, styles.rowDesktop, { paddingHorizontal: gutter }, contentWidth ? { maxWidth: contentWidth + gutter * 2 } : null]}>
          <View style={styles.side}>
            <IconButton icon="menu" label="Minha coleção" tone="onBrand" color={ink} onPress={onMenu} />
            {titleButton}
          </View>
          <View style={styles.searchDesktop}>{search}</View>
          <View style={[styles.side, styles.sideEnd]}>
            {findButton}
            <Pressable
              onPress={onAdd}
              role="button"
              accessibilityLabel="Adicionar carta"
              style={(s) => {
                const { pressed, hovered } = s as PressState;
                return [styles.add, hovered && { backgroundColor: colors.surfaceAlt }, pressed && { opacity: 0.8 }];
              }}>
              <Ionicons name="add" size={20} color={colors.primaryText} />
              <Text style={styles.addText}>Carta</Text>
            </Pressable>
            <IconButton icon="settings-outline" label="Personalizar fichário" tone="onBrand" color={ink} onPress={onEdit} />
          </View>
        </View>
      ) : (
        <>
          <View style={[styles.row, { paddingHorizontal: space.sm }]}>
            <IconButton icon="menu" label="Minha coleção" tone="onBrand" color={ink} onPress={onMenu} />
            {titleButton}
            <IconButton
              icon={searchOpen ? 'close' : 'search'}
              label={searchOpen ? 'Fechar a busca' : 'Buscar no fichário'}
              tone="onBrand"
              color={ink}
              onPress={onToggleSearch}
            />
            {findButton}
            <IconButton icon="settings-outline" label="Personalizar fichário" tone="onBrand" color={ink} onPress={onEdit} />
          </View>
          {searchOpen ? <View style={[styles.searchRow, { paddingHorizontal: gutter }]}>{search}</View> : null}
        </>
      )}
      <View style={styles.track} aria-hidden>
        <View style={[styles.fill, { width: pct, backgroundColor: fill }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { zIndex: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 56, alignSelf: 'center', width: '100%' },
  rowDesktop: { minHeight: 64, gap: space.lg, maxWidth: widths.spread },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 },
  sideEnd: { justifyContent: 'flex-end' },
  searchDesktop: { flex: 1.4, maxWidth: 440 },
  searchRow: { paddingBottom: space.md },
  titleBtn: { flex: 1, minWidth: 0, minHeight: TOUCH, justifyContent: 'center', alignItems: 'center', borderRadius: radius.md, paddingHorizontal: space.xs },
  // Largura do próprio nome (até o espaço que sobra): `flex: 0` na web vira base 0% e o nome sumia.
  titleBtnDesktop: { alignItems: 'flex-start', flexGrow: 0, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: space.sm },
  titleHover: { backgroundColor: semantic.hover.onBrand },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: '100%' },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '800', flexShrink: 1 },
  titleDesktop: { fontSize: 19 },
  subtitle: { ...typography.caption, fontSize: 12, lineHeight: 16, fontWeight: '600', ...typography.tabular },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: TOUCH,
    paddingLeft: space.md,
    paddingRight: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  addText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  track: { height: 3, backgroundColor: semantic.brand.track },
  fill: { height: 3 },
});
