import { act, createElement } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import CardScreen from '@/app/card';
import { FACTS_WAIT_MS } from '@/components/collector-facts';
import { catalogByTcgdexIds, type CatalogRow } from '@/lib/catalog';
import { cardDetail, setFacts, type CardDetail } from '@/lib/tcgdex';
import type { Entry } from '@/lib/types';
import { saveCollectionNow } from '@/store/collection';
import { colors, semantic } from '@/theme';

import { entry, settings } from './fixtures';

// Tela da carta: link com parâmetros errados, texto salvo ao sair do app, título ao colocar, nome e valor pago, bloco
// "Para colecionador" e ano do título.

const mockParams: { value: Record<string, string | undefined> } = { value: {} };
const mockTitles: string[] = [];
const mockStore: { entries: Record<string, Entry>; listeners: Set<() => void> } = { entries: {}, listeners: new Set() };
const mockSettings = settings();
// Props do quadro de preço (os links das lojas).
const mockPanel: { props?: { ligaUrl?: string; mypSearchUrl?: string } } = {};
// Props do seletor de versões (aberto ou não, e as versões).
const mockPicker: { props?: { visible: boolean; options: unknown[] } } = {};

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
jest.mock('@/components/price-panel', () => ({
  PricePanel: (props: { ligaUrl?: string; mypSearchUrl?: string }) => {
    mockPanel.props = props;
    return null;
  },
}));
jest.mock('@/components/card-move', () => ({ CardMovePanel: () => null }));
jest.mock('@/components/card-facts', () => ({
  CardAttributes: () => null,
  CardMoves: () => null,
  cardAttributeItems: () => [],
  hasCardFacts: jest.requireActual('@/components/card-facts').hasCardFacts,
}));
jest.mock('@/components/version-picker', () => ({
  VersionPicker: (props: { visible: boolean; options: unknown[] }) => {
    mockPicker.props = props;
    return null;
  },
}));
jest.mock('@/components/binder-slot', () => ({ isSpecialCard: () => false }));
jest.mock('@/components/owned-badge', () => ({ ownershipOf: () => null }));
jest.mock('@/lib/add-card', () => ({ isCopyOf: () => false, japaneseProductOf: () => undefined }));
jest.mock('@/lib/myp-api', () => ({ mypApiDue: () => false, prioritizeMypPrice: jest.fn(), mypPtImage: () => undefined }));
jest.mock('@/lib/stamp-image', () => ({ useStampImage: () => undefined }));
jest.mock('@/lib/variants', () => ({
  ...jest.requireActual('@/lib/variants'),
  availableVariants: () => ({ ids: ['normal'], stamps: [] }),
  // As versões que a tela junta (TCGdex + catálogo): cada teste diz quais são.
  withCatalogVersions: jest.fn(() => []),
  versionOptions: jest.fn(() => []),
}));
jest.mock('@/lib/tcgdex', () => ({
  ...jest.requireActual('@/lib/tcgdex'),
  cardDetail: jest.fn(),
  setFacts: jest.fn(async () => ({})),
  setNameIn: jest.fn(async () => undefined),
}));
jest.mock('@/lib/catalog', () => ({ ...jest.requireActual('@/lib/catalog'), catalogByTcgdexIds: jest.fn(async () => []) }));
jest.mock('@/lib/ja-catalog', () => ({ ...jest.requireActual('@/lib/ja-catalog'), japaneseGroupFor: jest.fn(async () => undefined) }));
jest.mock('@/lib/tcgplayer', () => ({ ...jest.requireActual('@/lib/tcgplayer'), catalogOnlyVariant: jest.fn(async () => undefined) }));

const detailFetch = jest.mocked(cardDetail);
const factsFetch = jest.mocked(setFacts);
const catalogFetch = jest.mocked(catalogByTcgdexIds);
const { withCatalogVersions, versionOptions } = jest.requireMock<{ withCatalogVersions: jest.Mock; versionOptions: jest.Mock }>('@/lib/variants');
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
  factsFetch.mockReset().mockResolvedValue({});
  catalogFetch.mockReset().mockResolvedValue([]);
  withCatalogVersions.mockReset().mockReturnValue([]);
  versionOptions.mockReset().mockReturnValue([]);
  mockPicker.props = undefined;
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

