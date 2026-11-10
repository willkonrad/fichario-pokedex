import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, Stack, useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useDeferredValue, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, BackHandler, Keyboard, Platform, ScrollView, StyleSheet, Text, View, type TextInputInstance, type ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddCardSheet } from '@/components/add-sheet';
import { CardGridSkeleton } from '@/components/card-grid';
import { heading, inertWhen, useFocusReturn } from '@/components/layer-a11y';
import { addRecent, dropFilterTerm, getSessionLang, HpRow, LangRow, LookupField, readRecents, RECENT_KEY, setSessionLang, SpeciesStrip, withSpecies, type LangChip, type RecentSearch } from '@/components/lookup-bar';
import { activeFilterList, LookupFiltersPanel, NoResultFilters, type ActiveFilter } from '@/components/lookup-filters';
import { cursorSpeech, gridPhotoUrl, LookupGrid, lookupGridSize, LookupListFoot, usesYearRail } from '@/components/lookup-grid';
import { LookupPhoto, type LookupPhotoResult } from '@/components/lookup-photo';
import { collectableLang, LookupCardBody, LookupPanel, LookupSheet } from '@/components/lookup-sheet';
import { CONSULTA_LAST } from '@/components/lookup-warmup';
import { Button, Chip, ChipGroup, EmptyState, GroupLabel, IconButton, Notice, showToast, useKeyboardHeight, useLayout, useToastClearance } from '@/components/ui';
import { getSpecies } from '@/data/pokedex';
import { LOOKUP_PRICE, LOOKUP_UNAVAILABLE } from '@/lib/copy';
import { formatDay, formatInt } from '@/lib/format';
import { lookupBrief, shownPrint } from '@/lib/lookup-brief';
import { numberKeys, numberLeft } from '@/lib/lookup-format';
import { ensureLookupLoaded, lookupByCode, lookupByNumber, searchTrainers, sectionCards, sectionCount, setLookupFocused, useLookupIndex } from '@/lib/lookup-index';
import { hpTermToNumber, NO_VALUE, parseLookupQuery, toggleTerm, type QueryContext } from '@/lib/lookup-query';
import type { LookupCard, LookupFilters, LookupHeader, LookupLang, ParsedQuery, VariantFilter } from '@/lib/lookup-types';
import { applyFilters, defaultSheetLang, facets as facetsOf, groupByYear, type YearGroup } from '@/lib/lookup-view';
import { holdMypQueue } from '@/lib/myp-queue';
import { deliverScanPick } from '@/lib/scan-lot';
import type { CardBrief } from '@/lib/tcgdex';
import { colors, space, TOUCH, typography } from '@/theme';

import { isOcrAvailable } from '../../modules/card-ocr';

const WEB = Platform.OS === 'web';
const ANDROID = Platform.OS === 'android';
const KEEP_AWAKE = 'consulta';
/** Tela dividida com a live: fica só a faixa contextual e o campo. */
const LOW_WINDOW = 560;
const PANEL_WIDTH = 400;
/** Altura da linha de título (a mesma da grade, que a conta na rolagem). */
const TITLE_HEIGHT = TOUCH + space.sm;
const STALE_MS = 3 * 86_400_000;
const PREFETCH_COUNT = 12;
const PREFETCH_DELAY_MS = 150;
const ANNOUNCE_DELAY_MS = 800;
/** Sem tecla por este tempo, a pessoa parou de digitar: só aí "nenhuma carta" troca a grade. */
const TYPING_PAUSE_MS = 800;
/** Carta única na tela por este tempo, com o campo em uso: a busca deu resultado e vai para os recentes. */
const SOLE_RECENT_MS = 2000;
const LANGS: readonly LookupLang[] = ['pt', 'en', 'ja', 'ko', 'zh'];
const LANG_TAG: Record<LookupLang, string> = { pt: 'PT', en: 'EN', ja: 'JP', ko: 'KO', zh: 'ZH' };

/** Como cada variação se escreve no campo; a que não tem termo fica guardada à parte. */
const VARIANT_TERM: Partial<Record<VariantFilter, string>> = {
  holo: 'holo',
  reverse: 'reverse',
  firstEdition: '1ed',
  stamp: 'selo',
  staff: 'staff',
  pokeball: 'pokeball',
  masterball: 'masterball',
  mirror: 'mirror',
};

/** Filtros que a gramática nem sempre sabe escrever ("Sem ano", "Stage 2"): guardados à parte, só para esta busca. */
type HeldField = 'year' | 'rarity' | 'setKey' | 'cardType' | 'stage' | 'number' | 'variant';
type HeldValues = Partial<Pick<LookupFilters, HeldField>>;
type ChipField = HeldField | 'hp';

const HELD_FIELDS: ReadonlySet<ChipField> = new Set<ChipField>(['year', 'rarity', 'setKey', 'cardType', 'stage', 'number', 'variant']);
const PANEL_TERMS = ['year', 'rarity', 'variant', 'setKey'] as const;
const NO_HELD: HeldValues = {};

const same = (a: unknown, b: unknown) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();
const cartas = (n: number) => `${formatInt(n)} ${n === 1 ? 'carta' : 'cartas'}`;
const asLang = (v: unknown) => (LANGS.includes(v as LookupLang) ? (v as LookupLang) : null);

