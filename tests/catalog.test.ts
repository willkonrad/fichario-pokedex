import { catalogImage, isOversize, normNumber, plainName, sameStampVersion, stampVariant } from '@/lib/catalog';

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
