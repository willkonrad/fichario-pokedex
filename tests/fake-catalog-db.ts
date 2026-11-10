// Banco do catálogo simulado (tcg_groups, tcg_catalog) para os testes que leem o Supabase direto: cada consulta filtra
// as linhas em memória pelos mesmos filtros da API (eq, in, ilike sem curinga, not is null). Nenhum teste acessa a rede.

type Row = Record<string, unknown>;

/** Linhas de cada tabela; os testes trocam o conteúdo em beforeEach. */
export const fakeTables: Record<string, Row[]> = {};

/** Consultas feitas (tabela e filtros), para conferir o que o app pediu. */
export const fakeQueries: { table: string; filters: string[] }[] = [];

/** Colunas pedidas em cada consulta (na ordem de fakeQueries). */
export const fakeSelects: string[] = [];

/** Colunas que o banco simulado ainda não tem: a consulta que pede alguma delas falha com 42703. */
export const fakeMissingColumns = new Set<string>();

type Result = { data: Row[] | Row | null; error: { code: string; message: string } | null };

/** Mesmo encadeamento do cliente do Supabase (select → filtros → await). */
export function fakeFrom(table: string) {
  const tests: ((r: Row) => boolean)[] = [];
  const filters: string[] = [];
  let columns = '';
  let one = false;
  fakeQueries.push({ table, filters });
  const result = (): Result => {
    const missing = columns
      .split(',')
      .map((c) => c.trim())
      .find((c) => fakeMissingColumns.has(c));
    if (missing) return { data: null, error: { code: '42703', message: `column tcg_catalog.${missing} does not exist` } };
    const rows = (fakeTables[table] ?? []).filter((r) => tests.every((t) => t(r)));
    return { data: one ? (rows[0] ?? null) : rows, error: null };
  };
  const q = {
    select: (cols = '*') => {
      columns = cols;
      fakeSelects.push(cols);
      return q;
    },
    maybeSingle: () => {
      one = true;
      return q;
    },
    eq: (col: string, v: unknown) => {
      filters.push(`${col}=${String(v)}`);
      tests.push((r) => r[col] === v);
      return q;
    },
    in: (col: string, vs: unknown[]) => {
      filters.push(`${col} in ${vs.join(',')}`);
      tests.push((r) => vs.includes(r[col]));
      return q;
    },
    ilike: (col: string, v: string) => {
      filters.push(`${col}~${v}`);
      tests.push((r) => String(r[col] ?? '').toLowerCase() === v.replace(/\\(.)/g, '$1').toLowerCase());
      return q;
    },
    not: (col: string, _op: string, _v: unknown) => {
      filters.push(`${col} not null`);
      tests.push((r) => r[col] != null);
      return q;
    },
    order: () => q,
    limit: () => q,
    range: () => q,
    abortSignal: () => q,
    then: (ok: (r: Result) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, fail),
  };
  return q;
}
