import { useEffect, useState } from 'react';

import { supabase } from './supabase';
import { cached } from './tcgdex';

/** Selos que nunca viram produto à parte na TCGplayer (1ª edição). O da Booster Box vira ("<Coleção> Stamped"). */
const NO_PHOTO = ['1st-edition'];

/**
 * Foto oficial da versão com selo (ex.: Pikachu SVP 027 "Pokémon Center"), pela Edge Function stamp-image, que
 * procura no TCGCSV (catálogo da TCGplayer). null = não existe foto dessa versão. Guardada por 1 semana.
 */
export function stampImage(cardId: string, stampKeys: string[]) {
  return cached(`tcgdex:stampimg:v2:${cardId}:${stampKeys.join(',')}`, async () => {
    if (!supabase) return null;
    const { data, error } = await supabase.functions.invoke<{ image?: string }>('stamp-image', { body: { cardId, stamps: stampKeys } });
    if (error) throw error;
    return data?.image ?? null;
  });
}

/** Foto oficial da versão com selo, se houver (undefined enquanto procura ou quando não existe). */
export function useStampImage(cardId?: string, stampKeys?: string[]) {
  const keys = (stampKeys ?? []).filter((k) => !NO_PHOTO.includes(k));
  const key = cardId && keys.length ? `${cardId}|${keys.join(',')}` : '';
  const [found, setFound] = useState<{ key: string; url?: string }>();

  useEffect(() => {
    if (!key) return;
    const [id, list] = key.split('|');
    let alive = true;
    stampImage(id, list.split(','))
      .then((url) => alive && setFound({ key, url: url ?? undefined }))
      .catch(() => alive && setFound({ key }));
    return () => {
      alive = false;
    };
  }, [key]);

  return found?.key === key ? found.url : undefined;
}
