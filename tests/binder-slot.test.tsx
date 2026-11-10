import { createElement, type ReactElement } from 'react';
import type { Root, TestInstance } from 'test-renderer';

import { isSpecialCard, POCKET_FONT_SCALE } from '@/components/binder-slot';
import { priceAfterPlacingText, pricePendingText } from '@/lib/copy';
import type { Entry } from '@/lib/types';

import { entry, myp } from './fixtures';

// Bolso do fichário: filete foil por raridade, o que ele diz da carta sem preço (celular e web) e o teto da fonte do sistema.

jest.mock('expo-image', () => {
  const Image = (props: object) => jest.requireActual('react').createElement('ExpoImage', props);
  Image.prefetch = jest.fn(async () => true);
  return { Image };
});
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }));
// Como web, o expo-router de verdade lê o `window.location` ao abrir; o bolso só usa o Link quando recebe `href`.
jest.mock('expo-router', () => ({ Link: () => null }));

const IMAGE = 'https://assets.tcgdex.net/en/sv/sv03.5/25';
// Carta em português sem busca no MYP: é a que a web nunca precifica sozinha.
const waiting = (over: Partial<Entry> = {}) => entry({ image: IMAGE, ...over });

type Mods = { slot: typeof import('@/components/binder-slot'); image: typeof import('@/components/card-image') };

/**
 * Desenha num registro de módulos próprio: o `Platform.OS` é lido ao abrir o módulo. O desenho fica dentro do registro
 * porque o react-native carrega cada peça só na hora de usar (fora dele, viria outra cópia do React).
 */
async function renderOn(os: 'android' | 'web', build: (mods: Mods) => ReactElement) {
  let root!: Root;
  await jest.isolateModulesAsync(async () => {
    jest.requireActual<typeof import('react-native')>('react-native').Platform.OS = os;
    const { act } = jest.requireActual<typeof import('react')>('react');
    const { createRoot } = jest.requireActual<typeof import('test-renderer')>('test-renderer');
    const mods: Mods = { slot: jest.requireActual('@/components/binder-slot'), image: jest.requireActual('@/components/card-image') };
    root = createRoot();
    await act(async () => root.render(build(mods)));
  });
  return root;
}

const pocket = (os: 'android' | 'web', e: Entry, width = 120) =>
  renderOn(os, ({ slot }) => createElement(slot.BinderSlot, { width, entry: e, onPress: () => {} }));

const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const texts = (root: Root) => root.container.queryAll((n: TestInstance) => n.type === 'Text');
const screenText = (root: Root) => texts(root).map(textOf);
const pocketLabel = (root: Root) => root.container.queryAll((n: TestInstance) => typeof n.props.accessibilityLabel === 'string')[0].props.accessibilityLabel as string;

describe('isSpecialCard (filete foil)', () => {
  it.each([
    ['Special Art Rare', 'Special Illustration Rare'],
    ['Art Rare', 'Illustration Rare'],
  ])('a raridade japonesa "%s" é especial como a inglesa "%s"', (japanese, english) => {
    expect(isSpecialCard({ variant: 'normal', rarity: japanese })).toBe(true);
    expect(isSpecialCard({ variant: 'normal', rarity: english })).toBe(true);
  });

  it.each(['Common', 'Rare', 'Double Rare', 'Character Rare', 'Character Super Rare'])('"%s" não é especial', (rarity) => {
    expect(isSpecialCard({ variant: 'normal', rarity })).toBe(false);
  });
});

describe('carta esperando preço', () => {
  it('no celular, que busca: "buscando…"', async () => {
    const root = await pocket('android', waiting());
    expect(screenText(root)).toContain('buscando…');
    expect(pocketLabel(root)).toContain('buscando preço');
  });

  it('na web, que não consulta o MYP: "esperando preço", sem prometer busca', async () => {
    const root = await pocket('web', waiting());
    expect(screenText(root)).toContain('esperando preço');
    expect(screenText(root).join(' ')).not.toContain('buscando');
    expect(pocketLabel(root)).toContain('esperando preço');
    expect(pocketLabel(root)).not.toContain('buscando');
  });

  it('no bolso estreito da web a cápsula encurta, e o rótulo continua completo', async () => {
    const root = await pocket('web', waiting(), 90);
    expect(screenText(root)).toContain('esperando');
    expect(screenText(root)).not.toContain('esperando preço');
    expect(pocketLabel(root)).toContain('esperando preço');
  });

  it('já buscada, sem preço: "sem preço" nos dois', async () => {
    const e = waiting();
    const searched = { ...e, mypApi: myp(e, { min: undefined, avg: undefined, max: undefined, qty: 0 }) };
    expect(screenText(await pocket('android', searched))).toContain('sem preço');
    expect(screenText(await pocket('web', searched))).toContain('sem preço');
  });

  it('a espiada e o quadro de preço têm o texto de cada plataforma', () => {
    expect(pricePendingText(false).peek).toBe('Buscando o preço…');
    expect(pricePendingText(true).peek).toBe('Esperando preço');
    expect(priceAfterPlacingText(false)).toBe('O preço chega alguns minutos depois de colocar a carta.');
    expect(priceAfterPlacingText(true)).toContain('app no celular');
  });
});

describe('fonte do sistema no nome da carta dentro do bolso', () => {
  const nameNode = (root: Root) => texts(root).find((n) => textOf(n) === 'Pikachu');

  it('o bolso limita o nome a POCKET_FONT_SCALE, enquanto a imagem carrega', async () => {
    const root = await pocket('android', waiting());
    expect(nameNode(root)?.props.maxFontSizeMultiplier).toBe(POCKET_FONT_SCALE);
  });

  it('o bolso limita o nome também sem imagem nenhuma', async () => {
    const root = await pocket('android', waiting({ image: undefined, cardId: undefined as unknown as string }));
    expect(nameNode(root)?.props.maxFontSizeMultiplier).toBe(POCKET_FONT_SCALE);
  });

  it('fora do bolso, sem o limite', async () => {
    const root = await renderOn('android', ({ image }) => createElement(image.CardImage, { image: IMAGE, label: 'Pikachu' }));
    expect(nameNode(root)?.props.maxFontSizeMultiplier).toBeUndefined();
  });
});