describe('links das lojas', () => {
  it('japonesa do catálogo (Dark Kadabra, Rocket Gang): Liga e MYP pelo nome da carta, não só "Kadabra"', async () => {
    mockStore.entries = {
      '64-0': entry({ id: '64-0', dex: 64, lang: 'ja', cardId: 'tcgp-575766', cardName: 'Dark Kadabra', setName: 'Rocket Gang', setId: 'tcgp23724', localId: '', rarity: 'Uncommon' }),
    };
    detailFetch.mockRejectedValue(new Error('sem ficha'));
    await open({ dex: '64', slot: '0' });
    expect(mockPanel.props?.ligaUrl).toBe('https://www.ligapokemon.com.br/?view=cards/search&card=Dark%20Kadabra');
    // A API do MYP não tem japonesas: a busca do site, só em japonês (7), em vez da página inicial.
    expect(mockPanel.props?.mypSearchUrl).toBe('https://mypcards.com/pokemon?ProdutoSearch%5Bquery%5D=Dark%20Kadabra&ProdutoSearch%5BidiomasSelecionados%5D%5B%5D=7');
  });

  it('japonesa com o nome em japonês (TCGdex): o nome do Pokémon em inglês', async () => {
    mockStore.entries = { '64-0': entry({ id: '64-0', dex: 64, lang: 'ja', cardId: 'neo1-30', cardName: 'わるいユンゲラー', localId: '' }) };
    detailFetch.mockRejectedValue(new Error('sem ficha'));
    await open({ dex: '64', slot: '0' });
    expect(mockPanel.props?.ligaUrl).toBe('https://www.ligapokemon.com.br/?view=cards/search&card=Kadabra');
    expect(mockPanel.props?.mypSearchUrl).toContain('ProdutoSearch%5Bquery%5D=Kadabra&');
  });

  it('em português: Liga pelo nome em inglês com o número; MYP pelo nome em português, só em português (1)', async () => {
    mockStore.entries = { '25-0': entry() };
    await open({ dex: '25', slot: '0' });
    expect(mockPanel.props?.ligaUrl).toBe('https://www.ligapokemon.com.br/?view=cards/search&card=Pikachu%20(025%2F165)');
    expect(mockPanel.props?.mypSearchUrl).toBe('https://mypcards.com/pokemon?ProdutoSearch%5Bquery%5D=Pikachu&ProdutoSearch%5BidiomasSelecionados%5D%5B%5D=1');
  });

  const LIGA = 'https://www.ligapokemon.com.br/?view=cards/search&card=';

  it('japonesa antiga (PMCG1-021, sem número impresso): Liga só pelo nome, nunca "(021/102)"', async () => {
    mockStore.entries = { '6-0': entry({ id: '6-0', dex: 6, lang: 'ja', cardId: 'PMCG1-021', cardName: 'リザードン', setId: 'PMCG1', localId: '021', setTotal: 102 }) };
    detailFetch.mockRejectedValue(new Error('sem ficha'));
    await open({ dex: '6', slot: '0' });
    expect(mockPanel.props?.ligaUrl).toBe(`${LIGA}Charizard`);
  });

  it('Coleção Clássica de 30 anos (30th-c-003) sem a busca salva: só o nome, nunca "(003/030)" nem o número do catálogo', async () => {
    mockStore.entries = {
      '376-0': entry({ id: '376-0', dex: 376, cardId: '30th-c-003', cardName: 'Metagross', setId: '30th-c', setName: 'Coleção Clássica de 30 Anos', localId: '003', setTotal: 30 }),
    };
    detailFetch.mockResolvedValue(
      detail({ id: '30th-c-003', localId: '003', name: 'Metagross', dexId: [376], set: { id: '30th-c', name: 'Coleção Clássica de 30 Anos', cardCount: { official: 30, total: 30 } } }),
    );
    await open({ dex: '376', slot: '0' });
    expect(mockPanel.props?.ligaUrl).toBe(`${LIGA}Metagross`);
  });

  it('a busca salva da Liga continua valendo ("Charizard (004/30)")', async () => {
    mockStore.entries = { '6-0': entry({ id: '6-0', dex: 6, cardId: '30th-c-001', cardName: 'Charizard', setId: '30th-c', localId: '001', setTotal: 30, ligaQuery: 'Charizard (004/30)' }) };
    detailFetch.mockResolvedValue(detail({ id: '30th-c-001', localId: '001', name: 'Charizard', dexId: [6], set: { id: '30th-c', name: '30th Classic Collection', cardCount: { official: 30, total: 30 } } }));
    await open({ dex: '6', slot: '0' });
    expect(mockPanel.props?.ligaUrl).toBe(`${LIGA}Charizard%20(004%2F30)`);
  });

  it('"Yellow A Alternate" (xya, total 6 da TCGdex): só o nome, nunca "(54a/06)"', async () => {
    mockStore.entries = { '145-0': entry({ id: '145-0', dex: 145, lang: 'en', cardId: 'xya-54a', cardName: 'Zapdos', setId: 'xya', localId: '54a', setTotal: 6 }) };
    detailFetch.mockResolvedValue(detail({ id: 'xya-54a', localId: '54a', name: 'Zapdos', dexId: [145], set: { id: 'xya', name: 'Yellow A Alternate', cardCount: { official: 6, total: 6 } } }));
    await open({ dex: '145', slot: '0' });
    expect(mockPanel.props?.ligaUrl).toBe(`${LIGA}Zapdos`);
  });

  it('coleção japonesa comum que termina em "P" (SV2P): a Liga com o número que a tela mostra, "045/071"', async () => {
    mockStore.entries = { '460-0': entry({ id: '460-0', dex: 460, lang: 'ja', cardId: 'SV2P-045', cardName: 'Abomasnow', setId: 'SV2P', localId: '045', setTotal: 71 }) };
    detailFetch.mockRejectedValue(new Error('sem ficha'));
    const root = await open({ dex: '460', slot: '0' });
    expect(screenText(root)).toContain('045/071');
    expect(mockPanel.props?.ligaUrl).toBe(`${LIGA}Abomasnow%20(045%2F071)`);
  });

  it('treinador japonês com o nome só em japonês: sem link da Liga e o MYP na página inicial (as lojas cadastram em inglês)', async () => {
    mockStore.entries = { '0-0': entry({ id: '0-0', dex: 0, lang: 'ja', cardId: 'SV9a-062', cardName: 'ナンジャモ', setId: 'SV9a', localId: '' }) };
    detailFetch.mockRejectedValue(new Error('sem ficha'));
    // O quadro desta carta substitui as props da anterior.
    mockPanel.props = { ligaUrl: 'anterior', mypSearchUrl: 'anterior' };
    await open({ dex: '0', slot: '0' });
    expect(mockPanel.props?.ligaUrl).toBeUndefined();
    expect(mockPanel.props?.mypSearchUrl).toBeUndefined();
  });
});
describe('carta salva com o nome antigo do selo (dp5-42 "Pre Release")', () => {
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
    withCatalogVersions.mockReturnValue([
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
    withCatalogVersions.mockReturnValue([
      { variant: 'holo' },
      { variant: 'wPromo', stamp: 'Pokémon Center', stampKeys: ['pokemon-center'] },
      { variant: 'wPromo', stamp: 'GameStop', stampKeys: ['gamestop'] },
    ]);
    mockStore.entries = { '25-0': old() };
    const root = await open({ dex: '25', slot: '0' });
    await autosave(root);
    expect(saveEntry.mock.calls[0][0].stampKeys).toEqual(['pre-release']);
  });

  it('tocar na mesma versão na lista só abre a ficha (não é troca de carta)', async () => {
    withCatalogVersions.mockReturnValue([{ variant: 'holo' }, { variant: 'staff', stamp: 'Pré-release', stampKeys: ['prerelease'] }]);
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

describe('"Para colecionador" e o ano do título', () => {
  /** Espera as buscas já resolvidas chegarem à tela. */
  const settle = () => act(async () => {});
  const badgeNamed = (root: Root, spoken: string) => hosts(root, 'View').find((n) => n.props.accessibilityLabel === spoken);
  const heading = (root: Root) => hosts(root, 'Text').find((n) => n.props.role === 'heading' && textOf(n) === 'Para colecionador');

  it('carta salva: o ano da coleção ao lado da raridade, o título do bloco e a data', async () => {
    factsFetch.mockResolvedValue({ day: '2023-09-22', serieId: 'sv', serie: 'Escarlate e Violeta' });
    mockStore.entries = { '25-0': entry() };
    const root = await open({ dex: '25', slot: '0' });
    await settle();
    expect(factsFetch).toHaveBeenCalledWith('sv03.5', 'pt');
    const badge = badgeNamed(root, 'Ano da coleção em inglês: 2023');
    expect(badge).toBeDefined();
    // Na carta em português, a data é a do lançamento em inglês: a tela diz isso também, não só o leitor de tela.
    expect(textOf(badge!)).toBe('2023 · EN');
    expect(heading(root)).toBeDefined();
    const text = screenText(root);
    expect(text).toContain('22/09/2023');
    expect(text).toContain('Lançamento em inglês');
    expect(text).toContain('Escarlate e Violeta');
    // O ano vem depois da raridade e antes de qualquer outro selo.
    const badges = hosts(root, 'Text').map(textOf);
    expect(badges.indexOf('2023 · EN')).toBeGreaterThan(badges.indexOf('Common'));
  });

  it('Coleção Clássica: "4/102" do catálogo no título e no bloco, nunca "CC002"', async () => {
    mockStore.entries = {
      '6-0': entry({ id: '6-0', dex: 6, lang: 'en', cardId: 'cel25cc-CC002', cardName: 'Charizard', setName: 'Celebrations Classic Collection', setId: 'cel25cc', localId: 'CC002' }),
    };
    detailFetch.mockResolvedValue(
      detail({
        id: 'cel25cc-CC002',
        localId: 'CC002',
        name: 'Charizard',
        rarity: 'Classic Collection',
        dexId: [6],
        set: { id: 'cel25cc', name: 'Celebrations Classic Collection', cardCount: { official: 25, total: 25 } },
      }),
    );
    catalogFetch.mockResolvedValue([
      {
        product_id: 250320,
        category: 3,
        group_id: 2931,
        name: 'Charizard',
        full_name: 'Charizard',
        number: '4/102',
        rarity: 'Classic Collection',
        image: '',
        stamp: null,
        tcgdex_id: 'cel25cc-CC002',
        released_on: null,
        tcg_groups: { name: 'Celebrations: Classic Collection', abbr: null, published_on: '2021-10-08' },
      } satisfies CatalogRow,
    ]);
    factsFetch.mockResolvedValue({ day: '2021-10-08', serieId: 'swsh', serie: 'Sword & Shield' });
    const root = await open({ dex: '6', slot: '0' });
    await settle();
    // As linhas do catálogo são pedidas ao abrir, com a data de cada produto.
    expect(catalogFetch).toHaveBeenCalledWith(['cel25cc-CC002'], 3, { released: true });
    const text = screenText(root);
    expect(text).toContain('Celebrations Classic Collection · 4/102');
    expect(text).toContain('Lançamento desta reimpressão');
    expect(text).not.toContain('CC002');
    expect(badgeNamed(root, 'Ano desta reimpressão: 2021')).toBeDefined();
  });

  it('as linhas do catálogo saem ao abrir, sem esperar a ficha em inglês', async () => {
    detailFetch.mockReturnValue(new Promise(() => {}));
    mockStore.entries = { '25-0': entry() };
    await open({ dex: '25', slot: '0' });
    expect(catalogFetch).toHaveBeenCalledWith(['sv03.5-025'], 3, { released: true });
  });

  it('catálogo fora do ar: o seletor de versões abre mesmo assim (carta nova)', async () => {
    catalogFetch.mockRejectedValue(new Error('sem internet'));
    versionOptions.mockReturnValue([{ variant: 'normal' }, { variant: 'reverse' }]);
    withCatalogVersions.mockImplementation((options: unknown[]) => options);
    await open({ cardId: 'sv03.5-025', dex: '25', slot: '0', lang: 'pt', name: 'Pikachu' });
    await settle();
    expect(withCatalogVersions).toHaveBeenCalledWith(expect.any(Array), [], '151');
    expect(mockPicker.props?.visible).toBe(true);
    expect(mockPicker.props?.options).toHaveLength(2);
  });

  it('fonte que não responde: o esboço até FACTS_WAIT_MS, depois as linhas que já existem (sem ano)', async () => {
    factsFetch.mockReturnValue(new Promise(() => {}));
    mockStore.entries = { '25-0': entry() };
    const root = await open({ dex: '25', slot: '0' });
    await settle();
    expect(heading(root)).toBeDefined();
    expect(screenText(root)).not.toContain('Raridade');
    await act(async () => {
      jest.advanceTimersByTime(FACTS_WAIT_MS - 100);
    });
    expect(screenText(root)).not.toContain('Raridade');
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    const text = screenText(root);
    expect(text).toContain('Raridade');
    expect(text).toContain('Número');
    expect(text).not.toContain('Lançamento');
    expect(hosts(root, 'Text').map(textOf)).not.toContain('2023 · EN');
  });

  it('as saídas antecipadas da tela (fichário apagado, bolso vazio) não mudam a ordem dos ganchos', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const gone = await open({ binder: 'apagado', slot: '0' });
    expect(screenText(gone)).toContain('Fichário não encontrado');
    const empty = await open({ dex: '25', slot: '0' });
    expect(screenText(empty)).toContain('Bolso vazio');
    // A carta chega ao bolso com a tela aberta: a tela inteira aparece.
    await act(async () => {
      mockStore.entries = { '25-0': entry() };
      mockStore.listeners.forEach((fn) => fn());
    });
    await settle();
    expect(screenText(empty)).toContain('Para colecionador');
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/order of Hooks|Rendered (more|fewer) hooks/i);
    errors.mockRestore();
  });

  it('no Android, cada informação é uma parada só do leitor de tela: o valor selecionável fica fora da árvore', async () => {
    factsFetch.mockResolvedValue({ day: '2023-09-22', serieId: 'sv', serie: 'Escarlate e Violeta' });
    mockStore.entries = { '25-0': entry() };
    const root = await open({ dex: '25', slot: '0' });
    await settle();
    const cells = hosts(root, 'View').filter((n) => n.props.accessible === true && /^(Coleção|Lançamento em inglês|Número|Raridade): /.test(n.props.accessibilityLabel ?? ''));
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      // Texto selecionável vira um elemento com ação no Android: dentro da célula, o TalkBack pararia nele de novo.
      const values = cell.queryAll((n: TestInstance) => n.type === 'Text' && !!n.props.selectable);
      expect(values).toHaveLength(1);
      expect(values[0].props.importantForAccessibility).toBe('no');
    }
  });

  it('o esboço já tem o tamanho do bloco: uma célula por linha conhecida e a da data, nas mesmas larguras', async () => {
    let answer!: (facts: { day: string }) => void;
    factsFetch.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    mockStore.entries = { '25-0': entry() };
    const root = await open({ dex: '25', slot: '0' });
    await settle();
    const grid = () =>
      heading(root)!.parent!.parent!.queryAll((n: TestInstance) => n.type === 'View' && StyleSheet.flatten(n.props.style)?.flexWrap === 'wrap')[0];
    const widths = () => grid().children.map((c) => (typeof c === 'string' ? '' : String(StyleSheet.flatten(c.props.style)?.width)));
    expect(screenText(root)).not.toContain('Raridade');
    // Coleção, a data (que falta), número, tamanho, raridade e Pokémon: antes eram 3 linhas de esboço (~72 px).
    const before = widths();
    expect(before).toEqual(['100%', '100%', '50%', '100%', '50%', '100%']);
    await act(async () => answer({ day: '2023-09-22' }));
    expect(screenText(root)).toContain('Raridade');
    expect(widths()).toEqual(before);
  });

  it('fora do fichário: o aviso numa linha de selos só dele, e o ano que chega depois não o empurra para baixo', async () => {
    factsFetch.mockResolvedValue({ day: '2023-09-22' });
    mockStore.entries = { '25-1': entry({ id: '25-1', slot: 1 }) };
    const root = await open({ dex: '25', slot: '1' });
    await settle();
    const year = badgeNamed(root, 'Ano da coleção em inglês: 2023');
    expect(year).toBeDefined();
    expect(hosts(root, 'Text').some((n) => textOf(n) === 'Fora do fichário')).toBe(true);
    const yearRow = year!.parent!;
    expect(textOf(yearRow)).toContain('Common');
    expect(yearRow.queryAll((n: TestInstance) => n.type === 'Text' && textOf(n) === 'Fora do fichário')).toHaveLength(0);
  });

  it('carta nova escolhida na lista: a coleção e o número da lista no título enquanto a ficha não chega, e sem internet (T5)', async () => {
    const listed = { cardId: 'base1-4', dex: '6', slot: '0', lang: 'en', name: 'Charizard', setName: 'Base Set', localId: '4' };
    detailFetch.mockReturnValue(new Promise(() => {}));
    const loading = await open(listed);
    await settle();
    expect(screenText(loading)).toContain('Base Set · 4');
    detailFetch.mockRejectedValue(new Error('Network request failed'));
    const offline = await open(listed);
    await settle();
    expect(screenText(offline)).toContain('Sem conexão');
    expect(screenText(offline)).toContain('Base Set · 4');
  });

  it('"Sobre a carta" só com algum fato de jogo (a ficha só do catálogo de um treinador não abre um cartão vazio)', async () => {
    mockStore.entries = { '25-0': entry() };
    const bare = await open({ dex: '25', slot: '0' });
    await settle();
    expect(screenText(bare)).not.toContain('Sobre a carta');
    detailFetch.mockResolvedValue(detail({ category: 'Pokemon', hp: 60 }));
    const full = await open({ dex: '25', slot: '0' });
    await settle();
    expect(screenText(full)).toContain('Sobre a carta');
  });

  it('treinador num bolso livre: sem a linha "Pokémon" do nome dele ("Manectric Spirit Link" não é o Manectric)', async () => {
    mockStore.entries = {
      '0-0': entry({ id: '0-0', dex: 0, slot: 0, lang: 'en', cardId: 'xy4-101', cardName: 'Manectric Spirit Link', setId: 'xy4', setName: 'Phantom Forces', localId: '101' }),
    };
    detailFetch.mockResolvedValue(
      detail({ id: 'xy4-101', localId: '101', name: 'Manectric Spirit Link', category: 'Trainer', rarity: 'Uncommon', dexId: undefined, set: { id: 'xy4', name: 'Phantom Forces', cardCount: { official: 119, total: 124 } } }),
    );
    const root = await open({ dex: '0', slot: '0' });
    await settle();
    expect(heading(root)).toBeDefined();
    expect(screenText(root)).toContain('Phantom Forces');
    expect(screenText(root)).not.toContain('#310');
    expect(screenText(root)).not.toContain('PokéAPI');
  });

  it('"Tentar de novo" busca de novo também o dia e a série da coleção', async () => {
    detailFetch.mockRejectedValue(new Error('Network request failed'));
    factsFetch.mockRejectedValue(new Error('Network request failed'));
    mockStore.entries = { '25-0': entry() };
    const root = await open({ dex: '25', slot: '0' });
    await settle();
    expect(factsFetch).toHaveBeenCalledTimes(1);
    expect(screenText(root)).not.toContain('Lançamento');
    detailFetch.mockResolvedValue(detail());
    factsFetch.mockResolvedValue({ day: '2023-09-22', serieId: 'sv', serie: 'Escarlate e Violeta' });
    await act(async () => (pressableWith(root, 'Tentar de novo')!.props.onPress as () => void)());
    await settle();
    expect(factsFetch).toHaveBeenCalledTimes(2);
    expect(screenText(root)).toContain('22/09/2023');
    expect(screenText(root)).toContain('Escarlate e Violeta');
  });
});
