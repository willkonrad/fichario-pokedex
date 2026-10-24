import {
  formatBRL,
  formatBRLShort,
  formatBRLTight,
  formatCompact,
  formatDate,
  formatDay,
  formatInput,
  formatPct,
  formatRate,
  formatSignedBRL,
  formatUSD,
  parseBRL,
} from '@/lib/format';

/** O Intl separa "R$" do número com espaço não separável; nos testes, espaço comum. */
const plain = (s: string) => s.replace(/ /g, ' ');

describe('parseBRL (padrão brasileiro)', () => {
  it.each([
    ['1.500', 1500],
    ['1.234,56', 1234.56],
    ['1.234.567,89', 1234567.89],
    ['37,9', 37.9],
    ['37,90', 37.9],
    ['R$ 12', 12],
    ['r$12,50', 12.5],
    ['1 500,00', 1500],
    ['1 500,00', 1500],
    ['007,50', 7.5],
    [',5', 0.5],
    // Ponto com 1 ou 2 casas: teclado em inglês.
    ['37.90', 37.9],
    ['1.5', 1.5],
    // "37." no meio da digitação.
    ['37.', 37],
    // A 3ª casa arredonda.
    ['0,005', 0.01],
    ['10,999', 11],
  ])('%s → %d', (text, value) => {
    expect(parseBRL(text)).toEqual({ value });
  });

  it('vazio não é erro (campo apagado)', () => {
    expect(parseBRL('')).toEqual({ value: undefined });
    expect(parseBRL('   ')).toEqual({ value: undefined });
    expect(parseBRL('R$')).toEqual({ value: undefined });
  });

  it.each([
    ['0,004', 'maior que zero'],
    ['0', 'maior que zero'],
    ['0,00', 'maior que zero'],
    ['abc', 'só números'],
    ['-5', 'só números'],
    ['12a', 'só números'],
    ['1,2,3', 'vírgula só'],
    ['12,3.4', 'Depois da vírgula'],
    ['1.50,00', 'grupos de 3'],
    ['1.5000', 'grupos de 3'],
    ['12.34.56', 'grupos de 3'],
    ['1234567890', 'alto demais'],
    ['100.000.000', 'alto demais'],
  ])('%s é inválido (%s)', (text, message) => {
    const r = parseBRL(text);
    expect(r.value).toBeUndefined();
    expect(r.error).toContain(message);
  });

  it('lê de volta o que o campo mostra', () => {
    for (const n of [0.01, 1, 37.9, 1500, 1234.56, 99_999_999.99]) {
      expect(parseBRL(formatInput(n))).toEqual({ value: n });
    }
  });
});

describe('formatadores de dinheiro', () => {
  it('formatBRL', () => {
    expect(plain(formatBRL(1234.56))).toBe('R$ 1.234,56');
    expect(plain(formatBRL(0))).toBe('R$ 0,00');
    expect(formatBRL(undefined)).toBe('—');
    expect(formatBRL(null)).toBe('—');
    expect(formatBRL(NaN)).toBe('—');
  });

  it('formatBRLTight: centavos só abaixo de R$ 100', () => {
    expect(plain(formatBRLTight(82.52))).toBe('R$ 82,52');
    expect(plain(formatBRLTight(1537.4))).toBe('R$ 1.537');
    // 99,996 arredonda para 100: já sem centavos.
    expect(plain(formatBRLTight(99.996))).toBe('R$ 100');
  });

  it('formatCompact e formatBRLShort', () => {
    expect(formatCompact(0.82)).toBe('0,82');
    expect(formatCompact(82)).toBe('82');
    expect(formatCompact(1200)).toBe('1,2 mil');
    expect(formatCompact(999.6)).toBe('1,0 mil');
    expect(formatCompact(9.996)).toBe('10');
    expect(formatCompact(120_000)).toBe('120 mil');
    expect(formatCompact(1_500_000)).toBe('1,5 mi');
    expect(formatCompact(-5)).toBe('−5,00');
    expect(formatCompact(Infinity)).toBe('—');
    expect(plain(formatBRLShort(1200))).toBe('R$ 1,2 mil');
    expect(formatBRLShort(undefined)).toBe('—');
  });

  it('formatSignedBRL', () => {
    expect(plain(formatSignedBRL(152))).toBe('+R$ 152');
    expect(plain(formatSignedBRL(-12.5))).toBe('−R$ 12,50');
    expect(plain(formatSignedBRL(0.001))).toBe('R$ 0,00');
  });

  it('dólar e câmbio', () => {
    expect(formatUSD(1234.56)).toBe('US$ 1.234,56');
    expect(formatUSD(undefined)).toBe('—');
    expect(formatRate(5.03834)).toBe('5,0383');
  });
});

describe('formatPct', () => {
  it('uma casa, sinal opcional', () => {
    expect(formatPct(1.234)).toBe('1,2%');
    expect(formatPct(-1.2)).toBe('−1,2%');
    expect(formatPct(1.25, { sign: true })).toBe('+1,3%');
    expect(formatPct(-1.2, { sign: true })).toBe('−1,2%');
    expect(formatPct(5, { digits: 0 })).toBe('5%');
  });

  it('zero depois do arredondamento fica sem sinal', () => {
    expect(formatPct(0.04, { sign: true })).toBe('0,0%');
    expect(formatPct(-0.04, { sign: true })).toBe('0,0%');
  });
});

describe('datas', () => {
  it('dia "AAAA-MM-DD" é lido como dia, sem fuso', () => {
    expect(formatDay('2026-10-20')).toBe('20/10');
    expect(formatDate('2026-10-20')).toBe('20/10/2026');
    expect(formatDate('2026-01-01')).toBe('01/01/2026');
  });
});
