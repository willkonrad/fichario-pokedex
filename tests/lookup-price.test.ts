import { LOOKUP_PRICE, lookupChipPrice, lookupChipSpeech, lookupDatesText, mypOffersText, mypPauseText, PRINT_LABEL } from '@/lib/copy';
import { cellPrice, priceBlock } from '@/lib/lookup-price';

import { header, jaCard, jaSet, lookupCard, lookupSet, print, zhCard, zhSet } from './lookup-fixtures';

// Preços da Consulta (seção 8): rótulos, só anúncio, referência sempre rotulada, gêmea única e impressão padrão.

const h = header();
const FX = 5.5;
const twinJp = jaCard({ key: '568335', productId: 568335, prints: [print('N', 200, 100, 150)] });

describe('rótulos', () => {
  it('fala Near Mint no mercado e nunca chama anúncio de mercado', () => {
    expect(LOOKUP_PRICE.market).toBe('Mercado (Near Mint)');
    expect(LOOKUP_PRICE.low).toBe('Menor anúncio');
    expect(LOOKUP_PRICE.low).not.toMatch(/mercado/i);
    expect(LOOKUP_PRICE.listing).not.toMatch(/mercado/i);
    expect(LOOKUP_PRICE.mid).toBe('Mediana dos anúncios');
  });

  it('referência diz de qual versão veio', () => {
    expect(LOOKUP_PRICE.refEn).toBe('TCGplayer, versão inglesa');
    expect(LOOKUP_PRICE.refJa).toBe('TCGplayer, versão japonesa');
    expect(LOOKUP_PRICE.refShortEn).toBe('ref. EN');
    expect(LOOKUP_PRICE.refShortJa).toBe('ref. JP');
  });

  it('todas as impressões têm nome', () => {
    for (const code of ['N', 'H', 'R', '1', '1H', 'U', 'UH'] as const) expect(PRINT_LABEL[code]).toBeTruthy();
  });

  it('data dos preços e do câmbio juntas', () => {
    expect(lookupDatesText({ pricesDay: '2026-11-08', fxDay: '2026-11-06', fxSell: 5.5013 })).toBe('preços de 08/11 · PTAX 5,5013 de 06/11');
  });

  it('com o valor em dólar, a conta inteira', () => {
    const line = lookupDatesText({ pricesDay: '2026-11-08', fxDay: '2026-11-06', fxSell: 5.5013, usd: 111.2 }).replace(/ /g, ' ');
    expect(line).toBe('US$ 111,20 × PTAX 5,5013 de 06/11 · preços de 08/11');
  });

  it('chip de preço: só anúncio e referência sempre escritos', () => {
    const clean = (s: string) => s.replace(/ /g, ' ');
    expect(clean(lookupChipPrice(44, 'market', null))).toBe('R$ 44,00');
    expect(clean(lookupChipPrice(44, 'listing', null))).toBe('anúncio R$ 44,00');
    expect(clean(lookupChipPrice(40, 'market', 'en'))).toBe('ref. EN R$ 40,00');
    expect(clean(lookupChipPrice(40, 'listing', 'ja'))).toBe('ref. JP anúncio R$ 40,00');
    expect(clean(lookupChipSpeech(40, 'listing', 'en'))).toBe('R$ 40,00, menor anúncio, TCGplayer, versão inglesa');
  });

  it('linha do MYP: faixa, ofertas só se vierem, e a pausa', () => {
    const ok = { status: 'ok', min: 480, avg: 600, max: 700, at: '2026-11-09T12:00:00.000Z' } as const;
    // O Intl separa "R$" e o número com espaço fixo.
    const text = (m: Parameters<typeof mypOffersText>[0]) => mypOffersText(m).replace(/ /g, ' ');
    expect(text({ ...ok, qty: 12 })).toBe('R$ 480–700 · 12 ofertas');
    expect(text({ ...ok, qty: 1 })).toBe('R$ 480–700 · 1 oferta');
    expect(text(ok)).toBe('R$ 480–700');
    expect(text({ ...ok, min: 600, max: 600 })).toBe('R$ 600');
    expect(mypPauseText(58)).toBe('MYP pediu uma pausa: 58 s');
  });
});

