import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BinderSlot } from '@/components/binder-slot';
import { formatDex, searchSpecies } from '@/data/pokedex';
import {
  customSlotsOnPage,
  customTotalSlots,
  dexRange,
  inDexRange,
  pageOfDex,
  pageSize,
  slotAt,
  slotsOnPage,
  totalPages,
} from '@/lib/binder';
import { collectionTotals, formatBRLTight } from '@/lib/quotes';
import { POKEDEX_BINDER, type BinderSettings, type CustomBinder, type Entry } from '@/lib/types';
import { customEntryId, entriesOf, entryId, useCollection } from '@/store/collection';
import { colors, mono, radius } from '@/theme';

const GAP = 8;
const MAX_WIDTH = 720;
// Valor da coleção (MYP Cards) e quantas cartas têm preço.
const TOTAL_COLORS = { value: '#E8C25A', priced: '#5FD69C' };

export default function BinderScreen() {
  const { ready, settings, activeBinderId, binders } = useCollection();

  if (!ready) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!settings) return <Redirect href="/setup" />;

  const custom = binders.find((b) => b.id === activeBinderId);
  // `key`: cada fichário começa na própria página 1.
  return custom ? <CustomBinderView key={custom.id} binder={custom} /> : <PokedexBinderView key={POKEDEX_BINDER} settings={settings} />;
}

// ---------- Fichário Pokédex ----------

function PokedexBinderView({ settings }: { settings: BinderSettings }) {
  const { entries } = useCollection();
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const range = dexRange(settings);

  const list = useMemo(() => entriesOf(entries, POKEDEX_BINDER), [entries]);
  const species = useMemo(() => new Set(list.filter((e) => inDexRange(settings, e.dex)).map((e) => e.dex)).size, [list, settings]);

  const pages = totalPages(settings);
  const current = Math.min(page, pages - 1);
  const slots = slotsOnPage(settings, current);
  const first = slots[0]?.dex;
  const last = slots[slots.length - 1]?.dex;

  /** Primeira página, depois da atual, com espaço vazio (volta ao começo se precisar). */
  function nextEmpty() {
    const size = pageSize(settings);
    const total = range.count * settings.slotsPerPokemon;
    for (let step = 1; step <= total; step++) {
      const i = ((current + 1) * size + step - 1) % total;
      const ref = slotAt(settings, i);
      if (ref && !entries[entryId(ref.dex, ref.slot)]) {
        setPage(Math.floor(i / size));
        setHighlight(ref.dex);
        return;
      }
    }
    setNotice('Fichário completo! Todos os espaços têm carta.');
  }

  function runSearch() {
    const found = searchSpecies(query);
    if (!found) return setNotice('Nenhum Pokémon com esse nome ou número.');
    if (!inDexRange(settings, found.id)) return setNotice(`${found.name} não está na faixa deste fichário (${formatDex(range.from)}–${formatDex(range.to)}).`);
    setNotice(null);
    setPage(pageOfDex(settings, found.id));
    setHighlight(found.id);
  }

  return (
    <BinderFrame
      title={settings.name || 'Fichário Pokédex'}
      color={settings.color}
      entries={list}
      counter={{ value: species, total: range.count }}
      progress={species / range.count}
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setNotice(null);
        if (!q) setHighlight(null);
      }}
      onSearch={runSearch}
      placeholder="Buscar nome ou #número"
      notice={notice}
      page={current}
      pages={pages}
      onPage={(p) => {
        setPage(p);
        setHighlight(null);
      }}
      pageRange={first && last ? `${formatDex(first)}–${formatDex(last)}` : ''}
      onNextEmpty={nextEmpty}
      cols={settings.cols}
      items={slots.map((s) => {
        const entry = entries[entryId(s.dex, s.slot)];
        return {
          key: String(s.index),
          render: (width: number) => (
            <BinderSlot
              dex={s.dex}
              width={width}
              entry={entry}
              highlighted={highlight === s.dex}
              onPress={() =>
                entry
                  ? router.push({ pathname: '/card', params: { dex: s.dex, slot: s.slot } })
                  : router.push({ pathname: '/pokemon/[dex]', params: { dex: s.dex, slot: s.slot } })
              }
            />
          ),
        };
      })}
    />
  );
}

// ---------- Fichário livre ----------

