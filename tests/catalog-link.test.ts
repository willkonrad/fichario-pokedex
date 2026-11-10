// Regra de ligação do catálogo do TCGCSV à TCGdex (Edge Function catalog-sync, funções puras de link.ts).
import { candidatesFor, linkAndStamp, linkByTotal, linkCard, productName, qualifiers, withoutQualifiers, type TcgdexSet } from '../supabase/functions/catalog-sync/link';

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

describe('complemento com colchete dentro do parêntese', () => {
  it.each([
    ['Vivillon (High Plains [Orange])', 'Vivillon'],
    ['Vivillon (Meadow [Pink])', 'Vivillon'],
    ['Pikachu [Promo (Staff)]', 'Pikachu'],
  ])('withoutQualifiers e productName(%j) → %j', (input, out) => {
    expect(withoutQualifiers(input)).toBe(out);
    expect(productName(input)).toBe(out);
  });

  it.each<[string, string[]]>([
    ['Vivillon (Meadow [Pink])', ['Meadow [Pink]']],
    // A TCGplayer escreve este sem o parêntese de fechar: o selo de funcionário não pode se perder.
    ['Chesnaught - XY68 (Prerelease [Staff]', ['Prerelease [Staff]']],
    ['Pikachu - 225 (World Championship 2025) [Winner]', ['World Championship 2025', 'Winner']],
    ['Psychic Energy (#8 - Latias)', ['#8 - Latias']],
  ])('qualifiers(%j) → %j', (input, out) => {
    expect(qualifiers(input)).toEqual(out);
  });

  it('o nome não sobra com o parêntese e o selo sai inteiro', () => {
    const xy1 = set('xy1', [['17', 'Vivillon']]);
    const cards = [
      { product_id: 90395, full_name: 'Vivillon (High Plains [Orange])' },
      { product_id: 91249, full_name: 'Vivillon (Meadow [Pink])' },
    ].map((c) => ({ ...c, name: productName(c.full_name), number: '17/146' }));
    expect(cards.map((c) => c.name)).toEqual(['Vivillon', 'Vivillon']);
    expect(linkAndStamp('XY Base Set', cards, [xy1], [xy1], new Map())).toEqual([
      { product_id: 90395, tcgdex_id: 'xy1-17', stamp: null },
      { product_id: 91249, tcgdex_id: 'xy1-17', stamp: 'Meadow [Pink]' },
    ]);
  });

  it('o selo sai inteiro mesmo sem o parêntese de fechar (108598, antes "Prerelease [Staff")', () => {
    const xyp = set('xyp', [['XY68', 'Chesnaught']]);
    const cards = ['Chesnaught - XY68', 'Chesnaught - XY68 (Prerelease [Staff]'].map((full_name, i) => ({
      product_id: i + 1,
      name: productName(full_name),
      number: 'XY68',
      full_name,
    }));
    expect(cards.map((c) => c.name)).toEqual(['Chesnaught', 'Chesnaught']);
    expect(linkAndStamp('XY Promos', cards, [xyp], [xyp], new Map()).map((o) => o.stamp)).toEqual([null, 'Prerelease [Staff]']);
  });
});

