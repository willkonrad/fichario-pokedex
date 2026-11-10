import { printedNumber } from '@/lib/card-number';

/**
 * Link para abrir a carta na LigaPokemon (só o link: os preços do app vêm do MYP Cards).
 * A busca "Nome em inglês (número/total)" leva direto à edição exata da carta.
 */

/**
 * Busca no formato da Liga, com o número como impresso (ver printedNumber): "Alakazam EX (25/124)", "Charmander
 * (011/094)", "Gardevoir (TG05/TG30)". Sem total impresso (promo, "RC5" em Gerações), só o nome, como na Consulta.
 */
export function ligaQuery(nameEn: string, localId?: string, setTotal?: number, set: { setId?: string; setName?: string } = {}) {
  const number = printedNumber({ localId, total: setTotal, ...set });
  return number.includes('/') ? `${nameEn} (${number})` : nameEn;
}

export function ligaSearchUrl(query: string) {
  return `https://www.ligapokemon.com.br/?view=cards/search&card=${encodeURIComponent(query)}`;
}
