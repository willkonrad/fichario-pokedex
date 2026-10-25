-- 3.0.2 — Data de lançamento das coleções do catálogo (TCGCSV "publishedOn"), para o app mostrar o ano ao lado do nome da
-- coleção na lista de cartas ("Realeza Absoluta Galeria de Galar · 2023"). As coleções da TCGdex vêm com a data pela
-- própria TCGdex; esta coluna cobre as que só existem no catálogo (promos, Battle Academy…).
--
-- Pode rodar mais de uma vez. O catalog-sync preenche a coluna na próxima leitura da lista de coleções do TCGCSV.

alter table public.tcg_groups add column if not exists published_on date;

-- Lê a lista de coleções do TCGCSV de novo na próxima execução (só 2 arquivos), para preencher a data já hoje.
update public.qvmc_cache set fetched_at = '2000-01-01' where key = 'tcgcsv:groups-listed';
