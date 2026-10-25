import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router, Stack, useIsFocused, useLocalSearchParams, useNavigation, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
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
  type TextInputInstance,
  type ViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BinderSlot, priceBlockHeight } from '@/components/binder-slot';
import { cardImageUrl, prefetchCardImages } from '@/components/card-image';
import { hintSeen, markHint, rememberedPage, rememberPage, usePageMemoryReady } from '@/components/home-page-memory';
import { HomePager, RegionRuler, type RegionChip } from '@/components/home-pager';
import { HomeSearchInput, SuggestionList, type Suggestion } from '@/components/home-search';
import { CardPeekSheet, GoToPageSheet, OutsideCardsSheet } from '@/components/home-sheets';
import { HomeValueSummary, NoticeSlot, type HomeChange, type HomeNotice, type HomeValue } from '@/components/home-summary';
import { HomeTopBar } from '@/components/home-top-bar';
import { NATIVE_DRIVER, useReducedMotion } from '@/components/motion';
import { type PressState } from '@/components/icon-button';
import { Card, CardSkeleton, ListRow, onCover, PokeballIcon, useLayout, useToastClearance, type IconName } from '@/components/ui';
import { formatDex, getSpecies, searchSpeciesList } from '@/data/pokedex';
import {
  customPlaceText,
  customSlotsOnPage,
  customTotalSlots,
  dexRange,
  extraOnPage,
  extraSlots,
  indexOfDex,
  indexOfEntry,
  indexOfExtra,
  inDexRange,
  isPlaced,
  isPlacedCustom,
  pageOfDex,
  pagePocketText,
  pageSize,
  regionsIn,
  slotAt,
  slotsOnPage,
  totalPages,
  totalSlots,
} from '@/lib/binder';
import { plainName } from '@/lib/catalog';
import { changeText } from '@/lib/copy';
import { formatBRLShort, formatInt } from '@/lib/format';
import { recentChange } from '@/lib/history';
import { mypPtImage } from '@/lib/myp-api';
import { collectionTotals } from '@/lib/quotes';
import { POKEDEX_BINDER, type BinderSettings, type CustomBinder, type Entry } from '@/lib/types';
import { pricePending, valuation } from '@/lib/valuation';
import {
  customEntryId,
  entriesOf,
  entryId,
  useActiveBinderId,
  useBinders,
  useCollectionActions,
  useCollectionReady,
  useEntries,
  useSession,
  useSettings,
  useSyncStatus,
} from '@/store/collection';
import { binderColors as B, breakpoints, CARD_RATIO, colors, elevation, radius, semantic, shadow, space, TOUCH, typography, widths } from '@/theme';

