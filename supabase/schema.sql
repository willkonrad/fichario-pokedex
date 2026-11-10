-- Fichário Pokédex · banco de dados (Supabase, Postgres 17) — retrato completo da versão 3.5.0.
--
-- Este arquivo é o espelho do banco em produção: tabelas, regras de acesso (RLS), funções, gatilhos e crons, já com as
-- migrações de supabase/migrations/ aplicadas (20261024a_sync, 20261024b_catalog, 20261024c_pricing,
-- 20261024d_fixes, 20261025a_hardening, 20261025b_group_dates, 20261105a_link_fix (só dados),
-- 20261105b_entry_events, sem o backfill, que é um passo único sobre os dados, 20261107a_japonesas, sem a limpeza
-- das datas, outro passo único sobre os dados (a nova cópia do catálogo japonês é feita pelo próprio catalog-sync), e
-- 20261109a_consulta).
-- Pode rodar mais de uma vez (idempotente): cria o que falta e troca as funções pela versão daqui, sem apagar dados.
--
-- Projeto novo: troque SEU_PROJECT_REF (cron do catalog-sync, no fim) e rode o arquivo inteiro no SQL Editor, ou com
-- `supabase db query --linked -f supabase/schema.sql`.
--
-- Mudança num banco que já está em uso: vai num arquivo novo em supabase/migrations/ (idempotente, comentado em
-- português), aplicado com o Supabase CLI (`supabase db query --linked -f supabase/migrations/<arquivo>.sql`) ou pela
-- ferramenta execute_sql do MCP do Supabase, e depois espelhada aqui. Os nomes dos arquivos não seguem o padrão do
-- `supabase db push`; não use esse comando. As migrações guardam o histórico e as limpezas de dados de cada versão;
-- este arquivo é a foto completa. Passo a passo em docs/arquitetura.md.

-- ===== Extensões =====

-- pg_cron (agenda os jobs), pg_net (o cron chama a Edge Function por HTTP), pg_trgm (busca por trechos do nome) e
-- pgcrypto (chave aleatória do Vault). No projeto atual o pg_net ficou no schema public, de antes; as funções dele
-- ficam no schema net de qualquer jeito.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ===== Coleção =====
-- As tabelas do app têm a permissão padrão do Supabase para anon e authenticated; quem decide o acesso é o RLS.

create table if not exists public.binder_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null, -- "<dex>-<slot>" (Pokédex) ou "<fichário>:<bolso>" (fichário livre)
  dex int not null,
  slot int not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.binder_settings enable row level security;
alter table public.entries enable row level security;

drop policy if exists "own settings" on public.binder_settings;
create policy "own settings" on public.binder_settings
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- updated_at gravado pelo servidor: base da sincronização incremental (o app busca só o que mudou depois da última
-- sincronização, pelo relógio do servidor). O updatedAt dentro de `data` continua sendo o da última edição do usuário.
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
-- Funções de gatilho não são chamadas pela API. O Postgres confere o EXECUTE só ao criar o gatilho (o dono, postgres,
-- continua com ele), não quando ele dispara.
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

create index if not exists entries_user_updated on public.entries (user_id, updated_at);

-- Preço mais novo nunca é desfeito: uma carta enviada inteira por um aparelho com o preço mais antigo (do MYP ou da
-- TCGplayer) mantém o preço mais novo que já está no banco, desde que seja desta carta, versão e idioma. Os outros
-- campos são do usuário e seguem o que veio. Se o preço que ficou for mais novo que o "Meu valor" e a média passar dele,
-- vale a mesma regra das funções patch_entry_myp / patch_entry_tcgplayer: o "Meu valor" sai e fica o registro da troca
-- (nas cartas em inglês e japonês, pela TCGplayer; nas outras, pelo MYP, desta versão e selo).
create or replace function public.entries_keep_newer_prices()
returns trigger language plpgsql set search_path = '' as $$
declare
  k text;
  p jsonb;
  tcg boolean;
  v text;
  rule_key text;
  note text;
  mine numeric;
  avg numeric;
begin
  -- Cartas em inglês e japonês: o valor vem da TCGplayer.
  tcg := coalesce(new.data ->> 'lang', 'pt') in ('en', 'ja');
  v := coalesce(new.data ->> 'variant', 'normal');
  -- Fonte que apaga o "Meu valor": TCGplayer nas cartas em inglês e japonês, MYP nas outras.
  rule_key := case when tcg then 'tcgplayer' else 'mypApi' end;
  foreach k in array array['mypApi', 'tcgplayer'] loop
    if jsonb_typeof(old.data -> k) = 'object'
       and old.data -> k ->> 'cardId' = new.data ->> 'cardId'
       and old.data -> k ->> 'variant' = v
       and coalesce(old.data ->> 'lang', 'pt') = coalesce(new.data ->> 'lang', 'pt')
       and coalesce(old.data -> k ->> 'checkedAt', '') > coalesce(new.data -> k ->> 'checkedAt', '') then
      p := old.data -> k;
      new.data := jsonb_set(new.data, array[k], p);
      if k = rule_key then
        mine := nullif(new.data -> 'myValue' ->> 'value', '')::numeric;
        avg := nullif(p ->> 'avg', '')::numeric;
        note := case when tcg or v in ('wPromo', 'staff') then coalesce(btrim(new.data ->> 'variantNote'), '') else '' end;
        if mine is not null and avg is not null and avg > mine and coalesce(p ->> 'note', '') = note
           and coalesce(p ->> 'checkedAt', '') > coalesce(new.data -> 'myValue' ->> 'setAt', '') then
          new.data := new.data || jsonb_build_object(
            'myValue', null,
            'myValueReplaced', jsonb_build_object('value', mine, 'mypValue', avg, 'at', p ->> 'checkedAt',
                                                  'source', case when tcg then 'tcgplayer' else 'myp' end));
        end if;
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create or replace trigger entries_keep_prices before update on public.entries
  for each row execute function public.entries_keep_newer_prices();
revoke execute on function public.entries_keep_newer_prices() from public, anon, authenticated;

-- ===== Remoções registradas no servidor =====
-- Carta apagada (removida, movida de bolso ou de fichário apagado) deixa um registro aqui, para os outros aparelhos
-- também tirarem a carta em vez de reenviá-la. Carta recolocada no mesmo bolso apaga o registro. Guardado por 180 dias
-- (cron daily-cleanup).

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
-- Security definer só para o gatilho gravar em entry_tombstones: ninguém chama pela API (/rest/v1/rpc/...).
revoke execute on function public.entries_tombstone() from public, anon, authenticated;
revoke execute on function public.entries_untombstone() from public, anon, authenticated;

-- Apaga várias cartas de uma vez (p = { "<id>": "<quando foi removida, ISO>" }), menos as que foram alteradas depois
-- da remoção (recolocadas em outro aparelho). Devolve os ids apagados. Roda com as permissões do usuário. Antes, deixa
-- `p` na transação (app.removed_at), para o registro de mudanças (entries_log_removed) gravar a hora de cada remoção.
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

-- ===== Registro de mudanças das cartas (tela "Relatórios") =====
-- Cada carta que entra, sai ou é trocada num bolso vira um fato cru em entry_events, gravado por gatilho. Só conta a
-- troca da chave da carta (carta, idioma, versão e selo): preço, data, texto, imagem e reenvio da sincronização não
-- geram nada. Movida, troca de lugar, "Desfazer" e digitação do selo se resolvem na leitura (src/lib/activity.ts).
-- Guardado para sempre (~1 KB por evento); conta apagada leva os eventos junto. O histórico de antes do gatilho
-- (desde 24/10) foi reconstruído uma vez das cópias diárias (source 'backfill', só na migração 20261105b_entry_events).

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

-- Só os gatilhos usam (rodam como dono); fora da API.
revoke execute on function public.entry_key(jsonb) from public, anon, authenticated;
revoke execute on function public.entry_summary(jsonb) from public, anon, authenticated;
revoke execute on function public.entry_event_time(text) from public, anon, authenticated;
revoke execute on function public.entry_key_changes(text, text) from public, anon, authenticated;

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

-- Um fato por linha; UPDATE só quando a carta do bolso mudou (preço, data, texto e reenvio não contam). A origem
-- 'restore' vem de backup.restore_collection (app.entry_source).
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

create or replace trigger entries_log_insert after insert on public.entries
  for each row execute function public.entries_log_event();
create or replace trigger entries_log_update after update on public.entries
  for each row execute function public.entries_log_event();
create or replace trigger entries_log_delete after delete on public.entries referencing old table as gone
  for each statement execute function public.entries_log_removed();
-- Security definer só para gravar em entry_events: ninguém chama pela API.
revoke execute on function public.entries_log_event() from public, anon, authenticated;
revoke execute on function public.entries_log_removed() from public, anon, authenticated;

-- ===== Preço gravado na carta (o app grava; gravar um preço não conta como edição) =====
-- Não mexem no updatedAt da carta (edições do usuário ainda não enviadas continuam valendo, e uma remoção feita sem
-- internet não é desfeita). Os aparelhos juntam os preços pelo checkedAt. Preço mais antigo que o já gravado (aparelho
-- atrasado) é ignorado. Rodam com as permissões do usuário.

-- Preços do MYP Cards (mypApi: mínimo/média/máximo da API pública, buscados pelo app no celular), gravados SOBRE a
-- carta como está no banco, com a regra do "Meu valor" pelo valor atual do banco: se a média do MYP (desta carta,
-- versão e selo) passar dele, ele é apagado e fica o registro da troca.
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
  -- cartas em inglês o MYP é só referência (o valor vem da TCGplayer) e nas japonesas ele não é fonte, então não apaga
  -- o "Meu valor".
  if coalesce(cur->>'lang', 'pt') not in ('en', 'ja') and mine is not null and avg is not null and avg > mine
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

-- Preço da TCGplayer (tcgplayer, cartas em inglês e japonês), gravado sobre a carta como está no banco, com a regra do
-- "Meu valor" (a média, que é o valor de mercado, em reais).
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
  if cur->>'lang' in ('en', 'ja') and mine is not null and avg is not null and avg > mine
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

-- Saiu na 3.0: gravava campos do servidor nas cartas (preços da Liga e das vendas).
drop function if exists public.set_entry_fields(uuid, text, jsonb);

-- ===== Servidor: marcadores e chave dos crons =====

-- Marcadores do servidor (hoje só o do catalog-sync, "tcgcsv:groups-listed"); só o servidor lê e grava. O nome vem de
-- quando guardava as páginas de vendas reais do "Quanto vale minha carta?", fonte que saiu na 2.5.0.
create table if not exists public.qvmc_cache (
  key text primary key,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.qvmc_cache enable row level security;

-- Chave aleatória que só o cron conhece (guardada no Vault).
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'liga_sync_key', 'Chave dos crons do servidor')
where not exists (select 1 from vault.secrets where name = 'liga_sync_key');

create or replace function public.check_liga_sync_key(k text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'liga_sync_key' and decrypted_secret = k);
$$;
revoke all on function public.check_liga_sync_key(text) from public, anon, authenticated;
grant execute on function public.check_liga_sync_key(text) to service_role;

-- ===== Catálogo de cartas: TCGCSV (base principal) ligado à TCGdex — Edge Function catalog-sync + pg_cron =====

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

-- Coleções do TCGCSV (catálogo da TCGplayer): 3 = Pokémon em inglês, 85 = japonês.
create table if not exists public.tcg_groups (
  group_id integer primary key,
  category smallint not null,
  name text not null,
  abbr text,
  modified_on timestamptz,
  synced_at timestamptz,
  -- Versão da regra de ligação TCGCSV → TCGdex aplicada (sobe quando a regra melhora, para religar sem baixar de novo).
  -- Na 85, que não é ligada, a versão da cópia (JA_COPY_VERSION no catalog-sync: com uma menor, é copiada de novo).
  link_version integer not null default 0,
  -- Versão dos preços da TCGplayer copiada (built_at do TCGCSV).
  prices_at timestamptz,
  -- Data de lançamento da coleção (publishedOn do TCGCSV): o ano aparece ao lado do nome da coleção no app. Nula sem
  -- data de verdade (o TCGCSV manda a data do dia quando a coleção não tem).
  published_on date
);
-- Colunas que chegaram depois da criação da tabela (bancos antigos).
alter table public.tcg_groups add column if not exists link_version integer not null default 0;
alter table public.tcg_groups add column if not exists prices_at timestamptz;
alter table public.tcg_groups add column if not exists published_on date;

-- Cartas do TCGCSV, ligadas ao id da TCGdex quando a carta existe lá (mesma coleção, número e nome; só a categoria 3).
-- Na 85 (japonês) entram também as cartas sem número impresso (as antigas, 1996–2002), reconhecidas pelos campos de
-- carta do produto (catalog-sync, products.ts), com `number` nulo; produto lacrado fica de fora.
create table if not exists public.tcg_catalog (
  product_id integer primary key,
  category smallint not null,
  group_id integer not null references public.tcg_groups (group_id) on delete cascade,
  name text not null,
  full_name text not null,
  number text,
  rarity text,
  image text not null,
  stamp text,
  tcgdex_id text,
  updated_at timestamptz not null default now(),
  -- Calculada pelo banco (busca sem acento, apóstrofo ou símbolo), sem mudar o catalog-sync.
  name_plain text generated always as (public.catalog_plain(name)) stored,
  hp smallint,
  card_type text,   -- como vem da fonte: "Lightning", "Trainer", "Energy"…
  stage text,
  released_on date  -- presaleInfo.releasedOn; guardado, ainda não usado
);
alter table public.tcg_catalog
  add column if not exists name_plain text generated always as (public.catalog_plain(name)) stored;
alter table public.tcg_catalog
  add column if not exists hp smallint,
  add column if not exists card_type text,
  add column if not exists stage text,
  add column if not exists released_on date;
create index if not exists tcg_catalog_name_trgm on public.tcg_catalog using gin (name extensions.gin_trgm_ops);
create index if not exists tcg_catalog_name_plain_trgm on public.tcg_catalog using gin (name_plain extensions.gin_trgm_ops);
create index if not exists tcg_catalog_tcgdex on public.tcg_catalog (tcgdex_id);
create index if not exists tcg_catalog_group on public.tcg_catalog (group_id);

-- Siglas e cartas das coleções da TCGdex (para ligar às do TCGCSV); só o servidor lê e grava.
create table if not exists public.tcgdex_sets (
  id text primary key,
  name text,
  abbr text,
  cards jsonb,
  synced_at timestamptz not null default now(),
  release_date date
);
alter table public.tcgdex_sets add column if not exists release_date date;

alter table public.tcg_groups enable row level security;
alter table public.tcg_catalog enable row level security;
alter table public.tcgdex_sets enable row level security;
drop policy if exists "catálogo público" on public.tcg_groups;
create policy "catálogo público" on public.tcg_groups for select to anon, authenticated using (true);
drop policy if exists "catálogo público" on public.tcg_catalog;
create policy "catálogo público" on public.tcg_catalog for select to anon, authenticated using (true);

-- Religa cartas do catálogo à TCGdex em lote, com o selo e, quando vier, o nome recalculado do nome completo do produto
-- (ex.: "Unown [M]" → "Unown M"): p = [{ product_id, tcgdex_id, stamp, name? }] (só o servidor). Sem "name", fica o
-- nome atual.
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

-- Coleções a copiar: nunca copiadas, alteradas na TCGplayer (modified_on) depois da própria cópia (synced_at) ou, na 85,
-- copiadas com uma versão da cópia menor (p_ja_copy_version, o JA_COPY_VERSION de products.ts). Na 3 a versão não pede
-- cópia: a religação refaz a ligação a partir da cópia guardada. Em inglês primeiro e, em cada categoria, as sem data e
-- as mais antigas primeiro. Só o catalog-sync chama (o catálogo já é público, então não precisa de security definer).
create or replace function public.catalog_due_groups(p_ja_copy_version integer)
returns table (group_id integer, category smallint, name text, abbr text, modified_on timestamptz, synced_at timestamptz, link_version integer)
language sql stable security invoker set search_path = '' as $$
  select g.group_id, g.category, g.name, g.abbr, g.modified_on, g.synced_at, g.link_version
  from public.tcg_groups g
  where g.synced_at is null
    or g.modified_on > g.synced_at
    or (g.category = 85 and g.link_version < p_ja_copy_version)
  order by g.category, g.published_on asc nulls first;
$$;
revoke all on function public.catalog_due_groups(integer) from public, anon, authenticated;
grant execute on function public.catalog_due_groups(integer) to service_role;

-- ===== Preços da TCGplayer (cartas em inglês e japonês), via TCGCSV, e câmbio oficial (PTAX) — catalog-sync =====

-- Preço atual de cada produto e impressão (subTypeName: Normal, Holofoil, Reverse Holofoil, 1st Edition…), em US$.
create table if not exists public.tcg_prices (
  product_id integer not null,
  sub_type text not null,
  group_id integer not null,
  low numeric,
  mid numeric,
  market numeric,
  built_at timestamptz not null,
  primary key (product_id, sub_type)
);
create index if not exists tcg_prices_group on public.tcg_prices (group_id);
alter table public.tcg_prices enable row level security;
drop policy if exists "preços da tcgplayer" on public.tcg_prices;
create policy "preços da tcgplayer" on public.tcg_prices for select to anon, authenticated using (true);

-- Câmbio do dia (PTAX de venda; ex.: USD = 5,0383).
create table if not exists public.fx_rates (
  day date not null,
  currency text not null,
  sell numeric not null,
  buy numeric,
  source text not null default 'bcb_ptax',
  fetched_at timestamptz not null default now(),
  primary key (day, currency)
);
alter table public.fx_rates enable row level security;
drop policy if exists "câmbio" on public.fx_rates;
create policy "câmbio" on public.fx_rates for select to anon, authenticated using (true);

-- Grava os preços de uma coleção (só produtos do catálogo dela), apaga os que saíram e marca a versão do TCGCSV.
create or replace function public.upsert_tcg_prices(p_group integer, p_built timestamptz, p jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  insert into public.tcg_prices (product_id, sub_type, group_id, low, mid, market, built_at)
  select x.product_id, x.sub_type, p_group, x.low, x.mid, x.market, p_built
  from jsonb_to_recordset(p) as x(product_id integer, sub_type text, low numeric, mid numeric, market numeric)
  where x.sub_type is not null
    and exists (select 1 from public.tcg_catalog c where c.product_id = x.product_id and c.group_id = p_group)
  on conflict (product_id, sub_type) do update
    set low = excluded.low, mid = excluded.mid, market = excluded.market, built_at = excluded.built_at, group_id = excluded.group_id;
  get diagnostics n = row_count;
  delete from public.tcg_prices t where t.group_id = p_group and t.built_at < p_built;
  update public.tcg_groups set prices_at = p_built where group_id = p_group;
  return n;
end;
$$;
revoke all on function public.upsert_tcg_prices(integer, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_tcg_prices(integer, timestamptz, jsonb) to service_role;

-- ===== Registro das execuções do catalog-sync =====

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

-- Resumo para a tela "Sobre e fontes" do app: última execução, última sem erro, falhas nas últimas 24 h e a idade do
-- catálogo, dos preços da TCGplayer e da PTAX.
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

-- ===== Histórico diário do valor (gráfico "Evolução do valor", variação, histórico de cada carta) =====

create table if not exists public.price_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id text not null,
  day date not null,
  card_id text,
  lang text,
  condition text,
  variant text,
  -- { manual, mypApi: { min, avg, max, own }, tcgplayer: { min, avg, max, usd, fx, built? }, basis }. Fotos antigas
  -- podem ter também sold, myp e mypOffer (fontes que saíram); as somas as ignoram.
  sources jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, entry_id, day)
);
alter table public.price_history enable row level security;
drop policy if exists "own price history" on public.price_history;
create policy "own price history" on public.price_history
  for select to authenticated using ((select auth.uid()) = user_id);

-- Período do gráfico: as fotos de um usuário por dia (a chave primária começa por user_id, entry_id).
create index if not exists price_history_user_day on public.price_history (user_id, day);

-- Total da coleção num dia, o mesmo que collection_history devolve. É uma conta guardada, refeita a qualquer hora a
-- partir de price_history (history_day_totals), e não um dado do usuário.
create table if not exists public.price_history_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  value numeric not null,                          -- soma do valor escolhido em cada carta ("Usar na soma")
  min numeric not null,
  avg numeric not null,
  max numeric not null,
  cards integer not null,                          -- cartas com preço naquele dia
  computed_at timestamptz not null default now(),  -- quando o total foi calculado
  primary key (user_id, day)
);
alter table public.price_history_daily enable row level security;
drop policy if exists "own daily totals" on public.price_history_daily;
create policy "own daily totals" on public.price_history_daily
  for select to authenticated using ((select auth.uid()) = user_id);
-- Só history_day_totals grava aqui. A leitura é explícita (não depende da permissão padrão do projeto).
revoke all on public.price_history_daily from public, anon, authenticated;
grant select on public.price_history_daily to authenticated;

-- Soma de cada dia, por conta, desde p_from (null: todos os dias): a soma do valor escolhido em cada carta (value), as
-- somas dos mínimos, das médias e dos máximos e quantas cartas tinham preço. Roda com as permissões de quem chama:
-- pela API, o RLS de price_history deixa só as fotos da própria conta; em history_day_totals, todas.
-- Valor de cada foto, com a mesma regra do app (src/lib/valuation.ts e src/lib/history.ts, snapshotValue): "Meu valor"
-- (mínimo, média e máximo iguais a ele), senão a TCGplayer (só cartas em inglês e japonês, já em reais), senão
-- mínimo/média/máximo do MYP. O mínimo e o máximo nunca ficam do lado de dentro da média, e o valor da carta (pick)
-- segue a escolha gravada na foto (basis; sem ela, a média). Foto sem preço não entra. A regra fica aqui, sem função
-- auxiliar: função com `set search_path` não é embutida na consulta e rodaria uma vez por foto.
-- A consulta vai por EXECUTE, planejada a cada chamada com a data pedida: pedindo poucos dias (o resto de
-- collection_history), ela usa o índice (user_id, day). Numa função SQL, o Postgres 17 usa sempre o plano genérico,
-- que lê a tabela inteira.
create or replace function public.history_day_sums(p_from date)
returns table (user_id uuid, day date, value numeric, min numeric, avg numeric, max numeric, cards integer)
language plpgsql stable security invoker set search_path = '' as $$
begin
  return query execute $q$
    with k as (
      select h.user_id, h.day, h.sources as s,
        case
          when jsonb_typeof(h.sources->'manual'->'value') = 'number' then 'manual'
          when h.lang in ('en', 'ja') and jsonb_typeof(h.sources->'tcgplayer'->'avg') = 'number' then 'tcgplayer'
          when jsonb_typeof(h.sources->'mypApi'->'avg') = 'number' then 'mypApi'
        end as kind
      from public.price_history h
      where h.day >= coalesce($1, '-infinity'::date)
        -- Fotos antigas de cartas sem preço (só com basis ou campos das fontes antigas) saem logo aqui.
        and h.sources ?| array['manual', 'mypApi', 'tcgplayer']
    ), p as (
      select k.user_id, k.day, k.s, k.kind,
        case when k.kind = 'manual' then (k.s->'manual'->>'value')::numeric else (k.s->k.kind->>'avg')::numeric end as mid,
        case when k.kind <> 'manual' and jsonb_typeof(k.s->k.kind->'min') = 'number' then (k.s->k.kind->>'min')::numeric end as lo,
        case when k.kind <> 'manual' and jsonb_typeof(k.s->k.kind->'max') = 'number' then (k.s->k.kind->>'max')::numeric end as hi
      from k
      where k.kind is not null
    ), r as (
      select p.user_id, p.day, p.s, p.kind, least(coalesce(p.lo, p.mid), p.mid) as lo, p.mid, greatest(coalesce(p.hi, p.mid), p.mid) as hi
      from p
    )
    select r.user_id, r.day,
      round(sum(case
        when r.kind = 'manual' then r.mid
        when r.s->>'basis' = 'min' then r.lo
        when r.s->>'basis' = 'max' then r.hi
        else r.mid
      end), 2),
      round(sum(r.lo), 2), round(sum(r.mid), 2), round(sum(r.hi), 2), count(*)::integer
    from r
    group by r.user_id, r.day
  $q$ using p_from;
end;
$$;
revoke all on function public.history_day_sums(date) from public, anon;
grant execute on function public.history_day_sums(date) to authenticated;

-- Total da coleção por dia desde p_from (sem p_from, todos os dias), da conta que chama: os totais guardados
-- (price_history_daily) e, nos dias depois do último total guardado, a soma feita agora (history_day_sums, chamada
-- uma vez). A conta não cresce com as fotos do ano: são até 366 totais e as fotos de um dia. Roda com as permissões do
-- usuário (só os dados dele). A variação do período e o histórico de cada carta são calculados no app
-- (src/lib/history.ts).
create or replace function public.collection_history(p_from date default null)
returns table (day date, value numeric, min numeric, avg numeric, max numeric, cards integer)
language sql stable security invoker set search_path = '' as $$
  with done as (
    -- Último dia com total guardado desta conta (sem nenhum, tudo é somado agora).
    select max(d.day) as day from public.price_history_daily d where d.user_id = (select auth.uid())
  )
  select d.day, d.value, d.min, d.avg, d.max, d.cards
  from public.price_history_daily d
  where d.user_id = (select auth.uid()) and d.day >= coalesce(p_from, '-infinity'::date)
  union all
  select s.day, s.value, s.min, s.avg, s.max, s.cards
  from done, public.history_day_sums(greatest(coalesce(p_from, '-infinity'::date), done.day + 1)) s
  where s.user_id = (select auth.uid())
  order by 1;
