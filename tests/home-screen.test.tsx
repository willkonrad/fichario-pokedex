import { act, createElement, createRef, type ReactElement } from 'react';
import { BackHandler, Platform, StyleSheet, type TextInputInstance } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import BinderScreen from '@/app/index';
import { HomeSearchInput, suggestionRoom, suggestionsSpeech } from '@/components/home-search';
import { CardPeekSheet, OUTSIDE_PAGE, OutsideCardsSheet } from '@/components/home-sheets';
import { NoticeSlot } from '@/components/home-summary';
import { VALUE_SCOPE } from '@/lib/copy';
import { formatBRLTight } from '@/lib/format';
import { DEFAULT_SETTINGS, type BinderSettings, type Entry } from '@/lib/types';
import { TOUCH, space } from '@/theme';

import { AT, entry, LATER } from './fixtures';

// Tela inicial: preço em rodada sem refazer a conta a cada gravação, "Próxima falta" lida pelo leitor de tela, voltar
// do Android com a busca aberta, ordem de leitura da busca, contagem das sugestões no celular, título do painel,
// esqueleto do computador e a folha das cartas fora do fichário em levas.

const mockWindow = { width: 360, height: 760, scale: 2, fontScale: 1 };
const mockFocus = { value: true };
const mockNavigation = { setParams: jest.fn() };
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
const mockState: { ready: boolean; settings: BinderSettings; entries: Record<string, Entry>; listeners: Set<() => void> } = {
  ready: true,
  settings: DEFAULT_SETTINGS,
  entries: {},
  listeners: new Set(),
};
const mockBinders: never[] = [];
const mockSync = { state: 'idle', pending: 0 };
const mockActions = { setActiveBinder: jest.fn(async () => {}), moveEntryTo: jest.fn(async () => {}), restoreEntry: jest.fn(async () => {}), removeEntry: jest.fn(async () => {}) };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Redirect: () => null,
  Link: ({ children }: { children: unknown }) => children,
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  useNavigation: () => mockNavigation,
  useIsFocused: () => mockFocus.value,
}));
jest.mock('expo-image', () => {
  const Image = (props: object) => jest.requireActual('react').createElement('ExpoImage', props);
  Image.prefetch = jest.fn(async () => true);
  return { Image };
});
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: (props: object) => jest.requireActual('react').createElement('LinearGradient', props) }));
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const React = jest.requireActual('react');
  const resolve = (v: unknown) => (typeof v === 'function' ? v({ pressed: false }) : v);
  function PressableMock(props: Record<string, unknown>) {
    return React.createElement('Pressable', { ...props, style: resolve(props.style) }, resolve(props.children));
  }
  return { __esModule: true, default: PressableMock };
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
// A miniatura não importa aqui (e buscaria a imagem que falta).
jest.mock('@/components/card-image', () => ({ CardImage: () => null, cardImageUrl: () => undefined, prefetchCardImages: () => {} }));
// Recusa do MYP (403): cada teste diz até quando (0 = nenhuma).
jest.mock('@/lib/myp-queue', () => ({ ...jest.requireActual('@/lib/myp-queue'), mypBlockedUntil: jest.fn(() => 0), clearMypBlock: jest.fn() }));
jest.mock('@/store/collection', () => ({
  ...jest.requireActual('@/store/collection'),
  useCollectionReady: () => mockState.ready,
  useSettings: () => mockState.settings,
  useBinders: () => mockBinders,
  useActiveBinderId: () => 'pokedex',
  useCollectionActions: () => mockActions,
  useSession: () => null,
  useSyncStatus: () => mockSync,
  collectionState: () => ({ entries: mockState.entries }),
  subscribeCollection: (fn: () => void) => {
    mockState.listeners.add(fn);
    return () => mockState.listeners.delete(fn);
  },
}));

