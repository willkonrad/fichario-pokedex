import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Fragment, useState } from 'react';
import { FlatList, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useIosAnnouncement } from '@/components/add-card-list';
import { EntryRow } from '@/components/add-entry-row';
import { digitsInSystemFont } from '@/components/digits';
import type { PressState } from '@/components/icon-button';
import { heading } from '@/components/layer-a11y';
import { BOTTOM_BAR_SPACE, BottomBar, Button, EmptyState, ExternalLink, gridColumns, Loading, Segmented, showToast, Toggle, useLayout, withMarkIcons } from '@/components/ui';
import { formatDex, spriteUrl, type Species } from '@/data/pokedex';
import { sourceCredits } from '@/lib/copy';
import { formatInt } from '@/lib/format';
import {
  approxLegend,
  entryParams,
  entryPlace,
  haveShareText,
  listPrice,
  listPriceSpeech,
  listPriceText,
  missingByRegion,
  needShareText,
  placeText,
  repeatedCards,
  tradeCards,
  type CopyGroup,
} from '@/lib/lists';
import { collectionTotals } from '@/lib/quotes';
import type { BinderSettings, Entry } from '@/lib/types';
import { useBinders, useCollectionReady, useEntries, useSettings } from '@/store/collection';
import { colors, MAX_WIDTH, radius, semantic, space, typography } from '@/theme';

type Tab = 'need' | 'have';
const TABS: { id: Tab; label: string }[] = [
  { id: 'need', label: 'Preciso' },
  { id: 'have', label: 'Tenho repetida' },
];
const GAP = space.sm;
const WEB = Platform.OS === 'web';

type NeedRow = { kind: 'region'; key: string; name: string; count: number } | { kind: 'cells'; key: string; species: Species[] };
type HaveRow =
  | { kind: 'header'; key: string; title: string; count: number }
  | { kind: 'copies'; key: string; group: CopyGroup }
  | { kind: 'trade'; key: string; entry: Entry };

/**
 * Listas para trocar (E1): "Preciso" (Pokémon sem carta no fichário Pokédex, por região; tocar escolhe a carta) e
 * "Tenho repetida" (cartas iguais em dois bolsos e as dos fichários de trocas, com onde estão). Prontas para mandar
 * no WhatsApp; sem preço, a menos que a pessoa peça (aí com a atribuição das fontes).
 */
export default function ListsScreen() {
  const ready = useCollectionReady();
  if (!ready) return <Loading />;
  return <Lists />;
}

function Lists() {
  const settings = useSettings();
  if (!settings) {
    return (
      <EmptyState
        title="Configure o fichário primeiro"
        text="As listas saem do fichário Pokédex e dos fichários livres."
        action={<Button title="Configurar" onPress={() => router.replace('/setup')} />}
      />
    );
  }
  return <ListsBody settings={settings} />;
}

