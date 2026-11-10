import { collectionTotals } from '@/lib/quotes';
import { noPriceReason } from '@/lib/reports';
import type { Entry } from '@/lib/types';

import { entry, myp, tcg } from './fixtures';

// mypPending: cartas sem valor que só o app no celular ainda vai buscar no MYP (na web, o aviso MYP_ON_PHONE).

const en = (over: Partial<Entry> = {}) => entry({ id: '5-0', lang: 'en', ...over });
/** Olhada na TCGplayer sem preço (fora do catálogo ou produto sem preço). */
const tcgNoPrice = (e: Entry, notFound?: string) => ({ ...e, tcgplayer: tcg(e, { min: undefined, avg: undefined, max: undefined, notFound }) });
const pending = (...list: Entry[]) => collectionTotals(list).mypPending;

describe('collectionTotals: mypPending', () => {
  it('em inglês, olhada na TCGplayer sem preço e ainda sem busca no MYP: conta (como o selo "aguardando busca")', () => {
    const notFound = tcgNoPrice(en(), 'fora do catálogo');
    const noPrice = tcgNoPrice(en({ id: '6-0' }));
    expect(noPriceReason(notFound)).toBe('pending');
    expect(pending(notFound)).toBe(1);
    expect(pending(notFound, noPrice)).toBe(2);
  });

  it('em inglês ainda sem a TCGplayer: não conta (a web busca a TCGplayer sozinha)', () => {
    expect(pending(en())).toBe(0);
  });

  it('em inglês já buscada no MYP (achada sem preço ou não encontrada): não conta', () => {
    const e = tcgNoPrice(en());
    expect(pending({ ...e, mypApi: myp(e, { notFound: 'sem produto', min: undefined, avg: undefined, max: undefined }) })).toBe(0);
    expect(pending({ ...e, mypApi: myp(e, { min: undefined, avg: undefined, max: undefined }) })).toBe(0);
  });

  it('com valor (TCGplayer ou MYP): não conta', () => {
    const e = en();
    expect(pending({ ...e, tcgplayer: tcg(e) })).toBe(0);
    const noTcg = tcgNoPrice(e);
    expect(pending({ ...noTcg, mypApi: myp(noTcg) })).toBe(0);
  });

  it('em português sem busca no MYP conta; já buscada ou em japonês, não', () => {
    const pt = entry();
    expect(pending(pt)).toBe(1);
    expect(pending({ ...pt, mypApi: myp(pt, { notFound: 'sem produto', min: undefined, avg: undefined, max: undefined }) })).toBe(0);
    expect(pending(entry({ lang: 'ja' }))).toBe(0);
  });

  it('em japonês nunca conta (o MYP não tem japonesas), nem esperando a TCGplayer nem sem preço lá', () => {
    const ja = entry({ id: '7-0', lang: 'ja' });
    expect(noPriceReason(ja)).toBe('pending');
    expect(pending(ja)).toBe(0);
    expect(pending(tcgNoPrice(ja, 'sem vendas recentes na TCGplayer'))).toBe(0);
    expect(pending(tcgNoPrice(ja))).toBe(0);
    // Com o preço da TCGplayer tem valor.
    expect(collectionTotals([{ ...ja, tcgplayer: tcg(ja) }])).toMatchObject({ valued: 1, value: 12, mypPending: 0 });
  });
});
