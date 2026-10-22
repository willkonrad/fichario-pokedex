import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState, type ReactNode } from 'react';
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BinderSlot } from '@/components/binder-slot';
import { Loading, onCover, SearchField } from '@/components/ui';
import { formatDex, searchSpecies } from '@/data/pokedex';
import {
  customSlotsOnPage,
  customTotalSlots,
  dexRange,
  extraOnPage,
  inDexRange,
  pageOfDex,
  pageSize,
  slotAt,
  slotsOnPage,
  totalPages,
} from '@/lib/binder';
import { collectionTotals, formatBRL, formatBRLTight } from '@/lib/quotes';
import { isSpread, pricePending } from '@/lib/valuation';
import { POKEDEX_BINDER, type BinderSettings, type CustomBinder, type Entry } from '@/lib/types';
import { customEntryId, entriesOf, entryId, useCollection } from '@/store/collection';
import { binderColors as B, CARD_RATIO, colors, MAX_WIDTH, mono, radius, shadow } from '@/theme';

const GAP = 8;
/** Largura de tela a partir da qual o fichário frente e verso abre duas páginas. */
const SPREAD_MIN_WIDTH = 960;
const SPREAD_MAX_WIDTH = 1440;
const SPREAD_GAP = 14;
/** Altura do topo, busca e paginação (para a página caber na tela no tablet/computador). */
const CHROME_HEIGHT = 300;
/** Espaço do preço embaixo de cada bolso. */
const PRICE_SPACE = 22;
const MIN_SLOT = 70;
/** Espaço interno da página escura do fichário. */
const PAGE_PAD = 10;

