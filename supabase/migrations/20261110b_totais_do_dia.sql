-- Fichário Pokédex — gráfico do valor pelos totais guardados de cada dia.
--
-- Pode rodar mais de uma vez: cria a tabela se faltar, troca as funções e o cron e recalcula os totais (o mesmo
-- resultado a cada vez). Não altera nenhuma foto de price_history.
--
-- Antes, collection_history somava no servidor, foto a foto, todas as fotos do período pedido (o app sempre pede 1
-- ano). A conta cresce em linha reta (~13 µs por foto): por volta de 620 mil fotos (1.700 cartas com preço guardadas
-- por um ano) ela passaria dos 8 s de limite da API, e o gráfico não abriria em nenhum período. Agora:
--
--   1. price_history_daily guarda o total de cada dia de cada conta (as colunas que collection_history devolve). A
--      conta só lê os dela; ninguém grava pela API.
--   2. history_day_sums tem a regra da soma que estava em collection_history, agrupada por conta e dia. No banco, a
--      regra do valor continua em dois lugares: history_day_sums (a soma) e snapshot_prices (a foto).
--   3. history_day_totals grava os totais a partir de history_day_sums. O cron "price-totals" (23:55 de Brasília,
--      depois da foto das 23:50) recalcula a última semana e qualquer dia que tenha ficado sem total.
--   4. collection_history lê os totais guardados (no máximo 366 linhas no ano) e soma foto a foto só os dias
--      depois do último total guardado (em geral nenhum; entre 23:50 e 23:55, o de hoje). Medido num Postgres local
--      com um ano de fotos: 1.700 cartas (622 mil fotos) caem de 3,5 s para 2–12 ms; 676 cartas, de 1,4 s para 2–6 ms.
--
-- Mudou a regra da soma (history_day_sums) ou alguma foto já gravada em price_history? Recalcule os totais na mesma
-- migração: select public.history_day_totals('-infinity');
--
-- Sem esta migração, o app continua usando a collection_history antiga, que soma tudo na hora.

-- ===== Totais de cada dia =====

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

-- Totais de todos os dias já guardados em price_history.
select public.history_day_totals('-infinity'::date);

-- Totais do gráfico: 23:55 de Brasília, depois da foto das 23:50 (cron.schedule troca o job de mesmo nome).
select cron.schedule('price-totals', '55 2 * * *', $$ select public.history_day_totals(); $$);

-- A API (PostgREST) passa a ver a tabela e a função novas na hora.
notify pgrst, 'reload schema';
