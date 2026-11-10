// Links da folha da carta (seção 9). Só endereços: nada é lido desses sites.

import { getSpecies } from '@/data/pokedex';
import { ligaSearchUrl } from '@/lib/liga';
import type { LinkContext, LookupCard, LookupLang, PortalLink } from '@/lib/lookup-types';
import type { Condition } from '@/lib/types';

const MYP_LANG: Record<LookupLang, number> = { pt: 1, en: 2, ja: 7, ko: 8, zh: 10 };
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

/** Nome em inglês: nas linhas chinesas (nome em chinês), o da espécie. */
const nameEn = (card: LookupCard) => (isChinese(card) ? (getSpecies(card.dex)?.name ?? card.name) : card.name);
const withNumber = (name: string, card: LookupCard) => (card.number ? `${name} ${card.number}` : name);

function liga(card: LookupCard, lang: LookupLang): PortalLink {
  // Número só nas cartas internacionais com total impresso; o resto, pelo nome.
  const numbered = (lang === 'pt' || lang === 'en') && card.number.includes('/');
  const name = nameEn(card);
  return { id: 'liga', label: 'Liga', url: ligaSearchUrl(numbered ? `${name} (${card.number})` : name) };
}

function myp(card: LookupCard, lang: LookupLang, mypUrl?: string): PortalLink {
  const search = `https://mypcards.com/pokemon?ProdutoSearch%5Bquery%5D=${q(nameEn(card))}&ProdutoSearch%5BidiomasSelecionados%5D%5B%5D=${MYP_LANG[lang]}`;
  return { id: 'myp', label: 'MYP', url: mypUrl ?? search };
}

function tcgplayer(card: LookupCard, lang: LookupLang, condition: Condition): PortalLink {
  const japanese = lang === 'ja' || lang === 'ko' || lang === 'zh';
  const label = lang === 'pt' ? 'TCGplayer (versão EN)' : lang === 'ko' || lang === 'zh' ? 'TCGplayer (versão JP)' : 'TCGplayer';
  const product = isChinese(card) ? card.twinProductId : (card.productId ?? undefined);
  if (product != null) {
    return { id: 'tcgplayer', label, url: `https://www.tcgplayer.com/product/${product}?Language=${japanese ? 'Japanese' : 'English'}&Condition=${TCG_CONDITION[condition]}` };
  }
  const line = japanese ? 'pokemon-japan' : 'pokemon';
  return { id: 'tcgplayer', label, url: `https://www.tcgplayer.com/search/${line}/product?productLineName=${line}&q=${q(withNumber(nameEn(card), card))}&view=grid` };
}

const ebay = (card: LookupCard): PortalLink => ({
  id: 'ebay',
  label: 'eBay vendidos',
  url: `https://www.ebay.com/sch/i.html?_nkw=${q(withNumber(nameEn(card), card))}&_sacat=183454&LH_Sold=1&LH_Complete=1`,
});
const priceCharting = (card: LookupCard): PortalLink => ({
  id: 'pricecharting',
  label: 'PriceCharting',
  url: `https://www.pricecharting.com/search-products?q=${q(withNumber(nameEn(card), card))}&type=prices`,
});
const cardmarket = (card: LookupCard): PortalLink => ({
  id: 'cardmarket',
  label: 'Cardmarket',
  url: `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${q(nameEn(card))}`,
});

const nameJa = (card: LookupCard) => getSpecies(card.dex)?.ja ?? card.name;
const snkrdunk = (card: LookupCard): PortalLink => ({ id: 'snkrdunk', label: 'SNKRDUNK', url: `https://snkrdunk.com/en/search/result?keyword=${q(withNumber(nameEn(card), card))}` });
const cardRush = (card: LookupCard): PortalLink => ({ id: 'cardrush', label: 'Card Rush', url: `https://www.cardrush-pokemon.jp/product-list?keyword=${q(withNumber(nameJa(card), card))}` });
const mercari = (card: LookupCard): PortalLink => ({ id: 'mercari', label: 'Mercari vendidos', url: `https://jp.mercari.com/search?keyword=${q(withNumber(nameJa(card), card))}&status=sold_out` });

const nameKo = (card: LookupCard) => getSpecies(card.dex)?.ko;
const collectory = (card: LookupCard): PortalLink => ({ id: 'collectory', label: 'Collectory', url: `https://collectory.cc/cards?q=${q(nameKo(card) ?? (card.number || card.name))}` });
const bunjang = (card: LookupCard): PortalLink => ({ id: 'bunjang', label: 'Bunjang', url: `https://m.bunjang.co.kr/search/products?q=${q(nameKo(card) ?? card.name)}` });
const CARDTRADER: PortalLink = { id: 'cardtrader', label: 'CardTrader', url: 'https://www.cardtrader.com/en/games/pokemon/expansions/simplified-chinese-products/blueprints_search' };
const OFFICIAL_TW: PortalLink = { id: 'official-tw', label: 'Oficial TW', url: 'https://asia.pokemon-card.com/tw/card-search/' };

/** Liga e MYP sempre nas duas primeiras posições; depois, os portais de cada idioma. */
export function portalLinks(ctx: LinkContext): { main: PortalLink[]; more: PortalLink[] } {
  const { card, lang, condition, mypUrl } = ctx;
  const first = [liga(card, lang), myp(card, lang, mypUrl)];
  const tcg = tcgplayer(card, lang, condition);
  switch (lang) {
    case 'pt':
    case 'en':
      return { main: [...first, tcg, ebay(card), priceCharting(card), cardmarket(card)], more: [] };
    case 'ja':
      return { main: [...first, tcg, snkrdunk(card), cardRush(card), mercari(card)], more: [ebay(card), priceCharting(card)] };
    case 'ko':
      return { main: [...first, collectory(card), bunjang(card), ebay(card), tcg], more: [priceCharting(card)] };
    case 'zh':
      return { main: [...first, collectory(card), ebay(card), priceCharting(card), tcg], more: [card.set.lang === 'zh-cn' ? CARDTRADER : OFFICIAL_TW] };
  }
}
