-- Fichário Pokédex — ano das promos japonesas em CD (Japanese CD Promo).
--
-- Pode rodar mais de uma vez: só grava (ou atualiza) uma linha de lookup_overrides. Não muda nenhuma outra tabela.
--
-- O grupo 24568 da TCGplayer japonesa (categoria 85), "Japanese CD Promo" (Charizard, Blastoise, Venusaur e Misty's
-- Treatment, sem número impresso), vem do TCGCSV com published_on 2025-12-01. As cartas são de 1998–1999 (vendas e
-- catálogos de cartas da época). Sem a correção, a Consulta mostra 2025 e o app punha o grupo na época Megaevolução.
-- O app aplica a mesma correção em src/lib/tcgdex.ts (GROUP_YEARS), porque lê o published_on direto.
--
-- O índice da Consulta pega a correção na próxima montagem (cron lookup-build, 00:10 e 06:10) ou com
-- `select public.lookup_build();`.

insert into public.lookup_overrides (kind, key, value, note)
select 'year_range', g.group_id::text, '1998-1999', 'Data errada no TCGCSV (2025-12-01): ' || g.name || ' é de 1998–1999.'
from public.tcg_groups g
where g.category = 85 and g.group_id = 24568
on conflict (kind, key) do update set value = excluded.value, note = excluded.note;
