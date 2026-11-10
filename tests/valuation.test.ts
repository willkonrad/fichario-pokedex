import { MYP_NO_JAPANESE, RANGE_LABELS, rangeLabelsOf, SOURCE_NAME, TCGPLAYER_SEARCHING } from '@/lib/copy';
import type { Entry } from '@/lib/types';
import {
  cardNoPriceText,
  myValueBelowSource,
  myValuePatch,
  myValueTrigger,
  pickLabel,
  pricePending,
  rangeLabels,
  usPriceGap,
  valuation,
} from '@/lib/valuation';

import { AT, entry, LATER, myp, tcg } from './fixtures';

describe('valuation: ordem das fontes', () => {
  it('sem nenhuma fonte, a carta fica sem valor (o app não estima)', () => {
    const v = valuation(entry());
    expect(v.value).toBeUndefined();
    expect(v.range).toBeUndefined();
    expect(v.sources).toEqual([]);
  });

  it('"Meu valor" vence o MYP e a TCGplayer, com confiança alta e faixa de um valor só', () => {
    const base = entry({ lang: 'en' });
    const e = { ...base, myValue: { value: 50, setAt: AT }, mypApi: myp(base), tcgplayer: tcg(base), valueBasis: 'min' as const };
    const v = valuation(e);
    expect(v.basis).toBe('manual');
    expect(v.value).toBe(50);
    expect(v.range).toEqual({ min: 50, avg: 50, max: 50 });
    expect(v.confidence).toBe('alta');
    expect(v.approx).toBeUndefined();
    expect(v.sources.map((s) => [s.id, s.used])).toEqual([
      ['manual', true],
      ['tcgplayer', false],
      ['myp', false],
    ]);
  });

  it('carta em inglês: TCGplayer (em reais) antes do MYP', () => {
    const base = entry({ lang: 'en' });
    const v = valuation({ ...base, mypApi: myp(base), tcgplayer: tcg(base) });
    expect(v.basis).toBe('tcgplayer');
    expect(v.value).toBe(12);
    expect(v.range).toEqual({ min: 8, avg: 12, max: 15 });
    expect(v.confidence).toBe('media');
    expect(v.sources.find((s) => s.id === 'myp')?.used).toBe(false);
  });

  it('carta em português: a TCGplayer não conta, vale o MYP', () => {
    const base = entry({ lang: 'pt' });
    const v = valuation({ ...base, mypApi: myp(base), tcgplayer: tcg(base) });
    expect(v.basis).toBe('myp');
    expect(v.value).toBe(10);
    expect(v.range).toEqual({ min: 5, avg: 10, max: 20 });
    expect(v.confidence).toBe('media');
    expect(v.sources.map((s) => s.id)).toEqual(['myp']);
  });

  it('carta em inglês sem preço na TCGplayer: MYP com confiança baixa (anúncios de todos os idiomas)', () => {
    const base = entry({ lang: 'en' });
    const v = valuation({ ...base, mypApi: myp(base), tcgplayer: tcg(base, { min: undefined, avg: undefined, max: undefined, notFound: 'sem vendas recentes' }) });
    expect(v.basis).toBe('myp');
    expect(v.value).toBe(10);
    expect(v.confidence).toBe('baixa');
    expect(v.approx).toBe('otherLanguages');
  });

  it('preço guardado de outra carta, versão ou selo não vale', () => {
    const base = entry();
    expect(valuation({ ...base, mypApi: myp(base, { cardId: 'sv01-025' }) }).value).toBeUndefined();
    expect(valuation({ ...base, mypApi: myp(base, { variant: 'holo' }) }).value).toBeUndefined();
    expect(valuation({ ...base, mypApi: myp(base, { checkedAt: '' }) }).value).toBeUndefined();
    // Promo com selo: o preço buscado sem o selo não é desta versão.
    const promo = entry({ variant: 'wPromo', variantNote: 'Pokémon Center' });
    expect(valuation({ ...promo, mypApi: myp(promo) }).value).toBeUndefined();
    expect(valuation({ ...promo, mypApi: myp(promo, { note: 'Pokémon Center' }) }).value).toBe(10);
  });
});

