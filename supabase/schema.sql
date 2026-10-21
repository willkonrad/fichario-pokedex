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
  sources jsonb, -- { manual, mypOffer, myp }
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
        'mypOffer', e.data->'mypOffers',
        'myp', e.data->'myp'->'price'
      ))
    from public.entries e
    on conflict (user_id, entry_id, day) do update set sources = excluded.sources, condition = excluded.condition, variant = excluded.variant
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke all on function public.snapshot_prices() from public, anon, authenticated;

-- ===== Preços do MYP Cards (Edge Function myp-sync + pg_cron) =====

-- Chave aleatória que só o cron conhece (guardada no Vault).
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'liga_sync_key', 'Chave dos crons de preço')
where not exists (select 1 from vault.secrets where name = 'liga_sync_key');

create or replace function public.check_liga_sync_key(k text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'liga_sync_key' and decrypted_secret = k);
$$;
revoke all on function public.check_liga_sync_key(text) from public, anon, authenticated;
grant execute on function public.check_liga_sync_key(text) to service_role;

-- Troque SEU_PROJECT_REF pelo código do projeto.
select cron.schedule('myp-sync', '5-59/10 * * * *', $$
  select net.http_post(
    url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/myp-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'liga_sync_key')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$);

-- Foto diária do valor de cada carta, às 23:50 de Brasília.
select cron.schedule('price-snapshot', '50 2 * * *', $$ select public.snapshot_prices(); $$);
