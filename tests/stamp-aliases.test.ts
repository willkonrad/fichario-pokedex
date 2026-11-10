// Cartas salvas com o nome que versões anteriores do app davam ao selo continuam sendo a mesma versão: o "Pre Release"
// da TCGdex (hoje "Pré-release", variação staff), o logo da coleção "(Booster Box)" (hoje "(Pré-release)" ou só "Logo da
// coleção", conforme o catálogo da carta), o logo com Staff e o produto "Prerelease" que hoje é a versão do logo. A
// lista diz "tenho", a tela marca a versão salva e o "Adicionar" não oferece trocar a carta por ela mesma.
import { ownershipOf } from '@/components/owned-badge';
import { alreadyInPocket } from '@/lib/add-card';
import type { CatalogRow } from '@/lib/catalog';
import type { CardBrief, CardDetail } from '@/lib/tcgdex';
import type { Entry, Variant } from '@/lib/types';
import { sameStamp, sameVersion, savedVersionOf, stampKey, versionOptions, withCatalogVersions } from '@/lib/variants';

import { entry } from './fixtures';

jest.mock('@/store/collection', () => ({ useEntries: () => ({}), entryId: (d: number, s: number) => `${d}-${s}`, customEntryId: (b: string, s: number) => `${b}:${s}` }));

const card = (setId: string, setName: string, printings: { type: string; stamp?: string[] }[]) =>
  ({ id: `${setId}-1`, localId: '1', name: 'Carta', set: { id: setId, name: setName }, variants_detailed: printings }) as unknown as CardDetail;
const row = (product_id: number, stamp: string | null): CatalogRow => ({
  product_id,
  category: 3,
  group_id: 1,
  name: 'Carta',
  full_name: 'Carta',
  number: '1',
  rarity: null,
  image: `https://tcgplayer-cdn.tcgplayer.com/product/${product_id}_in_1000x1000.jpg`,
  stamp,
  tcgdex_id: 'sv10-096',
  tcg_groups: { name: 'SV10: Destined Rivals', abbr: 'DRI' },
});
const saved = (variant: Variant, variantNote?: string, stampKeys?: string[]) => ({ variant, variantNote, stampKeys });

// dp5-42: as impressões com "pre-release" eram salvas como promo "Pre Release" e staff "Pre Release + Staff".
const dp5 = card('dp5', 'Majestic Dawn', [{ type: 'holo' }, { type: 'holo', stamp: ['pre-release'] }, { type: 'holo', stamp: ['pre-release', 'staff'] }]);
// sv10-096: só o produto "Prerelease" no catálogo (sem "<Coleção> Stamped"): o logo é a promo de Pré-release.
const sv10 = card('sv10', 'Destined Rivals', [{ type: 'normal' }, { type: 'holo', stamp: ['set-logo'] }, { type: 'holo', stamp: ['set-logo', 'staff'] }]);
const sv10Versions = withCatalogVersions(versionOptions(sv10, sv10), [row(630822, null), row(633111, 'Prerelease'), row(633112, 'Staff Prerelease')], 'Destined Rivals');

describe('nomes antigos do mesmo selo', () => {
  it('stampKey: "Pre Release" = "Pré-release"; o logo sem o nome da promo; o logo com outro selo sem "(Booster Box)"', () => {
    expect(stampKey('Pre Release')).toBe(stampKey('Pré-release'));
    expect(stampKey('Pre Release + Staff')).toBe(stampKey('Pré-release + Staff'));
    expect(stampKey('Logo da coleção (Booster Box)')).toBe(stampKey('Logo da coleção (Pré-release)'));
    expect(stampKey('Logo da coleção (Booster Box)')).toBe(stampKey('Logo da coleção'));
    expect(stampKey('Logo da coleção (Booster Box) + Staff')).toBe(stampKey('Logo da coleção + Staff'));
    // Selos diferentes continuam diferentes.
    expect(stampKey('Logo da coleção (Pré-release)')).not.toBe(stampKey('Logo da coleção + Pré-release'));
    expect(stampKey('Logo da coleção')).not.toBe(stampKey('Logo da coleção + Staff'));
    expect(stampKey('Prerelease')).not.toBe(stampKey('Pré-release'));
  });

  it('o produto "Prerelease" salvo à parte é a versão do logo que o juntou; não a de Pré-release da TCGdex nem a da Booster Box', () => {
    const old = { stamp: 'Prerelease' };
    expect(sameStamp(old, { stamp: 'Logo da coleção (Pré-release)' })).toBe(true);
    expect(sameStamp({ stamp: 'Logo da coleção (Pré-release)' }, old)).toBe(true);
    expect(sameStamp(old, { stamp: 'Logo da coleção (Booster Box)' })).toBe(false);
    expect(sameStamp({ stamp: 'Pré-release', keys: ['prerelease'] }, { stamp: 'Logo da coleção (Pré-release)' })).toBe(false);
    expect(sameStamp({ stamp: 'Staff Prerelease' }, { stamp: 'Logo da coleção (Pré-release)' })).toBe(false);
  });

  it('sameVersion: promo × staff só com o mesmo selo; sem selo, a variação manda', () => {
    expect(sameVersion({ variant: 'wPromo', stamp: 'Pre Release' }, { variant: 'staff', stamp: 'Pré-release' })).toBe(true);
    expect(sameVersion({ variant: 'staff', stamp: 'Prerelease' }, { variant: 'wPromo', stamp: 'Logo da coleção (Pré-release)' })).toBe(true);
    expect(sameVersion({ variant: 'wPromo', stamp: '' }, { variant: 'staff', stamp: '' })).toBe(false);
    expect(sameVersion({ variant: 'holo', stamp: 'Cosmos Holo' }, { variant: 'reverse', stamp: 'Cosmos Holo' })).toBe(false);
  });

  it('savedVersionOf: a versão de hoje de cada carta salva antes (uma só)', () => {
    const now = versionOptions(dp5, dp5);
    expect(savedVersionOf(now, { variant: 'wPromo', stamp: 'Pre Release', keys: ['pre-release'] })).toMatchObject({ variant: 'staff', stamp: 'Pré-release', stampKeys: ['prerelease'] });
    expect(savedVersionOf(now, { variant: 'staff', stamp: 'Pre Release + Staff' })).toMatchObject({ stamp: 'Pré-release + Staff', stampKeys: ['prerelease', 'staff'] });
    expect(savedVersionOf(sv10Versions, { variant: 'wPromo', stamp: 'Logo da coleção (Booster Box)' })).toMatchObject({ stamp: 'Logo da coleção (Pré-release)' });
    expect(savedVersionOf(sv10Versions, { variant: 'staff', stamp: 'Prerelease' })).toMatchObject({ stamp: 'Logo da coleção (Pré-release)', stampKeys: ['set-logo'] });
    expect(savedVersionOf(sv10Versions, { variant: 'staff', stamp: 'Logo da coleção (Booster Box) + Staff' })).toMatchObject({ stamp: 'Logo da coleção + Staff' });
    // O nome de hoje continua achando a própria versão.
    expect(savedVersionOf(sv10Versions, { variant: 'wPromo', stamp: 'Logo da coleção (Pré-release)' })).toBe(sv10Versions[1]);
  });
});

