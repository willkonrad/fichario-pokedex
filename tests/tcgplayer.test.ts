import type { CatalogRow } from '@/lib/catalog';
import { pickProduct, pickSubType, sameTcgplayerPrice, tcgplayerColumns, tcgplayerDue, tcgplayerFor, tcgplayerReason, type PriceRow } from '@/lib/tcgplayer';

import { AT, entry, tcg } from './fixtures';

let nextId = 1;
const row = (stamp: string | null, group = 'Surging Sparks', over: Partial<CatalogRow> = {}): CatalogRow => ({
  product_id: nextId++,
  category: 3,
  group_id: 1,
  name: 'Pikachu ex',
  full_name: 'Pikachu ex - 057/191',
  number: '057/191',
  rarity: 'Double Rare',
  image: 'https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg',
  stamp,
  tcgdex_id: 'sv08-057',
  tcg_groups: { name: group, abbr: 'SSP' },
  ...over,
});

const en = (over: Parameters<typeof entry>[0] = {}) => entry({ lang: 'en', cardId: 'sv08-057', ...over });

describe('pickProduct (produto da carta na TCGplayer)', () => {
  const common = row(null);
  const center = row('Pokemon Center Exclusive');
  const ball = row('Poke Ball Pattern');
  const master = row('Master Ball Pattern');
  const setStamp = row('Surging Sparks Stamped');
  const jumbo = row('Jumbo Card');
  const all = [jumbo, center, ball, master, setStamp, common];

  it('versão comum: o produto sem selo', () => {
    expect(pickProduct(en(), all)).toEqual({ row: common, base: false });
    expect(pickProduct(en({ variant: 'holo' }), all)).toEqual({ row: common, base: false });
  });

  it('versão escolhida no catálogo: o produto com exatamente esse selo e a mesma variação', () => {
    expect(pickProduct(en({ variant: 'wPromo', variantNote: ' Pokemon Center Exclusive ' }), all)).toEqual({ row: center, base: false });
    // O selo que sobrou depois de trocar de variação não escolhe outra impressão.
    expect(pickProduct(en({ variant: 'reverse', variantNote: 'Pokemon Center Exclusive' }), all)).toEqual({ row: common, base: false });
  });

  it('Poké Ball e Master Ball: o produto "Pattern"; sem ele, a carta base', () => {
    expect(pickProduct(en({ variant: 'pokeball' }), all)).toEqual({ row: ball, base: false });
    expect(pickProduct(en({ variant: 'masterball' }), all)).toEqual({ row: master, base: false });
    expect(pickProduct(en({ variant: 'masterball' }), [common, ball])).toEqual({ row: common, base: true });
  });

  it('promo/staff: pelo selo da TCGdex, pelo selo da Booster Box ou a carta base', () => {
    expect(pickProduct(en({ variant: 'wPromo', stampKeys: ['pokemon-center'] }), all)).toEqual({ row: center, base: false });
    expect(pickProduct(en({ variant: 'wPromo', stampKeys: ['set-logo'] }), all)).toEqual({ row: setStamp, base: false });
    expect(pickProduct(en({ variant: 'staff', stampKeys: ['prerelease'] }), all)).toEqual({ row: common, base: true });
    expect(pickProduct(en({ variant: 'wPromo', variantNote: 'Worlds 2025' }), all)).toEqual({ row: common, base: true });
    // Promo de coleção de promos sem selo marcado: o produto comum é a própria carta.
    expect(pickProduct(en({ variant: 'wPromo' }), all)).toEqual({ row: common, base: false });
  });

  it('1ª edição e Shadowless: a coleção "(Shadowless)" quando existe', () => {
    const unlimited = row(null, 'Base Set');
    const shadowless = row(null, 'Base Set (Shadowless)');
    expect(pickProduct(en({ variant: 'shadowless' }), [unlimited, shadowless])).toEqual({ row: shadowless, base: false });
    expect(pickProduct(en({ variant: 'firstEdition' }), [unlimited, shadowless])).toEqual({ row: shadowless, base: false });
    expect(pickProduct(en({ variant: 'firstEdition' }), [unlimited])).toEqual({ row: unlimited, base: false });
    expect(pickProduct(en(), [shadowless, unlimited])).toEqual({ row: unlimited, base: false });
  });

  it('carta gigante nunca entra; sem produto, nada', () => {
    expect(pickProduct(en(), [jumbo])).toBeUndefined();
    expect(pickProduct(en({ variant: 'wPromo', variantNote: 'Jumbo Card' }), [jumbo, common])).toEqual({ row: common, base: true });
    expect(pickProduct(en(), [])).toBeUndefined();
  });
});

const price = (sub_type: string, market: number | null = 1): PriceRow => ({ product_id: 1, sub_type, low: 0.5, mid: 1, market, built_at: AT });

