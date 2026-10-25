import { memo, useEffect, useState, type ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CardImage } from '@/components/card-image';
import { OwnedBadge, useOwnership, type Ownership } from '@/components/owned-badge';
import { Badge, CardSkeleton, gridColumns, TextSkeleton } from '@/components/ui';
import { getSpecies } from '@/data/pokedex';
import { plainName } from '@/lib/catalog';
import { groupCardsBySet, setReleaseYears, sortCards, type CardBrief, type CardOrder } from '@/lib/tcgdex';
import { CARD_RATIO, colors, gutterFor, radius, semantic, shadow, typography, widths } from '@/theme';

const GAP = 10;
/** Largura aproximada de uma célula: 3 colunas no celular, até 7 numa tela larga. */
const CELL = 150;
/** Número sobre a miniatura: texto branco sobre véu escuro, legível em qualquer arte. */
const NUMBER_VEIL = 'rgba(0, 0, 0, 0.6)';
/** `isOwned` antigo (sim/não): vale como "tenho". */
const OWNED: Ownership = { exact: true, label: 'tenho', count: 1 };

/**
 * Largura útil da grade de cartas numa janela de `width` px (W7): até `widths.wide`, já sem as margens laterais
 * (`gutterFor`). O que fica acima da grade (busca, filtros) usa a mesma largura, centralizada, para alinhar com ela:
 * `{ width: gridContentWidth(width), alignSelf: 'center' }`.
 */
export function gridContentWidth(width: number) {
  return Math.max(0, Math.min(width - gutterFor(width) * 2, widths.wide));
}

/** Colunas da grade (`gridColumns`: 3 no celular, mais em telas largas), margem lateral e largura de cada carta. */
function useGridLayout() {
  const { width } = useWindowDimensions();
  const contentWidth = gridContentWidth(width);
  const gutter = gutterFor(width);
  const cols = gridColumns(contentWidth, { cell: CELL, gap: GAP });
  const itemWidth = Math.floor((contentWidth - GAP * (cols - 1)) / cols);
  return { contentWidth, gutter, cols, itemWidth };
}

const cardKey = (c: CardBrief) => `${c.id}|${c.lang}|${c.stamp?.label ?? ''}|${c.imageUrl ?? ''}`;

type Row = { kind: 'header'; key: string; title: string; count: number } | { kind: 'cards'; key: string; cards: CardBrief[] };

/**
 * Grade de cartas para escolher (3 colunas no celular, mais em telas largas), com o selo "tenho" por versão (F3), o
 * número da carta sobre a miniatura e, opcionalmente, ordenada (`order`) e agrupada por coleção com um título para cada
 * uma. No fichário Pokédex (`dex`), a coleção vem primeiro e o nome da carta só aparece quando não é o do Pokémon.
 */
export function CardGrid({
  cards,
  dex,
  onPick,
  order,
  groupBySet = false,
  speciesName,
  isOwned,
  header,
}: {
  cards: CardBrief[];
  /** Pokémon das cartas (arte reserva quando não há imagem). */
  dex?: number;
  onPick: (card: CardBrief) => void;
  /** Ordem da lista (sem ela, a que veio). */
  order?: CardOrder;
  /** Títulos por coleção ("Coleção Clássica de 30 Anos · 4 cartas"). */
  groupBySet?: boolean;
  /** Nome do Pokémon (padrão: o de `dex`): cartas com esse nome mostram só a coleção. */
  speciesName?: string;
  /**
   * "Tenho" desta carta, no lugar da regra padrão (`useOwnership`: a mesma versão, com o selo, conta como "tenho";
   * outra versão da mesma carta, como "outra versão").
   */
  isOwned?: (card: CardBrief) => boolean;
  /** Cabeçalho que rola junto com a grade. */
  header?: ReactElement;
}) {
  const { contentWidth, gutter, cols, itemWidth } = useGridLayout();
  const ownership = useOwnership();
  const species = speciesName ?? (dex ? getSpecies(dex)?.name : undefined);
  const sorted = order ? sortCards(cards, order) : cards;

  // Ano de lançamento de cada coleção, ao lado do nome no título (carregado uma vez e guardado por 7 dias).
  const [years, setYears] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!groupBySet) return;
    let alive = true;
    setReleaseYears()
      .then((y) => {
        if (alive) setYears(y);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [groupBySet]);

  const rows: Row[] = [];
  const addCards = (list: CardBrief[], prefix: string) => {
    for (let i = 0; i < list.length; i += cols) rows.push({ kind: 'cards', key: `${prefix}:${i}`, cards: list.slice(i, i + cols) });
  };
  if (groupBySet) {
    for (const g of groupCardsBySet(sorted)) {
      rows.push({ kind: 'header', key: `h:${g.setId}`, title: g.setName, count: g.cards.length });
      addCards(g.cards, g.setId);
    }
  } else addCards(sorted, 'r');

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.key}
      contentContainerStyle={[styles.list, { width: contentWidth + gutter * 2, paddingHorizontal: gutter }]}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={Math.ceil(18 / cols) + 2}
      windowSize={7}
      ListHeaderComponent={header}
      renderItem={({ item: row }) =>
        row.kind === 'header' ? (
          <View style={styles.header} accessibilityRole="header">
            <Text style={styles.headerTitle} numberOfLines={2}>
              {row.title}
              {years[row.key.slice(2)] ? <Text style={styles.headerCount}> · {years[row.key.slice(2)]}</Text> : null}
            </Text>
            <Text style={styles.headerCount}>
              {row.count} {row.count === 1 ? 'carta' : 'cartas'}
            </Text>
          </View>
        ) : (
          <View style={styles.row}>
            {row.cards.map((c) => {
              const own = isOwned ? (isOwned(c) ? OWNED : null) : ownership(c);
              return (
                <CardCell
                  key={cardKey(c)}
                  item={c}
                  width={itemWidth}
                  dex={dex}
                  species={species}
                  ownLabel={own?.label}
                  ownExact={!!own?.exact}
                  onPick={onPick}
                />
              );
            })}
          </View>
        )
      }
    />
  );
}

