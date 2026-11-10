import { compareDays, dayString, dayTime, entrySeries, snapshotValue, type EntryHistoryPoint, type HistoryRow } from '@/lib/history';

describe('snapshotValue (valor de uma carta na foto diária)', () => {
  it('sem foto, sem valor', () => {
    expect(snapshotValue(null, 'pt')).toBeUndefined();
    expect(snapshotValue({}, 'pt')).toBeUndefined();
  });

  it('"Meu valor" vence tudo, com faixa de um valor só', () => {
    const s = { manual: { value: 40 }, mypApi: { min: 1, avg: 2, max: 3 }, tcgplayer: { avg: 9 } };
    expect(snapshotValue(s, 'en')).toEqual({ min: 40, avg: 40, max: 40, pick: 40, source: 'manual' });
  });

  it('TCGplayer só nas cartas em inglês e japonês; senão o MYP', () => {
    const s = { tcgplayer: { min: 8, avg: 12, max: 15 }, mypApi: { min: 5, avg: 10, max: 20 } };
    expect(snapshotValue(s, 'en')).toEqual({ min: 8, avg: 12, max: 15, pick: 12, source: 'tcgplayer' });
    expect(snapshotValue(s, 'ja')).toEqual({ min: 8, avg: 12, max: 15, pick: 12, source: 'tcgplayer' });
    expect(snapshotValue(s, 'pt')).toEqual({ min: 5, avg: 10, max: 20, pick: 10, source: 'myp' });
    expect(snapshotValue({ ...s, tcgplayer: { notFound: 'x' } }, 'en')?.source).toBe('myp');
    // Japonesa sem preço na TCGplayer (e sem MYP, que não tem japonesas): sem valor.
    expect(snapshotValue({ tcgplayer: { notFound: 'sem vendas recentes na TCGplayer' } }, 'ja')).toBeUndefined();
    expect(snapshotValue({ basis: 'min', tcgplayer: { min: 8, avg: 12, max: 15 } }, 'ja')?.pick).toBe(8);
  });

  it('usa a escolha gravada na foto ("Usar na soma"), ou a pedida', () => {
    const s = { basis: 'min', mypApi: { min: 5, avg: 10, max: 20 } };
    expect(snapshotValue(s, 'pt')?.pick).toBe(5);
    expect(snapshotValue({ ...s, basis: 'max' }, 'pt')?.pick).toBe(20);
    expect(snapshotValue({ ...s, basis: 'outra' }, 'pt')?.pick).toBe(10);
    expect(snapshotValue(s, 'pt', 'avg')?.pick).toBe(10);
  });

  it('fontes antigas e valores que não são números não entram', () => {
    expect(snapshotValue({ sold: { avg: 50 }, liga: { avg: 60 } }, 'pt')).toBeUndefined();
    expect(snapshotValue({ mypApi: { avg: '10' } }, 'pt')).toBeUndefined();
    expect(snapshotValue({ manual: { value: '10' }, mypApi: { avg: 7 } }, 'pt')?.source).toBe('myp');
    // A faixa sempre contém a média.
    expect(snapshotValue({ mypApi: { min: 15, avg: 10, max: 8 } }, 'pt')).toMatchObject({ min: 10, max: 10 });
  });
});

const row = (entry_id: string, day: string, sources: HistoryRow['sources'], over: Partial<HistoryRow> = {}): HistoryRow => ({
  entry_id,
  day,
  card_id: `card-${entry_id}`,
  lang: 'pt',
  variant: 'normal',
  sources,
  ...over,
});
const price = (avg: number, basis?: string) => ({ ...(basis ? { basis } : {}), mypApi: { min: avg / 2, avg, max: avg * 2 } });

