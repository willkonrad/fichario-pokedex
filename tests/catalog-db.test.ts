// Consultas do catálogo com o banco simulado: ano das coleções (inglês e japonês, sem as sem data), ligação pela TCGdex
// filtrada pela categoria (os ids da TCGdex japonesa repetem os ingleses) e produtos em lote.
import { catalogByTcgdexIds, catalogGroupYears, catalogProducts, JAPANESE } from '@/lib/catalog';

import { fakeQueries, fakeTables } from './fake-catalog-db';

jest.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => jest.requireActual('./fake-catalog-db').fakeFrom(t) } }));

beforeEach(() => {
  fakeQueries.length = 0;
  fakeTables.tcg_groups = [
    { group_id: 24380, category: 3, published_on: '2025-11-14' },
    { group_id: 24711, category: 85, published_on: '2026-01-23' },
    // Expansion Pack japonês (Pocket Monsters, 1996).
    { group_id: 604, category: 85, published_on: '1996-10-20' },
    // Sem data (a fonte não tem): fica sem ano, não "2026".
    { group_id: 3150, category: 85, published_on: null },
    { group_id: 3151, category: 3, published_on: null },
    { group_id: 3152, category: 85, published_on: '' },
    // Outra categoria (não é Pokémon em inglês nem japonês).
    { group_id: 9999, category: 89, published_on: '2020-01-01' },
  ];
  fakeTables.tcg_catalog = [
    { product_id: 1, category: 3, group_id: 1, name: 'Dark Charizard', tcgdex_id: 'neo1-4' },
    { product_id: 2, category: 85, group_id: 2, name: 'Dark Charizard', tcgdex_id: 'neo1-4' },
    { product_id: 695039, category: 85, group_id: 24711, name: 'Dhelmise', tcgdex_id: null },
  ];
});

describe('catalogGroupYears', () => {
  it('lê as coleções em inglês (3) e em japonês (85), pela chave "tcgp<grupo>", sem as sem data', async () => {
    const years = await catalogGroupYears();
    expect(years).toEqual({ tcgp24380: 2025, tcgp24711: 2026, tcgp604: 1996 });
    expect(fakeQueries).toEqual([{ table: 'tcg_groups', filters: ['category in 3,85', 'published_on not null'] }]);
  });
});

describe('catalogByTcgdexIds', () => {
  it('só a categoria pedida (padrão: a inglesa)', async () => {
    expect((await catalogByTcgdexIds(['neo1-4'])).map((r) => r.product_id)).toEqual([1]);
    expect((await catalogByTcgdexIds(['neo1-4'], JAPANESE)).map((r) => r.product_id)).toEqual([2]);
    expect(await catalogByTcgdexIds([])).toEqual([]);
  });
});

describe('catalogProducts', () => {
  it('vários produtos numa consulta, sem repetir e sem ids inválidos', async () => {
    const rows = await catalogProducts([695039, 1, 695039, NaN, 0]);
    expect(rows.map((r) => r.product_id).sort()).toEqual([1, 695039]);
    expect(fakeQueries).toEqual([{ table: 'tcg_catalog', filters: ['product_id in 695039,1'] }]);
  });
});
