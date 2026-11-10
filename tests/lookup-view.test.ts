import { emptyFilters, NO_VALUE } from '@/lib/lookup-query';
import type { LookupCard, LookupFilters } from '@/lib/lookup-types';
import { applyFilters, cardPhoto, defaultSheetLang, facets, groupByYear, languagesOf, siblings, toBrief } from '@/lib/lookup-view';

import { jaCard, jaSet, lookupCard, lookupSet, print, zhCard, zhSet } from './lookup-fixtures';

// Filtros, facetas e grupos por ano (seções 7.5 e 7.6), e a ponte para o resto do app (toBrief e fotos).

const filters = (over: Partial<LookupFilters> = {}): LookupFilters => ({ ...emptyFilters(), ...over });
const keys = (list: LookupCard[]) => list.map((c) => c.key);

const a = lookupCard({ key: 'a', hp: 120, rarity: 'Double Rare', marks: 'ep', cardType: 'Fire', stage: 'Stage 2', prints: [print('H', 100), print('R', 200)], year: { kind: 'year', year: 2023, origin: 'set' }, number: '4/102' });
const b = lookupCard({ key: 'b', hp: 60, rarity: undefined, marks: 'e', cardType: 'Fire', stage: 'Basic', prints: [print('N', 100)], year: { kind: 'none' }, number: '' });
const c = jaCard({ key: 'c', hp: null, rarity: 'Special Art Rare', marks: 'jk', cardType: undefined, stage: undefined, prints: [print('N', 100)], year: { kind: 'year', year: 2023, origin: 'set' }, number: '070/108' });
const d = lookupCard({ key: 'd', hp: 120, rarity: 'Promo', marks: 'e', stamp: 'Staff', prints: [print('H', 100)], year: { kind: 'range', from: 2023, to: 2025 }, number: '027', set: lookupSet({ key: '1938', abbr: 'SVP' }) });
const all = [a, b, c, d];

