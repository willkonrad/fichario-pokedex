import { noPriceReason, noPriceSummary, setSummaries } from '@/lib/reports';
import type { Entry } from '@/lib/types';

import { AT, entry, LATER, myp, tcg } from './fixtures';

/** Carta com preço do MYP (média 10, ou a pedida). */
const priced = (over: Partial<Entry> = {}, avg = 10) => {
  const e = entry(over);
  return { ...e, mypApi: myp(e, { min: avg / 2, avg, max: avg * 2 }) };
};

describe('setSummaries (cartas por coleção)', () => {
  const list: Entry[] = [
    priced({ id: '1-0', setId: 'sv03.5', setName: '151' }),
    priced({ id: '2-0', setId: 'sv03.5', setName: '151' }),
    // Mesmo setId com outro nome (catálogo renomeou): vale o nome mais comum.
    entry({ id: '3-0', setId: 'sv03.5', setName: 'Escarlate e Violeta 151' }),
    priced({ id: '4-0', setId: 'me01', setName: 'Megaevolução' }, 50),
    priced({ id: '5-0', setId: 'me01', setName: 'Megaevolução' }, 50),
    priced({ id: '6-0', setId: 'sv01', setName: 'Escarlate e Violeta' }, 5),
    priced({ id: '7-0', setId: 'sv01', setName: 'Escarlate e Violeta' }, 5),
    priced({ id: '8-0', setId: 'sv02', setName: 'Evoluções em Paldea' }, 1),
  ];

  it('agrupa pelo setId, com o nome mais comum, e soma pelo valuation', () => {
    const [first] = setSummaries(list);
    expect(first).toEqual({ key: 'sv03.5', setId: 'sv03.5', setName: '151', count: 3, value: 20, valued: 2 });
  });

  it('ordem: mais cartas, depois maior valor', () => {
    expect(setSummaries(list).map((s) => [s.setId, s.count, s.value])).toEqual([
      ['sv03.5', 3, 20],
      ['me01', 2, 100],
      ['sv01', 2, 10],
      ['sv02', 1, 1],
    ]);
  });

  it('corta em `max` (padrão 8)', () => {
    const many = Array.from({ length: 12 }, (_, k) => entry({ id: `${k}-0`, setId: `s${k}`, setName: `Coleção ${k}` }));
    expect(setSummaries(many)).toHaveLength(8);
    expect(setSummaries(list, 2).map((s) => s.setId)).toEqual(['sv03.5', 'me01']);
  });

  it('carta sem setId fica com as do mesmo nome de coleção', () => {
    const out = setSummaries([entry({ id: '1-0', setId: '', setName: 'Promo' }), entry({ id: '2-0', setId: '', setName: 'Promo' })]);
    expect(out).toEqual([{ key: 'nome:Promo', setId: '', setName: 'Promo', count: 2, value: 0, valued: 0 }]);
  });
});

describe('noPriceSummary (cartas sem preço e o motivo)', () => {
  const pending = entry({ id: '1-0', updatedAt: AT });
  const base = entry({ id: '2-0', updatedAt: LATER });
  const notFound = { ...base, mypApi: myp(base, { min: undefined, avg: undefined, max: undefined, notFound: 'sem produto' }) };
  const japanese = entry({ id: '3-0', lang: 'ja', updatedAt: '2026-10-22T12:00:00+00:00' });
  const enBase = entry({ id: '4-0', lang: 'en', updatedAt: '' });
  const enPending = enBase;
  const noTcg = { min: undefined, avg: undefined, max: undefined };
  const enTcgOnly = { ...entry({ id: '5-0', lang: 'en', updatedAt: AT }), tcgplayer: tcg(enBase, { ...noTcg, notFound: 'fora do catálogo' }) };
  // Também sem o MYP: buscou nas duas fontes e não achou.
  const enNotFound = { ...enTcgOnly, mypApi: myp(enBase, { ...noTcg, notFound: 'sem produto' }) };
  const withPrice = priced({ id: '6-0' });

  it('os três motivos', () => {
    expect(noPriceReason(pending)).toBe('pending');
    expect(noPriceReason(enPending)).toBe('pending');
    expect(noPriceReason(notFound)).toBe('notFound');
    expect(noPriceReason(enNotFound)).toBe('notFound');
    // MYP consultado, sem anúncios e sem motivo: nenhuma fonte achou.
    expect(noPriceReason({ ...base, mypApi: myp(base, noTcg) })).toBe('noSource');
  });

  it('japonesa: espera a TCGplayer (o MYP não tem japonesas); sem preço lá, "não encontrada"', () => {
    expect(noPriceReason(japanese)).toBe('pending');
    expect(noPriceReason({ ...japanese, tcgplayer: tcg(japanese, { ...noTcg, notFound: 'sem vendas recentes na TCGplayer' }) })).toBe('notFound');
    expect(noPriceReason({ ...japanese, tcgplayer: tcg(japanese, { ...noTcg, notFound: 'mais de um produto na TCGplayer' }) })).toBe('notFound');
    // Olhada na TCGplayer sem preço e sem motivo: sem fonte.
    expect(noPriceReason({ ...japanese, tcgplayer: tcg(japanese, noTcg) })).toBe('noSource');
  });

  it('em inglês sem preço na TCGplayer e ainda sem busca no MYP: aguardando (o app ainda busca no MYP)', () => {
    expect(noPriceReason(enTcgOnly)).toBe('pending');
    // TCGplayer sem preço (sem o motivo) e sem MYP: também.
    expect(noPriceReason({ ...enTcgOnly, tcgplayer: tcg(enBase, noTcg) })).toBe('pending');
    // MYP buscado sem anúncios: não é mais "aguardando".
    expect(noPriceReason({ ...enTcgOnly, mypApi: myp(enBase, noTcg) })).toBe('notFound');
  });

  it('"não encontrada" da TCGplayer só conta em carta inglesa ou japonesa (como no painel de preço)', () => {
    // Busca velha da TCGplayer gravada numa carta que virou portuguesa: o painel nem olha.
    const tcgNotFound = tcg(enBase, { ...noTcg, notFound: 'sem vendas recentes' });
    const ptNoAds = { ...entry({ id: '7-0' }), tcgplayer: tcgNotFound };
    expect(noPriceReason({ ...ptNoAds, mypApi: myp(ptNoAds, noTcg) })).toBe('noSource');
    // Em inglês e em japonês, "não encontrada".
    expect(noPriceReason({ ...enBase, tcgplayer: tcgNotFound, mypApi: myp(enBase, noTcg) })).toBe('notFound');
    expect(noPriceReason({ ...japanese, tcgplayer: tcgNotFound })).toBe('notFound');
  });

  it('conta só as sem valor, do mais recente para o mais antigo', () => {
    const s = noPriceSummary([withPrice, pending, notFound, japanese, enPending, enNotFound]);
    expect(s.total).toBe(5);
    expect(s.byReason).toEqual({ pending: 3, notFound: 2, noSource: 0 });
    // Data inválida ("") vai para o fim; empate pela ordem do id.
    expect(s.items.map((e) => e.id)).toEqual(['3-0', '2-0', '1-0', '5-0', '4-0']);
  });

  it('carta com "Meu valor" tem valor; a japonesa com preço da TCGplayer também', () => {
    expect(noPriceSummary([{ ...entry({ lang: 'ja' }), myValue: { value: 30, setAt: AT } }]).total).toBe(0);
    expect(noPriceSummary([{ ...japanese, tcgplayer: tcg(japanese) }]).total).toBe(0);
  });
});