describe('compareDays (variação só com as mesmas cartas)', () => {
  const D1 = '2026-10-01';
  const D2 = '2026-10-08';
  const rows: HistoryRow[] = [
    // Mesma carta nos dois dias: entram na variação.
    row('up', D1, price(10)),
    row('up', D2, price(14)),
    row('down', D1, price(20)),
    row('down', D2, price(15)),
    row('flat', D1, price(5)),
    row('flat', D2, price(5)),
    // "Meu valor" nos dois dias: entra na soma, não nas altas e quedas.
    row('mine', D1, { manual: { value: 30 } }),
    row('mine', D2, { manual: { value: 35 } }),
    // Trocou "Usar na soma" de média para mínimo: compara pelo mínimo nos dois dias.
    row('basis', D1, price(8)),
    row('basis', D2, price(8, 'min')),
    // Só no último dia (nova), só no primeiro (removida), outra carta no mesmo bolso e outra fonte.
    row('new', D2, price(100)),
    row('gone', D1, price(50)),
    row('swap', D1, price(7)),
    row('swap', D2, price(70), { card_id: 'outra' }),
    row('src', D1, price(9)),
    row('src', D2, { manual: { value: 90 } }),
    row('lang', D1, price(3)),
    row('lang', D2, price(3), { lang: 'en' }),
    // Sem preço no último dia: conta como removida.
    row('lost', D1, price(6)),
    row('lost', D2, {}),
  ];

  const c = compareDays(rows, D1, D2);

  it('separa iguais, novas, removidas e trocadas', () => {
    expect(c.same).toBe(5);
    expect(c.added).toBe(1);
    expect(c.addedValue).toBe(100);
    expect(c.removed).toBe(2);
    expect(c.removedValue).toBe(56);
    expect(c.changed).toBe(3);
  });

  it('soma e variação só das iguais', () => {
    // up 10→14, down 20→15, flat 5→5, mine 30→35, basis 4→4 (mínimo nos dois dias).
    expect(c.fromValue).toBe(69);
    expect(c.toValue).toBe(73);
    expect(c.diff).toBe(4);
    expect(c.pct).toBeCloseTo((4 / 69) * 100, 10);
  });

  it('maiores altas e quedas, sem as cartas com "Meu valor"', () => {
    expect(c.up.map((m) => [m.entryId, m.diff])).toEqual([['up', 4]]);
    expect(c.down.map((m) => [m.entryId, m.diff])).toEqual([['down', -5]]);
    expect(c.up[0].pct).toBeCloseTo(40, 10);
  });

  it('sem valor no primeiro dia, sem porcentagem', () => {
    const only = compareDays([row('a', D2, price(10))], D1, D2);
    expect(only.pct).toBeNull();
    expect(only.added).toBe(1);
  });

  it('versão ausente na foto conta como normal', () => {
    const r = compareDays([row('v', D1, price(10), { variant: null }), row('v', D2, price(12))], D1, D2);
    expect(r.same).toBe(1);
    expect(r.changed).toBe(0);
  });

  it('mesma carta sem preço reconhecido no primeiro dia (fontes antigas): ganhou preço, não é carta nova', () => {
    const old = { myp: { avg: 9 }, sold: { avg: 8 } };
    const r = compareDays(
      [
        row('old', D1, old),
        row('old', D2, price(12)),
        // Outra carta no mesmo bolso, também sem preço reconhecido no primeiro dia: trocada.
        row('swap', D1, old),
        row('swap', D2, price(5), { card_id: 'outra' }),
      ],
      D1,
      D2,
    );
    expect(r.added).toBe(0);
    expect(r.priced).toBe(1);
    expect(r.pricedValue).toBe(12);
    expect(r.changed).toBe(1);
    expect(r.same).toBe(0);
    expect(r.pct).toBeNull();
  });
});

const point = (day: string, source: EntryHistoryPoint['source'], min: number, avg: number, max: number, value = avg): EntryHistoryPoint => ({
  day,
  source,
  min,
  avg,
  max,
  value,
});

describe('entrySeries (linha do histórico de uma carta)', () => {
  it('sem pontos, vazio', () => {
    expect(entrySeries([])).toEqual([]);
  });

  it('só os últimos dias com a fonte do último dia: a troca do "Meu valor" não é alta nem queda', () => {
    const s = entrySeries([point('2026-10-22', 'manual', 75, 75, 75), point('2026-10-23', 'myp', 50, 163, 300, 50), point('2026-10-24', 'myp', 52, 160, 300, 52)], 'min');
    expect(s.map((p) => [p.day, p.value])).toEqual([
      ['2026-10-23', 50],
      ['2026-10-24', 52],
    ]);
  });

  it('a escolha atual ("Usar na soma") em todos os dias, mesmo se mudou no meio', () => {
    const s = entrySeries([point('2026-10-22', 'myp', 5, 10, 20, 10), point('2026-10-23', 'myp', 6, 11, 22, 6)], 'avg');
    expect(s.map((p) => p.value)).toEqual([10, 11]);
    expect(entrySeries([point('2026-10-22', 'myp', 5, 10, 20)], 'max')[0].value).toBe(20);
  });

  it('"Meu valor" fica com o valor digitado', () => {
    const s = entrySeries([point('2026-10-22', 'myp', 5, 10, 20), point('2026-10-23', 'manual', 30, 30, 30), point('2026-10-24', 'manual', 35, 35, 35)], 'min');
    expect(s.map((p) => p.value)).toEqual([30, 35]);
  });
});

describe('dias', () => {
  it('dayString e dayTime são inversos', () => {
    for (const d of ['2026-01-01', '2026-02-28', '2026-10-24', '2026-12-31']) expect(dayString(dayTime(d))).toBe(d);
  });
});
