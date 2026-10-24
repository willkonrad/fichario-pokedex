-- Fichário Pokédex 3.0 — preços e histórico do valor (área "pricing").
--
-- Pode rodar mais de uma vez: só cria ou troca funções e cria um índice. Não apaga nem altera nenhuma linha das
-- tabelas (as fotos antigas sem preço continuam lá e só deixam de entrar nas somas).
--
--   P4  O gráfico pede ao servidor o total de cada dia (collection_history: uma requisição, uma linha por dia) em vez
--       de baixar todas as fotos; a foto diária (snapshot_prices) grava só as cartas com preço.
--   P6  A TCGplayer só vale nas cartas em inglês, na foto e nas somas (uma carta trocada para outro idioma pode ter
--       ficado com o preço antigo da TCGplayer), como no app (src/lib/valuation.ts e src/lib/history.ts).
--   P9  A foto das cartas em inglês usa o preço do dia da TCGplayer (tcg_prices, copiado pelo catalog-sync) e o câmbio
--       mais recente (fx_rates), pela mesma conta do app (src/lib/tcgplayer.ts), sem depender de o app ter sido
--       aberto. Sem preço do dia ou sem câmbio, fica o preço gravado na carta.
--
-- A variação do período (P1) e o histórico de cada carta (E5) são calculados no app a partir das fotos de dois dias e
-- das fotos de uma carta (src/lib/history.ts); não precisam de função no banco.

-- ===== Valor de uma carta numa foto diária =====

-- Mesma regra do app (src/lib/history.ts, snapshotValue): "Meu valor" (mínimo, média e máximo iguais a ele), senão a
-- TCGplayer (só cartas em inglês, já em reais), senão mínimo/média/máximo do MYP. O mínimo e o máximo nunca ficam do
-- lado de dentro da média, e o valor da carta (pick) segue a escolha gravada na foto (basis; sem ela, a média). Foto
-- sem preço (ex.: só com os campos das fontes antigas) não devolve linha.
drop function if exists public.history_value(jsonb, text);
create function public.history_value(s jsonb, p_lang text)
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

-- ===== Total da coleção por dia (gráfico "Evolução do valor") =====

-- Uma linha por dia desde p_from (sem p_from, todos os dias): a soma do valor escolhido em cada carta (value), as somas
-- dos mínimos, das médias e dos máximos e quantas cartas tinham preço. Roda com as permissões do usuário (só as
-- fotos dele).
drop function if exists public.collection_history(date);
create function public.collection_history(p_from date default null)
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

-- Período do gráfico: as fotos de um usuário por dia (a chave primária começa por user_id, entry_id).
create index if not exists price_history_user_day on public.price_history (user_id, day);

-- ===== Foto diária do valor de cada carta (cron "price-snapshot", 23:50 de Brasília) =====

-- Grava uma linha por carta COM PREÇO (as outras não entram em nenhuma soma), com as fontes daquele dia:
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

-- A API (PostgREST) passa a ver collection_history na hora (o Supabase também recarrega sozinho depois de DDL).
notify pgrst, 'reload schema';
