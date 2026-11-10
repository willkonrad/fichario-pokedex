// Funções do banco que precisam continuar de um jeito: o total do gráfico sem função por linha (senão estoura o tempo
// limite da API) e a fila do catalog-sync exata no banco (senão a execução ociosa baixa coleções à toa).
const { readFileSync } = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');
const root = expect.getState().testPath!.replace(/[\\/]tests[\\/][^\\/]+$/, '');
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8').replace(/\r\n/g, '\n');

const schema = read('supabase/schema.sql');
const migration = read('supabase/migrations/20261109b_grafico_e_fila.sql');
const syncIndex = read('supabase/functions/catalog-sync/index.ts');

/** Texto da função, de "create or replace function" até o "$$;" que fecha o corpo. */
function functionSql(sql: string, name: string) {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  expect(at).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', sql.indexOf('$$', at) + 2);
  return sql.slice(at, end + 3);
}
const oneLine = (sql: string) => sql.replace(/\s+/g, ' ');

describe.each([
  ['schema.sql', schema],
  ['migração', migration],
])('collection_history em %s', (_, sql) => {
  const fn = functionSql(sql, 'collection_history');

  it('não chama função por foto', () => {
    expect(fn).not.toMatch(/history_value|lateral/);
    // A única função do projeto é a que diz quem é o usuário, uma vez só (select, em initPlan).
    expect(fn.match(/\b(public|auth)\.\w+\(/g)).toEqual(['public.collection_history(', 'auth.uid(']);
    expect(oneLine(fn)).toContain('h.user_id = (select auth.uid())');
  });

  it('mantém a ordem da regra: Meu valor, TCGplayer só em inglês e japonês, MYP', () => {
    const manual = fn.indexOf(`jsonb_typeof(h.sources->'manual'->'value') = 'number' then 'manual'`);
    const tcg = fn.indexOf(`h.lang in ('en', 'ja') and jsonb_typeof(h.sources->'tcgplayer'->'avg') = 'number' then 'tcgplayer'`);
    const myp = fn.indexOf(`jsonb_typeof(h.sources->'mypApi'->'avg') = 'number' then 'mypApi'`);
    expect(manual).toBeGreaterThanOrEqual(0);
    expect(tcg).toBeGreaterThan(manual);
    expect(myp).toBeGreaterThan(tcg);
  });

  it('mínimo e máximo nunca do lado de dentro da média, e a escolha da foto vale (menos no "Meu valor")', () => {
    const text = oneLine(fn);
    expect(text).toContain('least(coalesce(p.lo, p.mid), p.mid) as lo');
    expect(text).toContain('greatest(coalesce(p.hi, p.mid), p.mid) as hi');
    expect(text).toContain(`when r.kind = 'manual' then r.mid when r.s->>'basis' = 'min' then r.lo when r.s->>'basis' = 'max' then r.hi else r.mid`);
  });

  it('continua com as permissões do usuário e search_path vazio', () => {
    expect(fn).toContain(`language sql stable security invoker set search_path = ''`);
  });

  it('history_value saiu', () => {
    expect(sql).not.toContain('function public.history_value(s jsonb');
    expect(sql).toContain('drop function if exists public.history_value(jsonb, text);');
  });
});

describe.each([
  ['schema.sql', schema],
  ['migração', migration],
])('catalog_due_groups em %s', (_, sql) => {
  const fn = oneLine(functionSql(sql, 'catalog_due_groups'));

  it('compara cada coleção com a própria cópia (sem filtro largo)', () => {
    expect(fn).toContain('where g.synced_at is null or g.modified_on > g.synced_at or (g.category = 85 and g.link_version < p_ja_copy_version)');
  });

  it('mantém a ordem: categoria e, nela, as sem data e as mais antigas primeiro', () => {
    expect(fn).toContain('order by g.category, g.published_on asc nulls first');
  });

  it('segue as regras de função do projeto e só o servidor chama', () => {
    expect(fn).toContain(`language sql stable security invoker set search_path = ''`);
    expect(sql).toContain('revoke all on function public.catalog_due_groups(integer) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.catalog_due_groups(integer) to service_role;');
  });
});

describe('schema.sql é o espelho da migração', () => {
  it.each(['collection_history', 'catalog_due_groups'])('%s é igual nos dois', (name) => {
    expect(functionSql(schema, name)).toBe(functionSql(migration, name));
  });
});

describe('catalog-sync usa a fila do banco', () => {
  it('pede a fila pela RPC, com a versão da cópia da função', () => {
    expect(syncIndex).toContain(`admin.rpc('catalog_due_groups', { p_ja_copy_version: JA_COPY_VERSION })`);
  });

  it('não baixa mais a lista larga para filtrar aqui', () => {
    expect(syncIndex).not.toMatch(/dueFilter|isDue|\.select\('synced_at'\)/);
  });
});
