// Funções do banco que precisam continuar de um jeito: o total do gráfico sem função por linha e lido dos totais
// guardados de cada dia (senão estoura o tempo limite da API) e a fila do catalog-sync exata no banco (senão a execução
// ociosa baixa coleções à toa).
const { readFileSync } = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');
const root = expect.getState().testPath!.replace(/[\\/]tests[\\/][^\\/]+$/, '');
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8').replace(/\r\n/g, '\n');

const schema = read('supabase/schema.sql');
const migration = read('supabase/migrations/20261109b_grafico_e_fila.sql');
const totals = read('supabase/migrations/20261110b_totais_do_dia.sql');
const syncIndex = read('supabase/functions/catalog-sync/index.ts');

/** Texto da função, de "create or replace function" até o "$$;" que fecha o corpo. */
function functionSql(sql: string, name: string) {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  expect(at).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$$;', sql.indexOf('$$', at) + 2);
  return sql.slice(at, end + 3);
}
/** A tabela dos totais, com o RLS e as permissões (da criação até o grant). */
function dailyTableSql(sql: string) {
  const at = sql.indexOf('create table if not exists public.price_history_daily (');
  expect(at).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('grant select on public.price_history_daily to authenticated;', at);
  expect(end).toBeGreaterThan(at);
  return sql.slice(at, end);
}
const oneLine = (sql: string) => sql.replace(/\s+/g, ' ');
const calls = (fn: string) => [...new Set(fn.match(/\b(public|auth)\.\w+\(/g))].sort();

describe.each([
  ['schema.sql', schema],
  ['migração dos totais', totals],
])('history_day_sums (a regra da soma) em %s', (_, sql) => {
  const fn = functionSql(sql, 'history_day_sums');

  it('não chama função por foto', () => {
    expect(fn).not.toMatch(/history_value|lateral/);
    expect(fn.match(/\b(public|auth)\.\w+\(/g)).toEqual(['public.history_day_sums(']);
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

  it('soma por conta e dia, com as permissões de quem chama (pela API, o RLS deixa só as fotos da conta)', () => {
    const text = oneLine(fn);
    expect(text).toContain('group by r.user_id, r.day');
    expect(fn).toContain(`language plpgsql stable security invoker set search_path = ''`);
    expect(sql).toContain('revoke all on function public.history_day_sums(date) from public, anon;');
  });

  it('é planejada com a data pedida e usa o índice (user_id, day): EXECUTE e um limite só, sem "or"', () => {
    const text = oneLine(fn);
    expect(text).toContain('return query execute $q$');
    expect(text).toContain('$q$ using p_from;');
    expect(text).toContain(`where h.day >= coalesce($1, '-infinity'::date)`);
    expect(text).not.toMatch(/\bis null or\b/);
  });
});

describe.each([
  ['schema.sql', schema],
  ['migração dos totais', totals],
])('collection_history em %s', (_, sql) => {
  const fn = functionSql(sql, 'collection_history');
  const text = oneLine(fn);

  it('lê os totais guardados e soma na hora só os dias depois do último total', () => {
    expect(text).toContain('select max(d.day) as day from public.price_history_daily d where d.user_id = (select auth.uid())');
    expect(text).toContain(`where d.user_id = (select auth.uid()) and d.day >= coalesce(p_from, '-infinity'::date)`);
    expect(text).toContain(`from done, public.history_day_sums(greatest(coalesce(p_from, '-infinity'::date), done.day + 1)) s where s.user_id = (select auth.uid())`);
  });

  it('não tem cópia da regra nem lê as fotos direto', () => {
    expect(fn).not.toMatch(/jsonb_typeof|basis|price_history h\b|history_value|lateral/);
    expect(calls(fn)).toEqual(['auth.uid(', 'public.collection_history(', 'public.history_day_sums(']);
    // history_day_sums aparece uma vez só (uma chamada, não uma por foto).
    expect(fn.match(/public\.history_day_sums\(/g)).toHaveLength(1);
  });

  it('continua com as permissões do usuário, search_path vazio e a mesma assinatura', () => {
    expect(fn).toContain('create or replace function public.collection_history(p_from date default null)');
    expect(fn).toContain('returns table (day date, value numeric, min numeric, avg numeric, max numeric, cards integer)');
    expect(fn).toContain(`language sql stable security invoker set search_path = ''`);
    expect(sql).toContain('revoke all on function public.collection_history(date) from public, anon;');
    expect(sql).toContain('grant execute on function public.collection_history(date) to authenticated;');
  });
});

describe.each([
  ['schema.sql', schema],
  ['migração dos totais', totals],
])('history_day_totals (grava os totais) em %s', (_, sql) => {
  const fn = functionSql(sql, 'history_day_totals');
  const text = oneLine(fn);

  it('só o servidor chama: security definer com search_path vazio, fechada para a API', () => {
    expect(fn).toContain(`returns integer language sql security definer set search_path = ''`);
    expect(sql).toContain('revoke all on function public.history_day_totals(date) from public, anon, authenticated;');
    expect(sql).not.toMatch(/grant execute on function public\.history_day_totals/);
  });

  it('sem data: a última semana e todo dia depois do último total (sem buraco); tabela vazia, todos os dias', () => {
    expect(text).toContain(`when p_from is not null then p_from when max(d.day) is null then '-infinity'::date`);
    expect(text).toContain(`else least(max(d.day) + 1, (now() at time zone 'America/Sao_Paulo')::date - 6)`);
  });

  it('grava o que history_day_sums dá e tira só o total de um dia que ficou sem foto com preço', () => {
    expect(text).toContain('from f, public.history_day_sums(f.day) s');
    expect(text).toContain('on conflict (user_id, day) do update');
    expect(text).toContain('delete from public.price_history_daily d using f where d.day >= f.day and not exists (select 1 from t where t.user_id = d.user_id and t.day = d.day)');
    // Nunca mexe nas fotos.
    expect(fn).not.toMatch(/(insert into|update|delete from) public\.price_history\b(?!_daily)/);
  });
});

describe.each([
  ['schema.sql', schema],
  ['migração dos totais', totals],
])('price_history_daily em %s', (_, sql) => {
  const table = dailyTableSql(sql);

  it('RLS ligado e só a leitura da própria conta', () => {
    expect(table).toContain('alter table public.price_history_daily enable row level security;');
    expect(oneLine(table)).toContain(`create policy "own daily totals" on public.price_history_daily for select to authenticated using ((select auth.uid()) = user_id);`);
    expect(sql.match(/create policy [^;]+ on public\.price_history_daily/g)).toHaveLength(1);
  });

  it('ninguém grava pela API (permissão explícita, não a padrão do projeto)', () => {
    expect(table).toContain('revoke all on public.price_history_daily from public, anon, authenticated;');
    expect(sql).toContain('grant select on public.price_history_daily to authenticated;');
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]* on public\.price_history_daily/);
  });

  it('um total por conta e dia, que some com a conta', () => {
    expect(table).toContain('user_id uuid not null references auth.users (id) on delete cascade,');
    expect(table).toContain('primary key (user_id, day)');
  });
});

describe('cron dos totais', () => {
  const cron = "select cron.schedule('price-totals', '55 2 * * *', $$ select public.history_day_totals(); $$);";

  it.each([
    ['schema.sql', schema],
    ['migração dos totais', totals],
  ])('roda às 23:55 de Brasília, depois da foto das 23:50 (%s)', (_, sql) => {
    expect(sql).toContain(cron);
  });

  it('a foto continua sozinha no cron dela (uma falha nos totais não desfaz a foto do dia)', () => {
    expect(schema).toContain("select cron.schedule('price-snapshot', '50 2 * * *', $$ select public.snapshot_prices(); $$);");
    expect(functionSql(schema, 'snapshot_prices')).not.toMatch(/history_day/);
  });
});

describe('migração dos totais', () => {
  it('cria tudo antes de usar, preenche os totais de todos os dias e só depois agenda o cron', () => {
    const order = [
      'create table if not exists public.price_history_daily (',
      'create or replace function public.history_day_sums(',
      'create or replace function public.collection_history(',
      'create or replace function public.history_day_totals(',
      "select public.history_day_totals('-infinity'::date);",
      "select cron.schedule('price-totals'",
      "notify pgrst, 'reload schema';",
    ].map((s) => totals.indexOf(s));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('não altera nenhuma foto', () => {
    expect(totals).not.toMatch(/(insert into|update|delete from|truncate) public\.price_history\b(?!_daily)/);
  });
});

describe('history_value saiu', () => {
  it('o schema.sql não tem mais a função e a remove', () => {
    expect(schema).not.toContain('function public.history_value(s jsonb');
    expect(schema).toContain('drop function if exists public.history_value(jsonb, text);');
    expect(migration).toContain('drop function if exists public.history_value(jsonb, text);');
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

describe('schema.sql é o espelho das migrações', () => {
  it.each(['collection_history', 'history_day_sums', 'history_day_totals'])('%s é igual no schema e na migração dos totais', (name) => {
    expect(functionSql(schema, name)).toBe(functionSql(totals, name));
  });

  it('a tabela dos totais é igual nos dois', () => {
    expect(dailyTableSql(schema)).toBe(dailyTableSql(totals));
  });

  it('catalog_due_groups é igual no schema e na migração da fila', () => {
    expect(functionSql(schema, 'catalog_due_groups')).toBe(functionSql(migration, 'catalog_due_groups'));
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