/** Uma carta da grade (recebe só o que muda nela, para um preço gravado não redesenhar a grade inteira). */
const CardCell = memo(function CardCell({
  item,
  width,
  dex,
  species,
  ownLabel,
  ownExact,
  onPick,
}: {
  item: CardBrief;
  width: number;
  dex?: number;
  species?: string;
  /** Selo "tenho" ("tenho", "tenho · reverse", "outra versão"); ausente = o usuário não tem a carta. */
  ownLabel?: string;
  /** O usuário tem esta versão (senão, só outra versão da mesma carta). */
  ownExact: boolean;
  onPick: (card: CardBrief) => void;
}) {
  // Carta com o nome do próprio Pokémon: a coleção diz mais que o nome repetido.
  const showName = !species || plainName(item.name) !== plainName(species);
  const onlyEnglish = !!item.dataLang && item.dataLang !== item.lang;
  const owned = ownLabel ? (ownExact ? ', você já tem' : ', você tem outra versão') : '';
  return (
    <Pressable
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
      onPress={() => onPick(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.setName}, número ${item.localId}${item.stamp ? `, com selo ${item.stamp.label}` : ''}${onlyEnglish ? ', só em inglês' : ''}${owned}`}>
      <View style={[styles.thumb, { height: width / CARD_RATIO }]}>
        <CardImage
          image={item.image}
          imageUrl={item.imageUrl}
          cardId={item.lang === 'ja' ? undefined : item.id}
          nameEn={item.lang === 'en' || item.dataLang === 'en' ? item.name : undefined}
          setNameEn={item.setNameEn}
          localId={item.localId}
          dex={dex}
          stampKeys={item.stamp?.keys}
          // Versão com selo do catálogo: a foto já é a dela (sem procurar pelos selos).
          photo={item.stamp ? item.imageUrl : undefined}
          recyclingKey={cardKey(item)}
          skeleton
        />
        {ownLabel ? <OwnedBadge label={ownLabel} partial={!ownExact} /> : null}
        {item.localId ? (
          <View style={[styles.numberTag, !!item.stamp && styles.numberTagShort]}>
            <Text style={styles.numberText} numberOfLines={1}>
              {item.localId}
            </Text>
          </View>
        ) : null}
        {item.stamp ? (
          <View style={styles.stampTag}>
            <Badge label="Selo" tone="special" />
          </View>
        ) : null}
      </View>
      {species ? (
        <>
          <Text style={styles.title} numberOfLines={2}>
            {item.setName}
          </Text>
          {showName ? (
            <Text style={styles.sub} numberOfLines={1}>
              {item.name}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.title} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {item.setName}
          </Text>
        </>
      )}
      {/* Nome do selo: texto de apoio, não tocável (azul só no que se toca). */}
      {item.stamp ? (
        <Text style={styles.stamp} numberOfLines={2}>
          {item.stamp.label}
        </Text>
      ) : null}
      {onlyEnglish ? (
        <View style={styles.tag}>
          <Badge label="só em inglês" />
        </View>
      ) : null}
    </Pressable>
  );
});

/** Grade de espera na proporção da carta, enquanto a lista chega (mesma geometria da CardGrid). */
export function CardGridSkeleton({ count }: { count?: number }) {
  const { contentWidth, gutter, cols, itemWidth } = useGridLayout();
  const n = count ?? cols * 3;
  return (
    <View
      style={[styles.list, { width: contentWidth + gutter * 2, paddingHorizontal: gutter }]}
      accessibilityRole="progressbar"
      accessibilityLabel="Carregando as cartas">
      <View style={styles.skeletonGrid}>
        {Array.from({ length: n }, (_, i) => (
          <View key={i} style={{ width: itemWidth, gap: 3 }}>
            <CardSkeleton width={itemWidth} />
            <TextSkeleton lines={2} lineHeight={11} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 40, gap: 16, alignSelf: 'center' },
  row: { flexDirection: 'row', gap: GAP },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { ...typography.bodyStrong, color: colors.text, flexShrink: 1 },
  headerCount: { ...typography.caption, ...typography.tabular, color: colors.textMuted, marginLeft: 'auto' },
  // Fundo branco: o esqueleto (cinza claro) pulsa por cima enquanto a imagem chega.
  thumb: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface, ...shadow },
  title: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '700', marginTop: 6 },
  sub: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginTop: 1 },
  stamp: { color: colors.textMuted, fontSize: 11, lineHeight: 15, fontWeight: '600', marginTop: 1 },
  numberTag: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    maxWidth: '70%',
    backgroundColor: NUMBER_VEIL,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  // Com o selo "Selo" no canto direito, o número encolhe para não passar por baixo dele.
  numberTagShort: { maxWidth: '55%' },
  numberText: { ...typography.tabular, color: semantic.inverse.fg, fontSize: 11, fontWeight: '700' },
  stampTag: { position: 'absolute', right: 4, bottom: 4 },
  tag: { marginTop: 3 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: 16 },
});