const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const all = (root: Root) => root.container.queryAll(() => true);
const statusTexts = (root: Root) => root.container.queryAll((n: TestInstance) => n.type === 'Text' && n.props.role === 'status').map(textOf);
const pressable = (root: Root, label: string) => root.container.queryAll((n: TestInstance) => n.type === 'Pressable' && n.props.accessibilityLabel === label)[0];
const searchField = (root: Root) => root.container.queryAll((n: TestInstance) => n.type === 'TextInput' && n.props.accessibilityLabel === 'Buscar no fichário')[0];
const screenText = (root: Root) => textOf(root.container);

async function press(root: Root, label: string) {
  const node = pressable(root, label);
  if (!node) throw new Error(`botão "${label}" não encontrado`);
  await act(async () => (node.props.onPress as () => void)());
}

async function setEntries(entries: Record<string, Entry>) {
  await act(async () => {
    mockState.entries = entries;
    mockState.listeners.forEach((l) => l());
  });
}

const roots: Root[] = [];
async function open(element: ReactElement = createElement(BinderScreen)) {
  const root = createRoot();
  roots.push(root);
  await act(async () => root.render(element));
  // A memória de páginas lê o armazenamento do aparelho antes de mostrar a folha.
  await act(async () => {});
  return root;
}

type BackHandlerFn = Parameters<typeof BackHandler.addEventListener>[1];

const OS = Platform.OS;
beforeEach(() => {
  jest.useFakeTimers();
  mockWindow.width = 360;
  mockWindow.height = 760;
  mockFocus.value = true;
  mockState.ready = true;
  mockState.settings = DEFAULT_SETTINGS;
  mockState.entries = {};
});
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  Platform.OS = OS;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Home: rodada de preços', () => {
  it('o preço gravado entra no valor em até 1 s, numa leva; carta nova aparece na hora', async () => {
    const pika = entry({ myValue: { value: 10, setAt: AT } });
    mockState.entries = { [pika.id]: pika };
    const root = await open();
    expect(screenText(root)).toContain(formatBRLTight(10));

    await setEntries({ [pika.id]: { ...pika, myValue: { value: 20, setAt: LATER }, updatedAt: LATER } });
    expect(screenText(root)).toContain(formatBRLTight(10));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screenText(root)).toContain(formatBRLTight(20));

    const eevee = entry({ id: '133-0', dex: 133, cardId: 'sv03.5-133', cardName: 'Eevee', myValue: { value: 5, setAt: AT } });
    await setEntries({ ...mockState.entries, [eevee.id]: eevee });
    expect(screenText(root)).toContain(formatBRLTight(25));
  });
});

describe('Home: leitor de tela', () => {
  it('"Próxima falta" diz o resultado numa região já montada, mesmo sem mudar de página', async () => {
    const root = await open();
    expect(statusTexts(root).every((t) => t === '')).toBe(true);
    await press(root, 'Ir para: próxima falta');
    expect(statusTexts(root)).toContain('Próxima falta: #001 Bulbasaur, pág. 1, bolso 1, destacado');
    await press(root, 'Ir para: próxima falta');
    expect(statusTexts(root)).toContain('Próxima falta: #002 Ivysaur, pág. 1, bolso 2, destacado');
  });

  it('no celular, diz quantas sugestões abriram depois que a pessoa para de digitar', async () => {
    const root = await open();
    await press(root, 'Buscar no fichário');
    await act(async () => (searchField(root).props.onChangeText as (t: string) => void)('char'));
    const options = root.container.queryAll((n: TestInstance) => n.type === 'Pressable' && n.props.role === 'option').length;
    expect(options).toBeGreaterThan(0);
    expect(statusTexts(root)).not.toContain(suggestionsSpeech(options, 'char'));
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(statusTexts(root)).toContain(suggestionsSpeech(options, 'char'));
  });

  it('com a busca aberta, o campo vem logo depois da barra e a linha do valor coberta sai do leitor de tela', async () => {
    const root = await open();
    await press(root, 'Buscar no fichário');
    const nodes = all(root);
    const field = nodes.indexOf(searchField(root));
    const value = nodes.findIndex((n) => n.type === 'Pressable' && String(n.props.accessibilityLabel).startsWith(VALUE_SCOPE.binder));
    expect(field).toBeGreaterThan(-1);
    expect(field).toBeLessThan(value);
    const hidden = root.container.queryAll((n: TestInstance) => n.props['aria-hidden'] === true);
    expect(hidden.some((h) => h.queryAll((n: TestInstance) => n === nodes[value]).length > 0)).toBe(true);
  });
});

