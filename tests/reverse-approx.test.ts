import { APPROX_REASON, HOW_WE_CALCULATE, valueMark } from '@/lib/copy';
import { snapshotValue } from '@/lib/history';
import { listPrice, listPriceText } from '@/lib/lists';
import { collectionTotals } from '@/lib/quotes';
import type { Entry, MypApiPrice, ValueBasis } from '@/lib/types';
import { approxText, mypApiFitsVariant, mypFitsVariant, SPECIAL_VARIANTS, valuation } from '@/lib/valuation';

import { AT, entry, myp, tcg } from './fixtures';

// Reverse Foil em português avaliada pelo MYP Cards: o produto achado é o da carta (o MYP não tem um só da reverse),
// então o valor é "≈ Aproximado" pela carta base. Só a marca muda (confiança, motivo e o texto da fonte): o número é o mesmo de antes.

// O formatBRL separa o "R$" com espaço que não quebra.
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const mypRow = (e: Entry) => valuation(e).sources.find((s) => s.id === 'myp');
const noTcg = (e: Entry) => tcg(e, { min: undefined, avg: undefined, max: undefined, notFound: 'sem vendas recentes na TCGplayer' });

describe('Reverse Foil em português pelo MYP Cards', () => {
  const rev = entry({ variant: 'reverse' });

  it('pelo produto da carta (não o da reverse): ≈ Aproximado, confiança baixa, pela carta base', () => {
    const e = { ...rev, mypApi: myp(rev) };
    const v = valuation(e);
    expect(v).toMatchObject({ basis: 'myp', value: 10, range: { min: 5, avg: 10, max: 20 }, pick: 'avg', confidence: 'baixa', approx: 'base' });
    expect(valueMark(v)).toEqual({ mark: '≈', label: 'Aproximado', reason: APPROX_REASON.base });
    expect(approxText(v)).toBe(APPROX_REASON.base);
    expect(mypRow(e)?.detail).toMatch(/\(carta base, todos os estados e idiomas\)$/);
    // Nas listas e no texto para mandar, como as outras aproximadas.
    expect(plain(listPriceText(listPrice(e)!))).toBe('≈ R$ 10,00');
  });

  it('com o produto próprio da reverse no MYP (ownVersion): o preço é exato', () => {
    const e = { ...rev, mypApi: myp(rev, { ownVersion: true }) };
    const v = valuation(e);
    expect(v).toMatchObject({ basis: 'myp', value: 10, confidence: 'media' });
    expect(v.approx).toBeUndefined();
    expect(valueMark(v).mark).toBe('');
    expect(mypRow(e)?.detail).toMatch(/ \(todos os estados e idiomas\)$/);
  });

  it('"Meu valor" continua exato: confiança alta, sem ≈', () => {
    const e = { ...rev, myValue: { value: 50, setAt: AT }, mypApi: myp(rev) };
    const v = valuation(e);
    expect(v).toMatchObject({ basis: 'manual', value: 50, range: { min: 50, avg: 50, max: 50 }, confidence: 'alta' });
    expect(v.approx).toBeUndefined();
    expect(valueMark(v).mark).toBe('✎');
  });

  it('não virou versão especial: a Consulta e a busca no MYP (mypFitsVariant) seguem iguais', () => {
    expect(SPECIAL_VARIANTS).not.toContain('reverse');
    expect(mypFitsVariant('reverse')).toBe(true);
    // Só o preço guardado na carta deixa de valer como exato da reverse.
    expect(mypApiFitsVariant(rev, myp(rev))).toBe(false);
    expect(mypApiFitsVariant(rev, myp(rev, { ownVersion: true }))).toBe(true);
  });

  it('"Como calculamos o valor" explica a reverse em português', () => {
    const topic = HOW_WE_CALCULATE.topics.find((t) => t.title === '≈ Aproximado');
    expect(topic?.body).toMatch(/Reverse Foil em português/);
    expect(topic?.body).toMatch(/produto da carta/);
  });
});

describe('outras versões em português: nada muda', () => {
  it.each([
    ['normal', entry()],
    ['holo', entry({ variant: 'holo' })],
    // Holo com selo marcado ("Cosmos Holo"): o MYP acha o produto da carta e o preço segue exato (só a reverse mudou).
    ['holo com selo "Cosmos Holo"', entry({ variant: 'holo', variantNote: 'Cosmos Holo' })],
  ])('%s: confiança média, sem ≈', (_, base) => {
    const e = { ...base, mypApi: myp(base) };
    const v = valuation(e);
    expect(v).toMatchObject({ basis: 'myp', value: 10, range: { min: 5, avg: 10, max: 20 }, confidence: 'media' });
    expect(v.approx).toBeUndefined();
    expect(mypRow(e)?.detail).toMatch(/ \(todos os estados e idiomas\)$/);
  });

  it('Poké Ball sem produto próprio continua aproximada', () => {
    const ball = entry({ variant: 'pokeball' });
    expect(valuation({ ...ball, mypApi: myp(ball) })).toMatchObject({ confidence: 'baixa', approx: 'base' });
  });
});

