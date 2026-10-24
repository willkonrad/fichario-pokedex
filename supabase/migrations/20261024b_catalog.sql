-- Fichário Pokédex 3.0 · catálogo de cartas (área "catalog").
--
-- Idempotente: pode rodar mais de uma vez. Só mexe nas tabelas do catálogo (tcg_catalog, que o servidor recria a partir
-- do TCGCSV) e cria a tabela de execuções do catalog-sync. Não toca nas cartas do usuário (entries, binder_settings,
-- price_history).
--
-- Ordem: aplique esta migração ANTES de publicar a nova versão da Edge Function catalog-sync (ela grava o nome
-- recalculado pela relink_catalog daqui e registra cada execução em catalog_sync_runs).

-- ===== 1) Busca sem acento, apóstrofo ou símbolo (C6) =====

-- Nome normalizado para a busca, igual ao plainName() do app (src/lib/catalog.ts): sem acento (tirado antes das
-- minúsculas, para não depender do locale do lower()), minúsculas, ♀/♂ → f/m, ☆ → star, ◇ → prism star, δ → delta
-- species, sem apóstrofo (' ’) e só letras e números separados por espaço. A faixa '[̀-ͯ]' são as marcas de acento
-- combinantes U+0300–U+036F (caracteres invisíveis). Ex.: "Farfetch’d" → "farfetchd", "Nidoran♀" → "nidoran f",
-- "Flabébé" → "flabebe", "Poção" → "pocao".
create or replace function public.catalog_plain(t text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    regexp_replace(
      replace(replace(replace(replace(replace(replace(
        lower(regexp_replace(normalize(t, NFD), '[̀-ͯ]', '', 'g')),
        '♀', ' f '), '♂', ' m '), '☆', ' star '), '★', ' star '), '◇', ' prism star '), 'δ', ' delta species '),
      '[''’‘`´ʼ]', '', 'g'),
    '[^a-z0-9]+', ' ', 'g'));
$$;

-- Coluna calculada pelo banco (preenche as 56 mil cartas já copiadas e as próximas, sem mudar o catalog-sync).
alter table public.tcg_catalog
  add column if not exists name_plain text generated always as (public.catalog_plain(name)) stored;
create index if not exists tcg_catalog_name_plain_trgm on public.tcg_catalog using gin (name_plain extensions.gin_trgm_ops);

-- ===== 2) Religação com o nome recalculado (C1) =====

-- Religa cartas do catálogo à TCGdex em lote, com o selo e, quando vier, o nome recalculado do nome completo do produto
-- (ex.: "Unown [M]" → "Unown M"): p = [{ product_id, tcgdex_id, stamp, name? }] (só o servidor). Sem "name", fica o
-- nome atual (compatível com a versão anterior da função).
create or replace function public.relink_catalog(p jsonb)
returns integer language sql security definer set search_path = '' as $$
  with x as (
    select product_id, tcgdex_id, stamp, nullif(btrim(name), '') as name
    from jsonb_to_recordset(p) as r(product_id integer, tcgdex_id text, stamp text, name text)
  ),
  upd as (
    update public.tcg_catalog c
    set tcgdex_id = x.tcgdex_id, stamp = x.stamp, name = coalesce(x.name, c.name)
    from x
    where c.product_id = x.product_id
      and (c.tcgdex_id is distinct from x.tcgdex_id
        or c.stamp is distinct from x.stamp
        or (x.name is not null and c.name is distinct from x.name))
    returning 1
  )
  select count(*)::int from upd;
$$;
revoke all on function public.relink_catalog(jsonb) from public, anon, authenticated;
grant execute on function public.relink_catalog(jsonb) to service_role;

-- Conferência depois da religação (o catalog-sync religa 60 coleções a cada 10 min; ~1 hora para todas):
--   select count(*) from public.tcg_catalog where category = 3 and tcgdex_id is null;   -- antes: 1.694
--   select name, number, tcgdex_id from public.tcg_catalog where name ~* '^(nidoran|unown)' or name ~* 'prism star$';

-- ===== 3) Registro das execuções do catalog-sync (G2) =====

-- Uma linha por execução (a cada 10 min), guardada por 14 dias (o próprio catalog-sync apaga as antigas).
-- status: ok, partial (alguma etapa falhou e as outras seguiram) ou error (a execução parou).
create table if not exists public.catalog_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('ok', 'partial', 'error')),
  report jsonb,
  error text
);
create index if not exists catalog_sync_runs_started on public.catalog_sync_runs (started_at desc);
alter table public.catalog_sync_runs enable row level security;
-- Só leitura, e só para quem entrou na conta (o servidor grava com a chave de serviço).
revoke all on public.catalog_sync_runs from public, anon, authenticated;
grant select on public.catalog_sync_runs to authenticated;
drop policy if exists "execuções do catálogo" on public.catalog_sync_runs;
create policy "execuções do catálogo" on public.catalog_sync_runs for select to authenticated using (true);

-- Resumo para a tela "Sobre" do app: última execução, última sem erro, falhas nas últimas 24 h e a idade do catálogo,
-- dos preços da TCGplayer e da PTAX.
create or replace function public.catalog_sync_status()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'last', (select jsonb_build_object('startedAt', r.started_at, 'finishedAt', r.finished_at, 'status', r.status, 'error', r.error)
             from public.catalog_sync_runs r order by r.started_at desc limit 1),
    'lastOkAt', (select r.finished_at from public.catalog_sync_runs r where r.status = 'ok' order by r.started_at desc limit 1),
    'runs24h', (select count(*) from public.catalog_sync_runs r where r.started_at > now() - interval '24 hours'),
    'failures24h', (select count(*) from public.catalog_sync_runs r where r.status <> 'ok' and r.started_at > now() - interval '24 hours'),
    'catalogAt', (select max(g.synced_at) from public.tcg_groups g),
    'pricesAt', (select max(g.prices_at) from public.tcg_groups g),
    'fxDay', (select max(f.day) from public.fx_rates f where f.currency = 'USD')
  );
$$;
revoke all on function public.catalog_sync_status() from public, anon;
grant execute on function public.catalog_sync_status() to authenticated;
