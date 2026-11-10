// Consultas do catálogo com o banco simulado: ano e dia das coleções (inglês e japonês, sem as sem data), ligação pela
// TCGdex filtrada pela categoria (os ids da TCGdex japonesa repetem os ingleses), produtos em lote e as colunas a mais da
// tela da carta (com a volta às de sempre num banco sem elas).
import { catalogByTcgdexIds, catalogGroupDates, catalogGroupYears, catalogProduct, catalogProducts, JAPANESE } from '@/lib/catalog';

import { fakeMissingColumns, fakeQueries, fakeSelects, fakeTables } from './fake-catalog-db';

jest.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => jest.requireActual('./fake-catalog-db').fakeFrom(t) } }));

beforeEach(() => {
  fakeQueries.length = 0;
  fakeSelects.length = 0;
  fakeMissingColumns.clear();
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
    { product_id: 623235, category: 3, group_id: 22872, name: 'Mew', tcgdex_id: 'svp-183', released_on: '2025-04-11' },
    { product_id: 575766, category: 85, group_id: 23724, name: 'Dark Kadabra', tcgdex_id: null, hp: 50, card_type: 'Psychic', stage: 'Stage 1' },
  ];
});

describe('catalogGroupYears', () => {
  it('lê as coleções em inglês (3) e em japonês (85), pela chave "tcgp<grupo>", sem as sem data', async () => {
    const years = await catalogGroupYears();
    expect(years).toEqual({ tcgp24380: 2025, tcgp24711: 2026, tcgp604: 1996 });
    expect(fakeQueries).toEqual([{ table: 'tcg_groups', filters: ['category in 3,85', 'published_on not null'] }]);
  });
});

describe('catalogGroupDates', () => {
  it('o dia de cada coleção, pela mesma consulta, sem as sem data', async () => {
    fakeTables.tcg_groups.push({ group_id: 3153, category: 3, published_on: '2023-09-22T00:00:00' });
    expect(await catalogGroupDates()).toEqual({ tcgp24380: '2025-11-14', tcgp24711: '2026-01-23', tcgp604: '1996-10-20', tcgp3153: '2023-09-22' });
    expect(fakeQueries).toEqual([{ table: 'tcg_groups', filters: ['category in 3,85', 'published_on not null'] }]);
  });
});

describe('catalogByTcgdexIds', () => {
  it('só a categoria pedida (padrão: a inglesa)', async () => {
    expect((await catalogByTcgdexIds(['neo1-4'])).map((r) => r.product_id)).toEqual([1]);
    expect((await catalogByTcgdexIds(['neo1-4'], JAPANESE)).map((r) => r.product_id)).toEqual([2]);
    expect(await catalogByTcgdexIds([])).toEqual([]);
  });

  it('released_on só com { released: true } (as listas não levam a coluna a mais)', async () => {
    await catalogByTcgdexIds(['svp-183']);
    expect(fakeSelects.at(-1)).not.toContain('released_on');
    const rows = await catalogByTcgdexIds(['svp-183'], 3, { released: true });
    expect(fakeSelects.at(-1)).toContain('released_on');
    expect(rows.map((r) => [r.product_id, r.released_on])).toEqual([[623235, '2025-04-11']]);
  });

  it('banco sem a coluna (42703): repete com as colunas de sempre', async () => {
    fakeMissingColumns.add('released_on');
    const rows = await catalogByTcgdexIds(['svp-183'], 3, { released: true });
    expect(rows.map((r) => r.product_id)).toEqual([623235]);
    expect(fakeSelects).toHaveLength(2);
    expect(fakeSelects[0]).toContain('released_on');
    expect(fakeSelects[1]).not.toContain('released_on');
  });
});

describe('catalogProduct', () => {
  it('com { facts: true }: data do produto, HP, tipo e estágio', async () => {
    const plain = await catalogProduct(575766);
    expect(fakeSelects.at(-1)).not.toMatch(/released_on|hp|card_type|stage/);
    expect(plain?.name).toBe('Dark Kadabra');
    const row = await catalogProduct(575766, { facts: true });
    expect(fakeSelects.at(-1)).toMatch(/released_on, hp, card_type, stage/);
    expect(row).toMatchObject({ hp: 50, card_type: 'Psychic', stage: 'Stage 1' });
    expect(await catalogProduct(1234)).toBeUndefined();
  });

  it('banco sem as colunas (42703): repete com as colunas de sempre', async () => {
    fakeMissingColumns.add('hp');
    const row = await catalogProduct(575766, { facts: true });
    expect(row?.product_id).toBe(575766);
    expect(fakeSelects).toHaveLength(2);
    expect(fakeSelects[1]).not.toContain('hp');
  });

  it('sem { facts }, o erro de coluna não é escondido', async () => {
    fakeMissingColumns.add('tcgdex_id');
    await expect(catalogProduct(575766)).rejects.toMatchObject({ code: '42703' });
  });
});

describe('catalogProducts', () => {
  it('vários produtos numa consulta, sem repetir e sem ids inválidos', async () => {
    const rows = await catalogProducts([695039, 1, 695039, NaN, 0]);
    expect(rows.map((r) => r.product_id).sort()).toEqual([1, 695039]);
    expect(fakeQueries).toEqual([{ table: 'tcg_catalog', filters: ['product_id in 695039,1'] }]);
  });
});
