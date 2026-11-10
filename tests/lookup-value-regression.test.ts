import { buildNewEntry, type Destination } from '@/lib/add-card';
import { snapshotValue } from '@/lib/history';
import { priceBlock } from '@/lib/lookup-price';
import { toBrief } from '@/lib/lookup-view';
import { valuation } from '@/lib/valuation';
import type { Entry } from '@/lib/types';

import { entry, myp, tcg } from './fixtures';
import { header, jaCard, lookupCard, print } from './lookup-fixtures';

// Regressão de valor (seções 8 e 12): a referência de outro idioma nunca entra na coleção nem na soma.

const dest: Destination = { key: 'dex-6-0', kind: 'dex', dex: 6, slot: 0, title: '#006 Charizard' } as Destination;
const added = (card = lookupCard({ marks: 'ep', prints: [print('H', 100000)] }), lang: 'pt' | 'en' | 'ja' = 'pt') =>
  ({ ...buildNewEntry({ card: toBrief(card, lang), facts: null, version: null, condition: 'NM', dest }), id: 'x', updatedAt: '2026-11-09T00:00:00.000Z' }) as Entry;

describe('carta adicionada pela Consulta', () => {
  it('a Consulta mostra referência, mas a carta nasce sem nenhum preço', () => {
    expect(priceBlock(lookupCard({ marks: 'ep', prints: [print('H', 100000)] }), 'pt', header())).toMatchObject({ ref: 'en', brl: 5500 });
    const e = added();
    expect(e.tcgplayer).toBeUndefined();
    expect(e.mypApi).toBeUndefined();
    expect(e.myValue).toBeUndefined();
  });

  it('nada do preço do índice viaja na carta', () => {
    const text = JSON.stringify(added());
    expect(text).not.toMatch(/100000|5500|"ref"|"usd"|prices|market/i);
  });

  it('não soma nada até uma fonte de verdade trazer o preço', () => {
    const e = added();
    expect(valuation(e).value).toBeUndefined();
    expect(snapshotValue(e as unknown as Record<string, unknown>, e.lang)).toBeUndefined();
  });

  it('em inglês e japonês também nasce sem preço', () => {
    for (const e of [added(lookupCard(), 'en'), added(jaCard({ prints: [print('N', 5000)] }), 'ja')]) {
      expect(e.tcgplayer).toBeUndefined();
      expect(valuation(e).value).toBeUndefined();
    }
  });

  it('carta PT não confirmada leva os dados em inglês sem preço', () => {
    const e = added(lookupCard({ marks: 'eu' }));
    expect(e).toMatchObject({ lang: 'pt', dataLang: 'en' });
    expect(valuation(e).value).toBeUndefined();
  });
});

describe('valor da coleção sem mudança de número', () => {
  it('carta em inglês: TCGplayer, como sempre', () => {
    const e = entry({ lang: 'en', cardId: 'sv08-057' });
    const withPrices = { ...e, tcgplayer: tcg(e), mypApi: myp(e) };
    expect(valuation(withPrices)).toMatchObject({ value: 12, range: { min: 8, avg: 12, max: 15 }, basis: 'tcgplayer' });
    expect(snapshotValue(withPrices as unknown as Record<string, unknown>, 'en')).toEqual({ min: 8, avg: 12, max: 15, pick: 12, source: 'tcgplayer' });
  });

  it('carta em português: MYP, e o preço de outro idioma guardado não conta', () => {
    const e = entry({ lang: 'pt' });
    const withPrices = { ...e, tcgplayer: tcg(e), mypApi: myp(e) };
    expect(valuation(withPrices)).toMatchObject({ value: 10, range: { min: 5, avg: 10, max: 20 }, basis: 'myp' });
    expect(snapshotValue(withPrices as unknown as Record<string, unknown>, 'pt')).toEqual({ min: 5, avg: 10, max: 20, pick: 10, source: 'myp' });
  });

  it('"Meu valor" continua na frente', () => {
    const e: Entry = { ...entry({ lang: 'en' }), myValue: { value: 99, setAt: '2026-11-09T00:00:00.000Z' } };
    expect(valuation({ ...e, tcgplayer: tcg(e) }).value).toBe(99);
  });
});

describe('quem cuida do valor não lê a Consulta', () => {
  const { readFileSync } = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');
  const root = expect.getState().testPath!.replace(/[\\/]tests[\\/][^\\/]+$/, '');
  const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8');

  it.each(['src/lib/valuation.ts', 'src/lib/history.ts', 'src/lib/add-card.ts', 'src/components/add-sheet.tsx', 'src/store/collection.tsx'])('%s não importa lookup-price', (path) => {
    expect(read(path)).not.toMatch(/lookup-price/);
  });

  it('o banco não conhece o índice nas funções de valor', () => {
    const schema = read('supabase/schema.sql');
    for (const fn of ['collection_history', 'history_day_sums', 'history_day_totals', 'snapshot_prices']) {
      const at = schema.indexOf(`function public.${fn}`);
      expect(at).toBeGreaterThanOrEqual(0);
      const end = schema.indexOf('$$;', at);
      expect(schema.slice(at, end)).not.toMatch(/lookup_index/);
    }
  });

  it('a referência existe só em lookup-price', () => {
    const others = ['src/lib/lookup-view.ts', 'src/lib/lookup-format.ts', 'src/lib/lookup-index.ts', 'src/lib/lookup-links.ts', 'src/lib/lookup-myp.ts'];
    for (const path of others) expect(read(path)).not.toMatch(/\bref:\s*'(en|ja)'/);
  });
});
