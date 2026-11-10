// Variação padrão da carta japonesa só do catálogo, pelas impressões do produto na cópia do TCGCSV (tcg_prices).
import { defaultVersion, loadCardFacts } from '@/lib/add-card';
import type { CardBrief } from '@/lib/tcgdex';
import { catalogOnlyVariant } from '@/lib/tcgplayer';

import { fakeTables } from './fake-catalog-db';

jest.mock('@/store/collection', () => ({
  entryId: (dex: number, slot: number) => `${dex}-${slot}`,
  customEntryId: (binderId: string, slot: number) => `${binderId}:${slot}`,
}));
jest.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => jest.requireActual('./fake-catalog-db').fakeFrom(t) } }));

const print = (product_id: number, sub_type: string) => ({ product_id, sub_type, low: null, mid: null, market: 1, built_at: '2026-11-06' });

beforeEach(() => {
  fakeTables.tcg_prices = [
    // Charizard DP3: 1ª edição holo e Unlimited holo.
    print(605896, '1st Edition Holofoil'),
    print(605896, 'Unlimited Holofoil'),
    print(700001, '1st Edition'),
    print(700002, 'Normal'),
    print(700002, 'Holofoil'),
  ];
});

describe('catalogOnlyVariant', () => {
  it('carta japonesa "tcgp-": a variação das impressões do produto', async () => {
    expect(await catalogOnlyVariant({ id: 'tcgp-605896', lang: 'ja' })).toBe('holo');
    expect(await catalogOnlyVariant({ id: 'tcgp-700001', lang: 'ja' })).toBe('firstEdition');
  });

  it('impressões misturadas, produto sem impressões, versão com selo ou outra carta: nada', async () => {
    expect(await catalogOnlyVariant({ id: 'tcgp-700002', lang: 'ja' })).toBeUndefined();
    expect(await catalogOnlyVariant({ id: 'tcgp-999999', lang: 'ja' })).toBeUndefined();
    expect(await catalogOnlyVariant({ id: 'tcgp-605896', lang: 'ja', stamp: { label: 'Mirror Holofoil' } })).toBeUndefined();
    expect(await catalogOnlyVariant({ id: 'tcgp-605896', lang: 'en' })).toBeUndefined();
    expect(await catalogOnlyVariant({ id: 'M5-088', lang: 'ja' })).toBeUndefined();
  });
});

describe('loadCardFacts: carta japonesa só do catálogo sem versões na ficha', () => {
  const charizard: CardBrief = { id: 'tcgp-605896', localId: '', name: 'Charizard', lang: 'ja', setId: 'tcgp1', setName: 'DP3', setNameEn: 'DP3', setOrder: 1 };

  it('a versão é a das impressões do produto (holo), não a normal', async () => {
    const facts = await loadCardFacts(charizard);
    expect(facts.versions).toEqual([{ variant: 'holo' }]);
    expect(defaultVersion(facts.versions, charizard)).toEqual({ variant: 'holo' });
  });

  it('impressões misturadas: continua sem versões (fica a regra de sempre)', async () => {
    const facts = await loadCardFacts({ ...charizard, id: 'tcgp-700002' });
    expect(facts.versions).toEqual([]);
  });
});
