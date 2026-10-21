-- Rode este arquivo no SQL Editor do seu projeto Supabase.

create table if not exists public.binder_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null, -- "<dex>-<slot>"
  dex int not null,
  slot int not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Cache das cotações da Liga (Apify). Só a Edge Function (service role) lê e escreve.
create table if not exists public.liga_price_cache (
  query text primary key,
  items jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.liga_price_cache enable row level security;

alter table public.binder_settings enable row level security;
alter table public.entries enable row level security;

create policy "own settings" on public.binder_settings
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own entries" on public.entries
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ===== Cotação automática da Liga (Edge Function liga-sync + pg_cron) =====
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.liga_sync_runs (
  run_id text primary key,
  dataset_id text not null,
  queries jsonb not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text,
  status_message text,
  items int
);
alter table public.liga_sync_runs enable row level security;

-- Chave aleatória que só o cron conhece (guardada no Vault).
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'liga_sync_key', 'Chave do cron liga-sync')
where not exists (select 1 from vault.secrets where name = 'liga_sync_key');

create or replace function public.check_liga_sync_key(k text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'liga_sync_key' and decrypted_secret = k);
$$;
revoke all on function public.check_liga_sync_key(text) from public, anon, authenticated;
grant execute on function public.check_liga_sync_key(text) to service_role;

-- Troque SEU_PROJECT_REF pelo código do projeto.
select cron.schedule('liga-sync', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://SEU_PROJECT_REF.supabase.co/functions/v1/liga-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'liga_sync_key')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$$);
