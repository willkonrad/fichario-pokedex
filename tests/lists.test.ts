import { entryPlace, haveShareText, listPrice, listPriceSpeech, listPriceText, missingByRegion, placeText, repeatedCards, versionText } from '@/lib/lists';

import { binder, entry, myp, settings } from './fixtures';

const trades = binder({ id: 'trade1', name: 'Trocas', purpose: 'trade' });
const favs = binder({ id: 'fav1', name: 'Favoritas', purpose: 'favorites' });

describe('repeatedCards ("Tenho repetida")', () => {
  it('mesma carta, idioma, variação e selo em mais de um bolso', () => {
    const inDex = entry({ id: '25-0' });
    const inTrade = entry({ id: 'trade1:3', binderId: 'trade1', slot: 3 });
    const groups = repeatedCards([inTrade, inDex], [trades]);
    expect(groups).toHaveLength(1);
    expect(groups[0].copies).toEqual([inDex, inTrade]);
    // A cópia que sobra é a do fichário de trocas.
    expect(groups[0].spare).toBe(inTrade);
  });

  it('a que sobra: trocas, senão outro fichário livre, senão a última do Pokédex', () => {
    const a = entry({ id: '25-0' });
    const b = entry({ id: 'fav1:0', binderId: 'fav1', slot: 0 });
    const c = entry({ id: 'trade1:9', binderId: 'trade1', slot: 9 });
    expect(repeatedCards([c, b, a], [trades, favs])[0].copies.map((e) => e.id)).toEqual(['25-0', 'fav1:0', 'trade1:9']);
    expect(repeatedCards([a, b], [trades, favs])[0].spare).toBe(b);
    const d = entry({ id: '25-1', slot: 1 });
    expect(repeatedCards([d, a], [])[0].spare).toBe(d);
  });

  it('selo sem diferença de caixa ou espaço; outra variação, idioma ou carta não é repetida', () => {
    const p1 = entry({ id: '25-0', variant: 'wPromo', variantNote: 'Pokemon Center ' });
    const p2 = entry({ id: '25-1', slot: 1, variant: 'wPromo', variantNote: 'pokemon center' });
    expect(repeatedCards([p1, p2], [])).toHaveLength(1);
    expect(repeatedCards([entry(), entry({ id: '25-1', slot: 1, variant: 'reverse' })], [])).toEqual([]);
    expect(repeatedCards([entry(), entry({ id: '25-1', slot: 1, lang: 'en' })], [])).toEqual([]);
    expect(repeatedCards([entry(), entry({ id: '25-1', slot: 1, cardId: 'sv01-025' })], [])).toEqual([]);
  });

  it('grupos em ordem de nome', () => {
    const pika = [entry({ id: '25-0' }), entry({ id: '25-1', slot: 1 })];
    const abra = [entry({ id: '63-0', dex: 63, cardId: 'sv03.5-063', cardName: 'Abra' }), entry({ id: '63-1', dex: 63, slot: 1, cardId: 'sv03.5-063', cardName: 'Abra' })];
    expect(repeatedCards([...pika, ...abra], []).map((g) => g.spare.cardName)).toEqual(['Abra', 'Pikachu']);
  });
});

describe('missingByRegion ("Preciso")', () => {
  it('Pokémon da faixa sem carta no fichário Pokédex, por região', () => {
    const s = settings({ dexTo: 160 });
    const entries = [
      entry({ id: '1-0', dex: 1 }),
      entry({ id: '152-0', dex: 152 }),
      entry({ id: 'trade1:0', dex: 4, binderId: 'trade1' }),
      entry({ id: 'x', dex: 7, binderId: 'pokedex' }),
      // Treinador ou energia (dex 0) e Pokémon fora da faixa não mudam nada.
      entry({ id: '0-0', dex: 0 }),
      entry({ id: '200-0', dex: 200 }),
    ];
    const { groups, total, elsewhere } = missingByRegion(s, entries);
    expect(groups.map((g) => [g.region, g.species.length])).toEqual([
      // Kanto: faltam todos menos o #1 e o #7 (o #4 está em outro fichário: continua faltando aqui).
      ['Kanto', 149],
      ['Johto', 8],
    ]);
    expect(total).toBe(157);
    expect(groups[0].species[0]).toMatchObject({ id: 2, name: 'Ivysaur' });
    expect(groups[0].species.some((p) => p.id === 4)).toBe(true);
    expect([...elsewhere]).toEqual([4]);
  });

  it('região completa não aparece', () => {
    const s = settings({ dexFrom: 1, dexTo: 3 });
    const all = [1, 2, 3].map((dex) => entry({ id: `${dex}-0`, dex }));
    expect(missingByRegion(s, all)).toEqual({ groups: [], total: 0, elsewhere: new Set(), offPage: new Set() });
  });

  it('carta do Pokédex fora das páginas (F2) não conta como tenho, como na home', () => {
    // 1 espaço por Pokémon: a carta que ficou no espaço 2 do Pikachu não aparece no fichário.
    const s = settings({ dexFrom: 1, dexTo: 151, slotsPerPokemon: 1 });
    const { groups, offPage, elsewhere } = missingByRegion(s, [entry({ id: '25-1', dex: 25, slot: 1 })]);
    expect(groups[0].species.some((p) => p.id === 25)).toBe(true);
    expect([...offPage]).toEqual([25]);
    expect(elsewhere.size).toBe(0);
  });
});

