import { isShadowlessSet, lookupBrief, printOfVariant, printVersion, shownPrint } from '@/lib/lookup-brief';

import { header, jaCard, lookupCard, lookupSet, print } from './lookup-fixtures';

// Da Consulta para o "Adicionar": a carta vai com a versão que estava na tela, nunca com o preço do índice.

jest.mock('@/lib/lookup-index', () => ({ cardByKey: () => null }));

/** Charizard da "Base Set (Shadowless)": produto próprio, mesmo id da TCGdex da carta comum (base1-4). */
const shadowless = lookupCard({
  key: '106999',
  productId: 106999,
  set: lookupSet({ key: '1663', name: 'Base Set (Shadowless)' }),
  prints: [print('H', 217224), print('1H', 900000)],
});
/** Clefable do Jungle: Holo e 1ª ed. Holo, preços bem diferentes. */
const clefable = lookupCard({ key: '45', productId: 45, name: 'Clefable', number: '1/64', tcgdexId: 'base2-1', prints: [print('H', 3755), print('1H', 14915)] });

describe('versão vista na Consulta', () => {
  it('a coleção "(Shadowless)" é Shadowless; a 1ª edição dela continua 1ª edição', () => {
    expect(isShadowlessSet(shadowless)).toBe(true);
    expect(printVersion(shadowless, 'en', 'H')).toBe('shadowless');
    expect(printVersion(shadowless, 'en', null)).toBe('shadowless');
    expect(printVersion(shadowless, 'en', '1H')).toBe('firstEdition');
  });

  it('cada impressão vira a variação do app', () => {
    expect(printVersion(clefable, 'en', '1H')).toBe('firstEdition');
    expect(printVersion(clefable, 'en', '1')).toBe('firstEdition');
    expect(printVersion(clefable, 'en', 'H')).toBe('holo');
    expect(printVersion(clefable, 'en', 'R')).toBe('reverse');
    expect(printVersion(clefable, 'en', 'N')).toBe('normal');
    expect(printVersion(clefable, 'en', null)).toBeUndefined();
  });

  it('carta com selo: o selo já é a versão', () => {
    expect(printVersion(lookupCard({ stamp: 'Staff' }), 'en', 'H')).toBeUndefined();
    expect(lookupBrief(lookupCard({ stamp: 'Staff' }), 'en', 'H')).not.toHaveProperty('version');
  });

  it('Shadowless só na carta em inglês (o grupo é da TCGplayer dos EUA)', () => {
    expect(printVersion(shadowless, 'pt', 'H')).toBe('holo');
    expect(isShadowlessSet(jaCard({ set: lookupSet({ key: '9', lang: 'ja', name: 'Base Set (Shadowless)' }) }))).toBe(false);
  });

  it('o brief é o mesmo de toBrief, com a versão e sem preço', () => {
    const brief = lookupBrief(shadowless, 'en', 'H');
    expect(brief).toMatchObject({ id: 'base1-4', lang: 'en', version: 'shadowless' });
    expect(JSON.stringify(brief)).not.toMatch(/217224|2172|market|"ref"/);
  });
});

describe('impressão que a folha e a grade mostram', () => {
  it('sem filtro: a do preço padrão; com "1ª edição": a 1ª ed.', () => {
    expect(shownPrint(clefable, 'en', header(), null)).toBe('H');
    expect(shownPrint(clefable, 'en', header(), 'firstEdition')).toBe('1H');
    expect(printOfVariant(clefable, 'firstEdition')).toBe('1H');
  });

  it('impressão pedida sem preço ainda vale como a vista', () => {
    const noPrice = lookupCard({ prints: [print('H', 100), print('R', null, null, null)] });
    expect(shownPrint(noPrice, 'en', header(), 'reverse')).toBe('R');
  });
});