$$;
revoke all on function public.collection_history(date) from public, anon;
grant execute on function public.collection_history(date) to authenticated;

-- Grava em price_history_daily os totais de cada dia desde p_from, de todas as contas (o que history_day_sums dá), e
-- tira o total de um dia que ficou sem foto com preço. Sem p_from: a última semana e qualquer dia depois do último
-- total guardado (um dia em que o cron falhou entra na execução seguinte, e os totais guardados não ficam com
-- buraco); com a tabela vazia, todos os dias. Devolve quantos totais gravou. Só o cron "price-totals" e as migrações
-- chamam. Mudou a regra da soma (history_day_sums) ou alguma foto já gravada? Recalcule tudo na mesma migração:
-- select public.history_day_totals('-infinity');
create or replace function public.history_day_totals(p_from date default null)
returns integer language sql security definer set search_path = '' as $$
  with f as (
    select case
      when p_from is not null then p_from
      when max(d.day) is null then '-infinity'::date
      else least(max(d.day) + 1, (now() at time zone 'America/Sao_Paulo')::date - 6)
    end as day
    from public.price_history_daily d
  ), t as (
    select s.user_id, s.day, s.value, s.min, s.avg, s.max, s.cards
    from f, public.history_day_sums(f.day) s
  ), gone as (
    -- Só o total (uma conta guardada); as fotos ficam.
    delete from public.price_history_daily d
    using f
    where d.day >= f.day and not exists (select 1 from t where t.user_id = d.user_id and t.day = d.day)
  ), up as (
    insert into public.price_history_daily (user_id, day, value, min, avg, max, cards)
    select t.user_id, t.day, t.value, t.min, t.avg, t.max, t.cards from t
    on conflict (user_id, day) do update
      set value = excluded.value, min = excluded.min, avg = excluded.avg, max = excluded.max,
          cards = excluded.cards, computed_at = now()
    returning 1
  )
  select count(*)::integer from up;
$$;
revoke all on function public.history_day_totals(date) from public, anon, authenticated;

-- Saiu: era executada uma vez por foto; a regra está em history_day_sums.
drop function if exists public.history_value(jsonb, text);

