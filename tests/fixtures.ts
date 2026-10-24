// Cartas, fichários e preços de exemplo para os testes (só o que cada teste muda aparece nele).

import {
  DEFAULT_CUSTOM_BINDER,
  DEFAULT_SETTINGS,
  type BinderSettings,
  type CustomBinder,
  type Entry,
  type MypApiPrice,
  type TcgplayerPrice,
} from '@/lib/types';

export const AT = '2026-10-20T12:00:00.000Z';
export const LATER = '2026-10-21T12:00:00.000Z';

/** Pikachu de 151 em português, normal, NM, no espaço do #025 do fichário Pokédex. */
export function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: '25-0',
    dex: 25,
    slot: 0,
    cardId: 'sv03.5-025',
    lang: 'pt',
    cardName: 'Pikachu',
    setName: '151',
    setId: 'sv03.5',
    localId: '025',
    variant: 'normal',
    condition: 'NM',
    updatedAt: AT,
    ...over,
  };
}

/** Preço do MYP buscado para a carta como ela está (mesma carta, versão e selo). */
export function myp(e: Pick<Entry, 'cardId' | 'variant'>, over: Partial<MypApiPrice> = {}): MypApiPrice {
  return { cardId: e.cardId, variant: e.variant, checkedAt: AT, min: 5, avg: 10, max: 20, qty: 7, ...over };
}

/** Preço da TCGplayer (já em reais) buscado para a carta como ela está. */
export function tcg(e: Pick<Entry, 'cardId' | 'variant'>, over: Partial<TcgplayerPrice> = {}): TcgplayerPrice {
  return { cardId: e.cardId, variant: e.variant, checkedAt: AT, min: 8, avg: 12, max: 15, usdMarket: 2.3, fx: 5.2, ...over };
}

export function settings(over: Partial<BinderSettings> = {}): BinderSettings {
  return { ...DEFAULT_SETTINGS, ...over };
}

export function binder(over: Partial<CustomBinder> = {}): CustomBinder {
  return { ...DEFAULT_CUSTOM_BINDER, id: 'b1', name: 'Trocas', createdAt: AT, ...over };
}
