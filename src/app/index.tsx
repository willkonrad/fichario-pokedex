import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router, Stack, useIsFocused, useLocalSearchParams, useNavigation, type Href } from 'expo-router';
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type TextInputInstance,
  type ViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardDragLayer, useCardDrag } from '@/components/binder-drag';
import { BinderSlot, priceBlockHeight } from '@/components/binder-slot';
import { cardImageUrl, prefetchCardImages } from '@/components/card-image';
import { digitsInSystemFont } from '@/components/digits';
import { DOCK_HEIGHT, HomeDock } from '@/components/home-dock';
import { useHomeEntries } from '@/components/home-entries';
import { useCloseOnBack, useDebounced, useFocusReturn } from '@/components/home-focus';
import { hintSeen, markHint, rememberedPage, rememberPage, usePageMemoryReady } from '@/components/home-page-memory';
import { HomePager, RegionRuler, type RegionChip } from '@/components/home-pager';
import { consultSuggestion, HomeSearchInput, suggestionRoom, suggestionsSpeech, SuggestionList, type Suggestion } from '@/components/home-search';
import { CardPeekSheet, GoToPageSheet, OutsideCardsSheet } from '@/components/home-sheets';
import {
  ConsultaPill,
  HomeValueSummary,
  LiveStatus,
  nextSpeech,
  NoticeSlot,
  type HomeChange,
  type HomeNotice,
  type HomeValue,
} from '@/components/home-summary';
import { HomeTopBar } from '@/components/home-top-bar';
import { NATIVE_DRIVER, useReducedMotion } from '@/components/motion';
import { type PressState } from '@/components/icon-button';
import { Card, CardSkeleton, coverFill, ListRow, PokeballIcon, showToast, useLayout, useToastClearance, type IconName } from '@/components/ui';
import { formatDex, getSpecies, searchSpeciesList } from '@/data/pokedex';
import {
  customPlaceText,
  customSlotsOnPage,
  customTotalSlots,
  dexRange,
  extraOnPage,
  extraSlots,
  fitPocket,
  indexOfDex,
  indexOfEntry,
  indexOfExtra,
  inDexRange,
  isPlaced,
  isPlacedCustom,
  KEYBOARD_MIN,
  pageOfDex,
  pagePocketText,
  pageSize,
  regionsIn,
  slotAt,
  slotsOnPage,
  spineSide,
  spreadOf,
  squeezedByKeyboard,
  totalPages,
  totalSlots,
} from '@/lib/binder';
import { entryImageUrl, plainName } from '@/lib/catalog';
import { changeText, mypBlockedNotice } from '@/lib/copy';
import { formatBRLShort, formatInt, formatWhen } from '@/lib/format';
import { recentChange } from '@/lib/history';
import { mypPtImage } from '@/lib/myp-api';
import { clearMypBlock, mypBlockedUntil, subscribeMypBlock } from '@/lib/myp-queue';
import { collectionTotals } from '@/lib/quotes';
import { TAP } from '@/lib/tap-word';
import { POKEDEX_BINDER, type BinderSettings, type CustomBinder, type Entry } from '@/lib/types';
import { pricePending, valuation } from '@/lib/valuation';
import {
  collectionState,
  customEntryId,
  entriesOf,
  entryId,
  useActiveBinderId,
  useBinders,
  useCollectionActions,
  useCollectionReady,
  useSession,
  useSettings,
  useSyncStatus,
} from '@/store/collection';
import { binderColors as B, CARD_RATIO, colors, radius, semantic, space, TOUCH, typography, widths } from '@/theme';

const WEB = Platform.OS === 'web';
const GAP = 8;
/** Margem interna da folha escura. */
const PAGE_PAD = 10;
/** Borda da folha (entra na largura: sem ela, a última coluna passava 2 px da margem). */
const SHEET_BORDER = 1;
/** Furo de argola, na escala da folha de verdade. */
const HOLE_SIZE = 14;
/** Folga de cada lado do furo: até a beira da folha e até os bolsos. */
const HOLE_INSET = 4;
/** Lado da lombada: o furo e as duas folgas. */
const SPINE_PAD = HOLE_INSET * 2 + HOLE_SIZE;
/** Furos da lombada, em % da altura da folha. */
const HOLES = ['18%', '50%', '82%'] as const;
/** Faixa com a cor da capa na contracapa, do lado da lombada. */
const COVER_STRIP = 14;
const SPREAD_GAP = 14;
/** Painel-resumo do computador, à direita da página. */
const PANEL_WIDTH = 320;
const PANEL_GAP = 24;
/** Duas páginas abertas só quando a coluna da página tem esta largura (janela de ~1280 px). */
const SPREAD_MIN_MAIN = 860;
/** Bolso mínimo legível: abaixo dele a folha não encolhe mais, e só a área dela rola. */
const MIN_SLOT = 56;
/** Bolso máximo no computador: as miniaturas das cartas têm ~245 px; maior que isso, a imagem fica borrada. */
const MAX_SLOT_DESKTOP = 220;
/** Coluna mínima das páginas no computador, para o paginador (setas, página e "Próxima falta") caber numa linha. */
const MIN_MAIN_DESKTOP = 480;
/** Folga para a barra de rolagem clássica do navegador (15 a 17 px), quando a área da folha rola no computador. */
const SCROLLBAR_SPACE = 18;
/** Folga em cima e embaixo da folha, dentro da faixa que recorta o folhear. */
const VIEWPORT_PAD = space.xs;
/** Número embaixo da folha, com duas páginas abertas. */
const PAGE_NUMBER_SPACE = typography.caption.lineHeight + space.xs;
/** Margens do corpo no computador. */
const DESKTOP_TOP = space.md;
const DESKTOP_BOTTOM = space.lg;
/** Margem interna do cartão do painel (a do `Card`). */
const PANEL_PAD = space.lg;
/** Lista de regiões do painel: com menos altura que 2 linhas, o painel inteiro rola (último recurso, janela muito baixa). */
const MIN_PANEL_LIST = (TOUCH + space.xs) * 2;
/** Só até a primeira medida: o que fica acima da folha (resumo e régua; paginador e margens). */
const ABOVE_SHEET_GUESS = { phone: 136, desktop: 90 };
/** Barra do topo sem a área segura (HomeTopBar: linha de 56, 64 no computador, e o fio de 3), até a primeira medida. */
const BAR_HEIGHT = { phone: 59, desktop: 67 };
/** Espera para ler quantas sugestões abriram (depois que a pessoa para de digitar). */
const SPEECH_DELAY_MS = 600;
/** Capa sem a lista: margens, Poké Ball, título em até 2 linhas, rótulo, "Lista completa" e os vãos. */
const COVER_CHROME = space.xl * 2 + 36 + typography.heading.lineHeight * 2 + typography.label.lineHeight + space.sm * 5 + TOUCH;

/** O que o fichário põe em cada bolso de uma página. */
type PageItem = {
  key: string;
  /** Posição corrida do bolso (Pokédex: índice do espaço; livre: nº do bolso a partir de 0). */
  index: number;
  entry?: Entry;
  dex?: number;
  pocket?: number;
  free?: boolean;
  highlighted: boolean;
  href: Href;
};

type Missing = { key: string; label: string; onPress: () => void };

/** Endereço da carta salva (tela da carta). */
function cardHref(e: Entry): Href {
  return { pathname: '/card', params: e.binderId ? { binder: e.binderId, slot: e.slot } : { dex: e.dex, slot: e.slot } };
}

/**
 * Onde a carta está: "Fichário Pokédex · pág. 2, bolso 5", "GENGAR · pág. 2, bolso 5 · nº 25" (fichário livre: com o
 * nº corrido do bolso) ou "fora do fichário". "Bolso" é o da página, como na tela da carta e na busca na coleção.
 */
function whereIs(e: Entry, settings: BinderSettings | null, binders: CustomBinder[]) {
  if (e.binderId) {
    const b = binders.find((x) => x.id === e.binderId);
    if (!b) return 'fichário apagado';
    if (!isPlacedCustom(b, e)) return `${b.name} · fora do fichário`;
    return `${b.name} · ${customPlaceText(b, e.slot)}`;
  }
  const name = settings?.name || 'Fichário Pokédex';
  if (!settings || !isPlaced(settings, e)) return `${name} · fora do fichário`;
  return `${name} · ${pagePocketText(settings, indexOfEntry(settings, e))}`;
}

/** "#021 Spearow" (só o número, se o Pokémon não estiver na lista). */
const dexName = (dex: number) => [formatDex(dex), getSpecies(dex)?.name].filter(Boolean).join(' ');

/** Comparação da busca sem acento, apóstrofo nem pontuação (japonês: o texto como está). */
function matcher(q: string) {
  const key = plainName(q);
  const raw = q.trim().toLocaleLowerCase('pt-BR');
  const text = (s?: string) => !!s && (key ? plainName(s).includes(key) : s.toLocaleLowerCase('pt-BR').includes(raw));
  return (e: Entry) => text(e.cardName) || text(e.setName) || (!!e.localId && e.localId.toLowerCase() === raw);
}

/** Sugestão da busca ao vivo que leva o texto para a busca na coleção inteira (E2), em todos os fichários. */
function findEverywhere(q: string): Suggestion {
  return {
    key: 'find',
    section: 'Coleção inteira',
    title: 'Procurar em toda a coleção',
    detail: `“${q}” em todos os fichários`,
    icon: 'search-outline',
    onSelect: () => router.push({ pathname: '/find', params: { q } }),
  };
}

/** Valores da home para o resumo: valor, fontes e quantas cartas esperam ou não têm preço. */
function homeValue(list: Entry[]): HomeValue {
  const totals = collectionTotals(list);
  let pending = 0;
  let unpriced = 0;
  for (const e of list) {
    if (pricePending(e)) pending++;
    else if (valuation(e).value == null) unpriced++;
  }
  return { value: totals.value, valued: totals.valued, byBasis: totals.byBasis, pending, unpriced };
}

// ---------- Página lembrada e página na URL (H5, W5) ----------

/** A página da URL (recarregar, favorito, link) vale só na primeira abertura do fichário dela. */
let urlPageUsed = false;

