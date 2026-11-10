-- 3.1.0 — Registro de mudanças das cartas, para a tela "Relatórios" (últimas adicionadas, trocas no fichário Pokédex,
-- movidas e removidas).
--
-- Cada carta que entra, sai ou é trocada num bolso de public.entries vira um fato cru em public.entry_events, gravado
-- por gatilho. Só conta a troca da chave da carta (carta, idioma, versão e selo): preço, data, texto, imagem e reenvio
-- da sincronização não geram nada. Movida, troca de lugar, "Desfazer" e digitação do selo se resolvem na leitura
-- (src/lib/activity.ts), não aqui: um erro no gatilho derrubaria a gravação da carta.
--
--   1. entry_key / entry_summary / entry_event_time / entry_key_changes: funções puras, só os gatilhos e o backfill usam.
--   2. public.entry_events: o dono só lê (RLS); ninguém grava pela API. Guardado para sempre (~1 KB por evento); conta
--      apagada leva os eventos junto.
--   3. delete_entries passa a deixar na transação a hora de cada remoção (do aparelho), para o evento "removida".
--   4. backup.restore_collection marca os eventos dela como 'restore' ("Restaurada da cópia").
--   5. Backfill (uma vez só): o que mudou desde 24/10, pelas cópias diárias (backup.entries_daily, a de 24/10 também
--      em backup.entries_20261024) e o estado de agora. Os eventos do backfill têm só o dia confiável (source
--      'backfill', tx nula). Aplicar antes de 08/11 00:20 (Brasília), quando a cópia de 25/10 é apagada.
--   6. Gatilhos AFTER em entries: insert e update por linha; delete por comando (lê a hora das remoções uma vez só).
--
-- Pode rodar mais de uma vez: create or replace, if not exists, policy recriada, gatilhos create or replace; o backfill
-- só roda se ainda não há gatilho de registro nem evento de backfill. Trava as gravações em entries por alguns
-- segundos (leitura continua), para o backfill e o gatilho não deixarem buraco nem duplicata. Específica deste banco
-- (lê backup.entries_20261024); o schema.sql tem tudo menos o backfill.
--
-- Depois de aplicar: consultas de conferência (eventos por kind/source, gatilhos ligados, policies, teste com rollback)
-- e get_advisors (security).

begin;

-- Não espera para sempre por uma gravação em andamento (a fila travaria o app); se estourar, rode de novo.
set local lock_timeout = '15s';
lock table public.entries in share row exclusive mode;

-- ----- Funções puras -----

-- Chave da carta: o que faz um bolso ter "outra carta" (carta, idioma, versão, selo). Igual a entryKey() do app.
create or replace function public.entry_key(d jsonb)
returns text language sql immutable set search_path = '' as $$
  select coalesce(d ->> 'cardId', '') || '|' || coalesce(d ->> 'lang', 'pt') || '|' || coalesce(d ->> 'variant', 'normal')
         || '|' || coalesce(btrim(d ->> 'variantNote'), '');
$$;

