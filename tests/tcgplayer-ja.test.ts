import { clearJapaneseCatalogCache } from '@/lib/ja-catalog';
import { supabase } from '@/lib/supabase';
import { fetchTcgplayerPrices, TCG_NOT_FOUND } from '@/lib/tcgplayer';
import type { Entry } from '@/lib/types';
import { valuation } from '@/lib/valuation';

import { entry } from './fixtures';
import { japaneseCatalogTables, queriesOf, type FakeDb } from './ja-catalog-fake-db';

// Preço da TCGplayer das cartas japonesas lido de um banco de mentira na memória (catálogo, preços e PTAX; nenhuma rede).
jest.mock('@/lib/supabase', () => jest.requireActual('./ja-catalog-fake-db').fakeSupabaseModule());

const db = supabase as unknown as FakeDb;

/** Carta japonesa da TCGdex (Dhelmise 088/081 de M5, como a salva na coleção), ou a pedida. */
const ja = (over: Partial<Entry> = {}) =>
  entry({ id: '781-0', dex: 781, lang: 'ja', cardId: 'M5-088', cardName: 'ダダリン', setId: 'M5', setName: 'アビスアイ', localId: '088', setTotal: 81, variant: 'holo', ...over });

beforeEach(() => {
  db.reset(japaneseCatalogTables());
  clearJapaneseCatalogCache();
});

