import { act, createElement } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import CardScreen from '@/app/card';
import { cardDetail, type CardDetail } from '@/lib/tcgdex';
import type { Entry } from '@/lib/types';
import { saveCollectionNow } from '@/store/collection';
import { colors, semantic } from '@/theme';

import { entry, settings } from './fixtures';

// Tela da carta: link com parâmetros errados, texto salvo ao sair do app, título ao colocar, nome e valor pago.

const mockParams: { value: Record<string, string | undefined> } = { value: {} };
const mockTitles: string[] = [];
const mockStore: { entries: Record<string, Entry>; listeners: Set<() => void> } = { entries: {}, listeners: new Set() };
const mockSettings = settings();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true },
  Stack: {
    Screen: ({ options }: { options?: { headerTitle?: string } }) => {
      if (options?.headerTitle) mockTitles.push(options.headerTitle);
      return null;
    },
  },
  useLocalSearchParams: () => mockParams.value,
  useNavigation: () => ({ getState: () => ({ routes: [] }) }),
}));
// O título da barra vira um componente (números na fonte do sistema): aqui, só o texto dele.
jest.mock('@/components/header-title', () => ({ headerTitleFor: (text: string) => text }));
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
jest.mock('@/store/collection', () => {
  const React = jest.requireActual('react');
  const keyOf = (b: string | undefined, dex: number, slot: number) => (b ? `${b}:${slot}` : `${dex}-${slot}`);
  const subscribe = (fn: () => void) => {
    mockStore.listeners.add(fn);
    return () => mockStore.listeners.delete(fn);
  };
  const useEntries = () => React.useSyncExternalStore(subscribe, () => mockStore.entries);
  const put = (e: Entry) => {
    mockStore.entries = { ...mockStore.entries, [e.id]: e };
    mockStore.listeners.forEach((fn) => fn());
  };
  const actions = {
    saveEntry: jest.fn(async (input: Omit<Entry, 'id' | 'updatedAt'>) => put({ ...input, id: keyOf(input.binderId, input.dex, input.slot), updatedAt: 'agora' } as Entry)),
    removeEntry: jest.fn(async () => {}),
    restoreEntry: jest.fn(async () => {}),
    moveEntryTo: jest.fn(async () => {}),
    setActiveBinder: jest.fn(async () => {}),
  };
  return {
    keyOf,
    saveCollectionNow: jest.fn(async () => {}),
    useBinders: () => [],
    useCollectionActions: () => actions,
    useCollectionReady: () => true,
    useEntries,
    useEntry: (id?: string) => useEntries()[id ?? ''],
    useSettings: () => mockSettings,
    useSyncStatus: () => ({ state: 'ok', pending: 0 }),
  };
});
jest.mock('@/components/card-image', () => ({ CardImage: () => null }));
jest.mock('@/components/price-panel', () => ({ PricePanel: () => null }));
jest.mock('@/components/card-move', () => ({ CardMovePanel: () => null }));
jest.mock('@/components/card-facts', () => ({ CardAttributes: () => null, CardMoves: () => null, cardAttributeItems: () => [] }));
jest.mock('@/components/version-picker', () => ({ VersionPicker: () => null }));
jest.mock('@/components/binder-slot', () => ({ isSpecialCard: () => false }));
jest.mock('@/components/owned-badge', () => ({ ownershipOf: () => null }));
jest.mock('@/lib/add-card', () => ({ isCopyOf: () => false, japaneseProductOf: () => undefined }));
jest.mock('@/lib/myp-api', () => ({ mypApiDue: () => false, prioritizeMypPrice: jest.fn(), mypPtImage: () => undefined }));
jest.mock('@/lib/stamp-image', () => ({ useStampImage: () => undefined }));
jest.mock('@/lib/variants', () => ({
  ...jest.requireActual('@/lib/variants'),
  availableVariants: () => ({ ids: ['normal'], stamps: [] }),
  cardVersions: jest.fn(async () => []),
  versionOptions: () => [],
}));
jest.mock('@/lib/tcgdex', () => ({ ...jest.requireActual('@/lib/tcgdex'), cardDetail: jest.fn() }));
jest.mock('@/lib/tcgplayer', () => ({ ...jest.requireActual('@/lib/tcgplayer'), catalogOnlyVariant: jest.fn(async () => undefined) }));

const detailFetch = jest.mocked(cardDetail);
const { saveEntry } = jest.requireMock('@/store/collection').useCollectionActions() as { saveEntry: jest.Mock };

function detail(over: Partial<CardDetail> = {}): CardDetail {
  return {
    id: 'sv03.5-025',
    localId: '025',
    name: 'Pikachu',
    rarity: 'Common',
    image: 'https://assets.tcgdex.net/pt/sv/sv03.5/025',
    dexId: [25],
    set: { id: 'sv03.5', name: '151', cardCount: { official: 165, total: 207 } },
    ...over,
  } as CardDetail;
}