describe('onde está a carta', () => {
  it('Pokédex: página, folha, lado e bolso', () => {
    const p = entryPlace(entry(), settings(), []);
    expect(p).toMatchObject({ binder: 'Fichário Pokédex', page: 3, pocket: 7, sheet: 2, side: 'frente', hidden: false });
    expect(placeText(p)).toBe('Fichário Pokédex · pág. 3, bolso 7');
    expect(placeText(p, true)).toBe('Fichário Pokédex · pág. 3 (folha 2, frente), bolso 7');
  });

  it('Pokédex em mais de um fichário físico (F8): a folha dentro do fichário dela', () => {
    // 1 folha por fichário físico: a folha 2 é a 1ª do fichário 2.
    const p = entryPlace(entry(), settings({ sheets: 1 }), []);
    expect(placeText(p, true)).toBe('Fichário Pokédex · pág. 3 (fichário 2, folha 1, frente), bolso 7');
    expect(placeText(p)).toBe('Fichário Pokédex · pág. 3, bolso 7');
  });

  it('fora das páginas, fichário apagado e fichário livre', () => {
    expect(placeText(entryPlace(entry({ dex: 25, slot: 1 }), settings(), []))).toBe('Fichário Pokédex · fora das páginas');
    expect(placeText(entryPlace(entry({ binderId: 'sumiu' }), settings(), []))).toBe('fichário apagado');
    expect(placeText(null)).toBe('fichário apagado');
    const e = entry({ binderId: 'trade1', slot: 10 });
    expect(placeText(entryPlace(e, null, [trades]))).toBe('Trocas · pág. 2, bolso 2');
  });

  it('versionText', () => {
    expect(versionText({ variant: 'normal' })).toBe('');
    expect(versionText({ variant: 'reverse' })).toBe('Reverse Foil');
    expect(versionText({ variant: 'holo', variantNote: 'Cosmos Holo' })).toBe('Holo / Foil · Cosmos Holo');
    expect(versionText({ variant: 'wPromo', variantNote: 'Pokémon Center' })).toBe('Pokémon Center');
  });
});

describe('preços da lista "Tenho repetida"', () => {
  // O formatBRL separa o "R$" com espaço que não quebra.
  const plain = (s: string) => s.replace(/[  ]/g, ' ');
  const pokeball = entry({ id: 'trade1:0', binderId: 'trade1', slot: 0, variant: 'pokeball' });
  const approx = { ...pokeball, mypApi: myp(pokeball) };
  const manual = entry({ id: 'trade1:1', binderId: 'trade1', slot: 1, cardName: 'Abra', myValue: { value: 45, setAt: '2026-10-20T12:00:00.000Z' } });
  const exact = { ...entry({ id: 'trade1:2', binderId: 'trade1', slot: 2, cardName: 'Mew' }), mypApi: myp(entry()) };

  it('marca o aproximado e o Meu valor, como na home', () => {
    expect(plain(listPriceText(listPrice(approx)!))).toBe('≈ R$ 10,00');
    expect(plain(listPriceText(listPrice(manual)!))).toBe('✎ R$ 45,00');
    expect(plain(listPriceText(listPrice(exact)!))).toBe('R$ 10,00');
    expect(listPrice(entry())).toBeNull();
    expect(plain(listPriceSpeech(listPrice(approx)))).toMatch(/^R\$ 10,00, aproximado: preço da carta base/);
    expect(listPriceSpeech(null)).toBe('sem preço');
  });

  it('texto para mandar: "≈" com a legenda e "(meu valor)"', () => {
    const text = plain(haveShareText([], [{ binder: trades, entries: [approx, manual, exact] }], true));
    expect(text).toContain('— ≈ R$ 10,00');
    expect(text).toContain('— R$ 45,00 (meu valor)');
    expect(text).toMatch(/\n≈ Aproximado \(preço da carta base: esta versão não é vendida à parte\)\nPreços: /);
    // Sem aproximado, sem legenda.
    expect(haveShareText([], [{ binder: trades, entries: [exact] }], true)).not.toContain('≈');
  });
});
