-- 3.0 — Sincronização: remoções no servidor, updated_at do servidor (busca incremental), preço sem contar como edição,
-- limpeza dos campos antigos e cópia diária da coleção.
--
-- Pode rodar mais de uma vez (idempotente). Não apaga dados do usuário: os campos que saem de entries.data são de
-- fontes que já saíram do app (Liga, vendas do "Quanto vale minha carta?", pokemontcg.io), e as tabelas antigas vão
-- para o schema backup (não são apagadas). A cópia de 24/10 continua em backup.*_20261024.

-- ===== 1. Cópia diária da coleção (G1) =====
-- Guarda as cartas e a configuração de cada dia em backup.* por 14 dias. O schema backup não é exposto pela API.

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table if not exists backup.entries_daily (
  day date not null,
  user_id uuid not null,
  id text not null,
  dex int not null,
  slot int not null,
  data jsonb not null,
  updated_at timestamptz not null,
  primary key (day, user_id, id)
);

create table if not exists backup.binder_settings_daily (
  day date not null,
  user_id uuid not null,
  data jsonb not null,
  updated_at timestamptz not null,
  primary key (day, user_id)
);

-- Copia a coleção do dia (dia de Brasília) e apaga as cópias com mais de `keep_days` dias. Rodar de novo no mesmo dia
-- troca a cópia do dia.
create or replace function backup.snapshot_collection(keep_days integer default 14)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'America/Sao_Paulo')::date;
  n_entries integer;
  n_settings integer;
begin
  delete from backup.entries_daily where day = d;
  insert into backup.entries_daily (day, user_id, id, dex, slot, data, updated_at)
  select d, e.user_id, e.id, e.dex, e.slot, e.data, e.updated_at from public.entries e;
  get diagnostics n_entries = row_count;

  delete from backup.binder_settings_daily where day = d;
  insert into backup.binder_settings_daily (day, user_id, data, updated_at)
  select d, s.user_id, s.data, s.updated_at from public.binder_settings s;
  get diagnostics n_settings = row_count;

  delete from backup.entries_daily where day <= d - keep_days;
  delete from backup.binder_settings_daily where day <= d - keep_days;
  return jsonb_build_object('day', d, 'entries', n_entries, 'settings', n_settings);
end;
$$;
revoke all on function backup.snapshot_collection(integer) from public, anon, authenticated;

-- Cópia de hoje antes das mudanças abaixo. Rodando a migração de novo no mesmo dia, a cópia de antes fica (não é
-- trocada pela de depois da limpeza).
select backup.snapshot_collection()
where not exists (select 1 from backup.entries_daily where day = (now() at time zone 'America/Sao_Paulo')::date)
  and not exists (select 1 from backup.binder_settings_daily where day = (now() at time zone 'America/Sao_Paulo')::date);

-- Todo dia às 00:20 de Brasília (depois da foto diária de preços, às 23:50).
select cron.schedule('collection-backup', '20 3 * * *', $$ select backup.snapshot_collection(); $$);

-- ===== 2. updated_at gravado pelo servidor (D3) =====
-- Base da sincronização incremental: o app busca só o que mudou depois da última sincronização (pelo relógio do
-- servidor, não pelo do aparelho). O updatedAt dentro de `data` continua sendo o da última edição do usuário.

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger entries_touch before insert or update on public.entries
  for each row execute function public.touch_updated_at();
create or replace trigger binder_settings_touch before insert or update on public.binder_settings
  for each row execute function public.touch_updated_at();

create index if not exists entries_user_updated on public.entries (user_id, updated_at);

-- ===== 3. Preço mais novo nunca é desfeito (S5) =====
-- Uma carta enviada inteira por um aparelho com o preço mais antigo (do MYP ou da TCGplayer) mantém o preço mais novo
-- que já está no banco, desde que seja desta carta e versão. Os outros campos são do usuário e seguem o que veio.

create or replace function public.entries_keep_newer_prices()
returns trigger language plpgsql set search_path = '' as $$
declare
  k text;
begin
  foreach k in array array['mypApi', 'tcgplayer'] loop
    if jsonb_typeof(old.data -> k) = 'object'
       and old.data -> k ->> 'cardId' = new.data ->> 'cardId'
       and old.data -> k ->> 'variant' = coalesce(new.data ->> 'variant', 'normal')
       and coalesce(old.data -> k ->> 'checkedAt', '') > coalesce(new.data -> k ->> 'checkedAt', '') then
      new.data := jsonb_set(new.data, array[k], old.data -> k);
    end if;
  end loop;
  return new;
end;
$$;

create or replace trigger entries_keep_prices before update on public.entries
  for each row execute function public.entries_keep_newer_prices();

