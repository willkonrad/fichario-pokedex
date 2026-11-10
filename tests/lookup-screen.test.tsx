import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, createElement } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import ConsultaScreen from '@/app/consulta';
import { ConsultaPill, HomeValueSummary } from '@/components/home-summary';
import { addRecent, dropFilterTerm, readRecents, RECENT_KEY, setSessionLang, withSpecies, type RecentSearch } from '@/components/lookup-bar';
import { buildGridRows, lookupCellLabel, lookupGridSize, rowOffsets, usesYearRail } from '@/components/lookup-grid';
import { CONSULTA_LAST, shouldReopenConsulta } from '@/components/lookup-warmup';
import { getSpecies } from '@/data/pokedex';
import { LOOKUP_PRICE, LOOKUP_UNAVAILABLE, MYP_URL } from '@/lib/copy';
import { parseLookupQuery } from '@/lib/lookup-query';
import type { LookupCard, MypNow } from '@/lib/lookup-types';
import { colors, TOUCH } from '@/theme';

import { header as makeHeader, jaCard, lookupCard, lookupSet, print, zhCard } from './lookup-fixtures';

// Tela de Consulta (seção 12): estados da 7.8, KO/ZH sem "Adicionar", crédito do MYP, leitura indisponível e leitor de tela.

type MockIndex = { status: string; header: unknown; sections: Map<number, LookupCard[]>; problem?: 'server' | 'format' };

const mockIndex: MockIndex = { status: 'ready', header: null, sections: new Map() };
const mockMyp: { now: MypNow } = { now: { status: 'unavailable', reason: 'language' } };
const mockOcr = { available: false };
const mockEntries: { value: Record<string, unknown> } = { value: {} };
const mockWindow = { width: 360, height: 760, scale: 2, fontScale: 1 };
const mockParams: { q?: string; lang?: string; pick?: string } = {};
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };

/** O `useEffect` do React que desenha a tela: na tela carregada como na web (outro registro), é o de lá. */
const mockReact: { useEffect: ((fn: () => void | (() => void), deps: unknown[]) => void) | null } = { useEffect: null };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (fn: () => void | (() => void)) => (mockReact.useEffect ?? jest.requireActual('react').useEffect)(fn, [fn]),
  useIsFocused: () => true,
  usePathname: () => '/consulta',
}));
jest.mock('expo-image', () => {
  const Image = (props: object) => jest.requireActual('react').createElement('ExpoImage', props);
  Image.prefetch = jest.fn(async () => true);
  return { Image };
});
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => {}), deactivateKeepAwake: jest.fn(async () => {}) }));
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({})),
  warmUpAsync: jest.fn(async () => ({})),
  coolDownAsync: jest.fn(async () => ({})),
  mayInitWithUrlAsync: jest.fn(async () => ({})),
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: (props: object) => jest.requireActual('react').createElement('LinearGradient', props) }));
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// O alvo de toque com as próprias props, para achar pelo nome e tocar (inclusive o "segurar").
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const React = jest.requireActual('react');
  const resolve = (v: unknown) => (typeof v === 'function' ? v({ pressed: false }) : v);
  function PressableMock(props: Record<string, unknown>) {
    return React.createElement('Pressable', { ...props, style: resolve(props.style) }, resolve(props.children));
  }
  return { __esModule: true, default: PressableMock };
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

jest.mock('@/lib/lookup-index', () => ({
  useLookupIndex: () => ({ status: mockIndex.status, header: mockIndex.header, problem: mockIndex.problem ?? null }),
  ensureLookupLoaded: jest.fn(async () => {}),
  warmLookup: jest.fn(async () => {}),
  setLookupFocused: jest.fn(),
  sectionCards: (dex: number) => mockIndex.sections.get(dex) ?? [],
  sectionCount: (dex: number) => (mockIndex.sections.get(dex) ?? []).length,
  searchTrainers: () => [],
  lookupByNumber: () => [],
  lookupByCode: () => [],
  cardByKey: () => null,
}));
jest.mock('@/lib/lookup-myp', () => ({ useMypNow: () => mockMyp.now }));
jest.mock('@/lib/myp-queue', () => ({ holdMypQueue: jest.fn(() => mockRelease), consultMypNow: jest.fn() }));
const mockRelease = jest.fn();
jest.mock('@/lib/scan-lot', () => ({ deliverScanPick: jest.fn() }));
jest.mock('@/store/collection', () => ({ useEntries: () => mockEntries.value, useSettings: () => null, useBinders: () => [] }));
jest.mock('@/components/add-sheet', () => ({
  AddCardSheet: (props: { card: unknown }) => (props.card ? jest.requireActual('react').createElement('AddCardSheet', props) : null),
}));
jest.mock('@/components/lookup-photo', () => ({ LookupPhoto: (props: object) => jest.requireActual('react').createElement('LookupPhoto', props) }));
jest.mock('@/components/card-grid', () => ({
  CardGridSkeleton: () => jest.requireActual('react').createElement('CardGridSkeleton'),
}));
jest.mock('../modules/card-ocr', () => ({
  get isOcrAvailable() {
    return mockOcr.available;
  },
}));

const { ensureLookupLoaded, setLookupFocused } = jest.requireMock<{ ensureLookupLoaded: jest.Mock; setLookupFocused: jest.Mock }>('@/lib/lookup-index');
const { deliverScanPick } = jest.requireMock<{ deliverScanPick: jest.Mock }>('@/lib/scan-lot');
const { activateKeepAwakeAsync, deactivateKeepAwake } = jest.requireMock<{ activateKeepAwakeAsync: jest.Mock; deactivateKeepAwake: jest.Mock }>('expo-keep-awake');
const { holdMypQueue } = jest.requireMock<{ holdMypQueue: jest.Mock }>('@/lib/myp-queue');
const { openBrowserAsync } = jest.requireMock<{ openBrowserAsync: jest.Mock }>('expo-web-browser');