function CustomBinderView({ binder }: { binder: CustomBinder }) {
  const { entries } = useCollection();
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const list = useMemo(() => entriesOf(entries, binder.id), [entries, binder.id]);
  const total = customTotalSlots(binder);
  const filled = list.filter((e) => e.slot < total).length;
  const current = Math.min(page, binder.pages - 1);
  const slots = customSlotsOnPage(binder, current);
  const size = pageSize(binder);

  function nextEmpty() {
    for (let step = 1; step <= total; step++) {
      const i = ((current + 1) * size + step - 1) % total;
      if (!entries[customEntryId(binder.id, i)]) {
        setPage(Math.floor(i / size));
        setHighlight(new Set([i]));
        return;
      }
    }
    setNotice('Fichário cheio! Aumente as páginas em ⋯ para ganhar bolsos.');
  }

  function runSearch() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hits = list.filter(
      (e) => e.cardName.toLowerCase().includes(q) || e.setName.toLowerCase().includes(q) || String(e.slot + 1) === q,
    );
    if (!hits.length) return setNotice('Nenhuma carta deste fichário com esse nome, coleção ou bolso.');
    setNotice(hits.length > 1 ? `${hits.length} cartas encontradas (destacadas).` : null);
    const firstHit = Math.min(...hits.map((e) => e.slot));
    setPage(Math.floor(firstHit / size));
    setHighlight(new Set(hits.map((e) => e.slot)));
  }

  return (
    <BinderFrame
      title={binder.name}
      color={binder.color}
      entries={list}
      counter={{ value: filled, total }}
      progress={filled / Math.max(1, total)}
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setNotice(null);
        if (!q) setHighlight(new Set());
      }}
      onSearch={runSearch}
      placeholder="Buscar carta, coleção ou nº do bolso"
      notice={notice}
      page={current}
      pages={binder.pages}
      onPage={(p) => {
        setPage(p);
        setHighlight(new Set());
      }}
      pageRange={`bolsos ${slots[0] + 1}–${slots[slots.length - 1] + 1}`}
      onNextEmpty={nextEmpty}
      cols={binder.cols}
      showPrices={binder.showPrices}
      emptyHint={
        filled === 0 ? 'Toque num bolso para escolher uma carta. Em ⋯ você muda capa, tamanho e páginas.' : undefined
      }
      onEdit={() => router.push({ pathname: '/binder-edit', params: { id: binder.id } })}
      items={slots.map((slot) => {
        const entry = entries[customEntryId(binder.id, slot)];
        return {
          key: String(slot),
          render: (width: number) => (
            <BinderSlot
              pocket={binder.showPocketNumbers ? slot + 1 : undefined}
              width={width}
              entry={entry}
              showPrices={binder.showPrices}
              highlighted={highlight.has(slot)}
              onPress={() =>
                entry
                  ? router.push({ pathname: '/card', params: { binder: binder.id, slot } })
                  : router.push({ pathname: '/search', params: { binder: binder.id, slot } })
              }
            />
          ),
        };
      })}
    />
  );
}

// ---------- Moldura comum ----------