// A regra da reverse é só das cartas em português (a decisão do dono e "Como calculamos o valor"): a inglesa fica como
// antes da regra.
describe('Reverse Foil em inglês: como antes', () => {
  const rev = entry({ lang: 'en', variant: 'reverse' });

  it('o preço do MYP da reverse inglesa não vira "carta base" (só a portuguesa)', () => {
    expect(mypApiFitsVariant(rev, myp(rev))).toBe(true);
    expect(mypApiFitsVariant(entry({ variant: 'reverse' }), myp(rev))).toBe(false);
  });

  it('pela TCGplayer (impressão Reverse Holofoil): exato; o MYP fica de referência, sem "carta base"', () => {
    const e = { ...rev, tcgplayer: tcg(rev), mypApi: myp(rev) };
    const v = valuation(e);
    expect(v).toMatchObject({ basis: 'tcgplayer', value: 12, confidence: 'media' });
    expect(v.approx).toBeUndefined();
    expect(mypRow(e)).toMatchObject({ used: false });
    expect(mypRow(e)?.detail).toMatch(/ \(todos os estados e idiomas\)$/);
  });

  it('sem preço na TCGplayer, pelo MYP: continua ≈ Aproximado, pelos anúncios de todos os idiomas', () => {
    const e = { ...rev, tcgplayer: noTcg(rev), mypApi: myp(rev) };
    const v = valuation(e);
    expect(v).toMatchObject({ basis: 'myp', value: 10, range: { min: 5, avg: 10, max: 20 }, confidence: 'baixa', approx: 'otherLanguages' });
    expect(approxText(v)).toBe(APPROX_REASON.otherLanguages);
    expect(mypRow(e)?.detail).toMatch(/ \(todos os estados e idiomas\)$/);
  });

  it('com o produto próprio da reverse no MYP: ainda aproximado, pelos anúncios de todos os idiomas', () => {
    const e = { ...rev, tcgplayer: noTcg(rev), mypApi: myp(rev, { ownVersion: true }) };
    expect(valuation(e)).toMatchObject({ value: 10, confidence: 'baixa', approx: 'otherLanguages' });
  });

  it('o número é o mesmo da versão normal inglesa pelo MYP', () => {
    const normal = entry({ lang: 'en' });
    const before = valuation({ ...normal, tcgplayer: noTcg(normal), mypApi: myp(normal) });
    const after = valuation({ ...rev, tcgplayer: noTcg(rev), mypApi: myp(rev) });
    expect(after).toMatchObject({ value: before.value, range: before.range, confidence: before.confidence, approx: before.approx });
  });
});

describe('regressão: o número da Reverse Foil é o mesmo de antes', () => {
  it('o preço de exemplo dá o mesmo valor e a mesma faixa de antes (5 / 10 / 20)', () => {
    const rev = entry({ variant: 'reverse' });
    for (const [pick, value] of [
      [undefined, 10],
      ['min', 5],
      ['avg', 10],
      ['max', 20],
    ] as const) {
      const v = valuation({ ...rev, mypApi: myp(rev), valueBasis: pick });
      expect(v.value).toBe(value);
      expect(v.range).toEqual({ min: 5, avg: 10, max: 20 });
    }
  });

  // Antes desta regra, a reverse em português seguia exatamente o caminho da versão normal: a mesma conta, sem a marca.
  const prices: Partial<MypApiPrice>[] = [{}, { min: 15, avg: 10, max: 8 }, { min: undefined, max: undefined }, { min: 0.5, avg: 1234.56, max: 9999, qty: 1 }];
  const picks: (ValueBasis | undefined)[] = [undefined, 'min', 'avg', 'max'];
  const cases = prices.flatMap((p) => picks.map((pick): [Partial<MypApiPrice>, ValueBasis | undefined] => [p, pick]));

  it.each(cases)('preço %j, "Usar na soma" %s: igual à versão normal e à foto diária', (p, pick) => {
    const normal = entry({ valueBasis: pick });
    const rev = entry({ variant: 'reverse', valueBasis: pick });
    const before = valuation({ ...normal, mypApi: myp(normal, p) });
    const after = valuation({ ...rev, mypApi: myp(rev, p) });
    expect(after.value).toBe(before.value);
    expect(after.range).toEqual(before.range);
    expect(after.pick).toBe(before.pick);
    expect(after.sources.map((s) => [s.id, s.brl, s.used])).toEqual(before.sources.map((s) => [s.id, s.brl, s.used]));
    // A foto diária (snapshotValue, a mesma conta de collection_history) não olha a versão: o mesmo número.
    const m = myp(rev, p);
    const shot = snapshotValue({ mypApi: { min: m.min, avg: m.avg, max: m.max }, ...(pick ? { basis: pick } : {}) }, 'pt');
    expect(shot).toEqual({ ...after.range, pick: after.value, source: 'myp' });
  });

  it('a soma da coleção é a mesma; só a contagem de aproximadas muda', () => {
    const a = entry({ id: '25-0' });
    const b = entry({ id: '25-1', slot: 1 });
    const rev = { ...b, variant: 'reverse' as const };
    const before = collectionTotals([
      { ...a, mypApi: myp(a) },
      { ...b, mypApi: myp(b) },
    ]);
    const after = collectionTotals([
      { ...a, mypApi: myp(a) },
      { ...rev, mypApi: myp(rev) },
    ]);
    expect(after.value).toBe(before.value);
    expect(after.range).toEqual(before.range);
    expect(after.valued).toBe(before.valued);
    expect(after.approx).toBe(before.approx + 1);
    expect(after.byConfidence).toEqual({ alta: 0, media: 1, baixa: 1 });
  });
});
