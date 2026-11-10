import { portalLinks } from '@/lib/lookup-links';
import type { LinkContext, LookupLang } from '@/lib/lookup-types';

import { jaCard, lookupCard, zhCard, zhSet } from './lookup-fixtures';

// Links da folha (seção 9): Liga e MYP sempre primeiro, ordem por idioma, estado e número exibido.

const links = (over: Partial<LinkContext> & Pick<LinkContext, 'lang'>) => portalLinks({ card: lookupCard(), condition: 'NM', ...over });
const ids = (list: { id: string }[]) => list.map((l) => l.id);
const url = (list: { id: string; url: string }[], id: string) => list.find((l) => l.id === id)!.url;

const CASES: [LookupLang, LinkContext['card']][] = [
  ['pt', lookupCard({ marks: 'ep' })],
  ['en', lookupCard()],
  ['ja', jaCard()],
  ['ko', jaCard({ marks: 'jk' })],
  ['zh', zhCard()],
];

describe('ordem dos portais', () => {
  it.each(CASES)('%s: Liga e MYP sempre nas duas primeiras posições', (lang, card) => {
    expect(ids(portalLinks({ card, lang, condition: 'NM' }).main).slice(0, 2)).toEqual(['liga', 'myp']);
  });

  it('PT', () => {
    const r = links({ lang: 'pt' });
    expect(ids(r.main)).toEqual(['liga', 'myp', 'tcgplayer', 'ebay', 'pricecharting', 'cardmarket']);
    expect(r.main[2].label).toBe('TCGplayer (versão EN)');
    expect(r.more).toEqual([]);
  });

  it('EN', () => {
    const r = links({ lang: 'en' });
    expect(ids(r.main)).toEqual(['liga', 'myp', 'tcgplayer', 'ebay', 'pricecharting', 'cardmarket']);
    expect(r.main[2].label).toBe('TCGplayer');
    expect(r.more).toEqual([]);
  });

  it('JP', () => {
    const r = portalLinks({ card: jaCard(), lang: 'ja', condition: 'NM' });
    expect(ids(r.main)).toEqual(['liga', 'myp', 'tcgplayer', 'snkrdunk', 'cardrush', 'mercari']);
    expect(r.main[2].label).toBe('TCGplayer');
    expect(ids(r.more)).toEqual(['ebay', 'pricecharting']);
  });

  it('KO', () => {
    const r = portalLinks({ card: jaCard({ marks: 'jk' }), lang: 'ko', condition: 'NM' });
    expect(ids(r.main)).toEqual(['liga', 'myp', 'collectory', 'bunjang', 'ebay', 'tcgplayer']);
    expect(r.main[5].label).toBe('TCGplayer (versão JP)');
    expect(ids(r.more)).toEqual(['pricecharting']);
  });

  it('ZH tradicional', () => {
    const r = portalLinks({ card: zhCard(), lang: 'zh', condition: 'NM' });
    expect(ids(r.main)).toEqual(['liga', 'myp', 'collectory', 'ebay', 'pricecharting', 'tcgplayer']);
    expect(ids(r.more)).toEqual(['official-tw']);
  });

  it('ZH simplificado', () => {
    expect(ids(portalLinks({ card: zhCard({ set: zhSet({ lang: 'zh-cn' }) }), lang: 'zh', condition: 'NM' }).more)).toEqual(['cardtrader']);
  });
});