describe('cellPrice: de que linha vem o preço', () => {
  const ep = lookupCard({ marks: 'ep', prints: [print('H', 10000)] });

  it('EN mostra o mercado, sem referência', () => {
    expect(cellPrice(ep, 'en', h)).toEqual({ kind: 'market', brl: 550, ref: null, morePrints: 0 });
  });

  it('linha ep em "Todos": preço EN sem "ref."', () => {
    expect(cellPrice(ep, null, h)).toMatchObject({ kind: 'market', brl: 550, ref: null });
  });

  it('linha ep com chip PT: o mesmo preço, como referência inglesa', () => {
    expect(cellPrice(ep, 'pt', h)).toMatchObject({ kind: 'market', brl: 550, ref: 'en' });
  });

  it('PT não confirmada também é referência', () => {
    expect(cellPrice(lookupCard({ marks: 'eu' }), 'pt', h).ref).toBe('en');
  });

  it('JP: o preço da própria linha, sem referência', () => {
    expect(cellPrice(jaCard(), 'ja', h)).toMatchObject({ kind: 'market', brl: 38.5, ref: null });
  });

  it('JP de uma linha inglesa não existe: nunca o preço de outro idioma', () => {
    expect(cellPrice(ep, 'ja', h)).toEqual({ kind: 'none', brl: null, ref: null, morePrints: 0 });
  });

  it('EN de uma linha japonesa não existe', () => {
    expect(cellPrice(jaCard(), 'en', h).kind).toBe('none');
  });

  it('KO: a própria linha JP, como referência japonesa', () => {
    expect(cellPrice(jaCard({ marks: 'jk' }), 'ko', h)).toMatchObject({ kind: 'market', ref: 'ja' });
    expect(cellPrice(jaCard({ marks: 'ji' }), 'ko', h)).toMatchObject({ kind: 'market', ref: 'ja' });
  });

  it('KO sem marca não tem referência', () => {
    expect(cellPrice(jaCard({ marks: 'j' }), 'ko', h).kind).toBe('none');
  });

  it('ZH tradicional: a gêmea única, como referência japonesa', () => {
    expect(cellPrice(zhCard(), 'zh', h, twinJp)).toMatchObject({ kind: 'market', brl: 11, ref: 'ja' });
    expect(cellPrice(zhCard(), null, h, twinJp)).toMatchObject({ kind: 'market', ref: 'ja' });
  });

  it('2 candidatos = sem referência: o índice não traz gêmea', () => {
    expect(cellPrice(zhCard({ twinProductId: undefined }), 'zh', h, twinJp)).toEqual({ kind: 'none', brl: null, ref: null, morePrints: 0 });
  });

  it('gêmea passada não é a que o índice aponta: sem referência', () => {
    const wrong = jaCard({ key: '999', productId: 999 });
    expect(cellPrice(zhCard(), 'zh', h, wrong).kind).toBe('none');
  });

  it('gêmea que não é japonesa: sem referência', () => {
    const notJa = lookupCard({ key: '568335', productId: 568335, set: lookupSet() });
    expect(cellPrice(zhCard(), 'zh', h, notJa).kind).toBe('none');
  });

  it('gêmea ainda não carregada: sem referência', () => {
    expect(cellPrice(zhCard(), 'zh', h).kind).toBe('none');
    expect(cellPrice(zhCard(), 'zh', h, null).kind).toBe('none');
  });

  it('ZH simplificado: só links, mesmo com gêmea', () => {
    expect(cellPrice(zhCard({ set: zhSet({ lang: 'zh-cn' }) }), 'zh', h, twinJp).kind).toBe('none');
  });

  it('linha só em PT, sem produto, não tem preço', () => {
    const ptOnly = lookupCard({ key: 't:pt:x', productId: null, set: lookupSet({ lang: 'pt' }), prints: [], marks: 'p' });
    expect(cellPrice(ptOnly, 'pt', h).kind).toBe('none');
    expect(cellPrice(ptOnly, null, h).kind).toBe('none');
  });
});