describe('valuation: "Usar na soma" (valueBasis)', () => {
  const base = entry();
  const e = { ...base, mypApi: myp(base) };

  it.each([
    [undefined, 10],
    ['min', 5],
    ['avg', 10],
    ['max', 20],
  ] as const)('%s → %d', (pick, value) => {
    const v = valuation({ ...e, valueBasis: pick });
    expect(v.value).toBe(value);
    expect(v.pick).toBe(pick ?? 'avg');
    expect(v.range).toEqual({ min: 5, avg: 10, max: 20 });
  });

  it('a faixa sempre contém a média, mesmo com mínimo/máximo estranhos da fonte', () => {
    const v = valuation({ ...base, mypApi: myp(base, { min: 15, avg: 10, max: 8 }), valueBasis: 'min' });
    expect(v.range).toEqual({ min: 10, avg: 10, max: 10 });
    expect(v.value).toBe(10);
  });

  it('sem mínimo e máximo, os três são a média', () => {
    const v = valuation({ ...base, mypApi: myp(base, { min: undefined, max: undefined }), valueBasis: 'max' });
    expect(v.range).toEqual({ min: 10, avg: 10, max: 10 });
  });
});

describe('valuation: confiança das versões especiais', () => {
  it('versão especial com o preço da carta base: aproximado', () => {
    const base = entry({ variant: 'pokeball' });
    const v = valuation({ ...base, mypApi: myp(base) });
    expect(v.confidence).toBe('baixa');
    expect(v.approx).toBe('base');
  });

  it('versão especial com produto próprio no MYP: confiança média', () => {
    const base = entry({ variant: 'pokeball' });
    const v = valuation({ ...base, mypApi: myp(base, { ownVersion: true }) });
    expect(v.confidence).toBe('media');
    expect(v.approx).toBeUndefined();
  });

  it('TCGplayer com o preço da carta base: aproximado', () => {
    const base = entry({ lang: 'en', variant: 'wPromo' });
    const v = valuation({ ...base, tcgplayer: tcg(base, { base: true }) });
    expect(v.basis).toBe('tcgplayer');
    expect(v.confidence).toBe('baixa');
    expect(v.approx).toBe('base');
  });
});

describe('myValuePatch', () => {
  const base = entry({ myValue: { value: 30, setAt: AT } });

  it('média da fonte acima do "Meu valor": apaga e guarda o registro da troca', () => {
    expect(myValuePatch(base, { avg: 31, checkedAt: LATER }, 'myp')).toEqual({
      myValue: null,
      myValueReplaced: { value: 30, mypValue: 31, at: LATER, source: 'myp' },
    });
  });

  it('média igual ou abaixo, ou sem "Meu valor": nada muda', () => {
    expect(myValuePatch(base, { avg: 30, checkedAt: LATER }, 'myp')).toEqual({});
    expect(myValuePatch(base, { avg: 12, checkedAt: LATER }, 'tcgplayer')).toEqual({});
    expect(myValuePatch(base, { checkedAt: LATER }, 'myp')).toEqual({});
    expect(myValuePatch(entry(), { avg: 99, checkedAt: LATER }, 'myp')).toEqual({});
  });
});