/** Quanto tempo o bolso pedido pelo "Ver no fichário" fica destacado (~2 s à vista, mais o fechar da tela da carta). */
const ASKED_MS = 2400;

/** `bolso`: o bolso dentro da página (1, 2…), mandado pelo "Ver no fichário" da tela da carta; a home não o escreve. */
type UrlParams = { fichario?: string; pagina?: string; bolso?: string };

/**
 * Pedido do "Ver no fichário" ('' = nenhum). Só o `bolso` marca o pedido: a home nunca o grava, e os parâmetros que
 * ela grava ao folhear podem chegar atrasados (não podem puxar a página de volta).
 */
function requestKey(params: UrlParams) {
  return params.bolso != null && params.fichario ? `${params.fichario}|${params.pagina ?? ''}|${params.bolso}` : '';
}

function initialPage(binderKey: string, params: UrlParams) {
  const fromUrl = Number(params.pagina);
  if (!urlPageUsed && params.fichario === binderKey && Number.isInteger(fromUrl) && fromUrl >= 1) return fromUrl - 1;
  return rememberedPage(binderKey) ?? 0;
}

/**
 * Página aberta do fichário: começa na lembrada (ou na da URL), fica gravada neste aparelho e, na web, na URL
 * (?fichario=…&pagina=12), sem encher o histórico do navegador. Quando chega um pedido do "Ver no fichário" (com a
 * home já montada ou não), vai até a página e destaca o bolso pedido (`asked`, índice corrido) por ~2 s, ou até a
 * próxima troca de página.
 */
function useBinderPage(binderKey: string, pages: number, size: number) {
  const params = useLocalSearchParams<UrlParams>();
  const [page, setPageState] = useState(() => initialPage(binderKey, params));
  const [asked, setAsked] = useState<number | null>(null);
  const current = Math.max(0, Math.min(page, pages - 1));
  const navigation = useNavigation();
  const focused = useIsFocused();

  // Pedido novo nos parâmetros (o `bolso` sai da URL logo depois de lido, então o mesmo pedido pode voltar). Ajuste no
  // desenho, sem efeito.
  const request = requestKey(params);
  const [seen, setSeen] = useState('');
  if (request !== seen) {
    setSeen(request);
    const want = Number(params.pagina);
    if (request && params.fichario === binderKey && Number.isInteger(want) && want >= 1 && want <= pages) {
      const pocket = Number(params.bolso);
      setPageState(want - 1);
      setAsked(Number.isInteger(pocket) && pocket >= 1 && pocket <= size ? (want - 1) * size + pocket - 1 : null);
    }
  }

  // Ao voltar para a home com outra página nos parâmetros e sem `bolso` (só na volta: enquanto a home está na frente,
  // os parâmetros são os que ela mesma grava).
  const [wasFocused, setWasFocused] = useState(focused);
  if (focused !== wasFocused) {
    setWasFocused(focused);
    const want = Number(params.pagina);
    if (focused && !request && params.fichario === binderKey && Number.isInteger(want) && want >= 1 && want <= pages && want - 1 !== current) {
      setPageState(want - 1);
      setAsked(null);
    }
  }

  // O destaque do pedido sai sozinho (estado da tela: nada vai para o histórico). Conta só com a home na frente.
  useEffect(() => {
    if (asked == null || !focused) return;
    const timer = setTimeout(() => setAsked(null), ASKED_MS);
    return () => clearTimeout(timer);
  }, [asked, focused]);

  useEffect(() => {
    urlPageUsed = true;
    rememberPage(binderKey, current);
    if (!focused) return;
    const pagina = String(current + 1);
    // Parâmetros desta tela (e não da que estiver na frente); o `bolso` pedido sai depois de lido.
    if (params.fichario !== binderKey || params.pagina !== pagina || params.bolso != null) {
      (navigation as unknown as { setParams: (p: UrlParams) => void }).setParams({ fichario: binderKey, pagina, bolso: undefined });
    }
  }, [binderKey, current, focused, navigation, params.fichario, params.pagina, params.bolso]);

  const setPage = (p: number) => {
    setAsked(null);
    setPageState(p);
  };
  return [current, setPage, asked] as const;
}

// ---------- Tela ----------

export default function BinderScreen() {
  // Seletores (D2): a tela só desenha de novo quando muda o que ela usa (não a cada preço gravado).
  const ready = useCollectionReady();
  const settings = useSettings();
  const binders = useBinders();
  const activeBinderId = useActiveBinderId();
  const { setActiveBinder } = useCollectionActions();
  const memoryReady = usePageMemoryReady();
  const params = useLocalSearchParams<UrlParams>();
  // Fichário pedido pela URL ao abrir o app ou por um "Ver no fichário" (null = já tratado): troca o fichário aberto.
  const [urlBinder, setUrlBinder] = useState<string | null | undefined>(() => params.fichario);
  // O "Ver no fichário" já troca o fichário antes de voltar; se não trocou (ou não deu), a home troca aqui.
  const request = requestKey(params);
  const [seenRequest, setSeenRequest] = useState(request);
  if (request !== seenRequest) {
    setSeenRequest(request);
    if (request) setUrlBinder(params.fichario);
  }
  const urlValid = !!urlBinder && (urlBinder === POKEDEX_BINDER || binders.some((b) => b.id === urlBinder));
  const switching = ready && urlValid && urlBinder !== activeBinderId;

  useEffect(() => {
    if (!ready || urlBinder === null) return;
    let alive = true;
    (async () => {
      if (switching && urlBinder) await setActiveBinder(urlBinder).catch(() => {});
      if (alive) setUrlBinder(null);
    })();
    return () => {
      alive = false;
    };
  }, [ready, urlBinder, switching, setActiveBinder]);

  if (!ready || !memoryReady || switching) return <HomeSkeleton />;
  if (!settings) return <Redirect href="/setup" />;

  const custom = binders.find((b) => b.id === activeBinderId);
  // `key`: cada fichário monta com a própria página.
  return custom ? <CustomBinderView key={custom.id} binder={custom} /> : <PokedexBinderView key={POKEDEX_BINDER} settings={settings} />;
}