const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const screenText = (root: Root) => root.container.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join(' ');
const hosts = (root: Root, type: string) => root.container.queryAll((n: TestInstance) => n.type === type);
const inputNamed = (root: Root, label: string) => hosts(root, 'TextInput').find((n) => n.props.accessibilityLabel === label);
const pressableWith = (root: Root, text: string) => hosts(root, 'Pressable').find((n) => textOf(n).includes(text));

const roots: Root[] = [];
async function open(params: Record<string, string | undefined>) {
  mockParams.value = params;
  const root = createRoot();
  roots.push(root);
  await act(async () => root.render(createElement(CardScreen)));
  return root;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockStore.entries = {};
  mockTitles.length = 0;
  detailFetch.mockReset().mockResolvedValue(detail());
  saveEntry.mockClear();
  jest.mocked(saveCollectionNow).mockClear();
  jest.mocked(AppState.addEventListener).mockClear();
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  jest.useRealTimers();
});

describe('link com parâmetros errados', () => {
  it.each([
    ['bolso que não é número', { cardId: 'sv03.5-025', dex: '25', slot: 'abc' }],
    ['sem dex nem bolso', { cardId: 'sv03.5-025' }],
    ['idioma que o app não tem', { cardId: 'sv03.5-025', dex: '25', slot: '0', lang: 'ko' }],
  ])('%s: "Bolso vazio", sem "Colocar" e sem gravar nada', async (_name, params) => {
    const root = await open(params);
    expect(screenText(root)).toContain('Bolso vazio');
    expect(pressableWith(root, 'Colocar')).toBeUndefined();
    expect(detailFetch).not.toHaveBeenCalled();
    expect(saveEntry).not.toHaveBeenCalled();
  });
});

describe('carta salva', () => {
  it('app em segundo plano antes dos 700 ms: o "Meu valor" é salvo e gravado no aparelho na hora', async () => {
    mockStore.entries = { '25-0': entry() };
    const root = await open({ dex: '25', slot: '0' });
    await act(async () => (inputNamed(root, 'Meu valor em reais')!.props.onChangeText as (t: string) => void)('50'));
    expect(saveEntry).not.toHaveBeenCalled();

    const onChange = jest.mocked(AppState.addEventListener).mock.calls.filter(([type]) => type === 'change').map(([, fn]) => fn);
    expect(onChange.length).toBeGreaterThan(0);
    await act(async () => onChange.forEach((fn) => fn('background')));

    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(saveEntry.mock.calls[0][0].myValue?.value).toBe(50);
    expect(saveCollectionNow).toHaveBeenCalled();
    // O salvamento de 700 ms depois não repete a gravação.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(saveEntry).toHaveBeenCalledTimes(1);
  });

  it('nome com número: os algarismos saem da Kanit', async () => {
    mockStore.entries = { '137-0': entry({ id: '137-0', dex: 137, cardName: 'Porygon2', cardId: 'neo2-9' }) };
    detailFetch.mockResolvedValue(detail({ id: 'neo2-9', name: 'Porygon2', localId: '9', dexId: [233] }));
    const root = await open({ dex: '137', slot: '0' });
    const title = hosts(root, 'Text').find((n) => n.props.role === 'heading' && textOf(n) === 'Porygon2');
    expect(title).toBeDefined();
    const digits = title!.queryAll((n: TestInstance) => n.type === 'Text' && textOf(n) === '2');
    expect(digits.length).toBeGreaterThan(0);
  });

  it('"Pagou … vale …": o dinheiro fica branco e só a porcentagem tem a cor da alta', async () => {
    mockStore.entries = { '25-0': entry({ origin: 'purchase', purchasePrice: 50, myValue: { value: 80, setAt: '2026-10-20T12:00:00.000Z' } }) };
    const root = await open({ dex: '25', slot: '0' });
    const paid = hosts(root, 'Text').find((n) => textOf(n).startsWith('Pagou'));
    expect(paid).toBeDefined();
    expect(StyleSheet.flatten(paid!.props.style).color).toBe(semantic.money.fg);
    const pct = paid!.queryAll((n: TestInstance) => n.type === 'Text' && n !== paid && textOf(n).includes('%'));
    expect(pct).toHaveLength(1);
    expect(textOf(pct[0])).toContain('+60');
    expect(StyleSheet.flatten(pct[0].props.style).color).toBe(semantic.gain.fg);
    expect(semantic.gain.fg).not.toBe(colors.text);
  });

  it('número da Jungle como impresso: "1/64"', async () => {
    mockStore.entries = { '36-0': entry({ id: '36-0', dex: 36, cardName: 'Clefable', cardId: 'base2-1', setId: 'base2', localId: '1' }) };
    detailFetch.mockResolvedValue(detail({ id: 'base2-1', name: 'Clefable', localId: '1', dexId: [36], set: { id: 'base2', name: 'Jungle', cardCount: { official: 64, total: 64 } } } as Partial<CardDetail>));
    const root = await open({ dex: '36', slot: '0' });
    expect(screenText(root)).toContain('Jungle · 1/64');
    expect(screenText(root)).not.toContain('1/064');
  });
});