describe('impressão padrão', () => {
  it('a primeira com mercado, na ordem N, H, U, UH, 1, 1H, R', () => {
    const prints = [print('R', 7), print('1H', 6), print('1', 5), print('UH', 4), print('U', 3), print('H', 2), print('N', 1)];
    expect(priceBlock(lookupCard({ prints }), 'en', h).printCode).toBe('N');
    expect(priceBlock(lookupCard({ prints: prints.slice(0, 6) }), 'en', h).printCode).toBe('H');
    expect(priceBlock(lookupCard({ prints: prints.slice(0, 5) }), 'en', h).printCode).toBe('U');
    expect(priceBlock(lookupCard({ prints: prints.slice(0, 4) }), 'en', h).printCode).toBe('UH');
    expect(priceBlock(lookupCard({ prints: prints.slice(0, 3) }), 'en', h).printCode).toBe('1');
    expect(priceBlock(lookupCard({ prints: prints.slice(0, 2) }), 'en', h).printCode).toBe('1H');
    expect(priceBlock(lookupCard({ prints: prints.slice(0, 1) }), 'en', h).printCode).toBe('R');
  });

  it('impressão sem mercado perde para outra, mais adiante, com mercado', () => {
    const block = priceBlock(lookupCard({ prints: [print('N', null, 10, 20), print('R', 500)] }), 'en', h);
    expect(block).toMatchObject({ printCode: 'R', kind: 'market' });
  });

  it('sem mercado em nenhuma, a primeira com menor anúncio', () => {
    const block = priceBlock(lookupCard({ prints: [print('R', null, 700, null), print('H', null, 400, null)] }), 'en', h);
    expect(block).toMatchObject({ printCode: 'H', kind: 'listing', brl: 22 });
  });

  it('sem nenhum preço, nada', () => {
    expect(priceBlock(lookupCard({ prints: [print('H', null, null, 100)] }), 'en', h).kind).toBe('none');
    expect(priceBlock(lookupCard({ prints: [] }), 'en', h).kind).toBe('none');
  });
});

describe('só anúncio', () => {
  const listing = lookupCard({ prints: [print('H', null, 1000, 1500)] });

  it('na célula é "listing", nunca mercado', () => {
    expect(cellPrice(listing, 'en', h)).toMatchObject({ kind: 'listing', brl: 55 });
  });

  it('na folha também, com o menor anúncio em evidência', () => {
    expect(priceBlock(listing, 'en', h)).toMatchObject({ kind: 'listing', brl: 55, usd: 10, lowBrl: 55, midBrl: 82.5 });
  });
});

describe('referência sempre rotulada', () => {
  it('toda vez que o preço vem de outro idioma, `ref` diz de onde', () => {
    const ep = lookupCard({ marks: 'ep' });
    expect(priceBlock(ep, 'pt', h)).toMatchObject({ ref: 'en', kind: 'market' });
    expect(priceBlock(jaCard({ marks: 'jk' }), 'ko', h)).toMatchObject({ ref: 'ja', kind: 'market' });
    expect(priceBlock(zhCard(), 'zh', h, twinJp)).toMatchObject({ ref: 'ja', kind: 'market', brl: 11 });
  });

  it('o próprio idioma nunca é referência', () => {
    expect(priceBlock(lookupCard(), 'en', h).ref).toBeNull();
    expect(priceBlock(jaCard(), 'ja', h).ref).toBeNull();
  });

  it('referência usa a impressão escolhida; se não existir, não há referência', () => {
    const ep = lookupCard({ marks: 'ep', prints: [print('H', 100)] });
    expect(priceBlock(ep, 'pt', h, null, 'H')).toMatchObject({ ref: 'en', printCode: 'H' });
    expect(priceBlock(ep, 'pt', h, null, 'R')).toMatchObject({ ref: null, printsRef: 'en', kind: 'none', brl: null, printCode: null });
  });

  it('referência de ZH usa as impressões da gêmea', () => {
    expect(priceBlock(zhCard(), 'zh', h, twinJp, 'N').printCode).toBe('N');
    expect(priceBlock(zhCard(), 'zh', h, twinJp, 'H').kind).toBe('none');
  });
});