/** Lista derivada da seção, calculada uma vez por lista (a seção é a mesma enquanto estiver no cache). */
function perSection<T>(make: (cards: LookupCard[]) => T) {
  const cache = new WeakMap<LookupCard[], T>();
  return (dex: number) => {
    const cards = sectionCards(dex);
    let value = cache.get(cards);
    if (value === undefined) {
      value = make(cards);
      cache.set(cards, value);
    }
    return value;
  };
}

function queryContext(header: LookupHeader | null): QueryContext {
  const abbrs = new Set<string>();
  if (header) {
    for (const s of header.sets.values()) if (s.abbr) abbrs.add(s.abbr.toLowerCase());
    for (const a of header.tdAbbr.values()) abbrs.add(a.toLowerCase());
  }
  return {
    hpsOf: perSection((cards) => new Set(cards.flatMap((c) => (c.hp != null ? [c.hp] : [])))),
    countOf: sectionCount,
    abbrsOf: perSection((cards) => new Set(cards.map((c) => c.set.abbr).filter(Boolean))),
    isSetAbbr: (a) => abbrs.has(a.toLowerCase()),
    // "dark patch" é o treinador; "MEW 199" sem carta do Mew com esse número é a sigla MEW (ver parseLookupQuery).
    trainerCount: (words) => searchTrainers(words).length,
    matchCount: (dex, f) => {
      const r = applyFilters(sectionCards(dex), f);
      return r.shown.length + r.withoutHp.length;
    },
    codeCount: (abbr, number) => lookupByCode(abbr, number).length,
  };
}

/** Identifica a lista-base: filtro novo não muda a busca, outro Pokémon muda. */
const scopeOf = (q: ParsedQuery) => [q.mode, q.dex ?? '', q.code?.abbr ?? '', q.code?.number ?? '', q.mode === 'trainer' ? q.text : q.mode === 'number' ? (q.filters.number ?? '') : ''].join('|');

function findCards(header: LookupHeader | null, mode: ParsedQuery['mode'], dex: number | null, abbr: string | undefined, code: string | undefined, number: string | null, trainer: string): LookupCard[] {
  if (!header) return [];
  if (mode === 'species' && dex != null) return sectionCards(dex);
  if (mode === 'number' && number) return lookupByNumber(number);
  if (mode === 'code' && abbr && code) return lookupByCode(abbr, code);
  if (mode === 'trainer') return searchTrainers(trainer);
  return [];
}

/** O texto manda; o que ficou guardado completa; o idioma digitado vale sobre o chip. */
function mergeFilters(q: ParsedQuery, held: HeldValues, chipLang: LookupLang | null): LookupFilters {
  const f = q.filters;
  return {
    ...f,
    lang: f.lang ?? chipLang,
    year: f.year ?? held.year ?? null,
    rarity: f.rarity ?? held.rarity ?? null,
    variant: f.variant ?? held.variant ?? null,
    setKey: f.setKey ?? held.setKey ?? null,
    cardType: f.cardType ?? held.cardType ?? null,
    stage: f.stage ?? held.stage ?? null,
    // Na busca por número, a lista-base já é só aquele número; em treinador, só aquelas palavras.
    number: q.mode === 'number' ? null : (f.number ?? held.number ?? null),
    nameTerms: q.mode === 'trainer' ? [] : f.nameTerms,
  };
}

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** A grade na tela: a da busca ou, enquanto a pessoa digita um termo que ainda dá zero, a anterior. */
type GridView = { text: string; shown: LookupCard[]; withoutHp: LookupCard[]; groups: YearGroup[]; lang: LookupLang | null; variant: VariantFilter | null };

/** Um texto continua o outro (digitando ou apagando o fim): só aí a grade anterior segura o lugar. */
function continues(a: string, b: string) {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return !!x && !!y && (x.startsWith(y) || y.startsWith(x));
}

function isStale(day: string, now = Date.now()) {
  const at = new Date(`${day}T00:00:00`).getTime();
  return Number.isFinite(at) && now - at > STALE_MS;
}

function TitleRow({ pricesDay, pick }: { pricesDay?: string; pick: boolean }) {
  return (
    <View style={styles.titleRow}>
      <IconButton icon="chevron-back" label="Voltar" onPress={goBack} style={styles.back} />
      <Text style={styles.title} {...heading(1)} numberOfLines={1}>
        {pick ? 'Escolher carta' : 'Consulta'}
      </Text>
      {pricesDay ? <Text style={styles.dataDay}>Dados {formatDay(pricesDay)}</Text> : null}
    </View>
  );
}

/** Preparando o índice pela primeira vez: esqueleto, sem travar o campo. */
function Preparing() {
  return (
    <>
      <Text style={styles.preparing} role="status" aria-live="polite" accessibilityLiveRegion="polite">
        Preparando as cartas (2 MB)…
      </Text>
      <CardGridSkeleton />
    </>
  );
}

type ScanNote = { text: string; forText: string; undo: string | null; others: number[] };

/**
 * Consulta de cartas, feita para leilão ao vivo: um campo que faz tudo (no rodapé do celular, no topo do computador), a
 * grade com o preço na célula e a folha da carta. Não mexe na coleção: quem adiciona é a `AddCardSheet`, com o toque do
 * dono, e nenhuma referência de outro idioma sai desta tela para o valor.
 */
