import { act, createElement } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import SearchScreen from '@/app/search';
import { cardsByCode } from '@/lib/add-card';
import { searchCardsResult, type CardBrief } from '@/lib/tcgdex';

// "+ Carta": trocar entre Nome e Código começa do zero; tocar no modo já escolhido não apaga nada.

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ mode: 'add' }),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: (props: object) => jest.requireActual('react').createElement('LinearGradient', props) }));
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// O alvo de toque com as próprias props, para achar pelo texto e tocar.
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const React = jest.requireActual('react');
  const resolve = (v: unknown) => (typeof v === 'function' ? v({ pressed: false }) : v);
  function PressableMock(props: Record<string, unknown>) {
    return React.createElement('Pressable', { ...props, style: resolve(props.style) }, resolve(props.children));
  }
  return { __esModule: true, default: PressableMock };
});
jest.mock('../modules/card-ocr', () => ({ isOcrAvailable: false }));
jest.mock('@/store/collection', () => ({
  useCollectionReady: () => true,
  useBinders: () => [],
  useSettings: () => null,
  useActiveBinderId: () => undefined,
  useEntry: () => undefined,
  customEntryId: (binder: string, slot: number) => `${binder}:${slot}`,
  entryId: (dex: number, slot: number) => `${dex}:${slot}`,
}));
jest.mock('@/components/add-card-list', () => ({
  CardPickerList: (props: object) => jest.requireActual('react').createElement('CardPickerList', props),
}));
jest.mock('@/components/add-sheet', () => ({
  AddCardSheet: (props: { card: unknown }) => (props.card ? jest.requireActual('react').createElement('AddCardSheet', props) : null),
}));
jest.mock('@/components/card-grid', () => ({ gridContentWidth: () => 358 }));
jest.mock('@/lib/add-card', () => ({ ...jest.requireActual('@/lib/add-card'), cardsByCode: jest.fn() }));
jest.mock('@/lib/tcgdex', () => ({ ...jest.requireActual('@/lib/tcgdex'), searchCardsResult: jest.fn() }));

const byCode = jest.mocked(cardsByCode);
const byName = jest.mocked(searchCardsResult);

const card = { id: 'me01-133', name: 'Eevee' } as CardBrief;

const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const screenText = (root: Root) => root.container.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join(' ');
const hosts = (root: Root, type: string) => root.container.queryAll((n: TestInstance) => n.type === type);
const input = (root: Root) => hosts(root, 'TextInput')[0];
const value = (root: Root) => input(root).props.value as string;
const chip = (root: Root, label: string) => hosts(root, 'Pressable').find((n) => textOf(n) === label);

async function press(root: Root, label: string) {
  const node = chip(root, label);
  if (!node) throw new Error(`chip "${label}" não encontrado`);
  await act(async () => (node.props.onPress as () => void)());
}
async function type(root: Root, text: string) {
  await act(async () => (input(root).props.onChangeText as (t: string) => void)(text));
}
async function submit(root: Root) {
  await act(async () => (input(root).props.onSubmitEditing as () => void)());
}
/** Passa o intervalo da busca (400 ms depois da última tecla). */
async function afterDebounce() {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

const roots: Root[] = [];
async function open() {
  const root = createRoot();
  roots.push(root);
  await act(async () => root.render(createElement(SearchScreen)));
  return root;
}

beforeEach(() => {
  jest.useFakeTimers();
  byCode.mockReset().mockResolvedValue({ cards: [card], partial: false });
  byName.mockReset().mockResolvedValue({ cards: [card], partial: false });
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  jest.useRealTimers();
});

describe('troca entre Nome e Código', () => {
  it('Nome para Código: o nome sai do campo e não vira "Não entendi o código"', async () => {
    const root = await open();
    await type(root, 'Eevee');
    await afterDebounce();
    expect(byName).toHaveBeenCalledTimes(1);

    await press(root, 'Código');
    expect(value(root)).toBe('');
    expect(screenText(root)).not.toContain('Não entendi o código');
    expect(screenText(root)).toContain('Adicionar por código');

    await afterDebounce();
    expect(screenText(root)).not.toContain('Não entendi o código');
  });

  it('tecla ainda no intervalo da busca: o texto antigo não é buscado depois da troca', async () => {
    const root = await open();
    await type(root, 'MEG 133');
    await press(root, 'Código');
    await afterDebounce();
    expect(value(root)).toBe('');
    expect(byCode).not.toHaveBeenCalled();
    expect(byName).not.toHaveBeenCalled();
  });

  it('Código para Nome: o código sai do campo e volta o convite da busca por nome', async () => {
    const root = await open();
    await press(root, 'Código');
    await type(root, 'MEG 133');
    await afterDebounce();
    expect(byCode).toHaveBeenCalledTimes(1);

    await press(root, 'Nome');
    expect(value(root)).toBe('');
    expect(screenText(root)).toContain('Qual carta você quer adicionar?');
    await afterDebounce();
    expect(byName).not.toHaveBeenCalled();
  });

  it('tocar no modo já escolhido mantém o que foi digitado', async () => {
    const root = await open();
    await type(root, 'Eevee');
    await press(root, 'Nome');
    expect(value(root)).toBe('Eevee');
  });

  it('Enter esperando a resposta não abre o "Adicionar" depois de trocar de modo', async () => {
    byCode.mockReturnValueOnce(new Promise(() => {}));
    const root = await open();
    await press(root, 'Código');
    await type(root, 'MEG 133');
    await submit(root);

    await press(root, 'Nome');
    await press(root, 'Código');
    await type(root, 'MEG 133');
    await afterDebounce();
    expect(byCode).toHaveBeenCalledTimes(2);
    expect(hosts(root, 'AddCardSheet')).toHaveLength(0);
  });

  it('sem trocar de modo, o Enter continua abrindo o "Adicionar" com uma carta só', async () => {
    const root = await open();
    await press(root, 'Código');
    await type(root, 'MEG 133');
    await submit(root);
    expect(hosts(root, 'AddCardSheet')).toHaveLength(1);
  });
});