describe('filtro de variação', () => {
  const card = lookupCard({ prints: [print('N', 100), print('H', 200), print('R', 300), print('1H', 400)] });

  it('sem filtro, a impressão padrão', () => {
    expect(cellPrice(card, 'en', h).brl).toBe(5.5);
  });

  it('com filtro, o preço daquela impressão', () => {
    expect(cellPrice(card, 'en', h, null, 'reverse').brl).toBe(16.5);
    expect(cellPrice(card, 'en', h, null, 'holo').brl).toBe(11);
    expect(cellPrice(card, 'en', h, null, 'firstEdition').brl).toBe(22);
  });

  it('variação sem preço: nada, em vez do preço de outra impressão', () => {
    expect(cellPrice(lookupCard({ prints: [print('N', 100)] }), 'en', h, null, 'holo').kind).toBe('none');
  });

  it('carta que já é a própria versão pelo selo usa a impressão dela', () => {
    expect(cellPrice(jaCard({ stamp: 'Reverse Holofoil', prints: [print('H', 100)] }), 'ja', h, null, 'reverse').brl).toBe(5.5);
  });

  it('filtro de selo não muda a impressão', () => {
    expect(cellPrice(lookupCard({ stamp: 'Staff', prints: [print('H', 100)] }), 'en', h, null, 'staff').brl).toBe(5.5);
  });
});

describe('impressões a mais', () => {
  it('conta só as outras com preço', () => {
    const card = lookupCard({ prints: [print('H', 100), print('R', null, 50, null), print('N', null, null, 20)] });
    expect(cellPrice(card, 'en', h).morePrints).toBe(1);
  });
});

describe('priceBlock: quadro da folha', () => {
  it('converte centavos pelo câmbio, com data', () => {
    expect(priceBlock(lookupCard({ prints: [print('H', 11120, 9000, 9500)] }), 'en', h)).toMatchObject({
      kind: 'market',
      printCode: 'H',
      brl: 611.6,
      usd: 111.2,
      lowBrl: 495,
      midBrl: 522.5,
      pricesDay: '2026-11-08',
      fxDay: '2026-11-06',
      fxSell: FX,
    });
  });

  it('lista as impressões na ordem padrão, com rótulo e tipo', () => {
    const block = priceBlock(lookupCard({ prints: [print('R', null, 100, null), print('H', 200)] }), 'en', h);
    expect(block.prints).toEqual([
      { code: 'H', label: 'Holo', brl: 11, kind: 'market' },
      { code: 'R', label: 'Reverse', brl: 5.5, kind: 'listing' },
    ]);
  });

  it('impressão escolhida nos chips', () => {
    expect(priceBlock(lookupCard({ prints: [print('H', 200), print('R', 100)] }), 'en', h, null, 'R')).toMatchObject({ printCode: 'R', brl: 5.5 });
  });

  it('coleção com preço mais velho mostra o dia dela', () => {
    expect(priceBlock(jaCard({ set: jaSet({ pricesDay: '2026-11-07' }) }), 'ja', h).pricesDay).toBe('2026-11-07');
  });

  it('referência de gêmea mostra o dia da coleção da gêmea', () => {
    const twin = jaCard({ key: '568335', productId: 568335, set: jaSet({ pricesDay: '2026-11-01' }) });
    expect(priceBlock(zhCard(), 'zh', h, twin).pricesDay).toBe('2026-11-01');
  });

  it('sem câmbio não inventa reais', () => {
    const noFx = header({ fx: ['2026-11-06', 0] });
    expect(cellPrice(lookupCard(), 'en', noFx).kind).toBe('none');
    expect(priceBlock(lookupCard(), 'en', noFx).brl).toBeNull();
  });
});
