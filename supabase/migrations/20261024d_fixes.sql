-- 3.0 — Correções da sincronização e da cópia diária.
--
-- Pode rodar mais de uma vez (idempotente): só troca uma função e cria outra. Não altera nenhuma linha das tabelas.
--
--   1. entries_keep_newer_prices: o preço mais novo devolvido pelo gatilho só vale para a carta no mesmo idioma (como
--      o priceFits do app: trocar a carta EN pela mesma em PT não leva o preço da anterior) e reaplica a regra do
--      "Meu valor" (um envio atrasado, com o "Meu valor" que o preço novo já tinha apagado, não o ressuscita).
--   2. backup.restore_collection: restaura a cópia diária de uma conta com data nova dentro de cada carta, para os
--      aparelhos não mandarem de volta a cópia deles (ver docs/arquitetura.md).

-- ===== 1. Preço mais novo nunca é desfeito (S5), com a regra do "Meu valor" =====
-- Uma carta enviada inteira por um aparelho com o preço mais antigo (do MYP ou da TCGplayer) mantém o preço mais novo
-- que já está no banco, desde que seja desta carta, versão e idioma. Os outros campos são do usuário e seguem o que
-- veio. Se o preço que ficou for mais novo que o "Meu valor" e a média passar dele, vale a mesma regra das funções
-- patch_entry_myp / patch_entry_tcgplayer: o "Meu valor" sai e fica o registro da troca (nas cartas em inglês, pela
-- TCGplayer; nas outras, pelo MYP, desta versão e selo).

create or replace function public.entries_keep_newer_prices()
returns trigger language plpgsql set search_path = '' as $$
declare
  k text;
  p jsonb;
  en boolean;
  v text;
  rule_key text;
  note text;
  mine numeric;
  avg numeric;
begin
  en := coalesce(new.data ->> 'lang', 'pt') = 'en';
  v := coalesce(new.data ->> 'variant', 'normal');
  -- Fonte que apaga o "Meu valor": TCGplayer nas cartas em inglês, MYP nas outras.
  rule_key := case when en then 'tcgplayer' else 'mypApi' end;
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
        note := case when en or v in ('wPromo', 'staff') then coalesce(btrim(new.data ->> 'variantNote'), '') else '' end;
        if mine is not null and avg is not null and avg > mine and coalesce(p ->> 'note', '') = note
           and coalesce(p ->> 'checkedAt', '') > coalesce(new.data -> 'myValue' ->> 'setAt', '') then
          new.data := new.data || jsonb_build_object(
            'myValue', null,
            'myValueReplaced', jsonb_build_object('value', mine, 'mypValue', avg, 'at', p ->> 'checkedAt',
                                                  'source', case when en then 'tcgplayer' else 'myp' end));
        end if;
      end if;
    end if;
  end loop;
  return new;
end;
$$;

-- ===== 2. Restaurar a cópia diária (G1) =====
-- Recoloca as cartas de uma conta como estavam num dia da cópia diária. Cada carta volta com a data de agora dentro de
-- `data` (updatedAt): assim ela vence a cópia que os aparelhos têm e chega a eles na próxima sincronização (com a data
-- antiga, um aparelho com a carta editada depois mandaria a versão dele de volta). Fichários livres da cópia que não
-- existem mais voltam também, com data nova (senão os aparelhos tiram as cartas deles). Nada é apagado: cartas postas
-- depois do dia da cópia ficam, e o preço mais novo do banco fica (gatilho entries_keep_prices). Carta que não estava
-- mais no banco perde o registro de remoção (gatilho entries_untombstone).
-- Uso (SQL Editor): select backup.restore_collection('<id da conta>', '2026-10-24');
create or replace function backup.restore_collection(p_user uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  stamp text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  saved jsonb;
  cur jsonb;
  back jsonb;
  n_entries integer;
  n_binders integer := 0;
begin
  if not exists (select 1 from backup.entries_daily where day = p_day and user_id = p_user)
     and not exists (select 1 from backup.binder_settings_daily where day = p_day and user_id = p_user) then
    raise exception 'Não há cópia de % desta conta.', p_day;
  end if;

  -- Fichários livres da cópia que não existem hoje.
  select data into saved from backup.binder_settings_daily where day = p_day and user_id = p_user;
  if saved is not null then
    select data into cur from public.binder_settings where user_id = p_user for update;
    select coalesce(jsonb_agg(x.b || jsonb_build_object('updatedAt', stamp) order by x.n), '[]'::jsonb) into back
    from jsonb_array_elements(case when jsonb_typeof(saved -> 'extras') = 'array' then saved -> 'extras' else '[]'::jsonb end)
         with ordinality as x(b, n)
    where not exists (
      select 1
      from jsonb_array_elements(case when jsonb_typeof(cur -> 'extras') = 'array' then cur -> 'extras' else '[]'::jsonb end) c
      where c ->> 'id' = x.b ->> 'id');
    n_binders := jsonb_array_length(back);
    if cur is null then
      insert into public.binder_settings (user_id, data)
      values (p_user, case when n_binders > 0 then jsonb_set(saved, '{extras}', back) else saved end);
    elsif n_binders > 0 then
      update public.binder_settings
      set data = jsonb_set(cur, '{extras}',
                           (case when jsonb_typeof(cur -> 'extras') = 'array' then cur -> 'extras' else '[]'::jsonb end) || back)
      where user_id = p_user;
    end if;
  end if;

  insert into public.entries (user_id, id, dex, slot, data)
  select b.user_id, b.id, b.dex, b.slot, jsonb_set(b.data, '{updatedAt}', to_jsonb(stamp))
  from backup.entries_daily b
  where b.day = p_day and b.user_id = p_user
  on conflict (user_id, id) do update set dex = excluded.dex, slot = excluded.slot, data = excluded.data;
  get diagnostics n_entries = row_count;

  return jsonb_build_object('day', p_day, 'entries', n_entries, 'binders', n_binders);
end;
$$;
revoke all on function backup.restore_collection(uuid, date) from public, anon, authenticated;
