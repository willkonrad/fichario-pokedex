-- Fichário Pokédex — gráfico do valor sem função por linha e fila exata do catalog-sync.
--
-- Pode rodar mais de uma vez: só troca, cria e remove funções. Não altera nenhuma linha das tabelas.
--
--   1. collection_history passa a ter a regra do valor escrita na própria consulta. O history_value tem
--      `set search_path = ''`, e por isso o Postgres o executava uma vez por foto (0,3 ms cada): por volta de 26 mil
--      fotos, a consulta passaria dos 8 s de limite da API e o gráfico deixaria de abrir. O history_value sai: ninguém
--      mais o chama, e ele seria mais uma cópia da regra para manter.
--   2. catalog_due_groups devolve só as coleções que o catalog-sync precisa copiar. A API do banco não compara duas
--      colunas, e o filtro largo de antes (alteradas depois da cópia mais antiga) trazia cada vez mais coleções que a
--      função descartava, em toda execução, a cada 10 min (cota de egress do plano Free).
--
-- Aplique antes de publicar o catalog-sync novo, que chama catalog_due_groups.

-- ===== Total da coleção por dia =====

-- Total da coleção por dia desde p_from (sem p_from, todos os dias): a soma do valor escolhido em cada carta (value),
-- as somas dos mínimos, das médias e dos máximos e quantas cartas tinham preço. Roda com as permissões do usuário (só
-- as fotos dele). A variação do período e o histórico de cada carta são calculados no app (src/lib/history.ts).
-- Valor de cada foto, com a mesma regra do app (src/lib/valuation.ts e src/lib/history.ts, snapshotValue): "Meu valor"
-- (mínimo, média e máximo iguais a ele), senão a TCGplayer (só cartas em inglês e japonês, já em reais), senão
-- mínimo/média/máximo do MYP. O mínimo e o máximo nunca ficam do lado de dentro da média, e o valor da carta (pick)
-- segue a escolha gravada na foto (basis; sem ela, a média). Foto sem preço não entra. A regra fica aqui, sem função
-- auxiliar: função com `set search_path` não é embutida na consulta e rodaria uma vez por foto.
create or replace function public.collection_history(p_from date default null)
returns table (day date, value numeric, min numeric, avg numeric, max numeric, cards integer)
language sql stable security invoker set search_path = '' as $$
  with k as (
    select h.day, h.sources as s,
      case
        when jsonb_typeof(h.sources->'manual'->'value') = 'number' then 'manual'
        when h.lang in ('en', 'ja') and jsonb_typeof(h.sources->'tcgplayer'->'avg') = 'number' then 'tcgplayer'
        when jsonb_typeof(h.sources->'mypApi'->'avg') = 'number' then 'mypApi'
      end as kind
    from public.price_history h
    where h.user_id = (select auth.uid()) and (p_from is null or h.day >= p_from)
      -- Fotos antigas de cartas sem preço (só com basis ou campos das fontes antigas) saem logo aqui.
      and h.sources ?| array['manual', 'mypApi', 'tcgplayer']
  ), p as (
    select k.day, k.s, k.kind,
      case when k.kind = 'manual' then (k.s->'manual'->>'value')::numeric else (k.s->k.kind->>'avg')::numeric end as mid,
      case when k.kind <> 'manual' and jsonb_typeof(k.s->k.kind->'min') = 'number' then (k.s->k.kind->>'min')::numeric end as lo,
      case when k.kind <> 'manual' and jsonb_typeof(k.s->k.kind->'max') = 'number' then (k.s->k.kind->>'max')::numeric end as hi
    from k
    where k.kind is not null
  ), r as (
    select p.day, p.s, p.kind, least(coalesce(p.lo, p.mid), p.mid) as lo, p.mid, greatest(coalesce(p.hi, p.mid), p.mid) as hi
    from p
  )
  select r.day,
    round(sum(case
      when r.kind = 'manual' then r.mid
      when r.s->>'basis' = 'min' then r.lo
      when r.s->>'basis' = 'max' then r.hi
      else r.mid
    end), 2),
    round(sum(r.lo), 2), round(sum(r.mid), 2), round(sum(r.hi), 2), count(*)::integer
  from r
  group by r.day
  order by r.day;
$$;
revoke all on function public.collection_history(date) from public, anon;
grant execute on function public.collection_history(date) to authenticated;

-- Saiu: era executada uma vez por foto; a regra está em collection_history.
drop function if exists public.history_value(jsonb, text);

-- ===== Fila do catalog-sync =====

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

-- A API (PostgREST) passa a ver catalog_due_groups na hora.
notify pgrst, 'reload schema';
