-- 3.0.3 — Ligação errada do catálogo com a TCGdex: o Groudon 111/103 da coleção nova "ME06: Delta Reign" (grupo 24831)
-- estava ligado ao Groudon Star 111 de "Delta Species" (ex11-111), porque as duas coleções dividem a palavra "Delta" e a
-- carta tem o mesmo nome e número. Era a única carta ligada da coleção, então o app achava que a Delta Reign era a Delta
-- Species (sigla DS na busca do MYP).
--
-- A regra 7 do catalog-sync (link.ts) corrige este e os outros casos parecidos (Team Rocket × Team Rocket Returns,
-- Triumphant × Triumphant Light, kits de treinador, McDonald's 2026 × anos anteriores…) e religa todas as coleções a
-- partir da cópia, 60 por execução. Esta migração só desfaz já o da coleção nova.
--
-- Só dados (o esquema não muda; nada a espelhar em schema.sql). Pode rodar mais de uma vez.

update public.tcg_catalog
set tcgdex_id = null
where product_id = 726563 and tcgdex_id = 'ex11-111';