describe('carta salva com o nome antigo do selo (dp5-42 "Pre Release")', () => {
  const { cardVersions } = jest.requireMock<{ cardVersions: jest.Mock }>('@/lib/variants');
  afterEach(() => cardVersions.mockReset().mockResolvedValue([]));
  const old = () =>
    entry({ id: '25-0', cardId: 'dp5-42', setId: 'dp5', localId: '42', variant: 'wPromo', variantNote: 'Pre Release', stampKeys: ['pre-release'] });
  /** Digita o "Meu valor" e espera o salvamento automático (700 ms). */
  async function autosave(root: Root) {
    await act(async () => (inputNamed(root, 'Meu valor em reais')!.props.onChangeText as (t: string) => void)('50'));
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
  }

  it('o salvamento automático grava os selos da versão de hoje ("prerelease"), não apaga os selos', async () => {
    cardVersions.mockResolvedValue([
      { variant: 'holo' },
      { variant: 'staff', stamp: 'Pré-release', stampKeys: ['prerelease'] },
      { variant: 'staff', stamp: 'Pré-release + Staff', stampKeys: ['prerelease', 'staff'] },
    ]);
    mockStore.entries = { '25-0': old() };
    const root = await open({ dex: '25', slot: '0' });
    await autosave(root);
    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(saveEntry.mock.calls[0][0]).toMatchObject({ variant: 'wPromo', variantNote: 'Pre Release', stampKeys: ['prerelease'] });
  });

  it('nenhuma versão de hoje bate: ficam os selos salvos', async () => {
    cardVersions.mockResolvedValue([{ variant: 'holo' }, { variant: 'wPromo', stamp: 'Pokémon Center', stampKeys: ['pokemon-center'] }, { variant: 'wPromo', stamp: 'GameStop', stampKeys: ['gamestop'] }]);
    mockStore.entries = { '25-0': old() };
    const root = await open({ dex: '25', slot: '0' });
    await autosave(root);
    expect(saveEntry.mock.calls[0][0].stampKeys).toEqual(['pre-release']);
  });

  it('tocar na mesma versão na lista só abre a ficha (não é troca de carta)', async () => {
    cardVersions.mockResolvedValue([{ variant: 'holo' }, { variant: 'staff', stamp: 'Pré-release', stampKeys: ['prerelease'] }]);
    mockStore.entries = { '25-0': old() };
    await open({ cardId: 'dp5-42', dex: '25', slot: '0', lang: 'pt', variant: 'staff', stamp: 'Pré-release' });
    expect(mockTitles).not.toContain('Substituir carta');
    expect(mockTitles).not.toContain('Colocar carta');
  });
});

describe('colocar carta', () => {
  it('bolso vazio: o título fica "Colocar carta" enquanto a carta entra (não vira "Substituir carta")', async () => {
    const root = await open({ cardId: 'sv03.5-025', dex: '25', slot: '0', lang: 'pt', name: 'Pikachu' });
    expect(mockTitles.at(-1)).toBe('Colocar carta');
    const place = pressableWith(root, 'Colocar');
    expect(place).toBeDefined();
    await act(async () => (place!.props.onPress as () => void)());
    expect(saveEntry).toHaveBeenCalledTimes(1);
    // A carta nova já está no bolso e a tela ainda não fechou.
    expect(mockStore.entries['25-0']).toBeDefined();
    expect(mockTitles).not.toContain('Substituir carta');
    expect(mockTitles.at(-1)).toBe('Colocar carta');
  });

  it('carta japonesa só do catálogo sem versão escolhida: salva a variação das impressões do produto', async () => {
    const { catalogOnlyVariant } = jest.requireMock<{ catalogOnlyVariant: jest.Mock }>('@/lib/tcgplayer');
    catalogOnlyVariant.mockImplementation(async (c: { id: string }) => (c.id === 'tcgp-605896' ? 'holo' : undefined));
    const root = await open({ cardId: 'tcgp-605896', dex: '6', slot: '0', lang: 'ja', name: 'Charizard' });
    await act(async () => (pressableWith(root, 'Colocar')!.props.onPress as () => void)());
    expect(catalogOnlyVariant).toHaveBeenCalledWith({ id: 'tcgp-605896', lang: 'ja', stamp: undefined });
    expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'tcgp-605896', variant: 'holo' }));
    catalogOnlyVariant.mockReset().mockResolvedValue(undefined);
  });

  it('bolso com outra carta: o título continua "Substituir carta" durante a troca', async () => {
    mockStore.entries = { '25-0': entry({ cardId: 'sv01-050', cardName: 'Raichu' }) };
    const root = await open({ cardId: 'sv03.5-025', dex: '25', slot: '0', lang: 'pt', name: 'Pikachu' });
    expect(mockTitles.at(-1)).toBe('Substituir carta');
    await act(async () => (pressableWith(root, 'Substituir')!.props.onPress as () => void)());
    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(mockTitles.at(-1)).toBe('Substituir carta');
  });
});
