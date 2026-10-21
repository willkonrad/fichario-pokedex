import { supabase } from './supabase';
import type { JornadaQuote } from './types';

/**
 * Pede à função jornada-price o preço das cartas (já salvas na nuvem) na versão exata delas.
 * A função grava o resultado na nuvem e devolve o campo `jornada` de cada carta.
 */
export async function fetchJornadaQuotes(entryIds: string[]): Promise<Record<string, JornadaQuote>> {
  if (!supabase) throw new Error('Supabase não configurado');
  const { data, error } = await supabase.functions.invoke<{ results: { id: string; data?: { jornada?: JornadaQuote } }[] }>(
    'jornada-price',
    { body: { entryIds } },
  );
  if (error) throw error;
  const out: Record<string, JornadaQuote> = {};
  for (const r of data?.results ?? []) if (r.data?.jornada) out[r.id] = r.data.jornada;
  return out;
}

/** Endereço da página da carta na LigaPokemon. */
export function ligaCardUrl(ligaQuery?: string, fallbackName?: string) {
  const card = ligaQuery || fallbackName;
  if (!card) return undefined;
  return `https://www.ligapokemon.com.br/?view=cards/card&card=${encodeURIComponent(card)}`;
}