describe('TCGplayer: idioma e estado', () => {
  it.each([
    ['M', 'Near+Mint'],
    ['NM', 'Near+Mint'],
    ['SP', 'Lightly+Played'],
    ['MP', 'Moderately+Played'],
    ['HP', 'Heavily+Played'],
    ['D', 'Damaged'],
  ] as const)('estado %s', (condition, param) => {
    expect(url(links({ lang: 'en', condition }).main, 'tcgplayer')).toBe(`https://www.tcgplayer.com/product/42382?Language=English&Condition=${param}`);
  });

  it('PT abre a versão inglesa, o mesmo produto', () => {
    expect(url(links({ lang: 'pt', condition: 'SP' }).main, 'tcgplayer')).toBe('https://www.tcgplayer.com/product/42382?Language=English&Condition=Lightly+Played');
  });

  it('JP abre em japonês, com o estado', () => {
    expect(url(portalLinks({ card: jaCard(), lang: 'ja', condition: 'HP' }).main, 'tcgplayer')).toBe('https://www.tcgplayer.com/product/567024?Language=Japanese&Condition=Heavily+Played');
  });

  it('KO abre a própria linha JP', () => {
    expect(url(portalLinks({ card: jaCard({ marks: 'jk' }), lang: 'ko', condition: 'D' }).main, 'tcgplayer')).toBe('https://www.tcgplayer.com/product/567024?Language=Japanese&Condition=Damaged');
  });

  it('ZH abre a gêmea japonesa', () => {
    expect(url(portalLinks({ card: zhCard(), lang: 'zh', condition: 'MP' }).main, 'tcgplayer')).toBe('https://www.tcgplayer.com/product/568335?Language=Japanese&Condition=Moderately+Played');
  });

  it('sem produto: a busca, na linha de produtos certa', () => {
    const ptOnly = lookupCard({ key: 't:pt:x', productId: null, name: 'Pikachu', number: '25/102' });
    expect(url(portalLinks({ card: ptOnly, lang: 'pt', condition: 'NM' }).main, 'tcgplayer')).toBe('https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=Pikachu%2025%2F102&view=grid');
    const zhNoTwin = zhCard({ twinProductId: undefined });
    expect(url(portalLinks({ card: zhNoTwin, lang: 'zh', condition: 'NM' }).main, 'tcgplayer')).toContain('/search/pokemon-japan/product?productLineName=pokemon-japan&q=');
  });
});

describe('número exibido', () => {
  const tg = lookupCard({ name: 'Pikachu VMAX', number: 'TG05/TG30', rarity: 'Trainer Gallery' });

  it('Liga usa o número do índice, não o total da coleção ("TG05/195")', () => {
    const liga = url(portalLinks({ card: tg, lang: 'en', condition: 'NM' }).main, 'liga');
    expect(decodeURIComponent(liga)).toContain('card=Pikachu VMAX (TG05/TG30)');
    expect(liga).not.toContain('195');
  });

  it('eBay e PriceCharting levam o mesmo número', () => {
    const r = portalLinks({ card: tg, lang: 'en', condition: 'NM' });
    expect(decodeURIComponent(url(r.main, 'ebay'))).toContain('_nkw=Pikachu VMAX TG05/TG30');
    expect(decodeURIComponent(url(r.main, 'pricecharting'))).toContain('q=Pikachu VMAX TG05/TG30');
  });

  it('carta antiga, com o número sem zeros', () => {
    expect(url(links({ lang: 'en' }).main, 'liga')).toBe('https://www.ligapokemon.com.br/?view=cards/search&card=Charizard%20(4%2F102)');
  });
});

describe('Liga', () => {
  it('JP, KO e ZH: só o nome', () => {
    expect(url(portalLinks({ card: jaCard(), lang: 'ja', condition: 'NM' }).main, 'liga')).toBe('https://www.ligapokemon.com.br/?view=cards/search&card=Umbreon');
    expect(url(portalLinks({ card: jaCard({ marks: 'jk' }), lang: 'ko', condition: 'NM' }).main, 'liga')).toBe('https://www.ligapokemon.com.br/?view=cards/search&card=Umbreon');
  });

  it('ZH busca pelo nome inglês da espécie', () => {
    expect(url(portalLinks({ card: zhCard(), lang: 'zh', condition: 'NM' }).main, 'liga')).toBe('https://www.ligapokemon.com.br/?view=cards/search&card=Roselia');
  });

  it('ZH de treinador (sem espécie): o nome em inglês da gêmea japonesa nas lojas, nunca o nome em chinês', () => {
    const trainer = zhCard({ dex: 0, name: '博士的研究', number: '070/071' });
    const r = portalLinks({ card: trainer, lang: 'zh', condition: 'NM', twinName: "Professor's Research" });
    expect(decodeURIComponent(url(r.main, 'liga'))).toBe("https://www.ligapokemon.com.br/?view=cards/search&card=Professor's Research");
    expect(decodeURIComponent(url(r.main, 'myp'))).toContain("ProdutoSearch[query]=Professor's Research&");
    expect(decodeURIComponent(url(r.main, 'ebay'))).toContain("_nkw=Professor's Research 070/071");
    expect(decodeURIComponent(url(r.main, 'pricecharting'))).toContain("q=Professor's Research 070/071");
    // Gêmea também com o nome em japonês: não serve; fica o da linha.
    const ja = portalLinks({ card: trainer, lang: 'zh', condition: 'NM', twinName: '博士の研究' });
    expect(decodeURIComponent(url(ja.main, 'liga'))).toContain('card=博士的研究');
    // Com espécie, ela continua na frente.
    expect(url(portalLinks({ card: zhCard(), lang: 'zh', condition: 'NM', twinName: 'Roselia ex' }).main, 'liga')).toContain('card=Roselia');
  });

  it('promo sem total: só o nome', () => {
    expect(url(portalLinks({ card: lookupCard({ name: 'Pikachu', number: 'SWSH020' }), lang: 'en', condition: 'NM' }).main, 'liga')).toBe('https://www.ligapokemon.com.br/?view=cards/search&card=Pikachu');
  });
});

