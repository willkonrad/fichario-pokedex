-- Fichário Pokédex · banco de dados (Supabase, Postgres 17) — retrato completo da versão 3.0.1.
--
-- Este arquivo é o espelho do banco em produção: tabelas, regras de acesso (RLS), funções, gatilhos e crons, já com as
-- migrações de supabase/migrations/ aplicadas (20261024a_sync, 20261024b_catalog, 20261024c_pricing,
-- 20261024d_fixes e 20261025a_hardening). Pode rodar mais de uma vez (idempotente): cria o que falta e troca as funções
-- pela versão daqui, sem apagar dados.
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
-- (nas cartas em inglês, pela TCGplayer; nas outras, pelo MYP, desta versão e selo).
create or replace function public.entries_keep_newer_prices()
returns trigger language plpgsql set search_path = '' as $$
declare
  k text;
  p jsonb;
  en boolean;
  v text;
  rule_key text;
  note text;
  mine numeric;
  avg numeric;
begin
  en := coalesce(new.data ->> 'lang', 'pt') = 'en';
  v := coalesce(new.data ->> 'variant', 'normal');
  -- Fonte que apaga o "Meu valor": TCGplayer nas cartas em inglês, MYP nas outras.
  rule_key := case when en then 'tcgplayer' else 'mypApi' end;
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
        note := case when en or v in ('wPromo', 'staff') then coalesce(btrim(new.data ->> 'variantNote'), '') else '' end;
        if mine is not null and avg is not null and avg > mine and coalesce(p ->> 'note', '') = note
           and coalesce(p ->> 'checkedAt', '') > coalesce(new.data -> 'myValue' ->> 'setAt', '') then
          new.data := new.data || jsonb_build_object(
            'myValue', null,
            'myValueReplaced', jsonb_build_object('value', mine, 'mypValue', avg, 'at', p ->> 'checkedAt',
                                                  'source', case when en then 'tcgplayer' else 'myp' end));
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

-- Preço da TCGplayer (tcgplayer, cartas em inglês), gravado sobre a carta como está no banco, com a regra do "Meu
-- valor" (a média, que é o valor de mercado, em reais).
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
  link_version integer not null default 0,
  -- Versão dos preços da TCGplayer copiada (built_at do TCGCSV).
  prices_at timestamptz
);
-- Colunas que chegaram depois da criação da tabela (bancos antigos).
alter table public.tcg_groups add column if not exists link_version integer not null default 0;
alter table public.tcg_groups add column if not exists prices_at timestamptz;

-- Cartas do TCGCSV, ligadas ao id da TCGdex quando a carta existe lá (mesma coleção, número e nome).
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
  name_plain text generated always as (public.catalog_plain(name)) stored
);
alter table public.tcg_catalog
  add column if not exists name_plain text generated always as (public.catalog_plain(name)) stored;
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
  synced_at timestamptz not null default now()
);

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

-- ===== Preços da TCGplayer (cartas em inglês), via TCGCSV, e câmbio oficial (PTAX) — catalog-sync =====

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

