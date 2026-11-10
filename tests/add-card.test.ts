import { buildNewEntry, cardParams, defaultVersion, destinationsFor, parseCardCode, placedText, type Destination } from '@/lib/add-card';

import { binder, entry, settings } from './fixtures';

// Só os ids das cartas vêm do store (o resto do store não importa aqui).
jest.mock('@/store/collection', () => ({
  entryId: (dex: number, slot: number) => `${dex}-${slot}`,
  customEntryId: (binderId: string, slot: number) => `${binderId}:${slot}`,
}));

describe('parseCardCode (código impresso no canto da carta)', () => {
  it.each([
    ['MEG 133', 'MEG', '133'],
    ['MEG 133/132', 'MEG', '133'],
    ['meg 133 / 132', 'MEG', '133'],
    ['MEG: 133', 'MEG', '133'],
    ['MEG #133', 'MEG', '133'],
    ['  MEG   133  ', 'MEG', '133'],
    ['MEG133', 'MEG', '133'],
    ['svi25', 'SVI', '25'],
    ['SVI 25', 'SVI', '25'],
    ['SWSH12 186', 'SWSH12', '186'],
    ['SVP 085', 'SVP', '085'],
    ['133/132 MEG', 'MEG', '133'],
    ['133 MEG', 'MEG', '133'],
    ['TG06/TG30 LOR', 'LOR', 'TG06'],
    ['SM 60a', 'SM', '60a'],
  ])('%s → sigla %s, número %s', (text, abbr, number) => {
    expect(parseCardCode(text)).toEqual({ kind: 'set', abbr, number });
  });

  it.each([
    ['swsh12-186', 'swsh12', '186'],
    ['sv03.5-025', 'sv03.5', '025'],
    ['30th-c-011', '30th-c', '011'],
    ['me01-133', 'me01', '133'],
    ['swsh1-TG06', 'swsh1', 'TG06'],
  ])('%s → id da TCGdex (%s, %s)', (text, set, number) => {
    expect(parseCardCode(text)).toEqual({ kind: 'id', set, number });
  });

  it.each(['', '   ', '133', '133/132', '25-1', 'pikachu', 'Pikachu ex', 'M', '12345 MEG'])('%j não é código', (text) => {
    expect(parseCardCode(text)).toBeNull();
  });
});

describe('destinationsFor (onde colocar a carta nova)', () => {
  const trades = binder({ id: 'b1', name: 'Trocas' });
  const favs = binder({ id: 'b2', name: 'Favoritas' });

  it('o fichário aberto primeiro, depois o espaço do Pokémon, os outros fichários e o bolso livre', () => {
    const list = destinationsFor({ dex: 25, settings: settings({ dexTo: 151 }), binders: [trades, favs], entries: {}, activeBinderId: 'b2' });
    expect(list.map((d) => d.key)).toEqual(['binder:b2', 'dex', 'binder:b1', 'extra']);
    expect(list[1]).toMatchObject({ kind: 'dex', dex: 25, slot: 0, title: '#025 Pikachu', where: 'pág. 3, bolso 7' });
    expect(list[3]).toMatchObject({ kind: 'extra', dex: 0, slot: 0, where: 'pág. 17, bolso 8' });
  });

  it('espaço do Pokémon ocupado: oferece substituir, por último', () => {
    const old = entry({ cardName: 'Pikachu V' });
    const list = destinationsFor({ dex: 25, settings: settings(), binders: [], entries: { '25-0': old } });
    expect(list.map((d) => d.key)).toEqual(['extra', 'replace']);
    expect(list[1]).toMatchObject({ title: 'Substituir Pikachu V', replaces: old });
    expect(placedText('Pikachu', list[1])).toBe('Pikachu entrou no lugar de Pikachu V');
  });

  it('fichário livre cheio fica de fora; o bolso vazio seguinte é o sugerido', () => {
    const small = binder({ id: 'b3', name: 'Mini', rows: 1, cols: 2, pages: 1 });
    const full = { 'b3:0': entry({ binderId: 'b3', slot: 0 }), 'b3:1': entry({ binderId: 'b3', slot: 1 }) };
    expect(destinationsFor({ settings: null, binders: [small], entries: full })).toEqual([]);
    const half = destinationsFor({ settings: null, binders: [small], entries: { 'b3:0': full['b3:0'] } });
    expect(half).toHaveLength(1);
    expect(half[0]).toMatchObject({ kind: 'binder', slot: 1, where: 'pág. 1, bolso 2' });
    expect(placedText('', half[0])).toBe('Carta em Mini · pág. 1, bolso 2');
  });
});

describe('cardParams (da lista para a tela da carta)', () => {
  const card = { id: 'sv03.5-025', localId: '025', name: 'Pikachu', lang: 'pt' as const, setId: 'sv03.5', setName: '151', setOrder: 1, setNameEn: '151' };

  it('leva a imagem da TCGdex que a lista já tem (T5: sem internet, a carta colocada fica com ela)', () => {
    const image = 'https://assets.tcgdex.net/pt/sv/sv03.5/025';
    expect(cardParams({ ...card, image })).toMatchObject({ image, imageUrl: undefined, name: 'Pikachu' });
    const imageUrl = 'https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg';
    expect(cardParams({ ...card, imageUrl })).toMatchObject({ image: undefined, imageUrl });
  });
});

describe('defaultVersion e buildNewEntry: versão vista na Consulta (card.version)', () => {
  const card = { id: 'base1-4', localId: '4', name: 'Charizard', lang: 'en' as const, setId: 'base1', setName: 'Base Set', setOrder: 1, setNameEn: 'Base Set' };
  const options = [{ variant: 'holo' as const }, { variant: 'firstEdition' as const }, { variant: 'shadowless' as const }];
  const dest: Destination = { key: 'dex', kind: 'dex', dex: 6, slot: 0, title: '#006 Charizard', detail: '', where: '' };

  it('marca a versão vista quando ela está entre as opções', () => {
    expect(defaultVersion(options, { ...card, version: 'shadowless' })).toEqual({ variant: 'shadowless' });
    expect(defaultVersion(options, { ...card, version: 'firstEdition' })).toEqual({ variant: 'firstEdition' });
  });

  it('versão que não está na lista: a primeira comum', () => {
    expect(defaultVersion(options, { ...card, version: 'reverse' })).toEqual({ variant: 'holo' });
    expect(defaultVersion(options, card)).toEqual({ variant: 'holo' });
  });

  it('sem ficha nem versões: salva a versão vista', () => {
    expect(buildNewEntry({ card: { ...card, version: 'shadowless' }, facts: null, version: null, condition: 'NM', dest }).variant).toBe('shadowless');
    expect(buildNewEntry({ card: { ...card, version: 'firstEdition' }, facts: null, version: null, condition: 'NM', dest, known: { variant: 'holo' } }).variant).toBe('firstEdition');
  });
});