describe('Home: voltar do Android', () => {
  it('com a busca aberta, o voltar fecha a busca e não sai do app', async () => {
    Platform.OS = 'android';
    const handlers: BackHandlerFn[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, fn) => {
      handlers.push(fn);
      return { remove: () => handlers.splice(handlers.indexOf(fn), 1) };
    });
    const root = await open();
    expect(handlers).toHaveLength(0);
    await press(root, 'Buscar no fichário');
    expect(searchField(root)).toBeTruthy();
    expect(handlers).toHaveLength(1);
    let handled: boolean | null | undefined;
    await act(async () => {
      handled = handlers[handlers.length - 1]({} as Parameters<BackHandlerFn>[0]);
    });
    expect(handled).toBe(true);
    expect(searchField(root)).toBeUndefined();
    expect(handlers).toHaveLength(0);
  });
});

describe('Home no computador', () => {
  it('o título do painel tem os números na fonte do sistema', async () => {
    mockWindow.width = 1280;
    mockWindow.height = 800;
    mockState.settings = { ...DEFAULT_SETTINGS, name: 'Coleção 151' };
    const root = await open();
    const titles = root.container.queryAll((n: TestInstance) => n.type === 'Text' && n.props.role === 'heading' && textOf(n) === 'Coleção 151');
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t.queryAll((n: TestInstance) => n.type === 'Text' && n !== t && textOf(n) === '151')).toHaveLength(1);
  });

  it.each([
    [360, 59],
    [1280, 67],
  ])('o esqueleto tem a altura da barra de verdade (%i px de largura: %i)', async (width, height) => {
    mockWindow.width = width;
    mockState.ready = false;
    const root = await open();
    const bar = root.container.queryAll((n: TestInstance) => n.type === 'View' && StyleSheet.flatten(n.props.style)?.borderBottomWidth === 3)[0];
    expect(StyleSheet.flatten(bar.props.style).height).toBe(height);
  });
});

describe('Aviso da recusa do MYP', () => {
  it('MYP recusou (403): o Fichário avisa até quando, e "Tentar de novo" libera a próxima consulta', async () => {
    const { mypBlockedUntil, clearMypBlock } = jest.requireMock<{ mypBlockedUntil: jest.Mock; clearMypBlock: jest.Mock }>('@/lib/myp-queue');
    mypBlockedUntil.mockImplementation(() => new Date(AT).getTime() + 24 * 60 * 60_000);
    try {
      const root = await open();
      expect(screenText(root)).toContain('MYP Cards recusou as consultas de preço');
      const retry = root.container.queryAll((n: TestInstance) => n.type === 'Pressable' && textOf(n).includes('Tentar de novo'))[0];
      expect(retry).toBeDefined();
      await act(async () => (retry.props.onPress as () => void)());
      expect(clearMypBlock).toHaveBeenCalledTimes(1);
    } finally {
      mypBlockedUntil.mockImplementation(() => 0);
    }
  });

  it('sem recusa, nenhum aviso do MYP', async () => {
    const root = await open();
    expect(screenText(root)).not.toContain('MYP Cards recusou');
  });
});

