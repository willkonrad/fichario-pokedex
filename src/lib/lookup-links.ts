// Links da folha da carta (seção 9). Só endereços: nada é lido desses sites.

import { getSpecies } from '@/data/pokedex';
import { hasJapaneseScript, ligaSearchUrl, mypSearchUrl } from '@/lib/liga';
import type { LinkContext, LookupCard, LookupLang, PortalLink } from '@/lib/lookup-types';
import type { Condition } from '@/lib/types';

const TCG_CONDITION: Record<Condition, string> = {
  M: 'Near+Mint',
  NM: 'Near+Mint',
  SP: 'Lightly+Played',
  MP: 'Moderately+Played',
  HP: 'Heavily+Played',
  D: 'Damaged',
};

const q = encodeURIComponent;
const isChinese = (card: LookupCard) => card.set.lang === 'zh-tw' || card.set.lang === 'zh-cn';

/**
 * Nome em inglês, para as lojas que cadastram em inglês: nas linhas chinesas (nome em chinês), o da espécie; sem espécie
 * (treinador, energia), o do produto gêmeo da TCGplayer japonesa, quando ele está em inglês.
 */
function nameEn(card: LookupCard, twinName?: string) {
  if (!isChinese(card)) return card.name;
  const twin = twinName && !hasJapaneseScript(twinName) ? twinName : undefined;
  return getSpecies(card.dex)?.name ?? twin ?? card.name;
}
const withNumber = (name: string, card: LookupCard) => (card.number ? `${name} ${card.number}` : name);

function liga(card: LookupCard, lang: LookupLang, name: string): PortalLink {
  // Número só nas cartas internacionais com total impresso; o resto, pelo nome.
  const numbered = (lang === 'pt' || lang === 'en') && card.number.includes('/');
  return { id: 'liga', label: 'Liga', url: ligaSearchUrl(numbered ? `${name} (${card.number})` : name) };
}

function myp(lang: LookupLang, name: string, mypUrl?: string): PortalLink {
  return { id: 'myp', label: 'MYP', url: mypUrl ?? mypSearchUrl(name, lang) };
}

function tcgplayer(card: LookupCard, lang: LookupLang, condition: Condition, name: string): PortalLink {
  const japanese = lang === 'ja' || lang === 'ko' || lang === 'zh';
  const label = lang === 'pt' ? 'TCGplayer (versão EN)' : lang === 'ko' || lang === 'zh' ? 'TCGplayer (versão JP)' : 'TCGplayer';
  const product = isChinese(card) ? card.twinProductId : (card.productId ?? undefined);
  if (product != null) {
    return { id: 'tcgplayer', label, url: `https://www.tcgplayer.com/product/${product}?Language=${japanese ? 'Japanese' : 'English'}&Condition=${TCG_CONDITION[condition]}` };
  }
  const line = japanese ? 'pokemon-japan' : 'pokemon';
  return { id: 'tcgplayer', label, url: `https://www.tcgplayer.com/search/${line}/product?productLineName=${line}&q=${q(withNumber(name, card))}&view=grid` };
}

const ebay = (card: LookupCard, name: string): PortalLink => ({
  id: 'ebay',
  label: 'eBay vendidos',
  url: `https://www.ebay.com/sch/i.html?_nkw=${q(withNumber(name, card))}&_sacat=183454&LH_Sold=1&LH_Complete=1`,
});
const priceCharting = (card: LookupCard, name: string): PortalLink => ({
  id: 'pricecharting',
  label: 'PriceCharting',
  url: `https://www.pricecharting.com/search-products?q=${q(withNumber(name, card))}&type=prices`,
});
const cardmarket = (name: string): PortalLink => ({
  id: 'cardmarket',
  label: 'Cardmarket',
  url: `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${q(name)}`,
});

const nameJa = (card: LookupCard) => getSpecies(card.dex)?.ja ?? card.name;
const snkrdunk = (card: LookupCard, name: string): PortalLink => ({ id: 'snkrdunk', label: 'SNKRDUNK', url: `https://snkrdunk.com/en/search/result?keyword=${q(withNumber(name, card))}` });
const cardRush = (card: LookupCard): PortalLink => ({ id: 'cardrush', label: 'Card Rush', url: `https://www.cardrush-pokemon.jp/product-list?keyword=${q(withNumber(nameJa(card), card))}` });
const mercari = (card: LookupCard): PortalLink => ({ id: 'mercari', label: 'Mercari vendidos', url: `https://jp.mercari.com/search?keyword=${q(withNumber(nameJa(card), card))}&status=sold_out` });

const nameKo = (card: LookupCard) => getSpecies(card.dex)?.ko;
const collectory = (card: LookupCard): PortalLink => ({ id: 'collectory', label: 'Collectory', url: `https://collectory.cc/cards?q=${q(nameKo(card) ?? (card.number || card.name))}` });
const bunjang = (card: LookupCard): PortalLink => ({ id: 'bunjang', label: 'Bunjang', url: `https://m.bunjang.co.kr/search/products?q=${q(nameKo(card) ?? card.name)}` });
const CARDTRADER: PortalLink = { id: 'cardtrader', label: 'CardTrader', url: 'https://www.cardtrader.com/en/games/pokemon/expansions/simplified-chinese-products/blueprints_search' };
const OFFICIAL_TW: PortalLink = { id: 'official-tw', label: 'Oficial TW', url: 'https://asia.pokemon-card.com/tw/card-search/' };

/** Liga e MYP sempre nas duas primeiras posições; depois, os portais de cada idioma. */
export function portalLinks(ctx: LinkContext): { main: PortalLink[]; more: PortalLink[] } {
  const { card, lang, condition, mypUrl, twinName } = ctx;
  const en = nameEn(card, twinName);
  const first = [liga(card, lang, en), myp(lang, en, mypUrl)];
  const tcg = tcgplayer(card, lang, condition, en);
  switch (lang) {
    case 'pt':
    case 'en':
      return { main: [...first, tcg, ebay(card, en), priceCharting(card, en), cardmarket(en)], more: [] };
    case 'ja':
      return { main: [...first, tcg, snkrdunk(card, en), cardRush(card), mercari(card)], more: [ebay(card, en), priceCharting(card, en)] };
    case 'ko':
      return { main: [...first, collectory(card), bunjang(card), ebay(card, en), tcg], more: [priceCharting(card, en)] };
    case 'zh':
      return { main: [...first, collectory(card), ebay(card, en), priceCharting(card, en), tcg], more: [card.set.lang === 'zh-cn' ? CARDTRADER : OFFICIAL_TW] };
  }
}