/** Enquanto a coleção carrega: a barra e uma folha em esqueleto (H1), no lugar de uma tela vazia. */
function HomeSkeleton() {
  const L = useLayout();
  const insets = useSafeAreaInsets();
  const w = Math.min(L.width - L.gutter * 2, widths.reading);
  const slot = Math.min(140, Math.floor((w - PAGE_PAD - SPINE_PAD - GAP * 2) / 3));
  return (
    <View style={styles.root} aria-busy accessibilityLabel="Carregando o fichário">
      <View style={[styles.skeletonBar, { height: insets.top + (L.isDesktop ? BAR_HEIGHT.desktop : BAR_HEIGHT.phone) }]} />
      <View style={[styles.sheet, styles.skeletonSheet]}>
        {[0, 1, 2].map((r) => (
          <View key={r} style={[styles.row, { gap: GAP }]}>
            {[0, 1, 2].map((c) => (
              <CardSkeleton key={c} width={slot} tone="dark" />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------- Fichário Pokédex ----------

function PokedexBinderView({ settings }: { settings: BinderSettings }) {
  const entries = useHomeEntries();
  const binders = useBinders();
  const pages = totalPages(settings);
  const size = pageSize(settings);
  const [page, setPage, asked] = useBinderPage(POKEDEX_BINDER, pages, size);
  const [query, setQuery] = useState('');
  // Espaços destacados pela busca (índices corridos): ficam enquanto houver texto na busca (F6).
  const [found, setFound] = useState<Set<number> | null>(null);
  // Espaço destacado por "Próxima falta" (o próximo toque segue dele).
  const [emptyAt, setEmptyAt] = useState<number | null>(null);
  const [cycleAt, setCycleAt] = useState(-1);
  const [notice, setNotice] = useState<HomeNotice | null>(null);
  // Resultado sem aviso na tela (a página pode nem mudar), só para o leitor de tela.
  const [status, setStatus] = useState('');
  const say = (text: string) => setStatus((cur) => nextSpeech(cur, text));
  const range = dexRange(settings);
  const name = settings.name || 'Fichário Pokédex';

  const list = useMemo(() => entriesOf(entries, POKEDEX_BINDER), [entries]);
  const outside = useMemo(() => list.filter((e) => !isPlaced(settings, e)), [list, settings]);
  const ownedDex = useMemo(() => new Set(list.filter((e) => e.dex > 0 && isPlaced(settings, e)).map((e) => e.dex)), [list, settings]);
  const species = ownedDex.size;
  const q = query.trim();
  const shownFound = q ? found : null;

  function goTo(p: number) {
    setPage(p);
    setEmptyAt(null);
  }

  /**
   * Destaca o próximo espaço vazio: começa na primeira página aberta (a da esquerda, com duas abertas) e, a cada toque,
   * segue do destacado, enquanto ele estiver à vista (folhear ou "Ver no fichário" recomeça na página aberta).
   */
  function nextEmpty(shownPages: number[]) {
    const total = totalSlots(settings);
    const start = emptyAt != null && shownPages.includes(Math.floor(emptyAt / size)) ? emptyAt + 1 : shownPages[0] * size;
    for (let step = 0; step < total; step++) {
      const i = (start + step) % total;
      const ref = slotAt(settings, i);
      if (ref && !entries[entryId(ref.dex, ref.slot)]) {
        setPage(Math.floor(i / size));
        setEmptyAt(i);
        setNotice(null);
        say(`Próxima falta: ${dexName(ref.dex)}, ${pagePocketText(settings, i)}, destacado`);
        return;
      }
    }
    setNotice({ text: 'Fichário completo! Todos os espaços têm carta.', tone: 'success' });
  }

  /** Vai até o Pokémon e destaca os espaços dele. `quiet`: quem chamou já mostra um aviso (não lê duas vezes). */
  function selectSpecies(dex: number, quiet = false) {
    const s = getSpecies(dex);
    if (!inDexRange(settings, dex)) {
      setNotice({ text: `${s?.name ?? formatDex(dex)} não está na faixa deste fichário (${formatDex(range.from)}–${formatDex(range.to)}).`, tone: 'warning' });
      return;
    }
    const base = indexOfDex(settings, dex, 0);
    setFound(new Set(Array.from({ length: settings.slotsPerPokemon }, (_, k) => base + k)));
    setEmptyAt(null);
    setPage(pageOfDex(settings, dex));
    setNotice(null);
    if (!quiet) say(`${dexName(dex)}, ${pagePocketText(settings, base)}, destacado`);
  }

  const targets = useMemo(() => (q ? searchSpeciesList(q, 6).filter((s) => inDexRange(settings, s.id)) : []), [q, settings]);

  /** Vai ao Pokémon `i` da lista; o "Próximo" do aviso leva ao seguinte (o índice vai junto, não fica preso ao desenho). */
  function goToTarget(i: number) {
    const t = targets[i];
    if (!t) return;
    setCycleAt(i);
    selectSpecies(t.id, targets.length > 1);
    if (targets.length > 1) {
      setNotice({ text: `${i + 1} de ${targets.length}: ${t.name}`, action: { label: 'Próximo', onPress: () => goToTarget((i + 1) % targets.length) } });
    }
  }

  /** Enter de novo (lista fechada): o próximo Pokémon que combina ("char" → Charmander → Charmeleon → Charizard). */
  function cycle() {
    if (!targets.length) {
      setNotice({ text: q ? 'Nenhum Pokémon desta faixa com esse nome ou número.' : 'Digite um nome ou número.', tone: 'info' });
      return;
    }
    goToTarget((cycleAt + 1) % targets.length);
  }

  // Sugestões da busca (o React Compiler guarda o resultado entre os desenhos).
  const suggestions = ((): Suggestion[] => {
    if (!q) return [];
    const out: Suggestion[] = [];
    const byDex = new Map<number, Entry[]>();
    for (const e of list) if (e.dex > 0 && isPlaced(settings, e)) byDex.set(e.dex, [...(byDex.get(e.dex) ?? []), e]);
    const speciesHits = searchSpeciesList(q, 6);
    speciesHits.forEach((s) => {
      const inRange = inDexRange(settings, s.id);
      const mine = byDex.get(s.id) ?? [];
      const value = mine.reduce((sum, e) => sum + (valuation(e).value ?? 0), 0);
      const where = `pág. ${pageOfDex(settings, s.id) + 1}`;
      const detail = !inRange
        ? `fora da faixa (${formatDex(range.from)}–${formatDex(range.to)})`
        : mine.length
          ? [`tenho${settings.slotsPerPokemon > 1 ? ` ${mine.length}/${settings.slotsPerPokemon}` : ''}`, value ? formatBRLShort(value) : '', where].filter(Boolean).join(' · ')
          : `falta · ${where}`;
      out.push({
        key: `p${s.id}`,
        section: 'Pokémon',
        title: `${formatDex(s.id)} ${s.name}`,
        detail,
        dex: s.id,
        onSelect: () => {
          const i = targets.findIndex((t) => t.id === s.id);
          setCycleAt(i);
          selectSpecies(s.id);
        },
      });
    });
    // Cartas de bolsos livres deste fichário e cartas dos outros fichários com esse nome (E2 na home).
    const match = matcher(q);
    for (const e of list) {
      if (e.dex !== 0 || !isPlaced(settings, e) || !match(e) || out.length >= 9) continue;
      const i = indexOfExtra(settings, e.slot);
      out.push({
        key: e.id,
        section: 'Neste fichário',
        title: e.cardName,
        detail: `${e.setName} · bolso livre, pág. ${Math.floor(i / size) + 1}`,
        entry: e,
        onSelect: () => {
          setFound(new Set([i]));
          setEmptyAt(null);
          setPage(Math.floor(i / size));
          say(`${e.cardName}, bolso livre, ${pagePocketText(settings, i)}, destacada`);
        },
      });
    }
    Object.values(entries)
      .filter((e) => e.binderId && binders.some((b) => b.id === e.binderId) && match(e))
      .slice(0, 3)
      .forEach((e) => {
        out.push({ key: e.id, section: 'Outros fichários', title: e.cardName, detail: whereIs(e, settings, binders), entry: e, onSelect: () => router.push(cardHref(e)) });
      });
    out.push(findEverywhere(q));
    out.push(consultSuggestion(q));
    const top = speciesHits[0];
    out.push({
      key: 'add',
      section: 'Adicionar',
      title: top ? `Adicionar carta de ${top.name}` : `Adicionar “${q}”`,
      icon: 'add-circle-outline',
      onSelect: () => router.push({ pathname: '/search', params: { mode: 'add', q: top?.name ?? q } }),
    });
    return out;
  })();

  const regions = useMemo(() => {
    const all = regionsIn(settings);
    return all.length > 1 ? all : undefined;
  }, [settings]);
  // Régua das regiões, marcada pela primeira página aberta (a da esquerda, com duas abertas).
  const regionChips = regions
    ? (firstShown: number): RegionChip[] => {
        const firstDexShown = slotsOnPage(settings, firstShown)[0]?.dex ?? range.from;
        return regions.map((r) => {
          let filled = 0;
          for (const d of ownedDex) if (d >= r.from && d <= r.to) filled++;
          return {
            id: r.id,
            label: r.label,
            filled,
            count: r.count,
            active: firstDexShown >= r.from && firstDexShown <= r.to,
            onPress: () => goTo(pageOfDex(settings, r.from)),
          };
        });
      }
    : undefined;

  const highlightedAt = (i: number) => (shownFound?.has(i) ?? false) || emptyAt === i || asked === i;

  const itemsFor = (p: number): PageItem[] => [
    ...slotsOnPage(settings, p).map((s) => {
      const entry = entries[entryId(s.dex, s.slot)];
      const params = { dex: s.dex, slot: s.slot };
      return {
        key: String(s.index),
        index: s.index,
        entry,
        dex: s.dex,
        highlighted: highlightedAt(s.index),
        href: entry ? ({ pathname: '/card', params } as Href) : ({ pathname: '/pokemon/[dex]', params } as Href),
      };
    }),
    // Bolsos que sobram na última página: livres para cartas especiais (qualquer carta).
    ...extraOnPage(settings, p).map((k) => {
      const entry = entries[entryId(0, k)];
      const index = indexOfExtra(settings, k);
      return {
        key: `extra-${k}`,
        index,
        entry,
        free: true,
        highlighted: highlightedAt(index),
        href: entry ? ({ pathname: '/card', params: { dex: 0, slot: k } } as Href) : ({ pathname: '/search', params: { extra: k } } as Href),
      };
    }),
  ];

  /**
   * Os próximos Pokémon que faltam, a partir da página (para a contracapa no computador). Com 2+ espaços por Pokémon,
   * quem já tem carta num deles não falta (como no título "Faltam N Pokémon" e na lista "Preciso").
   */
  const missingFrom = (p: number): Missing[] => {
    const out: Missing[] = [];
    const total = totalSlots(settings);
    for (let i = p * size; i < total && out.length < 8; i++) {
      const ref = slotAt(settings, i);
      if (!ref || ownedDex.has(ref.dex) || entries[entryId(ref.dex, ref.slot)] || out.some((m) => m.key === String(ref.dex))) continue;
      const idx = i;
      out.push({
        key: String(ref.dex),
        label: `${formatDex(ref.dex)} ${getSpecies(ref.dex)?.name ?? ''}`,
        onPress: () => {
          setPage(Math.floor(idx / size));
          setEmptyAt(idx);
        },
      });
    }
    return out;
  };

  const left = range.count - species;
  return (
    <BinderFrame
      binderKey={POKEDEX_BINDER}
      title={name}
      coverColor={settings.color ?? colors.primary}
      counter={{ value: species, total: range.count, unit: 'Pokémon' }}
      entries={list}
      outside={outside}
      outsideReason={(e) => {
        if (e.dex === 0) {
          const extra = extraSlots(settings);
          return `bolso livre ${e.slot + 1} (${extra ? `a última página tem ${extra}` : 'a última página não tem bolsos livres'})`;
        }
        if (!inDexRange(settings, e.dex)) return `${formatDex(e.dex)} fora da faixa (${formatDex(range.from)}–${formatDex(range.to)})`;
        return `espaço ${e.slot + 1} de ${formatDex(e.dex)} (o fichário tem ${settings.slotsPerPokemon} por Pokémon)`;
      }}
      showPrices
      page={page}
      pages={pages}
      onPage={goTo}
      rows={settings.rows}
      cols={settings.cols}
      doubleSided={settings.doubleSided}
      rangeFor={(p) => {
        const slots = slotsOnPage(settings, p);
        const first = slots[0]?.dex;
        const last = slots[slots.length - 1]?.dex;
        return first && last ? `${formatDex(first)}–${formatDex(last)}` : 'bolsos livres';
      }}
      firstLabelFor={(p) => {
        const d = slotsOnPage(settings, p)[0]?.dex;
        return d ? formatDex(d) : 'livres';
      }}
      itemsFor={itemsFor}
      regionsAt={regionChips}
      nextEmptyLabel="Próxima falta"
      onNextEmpty={nextEmpty}
      missingTitle={left > 0 ? `Faltam ${formatInt(left)} Pokémon` : 'Pokédex completa!'}
      missingFrom={missingFrom}
      onMissingList={left > 0 ? () => router.push('/lists') : undefined}
      emptyHint={list.length === 0 ? `${TAP} num espaço ou em “+ Carta” para colocar a primeira carta.` : undefined}
      notice={notice}
      status={status}
      onDismissNotice={() => setNotice(null)}
      query={query}
      onQuery={(text) => {
        setQuery(text);
        setFound(null);
        setCycleAt(-1);
        setNotice(null);
      }}
      suggestions={suggestions}
      onCycle={cycle}
      placeholder="Pokémon, carta ou nº"
      onEdit={() => router.push('/setup')}
      positionOf={(e) => whereIs(e, settings, binders)}
      hasOtherBinders={binders.length > 0}
    />
  );
}

// ---------- Fichário livre ----------

function CustomBinderView({ binder }: { binder: CustomBinder }) {
  const entries = useHomeEntries();
  const settings = useSettings();
  const binders = useBinders();
  const { moveEntryTo, restoreEntry, removeEntry } = useCollectionActions();
  const size = pageSize(binder);
  const [page, setPage, asked] = useBinderPage(binder.id, binder.pages, size);
  const [query, setQuery] = useState('');
  // Posição na lista de cartas achadas (Enter de novo vai para a próxima: "2 de 5").
  const [hitAt, setHitAt] = useState(-1);
  // Bolso pedido pelo número (destacado mesmo vazio) e o destacado por "Próximo vazio".
  const [pocketAt, setPocketAt] = useState<number | null>(null);
  const [emptyAt, setEmptyAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<HomeNotice | null>(null);
  // Resultado sem aviso na tela (a página pode nem mudar), só para o leitor de tela.
  const [status, setStatus] = useState('');
  const say = (text: string) => setStatus((cur) => nextSpeech(cur, text));
  const total = customTotalSlots(binder);
  const q = query.trim();

  const list = useMemo(() => entriesOf(entries, binder.id), [entries, binder.id]);
  const outside = useMemo(() => list.filter((e) => !isPlacedCustom(binder, e)), [list, binder]);
  const filled = list.length - outside.length;
  const hits = useMemo(() => {
    if (!q) return [];
    const match = matcher(q);
    return list.filter((e) => isPlacedCustom(binder, e) && match(e)).sort((a, b) => a.slot - b.slot);
  }, [q, list, binder]);
  // Destaque ao vivo: as cartas que combinam com o texto, enquanto ele estiver na busca (F6).
  const hitSlots = useMemo(() => new Set(hits.map((e) => e.slot)), [hits]);
  const pocketQuery = /^\d+$/.test(q) && Number(q) >= 1 && Number(q) <= total ? Number(q) - 1 : null;

  function goTo(p: number) {
    setPage(p);
    setEmptyAt(null);
  }

  function goToHit(i: number) {
    const e = hits[i];
    if (!e) return;
    setHitAt(i);
    setPocketAt(null);
    setEmptyAt(null);
    setPage(Math.floor(e.slot / size));
    setNotice(
      hits.length > 1
        ? { text: `${i + 1} de ${hits.length}: ${e.cardName}, ${customPlaceText(binder, e.slot)}`, action: { label: 'Próxima', onPress: () => goToHit((i + 1) % hits.length) } }
        : null,
    );
    if (hits.length === 1) say(`${e.cardName}, ${customPlaceText(binder, e.slot)}, destacada`);
  }

  /** Vai até o bolso pelo número, com carta ou vazio (F6). */
  function goToPocket(slot: number) {
    setPocketAt(slot);
    setEmptyAt(null);
    setPage(Math.floor(slot / size));
    setNotice(null);
    const e = entries[customEntryId(binder.id, slot)];
    say(`Bolso nº ${slot + 1}, ${pagePocketText(binder, slot)}, ${e ? e.cardName : 'vazio'}, destacado`);
  }

  /** Destaca o próximo bolso vazio: começa na primeira página aberta e segue do destacado enquanto ele estiver à vista. */
  function nextEmpty(shownPages: number[]) {
    const start = emptyAt != null && shownPages.includes(Math.floor(emptyAt / size)) ? emptyAt + 1 : shownPages[0] * size;
    for (let step = 0; step < total; step++) {
      const i = (start + step) % total;
      if (!entries[customEntryId(binder.id, i)]) {
        setPage(Math.floor(i / size));
        setEmptyAt(i);
        setNotice(null);
        say(`Próximo vazio: ${customPlaceText(binder, i)}, destacado`);
        return;
      }
    }
    setNotice({ text: 'Fichário cheio! Aumente as páginas em ⚙ para ganhar bolsos.', tone: 'success' });
  }

  /**
   * Carta solta em outro bolso: vai para lá e, se houver carta nele, as duas trocam de lugar. O "Desfazer" recoloca cada
   * uma como estava, como no "Mover" da tela da carta.
   */
  function moveCard(card: Entry, slot: number) {
    // Do store, e não do desenho: o desenho da home pode estar até 1 s atrás no preço, e o "Desfazer" regravaria o antigo.
    const live = collectionState().entries;
    const before = live[card.id] ?? card;
    const movedId = customEntryId(binder.id, slot);
    const occupant = live[movedId];
    const name = card.cardName || 'Carta';
    const failed = (fallback: string) => (e: unknown) => {
      showToast({ message: e instanceof Error ? e.message : fallback, tone: 'error' });
    };
    return moveEntryTo(card.id, { binderId: binder.id, slot }).then(() => {
      showToast({
        message: occupant ? `${name} e ${occupant.cardName || 'outra carta'} trocaram de lugar` : `${name} foi para ${binder.name} · ${pagePocketText(binder, slot)}`,
        actionLabel: 'Desfazer',
        onAction: () => {
          restoreEntry(before)
            .then(() => (occupant ? restoreEntry(occupant) : removeEntry(movedId)))
            .catch(failed('Não consegui desfazer.'));
        },
        duration: 8000,
      });
    }, failed('Não consegui mover a carta.'));
  }

  function cycle() {
    if (pocketQuery != null && !hits.length) return goToPocket(pocketQuery);
    if (hits.length) return goToHit((hitAt + 1) % hits.length);
    setNotice({ text: q ? 'Nenhuma carta deste fichário com esse nome, coleção ou bolso.' : 'Digite o nome, a coleção ou o nº do bolso.', tone: 'info' });
  }

  const suggestions = ((): Suggestion[] => {
    if (!q) return [];
    const out: Suggestion[] = [];
    if (pocketQuery != null) {
      const e = entries[customEntryId(binder.id, pocketQuery)];
      // O número digitado é o nº corrido do bolso; o detalhe diz a página e o bolso dentro dela.
      out.push({
        key: 'pocket',
        section: 'Nº do bolso',
        title: `Bolso nº ${pocketQuery + 1}`,
        detail: `${e ? e.cardName : 'vazio'} · ${pagePocketText(binder, pocketQuery)}`,
        icon: 'locate-outline',
        onSelect: () => goToPocket(pocketQuery),
      });
    }
    hits.slice(0, 5).forEach((e, i) => {
      out.push({
        key: e.id,
        section: hits.length > 5 ? `Neste fichário (${hits.length})` : 'Neste fichário',
        title: e.cardName,
        detail: `${e.setName} · ${customPlaceText(binder, e.slot)}`,
        entry: e,
        onSelect: () => goToHit(i),
      });
    });
    const match = matcher(q);
    Object.values(entries)
      .filter((e) => e.binderId !== binder.id && (!e.binderId || binders.some((b) => b.id === e.binderId)) && match(e))
      .slice(0, 3)
      .forEach((e) => {
        out.push({ key: e.id, section: 'Outros fichários', title: e.cardName, detail: whereIs(e, settings, binders), entry: e, onSelect: () => router.push(cardHref(e)) });
      });
    out.push(findEverywhere(q));
    out.push(consultSuggestion(q));
    out.push({
      key: 'add',
      section: 'Adicionar',
      title: `Adicionar “${q}”`,
      icon: 'add-circle-outline',
      onSelect: () => router.push({ pathname: '/search', params: { mode: 'add', q } }),
    });
    return out;
  })();

  const itemsFor = (p: number): PageItem[] =>
    customSlotsOnPage(binder, p).map((slot) => {
      const entry = entries[customEntryId(binder.id, slot)];
      const params = { binder: binder.id, slot };
      return {
        key: String(slot),
        index: slot,
        entry,
        pocket: binder.showPocketNumbers || pocketAt === slot ? slot + 1 : undefined,
        highlighted: hitSlots.has(slot) || pocketAt === slot || emptyAt === slot || asked === slot,
        href: entry ? ({ pathname: '/card', params } as Href) : ({ pathname: '/search', params } as Href),
      };
    });

  const empty = total - filled;
  return (
    <BinderFrame
      binderKey={binder.id}
      title={binder.name}
      coverColor={binder.color}
      counter={{ value: filled, total, unit: 'bolsos' }}
      entries={list}
      outside={outside}
      outsideReason={(e) => `bolso nº ${e.slot + 1} (o fichário tem ${total} bolsos)`}
      showPrices={binder.showPrices}
      page={page}
      pages={binder.pages}
      onPage={goTo}
      rows={binder.rows}
      cols={binder.cols}
      doubleSided={binder.doubleSided}
      rangeFor={(p) => {
        const slots = customSlotsOnPage(binder, p);
        return `nº ${slots[0] + 1}–${slots[slots.length - 1] + 1}`;
      }}
      firstLabelFor={(p) => `nº ${p * size + 1}`}
      itemsFor={itemsFor}
      nextEmptyLabel="Próximo vazio"
      onNextEmpty={nextEmpty}
      missingTitle={empty > 0 ? `${formatInt(empty)} ${empty === 1 ? 'bolso vazio' : 'bolsos vazios'}` : 'Fichário cheio!'}
      emptyHint={filled === 0 ? `${TAP} num bolso ou em “+ Carta” para colocar a primeira carta. Em ⚙ você muda capa, tamanho e páginas.` : undefined}
      notice={notice}
      status={status}
      onDismissNotice={() => setNotice(null)}
      query={query}
      onQuery={(text) => {
        setQuery(text);
        setHitAt(-1);
        setPocketAt(null);
        setNotice(null);
      }}
      suggestions={suggestions}
      onCycle={cycle}
      placeholder="Carta, coleção ou nº do bolso"
      onEdit={() => router.push({ pathname: '/binder-edit', params: { id: binder.id } })}
      positionOf={(e) => whereIs(e, settings, binders)}
      hasOtherBinders
      onMoveCard={moveCard}
    />
  );
}

// ---------- Moldura comum ----------

type FrameProps = {
  /** Id do fichário ("pokedex" ou o do fichário livre): página lembrada e URL. */
  binderKey: string;
  title: string;
  coverColor: string;
  counter: { value: number; total: number; unit: string };
  /** Todas as cartas do fichário (as de fora também contam no valor). */
  entries: Entry[];
  /** Cartas sem bolso na configuração atual (F2). */
  outside: Entry[];
  outsideReason: (e: Entry) => string;
  showPrices: boolean;
  page: number;
  pages: number;
  onPage: (p: number) => void;
  rows: number;
  cols: number;
  /** Frente e verso: no computador largo, duas páginas abertas, como o fichário de verdade. */
  doubleSided: boolean;
  /** Faixa da página ("#001–#020", "nº 1–20"). */
  rangeFor: (page: number) => string;
  /** Rótulo curto da página na grade "Ir para a página". */
  firstLabelFor?: (page: number) => string | undefined;
  itemsFor: (page: number) => PageItem[];
  /** Régua das regiões, marcada pela primeira página aberta. */
  regionsAt?: (firstShown: number) => RegionChip[];
  nextEmptyLabel: string;
  /** "Próxima falta"/"Próximo vazio", com as páginas abertas (a busca começa na primeira delas). */
  onNextEmpty: (shownPages: number[]) => void;
  /** "Faltam 977 Pokémon" / "180 bolsos vazios" (contracapa). */
  missingTitle: string;
  missingFrom?: (page: number) => Missing[];
  /** A lista "Preciso" inteira (E1), a partir da contracapa. */
  onMissingList?: () => void;
  emptyHint?: string;
  notice: HomeNotice | null;
  /** Resultado só para o leitor de tela ("Próxima falta: #021 Spearow, pág. 3, bolso 3, destacado"). */
  status: string;
  onDismissNotice: () => void;
  query: string;
  onQuery: (q: string) => void;
  suggestions: Suggestion[];
  /** Enter com a lista fechada: o próximo resultado. */
  onCycle: () => void;
  placeholder: string;
  onEdit: () => void;
  /** Onde a carta está (folha de espiar). */
  positionOf: (e: Entry) => string;
  /** Há outros fichários: a variação é da coleção, não só deste. */
  hasOtherBinders: boolean;
  /** Fichário livre: a carta foi solta em outro bolso (`slot`). Sem isto, as cartas não se arrastam. */
  onMoveCard?: (card: Entry, slot: number) => Promise<void>;
};

/** Variação dos últimos 7 dias (com conta e histórico de 2 dias ou mais), para o resumo (V5). */
function useRecentChange(enabled: boolean, scope: string): HomeChange | null {
  const session = useSession();
  const uid = session?.user.id;
  const [change, setChange] = useState<{ uid: string; value: HomeChange | null } | null>(null);
  useEffect(() => {
    if (!enabled || !uid) return;
    let alive = true;
    recentChange(7)
      .then((c) => {
        if (!alive) return;
        // Menos de 50 centavos: não mostra (é ruído de arredondamento).
        const value: HomeChange | null =
          c && c.same > 0 && Math.abs(c.diff) >= 0.5 ? { text: `${changeText(c)}${scope}`, direction: c.diff > 0 ? 'up' : 'down' } : null;
        setChange({ uid, value });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, uid, scope]);
  return enabled && change && change.uid === uid ? change.value : null;
}

/** Ícone redondo dos atalhos do painel (o mesmo das linhas da "Minha coleção"). */
function ShortcutIcon({ icon }: { icon: IconName }) {
  return (
    <View style={styles.shortcutIcon} aria-hidden>
      <Ionicons name={icon} size={18} color={colors.text} />
    </View>
  );
}

/** Altura do teclado na tela (celular), para a lista de sugestões não ficar embaixo dele. Na web, 0. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (WEB) return;
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/** Aviso da sincronização (S10/S11): sem internet, preços pausados; erro, com o que espera envio. */
function useSyncNotice(): HomeNotice | null {
  const status = useSyncStatus();
  const pending = status.pending > 0 ? ` · ${status.pending} ${status.pending === 1 ? 'mudança' : 'mudanças'} para enviar` : '';
  if (status.state === 'offline') {
    return { text: `Sem internet: preços pausados${pending}. Tudo fica salvo neste aparelho.`, tone: 'warning', icon: 'cloud-offline-outline' };
  }
  if (status.state === 'error') {
    return {
      text: `${status.message ?? 'Não consegui sincronizar.'}${status.pending > 0 ? ` Salvo neste aparelho; envio pendente (${status.pending}).` : ''}`,
      tone: 'danger',
    };
  }
  return null;
}

/**
 * Aviso da recusa do MYP (403): as consultas dele ficam paradas por 24 h (myp-queue.ts), e a pessoa sabe por quê.
 * "Tentar de novo" libera a próxima consulta; outra recusa para tudo de novo.
 */
function useMypBlockNotice(): HomeNotice | null {
  const until = useSyncExternalStore(subscribeMypBlock, mypBlockedUntil, () => 0);
  if (!until) return null;
  return {
    text: mypBlockedNotice(formatWhen(new Date(until).toISOString())),
    tone: 'warning',
    icon: 'pricetag-outline',
    action: { label: 'Tentar de novo', onPress: clearMypBlock },
  };
}

function BinderFrame(p: FrameProps) {
  const L = useLayout();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const desktop = L.isDesktop;
  // A medida da barra já inclui a área segura de cima.
  const [barHeight, setBarHeight] = useState(() => insets.top + (desktop ? BAR_HEIGHT.desktop : BAR_HEIGHT.phone));
  const [searchOpen, setSearchOpen] = useState(false);
  // Altura da linha do campo de busca do celular (a lista de sugestões abre logo abaixo dela).
  const [searchRowHeight, setSearchRowHeight] = useState(TOUCH + space.xs + space.sm);
  // Área da folha, medida na tela (null até a primeira medida).
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  // Área e janela de quando a busca abriu no celular (null com ela fechada).
  const [held, setHeld] = useState<{ width: number; height: number; window: number } | null>(null);
  // Altura do que fica acima da lista de regiões, no painel do computador.
  const [panelTop, setPanelTop] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searchFrame, setSearchFrame] = useState<{ x: number; y: number; width: number } | null>(null);
  const [goToOpen, setGoToOpen] = useState(false);
  const [outsideOpen, setOutsideOpen] = useState(false);
  const [peek, setPeek] = useState<Entry | undefined>();
  const [showHint, setShowHint] = useState(() => !(WEB && desktop) && hintSeen('swipe') < 3);
  const canDrag = !!p.onMoveCard;
  // Dica à parte da de folhear: quem já folheou ainda não conhece o arraste.
  const [showDragHint, setShowDragHint] = useState(() => canDrag && !(WEB && desktop) && hintSeen('drag') < 3);
  const inputRef = useRef<TextInputInstance>(null);
  const searchBox = useRef<ViewInstance>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncNotice = useSyncNotice();
  const mypNotice = useMypBlockNotice();
  const keyboard = useKeyboardHeight();
  const change = useRecentChange(p.showPrices, p.hasOtherBinders ? ' na coleção' : '');
  const value = useMemo(() => homeValue(p.entries), [p.entries]);

  // ----- Medidas: a folha cabe na largura e na altura da área dela, em qualquer janela -----
  // No computador não há teto de largura: o bolso cresce até a página caber na altura da janela, e o fichário (páginas
  // + painel) fica centralizado. Com o teto de 1.440 px, numa tela grande sobravam as laterais e metade da altura.
  const avail = Math.max(0, L.width - L.gutter * 2);
  const mainAvail = desktop ? avail - PANEL_WIDTH - PANEL_GAP : Math.min(avail, widths.reading);
  const spread = p.doubleSided && desktop && mainAvail >= SPREAD_MIN_MAIN && p.pages > 1;
  const pageWidth = spread ? Math.floor((mainAvail - SPREAD_GAP) / 2) : mainAvail;
  // A área é medida na tela: barra, resumo, créditos, avisos, régua, dica e base já saíram dela.
  const room = stage ?? {
    width: 0,
    height: Math.max(0, L.height - barHeight - insets.bottom - (desktop ? ABOVE_SHEET_GUESS.desktop : ABOVE_SHEET_GUESS.phone + DOCK_HEIGHT)),
  };
  const typing = !desktop && searchOpen;
  // Sem o resumo no fluxo (fichário sem preços), a linha da busca reserva o espaço dela, em vez de cobrir a folha (+1: o fio).
  const searchReserve = typing && !p.showPrices ? Math.max(0, searchRowHeight + 1 - space.md) : 0;
  // Busca aberta no celular: enquanto o teclado encolher a área, a folha fica com a altura de antes e não pula. Mudou a
  // largura (girou o aparelho) ou encolheu por outro motivo (aviso, dica), vale a medida nova.
  if (typing !== !!held) setHeld(typing ? { ...room, height: room.height - searchReserve, window: L.height } : null);
  const holding = held && held.width === room.width && squeezedByKeyboard(held.height, room.height, keyboard) ? held : null;
  const stageHeight = holding ? holding.height : room.height;
  const keyboardOpen = keyboard > 0 || (WEB && !!holding && holding.window - L.height > KEYBOARD_MIN);
  const fit = fitPocket({
    width: pageWidth - PAGE_PAD - SPINE_PAD - SHEET_BORDER * 2,
    height: stageHeight - (VIEWPORT_PAD + PAGE_PAD + SHEET_BORDER) * 2 - (spread ? PAGE_NUMBER_SPACE : 0),
    rows: p.rows,
    cols: p.cols,
    gap: GAP,
    ratio: CARD_RATIO,
    priceHeight: (w) => (p.showPrices ? priceBlockHeight(w, L.fontScale) : 0),
    min: MIN_SLOT,
    max: desktop ? MAX_SLOT_DESKTOP : undefined,
  });
  const slot = fit.width;
  const sheetWidth = slot * p.cols + GAP * (p.cols - 1) + PAGE_PAD + SPINE_PAD + SHEET_BORDER * 2;
  const sheetHeight = fit.height + (PAGE_PAD + SHEET_BORDER) * 2;
  // Painel do computador: tem a altura da janela e, dentro dele, só a lista de regiões rola.
  const panelRoom = Math.max(0, L.height - barHeight - insets.bottom - DESKTOP_TOP - DESKTOP_BOTTOM - PANEL_PAD * 2);
  const belowTop = panelRoom - panelTop - PANEL_PAD;
  // A legenda do teclado sai antes de a lista de regiões ficar sem altura.
  const keysSpace = typography.caption.lineHeight + PANEL_PAD;
  const showKeys = WEB && belowTop - keysSpace >= (p.regionsAt ? MIN_PANEL_LIST : 0);
  const listRoom = belowTop - (showKeys ? keysSpace : 0);
  const panelShort = listRoom < MIN_PANEL_LIST;
  // Largura em uso: no computador, só o que as páginas ocupam (com um mínimo para o paginador, e com a barra de rolagem
  // quando a área rola, senão ela cortaria as bordas da folha), mais o painel; no celular e no tablet, a coluna inteira.
  const scrollbar = WEB && desktop && fit.overflow ? SCROLLBAR_SPACE : 0;
  const main = desktop ? Math.min(mainAvail, Math.max((spread ? sheetWidth * 2 + SPREAD_GAP : sheetWidth) + scrollbar, MIN_MAIN_DESKTOP)) : mainAvail;
  const outer = desktop ? main + PANEL_WIDTH + PANEL_GAP : main;

  const shown = spread ? spreadOf(p.page, p.pages) : [p.page];
  const first = shown[0];
  const last = shown[shown.length - 1];
  const canPrev = first > 0;
  const canNext = last < p.pages - 1;
  const pageLabel = shown.length > 1 ? `Págs. ${first + 1}–${last + 1}` : `Pág. ${first + 1}`;
  const shownItems = shown.flatMap(p.itemsFor);
  const shownFilled = shownItems.filter((it) => it.entry).length;
  const pagerDetail = [
    shown.map(p.rangeFor).filter(Boolean).join(' · '),
    shownItems.length ? (shownFilled === shownItems.length ? 'completa ✓' : `${shownFilled}/${shownItems.length}`) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const regions = p.regionsAt?.(first);
  const nextEmpty = () => p.onNextEmpty(shown);
  const progress = p.counter.value / Math.max(1, p.counter.total);
  const subtitle = `${formatInt(p.counter.value)} de ${formatInt(p.counter.total)} ${p.counter.unit}`;
  const sheetOpen = goToOpen || outsideOpen || !!peek;

  // ----- Folhear: a página acompanha o dedo e assenta (AR2); botões e teclado fazem um deslize curto -----
  const [dragX] = useState(() => new Animated.Value(0));
  const slideIn = (dir: 1 | -1, distance: number) => {
    if (reduceMotion) return dragX.setValue(0);
    dragX.setValue(dir * distance);
    Animated.timing(dragX, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER }).start();
  };
  const turnTo = (target: number) => {
    if (target < 0 || target >= p.pages || shown.includes(target)) return;
    p.onPage(target);
    slideIn(target > first ? 1 : -1, 28);
  };
  const goPrev = () => canPrev && turnTo(first - 1);
  const goNext = () => canNext && turnTo(last + 1);

  // Só muda quando a página muda (depois do gesto) ou a janela muda de tamanho: o gesto em andamento não se perde.
  const onPage = p.onPage;
  const pan = useMemo(() => {
    // A página volta ao lugar (gesto curto ou interrompido); com "reduzir movimento", sem a mola.
    const settle = () => {
      if (reduceMotion) dragX.setValue(0);
      else Animated.spring(dragX, { toValue: 0, bounciness: 4, useNativeDriver: NATIVE_DRIVER }).start();
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        // Sem página para aquele lado: resiste (mostra que é o fim).
        const blocked = (g.dx < 0 && !canNext) || (g.dx > 0 && !canPrev);
        dragX.setValue(blocked ? g.dx * 0.2 : g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        const dir: 1 | -1 = g.dx < 0 ? 1 : -1;
        const can = dir === 1 ? canNext : canPrev;
        const target = dir === 1 ? last + 1 : first - 1;
        if (!can || (Math.abs(g.dx) < main * 0.25 && Math.abs(g.vx) < 0.5)) {
          settle();
          return;
        }
        // Quem já folheou não precisa mais da dica.
        if (showHint) {
          markHint('swipe', true);
          setShowHint(false);
        }
        if (reduceMotion) {
          dragX.setValue(0);
          onPage(target);
          return;
        }
        Animated.timing(dragX, { toValue: -dir * main, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: NATIVE_DRIVER }).start(() => {
          onPage(target);
          dragX.setValue(dir * main * 0.3);
          Animated.timing(dragX, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER }).start();
        });
      },
      onPanResponderTerminate: settle,
    });
  }, [canNext, canPrev, first, last, main, reduceMotion, showHint, onPage, dragX]);
  // No computador com mouse, folhear é pelos botões e pelo teclado (arrastar um link abriria o "arrastar" do navegador).
  const panHandlers = WEB && desktop ? null : pan.panHandlers;

  useEffect(() => {
    if (showHint) markHint('swipe');
  }, [showHint]);

  useEffect(() => {
    if (showDragHint) markHint('drag');
  }, [showDragHint]);

  // ----- Arrastar as cartas (só fichário livre): segurar levanta, soltar troca de lugar -----
  const onMoveCard = p.onMoveCard;
  const contentHeight = sheetHeight + VIEWPORT_PAD * 2 + (spread ? PAGE_NUMBER_SPACE : 0);
  const { drag, lifted } = useCardDrag(
    onMoveCard
      ? {
          gap: GAP,
          sheetPad: SPINE_PAD,
          maxScroll: fit.overflow ? Math.max(0, contentHeight - stageHeight) : 0,
          canFlip: (dir) => (dir === 1 ? canNext : canPrev),
          onFlip: (dir) => p.onPage(dir === 1 ? last + 1 : first - 1),
          onDrop: (card, target) => {
            // Quem já arrastou não precisa mais da dica.
            if (showDragHint) {
              markHint('drag', true);
              setShowDragHint(false);
            }
            return onMoveCard(card, target);
          },
          onPeek: setPeek,
          reduceMotion,
        }
      : null,
    // Com a área: um aviso que entra no meio do arraste muda o lugar e o tamanho dos bolsos.
    `${first}:${slot}:${stageHeight}`,
  );

  // ----- Pré-carga das miniaturas das páginas vizinhas (H1) -----
  const prefetch = useEffectEvent(() => {
    const near = spread ? [first - 2, first - 1, last + 1, last + 2] : [first - 1, last + 1];
    const urls = near
      .filter((n) => n >= 0 && n < p.pages)
      .flatMap((n) => p.itemsFor(n))
      .map((it) => it.entry)
      .filter((e): e is Entry => !!e)
      .map((e) => cardImageUrl({ image: e.image, imageUrl: entryImageUrl(e), photo: e.stampPhoto, ptImage: mypPtImage(e) }));
    prefetchCardImages(urls);
  });
  useEffect(() => {
    prefetch();
  }, [first, last, spread]);

  // ----- O iOS não lê regiões "ao vivo": a página nova é anunciada à parte (A7) -----
  const announced = useRef(first);
  useEffect(() => {
    if (announced.current === first) return;
    announced.current = first;
    if (Platform.OS === 'ios' && focused) AccessibilityInfo.announceForAccessibility(`${pageLabel} de ${p.pages}`);
  }, [first, focused, pageLabel, p.pages]);

  // ----- Busca (H6) -----
  // Posição do campo na janela (computador), para a lista abrir logo abaixo dele. O onLayout da web só avisa quando o
  // tamanho muda: ao redimensionar a janela o campo anda sem mudar de largura, então mede de novo aqui e no foco.
  const measureSearch = () => searchBox.current?.measureInWindow((x, y, width, height) => setSearchFrame({ x, y: y + height, width }));
  useEffect(() => {
    if (!desktop) return;
    searchBox.current?.measureInWindow((x, y, width, height) => setSearchFrame({ x, y: y + height, width }));
  }, [desktop, L.width, L.height]);
  const showList = listOpen && p.suggestions.length > 0 && (desktop || searchOpen);
  // A lista abre logo abaixo do campo, na barra (computador) ou na linha que abre embaixo dela (celular).
  const listTop = desktop && searchFrame ? searchFrame.y + space.xs : barHeight + searchRowHeight;
  const activeIndex = Math.min(active, p.suggestions.length - 1);
  const select = (s: Suggestion) => {
    setListOpen(false);
    if (!WEB) Keyboard.dismiss();
    s.onSelect();
  };
  const search = (
    <HomeSearchInput
      inputRef={inputRef}
      value={p.query}
      onChangeText={(t) => {
        p.onQuery(t);
        setListOpen(!!t.trim());
        setActive(0);
      }}
      placeholder={p.placeholder}
      onSubmit={() => (showList && p.suggestions[activeIndex] ? select(p.suggestions[activeIndex]) : p.onCycle())}
      onMove={(d) => {
        if (!showList) {
          setListOpen(!!p.query.trim());
          setActive(0);
          return;
        }
        setActive((i) => (i + d + p.suggestions.length) % p.suggestions.length);
      }}
      onEscape={() => {
        if (showList) return setListOpen(false);
        p.onQuery('');
        if (!desktop) setSearchOpen(false);
      }}
      onFocus={() => {
        clearTimeout(blurTimer.current);
        if (desktop) measureSearch();
        if (p.query.trim()) setListOpen(true);
      }}
      // A lista fecha um pouco depois de sair do campo, para o toque numa sugestão chegar antes.
      onBlur={() => {
        blurTimer.current = setTimeout(() => setListOpen(false), 200);
      }}
      expanded={showList}
      activeIndex={activeIndex}
      autoFocus={!desktop}
    />
  );
  const openSearch = () => {
    if (desktop) inputRef.current?.focus();
    else setSearchOpen(true);
  };
  // Fecha a busca do celular: o X da barra e o voltar do Android.
  const closeSearch = () => {
    p.onQuery('');
    setListOpen(false);
    setSearchOpen(false);
  };
  // A camada da busca não é um Modal (sem onRequestClose): o voltar do Android fecha a busca, e não o app.
  useCloseOnBack(typing && focused, closeSearch);
  // No celular, quantas sugestões abriram, lido quando a pessoa para de digitar (na web, o combobox já diz).
  const listSpeech = useDebounced(!WEB && showList ? suggestionsSpeech(p.suggestions.length, p.query.trim()) : '', SPEECH_DELAY_MS);

  // ----- Teclado no computador (W3): ← → folheiam, Home/End, "/" busca, F próxima falta, Esc limpa -----
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (sheetOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') goPrev();
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') goNext();
    else if (e.key === 'Home') turnTo(0);
    else if (e.key === 'End') turnTo(p.pages - 1);
    else if (e.key === '/') openSearch();
    else if (e.key === 'f' || e.key === 'F') nextEmpty();
    else if (e.key === 'Escape' && (p.query || p.notice)) {
      p.onQuery('');
      p.onDismissNotice();
    } else return;
    e.preventDefault();
  });
  useEffect(() => {
    if (!WEB || !focused) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focused]);

  // Na web, o foco volta ao controle que abriu a outra tela (o bolso, por exemplo) quando a home volta à frente.
  useFocusReturn(focused);

  const onAdd = () => router.push({ pathname: '/search', params: { mode: 'add' } });
  const onOpenCollection = () => router.push('/menu');
  const onConsulta = () => router.push('/consulta');

  // ----- Partes -----
  const renderPage = (pg: number) => {
    const items = p.itemsFor(pg);
    const rows = Array.from({ length: Math.ceil(items.length / p.cols) }, (_, r) => items.slice(r * p.cols, (r + 1) * p.cols));
    // O lado vem da página (frente ou verso); com duas abertas, a posição na tela já concorda com ele.
    const spineLeft = spineSide(p.doubleSided, pg) === 'left';
    return (
      <View key={pg} style={{ width: sheetWidth }}>
        <View style={[styles.sheet, spineLeft ? styles.spineLeft : styles.spineRight]}>
          {HOLES.map((top) => (
            <View key={top} style={[styles.hole, { top }, spineLeft ? styles.holeLeft : styles.holeRight]} aria-hidden />
          ))}
          <View style={{ gap: GAP }}>
            {rows.map((row, r) => (
              <View key={r} style={[styles.row, { gap: GAP }]}>
                {row.map((it) => (
                  <BinderSlot
                    key={it.key}
                    dex={it.dex}
                    pocket={it.pocket}
                    free={it.free}
                    width={slot}
                    entry={it.entry}
                    highlighted={it.highlighted}
                    showPrices={p.showPrices}
                    href={it.href}
                    onPress={() => router.push(it.href)}
                    onLongPress={it.entry ? () => setPeek(it.entry) : undefined}
                    drag={canDrag ? drag : undefined}
                    dragSlot={it.index}
                    lifted={lifted?.slot === it.index}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
        {spread ? <Text style={styles.pageNumber}>{pg + 1}</Text> : null}
      </View>
    );
  };

  /**
   * Verso da capa (ao lado da pág. 1) ou contracapa (ao lado da última): o que falta, para ir direto (W1). As duas
   * listam desde o início (ao lado da última página, "a partir dela" só repetiria o que já está à vista).
   */
  const cover = (side: 'front' | 'back') => {
    // Só os que cabem: a capa não pode ficar mais alta que a folha ao lado (não há rolagem para mostrar o resto).
    const missing = (p.missingFrom?.(0) ?? []).slice(0, Math.max(0, Math.floor((sheetHeight - COVER_CHROME) / (TOUCH + space.xxs))));
    // O verso da capa fica à esquerda da pág. 1 (lombada à direita dele); a contracapa, à direita da última.
    const front = side === 'front';
    return (
      <View key={side} style={{ width: sheetWidth }}>
        <View style={[styles.cover, front ? styles.coverFront : styles.coverBack]}>
          <View style={[styles.coverStrip, front ? styles.coverStripFront : styles.coverStripBack, { backgroundColor: coverFill(p.coverColor) }]} aria-hidden />
          <PokeballIcon size={36} color={colors.iconFaint} />
          <Text style={styles.coverTitle}>{digitsInSystemFont(p.missingTitle)}</Text>
          {missing.length ? <Text style={styles.coverLabel}>Os primeiros que faltam</Text> : null}
          <View style={styles.coverList}>
            {missing.map((m) => (
              <Pressable
                key={m.key}
                onPress={m.onPress}
                role="button"
                accessibilityLabel={`${m.label}, ir para o espaço`}
                style={(s) => {
                  const { pressed, hovered } = s as PressState;
                  return [styles.coverItem, hovered && { backgroundColor: semantic.hover.onLight }, pressed && { opacity: 0.7 }];
                }}>
                <Text style={styles.coverItemText} numberOfLines={1}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {p.onMissingList ? (
            <Pressable
              onPress={p.onMissingList}
              role="button"
              accessibilityLabel="Ver a lista completa do que falta"
              style={(s) => {
                const { pressed, hovered } = s as PressState;
                return [styles.coverItem, styles.coverLink, hovered && { backgroundColor: semantic.hover.onLight }, pressed && { opacity: 0.7 }];
              }}>
              <Text style={styles.coverLinkText}>Lista completa</Text>
              <Ionicons name="chevron-forward" size={16} color={B.text} />
            </Pressable>
          ) : null}
        </View>
        {/* A altura do número da página: a contracapa termina junto com a folha ao lado. */}
        <Text style={styles.pageNumber} aria-hidden>
          {' '}
        </Text>
      </View>
    );
  };

  const pagesView = (
    <View style={styles.viewport} ref={canDrag ? drag.setViewport : undefined}>
      <Animated.View style={[styles.spread, { gap: SPREAD_GAP, transform: [{ translateX: dragX }] }]} {...(panHandlers ?? {})}>
        {spread && first === 0 ? cover('front') : null}
        {shown.map((pg) => renderPage(pg))}
        {spread && shown.length === 1 && first > 0 ? cover('back') : null}
      </Animated.View>
    </View>
  );

  // Na web, a tela coberta por outra (display: none) mede 0: a medida zerada não vale, senão a folha volta minúscula.
  const onStageLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setStage({ width: Math.round(width), height: Math.floor(height) });
  };
  const onPanelTopLayout = (e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (height > 0) setPanelTop(Math.ceil(height));
  };
  const onBarHeight = (height: number) => {
    if (height > 0) setBarHeight(height);
  };

  // Área da folha: rola por dentro só no fichário denso demais, em que nem o bolso mínimo cabe.
  const stageView = (
    <View ref={canDrag ? drag.setStage : undefined} style={[styles.stage, { width: main }]} onLayout={onStageLayout}>
      <ScrollView
        ref={canDrag ? drag.setScroller : undefined}
        onScroll={canDrag && fit.overflow ? drag.onScroll : undefined}
        scrollEventThrottle={16}
        // Com a carta na mão, a folha não rola com o dedo. Na web quem barra a roda é o `setViewport`: tirar a rolagem sumiria com a barra (a folha andaria).
        scrollEnabled={fit.overflow && (WEB || !lifted)}
        showsVerticalScrollIndicator={fit.overflow}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={desktop ? undefined : styles.stageCentered}>
        {pagesView}
      </ScrollView>
    </View>
  );

  const pager = (
    <View style={styles.pagerBlock}>
      <HomePager
        label={pageLabel}
        pages={p.pages}
        detail={pagerDetail}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={goPrev}
        onNext={goNext}
        onGoTo={() => setGoToOpen(true)}
        onNextEmpty={nextEmpty}
        nextEmptyLabel={p.nextEmptyLabel}
      />
    </View>
  );

  const notices = (
    <>
      {/* Com a busca aberta no celular, o aviso dela fica embaixo do campo, por cima da tela. */}
      {typing ? null : <NoticeSlot notice={p.notice} />}
      <NoticeSlot notice={syncNotice} />
      <NoticeSlot notice={mypNotice} />
      <NoticeSlot
        notice={
          p.outside.length
            ? {
                text: `${p.outside.length} ${p.outside.length === 1 ? 'carta fora do fichário' : 'cartas fora do fichário'} nesta configuração`,
                action: { label: 'Ver', onPress: () => setOutsideOpen(true) },
              }
            : null
        }
      />
      {p.emptyHint ? <Text style={styles.hint}>{p.emptyHint}</Text> : null}
    </>
  );

  const summary = p.showPrices ? (
    <HomeValueSummary
      data={value}
      change={change}
      layout={desktop ? 'panel' : 'row'}
      onOpenCollection={onOpenCollection}
      trailing={desktop ? undefined : <ConsultaPill onPress={onConsulta} />}
      // Com a busca aberta no celular, a linha do valor fica embaixo do campo: sai do Tab e do leitor de tela.
      covered={typing}
    />
  ) : null;

  const panel = desktop ? (
    <View style={{ width: PANEL_WIDTH }}>
      <Card>
        {/* Só a lista de regiões rola; numa janela baixa demais para ela, o painel inteiro. */}
        <ScrollView
          style={[styles.panelScroll, { maxHeight: panelRoom }]}
          scrollEnabled={panelShort}
          showsVerticalScrollIndicator={panelShort}
          contentContainerStyle={styles.panel}>
          <View style={styles.panel} onLayout={onPanelTopLayout}>
            <View style={styles.panelHead}>
              <Text style={styles.panelTitle} numberOfLines={2} role="heading">
                {digitsInSystemFont(p.title)}
              </Text>
              <Text style={styles.panelCounter}>{subtitle}</Text>
              <View style={styles.panelTrack} aria-hidden>
                <View style={[styles.panelFill, { width: `${Math.max(1.5, Math.min(100, progress * 100))}%` }]} />
              </View>
            </View>
            {summary}
            {notices}
            {/* Telas da coleção inteira (E1, E2, Relatórios); no celular, ficam na "Minha coleção" e na busca ao vivo. */}
            <View>
              <ListRow
                title="Buscar na coleção"
                subtitle="Tenho essa carta? Onde ela está?"
                left={<ShortcutIcon icon="search-outline" />}
                right={<Ionicons name="chevron-forward" size={18} color={colors.iconFaint} />}
                onPress={() => router.push('/find')}
                accessibilityLabel="Buscar na coleção: tenho essa carta? Onde ela está?"
              />
              <ListRow
                title="Listas"
                subtitle="Preciso e tenho repetida"
                left={<ShortcutIcon icon="list-outline" />}
                right={<Ionicons name="chevron-forward" size={18} color={colors.iconFaint} />}
                onPress={() => router.push('/lists')}
                accessibilityLabel="Listas: preciso e tenho repetida"
              />
              <ListRow
                title="Relatórios"
                subtitle="Últimas cartas, trocas e destaques"
                left={<ShortcutIcon icon="stats-chart-outline" />}
                right={<Ionicons name="chevron-forward" size={18} color={colors.iconFaint} />}
                onPress={() => router.push('/reports')}
                accessibilityLabel="Relatórios: últimas cartas, trocas e destaques"
              />
            </View>
          </View>
          {regions ? <RegionRuler regions={regions} vertical maxHeight={panelShort ? undefined : listRoom} /> : null}
          {showKeys ? <Text style={styles.keys}>← → folheiam · / busca · F {p.nextEmptyLabel.toLowerCase()}</Text> : null}
        </ScrollView>
      </Card>
    </View>
  ) : null;

  // No celular, os avisos (toast) ficam acima da base fixa enquanto o fichário está na tela.
  useToastClearance(!desktop && focused && !keyboardOpen ? insets.bottom + DOCK_HEIGHT : 0);

  // Olha o fichário, e não a página: a altura da dica não pode mudar no meio do folhear (o bolso mudaria junto).
  const hintLine = [showHint && p.pages > 1 ? 'Arraste a página para o lado para folhear.' : '', showDragHint && p.entries.length > 0 ? 'Segure uma carta para mudar de lugar.' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <View style={styles.root} ref={canDrag ? drag.setRoot : undefined} {...(canDrag ? drag.rootProps : null)}>
      {/* Título da aba na web: "GENGAR · pág. 2 · Fichário Pokédex". */}
      <Stack.Screen options={{ title: `${p.title} · ${shown.length > 1 ? `págs. ${first + 1}–${last + 1}` : `pág. ${first + 1}`}` }} />

      <HomeTopBar
        title={p.title}
        subtitle={subtitle}
        progress={progress}
        desktop={desktop}
        gutter={L.gutter}
        contentWidth={desktop ? Math.max(outer, Math.min(avail, widths.wide)) : undefined}
        search={
          desktop ? (
            // A lista de sugestões fica por cima da página, alinhada com o campo (posição medida na janela).
            <View ref={searchBox} onLayout={measureSearch}>
              {search}
            </View>
          ) : null
        }
        searchOpen={searchOpen}
        onToggleSearch={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        onMenu={() => router.push('/menu')}
        onSwitch={() => router.push('/binders')}
        onEdit={p.onEdit}
        onAdd={onAdd}
        onFind={() => router.push('/find')}
        onConsulta={onConsulta}
        onHeight={onBarHeight}
      />

      {/*
        Busca do celular: abre por cima do resumo, abaixo da barra. Com resumo, nada embaixo dela muda de lugar ou de
        tamanho. Logo depois da barra, para o campo e as sugestões virem em seguida no Tab e no leitor de tela.
      */}
      {typing ? (
        <View style={[styles.searchLayer, { top: barHeight, paddingHorizontal: L.gutter }]}>
          <View style={styles.searchRow} onLayout={(e) => setSearchRowHeight(Math.ceil(e.nativeEvent.layout.height))}>
            {search}
          </View>
          <NoticeSlot notice={p.notice} />
        </View>
      ) : null}

      {showList ? (
        <SuggestionList
          items={p.suggestions}
          active={activeIndex}
          onHover={setActive}
          maxHeight={suggestionRoom({ windowHeight: L.height, top: listTop, keyboard, bottomInset: insets.bottom })}
          style={[
            styles.suggestions,
            desktop && searchFrame ? { top: listTop, left: searchFrame.x, width: searchFrame.width } : { top: listTop, left: L.gutter, right: L.gutter },
          ]}
        />
      ) : null}
      <LiveStatus text={listSpeech} />
      <LiveStatus text={p.status} />

      {/* A página não rola: o que rola é só a lista de regiões do painel, a régua do celular e, se preciso, a folha. */}
      {desktop ? (
        <View style={[styles.desktopBody, { width: outer, paddingBottom: DESKTOP_BOTTOM + insets.bottom }]}>
          <View style={[styles.desktopMain, { width: main }]}>
            {pager}
            {stageView}
          </View>
          {panel}
        </View>
      ) : (
        <View style={[styles.phoneBody, { paddingBottom: DOCK_HEIGHT + insets.bottom }]}>
          <View style={[styles.block, styles.summary, { width: outer, paddingTop: space.md + searchReserve }]}>
            {summary}
            {notices}
          </View>
          {regions ? (
            <View style={[styles.block, { width: outer }]}>
              <RegionRuler regions={regions} />
            </View>
          ) : null}
          {stageView}
          {hintLine ? <Text style={[styles.block, styles.swipeHint, { width: outer }]}>{hintLine}</Text> : null}
        </View>
      )}

      {/* A base fica fora do fluxo e o espaço dela continua reservado: sumir com o teclado não mexe na folha. */}
      {desktop || keyboardOpen ? null : (
        <HomeDock
          label={pageLabel}
          pages={p.pages}
          detail={pagerDetail}
          canPrev={canPrev}
          canNext={canNext}
          onPrev={goPrev}
          onNext={goNext}
          onGoTo={() => setGoToOpen(true)}
          onNextEmpty={nextEmpty}
          nextEmptyLabel={p.nextEmptyLabel}
          onAdd={onAdd}
          bottomInset={insets.bottom}
        />
      )}

      <GoToPageSheet
        visible={goToOpen}
        onClose={() => setGoToOpen(false)}
        pages={p.pages}
        current={shown}
        fillOf={(pg) => {
          const items = p.itemsFor(pg);
          return items.length ? items.filter((it) => it.entry).length / items.length : 0;
        }}
        labelOf={p.firstLabelFor}
        onGo={(pg) => {
          setGoToOpen(false);
          turnTo(pg);
        }}
      />
      <OutsideCardsSheet
        visible={outsideOpen}
        onClose={() => setOutsideOpen(false)}
        entries={p.outside}
        reasonOf={p.outsideReason}
        onOpen={(e) => {
          setOutsideOpen(false);
          router.push(cardHref(e));
        }}
        onEdit={() => {
          setOutsideOpen(false);
          p.onEdit();
        }}
      />
      <CardPeekSheet
        entry={peek}
        position={peek ? p.positionOf(peek) : undefined}
        onClose={() => setPeek(undefined)}
        onOpen={() => {
          const e = peek;
          setPeek(undefined);
          if (e) router.push(cardHref(e));
        }}
      />

      {canDrag ? <CardDragLayer drag={drag} lifted={lifted} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: colors.background },
  block: { alignSelf: 'center' },
  summary: { gap: space.sm },
  phoneBody: { flex: 1, minHeight: 0 },
  // Área da folha: ocupa a altura que sobra (a medida dela é a conta do bolso).
  stage: { flex: 1, minHeight: 0, alignSelf: 'center' },
  stageCentered: { flexGrow: 1, justifyContent: 'center' },
  pagerBlock: { paddingBottom: space.sm },
  desktopBody: { flex: 1, minHeight: 0, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-start', gap: PANEL_GAP, paddingTop: DESKTOP_TOP },
  desktopMain: { alignSelf: 'stretch' },
  // A linha do campo cobre só o valor, não os créditos que ficam logo abaixo dele.
  searchLayer: { position: 'absolute', left: 0, right: 0, zIndex: 9, backgroundColor: semantic.shell.bg, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchRow: { paddingTop: space.xs, paddingBottom: space.sm },
  viewport: { overflow: 'hidden', paddingVertical: VIEWPORT_PAD },
  spread: { flexDirection: 'row', justifyContent: 'center' },
  sheet: {
    backgroundColor: B.page,
    borderRadius: radius.md,
    paddingVertical: PAGE_PAD,
    borderWidth: SHEET_BORDER,
    borderColor: B.pageBorder,
  },
  // Mesma altura e fio vermelho da barra do topo, para ela não "piscar" ao terminar de carregar.
  skeletonBar: { backgroundColor: semantic.shell.bg, borderBottomWidth: 3, borderBottomColor: semantic.shell.rule },
  skeletonSheet: { alignSelf: 'center', marginTop: space.xl, paddingLeft: SPINE_PAD, paddingRight: PAGE_PAD, gap: GAP },
  spineLeft: { paddingLeft: SPINE_PAD, paddingRight: PAGE_PAD },
  spineRight: { paddingLeft: PAGE_PAD, paddingRight: SPINE_PAD },
  // Furos dos anéis na lombada da folha.
  hole: {
    position: 'absolute',
    width: HOLE_SIZE,
    height: HOLE_SIZE,
    marginTop: -HOLE_SIZE / 2,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: B.pocketBorder,
  },
  holeLeft: { left: HOLE_INSET },
  holeRight: { right: HOLE_INSET },
  row: { flexDirection: 'row' },
  pageNumber: { ...typography.caption, ...typography.tabular, color: colors.textFaint, fontWeight: '700', textAlign: 'center', marginTop: space.xs },
  // Uma folha como as outras: a cor da capa fica só na faixa do lado da lombada.
  cover: {
    flex: 1,
    backgroundColor: B.page,
    borderRadius: radius.md,
    borderWidth: SHEET_BORDER,
    borderColor: B.pageBorder,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.xl,
  },
  coverFront: { paddingRight: space.xl + COVER_STRIP },
  coverBack: { paddingLeft: space.xl + COVER_STRIP },
  coverStrip: { position: 'absolute', top: 0, bottom: 0, width: COVER_STRIP },
  coverStripFront: { right: 0 },
  coverStripBack: { left: 0 },
  coverTitle: { ...typography.heading, color: colors.heading, textAlign: 'center' },
  coverLabel: { ...typography.label, color: B.textMuted, marginTop: space.sm },
  coverList: { alignSelf: 'stretch', gap: 2 },
  coverItem: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.sm },
  coverItemText: { ...typography.bodyStrong, ...typography.tabular, color: B.text, textAlign: 'center' },
  coverLink: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  coverLinkText: { ...typography.bodyStrong, color: B.text, textDecorationLine: 'underline' },
  shortcutIcon: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: space.sm },
  swipeHint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: space.xxs },
  panel: { gap: PANEL_PAD },
  panelScroll: { flexGrow: 0 },
  panelHead: { gap: space.xs },
  panelTitle: { ...typography.heading, color: colors.heading },
  panelCounter: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  panelTrack: { height: 6, borderRadius: 3, backgroundColor: semantic.progress.track, overflow: 'hidden', marginTop: space.xs },
  panelFill: { height: 6, borderRadius: 3, backgroundColor: semantic.progress.fill },
  keys: { ...typography.caption, color: colors.textMuted },
  suggestions: { position: 'absolute', zIndex: 10, maxWidth: 520 },
});
