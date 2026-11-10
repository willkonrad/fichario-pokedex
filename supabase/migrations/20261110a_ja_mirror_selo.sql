-- Fichário Pokédex — marcador de versão escrito antes do número nas cartas japonesas (categoria 85).
--
-- A TCGplayer japonesa escreve algumas versões Mirror com o marcador antes do número: "Ampharos (Mirror Holofoil) -
-- 033/070", "Larry's Efficiency (Mirror Foil) - 162/187". A regra antiga do catalog-sync deixava o marcador no nome
-- ("Ampharos (Mirror Holofoil)") e a carta sem selo: a Consulta e a lista de escolha a mostravam como uma carta comum
-- com outro nome. A regra nova (link.ts, productName e linkAndStamp) tira o marcador do nome e o grava como selo, mas a
-- religação só roda na categoria 3 e a cópia da 85 só se refaz quando a TCGplayer muda a coleção (JA_COPY_VERSION não
-- sobe: zeraria preços). Esta migração faz nas linhas já copiadas o mesmo que a regra nova faria (11 linhas em
-- 10/11/2026, nas coleções 23909 e 24025).
--
-- Só dados (o esquema não muda; nada a espelhar em schema.sql). Pode rodar mais de uma vez: depois da primeira, as
-- linhas já têm selo e saem do filtro. Só quando nada mais vem entre parênteses ou colchetes depois do número (aí o
-- selo seria só o marcador, como na regra nova). O índice da Consulta pega a mudança na próxima montagem (cron
-- lookup-build) ou com `select public.lookup_build();`.
--
-- Rode esta migração antes de publicar o link.ts novo (ou junto): a segunda parte converte as cartas já salvas desses
-- produtos, que sem ela passariam a valer pelo preço da carta comum (ou ficariam sem preço).

update public.tcg_catalog
set stamp = substring(name from '\((Mirror (?:Holofoil|Foil))\)$'),
  name = btrim(regexp_replace(name, '\s*\(Mirror (?:Holofoil|Foil)\)$', '')),
  updated_at = now()
where category = 85
  and stamp is null
  and name ~ '\(Mirror (?:Holofoil|Foil)\)$'
  and full_name ~ '\(Mirror (?:Holofoil|Foil)\) - [^()\[\]]*$';

-- Cartas já salvas desses produtos ("tcgp-<produto>"): o "Adicionar" as gravou quando o produto ainda não tinha selo,
-- como normal ou holo, sem selo, com o marcador no nome ("Larry's Efficiency (Mirror Foil)"). Com o selo novo, o preço
-- delas sairia da carta comum de mesmo número, como se fosse exato (ou de nenhuma, na carta que só existe Mirror), e a
-- lista não marcaria "tenho" no Mirror. Viram a versão Mirror do produto: reverse, com o selo dele, e o nome sem o
-- marcador — o mesmo que o app faz ao ler a carta (src/lib/entry-upgrade.ts, para as cópias dos aparelhos e as cartas
-- sem conta). Só as que ainda têm o marcador no nome (salvas antes da regra nova) e nenhum selo ou descrição.
--   - A data da carta (updatedAt) fica: uma edição feita depois num aparelho ainda vence na sincronização. O updated_at
--     da linha muda (gatilho entries_touch): os aparelhos recebem a carta convertida.
--   - O preço guardado era da versão antiga e deixa de valer para ela: o app busca o novo (o mesmo produto, agora pelo
--     selo exato).
--   - Sem registro em entry_events: não é uma troca feita pelo colecionador. O gatilho de registro fica desligado só
--     durante este update, num bloco só: se algo falhar, o bloco inteiro volta atrás e o gatilho continua ligado
--     (com ou sem transação em volta do arquivo).
do $$
begin
  alter table public.entries disable trigger entries_log_update;

  update public.entries e
  set data = e.data || jsonb_build_object(
      'variant', 'reverse',
      'variantNote', c.stamp,
      'cardName', btrim(regexp_replace(e.data ->> 'cardName', '\s*\(Mirror (?:Holofoil|Foil)\)$', '')))
  from public.tcg_catalog c
  where c.category = 85
    and c.stamp ~ '^Mirror (?:Holofoil|Foil)$'
    and c.full_name ~ '\(Mirror (?:Holofoil|Foil)\) - [^()\[\]]*$'
    and e.data ->> 'cardId' = 'tcgp-' || c.product_id
    and e.data ->> 'lang' = 'ja'
    and coalesce(btrim(e.data ->> 'variantNote'), '') = ''
    and coalesce(e.data ->> 'variant', 'normal') in ('normal', 'holo', 'reverse')
    and e.data ->> 'cardName' ~ ('\(' || c.stamp || '\)$');

  alter table public.entries enable trigger entries_log_update;
end
$$;