-- Resumo da carta para o relatório funcionar sem a carta existir (os campos que a CardImage e a lista precisam).
create or replace function public.entry_summary(d jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select case when d is null then null else jsonb_strip_nulls(jsonb_build_object(
    'cardId', d -> 'cardId', 'cardName', d -> 'cardName', 'setName', d -> 'setName', 'setId', d -> 'setId',
    'localId', d -> 'localId', 'setTotal', d -> 'setTotal', 'rarity', d -> 'rarity',
    'lang', d -> 'lang', 'dataLang', d -> 'dataLang', 'variant', d -> 'variant', 'variantNote', d -> 'variantNote',
    'image', d -> 'image', 'imageUrl', d -> 'imageUrl', 'stampPhoto', d -> 'stampPhoto', 'stampKeys', d -> 'stampKeys',
    'imagePt', d -> 'mypApi' -> 'imagePt',
    'condition', d -> 'condition', 'origin', d -> 'origin', 'purchasePrice', d -> 'purchasePrice',
    'binderId', d -> 'binderId', 'dex', d -> 'dex', 'slot', d -> 'slot')) end;
$$;

-- Hora do aparelho (ISO), nunca no futuro; texto vazio ou estragado vale a hora do servidor. Nunca dá erro.
create or replace function public.entry_event_time(t text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v timestamptz;
begin
  if t is null or not pg_input_is_valid(t, 'timestamptz') then
    return now();
  end if;
  v := t::timestamptz;
  if not isfinite(v) then
    return now();
  end if;
  return least(now(), v);
end;
$$;

-- Quais partes da chave mudaram ("trocou a versão" x "trocou a carta"). O selo é o resto depois do 3º '|'.
create or replace function public.entry_key_changes(a text, b text)
returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[
    case when split_part(a, '|', 1) <> split_part(b, '|', 1) then 'cardId' end,
    case when split_part(a, '|', 2) <> split_part(b, '|', 2) then 'lang' end,
    case when split_part(a, '|', 3) <> split_part(b, '|', 3) then 'variant' end,
    case when regexp_replace(a, '^([^|]*\|){3}', '') <> regexp_replace(b, '^([^|]*\|){3}', '') then 'variantNote' end
  ], null);
$$;

revoke execute on function public.entry_key(jsonb) from public, anon, authenticated;
revoke execute on function public.entry_summary(jsonb) from public, anon, authenticated;
revoke execute on function public.entry_event_time(text) from public, anon, authenticated;
revoke execute on function public.entry_key_changes(text, text) from public, anon, authenticated;

-- ----- Tabela -----

create table if not exists public.entry_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id text not null,                          -- bolso: "<dex>-<slot>" ou "<fichário>:<bolso>"
  op text not null check (op in ('insert', 'update', 'delete')),
  kind text not null check (kind in ('added', 'removed', 'replaced')),
  changed text[],                                  -- replaced: cardId / lang / variant / variantNote
  before jsonb,                                    -- entry_summary da carta que saiu (null em added)
  after jsonb,                                     -- entry_summary da carta que entrou (null em removed)
  before_key text,
  after_key text,
  at timestamptz not null default now(),           -- relógio do servidor (agrupa o que chegou junto)
  happened_at timestamptz not null default now(),  -- quando a pessoa fez (aparelho), nunca no futuro
  tx xid8 default pg_current_xact_id(),            -- mesmo envio (null no backfill)
  source text not null default 'app' check (source in ('app', 'restore', 'backfill'))
);
create index if not exists entry_events_user_time on public.entry_events (user_id, happened_at desc, id desc);
create index if not exists entry_events_user_at on public.entry_events (user_id, at, id);
create index if not exists entry_events_user_entry on public.entry_events (user_id, entry_id, at);

alter table public.entry_events enable row level security;
drop policy if exists "own events" on public.entry_events;
create policy "own events" on public.entry_events
  for select to authenticated using ((select auth.uid()) = user_id);
-- Só o gatilho grava aqui. A leitura é explícita (não depende da permissão padrão do projeto).
revoke all on public.entry_events from anon, authenticated;
grant select on public.entry_events to authenticated;
revoke all on sequence public.entry_events_id_seq from anon, authenticated;

-- ----- Gatilhos -----

-- Um fato por linha; UPDATE só quando a carta do bolso mudou (preço, data, texto e reenvio não contam).
create or replace function public.entries_log_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  src text := coalesce(nullif(current_setting('app.entry_source', true), ''), 'app');
  ok text;
  nk text;
begin
  -- Só a restore_collection marca a origem; outro valor vira 'app' (o check não pode derrubar a gravação).
  if src not in ('app', 'restore') then
    src := 'app';
  end if;
  if tg_op = 'INSERT' then
    insert into public.entry_events (user_id, entry_id, op, kind, after, after_key, happened_at, source)
    values (new.user_id, new.id, 'insert', 'added', public.entry_summary(new.data), public.entry_key(new.data),
            public.entry_event_time(new.data ->> 'updatedAt'), src);
  elsif tg_op = 'UPDATE' then
    ok := public.entry_key(old.data);
    nk := public.entry_key(new.data);
    if ok = nk then
      return null;
    end if;
    insert into public.entry_events (user_id, entry_id, op, kind, changed, before, after, before_key, after_key,
                                     happened_at, source)
    values (new.user_id, new.id, 'update', 'replaced', public.entry_key_changes(ok, nk),
            public.entry_summary(old.data), public.entry_summary(new.data), ok, nk,
            public.entry_event_time(new.data ->> 'updatedAt'), src);
  end if;
  return null;
end;
$$;

