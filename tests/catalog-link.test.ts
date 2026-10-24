// Regra de ligação do catálogo do TCGCSV à TCGdex (Edge Function catalog-sync, funções puras de link.ts).
import { linkAndStamp, linkByTotal, linkCard, productName, withoutQualifiers, type TcgdexSet } from '../supabase/functions/catalog-sync/link';

const set = (id: string, cards: [string, string][], name = id): TcgdexSet => ({
  id,
  abbr: null,
  name,
  cards: cards.map(([localId, cardName]) => ({ id: `${id}-${localId}`, localId, name: cardName })),
});

describe('productName e withoutQualifiers', () => {
  it.each([
    ["Professor's Research [Professor Sada] - 189/198", "Professor's Research [Professor Sada]"],
    ['Psychic Energy (#8 - Latias)', 'Psychic Energy'],
    ['Unown [M]', 'Unown M'],
    ['Nidoran (F)', 'Nidoran F'],
    ['Pikachu - 025/165', 'Pikachu'],
  ])('productName(%j) → %j', (input, out) => {
    expect(productName(input)).toBe(out);
  });

  it.each([
    ["Professor's Research [Professor Sada]", "Professor's Research"],
    ['Darkrai (Team Plasma)', 'Darkrai'],
    ['Zacian V (Shiny)', 'Zacian V'],
    ['Unown [Q]', 'Unown Q'],
    ['Nidoran (M)', 'Nidoran M'],
  ])('withoutQualifiers(%j) → %j', (input, out) => {
    expect(withoutQualifiers(input)).toBe(out);
  });
});

describe('ligação com o complemento antes do " - "', () => {
  const sv01 = set('sv01', [
    ['189', "Professor's Research"],
    ['190', "Professor's Research"],
  ]);
  const swsh1 = set('swsh1', [['178', "Professor's Research (Professor Magnolia)"]]);

  it('sem acerto com o complemento, liga pelo nome sem ele (mesmo número)', () => {
    expect(linkCard("Professor's Research [Professor Sada]", '189/198', [sv01])).toBe('sv01-189');
    expect(linkCard("Professor's Research [Professor Turo]", '190/198', [sv01])).toBe('sv01-190');
    expect(linkCard('Darkrai (Team Plasma)', 'BW73', [set('bwp', [['BW73', 'Darkrai']])])).toBe('bwp-BW73');
  });

  it('a TCGdex com o complemento no nome continua ligando pelo nome inteiro', () => {
    expect(linkCard("Professor's Research [Professor Magnolia]", '178/202', [swsh1])).toBe('swsh1-178');
  });

  it('o número continua tendo de bater', () => {
    expect(linkCard("Professor's Research [Professor Sada]", '191/198', [sv01])).toBeNull();
  });

  it('pelo número completo, também sem o complemento', () => {
    const swsh9 = set('swsh9', [['132', "Boss's Orders"]]);
    expect(linkByTotal("Boss's Orders [Cyrus]", '132/172', [swsh9], new Map([['swsh9', 172]]))).toBe('swsh9-132');
  });

  it('linkAndStamp: a carta da coleção principal liga e fica sem selo', () => {
    const cards = [
      { product_id: 1, name: "Professor's Research [Professor Sada]", number: '189/198', full_name: "Professor's Research [Professor Sada] - 189/198" },
      { product_id: 2, name: 'Pikachu', number: '190/198', full_name: 'Pikachu - 190/198' },
    ];
    const out = linkAndStamp('SV01: Scarlet & Violet Base Set', cards, [sv01], [sv01], new Map());
    expect(out[0]).toEqual({ product_id: 1, tcgdex_id: 'sv01-189', stamp: null });
  });
});