export default function ConsultaScreen() {
  const params = useLocalSearchParams<{ q?: string; lang?: string; pick?: string }>();
  const L = useLayout();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const { status, header, problem } = useLookupIndex();
  const desktop = L.isDesktop;
  const low = !desktop && L.height < LOW_WINDOW;
  const pick = typeof params.pick === 'string' && params.pick ? params.pick : null;
  const pricesDay = header?.pricesDay || undefined;

  const [text, setText] = useState(() => (typeof params.q === 'string' ? params.q : ''));
  const [autoFocus] = useState(() => !text);
  const [chipLang, setChipLang] = useState<LookupLang | null>(() => asLang(params.lang) ?? getSessionLang());
  const [held, setHeld] = useState<{ scope: string; values: HeldValues }>({ scope: '', values: NO_HELD });
  const [focused, setFocused] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<LookupCard | null>(null);
  const [openLang, setOpenLang] = useState<LookupLang | null>(null);
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [addBrief, setAddBrief] = useState<CardBrief | null>(null);
  const [recents, setRecents] = useState<RecentSearch[]>([]);
  const [recentsLoaded, setRecentsLoaded] = useState(false);
  const [scan, setScan] = useState<'photo' | 'print' | null>(null);
  const [note, setNote] = useState<ScanNote | null>(null);
  const [barHeight, setBarHeight] = useState(0);
  const [photoOpen, setPhotoOpen] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);
  // A folha do celular e os filtros são camadas: ao fechar, o foco volta para quem as abriu (a célula, o botão).
  const sheetFocus = useFocusReturn(!desktop && !!selected);
  const filtersFocus = useFocusReturn(filtersOpen);
  const onTop = useIsFocused();

  // O aviso (toast) fica acima da barra do campo, que é a base fixa desta tela no celular.
  useToastClearance(!desktop && onTop ? barHeight : 0);

  // Enquanto a tela está na frente: não apaga, a fila do MYP espera e o índice novo fica no disco.
  useFocusEffect(
    useCallback(() => {
      void activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
      let releaseQueue: (() => void) | null = holdMypQueue();
      setLookupFocused(true);
      if (ANDROID) WebBrowser.warmUpAsync().catch(() => {});
      ensureLookupLoaded().catch(() => {});
      const stamp = () => {
        AsyncStorage.setItem(CONSULTA_LAST, String(Date.now())).catch(() => {});
      };
      stamp();
      // Fora do app a Consulta não usa as vagas do MYP: a fila (e a tarefa em segundo plano) segue.
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          releaseQueue ??= holdMypQueue();
          // Na web, o navegador solta a tela acesa ao esconder a aba (link de portal, a live): pede de novo na volta.
          if (WEB) void activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
          return;
        }
        stamp();
        releaseQueue?.();
        releaseQueue = null;
      });
      return () => {
        void deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
        releaseQueue?.();
        setLookupFocused(false);
        if (ANDROID) WebBrowser.coolDownAsync().catch(() => {});
        sub.remove();
        AsyncStorage.removeItem(CONSULTA_LAST).catch(() => {});
      };
    }, []),
  );

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => {
        if (!alive) return;
        setRecents((current) => current.reduceRight(addRecent, readRecents(raw)));
      })
      .catch(() => {})
      .finally(() => alive && setRecentsLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (recentsLoaded) AsyncStorage.setItem(RECENT_KEY, JSON.stringify(recents)).catch(() => {});
  }, [recents, recentsLoaded]);

  // Sem debounce: o texto e as sugestões respondem na hora; a grade vem depois, só quando a busca ou os filtros mudam.
  const ctx = useMemo(() => queryContext(header), [header]);
  const parse = useCallback((t: string) => parseLookupQuery(t, ctx), [ctx]);
  const query = useMemo(() => parse(text), [parse, text]);
  const deferred = useDeferredValue(query);
  const liveScope = scopeOf(query);
  const scope = scopeOf(deferred);
  const heldValues = held.scope === scope ? held.values : NO_HELD;

  const { mode, dex } = deferred;
  const numberTerm = mode === 'number' ? deferred.filters.number : null;
  const trainerText = mode === 'trainer' ? deferred.text : '';
  const base = useMemo(() => findCards(header, mode, dex, deferred.code?.abbr, deferred.code?.number, numberTerm, trainerText), [header, mode, dex, deferred.code?.abbr, deferred.code?.number, numberTerm, trainerText]);

  const filterKey = JSON.stringify(mergeFilters(deferred, heldValues, chipLang));
  const filters = useMemo(() => JSON.parse(filterKey) as LookupFilters, [filterKey]);
  const { shown, withoutHp } = useMemo(() => applyFilters(base, filters), [base, filters]);
  const groups = useMemo(() => groupByYear(shown), [shown]);
  const facets = useMemo(() => facetsOf(base, filters), [base, filters]);

  // Digitando "58/10" (a caminho de "58/102") o termo ainda dá zero: até a pessoa parar, fica a grade anterior.
  const [pausedText, setPausedText] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setPausedText(text), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const stillTyping = focused && text !== pausedText;
  const [lastGrid, setLastGrid] = useState<GridView | null>(null);
  const ready = status === 'ready' && !!header;
  const found = ready && shown.length + withoutHp.length > 0;
  // Campo vazio: a grade guardada sai (a busca seguinte começa do zero).
  if (!text.trim()) {
    if (lastGrid) setLastGrid(null);
  } else if (found && lastGrid?.shown !== shown) setLastGrid({ text, shown, withoutHp, groups, lang: filters.lang, variant: filters.variant });
  const holding = ready && !found && stillTyping && !!lastGrid && continues(text, lastGrid.text);
  const grid: GridView = holding && lastGrid ? lastGrid : { text, shown, withoutHp, groups, lang: filters.lang, variant: filters.variant };

  const langChips = useMemo<LangChip[]>(() => {
    const all = applyFilters(base, { ...filters, lang: null }).shown.length;
    return [{ id: null, count: all }, ...LANGS.filter((l) => facets.langs[l] > 0 || l === filters.lang).map((l) => ({ id: l, count: facets.langs[l] }))];
  }, [base, filters, facets]);

  const speciesItems = useMemo(() => {
    const others = (note?.forText === text ? note.others : [])
      .filter((id) => !query.suggestions.some((s) => s.species.id === id))
      .flatMap((id) => {
        const species = getSpecies(id);
        return species ? [{ species, count: sectionCount(id) }] : [];
      });
    return [...query.suggestions, ...others];
  }, [note, text, query.suggestions]);

  const ambiguousHp = useMemo(() => {
    const value = deferred.hpOrNumber;
    return value && base.some((c) => numberKeys(c).some((k) => numberLeft(k) === value)) ? value : null;
  }, [deferred.hpOrNumber, base]);
  const noNumberCount = useMemo(() => (mode === 'species' && filters.number != null ? applyFilters(base, { ...filters, number: NO_VALUE }).shown.length : 0), [mode, base, filters]);

  const speciesName = mode === 'species' && dex != null ? getSpecies(dex)?.name : undefined;
  const searchTerm = speciesName ?? deferred.text;
  const total = grid.shown.length + grid.withoutHp.length;
  const sole = grid.shown.length === 1 && !grid.withoutHp.length ? grid.shown[0] : null;
  const panelCount = [filters.year, filters.rarity, filters.variant, filters.setKey, filters.cardType, filters.stage].filter((v) => v != null).length;
  const active = useMemo<ActiveFilter[]>(() => (header ? activeFilterList(filters, base, header) : []), [filters, base, header]);

  const outerWidth = L.contentWidth('wide');
  const gridWidth = desktop ? Math.max(0, outerWidth - PANEL_WIDTH - space.xl) : outerWidth;
  const singleYears = grid.groups.filter((g) => g.from != null && g.from === g.to).length;
  const { cols, big } = lookupGridSize(gridWidth, grid.shown.length, usesYearRail(singleYears, grid.shown.length));

  // O que o leitor de tela ouve no computador: a carta sob o cursor e a aberta no painel (vale para a grade em que nasceu).
  const [say, setSay] = useState<{ text: string; grid: LookupCard[] } | null>(null);

  // Outra busca: o cursor volta ao começo e, no computador, o painel fica livre.
  const [seenScope, setSeenScope] = useState(scope);
  if (seenScope !== scope) {
    setSeenScope(scope);
    setCursorKey(null);
    if (desktop) setSelected(null);
  }

  // Carta aberta no painel do computador: o foco fica no campo ou na grade, então a região "ao vivo" diz qual abriu.
  const [seenSelected, setSeenSelected] = useState(selected);
  if (seenSelected !== selected) {
    setSeenSelected(selected);
    if (desktop && selected && header) setSay({ text: `Aberta ao lado: ${cursorSpeech(selected, filters.lang, header, filters.variant)}`, grid: grid.shown });
  }

  const onSearch = useCallback(() => {
    router.push({ pathname: '/search', params: searchTerm ? { q: searchTerm } : {} });
  }, [searchTerm]);

  const remember = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) setRecents((list) => addRecent(list, { text: trimmed, lang: chipLang }));
  };
  // Abriu uma carta: a busca deu resultado e vai para os recentes.
  const opened = selected ?? addBrief;
  const [seenOpened, setSeenOpened] = useState(opened);
  if (seenOpened !== opened) {
    setSeenOpened(opened);
    if (opened) remember(text);
  }

  // Busca respondida pela carta única na tela, sem abrir nada: também vai para os recentes, depois de um instante parado,
  // com o teclado fechado ou ao sair do app (um link de portal aberto, outra aba).
  const soleText = sole && !holding && deferred === query ? text.trim() : '';
  const rememberShown = useEffectEvent(() => remember(text));
  useEffect(() => {
    if (!soleText) return;
    const timer = setTimeout(() => rememberShown(), focused ? SOLE_RECENT_MS : 0);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') rememberShown();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [soleText, focused]);

  const openCard = useCallback((card: LookupCard, lang: LookupLang | null = null) => {
    Keyboard.dismiss();
    setSelected(card);
    setOpenLang(lang);
  }, []);

  /** Aberta de fora da folha (a célula da grade): o foco volta a ela quando a folha fechar. */
  const openFromGrid = useCallback(
    (card: LookupCard, from?: ViewInstance | null) => {
      sheetFocus.from(from);
      openCard(card);
    },
    [openCard, sheetFocus],
  );

  // Segurar: adiciona direto. Na conferência do lote, segurar só abre a carta: nada entra na coleção por aqui.
  const activeLang = grid.lang;
  const activeVariant = grid.variant;
  const addCard = useCallback(
    (card: LookupCard) => {
      if (pick) return openCard(card);
      const lang = defaultSheetLang(card, activeLang);
      if (!collectableLang(lang)) return showToast({ message: LOOKUP_PRICE.onlyLookup });
      Keyboard.dismiss();
      // A impressão da célula vai junto (a do filtro de variação, a da coleção "(Shadowless)"…), como no "Adicionar" da folha.
      setAddBrief(lookupBrief(card, lang, header ? shownPrint(card, lang, header, activeVariant) : null));
    },
    [openCard, pick, activeLang, activeVariant, header],
  );

  const addFromBody = useCallback(
    (brief: CardBrief) => {
      // No celular a folha dá lugar à de adicionar, que cuida do foco dela.
      if (!desktop) {
        sheetFocus.forget();
        setSelected(null);
      }
      setAddBrief(brief);
    },
    [desktop, sheetFocus],
  );

  const pickCard = useCallback(
    (card: LookupCard, lang: 'pt' | 'en' | 'ja') => {
      if (!pick) return;
      deliverScanPick(pick, card, lang);
      goBack();
    },
    [pick],
  );

  // No computador, o painel não tira o foco de ninguém: só a folha do celular devolve.
  const closeSheet = useCallback(() => {
    if (desktop) sheetFocus.forget();
    else sheetFocus.back();
    setSelected(null);
  }, [desktop, sheetFocus]);
  const closeScan = useCallback(() => setScan(null), []);

  /** `e`: o toque no botão dos filtros, para o foco voltar a ele ao fechar. */
  function openFilters(e?: { currentTarget?: unknown }) {
    filtersFocus.from(e?.currentTarget);
    Keyboard.dismiss();
    setFiltersOpen(true);
  }

  const closeFilters = useCallback(() => {
    filtersFocus.back();
    setFiltersOpen(false);
  }, [filtersFocus]);

  const layerOpen = filtersOpen || (!desktop && !!selected);

  function hold(field: ChipField, value: string | number | undefined) {
    if (!HELD_FIELDS.has(field)) return;
    setHeld((h) => ({ scope: liveScope, values: { ...(h.scope === liveScope ? h.values : NO_HELD), [field]: value } }));
  }

  /** Chip tocado: escreve o termo no texto; o que a gramática não lê de volta fica guardado à parte. */
  function toggleFilter(field: ChipField, value: string | number, term: string | null) {
    const clean = dropFilterTerm(text, field, parse);
    hold(field, undefined);
    if (same(filters[field], value)) return setText(clean);
    if (term) {
      const next = toggleTerm(clean, term, parse);
      if (same(parse(next).filters[field], value)) return setText(next);
    }
    setText(clean);
    hold(field, value);
  }

  function chooseLang(lang: LookupLang | null) {
    setSessionLang(lang);
    setChipLang(lang);
    if (query.filters.lang) setText(dropFilterTerm(text, 'lang', parse));
  }

  function clearActive(item: ActiveFilter) {
    if (item.id === 'lang') return chooseLang(null);
    if (item.id.startsWith('name:')) return setText(toggleTerm(text, item.id.slice('name:'.length)));
    hold(item.id as ChipField, undefined);
    setText(dropFilterTerm(text, item.id as ChipField, parse));
  }

  function clearPanel() {
    setHeld({ scope: liveScope, values: NO_HELD });
    setText(PANEL_TERMS.reduce((t, field) => dropFilterTerm(t, field, parse), text));
  }

  function chooseSet(key: string) {
    const abbr = header?.sets.get(key)?.abbr;
    const unique = !!abbr && facets.sets.filter(([k]) => same(header?.sets.get(k)?.abbr, abbr)).length === 1;
    toggleFilter('setKey', unique ? abbr : key, unique ? abbr : null);
  }

  function submit() {
    const atCursor = cursorKey ? grid.shown.find((c) => c.key === cursorKey) : undefined;
    if (atCursor) return openCard(atCursor);
    const first = query.mode === 'species' && query.suggestions.length > 1 ? query.suggestions[0].species : null;
    const next = first ? withSpecies(text, first) : text;
    setText(next);
    Keyboard.dismiss();
    if (query.mode !== 'empty') remember(next);
  }

  function clearField() {
    setText('');
    inputRef.current?.focus();
  }

  function repeatRecent(r: RecentSearch) {
    Keyboard.dismiss();
    setText(r.text);
    setSessionLang(r.lang);
    setChipLang(r.lang);
  }

  function openScan(kind: 'photo' | 'print') {
    Keyboard.dismiss();
    setNote(null);
    setScan(kind);
  }

  function onScanResult(r: LookupPhotoResult) {
    setScan(null);
    const forText = r.text || text;
    if (r.text) setText(r.text);
    setNote({ text: r.note, forText, undo: r.text ? text : null, others: r.others ?? [] });
    if (r.open) openCard(r.open, r.openLang ?? null);
  }

  // A câmera aberta fica no lugar da lista: o voltar do Android fecha só ela.
  useEffect(() => {
    if (!scan || WEB) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setScan(null);
      return true;
    });
    return () => sub.remove();
  }, [scan]);

  // Depois de um instante parado, as primeiras fotos já vêm para o cache.
  const firstUrls = useMemo(() => shown.slice(0, PREFETCH_COUNT).flatMap((c) => gridPhotoUrl(c, filters.lang, big) ?? []), [shown, filters.lang, big]);
  useEffect(() => {
    if (!firstUrls.length) return;
    const timer = setTimeout(() => {
      Image.prefetch(firstUrls, 'memory-disk').catch(() => {});
    }, PREFETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [firstUrls]);

  // Quantas cartas apareceram: lido depois que a pessoa para de digitar (na web, pela região "ao vivo").
  const countSpeech = ready && mode !== 'empty' ? cartas(total) : '';
  useEffect(() => {
    if (WEB || !countSpeech) return;
    const timer = setTimeout(() => AccessibilityInfo.announceForAccessibility(countSpeech), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [countSpeech]);

  // Teclas da web: Esc fecha os filtros e a folha em qualquer largura. No computador: / foca, setas andam, Enter abre,
  // Esc limpa o campo.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const el = document.activeElement as HTMLElement | null;
    const inField = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA';
    const idle = !el || el === document.body;
    if (e.key === 'Escape') {
      // A folha de adicionar e a foto grande são Modais: o Esc é delas (a carta continua aberta).
      if (addBrief || photoOpen) return;
      if (filtersOpen) closeFilters();
      else if (selected) closeSheet();
      else if (desktop && text) clearField();
      else return;
      e.preventDefault();
      return;
    }
    if (!desktop) return;
    if (e.key === '/' && !inField) {
      e.preventDefault();
      inputRef.current?.focus();
      return;
    }
    if (e.key === 'Enter' && idle && cursorKey) {
      const card = grid.shown.find((c) => c.key === cursorKey);
      if (card) {
        e.preventDefault();
        openCard(card);
      }
      return;
    }
    const list = grid.shown;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : 0;
    if (!step || !list.length || !(idle || (inField && Math.abs(step) === cols))) return;
    e.preventDefault();
    const at = cursorKey ? list.findIndex((c) => c.key === cursorKey) : -1;
    const next = list[at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + step))];
    setCursorKey(next.key);
    // O cursor é só um anel na tela: o leitor de tela ouve a carta pela região "ao vivo".
    if (header) setSay({ text: cursorSpeech(next, grid.lang, header, grid.variant), grid: list });
  });

  useEffect(() => {
    if (!WEB) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const hasTitle = !desktop && !low;
  const title = useMemo(() => (hasTitle ? <TitleRow pricesDay={pricesDay} pick={!!pick} /> : null), [hasTitle, pricesDay, pick]);
  const footer = useMemo(() => (header ? <LookupListFoot lang={filters.lang} header={header} speciesName={speciesName} onSearch={onSearch} /> : null), [filters.lang, header, speciesName, onSearch]);

  const bodyProps = header
    ? { header, activeLang: filters.lang, openLang: selected ? openLang : null, variant: filters.variant, pick: !!pick, onOpenCard: openCard, onAdd: addFromBody, onPick: pickCard, onPhoto: setPhotoOpen }
    : null;
  const pad = desktop ? 0 : L.gutter;
  const asian = filters.lang === 'ko' || filters.lang === 'zh';

  function renderMain(): ReactNode {
    if (scan) return <LookupPhoto mode={scan} lang={filters.lang} onResult={onScanResult} onCancel={closeScan} />;
    const titled = (content: ReactNode) => (
      <View style={styles.fill}>
        {title ? <View style={{ paddingHorizontal: pad }}>{title}</View> : null}
        {content}
      </View>
    );
    if (status === 'downloading') return titled(<Preparing />);
    if (status === 'noNetwork' && !header) {
      return titled(
        <EmptyState
          title="Conecte uma vez para baixar as cartas"
          text="Depois disso, a Consulta funciona sem internet."
          action={
            <View style={styles.actions}>
              <Button title="Tentar de novo" variant="secondary" onPress={() => void ensureLookupLoaded().catch(() => {})} />
              <Button title="Buscar no app" variant="ghost" onPress={onSearch} />
            </View>
          }
        />,
      );
    }
    if (status === 'noIndex' && !header) {
      // Lista que o app não lê pede atualizar o app; falha do servidor passa com outra tentativa.
      return titled(
        <EmptyState
          title={LOOKUP_UNAVAILABLE.title}
          text={problem === 'format' ? LOOKUP_UNAVAILABLE.format : LOOKUP_UNAVAILABLE.server}
          action={
            <View style={styles.actions}>
              <Button title="Tentar de novo" variant="secondary" onPress={() => void ensureLookupLoaded().catch(() => {})} />
              <Button title="Buscar no app" variant="ghost" onPress={onSearch} />
            </View>
          }
        />,
      );
    }
    if (!text.trim()) {
      return (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.home, { width: gridWidth }]}>
          {title}
          {recents.length ? (
            <View>
              <GroupLabel>Recentes</GroupLabel>
              <ChipGroup label="Buscas recentes" mode="button">
                {recents.map((r) => (
                  <Chip
                    key={`${r.text}|${r.lang ?? ''}`}
                    mode="button"
                    label={r.lang ? `${r.text} · ${LANG_TAG[r.lang]}` : r.text}
                    accessibilityLabel={`Buscar de novo: ${r.text}${r.lang ? `, em ${LANG_TAG[r.lang]}` : ''}`}
                    onPress={() => repeatRecent(r)}
                  />
                ))}
              </ChipGroup>
            </View>
          ) : null}
          <View>
            <Text style={styles.hint}>Nome, depois HP, ano ou número:</Text>
            <Text style={styles.hintExamples}>char 120 · umbreon jp · 070/108</Text>
          </View>
        </ScrollView>
      );
    }
    if (!ready) {
      // O índice ainda vai para a memória: campo e sugestões já funcionam, a grade entra ao terminar.
      return titled(<CardGridSkeleton />);
    }
    // A busca nova ainda não chegou à grade: "nenhuma carta" só depois de ela chegar.
    if (!total && scope !== liveScope) return titled(<CardGridSkeleton />);
    if (!total) {
      const withFilters = base.length > 0 && active.length > 0;
      return (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.home, { width: gridWidth }]}>
          {title}
          {withFilters ? (
            <NoResultFilters items={active} onClear={clearActive} />
          ) : (
            <EmptyState
              title={mode === 'number' || mode === 'code' ? 'Nenhuma carta com esse número' : 'Nenhuma carta com esse nome'}
              action={asian ? undefined : <Button title="Buscar no app" variant="secondary" onPress={onSearch} />}
            />
          )}
          {withFilters || asian ? footer : null}
        </ScrollView>
      );
    }
    if (sole && !desktop && bodyProps) {
      return (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.single, { width: gridWidth }]}>
          {title}
          <LookupCardBody {...bodyProps} card={sole} width={gridWidth} />
          {footer}
        </ScrollView>
      );
    }
    return (
      <View style={[styles.gridBox, { width: gridWidth }]}>
        <LookupGrid
          groups={grid.groups}
          withoutHp={grid.withoutHp}
          width={gridWidth}
          fontScale={L.fontScale}
          lang={grid.lang}
          variant={grid.variant}
          header={header as LookupHeader}
          title={title}
          footer={footer}
          cursorKey={cursorKey}
          bottomPad={space.lg}
          pick={!!pick}
          onOpen={openFromGrid}
          onAdd={addCard}
        />
      </View>
    );
  }

  // No Android, o teclado vem sem a barra de navegação: soma-se a área segura para o campo ficar logo acima dele.
  const barBottom = (ANDROID ? insets.bottom + keyboard : Math.max(insets.bottom, keyboard)) + space.sm;
  const typing = focused && (WEB || keyboard > 0);

  const speciesStrip = speciesItems.length > 1 ? <SpeciesStrip items={speciesItems} active={query.dex} onPick={(s) => setText(withSpecies(text, s))} /> : null;
  const showFilterRows = ready && base.length > 0 && !scan;
  const hpRow = showFilterRows ? (
    <HpRow
      hps={facets.hps}
      value={filters.hp}
      filterCount={panelCount}
      onHp={(hp) => toggleFilter('hp', hp, mode === 'species' ? String(hp) : `hp${hp}`)}
      onFilters={openFilters}>
      {ambiguousHp ? <Chip mode="button" label={`HP ${ambiguousHp} · trocar para nº`} accessibilityLabel={`${ambiguousHp} vale como HP. Trocar para número da carta`} onPress={() => setText(hpTermToNumber(text, ambiguousHp))} /> : null}
      {noNumberCount ? <Chip mode="button" label={`Sem número · ${formatInt(noNumberCount)}`} selected={filters.number === NO_VALUE} onPress={() => toggleFilter('number', NO_VALUE, null)} /> : null}
    </HpRow>
  ) : null;
  const langRow = showFilterRows ? <LangRow chips={langChips} value={filters.lang} onChange={chooseLang} /> : null;
  const rows: ReactNode = desktop ? (
    <>
      {speciesStrip}
      {langRow}
      {hpRow}
    </>
  ) : typing || low ? (
    (speciesStrip ?? hpRow)
  ) : (
    <>
      {note?.forText === text && note.others.length ? speciesStrip : null}
      {langRow}
      {hpRow}
    </>
  );

  const noteRow =
    note && note.forText === text ? (
      <View style={styles.noteRow}>
        <View style={styles.fillRow}>
          <Notice>{note.text}</Notice>
        </View>
        {note.undo != null ? (
          <Chip
            mode="button"
            label="Desfazer"
            accessibilityLabel="Desfazer o que foi lido"
            onPress={() => {
              setText(note.undo as string);
              setNote(null);
            }}
          />
        ) : null}
      </View>
    ) : null;

  const field = (
    <LookupField
      value={text}
      onChangeText={setText}
      onSubmit={submit}
      onClear={clearField}
      inputRef={inputRef}
      autoFocus={autoFocus}
      onFocusChange={setFocused}
      canScan={isOcrAvailable}
      onPhoto={() => openScan('photo')}
      onPrint={() => openScan('print')}
    />
  );

  const staleNotice = header && pricesDay && isStale(pricesDay) && !low ? (
    <View style={[styles.stale, { width: gridWidth }]}>
      <Notice tone="warning">Preços de {formatDay(pricesDay)}: mais de 3 dias sem atualizar.</Notice>
    </View>
  ) : null;

  const screenOptions = <Stack.Screen options={{ headerShown: desktop, title: pick ? 'Escolher carta' : 'Consulta de cartas' }} />;
  // Na web: quantas cartas há e, no computador, a carta sob o cursor ou a aberta no painel (enquanto vale para a grade).
  const liveText = desktop && say && say.grid === grid.shown ? say.text : countSpeech;
  const live = WEB ? (
    <View style={styles.live} aria-live="polite" accessibilityLiveRegion="polite">
      <Text>{liveText}</Text>
    </View>
  ) : null;
  const filtersPanel =
    filtersOpen && header ? (
      <LookupFiltersPanel
        facets={facets}
        filters={filters}
        cards={base}
        header={header}
        hasActive={panelCount > 0}
        actions={{
          onYear: (y) => toggleFilter('year', y, y === 'none' ? null : String(y)),
          onRarity: (code) => toggleFilter('rarity', code, code === NO_VALUE ? null : code),
          onVariant: (v) => toggleFilter('variant', v, VARIANT_TERM[v] ?? null),
          onSet: chooseSet,
          onType: (t) => toggleFilter('cardType', t, null),
          onStage: (t) => toggleFilter('stage', t, null),
          onClear: clearPanel,
          onClose: closeFilters,
        }}
      />
    ) : null;
  const addSheet = <AddCardSheet card={addBrief} onClose={() => setAddBrief(null)} onAdded={() => setAddBrief(null)} />;

  if (desktop) {
    // Com os filtros abertos, o resto sai do Tab e do leitor de tela (na web, `inert`; no Android, o TalkBack).
    const behindFilters = filtersOpen ? 'no-hide-descendants' : 'auto';
    return (
      <View style={styles.screen}>
        {screenOptions}
        <View style={[styles.controls, styles.controlsDesktop, { width: outerWidth }]} importantForAccessibility={behindFilters} {...inertWhen(filtersOpen)}>
          <View style={styles.desktopField}>
            <View style={styles.fillRow}>{field}</View>
            {pricesDay ? <Text style={styles.dataDay}>Dados {formatDay(pricesDay)}</Text> : null}
          </View>
          {noteRow}
          {rows}
        </View>
        <View style={[styles.desktopBody, { width: outerWidth }]} importantForAccessibility={behindFilters} {...inertWhen(filtersOpen)}>
          <View style={styles.main}>
            {staleNotice}
            {renderMain()}
          </View>
          {bodyProps ? <LookupPanel {...bodyProps} card={selected ?? sole} width={PANEL_WIDTH} empty={<Text style={styles.hint}>Escolha uma carta para ver o preço e os links.</Text>} /> : null}
        </View>
        {live}
        {filtersPanel}
        {addSheet}
      </View>
    );
  }

  // A folha e os filtros são camadas da tela: no Android, o `aria-modal` não fecha o que fica por baixo para o TalkBack;
  // na web, o `inert` tira o que fica atrás do Tab.
  const behindLayer = layerOpen ? 'no-hide-descendants' : 'auto';

  return (
    <View style={styles.screen}>
      {screenOptions}
      <View style={[styles.main, { paddingTop: insets.top }]} importantForAccessibility={behindLayer} {...inertWhen(layerOpen)}>
        {staleNotice}
        {renderMain()}
      </View>
      <View
        style={[styles.bar, { paddingBottom: barBottom, paddingHorizontal: pad }]}
        importantForAccessibility={behindLayer}
        {...inertWhen(layerOpen)}
        onLayout={(e) => setBarHeight(Math.ceil(e.nativeEvent.layout.height))}>
        <View style={[styles.controls, { width: outerWidth }]}>
          {noteRow}
          {rows}
          {field}
        </View>
      </View>
      {live}
      {selected && bodyProps ? <LookupSheet {...bodyProps} card={selected} onClose={closeSheet} /> : null}
      {filtersPanel}
      {addSheet}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1, minHeight: 0, overflow: 'hidden' },
  fillRow: { flex: 1, minWidth: 0 },
  main: { flex: 1, minHeight: 0, minWidth: 0 },
  home: { alignSelf: 'center', gap: space.md, paddingBottom: space.lg },
  single: { alignSelf: 'center', paddingBottom: space.lg },
  gridBox: { flex: 1, minHeight: 0, alignSelf: 'center' },
  titleRow: { height: TITLE_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  back: { marginLeft: -space.md },
  title: { ...typography.title, color: colors.text, flex: 1, minWidth: 0 },
  dataDay: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  hintExamples: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  preparing: { ...typography.bodyStrong, color: colors.text, textAlign: 'center', paddingVertical: space.lg, paddingHorizontal: space.lg },
  actions: { gap: space.sm, alignSelf: 'stretch' },
  stale: { alignSelf: 'center', paddingBottom: space.sm },
  bar: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background, paddingTop: space.sm },
  controls: { gap: space.sm, alignSelf: 'center' },
  controlsDesktop: { paddingVertical: space.md },
  desktopField: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  desktopBody: { flex: 1, minHeight: 0, flexDirection: 'row', alignSelf: 'center', gap: space.xl, paddingBottom: space.lg },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Só para o leitor de tela da web: fora do fluxo, sem ocupar espaço.
  live: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
});
