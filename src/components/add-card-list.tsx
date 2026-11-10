import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CardGrid, CardGridSkeleton, gridContentWidth } from '@/components/card-grid';
import { Button, Chip, ChipGroup, EmptyState, Notice, SearchField } from '@/components/ui';
import { formatInt } from '@/lib/format';
import { CARD_ORDER_LABEL, CARD_SEARCH_MAX, filterCards, seriesOf, type CardBrief, type CardOrder } from '@/lib/tcgdex';
import { colors, space, typography } from '@/theme';

const ORDERS: CardOrder[] = ['newest', 'oldest', 'number'];
/** Com poucas cartas (ex.: busca por código), filtro, ordem e séries só atrapalham. */
const TOOLS_MIN = 9;

/**
 * Situação da lista: buscando (com a lista base, se já chegou, e o que ainda falta: "versões com selo", "mais cartas"),
 * erro ou pronta.
 */
export type PickerState =
  | { status: 'loading'; cards?: CardBrief[]; pending?: string }
  | { status: 'error'; message: string }
  | { status: 'done'; cards: CardBrief[]; partial?: boolean; truncated?: boolean; number?: string; numberMatched?: boolean };

const cardsWord = (n: number) => `${formatInt(n)} ${n === 1 ? 'carta' : 'cartas'}`;

/** "buscando versões com selo" / "buscando mais cartas" com a lista base já na tela; null quando não falta nada. */
export function loadingMoreText(state: PickerState): string | null {
  return state.status === 'loading' && state.cards ? `buscando ${state.pending || 'mais cartas'}` : null;
}

/**
 * Lista de cartas para escolher (U6): filtro (nome, coleção, número ou selo, sem acento), ordem (mais novas, mais
 * antigas, nº), atalhos por série e títulos por coleção; avisos de lista incompleta (C2), de número sem carta e de
 * busca cortada (C5). `top` rola junto com a lista (ex.: o Pokémon e os idiomas).
 */