describe('marcador de versão antes do número (cartas japonesas)', () => {
  const stamps = (...fullNames: string[]) =>
    linkAndStamp(
      'Coleção japonesa',
      fullNames.map((full_name, i) => ({ product_id: i + 1, name: productName(full_name), number: full_name.split(' - ').at(-1)?.split(' ')[0] ?? null, full_name })),
      [],
      [],
      new Map(),
    ).map((o) => o.stamp);

  it.each([
    ['Ampharos (Mirror Holofoil) - 033/070', 'Ampharos'],
    ["Larry's Efficiency (Mirror Foil) - 162/187", "Larry's Efficiency"],
    ['Foo [Bar] (Mirror Holofoil) - 1/2', 'Foo [Bar]'],
    // O hífen do nome não é o " - " do número.
    ['Ho-Oh Legend (Mirror Holofoil) - 015/070', 'Ho-Oh Legend'],
  ])('productName(%j) tira só o marcador → %j', (input, out) => {
    expect(productName(input)).toBe(out);
  });

  it('o marcador vira selo e a versão comum fica sem selo, em qualquer ordem', () => {
    expect(stamps('Ampharos - 033/070', 'Ampharos (Mirror Holofoil) - 033/070')).toEqual([null, 'Mirror Holofoil']);
    expect(stamps('Ampharos (Mirror Holofoil) - 033/070', 'Ampharos - 033/070')).toEqual(['Mirror Holofoil', null]);
  });

  it('as duas versões deixam de ser dois produtos sem selo (Larry\'s Efficiency, antes "mais de um produto")', () => {
    expect(stamps("Larry's Efficiency - 162/187", "Larry's Efficiency (Mirror Foil) - 162/187")).toEqual([null, 'Mirror Foil']);
  });

  it('sem a versão comum na coleção, o marcador continua no selo (saiu do nome)', () => {
    expect(stamps('Ampharos (Mirror Holofoil) - 033/070')).toEqual(['Mirror Holofoil']);
    // Coleção 24025: a mesma carta só em Mirror, com dois números.
    expect(stamps('Ho-Oh Legend (Mirror Holofoil) - 015/070', 'Ho-Oh Legend (Mirror Holofoil) - 016/070')).toEqual(['Mirror Holofoil', 'Mirror Holofoil']);
  });

  it('o produto com marcador não vira a versão comum das outras', () => {
    expect(stamps('Pikachu (Mirror Holofoil) - 1/2', 'Pikachu - 1/2 (Birthday)')).toEqual(['Mirror Holofoil', null]);
  });

  it('marcador nos dois lados do número não se repete no selo; outro complemento continua', () => {
    expect(stamps('Pikachu - 1/2', 'Pikachu (Mirror Holofoil) - 1/2 (Mirror Holofoil)')).toEqual([null, 'Mirror Holofoil']);
    expect(stamps('Pikachu - 1/2', 'Pikachu (Mirror Holofoil) - 1/2 (Birthday)')).toEqual([null, 'Mirror Holofoil · Birthday']);
  });

  it('complemento que não é versão continua no nome e não vira selo', () => {
    expect(stamps("Professor's Research [Professor Sada] - 189/198")).toEqual([null]);
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

describe('regra 8: número colado no nome, colchetes e carta com o nome escrito de outro jeito', () => {
  it.each([
    ['Finizen 60/197', 'Finizen'],
    ['Finizen 061/197', 'Finizen'],
    ['Tadbulb 074/197', 'Tadbulb'],
    ['Electivire- 43/147 (#32 Pikachu Stamped)', 'Electivire'],
    ['Kyurem 43/113 (BW Legendary Treasures)', 'Kyurem'],
    ['Charizard ex -196', 'Charizard ex'],
    ['Rayquaza EX -BW47', 'Rayquaza EX'],
    ['Porygon-Z 100/100', 'Porygon-Z'],
  ])('productName(%j) tira o número → %j', (input, out) => {
    expect(productName(input)).toBe(out);
  });

  it.each([
    ['Energy Removal 2', 'Energy Removal 2'],
    ['Giratina Lv. 70', 'Giratina Lv. 70'],
    ['Porygon2', 'Porygon2'],
  ])('número sem barra e sem hífen é parte do nome: %j', (input, out) => {
    expect(productName(input)).toBe(out);
  });

  const sv03 = set('sv03', [['060', 'Finizen'], ['061', 'Finizen'], ['074', 'Tadbulb']]);

  it('Finizen 60/197 liga em sv03-060, sem duplicar a carta', () => {
    const cards = ['Finizen 60/197', 'Finizen 061/197', 'Tadbulb 074/197'].map((full_name, i) => ({
      product_id: i + 1,
      name: productName(full_name),
      number: ['060/197', '061/197', '074/197'][i],
      full_name,
    }));
    expect(linkAndStamp('SV03: Obsidian Flames', cards, [sv03], [sv03], new Map()).map((o) => o.tcgdex_id)).toEqual([
      'sv03-060',
      'sv03-061',
      'sv03-074',
    ]);
  });

  it('colchete e parêntese valem igual: o complemento que a TCGdex guarda no nome liga a carta', () => {
    const bs = set('swsh1', [['178', "Professor's Research (Professor Oak)"], ['179', "Professor's Research (Professor Magnolia)"]]);
    expect(linkCard("Professor's Research [Professor Oak]", '178/202', [bs])).toBe('swsh1-178');
    expect(linkCard("Professor's Research (Professor Magnolia)", '179/202', [bs])).toBe('swsh1-179');
    // Só com o colchete em full_name: o nome vem sem ele (productName sem número no fim tira os complementos).
    expect(linkCard("Professor's Research", '178/202', [bs], "Professor's Research [Professor Oak]")).toBe('swsh1-178');
  });

  /** [nome, número, complemento] de produtos que cobrem uma coleção da TCGdex com cartas numeradas. */
  const covered = (extra: [string, string][]) => {
    const dp7 = set('dp7', [
      ['1', 'Abomasnow'],
      ['2', 'Bronzong'],
      ['3', 'Drifblim'],
      ['96', 'Dusknoir'],
      ['97', 'Heatran'],
    ]);
    const list: [string, string][] = [['Abomasnow', '1/100'], ['Bronzong', '2/100'], ['Drifblim', '3/100'], ...extra];
    return { dp7, cards: list.map(([name, number], i) => ({ product_id: i + 1, name, number, full_name: name })) };
  };

  it('sem nenhuma ligação, liga a carta de mesmo número e mesma 1ª palavra numa candidata que cobre a coleção', () => {
    const { dp7, cards } = covered([['Dusknoir LV.X', '96/100']]);
    expect(linkAndStamp('Stormfront', cards, [dp7], [dp7], new Map())[3].tcgdex_id).toBe('dp7-96');
  });

  it('a 1ª palavra diferente não liga, mesmo com o número igual', () => {
    const { dp7, cards } = covered([['Gardevoir LV.X', '96/100']]);
    expect(linkAndStamp('Stormfront', cards, [dp7], [dp7], new Map())[3].tcgdex_id).toBeNull();
  });

  it('duas candidatas com a mesma carta: fica sem ligação em vez de escolher', () => {
    const { dp7, cards } = covered([['Dusknoir LV.X', '96/100']]);
    const twin = set('dp7b', [['1', 'Abomasnow'], ['2', 'Bronzong'], ['3', 'Drifblim'], ['96', 'Dusknoir']]);
    expect(linkAndStamp('Stormfront', cards, [dp7, twin], [dp7, twin], new Map())[3].tcgdex_id).toBeNull();
  });

  it('candidata que não cobre a coleção não liga', () => {
    const { dp7, cards } = covered([['Dusknoir LV.X', '96/100']]);
    const small = set('xx1', [['96', 'Dusknoir']]);
    const rest = Array.from({ length: 12 }, (_, i) => ({ product_id: 100 + i, name: `Outra ${i}`, number: `${i + 20}/100`, full_name: `Outra ${i}` }));
    const out = linkAndStamp('Stormfront', [...cards, ...rest], [small], [small, dp7], new Map());
    expect(out[3].tcgdex_id).toBeNull();
  });

  describe('regressão: ligação que já existia não troca de carta', () => {
    // Cada caso é uma carta que a regra 7 já ligava: a 8 só pode preencher quem estava sem ligação.
    const base1 = set('base1', [['1', 'Alakazam'], ['2', 'Blastoise'], ['4', 'Charizard'], ['58', 'Pikachu'], ['55', 'Nidoran M'], ['56', 'Onix']]);
    const swsh1 = set('swsh1', [['178', "Professor's Research (Professor Magnolia)"]]);
    const sv01 = set('sv01', [['189', "Professor's Research"], ['190', "Professor's Research"]]);
    const swsh9 = set('swsh9', [['132', "Boss's Orders"]]);

    it.each<[string, [string, string, string], string, string[]]>([
      ['nome e número iguais', ['Charizard', '004/102', 'Charizard'], 'Base Set', ['base1']],
      ['complemento no nome da TCGdex', ["Professor's Research [Professor Magnolia]", '178/202', "Professor's Research [Professor Magnolia] - 178/202"], 'SWSH01', ['swsh1']],
      ['complemento só no produto', ["Professor's Research [Professor Sada]", '189/198', "Professor's Research [Professor Sada] - 189/198"], 'SV01', ['sv01']],
      ['Nidoran com letra', ['Nidoran M', '055/102', 'Nidoran (M)'], 'Base Set', ['base1']],
    ])('%s', (_, [name, number, full_name], group, ids) => {
      const candidates = [base1, swsh1, sv01].filter((s) => ids.includes(s.id));
      const expected = linkCard(name, number, candidates, full_name);
      expect(expected).not.toBeNull();
      const out = linkAndStamp(group, [{ product_id: 1, name, number, full_name }], candidates, [base1, swsh1, sv01, swsh9], new Map());
      expect(out[0].tcgdex_id).toBe(expected);
    });

    it('a ligação pelo número completo continua igual', () => {
      // A coleção precisa de cartas de outros totais: "/172" não pode ser o total dela.
      const others = [2, 3].map((n) => ({ product_id: n, name: `Outra ${n}`, number: `${n}/90`, full_name: `Outra ${n} - ${n}/90` }));
      const out = linkAndStamp(
        'Miscellaneous Cards & Products',
        [{ product_id: 1, name: "Boss's Orders [Cyrus]", number: '132/172', full_name: "Boss's Orders [Cyrus] - 132/172" }, ...others],
        [],
        [swsh9],
        new Map([['swsh9', 172]]),
      );
      expect(out[0].tcgdex_id).toBe('swsh9-132');
    });

    it('carta já ligada não muda por existir outra candidata de mesmo número e 1ª palavra', () => {
      const a = set('a1', [['1', 'Dusknoir'], ['2', 'Dusknoir LV.X'], ['3', 'Bronzong']]);
      const cards = [
        { product_id: 1, name: 'Dusknoir', number: '1/3', full_name: 'Dusknoir' },
        { product_id: 2, name: 'Dusknoir LV.X', number: '2/3', full_name: 'Dusknoir LV.X' },
        { product_id: 3, name: 'Bronzong', number: '3/3', full_name: 'Bronzong' },
      ];
      expect(linkAndStamp('Coleção', cards, [a], [a], new Map()).map((o) => o.tcgdex_id)).toEqual(['a1-1', 'a1-2', 'a1-3']);
    });
  });
});

describe('regra 7: a candidata precisa cobrir a coleção', () => {
  /** Produtos da TCGplayer: [nome, número, complemento opcional]. */
  const cardsOf = (list: [string, string, string?][]) =>
    list.map(([name, number, extra], i) => ({ product_id: i + 1, name, number, full_name: `${name} - ${number}${extra ? ` (${extra})` : ''}` }));
  const filler = (id: string, n: number, named: Record<number, string> = {}) =>
    set(id, Array.from({ length: n }, (_, i): [string, string] => [String(i + 1), named[i + 1] ?? `${id} carta ${i + 1}`]));

  it('coleção nova fora da TCGdex: o Groudon 111/103 não vai para o Groudon Star 111 de Delta Species', () => {
    const ex11 = { ...filler('ex11', 114, { 111: 'Groudon Star' }), name: 'Delta Species', abbr: 'DS' };
    // Outra coleção com 103 cartas oficiais e um Groudon 111: a ligação pelo número completo também não serve.
    const other = filler('xx1', 120, { 111: 'Groudon' });
    const cards = cardsOf([
      ['Heracross', '001/103'],
      ['Masquerain', '003/103'],
      ['Spinarak', '058/103'],
      ['Ariados', '059/103'],
      ['Giratina', '045/103'],
      ['Groudon', '111/103'],
    ]);
    const group = { name: 'ME06: Delta Reign', abbr: 'DLR' };
    expect(candidatesFor(group, [ex11, other]).map((s) => s.id)).toContain('ex11');
    const out = linkAndStamp(group.name, cards, candidatesFor(group, [ex11, other]), [ex11, other], new Map([['ex11', 113], ['xx1', 103]]));
    expect(out.map((o) => o.tcgdex_id)).toEqual([null, null, null, null, null, null]);
  });

  it('a mesma carta em duas candidatas vai para a que cobre a coleção, não para a primeira', () => {
    // "Alakazam 1" existe em Expedition e em Base Set; a Base Set (Shadowless) é a Base Set.
    const ecard1 = filler('ecard1', 3, { 1: 'Alakazam' });
    const base1 = filler('base1', 4, { 1: 'Alakazam', 2: 'Blastoise', 3: 'Chansey', 4: 'Charizard' });
    const cards = cardsOf([
      ['Alakazam', '001/102'],
      ['Blastoise', '002/102'],
      ['Chansey', '003/102'],
      ['Charizard', '004/102'],
    ]);
    const out = linkAndStamp('Base Set (Shadowless)', cards, [ecard1, base1], [ecard1, base1], new Map());
    expect(out.map((o) => o.tcgdex_id)).toEqual(['base1-1', 'base1-2', 'base1-3', 'base1-4']);
  });

  it('número de promo ("XY67a", "221") liga mesmo numa candidata que cobre pouco da coleção', () => {
    const xyp = set('xyp', [['XY67a', 'Jirachi'], ...Array.from({ length: 50 }, (_, i): [string, string] => [`XY${i + 1}`, `Promo ${i + 1}`])]);
    const cards = cardsOf([['Jirachi', 'XY67a'], ...Array.from({ length: 9 }, (_, i): [string, string] => [`Outra ${i + 1}`, `${i + 1}/30`])]);
    const out = linkAndStamp('Alternate Art Promos', cards, [xyp], [xyp], new Map());
    expect(out[0].tcgdex_id).toBe('xyp-XY67a');
  });

  it('a coleção que é a mesma com outro nome continua ligando pelo número completo', () => {
    const sv035 = filler('sv03.5', 6, { 1: 'Bulbasaur', 2: 'Ivysaur', 3: 'Venusaur', 4: 'Charmander', 5: 'Charmeleon', 6: 'Charizard ex' });
    const cards = cardsOf([
      ['Bulbasaur', '001/165'],
      ['Ivysaur', '002/165'],
      ['Venusaur', '003/165'],
      ['Charmander', '004/165'],
      ['Charmeleon', '005/165'],
      ['Charizard ex', '006/165'],
    ]);
    const out = linkAndStamp('Coleção com nome diferente', cards, [], [sv035], new Map([['sv03.5', 165]]));
    expect(out.map((o) => o.tcgdex_id)).toEqual(['sv03.5-1', 'sv03.5-2', 'sv03.5-3', 'sv03.5-4', 'sv03.5-5', 'sv03.5-6']);
    expect(out.every((o) => o.stamp === null)).toBe(true);
  });

  it('candidata pequena dentro de uma coleção grande liga (a fatia é da menor das duas)', () => {
    // 5 cartas "a" de uma coleção de 5 numa coleção de 30 produtos: cobre a candidata inteira, só 1/6 da coleção.
    const xya = set('xya', [['24a', 'Pikachu'], ['28a', 'Raichu'], ['54a', 'Zapdos'], ['55a', 'Mewtwo'], ['67a', 'Jirachi']], 'XY Alternate');
    const own = ['24a', '28a', '54a', '55a', '67a'].map((n, i): [string, string] => [['Pikachu', 'Raichu', 'Zapdos', 'Mewtwo', 'Jirachi'][i], `${n}/30`]);
    const rest = Array.from({ length: 25 }, (_, i): [string, string] => [`Outra ${i + 1}`, `${i + 1}/30`]);
    const out = linkAndStamp('Coleção grande', cardsOf([...own, ...rest]), [xya], [xya], new Map());
    expect(out.slice(0, 5).map((o) => o.tcgdex_id)).toEqual(['xya-24a', 'xya-28a', 'xya-54a', 'xya-55a', 'xya-67a']);
  });

  it('exclusivas com selo de uma coleção (5 ou mais) continuam ligadas mesmo quando o total dela é o da maioria', () => {
    // 6 de 10 produtos são versões com selo de me01 ("/132"): ligam pelo número completo, com o nome da coleção no selo.
    const me01 = filler('me01', 188, { 10: 'Bulbasaur', 20: 'Pikachu', 30: 'Eevee', 40: 'Riolu', 50: 'Mawile', 60: 'Snorlax' });
    const stamped = [10, 20, 30, 40, 50, 60].map((n, i): [string, string, string] => [
      ['Bulbasaur', 'Pikachu', 'Eevee', 'Riolu', 'Mawile', 'Snorlax'][i],
      `${String(n).padStart(3, '0')}/132`,
      'Ultra Ball League',
    ]);
    const others = Array.from({ length: 4 }, (_, i): [string, string] => [`Outra ${i + 1}`, `${i + 1}/94`]);
    const out = linkAndStamp('Southeast Asia Exclusives', cardsOf([...stamped, ...others]), [], [me01], new Map([['me01', 132]]));
    expect(out.slice(0, 6).map((o) => o.tcgdex_id)).toEqual(['me01-10', 'me01-20', 'me01-30', 'me01-40', 'me01-50', 'me01-60']);
    expect(out[0].stamp).toBe('Southeast Asia Exclusives · Ultra Ball League');
  });

  it('versões do mesmo Pikachu não fazem a coleção virar uma reimpressão de outra', () => {
    const mcd = set('2022swsh', [['7', 'Pikachu'], ['1', 'Bulbasaur'], ['2', 'Charmander']]);
    const cards = ['Baby', 'Base Set', 'Flying', 'Jungle', 'Movie', 'Snap'].map((v, i) => ({
      product_id: i + 1,
      name: 'Pikachu',
      number: String(50 + i),
      full_name: `Pikachu (${v})`,
    }));
    const out = linkAndStamp('Pikachu World Collection Promos', cards, [mcd], [mcd], new Map());
    expect(out.map((o) => o.tcgdex_id)).toEqual([null, null, null, null, null, null]);
  });
});