-- ===== 4. Remoções registradas no servidor (S2) =====
-- Carta apagada (removida, movida de bolso ou de fichário apagado) deixa um registro aqui, para os outros aparelhos
-- também tirarem a carta em vez de reenviá-la. Carta recolocada no mesmo bolso apaga o registro. Guardado por 180 dias.

create table if not exists public.entry_tombstones (
  user_id uuid not null,
  id text not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists entry_tombstones_user_deleted on public.entry_tombstones (user_id, deleted_at);
alter table public.entry_tombstones enable row level security;
drop policy if exists "own tombstones" on public.entry_tombstones;
create policy "own tombstones" on public.entry_tombstones
  for select to authenticated using ((select auth.uid()) = user_id);
-- Só os gatilhos abaixo gravam aqui. A leitura é explícita (não depende da permissão padrão do projeto).
revoke all on public.entry_tombstones from anon;
revoke insert, update, delete, truncate on public.entry_tombstones from authenticated;
grant select on public.entry_tombstones to authenticated;

create or replace function public.entries_tombstone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.entry_tombstones (user_id, id, deleted_at) values (old.user_id, old.id, now())
  on conflict (user_id, id) do update set deleted_at = excluded.deleted_at;
  return null;
end;
$$;

create or replace function public.entries_untombstone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.entry_tombstones where user_id = new.user_id and id = new.id;
  return null;
end;
$$;

create or replace trigger entries_tombstone after delete on public.entries
  for each row execute function public.entries_tombstone();
create or replace trigger entries_untombstone after insert on public.entries
  for each row execute function public.entries_untombstone();

-- Apaga várias cartas de uma vez (p = { "<id>": "<quando foi removida, ISO>" }), menos as que foram alteradas depois
-- da remoção (recolocadas em outro aparelho). Devolve os ids apagados. Roda com as permissões do usuário.
create or replace function public.delete_entries(p jsonb)
returns setof text language sql security invoker set search_path = '' as $$
  delete from public.entries e
  using jsonb_each_text(coalesce(p, '{}'::jsonb)) as x(entry_id, removed_at)
  where e.user_id = (select auth.uid()) and e.id = x.entry_id and coalesce(e.data ->> 'updatedAt', '') <= x.removed_at
  returning e.id;
$$;
revoke all on function public.delete_entries(jsonb) from public, anon;
grant execute on function public.delete_entries(jsonb) to authenticated;

-- ===== 5. Gravar um preço não conta como edição (S5) =====
-- Reescritas: não mexem mais no updatedAt da carta (edições do usuário ainda não enviadas continuam valendo, e uma
-- remoção feita sem internet não é desfeita). Os aparelhos juntam os preços pelo checkedAt. Preço mais antigo que o
-- já gravado (aparelho atrasado) é ignorado.

-- Grava os preços do MYP (mypApi) SOBRE a carta como está no banco e aplica a regra do "Meu valor" com o valor atual do
-- banco: se a média do MYP (desta carta, versão e selo) passar dele, ele é apagado e fica o registro da troca.
create or replace function public.patch_entry_myp(p_id text, p_myp jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  cur jsonb;
  nxt jsonb;
  mine numeric;
  avg numeric;
  v text;
  note text;
begin
  select data into cur from public.entries where user_id = (select auth.uid()) and id = p_id for update;
  if cur is null then
    return null;
  end if;
  v := coalesce(cur->>'variant', 'normal');
  if cur->'mypApi'->>'cardId' = p_myp->>'cardId' and cur->'mypApi'->>'variant' = p_myp->>'variant'
     and coalesce(cur->'mypApi'->>'checkedAt', '') > coalesce(p_myp->>'checkedAt', '') then
    return jsonb_build_object('prev', cur->>'updatedAt', 'data', cur);
  end if;
  nxt := cur || jsonb_build_object('mypApi', p_myp);
  mine := nullif(cur->'myValue'->>'value', '')::numeric;
  avg := nullif(p_myp->>'avg', '')::numeric;
  note := case when v in ('wPromo', 'staff') then coalesce(btrim(cur->>'variantNote'), '') else '' end;
  -- Vale para toda versão (versão especial que o MYP não vende à parte usa o preço da carta base, valor parecido); nas
  -- cartas em inglês o MYP é só referência (o valor vem da TCGplayer), então não apaga o "Meu valor".
  if coalesce(cur->>'lang', 'pt') <> 'en' and mine is not null and avg is not null and avg > mine
     and p_myp->>'cardId' = cur->>'cardId' and p_myp->>'variant' = v and coalesce(p_myp->>'note', '') = note then
    nxt := nxt || jsonb_build_object(
      'myValue', null,
      'myValueReplaced', jsonb_build_object('value', mine, 'mypValue', avg, 'at', p_myp->>'checkedAt', 'source', 'myp'));
  end if;
  update public.entries set data = nxt where user_id = (select auth.uid()) and id = p_id;
  return jsonb_build_object('prev', cur->>'updatedAt', 'data', nxt);
end;
$$;
revoke all on function public.patch_entry_myp(text, jsonb) from public, anon;
grant execute on function public.patch_entry_myp(text, jsonb) to authenticated;

-- Grava o preço da TCGplayer (tcgplayer) sobre a carta como está no banco e aplica a regra do "Meu valor" (cartas em
-- inglês: a média, que é o valor de mercado, em reais).
create or replace function public.patch_entry_tcgplayer(p_id text, p_tcg jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  cur jsonb;
  nxt jsonb;
  mine numeric;
  avg numeric;
  v text;
  note text;
begin
  select data into cur from public.entries where user_id = (select auth.uid()) and id = p_id for update;
  if cur is null then
    return null;
  end if;
  v := coalesce(cur->>'variant', 'normal');
  if cur->'tcgplayer'->>'cardId' = p_tcg->>'cardId' and cur->'tcgplayer'->>'variant' = p_tcg->>'variant'
     and coalesce(cur->'tcgplayer'->>'checkedAt', '') > coalesce(p_tcg->>'checkedAt', '') then
    return jsonb_build_object('prev', cur->>'updatedAt', 'data', cur);
  end if;
  nxt := cur || jsonb_build_object('tcgplayer', p_tcg);
  mine := nullif(cur->'myValue'->>'value', '')::numeric;
  avg := nullif(p_tcg->>'avg', '')::numeric;
  -- Selo ou versão do catálogo (promo, Cosmos Holo, Reverse da Costco…): a TCGplayer vende à parte.
  note := coalesce(btrim(cur->>'variantNote'), '');
  if cur->>'lang' = 'en' and mine is not null and avg is not null and avg > mine
     and p_tcg->>'cardId' = cur->>'cardId' and p_tcg->>'variant' = v and coalesce(p_tcg->>'note', '') = note then
    nxt := nxt || jsonb_build_object(
      'myValue', null,
      'myValueReplaced', jsonb_build_object('value', mine, 'mypValue', avg, 'at', p_tcg->>'checkedAt', 'source', 'tcgplayer'));
  end if;
  update public.entries set data = nxt where user_id = (select auth.uid()) and id = p_id;
  return jsonb_build_object('prev', cur->>'updatedAt', 'data', nxt);
end;
$$;
revoke all on function public.patch_entry_tcgplayer(text, jsonb) from public, anon;
grant execute on function public.patch_entry_tcgplayer(text, jsonb) to authenticated;

-- ===== 6. Limpeza do que ficou das fontes que saíram (B3) =====

-- Campos antigos dentro das cartas (~60% do texto de cada uma), sem mexer no updatedAt da carta. O ligaQuery fica: é a
-- busca exata do link "Ver na Liga" com os casos especiais de numeração. O app faz a mesma limpeza no aparelho.
update public.entries
set data = data - array['myp', 'sold', 'intl', 'price', 'ligaImage', 'ligaFinishes', 'ligaUrl', 'ligaCheckedAt',
                        'ligaMismatch', 'ligaNotFound', 'ptcgId']
where data ?| array['myp', 'sold', 'intl', 'price', 'ligaImage', 'ligaFinishes', 'ligaUrl', 'ligaCheckedAt',
                    'ligaMismatch', 'ligaNotFound', 'ptcgId'];

-- Gravava campos do servidor nas cartas (preços da Liga e das vendas); ninguém usa mais.
drop function if exists public.set_entry_fields(uuid, text, jsonb);

-- Tabelas das fontes que saíram (preços da Liga obtidos pela Apify, execuções da busca na Liga, Jornada): saem da API
-- e ficam guardadas no schema backup. O qvmc_cache fica (guarda o marcador do catalog-sync).
do $$
declare
  t text;
begin
  foreach t in array array['liga_price_cache', 'liga_sync_runs', 'jornada_cards'] loop
    if to_regclass('public.' || t) is not null and to_regclass('backup.' || t) is null then
      execute format('alter table public.%I set schema backup', t);
    end if;
  end loop;
end;
$$;

-- Nada no schema backup fica acessível pela API, nem se o schema for exposto um dia.
do $$
declare
  t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname = 'backup' loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
    execute format('revoke all on table %I.%I from anon, authenticated', t.schemaname, t.tablename);
  end loop;
end;
$$;

-- Limpeza diária (03:40 UTC): histórico do pg_cron com mais de 14 dias e registros de remoção com mais de 180 dias (ou
-- de contas que não existem mais).
select cron.schedule('daily-cleanup', '40 3 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '14 days';
  delete from public.entry_tombstones t
  where t.deleted_at < now() - interval '180 days'
     or not exists (select 1 from auth.users u where u.id = t.user_id);
$$);

-- A API passa a ver a tabela e as funções novas.
notify pgrst, 'reload schema';