export function CardPickerList({
  state,
  top,
  onPick,
  onRetry,
  dex,
  speciesName,
  empty,
}: {
  state: PickerState;
  top?: ReactElement;
  onPick: (card: CardBrief) => void;
  /** "Tentar de novo" / "Buscar de novo" (sem a lista guardada). */
  onRetry: () => void;
  dex?: number;
  speciesName?: string;
  /** Sem nenhuma carta: título e texto. */
  empty: { title: string; text?: string };
}) {
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState('');
  const [order, setOrder] = useState<CardOrder>('newest');
  const [series, setSeries] = useState<string | null>(null);

  const all = state.status === 'error' ? [] : (state.cards ?? []);
  const loadingAll = state.status === 'loading' && !state.cards;
  const moreText = loadingMoreText(state);
  const loadingMore = !!moreText;
  const done = state.status === 'done' ? state : null;
  // Séries na ordem em que aparecem (a lista vem da coleção mais nova para a mais antiga).
  // (Cartas japonesas: séries pela época de lançamento, ex.: "Pocket Monsters (1996–2001)".)
  const seriesList = [...new Set(all.map(seriesOf))];
  const activeSeries = series && seriesList.includes(series) ? series : null;
  const visible = filterCards(all, filter).filter((c) => !activeSeries || seriesOf(c) === activeSeries);
  const narrowed = visible.length !== all.length;
  const tools = all.length >= TOOLS_MIN || !!filter || !!activeSeries;

  const status =
    state.status === 'error'
      ? 'Não consegui carregar as cartas'
      : loadingAll
        ? 'Buscando as cartas'
        : narrowed
          ? `${cardsWord(visible.length)} de ${formatInt(all.length)}`
          : all.length
            ? `${cardsWord(all.length)}${moreText ? `, ${moreText}` : ''}`
            : empty.title;

  const notices: ReactNode[] = [];
  if (done?.partial) {
    notices.push(
      <View key="partial" style={styles.noticeRow}>
        <View style={styles.noticeBody}>
          <Notice tone="warning">Algumas fontes não responderam.</Notice>
        </View>
        <Chip label="Buscar de novo" icon="refresh" mode="button" onPress={onRetry} />
      </View>,
    );
  }
  if (done?.number && done.numberMatched === false) {
    notices.push(
      <Notice key="number" tone="info">
        Nenhuma carta com o nº {done.number}; mostrando todas.
      </Notice>,
    );
  }
  if (done?.truncated) {
    notices.push(
      <Notice key="truncated" tone="info">
        As {formatInt(CARD_SEARCH_MAX)} mais recentes: refine a busca para ver as outras.
      </Notice>,
    );
  }

  const toolbar = (
    <View style={styles.toolbar}>
      {top}
      {tools ? (
        <>
          <SearchField value={filter} onChangeText={setFilter} placeholder="Filtrar: coleção, nome, nº ou selo" label="Filtrar cartas" icon="filter" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            <ChipGroup label="Ordem" style={styles.chipGroup}>
              {ORDERS.map((o) => (
                <Chip key={o} label={CARD_ORDER_LABEL[o]} accessibilityLabel={o === 'number' ? 'Por número' : undefined} selected={order === o} onPress={() => setOrder(o)} />
              ))}
            </ChipGroup>
            {seriesList.length > 1 ? (
              <>
                <View style={styles.divider} aria-hidden />
                <ChipGroup label="Série" style={styles.chipGroup}>
                  <Chip label="Todas" selected={!activeSeries} onPress={() => setSeries(null)} />
                  {seriesList.map((s) => (
                    <Chip key={s} label={s} selected={activeSeries === s} onPress={() => setSeries(activeSeries === s ? null : s)} />
                  ))}
                </ChipGroup>
              </>
            ) : null}
          </ScrollView>
        </>
      ) : null}
      {all.length ? (
        <View style={styles.countRow} aria-hidden>
          <Text style={styles.count}>{narrowed ? `${cardsWord(visible.length)} de ${formatInt(all.length)}` : cardsWord(all.length)}</Text>
          {loadingMore ? (
            <View style={styles.more}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={styles.count}>{moreText}…</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {notices}
      {all.length && !visible.length ? (
        <EmptyState
          title="Nenhuma carta com esse filtro"
          text="Tente outra coleção, número ou série."
          action={
            <Button
              title="Limpar filtro"
              variant="secondary"
              onPress={() => {
                setFilter('');
                setSeries(null);
              }}
            />
          }
        />
      ) : null}
    </View>
  );

  const live = <LiveStatus text={status} />;

  // Sem lista: o topo e a espera (ou o erro, ou o vazio) numa rolagem simples.
  if (!all.length) {
    return (
      <View style={styles.screen}>
        {live}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          {/* Mesma largura da grade (W7), para o topo não pular quando a lista chega. */}
          <View style={[styles.standalone, { width: gridContentWidth(width) }]}>{toolbar}</View>
          {loadingAll ? (
            <CardGridSkeleton />
          ) : state.status === 'error' ? (
            <EmptyState
              title="Não consegui carregar as cartas"
              text={`Confira a internet e tente de novo. (${state.message})`}
              action={<Button title="Tentar de novo" variant="secondary" icon="refresh" onPress={onRetry} />}
            />
          ) : (
            <EmptyState title={empty.title} text={empty.text} />
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {live}
      <CardGrid
        cards={visible}
        dex={dex}
        speciesName={speciesName}
        onPick={onPick}
        order={order}
        groupBySet={order !== 'number'}
        header={toolbar}
      />
    </View>
  );
}

/**
 * No iOS, o VoiceOver não lê regiões "ao vivo": anuncia o texto à parte, depois que ele para de mudar (a pessoa parou
 * de digitar). No Android e na web, use junto uma região ao vivo (role status + aria-live).
 */
export function useIosAnnouncement(text: string) {
  useEffect(() => {
    if (Platform.OS !== 'ios' || !text) return;
    const t = setTimeout(() => AccessibilityInfo.announceForAccessibility(text), 800);
    return () => clearTimeout(t);
  }, [text]);
}

/**
 * Situação da lista para o leitor de tela (A7): região "ao vivo" sempre montada (só o que muda dentro dela é lido); no
 * iOS, anunciada à parte, depois que a pessoa para de digitar.
 */
function LiveStatus({ text }: { text: string }) {
  useIosAnnouncement(text);
  return (
    <Text style={styles.srOnly} role="status" aria-live="polite" accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { paddingBottom: space.xxl },
  standalone: { alignSelf: 'center' },
  toolbar: { gap: space.md, paddingTop: space.lg, paddingBottom: space.xs },
  chips: { alignItems: 'center', gap: space.sm, paddingRight: space.lg },
  chipGroup: { flexWrap: 'nowrap' },
  divider: { width: 1, height: 28, backgroundColor: colors.border },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  count: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  more: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  noticeBody: { flex: 1 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
});
