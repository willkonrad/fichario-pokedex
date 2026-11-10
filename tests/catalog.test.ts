import {
  catalogImage,
  catalogYear,
  categoryOf,
  ENGLISH,
  entryImageUrl,
  isOversize,
  JAPANESE,
  normNumber,
  plainName,
  sameStampVersion,
  stampVariant,
  tcgplayerImageUrl,
} from '@/lib/catalog';

describe('plainName (mesma regra da função catalog_plain do banco)', () => {
  it('exemplo da migração 20261024b_catalog.sql', () => {
    expect(plainName('Flabébé ÉCLAIR Nidoran♀ Farfetch’d Poção')).toBe('flabebe eclair nidoran f farfetchd pocao');
  });

  it.each([
    ['Nidoran♂', 'nidoran m'],
    ['Nidoran ♀', 'nidoran f'],
    ["Farfetch'd", 'farfetchd'],
    ['Sirfetch‘d', 'sirfetchd'],
    ['Pikachu ☆', 'pikachu star'],
    ['Charizard ★', 'charizard star'],
    ['Mew ◇', 'mew prism star'],
    ['Pikachu δ', 'pikachu delta species'],
    ['Mr. Mime', 'mr mime'],
    ['Ho-Oh', 'ho oh'],
    ['Porygon-Z', 'porygon z'],
    ['  Pokémon   Center  ', 'pokemon center'],
    ['ポケモン', ''],
    ['', ''],
  ])('%s → %j', (input, out) => {
    expect(plainName(input)).toBe(out);
  });
});

describe('números e versões do catálogo', () => {
  it.each([
    ['007/165', '7'],
    ['SWSH001', 'swsh1'],
    ['TG06/TG30', 'tg6'],
    ['#25', '25'],
    [null, ''],
  ])('normNumber(%j) → %s', (input, out) => {
    expect(normNumber(input)).toBe(out);
  });

  it.each([
    ['Staff', 'staff'],
    ['Prerelease', 'staff'],
    ['Master Ball Pattern', 'masterball'],
    ['Poke Ball Pattern', 'pokeball'],
    ['Pokéball Pattern', 'pokeball'],
    ['Non-Holo', 'normal'],
    ['Reverse Holofoil', 'reverse'],
    ['Cosmos Holo', 'holo'],
    ['Cracked Ice Holo', 'holo'],
    ['1st Edition', 'firstEdition'],
    ['Pokemon Center Exclusive', 'wPromo'],
  ])('stampVariant(%s) → %s', (stamp, variant) => {
    expect(stampVariant(stamp)).toBe(variant);
  });

  it.each([
    ['Mirror Holofoil', 'reverse'],
    ['Mirror Holo', 'reverse'],
    ['Mirror Foil', 'reverse'],
    ['Reverse Holofoil', 'reverse'],
    ['Master Ball Pattern', 'masterball'],
    ['Poke Ball Pattern', 'pokeball'],
    ['Cosmos Holo', 'holo'],
    ['Staff', 'staff'],
    ['Energy Symbol Pattern', 'wPromo'],
  ])('stampVariant(%s) na japonesa (85) → %s', (stamp, variant) => {
    expect(stampVariant(stamp, JAPANESE)).toBe(variant);
  });

  it('na inglesa (3) o "Mirror" continua holo (só a 85 vende o Mirror como reverse à parte)', () => {
    expect(stampVariant('Mirror Holofoil')).toBe('holo');
    expect(stampVariant('Mirror Holofoil', ENGLISH)).toBe('holo');
  });

  it('carta gigante', () => {
    expect(isOversize('Jumbo Card')).toBe(true);
    expect(isOversize('Oversize')).toBe(true);
    expect(isOversize(null)).toBe(false);
    expect(isOversize('Pokemon Center')).toBe(false);
  });

  it('sameStampVersion: mesmo selo, ou o selo da Booster Box ("<Coleção> Stamped")', () => {
    expect(sameStampVersion(['pokemon-center'], 'Pokémon Center', 'Surging Sparks', 'Pokemon Center Exclusive')).toBe(true);
    expect(sameStampVersion(['set-logo'], 'Selo da coleção', 'Surging Sparks', 'Surging Sparks Stamped')).toBe(true);
    expect(sameStampVersion(['set-logo'], 'Selo da coleção', 'Surging Sparks', 'Prismatic Evolutions Stamped')).toBe(false);
    expect(sameStampVersion(['pokemon-center'], 'Pokémon Center', 'Surging Sparks', 'Jumbo Pokemon Center')).toBe(false);
  });

  it('catalogImage reduz as fotos para a lista', () => {
    expect(catalogImage('https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg', 'low')).toBe('https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg');
    expect(catalogImage('https://images.scrydex.com/pokemon/sv1-1/large', 'low')).toBe('https://images.scrydex.com/pokemon/sv1-1/small');
    expect(catalogImage('https://images.pokemontcg.io/sv1/1_hires.png', 'low')).toBe('https://images.pokemontcg.io/sv1/1.png');
    expect(catalogImage('https://images.pokemontcg.io/sv1/1_hires.png', 'high')).toBe('https://images.pokemontcg.io/sv1/1_hires.png');
  });
});