describe('"Meu valor" abaixo da média da fonte', () => {
  it('nas cartas em inglês, o mercado da TCGplayer; nas outras, a média do MYP', () => {
    const en = entry({ lang: 'en', myValue: { value: 60, setAt: AT } });
    const withTcg = { ...en, tcgplayer: tcg(en, { avg: 150 }), mypApi: myp(en, { avg: 60 }) };
    expect(myValueTrigger(withTcg)).toEqual({ avg: 150, source: 'tcgplayer' });
    expect(myValueBelowSource(withTcg)).toEqual({ avg: 150, source: 'tcgplayer' });
    // Em inglês, o MYP não apaga o "Meu valor".
    expect(myValueBelowSource({ ...en, mypApi: myp(en, { avg: 999 }) })).toBeUndefined();
    const pt = entry({ myValue: { value: 9, setAt: AT } });
    expect(myValueBelowSource({ ...pt, mypApi: myp(pt, { avg: 10 }) })).toEqual({ avg: 10, source: 'myp' });
  });

  it('igual ou acima da média, ou sem "Meu valor": nada', () => {
    const pt = entry({ myValue: { value: 10, setAt: AT } });
    expect(myValueBelowSource({ ...pt, mypApi: myp(pt, { avg: 10 }) })).toBeUndefined();
    expect(myValueBelowSource(pt)).toBeUndefined();
    expect(myValueBelowSource({ ...entry(), mypApi: myp(entry()) })).toBeUndefined();
  });
});

describe('TCGplayer: colunas sem preço próprio', () => {
  const en = entry({ lang: 'en' });

  it('mediana abaixo do mercado: "Usar na soma" na mediana soma o mercado, com o nome dele', () => {
    // 8-0: mediana US$ 4,95, mercado US$ 5,32 → o "máximo" em reais é o próprio mercado.
    const price = tcg(en, { usdLow: 4.5, usdMid: 4.95, usdMarket: 5.32, fx: 5.04, min: 22.68, avg: 26.8, max: 26.8 });
    const v = valuation({ ...en, tcgplayer: price, valueBasis: 'max' });
    expect(v.value).toBe(26.8);
    expect(v.pick).toBe('avg');
    expect(pickLabel(v)).toBe(RANGE_LABELS.tcgplayer.avg.long);
    // O menor anúncio continua valendo.
    expect(valuation({ ...en, tcgplayer: price, valueBasis: 'min' }).pick).toBe('min');
  });

  it('menor anúncio acima do mercado: o mínimo também vira o mercado', () => {
    const price = tcg(en, { usdLow: 6, usdMid: 7, usdMarket: 5, fx: 5, min: 25, avg: 25, max: 35 });
    const v = valuation({ ...en, tcgplayer: price, valueBasis: 'min' });
    expect(v.value).toBe(25);
    expect(v.pick).toBe('avg');
    expect(valuation({ ...en, tcgplayer: price, valueBasis: 'max' }).pick).toBe('max');
  });
});

describe('rótulos da faixa', () => {
  it('conforme a fonte do valor; "Meu valor" não tem faixa', () => {
    expect(rangeLabels({ basis: 'manual' })).toBeUndefined();
    expect(rangeLabels({ basis: undefined })).toBeUndefined();
    expect(rangeLabels({ basis: 'myp' })).toEqual(rangeLabelsOf('myp'));
    expect(rangeLabels({ basis: 'tcgplayer' })).toEqual(rangeLabelsOf('tcgplayer'));
  });

  it('pickLabel', () => {
    expect(pickLabel({ basis: 'manual', pick: 'min' })).toBe(SOURCE_NAME.manual);
    expect(pickLabel({ basis: 'myp', pick: 'min' })).toBe(RANGE_LABELS.myp.min.long);
    expect(pickLabel({ basis: 'tcgplayer' })).toBe(RANGE_LABELS.tcgplayer.avg.long);
    expect(pickLabel({})).toBe('');
  });
});

describe('usPriceGap', () => {
  it('só aparece quando a média dos EUA fica fora de 0,67× a 1,5× a do MYP', () => {
    const base = entry({ lang: 'en' });
    expect(usPriceGap({ ...base, tcgplayer: tcg(base, { avg: 12 }), mypApi: myp(base, { avg: 10 }) })).toBeUndefined();
    const gap = usPriceGap({ ...base, tcgplayer: tcg(base, { avg: 30, max: 30 }), mypApi: myp(base, { avg: 10 }) });
    expect(gap?.ratio).toBe(3);
    expect(gap?.avg).toBe(10);
    // Sem MYP, ou valor que não vem da TCGplayer: nada.
    expect(usPriceGap({ ...base, tcgplayer: tcg(base, { avg: 30 }) })).toBeUndefined();
    expect(usPriceGap({ ...entry(), mypApi: myp(entry()) })).toBeUndefined();
  });
});