describe('pickSubType (impressão do produto)', () => {
  it('impressão única: ela', () => {
    expect(pickSubType(en({ variant: 'reverse' }), [price('Normal')], false)?.sub_type).toBe('Normal');
  });

  it('a impressão da variação, nunca a de outra', () => {
    const rows = [price('Normal'), price('Holofoil'), price('Reverse Holofoil')];
    expect(pickSubType(en(), rows, false)?.sub_type).toBe('Normal');
    expect(pickSubType(en({ variant: 'holo' }), rows, false)?.sub_type).toBe('Holofoil');
    expect(pickSubType(en({ variant: 'reverse' }), rows, false)?.sub_type).toBe('Reverse Holofoil');
    expect(pickSubType(en({ variant: 'reverse' }), [price('Normal'), price('Holofoil')], false)).toBeUndefined();
    expect(pickSubType(en({ variant: 'firstEdition' }), [price('Unlimited Holofoil'), price('1st Edition Holofoil')], false)?.sub_type).toBe(
      '1st Edition Holofoil',
    );
    expect(pickSubType(en(), [price('Reverse Holofoil'), price('Unlimited')], false)?.sub_type).toBe('Unlimited');
  });

  it('carta base ou variação sem impressão própria: Holofoil, senão Normal', () => {
    const rows = [price('Normal'), price('Holofoil')];
    expect(pickSubType(en({ variant: 'reverse' }), rows, true)?.sub_type).toBe('Holofoil');
    expect(pickSubType(en({ variant: 'wPromo' }), rows, false)?.sub_type).toBe('Holofoil');
    expect(pickSubType(en({ variant: 'pokeball' }), [price('Normal'), price('Reverse Holofoil')], false)?.sub_type).toBe('Normal');
  });
});

describe('preço guardado da TCGplayer', () => {
  it('tcgplayerFor confere carta, versão e selo', () => {
    const e = en();
    expect(tcgplayerFor({ ...e, tcgplayer: tcg(e) })).toBeDefined();
    expect(tcgplayerFor({ ...e, tcgplayer: tcg(e, { variant: 'holo' }) })).toBeUndefined();
    expect(tcgplayerFor({ ...e, variantNote: 'Cosmos Holo', tcgplayer: tcg(e) })).toBeUndefined();
    expect(tcgplayerFor({ ...e, variantNote: 'Cosmos Holo', tcgplayer: tcg(e, { note: 'Cosmos Holo' }) })).toBeDefined();
  });

  it('sameTcgplayerPrice ignora só a hora da busca', () => {
    const e = en();
    const saved = { ...e, tcgplayer: tcg(e) };
    expect(sameTcgplayerPrice(saved, tcg(e, { checkedAt: '2026-10-22T00:00:00.000Z' }))).toBe(true);
    expect(sameTcgplayerPrice(saved, tcg(e, { avg: 13 }))).toBe(false);
  });

  it('tcgplayerDue: só cartas em inglês; renova com cópia nova do TCGCSV (no máximo 1×/hora)', () => {
    const now = Date.parse(AT);
    const hour = 3_600_000;
    expect(tcgplayerDue(entry({ lang: 'pt' }), undefined, now)).toBe(false);
    const e = en();
    expect(tcgplayerDue(e, undefined, now)).toBe(true);
    const fresh = { ...e, tcgplayer: tcg(e, { builtAt: '2026-10-19' }) };
    expect(tcgplayerDue(fresh, '2026-10-20', now + hour / 2)).toBe(false);
    expect(tcgplayerDue(fresh, '2026-10-20', now + 2 * hour)).toBe(true);
    expect(tcgplayerDue(fresh, '2026-10-19', now + 2 * hour)).toBe(false);
  });

  it('tcgplayerReason tira o nome da loja do fim', () => {
    expect(tcgplayerReason('sem vendas recentes na TCGplayer')).toBe('sem vendas recentes');
    expect(tcgplayerReason(undefined)).toBe('');
  });

  it('tcgplayerColumns: sem a mediana abaixo do mercado nem o menor anúncio acima dele', () => {
    expect(tcgplayerColumns({ usdLow: 4, usdMid: 6, usdMarket: 5 })).toEqual(['min', 'avg', 'max']);
    expect(tcgplayerColumns({ usdLow: 4.5, usdMid: 4.95, usdMarket: 5.32 })).toEqual(['min', 'avg']);
    expect(tcgplayerColumns({ usdLow: 6, usdMid: 7, usdMarket: 5 })).toEqual(['avg', 'max']);
    // Sem menor anúncio ou mediana, a coluna é o próprio mercado.
    expect(tcgplayerColumns({ usdMarket: 5 })).toEqual(['avg']);
    // Mediana igual ao mercado: é a mediana de verdade.
    expect(tcgplayerColumns({ usdLow: 5, usdMid: 5, usdMarket: 5 })).toEqual(['min', 'avg', 'max']);
    // Preço sem os valores em dólar: pela faixa em reais.
    expect(tcgplayerColumns({ min: 8, avg: 12, max: 15 })).toEqual(['min', 'avg', 'max']);
    expect(tcgplayerColumns({ min: 12, avg: 12, max: 12 })).toEqual(['avg']);
  });
});
