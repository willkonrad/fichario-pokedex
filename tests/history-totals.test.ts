import { snapshotValue } from '@/lib/history';

// O mesmo caso dá o mesmo número no app e no banco. As fotos abaixo passam por todos os ramos da regra; os totais
// esperados saíram de public.history_day_sums (via history_day_totals, como o cron grava em price_history_daily),
// rodada num Postgres com estas fotos. O app soma pelo snapshotValue (a conta do sumByDay, o caminho reserva sem a
// função no banco). Mudou a regra? Mude os dois lados e refaça os números no Postgres.

type Photo = [day: string, lang: string, sources: Record<string, unknown>];

const PHOTOS: Photo[] = [
  ['2026-11-01', 'pt', { mypApi: { min: 5, avg: 10, max: 20 } }],
  ['2026-11-01', 'pt', { basis: 'min', mypApi: { min: 5, avg: 10, max: 20 } }],
  // Faixa invertida: mínimo e máximo nunca do lado de dentro da média.
  ['2026-11-01', 'pt', { basis: 'max', mypApi: { min: 15, avg: 10, max: 8 } }],
  // Inglesa: TCGplayer antes do MYP.
  ['2026-11-01', 'en', { tcgplayer: { min: 8, avg: 12, max: 15 }, mypApi: { min: 1, avg: 2, max: 3 } }],
  ['2026-11-01', 'ja', { basis: 'max', tcgplayer: { avg: 30 } }],
  // Portuguesa com preço da TCGplayer guardado: não conta, e sem MYP fica sem valor.
  ['2026-11-01', 'pt', { tcgplayer: { min: 1, avg: 2, max: 3 } }],
  ['2026-11-01', 'en', { tcgplayer: { notFound: 'sem vendas' }, mypApi: { min: 4, avg: 6, max: 9 } }],
  // "Meu valor" vence tudo e ignora a escolha.
  ['2026-11-01', 'en', { basis: 'max', manual: { value: 40 }, tcgplayer: { min: 8, avg: 12, max: 15 } }],
  // Valores que não são números não entram.
  ['2026-11-01', 'pt', { manual: { value: '12' }, mypApi: { avg: 7 } }],
  ['2026-11-01', 'pt', { sold: { avg: 50 }, liga: { avg: 60 } }],
  ['2026-11-01', 'pt', { basis: 'min' }],
  ['2026-11-01', 'pt', { mypApi: { avg: '10' } }],
  ['2026-11-01', 'pt', { basis: 'outra', mypApi: { min: 'x', avg: 3.333, max: 4.444 } }],
  ['2026-11-01', 'en', { basis: 'min', manual: { value: null }, tcgplayer: { min: 0.5, avg: 0.755, max: 1 } }],
  ['2026-11-02', 'pt', { basis: 'max', mypApi: { min: 5, avg: 11.111, max: 22.225 } }],
  // Japonesa sem TCGplayer: o MYP guardado.
  ['2026-11-02', 'ja', { mypApi: { min: 1, avg: 2, max: 3 } }],
  ['2026-11-02', 'en', { manual: { value: 99.999 } }],
];

// public.history_day_sums com as fotos acima (somas arredondadas em 2 casas, como no banco).
const FROM_POSTGRES = [
  { day: '2026-11-01', value: 123.83, min: 112.83, avg: 129.09, max: 156.44, cards: 10 },
  { day: '2026-11-02', value: 124.22, min: 106.0, avg: 113.11, max: 125.22, cards: 3 },
];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

describe('total de cada dia: app e banco', () => {
  it('a soma do snapshotValue de cada dia é o total que o banco guarda', () => {
    const byDay = new Map<string, { day: string; value: number; min: number; avg: number; max: number; cards: number }>();
    for (const [day, lang, sources] of PHOTOS) {
      const v = snapshotValue(sources, lang);
      if (!v) continue;
      const t = byDay.get(day) ?? { day, value: 0, min: 0, avg: 0, max: 0, cards: 0 };
      t.value += v.pick;
      t.min += v.min;
      t.avg += v.avg;
      t.max += v.max;
      t.cards++;
      byDay.set(day, t);
    }
    const app = [...byDay.values()].map((t) => ({ ...t, value: round2(t.value), min: round2(t.min), avg: round2(t.avg), max: round2(t.max) }));
    expect(app).toEqual(FROM_POSTGRES);
  });

  it('as fotos sem valor ficam fora dos dois lados', () => {
    const counted = PHOTOS.filter(([, lang, s]) => snapshotValue(s, lang)).length;
    expect(counted).toBe(FROM_POSTGRES.reduce((n, t) => n + t.cards, 0));
  });
});