describe('pricePending', () => {
  it('inglês e japonês esperam a TCGplayer; português, o MYP', () => {
    const en = entry({ lang: 'en' });
    expect(pricePending(en)).toBe(true);
    expect(pricePending({ ...en, tcgplayer: tcg(en) })).toBe(false);
    const pt = entry();
    expect(pricePending(pt)).toBe(true);
    expect(pricePending({ ...pt, mypApi: myp(pt) })).toBe(false);
    const ja = entry({ lang: 'ja' });
    expect(pricePending(ja)).toBe(true);
    expect(pricePending({ ...ja, tcgplayer: tcg(ja) })).toBe(false);
    // Olhada sem preço (ex.: mais de um produto): não espera mais nada (o MYP não tem japonesas).
    expect(pricePending({ ...ja, tcgplayer: tcg(ja, { min: undefined, avg: undefined, max: undefined, notFound: 'mais de um produto na TCGplayer' }) })).toBe(
      false,
    );
  });
});

describe('pricePending: carta em inglês sem preço na TCGplayer', () => {
  const en = entry({ lang: 'en' });
  const noTcg = tcg(en, { min: undefined, avg: undefined, max: undefined, notFound: 'sem vendas recentes' });

  it('continua esperando enquanto o MYP não responde', () => {
    expect(pricePending({ ...en, tcgplayer: noTcg })).toBe(true);
    // Resposta do MYP de outra versão não é desta carta: ainda vai buscar de novo.
    expect(pricePending({ ...en, tcgplayer: noTcg, mypApi: myp(en, { variant: 'holo' }) })).toBe(true);
  });

  it('o MYP respondeu, com ou sem preço: não espera mais', () => {
    expect(pricePending({ ...en, tcgplayer: noTcg, mypApi: myp(en) })).toBe(false);
    const noMyp = myp(en, { min: undefined, avg: undefined, max: undefined, qty: undefined, notFound: 'sem produto' });
    expect(pricePending({ ...en, tcgplayer: noTcg, mypApi: noMyp })).toBe(false);
  });

  it('carta já avaliada pela TCGplayer não espera o MYP', () => {
    expect(pricePending({ ...en, tcgplayer: tcg(en) })).toBe(false);
  });
});

describe('carta japonesa: TCGplayer (o produto japonês)', () => {
  const ja = entry({ lang: 'ja', cardId: 'M5-088', setId: 'M5', localId: '088', setTotal: 81, variant: 'holo' });

  it('o valor é o da TCGplayer, com a faixa e a confiança média', () => {
    const v = valuation({ ...ja, tcgplayer: tcg(ja) });
    expect(v.basis).toBe('tcgplayer');
    expect(v.value).toBe(12);
    expect(v.range).toEqual({ min: 8, avg: 12, max: 15 });
    expect(v.confidence).toBe('media');
    expect(v.approx).toBeUndefined();
  });

  it('preço da carta base (reverse sem o produto Mirror): aproximado pela carta base, nunca "outros idiomas"', () => {
    const rev = { ...ja, variant: 'reverse' as const };
    const v = valuation({ ...rev, tcgplayer: tcg(rev, { base: true }) });
    expect(v.approx).toBe('base');
    expect(v.confidence).toBe('baixa');
  });

  it('sem preço na TCGplayer, fica sem valor (o MYP não tem japonesas)', () => {
    expect(valuation({ ...ja, tcgplayer: tcg(ja, { min: undefined, avg: undefined, max: undefined, notFound: 'sem vendas recentes na TCGplayer' }) }).value).toBeUndefined();
  });

  it('preço de outra carta ou versão não vale', () => {
    expect(valuation({ ...ja, tcgplayer: tcg(ja, { cardId: 'sv08-057' }) }).value).toBeUndefined();
    expect(valuation({ ...ja, tcgplayer: tcg(ja, { variant: 'reverse' }) }).value).toBeUndefined();
  });

  it('"Meu valor" é apagado pelo mercado da TCGplayer', () => {
    const mine = { ...ja, myValue: { value: 5, setAt: AT } };
    expect(valuation({ ...mine, tcgplayer: tcg(ja) }).basis).toBe('manual');
    expect(myValueTrigger({ ...mine, tcgplayer: tcg(ja, { avg: 30 }) })).toEqual({ avg: 30, source: 'tcgplayer' });
    expect(myValueBelowSource({ ...mine, tcgplayer: tcg(ja, { avg: 30 }) })).toEqual({ avg: 30, source: 'tcgplayer' });
    expect(myValueTrigger(mine)).toBeUndefined();
  });

  it('a TCGplayer não vale para a carta em português (mesmo guardada)', () => {
    const pt = entry();
    expect(valuation({ ...pt, tcgplayer: tcg(pt) }).value).toBeUndefined();
  });
});