function ListsBody({ settings }: { settings: BinderSettings }) {
  const params = useLocalSearchParams<{ tab?: string }>();
  const entries = useEntries();
  const binders = useBinders();
  const insets = useSafeAreaInsets();
  const { width, gutter } = useLayout();
  const [tab, setTab] = useState<Tab>(params.tab === 'have' ? 'have' : 'need');
  const [prices, setPrices] = useState(false);

  const all = Object.values(entries);
  const binderName = settings.name || 'Fichário Pokédex';
  const need = missingByRegion(settings, all);
  const groups = repeatedCards(all, binders);
  const grouped = new Set(groups.flatMap((g) => g.copies.map((e) => e.id)));
  const trades = tradeCards(all, binders, grouped);
  const tradeCount = trades.reduce((n, t) => n + t.entries.length, 0);
  const listed = [...groups.map((g) => g.spare), ...trades.flatMap((t) => t.entries)];
  const movable = need.groups.reduce((n, g) => n + g.species.filter((s) => need.elsewhere.has(s.id)).length, 0);

  const contentWidth = Math.min(width, MAX_WIDTH) - gutter * 2;
  const cols = gridColumns(contentWidth, { cell: 150, gap: GAP, min: 2, max: 6 });
  const cellWidth = Math.floor((contentWidth - GAP * (cols - 1)) / cols);

  const needRows: NeedRow[] = need.groups.flatMap((g) => {
    const rows: NeedRow[] = [{ kind: 'region', key: `r:${g.region}`, name: g.region, count: g.species.length }];
    for (let i = 0; i < g.species.length; i += cols) rows.push({ kind: 'cells', key: `c:${g.region}:${i}`, species: g.species.slice(i, i + cols) });
    return rows;
  });
  const haveRows: HaveRow[] = [
    ...(groups.length ? [{ kind: 'header' as const, key: 'h:copies', title: 'Repetidas', count: groups.length }] : []),
    ...groups.map((group) => ({ kind: 'copies' as const, key: group.key, group })),
    ...trades.flatMap((t) => [
      { kind: 'header' as const, key: `h:${t.binder.id}`, title: `Para troca · ${t.binder.name || 'Trocas'}`, count: t.entries.length },
      ...t.entries.map((entry) => ({ kind: 'trade' as const, key: entry.id, entry })),
    ]),
  ];

  const text = tab === 'need' ? needShareText(binderName, need.groups, need.total) : haveShareText(groups, trades, prices);
  const hasItems = tab === 'need' ? need.total > 0 : haveRows.length > 0;
  const title = tab === 'need' ? 'Preciso' : 'Tenho repetida';
  const summary =
    tab === 'need'
      ? `${formatInt(need.total)} Pokémon sem carta no ${binderName}${movable ? ` · ${formatInt(movable)} em outros fichários` : ''}`
      : `${formatInt(groups.length)} ${groups.length === 1 ? 'repetida' : 'repetidas'} · ${formatInt(tradeCount)} para troca`;
  // O resumo é uma região ao vivo (Android e web); no iOS, anunciado à parte ao trocar de lista (A7).
  useIosAnnouncement(summary);
  const credits = prices ? sourceCredits(collectionTotals(listed).byBasis).filter((c) => c.count > 0) : [];
  // O "≈" explicado junto dos créditos, como no texto para mandar.
  const legend = prices ? approxLegend(listed) : '';

  // Valor com a marca de confiança ("≈" aproximado, "✎" Meu valor), como na home e na tela da carta.
  const priceOf = (e: Entry) => {
    if (!prices) return undefined;
    const p = listPrice(e);
    return <Text style={styles.money}>{p ? withMarkIcons(listPriceText(p), { size: typography.caption.fontSize, color: semantic.money.fg }) : '—'}</Text>;
  };
  const priceLabel = (e: Entry) => (prices ? listPriceSpeech(listPrice(e)) : undefined);
  const open = (e: Entry) => router.push({ pathname: '/card', params: entryParams(e) });
  const where = (e: Entry) => placeText(entryPlace(e, settings, binders));
  const listStyle = [styles.list, { paddingHorizontal: gutter, paddingBottom: BOTTOM_BAR_SPACE + insets.bottom + space.lg }];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Listas' }} />
      <View style={[styles.top, { paddingHorizontal: gutter }]}>
        <Segmented label="Lista" options={TABS} value={tab} onChange={setTab} />
        <Text style={styles.summary} role="status" aria-live="polite" accessibilityLiveRegion="polite">
          {summary}
        </Text>
        {tab === 'have' && haveRows.length ? (
          <>
            <Toggle label="Mostrar preços" value={prices} onChange={setPrices} />
            {prices ? (
              credits.length ? (
                <Text style={styles.credits}>
                  Preços:{' '}
                  {credits.map((c, i) => (
                    <Fragment key={c.id}>
                      {i ? ' · ' : ''}
                      {c.url ? (
                        <ExternalLink href={c.url} variant="inline" arrow>
                          {c.label}
                        </ExternalLink>
                      ) : (
                        c.label
                      )}
                    </Fragment>
                  ))}
                </Text>
              ) : (
                <Text style={styles.credits}>Nenhuma carta desta lista tem preço ainda.</Text>
              )
            ) : null}
            {legend ? <Text style={styles.credits}>{legend}</Text> : null}
          </>
        ) : null}
      </View>

      {tab === 'need' ? (
        need.total ? (
          <FlatList
            data={needRows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={listStyle}
            initialNumToRender={16}
            renderItem={({ item }) =>
              item.kind === 'region' ? (
                <ListHeader title={item.name} count={item.count} />
              ) : (
                <View style={styles.cells}>
                  {item.species.map((s) => (
                    <NeedCell
                      key={s.id}
                      species={s}
                      width={cellWidth}
                      note={need.elsewhere.has(s.id) ? 'em outro fichário' : need.offPage.has(s.id) ? 'fora das páginas' : undefined}
                    />
                  ))}
                </View>
              )
            }
          />
        ) : (
          <EmptyState title="Fichário completo!" text="Todos os Pokémon da faixa têm carta." />
        )
      ) : haveRows.length ? (
        <FlatList
          data={haveRows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={listStyle}
          initialNumToRender={14}
          renderItem={({ item }) =>
            item.kind === 'header' ? (
              <ListHeader title={item.title} count={item.count} />
            ) : item.kind === 'copies' ? (
              // A linha tem 4 de recuo próprio: puxada para fora, a miniatura alinha com o título do grupo.
              <View style={styles.rowPull}>
                <EntryRow
                  entry={item.group.spare}
                  note={`${formatInt(item.group.copies.length)} cópias`}
                  place={item.group.copies.map(where).join('; ')}
                  right={priceOf(item.group.spare)}
                  rightLabel={priceLabel(item.group.spare)}
                  onPress={() => open(item.group.spare)}
                />
              </View>
            ) : (
              <View style={styles.rowPull}>
                <EntryRow
                  entry={item.entry}
                  place={where(item.entry)}
                  right={priceOf(item.entry)}
                  rightLabel={priceLabel(item.entry)}
                  onPress={() => open(item.entry)}
                />
              </View>
            )
          }
        />
      ) : (
        <EmptyState title="Nenhuma carta repetida" text="Cartas iguais em dois bolsos e as dos fichários de trocas aparecem aqui." />
      )}

      {hasItems ? (
        <BottomBar bottomInset={insets.bottom}>
          <ShareButtons text={text} title={title} />
        </BottomBar>
      ) : null}
    </View>
  );
}

/** Título de um grupo da lista e a contagem ao lado: em texto separado, porque número não vai na fonte dos títulos. */
function ListHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle} {...heading(2)}>
        {/* O nome do fichário pode ter número ("Para troca · Coleção 151"). */}
        {digitsInSystemFont(title)}
      </Text>
      <Text style={styles.headerCount}>· {formatInt(count)}</Text>
    </View>
  );
}