export default function BinderScreen() {
  const { ready, settings, activeBinderId, binders } = useCollection();

  if (!ready) return <Loading />;
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
  // Último espaço vazio destacado pelo botão "Vazio" (índice corrido), para o próximo toque seguir dele.
  const [emptyCursor, setEmptyCursor] = useState<number | null>(null);
  const range = dexRange(settings);

  const list = useMemo(() => entriesOf(entries, POKEDEX_BINDER), [entries]);
  const species = useMemo(() => new Set(list.filter((e) => inDexRange(settings, e.dex)).map((e) => e.dex)).size, [list, settings]);

  const pages = totalPages(settings);
  const current = Math.min(page, pages - 1);

  /** Primeira página, depois da atual, com espaço vazio (volta ao começo se precisar). */
  /** Destaca o próximo espaço vazio: começa na página atual e, a cada toque, vai para o seguinte. */
  function nextEmpty() {
    const size = pageSize(settings);
    const total = range.count * settings.slotsPerPokemon;
    const start = emptyCursor != null && Math.floor(emptyCursor / size) === current ? emptyCursor + 1 : current * size;
    for (let step = 0; step < total; step++) {
      const i = (start + step) % total;
      const ref = slotAt(settings, i);
      if (ref && !entries[entryId(ref.dex, ref.slot)]) {
        setPage(Math.floor(i / size));
        setHighlight(ref.dex);
        setEmptyCursor(i);
        setNotice(null);
        return;
      }
    }
    setNotice('Fichário completo! Todos os espaços têm carta.');
  }

  function runSearch() {
    const found = searchSpecies(query);
    if (!found) return setNotice('Nenhum Pokémon com esse nome ou número.');
    if (!inDexRange(settings, found.id)) {
      return setNotice(`${found.name} não está na faixa deste fichário (${formatDex(range.from)}–${formatDex(range.to)}).`);
    }
    setNotice(null);
    setPage(pageOfDex(settings, found.id));
    setHighlight(found.id);
  }

  return (
    <BinderFrame
      title={settings.name || 'Fichário Pokédex'}
      entries={list}
      counter={{ value: species, total: range.count, unit: 'Pokémon' }}
      query={query}
      onQuery={(q) => {
        setQuery(q);
        setNotice(null);
        if (!q) setHighlight(null);
      }}
      onSearch={runSearch}
      placeholder="Buscar Pokémon por nome ou #número"
      notice={notice}
      page={current}
      pages={pages}
      onPage={(p) => {
        setPage(p);
        setHighlight(null);
      }}
      rangeFor={(p) => {
        const slots = slotsOnPage(settings, p);
        const first = slots[0]?.dex;
        const last = slots[slots.length - 1]?.dex;
        return first && last ? `${formatDex(first)} – ${formatDex(last)}` : '';
      }}
      onNextEmpty={nextEmpty}
      cols={settings.cols}
      doubleSided={settings.doubleSided}
      coverColor={settings.color ?? colors.primary}
      onEdit={() => router.push('/setup')}
      itemsFor={(p) => [
        ...slotsOnPage(settings, p).map((s) => {
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
        }),
        // Bolsos que sobram na última página: livres para cartas especiais (qualquer carta).
        ...extraOnPage(settings, p).map((k) => {
          const entry = entries[entryId(0, k)];
          return {
            key: `extra-${k}`,
            render: (width: number) => (
              <BinderSlot
                free
                width={width}
                entry={entry}
                onPress={() =>
                  entry
                    ? router.push({ pathname: '/card', params: { dex: 0, slot: k } })
                    : router.push({ pathname: '/search', params: { extra: k } })
                }
              />
            ),
          };
        }),
      ]}
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
  // Último espaço vazio destacado pelo botão "Vazio" (índice corrido), para o próximo toque seguir dele.
  const [emptyCursor, setEmptyCursor] = useState<number | null>(null);

  const list = useMemo(() => entriesOf(entries, binder.id), [entries, binder.id]);
  const total = customTotalSlots(binder);
  const filled = list.filter((e) => e.slot < total).length;
  const current = Math.min(page, binder.pages - 1);
  const size = pageSize(binder);

  /** Destaca o próximo bolso vazio: começa na página atual e, a cada toque, vai para o seguinte. */
  function nextEmpty() {
    const start = emptyCursor != null && Math.floor(emptyCursor / size) === current ? emptyCursor + 1 : current * size;
    for (let step = 0; step < total; step++) {
      const i = (start + step) % total;
      if (!entries[customEntryId(binder.id, i)]) {
        setPage(Math.floor(i / size));
        setHighlight(new Set([i]));
        setEmptyCursor(i);
        setNotice(null);
        return;
      }
    }
    setNotice('Fichário cheio! Aumente as páginas em ⚙ para ganhar bolsos.');
  }

  function runSearch() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const hits = list.filter(
      (e) => e.cardName.toLowerCase().includes(q) || e.setName.toLowerCase().includes(q) || String(e.slot + 1) === q,
    );
    if (!hits.length) return setNotice('Nenhuma carta deste fichário com esse nome, coleção ou bolso.');
    setNotice(hits.length > 1 ? `${hits.length} cartas encontradas (destacadas em azul).` : null);
    const firstHit = Math.min(...hits.map((e) => e.slot));
    setPage(Math.floor(firstHit / size));
    setHighlight(new Set(hits.map((e) => e.slot)));
  }

  return (
    <BinderFrame
      title={binder.name}
      entries={list}
      counter={{ value: filled, total, unit: 'bolsos' }}
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
      rangeFor={(p) => {
        const slots = customSlotsOnPage(binder, p);
        return `bolsos ${slots[0] + 1} – ${slots[slots.length - 1] + 1}`;
      }}
      onNextEmpty={nextEmpty}
      cols={binder.cols}
      doubleSided={binder.doubleSided}
      coverColor={binder.color}
      showPrices={binder.showPrices}
      emptyHint={filled === 0 ? 'Toque num bolso para escolher uma carta. Em ⚙ você muda capa, tamanho e páginas.' : undefined}
      onEdit={() => router.push({ pathname: '/binder-edit', params: { id: binder.id } })}
      itemsFor={(p) => customSlotsOnPage(binder, p).map((slot) => {
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
  entries: Entry[];
  counter: { value: number; total: number; unit: string };
  query: string;
  onQuery: (q: string) => void;
  onSearch: () => void;
  placeholder: string;
  notice: string | null;
  page: number;
  pages: number;
  onPage: (p: number) => void;
  /** Faixa mostrada embaixo do número da página (ex.: "#001 – #009"). */
  rangeFor: (page: number) => string;
  onNextEmpty: () => void;
  cols: number;
  /** Frente e verso: em tela larga, mostra duas páginas abertas, como o fichário de verdade. */
  doubleSided: boolean;
  coverColor: string;
  showPrices?: boolean;
  emptyHint?: string;
  onEdit: () => void;
  itemsFor: (page: number) => { key: string; render: (width: number) => ReactNode }[];
}) {
  const { width, height } = useWindowDimensions();
  const totals = useMemo(() => collectionTotals(props.entries), [props.entries]);
  const { page, pages, onPage } = props;
  // Tela larga + fichário frente e verso: duas páginas abertas lado a lado, como o fichário de verdade
  // (a primeira página fica sozinha ao lado da capa; a última também, se cair do lado esquerdo).
  const spread = props.doubleSided && width >= SPREAD_MIN_WIDTH && pages > 1;
  const innerWidth = Math.min(width, spread ? SPREAD_MAX_WIDTH : MAX_WIDTH) - 32;
  const pageWidth = spread ? Math.floor((innerWidth - SPREAD_GAP) / 2) : innerWidth;
  // Largura de cada bolso dentro da página escura (arredonda para baixo: sobra < 1px por linha, nunca falta).
  const byWidth = Math.floor((pageWidth - PAGE_PAD * 2 - GAP * (props.cols - 1)) / props.cols);
  // Tablet e computador: a página inteira cabe na altura da tela (como olhar o fichário aberto de uma vez).
  const rowsPerPage = Math.max(1, Math.ceil(props.itemsFor(page).length / props.cols));
  const byHeight = Math.floor(((height - CHROME_HEIGHT - PAGE_PAD * 2 - GAP * (rowsPerPage - 1)) / rowsPerPage - PRICE_SPACE) * CARD_RATIO);
  const slotWidth = width >= 600 ? Math.max(MIN_SLOT, Math.min(byWidth, byHeight)) : byWidth;
  // Largura real da página (encolhe junto com os bolsos).
  const sheetWidth = slotWidth * props.cols + GAP * (props.cols - 1) + PAGE_PAD * 2;
  const shown = spread ? spreadOf(page, pages) : [page];
  const firstShown = shown[0];
  const lastShown = shown[shown.length - 1];
  const canPrev = firstShown > 0;
  const canNext = lastShown < pages - 1;
  const goPrev = () => canPrev && onPage(firstShown - 1);
  const goNext = () => canNext && onPage(lastShown + 1);
  const pageLabel = shown.length > 1 ? `Páginas ${firstShown + 1}–${lastShown + 1}` : `Página ${firstShown + 1}`;
  const rangeLabel = shown.map(props.rangeFor).filter(Boolean).join('  ·  ');
  const progress = props.counter.value / Math.max(1, props.counter.total);
  const showPrices = props.showPrices !== false;
  const pending = props.entries.filter(pricePending).length;

  // Arrastar a página para o lado troca de página, como folhear o fichário.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
        onPanResponderRelease: (_e, g) => {
          if (g.dx < -60 && canNext) onPage(lastShown + 1);
          else if (g.dx > 60 && canPrev) onPage(firstShown - 1);
        },
      }),
    [canNext, canPrev, lastShown, firstShown, onPage],
  );

  /** Uma página escura do fichário, linha por linha (sem flexWrap: o arredondamento de largura nunca empurra um bolso para baixo). */
  const renderPage = (p: number) => {
    const items = props.itemsFor(p);
    const rows = Array.from({ length: Math.ceil(items.length / props.cols) }, (_, r) => items.slice(r * props.cols, (r + 1) * props.cols));
    return (
      <View key={p} style={{ width: sheetWidth }}>
        <View style={styles.page}>
          <View style={{ gap: GAP }}>
            {rows.map((row, r) => (
              <View key={r} style={[styles.row, { gap: GAP }]}>
                {row.map((item) => (
                  <View key={item.key}>{item.render(slotWidth)}</View>
                ))}
              </View>
            ))}
          </View>
        </View>
        {spread ? <Text style={styles.pageNumber}>{p + 1}</Text> : null}
      </View>
    );
  };
  /** Capa (ao lado da primeira página, com o nome do fichário) ou contracapa (ao lado da última). */
  const cover = (side: 'front' | 'back') => {
    const ink = onCover(props.coverColor);
    return (
      <View key={side} style={[styles.cover, { width: sheetWidth, backgroundColor: props.coverColor }]}>
        <MaterialCommunityIcons name="pokeball" size={side === 'front' ? 72 : 56} color={ink} style={{ opacity: side === 'front' ? 0.9 : 0.35 }} />
        {side === 'front' ? (
          <>
            <Text style={[styles.coverTitle, { color: ink }]} numberOfLines={3}>
              {props.title}
            </Text>
            <Text style={[styles.coverText, { color: ink }]}>
              {props.counter.value}/{props.counter.total} {props.counter.unit}
            </Text>
          </>
        ) : (
          <Text style={[styles.coverText, { color: ink }]}>contracapa</Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Topo vermelho: menu, nome do fichário (troca de fichário), personalizar, progresso e valor */}
        <View style={styles.hero}>
          <View style={[styles.inner, { width: innerWidth }]}>
            <View style={styles.header}>
              <HeaderButton icon="menu" label="Minha coleção" onPress={() => router.push('/menu')} />
              <Pressable style={styles.titleBtn} onPress={() => router.push('/binders')} accessibilityRole="button" accessibilityLabel="Trocar de fichário" hitSlop={6}>
                <Text style={styles.title} numberOfLines={1}>
                  {props.title}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.onPrimary} />
              </Pressable>
              <HeaderButton icon="settings-outline" label="Personalizar fichário" onPress={props.onEdit} />
            </View>

            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(1.5, Math.min(100, progress * 100))}%` }]} />
              </View>
              <Text style={styles.counter}>
                {props.counter.value}
                <Text style={styles.counterTotal}>
                  /{props.counter.total} {props.counter.unit}
                </Text>
              </Text>
            </View>

            {showPrices ? (
              <>
                <View style={styles.valueRow}>
                  <Text style={styles.valueLabel}>Valor</Text>
                  <Text
                    style={styles.value}
                    accessibilityLabel={
                      totals.valued
                        ? `Média ${formatBRL(totals.value)}${isSpread(totals.range) ? `, de ${formatBRL(totals.min)} a ${formatBRL(totals.max)}` : ''}`
                        : 'Sem valor'
                    }>
                    {totals.valued ? formatBRLTight(totals.value) : '—'}
                  </Text>
                  {/* Crédito obrigatório da API do MYP Cards onde os preços aparecem (vale também para os valores dos bolsos). */}
                  <Text
                    style={styles.valueSource}
                    accessibilityRole="link"
                    accessibilityLabel="Preços do MYP Cards, abrir mypcards.com"
                    onPress={() => WebBrowser.openBrowserAsync('https://mypcards.com')}>
                    MYP Cards ↗
                  </Text>
                </View>
                {/* Mínimo e máximo na linha de baixo (na linha do valor, o "máx" seria cortado no celular). */}
                <Text style={styles.valueNote}>
                  {[
                    totals.valued && isSpread(totals.range) ? `mín ${formatBRLTight(totals.min)} · máx ${formatBRLTight(totals.max)}` : null,
                    !props.entries.length
                      ? 'coloque sua primeira carta'
                      : pending
                        ? Platform.OS === 'web'
                          ? `${pending} ${pending === 1 ? 'carta espera' : 'cartas esperam'} o preço (o app no celular busca)`
                          : `buscando preço de ${pending} ${pending === 1 ? 'carta' : 'cartas'}… (deixe o app aberto)`
                        : `${totals.valued} de ${props.entries.length} com preço`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={[styles.inner, { width: innerWidth }]}>
          <SearchField
            value={props.query}
            onChangeText={props.onQuery}
            onSubmit={props.onSearch}
            placeholder={props.placeholder}
            label="Buscar no fichário"
            style={styles.search}
          />
          {props.notice ? <Text style={styles.notice}>{props.notice}</Text> : null}
          {props.emptyHint ? <Text style={styles.notice}>{props.emptyHint}</Text> : null}

          <Pager
            label={pageLabel}
            pages={pages}
            range={rangeLabel}
            canPrev={canPrev}
            canNext={canNext}
            onPrev={goPrev}
            onNext={goNext}
            onNextEmpty={props.onNextEmpty}
          />

          {/* Página(s) do fichário: escuras como as folhas plásticas */}
          <View style={[styles.spread, { gap: SPREAD_GAP }]} {...pan.panHandlers}>
            {spread && firstShown === 0 ? cover('front') : null}
            {shown.map(renderPage)}
            {spread && shown.length === 1 && firstShown > 0 ? cover('back') : null}
          </View>

          {pages > 1 ? (
            <Pager label={pageLabel} pages={pages} canPrev={canPrev} canNext={canNext} onPrev={goPrev} onNext={goNext} compact />
          ) : null}
          {pages > 1 ? <Text style={styles.swipeHint}>Dica: arraste a página para o lado para folhear.</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HeaderButton({ icon, label, onPress }: { icon: 'menu' | 'settings-outline'; label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={colors.onPrimary} />
    </Pressable>
  );
}

/** Página(s) anterior/próxima, número da página, faixa da página e "próximo vazio". */
function Pager({
  label,
  pages,
  range,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onNextEmpty,
  compact,
}: {
  label: string;
  pages: number;
  range?: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onNextEmpty?: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.pager, compact && { marginTop: 14, marginBottom: 0 }]}>
      <PageButton icon="chevron-back" label="Página anterior" disabled={!canPrev} onPress={onPrev} />
      <View style={styles.pagerMid}>
        <Text style={styles.pageTitle}>
          {label} <Text style={styles.pageOf}>de {pages}</Text>
        </Text>
        {range ? (
          <Text style={styles.pageRange} numberOfLines={1}>
            {range}
          </Text>
        ) : null}
      </View>
      <PageButton icon="chevron-forward" label="Próxima página" disabled={!canNext} onPress={onNext} />
      {onNextEmpty ? (
        <Pressable
          onPress={onNextEmpty}
          style={({ pressed }) => [styles.nextEmpty, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel="Ir para o próximo espaço vazio">
          <Ionicons name="arrow-redo-outline" size={15} color={colors.primary} />
          <Text style={styles.nextEmptyText}>Vazio</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Páginas abertas lado a lado (índices a partir de 0): [0], [1, 2], [3, 4]… e a última sozinha se cair à esquerda. */
function spreadOf(page: number, pages: number) {
  if (page <= 0) return [0];
  const left = page % 2 === 1 ? page : page - 1;
  return left + 1 < pages ? [left, left + 1] : [left];
}

function PageButton({ icon, label, disabled, onPress }: { icon: 'chevron-back' | 'chevron-forward'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.pageBtn, disabled && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.primary },
  scroll: { backgroundColor: colors.background, paddingBottom: 48, flexGrow: 1 },
  inner: { alignSelf: 'center' },
  hero: { backgroundColor: colors.primary, paddingTop: 6, paddingBottom: 34, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  title: { color: colors.onPrimary, fontSize: 20, fontWeight: '900', flexShrink: 1 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  progressTrack: { flex: 1, height: 10, backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: 10, borderRadius: 5, backgroundColor: colors.yellow },
  counter: { color: colors.onPrimary, fontFamily: mono, fontSize: 14, fontWeight: '800' },
  counterTotal: { fontSize: 12, fontWeight: '600', opacity: 0.8 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 },
  valueLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  value: { color: colors.onPrimary, fontSize: 22, fontWeight: '900' },
  valueNote: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2, lineHeight: 17 },
  valueSource: { color: colors.onPrimary, fontSize: 12, fontWeight: '800', marginLeft: 'auto', textDecorationLine: 'underline' },
  search: { marginTop: -24, marginBottom: 12 },
  notice: { color: colors.textMuted, fontSize: 13, marginBottom: 10, lineHeight: 18, textAlign: 'center' },
  pager: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  pagerMid: { flex: 1, alignItems: 'center' },
  pageBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  pageTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  pageOf: { color: colors.textMuted, fontWeight: '700' },
  pageRange: { color: colors.textMuted, fontFamily: mono, fontSize: 12, marginTop: 2 },
  nextEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
  },
  nextEmptyText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  spread: { flexDirection: 'row', justifyContent: 'center' },
  page: { backgroundColor: B.page, borderRadius: radius.lg, padding: PAGE_PAD, borderWidth: 1, borderColor: B.pageBorder },
  pageNumber: { color: colors.textFaint, fontSize: 12, fontWeight: '800', textAlign: 'center', marginTop: 6 },
  cover: { borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: 6, ...shadow },
  coverTitle: { fontSize: 30, fontWeight: '900', textAlign: 'center', paddingHorizontal: 24, marginTop: 8 },
  coverText: { fontSize: 13, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', opacity: 0.7 },
  row: { flexDirection: 'row' },
  swipeHint: { color: colors.textFaint, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
