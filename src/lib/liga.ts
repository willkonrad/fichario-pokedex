import { printedNumber } from '@/lib/card-number';

/**
 * Link para abrir a carta na LigaPokemon (só o link: os preços do app vêm do MYP Cards).
 * A busca "Nome em inglês (número/total)" leva direto à edição exata da carta.
 */

/**
 * Busca no formato da Liga, com o número como impresso (ver printedNumber): "Alakazam EX (25/124)", "Charmander
 * (011/094)", "Gardevoir (TG05/TG30)". Sem total impresso (promo, "RC5" em Gerações), só o nome, como na Consulta.
 * `promo`: a coleção de promos já decidida por quem chama (a tela da carta usa a mesma regra do número dela).
 */
export function ligaQuery(nameEn: string, localId?: string, setTotal?: number, set: { setId?: string; setName?: string; promo?: boolean } = {}) {
  const number = printedNumber({ localId, total: setTotal, ...set });
  return number.includes('/') ? `${nameEn} (${number})` : nameEn;
}

export function ligaSearchUrl(query: string) {
  return `https://www.ligapokemon.com.br/?view=cards/search&card=${encodeURIComponent(query)}`;
}

/** Idioma no filtro da busca do MYP Cards (ProdutoSearch[idiomasSelecionados][]). */
const MYP_SEARCH_LANG = { pt: 1, en: 2, ja: 7, ko: 8, zh: 10 } as const;

/**
 * Busca no site do MYP Cards pelo nome, só no idioma da carta. É o link quando não há o produto achado pela API: carta
 * japonesa (a API não tem japonesas) ou preço ainda não buscado. Só o link: o app não lê a página.
 */
export function mypSearchUrl(name: string, lang: keyof typeof MYP_SEARCH_LANG) {
  return `https://mypcards.com/pokemon?ProdutoSearch%5Bquery%5D=${encodeURIComponent(name)}&ProdutoSearch%5BidiomasSelecionados%5D%5B%5D=${MYP_SEARCH_LANG[lang]}`;
}

/** Escrita japonesa (kana, kanji, katakana de meia largura); os ideogramas pegam também o chinês. */
const JAPANESE_SCRIPT = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;

/** Nome em escrita japonesa ou chinesa: as lojas brasileiras cadastram em inglês, e a busca por ele viria vazia. */
export const hasJapaneseScript = (name: string) => JAPANESE_SCRIPT.test(name);

/**
 * Nome para buscar uma carta japonesa nas lojas: o do produto da TCGplayer japonesa já é em inglês ("Dark Kadabra") e
 * acha a carta; o nome em japonês (cartas da TCGdex) vira o da espécie em inglês, que as lojas entendem. Sem espécie
 * (treinador, energia), continua em japonês: quem chama confere com hasJapaneseScript.
 */
export function japaneseStoreName(name: string, speciesName?: string) {
  return hasJapaneseScript(name) ? (speciesName ?? name) : name;
}