-- Foto diária do valor de cada carta (cron "price-snapshot", 23:50 de Brasília). Grava uma linha por carta COM PREÇO
-- (as outras não entram em nenhuma soma), com as fontes daquele dia:
--   manual     "Meu valor" (só quando tem um número);
--   mypApi     mínimo/média/máximo do MYP desta carta, versão e selo (buscados pelo app no celular);
--   tcgplayer  só cartas em inglês e japonês, do produto e impressão gravados na carta: o preço do dia (tcg_prices) ×
--              o câmbio mais recente, com a conta do app (mínimo = menor anúncio, média = mercado, máximo = mediana,
--              2 casas); sem preço do dia ou sem câmbio, o preço gravado na carta;
--   basis      a escolha da carta ("Usar na soma": min, avg ou max).
create or replace function public.snapshot_prices()
returns integer language sql security definer set search_path = '' as $$
  with fx as (
    -- Câmbio mais recente do dólar (PTAX de venda).
    select f.sell from public.fx_rates f where f.currency = 'USD' order by f.day desc limit 1
  ),
  cur as (
    select e.user_id, e.id, e.data,
      -- O preço do MYP é desta carta, versão e selo (o selo só conta nas versões promo/staff)?
      (e.data->'mypApi'->>'cardId' = e.data->>'cardId'
        and e.data->'mypApi'->>'variant' = coalesce(e.data->>'variant', 'normal')
        and coalesce(e.data->'mypApi'->>'note', '') =
            case when coalesce(e.data->>'variant', 'normal') in ('wPromo', 'staff')
                 then coalesce(btrim(e.data->>'variantNote'), '') else '' end
        and jsonb_typeof(e.data->'mypApi'->'avg') = 'number') as myp_ok,
      -- O produto da TCGplayer é desta carta, versão e selo (o selo conta em todas as versões), numa carta em inglês ou
      -- japonês?
      (e.data->>'lang' in ('en', 'ja')
        and e.data->'tcgplayer'->>'cardId' = e.data->>'cardId'
        and e.data->'tcgplayer'->>'variant' = coalesce(e.data->>'variant', 'normal')
        and coalesce(e.data->'tcgplayer'->>'note', '') = coalesce(btrim(e.data->>'variantNote'), '')) as tcg_ok
    from public.entries e
  ),
  src as (
    select c.user_id, c.id, c.data,
      jsonb_strip_nulls(jsonb_build_object(
        'manual', case when jsonb_typeof(c.data->'myValue'->'value') = 'number' then c.data->'myValue' end,
        'mypApi', case when c.myp_ok then jsonb_strip_nulls(jsonb_build_object(
            'min', c.data->'mypApi'->'min', 'avg', c.data->'mypApi'->'avg', 'max', c.data->'mypApi'->'max',
            'own', c.data->'mypApi'->'ownVersion')) end,
        'tcgplayer', case
          when c.tcg_ok and t.market is not null and fx.sell is not null then jsonb_build_object(
            'min', round(least(coalesce(t.low, t.market), t.market) * fx.sell, 2),
            'avg', round(t.market * fx.sell, 2),
            'max', round(greatest(coalesce(t.mid, t.market), t.market) * fx.sell, 2),
            'usd', t.market, 'fx', fx.sell, 'built', t.built_at)
          when c.tcg_ok and jsonb_typeof(c.data->'tcgplayer'->'avg') = 'number' then jsonb_strip_nulls(jsonb_build_object(
            'min', c.data->'tcgplayer'->'min', 'avg', c.data->'tcgplayer'->'avg', 'max', c.data->'tcgplayer'->'max',
            'usd', c.data->'tcgplayer'->'usdMarket', 'fx', c.data->'tcgplayer'->'fx'))
        end,
        'basis', c.data->'valueBasis'
      )) as sources
    from cur c
    left join fx on true
    -- Preço do dia do produto e impressão gravados na carta (o case evita converter um id que não é número).
    left join lateral (
      select p.low, p.mid, p.market, p.built_at
      from public.tcg_prices p
      where c.tcg_ok
        and p.product_id = case
          when jsonb_typeof(c.data->'tcgplayer'->'productId') = 'number' and c.data->'tcgplayer'->>'productId' ~ '^[0-9]{1,9}$'
          then (c.data->'tcgplayer'->>'productId')::integer end
        and p.sub_type = c.data->'tcgplayer'->>'subType'
    ) t on true
  ),
  ins as (
    insert into public.price_history (user_id, entry_id, day, card_id, lang, condition, variant, sources)
    select s.user_id, s.id, (now() at time zone 'America/Sao_Paulo')::date,
      s.data->>'cardId', s.data->>'lang', s.data->>'condition', s.data->>'variant', s.sources
    from src s
    where s.sources ?| array['manual', 'mypApi', 'tcgplayer']
    on conflict (user_id, entry_id, day) do update
      set sources = excluded.sources, card_id = excluded.card_id, lang = excluded.lang,
          condition = excluded.condition, variant = excluded.variant
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke all on function public.snapshot_prices() from public, anon, authenticated;

-- ===== Cópia diária da coleção (schema backup) =====
-- Guarda as cartas e a configuração de cada dia por 14 dias. O schema backup não é exposto pela API. Em produção ele
-- guarda também a cópia feita antes da 3.0 (backup.*_20261024) e as tabelas das fontes que saíram (abaixo).

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

-- Recoloca as cartas de uma conta como estavam num dia da cópia diária. Cada carta volta com a data de agora dentro de
-- `data` (updatedAt): assim ela vence a cópia que os aparelhos têm e chega a eles na próxima sincronização (com a data
-- antiga, um aparelho com a carta editada depois mandaria a versão dele de volta). Fichários livres da cópia que não
-- existem mais voltam também, com data nova (senão os aparelhos tiram as cartas deles). Nada é apagado: cartas postas
-- depois do dia da cópia ficam, e o preço mais novo do banco fica (gatilho entries_keep_prices). Carta que não estava
-- mais no banco perde o registro de remoção (gatilho entries_untombstone). No registro de mudanças, as cartas que
-- voltam aparecem como "Restaurada da cópia" (source 'restore').
-- Uso (SQL Editor): select backup.restore_collection('<id da conta>', '2026-10-24');
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

-- Tabelas das fontes que saíram (preços da Liga obtidos pela Apify, execuções da busca na Liga, Jornada): num banco
-- de antes da 3.0, saem da API e ficam guardadas no schema backup (não são apagadas).
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

-- ===== Consulta de cartas: índice montado no banco e baixado inteiro pelo app =====

-- ----- Tabelas -----

-- Nomes das espécies, para achar o Pokémon pelo nome da carta. Gerada de src/data/pokedex.json.
create table if not exists public.catalog_species (
  key text primary key,        -- "pikachu", "mrmime", "nidoranf"; em chinês e japonês, o nome
  dex smallint not null,
  kind text not null default 'en' check (kind in ('en', 'zh', 'ja'))
);

-- Resposta da TCGdex por idioma. Só o servidor lê e grava.
create table if not exists public.tcgdex_lang (
  lang text primary key,             -- pt, ko, zh-tw, zh-cn, ja, tcgp
  cards jsonb not null default '[]', -- [{id, localId, name, image?}]; image sem o domínio
  hp jsonb not null default '{}',    -- só zh-tw: {"SV5K-001": 60}
  sets jsonb not null default '{}',  -- {"SV5K": {name, official, total, date?}}
  fetched_at timestamptz not null default now()
);

-- Correções manuais, sempre com o motivo.
create table if not exists public.lookup_overrides (
  kind text not null check (kind in ('year_range', 'year_mixed', 'twin_block', 'dex')),
  key text not null,
  value text,
  note text not null,
  primary key (kind, key)
);

-- O índice da Consulta: uma linha, lida pelo app.
create table if not exists public.lookup_index (
  id smallint primary key default 1 check (id = 1),
  md5 text not null,
  format smallint not null,
  built_at timestamptz not null default now(),
  lines integer not null,
  bytes integer not null,
  meta jsonb not null default '{}',  -- cobertura e auditoria
  body text not null
);

alter table public.catalog_species enable row level security;
alter table public.tcgdex_lang enable row level security;
alter table public.lookup_overrides enable row level security;
alter table public.lookup_index enable row level security;

drop policy if exists "índice público" on public.lookup_index;
create policy "índice público" on public.lookup_index for select to anon, authenticated using (true);
drop policy if exists "só o servidor" on public.catalog_species;
create policy "só o servidor" on public.catalog_species for all to anon, authenticated using (false) with check (false);
drop policy if exists "só o servidor" on public.tcgdex_lang;
create policy "só o servidor" on public.tcgdex_lang for all to anon, authenticated using (false) with check (false);
drop policy if exists "só o servidor" on public.lookup_overrides;
create policy "só o servidor" on public.lookup_overrides for all to anon, authenticated using (false) with check (false);

-- ----- Sementes de catalog_species (scripts/make-species-sql.js --write troca o trecho entre os marcadores) -----

-- species:begin
insert into public.catalog_species (key, dex, kind) values
('bulbasaur',1,'en'),('妙蛙種子',1,'zh'),('妙蛙种子',1,'zh'),('フシギダネ',1,'ja'),('ivysaur',2,'en'),('妙蛙草',2,'zh'),('フシギソウ',2,'ja'),('venusaur',3,'en'),('妙蛙花',3,'zh'),
('フシギバナ',3,'ja'),('charmander',4,'en'),('小火龍',4,'zh'),('小火龙',4,'zh'),('ヒトカゲ',4,'ja'),('charmeleon',5,'en'),('火恐龍',5,'zh'),('火恐龙',5,'zh'),('リザード',5,'ja'),
('charizard',6,'en'),('噴火龍',6,'zh'),('喷火龙',6,'zh'),('リザードン',6,'ja'),('squirtle',7,'en'),('傑尼龜',7,'zh'),('杰尼龟',7,'zh'),('ゼニガメ',7,'ja'),('wartortle',8,'en'),
('卡咪龜',8,'zh'),('卡咪龟',8,'zh'),('カメール',8,'ja'),('blastoise',9,'en'),('水箭龜',9,'zh'),('水箭龟',9,'zh'),('カメックス',9,'ja'),('caterpie',10,'en'),('綠毛蟲',10,'zh'),
('绿毛虫',10,'zh'),('キャタピー',10,'ja'),('metapod',11,'en'),('鐵甲蛹',11,'zh'),('铁甲蛹',11,'zh'),('トランセル',11,'ja'),('butterfree',12,'en'),('巴大蝶',12,'zh'),('バタフリー',12,'ja'),
('weedle',13,'en'),('獨角蟲',13,'zh'),('独角虫',13,'zh'),('ビードル',13,'ja'),('kakuna',14,'en'),('鐵殼蛹',14,'zh'),('铁壳蛹',14,'zh'),('コクーン',14,'ja'),('beedrill',15,'en'),
('大針蜂',15,'zh'),('大针蜂',15,'zh'),('スピアー',15,'ja'),('pidgey',16,'en'),('波波',16,'zh'),('ポッポ',16,'ja'),('pidgeotto',17,'en'),('比比鳥',17,'zh'),('比比鸟',17,'zh'),
('ピジョン',17,'ja'),('pidgeot',18,'en'),('大比鳥',18,'zh'),('大比鸟',18,'zh'),('ピジョット',18,'ja'),('rattata',19,'en'),('小拉達',19,'zh'),('小拉达',19,'zh'),('コラッタ',19,'ja'),
('raticate',20,'en'),('拉達',20,'zh'),('拉达',20,'zh'),('ラッタ',20,'ja'),('spearow',21,'en'),('烈雀',21,'zh'),('オニスズメ',21,'ja'),('fearow',22,'en'),('大嘴雀',22,'zh'),
('オニドリル',22,'ja'),('ekans',23,'en'),('阿柏蛇',23,'zh'),('アーボ',23,'ja'),('arbok',24,'en'),('阿柏怪',24,'zh'),('アーボック',24,'ja'),('pikachu',25,'en'),('皮卡丘',25,'zh'),
('ピカチュウ',25,'ja'),('raichu',26,'en'),('雷丘',26,'zh'),('ライチュウ',26,'ja'),('sandshrew',27,'en'),('穿山鼠',27,'zh'),('サンド',27,'ja'),('sandslash',28,'en'),('穿山王',28,'zh'),
('サンドパン',28,'ja'),('nidoranf',29,'en'),('尼多蘭',29,'zh'),('尼多兰',29,'zh'),('ニドラン♀',29,'ja'),('nidorina',30,'en'),('尼多娜',30,'zh'),('ニドリーナ',30,'ja'),
('nidoqueen',31,'en'),('尼多后',31,'zh'),('ニドクイン',31,'ja'),('nidoranm',32,'en'),('尼多朗',32,'zh'),('ニドラン♂',32,'ja'),('nidorino',33,'en'),('尼多力諾',33,'zh'),
('尼多力诺',33,'zh'),('ニドリーノ',33,'ja'),('nidoking',34,'en'),('尼多王',34,'zh'),('ニドキング',34,'ja'),('clefairy',35,'en'),('皮皮',35,'zh'),('ピッピ',35,'ja'),
('clefable',36,'en'),('皮可西',36,'zh'),('ピクシー',36,'ja'),('vulpix',37,'en'),('六尾',37,'zh'),('ロコン',37,'ja'),('ninetales',38,'en'),('九尾',38,'zh'),('キュウコン',38,'ja'),
('jigglypuff',39,'en'),('胖丁',39,'zh'),('プリン',39,'ja'),('wigglytuff',40,'en'),('胖可丁',40,'zh'),('プクリン',40,'ja'),('zubat',41,'en'),('超音蝠',41,'zh'),('ズバット',41,'ja'),
('golbat',42,'en'),('大嘴蝠',42,'zh'),('ゴルバット',42,'ja'),('oddish',43,'en'),('走路草',43,'zh'),('ナゾノクサ',43,'ja'),('gloom',44,'en'),('臭臭花',44,'zh'),('クサイハナ',44,'ja'),
('vileplume',45,'en'),('霸王花',45,'zh'),('ラフレシア',45,'ja'),('paras',46,'en'),('派拉斯',46,'zh'),('パラス',46,'ja'),('parasect',47,'en'),('派拉斯特',47,'zh'),('パラセクト',47,'ja'),
('venonat',48,'en'),('毛球',48,'zh'),('コンパン',48,'ja'),('venomoth',49,'en'),('摩魯蛾',49,'zh'),('摩鲁蛾',49,'zh'),('モルフォン',49,'ja'),('diglett',50,'en'),('地鼠',50,'zh'),
('ディグダ',50,'ja'),('dugtrio',51,'en'),('三地鼠',51,'zh'),('ダグトリオ',51,'ja'),('meowth',52,'en'),('喵喵',52,'zh'),('ニャース',52,'ja'),('persian',53,'en'),('貓老大',53,'zh'),
('猫老大',53,'zh'),('ペルシアン',53,'ja'),('psyduck',54,'en'),('可達鴨',54,'zh'),('可达鸭',54,'zh'),('コダック',54,'ja'),('golduck',55,'en'),('哥達鴨',55,'zh'),('哥达鸭',55,'zh'),
('ゴルダック',55,'ja'),('mankey',56,'en'),('猴怪',56,'zh'),('マンキー',56,'ja'),('primeape',57,'en'),('火爆猴',57,'zh'),('火暴猴',57,'zh'),('オコリザル',57,'ja'),('growlithe',58,'en'),
('卡蒂狗',58,'zh'),('ガーディ',58,'ja'),('arcanine',59,'en'),('風速狗',59,'zh'),('风速狗',59,'zh'),('ウインディ',59,'ja'),('poliwag',60,'en'),('蚊香蝌蚪',60,'zh'),('ニョロモ',60,'ja'),
('poliwhirl',61,'en'),('蚊香君',61,'zh'),('ニョロゾ',61,'ja'),('poliwrath',62,'en'),('蚊香泳士',62,'zh'),('ニョロボン',62,'ja'),('abra',63,'en'),('凱西',63,'zh'),('凯西',63,'zh'),
('ケーシィ',63,'ja'),('kadabra',64,'en'),('勇基拉',64,'zh'),('ユンゲラー',64,'ja'),('alakazam',65,'en'),('胡地',65,'zh'),('フーディン',65,'ja'),('machop',66,'en'),('腕力',66,'zh'),
('ワンリキー',66,'ja'),('machoke',67,'en'),('豪力',67,'zh'),('ゴーリキー',67,'ja'),('machamp',68,'en'),('怪力',68,'zh'),('カイリキー',68,'ja'),('bellsprout',69,'en'),
('喇叭芽',69,'zh'),('マダツボミ',69,'ja'),('weepinbell',70,'en'),('口呆花',70,'zh'),('ウツドン',70,'ja'),('victreebel',71,'en'),('大食花',71,'zh'),('ウツボット',71,'ja'),
('tentacool',72,'en'),('瑪瑙水母',72,'zh'),('玛瑙水母',72,'zh'),('メノクラゲ',72,'ja'),('tentacruel',73,'en'),('毒刺水母',73,'zh'),('ドククラゲ',73,'ja'),('geodude',74,'en'),
('小拳石',74,'zh'),('イシツブテ',74,'ja'),('graveler',75,'en'),('隆隆石',75,'zh'),('ゴローン',75,'ja'),('golem',76,'en'),('隆隆岩',76,'zh'),('ゴローニャ',76,'ja'),('ponyta',77,'en'),
('小火馬',77,'zh'),('小火马',77,'zh'),('ポニータ',77,'ja'),('rapidash',78,'en'),('烈焰馬',78,'zh'),('烈焰马',78,'zh'),('ギャロップ',78,'ja'),('slowpoke',79,'en'),('呆呆獸',79,'zh'),
('呆呆兽',79,'zh'),('ヤドン',79,'ja'),('slowbro',80,'en'),('呆殼獸',80,'zh'),('呆壳兽',80,'zh'),('ヤドラン',80,'ja'),('magnemite',81,'en'),('小磁怪',81,'zh'),('コイル',81,'ja'),
('magneton',82,'en'),('三合一磁怪',82,'zh'),('レアコイル',82,'ja'),('farfetchd',83,'en'),('大蔥鴨',83,'zh'),('大葱鸭',83,'zh'),('カモネギ',83,'ja'),('doduo',84,'en'),('嘟嘟',84,'zh'),
('ドードー',84,'ja'),('dodrio',85,'en'),('嘟嘟利',85,'zh'),('ドードリオ',85,'ja'),('seel',86,'en'),('小海獅',86,'zh'),('小海狮',86,'zh'),('パウワウ',86,'ja'),('dewgong',87,'en'),
('白海獅',87,'zh'),('白海狮',87,'zh'),('ジュゴン',87,'ja'),('grimer',88,'en'),('臭泥',88,'zh'),('ベトベター',88,'ja'),('muk',89,'en'),('臭臭泥',89,'zh'),('ベトベトン',89,'ja'),
('shellder',90,'en'),('大舌貝',90,'zh'),('大舌贝',90,'zh'),('シェルダー',90,'ja'),('cloyster',91,'en'),('刺甲貝',91,'zh'),('刺甲贝',91,'zh'),('パルシェン',91,'ja'),('gastly',92,'en'),
('鬼斯',92,'zh'),('ゴース',92,'ja'),('haunter',93,'en'),('鬼斯通',93,'zh'),('ゴースト',93,'ja'),('gengar',94,'en'),('耿鬼',94,'zh'),('ゲンガー',94,'ja'),('onix',95,'en'),
('大岩蛇',95,'zh'),('イワーク',95,'ja'),('drowzee',96,'en'),('催眠貘',96,'zh'),('スリープ',96,'ja'),('hypno',97,'en'),('引夢貘人',97,'zh'),('引梦貘人',97,'zh'),('スリーパー',97,'ja'),
('krabby',98,'en'),('大鉗蟹',98,'zh'),('大钳蟹',98,'zh'),('クラブ',98,'ja'),('kingler',99,'en'),('巨鉗蟹',99,'zh'),('巨钳蟹',99,'zh'),('キングラー',99,'ja'),('voltorb',100,'en'),
('霹靂電球',100,'zh'),('霹雳电球',100,'zh'),('ビリリダマ',100,'ja'),('electrode',101,'en'),('頑皮雷彈',101,'zh'),('顽皮雷弹',101,'zh'),('マルマイン',101,'ja'),('exeggcute',102,'en'),
('蛋蛋',102,'zh'),('タマタマ',102,'ja'),('exeggutor',103,'en'),('椰蛋樹',103,'zh'),('椰蛋树',103,'zh'),('ナッシー',103,'ja'),('cubone',104,'en'),('卡拉卡拉',104,'zh'),
('カラカラ',104,'ja'),('marowak',105,'en'),('嘎啦嘎啦',105,'zh'),('ガラガラ',105,'ja'),('hitmonlee',106,'en'),('飛腿郎',106,'zh'),('飞腿郎',106,'zh'),('サワムラー',106,'ja'),
('hitmonchan',107,'en'),('快拳郎',107,'zh'),('エビワラー',107,'ja'),('lickitung',108,'en'),('大舌頭',108,'zh'),('大舌头',108,'zh'),('ベロリンガ',108,'ja'),('koffing',109,'en'),
('瓦斯彈',109,'zh'),('瓦斯弹',109,'zh'),('ドガース',109,'ja'),('weezing',110,'en'),('雙彈瓦斯',110,'zh'),('双弹瓦斯',110,'zh'),('マタドガス',110,'ja'),('rhyhorn',111,'en'),
('獨角犀牛',111,'zh'),('独角犀牛',111,'zh'),('サイホーン',111,'ja'),('rhydon',112,'en'),('鑽角犀獸',112,'zh'),('钻角犀兽',112,'zh'),('サイドン',112,'ja'),('chansey',113,'en'),
('吉利蛋',113,'zh'),('ラッキー',113,'ja'),('tangela',114,'en'),('蔓藤怪',114,'zh'),('モンジャラ',114,'ja'),('kangaskhan',115,'en'),('袋獸',115,'zh'),('袋兽',115,'zh'),
('ガルーラ',115,'ja'),('horsea',116,'en'),('墨海馬',116,'zh'),('墨海马',116,'zh'),('タッツー',116,'ja'),('seadra',117,'en'),('海刺龍',117,'zh'),('海刺龙',117,'zh'),('シードラ',117,'ja'),
('goldeen',118,'en'),('角金魚',118,'zh'),('角金鱼',118,'zh'),('トサキント',118,'ja'),('seaking',119,'en'),('金魚王',119,'zh'),('金鱼王',119,'zh'),('アズマオウ',119,'ja'),
('staryu',120,'en'),('海星星',120,'zh'),('ヒトデマン',120,'ja'),('starmie',121,'en'),('寶石海星',121,'zh'),('宝石海星',121,'zh'),('スターミー',121,'ja'),('mrmime',122,'en'),
('魔牆人偶',122,'zh'),('魔墙人偶',122,'zh'),('バリヤード',122,'ja'),('scyther',123,'en'),('飛天螳螂',123,'zh'),('飞天螳螂',123,'zh'),('ストライク',123,'ja'),('jynx',124,'en'),
('迷唇姐',124,'zh'),('ルージュラ',124,'ja'),('electabuzz',125,'en'),('電擊獸',125,'zh'),('电击兽',125,'zh'),('エレブー',125,'ja'),('magmar',126,'en'),('鴨嘴火獸',126,'zh'),
('鸭嘴火兽',126,'zh'),('ブーバー',126,'ja'),('pinsir',127,'en'),('凱羅斯',127,'zh'),('凯罗斯',127,'zh'),('カイロス',127,'ja'),('tauros',128,'en'),('肯泰羅',128,'zh'),('肯泰罗',128,'zh'),
('ケンタロス',128,'ja'),('magikarp',129,'en'),('鯉魚王',129,'zh'),('鲤鱼王',129,'zh'),('コイキング',129,'ja'),('gyarados',130,'en'),('暴鯉龍',130,'zh'),('暴鲤龙',130,'zh'),
('ギャラドス',130,'ja'),('lapras',131,'en'),('拉普拉斯',131,'zh'),('ラプラス',131,'ja'),('ditto',132,'en'),('百變怪',132,'zh'),('百变怪',132,'zh'),('メタモン',132,'ja'),
('eevee',133,'en'),('伊布',133,'zh'),('イーブイ',133,'ja'),('vaporeon',134,'en'),('水伊布',134,'zh'),('シャワーズ',134,'ja'),('jolteon',135,'en'),('雷伊布',135,'zh'),
('サンダース',135,'ja'),('flareon',136,'en'),('火伊布',136,'zh'),('ブースター',136,'ja'),('porygon',137,'en'),('多邊獸',137,'zh'),('多边兽',137,'zh'),('ポリゴン',137,'ja'),
('omanyte',138,'en'),('菊石獸',138,'zh'),('菊石兽',138,'zh'),('オムナイト',138,'ja'),('omastar',139,'en'),('多刺菊石獸',139,'zh'),('多刺菊石兽',139,'zh'),('オムスター',139,'ja'),
('kabuto',140,'en'),('化石盔',140,'zh'),('カブト',140,'ja'),('kabutops',141,'en'),('鐮刀盔',141,'zh'),('镰刀盔',141,'zh'),('カブトプス',141,'ja'),('aerodactyl',142,'en'),
('化石翼龍',142,'zh'),('化石翼龙',142,'zh'),('プテラ',142,'ja'),('snorlax',143,'en'),('卡比獸',143,'zh'),('卡比兽',143,'zh'),('カビゴン',143,'ja'),('articuno',144,'en'),
('急凍鳥',144,'zh'),('急冻鸟',144,'zh'),('フリーザー',144,'ja'),('zapdos',145,'en'),('閃電鳥',145,'zh'),('闪电鸟',145,'zh'),('サンダー',145,'ja'),('moltres',146,'en'),
('火焰鳥',146,'zh'),('火焰鸟',146,'zh'),('ファイヤー',146,'ja'),('dratini',147,'en'),('迷你龍',147,'zh'),('迷你龙',147,'zh'),('ミニリュウ',147,'ja'),('dragonair',148,'en'),
('哈克龍',148,'zh'),('哈克龙',148,'zh'),('ハクリュー',148,'ja'),('dragonite',149,'en'),('快龍',149,'zh'),('快龙',149,'zh'),('カイリュー',149,'ja'),('mewtwo',150,'en'),
('超夢',150,'zh'),('超梦',150,'zh'),('ミュウツー',150,'ja'),('mew',151,'en'),('夢幻',151,'zh'),('梦幻',151,'zh'),('ミュウ',151,'ja'),('chikorita',152,'en'),('菊草葉',152,'zh'),
('菊草叶',152,'zh'),('チコリータ',152,'ja'),('bayleef',153,'en'),('月桂葉',153,'zh'),('月桂叶',153,'zh'),('ベイリーフ',153,'ja'),('meganium',154,'en'),('大竺葵',154,'zh'),
('メガニウム',154,'ja'),('cyndaquil',155,'en'),('火球鼠',155,'zh'),('ヒノアラシ',155,'ja'),('quilava',156,'en'),('火岩鼠',156,'zh'),('マグマラシ',156,'ja'),('typhlosion',157,'en'),
('火爆獸',157,'zh'),('火暴兽',157,'zh'),('バクフーン',157,'ja'),('totodile',158,'en'),('小鋸鱷',158,'zh'),('小锯鳄',158,'zh'),('ワニノコ',158,'ja'),('croconaw',159,'en'),
('藍鱷',159,'zh'),('蓝鳄',159,'zh'),('アリゲイツ',159,'ja'),('feraligatr',160,'en'),('大力鱷',160,'zh'),('大力鳄',160,'zh'),('オーダイル',160,'ja'),('sentret',161,'en'),
('尾立',161,'zh'),('オタチ',161,'ja'),('furret',162,'en'),('大尾立',162,'zh'),('オオタチ',162,'ja'),('hoothoot',163,'en'),('咕咕',163,'zh'),('ホーホー',163,'ja'),
('noctowl',164,'en'),('貓頭夜鷹',164,'zh'),('猫头夜鹰',164,'zh'),('ヨルノズク',164,'ja'),('ledyba',165,'en'),('芭瓢蟲',165,'zh'),('芭瓢虫',165,'zh'),('レディバ',165,'ja'),
('ledian',166,'en'),('安瓢蟲',166,'zh'),('安瓢虫',166,'zh'),('レディアン',166,'ja'),('spinarak',167,'en'),('圓絲蛛',167,'zh'),('圆丝蛛',167,'zh'),('イトマル',167,'ja'),
('ariados',168,'en'),('阿利多斯',168,'zh'),('アリアドス',168,'ja'),('crobat',169,'en'),('叉字蝠',169,'zh'),('クロバット',169,'ja'),('chinchou',170,'en'),('燈籠魚',170,'zh'),
('灯笼鱼',170,'zh'),('チョンチー',170,'ja'),('lanturn',171,'en'),('電燈怪',171,'zh'),('电灯怪',171,'zh'),('ランターン',171,'ja'),('pichu',172,'en'),('皮丘',172,'zh'),
('ピチュー',172,'ja'),('cleffa',173,'en'),('皮寶寶',173,'zh'),('皮宝宝',173,'zh'),('ピィ',173,'ja'),('igglybuff',174,'en'),('寶寶丁',174,'zh'),('宝宝丁',174,'zh'),
('ププリン',174,'ja'),('togepi',175,'en'),('波克比',175,'zh'),('トゲピー',175,'ja'),('togetic',176,'en'),('波克基古',176,'zh'),('トゲチック',176,'ja'),('natu',177,'en'),
('天然雀',177,'zh'),('ネイティ',177,'ja'),('xatu',178,'en'),('天然鳥',178,'zh'),('天然鸟',178,'zh'),('ネイティオ',178,'ja'),('mareep',179,'en'),('咩利羊',179,'zh'),('メリープ',179,'ja'),
('flaaffy',180,'en'),('茸茸羊',180,'zh'),('モココ',180,'ja'),('ampharos',181,'en'),('電龍',181,'zh'),('电龙',181,'zh'),('デンリュウ',181,'ja'),('bellossom',182,'en'),
('美麗花',182,'zh'),('美丽花',182,'zh'),('キレイハナ',182,'ja'),('marill',183,'en'),('瑪力露',183,'zh'),('玛力露',183,'zh'),('マリル',183,'ja'),('azumarill',184,'en'),
('瑪力露麗',184,'zh'),('玛力露丽',184,'zh'),('マリルリ',184,'ja'),('sudowoodo',185,'en'),('樹才怪',185,'zh'),('树才怪',185,'zh'),('ウソッキー',185,'ja'),('politoed',186,'en'),
('蚊香蛙皇',186,'zh'),('ニョロトノ',186,'ja'),('hoppip',187,'en'),('毽子草',187,'zh'),('ハネッコ',187,'ja'),('skiploom',188,'en'),('毽子花',188,'zh'),('ポポッコ',188,'ja'),
('jumpluff',189,'en'),('毽子棉',189,'zh'),('ワタッコ',189,'ja'),('aipom',190,'en'),('長尾怪手',190,'zh'),('长尾怪手',190,'zh'),('エイパム',190,'ja'),('sunkern',191,'en'),
('向日種子',191,'zh'),('向日种子',191,'zh'),('ヒマナッツ',191,'ja'),('sunflora',192,'en'),('向日花怪',192,'zh'),('キマワリ',192,'ja'),('yanma',193,'en'),('蜻蜻蜓',193,'zh'),
('ヤンヤンマ',193,'ja'),('wooper',194,'en'),('烏波',194,'zh'),('乌波',194,'zh'),('ウパー',194,'ja'),('quagsire',195,'en'),('沼王',195,'zh'),('ヌオー',195,'ja'),
('espeon',196,'en'),('太陽伊布',196,'zh'),('太阳伊布',196,'zh'),('エーフィ',196,'ja'),('umbreon',197,'en'),('月亮伊布',197,'zh'),('ブラッキー',197,'ja'),('murkrow',198,'en'),
('黑暗鴉',198,'zh'),('黑暗鸦',198,'zh'),('ヤミカラス',198,'ja'),('slowking',199,'en'),('呆呆王',199,'zh'),('ヤドキング',199,'ja'),('misdreavus',200,'en'),('夢妖',200,'zh'),
('梦妖',200,'zh'),('ムウマ',200,'ja'),('unown',201,'en'),('未知圖騰',201,'zh'),('未知图腾',201,'zh'),('アンノーン',201,'ja'),('wobbuffet',202,'en'),('果然翁',202,'zh'),
('ソーナンス',202,'ja'),('girafarig',203,'en'),('麒麟奇',203,'zh'),('キリンリキ',203,'ja'),('pineco',204,'en'),('榛果球',204,'zh'),('クヌギダマ',204,'ja'),('forretress',205,'en'),
('佛烈托斯',205,'zh'),('フォレトス',205,'ja'),('dunsparce',206,'en'),('土龍弟弟',206,'zh'),('土龙弟弟',206,'zh'),('ノコッチ',206,'ja'),('gligar',207,'en'),('天蠍',207,'zh'),
('天蝎',207,'zh'),('グライガー',207,'ja'),('steelix',208,'en'),('大鋼蛇',208,'zh'),('大钢蛇',208,'zh'),('ハガネール',208,'ja'),('snubbull',209,'en'),('布魯',209,'zh'),
('布鲁',209,'zh'),('ブルー',209,'ja'),('granbull',210,'en'),('布魯皇',210,'zh'),('布鲁皇',210,'zh'),('グランブル',210,'ja'),('qwilfish',211,'en'),('千針魚',211,'zh'),
('千针鱼',211,'zh'),('ハリーセン',211,'ja'),('scizor',212,'en'),('巨鉗螳螂',212,'zh'),('巨钳螳螂',212,'zh'),('ハッサム',212,'ja'),('shuckle',213,'en'),('壺壺',213,'zh'),
('壶壶',213,'zh'),('ツボツボ',213,'ja'),('heracross',214,'en'),('赫拉克羅斯',214,'zh'),('赫拉克罗斯',214,'zh'),('ヘラクロス',214,'ja'),('sneasel',215,'en'),('狃拉',215,'zh'),
('ニューラ',215,'ja'),('teddiursa',216,'en'),('熊寶寶',216,'zh'),('熊宝宝',216,'zh'),('ヒメグマ',216,'ja'),('ursaring',217,'en'),('圈圈熊',217,'zh'),('リングマ',217,'ja'),
('slugma',218,'en'),('熔岩蟲',218,'zh'),('熔岩虫',218,'zh'),('マグマッグ',218,'ja'),('magcargo',219,'en'),('熔岩蝸牛',219,'zh'),('熔岩蜗牛',219,'zh'),('マグカルゴ',219,'ja'),
('swinub',220,'en'),('小山豬',220,'zh'),('小山猪',220,'zh'),('ウリムー',220,'ja'),('piloswine',221,'en'),('長毛豬',221,'zh'),('长毛猪',221,'zh'),('イノムー',221,'ja'),
('corsola',222,'en'),('太陽珊瑚',222,'zh'),('太阳珊瑚',222,'zh'),('サニーゴ',222,'ja'),('remoraid',223,'en'),('鐵炮魚',223,'zh'),('铁炮鱼',223,'zh'),('テッポウオ',223,'ja'),
('octillery',224,'en'),('章魚桶',224,'zh'),('章鱼桶',224,'zh'),('オクタン',224,'ja'),('delibird',225,'en'),('信使鳥',225,'zh'),('信使鸟',225,'zh'),('デリバード',225,'ja'),
('mantine',226,'en'),('巨翅飛魚',226,'zh'),('巨翅飞鱼',226,'zh'),('マンタイン',226,'ja'),('skarmory',227,'en'),('盔甲鳥',227,'zh'),('盔甲鸟',227,'zh'),('エアームド',227,'ja'),
('houndour',228,'en'),('戴魯比',228,'zh'),('戴鲁比',228,'zh'),('デルビル',228,'ja'),('houndoom',229,'en'),('黑魯加',229,'zh'),('黑鲁加',229,'zh'),('ヘルガー',229,'ja'),
('kingdra',230,'en'),('刺龍王',230,'zh'),('刺龙王',230,'zh'),('キングドラ',230,'ja'),('phanpy',231,'en'),('小小象',231,'zh'),('ゴマゾウ',231,'ja'),('donphan',232,'en'),
('頓甲',232,'zh'),('顿甲',232,'zh'),('ドンファン',232,'ja'),('porygon2',233,'en'),('多邊獸Ⅱ',233,'zh'),('多边兽２型',233,'zh'),('ポリゴン２',233,'ja'),('stantler',234,'en'),
('驚角鹿',234,'zh'),('惊角鹿',234,'zh'),('オドシシ',234,'ja'),('smeargle',235,'en'),('圖圖犬',235,'zh'),('图图犬',235,'zh'),('ドーブル',235,'ja'),('tyrogue',236,'en'),
('無畏小子',236,'zh'),('无畏小子',236,'zh'),('バルキー',236,'ja'),('hitmontop',237,'en'),('戰舞郎',237,'zh'),('战舞郎',237,'zh'),('カポエラー',237,'ja'),('smoochum',238,'en'),
('迷唇娃',238,'zh'),('ムチュール',238,'ja'),('elekid',239,'en'),('電擊怪',239,'zh'),('电击怪',239,'zh'),('エレキッド',239,'ja'),('magby',240,'en'),('鴨嘴寶寶',240,'zh'),
('鸭嘴宝宝',240,'zh'),('ブビィ',240,'ja'),('miltank',241,'en'),('大奶罐',241,'zh'),('ミルタンク',241,'ja'),('blissey',242,'en'),('幸福蛋',242,'zh'),('ハピナス',242,'ja'),
('raikou',243,'en'),('雷公',243,'zh'),('ライコウ',243,'ja'),('entei',244,'en'),('炎帝',244,'zh'),('エンテイ',244,'ja'),('suicune',245,'en'),('水君',245,'zh'),('スイクン',245,'ja'),
('larvitar',246,'en'),('幼基拉斯',246,'zh'),('ヨーギラス',246,'ja'),('pupitar',247,'en'),('沙基拉斯',247,'zh'),('サナギラス',247,'ja'),('tyranitar',248,'en'),('班基拉斯',248,'zh'),
('バンギラス',248,'ja'),('lugia',249,'en'),('洛奇亞',249,'zh'),('洛奇亚',249,'zh'),('ルギア',249,'ja'),('hooh',250,'en'),('鳳王',250,'zh'),('凤王',250,'zh'),('ホウオウ',250,'ja'),
('celebi',251,'en'),('時拉比',251,'zh'),('时拉比',251,'zh'),('セレビィ',251,'ja'),('treecko',252,'en'),('木守宮',252,'zh'),('木守宫',252,'zh'),('キモリ',252,'ja'),
('grovyle',253,'en'),('森林蜥蜴',253,'zh'),('ジュプトル',253,'ja'),('sceptile',254,'en'),('蜥蜴王',254,'zh'),('ジュカイン',254,'ja'),('torchic',255,'en'),('火稚雞',255,'zh'),
('火稚鸡',255,'zh'),('アチャモ',255,'ja'),('combusken',256,'en'),('力壯雞',256,'zh'),('力壮鸡',256,'zh'),('ワカシャモ',256,'ja'),('blaziken',257,'en'),('火焰雞',257,'zh'),
('火焰鸡',257,'zh'),('バシャーモ',257,'ja'),('mudkip',258,'en'),('水躍魚',258,'zh'),('水跃鱼',258,'zh'),('ミズゴロウ',258,'ja'),('marshtomp',259,'en'),('沼躍魚',259,'zh'),
('沼跃鱼',259,'zh'),('ヌマクロー',259,'ja'),('swampert',260,'en'),('巨沼怪',260,'zh'),('ラグラージ',260,'ja'),('poochyena',261,'en'),('土狼犬',261,'zh'),('ポチエナ',261,'ja'),
('mightyena',262,'en'),('大狼犬',262,'zh'),('グラエナ',262,'ja'),('zigzagoon',263,'en'),('蛇紋熊',263,'zh'),('蛇纹熊',263,'zh'),('ジグザグマ',263,'ja'),('linoone',264,'en'),
('直衝熊',264,'zh'),('直冲熊',264,'zh'),('マッスグマ',264,'ja'),('wurmple',265,'en'),('刺尾蟲',265,'zh'),('刺尾虫',265,'zh'),('ケムッソ',265,'ja'),('silcoon',266,'en'),
('甲殼繭',266,'zh'),('甲壳茧',266,'zh'),('カラサリス',266,'ja'),('beautifly',267,'en'),('狩獵鳳蝶',267,'zh'),('狩猎凤蝶',267,'zh'),('アゲハント',267,'ja'),('cascoon',268,'en'),
('盾甲繭',268,'zh'),('盾甲茧',268,'zh'),('マユルド',268,'ja'),('dustox',269,'en'),('毒粉蛾',269,'zh'),('ドクケイル',269,'ja'),('lotad',270,'en'),('蓮葉童子',270,'zh'),
('莲叶童子',270,'zh'),('ハスボー',270,'ja'),('lombre',271,'en'),('蓮帽小童',271,'zh'),('莲帽小童',271,'zh'),('ハスブレロ',271,'ja'),('ludicolo',272,'en'),('樂天河童',272,'zh'),
('乐天河童',272,'zh'),('ルンパッパ',272,'ja'),('seedot',273,'en'),('橡實果',273,'zh'),('橡实果',273,'zh'),('タネボー',273,'ja'),('nuzleaf',274,'en'),('長鼻葉',274,'zh'),
('长鼻叶',274,'zh'),('コノハナ',274,'ja'),('shiftry',275,'en'),('狡猾天狗',275,'zh'),('ダーテング',275,'ja'),('taillow',276,'en'),('傲骨燕',276,'zh'),('スバメ',276,'ja'),
('swellow',277,'en'),('大王燕',277,'zh'),('オオスバメ',277,'ja'),('wingull',278,'en'),('長翅鷗',278,'zh'),('长翅鸥',278,'zh'),('キャモメ',278,'ja'),('pelipper',279,'en'),
('大嘴鷗',279,'zh'),('大嘴鸥',279,'zh'),('ペリッパー',279,'ja'),('ralts',280,'en'),('拉魯拉絲',280,'zh'),('拉鲁拉丝',280,'zh'),('ラルトス',280,'ja'),('kirlia',281,'en'),
('奇魯莉安',281,'zh'),('奇鲁莉安',281,'zh'),('キルリア',281,'ja'),('gardevoir',282,'en'),('沙奈朵',282,'zh'),('サーナイト',282,'ja'),('surskit',283,'en'),('溜溜糖球',283,'zh'),
('アメタマ',283,'ja'),('masquerain',284,'en'),('雨翅蛾',284,'zh'),('アメモース',284,'ja'),('shroomish',285,'en'),('蘑蘑菇',285,'zh'),('キノココ',285,'ja'),('breloom',286,'en'),
('斗笠菇',286,'zh'),('キノガッサ',286,'ja'),('slakoth',287,'en'),('懶人獺',287,'zh'),('懒人獭',287,'zh'),('ナマケロ',287,'ja'),('vigoroth',288,'en'),('過動猿',288,'zh'),
('过动猿',288,'zh'),('ヤルキモノ',288,'ja'),('slaking',289,'en'),('請假王',289,'zh'),('请假王',289,'zh'),('ケッキング',289,'ja'),('nincada',290,'en'),('土居忍士',290,'zh'),
('ツチニン',290,'ja'),('ninjask',291,'en'),('鐵面忍者',291,'zh'),('铁面忍者',291,'zh'),('テッカニン',291,'ja'),('shedinja',292,'en'),('脫殼忍者',292,'zh'),('脱壳忍者',292,'zh'),
('ヌケニン',292,'ja'),('whismur',293,'en'),('咕妞妞',293,'zh'),('ゴニョニョ',293,'ja'),('loudred',294,'en'),('吼爆彈',294,'zh'),('吼爆弹',294,'zh'),('ドゴーム',294,'ja'),
('exploud',295,'en'),('爆音怪',295,'zh'),('バクオング',295,'ja'),('makuhita',296,'en'),('幕下力士',296,'zh'),('マクノシタ',296,'ja'),('hariyama',297,'en'),('鐵掌力士',297,'zh'),
('铁掌力士',297,'zh'),('ハリテヤマ',297,'ja'),('azurill',298,'en'),('露力麗',298,'zh'),('露力丽',298,'zh'),('ルリリ',298,'ja'),('nosepass',299,'en'),('朝北鼻',299,'zh'),
('ノズパス',299,'ja'),('skitty',300,'en'),('向尾喵',300,'zh'),('エネコ',300,'ja'),('delcatty',301,'en'),('優雅貓',301,'zh'),('优雅猫',301,'zh'),('エネコロロ',301,'ja'),
('sableye',302,'en'),('勾魂眼',302,'zh'),('ヤミラミ',302,'ja'),('mawile',303,'en'),('大嘴娃',303,'zh'),('クチート',303,'ja'),('aron',304,'en'),('可可多拉',304,'zh'),
('ココドラ',304,'ja'),('lairon',305,'en'),('可多拉',305,'zh'),('コドラ',305,'ja'),('aggron',306,'en'),('波士可多拉',306,'zh'),('ボスゴドラ',306,'ja'),('meditite',307,'en'),
('瑪沙那',307,'zh'),('玛沙那',307,'zh'),('アサナン',307,'ja'),('medicham',308,'en'),('恰雷姆',308,'zh'),('チャーレム',308,'ja'),('electrike',309,'en'),('落雷獸',309,'zh'),
('落雷兽',309,'zh'),('ラクライ',309,'ja'),('manectric',310,'en'),('雷電獸',310,'zh'),('雷电兽',310,'zh'),('ライボルト',310,'ja'),('plusle',311,'en'),('正電拍拍',311,'zh'),
('正电拍拍',311,'zh'),('プラスル',311,'ja'),('minun',312,'en'),('負電拍拍',312,'zh'),('負电拍拍',312,'zh'),('マイナン',312,'ja'),('volbeat',313,'en'),('電螢蟲',313,'zh'),
('电萤虫',313,'zh'),('バルビート',313,'ja'),('illumise',314,'en'),('甜甜螢',314,'zh'),('甜甜萤',314,'zh'),('イルミーゼ',314,'ja'),('roselia',315,'en'),('毒薔薇',315,'zh'),
('毒蔷薇',315,'zh'),('ロゼリア',315,'ja'),('gulpin',316,'en'),('溶食獸',316,'zh'),('溶食兽',316,'zh'),('ゴクリン',316,'ja'),('swalot',317,'en'),('吞食獸',317,'zh'),('吞食兽',317,'zh'),
('マルノーム',317,'ja'),('carvanha',318,'en'),('利牙魚',318,'zh'),('利牙鱼',318,'zh'),('キバニア',318,'ja'),('sharpedo',319,'en'),('巨牙鯊',319,'zh'),('巨牙鲨',319,'zh'),
('サメハダー',319,'ja'),('wailmer',320,'en'),('吼吼鯨',320,'zh'),('吼吼鲸',320,'zh'),('ホエルコ',320,'ja'),('wailord',321,'en'),('吼鯨王',321,'zh'),('吼鲸王',321,'zh'),
('ホエルオー',321,'ja'),('numel',322,'en'),('呆火駝',322,'zh'),('呆火驼',322,'zh'),('ドンメル',322,'ja'),('camerupt',323,'en'),('噴火駝',323,'zh'),('喷火驼',323,'zh'),
('バクーダ',323,'ja'),('torkoal',324,'en'),('煤炭龜',324,'zh'),('煤炭龟',324,'zh'),('コータス',324,'ja'),('spoink',325,'en'),('跳跳豬',325,'zh'),('跳跳猪',325,'zh'),
('バネブー',325,'ja'),('grumpig',326,'en'),('噗噗豬',326,'zh'),('噗噗猪',326,'zh'),('ブーピッグ',326,'ja'),('spinda',327,'en'),('晃晃斑',327,'zh'),('パッチール',327,'ja'),
('trapinch',328,'en'),('大顎蟻',328,'zh'),('大颚蚁',328,'zh'),('ナックラー',328,'ja'),('vibrava',329,'en'),('超音波幼蟲',329,'zh'),('超音波幼虫',329,'zh'),('ビブラーバ',329,'ja'),
('flygon',330,'en'),('沙漠蜻蜓',330,'zh'),('フライゴン',330,'ja'),('cacnea',331,'en'),('刺球仙人掌',331,'zh'),('サボネア',331,'ja'),('cacturne',332,'en'),('夢歌仙人掌',332,'zh'),
('梦歌仙人掌',332,'zh'),('ノクタス',332,'ja'),('swablu',333,'en'),('青綿鳥',333,'zh'),('青绵鸟',333,'zh'),('チルット',333,'ja'),('altaria',334,'en'),('七夕青鳥',334,'zh'),
('七夕青鸟',334,'zh'),('チルタリス',334,'ja'),('zangoose',335,'en'),('貓鼬斬',335,'zh'),('猫鼬斩',335,'zh'),('ザングース',335,'ja'),('seviper',336,'en'),('飯匙蛇',336,'zh'),
('饭匙蛇',336,'zh'),('ハブネーク',336,'ja'),('lunatone',337,'en'),('月石',337,'zh'),('ルナトーン',337,'ja'),('solrock',338,'en'),('太陽岩',338,'zh'),('太阳岩',338,'zh'),
('ソルロック',338,'ja'),('barboach',339,'en'),('泥泥鰍',339,'zh'),('泥泥鳅',339,'zh'),('ドジョッチ',339,'ja'),('whiscash',340,'en'),('鯰魚王',340,'zh'),('鲶鱼王',340,'zh'),
('ナマズン',340,'ja'),('corphish',341,'en'),('龍蝦小兵',341,'zh'),('龙虾小兵',341,'zh'),('ヘイガニ',341,'ja'),('crawdaunt',342,'en'),('鐵螯龍蝦',342,'zh'),('铁螯龙虾',342,'zh'),
('シザリガー',342,'ja'),('baltoy',343,'en'),('天秤偶',343,'zh'),('ヤジロン',343,'ja'),('claydol',344,'en'),('念力土偶',344,'zh'),('ネンドール',344,'ja'),('lileep',345,'en'),
('觸手百合',345,'zh'),('触手百合',345,'zh'),('リリーラ',345,'ja'),('cradily',346,'en'),('搖籃百合',346,'zh'),('摇篮百合',346,'zh'),('ユレイドル',346,'ja'),('anorith',347,'en'),
('太古羽蟲',347,'zh'),('太古羽虫',347,'zh'),('アノプス',347,'ja'),('armaldo',348,'en'),('太古盔甲',348,'zh'),('アーマルド',348,'ja'),('feebas',349,'en'),('醜醜魚',349,'zh'),
('丑丑鱼',349,'zh'),('ヒンバス',349,'ja'),('milotic',350,'en'),('美納斯',350,'zh'),('美纳斯',350,'zh'),('ミロカロス',350,'ja'),('castform',351,'en'),('飄浮泡泡',351,'zh'),
('飘浮泡泡',351,'zh'),('ポワルン',351,'ja'),('kecleon',352,'en'),('變隱龍',352,'zh'),('变隐龙',352,'zh'),('カクレオン',352,'ja'),('shuppet',353,'en'),('怨影娃娃',353,'zh'),
('カゲボウズ',353,'ja'),('banette',354,'en'),('詛咒娃娃',354,'zh'),('诅咒娃娃',354,'zh'),('ジュペッタ',354,'ja'),('duskull',355,'en'),('夜巡靈',355,'zh'),('夜巡灵',355,'zh'),
('ヨマワル',355,'ja'),('dusclops',356,'en'),('彷徨夜靈',356,'zh'),('彷徨夜灵',356,'zh'),('サマヨール',356,'ja'),('tropius',357,'en'),('熱帶龍',357,'zh'),('热带龙',357,'zh'),
('トロピウス',357,'ja'),('chimecho',358,'en'),('風鈴鈴',358,'zh'),('风铃铃',358,'zh'),('チリーン',358,'ja'),('absol',359,'en'),('阿勃梭魯',359,'zh'),('阿勃梭鲁',359,'zh'),
('アブソル',359,'ja'),('wynaut',360,'en'),('小果然',360,'zh'),('ソーナノ',360,'ja'),('snorunt',361,'en'),('雪童子',361,'zh'),('ユキワラシ',361,'ja'),('glalie',362,'en'),
('冰鬼護',362,'zh'),('冰鬼护',362,'zh'),('オニゴーリ',362,'ja'),('spheal',363,'en'),('海豹球',363,'zh'),('タマザラシ',363,'ja'),('sealeo',364,'en'),('海魔獅',364,'zh'),
('海魔狮',364,'zh'),('トドグラー',364,'ja'),('walrein',365,'en'),('帝牙海獅',365,'zh'),('帝牙海狮',365,'zh'),('トドゼルガ',365,'ja'),('clamperl',366,'en'),('珍珠貝',366,'zh'),
('珍珠贝',366,'zh'),('パールル',366,'ja'),('huntail',367,'en'),('獵斑魚',367,'zh'),('猎斑鱼',367,'zh'),('ハンテール',367,'ja'),('gorebyss',368,'en'),('櫻花魚',368,'zh'),
('樱花鱼',368,'zh'),('サクラビス',368,'ja'),('relicanth',369,'en'),('古空棘魚',369,'zh'),('古空棘鱼',369,'zh'),('ジーランス',369,'ja'),('luvdisc',370,'en'),('愛心魚',370,'zh'),
('爱心鱼',370,'zh'),('ラブカス',370,'ja'),('bagon',371,'en'),('寶貝龍',371,'zh'),('宝贝龙',371,'zh'),('タツベイ',371,'ja'),('shelgon',372,'en'),('甲殼龍',372,'zh'),('甲壳龙',372,'zh'),
('コモルー',372,'ja'),('salamence',373,'en'),('暴飛龍',373,'zh'),('暴飞龙',373,'zh'),('ボーマンダ',373,'ja'),('beldum',374,'en'),('鐵啞鈴',374,'zh'),('铁哑铃',374,'zh'),
('ダンバル',374,'ja'),('metang',375,'en'),('金屬怪',375,'zh'),('金属怪',375,'zh'),('メタング',375,'ja'),('metagross',376,'en'),('巨金怪',376,'zh'),('メタグロス',376,'ja'),
('regirock',377,'en'),('雷吉洛克',377,'zh'),('レジロック',377,'ja'),('regice',378,'en'),('雷吉艾斯',378,'zh'),('レジアイス',378,'ja'),('registeel',379,'en'),('雷吉斯奇魯',379,'zh'),
('雷吉斯奇鲁',379,'zh'),('レジスチル',379,'ja'),('latias',380,'en'),('拉帝亞斯',380,'zh'),('拉帝亚斯',380,'zh'),('ラティアス',380,'ja'),('latios',381,'en'),('拉帝歐斯',381,'zh'),
('拉帝欧斯',381,'zh'),('ラティオス',381,'ja'),('kyogre',382,'en'),('蓋歐卡',382,'zh'),('盖欧卡',382,'zh'),('カイオーガ',382,'ja'),('groudon',383,'en'),('固拉多',383,'zh'),
('グラードン',383,'ja'),('rayquaza',384,'en'),('烈空坐',384,'zh'),('レックウザ',384,'ja'),('jirachi',385,'en'),('基拉祈',385,'zh'),('ジラーチ',385,'ja'),('deoxys',386,'en'),
('代歐奇希斯',386,'zh'),('代欧奇希斯',386,'zh'),('デオキシス',386,'ja'),('turtwig',387,'en'),('草苗龜',387,'zh'),('草苗龟',387,'zh'),('ナエトル',387,'ja'),('grotle',388,'en'),
('樹林龜',388,'zh'),('树林龟',388,'zh'),('ハヤシガメ',388,'ja'),('torterra',389,'en'),('土台龜',389,'zh'),('土台龟',389,'zh'),('ドダイトス',389,'ja'),('chimchar',390,'en'),
('小火焰猴',390,'zh'),('ヒコザル',390,'ja'),('monferno',391,'en'),('猛火猴',391,'zh'),('モウカザル',391,'ja'),('infernape',392,'en'),('烈焰猴',392,'zh'),('ゴウカザル',392,'ja'),
('piplup',393,'en'),('波加曼',393,'zh'),('ポッチャマ',393,'ja'),('prinplup',394,'en'),('波皇子',394,'zh'),('ポッタイシ',394,'ja'),('empoleon',395,'en'),('帝王拿波',395,'zh'),
('エンペルト',395,'ja'),('starly',396,'en'),('姆克兒',396,'zh'),('姆克儿',396,'zh'),('ムックル',396,'ja'),('staravia',397,'en'),('姆克鳥',397,'zh'),('姆克鸟',397,'zh'),
('ムクバード',397,'ja'),('staraptor',398,'en'),('姆克鷹',398,'zh'),('姆克鹰',398,'zh'),('ムクホーク',398,'ja'),('bidoof',399,'en'),('大牙狸',399,'zh'),('ビッパ',399,'ja'),
('bibarel',400,'en'),('大尾狸',400,'zh'),('ビーダル',400,'ja'),('kricketot',401,'en'),('圓法師',401,'zh'),('圆法师',401,'zh'),('コロボーシ',401,'ja'),('kricketune',402,'en'),
('音箱蟀',402,'zh'),('コロトック',402,'ja'),('shinx',403,'en'),('小貓怪',403,'zh'),('小猫怪',403,'zh'),('コリンク',403,'ja'),('luxio',404,'en'),('勒克貓',404,'zh'),('勒克猫',404,'zh'),
('ルクシオ',404,'ja'),('luxray',405,'en'),('倫琴貓',405,'zh'),('伦琴猫',405,'zh'),('レントラー',405,'ja'),('budew',406,'en'),('含羞苞',406,'zh'),('スボミー',406,'ja'),
('roserade',407,'en'),('羅絲雷朵',407,'zh'),('罗丝雷朵',407,'zh'),('ロズレイド',407,'ja'),('cranidos',408,'en'),('頭蓋龍',408,'zh'),('头盖龙',408,'zh'),('ズガイドス',408,'ja'),
('rampardos',409,'en'),('戰槌龍',409,'zh'),('战槌龙',409,'zh'),('ラムパルド',409,'ja'),('shieldon',410,'en'),('盾甲龍',410,'zh'),('盾甲龙',410,'zh'),('タテトプス',410,'ja'),
('bastiodon',411,'en'),('護城龍',411,'zh'),('护城龙',411,'zh'),('トリデプス',411,'ja'),('burmy',412,'en'),('結草兒',412,'zh'),('结草儿',412,'zh'),('ミノムッチ',412,'ja'),
('wormadam',413,'en'),('結草貴婦',413,'zh'),('结草贵妇',413,'zh'),('ミノマダム',413,'ja'),('mothim',414,'en'),('紳士蛾',414,'zh'),('绅士蛾',414,'zh'),('ガーメイル',414,'ja'),
('combee',415,'en'),('三蜜蜂',415,'zh'),('ミツハニー',415,'ja'),('vespiquen',416,'en'),('蜂女王',416,'zh'),('ビークイン',416,'ja'),('pachirisu',417,'en'),('帕奇利茲',417,'zh'),
('帕奇利兹',417,'zh'),('パチリス',417,'ja'),('buizel',418,'en'),('泳圈鼬',418,'zh'),('ブイゼル',418,'ja'),('floatzel',419,'en'),('浮潛鼬',419,'zh'),('浮潜鼬',419,'zh'),
('フローゼル',419,'ja'),('cherubi',420,'en'),('櫻花寶',420,'zh'),('樱花宝',420,'zh'),('チェリンボ',420,'ja'),('cherrim',421,'en'),('櫻花兒',421,'zh'),('樱花儿',421,'zh'),
('チェリム',421,'ja'),('shellos',422,'en'),('無殼海兔',422,'zh'),('无壳海兔',422,'zh'),('カラナクシ',422,'ja'),('gastrodon',423,'en'),('海兔獸',423,'zh'),('海兔兽',423,'zh'),
('トリトドン',423,'ja'),('ambipom',424,'en'),('雙尾怪手',424,'zh'),('双尾怪手',424,'zh'),('エテボース',424,'ja'),('drifloon',425,'en'),('飄飄球',425,'zh'),('飘飘球',425,'zh'),
('フワンテ',425,'ja'),('drifblim',426,'en'),('隨風球',426,'zh'),('随风球',426,'zh'),('フワライド',426,'ja'),('buneary',427,'en'),('捲捲耳',427,'zh'),('卷卷耳',427,'zh'),
('ミミロル',427,'ja'),('lopunny',428,'en'),('長耳兔',428,'zh'),('长耳兔',428,'zh'),('ミミロップ',428,'ja'),('mismagius',429,'en'),('夢妖魔',429,'zh'),('梦妖魔',429,'zh'),
('ムウマージ',429,'ja'),('honchkrow',430,'en'),('烏鴉頭頭',430,'zh'),('乌鸦头头',430,'zh'),('ドンカラス',430,'ja'),('glameow',431,'en'),('魅力喵',431,'zh'),('ニャルマー',431,'ja'),
('purugly',432,'en'),('東施喵',432,'zh'),('东施喵',432,'zh'),('ブニャット',432,'ja'),('chingling',433,'en'),('鈴鐺響',433,'zh'),('铃铛响',433,'zh'),('リーシャン',433,'ja'),
('stunky',434,'en'),('臭鼬噗',434,'zh'),('スカンプー',434,'ja'),('skuntank',435,'en'),('坦克臭鼬',435,'zh'),('スカタンク',435,'ja'),('bronzor',436,'en'),('銅鏡怪',436,'zh'),
('铜镜怪',436,'zh'),('ドーミラー',436,'ja'),('bronzong',437,'en'),('青銅鐘',437,'zh'),('青铜钟',437,'zh'),('ドータクン',437,'ja'),('bonsly',438,'en'),('盆才怪',438,'zh'),
('ウソハチ',438,'ja'),('mimejr',439,'en'),('魔尼尼',439,'zh'),('マネネ',439,'ja'),('happiny',440,'en'),('小福蛋',440,'zh'),('ピンプク',440,'ja'),('chatot',441,'en'),
('聒噪鳥',441,'zh'),('聒噪鸟',441,'zh'),('ペラップ',441,'ja'),('spiritomb',442,'en'),('花岩怪',442,'zh'),('ミカルゲ',442,'ja'),('gible',443,'en'),('圓陸鯊',443,'zh'),
('圆陆鲨',443,'zh'),('フカマル',443,'ja'),('gabite',444,'en'),('尖牙陸鯊',444,'zh'),('尖牙陆鲨',444,'zh'),('ガバイト',444,'ja'),('garchomp',445,'en'),('烈咬陸鯊',445,'zh'),
('烈咬陆鲨',445,'zh'),('ガブリアス',445,'ja'),('munchlax',446,'en'),('小卡比獸',446,'zh'),('小卡比兽',446,'zh'),('ゴンベ',446,'ja'),('riolu',447,'en'),('利歐路',447,'zh'),
('利欧路',447,'zh'),('リオル',447,'ja'),('lucario',448,'en'),('路卡利歐',448,'zh'),('路卡利欧',448,'zh'),('ルカリオ',448,'ja'),('hippopotas',449,'en'),('沙河馬',449,'zh'),
('沙河马',449,'zh'),('ヒポポタス',449,'ja'),('hippowdon',450,'en'),('河馬獸',450,'zh'),('河马兽',450,'zh'),('カバルドン',450,'ja'),('skorupi',451,'en'),('鉗尾蠍',451,'zh'),
('钳尾蝎',451,'zh'),('スコルピ',451,'ja'),('drapion',452,'en'),('龍王蠍',452,'zh'),('龙王蝎',452,'zh'),('ドラピオン',452,'ja'),('croagunk',453,'en'),('不良蛙',453,'zh'),
('グレッグル',453,'ja'),('toxicroak',454,'en'),('毒骷蛙',454,'zh'),('ドクロッグ',454,'ja'),('carnivine',455,'en'),('尖牙籠',455,'zh'),('尖牙笼',455,'zh'),('マスキッパ',455,'ja'),
('finneon',456,'en'),('螢光魚',456,'zh'),('荧光鱼',456,'zh'),('ケイコウオ',456,'ja'),('lumineon',457,'en'),('霓虹魚',457,'zh'),('霓虹鱼',457,'zh'),('ネオラント',457,'ja'),
('mantyke',458,'en'),('小球飛魚',458,'zh'),('小球飞鱼',458,'zh'),('タマンタ',458,'ja'),('snover',459,'en'),('雪笠怪',459,'zh'),('ユキカブリ',459,'ja'),('abomasnow',460,'en'),
('暴雪王',460,'zh'),('ユキノオー',460,'ja'),('weavile',461,'en'),('瑪狃拉',461,'zh'),('玛狃拉',461,'zh'),('マニューラ',461,'ja'),('magnezone',462,'en'),('自爆磁怪',462,'zh'),
('ジバコイル',462,'ja'),('lickilicky',463,'en'),('大舌舔',463,'zh'),('ベロベルト',463,'ja'),('rhyperior',464,'en'),('超甲狂犀',464,'zh'),('ドサイドン',464,'ja'),('tangrowth',465,'en'),
('巨蔓藤',465,'zh'),('モジャンボ',465,'ja'),('electivire',466,'en'),('電擊魔獸',466,'zh'),('电击魔兽',466,'zh'),('エレキブル',466,'ja'),('magmortar',467,'en'),('鴨嘴炎獸',467,'zh'),
('鸭嘴炎兽',467,'zh'),('ブーバーン',467,'ja'),('togekiss',468,'en'),('波克基斯',468,'zh'),('トゲキッス',468,'ja'),('yanmega',469,'en'),('遠古巨蜓',469,'zh'),('远古巨蜓',469,'zh'),
('メガヤンマ',469,'ja'),('leafeon',470,'en'),('葉伊布',470,'zh'),('叶伊布',470,'zh'),('リーフィア',470,'ja'),('glaceon',471,'en'),('冰伊布',471,'zh'),('グレイシア',471,'ja'),
('gliscor',472,'en'),('天蠍王',472,'zh'),('天蝎王',472,'zh'),('グライオン',472,'ja'),('mamoswine',473,'en'),('象牙豬',473,'zh'),('象牙猪',473,'zh'),('マンムー',473,'ja'),
('porygonz',474,'en'),('多邊獸Ｚ',474,'zh'),('多边兽乙型',474,'zh'),('ポリゴンＺ',474,'ja'),('gallade',475,'en'),('艾路雷朵',475,'zh'),('エルレイド',475,'ja'),('probopass',476,'en'),
('大朝北鼻',476,'zh'),('ダイノーズ',476,'ja'),('dusknoir',477,'en'),('黑夜魔靈',477,'zh'),('黑夜魔灵',477,'zh'),('ヨノワール',477,'ja'),('froslass',478,'en'),('雪妖女',478,'zh'),
('ユキメノコ',478,'ja'),('rotom',479,'en'),('洛托姆',479,'zh'),('ロトム',479,'ja'),('uxie',480,'en'),('由克希',480,'zh'),('ユクシー',480,'ja'),('mesprit',481,'en'),
('艾姆利多',481,'zh'),('エムリット',481,'ja'),('azelf',482,'en'),('亞克諾姆',482,'zh'),('亚克诺姆',482,'zh'),('アグノム',482,'ja'),('dialga',483,'en'),('帝牙盧卡',483,'zh'),
('帝牙卢卡',483,'zh'),('ディアルガ',483,'ja'),('palkia',484,'en'),('帕路奇亞',484,'zh'),('帕路奇亚',484,'zh'),('パルキア',484,'ja'),('heatran',485,'en'),('席多藍恩',485,'zh'),
('席多蓝恩',485,'zh'),('ヒードラン',485,'ja'),('regigigas',486,'en'),('雷吉奇卡斯',486,'zh'),('レジギガス',486,'ja'),('giratina',487,'en'),('騎拉帝納',487,'zh'),('骑拉帝纳',487,'zh'),
('ギラティナ',487,'ja'),('cresselia',488,'en'),('克雷色利亞',488,'zh'),('克雷色利亚',488,'zh'),('クレセリア',488,'ja'),('phione',489,'en'),('霏歐納',489,'zh'),('霏欧纳',489,'zh'),
('フィオネ',489,'ja'),('manaphy',490,'en'),('瑪納霏',490,'zh'),('玛纳霏',490,'zh'),('マナフィ',490,'ja'),('darkrai',491,'en'),('達克萊伊',491,'zh'),('达克莱伊',491,'zh'),
('ダークライ',491,'ja'),('shaymin',492,'en'),('謝米',492,'zh'),('谢米',492,'zh'),('シェイミ',492,'ja'),('arceus',493,'en'),('阿爾宙斯',493,'zh'),('阿尔宙斯',493,'zh'),
('アルセウス',493,'ja'),('victini',494,'en'),('比克提尼',494,'zh'),('ビクティニ',494,'ja'),('snivy',495,'en'),('藤藤蛇',495,'zh'),('ツタージャ',495,'ja'),('servine',496,'en'),
('青藤蛇',496,'zh'),('ジャノビー',496,'ja'),('serperior',497,'en'),('君主蛇',497,'zh'),('ジャローダ',497,'ja'),('tepig',498,'en'),('暖暖豬',498,'zh'),('暖暖猪',498,'zh'),
('ポカブ',498,'ja'),('pignite',499,'en'),('炒炒豬',499,'zh'),('炒炒猪',499,'zh'),('チャオブー',499,'ja'),('emboar',500,'en'),('炎武王',500,'zh'),('エンブオー',500,'ja'),
('oshawott',501,'en'),('水水獺',501,'zh'),('水水獭',501,'zh'),('ミジュマル',501,'ja'),('dewott',502,'en'),('雙刃丸',502,'zh'),('双刃丸',502,'zh'),('フタチマル',502,'ja'),
('samurott',503,'en'),('大劍鬼',503,'zh'),('大剑鬼',503,'zh'),('ダイケンキ',503,'ja'),('patrat',504,'en'),('探探鼠',504,'zh'),('ミネズミ',504,'ja'),('watchog',505,'en'),
('步哨鼠',505,'zh'),('ミルホッグ',505,'ja'),('lillipup',506,'en'),('小約克',506,'zh'),('小约克',506,'zh'),('ヨーテリー',506,'ja'),('herdier',507,'en'),('哈約克',507,'zh'),
('哈约克',507,'zh'),('ハーデリア',507,'ja'),('stoutland',508,'en'),('長毛狗',508,'zh'),('长毛狗',508,'zh'),('ムーランド',508,'ja'),('purrloin',509,'en'),('扒手貓',509,'zh'),
('扒手猫',509,'zh'),('チョロネコ',509,'ja'),('liepard',510,'en'),('酷豹',510,'zh'),('レパルダス',510,'ja'),('pansage',511,'en'),('花椰猴',511,'zh'),('ヤナップ',511,'ja'),
('simisage',512,'en'),('花椰猿',512,'zh'),('ヤナッキー',512,'ja'),('pansear',513,'en'),('爆香猴',513,'zh'),('バオップ',513,'ja'),('simisear',514,'en'),('爆香猿',514,'zh'),
('バオッキー',514,'ja'),('panpour',515,'en'),('冷水猴',515,'zh'),('ヒヤップ',515,'ja'),('simipour',516,'en'),('冷水猿',516,'zh'),('ヒヤッキー',516,'ja'),('munna',517,'en'),
('食夢夢',517,'zh'),('食梦梦',517,'zh'),('ムンナ',517,'ja'),('musharna',518,'en'),('夢夢蝕',518,'zh'),('梦梦蚀',518,'zh'),('ムシャーナ',518,'ja'),('pidove',519,'en'),
('豆豆鴿',519,'zh'),('豆豆鸽',519,'zh'),('マメパト',519,'ja'),('tranquill',520,'en'),('咕咕鴿',520,'zh'),('咕咕鸽',520,'zh'),('ハトーボー',520,'ja'),('unfezant',521,'en'),
('高傲雉雞',521,'zh'),('高傲雉鸡',521,'zh'),('ケンホロウ',521,'ja'),('blitzle',522,'en'),('斑斑馬',522,'zh'),('斑斑马',522,'zh'),('シママ',522,'ja'),('zebstrika',523,'en'),
('雷電斑馬',523,'zh'),('雷电斑马',523,'zh'),('ゼブライカ',523,'ja'),('roggenrola',524,'en'),('石丸子',524,'zh'),('ダンゴロ',524,'ja'),('boldore',525,'en'),('地幔岩',525,'zh'),
('ガントル',525,'ja'),('gigalith',526,'en'),('龐岩怪',526,'zh'),('庞岩怪',526,'zh'),('ギガイアス',526,'ja'),('woobat',527,'en'),('滾滾蝙蝠',527,'zh'),('滚滚蝙蝠',527,'zh'),
('コロモリ',527,'ja'),('swoobat',528,'en'),('心蝙蝠',528,'zh'),('ココロモリ',528,'ja'),('drilbur',529,'en'),('螺釘地鼠',529,'zh'),('螺钉地鼠',529,'zh'),('モグリュー',529,'ja'),
('excadrill',530,'en'),('龍頭地鼠',530,'zh'),('龙头地鼠',530,'zh'),('ドリュウズ',530,'ja'),('audino',531,'en'),('差不多娃娃',531,'zh'),('タブンネ',531,'ja'),('timburr',532,'en'),
('搬運小匠',532,'zh'),('搬运小匠',532,'zh'),('ドッコラー',532,'ja'),('gurdurr',533,'en'),('鐵骨土人',533,'zh'),('铁骨土人',533,'zh'),('ドテッコツ',533,'ja'),('conkeldurr',534,'en'),
('修建老匠',534,'zh'),('ローブシン',534,'ja'),('tympole',535,'en'),('圓蝌蚪',535,'zh'),('圆蝌蚪',535,'zh'),('オタマロ',535,'ja'),('palpitoad',536,'en'),('藍蟾蜍',536,'zh'),
('蓝蟾蜍',536,'zh'),('ガマガル',536,'ja'),('seismitoad',537,'en'),('蟾蜍王',537,'zh'),('ガマゲロゲ',537,'ja'),('throh',538,'en'),('投摔鬼',538,'zh'),('ナゲキ',538,'ja'),
('sawk',539,'en'),('打擊鬼',539,'zh'),('打击鬼',539,'zh'),('ダゲキ',539,'ja'),('sewaddle',540,'en'),('蟲寶包',540,'zh'),('虫宝包',540,'zh'),('クルミル',540,'ja'),
('swadloon',541,'en'),('寶包繭',541,'zh'),('宝包茧',541,'zh'),('クルマユ',541,'ja'),('leavanny',542,'en'),('保母蟲',542,'zh'),('保姆虫',542,'zh'),('ハハコモリ',542,'ja'),
('venipede',543,'en'),('百足蜈蚣',543,'zh'),('フシデ',543,'ja'),('whirlipede',544,'en'),('車輪毬',544,'zh'),('车轮球',544,'zh'),('ホイーガ',544,'ja'),('scolipede',545,'en'),
('蜈蚣王',545,'zh'),('ペンドラー',545,'ja'),('cottonee',546,'en'),('木棉球',546,'zh'),('モンメン',546,'ja'),('whimsicott',547,'en'),('風妖精',547,'zh'),('风妖精',547,'zh'),
('エルフーン',547,'ja'),('petilil',548,'en'),('百合根娃娃',548,'zh'),('チュリネ',548,'ja'),('lilligant',549,'en'),('裙兒小姐',549,'zh'),('裙儿小姐',549,'zh'),('ドレディア',549,'ja'),
('basculin',550,'en'),('野蠻鱸魚',550,'zh'),('野蛮鲈鱼',550,'zh'),('バスラオ',550,'ja'),('sandile',551,'en'),('黑眼鱷',551,'zh'),('黑眼鳄',551,'zh'),('メグロコ',551,'ja'),
('krokorok',552,'en'),('混混鱷',552,'zh'),('混混鳄',552,'zh'),('ワルビル',552,'ja'),('krookodile',553,'en'),('流氓鱷',553,'zh'),('流氓鳄',553,'zh'),('ワルビアル',553,'ja'),
('darumaka',554,'en'),('火紅不倒翁',554,'zh'),('火红不倒翁',554,'zh'),('ダルマッカ',554,'ja'),('darmanitan',555,'en'),('達摩狒狒',555,'zh'),('达摩狒狒',555,'zh'),('ヒヒダルマ',555,'ja'),
('maractus',556,'en'),('沙鈴仙人掌',556,'zh'),('沙铃仙人掌',556,'zh'),('マラカッチ',556,'ja'),('dwebble',557,'en'),('石居蟹',557,'zh'),('イシズマイ',557,'ja'),('crustle',558,'en'),
('岩殿居蟹',558,'zh'),('イワパレス',558,'ja'),('scraggy',559,'en'),('滑滑小子',559,'zh'),('ズルッグ',559,'ja'),('scrafty',560,'en'),('頭巾混混',560,'zh'),('头巾混混',560,'zh'),
('ズルズキン',560,'ja'),('sigilyph',561,'en'),('象徵鳥',561,'zh'),('象征鸟',561,'zh'),('シンボラー',561,'ja'),('yamask',562,'en'),('哭哭面具',562,'zh'),('デスマス',562,'ja'),
('cofagrigus',563,'en'),('死神棺',563,'zh'),('迭失棺',563,'zh'),('デスカーン',563,'ja'),('tirtouga',564,'en'),('原蓋海龜',564,'zh'),('原盖海龟',564,'zh'),('プロトーガ',564,'ja'),
('carracosta',565,'en'),('肋骨海龜',565,'zh'),('肋骨海龟',565,'zh'),('アバゴーラ',565,'ja'),('archen',566,'en'),('始祖小鳥',566,'zh'),('始祖小鸟',566,'zh'),('アーケン',566,'ja'),
('archeops',567,'en'),('始祖大鳥',567,'zh'),('始祖大鸟',567,'zh'),('アーケオス',567,'ja'),('trubbish',568,'en'),('破破袋',568,'zh'),('ヤブクロン',568,'ja'),('garbodor',569,'en'),
('灰塵山',569,'zh'),('灰尘山',569,'zh'),('ダストダス',569,'ja'),('zorua',570,'en'),('索羅亞',570,'zh'),('索罗亚',570,'zh'),('ゾロア',570,'ja'),('zoroark',571,'en'),('索羅亞克',571,'zh'),
('索罗亚克',571,'zh'),('ゾロアーク',571,'ja'),('minccino',572,'en'),('泡沫栗鼠',572,'zh'),('チラーミィ',572,'ja'),('cinccino',573,'en'),('奇諾栗鼠',573,'zh'),('奇诺栗鼠',573,'zh'),
('チラチーノ',573,'ja'),('gothita',574,'en'),('哥德寶寶',574,'zh'),('哥德宝宝',574,'zh'),('ゴチム',574,'ja'),('gothorita',575,'en'),('哥德小童',575,'zh'),('ゴチミル',575,'ja'),
('gothitelle',576,'en'),('哥德小姐',576,'zh'),('ゴチルゼル',576,'ja'),('solosis',577,'en'),('單卵細胞球',577,'zh'),('单卵细胞球',577,'zh'),('ユニラン',577,'ja'),('duosion',578,'en'),
('雙卵細胞球',578,'zh'),('双卵细胞球',578,'zh'),('ダブラン',578,'ja'),('reuniclus',579,'en'),('人造細胞卵',579,'zh'),('人造细胞卵',579,'zh'),('ランクルス',579,'ja'),('ducklett',580,'en'),
('鴨寶寶',580,'zh'),('鸭宝宝',580,'zh'),('コアルヒー',580,'ja'),('swanna',581,'en'),('舞天鵝',581,'zh'),('舞天鹅',581,'zh'),('スワンナ',581,'ja'),('vanillite',582,'en'),
('迷你冰',582,'zh'),('バニプッチ',582,'ja'),('vanillish',583,'en'),('多多冰',583,'zh'),('バニリッチ',583,'ja'),('vanilluxe',584,'en'),('雙倍多多冰',584,'zh'),('双倍多多冰',584,'zh'),
('バイバニラ',584,'ja'),('deerling',585,'en'),('四季鹿',585,'zh'),('シキジカ',585,'ja'),('sawsbuck',586,'en'),('萌芽鹿',586,'zh'),('メブキジカ',586,'ja'),('emolga',587,'en'),
('電飛鼠',587,'zh'),('电飞鼠',587,'zh'),('エモンガ',587,'ja'),('karrablast',588,'en'),('蓋蓋蟲',588,'zh'),('盖盖虫',588,'zh'),('カブルモ',588,'ja'),('escavalier',589,'en'),
('騎士蝸牛',589,'zh'),('骑士蜗牛',589,'zh'),('シュバルゴ',589,'ja'),('foongus',590,'en'),('哎呀球菇',590,'zh'),('タマゲタケ',590,'ja'),('amoonguss',591,'en'),('敗露球菇',591,'zh'),
('败露球菇',591,'zh'),('モロバレル',591,'ja'),('frillish',592,'en'),('輕飄飄',592,'zh'),('轻飘飘',592,'zh'),('プルリル',592,'ja'),('jellicent',593,'en'),('胖嘟嘟',593,'zh'),
('ブルンゲル',593,'ja'),('alomomola',594,'en'),('保母曼波',594,'zh'),('保姆曼波',594,'zh'),('ママンボウ',594,'ja'),('joltik',595,'en'),('電電蟲',595,'zh'),('电电虫',595,'zh'),
('バチュル',595,'ja'),('galvantula',596,'en'),('電蜘蛛',596,'zh'),('电蜘蛛',596,'zh'),('デンチュラ',596,'ja'),('ferroseed',597,'en'),('種子鐵球',597,'zh'),('种子铁球',597,'zh'),
('テッシード',597,'ja'),('ferrothorn',598,'en'),('堅果啞鈴',598,'zh'),('坚果哑铃',598,'zh'),('ナットレイ',598,'ja'),('klink',599,'en'),('齒輪兒',599,'zh'),('齿轮儿',599,'zh'),
('ギアル',599,'ja'),('klang',600,'en'),('齒輪組',600,'zh'),('齿轮组',600,'zh'),('ギギアル',600,'ja'),('klinklang',601,'en'),('齒輪怪',601,'zh'),('齿轮怪',601,'zh'),
('ギギギアル',601,'ja'),('tynamo',602,'en'),('麻麻小魚',602,'zh'),('麻麻小鱼',602,'zh'),('シビシラス',602,'ja'),('eelektrik',603,'en'),('麻麻鰻',603,'zh'),('麻麻鳗',603,'zh'),
('シビビール',603,'ja'),('eelektross',604,'en'),('麻麻鰻魚王',604,'zh'),('麻麻鳗鱼王',604,'zh'),('シビルドン',604,'ja'),('elgyem',605,'en'),('小灰怪',605,'zh'),('リグレー',605,'ja'),
('beheeyem',606,'en'),('大宇怪',606,'zh'),('オーベム',606,'ja'),('litwick',607,'en'),('燭光靈',607,'zh'),('烛光灵',607,'zh'),('ヒトモシ',607,'ja'),('lampent',608,'en'),
('燈火幽靈',608,'zh'),('灯火幽灵',608,'zh'),('ランプラー',608,'ja'),('chandelure',609,'en'),('水晶燈火靈',609,'zh'),('水晶灯火灵',609,'zh'),('シャンデラ',609,'ja'),('axew',610,'en'),
('牙牙',610,'zh'),('キバゴ',610,'ja'),('fraxure',611,'en'),('斧牙龍',611,'zh'),('斧牙龙',611,'zh'),('オノンド',611,'ja'),('haxorus',612,'en'),('雙斧戰龍',612,'zh'),
('双斧战龙',612,'zh'),('オノノクス',612,'ja'),('cubchoo',613,'en'),('噴嚏熊',613,'zh'),('喷嚏熊',613,'zh'),('クマシュン',613,'ja'),('beartic',614,'en'),('凍原熊',614,'zh'),
('冻原熊',614,'zh'),('ツンベアー',614,'ja'),('cryogonal',615,'en'),('幾何雪花',615,'zh'),('几何雪花',615,'zh'),('フリージオ',615,'ja'),('shelmet',616,'en'),('小嘴蝸',616,'zh'),
('小嘴蜗',616,'zh'),('チョボマキ',616,'ja'),('accelgor',617,'en'),('敏捷蟲',617,'zh'),('敏捷虫',617,'zh'),('アギルダー',617,'ja'),('stunfisk',618,'en'),('泥巴魚',618,'zh'),
('泥巴鱼',618,'zh'),('マッギョ',618,'ja'),('mienfoo',619,'en'),('功夫鼬',619,'zh'),('コジョフー',619,'ja'),('mienshao',620,'en'),('師父鼬',620,'zh'),('师父鼬',620,'zh'),
('コジョンド',620,'ja'),('druddigon',621,'en'),('赤面龍',621,'zh'),('赤面龙',621,'zh'),('クリムガン',621,'ja'),('golett',622,'en'),('泥偶小人',622,'zh'),('ゴビット',622,'ja'),
('golurk',623,'en'),('泥偶巨人',623,'zh'),('ゴルーグ',623,'ja'),('pawniard',624,'en'),('駒刀小兵',624,'zh'),('驹刀小兵',624,'zh'),('コマタナ',624,'ja'),('bisharp',625,'en'),
('劈斬司令',625,'zh'),('劈斩司令',625,'zh'),('キリキザン',625,'ja'),('bouffalant',626,'en'),('爆炸頭水牛',626,'zh'),('爆炸头水牛',626,'zh'),('バッフロン',626,'ja'),('rufflet',627,'en'),
('毛頭小鷹',627,'zh'),('毛头小鹰',627,'zh'),('ワシボン',627,'ja'),('braviary',628,'en'),('勇士雄鷹',628,'zh'),('勇士雄鹰',628,'zh'),('ウォーグル',628,'ja'),('vullaby',629,'en'),
('禿鷹丫頭',629,'zh'),('秃鹰丫头',629,'zh'),('バルチャイ',629,'ja'),('mandibuzz',630,'en'),('禿鷹娜',630,'zh'),('秃鹰娜',630,'zh'),('バルジーナ',630,'ja'),('heatmor',631,'en'),
('熔蟻獸',631,'zh'),('熔蚁兽',631,'zh'),('クイタラン',631,'ja'),('durant',632,'en'),('鐵蟻',632,'zh'),('铁蚁',632,'zh'),('アイアント',632,'ja'),('deino',633,'en'),('單首龍',633,'zh'),
('单首龙',633,'zh'),('モノズ',633,'ja'),('zweilous',634,'en'),('雙首暴龍',634,'zh'),('双首暴龙',634,'zh'),('ジヘッド',634,'ja'),('hydreigon',635,'en'),('三首惡龍',635,'zh'),
('三首恶龙',635,'zh'),('サザンドラ',635,'ja'),('larvesta',636,'en'),('燃燒蟲',636,'zh'),('燃烧虫',636,'zh'),('メラルバ',636,'ja'),('volcarona',637,'en'),('火神蛾',637,'zh'),
('ウルガモス',637,'ja'),('cobalion',638,'en'),('勾帕路翁',638,'zh'),('コバルオン',638,'ja'),('terrakion',639,'en'),('代拉基翁',639,'zh'),('テラキオン',639,'ja'),('virizion',640,'en'),
('畢力吉翁',640,'zh'),('毕力吉翁',640,'zh'),('ビリジオン',640,'ja'),('tornadus',641,'en'),('龍捲雲',641,'zh'),('龙卷云',641,'zh'),('トルネロス',641,'ja'),('thundurus',642,'en'),
('雷電雲',642,'zh'),('雷电云',642,'zh'),('ボルトロス',642,'ja'),('reshiram',643,'en'),('萊希拉姆',643,'zh'),('莱希拉姆',643,'zh'),('レシラム',643,'ja'),('zekrom',644,'en'),
('捷克羅姆',644,'zh'),('捷克罗姆',644,'zh'),('ゼクロム',644,'ja'),('landorus',645,'en'),('土地雲',645,'zh'),('土地云',645,'zh'),('ランドロス',645,'ja'),('kyurem',646,'en'),
('酋雷姆',646,'zh'),('キュレム',646,'ja'),('keldeo',647,'en'),('凱路迪歐',647,'zh'),('凯路迪欧',647,'zh'),('ケルディオ',647,'ja'),('meloetta',648,'en'),('美洛耶塔',648,'zh'),
('メロエッタ',648,'ja'),('genesect',649,'en'),('蓋諾賽克特',649,'zh'),('盖诺赛克特',649,'zh'),('ゲノセクト',649,'ja'),('chespin',650,'en'),('哈力栗',650,'zh'),('ハリマロン',650,'ja'),
('quilladin',651,'en'),('胖胖哈力',651,'zh'),('ハリボーグ',651,'ja'),('chesnaught',652,'en'),('布里卡隆',652,'zh'),('ブリガロン',652,'ja'),('fennekin',653,'en'),('火狐狸',653,'zh'),
('フォッコ',653,'ja'),('braixen',654,'en'),('長尾火狐',654,'zh'),('长尾火狐',654,'zh'),('テールナー',654,'ja'),('delphox',655,'en'),('妖火紅狐',655,'zh'),('妖火红狐',655,'zh'),
('マフォクシー',655,'ja'),('froakie',656,'en'),('呱呱泡蛙',656,'zh'),('ケロマツ',656,'ja'),('frogadier',657,'en'),('呱頭蛙',657,'zh'),('呱头蛙',657,'zh'),('ゲコガシラ',657,'ja'),
('greninja',658,'en'),('甲賀忍蛙',658,'zh'),('甲贺忍蛙',658,'zh'),('ゲッコウガ',658,'ja'),('bunnelby',659,'en'),('掘掘兔',659,'zh'),('ホルビー',659,'ja'),('diggersby',660,'en'),
('掘地兔',660,'zh'),('ホルード',660,'ja'),('fletchling',661,'en'),('小箭雀',661,'zh'),('ヤヤコマ',661,'ja'),('fletchinder',662,'en'),('火箭雀',662,'zh'),('ヒノヤコマ',662,'ja'),
('talonflame',663,'en'),('烈箭鷹',663,'zh'),('烈箭鹰',663,'zh'),('ファイアロー',663,'ja'),('scatterbug',664,'en'),('粉蝶蟲',664,'zh'),('粉蝶虫',664,'zh'),('コフキムシ',664,'ja'),
('spewpa',665,'en'),('粉蝶蛹',665,'zh'),('コフーライ',665,'ja'),('vivillon',666,'en'),('彩粉蝶',666,'zh'),('ビビヨン',666,'ja'),('litleo',667,'en'),('小獅獅',667,'zh'),
('小狮狮',667,'zh'),('シシコ',667,'ja'),('pyroar',668,'en'),('火炎獅',668,'zh'),('火炎狮',668,'zh'),('カエンジシ',668,'ja'),('flabebe',669,'en'),('花蓓蓓',669,'zh'),
('フラベベ',669,'ja'),('floette',670,'en'),('花葉蒂',670,'zh'),('花叶蒂',670,'zh'),('フラエッテ',670,'ja'),('florges',671,'en'),('花潔夫人',671,'zh'),('花洁夫人',671,'zh'),
('フラージェス',671,'ja'),('skiddo',672,'en'),('坐騎小羊',672,'zh'),('坐骑小羊',672,'zh'),('メェークル',672,'ja'),('gogoat',673,'en'),('坐騎山羊',673,'zh'),('坐骑山羊',673,'zh'),
('ゴーゴート',673,'ja'),('pancham',674,'en'),('頑皮熊貓',674,'zh'),('顽皮熊猫',674,'zh'),('ヤンチャム',674,'ja'),('pangoro',675,'en'),('流氓熊貓',675,'zh'),('霸道熊猫',675,'zh'),
('ゴロンダ',675,'ja'),('furfrou',676,'en'),('多麗米亞',676,'zh'),('多丽米亚',676,'zh'),('トリミアン',676,'ja'),('espurr',677,'en'),('妙喵',677,'zh'),('ニャスパー',677,'ja'),
('meowstic',678,'en'),('超能妙喵',678,'zh'),('ニャオニクス',678,'ja'),('honedge',679,'en'),('獨劍鞘',679,'zh'),('独剑鞘',679,'zh'),('ヒトツキ',679,'ja'),('doublade',680,'en'),
('雙劍鞘',680,'zh'),('双剑鞘',680,'zh'),('ニダンギル',680,'ja'),('aegislash',681,'en'),('堅盾劍怪',681,'zh'),('坚盾剑怪',681,'zh'),('ギルガルド',681,'ja'),('spritzee',682,'en'),
('粉香香',682,'zh'),('シュシュプ',682,'ja'),('aromatisse',683,'en'),('芳香精',683,'zh'),('フレフワン',683,'ja'),('swirlix',684,'en'),('綿綿泡芙',684,'zh'),('绵绵泡芙',684,'zh'),
('ペロッパフ',684,'ja'),('slurpuff',685,'en'),('胖甜妮',685,'zh'),('ペロリーム',685,'ja'),('inkay',686,'en'),('好啦魷',686,'zh'),('好啦鱿',686,'zh'),('マーイーカ',686,'ja'),
('malamar',687,'en'),('烏賊王',687,'zh'),('乌贼王',687,'zh'),('カラマネロ',687,'ja'),('binacle',688,'en'),('龜腳腳',688,'zh'),('龟脚脚',688,'zh'),('カメテテ',688,'ja'),
('barbaracle',689,'en'),('龜足巨鎧',689,'zh'),('龟足巨铠',689,'zh'),('ガメノデス',689,'ja'),('skrelp',690,'en'),('垃垃藻',690,'zh'),('クズモー',690,'ja'),('dragalge',691,'en'),
('毒藻龍',691,'zh'),('毒藻龙',691,'zh'),('ドラミドロ',691,'ja'),('clauncher',692,'en'),('鐵臂槍蝦',692,'zh'),('铁臂枪虾',692,'zh'),('ウデッポウ',692,'ja'),('clawitzer',693,'en'),
('鋼炮臂蝦',693,'zh'),('钢炮臂虾',693,'zh'),('ブロスター',693,'ja'),('helioptile',694,'en'),('傘電蜥',694,'zh'),('伞电蜥',694,'zh'),('エリキテル',694,'ja'),('heliolisk',695,'en'),
('光電傘蜥',695,'zh'),('光电伞蜥',695,'zh'),('エレザード',695,'ja'),('tyrunt',696,'en'),('寶寶暴龍',696,'zh'),('宝宝暴龙',696,'zh'),('チゴラス',696,'ja'),('tyrantrum',697,'en'),
('怪顎龍',697,'zh'),('怪颚龙',697,'zh'),('ガチゴラス',697,'ja'),('amaura',698,'en'),('冰雪龍',698,'zh'),('冰雪龙',698,'zh'),('アマルス',698,'ja'),('aurorus',699,'en'),
('冰雪巨龍',699,'zh'),('冰雪巨龙',699,'zh'),('アマルルガ',699,'ja'),('sylveon',700,'en'),('仙子伊布',700,'zh'),('ニンフィア',700,'ja'),('hawlucha',701,'en'),('摔角鷹人',701,'zh'),
('摔角鹰人',701,'zh'),('ルチャブル',701,'ja'),('dedenne',702,'en'),('咚咚鼠',702,'zh'),('デデンネ',702,'ja'),('carbink',703,'en'),('小碎鑽',703,'zh'),('小碎钻',703,'zh'),
('メレシー',703,'ja'),('goomy',704,'en'),('黏黏寶',704,'zh'),('黏黏宝',704,'zh'),('ヌメラ',704,'ja'),('sliggoo',705,'en'),('黏美兒',705,'zh'),('黏美儿',705,'zh'),('ヌメイル',705,'ja'),
('goodra',706,'en'),('黏美龍',706,'zh'),('黏美龙',706,'zh'),('ヌメルゴン',706,'ja'),('klefki',707,'en'),('鑰圈兒',707,'zh'),('钥圈儿',707,'zh'),('クレッフィ',707,'ja'),
('phantump',708,'en'),('小木靈',708,'zh'),('小木灵',708,'zh'),('ボクレー',708,'ja'),('trevenant',709,'en'),('朽木妖',709,'zh'),('オーロット',709,'ja'),('pumpkaboo',710,'en'),
('南瓜精',710,'zh'),('バケッチャ',710,'ja'),('gourgeist',711,'en'),('南瓜怪人',711,'zh'),('パンプジン',711,'ja'),('bergmite',712,'en'),('冰寶',712,'zh'),('冰宝',712,'zh'),
('カチコール',712,'ja'),('avalugg',713,'en'),('冰岩怪',713,'zh'),('クレベース',713,'ja'),('noibat',714,'en'),('嗡蝠',714,'zh'),('オンバット',714,'ja'),('noivern',715,'en'),
('音波龍',715,'zh'),('音波龙',715,'zh'),('オンバーン',715,'ja'),('xerneas',716,'en'),('哲爾尼亞斯',716,'zh'),('哲尔尼亚斯',716,'zh'),('ゼルネアス',716,'ja'),('yveltal',717,'en'),
('伊裴爾塔爾',717,'zh'),('伊裴尔塔尔',717,'zh'),('イベルタル',717,'ja'),('zygarde',718,'en'),('基格爾德',718,'zh'),('基格尔德',718,'zh'),('ジガルデ',718,'ja'),('diancie',719,'en'),
('蒂安希',719,'zh'),('ディアンシー',719,'ja'),('hoopa',720,'en'),('胡帕',720,'zh'),('フーパ',720,'ja'),('volcanion',721,'en'),('波爾凱尼恩',721,'zh'),('波尔凯尼恩',721,'zh'),
('ボルケニオン',721,'ja'),('rowlet',722,'en'),('木木梟',722,'zh'),('木木枭',722,'zh'),('モクロー',722,'ja'),('dartrix',723,'en'),('投羽梟',723,'zh'),('投羽枭',723,'zh'),
('フクスロー',723,'ja'),('decidueye',724,'en'),('狙射樹梟',724,'zh'),('狙射树枭',724,'zh'),('ジュナイパー',724,'ja'),('litten',725,'en'),('火斑喵',725,'zh'),('ニャビー',725,'ja'),
('torracat',726,'en'),('炎熱喵',726,'zh'),('炎热喵',726,'zh'),('ニャヒート',726,'ja'),('incineroar',727,'en'),('熾焰咆哮虎',727,'zh'),('炽焰咆哮虎',727,'zh'),('ガオガエン',727,'ja'),
('popplio',728,'en'),('球球海獅',728,'zh'),('球球海狮',728,'zh'),('アシマリ',728,'ja'),('brionne',729,'en'),('花漾海獅',729,'zh'),('花漾海狮',729,'zh'),('オシャマリ',729,'ja'),
('primarina',730,'en'),('西獅海壬',730,'zh'),('西狮海壬',730,'zh'),('アシレーヌ',730,'ja'),('pikipek',731,'en'),('小篤兒',731,'zh'),('小笃儿',731,'zh'),('ツツケラ',731,'ja'),
('trumbeak',732,'en'),('喇叭啄鳥',732,'zh'),('喇叭啄鸟',732,'zh'),('ケララッパ',732,'ja'),('toucannon',733,'en'),('銃嘴大鳥',733,'zh'),('铳嘴大鸟',733,'zh'),('ドデカバシ',733,'ja'),
('yungoos',734,'en'),('貓鼬少',734,'zh'),('猫鼬少',734,'zh'),('ヤングース',734,'ja'),('gumshoos',735,'en'),('貓鼬探長',735,'zh'),('猫鼬探长',735,'zh'),('デカグース',735,'ja'),
('grubbin',736,'en'),('強顎雞母蟲',736,'zh'),('强颚鸡母虫',736,'zh'),('アゴジムシ',736,'ja'),('charjabug',737,'en'),('蟲電寶',737,'zh'),('虫电宝',737,'zh'),('デンヂムシ',737,'ja'),
('vikavolt',738,'en'),('鍬農炮蟲',738,'zh'),('锹农炮虫',738,'zh'),('クワガノン',738,'ja'),('crabrawler',739,'en'),('好勝蟹',739,'zh'),('好胜蟹',739,'zh'),('マケンカニ',739,'ja'),
('crabominable',740,'en'),('好勝毛蟹',740,'zh'),('好胜毛蟹',740,'zh'),('ケケンカニ',740,'ja'),('oricorio',741,'en'),('花舞鳥',741,'zh'),('花舞鸟',741,'zh'),('オドリドリ',741,'ja'),
('cutiefly',742,'en'),('萌虻',742,'zh'),('アブリー',742,'ja'),('ribombee',743,'en'),('蝶結萌虻',743,'zh'),('蝶结萌虻',743,'zh'),('アブリボン',743,'ja'),('rockruff',744,'en'),
('岩狗狗',744,'zh'),('イワンコ',744,'ja'),('lycanroc',745,'en'),('鬃岩狼人',745,'zh'),('ルガルガン',745,'ja'),('wishiwashi',746,'en'),('弱丁魚',746,'zh'),('弱丁鱼',746,'zh'),
('ヨワシ',746,'ja'),('mareanie',747,'en'),('好壞星',747,'zh'),('好坏星',747,'zh'),('ヒドイデ',747,'ja'),('toxapex',748,'en'),('超壞星',748,'zh'),('超坏星',748,'zh'),
('ドヒドイデ',748,'ja'),('mudbray',749,'en'),('泥驢仔',749,'zh'),('泥驴仔',749,'zh'),('ドロバンコ',749,'ja'),('mudsdale',750,'en'),('重泥挽馬',750,'zh'),('重泥挽马',750,'zh'),
('バンバドロ',750,'ja'),('dewpider',751,'en'),('滴蛛',751,'zh'),('シズクモ',751,'ja'),('araquanid',752,'en'),('滴蛛霸',752,'zh'),('オニシズクモ',752,'ja'),('fomantis',753,'en'),
('偽螳草',753,'zh'),('伪螳草',753,'zh'),('カリキリ',753,'ja'),('lurantis',754,'en'),('蘭螳花',754,'zh'),('兰螳花',754,'zh'),('ラランテス',754,'ja'),('morelull',755,'en'),
('睡睡菇',755,'zh'),('ネマシュ',755,'ja'),('shiinotic',756,'en'),('燈罩夜菇',756,'zh'),('灯罩夜菇',756,'zh'),('マシェード',756,'ja'),('salandit',757,'en'),('夜盜火蜥',757,'zh'),
('夜盗火蜥',757,'zh'),('ヤトウモリ',757,'ja'),('salazzle',758,'en'),('焰后蜥',758,'zh'),('エンニュート',758,'ja'),('stufful',759,'en'),('童偶熊',759,'zh'),('ヌイコグマ',759,'ja'),
('bewear',760,'en'),('穿著熊',760,'zh'),('穿着熊',760,'zh'),('キテルグマ',760,'ja'),('bounsweet',761,'en'),('甜竹竹',761,'zh'),('アマカジ',761,'ja'),('steenee',762,'en'),
('甜舞妮',762,'zh'),('アママイコ',762,'ja'),('tsareena',763,'en'),('甜冷美后',763,'zh'),('アマージョ',763,'ja'),('comfey',764,'en'),('花療環環',764,'zh'),('花疗环环',764,'zh'),
('キュワワー',764,'ja'),('oranguru',765,'en'),('智揮猩',765,'zh'),('智挥猩',765,'zh'),('ヤレユータン',765,'ja'),('passimian',766,'en'),('投擲猴',766,'zh'),('投掷猴',766,'zh'),
('ナゲツケサル',766,'ja'),('wimpod',767,'en'),('膽小蟲',767,'zh'),('胆小虫',767,'zh'),('コソクムシ',767,'ja'),('golisopod',768,'en'),('具甲武者',768,'zh'),('グソクムシャ',768,'ja'),
('sandygast',769,'en'),('沙丘娃',769,'zh'),('スナバァ',769,'ja'),('palossand',770,'en'),('噬沙堡爺',770,'zh'),('噬沙堡爷',770,'zh'),('シロデスナ',770,'ja'),('pyukumuku',771,'en'),
('拳海參',771,'zh'),('拳海参',771,'zh'),('ナマコブシ',771,'ja'),('typenull',772,'en'),('屬性：空',772,'zh'),('属性：空',772,'zh'),('タイプ：ヌル',772,'ja'),('silvally',773,'en'),
('銀伴戰獸',773,'zh'),('银伴战兽',773,'zh'),('シルヴァディ',773,'ja'),('minior',774,'en'),('小隕星',774,'zh'),('小陨星',774,'zh'),('メテノ',774,'ja'),('komala',775,'en'),
('樹枕尾熊',775,'zh'),('树枕尾熊',775,'zh'),('ネッコアラ',775,'ja'),('turtonator',776,'en'),('爆焰龜獸',776,'zh'),('爆焰龟兽',776,'zh'),('バクガメス',776,'ja'),('togedemaru',777,'en'),
('托戈德瑪爾',777,'zh'),('托戈德玛尔',777,'zh'),('トゲデマル',777,'ja'),('mimikyu',778,'en'),('謎擬Ｑ',778,'zh'),('谜拟丘',778,'zh'),('ミミッキュ',778,'ja'),('bruxish',779,'en'),
('磨牙彩皮魚',779,'zh'),('磨牙彩皮鱼',779,'zh'),('ハギギシリ',779,'ja'),('drampa',780,'en'),('老翁龍',780,'zh'),('老翁龙',780,'zh'),('ジジーロン',780,'ja'),('dhelmise',781,'en'),
('破破舵輪',781,'zh'),('破破舵轮',781,'zh'),('ダダリン',781,'ja'),('jangmoo',782,'en'),('心鱗寶',782,'zh'),('心鳞宝',782,'zh'),('ジャラコ',782,'ja'),('hakamoo',783,'en'),
('鱗甲龍',783,'zh'),('鳞甲龙',783,'zh'),('ジャランゴ',783,'ja'),('kommoo',784,'en'),('杖尾鱗甲龍',784,'zh'),('杖尾鳞甲龙',784,'zh'),('ジャラランガ',784,'ja'),('tapukoko',785,'en'),
('卡璞・鳴鳴',785,'zh'),('卡璞・鸣鸣',785,'zh'),('カプ・コケコ',785,'ja'),('tapulele',786,'en'),('卡璞・蝶蝶',786,'zh'),('カプ・テテフ',786,'ja'),('tapubulu',787,'en'),('卡璞・哞哞',787,'zh'),
('カプ・ブルル',787,'ja'),('tapufini',788,'en'),('卡璞・鰭鰭',788,'zh'),('卡璞・鳍鳍',788,'zh'),('カプ・レヒレ',788,'ja'),('cosmog',789,'en'),('科斯莫古',789,'zh'),('コスモッグ',789,'ja'),
('cosmoem',790,'en'),('科斯莫姆',790,'zh'),('コスモウム',790,'ja'),('solgaleo',791,'en'),('索爾迦雷歐',791,'zh'),('索尔迦雷欧',791,'zh'),('ソルガレオ',791,'ja'),('lunala',792,'en'),
('露奈雅拉',792,'zh'),('ルナアーラ',792,'ja'),('nihilego',793,'en'),('虛吾伊德',793,'zh'),('虚吾伊德',793,'zh'),('ウツロイド',793,'ja'),('buzzwole',794,'en'),('爆肌蚊',794,'zh'),
('マッシブーン',794,'ja'),('pheromosa',795,'en'),('費洛美螂',795,'zh'),('费洛美螂',795,'zh'),('フェローチェ',795,'ja'),('xurkitree',796,'en'),('電束木',796,'zh'),('电束木',796,'zh'),
('デンジュモク',796,'ja'),('celesteela',797,'en'),('鐵火輝夜',797,'zh'),('铁火辉夜',797,'zh'),('テッカグヤ',797,'ja'),('kartana',798,'en'),('紙御劍',798,'zh'),('纸御剑',798,'zh'),
('カミツルギ',798,'ja'),('guzzlord',799,'en'),('惡食大王',799,'zh'),('恶食大王',799,'zh'),('アクジキング',799,'ja'),('necrozma',800,'en'),('奈克洛茲瑪',800,'zh'),('奈克洛兹玛',800,'zh'),
('ネクロズマ',800,'ja'),('magearna',801,'en'),('瑪機雅娜',801,'zh'),('玛机雅娜',801,'zh'),('マギアナ',801,'ja'),('marshadow',802,'en'),('瑪夏多',802,'zh'),('玛夏多',802,'zh'),
('マーシャドー',802,'ja'),('poipole',803,'en'),('毒貝比',803,'zh'),('毒贝比',803,'zh'),('ベベノム',803,'ja'),('naganadel',804,'en'),('四顎針龍',804,'zh'),('四颚针龙',804,'zh'),
('アーゴヨン',804,'ja'),('stakataka',805,'en'),('壘磊石',805,'zh'),('垒磊石',805,'zh'),('ツンデツンデ',805,'ja'),('blacephalon',806,'en'),('砰頭小丑',806,'zh'),('砰头小丑',806,'zh'),
('ズガドーン',806,'ja'),('zeraora',807,'en'),('捷拉奧拉',807,'zh'),('捷拉奥拉',807,'zh'),('ゼラオラ',807,'ja'),('meltan',808,'en'),('美錄坦',808,'zh'),('美录坦',808,'zh'),
('メルタン',808,'ja'),('melmetal',809,'en'),('美錄梅塔',809,'zh'),('美录梅塔',809,'zh'),('メルメタル',809,'ja'),('grookey',810,'en'),('敲音猴',810,'zh'),('サルノリ',810,'ja'),
('thwackey',811,'en'),('啪咚猴',811,'zh'),('バチンキー',811,'ja'),('rillaboom',812,'en'),('轟擂金剛猩',812,'zh'),('轰擂金刚猩',812,'zh'),('ゴリランダー',812,'ja'),('scorbunny',813,'en'),
('炎兔兒',813,'zh'),('炎兔儿',813,'zh'),('ヒバニー',813,'ja'),('raboot',814,'en'),('騰蹴小將',814,'zh'),('腾蹴小将',814,'zh'),('ラビフット',814,'ja'),('cinderace',815,'en'),
('閃焰王牌',815,'zh'),('闪焰王牌',815,'zh'),('エースバーン',815,'ja'),('sobble',816,'en'),('淚眼蜥',816,'zh'),('泪眼蜥',816,'zh'),('メッソン',816,'ja'),('drizzile',817,'en'),
('變澀蜥',817,'zh'),('变涩蜥',817,'zh'),('ジメレオン',817,'ja'),('inteleon',818,'en'),('千面避役',818,'zh'),('インテレオン',818,'ja'),('skwovet',819,'en'),('貪心栗鼠',819,'zh'),
('贪心栗鼠',819,'zh'),('ホシガリス',819,'ja'),('greedent',820,'en'),('藏飽栗鼠',820,'zh'),('藏饱栗鼠',820,'zh'),('ヨクバリス',820,'ja'),('rookidee',821,'en'),('稚山雀',821,'zh'),
('ココガラ',821,'ja'),('corvisquire',822,'en'),('藍鴉',822,'zh'),('蓝鸦',822,'zh'),('アオガラス',822,'ja'),('corviknight',823,'en'),('鋼鎧鴉',823,'zh'),('钢铠鸦',823,'zh'),
('アーマーガア',823,'ja'),('blipbug',824,'en'),('索偵蟲',824,'zh'),('索侦虫',824,'zh'),('サッチムシ',824,'ja'),('dottler',825,'en'),('天罩蟲',825,'zh'),('天罩虫',825,'zh'),
('レドームシ',825,'ja'),('orbeetle',826,'en'),('以歐路普',826,'zh'),('以欧路普',826,'zh'),('イオルブ',826,'ja'),('nickit',827,'en'),('偷兒狐',827,'zh'),('狡小狐',827,'zh'),
('クスネ',827,'ja'),('thievul',828,'en'),('狐大盜',828,'zh'),('猾大狐',828,'zh'),('フォクスライ',828,'ja'),('gossifleur',829,'en'),('幼棉棉',829,'zh'),('ヒメンカ',829,'ja'),
('eldegoss',830,'en'),('白蓬蓬',830,'zh'),('ワタシラガ',830,'ja'),('wooloo',831,'en'),('毛辮羊',831,'zh'),('毛辫羊',831,'zh'),('ウールー',831,'ja'),('dubwool',832,'en'),
('毛毛角羊',832,'zh'),('バイウールー',832,'ja'),('chewtle',833,'en'),('咬咬龜',833,'zh'),('咬咬龟',833,'zh'),('カムカメ',833,'ja'),('drednaw',834,'en'),('暴噬龜',834,'zh'),
('暴噬龟',834,'zh'),('カジリガメ',834,'ja'),('yamper',835,'en'),('來電汪',835,'zh'),('来电汪',835,'zh'),('ワンパチ',835,'ja'),('boltund',836,'en'),('逐電犬',836,'zh'),
('逐电犬',836,'zh'),('パルスワン',836,'ja'),('rolycoly',837,'en'),('小炭仔',837,'zh'),('タンドン',837,'ja'),('carkol',838,'en'),('大炭車',838,'zh'),('大炭车',838,'zh'),
('トロッゴン',838,'ja'),('coalossal',839,'en'),('巨炭山',839,'zh'),('セキタンザン',839,'ja'),('applin',840,'en'),('啃果蟲',840,'zh'),('啃果虫',840,'zh'),('カジッチュ',840,'ja'),
('flapple',841,'en'),('蘋裹龍',841,'zh'),('苹裹龙',841,'zh'),('アップリュー',841,'ja'),('appletun',842,'en'),('豐蜜龍',842,'zh'),('丰蜜龙',842,'zh'),('タルップル',842,'ja'),
('silicobra',843,'en'),('沙包蛇',843,'zh'),('スナヘビ',843,'ja'),('sandaconda',844,'en'),('沙螺蟒',844,'zh'),('サダイジャ',844,'ja'),('cramorant',845,'en'),('古月鳥',845,'zh'),
('古月鸟',845,'zh'),('ウッウ',845,'ja'),('arrokuda',846,'en'),('刺梭魚',846,'zh'),('刺梭鱼',846,'zh'),('サシカマス',846,'ja'),('barraskewda',847,'en'),('戽斗尖梭',847,'zh'),
('カマスジョー',847,'ja'),('toxel',848,'en'),('毒電嬰',848,'zh'),('电音婴',848,'zh'),('エレズン',848,'ja'),('toxtricity',849,'en'),('顫弦蠑螈',849,'zh'),('颤弦蝾螈',849,'zh'),
('ストリンダー',849,'ja'),('sizzlipede',850,'en'),('燒火蚣',850,'zh'),('烧火蚣',850,'zh'),('ヤクデ',850,'ja'),('centiskorch',851,'en'),('焚焰蚣',851,'zh'),('マルヤクデ',851,'ja'),
('clobbopus',852,'en'),('拳拳蛸',852,'zh'),('タタッコ',852,'ja'),('grapploct',853,'en'),('八爪武師',853,'zh'),('八爪武师',853,'zh'),('オトスパス',853,'ja'),('sinistea',854,'en'),
('來悲茶',854,'zh'),('来悲茶',854,'zh'),('ヤバチャ',854,'ja'),('polteageist',855,'en'),('怖思壺',855,'zh'),('怖思壶',855,'zh'),('ポットデス',855,'ja'),('hatenna',856,'en'),
('迷布莉姆',856,'zh'),('ミブリム',856,'ja'),('hattrem',857,'en'),('提布莉姆',857,'zh'),('テブリム',857,'ja'),('hatterene',858,'en'),('布莉姆溫',858,'zh'),('布莉姆温',858,'zh'),
('ブリムオン',858,'ja'),('impidimp',859,'en'),('搗蛋小妖',859,'zh'),('捣蛋小妖',859,'zh'),('ベロバー',859,'ja'),('morgrem',860,'en'),('詐唬魔',860,'zh'),('诈唬魔',860,'zh'),
('ギモー',860,'ja'),('grimmsnarl',861,'en'),('長毛巨魔',861,'zh'),('长毛巨魔',861,'zh'),('オーロンゲ',861,'ja'),('obstagoon',862,'en'),('堵攔熊',862,'zh'),('堵拦熊',862,'zh'),
('タチフサグマ',862,'ja'),('perrserker',863,'en'),('喵頭目',863,'zh'),('喵头目',863,'zh'),('ニャイキング',863,'ja'),('cursola',864,'en'),('魔靈珊瑚',864,'zh'),('魔灵珊瑚',864,'zh'),
('サニゴーン',864,'ja'),('sirfetchd',865,'en'),('蔥遊兵',865,'zh'),('葱游兵',865,'zh'),('ネギガナイト',865,'ja'),('mrrime',866,'en'),('踏冰人偶',866,'zh'),('バリコオル',866,'ja'),
('runerigus',867,'en'),('死神板',867,'zh'),('迭失板',867,'zh'),('デスバーン',867,'ja'),('milcery',868,'en'),('小仙奶',868,'zh'),('マホミル',868,'ja'),('alcremie',869,'en'),
('霜奶仙',869,'zh'),('マホイップ',869,'ja'),('falinks',870,'en'),('列陣兵',870,'zh'),('列阵兵',870,'zh'),('タイレーツ',870,'ja'),('pincurchin',871,'en'),('啪嚓海膽',871,'zh'),
('啪嚓海胆',871,'zh'),('バチンウニ',871,'ja'),('snom',872,'en'),('雪吞蟲',872,'zh'),('雪吞虫',872,'zh'),('ユキハミ',872,'ja'),('frosmoth',873,'en'),('雪絨蛾',873,'zh'),
('雪绒蛾',873,'zh'),('モスノウ',873,'ja'),('stonjourner',874,'en'),('巨石丁',874,'zh'),('イシヘンジン',874,'ja'),('eiscue',875,'en'),('冰砌鵝',875,'zh'),('冰砌鹅',875,'zh'),
('コオリッポ',875,'ja'),('indeedee',876,'en'),('愛管侍',876,'zh'),('爱管侍',876,'zh'),('イエッサン',876,'ja'),('morpeko',877,'en'),('莫魯貝可',877,'zh'),('莫鲁贝可',877,'zh'),
('モルペコ',877,'ja'),('cufant',878,'en'),('銅象',878,'zh'),('铜象',878,'zh'),('ゾウドウ',878,'ja'),('copperajah',879,'en'),('大王銅象',879,'zh'),('大王铜象',879,'zh'),
('ダイオウドウ',879,'ja'),('dracozolt',880,'en'),('雷鳥龍',880,'zh'),('雷鸟龙',880,'zh'),('パッチラゴン',880,'ja'),('arctozolt',881,'en'),('雷鳥海獸',881,'zh'),('雷鸟海兽',881,'zh'),
('パッチルドン',881,'ja'),('dracovish',882,'en'),('鰓魚龍',882,'zh'),('鳃鱼龙',882,'zh'),('ウオノラゴン',882,'ja'),('arctovish',883,'en'),('鰓魚海獸',883,'zh'),('鳃鱼海兽',883,'zh'),
('ウオチルドン',883,'ja'),('duraludon',884,'en'),('鋁鋼龍',884,'zh'),('铝钢龙',884,'zh'),('ジュラルドン',884,'ja'),('dreepy',885,'en'),('多龍梅西亞',885,'zh'),('多龙梅西亚',885,'zh'),
('ドラメシヤ',885,'ja'),('drakloak',886,'en'),('多龍奇',886,'zh'),('多龙奇',886,'zh'),('ドロンチ',886,'ja'),('dragapult',887,'en'),('多龍巴魯托',887,'zh'),('多龙巴鲁托',887,'zh'),
('ドラパルト',887,'ja'),('zacian',888,'en'),('蒼響',888,'zh'),('苍响',888,'zh'),('ザシアン',888,'ja'),('zamazenta',889,'en'),('藏瑪然特',889,'zh'),('藏玛然特',889,'zh'),
('ザマゼンタ',889,'ja'),('eternatus',890,'en'),('無極汰那',890,'zh'),('无极汰那',890,'zh'),('ムゲンダイナ',890,'ja'),('kubfu',891,'en'),('熊徒弟',891,'zh'),('ダクマ',891,'ja'),
('urshifu',892,'en'),('武道熊師',892,'zh'),('武道熊师',892,'zh'),('ウーラオス',892,'ja'),('zarude',893,'en'),('薩戮德',893,'zh'),('萨戮德',893,'zh'),('ザルード',893,'ja'),
('regieleki',894,'en'),('雷吉艾勒奇',894,'zh'),('レジエレキ',894,'ja'),('regidrago',895,'en'),('雷吉鐸拉戈',895,'zh'),('雷吉铎拉戈',895,'zh'),('レジドラゴ',895,'ja'),
('glastrier',896,'en'),('雪暴馬',896,'zh'),('雪暴马',896,'zh'),('ブリザポス',896,'ja'),('spectrier',897,'en'),('靈幽馬',897,'zh'),('灵幽马',897,'zh'),('レイスポス',897,'ja'),
('calyrex',898,'en'),('蕾冠王',898,'zh'),('バドレックス',898,'ja'),('wyrdeer',899,'en'),('詭角鹿',899,'zh'),('诡角鹿',899,'zh'),('アヤシシ',899,'ja'),('kleavor',900,'en'),
('劈斧螳螂',900,'zh'),('バサギリ',900,'ja'),('ursaluna',901,'en'),('月月熊',901,'zh'),('ガチグマ',901,'ja'),('basculegion',902,'en'),('幽尾玄魚',902,'zh'),('幽尾玄鱼',902,'zh'),
('イダイトウ',902,'ja'),('sneasler',903,'en'),('大狃拉',903,'zh'),('オオニューラ',903,'ja'),('overqwil',904,'en'),('萬針魚',904,'zh'),('万针鱼',904,'zh'),('ハリーマン',904,'ja'),
('enamorus',905,'en'),('眷戀雲',905,'zh'),('眷恋云',905,'zh'),('ラブトロス',905,'ja'),('sprigatito',906,'en'),('新葉喵',906,'zh'),('新叶喵',906,'zh'),('ニャオハ',906,'ja'),
('floragato',907,'en'),('蒂蕾喵',907,'zh'),('ニャローテ',907,'ja'),('meowscarada',908,'en'),('魔幻假面喵',908,'zh'),('マスカーニャ',908,'ja'),('fuecoco',909,'en'),('呆火鱷',909,'zh'),
('呆火鳄',909,'zh'),('ホゲータ',909,'ja'),('crocalor',910,'en'),('炙燙鱷',910,'zh'),('炙烫鳄',910,'zh'),('アチゲータ',910,'ja'),('skeledirge',911,'en'),('骨紋巨聲鱷',911,'zh'),
('骨纹巨声鳄',911,'zh'),('ラウドボーン',911,'ja'),('quaxly',912,'en'),('潤水鴨',912,'zh'),('润水鸭',912,'zh'),('クワッス',912,'ja'),('quaxwell',913,'en'),('湧躍鴨',913,'zh'),
('涌跃鸭',913,'zh'),('ウェルカモ',913,'ja'),('quaquaval',914,'en'),('狂歡浪舞鴨',914,'zh'),('狂欢浪舞鸭',914,'zh'),('ウェーニバル',914,'ja'),('lechonk',915,'en'),('愛吃豚',915,'zh'),
('爱吃豚',915,'zh'),('グルトン',915,'ja'),('oinkologne',916,'en'),('飄香豚',916,'zh'),('飘香豚',916,'zh'),('パフュートン',916,'ja'),('tarountula',917,'en'),('團珠蛛',917,'zh'),
('团珠蛛',917,'zh'),('タマンチュラ',917,'ja'),('spidops',918,'en'),('操陷蛛',918,'zh'),('ワナイダー',918,'ja'),('nymble',919,'en'),('豆蟋蟀',919,'zh'),('マメバッタ',919,'ja'),
('lokix',920,'en'),('烈腿蝗',920,'zh'),('エクスレッグ',920,'ja'),('pawmi',921,'en'),('布撥',921,'zh'),('布拨',921,'zh'),('パモ',921,'ja'),('pawmo',922,'en'),('布土撥',922,'zh'),
('布土拨',922,'zh'),('パモット',922,'ja'),('pawmot',923,'en'),('巴布土撥',923,'zh'),('巴布土拨',923,'zh'),('パーモット',923,'ja'),('tandemaus',924,'en'),('一對鼠',924,'zh'),
('一对鼠',924,'zh'),('ワッカネズミ',924,'ja'),('maushold',925,'en'),('一家鼠',925,'zh'),('イッカネズミ',925,'ja'),('fidough',926,'en'),('狗仔包',926,'zh'),('パピモッチ',926,'ja'),
('dachsbun',927,'en'),('麻花犬',927,'zh'),('バウッツェル',927,'ja'),('smoliv',928,'en'),('迷你芙',928,'zh'),('ミニーブ',928,'ja'),('dolliv',929,'en'),('奧利紐',929,'zh'),
('奥利纽',929,'zh'),('オリーニョ',929,'ja'),('arboliva',930,'en'),('奧利瓦',930,'zh'),('奥利瓦',930,'zh'),('オリーヴァ',930,'ja'),('squawkabilly',931,'en'),('怒鸚哥',931,'zh'),
('怒鹦哥',931,'zh'),('イキリンコ',931,'ja'),('nacli',932,'en'),('鹽石寶',932,'zh'),('盐石宝',932,'zh'),('コジオ',932,'ja'),('naclstack',933,'en'),('鹽石壘',933,'zh'),
('盐石垒',933,'zh'),('ジオヅム',933,'ja'),('garganacl',934,'en'),('鹽石巨靈',934,'zh'),('盐石巨灵',934,'zh'),('キョジオーン',934,'ja'),('charcadet',935,'en'),('炭小侍',935,'zh'),
('カルボウ',935,'ja'),('armarouge',936,'en'),('紅蓮鎧騎',936,'zh'),('红莲铠骑',936,'zh'),('グレンアルマ',936,'ja'),('ceruledge',937,'en'),('蒼炎刃鬼',937,'zh'),('苍炎刃鬼',937,'zh'),
('ソウブレイズ',937,'ja'),('tadbulb',938,'en'),('光蚪仔',938,'zh'),('ズピカ',938,'ja'),('bellibolt',939,'en'),('電肚蛙',939,'zh'),('电肚蛙',939,'zh'),('ハラバリー',939,'ja'),
('wattrel',940,'en'),('電海燕',940,'zh'),('电海燕',940,'zh'),('カイデン',940,'ja'),('kilowattrel',941,'en'),('大電海燕',941,'zh'),('大电海燕',941,'zh'),('タイカイデン',941,'ja'),
('maschiff',942,'en'),('偶叫獒',942,'zh'),('オラチフ',942,'ja'),('mabosstiff',943,'en'),('獒教父',943,'zh'),('マフィティフ',943,'ja'),('shroodle',944,'en'),('滋汁鼴',944,'zh'),
('滋汁鼹',944,'zh'),('シルシュルー',944,'ja'),('grafaiai',945,'en'),('塗標客',945,'zh'),('涂标客',945,'zh'),('タギングル',945,'ja'),('bramblin',946,'en'),('納噬草',946,'zh'),
('纳噬草',946,'zh'),('アノクサ',946,'ja'),('brambleghast',947,'en'),('怖納噬草',947,'zh'),('怖纳噬草',947,'zh'),('アノホラグサ',947,'ja'),('toedscool',948,'en'),('原野水母',948,'zh'),
('ノノクラゲ',948,'ja'),('toedscruel',949,'en'),('陸地水母',949,'zh'),('陆地水母',949,'zh'),('リククラゲ',949,'ja'),('klawf',950,'en'),('毛崖蟹',950,'zh'),('ガケガニ',950,'ja'),
('capsakid',951,'en'),('熱辣娃',951,'zh'),('热辣娃',951,'zh'),('カプサイジ',951,'ja'),('scovillain',952,'en'),('狠辣椒',952,'zh'),('スコヴィラン',952,'ja'),('rellor',953,'en'),
('蟲滾泥',953,'zh'),('虫滚泥',953,'zh'),('シガロコ',953,'ja'),('rabsca',954,'en'),('蟲甲聖',954,'zh'),('虫甲圣',954,'zh'),('ベラカス',954,'ja'),('flittle',955,'en'),('飄飄雛',955,'zh'),
('飘飘雏',955,'zh'),('ヒラヒナ',955,'ja'),('espathra',956,'en'),('超能艷鴕',956,'zh'),('超能艳鸵',956,'zh'),('クエスパトラ',956,'ja'),('tinkatink',957,'en'),('小鍛匠',957,'zh'),
('小锻匠',957,'zh'),('カヌチャン',957,'ja'),('tinkatuff',958,'en'),('巧鍛匠',958,'zh'),('巧锻匠',958,'zh'),('ナカヌチャン',958,'ja'),('tinkaton',959,'en'),('巨鍛匠',959,'zh'),
('巨锻匠',959,'zh'),('デカヌチャン',959,'ja'),('wiglett',960,'en'),('海地鼠',960,'zh'),('ウミディグダ',960,'ja'),('wugtrio',961,'en'),('三海地鼠',961,'zh'),('ウミトリオ',961,'ja'),
('bombirdier',962,'en'),('下石鳥',962,'zh'),('下石鸟',962,'zh'),('オトシドリ',962,'ja'),('finizen',963,'en'),('波普海豚',963,'zh'),('ナミイルカ',963,'ja'),('palafin',964,'en'),
('海豚俠',964,'zh'),('海豚侠',964,'zh'),('イルカマン',964,'ja'),('varoom',965,'en'),('噗隆隆',965,'zh'),('ブロロン',965,'ja'),('revavroom',966,'en'),('普隆隆姆',966,'zh'),
('ブロロローム',966,'ja'),('cyclizar',967,'en'),('摩托蜥',967,'zh'),('モトトカゲ',967,'ja'),('orthworm',968,'en'),('拖拖蚓',968,'zh'),('ミミズズ',968,'ja'),('glimmet',969,'en'),
('晶光芽',969,'zh'),('キラーメ',969,'ja'),('glimmora',970,'en'),('晶光花',970,'zh'),('キラフロル',970,'ja'),('greavard',971,'en'),('墓仔狗',971,'zh'),('ボチ',971,'ja'),
('houndstone',972,'en'),('墓揚犬',972,'zh'),('墓扬犬',972,'zh'),('ハカドッグ',972,'ja'),('flamigo',973,'en'),('纏紅鶴',973,'zh'),('纏红鹤',973,'zh'),('カラミンゴ',973,'ja'),
('cetoddle',974,'en'),('走鯨',974,'zh'),('走鲸',974,'zh'),('アルクジラ',974,'ja'),('cetitan',975,'en'),('浩大鯨',975,'zh'),('浩大鲸',975,'zh'),('ハルクジラ',975,'ja'),
('veluza',976,'en'),('輕身鱈',976,'zh'),('轻身鳕',976,'zh'),('ミガルーサ',976,'ja'),('dondozo',977,'en'),('吃吼霸',977,'zh'),('ヘイラッシャ',977,'ja'),('tatsugiri',978,'en'),
('米立龍',978,'zh'),('米立龙',978,'zh'),('シャリタツ',978,'ja'),('annihilape',979,'en'),('棄世猴',979,'zh'),('弃世猴',979,'zh'),('コノヨザル',979,'ja'),('clodsire',980,'en'),
('土王',980,'zh'),('ドオー',980,'ja'),('farigiraf',981,'en'),('奇麒麟',981,'zh'),('リキキリン',981,'ja'),('dudunsparce',982,'en'),('土龍節節',982,'zh'),('土龙节节',982,'zh'),
('ノココッチ',982,'ja'),('kingambit',983,'en'),('仆刀將軍',983,'zh'),('仆刀将军',983,'zh'),('ドドゲザン',983,'ja'),('greattusk',984,'en'),('雄偉牙',984,'zh'),('雄伟牙',984,'zh'),
('イダイナキバ',984,'ja'),('screamtail',985,'en'),('吼叫尾',985,'zh'),('サケブシッポ',985,'ja'),('brutebonnet',986,'en'),('猛惡菇',986,'zh'),('猛恶菇',986,'zh'),('アラブルタケ',986,'ja'),
('fluttermane',987,'en'),('振翼髮',987,'zh'),('振翼发',987,'zh'),('ハバタクカミ',987,'ja'),('slitherwing',988,'en'),('爬地翅',988,'zh'),('チヲハウハネ',988,'ja'),
('sandyshocks',989,'en'),('沙鐵皮',989,'zh'),('沙铁皮',989,'zh'),('スナノケガワ',989,'ja'),('irontreads',990,'en'),('鐵轍跡',990,'zh'),('铁轍迹',990,'zh'),('テツノワダチ',990,'ja'),
('ironbundle',991,'en'),('鐵包袱',991,'zh'),('铁包袱',991,'zh'),('テツノツツミ',991,'ja'),('ironhands',992,'en'),('鐵臂膀',992,'zh'),('铁臂膀',992,'zh'),('テツノカイナ',992,'ja'),
('ironjugulis',993,'en'),('鐵脖頸',993,'zh'),('铁脖颈',993,'zh'),('テツノコウベ',993,'ja'),('ironmoth',994,'en'),('鐵毒蛾',994,'zh'),('铁毒蛾',994,'zh'),('テツノドクガ',994,'ja'),
('ironthorns',995,'en'),('鐵荊棘',995,'zh'),('铁荆棘',995,'zh'),('テツノイバラ',995,'ja'),('frigibax',996,'en'),('涼脊龍',996,'zh'),('凉脊龙',996,'zh'),('セビエ',996,'ja'),
('arctibax',997,'en'),('凍脊龍',997,'zh'),('冻脊龙',997,'zh'),('セゴール',997,'ja'),('baxcalibur',998,'en'),('戟脊龍',998,'zh'),('戟脊龙',998,'zh'),('セグレイブ',998,'ja'),
('gimmighoul',999,'en'),('索財靈',999,'zh'),('索财灵',999,'zh'),('コレクレー',999,'ja'),('gholdengo',1000,'en'),('賽富豪',1000,'zh'),('赛富豪',1000,'zh'),('サーフゴー',1000,'ja'),
('wochien',1001,'en'),('古簡蝸',1001,'zh'),('古简蜗',1001,'zh'),('チオンジェン',1001,'ja'),('chienpao',1002,'en'),('古劍豹',1002,'zh'),('古剑豹',1002,'zh'),('パオジアン',1002,'ja'),
('tinglu',1003,'en'),('古鼎鹿',1003,'zh'),('ディンルー',1003,'ja'),('chiyu',1004,'en'),('古玉魚',1004,'zh'),('古玉鱼',1004,'zh'),('イーユイ',1004,'ja'),('roaringmoon',1005,'en'),
('轟鳴月',1005,'zh'),('轰鸣月',1005,'zh'),('トドロクツキ',1005,'ja'),('ironvaliant',1006,'en'),('鐵武者',1006,'zh'),('铁武者',1006,'zh'),('テツノブジン',1006,'ja'),
('koraidon',1007,'en'),('故勒頓',1007,'zh'),('故勒顿',1007,'zh'),('コライドン',1007,'ja'),('miraidon',1008,'en'),('密勒頓',1008,'zh'),('密勒顿',1008,'zh'),('ミライドン',1008,'ja'),
('walkingwake',1009,'en'),('波盪水',1009,'zh'),('波荡水',1009,'zh'),('ウネルミナモ',1009,'ja'),('ironleaves',1010,'en'),('鐵斑葉',1010,'zh'),('铁斑叶',1010,'zh'),
('テツノイサハ',1010,'ja'),('dipplin',1011,'en'),('裹蜜蟲',1011,'zh'),('裹蜜虫',1011,'zh'),('カミッチュ',1011,'ja'),('poltchageist',1012,'en'),('斯魔茶',1012,'zh'),
('チャデス',1012,'ja'),('sinistcha',1013,'en'),('來悲粗茶',1013,'zh'),('来悲粗茶',1013,'zh'),('ヤバソチャ',1013,'ja'),('okidogi',1014,'en'),('夠讚狗',1014,'zh'),('够赞狗',1014,'zh'),
('イイネイヌ',1014,'ja'),('munkidori',1015,'en'),('願增猿',1015,'zh'),('愿增猿',1015,'zh'),('マシマシラ',1015,'ja'),('fezandipiti',1016,'en'),('吉雉雞',1016,'zh'),('吉雉鸡',1016,'zh'),
('キチキギス',1016,'ja'),('ogerpon',1017,'en'),('厄鬼椪',1017,'zh'),('厄诡椪',1017,'zh'),('オーガポン',1017,'ja'),('archaludon',1018,'en'),('鋁鋼橋龍',1018,'zh'),('铝钢桥龙',1018,'zh'),
('ブリジュラス',1018,'ja'),('hydrapple',1019,'en'),('蜜集大蛇',1019,'zh'),('カミツオロチ',1019,'ja'),('gougingfire',1020,'en'),('破空焰',1020,'zh'),('ウガツホムラ',1020,'ja'),
('ragingbolt',1021,'en'),('猛雷鼓',1021,'zh'),('タケルライコ',1021,'ja'),('ironboulder',1022,'en'),('鐵磐岩',1022,'zh'),('铁磐岩',1022,'zh'),('テツノイワオ',1022,'ja'),
('ironcrown',1023,'en'),('鐵頭殼',1023,'zh'),('铁头壳',1023,'zh'),('テツノカシラ',1023,'ja'),('terapagos',1024,'en'),('太樂巴戈斯',1024,'zh'),('太乐巴戈斯',1024,'zh'),
('テラパゴス',1024,'ja'),('pecharunt',1025,'en'),('桃歹郎',1025,'zh'),('モモワロウ',1025,'ja')
on conflict (key) do update set dex = excluded.dex, kind = excluded.kind;
-- species:end

-- ----- Sementes de lookup_overrides -----

-- o app espelha estas linhas em src/lib/collector.ts (PROMO_GROUP_YEARS, YEAR_MIXED_GROUPS); o teste collector-years confere.

-- Coleções "de tudo um pouco": a data da coleção não é a da carta.
insert into public.lookup_overrides (kind, key, value, note)
select 'year_mixed', g.group_id::text, null, 'Coleção de tudo um pouco: ' || g.name
from public.tcg_groups g
where g.category = 3 and g.name in (
  'World Championship Decks', 'Prize Pack Series Cards', 'Miscellaneous Cards & Products', 'Deck Exclusives',
  'League & Championship Cards', 'Jumbo Cards', 'Blister Exclusives', 'Professor Program Promos', 'Alternate Art Promos')
on conflict (kind, key) do update set value = excluded.value, note = excluded.note;

-- Séries abertas de promos: a fonte não data cada carta. Fim vazio = até o ano atual.
insert into public.lookup_overrides (kind, key, value, note)
select 'year_range', g.group_id::text, v.years, 'Série aberta de promos: ' || g.name
from (values
  (3, 'WoTC Promo', '1999-2003'),
  (3, 'Diamond and Pearl Promos', '2007-2010'),
  (3, 'HGSS Promos', '2010-2011'),
  (3, 'Black and White Promos', '2011-2013'),
  (3, 'XY Promos', '2013-2016'),
  (3, 'SM Promos', '2016-2019'),
  (3, 'SWSH: Sword & Shield Promo Cards', '2019-2023'),
  (3, 'SV: Scarlet & Violet Promo Cards', '2023-2025'),
  (3, 'ME: Mega Evolution Promo', '2025-'),
  (85, 'ADV-P Promotional cards', '2003-2004'),
  (85, 'PCG-P Promotional cards', '2004-2006'),
  (85, 'DP-P Promotional cards', '2006-2008'),
  (85, 'DPt-P Promotional cards', '2008-2009'),
  (85, 'L-P: Legends Promos', '2009-2010'),
  (85, 'BW-P Promotional cards', '2010-2013'),
  (85, 'XY-P: XY Promos', '2013-2016'),
  (85, 'SM-P: Sun & Moon Promos', '2016-2019'),
  (85, 'S-P: Sword & Shield Promos', '2019-2022'),
  (85, 'SV-P Promotional Cards', '2022-2025'),
  (85, 'M-P Promotional Cards', '2025-')
) as v(category, name, years)
join public.tcg_groups g on g.category = v.category and g.name = v.name
on conflict (kind, key) do update set value = excluded.value, note = excluded.note;

-- "Japanese CD Promo" (grupo 24568 da 85, sem número impresso): o TCGCSV data de 2025-12-01, mas as cartas são de
-- 1998–1999 (migração 20261109c_cd_promo; o app corrige o mesmo em src/lib/tcgdex.ts, GROUP_YEARS).
insert into public.lookup_overrides (kind, key, value, note)
select 'year_range', g.group_id::text, '1998-1999', 'Data errada no TCGCSV (2025-12-01): ' || g.name || ' é de 1998–1999.'
from public.tcg_groups g
where g.category = 85 and g.group_id = 24568
on conflict (kind, key) do update set value = excluded.value, note = excluded.note;

insert into public.lookup_overrides (kind, key, value, note) values
  ('twin_block', 'SM7a', null, 'A coleção coreana tem total diferente: a japonesa não é gêmea dela.'),
  ('twin_block', 'SM10b', null, 'A coleção coreana tem total diferente: a japonesa não é gêmea dela.'),
  ('dex', 'Dark Exeggcutor', '103', 'Grafia errada na TCGplayer (o certo é Exeggutor).')
on conflict (kind, key) do update set value = excluded.value, note = excluded.note;

-- ----- O índice -----

-- Monta o texto do índice (formato 1: 1ª linha JSON, seções @dex, colunas por TAB; quem lê é src/lib/lookup-format.ts) e
-- grava só se o md5 mudou. Sem security definer: quem chama é o cron, que roda como dono da função. Tabelas temporárias, um insert por fonte, cada passo conferível sozinho.
-- Devolve 'novo' ou 'sem mudança'. Índice ruim (poucas linhas, queda brusca) levanta erro e a versão no ar fica.
create or replace function public.lookup_build()
returns text
language plpgsql
set search_path = ''
as $lookup$
declare
  v_prices date;
  v_only jsonb;
  v_limits jsonb;
  v_header text;
  v_sections text;
  v_body text;
  v_md5 text;
  v_lines integer;
  v_hp numeric;
  v_meta jsonb;
  v_unknown jsonb;
  v_twins jsonb;
  v_old record;
begin
  -- ----- Fontes -----

  -- Coleções do TCG Pocket: fora em todos os idiomas.
  create temp table lk_tcgp on commit drop as
    select s.key as id
    from public.tcgdex_lang l cross join lateral jsonb_each(l.sets) s
    where l.lang = 'tcgp';

  create temp table lk_td_set on commit drop as
    select l.lang, s.key as id, s.value->>'name' as name,
      nullif(nullif(s.value->>'official', '')::integer, 0) as official, -- promos: 0 na fonte
      nullif(s.value->>'date', '')::date as date
    from public.tcgdex_lang l cross join lateral jsonb_each(l.sets) s
    where l.lang <> 'tcgp' and not exists (select 1 from lk_tcgp t where t.id = s.key);

  -- num: número normalizado, para comparar ("001" e "1"; "TG05" e "tg5").
  create temp table lk_td_card on commit drop as
    select l.lang, x.id, regexp_replace(x.id, '-[^-]*$', '') as set_id, x."localId" as local_id, x.name, x.image,
      regexp_replace(lower(btrim(x."localId")), '^([a-z]*)0+(?=[0-9])', '\1') as num
    from public.tcgdex_lang l cross join lateral jsonb_to_recordset(l.cards) as x(id text, "localId" text, name text, image text)
    where l.lang <> 'tcgp' and not exists (select 1 from lk_tcgp t where t.id = regexp_replace(x.id, '-[^-]*$', ''));
  analyze lk_td_card;

  create temp table lk_en_card on commit drop as
    select s.id as set_id, x.id, x."localId" as local_id, x.name
    from public.tcgdex_sets s cross join lateral jsonb_to_recordset(s.cards) as x(id text, "localId" text, name text)
    where jsonb_typeof(s.cards) = 'array' and not exists (select 1 from lk_tcgp t where t.id = s.id);

  -- Uma linha por produto, com o número exibido (passo 4 da especificação) e o complemento q (passo 5).
  create temp table lk_base on commit drop as
    select b.*,
      -- Tira os zeros só quando a TCGdex prova que a carta não os tem ("004/102" e base1-4 → "4/102").
      case when lower(ltrim(split_part(b.no_raw, '/', 1), '0')) = lower(b.td_local) and b.no_raw ~ '^0+[0-9]'
        then regexp_replace(b.no_raw, '^0+(?=[0-9])', '') else b.no_raw end as no,
      regexp_replace(lower(btrim(split_part(b.no_raw, '/', 1))), '^([a-z]*)0+(?=[0-9])', '\1') as num,
      -- Segunda chave: outro N/T no nome do produto ("Pikachu - 291/SV-P" com o campo 120/SV-P).
      case when regexp_replace(lower(split_part(b.alt_raw, '/', 1)), '^([a-z]*)0+(?=[0-9])', '\1')
             <> regexp_replace(lower(btrim(split_part(b.no_raw, '/', 1))), '^([a-z]*)0+(?=[0-9])', '\1')
        then b.alt_raw end as alt,
      (select string_agg(m.q, ' · ' order by m.ord)
        from (select btrim(r[1]) as q, ord from regexp_matches(b.full_name, '[(\[]([^)\]]+)[)\]]', 'g') with ordinality as t(r, ord)) m
        where m.q !~ '^[0-9]+$'
          and position(lower(m.q) in lower(b.name)) = 0
          and position(lower(m.q) in lower(coalesce(b.stamp, ''))) = 0) as q
    from (
      select c.product_id, c.category, c.group_id, c.name, c.full_name, c.name_plain, c.rarity, c.stamp, c.tcgdex_id,
        c.hp, c.card_type, c.stage,
        g.name as group_name, nullif(g.abbr, '') as abbr, g.published_on,
        case when c.tcgdex_id is not null then regexp_replace(c.tcgdex_id, '-[^-]*$', '') end as td_set,
        case when c.tcgdex_id is not null then substring(c.tcgdex_id from '[^-]*$') end as td_local,
        btrim(regexp_replace(coalesce(c.number, ''), '\s*[(\[][^)\]]*[)\]]', '', 'g')) as no_raw,
        substring(c.full_name from ' - ([^ ()\[\]]*[0-9][^ ()\[\]]*/[^ ()\[\]]+)') as alt_raw
      from public.tcg_catalog c join public.tcg_groups g using (group_id)
    ) b;
  analyze lk_base;

  -- ----- Passo 2: preços, em centavos de dólar -----

  create temp table lk_print on commit drop as
    select * from (values
      ('Normal', 'N', 1), ('Holofoil', 'H', 2), ('Reverse Holofoil', 'R', 3), ('1st Edition', '1', 4),
      ('1st Edition Holofoil', '1H', 5), ('Unlimited', 'U', 6), ('Unlimited Holofoil', 'UH', 7)
    ) as v(sub_type, code, ord);

  create temp table lk_price on commit drop as
    select p.product_id,
      string_agg(v.code || ':' || coalesce(round(p.low * 100)::text, '') || ':' || coalesce(round(p.mid * 100)::text, '') || ':' || coalesce(round(p.market * 100)::text, ''),
        '|' order by v.ord) as prices
    from public.tcg_prices p join lk_print v using (sub_type)
    where p.low is not null or p.mid is not null or p.market is not null
    group by p.product_id;

  select coalesce(jsonb_object_agg(x.sub_type, x.n), '{}') into v_unknown
  from (
    select p.sub_type, count(*) as n
    from public.tcg_prices p
    where not exists (select 1 from lk_print v where v.sub_type = p.sub_type)
    group by p.sub_type
  ) x;

  select max((built_at at time zone 'UTC')::date) into v_prices from public.tcg_prices;

  -- ----- Passo 3: coleções -----

  create temp table lk_set (
    key text primary key, lang text not null, name text not null, abbr text not null default '',
    date date, total integer, total_text text, y_from integer, y_to integer, price_day date
  ) on commit drop;

  insert into lk_set (key, lang, name, abbr, date, total, total_text, y_from, y_to, price_day)
  with stats as (
    select b.group_id,
      mode() within group (order by nullif(split_part(b.no, '/', 2), '') collate "C") as total_text,
      min(s.release_date) as td_date
    from lk_base b left join public.tcgdex_sets s on s.id = b.td_set
    group by b.group_id
  ), day as (
    select p.group_id, max((p.built_at at time zone 'UTC')::date) as price_day from public.tcg_prices p group by p.group_id
  )
  select g.group_id::text,
    case g.category when 3 then 'en' else 'ja' end,
    g.name, coalesce(g.abbr, ''),
    case
      when y.y is not null and (g.published_on is null or extract(year from g.published_on)::integer <> y.y) then make_date(y.y, 1, 1)
      when g.published_on is not null then g.published_on
      else st.td_date
    end,
    case when st.total_text ~ '^[0-9]+$' then ltrim(st.total_text, '0')::integer end,
    st.total_text,
    case when o.value is not null then split_part(o.value, '-', 1)::integer end,
    case when o.value is not null then coalesce(nullif(split_part(o.value, '-', 2), '')::integer, 0) end,
    d.price_day
  from public.tcg_groups g
  join stats st using (group_id)
  left join day d using (group_id)
  left join public.lookup_overrides o on o.kind = 'year_range' and o.key = g.group_id::text
  cross join lateral (select substring(g.name from '((?:19|20)[0-9]{2})$')::integer as y) y;

  -- ----- Passo 7: línguas de cada produto -----

  create temp table lk_mark (product_id integer not null, mark text not null) on commit drop;

  -- p: a TCGdex pt tem a carta; uma por tcgdex_id, a Shadowless por último.
  insert into lk_mark
  select x.product_id, 'p'
  from (
    select b.product_id, row_number() over (partition by b.tcgdex_id order by (b.group_name ~* 'shadowless'), b.published_on nulls last, b.product_id) as n
    from lk_base b
    where b.category = 3 and b.stamp is null and exists (select 1 from lk_td_card c where c.lang = 'pt' and c.id = b.tcgdex_id)
  ) x
  where x.n = 1;

  -- u: a coleção existe em PT, a carta não está na lista. Também uma por tcgdex_id, a Shadowless por último.
  insert into lk_mark
  select x.product_id, 'u'
  from (
    select b.product_id, row_number() over (partition by b.tcgdex_id order by (b.group_name ~* 'shadowless'), b.published_on nulls last, b.product_id) as n
    from lk_base b
    where b.category = 3 and b.stamp is null
      and exists (select 1 from lk_td_set s where s.lang = 'pt' and s.id = b.td_set)
      and not exists (select 1 from lk_td_card c where c.lang = 'pt' and c.id = b.tcgdex_id)
  ) x
  where x.n = 1;

  -- u: padrão Poké Ball e Master Ball de uma carta que tem p.
  insert into lk_mark
  select b.product_id, 'u'
  from lk_base b
  where b.category = 3 and b.stamp ~* '^(pok[eé] ?ball|master ?ball)'
    and b.tcgdex_id in (select p.tcgdex_id from lk_base p join lk_mark m on m.product_id = p.product_id and m.mark = 'p');

  -- k: gêmea japonesa de uma carta real da lista coreana.
  insert into lk_mark
  select distinct b.product_id, 'k'
  from lk_base b join lk_td_card c on c.lang = 'ko' and lower(c.set_id) = lower(b.abbr) and c.num = b.num
  where b.category = 85 and b.stamp is null;

  -- i: coreana pela coleção: mesma sigla, mesmo total oficial, número dentro do total.
  insert into lk_mark
  select b.product_id, 'i'
  from lk_base b
  join lk_td_set k on k.lang = 'ko' and lower(k.id) = lower(b.abbr)
  join lk_set s on s.key = b.group_id::text and s.total = k.official
  where b.category = 85 and b.stamp is null
    and (regexp_match(b.no, '^0*([0-9]+)/'))[1]::numeric <= k.official
    and not exists (select 1 from public.lookup_overrides o where o.kind = 'twin_block' and lower(o.key) = lower(b.abbr))
    and not exists (select 1 from lk_mark m where m.product_id = b.product_id and m.mark = 'k');

  -- ----- As linhas -----

  create temp table lk_row (
    id text primary key, set_key text not null, name text not null, plain text, no text, alt text, rarity text, stamp text,
    q text, hp text, card_type text, stage text, td text, prices text, langs text not null, pn text, twin text, year text,
    img text, dated date, item boolean not null default false
  ) on commit drop;

  -- Produtos (passo 6: ano por linha nas coleções de tudo um pouco).
  insert into lk_row (id, set_key, name, plain, no, alt, rarity, stamp, q, hp, card_type, stage, td, prices, langs, pn, year, img, dated, item)
  select b.product_id::text, b.group_id::text, b.name, b.name_plain, b.no, b.alt, b.rarity, b.stamp, b.q, b.hp::text, b.card_type, b.stage,
    b.tcgdex_id, p.prices,
    case b.category when 3 then 'e' else 'j' end || coalesce(m.marks, ''),
    case when m.marks ~ '[pu]' and c.name <> b.name then c.name end,
    case
      when o.key is null then null
      when y.y is not null then y.y || 'n'
      when t.release_date is not null then extract(year from t.release_date)::integer || 'o'
      else '-'
    end,
    case when m.marks like '%p%' then c.image end,
    case
      when o.key is null then s.date
      when y.y is not null then make_date(y.y::integer, 1, 1)
      else t.release_date
    end,
    coalesce(b.card_type ~* '(trainer|energy|supporter|stadium|\mitem\M|\mtool\M)', false)
      or (b.card_type is null and b.name ~* '(spirit link|^rotom (dex|bike|phone)| cap$)')
  from lk_base b
  join lk_set s on s.key = b.group_id::text
  left join lk_price p using (product_id)
  left join (select l.product_id, string_agg(l.mark, '' order by l.mark) as marks from lk_mark l group by l.product_id) m using (product_id)
  left join lk_td_card c on c.lang = 'pt' and c.id = b.tcgdex_id
  left join public.lookup_overrides o on o.kind = 'year_mixed' and o.key = b.group_id::text
  left join public.tcgdex_sets t on t.id = b.td_set
  cross join lateral (select substring(b.full_name from ' - ((?:19|20)[0-9]{2})(?![0-9/])') as y) y;

  -- Passo 8: cartas da TCGdex sem produto. Coleção com produto: a linha entra nela; sem produto, coleção própria.
  create temp table lk_td_group on commit drop as
    select distinct on (b.td_set) b.td_set, b.group_id::text as set_key
    from lk_base b
    where b.category = 3 and b.td_set is not null and b.stamp is null
    group by b.td_set, b.group_id
    order by b.td_set, count(*) desc, b.group_id;

  insert into lk_set (key, lang, name, abbr, date)
  select distinct 'en:' || e.set_id, 'en', s.name, coalesce(s.abbr, ''), s.release_date
  from lk_en_card e
  join public.tcgdex_sets s on s.id = e.set_id
  where not exists (select 1 from lk_base b where b.tcgdex_id = e.id)
    and not exists (select 1 from lk_td_group g where g.td_set = e.set_id)
    and exists (select 1 from lk_tcgp);

  -- Só na TCGdex em inglês (com a marca p, se também existe em português).
  insert into lk_row (id, set_key, name, plain, no, td, langs, pn, img, dated, item)
  select 't:en:' || e.id, coalesce(g.set_key, 'en:' || e.set_id), e.name, public.catalog_plain(e.name),
    case when s.total_text is not null then e.local_id || '/' || s.total_text else e.local_id end,
    e.id,
    case when c.id is null then 'e' else 'ep' end,
    case when c.name <> e.name then c.name end,
    c.image,
    coalesce(s.date, t.release_date),
    e.name ~* '(spirit link|^rotom (dex|bike|phone)| cap$)'
  from lk_en_card e
  join public.tcgdex_sets t on t.id = e.set_id
  left join lk_td_group g on g.td_set = e.set_id
  left join lk_set s on s.key = g.set_key
  left join lk_td_card c on c.lang = 'pt' and c.id = e.id
  where not exists (select 1 from lk_base b where b.tcgdex_id = e.id)
    and exists (select 1 from lk_tcgp); -- sem a lista do Pocket, não dá para separar as digitais

  -- Só em português: PT usa a data do inglês.
  insert into lk_set (key, lang, name, abbr, date, total)
  select 'pt:' || s.id, 'pt', s.name, coalesce(t.abbr, ''), t.release_date, s.official
  from lk_td_set s left join public.tcgdex_sets t on t.id = s.id
  where s.lang = 'pt';

  insert into lk_row (id, set_key, name, plain, no, td, langs, img, dated)
  select 't:pt:' || c.id, 'pt:' || c.set_id, c.name, public.catalog_plain(c.name),
    case when s.official is not null then c.local_id || '/' || s.official else c.local_id end,
    c.id, 'p', c.image, st.date
  from lk_td_card c
  join lk_td_set s on s.lang = 'pt' and s.id = c.set_id
  join lk_set st on st.key = 'pt:' || c.set_id
  where c.lang = 'pt'
    and not exists (select 1 from lk_base b where b.tcgdex_id = c.id)
    and not exists (select 1 from lk_en_card e where e.id = c.id);

  -- Passo 1: maior sequência de até 3 palavras do nome que é uma espécie. Item fica na seção 0.
  create temp table lk_dex (id text not null, dex smallint not null) on commit drop;

  insert into lk_dex
  with w as (
    select r.id, string_to_array(r.plain, ' ') as a from lk_row r where not r.item and r.plain <> ''
  ), t as (
    select w.id, i, n, array_to_string(w.a[i:i + n], '') as k
    from w, generate_subscripts(w.a, 1) as i, generate_series(0, 2) as n
    where i + n <= array_length(w.a, 1)
  ), h as (
    select t.id, t.i, t.n, s.dex from t join public.catalog_species s on s.kind = 'en' and s.key = t.k
  )
  select distinct h.id, h.dex
  from h
  where not exists (select 1 from h o where o.id = h.id and o.i <= h.i and o.i + o.n >= h.i + h.n and o.n > h.n);

  -- Grafia errada na fonte: a correção manda.
  delete from lk_dex d using lk_row r, public.lookup_overrides o
  where o.kind = 'dex' and r.id = d.id and r.plain = public.catalog_plain(o.key);
  insert into lk_dex
  select r.id, o.value::smallint
  from lk_row r join public.lookup_overrides o on o.kind = 'dex' and r.plain = public.catalog_plain(o.key);
  analyze lk_dex;

  -- Só na TCGdex japonesa, e só em coleção com sigla na 85: as antigas sem sigla já existem como produto sem número.
  create temp table lk_ja on commit drop as
    select c.id, c.local_id, c.name, c.image, c.num, g.group_id::text as set_key, s.total_text, s.date
    from lk_td_card c
    join lateral (
      select min(x.group_id) as group_id
      from public.tcg_groups x
      where x.category = 85 and lower(nullif(x.abbr, '')) = lower(c.set_id)
    ) g on g.group_id is not null
    join lk_set s on s.key = g.group_id::text
    where c.lang = 'ja'
      and not exists (select 1 from lk_base b where b.category = 85 and lower(b.abbr) = lower(c.set_id) and b.num = c.num);

  insert into lk_row (id, set_key, name, no, td, langs, img, dated)
  select 't:ja:' || j.id, j.set_key, j.name,
    case when j.total_text is not null then j.local_id || '/' || j.total_text else j.local_id end,
    j.id, 'j', j.image, j.date
  from lk_ja j;

  insert into lk_dex
  select distinct on (j.id) 't:ja:' || j.id, s.dex
  from lk_ja j join public.catalog_species s on s.kind = 'ja' and position(s.key in j.name) > 0
  order by j.id, length(s.key) desc, s.dex;

  -- Passo 9: chinês. Gêmea japonesa: mesma sigla e número, sem selo e única; mais de uma, filtra pela espécie.
  insert into lk_set (key, lang, name, abbr, date, total)
  select s.lang || ':' || s.id, s.lang, s.name, s.id, s.date, s.official
  from lk_td_set s
  where s.lang in ('zh-tw', 'zh-cn');

  create temp table lk_twin_all on commit drop as
    select z.lang, z.id, b.product_id, count(*) over (partition by z.lang, z.id) as n
    from lk_td_card z
    join lk_base b on b.category = 85 and b.stamp is null and lower(b.abbr) = lower(z.set_id) and b.num = z.num
    where z.lang in ('zh-tw', 'zh-cn');

  -- Espécie pelo nome chinês, só de quem precisa (sem gêmea ou com mais de uma): o maior nome contido.
  create temp table lk_zh_name on commit drop as
    select distinct on (z.lang, z.id) z.lang, z.id, s.dex
    from lk_td_card z
    join public.catalog_species s on s.kind = 'zh' and position(s.key in z.name) > 0
    where z.lang in ('zh-tw', 'zh-cn')
      and not exists (select 1 from lk_twin_all t where t.lang = z.lang and t.id = z.id and t.n = 1)
    order by z.lang, z.id, length(s.key) desc, s.dex;

  create temp table lk_twin on commit drop as
    select t.lang, t.id, t.product_id from lk_twin_all t where t.n = 1
    union all
    select t.lang, t.id, min(t.product_id)
    from lk_twin_all t
    join lk_zh_name z on z.lang = t.lang and z.id = t.id
    join lk_dex d on d.id = t.product_id::text and d.dex = z.dex
    where t.n > 1
    group by t.lang, t.id
    having count(*) = 1;

  select jsonb_build_object(
    'unique', (select count(*) from lk_twin),
    'ambiguous', (select count(distinct (t.lang, t.id)) from lk_twin_all t where t.n > 1 and not exists (select 1 from lk_twin w where w.lang = t.lang and w.id = t.id)),
    'missing', (select count(*) from lk_td_card z where z.lang in ('zh-tw', 'zh-cn') and not exists (select 1 from lk_twin_all t where t.lang = z.lang and t.id = z.id))
  ) into v_twins;

  insert into lk_row (id, set_key, name, no, hp, td, langs, twin, year, img, dated)
  select 't:' || z.lang || ':' || z.id, z.lang || ':' || z.set_id, z.name,
    case when s.official is not null
      then z.local_id || '/' || case when z.local_id ~ '^[0-9]+$' then lpad(s.official::text, length(z.local_id), '0') else s.official::text end
      else z.local_id end,
    coalesce((l.hp->>z.id)::integer::text, tb.hp::text || 'j'),
    z.id,
    case z.lang when 'zh-tw' then 't' else 'c' end,
    t.product_id::text,
    case
      when s.date is not null then null
      when ts.date is not null then extract(year from ts.date)::integer || 'j'
      else '-'
    end,
    z.image,
    coalesce(s.date, ts.date)
  from lk_td_card z
  join lk_td_set s on s.lang = z.lang and s.id = z.set_id
  join public.tcgdex_lang l on l.lang = z.lang
  left join lk_twin t on t.lang = z.lang and t.id = z.id
  left join lk_base tb on tb.product_id = t.product_id
  left join lk_set ts on ts.key = tb.group_id::text
  where z.lang in ('zh-tw', 'zh-cn');

  -- Espécie: a da gêmea; senão, o nome chinês.
  insert into lk_dex
  select 't:' || t.lang || ':' || t.id, d.dex
  from lk_twin t join lk_dex d on d.id = t.product_id::text;
  insert into lk_dex
  select 't:' || z.lang || ':' || z.id, z.dex
  from lk_zh_name z
  where not exists (select 1 from lk_twin t where t.lang = z.lang and t.id = z.id);

  -- O que não achou espécie é a seção 0 (treinador, energia, item).
  insert into lk_dex
  select r.id, 0::smallint from lk_row r where not exists (select 1 from lk_dex d where d.id = r.id);

  -- ----- Passos 10 e 11: cabeçalho e texto -----

  -- Coleções coreanas e chinesas sem nenhuma carta no índice: só nome, data e quantidade.
  select coalesce(jsonb_agg(jsonb_build_array(s.lang, s.name, s.date, s.official) order by s.lang, s.date desc nulls last, s.name collate "C"), '[]')
  into v_only
  from (
    select k.lang, k.id, k.name, j.date, k.official
    from lk_td_set k
    left join lateral (
      select max(g.published_on) as date from public.tcg_groups g where g.category = 85 and lower(nullif(g.abbr, '')) = lower(k.id)
    ) j on true
    where k.lang = 'ko'
      and not exists (
        select 1 from lk_base b join lk_mark m on m.product_id = b.product_id and m.mark in ('k', 'i') where lower(b.abbr) = lower(k.id))
    union all
    select z.lang, z.id, z.name, z.date, z.official
    from lk_td_set z
    where z.lang in ('zh-tw', 'zh-cn')
      and not exists (select 1 from lk_row r where r.set_key = z.lang || ':' || z.id)
  ) s;

  select jsonb_strip_nulls(jsonb_build_object(
    'ko', (select to_char(max(b.published_on), 'YYYY-MM') from lk_base b join lk_mark m on m.product_id = b.product_id and m.mark in ('k', 'i')),
    'zh', (select to_char(max(s.date), 'YYYY-MM') from lk_set s where s.lang in ('zh-tw', 'zh-cn') and exists (select 1 from lk_row r where r.set_key = s.key))
  )) into v_limits;

  select jsonb_build_object(
    'v', 1,
    'prices', v_prices,
    'fx', (select jsonb_build_array(f.day, f.sell) from public.fx_rates f where f.currency = 'USD' order by f.day desc limit 1),
    'sets', (
      select coalesce(jsonb_object_agg(s.key, jsonb_build_array(s.lang, s.name, s.abbr, s.date, s.total, coalesce(s.y_from, 0), coalesce(s.y_to, 0),
        case when s.price_day is distinct from v_prices then s.price_day end)), '{}')
      from lk_set s
      where exists (select 1 from lk_row r where r.set_key = s.key)
    ),
    'td', (
      select coalesce(jsonb_object_agg(t.id, t.abbr), '{}')
      from public.tcgdex_sets t
      where nullif(t.abbr, '') is not null and not exists (select 1 from lk_tcgp p where p.id = t.id)
    ),
    'only', v_only,
    'limits', v_limits
  )::text into v_header;

  create temp table lk_line on commit drop as
    select r.id, r.set_key, r.no, r.dated,
      substring(r.no from '^[^0-9]*') as no_prefix,
      coalesce((regexp_match(r.no, '[0-9]+'))[1]::numeric, 0) as no_value,
      regexp_replace(array_to_string(array[
        r.id, r.set_key, translate(r.name, E'\t\n\r', '   '), translate(r.no, E'\t\n\r', '   '), translate(r.alt, E'\t\n\r', '   '),
        translate(r.rarity, E'\t\n\r', '   '), translate(r.stamp, E'\t\n\r', '   '), translate(r.q, E'\t\n\r', '   '), r.hp,
        translate(r.card_type, E'\t\n\r', '   '), translate(r.stage, E'\t\n\r', '   '), r.td, r.prices, r.langs,
        translate(r.pn, E'\t\n\r', '   '), r.twin, r.year, r.img
      ]::text[], E'\t', ''), E'\t+$', '') as line
    from lk_row r;
  analyze lk_line;

  select string_agg(s.section, E'\n' order by (s.dex = 0), s.dex), sum(s.n)::integer
  into v_sections, v_lines
  from (
    select d.dex, count(*) as n,
      '@' || d.dex || E'\n' || string_agg(l.line, E'\n' order by l.dated desc nulls last, l.set_key collate "C", l.no_prefix collate "C", l.no_value, l.no collate "C", l.id collate "C") as section
    from lk_dex d join lk_line l using (id)
    group by d.dex
  ) s;

  v_body := v_header || E'\n' || v_sections;
  v_md5 := md5(v_body);

  select round(100.0 * count(*) filter (where r.hp is not null) / nullif(count(*), 0), 1) into v_hp from lk_row r;

  select jsonb_build_object(
    'lines', jsonb_build_object(
      'total', count(*),
      'e', count(*) filter (where r.langs like '%e%'), 'p', count(*) filter (where r.langs like '%p%'),
      'u', count(*) filter (where r.langs like '%u%'), 'j', count(*) filter (where r.langs like '%j%'),
      'k', count(*) filter (where r.langs like '%k%'), 'i', count(*) filter (where r.langs like '%i%'),
      't', count(*) filter (where r.langs like '%t%'), 'c', count(*) filter (where r.langs like '%c%'),
      'noProduct', count(*) filter (where r.id like 't:%')
    ),
    'hp', jsonb_build_object(
      'all', v_hp,
      'en', round(100.0 * count(*) filter (where r.hp is not null and r.langs like '%e%') / nullif(count(*) filter (where r.langs like '%e%'), 0), 1),
      'ja', round(100.0 * count(*) filter (where r.hp is not null and r.langs like '%j%') / nullif(count(*) filter (where r.langs like '%j%'), 0), 1),
      'zh', round(100.0 * count(*) filter (where r.hp is not null and r.langs ~ '[tc]') / nullif(count(*) filter (where r.langs ~ '[tc]'), 0), 1)
    ),
    'noYear', count(*) filter (where r.year = '-' or (r.year is null and s.date is null and s.y_from is null)),
    'twins', v_twins,
    'prices', jsonb_build_object(
      'market', count(*) filter (where r.prices ~ ':[0-9]+(\||$)'),
      'listing', count(*) filter (where r.prices is not null and r.prices !~ ':[0-9]+(\||$)'),
      'none', count(*) filter (where r.prices is null)
    ),
    'unknownPrints', v_unknown
  ) into v_meta
  from lk_row r join lk_set s on s.key = r.set_key;

  -- ----- Trava: índice ruim não entra; a versão no ar fica e o motivo vai para cron.job_run_details -----

  select i.md5, i.lines, nullif(i.meta->'hp'->>'all', '')::numeric as hp into v_old from public.lookup_index i where i.id = 1;

  if v_lines is null or v_lines < 50000 then
    raise exception 'lookup_build: só % linhas (mínimo 50.000)', coalesce(v_lines, 0);
  end if;
  if v_old.lines is not null and v_lines < v_old.lines * 0.95 then
    raise exception 'lookup_build: queda de mais de 5%% nas linhas (% → %)', v_old.lines, v_lines;
  end if;
  if v_old.hp is not null and v_hp < v_old.hp - 10 then
    raise exception 'lookup_build: cobertura de HP caiu mais de 10 pontos (% → %)', v_old.hp, v_hp;
  end if;

  if v_old.md5 is not distinct from v_md5 then
    return 'sem mudança';
  end if;

  insert into public.lookup_index (id, md5, format, built_at, lines, bytes, meta, body)
  values (1, v_md5, 1, now(), v_lines, octet_length(v_body), v_meta, v_body)
  on conflict (id) do update
    set md5 = excluded.md5, format = excluded.format, built_at = excluded.built_at, lines = excluded.lines,
        bytes = excluded.bytes, meta = excluded.meta, body = excluded.body;
  return 'novo';
end;
$lookup$;
revoke all on function public.lookup_build() from public, anon, authenticated;

-- ===== Crons (pg_cron) =====
-- cron.schedule troca o job de mesmo nome, então rodar de novo não duplica nada. Horários em UTC.

-- Foto diária do valor de cada carta: 23:50 de Brasília.
select cron.schedule('price-snapshot', '50 2 * * *', $$ select public.snapshot_prices(); $$);

-- Totais do gráfico (price_history_daily): 23:55 de Brasília, depois da foto das 23:50. Num job à parte, para uma
-- falha nos totais não desfazer a foto do dia; o dia que faltar entra na execução seguinte.
select cron.schedule('price-totals', '55 2 * * *', $$ select public.history_day_totals(); $$);

-- Cópia diária da coleção: 00:20 de Brasília (depois da foto de preços).
select cron.schedule('collection-backup', '20 3 * * *', $$ select backup.snapshot_collection(); $$);

-- Índice da Consulta, às 00:10 e 06:10 UTC: os preços terminam perto das 23 h; a segunda passada cobre dia lento e fica longe dos crons de
-- 02:50, 02:55, 03:20 e 03:40.
select cron.schedule('lookup-build', '10 0,6 * * *', $$ select public.lookup_build(); $$);

-- Limpeza diária (00:40 de Brasília): histórico do pg_cron com mais de 14 dias e registros de remoção com mais de 180
-- dias (ou de contas que não existem mais).
select cron.schedule('daily-cleanup', '40 3 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '14 days';
  delete from public.entry_tombstones t
  where t.deleted_at < now() - interval '180 days'
     or not exists (select 1 from auth.users u where u.id = t.user_id);
$$);

-- Cópia do catálogo e dos preços do TCGCSV e da PTAX, a cada 10 min (o catalog-sync respeita as regras do TCGCSV:
-- 1×/dia por coleção alterada). Troque SEU_PROJECT_REF pelo id do projeto (Project Settings → General). Com o id de
-- exemplo, nada é agendado e o job que já existe fica como está; com um id de verdade, o job é criado ou trocado.
do $$
declare
  ref text := 'SEU_PROJECT_REF';
begin
  if ref !~ '^[a-z0-9]{20}$' then
    raise notice 'catalog-sync: troque SEU_PROJECT_REF pelo id do projeto para agendar o cron.';
    return;
  end if;
  perform cron.schedule('catalog-sync', '2-59/10 * * * *', format($cmd$
  select net.http_post(
    url := 'https://%s.supabase.co/functions/v1/catalog-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'liga_sync_key')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$cmd$, ref));
end;
$$;

-- A API (PostgREST) passa a ver as tabelas e funções novas na hora.
notify pgrst, 'reload schema';
