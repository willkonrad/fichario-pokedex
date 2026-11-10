import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { digitsInSystemFont } from '@/components/digits';
import { AddCardPill } from '@/components/home-dock';
import { ConsultaPill } from '@/components/home-summary';
import { IconButton, type PressState } from '@/components/icon-button';
import { breakpoints, font, radius, semantic, space, TOUCH, typography, widths } from '@/theme';

/** Abaixo disto, os botões da direita ficam com a largura deles: em terços iguais, cobririam o fim da busca. */
const TIGHT_DESKTOP = 1180;

/**
 * Barra do topo da home, fixa e preta (AR3, H4): menu, nome do fichário (troca de fichário) com o progresso, busca e
 * personalizar, e embaixo o fio vermelho com o traço de progresso. No computador, uma barra só com a busca no meio e o
 * "+ Carta". Com `onFind`, um botão "Buscar na coleção" (E2) ao lado da busca (tablet) ou do "+ Carta" (no celular,
 * não: o nome do fichário ficaria cortado). A altura não muda com a busca aberta: no celular o campo abre por cima da
 * tela, fora da barra (`index.tsx`).
 */
export function HomeTopBar({
  title,
  subtitle,
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
  onConsulta,
  onHeight,
}: {
  title: string;
  /** "48 de 1.025 Pokémon". */
  subtitle: string;
  /** 0 a 1. */
  progress: number;
  desktop: boolean;
  gutter: number;
  /** Computador: largura do fichário (páginas + painel), para a barra alinhar com ele. */
  contentWidth?: number;
  /** O campo de busca, que fica sempre na barra do computador. */
  search: ReactNode;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onMenu: () => void;
  onSwitch: () => void;
  onEdit: () => void;
  onAdd: () => void;
  /** Busca na coleção inteira (E2), em todos os fichários. Sem ele, o botão não aparece. */
  onFind?: () => void;
  /** Consulta de cartas: pílula neutra ao lado do "+ Carta", só no computador. */
  onConsulta?: () => void;
  onHeight: (h: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Ícone diferente da lupa da busca no fichário, que fica ao lado no tablet. No celular não cabe um 4º ícone sem cortar
  // o nome do fichário: lá a busca na coleção fica na "Minha coleção" e na busca ao vivo ("Procurar em toda a coleção").
  const findButton =
    onFind && (desktop || width >= breakpoints.tablet) ? <IconButton icon="library-outline" label="Buscar na coleção" tone="onBrand" onPress={onFind} /> : null;
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
        <Text style={[styles.title, desktop && styles.titleDesktop]} numberOfLines={1}>
          {digitsInSystemFont(title)}
        </Text>
        <Ionicons name="chevron-down" size={18} color={semantic.shell.fg} />
      </View>
      <Text style={styles.subtitle} numberOfLines={1}>
        {subtitle}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]} onLayout={(e: LayoutChangeEvent) => onHeight(e.nativeEvent.layout.height)}>
      {desktop ? (
        <View style={[styles.row, styles.rowDesktop, { paddingHorizontal: gutter }, contentWidth ? { maxWidth: contentWidth + gutter * 2 } : null]}>
          <View style={styles.side}>
            <IconButton icon="menu" label="Minha coleção" tone="onBrand" onPress={onMenu} />
            {titleButton}
          </View>
          <View style={styles.searchDesktop}>{search}</View>
          <View style={width < TIGHT_DESKTOP ? styles.sideContent : [styles.side, styles.sideEnd]}>
            {findButton}
            {onConsulta ? <ConsultaPill onPress={onConsulta} tall /> : null}
            <AddCardPill onPress={onAdd} />
            <IconButton icon="settings-outline" label="Personalizar fichário" tone="onBrand" onPress={onEdit} />
          </View>
        </View>
      ) : (
        <View style={[styles.row, { paddingHorizontal: space.sm }]}>
          <IconButton icon="menu" label="Minha coleção" tone="onBrand" onPress={onMenu} />
          {titleButton}
          <IconButton icon={searchOpen ? 'close' : 'search'} label={searchOpen ? 'Fechar a busca' : 'Buscar no fichário'} tone="onBrand" onPress={onToggleSearch} />
          {findButton}
          <IconButton icon="settings-outline" label="Personalizar fichário" tone="onBrand" onPress={onEdit} />
        </View>
      )}
      <View style={styles.track} aria-hidden>
        <View style={[styles.fill, { width: pct }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { zIndex: 2, backgroundColor: semantic.shell.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 56, alignSelf: 'center', width: '100%' },
  rowDesktop: { minHeight: 64, gap: space.lg, maxWidth: widths.spread },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 },
  sideEnd: { justifyContent: 'flex-end' },
  sideContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.sm, flexShrink: 0 },
  searchDesktop: { flex: 1.4, maxWidth: 440 },
  titleBtn: { flex: 1, minWidth: 0, minHeight: TOUCH, justifyContent: 'center', alignItems: 'center', borderRadius: radius.md, paddingHorizontal: space.xs },
  // Largura do próprio nome (até o espaço que sobra): `flex: 0` na web vira base 0% e o nome sumia.
  titleBtnDesktop: { alignItems: 'flex-start', flexGrow: 0, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: space.sm },
  titleHover: { backgroundColor: semantic.hover.onBrand },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: '100%' },
  // 18 px: o nome padrão ("Fichário Pokédex") cabe inteiro já em 360 px.
  title: { color: semantic.shell.fg, fontFamily: font.display, fontSize: 18, lineHeight: 23, fontWeight: 'normal', flexShrink: 1 },
  titleDesktop: { fontSize: 22, lineHeight: 28 },
  subtitle: { ...typography.caption, color: semantic.shell.fg, fontSize: 12, lineHeight: 16, fontWeight: '600', ...typography.tabular },
  // O fio vermelho da barra do topo, com o progresso em amarelo-claro por cima.
  track: { height: 3, backgroundColor: semantic.shell.rule },
  fill: { height: 3, backgroundColor: semantic.progress.fill },
});
