-- Auditoria do índice da Consulta (public.lookup_index). Só SELECT: não grava nada e não é objeto do banco.
-- Rodar depois da recópia, e sempre que lookup_build() mudar:
--   npx --yes supabase@2.121.0 db query --linked --project-ref <ref> --file scripts/lookup-audit.sql
-- Cada linha é uma conferência; as que falharam vêm primeiro. Pronto = nenhuma com ok = false.
-- As conferências de HP só passam depois da recópia, quando o catálogo já tem o campo.

with idx as (
  select body, md5, format, lines, bytes from public.lookup_index where id = 1
),
head as (
  select split_part(body, E'\n', 1)::jsonb as h from idx
),
sets as (
  select s.key, s.value as v from head cross join lateral jsonb_each(h->'sets') s
),
raw as (
  select t.l, t.ord
  from idx cross join lateral string_to_table(body, E'\n') with ordinality as t(l, ord)
),
marked as (
  select r.l, r.ord, max(r.ord) filter (where r.l ~ '^@[0-9]+$') over (order by r.ord) as head_ord
  from raw r
  where r.ord > 1
),
sections as (
  select ord, substr(l, 2)::integer as dex, row_number() over (order by ord) as pos from marked where l ~ '^@[0-9]+$'
),
cards as (
  select s.dex, string_to_array(m.l, E'\t') as c
  from marked m join sections s on s.ord = m.head_ord
  where m.l !~ '^@[0-9]+$'
),
rowsx as (
  select dex, c[1] as id, c[2] as set_key, c[3] as name, c[4] as no, c[5] as alt, c[6] as rarity, c[7] as stamp, c[8] as q,
    c[9] as hp, c[10] as card_type, c[11] as stage, c[12] as td, c[13] as prices, coalesce(c[14], '') as langs, c[15] as pn,
    c[16] as twin, c[17] as year, c[18] as img
  from cards
),
w as (
  -- Testemunha com a coleção junto. Carta de duas espécies aparece em duas seções; aqui, uma vez.
  select distinct on (r.id) r.*, s.v->>3 as set_date, (s.v->>5)::integer as y_from, (s.v->>6)::integer as y_to
  from rowsx r left join sets s on s.key = r.set_key
  order by r.id, r.dex
),
checks (carta, esperado, obtido, ok) as (
  -- ----- O arquivo como um todo -----
  select 'índice', 'existe, formato 1', coalesce((select 'formato ' || format from idx), 'sem linha'), (select format = 1 from idx) is true
  union all
  select 'md5', 'igual ao do corpo', (select md5 from idx), (select md5 = md5(body) from idx) is true
  union all
  select 'bytes', 'igual ao do corpo', (select bytes::text from idx), (select bytes = octet_length(body) from idx) is true
  union all
  select 'linhas', 'coluna lines = cartas no texto e 50.000 ou mais', (select count(*)::text from rowsx),
    (select lines = (select count(*) from rowsx) and lines >= 50000 from idx) is true
  union all
  select 'seções', '@0 por último, as outras em ordem crescente',
    (select string_agg(dex::text, ',' order by pos) from (select * from sections order by pos desc limit 3) x),
    not exists (select 1 from sections a join sections b on b.pos = a.pos + 1 where a.dex = 0 or (b.dex <> 0 and b.dex <= a.dex))
      and (select dex from sections order by pos desc limit 1) = 0
  union all
  select 'coleções', 'toda linha aponta para uma coleção do cabeçalho', (select count(*)::text from rowsx r where not exists (select 1 from sets s where s.key = r.set_key)) || ' sem coleção',
    not exists (select 1 from rowsx r where not exists (select 1 from sets s where s.key = r.set_key))
  union all
  select 'línguas', 'toda linha tem língua, só das letras e p u j k i t c', (select count(*)::text from rowsx where langs !~ '^[epujkitc]+$') || ' erradas',
    not exists (select 1 from rowsx where langs !~ '^[epujkitc]+$')
  union all
  select 'repetidas', 'nenhuma carta duas vezes na mesma seção', (select count(*)::text from (select dex, id from rowsx group by 1, 2 having count(*) > 1) x) || ' repetidas',
    not exists (select 1 from rowsx group by dex, id having count(*) > 1)
  union all
  select 'KO e ZH', 'nunca marcadas em linha inglesa', (select count(*)::text from rowsx where langs ~ 'e' and langs ~ '[kitc]') || ' erradas',
    not exists (select 1 from rowsx where langs ~ 'e' and langs ~ '[kitc]')
  union all
  select 'gêmeas', 'twin só em linha chinesa', (select count(*)::text from rowsx where twin is not null and twin <> '' and langs !~ '[tc]') || ' erradas',
    not exists (select 1 from rowsx where twin is not null and twin <> '' and langs !~ '[tc]')
  union all
  select 'preço por carta', 'preço só em linha com produto', (select count(*)::text from rowsx where id like 't:%' and prices is not null and prices <> '') || ' erradas',
    not exists (select 1 from rowsx where id like 't:%' and prices is not null and prices <> '')
  -- ----- Testemunhas (seção 12 da especificação) -----
  union all
  -- A TCGdex pt lista a coleção base1 sem nenhuma carta: pela regra a marca é u; se a lista vier a ter a carta, vira p.
  select '42382 Charizard Base Set', '4/102, PT (p ou u), ano 1999, HP 120', no || ' · ' || langs || ' · ' || left(set_date, 4) || ' · HP ' || coalesce(hp, '?'),
    no = '4/102' and langs ~ '[pu]' and left(set_date, 4) = '1999' and coalesce(year, '') = '' and hp = '120'
  from w where id = '42382'
  union all
  select '106999 Charizard Shadowless', 'sem marca PT, impressões 1ª edição e Unlimited', langs || ' · ' || coalesce(prices, ''),
    langs !~ '[pu]' and prices ~ '(^|\|)1H?:' and prices ~ '(^|\|)UH?:'
  from w where id = '106999'
  union all
  select '252517 Charizard Metal Card', 'selo, year 1999o, sem p', coalesce(stamp, '') || ' · ' || coalesce(year, '') || ' · ' || langs,
    stamp is not null and year = '1999o' and langs !~ 'p'
  from w where id = '252517'
  union all
  select '250320 Charizard Classic Collection', '2021, 4/102', left(set_date, 4) || ' · ' || no,
    left(set_date, 4) = '2021' and no = '4/102'
  from w where id = '250320'
  union all
  select '567024 Umbreon 070/108', 'JP, 2023, preço Normal', langs || ' · ' || left(set_date, 4) || ' · ' || coalesce(prices, ''),
    langs ~ 'j' and left(set_date, 4) = '2023' and prices ~ '(^|\|)N:'
  from w where id = '567024'
  union all
  select '609309 Vigoroth 070/108', 'o número traz Vigoroth e Umbreon',
    (select string_agg(id, ', ' order by id) from w where id in ('609309', '567024') and regexp_replace(lower(no), '^0+', '') = '70/108'),
    (select count(*) from w where id in ('609309', '567024') and regexp_replace(lower(no), '^0+', '') = '70/108') = 2
  union all
  select '568335 Roselia SV5K 001/071', 'k; zh-tw SV5K-001 com twin 568335',
    (select langs from w where id = '568335') || ' · twin ' || coalesce((select twin from w where id = 't:zh-tw:SV5K-001'), '?'),
    (select langs ~ 'k' from w where id = '568335') and (select twin = '568335' from w where id = 't:zh-tw:SV5K-001')
  union all
  select '680962 Pikachu SV-P', 'no 120/SV-P, alt 291/SV-P', no || ' · ' || coalesce(alt, ''), no = '120/SV-P' and alt = '291/SV-P'
  from w where id = '680962'
  union all
  select '614744 Brock''s Geodude', 'q LV.17', coalesce(q, ''), q = 'LV.17'
  from w where id = '614744'
  union all
  select '571309 Morpeko V-UNION', 'número limpo, q Top Left', no || ' · ' || coalesce(q, ''), no = '056/184' and q = 'Top Left'
  from w where id = '571309'
  union all
  select '614370 Charizard McDonald''s 2024', 'ano 2024', coalesce(nullif(year, ''), left(set_date, 4)), coalesce(nullif(year, ''), left(set_date, 4)) = '2024'
  from w where id = '614370'
  union all
  select '477355 Torchic WCD', 'year 2004n', coalesce(year, ''), year = '2004n'
  from w where id = '477355'
  union all
  select '42425 Machamp Deck Exclusives', 'year 1999o, sem p', coalesce(year, '') || ' · ' || langs, year = '1999o' and langs !~ 'p'
  from w where id = '42425'
  union all
  select '500263 Pikachu SVP 027', 'faixa 2023–2025', y_from || '–' || y_to, y_from = 2023 and y_to = 2025
  from w where id = '500263'
  union all
  select '610590 Eevee Poké Ball PRE', 'linha própria, selo', coalesce(stamp, ''), stamp ~* 'pok[eé] ?ball'
  from w where id = '610590'
  union all
  select '566726 Pikachu Master Ball SV2a', 'linha própria, selo', coalesce(stamp, ''), stamp ~* 'master ?ball'
  from w where id = '566726'
  union all
  select '617462 Pikachu Vending', 'Sem ano', coalesce(year, '') || ' · ' || coalesce(set_date, 'sem data'),
    (year = '-' or (coalesce(year, '') = '' and set_date is null))
  from w where id = '617462'
  union all
  select '509812 Finizen', 'td sv03-060, nome sem número', coalesce(td, '') || ' · ' || name, td = 'sv03-060' and name = 'Finizen'
  from w where id = '509812'
  union all
  select 'SVAM-001 zh-tw', 'twin 591244 Shroomish, não Alomomola', coalesce(twin, ''), twin = '591244'
  from w where id = 't:zh-tw:SVAM-001'
  union all
  select 'Charizard Spirit Link', 'seção 0', (select string_agg(distinct dex::text, ',') from rowsx where name = 'Charizard Spirit Link'),
    exists (select 1 from rowsx where name = 'Charizard Spirit Link')
      and not exists (select 1 from rowsx where name = 'Charizard Spirit Link' and dex <> 0)
),
expected (carta) as (
  values ('42382 Charizard Base Set'), ('106999 Charizard Shadowless'), ('252517 Charizard Metal Card'), ('250320 Charizard Classic Collection'),
    ('567024 Umbreon 070/108'), ('609309 Vigoroth 070/108'), ('568335 Roselia SV5K 001/071'), ('680962 Pikachu SV-P'), ('614744 Brock''s Geodude'),
    ('571309 Morpeko V-UNION'), ('614370 Charizard McDonald''s 2024'), ('477355 Torchic WCD'), ('42425 Machamp Deck Exclusives'), ('500263 Pikachu SVP 027'),
    ('610590 Eevee Poké Ball PRE'), ('566726 Pikachu Master Ball SV2a'), ('617462 Pikachu Vending'), ('509812 Finizen'), ('SVAM-001 zh-tw'), ('Charizard Spirit Link')
),
missing as (
  -- Testemunha que nem apareceu no índice também é falha.
  select e.carta, 'presente no índice' as esperado, 'ausente' as obtido, false as ok
  from expected e
  where not exists (select 1 from checks c where c.carta = e.carta)
)
select coalesce(ok, false) as ok, carta, esperado, obtido
from (select * from checks union all select * from missing) x
order by coalesce(ok, false), carta;