describe('cardNoPriceText (quadro de preço da carta sem valor)', () => {
  const noPrice = (e: Pick<Entry, 'cardId' | 'variant'>, notFound: string) => tcg(e, { min: undefined, avg: undefined, max: undefined, notFound });

  it('japonesa: buscando na TCGplayer; sem preço lá, o motivo e que o MYP não tem japonesas (na web e no celular)', () => {
    const ja = entry({ lang: 'ja', cardId: 'M5-088', variant: 'holo' });
    expect(cardNoPriceText(ja, undefined, undefined, false)).toBe(TCGPLAYER_SEARCHING);
    for (const web of [false, true]) {
      expect(cardNoPriceText(ja, undefined, noPrice(ja, 'mais de um produto na TCGplayer'), web)).toBe(
        `Sem preço na TCGplayer (mais de um produto). ${MYP_NO_JAPANESE}`,
      );
    }
    // Nunca manda esperar o MYP Cards.
    expect(cardNoPriceText(ja, undefined, noPrice(ja, 'sem vendas recentes na TCGplayer'), false)).not.toMatch(/Buscando/);
  });

  it('inglesa: TCGplayer primeiro e depois o MYP Cards; portuguesa: só o MYP Cards', () => {
    const en = entry({ lang: 'en', cardId: 'sv08-057' });
    expect(cardNoPriceText(en, undefined, undefined, false)).toBe(TCGPLAYER_SEARCHING);
    expect(cardNoPriceText(en, undefined, noPrice(en, 'sem vendas recentes na TCGplayer'), false)).toBe(
      'Sem preço na TCGplayer (sem vendas recentes). Buscando no MYP Cards…',
    );
    expect(cardNoPriceText(en, undefined, noPrice(en, 'sem vendas recentes na TCGplayer'), true)).toBe(
      'Sem preço na TCGplayer (sem vendas recentes). O MYP Cards é consultado pelo app no celular.',
    );
    expect(cardNoPriceText(en, { cardId: en.cardId, variant: en.variant, checkedAt: AT }, noPrice(en, 'sem vendas recentes na TCGplayer'), false)).toBe(
      'Sem preço na TCGplayer (sem vendas recentes) nem no MYP Cards.',
    );
    const pt = entry();
    expect(cardNoPriceText(pt, undefined, undefined, false)).toBe('Buscando o preço no MYP Cards…');
    expect(cardNoPriceText(pt, undefined, undefined, true)).toBe('O MYP Cards é consultado pelo app no celular.');
    expect(cardNoPriceText(pt, { cardId: pt.cardId, variant: pt.variant, checkedAt: AT, notFound: 'sem o produto' }, undefined, false)).toBe(
      'Não achei esta carta no MYP Cards (sem o produto).',
    );
  });
});
