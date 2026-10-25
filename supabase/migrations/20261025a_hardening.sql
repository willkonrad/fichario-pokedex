-- 3.0.1 — Endurecimento do banco antes de abrir o app na internet (avisos 0028 e 0029 do Security Advisor).
--
-- Pode rodar mais de uma vez (idempotente): só tira permissões de execução. Não altera nenhuma tabela nem linha.
--
--   1. entries_tombstone e entries_untombstone são funções de gatilho security definer (gravam em entry_tombstones,
--      onde o usuário não grava) e, pela permissão padrão do Supabase, tinham EXECUTE para anon e authenticated. Fora
--      de um gatilho o Postgres não as roda ("trigger functions can only be called as triggers"), mas a permissão
--      contraria a regra do AGENTS.md e gera os avisos. O Postgres confere o EXECUTE de uma função de gatilho só ao
--      criar o gatilho (o dono, postgres, continua com ele), não quando o gatilho dispara: os gatilhos seguem iguais.
--   2. Pelo mesmo motivo, as outras duas funções de gatilho (touch_updated_at e entries_keep_newer_prices, security
--      invoker, que não estavam nos avisos) também saem da API.
--
-- As outras funções security definer (check_liga_sync_key, relink_catalog, upsert_tcg_prices, snapshot_prices e as do
-- schema backup) já não podem ser chamadas por public, anon nem authenticated.
--
-- Depois de aplicar: get_advisors (security) sem os avisos 0028/0029; no app, remover uma carta e recolocá-la no mesmo
-- bolso (o registro em entry_tombstones aparece e depois some).

revoke execute on function public.entries_tombstone() from public, anon, authenticated;
revoke execute on function public.entries_untombstone() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.entries_keep_newer_prices() from public, anon, authenticated;

-- A API (PostgREST) relê as permissões na hora.
notify pgrst, 'reload schema';