const WEB = Platform.OS === 'web';
/** "Toque" no celular, "Clique" no navegador (W3). */
const TAP = WEB ? 'Clique' : 'Toque';
const GAP = 8;
/** Margem interna da folha escura. */
const PAGE_PAD = 10;
/** Borda da folha (entra na largura: sem ela, a última coluna passava 2 px da margem). */
const SHEET_BORDER = 1;
/** Lado da lombada (com os furos do fichário): um pouco mais largo. */
const SPINE_PAD = 18;
/** Furos da lombada, em % da altura da folha. */
const HOLES = ['18%', '50%', '82%'] as const;
const SPREAD_GAP = 14;
/** Painel-resumo do computador, à direita da página. */
const PANEL_WIDTH = 320;
const PANEL_GAP = 24;
/** Duas páginas abertas só quando a coluna da página tem esta largura (janela de ~1280 px). */
const SPREAD_MIN_MAIN = 860;
/** Bolso mínimo no tablet e no computador (a página cabe na altura da janela). */
const MIN_SLOT_WIDE = 56;
/** Bolso máximo no computador: as miniaturas das cartas têm ~245 px; maior que isso, a imagem fica borrada. */
const MAX_SLOT_DESKTOP = 220;
/** Coluna mínima das páginas no computador, para o paginador (setas, página e "Próxima falta") caber numa linha. */
const MIN_MAIN_DESKTOP = 480;
/** Paginador fixo (48 px + margens). */
const PAGER_SPACE = 60;
/** Espaço livre no fim da rolagem para o botão "+ Carta" não cobrir a última linha. */
const FAB_SPACE = 88;
/** Altura do botão "+ Carta" do celular. */
const FAB_HEIGHT = 48;

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
      <View style={{ backgroundColor: semantic.brand.bg, height: insets.top + 59 }} />
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
  const entries = useEntries();
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
        return;
      }
    }
    setNotice({ text: 'Fichário completo! Todos os espaços têm carta.', tone: 'success' });
  }

  /** Vai até o Pokémon e destaca os espaços dele. */
  function selectSpecies(dex: number) {
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
  }

  const targets = useMemo(() => (q ? searchSpeciesList(q, 6).filter((s) => inDexRange(settings, s.id)) : []), [q, settings]);

  /** Vai ao Pokémon `i` da lista; o "Próximo" do aviso leva ao seguinte (o índice vai junto, não fica preso ao desenho). */
  function goToTarget(i: number) {
    const t = targets[i];
    if (!t) return;
    setCycleAt(i);
    selectSpecies(t.id);
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
  const entries = useEntries();
  const settings = useSettings();
  const binders = useBinders();
  const size = pageSize(binder);
  const [page, setPage, asked] = useBinderPage(binder.id, binder.pages, size);
  const [query, setQuery] = useState('');
  // Posição na lista de cartas achadas (Enter de novo vai para a próxima: "2 de 5").
  const [hitAt, setHitAt] = useState(-1);
  // Bolso pedido pelo número (destacado mesmo vazio) e o destacado por "Próximo vazio".
  const [pocketAt, setPocketAt] = useState<number | null>(null);
  const [emptyAt, setEmptyAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<HomeNotice | null>(null);
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
  }

  /** Vai até o bolso pelo número, com carta ou vazio (F6). */
  function goToPocket(slot: number) {
    setPocketAt(slot);
    setEmptyAt(null);
    setPage(Math.floor(slot / size));
    setNotice(null);
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
        return;
      }
    }
    setNotice({ text: 'Fichário cheio! Aumente as páginas em ⚙ para ganhar bolsos.', tone: 'success' });
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
};

/** Páginas abertas lado a lado (índices a partir de 0): [0], [1, 2], [3, 4]… e a última sozinha se cair à esquerda. */
function spreadOf(page: number, pages: number) {
  if (page <= 0) return [0];
  const left = page % 2 === 1 ? page : page - 1;
  return left + 1 < pages ? [left, left + 1] : [left];
}

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