const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const screenText = (root: Root) => root.container.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join(' ').replace(/\u00A0/g, ' ');
const hosts = (root: Root, type: string) => root.container.queryAll((n: TestInstance) => n.type === type);
const pressables = (root: Root) => hosts(root, 'Pressable');
const byLabel = (root: Root, label: string) => pressables(root).find((n) => n.props.accessibilityLabel === label);
const byText = (root: Root, text: string) => pressables(root).find((n) => textOf(n) === text);
const cells = (root: Root, name: string) => pressables(root).filter((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(`${name}, `) && !!n.props.onLongPress);
/** A célula do Charizard do Base Set (a japonesa, mais nova, vem primeiro). */
const baseSetCell = (root: Root) => cells(root, 'Charizard').find((n) => (n.props.accessibilityLabel as string).includes('4/102'));
const input = (root: Root) => hosts(root, 'TextInput')[0];
const value = (root: Root) => input(root).props.value as string;

async function press(node: TestInstance | undefined) {
  if (!node) throw new Error('alvo de toque não encontrado');
  await act(async () => (node.props.onPress as () => void)());
}
async function longPress(node: TestInstance | undefined) {
  if (!node) throw new Error('alvo de toque não encontrado');
  await act(async () => (node.props.onLongPress as () => void)());
}
async function type(root: Root, text: string) {
  await act(async () => (input(root).props.onChangeText as (t: string) => void)(text));
}

const roots: Root[] = [];
async function open(params: typeof mockParams = {}) {
  Object.assign(mockParams, { q: undefined, lang: undefined, pick: undefined }, params);
  const root = createRoot();
  roots.push(root);
  await act(async () => root.render(createElement(ConsultaScreen)));
  return root;
}

const dayIso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

const charizard = lookupCard();
/** Outra carta do Base Set: as duas ficam na primeira linha da grade. */
const sameYear = lookupCard({ key: '43', productId: 43, number: '5/102' });
const charizardJa = jaCard({ key: '500', productId: 500, name: 'Charizard', number: '006/165', hp: 130, dex: 6, prints: [print('H', 4000)] });

function ready(cards: Record<number, LookupCard[]> = { 6: [charizard, charizardJa] }, prices = dayIso(1)) {
  mockIndex.status = 'ready';
  mockIndex.header = makeHeader({ prices });
  mockIndex.sections = new Map(Object.entries(cards).map(([dex, list]) => [Number(dex), list]));
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  Object.assign(mockWindow, { width: 360, height: 760, fontScale: 1 });
  mockMyp.now = { status: 'unavailable', reason: 'language' };
  mockOcr.available = false;
  mockEntries.value = {};
  mockIndex.problem = undefined;
  setSessionLang(null);
  await AsyncStorage.clear();
  ready();
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

describe('estados da seção 7.8', () => {
  it('índice indo para a memória: campo e sugestões já funcionam; a grade entra ao terminar', async () => {
    mockIndex.status = 'loading';
    mockIndex.header = null;
    mockIndex.sections = new Map();
    // Janela baixa: a faixa contextual aparece sem depender do teclado.
    mockWindow.height = 500;
    const root = await open({ q: 'char' });
    expect(value(root)).toBe('char');
    expect(byLabel(root, 'Charizard')).toBeDefined();
    expect(hosts(root, 'CardGridSkeleton')).toHaveLength(1);
    expect(cells(root, 'Charizard')).toHaveLength(0);

    ready();
    await act(async () => root.render(createElement(ConsultaScreen)));
    expect(hosts(root, 'CardGridSkeleton')).toHaveLength(0);
    expect(cells(root, 'Charizard').length).toBeGreaterThan(0);
  });

  it('primeira vez, baixando: aviso do tamanho com o esqueleto', async () => {
    mockIndex.status = 'downloading';
    mockIndex.header = null;
    const root = await open();
    expect(screenText(root)).toContain('Preparando as cartas (2 MB)…');
    expect(hosts(root, 'CardGridSkeleton')).toHaveLength(1);
  });

  it('sem índice e sem internet: pede para conectar e oferece a busca do app', async () => {
    mockIndex.status = 'noNetwork';
    mockIndex.header = null;
    const root = await open();
    expect(screenText(root)).toContain('Conecte uma vez para baixar as cartas');
    await press(byText(root, 'Buscar no app'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/search', params: {} });
  });

  it('formato maior que o conhecido: trata como sem índice, pede para atualizar e oferece a busca', async () => {
    mockIndex.status = 'noIndex';
    mockIndex.header = null;
    mockIndex.problem = 'format';
    const root = await open({ q: 'pikachu' });
    expect(screenText(root)).toContain(LOOKUP_UNAVAILABLE.title);
    expect(screenText(root)).toContain(LOOKUP_UNAVAILABLE.format);
    expect(byText(root, 'Buscar no app')).toBeDefined();
    expect(cells(root, 'Pikachu')).toHaveLength(0);
  });

  it('servidor sem a lista (ou motivo desconhecido): o texto do servidor e "Tentar de novo"', async () => {
    mockIndex.status = 'noIndex';
    mockIndex.header = null;
    for (const problem of ['server', undefined] as const) {
      mockIndex.problem = problem;
      const root = await open();
      expect(screenText(root)).toContain(LOOKUP_UNAVAILABLE.server);
      ensureLookupLoaded.mockClear();
      await press(byText(root, 'Tentar de novo'));
      expect(ensureLookupLoaded).toHaveBeenCalled();
    }
  });

  it('vazio: recentes e dica; um toque refaz a busca com o idioma guardado', async () => {
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify([{ text: 'Charizard 120', lang: null }, { text: 'Umbreon', lang: 'ja' }]));
    const root = await open();
    const text = screenText(root);
    expect(text).toContain('RECENTES'.toLowerCase().replace(/^./, 'R'));
    expect(text).toContain('Nome, depois HP, ano ou número:');
    await press(byText(root, 'Umbreon · JP'));
    expect(value(root)).toBe('Umbreon');
  });

  it('sem resultado com filtros: chips com ✕ e quantas cartas voltam sem cada um', async () => {
    const root = await open({ q: 'charizard 120 jp' });
    const text = screenText(root);
    expect(text).toContain('Nenhuma carta com esses filtros');
    expect(text).toContain('Sem o HP 120: 1 carta');
    await press(byLabel(root, 'Tirar o filtro HP 120'));
    expect(value(root)).toBe('charizard jp');
    expect(screenText(root)).toContain('006/165');
  });

  it('sem resultado nenhum: avisa e leva à busca do app com o nome', async () => {
    const root = await open({ q: 'mewtwo' });
    expect(screenText(root)).toContain('Nenhuma carta com esse nome');
    await press(byText(root, 'Buscar no app'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/search', params: { q: 'Mewtwo' } });
  });

  it('preços com mais de 3 dias: aviso com a data; recentes, sem aviso', async () => {
    ready(undefined, dayIso(10));
    const stale = await open({ q: 'charizard' });
    expect(screenText(stale)).toContain('mais de 3 dias sem atualizar');
    ready(undefined, dayIso(1));
    const fresh = await open({ q: 'charizard' });
    expect(screenText(fresh)).not.toContain('mais de 3 dias sem atualizar');
  });

  it('carta sem preço: diz que não tem, mostra "—" na grade, nunca estima, e os links continuam', async () => {
    ready({ 6: [lookupCard({ prints: [] }), sameYear] });
    const root = await open({ q: 'charizard' });
    const cell = baseSetCell(root)!;
    expect(cell.props.accessibilityLabel).toContain('sem preço');
    expect(textOf(cell)).toContain('—');
    await press(cell);
    const text = screenText(root);
    expect(text).toContain('Sem preço no índice');
    expect(text).not.toContain(LOOKUP_PRICE.market);
    expect(pressables(root).some((n) => n.props.accessibilityLabel === 'Liga: abrir fora do app')).toBe(true);
  });

  it('com foco: mantém a tela acesa, segura a fila e o índice; ao sair, solta tudo', async () => {
    const root = await open({ q: 'charizard' });
    expect(activateKeepAwakeAsync).toHaveBeenCalledWith('consulta');
    expect(holdMypQueue).toHaveBeenCalledTimes(1);
    expect(setLookupFocused).toHaveBeenLastCalledWith(true);
    expect(ensureLookupLoaded).toHaveBeenCalled();
    expect(await AsyncStorage.getItem(CONSULTA_LAST)).toMatch(/^\d+$/);

    roots.splice(roots.indexOf(root), 1);
    await act(async () => root.unmount());
    expect(deactivateKeepAwake).toHaveBeenCalledWith('consulta');
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(setLookupFocused).toHaveBeenLastCalledWith(false);
    expect(await AsyncStorage.getItem(CONSULTA_LAST)).toBeNull();
  });
});

describe('coreana e chinesa: só consulta', () => {
  const korean = jaCard({ key: '700', productId: 700, name: 'Charizard', number: '006/165', dex: 6, marks: 'jk' });
  const chinese = zhCard({ name: '噴火龍', dex: 6 });

  it.each([
    ['ko', korean, 'Charizard'],
    ['zh', chinese, '噴火龍'],
  ] as const)('%s: sem "Adicionar", com o aviso; segurar não abre a folha de adicionar', async (lang, card, name) => {
    ready({ 6: [card, charizard] });
    const root = await open({ q: 'charizard', lang });
    const list = cells(root, name);
    // A carta única já vem aberta na tela; com mais cartas, abre pelo toque.
    if (list.length) await longPress(list[0]);
    expect(hosts(root, 'AddCardSheet')).toHaveLength(0);
    if (list.length) await press(list[0]);
    const text = screenText(root);
    expect(text).toContain(LOOKUP_PRICE.onlyLookup);
    expect(byText(root, 'Adicionar à coleção')).toBeUndefined();
  });

  it('nunca mostra "tenho" numa célula coreana', async () => {
    ready({ 6: [korean, korean && { ...korean, key: '701', productId: 701 }] });
    const root = await open({ q: 'charizard', lang: 'ko' });
    for (const cell of cells(root, 'Charizard')) expect(cell.props.accessibilityLabel).not.toContain('você já tem');
  });

  it('PT, EN e JP têm "Adicionar": a folha abre com a carta no idioma mostrado', async () => {
    ready({ 6: [charizard, charizardJa] });
    const root = await open({ q: 'charizard', lang: 'en' });
    // Em EN sobra uma carta: o conteúdo da folha já está na tela, sem toque.
    await press(byText(root, 'Adicionar à coleção'));
    const [sheet] = hosts(root, 'AddCardSheet');
    expect(sheet.props.card).toMatchObject({ id: 'base1-4', lang: 'en' });
  });

  it('segurar numa carta de PT/EN/JP vai direto para adicionar', async () => {
    const root = await open({ q: 'charizard' });
    await longPress(cells(root, 'Charizard')[0]);
    expect(hosts(root, 'AddCardSheet')).toHaveLength(1);
  });
});

describe('preço do MYP: crédito com link', () => {
  async function sheetWith(now: MypNow, lang = 'en') {
    mockMyp.now = now;
    return open({ q: 'charizard', lang });
  }
  const credit = (root: Root) => hosts(root, 'Text').find((n) => n.props.role === 'link' && n.props.accessibilityLabel === 'MYP Cards');

  it('com preço: faixa, ofertas e crédito que abre a ficha, voltando direto para a Consulta', async () => {
    const root = await sheetWith({ status: 'ok', min: 480, avg: 600, max: 700, qty: 12, url: 'https://mypcards.com/x', at: new Date().toISOString() });
    const text = screenText(root);
    expect(text).toContain('R$ 480–700');
    expect(text).toContain('12 ofertas');
    const link = credit(root);
    expect(link).toBeDefined();
    await act(async () => (link!.props.onPress as () => void)());
    expect(openBrowserAsync).toHaveBeenCalledWith('https://mypcards.com/x', { createTask: false, enableBarCollapsing: true });
  });

  it('429: mostra a pausa e mantém o crédito', async () => {
    const root = await sheetWith({ status: 'limited', retryInS: 58 });
    expect(screenText(root)).toContain('MYP pediu uma pausa: 58 s');
    await act(async () => (credit(root)!.props.onPress as () => void)());
    expect(openBrowserAsync).toHaveBeenCalledWith(MYP_URL, expect.anything());
  });

  it('limite do próprio app: "Limite de consultas", não a pausa do MYP', async () => {
    const root = await sheetWith({ status: 'limited', retryInS: 52, by: 'app' });
    expect(screenText(root)).toContain('Limite de consultas: 52 s');
    expect(screenText(root)).not.toContain('MYP pediu uma pausa');
    expect(credit(root)).toBeDefined();
  });

  it('sem oferta também credita; web e idioma sem preço não fingem preço', async () => {
    const none = await sheetWith({ status: 'notFound' });
    expect(credit(none)).toBeDefined();
    const web = await sheetWith({ status: 'unavailable', reason: 'web' });
    expect(screenText(web)).toContain(LOOKUP_PRICE.mypMobileOnly);
    expect(credit(web)).toBeUndefined();
  });

  it('carregando: só a linha do MYP espera, com o resto já na tela', async () => {
    const root = await sheetWith({ status: 'loading' });
    expect(root.container.queryAll((n: TestInstance) => n.props.accessibilityLabel === 'Buscando o preço do MYP Cards')).toHaveLength(1);
    expect(screenText(root)).toContain(LOOKUP_PRICE.market);
  });
});

describe('leitura pela câmera', () => {
  const PHOTO = 'Procurar pela foto da carta';
  const PRINT = 'Procurar por um print da tela';

  it('isOcrAvailable falso: sem F, sem P e sem câmera', async () => {
    const root = await open();
    expect(byLabel(root, PHOTO)).toBeUndefined();
    expect(byLabel(root, PRINT)).toBeUndefined();
    expect(hosts(root, 'LookupPhoto')).toHaveLength(0);
  });

  it('com o módulo: F abre a foto no lugar da lista; o que foi lido vira texto no campo, com "Desfazer"', async () => {
    mockOcr.available = true;
    const root = await open({ q: 'charizard' });
    await press(byLabel(root, PHOTO));
    const [photo] = hosts(root, 'LookupPhoto');
    expect(photo.props.mode).toBe('photo');
    await act(async () => (photo.props.onResult as (r: object) => void)({ text: 'charizard 120', note: 'Lido: Charizard · HP 120' }));
    expect(hosts(root, 'LookupPhoto')).toHaveLength(0);
    expect(value(root)).toBe('charizard 120');
    expect(screenText(root)).toContain('Lido: Charizard · HP 120');
    await press(byText(root, 'Desfazer'));
    expect(value(root)).toBe('charizard');
  });

  it('leitura exata abre a folha da carta', async () => {
    mockOcr.available = true;
    const root = await open();
    await press(byLabel(root, PRINT));
    const [photo] = hosts(root, 'LookupPhoto');
    expect(photo.props.mode).toBe('print');
    await act(async () => (photo.props.onResult as (r: object) => void)({ text: 'charizard 120', note: 'Lido', open: charizard }));
    expect(root.container.queryAll((n: TestInstance) => n.props.role === 'dialog' && n.props['aria-label'] === 'Charizard')).toHaveLength(1);
  });
});

describe('leitor de tela', () => {
  it('a célula diz o que a foto e as siglas mostram', async () => {
    ready({ 6: [charizard, sameYear] });
    const root = await open({ q: 'charizard' });
    const cell = baseSetCell(root)!;
    const label = cell.props.accessibilityLabel as string;
    for (const part of ['Charizard', 'português e inglês', 'número 4/102', 'Base Set', '1999', 'HP 120', LOOKUP_PRICE.market]) expect(label).toContain(part);
    expect(label).toContain('R$');
    expect(cell.props.role).toBe('button');
  });

  it('referência sempre rotulada; só anúncio nunca vira mercado; sem HP e sem ano ditos como tais', () => {
    const ref = lookupCellLabel(charizard, { kind: 'market', brl: 550, ref: 'en', morePrints: 0 }, null, 'pt');
    expect(ref).toContain(LOOKUP_PRICE.refEn);
    expect(ref).toContain('português');
    const listing = lookupCellLabel(charizard, { kind: 'listing', brl: 10, ref: null, morePrints: 1 });
    expect(listing).toContain(LOOKUP_PRICE.low.toLowerCase());
    expect(listing).not.toContain(LOOKUP_PRICE.market);
    expect(listing).toContain('mais 1 impressão');
    const bare = lookupCellLabel(lookupCard({ hp: null, year: { kind: 'none' } }), { kind: 'none', brl: null, ref: null, morePrints: 0 });
    expect(bare).toContain('sem ano');
    expect(bare).toContain('sem preço');
    expect(bare).not.toContain('HP');
  });

  it('segurar tem uma ação equivalente para quem usa leitor de tela', async () => {
    const root = await open({ q: 'charizard' });
    const [cell] = cells(root, 'Charizard');
    expect(cell.props.accessibilityActions).toEqual([{ name: 'longpress', label: 'Adicionar à coleção' }]);
    await act(async () => (cell.props.onAccessibilityAction as () => void)());
    expect(hosts(root, 'AddCardSheet')).toHaveLength(1);
  });
});

describe('campo único', () => {
  it('chip de HP escreve no texto e tira de novo', async () => {
    const root = await open({ q: 'Charizard' });
    await press(byLabel(root, 'HP 120, 1 carta'));
    expect(value(root)).toBe('Charizard 120');
    await press(byLabel(root, 'HP 120, 1 carta'));
    expect(value(root)).toBe('Charizard');
  });

  it('idioma do chip fica fora do texto e vale na sessão; o digitado vale sobre ele', async () => {
    const root = await open({ q: 'Charizard' });
    await press(byLabel(root, 'Japonês, 1 carta'));
    expect(value(root)).toBe('Charizard');
    // Sobra uma carta japonesa: a folha já está aberta na tela.
    expect(screenText(root)).toContain('006/165');
    expect(screenText(root)).not.toContain('4/102');
    await type(root, 'Charizard en');
    expect(screenText(root)).toContain('4/102');
    // Outra tela nesta sessão continua em japonês.
    const again = await open({ q: 'Charizard' });
    expect(screenText(again)).toContain('006/165');
    expect(screenText(again)).not.toContain('4/102');
  });

  it('Enter confirma o 1º lugar: "char" vira o nome, e o resto do texto fica', async () => {
    mockWindow.height = 500;
    const root = await open({ q: 'char 120' });
    await act(async () => (input(root).props.onSubmitEditing as () => void)());
    expect(value(root)).toMatch(/^Char\S+ 120$/);
    expect(value(root)).not.toBe('char 120');
  });

  it('limpar mantém o campo e volta aos recentes', async () => {
    const root = await open({ q: 'charizard' });
    await press(byLabel(root, 'Limpar a busca'));
    expect(value(root)).toBe('');
    expect(screenText(root)).toContain('Nome, depois HP, ano ou número:');
  });

  it('"HP 120 · trocar para nº" só quando 120 existe também como número', async () => {
    ready({ 6: [charizard, lookupCard({ key: '9', productId: 9, number: '120/165', hp: 90, dex: 6 })] });
    const root = await open({ q: 'charizard 120' });
    await press(byText(root, 'HP 120 · trocar para nº'));
    expect(value(root)).toBe('charizard #120');

    ready({ 6: [charizard, charizardJa] });
    const plain = await open({ q: 'charizard 120' });
    expect(byText(plain, 'HP 120 · trocar para nº')).toBeUndefined();
  });

  it('filtro que a gramática não escreve fica fora do texto e some em outra busca', async () => {
    const stage2 = lookupCard({ key: '11', productId: 11, stage: 'Stage 2', number: '11/102' });
    const basic = lookupCard({ key: '12', productId: 12, stage: 'Basic', number: '12/102' });
    ready({ 6: [stage2, basic], 25: [lookupCard({ key: '13', productId: 13, name: 'Pikachu', dex: 25, stage: 'Basic', number: '13/102' }), lookupCard({ key: '14', productId: 14, name: 'Pikachu', dex: 25, stage: 'Basic', number: '14/102' })] });
    const root = await open({ q: 'charizard' });
    await press(byText(root, '+ Filtros'));
    await press(byText(root, 'Basic · 1'));
    expect(value(root)).toBe('charizard');
    expect(screenText(root)).toContain('12/102');
    await press(byLabel(root, 'Fechar os filtros'));
    await type(root, 'pikachu');
    expect(cells(root, 'Pikachu')).toHaveLength(2);
  });
});

describe('folha da carta', () => {
  it('Liga e MYP primeiro, todos neutros: o único vermelho é "Adicionar à coleção"', async () => {
    const root = await open({ q: 'charizard', lang: 'en' });
    const links = pressables(root).filter((n) => n.props.role === 'link');
    expect(links.slice(0, 2).map((n) => n.props.accessibilityLabel)).toEqual(['Liga: abrir fora do app', 'MYP: abrir fora do app']);
    const flat = (n: TestInstance) => StyleSheet.flatten((typeof n.props.style === 'function' ? n.props.style({ pressed: false }) : n.props.style) as object) as { backgroundColor?: string };
    for (const link of links) expect(flat(link).backgroundColor).toBe(colors.surfaceAlt);
    expect(hosts(root, 'LinearGradient')).toHaveLength(1);
  });

  it('referência de PT sai rotulada e aviso de "Near Mint" no mercado', async () => {
    const root = await open({ q: 'charizard', lang: 'pt' });
    const text = screenText(root);
    expect(text).toContain(LOOKUP_PRICE.refEn);
    expect(text).toContain(LOOKUP_PRICE.market);
  });

  it('com `pick`, a ação vira "Usar esta carta" e devolve a carta à conferência', async () => {
    const root = await open({ q: 'charizard', lang: 'en', pick: 'item-1' });
    expect(byText(root, 'Adicionar à coleção')).toBeUndefined();
    await press(byText(root, 'Usar esta carta'));
    expect(deliverScanPick).toHaveBeenCalledWith('item-1', charizard, 'en');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(hosts(root, 'AddCardSheet')).toHaveLength(0);
  });

  it('com `pick`, segurar só abre a carta', async () => {
    const root = await open({ q: 'charizard', pick: 'item-1' });
    await longPress(cells(root, 'Charizard')[0]);
    expect(hosts(root, 'AddCardSheet')).toHaveLength(0);
    expect(root.container.queryAll((n: TestInstance) => n.props.role === 'dialog')).toHaveLength(1);
  });

  it('no computador, painel fixo ao lado: troca de carta sem abrir folha', async () => {
    mockWindow.width = 1280;
    mockWindow.height = 900;
    const root = await open({ q: 'charizard' });
    const panel = () => root.container.queryAll((n: TestInstance) => n.props.role === 'complementary');
    expect(panel()).toHaveLength(1);
    expect(textOf(panel()[0])).toContain('Escolha uma carta');
    await press(baseSetCell(root));
    expect(root.container.queryAll((n: TestInstance) => n.props.role === 'dialog')).toHaveLength(0);
    expect(textOf(panel()[0])).toContain('4/102 · BS');
  });
});

describe('grade', () => {
  it('densidade: mais de 4 cartas, 3 colunas no celular; de 2 a 4, duas maiores', () => {
    expect(lookupGridSize(328, 30, false)).toMatchObject({ cols: 3, big: false });
    expect(lookupGridSize(328, 3, false)).toMatchObject({ cols: 2, big: true });
  });

  it('trilho de anos só com mais de 2 anos e mais de 18 cartas', () => {
    expect(usesYearRail(3, 19)).toBe(true);
    expect(usesYearRail(2, 40)).toBe(false);
    expect(usesYearRail(5, 18)).toBe(false);
  });

  it('as linhas têm altura conhecida e as sem HP ficam recolhidas no fim', () => {
    const group = { key: 'y1999', title: '1999', from: 1999, to: 1999, cards: [charizard, charizard, charizard, charizard] };
    const rows = buildGridRows([group], [charizardJa], false, 3, true);
    expect(rows.map((r) => r.kind)).toEqual(['title', 'year', 'cards', 'cards', 'noHp']);
    const open = buildGridRows([group], [charizardJa], true, 3, false);
    expect(open[open.length - 1]).toMatchObject({ kind: 'cards', start: 4 });
    const { offsets, heights } = rowOffsets(rows, 200);
    expect(offsets[1]).toBe(heights[0]);
    expect(offsets[2]).toBe(heights[0] + heights[1]);
  });
});

describe('ajudas do texto', () => {
  const ctx = { hpsOf: () => new Set([120]), countOf: () => 1, abbrsOf: () => new Set<string>() };
  const parse = (t: string) => parseLookupQuery(t, ctx);

  it('withSpecies troca só o trecho do nome', () => {
    expect(withSpecies('char 120', getSpecies(6)!)).toBe('Charizard 120');
    expect(withSpecies('jp char', getSpecies(6)!)).toBe('jp Charizard');
  });

  it('dropFilterTerm tira o filtro em qualquer grafia, sem mexer no resto', () => {
    expect(dropFilterTerm('charizard rev', 'variant', parse)).toBe('charizard');
    expect(dropFilterTerm('charizard holo 120', 'hp', parse)).toBe('charizard holo');
    expect(dropFilterTerm('charizard hp 120', 'hp', parse)).toBe('charizard');
    expect(dropFilterTerm('charizard', 'hp', parse)).toBe('charizard');
  });

  it('recentes: sem repetir, a mais nova na frente, até 8; dado ruim fica de fora', () => {
    let list: RecentSearch[] = [{ text: 'Mew', lang: null }];
    list = addRecent(list, { text: 'mew ', lang: null });
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('mew ');
    for (let i = 0; i < 12; i++) list = addRecent(list, { text: `p${i}`, lang: null });
    expect(list).toHaveLength(8);
    expect(list[0].text).toBe('p11');
    expect(readRecents('{ruim')).toEqual([]);
    expect(readRecents('[{"text":"Mew","lang":"xx"},{"lang":"pt"}]')).toEqual([{ text: 'Mew', lang: null }]);
  });

  it('app frio: volta à Consulta só com uso recente', () => {
    const now = 1_000_000_000_000;
    expect(shouldReopenConsulta(String(now - 5 * 60_000), now)).toBe(true);
    expect(shouldReopenConsulta(String(now - 31 * 60_000), now)).toBe(false);
    expect(shouldReopenConsulta(null, now)).toBe(false);
    expect(shouldReopenConsulta(String(now + 1000), now)).toBe(false);
  });
});

describe('atalho na tela inicial', () => {
  const value = { value: 100, valued: 2, byBasis: { manual: 0, tcgplayer: 2, myp: 0 } as never, pending: 0, unpriced: 0 };

  it('pílula neutra, com alvo de 48 e nome para o leitor de tela', async () => {
    const onPress = jest.fn();
    const root = createRoot();
    roots.push(root);
    await act(async () => root.render(createElement(ConsultaPill, { onPress })));
    const [pill] = pressables(root);
    expect(pill.props.accessibilityLabel).toContain('Consulta');
    expect((StyleSheet.flatten(pill.props.style as object) as { minHeight?: number }).minHeight).toBe(TOUCH);
    await press(pill);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(hosts(root, 'LinearGradient')).toHaveLength(0);
  });

  it('na linha do valor, a pílula entra na ponta sem criar outra linha', async () => {
    const root = createRoot();
    roots.push(root);
    await act(async () => root.render(createElement(HomeValueSummary, { data: value, onOpenCollection: () => {}, trailing: createElement(ConsultaPill, { onPress: () => {} }) })));
    const [button, pill] = pressables(root);
    expect(button.props.accessibilityLabel).toContain('Abrir minha coleção');
    expect(pill.props.accessibilityLabel).toContain('Consulta');
    expect(button.parent).toBe(pill.parent);
    expect((StyleSheet.flatten(button.props.style as object) as { minHeight?: number; flexDirection?: string }).flexDirection).toBe('column');
  });
});

describe('folha: idioma, posse e preços dos chips', () => {
  const roselia = jaCard({ key: '568335', productId: 568335, name: 'Roselia', number: '001/071', hp: 60, dex: 315, marks: 'jk' });
  const dexRoselia = { 315: [roselia] };

  async function photoResult(root: Root, result: object) {
    await press(byLabel(root, 'Procurar pela foto da carta'));
    await act(async () => (hosts(root, 'LookupPhoto')[0].props.onResult as (r: object) => void)(result));
  }

  it('coreana lida pela foto abre como coreana: sem Adicionar e com a referência rotulada', async () => {
    ready(dexRoselia);
    mockOcr.available = true;
    const root = await open();
    await photoResult(root, { text: 'roselia 001/071 ko', note: 'Lido: Roselia', open: roselia, openLang: 'ko' });
    expect(byText(root, 'Adicionar à coleção')).toBeUndefined();
    const text = screenText(root);
    expect(text).toContain(LOOKUP_PRICE.onlyLookup);
    expect(text).toContain(LOOKUP_PRICE.refJa);
  });

  it('inglesa lida pela foto abre em inglês, mesmo com PT na linha', async () => {
    mockOcr.available = true;
    const root = await open();
    await photoResult(root, { text: 'charizard 4/102', note: 'Lido: Charizard', open: charizard, openLang: 'en' });
    expect(screenText(root)).not.toContain(LOOKUP_PRICE.refEn);
    expect(byText(root, 'Adicionar à coleção')).toBeDefined();
  });

  it('corpo de carta única acompanha o idioma digitado depois', async () => {
    ready(dexRoselia);
    const root = await open({ q: 'roselia' });
    expect(byText(root, 'Adicionar à coleção')).toBeDefined();
    await type(root, 'roselia ko');
    expect(byText(root, 'Adicionar à coleção')).toBeUndefined();
    expect(screenText(root)).toContain(LOOKUP_PRICE.onlyLookup);
  });

  it('com `pick`, o idioma mostrado na folha vai junto com a carta', async () => {
    ready({ 6: [charizard, sameYear] });
    const root = await open({ q: 'charizard', pick: 'item-1' });
    await press(baseSetCell(root));
    await press(pressables(root).find((n) => n.props.accessibilityLabel === 'EN, Inglês'));
    await press(byText(root, 'Usar esta carta'));
    expect(deliverScanPick).toHaveBeenCalledWith('item-1', charizard, 'en');
  });

  const sibling = (over: Partial<LookupCard>) => lookupCard({ key: '77', productId: 77, stamp: 'Master Ball Pattern', ...over });

  it('Outras versões: só anúncio e referência aparecem no chip e no leitor de tela', async () => {
    const listing = sibling({ prints: [print('H', null, 1000, null)] });
    ready({ 6: [charizard, listing] });
    const root = await open({ q: 'charizard', lang: 'pt' });
    await press(baseSetCell(root));
    const chip = pressables(root).find((n) => textOf(n).startsWith('Master Ball Pattern '));
    expect(textOf(chip as TestInstance).replace(/\u00A0/g, ' ')).toContain('ref. EN anúncio R$');
    expect(chip?.props.accessibilityLabel).toContain(LOOKUP_PRICE.refEn);
    expect(chip?.props.accessibilityLabel).toContain(LOOKUP_PRICE.low.toLowerCase());
  });

  it('tem só a versão comum: a Master Ball diz "outra versão", e não "tenho"', async () => {
    ready({ 6: [sibling({ tcgdexId: charizard.tcgdexId, prints: [print('H', 100)] })] });
    mockEntries.value = { '6-0': { id: '6-0', cardId: charizard.tcgdexId, lang: 'en', variant: 'normal', dex: 6, slot: 0, binderId: 'pokedex' } };
    const root = await open({ q: 'charizard', lang: 'en' });
    const text = screenText(root);
    expect(text).toContain('outra versão:');
    expect(text).not.toContain('tenho:');
  });
});

describe('adicionar leva a versão que estava na tela', () => {
  const chip = (root: Root, start: string) => pressables(root).find((n) => textOf(n).startsWith(start));

  it('chip "1ª ed. Holo" na folha: a carta vai como 1ª edição, e não como a comum', async () => {
    ready({ 6: [lookupCard({ prints: [print('H', 3755), print('1H', 14915)] }), sameYear] });
    const root = await open({ q: 'charizard', lang: 'en' });
    await press(baseSetCell(root));
    await press(chip(root, '1ª ed. Holo'));
    await press(byText(root, 'Adicionar à coleção'));
    expect(hosts(root, 'AddCardSheet')[0].props.card).toMatchObject({ id: 'base1-4', lang: 'en', version: 'firstEdition' });
  });

  it('sem tocar em chip, vai a impressão do preço mostrado', async () => {
    ready({ 6: [lookupCard({ prints: [print('H', 3755), print('1H', 14915)] }), sameYear] });
    const root = await open({ q: 'charizard', lang: 'en' });
    await press(baseSetCell(root));
    await press(byText(root, 'Adicionar à coleção'));
    expect(hosts(root, 'AddCardSheet')[0].props.card).toMatchObject({ version: 'holo' });
  });

  it('segurar na carta da "Base Set (Shadowless)": vai como Shadowless (mesmo id da TCGdex da comum)', async () => {
    const shadowless = lookupCard({ key: '106999', productId: 106999, set: lookupSet({ key: '1663', name: 'Base Set (Shadowless)' }), prints: [print('H', 39495)] });
    ready({ 6: [shadowless, sameYear] });
    const root = await open({ q: 'charizard', lang: 'en' });
    await longPress(baseSetCell(root));
    expect(hosts(root, 'AddCardSheet')[0].props.card).toMatchObject({ id: 'base1-4', version: 'shadowless' });
  });

  it('segurar com o filtro "1ed": vai a 1ª edição que a célula mostra', async () => {
    const both = [print('H', 3755), print('1H', 14915)];
    ready({ 6: [lookupCard({ prints: both }), { ...sameYear, prints: both }] });
    const root = await open({ q: 'charizard 1ed', lang: 'en' });
    await longPress(baseSetCell(root));
    expect(hosts(root, 'AddCardSheet')[0].props.card).toMatchObject({ version: 'firstEdition' });
  });
});

describe('digitando: sem telas de "nenhuma carta" no meio do termo', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const focus = (root: Root) => act(async () => (input(root).props.onFocus as () => void)());
  const pause = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

  it('termo que ainda dá zero: a grade anterior fica até a pessoa parar de digitar', async () => {
    ready({ 6: [charizard, sameYear] });
    const root = await open({ q: 'charizard' });
    await focus(root);
    await type(root, 'charizard zz');
    expect(cells(root, 'Charizard')).toHaveLength(2);
    expect(screenText(root)).not.toContain('Nenhuma carta');
    await pause(900);
    expect(screenText(root)).toContain('Nenhuma carta com esses filtros');
    expect(cells(root, 'Charizard')).toHaveLength(0);
  });

  it('com o teclado fechado, o zero aparece na hora; outra busca não segura a grade', async () => {
    ready({ 6: [charizard, sameYear] });
    const root = await open({ q: 'charizard' });
    await type(root, 'charizard zz');
    expect(screenText(root)).toContain('Nenhuma carta com esses filtros');
    await focus(root);
    await type(root, 'charizard');
    await type(root, 'mewtwo');
    expect(screenText(root)).toContain('Nenhuma carta com esse nome');
  });

  it('busca por número sem carta: o aviso fala de número, não de nome', async () => {
    const root = await open({ q: '999/999' });
    const text = screenText(root);
    expect(text).toContain('Nenhuma carta com esse número');
    expect(text).not.toContain('com esse nome');
  });
});

describe('recentes: busca respondida pela carta única', () => {
  const recentTexts = async () => readRecents(await AsyncStorage.getItem(RECENT_KEY)).map((r) => r.text);

  it('carta única na tela, sem abrir nada: a busca vai para os recentes', async () => {
    const root = await open({ q: 'charizard', lang: 'en' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await press(byLabel(root, 'Limpar a busca'));
    expect(byText(root, 'charizard · EN')).toBeDefined();
  });

  it('digitando: entra depois de um instante parado; com duas cartas e nenhum toque, não entra', async () => {
    jest.useFakeTimers();
    try {
      const root = await open({ q: 'charizard' });
      await act(async () => (input(root).props.onFocus as () => void)());
      await act(async () => void jest.advanceTimersByTime(3000));
      expect(await recentTexts()).not.toContain('charizard');
      await type(root, 'charizard 4/102');
      await act(async () => void jest.advanceTimersByTime(1000));
      expect(await recentTexts()).not.toContain('charizard 4/102');
      await act(async () => void jest.advanceTimersByTime(1100));
      expect(await recentTexts()).toContain('charizard 4/102');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('acessibilidade da grade, da folha e dos filtros', () => {
  afterEach(() => jest.restoreAllMocks());

  it('na conferência do lote, a célula não oferece "Adicionar à coleção" ao leitor de tela', async () => {
    const root = await open({ q: 'charizard', pick: 'item-1' });
    for (const cell of cells(root, 'Charizard')) {
      expect(cell.props.accessibilityActions).toBeUndefined();
      expect(cell.props.onAccessibilityAction).toBeUndefined();
    }
  });

  it('faixa do ano: título com o ano e a contagem num nome só', async () => {
    ready({ 6: [charizard, sameYear] });
    const root = await open({ q: 'charizard' });
    expect(root.container.queryAll((n: TestInstance) => n.props.role === 'heading' && n.props.accessibilityLabel === '1999, 2 cartas')).toHaveLength(1);
  });

  it('foto grande: só o botão "Fechar a foto"; o fundo fecha ao toque, sem ser um alvo', async () => {
    const root = await open({ q: 'charizard', lang: 'en' });
    await press(byLabel(root, 'Ver a foto grande de Charizard'));
    expect(pressables(root).filter((n) => n.props.accessibilityLabel === 'Fechar a foto')).toHaveLength(1);
    const backdrop = hosts(root, 'ExpoImage').find((n) => n.props.accessibilityLabel === 'Foto de Charizard')?.parent;
    expect(backdrop?.type).toBe('View');
    expect(backdrop?.props.role).toBeUndefined();
    await act(async () => (backdrop!.props.onResponderRelease as () => void)());
    expect(byLabel(root, 'Fechar a foto')).toBeUndefined();
  });

  it('folha: o foco entra nela e volta à célula que a abriu', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    ready({ 6: [charizard, sameYear] });
    const root = await open({ q: 'charizard' });
    const cell = baseSetCell(root)!;
    await press(cell);
    expect(focus).toHaveBeenCalledTimes(1);
    await press(byLabel(root, 'Fechar'));
    expect(focus).toHaveBeenCalledTimes(2);
    expect(focus.mock.calls[1][0]).toBeTruthy();
    expect(focus.mock.calls[1][0]).not.toBe(focus.mock.calls[0][0]);
    expect(focus.mock.calls[1][1]).toBe('focus');
  });

  it('filtros: o foco entra no painel e volta ao botão ao fechar', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    const root = await open({ q: 'charizard' });
    const button = byText(root, '+ Filtros')!;
    const marker = { botão: 'filtros' };
    await act(async () => (button.props.onPress as (e: object) => void)({ currentTarget: marker }));
    expect(root.container.queryAll((n: TestInstance) => n.props.role === 'dialog' && n.props['aria-label'] === 'Filtros')).toHaveLength(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.calls[0][0]).not.toBe(marker);
    await press(byLabel(root, 'Fechar os filtros'));
    expect(focus).toHaveBeenLastCalledWith(marker, 'focus');
  });
});

describe('na web', () => {
  type WebScreen = { root: Root; run: (fn: () => unknown) => Promise<void>; key: (key: string) => Promise<void>; appState: (s: string) => Promise<void>; keepAwake: jest.Mock };
  const g = globalThis as unknown as { document?: unknown; window: Record<string, unknown> };

  /**
   * A tela carregada como na web (o `Platform.OS` é lido ao abrir cada módulo), com `window` e `document` de mentira. O
   * teste inteiro roda dentro do registro próprio: o react-native carrega cada peça só na hora de usar.
   */
  async function onWeb(params: typeof mockParams, body: (web: WebScreen) => Promise<void>) {
    Object.assign(mockParams, { q: undefined, lang: undefined, pick: undefined }, params);
    const keys = new Set<(e: object) => void>();
    const states = new Set<(s: string) => void>();
    const page = { tagName: 'BODY' };
    g.document = { activeElement: page, body: page };
    g.window.addEventListener = (type: string, fn: (e: object) => void) => type === 'keydown' && keys.add(fn);
    g.window.removeEventListener = (_type: string, fn: (e: object) => void) => keys.delete(fn);
    try {
      await jest.isolateModulesAsync(async () => {
        const RN = jest.requireActual<typeof import('react-native')>('react-native');
        RN.Platform.OS = 'web';
        jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(((_type: string, fn: (s: string) => void) => {
          states.add(fn);
          return { remove: () => states.delete(fn) };
        }) as never);
        const React = jest.requireActual<typeof import('react')>('react');
        mockReact.useEffect = React.useEffect;
        const { createRoot: create } = jest.requireActual<typeof import('test-renderer')>('test-renderer');
        const Screen = jest.requireActual<typeof import('@/app/consulta')>('@/app/consulta').default;
        const keepAwake = jest.requireMock<{ activateKeepAwakeAsync: jest.Mock }>('expo-keep-awake').activateKeepAwakeAsync;
        const root = create();
        const run = (fn: () => unknown) => React.act(async () => void (await fn()));
        await run(() => root.render(React.createElement(Screen)));
        try {
          await body({
            root,
            run,
            keepAwake,
            key: (key) => run(() => [...keys].forEach((fn) => fn({ key, preventDefault: () => {} }))),
            appState: (s) => run(() => [...states].forEach((fn) => fn(s))),
          });
        } finally {
          await run(() => root.unmount());
        }
      });
    } finally {
      mockReact.useEffect = null;
      delete g.document;
      delete g.window.addEventListener;
      delete g.window.removeEventListener;
    }
  }

  const webPress = (web: WebScreen, node: TestInstance | undefined) => {
    if (!node) throw new Error('alvo de toque não encontrado');
    return web.run(() => (node.props.onPress as () => void)());
  };
  const headings = (root: Root) => root.container.queryAll((n: TestInstance) => n.props.role === 'heading');
  const liveText = (root: Root) => textOf(root.container.queryAll((n: TestInstance) => n.props['aria-live'] === 'polite' && n.props.accessibilityLiveRegion === 'polite')[0]);

  it('todo título tem nível: h1 só o da tela, h2 os grupos e a carta, h3 dentro dos filtros', async () => {
    ready({ 6: [charizard, sameYear] });
    await onWeb({ q: 'charizard' }, async (web) => {
      const level = (label: string) => headings(web.root).find((n) => n.props.accessibilityLabel === label || textOf(n) === label)?.props['aria-level'];
      expect(level('Consulta')).toBe(1);
      expect(level('1999, 2 cartas')).toBe(2);
      await webPress(web, byText(web.root, '+ Filtros'));
      expect(level('Filtros')).toBe(2);
      expect(level('Ano')).toBe(3);
      for (const h of headings(web.root)) expect(h.props['aria-level']).toBeDefined();
      expect(headings(web.root).filter((n) => n.props['aria-level'] === 1)).toHaveLength(1);
    });
  });

  it('a carta aberta tem título h2', async () => {
    ready({ 6: [charizard, sameYear] });
    await onWeb({ q: 'charizard' }, async (web) => {
      await webPress(web, baseSetCell(web.root));
      expect(headings(web.root).find((n) => textOf(n) === 'Charizard')?.props['aria-level']).toBe(2);
    });
  });

  it('volta para a aba: pede a tela acesa de novo (o navegador solta ao esconder)', async () => {
    await onWeb({ q: 'charizard' }, async (web) => {
      expect(web.keepAwake).toHaveBeenCalledTimes(1);
      await web.appState('background');
      await web.appState('active');
      expect(web.keepAwake).toHaveBeenCalledTimes(2);
      expect(web.keepAwake).toHaveBeenLastCalledWith('consulta');
    });
  });

  it('celular: Esc fecha os filtros e a folha da carta', async () => {
    ready({ 6: [charizard, sameYear] });
    await onWeb({ q: 'charizard' }, async (web) => {
      const dialogs = () => web.root.container.queryAll((n: TestInstance) => n.props.role === 'dialog');
      await webPress(web, byText(web.root, '+ Filtros'));
      expect(dialogs()).toHaveLength(1);
      await web.key('Escape');
      expect(dialogs()).toHaveLength(0);
      await webPress(web, baseSetCell(web.root));
      expect(dialogs()).toHaveLength(1);
      await web.key('Escape');
      expect(dialogs()).toHaveLength(0);
    });
  });

  it('celular: com a folha aberta, o que fica atrás fica `inert`', async () => {
    ready({ 6: [charizard, sameYear] });
    await onWeb({ q: 'charizard' }, async (web) => {
      const inert = () => web.root.container.queryAll((n: TestInstance) => n.props.inert === true);
      expect(inert()).toHaveLength(0);
      await webPress(web, baseSetCell(web.root));
      expect(inert()).toHaveLength(2);
      await web.key('Escape');
      expect(inert()).toHaveLength(0);
    });
  });

  it('computador: Esc na foto grande fecha só a foto, e a carta fica no painel', async () => {
    Object.assign(mockWindow, { width: 1280, height: 900 });
    ready({ 6: [charizard, sameYear] });
    await onWeb({ q: 'charizard' }, async (web) => {
      const panel = () => textOf(web.root.container.queryAll((n: TestInstance) => n.props.role === 'complementary')[0]);
      await webPress(web, baseSetCell(web.root));
      expect(panel()).toContain('4/102 · BS');
      await webPress(web, byLabel(web.root, 'Ver a foto grande de Charizard'));
      await web.key('Escape');
      expect(panel()).toContain('4/102 · BS');
      await webPress(web, byLabel(web.root, 'Fechar a foto'));
      await web.key('Escape');
      expect(panel()).toContain('Escolha uma carta');
    });
  });

  it('computador: o cursor e a carta aberta no painel são ditos pela região "ao vivo"', async () => {
    Object.assign(mockWindow, { width: 1280, height: 900 });
    ready({ 6: [charizard, sameYear] });
    await onWeb({ q: 'charizard' }, async (web) => {
      expect(liveText(web.root)).toBe('2 cartas');
      await web.key('ArrowRight');
      expect(liveText(web.root)).toMatch(/^Charizard, .*número 4\/102/);
      await web.key('Enter');
      expect(liveText(web.root)).toMatch(/^Aberta ao lado: Charizard, .*número 4\/102/);
    });
  });
});
