-- Rode este arquivo no SQL Editor do seu projeto Supabase (troque SEU_PROJECT_REF no final).

-- ===== Coleção =====

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

create policy "own settings" on public.binder_settings
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own entries" on public.entries
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- O servidor grava só os campos de preço da carta (ex.: `myp`), sem mexer no resto.
create or replace function public.set_entry_fields(p_user uuid, p_id text, p_fields jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.entries
  set data = data || p_fields
             || jsonb_build_object('updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      updated_at = now()
  where user_id = p_user and id = p_id;
$$;
revoke all on function public.set_entry_fields(uuid, text, jsonb) from public, anon, authenticated;

-- ===== Histórico diário do valor (base dos gráficos) =====

create table if not exists public.price_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_id text not null,
  day date not null,
  card_id text,
  lang text,
  condition text,
  variant text,
  sources jsonb, -- { manual, mypApi: { min, avg, max, own }, basis } (fotos antigas podem ter também sold, myp, mypOffer)
  created_at timestamptz not null default now(),
  primary key (user_id, entry_id, day)
);
alter table public.price_history enable row level security;

create policy "own price history" on public.price_history
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.snapshot_prices()
returns integer language sql security definer set search_path = '' as $$
  with ins as (
    insert into public.price_history (user_id, entry_id, day, card_id, lang, condition, variant, sources)
    select e.user_id, e.id, (now() at time zone 'America/Sao_Paulo')::date,
      e.data->>'cardId', e.data->>'lang', e.data->>'condition', e.data->>'variant',
      jsonb_strip_nulls(jsonb_build_object(
        'manual', e.data->'myValue',
        -- Mínimo/média/máximo do MYP (API pública, buscados pelo app no celular), só desta carta, versão e selo.
        -- O gráfico desenha a faixa (mínimo a máximo) e a linha do valor escolhido na carta (basis).
        'mypApi', case
          when e.data->'mypApi'->>'cardId' = e.data->>'cardId'
           and e.data->'mypApi'->>'variant' = coalesce(e.data->>'variant', 'normal')
           and coalesce(e.data->'mypApi'->>'note', '') =
               case when coalesce(e.data->>'variant', 'normal') in ('wPromo', 'staff')
                    then coalesce(btrim(e.data->>'variantNote'), '') else '' end
           and e.data->'mypApi' ? 'avg'
          then jsonb_strip_nulls(jsonb_build_object(
            'min', e.data->'mypApi'->'min', 'avg', e.data->'mypApi'->'avg', 'max', e.data->'mypApi'->'max',
            'own', e.data->'mypApi'->'ownVersion'))
        end,
        -- TCGplayer (cartas em inglês): menor anúncio / mercado / mediana, já em reais, desta carta, versão e selo.
        'tcgplayer', case
          when e.data->'tcgplayer'->>'cardId' = e.data->>'cardId'
           and e.data->'tcgplayer'->>'variant' = coalesce(e.data->>'variant', 'normal')
           and coalesce(e.data->'tcgplayer'->>'note', '') = coalesce(btrim(e.data->>'variantNote'), '')
           and e.data->'tcgplayer' ? 'avg'
          then jsonb_strip_nulls(jsonb_build_object(
            'min', e.data->'tcgplayer'->'min', 'avg', e.data->'tcgplayer'->'avg', 'max', e.data->'tcgplayer'->'max',
            'usd', e.data->'tcgplayer'->'usdMarket', 'fx', e.data->'tcgplayer'->'fx'))
        end,
        'basis', e.data->'valueBasis'
      ))
    from public.entries e
    on conflict (user_id, entry_id, day) do update set sources = excluded.sources, condition = excluded.condition, variant = excluded.variant
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke all on function public.snapshot_prices() from public, anon, authenticated;

-- ===== Servidor: marcadores e chave dos crons =====

-- Marcadores do servidor (hoje só o do catalog-sync, "tcgcsv:groups-listed"); só o servidor lê e grava. O nome vem de
-- quando guardava as páginas de vendas reais do "Quanto vale minha carta?", fonte que saiu na 2.5.0.
create table if not exists public.qvmc_cache (
  key text primary key,
  data jsonb,
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

-- Foto diária do valor de cada carta, às 23:50 de Brasília.
select cron.schedule('price-snapshot', '50 2 * * *', $$ select public.snapshot_prices(); $$);

-- ===== Preços do MYP Cards pela API pública (mínimo/média/máximo), buscados pelo app no celular =====

-- Grava os preços do MYP (mypApi) SOBRE a carta como está no banco (mescla campo a campo, sem sobrescrever edições de
-- outro aparelho ou do servidor) e aplica a regra do "Meu valor" com o valor atual do banco: se a média do MYP (desta
-- carta, versão e selo) passar dele, ele é apagado e fica o registro da troca. Roda com as permissões do usuário.
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
  nxt := cur || jsonb_build_object('mypApi', p_myp);
  mine := nullif(cur->'myValue'->>'value', '')::numeric;
  avg := nullif(p_myp->>'avg', '')::numeric;
  v := coalesce(cur->>'variant', 'normal');
  note := case when v in ('wPromo', 'staff') then coalesce(btrim(cur->>'variantNote'), '') else '' end;
  -- Vale para toda versão (versão especial que o MYP não vende à parte usa o preço da carta base, valor parecido); nas
  -- cartas em inglês o MYP é só referência (o valor vem da TCGplayer), então não apaga o "Meu valor".
  if coalesce(cur->>'lang', 'pt') <> 'en' and mine is not null and avg is not null and avg > mine
     and p_myp->>'cardId' = cur->>'cardId' and p_myp->>'variant' = v and coalesce(p_myp->>'note', '') = note then
    nxt := nxt || jsonb_build_object(
      'myValue', null,
      'myValueReplaced', jsonb_build_object('value', mine, 'mypValue', avg, 'at', p_myp->>'checkedAt', 'source', 'myp'));
  end if;
  nxt := nxt || jsonb_build_object('updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  update public.entries set data = nxt, updated_at = now() where user_id = (select auth.uid()) and id = p_id;
  return jsonb_build_object('prev', cur->>'updatedAt', 'data', nxt);
end;
$$;
revoke all on function public.patch_entry_myp(text, jsonb) from public, anon;
grant execute on function public.patch_entry_myp(text, jsonb) to authenticated;

-- ===== Catálogo de cartas: TCGCSV (base principal) ligado à TCGdex — Edge Function catalog-sync + pg_cron =====

-- Coleções do TCGCSV (catálogo da TCGplayer): 3 = Pokémon em inglês, 85 = japonês.
create table if not exists public.tcg_groups (
  group_id integer primary key,
  category smallint not null,
  name text not null,
  abbr text,
  modified_on timestamptz,
  synced_at timestamptz,
  -- Versão da regra de ligação TCGCSV → TCGdex aplicada (sobe quando a regra melhora, para religar sem baixar de novo).
  link_version integer not null default 0
);

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
  updated_at timestamptz not null default now()
);
create extension if not exists pg_trgm with schema extensions;
create index if not exists tcg_catalog_name_trgm on public.tcg_catalog using gin (name extensions.gin_trgm_ops);
create index if not exists tcg_catalog_tcgdex on public.tcg_catalog (tcgdex_id);
create index if not exists tcg_catalog_group on public.tcg_catalog (group_id);

-- Siglas e cartas das coleções da TCGdex (para ligar às do TCGCSV).
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
create policy "catálogo público" on public.tcg_groups for select to anon, authenticated using (true);
create policy "catálogo público" on public.tcg_catalog for select to anon, authenticated using (true);

-- Religa cartas do catálogo à TCGdex em lote, com o selo: p = [{ product_id, tcgdex_id, stamp }] (só o servidor).
create or replace function public.relink_catalog(p jsonb)
returns integer language sql security definer set search_path = '' as $$
  with upd as (
    update public.tcg_catalog c set tcgdex_id = x.tcgdex_id, stamp = x.stamp
    from jsonb_to_recordset(p) as x(product_id integer, tcgdex_id text, stamp text)
    where c.product_id = x.product_id and (c.tcgdex_id is distinct from x.tcgdex_id or c.stamp is distinct from x.stamp)
    returning 1
  )
  select count(*)::int from upd;
$$;
revoke all on function public.relink_catalog(jsonb) from public, anon, authenticated;
grant execute on function public.relink_catalog(jsonb) to service_role;

-- Cópia do catálogo do TCGCSV (respeita as regras dele: 1×/dia por coleção alterada). Troque SEU_PROJECT_REF.
select cron.schedule('catalog-sync', '2-59/10 * * * *', $$
  select net.http_post(
    url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/catalog-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'liga_sync_key')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$$);

-- ===== Preços da TCGplayer (cartas em inglês), via TCGCSV, e câmbio oficial (PTAX) — catalog-sync =====

alter table public.tcg_groups add column if not exists prices_at timestamptz;

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

-- Grava o preço da TCGplayer (tcgplayer) sobre a carta como está no banco e aplica a regra do "Meu valor" (cartas em
-- inglês: a média, que é o valor de mercado, em reais). Roda com as permissões do usuário.
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
  nxt := cur || jsonb_build_object('tcgplayer', p_tcg);
  mine := nullif(cur->'myValue'->>'value', '')::numeric;
  avg := nullif(p_tcg->>'avg', '')::numeric;
  v := coalesce(cur->>'variant', 'normal');
  -- Selo ou versão do catálogo (promo, Cosmos Holo, Reverse da Costco…): a TCGplayer vende à parte.
  note := coalesce(btrim(cur->>'variantNote'), '');
  if cur->>'lang' = 'en' and mine is not null and avg is not null and avg > mine
     and p_tcg->>'cardId' = cur->>'cardId' and p_tcg->>'variant' = v and coalesce(p_tcg->>'note', '') = note then
    nxt := nxt || jsonb_build_object(
      'myValue', null,
      'myValueReplaced', jsonb_build_object('value', mine, 'mypValue', avg, 'at', p_tcg->>'checkedAt', 'source', 'tcgplayer'));
  end if;
  nxt := nxt || jsonb_build_object('updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  update public.entries set data = nxt, updated_at = now() where user_id = (select auth.uid()) and id = p_id;
  return jsonb_build_object('prev', cur->>'updatedAt', 'data', nxt);
end;
$$;
revoke all on function public.patch_entry_tcgplayer(text, jsonb) from public, anon;
grant execute on function public.patch_entry_tcgplayer(text, jsonb) to authenticated;