describe('Cartas fora do fichário', () => {
  it('mostra as cartas em levas, não todas de uma vez', async () => {
    const list = Array.from({ length: 75 }, (_, i) => entry({ id: `${i + 1}-1`, dex: i + 1, slot: 1, cardName: `Carta ${i + 1}` }));
    const root = await open(
      createElement(OutsideCardsSheet, { visible: true, onClose: () => {}, entries: list, reasonOf: () => 'fora', onOpen: () => {}, onEdit: () => {} }),
    );
    const rows = () => root.container.queryAll((n: TestInstance) => n.type === 'Pressable' && String(n.props.accessibilityLabel).startsWith('Carta ')).length;
    expect(rows()).toBe(OUTSIDE_PAGE);
    expect(screenText(root)).toContain('30 de 75');
    await press(root, 'Ver mais 30 cartas');
    expect(rows()).toBe(60);
    await press(root, 'Ver mais 15 cartas');
    expect(rows()).toBe(75);
    expect(pressable(root, 'Ver mais 15 cartas')).toBeUndefined();
  });
});

describe('Espiar a carta (toque longo no bolso)', () => {
  const setLine = (root: Root, setName: string) => root.container.queryAll((n: TestInstance) => n.type === 'Text' && textOf(n).startsWith(setName)).map(textOf)[0];

  it('coleção e número; japonesa antiga sem número e sem o " · " sobrando', async () => {
    const props = { onClose: () => {}, onOpen: () => {} };
    const pika = await open(createElement(CardPeekSheet, { ...props, entry: entry({ setTotal: 165 }) }));
    expect(setLine(pika, '151')).toBe('151 · 025/165');
    const old = entry({ id: '6-0', dex: 6, cardId: 'PMCG1-021', lang: 'ja', setId: 'PMCG1', setName: '拡張パック', localId: '021', setTotal: 102 });
    const root = await open(createElement(CardPeekSheet, { ...props, entry: old }));
    expect(setLine(root, '拡張パック')).toBe('拡張パック');
  });
});

describe('Busca da home', () => {
  it('"Limpar a busca" devolve o foco ao campo', async () => {
    const ref = createRef<TextInputInstance>();
    const onChangeText = jest.fn();
    const props = { value: 'char', onChangeText, placeholder: '', onSubmit: () => {}, onMove: () => {}, onEscape: () => {}, expanded: false, activeIndex: 0, inputRef: ref };
    const root = await open(createElement(HomeSearchInput, props));
    const focus = jest.spyOn(ref.current as TextInputInstance, 'focus');
    await press(root, 'Limpar a busca');
    expect(onChangeText).toHaveBeenCalledWith('');
    expect(focus).toHaveBeenCalled();
  });

  it('no Android, a lista de sugestões para acima do teclado e da barra de navegação', () => {
    const base = { windowHeight: 800, top: 120, keyboard: 300, bottomInset: 48 };
    expect(suggestionRoom({ ...base, android: true })).toBe(800 - 120 - 300 - 48 - space.lg);
    // No iOS, a altura do teclado já conta a área segura.
    expect(suggestionRoom({ ...base, android: false })).toBe(800 - 120 - 300 - space.lg);
    expect(suggestionRoom({ ...base, keyboard: 0, android: false })).toBe(800 - 120 - 48 - space.lg);
    expect(suggestionRoom({ ...base, top: 700, android: true })).toBe(TOUCH * 2);
  });

  it('a contagem das sugestões muda com o texto, mesmo com o mesmo número', () => {
    expect(suggestionsSpeech(1, 'char')).toBe('1 sugestão para char');
    expect(suggestionsSpeech(5, 'char')).toBe('5 sugestões para char');
    expect(suggestionsSpeech(5, 'pika')).not.toBe(suggestionsSpeech(5, 'char'));
  });
});

describe('Avisos da home no Android', () => {
  it('a região ao vivo não é achatada, vazia ou com aviso', async () => {
    const root = await open(createElement(NoticeSlot, { notice: null }));
    const slot = () => root.container.queryAll((n: TestInstance) => n.type === 'View' && n.props.accessibilityLiveRegion === 'polite')[0];
    expect(slot().props.collapsable).toBe(false);
    await act(async () => root.render(createElement(NoticeSlot, { notice: { text: '2 de 5: Charizard' } })));
    expect(slot().props.collapsable).toBe(false);
    expect(textOf(slot())).toContain('2 de 5: Charizard');
  });
});