/**
 * Um Pokémon que falta: tocar abre a escolha da carta para o espaço dele. `note` = onde já há carta dele ("em outro
 * fichário" ou, no Pokédex, "fora das páginas").
 */
function NeedCell({ species, width, note }: { species: Species; width: number; note?: string }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/pokemon/[dex]', params: { dex: species.id, slot: 0 } })}
      role="button"
      accessibilityLabel={`${formatDex(species.id)} ${species.name}${note ? `, tem carta ${note}` : ''}, escolher carta`}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [styles.cell, { width }, hovered && styles.cellHover, pressed && { opacity: 0.7 }];
      }}>
      <Image source={spriteUrl(species.id)} style={styles.sprite} contentFit="contain" cachePolicy="memory-disk" />
      <View style={styles.cellText}>
        <Text style={styles.cellDex}>{formatDex(species.id)}</Text>
        <Text style={styles.cellName} numberOfLines={1}>
          {species.name}
        </Text>
        {note ? (
          <Text style={styles.cellNote} numberOfLines={1}>
            {note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Mandar a lista: no celular, a folha de compartilhar do sistema (que também copia); na web, copiar (e compartilhar,
 * quando o navegador tem).
 */
function ShareButtons({ text, title }: { text: string; title: string }) {
  const webShare = WEB && typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ message: 'Lista copiada' });
    } catch {
      showToast({ message: 'Não consegui copiar a lista.', tone: 'error' });
    }
  }

  async function share() {
    try {
      if (WEB) await navigator.share({ title, text });
      else await Share.share({ message: text, title });
    } catch (e) {
      // Fechou a folha sem escolher: nada a avisar.
      if ((e as { name?: string } | null)?.name === 'AbortError') return;
      if (WEB) await copy();
      else showToast({ message: 'Não consegui abrir o compartilhar.', tone: 'error' });
    }
  }

  if (!WEB) return <Button title="Compartilhar lista" icon="share-outline" onPress={share} />;
  return (
    <View style={styles.shareRow}>
      <Button title="Copiar lista" icon="copy-outline" onPress={copy} style={styles.shareButton} />
      {webShare ? <Button title="Compartilhar" variant="secondary" icon="share-outline" onPress={share} style={styles.shareButton} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // A margem lateral (topo e lista) vem do useLayout().gutter.
  top: { paddingTop: space.lg, paddingBottom: space.sm, gap: space.md, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  summary: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  credits: { ...typography.caption, color: colors.textMuted },
  list: { gap: GAP, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  rowPull: { marginHorizontal: -space.xs },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs, marginTop: space.md },
  headerTitle: { ...typography.heading, color: colors.heading, flexShrink: 1 },
  headerCount: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  cells: { flexDirection: 'row', gap: GAP },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cellHover: { borderColor: colors.borderStrong },
  sprite: { width: 40, height: 40 },
  cellText: { flex: 1, minWidth: 0 },
  cellDex: { ...typography.caption, ...typography.tabular, fontSize: 12, lineHeight: 16, color: colors.textMuted },
  cellName: { ...typography.bodyStrong, fontSize: 14, lineHeight: 19, color: colors.text },
  cellNote: { ...typography.caption, fontSize: 11, lineHeight: 15, color: colors.textMuted },
  money: { ...typography.numeric, color: semantic.money.fg },
  shareRow: { flexDirection: 'row', gap: space.sm },
  shareButton: { flex: 1 },
});
