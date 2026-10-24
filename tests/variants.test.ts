import type { CatalogRow } from '@/lib/catalog';
import type { CardDetail } from '@/lib/tcgdex';
import { versionOptions, withCatalogVersions } from '@/lib/variants';

const row = (product_id: number, stamp: string | null): CatalogRow => ({
  product_id,
  category: 3,
  group_id: 23821,
  name: 'Exeggcute',
  full_name: stamp ? `Exeggcute (${stamp})` : 'Exeggcute',
  number: '001/131',
  rarity: 'Common',
  image: `https://tcgplayer-cdn.tcgplayer.com/product/${product_id}_in_1000x1000.jpg`,
  stamp,
  tcgdex_id: 'sv08.5-001',
  tcg_groups: { name: 'SV: Prismatic Evolutions', abbr: 'PRE' },
});

// sv08.5-001 na TCGdex: normal, reverse e as impressões reverse com acabamento Poké Ball e Master Ball (sem selo).
const detail = {
  id: 'sv08.5-001',
  localId: '001',
  name: 'Exeggcute',
  set: { id: 'sv08.5', name: 'Prismatic Evolutions' },
  variants_detailed: [{ type: 'normal' }, { type: 'reverse' }, { type: 'reverse', foil: 'pokeball' }, { type: 'reverse', foil: 'masterball' }],
} as CardDetail;

describe('withCatalogVersions', () => {
  it('o padrão Poké Ball/Master Ball do catálogo é a impressão da TCGdex (sem versão em dobro)', () => {
    const base = versionOptions(detail, detail);
    expect(base.map((o) => o.variant)).toEqual(['normal', 'reverse', 'pokeball', 'masterball']);
    const out = withCatalogVersions(base, [row(610536, 'Poke Ball Pattern'), row(610637, 'Master Ball Pattern')], 'Prismatic Evolutions');
    expect(out).toHaveLength(4);
    expect(out.find((o) => o.variant === 'pokeball')).toEqual({ variant: 'pokeball', photo: row(610536, null).image });
    expect(out.find((o) => o.variant === 'masterball')).toEqual({ variant: 'masterball', photo: row(610637, null).image });
  });

  it('sem a impressão na TCGdex, o padrão entra como versão do catálogo', () => {
    const plain = { ...detail, variants_detailed: [{ type: 'normal' }, { type: 'reverse' }] } as CardDetail;
    const out = withCatalogVersions(versionOptions(plain, plain), [row(610536, 'Poke Ball Pattern')], 'Prismatic Evolutions');
    expect(out.map((o) => [o.variant, o.stamp ?? '', !!o.fromCatalog])).toEqual([
      ['normal', '', false],
      ['reverse', '', false],
      ['pokeball', 'Poke Ball Pattern', true],
    ]);
  });

  it('versão com selo continua pareando pelo selo', () => {
    const stamped = { ...detail, variants_detailed: [{ type: 'holo' }, { type: 'holo', stamp: ['pokemon-center'] }] } as CardDetail;
    const out = withCatalogVersions(versionOptions(stamped, stamped), [row(1, 'Pokemon Center Exclusive')], 'Prismatic Evolutions');
    expect(out).toHaveLength(2);
    expect(out.find((o) => o.variant === 'wPromo')?.photo).toBe(row(1, null).image);
  });
});
