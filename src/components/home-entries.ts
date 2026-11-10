import { useSyncExternalStore } from 'react';

import { coalesce, onlyPricesChanged } from '@/lib/coalesce';
import { collectionState, subscribeCollection } from '@/store/collection';

/** Intervalo mínimo entre dois desenhos da home durante uma rodada de preços. */
export const PRICE_RUN_MS = 1000;

const homeEntries = coalesce({ get: () => collectionState().entries, subscribe: subscribeCollection }, onlyPricesChanged, PRICE_RUN_MS);

/**
 * Cartas para a home. Cada preço gravado refazia as contas da coleção inteira; numa rodada de preços (até milhares
 * seguidos), a home desenha no máximo uma vez por segundo. Carta que entra, sai ou muda de bolso aparece na hora.
 * Para gravar (desfazer, mover), leia `collectionState()`: aqui o preço pode estar até 1 s atrasado.
 */
export function useHomeEntries() {
  return useSyncExternalStore(homeEntries.subscribe, homeEntries.getSnapshot, homeEntries.getSnapshot);
}