-- Remoções: uma vez por comando, com as cartas apagadas na tabela de transição `gone`. Lê a origem e o mapa das horas
-- uma vez só (lido a cada linha, um fichário grande apagado de uma vez estourava o statement_timeout de 8 s).
create or replace function public.entries_log_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  src text := coalesce(nullif(current_setting('app.entry_source', true), ''), 'app');
  raw text := nullif(current_setting('app.removed_at', true), '');
  removed jsonb;
begin
  -- Só a restore_collection marca a origem; outro valor vira 'app' (o check não pode derrubar a gravação).
  if src not in ('app', 'restore') then
    src := 'app';
  end if;
  -- delete_entries deixa na transação a hora de cada remoção ({ "<id>": "<ISO>" }); estragado vale a hora do servidor.
  if raw is not null and pg_input_is_valid(raw, 'jsonb') then
    removed := raw::jsonb;
  end if;
  -- Conta sendo apagada (cascata de auth.users): sem evento, senão a chave estrangeira barraria a exclusão.
  insert into public.entry_events (user_id, entry_id, op, kind, before, before_key, happened_at, source)
  select g.user_id, g.id, 'delete', 'removed', public.entry_summary(g.data), public.entry_key(g.data),
         public.entry_event_time(removed ->> g.id), src
  from gone g
  where exists (select 1 from auth.users u where u.id = g.user_id);
  return null;
end;
$$;
-- Security definer só para gravar em entry_events: ninguém chama pela API.
revoke execute on function public.entries_log_event() from public, anon, authenticated;
revoke execute on function public.entries_log_removed() from public, anon, authenticated;

-- ----- delete_entries: a mesma de antes, guardando antes a hora das remoções (vale só nesta transação) -----

create or replace function public.delete_entries(p jsonb)
returns setof text language sql security invoker set search_path = '' as $$
  select pg_catalog.set_config('app.removed_at', coalesce(p, '{}'::jsonb)::text, true);
  delete from public.entries e
  using jsonb_each_text(coalesce(p, '{}'::jsonb)) as x(entry_id, removed_at)
  where e.user_id = (select auth.uid()) and e.id = x.entry_id and coalesce(e.data ->> 'updatedAt', '') <= x.removed_at
  returning e.id;
$$;
revoke all on function public.delete_entries(jsonb) from public, anon;
grant execute on function public.delete_entries(jsonb) to authenticated;

-- ----- backup.restore_collection: a mesma de antes, com os eventos marcados como 'restore' -----

