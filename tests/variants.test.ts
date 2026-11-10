import type { CatalogRow } from '@/lib/catalog';
import type { CardDetail } from '@/lib/tcgdex';
import { availableVariants, logoOnlyLabel, onlyStampedPrintings, versionOptions, withCatalogVersions } from '@/lib/variants';

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

/** Ficha com as impressões pedidas (os selos como a TCGdex manda). */
const card = (setId: string, setName: string, printings: CardDetail['variants_detailed']) =>
  ({ id: `${setId}-1`, localId: '1', name: 'Carta', set: { id: setId, name: setName }, variants_detailed: printings }) as CardDetail;

const shape = (list: ReturnType<typeof versionOptions>) => list.map((o) => [o.variant, o.stamp ?? '', o.stampKeys?.join(',') ?? '', !!o.fromCatalog]);

describe('selo "pre-release" da TCGdex (dp5-42, ex11-49, base2-1)', () => {
  const dp5 = card('dp5', 'Majestic Dawn', [{ type: 'holo' }, { type: 'holo', stamp: ['pre-release'] }, { type: 'holo', stamp: ['pre-release', 'staff'] }]);

  it('é a versão Staff / Pré-release, com a chave "prerelease"', () => {
    expect(availableVariants(dp5, dp5).ids).toEqual(['holo', 'staff']);
    expect(shape(versionOptions(dp5, dp5))).toEqual([
      ['holo', '', '', false],
      ['staff', 'Pré-release', 'prerelease', false],
      ['staff', 'Pré-release + Staff', 'prerelease,staff', false],
    ]);
  });

  it('fica com os produtos "Prerelease" e "Staff Prerelease" do catálogo (sem versão em dobro)', () => {
    const out = withCatalogVersions(versionOptions(dp5, dp5), [row(87582, null), row(232881, 'Prerelease'), row(532629, 'Staff Prerelease')], 'Majestic Dawn');
    expect(shape(out)).toEqual([
      ['holo', '', '', false],
      ['staff', 'Pré-release', 'prerelease', false],
      ['staff', 'Pré-release + Staff', 'prerelease,staff', false],
    ]);
    expect(out[1].photo).toBe(row(232881, null).image);
    expect(out[2].photo).toBe(row(532629, null).image);
  });
});

describe('selo só do logo da coleção: Booster Box ou Pré-release', () => {
  const printings = [{ type: 'normal' }, { type: 'holo', stamp: ['set-logo'] }, { type: 'holo', stamp: ['set-logo', 'staff'] }];
  const sv10 = card('sv10', 'Destined Rivals', printings);

  it('sem o catálogo: "Booster Box" só nas coleções recentes; o logo com Staff nunca é da Booster Box', () => {
    expect(shape(versionOptions(sv10, sv10))).toEqual([
      ['normal', '', '', false],
      ['wPromo', 'Logo da coleção (Booster Box)', 'set-logo', false],
      ['staff', 'Logo da coleção + Staff', 'set-logo,staff', false],
    ]);
    const ex11 = card('ex11', 'Delta Species', printings);
    expect(versionOptions(ex11, ex11)[1].stamp).toBe('Logo da coleção');
    expect(logoOnlyLabel('sv10')).toBe('Logo da coleção (Booster Box)');
    expect(logoOnlyLabel('ex11')).toBe('Logo da coleção');
  });

  it('sem "<Coleção> Stamped": fica com o produto "Prerelease" e com o nome de Pré-release (sv10-096)', () => {
    const rows = [row(630822, null), row(633111, 'Prerelease'), row(633112, 'Staff Prerelease')];
    const out = withCatalogVersions(versionOptions(sv10, sv10), rows, 'Destined Rivals');
    expect(shape(out)).toEqual([
      ['normal', '', '', false],
      ['wPromo', 'Logo da coleção (Pré-release)', 'set-logo', false],
      ['staff', 'Logo da coleção + Staff', 'set-logo,staff', false],
    ]);
    expect(out[1].photo).toBe(row(633111, null).image);
    expect(out[2].photo).toBe(row(633112, null).image);
    expect(logoOnlyLabel('sv10', rows, 'Destined Rivals')).toBe('Logo da coleção (Pré-release)');
    // Coleção antiga com o produto Prerelease também.
    const ex11 = card('ex11', 'Delta Species', printings);
    expect(withCatalogVersions(versionOptions(ex11, ex11), rows, 'Delta Species')[1].stamp).toBe('Logo da coleção (Pré-release)');
  });

  it('com "<Coleção> Stamped": o da Booster Box (o mesmo nome das cartas já salvas)', () => {
    const rows = [row(1, null), row(2, 'Destined Rivals Stamped'), row(3, 'Prerelease')];
    const out = withCatalogVersions(versionOptions(sv10, sv10), rows, 'Destined Rivals');
    const logo = out.find((o) => o.stampKeys?.join() === 'set-logo');
    expect(logo).toMatchObject({ stamp: 'Logo da coleção (Booster Box)', photo: row(2, null).image });
    // O Prerelease sobra como versão do catálogo.
    expect(out.some((o) => o.fromCatalog && o.stamp === 'Prerelease')).toBe(true);
    expect(logoOnlyLabel('ex11', rows, 'Destined Rivals')).toBe('Logo da coleção (Booster Box)');
  });

  it('a lista e a tela de versões dão o mesmo nome sem catálogo da carta', () => {
    expect(withCatalogVersions(versionOptions(sv10, sv10), [], 'Destined Rivals')).toEqual(versionOptions(sv10, sv10));
  });
});

describe('carta que só existe com selo (30th-c-014, 30th-c-026)', () => {
  // A TCGdex marca holo: true pela própria impressão com selo; o holo comum não existe.
  const mew = { ...card('30th-c', '30th Classic Collection', [{ type: 'holo', stamp: ['30th-anniversary'] }]), variants: { holo: true } } as CardDetail;

  it('não oferece a versão comum das marcações simples', () => {
    expect(onlyStampedPrintings(mew, mew)).toBe(true);
    expect(availableVariants(mew, mew).ids).toEqual(['wPromo']);
  });

  it('com uma impressão sem selo (ou só a de 1ª edição), as marcações simples continuam valendo', () => {
    const both = { ...card('sv01', 'Scarlet & Violet', [{ type: 'holo' }, { type: 'holo', stamp: ['set-logo'] }]), variants: { reverse: true } } as CardDetail;
    expect(onlyStampedPrintings(both, both)).toBe(false);
    expect(availableVariants(both, both).ids).toEqual(['holo', 'reverse', 'wPromo']);
    const first = card('base1', 'Base Set', [{ type: 'holo', stamp: ['1st-edition'] }]);
    expect(onlyStampedPrintings(first, first)).toBe(false);
    expect(onlyStampedPrintings(card('x', 'X', []), null)).toBe(false);
  });
});
