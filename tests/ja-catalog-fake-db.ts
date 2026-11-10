// Banco de mentira para os testes que leem o catálogo e os preços (tcg_groups, tcg_catalog, tcg_prices, fx_rates): as
// tabelas ficam na memória e cada consulta fica registrada, para conferir que a leitura é em lote. Nenhuma rede.
//
// Uso no teste (a fábrica do jest.mock não enxerga variáveis de fora, por isso o require):
//   jest.mock('@/lib/supabase', () => jest.requireActual('./ja-catalog-fake-db').fakeSupabaseModule());

type Row = Record<string, unknown>;
type Filter = ['eq' | 'in', string, unknown];

/** Uma consulta feita: tabela e filtros (eq/in), na ordem. */
export type FakeQuery = { table: string; filters: Filter[] };

export type FakeDb = {
  tables: Record<string, Row[]>;
  queries: FakeQuery[];
  from: (table: string) => FakeBuilder;
  /** Troca o conteúdo das tabelas e apaga o registro das consultas. */
  reset: (tables?: Record<string, Row[]>) => void;
};

class FakeBuilder implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private sort?: { col: string; asc: boolean };
  private max?: number;
  private single = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select() {
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push(['eq', col, value]);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push(['in', col, values]);
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.sort = { col, asc: opts.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  abortSignal() {
    return this;
  }

  private run() {
    this.db.queries.push({ table: this.table, filters: this.filters });
    let rows = (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every(([op, col, v]) => (op === 'eq' ? r[col] === v : (v as unknown[]).includes(r[col]))),
    );
    if (this.sort) {
      const { col, asc } = this.sort;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.max != null) rows = rows.slice(0, this.max);
    return { data: this.single ? (rows[0] ?? null) : rows, error: null };
  }

  then<A = { data: unknown; error: null }, B = never>(
    onFulfilled?: ((value: { data: unknown; error: null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

export function createFakeDb(): FakeDb {
  const db: FakeDb = {
    tables: {},
    queries: [],
    from: (table) => new FakeBuilder(db, table),
    reset: (tables = {}) => {
      for (const k of Object.keys(db.tables)) delete db.tables[k];
      Object.assign(db.tables, tables);
      db.queries.length = 0;
    },
  };
  return db;
}

/** O módulo @/lib/supabase com o banco de mentira no lugar do cliente (o resto como no tests/setup.ts). */
export function fakeSupabaseModule() {
  return {
    supabase: createFakeDb(),
    PAGE_SIZE: 1000,
    fetchAllPages: async () => [],
    errorText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    isNetworkError: () => false,
    isMissingInServer: () => false,
    describeSyncError: () => ({ kind: 'error', message: '' }),
  };
}

/** Consultas feitas numa tabela. */
export const queriesOf = (db: FakeDb, table: string) => db.queries.filter((q) => q.table === table);

type Group = { group_id: number; category: number; name: string; abbr: string | null; published_on: string | null };

const GROUPS: Group[] = [
  { group_id: 24711, category: 85, name: 'M5: Abyss Eye', abbr: 'M5', published_on: '2026-05-22' },
  // Mesma sigla, outro total impresso: não é a coleção da carta.
  { group_id: 99001, category: 85, name: 'M5: Deck de exemplo', abbr: 'm5', published_on: '2026-05-22' },
  { group_id: 23859, category: 85, name: 'SI: Start Deck 100', abbr: 'SI', published_on: '2021-12-17' },
  { group_id: 24019, category: 85, name: 'Southern Island', abbr: 'SI', published_on: '1999-07-30' },
  { group_id: 23875, category: 85, name: 'SMH: GX Starter Decks', abbr: 'SMH', published_on: '2018-08-03' },
  // Coleção em inglês com a mesma sigla: nunca entra para a japonesa.
  { group_id: 99003, category: 3, name: 'Coleção em inglês', abbr: 'M5', published_on: '2026-01-01' },
  { group_id: 1, category: 3, name: 'Surging Sparks', abbr: 'SSP', published_on: '2024-11-08' },
];

const product = (product_id: number, group_id: number, name: string, number: string, stamp: string | null = null, over: Row = {}): Row => {
  const g = GROUPS.find((x) => x.group_id === group_id)!;
  return {
    product_id,
    category: g.category,
    group_id,
    name,
    full_name: `${name} - ${number}${stamp ? ` (${stamp})` : ''}`,
    number,
    rarity: null,
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${product_id}_in_1000x1000.jpg`,
    stamp,
    tcgdex_id: null,
    tcg_groups: { name: g.name, abbr: g.abbr, published_on: g.published_on },
    ...over,
  };
};

const print = (product_id: number, sub_type: string, low: number | null, mid: number | null, market: number | null): Row => ({
  product_id,
  sub_type,
  low,
  mid,
  market,
  built_at: '2026-11-06T20:05:28+00:00',
});

/**
 * Catálogo de exemplo: as duas japonesas salvas (Dhelmise 088/081 = 695039, Mega Zeraora ex 026/081 = 695049, de
 * "M5: Abyss Eye"), um Mew com o Mirror vendido à parte, dois "Flareon GX" com o mesmo número (ambíguo), um decoy
 * com a mesma sigla e outro total, a mesma carta na categoria 3 e uma carta em inglês ligada à TCGdex.
 */
export function japaneseCatalogTables(): Record<string, Row[]> {
  return {
    tcg_groups: GROUPS.map((g) => ({ ...g })),
    tcg_catalog: [
      product(695038, 24711, 'Dhelmise', '037/081'),
      product(695039, 24711, 'Dhelmise', '088/081'),
      product(695049, 24711, 'Mega Zeraora ex', '026/081'),
      product(695050, 24711, 'Mega Zeraora ex', '096/081'),
      product(99101, 99001, 'Dhelmise', '088/030'),
      product(714000, 23859, 'Mew', '171/414'),
      product(714045, 23859, 'Mew', '171/414', 'Mirror Holo'),
      product(800001, 23875, 'Flareon GX', '001/038'),
      product(800002, 23875, 'Flareon GX', '001/038'),
      product(500001, 99003, 'Dhelmise', '088/081'),
      product(600001, 1, 'Pikachu ex', '057/191', null, { tcgdex_id: 'sv08-057' }),
    ],
    tcg_prices: [
      print(695039, 'Holofoil', 0.4, 0.6, 0.5),
      print(695049, 'Holofoil', 1, 1.5, 1.2),
      print(714000, 'Normal', 0.2, 0.3, 0.25),
      print(714045, 'Holofoil', 3, 5, 4),
      print(800001, 'Holofoil', 1, 1, 1),
      print(800002, 'Holofoil', 2, 2, 2),
      print(500001, 'Holofoil', 9, 9, 9),
      print(600001, 'Holofoil', 2, 3, 2.5),
    ],
    fx_rates: [
      { currency: 'USD', day: '2026-11-05', sell: 5.4 },
      { currency: 'USD', day: '2026-11-06', sell: 5.5 },
    ],
  };
}
