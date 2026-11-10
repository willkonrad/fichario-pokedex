// Mirror japonês com o marcador escrito antes do número ("Larry's Efficiency (Mirror Foil) - 162/187"): o catalog-sync
// deixava o marcador no nome e o produto sem selo, então a carta salva antes ficou normal ou holo, sem selo. Com o selo
// novo (link.ts e a migração 20261110a_ja_mirror_selo), essa carta passaria a valer pelo preço da carta comum de mesmo
// número, como se fosse exato, ou ficaria sem preço (a que só existe Mirror), e a lista não a marcaria "tenho". Ao ler a
// carta (aparelho, nuvem, cópia), ela vira a versão Mirror do próprio produto.
import { ownershipOf } from '@/components/owned-badge';
import { parseBackup } from '@/lib/backup';
import { upgradeEntry } from '@/lib/entry-upgrade';
import { clearJapaneseCatalogCache } from '@/lib/ja-catalog';
import { supabase } from '@/lib/supabase';
import { fetchTcgplayerPrices, TCG_NOT_FOUND } from '@/lib/tcgplayer';
import type { Entry } from '@/lib/types';
import { valuation } from '@/lib/valuation';

import { entry } from './fixtures';
import type { FakeDb } from './ja-catalog-fake-db';

jest.mock('@/lib/supabase', () => jest.requireActual('./ja-catalog-fake-db').fakeSupabaseModule());
jest.mock('@/store/collection', () => ({ useEntries: () => ({}) }));

const db = supabase as unknown as FakeDb;

const group = { name: 'SV1a: Triplet Beat', abbr: 'SV1a', published_on: '2023-03-10' };
const row = (product_id: number, name: string, number: string, stamp: string | null, full_name: string) => ({
  product_id,
  category: 85,
  group_id: 23909,
  name,
  full_name,
  number,
  rarity: null,
  image: `https://tcgplayer-cdn.tcgplayer.com/product/${product_id}_in_1000x1000.jpg`,
  stamp,
  tcgdex_id: null,
  tcg_groups: group,
});
const print = (product_id: number, sub_type: string, market: number) => ({ product_id, sub_type, low: market, mid: market, market, built_at: '2026-11-10T20:00:00+00:00' });

/** O catálogo depois da regra nova: o Mirror com selo e o nome sem o marcador; o Ampharos só existe Mirror. */
function tables() {
  return {
    tcg_groups: [{ group_id: 23909, category: 85, ...group }],
    tcg_catalog: [
      row(602600, "Larry's Efficiency", '162/187', null, "Larry's Efficiency - 162/187"),
      row(602601, "Larry's Efficiency", '162/187', 'Mirror Foil', "Larry's Efficiency (Mirror Foil) - 162/187"),
      row(608106, 'Ampharos', '033/070', 'Mirror Holofoil', 'Ampharos (Mirror Holofoil) - 033/070'),
    ],
    tcg_prices: [print(602600, 'Normal', 0.1), print(602601, 'Holofoil', 2), print(608106, 'Holofoil', 3)],
    fx_rates: [{ currency: 'USD', day: '2026-11-10', sell: 5 }],
  };
}

beforeEach(() => {
  db.reset(tables());
  clearJapaneseCatalogCache();
});

/** Carta salva do produto antes da regra nova: o nome com o marcador, a variação das impressões (holo), sem selo. */
const oldSave = (over: Partial<Entry> = {}) =>
  entry({ id: '0-0', dex: 0, lang: 'ja', cardId: 'tcgp-602601', cardName: "Larry's Efficiency (Mirror Foil)", setId: 'tcgp23909', setName: 'SV1a: Triplet Beat', localId: '162', variant: 'holo', ...over });

