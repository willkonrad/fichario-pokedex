import { useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { fetchTcgplayerPrices, latestPriceBuild, sameTcgplayerPrice, tcgplayerDue, tcgplayerFor, tcgplayerNote } from '@/lib/tcgplayer';
import type { Entry } from '@/lib/types';
import { useCollection } from '@/store/collection';

/** Olha de novo a cada 3 horas (a cópia do TCGCSV muda 1×/dia). */
const TICK_MS = 3 * 3_600_000;
/** A versão mais recente dos preços é consultada no máximo a cada 10 min. */
const BUILD_CACHE_MS = 10 * 60_000;
/**
 * Carta que já tem preço desta versão e selo, mas continua pendente (coleção que o servidor ainda não copiou de novo,
 * carta sem preço na TCGplayer): o resultado volta igual e não é gravado, então ela é buscada de novo no máximo a cada
 * hora. Carta sem preço desta versão (nova, ou trocou de variação) é sempre buscada: a gravação a tira das pendentes.
 */
const RETRY_MS = 3_600_000;

const tryKey = (e: Entry) => `${e.id}|${e.cardId}|${e.variant}|${tcgplayerNote(e)}`;

/**
 * Grava, em segundo plano, o preço da TCGplayer (EUA) das cartas em inglês: produto e impressão pelo catálogo, preço
 * da cópia diária do TCGCSV e câmbio da PTAX, tudo lido do banco (lib/tcgplayer.ts). Roda no celular e na web (não
 * chama o TCGCSV). Busca cartas novas ou alteradas e renova quando o servidor copia preços novos; preço igual ao
 * guardado não é gravado de novo (nem muda a data da carta nos outros aparelhos).
 */
export function TcgplayerRefresher() {
  const { ready, session, lastSyncAt, entries, applyTcgplayerPrice } = useCollection();
  const [tick, setTick] = useState(0);
  const busy = useRef(false);
  const build = useRef<{ at: number; value?: string }>({ at: 0 });
  // Última busca de cada carta (versão e selo) neste aparelho.
  const tried = useRef(new Map<string, number>());
  // A função muda a cada render do provedor; guardada aqui, não dispara a busca sozinha.
  const applyRef = useRef(applyTcgplayerPrice);
  // Com conta, espera a primeira sincronização: assim parte das cartas como estão na nuvem.
  const canRun = !!supabase && ready && (!session || !!lastSyncAt);

  useEffect(() => {
    applyRef.current = applyTcgplayerPrice;
  }, [applyTcgplayerPrice]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!canRun || busy.current) return;
    const now = Date.now();
    // Só cartas em inglês; sem nenhuma, nem consulta o banco.
    if (!Object.values(entries).some((e) => e.lang === 'en')) return;
    busy.current = true;
    (async () => {
      try {
        if (now - build.current.at > BUILD_CACHE_MS) build.current = { at: now, value: await latestPriceBuild() };
        const due = Object.values(entries).filter(
          (e) => tcgplayerDue(e, build.current.value, now) && (!tcgplayerFor(e) || now - (tried.current.get(tryKey(e)) ?? 0) > RETRY_MS),
        );
        if (!due.length) return;
        const prices = await fetchTcgplayerPrices(due);
        for (const e of due) {
          const price = prices.get(e.id);
          if (!price) continue;
          tried.current.set(tryKey(e), now);
          if (!sameTcgplayerPrice(e, price)) await applyRef.current(e.id, price);
        }
      } catch {
        // Sem internet ou erro do banco: tenta de novo na próxima mudança da coleção ou em 3 horas.
      } finally {
        busy.current = false;
      }
    })();
  }, [canRun, entries, tick]);

  return null;
}