describe('fetchTcgplayerPrices: cartas japonesas', () => {
  it('as duas japonesas salvas ganham produto (a foto) e preço, sem mudar a chave da carta', async () => {
    const dhelmise = ja();
    const zeraora = ja({ id: '807-0', dex: 807, cardId: 'M5-026', localId: '026' });
    const out = await fetchTcgplayerPrices([dhelmise, zeraora]);
    expect(out.get('781-0')).toMatchObject({ cardId: 'M5-088', variant: 'holo', productId: 695039, subType: 'Holofoil', avg: 2.75, fx: 5.5, fxDay: '2026-11-06' });
    expect(out.get('807-0')).toMatchObject({ cardId: 'M5-026', productId: 695049, avg: 6.6 });
    expect(out.get('781-0')?.notFound).toBeUndefined();
    expect(valuation({ ...dhelmise, tcgplayer: out.get('781-0') })).toMatchObject({ basis: 'tcgplayer', value: 2.75, confidence: 'media' });
  });

  it('carta "tcgp-" da 85 com preço; a japonesa apontando para o produto da 3, sem preço', async () => {
    const own = ja({ id: '1-0', cardId: 'tcgp-695039' });
    const english = ja({ id: '2-0', cardId: 'tcgp-500001' });
    const out = await fetchTcgplayerPrices([own, english]);
    expect(out.get('1-0')).toMatchObject({ productId: 695039, avg: 2.75 });
    expect(out.get('2-0')).toMatchObject({ notFound: TCG_NOT_FOUND.otherLanguage });
    expect(out.get('2-0')?.avg).toBeUndefined();
    expect(out.get('2-0')?.productId).toBeUndefined();
  });

  it('mais de um produto possível: sem preço', async () => {
    const flareon = ja({ id: '136-0', dex: 136, cardId: 'SMH-001', setId: 'SMH', localId: '001', setTotal: 38 });
    const out = await fetchTcgplayerPrices([flareon]);
    expect(out.get('136-0')).toMatchObject({ notFound: TCG_NOT_FOUND.ambiguous });
    expect(out.get('136-0')?.productId).toBeUndefined();
  });

  it('reverse: o produto Mirror quando existe; sem ele, a carta comum como carta base (aproximado)', async () => {
    const mewReverse = ja({ id: '151-0', dex: 151, cardId: 'SI-171', setId: 'SI', localId: '171', setTotal: 414, variant: 'reverse' });
    const mewNormal = { ...mewReverse, id: '151-1', variant: 'normal' as const };
    const dhelmiseReverse = ja({ variant: 'reverse' });
    const out = await fetchTcgplayerPrices([mewReverse, mewNormal, dhelmiseReverse]);
    expect(out.get('151-0')).toMatchObject({ productId: 714045, subType: 'Holofoil', avg: 22 });
    expect(out.get('151-0')?.base).toBeUndefined();
    expect(out.get('151-1')).toMatchObject({ productId: 714000, subType: 'Normal', avg: 1.38 });
    expect(out.get('781-0')).toMatchObject({ productId: 695039, base: true, avg: 2.75 });
    expect(valuation({ ...dhelmiseReverse, tcgplayer: out.get('781-0') }).approx).toBe('base');
  });

  it('carta "tcgp-" da 85 trocada de versão: o produto irmão da versão (mesma coleção, número e nome), lido em lote', async () => {
    const lot = [
      // A comum trocada para reverse: o Mirror vendido à parte, com o preço exato (sem "≈").
      ja({ id: 'a', dex: 151, cardId: 'tcgp-714000', variant: 'reverse' }),
      // O Mirror trocado para normal: a comum.
      ja({ id: 'b', dex: 151, cardId: 'tcgp-714045', variant: 'normal' }),
      // Sem o Mirror: a própria carta como carta base, mesmo com outra comum de mesmo número (não fica ambíguo).
      ja({ id: 'c', cardId: 'tcgp-695039', variant: 'reverse' }),
      ja({ id: 'd', dex: 136, cardId: 'tcgp-800001', variant: 'reverse' }),
    ];
    const out = await fetchTcgplayerPrices(lot);
    expect(out.get('a')).toMatchObject({ cardId: 'tcgp-714000', variant: 'reverse', productId: 714045, subType: 'Holofoil', avg: 22 });
    expect(out.get('a')?.base).toBeUndefined();
    expect(valuation({ ...lot[0], tcgplayer: out.get('a') })).toMatchObject({ basis: 'tcgplayer', value: 22, confidence: 'media' });
    expect(valuation({ ...lot[0], tcgplayer: out.get('a') }).approx).toBeUndefined();
    expect(out.get('b')).toMatchObject({ productId: 714000, subType: 'Normal', avg: 1.38 });
    expect(out.get('b')?.base).toBeUndefined();
    expect(out.get('c')).toMatchObject({ productId: 695039, base: true, avg: 2.75 });
    expect(out.get('d')).toMatchObject({ productId: 800001, base: true, avg: 5.5 });
    // Uma consulta por coleção (SI, M5 e SMH), só da 85.
    const slots = queriesOf(db, 'tcg_catalog').filter((q) => q.filters.some(([, col]) => col === 'number'));
    expect(slots).toHaveLength(3);
    for (const q of slots) expect(q.filters).toContainEqual(['eq', 'category', 85]);
  });

  it('Pokémon errado, fora do catálogo ou com os dados da TCGdex em inglês: sem produto', async () => {
    const wrong = ja({ id: '25-0', dex: 25 });
    const unknown = ja({ id: '3-0', cardId: 'PMCG1-1', setId: 'PMCG1', localId: '1', setTotal: 102 });
    const englishData = ja({ id: '4-0', cardId: 'sv08-057', setId: 'sv08', localId: '057', setTotal: 191, dataLang: 'en' });
    const out = await fetchTcgplayerPrices([wrong, unknown, englishData]);
    for (const id of ['25-0', '3-0', '4-0']) expect(out.get(id)).toMatchObject({ notFound: TCG_NOT_FOUND.offCatalog });
  });

  it('inglês continua pela ligação à TCGdex (só a categoria 3); português nem é buscado', async () => {
    const en = entry({ id: '5-0', lang: 'en', cardId: 'sv08-057' });
    const pt = entry({ id: '6-0' });
    const out = await fetchTcgplayerPrices([en, pt]);
    expect(out.get('5-0')).toMatchObject({ productId: 600001, avg: 13.75 });
    expect(out.has('6-0')).toBe(false);
    const linked = queriesOf(db, 'tcg_catalog').find((q) => q.filters.some(([, col]) => col === 'tcgdex_id'))!;
    expect(linked.filters).toContainEqual(['eq', 'category', 3]);
  });

  it('lê em lote: os produtos "tcgp-" numa consulta, os grupos uma vez, os preços numa consulta', async () => {
    const lot = [
      ja({ id: 'a', cardId: 'tcgp-695039' }),
      ja({ id: 'b', cardId: 'tcgp-695049' }),
      ja({ id: 'c', cardId: 'tcgp-714045', variant: 'reverse', variantNote: 'Mirror Holo' }),
      ja({ id: 'd' }),
      ja({ id: 'e', dex: 807, cardId: 'M5-026', localId: '026' }),
    ];
    const out = await fetchTcgplayerPrices(lot);
    expect(out.get('c')).toMatchObject({ productId: 714045, avg: 22 });
    const catalogReads = queriesOf(db, 'tcg_catalog');
    const byProduct = catalogReads.filter((q) => q.filters.some(([op, col]) => op === 'in' && col === 'product_id'));
    expect(byProduct).toHaveLength(1);
    expect(byProduct[0].filters).toContainEqual(['in', 'product_id', [695039, 695049, 714045]]);
    // M5 tem dois grupos com a sigla: uma consulta de cada, com os dois números juntos.
    expect(catalogReads.filter((q) => q.filters.some(([, col]) => col === 'number'))).toHaveLength(2);
    expect(queriesOf(db, 'tcg_groups')).toHaveLength(1);
    expect(queriesOf(db, 'tcg_prices')).toHaveLength(1);
  });
});