describe('applyFilters', () => {
  it('sem filtro mostra tudo, na ordem do arquivo', () => {
    expect(keys(applyFilters(all, filters()).shown)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('carta sem HP nunca some em silêncio', () => {
    const { shown, withoutHp } = applyFilters(all, filters({ hp: 120 }));
    expect(keys(shown)).toEqual(['a', 'd']);
    expect(keys(withoutHp)).toEqual(['c']);
  });

  it('carta sem HP que não passa nos outros filtros fica de fora dos dois', () => {
    expect(applyFilters(all, filters({ hp: 120, lang: 'en' })).withoutHp).toEqual([]);
  });

  it('sem filtro de HP ninguém vai para "sem HP"', () => {
    expect(applyFilters(all, filters()).withoutHp).toEqual([]);
  });

  it('idioma', () => {
    expect(keys(applyFilters(all, filters({ lang: 'pt' })).shown)).toEqual(['a']);
    expect(keys(applyFilters(all, filters({ lang: 'ko' })).shown)).toEqual(['c']);
    expect(keys(applyFilters(all, filters({ lang: 'ja' })).shown)).toEqual(['c']);
  });

  it('ano: faixa de promos casa com qualquer ano dentro dela', () => {
    expect(keys(applyFilters(all, filters({ year: 2024 })).shown)).toEqual(['d']);
    expect(keys(applyFilters(all, filters({ year: 2023 })).shown)).toEqual(['a', 'c', 'd']);
    expect(keys(applyFilters(all, filters({ year: 2022 })).shown)).toEqual([]);
  });

  it('"Sem ano" só traz a carta sem ano', () => {
    expect(keys(applyFilters(all, filters({ year: 'none' })).shown)).toEqual(['b']);
  });

  it('número: com total exato; sem total, o número da carta; "Sem número"', () => {
    expect(keys(applyFilters(all, filters({ number: '70/108' })).shown)).toEqual(['c']);
    expect(keys(applyFilters(all, filters({ number: '70' })).shown)).toEqual(['c']);
    expect(keys(applyFilters(all, filters({ number: '4/999' })).shown)).toEqual([]);
    expect(keys(applyFilters(all, filters({ number: NO_VALUE })).shown)).toEqual(['b']);
  });

  it('raridade pelo código; "Sem raridade" traz a carta sem o dado', () => {
    expect(keys(applyFilters(all, filters({ rarity: 'SAR' })).shown)).toEqual(['c']);
    expect(keys(applyFilters(all, filters({ rarity: NO_VALUE })).shown)).toEqual(['b']);
  });

  it('variação pelas impressões e pelo selo', () => {
    expect(keys(applyFilters(all, filters({ variant: 'reverse' })).shown)).toEqual(['a']);
    expect(keys(applyFilters(all, filters({ variant: 'holo' })).shown)).toEqual(['a', 'd']);
    expect(keys(applyFilters(all, filters({ variant: 'staff' })).shown)).toEqual(['d']);
  });

  it('coleção pela chave ou pela sigla digitada', () => {
    expect(keys(applyFilters(all, filters({ setKey: '1938' })).shown)).toEqual(['d']);
    expect(keys(applyFilters(all, filters({ setKey: 'svp' })).shown)).toEqual(['d']);
  });

  it('tipo e estágio', () => {
    expect(keys(applyFilters(all, filters({ cardType: 'Fire', stage: 'Basic' })).shown)).toEqual(['b']);
  });

  it('carta sem tipo, estágio ou impressões tem o próprio filtro: nunca some em silêncio', () => {
    const bare = lookupCard({ key: 'bare', cardType: undefined, stage: undefined, prints: [] });
    const full = lookupCard({ key: 'full', cardType: 'Fire', stage: 'Basic', prints: [print('H', 100)] });
    const both = [bare, full];
    expect(keys(applyFilters(both, filters({ cardType: 'Fire' })).shown)).toEqual(['full']);
    expect(keys(applyFilters(both, filters({ cardType: NO_VALUE })).shown)).toEqual(['bare']);
    expect(keys(applyFilters(both, filters({ stage: NO_VALUE })).shown)).toEqual(['bare']);
    expect(keys(applyFilters(both, filters({ variant: 'noPrints' })).shown)).toEqual(['bare']);
    // Com "Fire" ligado, o chip "Sem tipo" continua contando a carta que saiu.
    const f = facets(both, filters({ cardType: 'Fire' }));
    expect(Object.fromEntries(f.types)).toEqual({ Fire: 1, [NO_VALUE]: 1 });
    expect(Object.fromEntries(facets(both, filters({ variant: 'holo' })).variants)).toMatchObject({ noPrints: 1, holo: 1 });
  });

  it('parte do nome: termo curto só como palavra inteira', () => {
    const ex = lookupCard({ key: 'ex', name: 'Charizard ex' });
    const alex = lookupCard({ key: 'alex', name: 'Alexandre' });
    const v = lookupCard({ key: 'v', name: 'Charizard V' });
    const vmax = lookupCard({ key: 'vmax', name: 'Charizard VMAX' });
    expect(keys(applyFilters([ex, alex], filters({ nameTerms: ['ex'] })).shown)).toEqual(['ex']);
    expect(keys(applyFilters([v, vmax], filters({ nameTerms: ['v'] })).shown)).toEqual(['v']);
    expect(keys(applyFilters([v, vmax], filters({ nameTerms: ['vmax'] })).shown)).toEqual(['vmax']);
  });

  it('parte do nome também olha o complemento, o selo e o nome em português', () => {
    expect(keys(applyFilters([lookupCard({ key: 'q', qualifier: 'Lv.13' })], filters({ nameTerms: ['lv'] })).shown)).toEqual(['q']);
    expect(keys(applyFilters([lookupCard({ key: 'pt', ptName: 'Pikachu Voador' })], filters({ nameTerms: ['voador'] })).shown)).toEqual(['pt']);
  });
});

describe('facets', () => {
  it('conta cada idioma', () => {
    expect(facets(all, filters()).langs).toEqual({ pt: 1, en: 3, ja: 1, ko: 1, zh: 0 });
  });

  it('HPs em ordem crescente, sem a carta sem HP', () => {
    expect(facets(all, filters()).hps).toEqual([
      [60, 1],
      [120, 2],
    ]);
  });

  it('anos do mais novo ao mais antigo, faixa aberta e "Sem ano" no fim', () => {
    expect(facets(all, filters()).years).toEqual([2025, 2024, 2023, 'none']);
  });

  it('raridades com o chip "Sem raridade" e variações na ordem fixa', () => {
    const f = facets(all, filters());
    expect(Object.fromEntries(f.rarities)).toEqual({ RR: 1, [NO_VALUE]: 1, SAR: 1, PR: 1 });
    expect(f.variants).toEqual([
      ['holo', 2],
      ['reverse', 1],
      ['staff', 1],
    ]);
  });

  it('coleções, tipos e estágios contados', () => {
    const f = facets(all, filters());
    expect(Object.fromEntries(f.sets)).toEqual({ '604': 2, '23353': 1, '1938': 1 });
    expect(Object.fromEntries(f.types)).toEqual({ Fire: 3, [NO_VALUE]: 1 });
    expect(Object.fromEntries(f.stages)).toEqual({ 'Stage 2': 2, Basic: 1, [NO_VALUE]: 1 });
  });

  it('cada faceta conta os outros filtros, não o próprio', () => {
    const f = facets(all, filters({ lang: 'en' }));
    expect(f.langs).toEqual({ pt: 1, en: 3, ja: 1, ko: 1, zh: 0 });
    expect(f.hps).toEqual([
      [60, 1],
      [120, 2],
    ]);
    expect(Object.fromEntries(f.rarities)).toEqual({ RR: 1, [NO_VALUE]: 1, PR: 1 });
  });

  it('valor sem resultado não aparece', () => {
    const f = facets(all, filters({ hp: 60 }));
    expect(f.years).toEqual(['none']);
    expect(f.langs).toEqual({ pt: 0, en: 1, ja: 0, ko: 0, zh: 0 });
    expect(f.hps).toEqual([
      [60, 1],
      [120, 2],
    ]);
  });
});

describe('groupByYear', () => {
  const year = (y: number, key: string) => lookupCard({ key, year: { kind: 'year', year: y, origin: 'set' } });
  const range = (from: number, to: number, key: string) => lookupCard({ key, year: { kind: 'range', from, to } });
  const none = (key: string) => lookupCard({ key, year: { kind: 'none' } });

  it('do mais novo ao mais antigo, com "Sem ano" no fim', () => {
    expect(groupByYear([year(1999, 'x'), none('n'), year(2023, 'y')]).map((g) => g.title)).toEqual(['2023', '1999', 'Sem ano']);
  });

  it('faixa de promos logo depois da faixa do seu ano final', () => {
    const groups = groupByYear([year(2023, 'a'), range(2023, 2025, 'p'), year(2025, 'b'), year(2024, 'c')]);
    expect(groups.map((g) => g.title)).toEqual(['2025', 'Promos 2023–2025', '2024', '2023']);
    expect(groups[1]).toMatchObject({ from: 2023, to: 2025 });
  });

  it('faixa sem o ano final entre os grupos fica no lugar certo', () => {
    expect(groupByYear([year(2026, 'a'), range(2023, 2025, 'p'), year(2024, 'c')]).map((g) => g.title)).toEqual(['2026', 'Promos 2023–2025', '2024']);
  });

  it('dentro do grupo, a ordem do arquivo', () => {
    expect(keys(groupByYear([year(2023, 'b'), year(2023, 'a'), year(2023, 'c')])[0].cards)).toEqual(['b', 'a', 'c']);
  });
});

describe('siblings', () => {
  const base = lookupCard({ key: 'base', tcgdexId: 'sv03-125', number: '125/197', set: lookupSet({ key: 'obf' }) });
  const stamped = lookupCard({ key: 'stamped', tcgdexId: 'sv03-125', number: '125/197', stamp: 'Prerelease', set: lookupSet({ key: 'obf' }) });
  const sameNumber = lookupCard({ key: 'same', tcgdexId: undefined, number: '0125/197', set: lookupSet({ key: 'obf' }) });
  const other = lookupCard({ key: 'other', tcgdexId: 'sv03-126', number: '126/197', set: lookupSet({ key: 'obf' }) });
  const otherSet = lookupCard({ key: 'elsewhere', tcgdexId: 'sv04-125', number: '125/197', set: lookupSet({ key: 'par' }) });
  const japanese = lookupCard({ key: 'ja', tcgdexId: 'sv03-125', number: '125/197', set: jaSet({ key: 'obf' }) });
  const section = [base, stamped, sameNumber, other, otherSet, japanese];

  it('liga pelo mesmo id da TCGdex ou pela mesma coleção e número', () => {
    expect(keys(siblings(base, section))).toEqual(['stamped', 'same']);
  });

  it('nunca a própria carta, nunca outro idioma de catálogo', () => {
    expect(keys(siblings(base, section))).not.toContain('base');
    expect(keys(siblings(base, section))).not.toContain('ja');
  });

  it('carta sem número e sem id não tem irmãs', () => {
    expect(siblings(lookupCard({ key: 'x', tcgdexId: undefined, number: '' }), [lookupCard({ key: 'y', tcgdexId: undefined, number: '' })])).toEqual([]);
  });
});

describe('languagesOf e defaultSheetLang', () => {
  it('idiomas em que a linha existe', () => {
    expect(languagesOf(lookupCard({ marks: 'ep' }))).toEqual(['pt', 'en']);
    expect(languagesOf(jaCard({ marks: 'ji' }))).toEqual(['ja', 'ko']);
    expect(languagesOf(zhCard({ marks: 'c' }))).toEqual(['zh']);
  });

  it('com chip, o do chip', () => {
    expect(defaultSheetLang(lookupCard({ marks: 'ep' }), 'en')).toBe('en');
    expect(defaultSheetLang(jaCard({ marks: 'jk' }), 'ko')).toBe('ko');
  });

  it('em "Todos", PT se a carta tem p; senão a própria linha', () => {
    expect(defaultSheetLang(lookupCard({ marks: 'ep' }), null)).toBe('pt');
    expect(defaultSheetLang(lookupCard({ marks: 'eu' }), null)).toBe('en');
    expect(defaultSheetLang(jaCard({ marks: 'j' }), null)).toBe('ja');
    expect(defaultSheetLang(zhCard({ marks: 't' }), null)).toBe('zh');
  });

  it('chip de idioma que a carta não tem cai no padrão', () => {
    expect(defaultSheetLang(jaCard({ marks: 'j' }), 'pt')).toBe('ja');
  });
});

describe('toBrief', () => {
  const tcgImage = 'https://tcgplayer-cdn.tcgplayer.com/product/42382_in_1000x1000.jpg';

  it('PT com p: id da TCGdex, sem dataLang', () => {
    expect(toBrief(lookupCard({ marks: 'ep' }), 'pt')).toMatchObject({ id: 'base1-4', localId: '4', lang: 'pt', setId: 'base1', dataLang: undefined, imageUrl: tcgImage });
  });

  it('PT com u: id da TCGdex, dados em inglês', () => {
    expect(toBrief(lookupCard({ marks: 'eu' }), 'pt')).toMatchObject({ id: 'base1-4', lang: 'pt', dataLang: 'en' });
  });

  it('EN: id da TCGdex; sem ele, o do produto', () => {
    expect(toBrief(lookupCard(), 'en')).toMatchObject({ id: 'base1-4', lang: 'en', dataLang: undefined });
    expect(toBrief(lookupCard({ tcgdexId: undefined }), 'en')).toMatchObject({ id: 'tcgp-42382', lang: 'en', localId: '4', setId: 'tcgp604' });
  });

  it('JP: sempre o produto, guardando o id da TCGdex para o "tenho"', () => {
    const b1 = toBrief(jaCard({ tcgdexId: 'SV5a-070' }), 'ja');
    expect(b1).toMatchObject({ id: 'tcgp-567024', lang: 'ja', dataLang: undefined, tcgdexId: 'SV5a-070', localId: '070', setId: 'tcgp23353' });
    expect(b1.series).toBeTruthy();
    expect(toBrief(jaCard(), 'ja').tcgdexId).toBeUndefined();
  });

  it('JP com a data corrigida pelo app: a "Japanese CD Promo" (2025 no TCGCSV) fica na época de 1998–1999', () => {
    const cd = toBrief(jaCard({ set: jaSet({ key: '24568', name: 'Japanese CD Promo', abbr: undefined, date: '2025-12-01' }) }), 'ja');
    expect(cd.series).toBe('Pocket Monsters (1996–2001)');
    expect(cd.setOrder).toBe(19980101);
  });

  it('nome em português só com o idioma PT', () => {
    const card = lookupCard({ ptName: 'Charizard PT' });
    expect(toBrief(card, 'pt').name).toBe('Charizard PT');
    expect(toBrief(card, 'en').name).toBe('Charizard');
  });

  it('selo pela variação do catálogo certo', () => {
    expect(toBrief(lookupCard({ stamp: 'Staff' }), 'en').stamp).toEqual({ variant: 'staff', label: 'Staff', keys: [] });
    expect(toBrief(jaCard({ stamp: 'Mirror Holofoil' }), 'ja').stamp).toEqual({ variant: 'reverse', label: 'Mirror Holofoil', keys: [] });
    expect(toBrief(lookupCard(), 'en').stamp).toBeUndefined();
  });

  it('foto em português da TCGdex só em PT e sem selo', () => {
    const path = 'pt/sv/sv03/060';
    expect(toBrief(lookupCard({ imagePath: path }), 'pt').image).toBe(`https://assets.tcgdex.net/${path}`);
    expect(toBrief(lookupCard({ imagePath: path }), 'en').image).toBeUndefined();
    expect(toBrief(lookupCard({ imagePath: path, stamp: 'Staff' }), 'pt').image).toBeUndefined();
  });

  it('nunca leva preço para a carta', () => {
    const brief = toBrief(lookupCard({ prints: [print('H', 100000)] }), 'en');
    expect(JSON.stringify(brief)).not.toMatch(/100000|market|tcgplayer"/i);
  });
});

describe('cardPhoto', () => {
  const tcg = (id: number, suffix: string) => `https://tcgplayer-cdn.tcgplayer.com/product/${id}${suffix}`;
  const LARGE = '_in_600x600.jpg';

  it('grade: quem tem produto usa sempre a TCGplayer pequena, em qualquer idioma', () => {
    const card = lookupCard({ imagePath: 'pt/base/base1/4' });
    for (const lang of ['pt', 'en', 'ja', 'ko', 'zh'] as const) expect(cardPhoto(card, lang, 'grid')).toEqual({ url: tcg(42382, '_200w.jpg') });
  });

  it('grade, ZH sem produto: a própria, senão a gêmea', () => {
    expect(cardPhoto(zhCard({ imagePath: 'zh-tw/sv/SV5K/001' }), 'zh', 'grid')).toEqual({ url: 'https://assets.tcgdex.net/zh-tw/sv/SV5K/001/low.webp' });
    expect(cardPhoto(zhCard(), 'zh', 'grid')).toEqual({ url: tcg(568335, '_200w.jpg'), tag: 'Foto JP' });
    expect(cardPhoto(zhCard({ twinProductId: undefined }), 'zh', 'grid')).toEqual({ url: null, tag: 'Sem foto' });
  });

  it('PT: da TCGdex; senão a TCGplayer, com "Foto EN"', () => {
    expect(cardPhoto(lookupCard({ imagePath: 'pt/base/base1/4' }), 'pt', 'large')).toEqual({ url: 'https://assets.tcgdex.net/pt/base/base1/4/high.webp' });
    expect(cardPhoto(lookupCard(), 'pt', 'large')).toEqual({ url: tcg(42382, LARGE), tag: 'Foto EN' });
  });

  it('EN e JP: TCGplayer, sem etiqueta', () => {
    expect(cardPhoto(lookupCard(), 'en', 'large')).toEqual({ url: tcg(42382, LARGE) });
    expect(cardPhoto(jaCard(), 'ja', 'full')).toEqual({ url: tcg(567024, '_in_1000x1000.jpg') });
  });

  it('KO: a da linha JP, com "Foto JP"', () => {
    expect(cardPhoto(jaCard({ marks: 'jk' }), 'ko', 'large')).toEqual({ url: tcg(567024, LARGE), tag: 'Foto JP' });
  });

  it('ZH tradicional: própria, gêmea com "Foto JP" e quadro', () => {
    expect(cardPhoto(zhCard({ imagePath: 'zh-tw/sv/SV5K/001' }), 'zh', 'large')).toEqual({ url: 'https://assets.tcgdex.net/zh-tw/sv/SV5K/001/high.webp' });
    expect(cardPhoto(zhCard(), 'zh', 'large')).toEqual({ url: tcg(568335, LARGE), tag: 'Foto JP' });
    expect(cardPhoto(zhCard({ twinProductId: undefined }), 'zh', 'large')).toEqual({ url: null, tag: 'Sem foto' });
  });

  it('ZH simplificado: sempre o quadro', () => {
    expect(cardPhoto(zhCard({ set: zhSet({ lang: 'zh-cn' }), imagePath: 'x/y' }), 'zh', 'large')).toEqual({ url: null, tag: 'Sem foto' });
  });
});