describe('lista: "tenho" para a carta salva com o nome antigo', () => {
  const tile = (o: { variant: Variant; stamp?: string; stampKeys?: string[] }) => ({ stamp: { label: o.stamp!, keys: o.stampKeys } });

  it('dp5-42 salva como promo "Pre Release" é a versão Pré-release de hoje', () => {
    const [, pre, preStaff] = versionOptions(dp5, dp5);
    expect(ownershipOf([saved('wPromo', 'Pre Release', ['pre-release'])], tile(pre))).toEqual({ exact: true, label: 'tenho', count: 1 });
    expect(ownershipOf([saved('staff', 'Pre Release + Staff', ['pre-release', 'staff'])], tile(preStaff))?.exact).toBe(true);
    expect(ownershipOf([saved('wPromo', 'Pre Release', ['pre-release'])], tile(preStaff))?.label).toBe('outra versão');
  });

  it('sv10-096 salva como "Logo da coleção (Booster Box)" ou como o produto "Prerelease" é a versão do logo de hoje', () => {
    const logo = sv10Versions[1];
    expect(ownershipOf([saved('wPromo', 'Logo da coleção (Booster Box)', ['set-logo'])], tile(logo))?.label).toBe('tenho');
    expect(ownershipOf([saved('staff', 'Prerelease')], tile(logo))?.label).toBe('tenho');
    expect(ownershipOf([saved('staff', 'Logo da coleção (Booster Box) + Staff', ['set-logo', 'staff'])], tile(sv10Versions[2]))?.label).toBe('tenho');
    // A carta comum salva não vira a versão do logo.
    expect(ownershipOf([saved('normal')], tile(logo))?.label).toBe('outra versão');
  });
});

describe('"Adicionar": a carta do bolso já é a versão tocada (sem "Substituir" a carta por ela mesma)', () => {
  const brief = (stamp: { variant: Variant; label: string; keys: string[] }): CardBrief =>
    ({ id: 'sv10-096', localId: '096', name: 'Carta', lang: 'pt', setId: 'sv10', setName: 'Rivais Predestinados', setOrder: 1, stamp }) as CardBrief;
  const inPocket = (over: Partial<Entry>) => entry({ cardId: 'sv10-096', setId: 'sv10', localId: '096', ...over });

  it('logo salvo como "(Booster Box)" ou como o produto "Prerelease"', () => {
    const logo = brief({ variant: 'wPromo', label: 'Logo da coleção (Pré-release)', keys: ['set-logo'] });
    expect(alreadyInPocket(inPocket({ variant: 'wPromo', variantNote: 'Logo da coleção (Booster Box)', stampKeys: ['set-logo'] }), logo)).toBe(true);
    expect(alreadyInPocket(inPocket({ variant: 'staff', variantNote: 'Prerelease' }), logo)).toBe(true);
    expect(alreadyInPocket(inPocket({ variant: 'staff', variantNote: 'Prerelease' }), logo, { variant: 'wPromo', stamp: 'Logo da coleção (Pré-release)', stampKeys: ['set-logo'] })).toBe(true);
    // Outra versão continua sendo outra.
    expect(alreadyInPocket(inPocket({ variant: 'normal' }), logo)).toBe(false);
    expect(alreadyInPocket(inPocket({ variant: 'staff', variantNote: 'Logo da coleção + Staff', stampKeys: ['set-logo', 'staff'] }), logo)).toBe(false);
  });

  it('"Pre Release" salvo como promo e a versão Pré-release (staff) de hoje', () => {
    const pre = brief({ variant: 'staff', label: 'Pré-release', keys: ['prerelease'] });
    expect(alreadyInPocket(inPocket({ variant: 'wPromo', variantNote: 'Pre Release', stampKeys: ['pre-release'] }), pre)).toBe(true);
  });
});
