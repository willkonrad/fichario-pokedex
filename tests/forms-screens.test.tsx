import { act, createElement, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import BinderEditScreen from '@/app/binder-edit';
import BindersScreen from '@/app/binders';
import ListsScreen from '@/app/lists';
import SetupScreen from '@/app/setup';
import { TOTAL_SPECIES } from '@/data/pokedex';
import { formatInt } from '@/lib/format';
import type { CustomBinder, Entry } from '@/lib/types';

import { binder, entry } from './fixtures';

// Telas de formulário: o aviso da grade só quando alguma carta muda de lugar, contagens com ponto de milhar, nome de
// fichário com número fora da Kanit e o campo "até" que não sai da linha.

const store: { binders: CustomBinder[]; entries: Record<string, Entry>; params: Record<string, string> } = { binders: [], entries: {}, params: {} };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => store.params,
  useIsFocused: () => true,
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
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
jest.mock('@/components/collection-value', () => ({ HowWeCalculateSheet: () => null, SourceCreditsLine: () => null }));
jest.mock('@/components/add-card-list', () => ({ useIosAnnouncement: () => {} }));
jest.mock('@/components/add-entry-row', () => ({ EntryRow: (props: object) => jest.requireActual('react').createElement('EntryRow', props) }));
jest.mock('@/store/collection', () => {
  const { DEFAULT_SETTINGS, POKEDEX_BINDER } = jest.requireActual('@/lib/types');
  const entriesOf = (entries: Record<string, Entry>, id: string) => Object.values(entries).filter((e) => (e.binderId ?? POKEDEX_BINDER) === id);
  const collection = () => ({
    ready: true,
    settings: DEFAULT_SETTINGS,
    entries: store.entries,
    binders: store.binders,
    activeBinderId: POKEDEX_BINDER,
    setActiveBinder: jest.fn(async () => {}),
    saveBinder: jest.fn(async () => {}),
    deleteBinder: jest.fn(async () => {}),
    saveSettings: jest.fn(async () => {}),
  });
  return {
    entriesOf,
    useCollection: collection,
    useCollectionReady: () => true,
    useSettings: () => DEFAULT_SETTINGS,
    useEntries: () => store.entries,
    useBinders: () => store.binders,
  };
});

const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const texts = (root: Root) => root.container.queryAll((n: TestInstance) => n.type === 'Text', { matchDeepestOnly: false }).map(textOf);
const hosts = (root: Root, type: string) => root.container.queryAll((n: TestInstance) => n.type === type);
const nestedDigits = (n: TestInstance) => n.queryAll((c: TestInstance) => c.type === 'Text').map(textOf);

const roots: Root[] = [];
async function open(screen: () => ReactNode) {
  const root = createRoot();
  roots.push(root);
  await act(async () => root.render(createElement(screen)));
  return root;
}
async function pressChip(root: Root, label: string) {
  const node = hosts(root, 'Pressable').find((n) => textOf(n) === label);
  if (!node) throw new Error(`chip "${label}" não encontrado`);
  await act(async () => (node.props.onPress as () => void)());
}

const inBinder = (slot: number) => entry({ id: `b1:${slot}`, dex: 0, slot, binderId: 'b1' });

beforeEach(() => {
  store.binders = [];
  store.entries = {};
  store.params = {};
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

describe('Personalizar fichário: grade nova', () => {
  it('cartas nos bolsos 1 e 2, de 3×3 para 2×2: continuam no lugar, e a tela não diz que mudam de posição', async () => {
    store.binders = [binder({ rows: 3, cols: 3 })];
    store.entries = { 'b1:0': inBinder(0), 'b1:1': inBinder(1) };
    store.params = { id: 'b1' };
    const root = await open(BinderEditScreen);
    await pressChip(root, '4 (2×2)');
    const all = texts(root).join(' | ');
    expect(all).not.toMatch(/mudam de página|mudam de posição/);
    expect(all).not.toMatch(/mud(a|am) de lugar/);
  });

  it('carta no bolso 5, de 3×3 para 2×2: o aviso perto do Salvar diz quantas mudam de lugar', async () => {
    store.binders = [binder({ rows: 3, cols: 3 })];
    store.entries = { 'b1:0': inBinder(0), 'b1:4': inBinder(4) };
    store.params = { id: 'b1' };
    const root = await open(BinderEditScreen);
    await pressChip(root, '4 (2×2)');
    expect(texts(root).join(' | ')).toContain('1 carta muda de lugar no fichário físico.');
  });

  it('nome com número na prévia da capa: os dígitos saem da Kanit', async () => {
    store.binders = [binder({ name: 'Coleção 151' })];
    store.params = { id: 'b1' };
    const root = await open(BinderEditScreen);
    const name = hosts(root, 'Text').find((n) => textOf(n) === 'Coleção 151' && n.queryAll((c) => c.type === 'Text').length > 0);
    expect(name && nestedDigits(name)).toEqual(['151']);
  });
});

describe('Meus fichários', () => {
  it('contagem com ponto de milhar, como na tela inicial ("3/1.025 Pokémon")', async () => {
    store.entries = { '1-0': entry({ id: '1-0', dex: 1 }), '4-0': entry({ id: '4-0', dex: 4 }), '7-0': entry({ id: '7-0', dex: 7 }) };
    const root = await open(BindersScreen);
    expect(texts(root)).toContain(`3/${formatInt(TOTAL_SPECIES)} Pokémon`);
    const open1 = hosts(root, 'Pressable').find((n) => String(n.props.accessibilityLabel).startsWith('Abrir Fichário Pokédex'));
    expect(open1?.props.accessibilityLabel).toContain(`3 de ${formatInt(TOTAL_SPECIES)} Pokémon`);
  });

  it('fichário "Coleção 151": o número do nome sai da Kanit', async () => {
    store.binders = [binder({ name: 'Coleção 151' })];
    const root = await open(BindersScreen);
    const name = hosts(root, 'Text').find((n) => textOf(n) === 'Coleção 151');
    expect(name && nestedDigits(name)).toEqual(['151']);
  });
});

describe('Listas: Tenho repetida', () => {
  it('título "Para troca · Coleção 151" com o número fora da Kanit; as linhas se alinham ao título (−4 do recuo da linha)', async () => {
    store.binders = [binder({ name: 'Coleção 151', purpose: 'trade' })];
    store.entries = { 'b1:0': inBinder(0) };
    store.params = { tab: 'have' };
    const root = await open(ListsScreen);
    const title = hosts(root, 'Text').find((n) => n.props.role === 'heading' && textOf(n) === 'Para troca · Coleção 151');
    expect(title && nestedDigits(title)).toEqual(['151']);
    const row = hosts(root, 'EntryRow')[0];
    expect(StyleSheet.flatten(row.parent!.props.style).marginHorizontal).toBe(-4);
  });
});

describe('Configurar o fichário Pokédex', () => {
  it('resumo com ponto de milhar ("1.025 Pokémon × 1 = 1.025 espaços")', async () => {
    const root = await open(SetupScreen);
    const total = formatInt(TOTAL_SPECIES);
    expect(texts(root).some((t) => t.startsWith(`${total} Pokémon × 1 = ${total} espaços`))).toBe(true);
  });

  it('campos da faixa com minWidth 0: na web, os dois dividem a linha em vez de sair dela', async () => {
    const root = await open(SetupScreen);
    const until = hosts(root, 'TextInput').find((n) => n.props.accessibilityLabel === 'Até o número da Pokédex')!;
    expect(StyleSheet.flatten(until.props.style)).toEqual(expect.objectContaining({ flex: 1, minWidth: 0 }));
  });

  it('legenda de "Espaços por Pokémon" numa linha só', async () => {
    const root = await open(SetupScreen);
    expect(texts(root)).toContain('Mais de 1 para versões lado a lado');
  });
});

