-- 3.2.0 — Cartas japonesas: foto e preço pela TCGplayer japonesa (categoria 85 do TCGCSV, em dólar convertido pela
-- PTAX, como as cartas em inglês) e as cartas antigas sem número (o lote "Pocket Monsters", 1996–2002) no catálogo.
--
--   1. Regra do valor: "Meu valor" → TCGplayer (cartas em inglês E japonês) → MYP Cards (pt e en). As funções abaixo
--      foram recriadas iguais às da 3.1.0, só com 'en' trocado por 'en' e 'ja' onde a TCGplayer decide o valor:
--        entries_keep_newer_prices  o preço da TCGplayer que fica (mais novo) apaga o "Meu valor" também na japonesa;
--        patch_entry_myp            o MYP nunca apaga o "Meu valor" da japonesa (não é a fonte dela);
--        patch_entry_tcgplayer      a TCGplayer apaga o "Meu valor" também na japonesa;
--        history_value              a foto diária da japonesa vale pela TCGplayer;
--        snapshot_prices            a foto diária grava o preço da TCGplayer também da japonesa.
--      Andam juntas com src/lib/valuation.ts e src/lib/history.ts (snapshotValue) do app.
--   2. Catálogo japonês copiado de novo, com o critério novo das cartas sem número: NÃO é feito aqui. O catalog-sync
--      novo pede a nova cópia sozinho (na 85, link_version guarda a versão da cópia, JA_COPY_VERSION = 8 em
--      supabase/functions/catalog-sync/products.ts; as 461 coleções estão com 0 a 7): 20 coleções por execução, ~4 h,
--      as sem data e as mais antigas primeiro. Todas as coleções da 85, não só as 59 vazias: algumas têm só parte das
--      cartas (as com número), como "Darkness, and to Light..." (1 carta) e "Vending Machine cards Series 3 (Green)"
--      (5). synced_at não é zerado, então os preços das coleções que já têm cartas (como a M5: Abyss Eye) começam na
--      primeira execução, sem esperar a nova cópia.
--   3. Data de lançamento falsa: o TCGCSV manda a data do dia quando a coleção não tem data (POP Series, CoroCoro,
--      Vending Machine… ficaram com 2026-11-06, o dia da última leitura da lista). Fica nula, menos a ME06: Delta
--      Reign, lançada de fato em 06/11/2026. O catalog-sync novo já grava nula a data do dia do build.
--
-- A ordem entre aplicar esta migração e publicar o catalog-sync novo não importa: a função nova não depende de nada
-- daqui, e a antiga não descarta nada por causa daqui (ela não lê a versão da cópia; a nova cópia fica para a função
-- nova). Só a data do dia volta se a função antiga ler a lista de novo antes da publicação (1×/dia, quando o TCGCSV
-- atualiza): a função nova a deixa nula na leitura seguinte, ou rode esta migração de novo. Pode rodar mais de uma vez
-- (create or replace; os updates só mexem no que ainda está errado). O esquema das tabelas não muda.

begin;

-- ----- 1. Regra do valor com as cartas japonesas -----

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
revoke execute on function public.entries_keep_newer_prices() from public, anon, authenticated;

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

-- Valor de uma carta numa foto diária. Mesma regra do app (src/lib/valuation.ts e src/lib/history.ts, snapshotValue):
-- "Meu valor" (mínimo, média e máximo iguais a ele), senão a TCGplayer (só cartas em inglês e japonês, já em reais),
-- senão mínimo/média/máximo do MYP. O mínimo e o máximo nunca ficam do lado de dentro da média, e o valor da carta
-- (pick) segue a escolha gravada na foto (basis; sem ela, a média). Foto sem preço não devolve linha.
create or replace function public.history_value(s jsonb, p_lang text)
returns table (source text, min numeric, avg numeric, max numeric, pick numeric)
language sql immutable set search_path = '' as $$
  with k as (
    select case
      when jsonb_typeof(s->'manual'->'value') = 'number' then 'manual'
      when p_lang in ('en', 'ja') and jsonb_typeof(s->'tcgplayer'->'avg') = 'number' then 'tcgplayer'
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

-- ----- 2. Catálogo japonês copiado de novo: pelo catalog-sync novo (JA_COPY_VERSION), sem passo aqui -----

-- ----- 3. Data de lançamento falsa (a data do dia da leitura da lista) -----

-- Coleções com a data do dia da última leitura da lista do TCGCSV (ou depois), menos a ME06: Delta Reign (categoria 3),
-- que é de fato desse dia. Sem a marca da leitura, nada muda.
update public.tcg_groups g
set published_on = null
where g.published_on >= (
    select (c.fetched_at at time zone 'UTC')::date from public.qvmc_cache c where c.key = 'tcgcsv:groups-listed')
  and not (g.category = 3 and g.name like 'ME06:%');

commit;