-- Valor de uma carta numa foto diária. Mesma regra do app (src/lib/valuation.ts e src/lib/history.ts, snapshotValue):
-- "Meu valor" (mínimo, média e máximo iguais a ele), senão a TCGplayer (só cartas em inglês, já em reais), senão
-- mínimo/média/máximo do MYP. O mínimo e o máximo nunca ficam do lado de dentro da média, e o valor da carta (pick)
-- segue a escolha gravada na foto (basis; sem ela, a média). Foto sem preço não devolve linha.
create or replace function public.history_value(s jsonb, p_lang text)
returns table (source text, min numeric, avg numeric, max numeric, pick numeric)
language sql immutable set search_path = '' as $$
  with k as (
    select case
      when jsonb_typeof(s->'manual'->'value') = 'number' then 'manual'
      when p_lang = 'en' and jsonb_typeof(s->'tcgplayer'->'avg') = 'number' then 'tcgplayer'
      when jsonb_typeof(s->'mypApi'->'avg') = 'number' then 'mypApi'
    end as kind
  ), p as (
    select k.kind,
      case when k.kind = 'manual' then (s->'manual'->>'value')::numeric else (s->k.kind->>'avg')::numeric end as mid,
      case when k.kind <> 'manual' and jsonb_typeof(s->k.kind->'min') = 'number' then (s->k.kind->>'min')::numeric end as lo,
      case when k.kind <> 'manual' and jsonb_typeof(s->k.kind->'max') = 'number' then (s->k.kind->>'max')::numeric end as hi
    from k
    where k.kind is not null
  ), r as (
    select p.kind, least(coalesce(p.lo, p.mid), p.mid) as lo, p.mid, greatest(coalesce(p.hi, p.mid), p.mid) as hi
    from p
  )
  select
    case r.kind when 'mypApi' then 'myp' else r.kind end,
    r.lo,
    r.mid,
    r.hi,
    case
      when r.kind = 'manual' then r.mid
      when s->>'basis' = 'min' then r.lo
      when s->>'basis' = 'max' then r.hi
      else r.mid
    end
  from r;
$$;
revoke all on function public.history_value(jsonb, text) from public, anon;
grant execute on function public.history_value(jsonb, text) to authenticated;

-- Total da coleção por dia desde p_from (sem p_from, todos os dias): a soma do valor escolhido em cada carta (value),
-- as somas dos mínimos, das médias e dos máximos e quantas cartas tinham preço. Roda com as permissões do usuário (só
-- as fotos dele). A variação do período e o histórico de cada carta são calculados no app (src/lib/history.ts).
create or replace function public.collection_history(p_from date default null)
returns table (day date, value numeric, min numeric, avg numeric, max numeric, cards integer)
language sql stable security invoker set search_path = '' as $$
  select h.day, round(sum(v.pick), 2), round(sum(v.min), 2), round(sum(v.avg), 2), round(sum(v.max), 2), count(*)::integer
  from public.price_history h
  cross join lateral public.history_value(h.sources, h.lang) v
  where h.user_id = (select auth.uid()) and (p_from is null or h.day >= p_from)
    -- Fotos antigas de cartas sem preço (só com basis ou campos das fontes antigas) nem chamam a função.
    and h.sources ?| array['manual', 'mypApi', 'tcgplayer']
  group by h.day
  order by h.day;
$$;
revoke all on function public.collection_history(date) from public, anon;
grant execute on function public.collection_history(date) to authenticated;

-- Foto diária do valor de cada carta (cron "price-snapshot", 23:50 de Brasília). Grava uma linha por carta COM PREÇO
-- (as outras não entram em nenhuma soma), com as fontes daquele dia:
--   manual     "Meu valor" (só quando tem um número);
--   mypApi     mínimo/média/máximo do MYP desta carta, versão e selo (buscados pelo app no celular);
--   tcgplayer  só cartas em inglês, do produto e impressão gravados na carta: o preço do dia (tcg_prices) × o câmbio
--              mais recente, com a conta do app (mínimo = menor anúncio, média = mercado, máximo = mediana, 2 casas);
--              sem preço do dia ou sem câmbio, o preço gravado na carta;
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
      -- O produto da TCGplayer é desta carta, versão e selo (o selo conta em todas as versões), numa carta em inglês?
      (e.data->>'lang' = 'en'
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
-- mais no banco perde o registro de remoção (gatilho entries_untombstone).
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

-- ===== Crons (pg_cron) =====
-- cron.schedule troca o job de mesmo nome, então rodar de novo não duplica nada. Horários em UTC.

-- Foto diária do valor de cada carta: 23:50 de Brasília.
select cron.schedule('price-snapshot', '50 2 * * *', $$ select public.snapshot_prices(); $$);

-- Cópia diária da coleção: 00:20 de Brasília (depois da foto de preços).
select cron.schedule('collection-backup', '20 3 * * *', $$ select backup.snapshot_collection(); $$);

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