function BinderFrame(p: FrameProps) {
  const L = useLayout();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const desktop = L.isDesktop;
  const ink = onCover(p.coverColor);
  const [barHeight, setBarHeight] = useState(desktop ? 67 : 59);
  const [searchOpen, setSearchOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searchFrame, setSearchFrame] = useState<{ x: number; y: number; width: number } | null>(null);
  const [goToOpen, setGoToOpen] = useState(false);
  const [outsideOpen, setOutsideOpen] = useState(false);
  const [peek, setPeek] = useState<Entry | undefined>();
  const [showHint, setShowHint] = useState(() => !(WEB && desktop) && hintSeen('swipe') < 3);
  const inputRef = useRef<TextInputInstance>(null);
  const searchBox = useRef<ViewInstance>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncNotice = useSyncNotice();
  const keyboard = useKeyboardHeight();
  const change = useRecentChange(p.showPrices, p.hasOtherBinders ? ' na coleção' : '');
  const value = useMemo(() => homeValue(p.entries), [p.entries]);

  // ----- Medidas: a página cabe na largura (celular) ou na altura da janela (tablet e computador) -----
  // No computador não há teto de largura: o bolso cresce até a página caber na altura da janela, e o fichário (páginas
  // + painel) fica centralizado. Com o teto de 1.440 px, numa tela grande sobravam as laterais e metade da altura.
  const avail = Math.max(0, L.width - L.gutter * 2);
  const mainAvail = desktop ? avail - PANEL_WIDTH - PANEL_GAP : Math.min(avail, widths.reading);
  const spread = p.doubleSided && desktop && mainAvail >= SPREAD_MIN_MAIN && p.pages > 1;
  const pageWidth = spread ? Math.floor((mainAvail - SPREAD_GAP) / 2) : mainAvail;
  const byWidth = Math.floor((pageWidth - PAGE_PAD - SPINE_PAD - SHEET_BORDER * 2 - GAP * (p.cols - 1)) / p.cols);
  const priceSpace = p.showPrices ? priceBlockHeight(byWidth, L.fontScale) : 0;
  // No computador, mais o respiro de cima e o número das páginas abertas lado a lado.
  const chrome =
    barHeight + PAGER_SPACE + (PAGE_PAD + SHEET_BORDER) * 2 + insets.bottom + (desktop ? space.xxl + (spread ? space.xl : 0) : FAB_SPACE);
  const byHeight = Math.floor(((L.height - chrome - GAP * (p.rows - 1)) / p.rows - priceSpace) * CARD_RATIO);
  const slot =
    L.width >= breakpoints.tablet ? Math.max(MIN_SLOT_WIDE, Math.min(byWidth, byHeight, desktop ? MAX_SLOT_DESKTOP : Infinity)) : byWidth;
  const sheetWidth = slot * p.cols + GAP * (p.cols - 1) + PAGE_PAD + SPINE_PAD + SHEET_BORDER * 2;
  // Largura em uso: no computador, só o que as páginas ocupam (com um mínimo para o paginador), mais o painel; no
  // celular e no tablet, a coluna inteira.
  const main = desktop ? Math.min(mainAvail, Math.max(spread ? sheetWidth * 2 + SPREAD_GAP : sheetWidth, MIN_MAIN_DESKTOP)) : mainAvail;
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
  const pan = useMemo(
    () =>
      PanResponder.create({
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
            Animated.spring(dragX, { toValue: 0, bounciness: 4, useNativeDriver: NATIVE_DRIVER }).start();
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
        onPanResponderTerminate: () => {
          Animated.spring(dragX, { toValue: 0, bounciness: 4, useNativeDriver: NATIVE_DRIVER }).start();
        },
      }),
    [canNext, canPrev, first, last, main, reduceMotion, showHint, onPage, dragX],
  );
  // No computador com mouse, folhear é pelos botões e pelo teclado (arrastar um link abriria o "arrastar" do navegador).
  const panHandlers = WEB && desktop ? null : pan.panHandlers;

  useEffect(() => {
    if (showHint) markHint('swipe');
  }, [showHint]);

  // ----- Pré-carga das miniaturas das páginas vizinhas (H1) -----
  const prefetch = useEffectEvent(() => {
    const near = spread ? [first - 2, first - 1, last + 1, last + 2] : [first - 1, last + 1];
    const urls = near
      .filter((n) => n >= 0 && n < p.pages)
      .flatMap((n) => p.itemsFor(n))
      .map((it) => it.entry)
      .filter((e): e is Entry => !!e)
      .map((e) => cardImageUrl({ image: e.image, imageUrl: e.imageUrl, photo: e.stampPhoto, ptImage: mypPtImage(e) }));
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
  // A lista abre logo abaixo do campo (computador) ou da barra (celular).
  const listTop = desktop && searchFrame ? searchFrame.y + space.xs : barHeight;
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

  const onAdd = () => router.push({ pathname: '/search', params: { mode: 'add' } });
  const onOpenCollection = () => router.push('/menu');

  // ----- Partes -----
  const renderPage = (pg: number, side: 'left' | 'right') => {
    const items = p.itemsFor(pg);
    const rows = Array.from({ length: Math.ceil(items.length / p.cols) }, (_, r) => items.slice(r * p.cols, (r + 1) * p.cols));
    // Página da direita (ou sozinha): lombada à esquerda; página da esquerda: à direita.
    const spineLeft = side === 'right';
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
    const missing = p.missingFrom?.(0) ?? [];
    return (
      <View key={side} style={[styles.cover, { width: sheetWidth, backgroundColor: p.coverColor }]}>
        <PokeballIcon size={36} color={ink} />
        <Text style={[styles.coverTitle, { color: ink }]}>{p.missingTitle}</Text>
        {missing.length ? <Text style={[styles.coverLabel, { color: ink }]}>Os primeiros que faltam</Text> : null}
        <View style={styles.coverList}>
          {missing.map((m) => (
            <Pressable
              key={m.key}
              onPress={m.onPress}
              role="button"
              accessibilityLabel={`${m.label}, ir para o espaço`}
              style={(s) => {
                const { pressed, hovered } = s as PressState;
                return [styles.coverItem, hovered && { backgroundColor: semantic.hover.onBrand }, pressed && { opacity: 0.7 }];
              }}>
              <Text style={[styles.coverItemText, { color: ink }]} numberOfLines={1}>
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
              return [styles.coverItem, styles.coverLink, hovered && { backgroundColor: semantic.hover.onBrand }, pressed && { opacity: 0.7 }];
            }}>
            <Text style={[styles.coverLinkText, { color: ink }]}>Lista completa</Text>
            <Ionicons name="chevron-forward" size={16} color={ink} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  const pagesView = (
    <View style={styles.viewport}>
      <Animated.View style={[styles.spread, { gap: SPREAD_GAP, transform: [{ translateX: dragX }] }]} {...(panHandlers ?? {})}>
        {spread && first === 0 ? cover('front') : null}
        {/* Página da esquerda: a primeira de duas, ou a última sozinha (com a contracapa à direita). */}
        {shown.map((pg, i) => renderPage(pg, spread && (shown.length > 1 ? i === 0 : first > 0) ? 'left' : 'right'))}
        {spread && shown.length === 1 && first > 0 ? cover('back') : null}
      </Animated.View>
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
      <NoticeSlot notice={p.notice} />
    </View>
  );

  const notices = (
    <>
      <NoticeSlot notice={syncNotice} />
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

  const summary = p.showPrices ? <HomeValueSummary data={value} change={change} layout={desktop ? 'panel' : 'row'} onOpenCollection={onOpenCollection} /> : null;

  const panel = desktop ? (
    <View style={{ width: PANEL_WIDTH }}>
      <Card style={styles.panel}>
        <View style={[styles.panelStrip, { backgroundColor: p.coverColor }]} aria-hidden />
        <View style={styles.panelHead}>
          <Text style={styles.panelTitle} numberOfLines={2} role="heading">
            {p.title}
          </Text>
          <Text style={styles.panelCounter}>{subtitle}</Text>
          <View style={styles.panelTrack} aria-hidden>
            <View style={[styles.panelFill, { width: `${Math.max(1.5, Math.min(100, progress * 100))}%` }]} />
          </View>
        </View>
        {summary}
        {notices}
        {/* Telas da coleção inteira (E1, E2); no celular, ficam na "Minha coleção" e na busca ao vivo. */}
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
        </View>
        {regions ? <RegionRuler regions={regions} vertical /> : null}
        {WEB ? <Text style={styles.keys}>← → folheiam · / busca · F {p.nextEmptyLabel.toLowerCase()}</Text> : null}
      </Card>
    </View>
  ) : null;

  const bottomSpace = desktop ? space.xxl : FAB_SPACE + insets.bottom;
  // No celular, os avisos (toast) ficam acima do "+ Carta" enquanto o fichário está na tela.
  useToastClearance(!desktop && focused ? insets.bottom + space.lg + FAB_HEIGHT : 0);

  return (
    <View style={styles.root}>
      {/* Título da aba na web: "GENGAR · pág. 2 · Fichário Pokédex". */}
      <Stack.Screen options={{ title: `${p.title} · ${shown.length > 1 ? `págs. ${first + 1}–${last + 1}` : `pág. ${first + 1}`}` }} />
      {/* Barra de status acompanhando a capa (só enquanto a home está na frente). */}
      {focused ? <StatusBar style={ink === colors.text ? 'dark' : 'light'} /> : null}

      <HomeTopBar
        title={p.title}
        subtitle={subtitle}
        cover={p.coverColor}
        ink={ink}
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
          ) : (
            search
          )
        }
        searchOpen={searchOpen}
        onToggleSearch={() => {
          if (searchOpen) {
            p.onQuery('');
            setListOpen(false);
          }
          setSearchOpen(!searchOpen);
        }}
        onMenu={() => router.push('/menu')}
        onSwitch={() => router.push('/binders')}
        onEdit={p.onEdit}
        onAdd={onAdd}
        onFind={() => router.push('/find')}
        onHeight={setBarHeight}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomSpace }]}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={desktop ? undefined : [2]}>
        {desktop ? (
          <View style={[styles.desktopBody, { width: outer }]}>
            <View style={{ width: main }}>
              {pager}
              {pagesView}
            </View>
            {panel}
          </View>
        ) : (
          [
            <View key="summary" style={[styles.block, styles.summary, { width: outer }]}>
              {summary}
              {notices}
            </View>,
            <View key="regions" style={[styles.block, { width: outer }]}>
              {regions ? <RegionRuler regions={regions} /> : null}
            </View>,
            <View key="pager" style={styles.sticky}>
              <View style={[styles.block, { width: outer }]}>{pager}</View>
            </View>,
            <View key="pages" style={[styles.block, { width: outer }]}>
              {pagesView}
              {showHint && p.pages > 1 ? <Text style={styles.hint}>Arraste a página para o lado para folhear.</Text> : null}
            </View>,
          ]
        )}
      </ScrollView>

      {showList ? (
        <SuggestionList
          items={p.suggestions}
          active={activeIndex}
          onHover={setActive}
          maxHeight={Math.max(TOUCH * 2, L.height - listTop - keyboard - space.lg)}
          style={[
            styles.suggestions,
            desktop && searchFrame ? { top: listTop, left: searchFrame.x, width: searchFrame.width } : { top: listTop, left: L.gutter, right: L.gutter },
          ]}
        />
      ) : null}

      {desktop ? null : (
        <Pressable
          onPress={onAdd}
          role="button"
          accessibilityLabel="Adicionar carta"
          style={({ pressed }) => [styles.fab, { bottom: insets.bottom + space.lg, right: L.gutter }, pressed && { opacity: 0.85 }]}>
          <Ionicons name="add" size={22} color={colors.onPrimary} />
          <Text style={styles.fabText}>Carta</Text>
        </Pressable>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'stretch' },
  block: { alignSelf: 'center' },
  summary: { paddingTop: space.md, gap: space.sm },
  sticky: { backgroundColor: colors.background, zIndex: 1 },
  pagerBlock: { gap: space.xs, paddingBottom: space.sm },
  desktopBody: { alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-start', gap: PANEL_GAP, paddingTop: space.md },
  viewport: { overflow: 'hidden', paddingVertical: space.xs },
  spread: { flexDirection: 'row', justifyContent: 'center' },
  sheet: {
    backgroundColor: B.page,
    borderRadius: radius.md,
    paddingVertical: PAGE_PAD,
    borderWidth: SHEET_BORDER,
    borderColor: B.pageBorder,
    ...elevation[1],
  },
  skeletonSheet: { alignSelf: 'center', marginTop: space.xl, paddingLeft: SPINE_PAD, paddingRight: PAGE_PAD, gap: GAP },
  spineLeft: { paddingLeft: SPINE_PAD, paddingRight: PAGE_PAD },
  spineRight: { paddingLeft: PAGE_PAD, paddingRight: SPINE_PAD },
  // Furos dos anéis na lombada da folha.
  hole: { position: 'absolute', width: 7, height: 7, marginTop: -3.5, borderRadius: 4, backgroundColor: colors.background, borderWidth: 1, borderColor: B.pocketBorder },
  holeLeft: { left: 5 },
  holeRight: { right: 5 },
  row: { flexDirection: 'row' },
  pageNumber: { ...typography.caption, ...typography.tabular, color: colors.textFaint, fontWeight: '700', textAlign: 'center', marginTop: space.xs },
  cover: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl, ...shadow },
  coverTitle: { ...typography.title, textAlign: 'center' },
  coverLabel: { ...typography.label, marginTop: space.sm },
  coverList: { alignSelf: 'stretch', gap: 2 },
  coverItem: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.sm },
  coverItemText: { ...typography.bodyStrong, ...typography.tabular, textAlign: 'center' },
  coverLink: { flexDirection: 'row', alignItems: 'center', gap: space.xxs, minHeight: TOUCH },
  coverLinkText: { ...typography.label, textDecorationLine: 'underline' },
  shortcutIcon: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  hint: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: space.sm },
  panel: { gap: space.lg, paddingTop: 0, overflow: 'hidden' },
  panelStrip: { height: 8, marginHorizontal: -space.lg },
  panelHead: { gap: space.xs },
  panelTitle: { ...typography.heading, color: colors.text },
  panelCounter: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  panelTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginTop: space.xs },
  panelFill: { height: 6, borderRadius: 3, backgroundColor: semantic.special.fill },
  keys: { ...typography.caption, color: colors.textMuted },
  suggestions: { position: 'absolute', zIndex: 10, maxWidth: 520 },
  fab: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: FAB_HEIGHT,
    paddingLeft: space.md,
    paddingRight: space.lg + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAction,
    ...elevation[2],
  },
  fabText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
});
