/**
 * Link para abrir a carta na LigaPokemon (só o link: os preços do app vêm do MYP Cards).
 * A busca "Nome em inglês (número/total)" leva direto à edição exata da carta.
 */

/** Busca no formato da Liga: "Alakazam EX (25/124)", "Charmander (011/094)" (total com zeros só se o número tiver). */
export function ligaQuery(nameEn: string, localId?: string, setTotal?: number) {
  if (!localId || !setTotal) return nameEn;
  const total = /^0/.test(localId) ? String(setTotal).padStart(localId.length, '0') : String(setTotal);
  return `${nameEn} (${localId}/${total})`;
}

export function ligaSearchUrl(query: string) {
  return `https://www.ligapokemon.com.br/?view=cards/search&card=${encodeURIComponent(query)}`;
}