function BinderFrame(props: {
  title: string;
  color?: string;
  entries: Entry[];
  counter: { value: number; total: number };
  progress: number;
  query: string;
  onQuery: (q: string) => void;
  onSearch: () => void;
  placeholder: string;
  notice: string | null;
  page: number;
  pages: number;
  onPage: (p: number) => void;
  pageRange: string;
  onNextEmpty: () => void;
  cols: number;
  showPrices?: boolean;
  emptyHint?: string;
  onEdit?: () => void;
  items: { key: string; render: (width: number) => ReactNode }[];
}) {
  const { width } = useWindowDimensions();
  const totals = useMemo(() => collectionTotals(props.entries), [props.entries]);
  const contentWidth = Math.min(width, MAX_WIDTH) - 32;
  // Arredonda para baixo: sobra < 1px por linha, nunca falta.
  const slotWidth = Math.floor((contentWidth - GAP * (props.cols - 1)) / props.cols);
  const rows = Array.from({ length: Math.ceil(props.items.length / props.cols) }, (_, r) =>
    props.items.slice(r * props.cols, (r + 1) * props.cols),
  );
  const { page, pages, onPage } = props;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.content, { width: contentWidth + 32 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable style={styles.iconBtn} onPress={() => router.push('/menu')} accessibilityLabel="Menu">
            <Ionicons name="menu" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Pressable
              style={styles.titleBtn}
              onPress={() => router.push('/binders')}
              accessibilityLabel="Trocar de fichário"
              hitSlop={6}>
              <View style={[styles.cover, { backgroundColor: props.color ?? colors.accent }]} />
              <Text style={styles.title} numberOfLines={1}>
                {props.title}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </Pressable>
            {props.showPrices !== false && totals.valued ? (
              <View style={styles.totals}>
                <Text style={[styles.total, styles.totalAvg, { borderLeftColor: TOTAL_COLORS.value }]} numberOfLines={1}>
                  <Text style={styles.totalLabel}>valor </Text>
                  {formatBRLTight(totals.value)}
                </Text>
                <Text style={[styles.total, { borderLeftColor: TOTAL_COLORS.priced }]} numberOfLines={1}>
                  {totals.valued}
                  <Text style={styles.totalLabel}>/{props.entries.length} com preço</Text>
                </Text>
              </View>
            ) : (
              <Text style={styles.subtitle} numberOfLines={1}>
                {props.entries.length
                  ? props.showPrices === false
                    ? `${props.entries.length} cartas`
                    : props.entries.every((e) => e.myp?.checkedAt)
                      ? 'MYP Cards ainda sem preço para estas cartas'
                      : 'Buscando preços no MYP Cards…'
                  : 'Comece colocando sua primeira carta'}
              </Text>
            )}
          </View>
          {props.onEdit ? (
            <Pressable style={styles.iconBtn} onPress={props.onEdit} accessibilityLabel="Personalizar fichário">
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
        {/* Progresso: barra + contador na mesma linha (libera o cabeçalho para o nome em telas estreitas). */}
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(1, Math.min(100, props.progress * 100))}%`, backgroundColor: props.color ?? colors.accent },
              ]}
            />
          </View>
          <Text style={styles.counterText}>
            {props.counter.value}
            <Text style={styles.counterTotal}>/{props.counter.total}</Text>
          </Text>
        </View>

        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={props.query}
            onChangeText={props.onQuery}
            onSubmitEditing={props.onSearch}
            placeholder={props.placeholder}
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {props.query ? (
            <Pressable onPress={() => props.onQuery('')} hitSlop={10} accessibilityLabel="Limpar busca">
              <Ionicons name="close-circle" size={18} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
        {props.notice ? <Text style={styles.notice}>{props.notice}</Text> : null}
        {props.emptyHint ? <Text style={styles.notice}>{props.emptyHint}</Text> : null}

        <View style={styles.pager}>
          <Pressable
            style={[styles.iconBtn, page === 0 && styles.iconBtnDisabled]}
            onPress={() => onPage(Math.max(0, page - 1))}
            disabled={page === 0}
            accessibilityLabel="Página anterior">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.pageTitle}>
              PÁGINA {page + 1} / {pages}
            </Text>
            <Text style={styles.pageRange}>{props.pageRange}</Text>
            <Pressable onPress={props.onNextEmpty} hitSlop={8} accessibilityLabel="Ir para o próximo espaço vazio">
              <Text style={styles.nextEmpty}>Próximo vazio →</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.iconBtn, page === pages - 1 && styles.iconBtnDisabled]}
            onPress={() => onPage(Math.min(pages - 1, page + 1))}
            disabled={page === pages - 1}
            accessibilityLabel="Próxima página">
            <Ionicons name="chevron-forward" size={22} color={colors.text} />
          </Pressable>
        </View>

        {/* Linha por linha (sem flexWrap): evita que arredondamento de largura empurre um card para a linha de baixo. */}
        <View style={{ gap: GAP }}>
          {rows.map((row, r) => (
            <View key={r} style={[styles.row, { gap: GAP }]}>
              {row.map((item) => (
                <View key={item.key}>{item.render(slotWidth)}</View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center' },
  content: { padding: 16, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnDisabled: { opacity: 0.35 },
  titleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%' },
  cover: { width: 6, height: 22, borderRadius: 3 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', flexShrink: 1 },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  totals: { flexDirection: 'row', gap: 8, marginTop: 3 },
  total: { color: colors.textMuted, fontSize: 12, borderLeftWidth: 2, paddingLeft: 5, flexShrink: 1 },
  totalAvg: { color: colors.text, fontWeight: '700' },
  totalLabel: { color: colors.textFaint, fontSize: 10, fontWeight: '600' },
  counterText: { color: colors.text, fontFamily: mono, fontSize: 13, fontWeight: '800' },
  counterTotal: { fontSize: 12, fontWeight: '600', opacity: 0.7 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  progressTrack: { flex: 1, height: 6, backgroundColor: colors.surfaceAlt, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 13, marginLeft: 10 },
  notice: { color: colors.textMuted, fontSize: 13, marginTop: -4, marginBottom: 12, lineHeight: 18 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  pageTitle: { color: colors.text, fontFamily: mono, fontSize: 16, fontWeight: '700', letterSpacing: 2 },
  pageRange: { color: colors.textMuted, fontFamily: mono, fontSize: 12, marginTop: 4 },
  nextEmpty: { color: colors.accent, fontSize: 12, fontWeight: '700', marginTop: 6 },
  row: { flexDirection: 'row' },
});