describe('MYP', () => {
  const mypUrl = (lang: LookupLang) => `https://mypcards.com/pokemon?ProdutoSearch%5Bquery%5D=Charizard&ProdutoSearch%5BidiomasSelecionados%5D%5B%5D=`;

  it.each([
    ['pt', 1],
    ['en', 2],
    ['ja', 7],
    ['ko', 8],
    ['zh', 10],
  ] as const)('idioma %s, sem número no termo', (lang, id) => {
    expect(url(links({ lang }).main, 'myp')).toBe(`${mypUrl(lang)}${id}`);
  });

  it('o link que a consulta na hora trouxe substitui a busca', () => {
    expect(url(links({ lang: 'pt', mypUrl: 'https://mypcards.com/pokemon/produto/1' }).main, 'myp')).toBe('https://mypcards.com/pokemon/produto/1');
  });
});

describe('outros portais', () => {
  const ja = () => portalLinks({ card: jaCard({ dex: 197, name: 'Umbreon', number: '070/108' }), lang: 'ja', condition: 'NM' });

  it('eBay em vendidos', () => {
    expect(url(links({ lang: 'en' }).main, 'ebay')).toBe('https://www.ebay.com/sch/i.html?_nkw=Charizard%204%2F102&_sacat=183454&LH_Sold=1&LH_Complete=1');
  });

  it('PriceCharting e Cardmarket', () => {
    const main = links({ lang: 'en' }).main;
    expect(url(main, 'pricecharting')).toBe('https://www.pricecharting.com/search-products?q=Charizard%204%2F102&type=prices');
    expect(url(main, 'cardmarket')).toBe('https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=Charizard');
  });

  it('SNKRDUNK em inglês; Card Rush e Mercari em japonês', () => {
    expect(url(ja().main, 'snkrdunk')).toBe('https://snkrdunk.com/en/search/result?keyword=Umbreon%20070%2F108');
    expect(decodeURIComponent(url(ja().main, 'cardrush'))).toBe('https://www.cardrush-pokemon.jp/product-list?keyword=ブラッキー 070/108');
    expect(decodeURIComponent(url(ja().main, 'mercari'))).toBe('https://jp.mercari.com/search?keyword=ブラッキー 070/108&status=sold_out');
  });

  it('páginas fixas', () => {
    expect(url(portalLinks({ card: zhCard({ set: zhSet({ lang: 'zh-cn' }) }), lang: 'zh', condition: 'NM' }).more, 'cardtrader')).toBe('https://www.cardtrader.com/en/games/pokemon/expansions/simplified-chinese-products/blueprints_search');
    expect(url(portalLinks({ card: zhCard(), lang: 'zh', condition: 'NM' }).more, 'official-tw')).toBe('https://asia.pokemon-card.com/tw/card-search/');
  });

  it('termo com caractere especial vai codificado', () => {
    const r = portalLinks({ card: lookupCard({ name: "Farfetch'd & Friends?", number: '' }), lang: 'en', condition: 'NM' });
    expect(url(r.main, 'ebay')).toContain('_nkw=Farfetch\'d%20%26%20Friends%3F&');
  });

  it('nenhum link aponta para o TCGCSV', () => {
    for (const [lang, card] of CASES) {
      const { main, more } = portalLinks({ card, lang, condition: 'NM' });
      for (const l of [...main, ...more]) expect(l.url).not.toMatch(/tcgcsv/i);
    }
  });
});