describe('cartas japonesas no catálogo (TCGplayer japonesa, categoria 85)', () => {
  it('categoryOf: japonesa só na 85; português e inglês na 3', () => {
    expect(categoryOf('ja')).toBe(85);
    expect(categoryOf('en')).toBe(3);
    expect(categoryOf('pt')).toBe(3);
  });

  it('tcgplayerImageUrl: a mesma foto que o catalog-sync grava (e que o catalogImage reduz)', () => {
    expect(tcgplayerImageUrl(695039)).toBe('https://tcgplayer-cdn.tcgplayer.com/product/695039_in_1000x1000.jpg');
    expect(catalogImage(tcgplayerImageUrl(695039), 'low')).toBe('https://tcgplayer-cdn.tcgplayer.com/product/695039_200w.jpg');
  });

  it('entryImageUrl: a foto salva vale primeiro; a japonesa sem foto usa a do produto ligado pelo preço', () => {
    const url = 'https://example.com/foto.jpg';
    const m5 = { cardId: 'M5-088', lang: 'ja' as const };
    const priced = { productId: 695039, cardId: 'M5-088' };
    expect(entryImageUrl({ ...m5, imageUrl: url, tcgplayer: priced })).toBe(url);
    // As 2 japonesas salvas da TCGdex (M5-088, M5-026): sem foto até o preço ligar o produto da 85.
    expect(entryImageUrl(m5)).toBeUndefined();
    expect(entryImageUrl({ ...m5, tcgplayer: priced })).toBe(tcgplayerImageUrl(695039));
    // Inglês e português nunca ganham a foto pelo produto do preço (a reserva de foto deles é outra).
    expect(entryImageUrl({ cardId: 'sv1-1', lang: 'en', tcgplayer: { productId: 1, cardId: 'sv1-1' } })).toBeUndefined();
    expect(entryImageUrl({ cardId: 'sv1-1', lang: 'pt', tcgplayer: { productId: 1, cardId: 'sv1-1' } })).toBeUndefined();
    expect(entryImageUrl({ ...m5, tcgplayer: null })).toBeUndefined();
  });

  it('entryImageUrl: o preço de outra carta (a anterior do bolso, logo depois de uma troca) não vira a foto', () => {
    // A M5-088 acabou de entrar no lugar da M5-037: o preço ainda é o da M5-037 (produto 695038) até a próxima busca.
    expect(entryImageUrl({ cardId: 'M5-088', lang: 'ja', tcgplayer: { productId: 695038, cardId: 'M5-037' } })).toBeUndefined();
    // Carta só do catálogo trocada por outra: idem.
    expect(entryImageUrl({ cardId: 'tcgp-695039', lang: 'ja', tcgplayer: { productId: 695038, cardId: 'tcgp-695038' } })).toBeUndefined();
    expect(entryImageUrl({ cardId: 'tcgp-695038', lang: 'ja', tcgplayer: { productId: 695038, cardId: 'tcgp-695038' } })).toBe(tcgplayerImageUrl(695038));
  });

  it('catalogYear: sem data (ou data inválida) não tem ano', () => {
    expect(catalogYear('1996-10-20')).toBe(1996);
    expect(catalogYear(null)).toBeUndefined();
    expect(catalogYear(undefined)).toBeUndefined();
    expect(catalogYear('')).toBeUndefined();
    expect(catalogYear('0001-01-01')).toBeUndefined();
  });
});