describe('Mirror japonês salvo antes do selo novo', () => {
  it('vira o Mirror do próprio produto: reverse, com o selo, e o nome sem o marcador (a data não muda)', () => {
    const e = oldSave();
    expect(upgradeEntry(e)).toEqual({ ...e, variant: 'reverse', variantNote: 'Mirror Foil', cardName: "Larry's Efficiency" });
    expect(upgradeEntry(oldSave({ variant: 'normal' }))).toMatchObject({ variant: 'reverse', variantNote: 'Mirror Foil' });
    expect(upgradeEntry(oldSave({ cardId: 'tcgp-608106', cardName: 'Ampharos (Mirror Holofoil)' }))).toMatchObject({ variant: 'reverse', variantNote: 'Mirror Holofoil', cardName: 'Ampharos' });
    // Já convertida: igual (o mesmo objeto).
    const done = upgradeEntry(e);
    expect(upgradeEntry(done)).toBe(done);
  });

  it('tcgp-602601 holo ou normal, com o Mirror e a comum no catálogo: o preço do Mirror, exato (nunca o da comum)', async () => {
    const holo = upgradeEntry(oldSave({ id: 'a' }));
    const normal = upgradeEntry(oldSave({ id: 'b', variant: 'normal' }));
    const out = await fetchTcgplayerPrices([holo, normal]);
    for (const id of ['a', 'b']) {
      expect(out.get(id)).toMatchObject({ cardId: 'tcgp-602601', variant: 'reverse', note: 'Mirror Foil', productId: 602601, subType: 'Holofoil', avg: 10 });
      expect(out.get(id)?.base).toBeUndefined();
    }
    expect(valuation({ ...holo, tcgplayer: out.get('a') })).toMatchObject({ basis: 'tcgplayer', value: 10, confidence: 'media' });
    expect(valuation({ ...holo, tcgplayer: out.get('a') }).approx).toBeUndefined();
  });

  it('carta que só existe Mirror (Ampharos 033/070): continua com o preço do próprio produto', async () => {
    const old = oldSave({ id: 'c', cardId: 'tcgp-608106', cardName: 'Ampharos (Mirror Holofoil)', localId: '033' });
    const out = await fetchTcgplayerPrices([upgradeEntry(old)]);
    expect(out.get('c')).toMatchObject({ productId: 608106, avg: 15 });
    expect(out.get('c')?.notFound).toBeUndefined();
    // Sem a conversão, a carta salva ficaria sem preço ("sem o produto desta versão").
    clearJapaneseCatalogCache();
    expect((await fetchTcgplayerPrices([old])).get('c')).toMatchObject({ notFound: TCG_NOT_FOUND.noVersion });
  });

  it('o Mirror trocado de propósito para a comum (nome sem o marcador) continua com o preço da comum', async () => {
    const switched = oldSave({ id: 'd', cardName: "Larry's Efficiency", variant: 'normal' });
    expect(upgradeEntry(switched)).toBe(switched);
    expect((await fetchTcgplayerPrices([switched])).get('d')).toMatchObject({ productId: 602600, subType: 'Normal' });
  });

  it('a lista marca "tenho" no Mirror', () => {
    expect(ownershipOf([upgradeEntry(oldSave())], { stamp: { label: 'Mirror Foil' } })).toEqual({ exact: true, label: 'tenho', count: 1 });
    expect(ownershipOf([oldSave()], { stamp: { label: 'Mirror Foil' } })?.label).toBe('outra versão');
  });

  it('fica como está: com selo ou descrição, "Outra", outra variação, outro idioma ou carta da TCGdex', () => {
    for (const e of [
      oldSave({ variantNote: 'assinada', variant: 'other' }),
      oldSave({ variant: 'reverse', variantNote: 'Mirror Foil' }),
      oldSave({ variant: 'firstEdition' }),
      oldSave({ lang: 'en' }),
      oldSave({ cardId: 'SV1a-162' }),
      oldSave({ cardName: "Larry's Efficiency" }),
    ]) {
      expect(upgradeEntry(e)).toBe(e);
    }
  });

  it('cópia importada também chega convertida', () => {
    const { entries } = parseBackup({ entries: [oldSave()] });
    expect(entries[0]).toMatchObject({ cardId: 'tcgp-602601', variant: 'reverse', variantNote: 'Mirror Foil', cardName: "Larry's Efficiency" });
  });
});