create or replace function backup.restore_collection(p_user uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  stamp text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  saved jsonb;
  cur jsonb;
  back jsonb;
  n_entries integer;
  n_binders integer := 0;
begin
  perform set_config('app.entry_source', 'restore', true);
  if not exists (select 1 from backup.entries_daily where day = p_day and user_id = p_user)
     and not exists (select 1 from backup.binder_settings_daily where day = p_day and user_id = p_user) then
    raise exception 'Não há cópia de % desta conta.', p_day;
  end if;

  -- Fichários livres da cópia que não existem hoje.
  select data into saved from backup.binder_settings_daily where day = p_day and user_id = p_user;
  if saved is not null then
    select data into cur from public.binder_settings where user_id = p_user for update;
    select coalesce(jsonb_agg(x.b || jsonb_build_object('updatedAt', stamp) order by x.n), '[]'::jsonb) into back
    from jsonb_array_elements(case when jsonb_typeof(saved -> 'extras') = 'array' then saved -> 'extras' else '[]'::jsonb end)
         with ordinality as x(b, n)
    where not exists (
      select 1
      from jsonb_array_elements(case when jsonb_typeof(cur -> 'extras') = 'array' then cur -> 'extras' else '[]'::jsonb end) c
      where c ->> 'id' = x.b ->> 'id');
    n_binders := jsonb_array_length(back);
    if cur is null then
      insert into public.binder_settings (user_id, data)
      values (p_user, case when n_binders > 0 then jsonb_set(saved, '{extras}', back) else saved end);
    elsif n_binders > 0 then
      update public.binder_settings
      set data = jsonb_set(cur, '{extras}',
                           (case when jsonb_typeof(cur -> 'extras') = 'array' then cur -> 'extras' else '[]'::jsonb end) || back)
      where user_id = p_user;
    end if;
  end if;

  insert into public.entries (user_id, id, dex, slot, data)
  select b.user_id, b.id, b.dex, b.slot, jsonb_set(b.data, '{updatedAt}', to_jsonb(stamp))
  from backup.entries_daily b
  where b.day = p_day and b.user_id = p_user
  on conflict (user_id, id) do update set dex = excluded.dex, slot = excluded.slot, data = excluded.data;
  get diagnostics n_entries = row_count;

  -- Desliga a marca: o set_config local vale até o fim da transação, não só aqui.
  perform set_config('app.entry_source', '', true);
  return jsonb_build_object('day', p_day, 'entries', n_entries, 'binders', n_binders);
end;
$$;
revoke all on function backup.restore_collection(uuid, date) from public, anon, authenticated;

-- ----- Backfill (uma vez só, antes dos gatilhos e com entries travada) -----
-- Cópia do dia D = estado às 00:20 de D (Brasília), ou seja, o fim de D-1. Cada par de cópias seguidas (e a última
-- contra a tabela agora) vira os fatos do intervalo, comparando só a chave da carta. Hora: a do aparelho
-- (data.updatedAt) presa ao intervalo; nas remoções, a do registro de remoção, senão o começo do intervalo (o dia
-- certo para mostrar "31/10").

insert into public.entry_events (user_id, entry_id, op, kind, changed, before, after, before_key, after_key, at,
                                 happened_at, tx, source)
with snaps as (
  select (day::timestamp + time '00:20') at time zone 'America/Sao_Paulo' as taken_at, user_id, id, data
  from backup.entries_daily
  union all
  -- A de 24/10 sai da cópia diária em 07/11; a cópia feita antes da 3.0 tem o mesmo conteúdo.
  select (timestamp '2026-10-24 00:20') at time zone 'America/Sao_Paulo', user_id, id, data
  from backup.entries_20261024
  where not exists (select 1 from backup.entries_daily where day = '2026-10-24')
  union all
  select now(), user_id, id, data from public.entries
),
cuts as (
  select taken_at, lag(taken_at) over (order by taken_at) as prev_at from (select distinct taken_at from snaps) s
),
k as (select s.*, public.entry_key(s.data) as ekey from snaps s),
a as (select c.taken_at as win_end, c.prev_at as win_start, k.* from cuts c join k on k.taken_at = c.prev_at),
b as (
  select c.taken_at as win_end, c.prev_at as win_start, k.* from cuts c join k on k.taken_at = c.taken_at
  where c.prev_at is not null
),
diff as (
  select coalesce(a.win_start, b.win_start) as win_start, coalesce(a.win_end, b.win_end) as win_end,
         coalesce(a.user_id, b.user_id) as user_id, coalesce(a.id, b.id) as entry_id,
         a.data as old_data, b.data as new_data, a.ekey as before_key, b.ekey as after_key
  from a full join b on b.win_end = a.win_end and b.user_id = a.user_id and b.id = a.id
  where a.ekey is distinct from b.ekey
),
timed as (
  select d.*, case
    when d.new_data is not null
      then greatest(d.win_start, least(d.win_end, public.entry_event_time(d.new_data ->> 'updatedAt')))
    else coalesce((select max(t.deleted_at) from public.entry_tombstones t
                   where t.user_id = d.user_id and t.id = d.entry_id
                     and t.deleted_at > d.win_start and t.deleted_at <= d.win_end), d.win_start)
  end as happened_at
  from diff d
)
select user_id, entry_id,
  case when before_key is null then 'insert' when after_key is null then 'delete' else 'update' end,
  case when before_key is null then 'added' when after_key is null then 'removed' else 'replaced' end,
  case when before_key is not null and after_key is not null then public.entry_key_changes(before_key, after_key) end,
  public.entry_summary(old_data), public.entry_summary(new_data), before_key, after_key,
  happened_at, happened_at, null, 'backfill'
from timed
where not exists (select 1 from public.entry_events where source = 'backfill')
  and not exists (select 1 from pg_catalog.pg_trigger
                  where tgrelid = 'public.entries'::regclass and tgname = 'entries_log_insert');

-- ----- Gatilhos (depois do backfill) -----

create or replace trigger entries_log_insert after insert on public.entries
  for each row execute function public.entries_log_event();
create or replace trigger entries_log_update after update on public.entries
  for each row execute function public.entries_log_event();
create or replace trigger entries_log_delete after delete on public.entries referencing old table as gone
  for each statement execute function public.entries_log_removed();

commit;

-- A API (PostgREST) passa a ver a tabela nova na hora.
notify pgrst, 'reload schema';
