// Textos da grade de escolher carta: o nome lido pelo leitor de tela e o "buscando …" enquanto a lista completa chega.
import { act, createElement } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import { loadingMoreText } from '@/components/add-card-list';
import { cardCellLabel, CardGrid } from '@/components/card-grid';
import type { CardBrief } from '@/lib/tcgdex';
import { semantic, typography } from '@/theme';

// A grade lê a coleção pelo store; aqui só os textos importam.
jest.mock('@/store/collection', () => ({ useEntries: () => ({}), entryId: () => '', customEntryId: () => '' }));
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: (props: object) => jest.requireActual('react').createElement('ExpoImage', props) }));
// O ano das coleções é lido do catálogo: fora daqui.
jest.mock('@/lib/tcgdex', () => ({ ...jest.requireActual('@/lib/tcgdex'), setReleaseYears: async () => ({}) }));

const card = (over: Partial<CardBrief> = {}): CardBrief => ({
  id: 'tcgp-500001',
  localId: '025',
  name: 'Pikachu',
  lang: 'ja',
  setId: 'tcgp604',
  setName: 'Expansion Pack',
  setNameEn: 'Expansion Pack',
  setOrder: 19961020,
  ...over,
});

describe('cardCellLabel (leitor de tela)', () => {
  it('nome, coleção e número', () => {
    expect(cardCellLabel(card())).toBe('Pikachu, Expansion Pack, número 025');
  });

  it('carta sem número impresso (japonesa antiga): sem o "número" vazio', () => {
    expect(cardCellLabel(card({ localId: '' }))).toBe('Pikachu, Expansion Pack');
  });

  it('selo, só em inglês e "tenho"', () => {
    const stamped = card({ lang: 'pt', dataLang: 'en', stamp: { variant: 'reverse', label: 'Mirror Holofoil', keys: [] } });
    expect(cardCellLabel(stamped, { exact: true })).toBe('Pikachu, Expansion Pack, número 025, com selo Mirror Holofoil, só em inglês, você já tem');
    expect(cardCellLabel(card(), { exact: false })).toBe('Pikachu, Expansion Pack, número 025, você tem outra versão');
  });
});

describe('CardGrid na tela', () => {
  const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
  const textNodes = (root: Root) => root.container.queryAll((n: TestInstance) => n.type === 'Text');
  const roots: Root[] = [];

  async function grid(cards: CardBrief[], groupBySet = false) {
    const root = createRoot();
    roots.push(root);
    await act(async () => root.render(createElement(CardGrid, { cards, onPick: () => {}, groupBySet })));
    return root;
  }

  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  });

  it('título da coleção: o número sai da Kanit, e o título continua um só', async () => {
    const root = await grid([card({ setName: 'Coleção Clássica de 30 Anos' })], true);
    const title = textNodes(root).find((n) => textOf(n) === 'Coleção Clássica de 30 Anos');
    const digits = title?.queryAll((n: TestInstance) => n.type === 'Text' && n !== title && textOf(n) === '30')[0];
    expect(digits).toBeDefined();
    expect(StyleSheet.flatten(digits?.props.style).fontFamily).not.toBe(typography.heading.fontFamily);
  });

  const badgeColor = async (variant: 'holo' | 'normal' | 'reverse' | 'pokeball' | 'staff') => {
    const root = await grid([card({ imageUrl: 'https://img/x.png', stamp: { variant, label: 'Versão', keys: [] } })]);
    const text = textNodes(root).find((n) => textOf(n) === 'Selo');
    return StyleSheet.flatten(text?.parent?.props.style).backgroundColor;
  };

  it.each(['holo', 'normal', 'reverse'] as const)('versão %s: o selo fica neutro (amarelo é só de carta especial)', async (variant) => {
    expect(await badgeColor(variant)).toBe(semantic.tag.bg);
  });

  it.each(['pokeball', 'staff'] as const)('versão %s, especial: o selo fica amarelo', async (variant) => {
    expect(await badgeColor(variant)).toBe(semantic.special.fill);
  });
});

describe('loadingMoreText (lista base na tela, o resto chegando)', () => {
  const cards = [card()];

  it('diz o que a fonte ainda busca: versões com selo (PT e EN) ou mais cartas (japonês)', () => {
    expect(loadingMoreText({ status: 'loading', cards, pending: 'versões com selo' })).toBe('buscando versões com selo');
    expect(loadingMoreText({ status: 'loading', cards, pending: 'mais cartas' })).toBe('buscando mais cartas');
    expect(loadingMoreText({ status: 'loading', cards })).toBe('buscando mais cartas');
  });

  it('sem lista base ou com a lista pronta: nada', () => {
    expect(loadingMoreText({ status: 'loading' })).toBeNull();
    expect(loadingMoreText({ status: 'done', cards })).toBeNull();
    expect(loadingMoreText({ status: 'error', message: 'x' })).toBeNull();
  });
});
