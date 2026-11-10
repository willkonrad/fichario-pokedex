import type { CatalogRow } from '@/lib/catalog';
import {
  hasTcgplayerCards,
  pickProduct,
  pickSubType,
  sameTcgplayerPrice,
  TCG_NOT_FOUND,
  tcgplayerColumns,
  tcgplayerCovers,
  tcgplayerDue,
  tcgplayerFor,
  tcgplayerPricesFrom,
  tcgplayerReason,
  variantFromPrints,
  type PriceRow,
} from '@/lib/tcgplayer';
import type { Entry } from '@/lib/types';
import { valuation } from '@/lib/valuation';
import { mergeEntry, mypMyValuePatch, tcgplayerMyValuePatch } from '@/store/collection';

import { AT, entry, LATER, tcg } from './fixtures';

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
    expect(pickProduct(en({ variant: 'staff', stampKeys: ['pre-release'] }), all)).toEqual({ row: common, base: true });
    expect(pickProduct(en({ variant: 'wPromo', variantNote: 'Worlds 2025' }), all)).toEqual({ row: common, base: true });
    // Promo de coleção de promos sem selo marcado: o produto comum é a própria carta.
    expect(pickProduct(en({ variant: 'wPromo' }), all)).toEqual({ row: common, base: false });
  });

  it('selo de Prerelease: a chave da TCGdex ("pre-release") acha o produto; o de Staff, só com o selo de Staff', () => {
    const prerelease = row('Prerelease');
    const staff = row('Staff Prerelease');
    const rows = [common, prerelease, staff];
    expect(pickProduct(en({ variant: 'staff', stampKeys: ['prerelease'] }), rows)).toEqual({ row: prerelease, base: false });
    expect(pickProduct(en({ variant: 'staff', stampKeys: ['prerelease', 'staff'] }), rows)).toEqual({ row: staff, base: false });
    // Cartas já salvas com a chave antiga.
    expect(pickProduct(en({ variant: 'wPromo', stampKeys: ['pre-release'], variantNote: 'Pre Release' }), rows)).toEqual({ row: prerelease, base: false });
    expect(pickProduct(en({ variant: 'staff', stampKeys: ['pre-release', 'staff'] }), rows)).toEqual({ row: staff, base: false });
    expect(pickProduct(en({ variant: 'staff', variantNote: 'Pre Release' }), rows)).toEqual({ row: prerelease, base: false });
  });

  it('selo só do logo: o "<Coleção> Stamped"; sem ele, o Prerelease, nunca o de Staff', () => {
    const prerelease = row('Prerelease');
    const staff = row('Staff Prerelease');
    const logo = en({ variant: 'wPromo', stampKeys: ['set-logo'], variantNote: 'Logo da coleção' });
    expect(pickProduct(logo, [common, prerelease, staff])).toEqual({ row: prerelease, base: false });
    expect(pickProduct(logo, [common, setStamp, prerelease])).toEqual({ row: setStamp, base: false });
    expect(pickProduct(logo, [common, staff])).toEqual({ row: common, base: true });
    // Com o nome que a lista de versões dá (Pré-release ou o antigo, Booster Box): os mesmos produtos.
    expect(pickProduct({ ...logo, variantNote: 'Logo da coleção (Pré-release)' }, [common, prerelease, staff])).toEqual({ row: prerelease, base: false });
    expect(pickProduct({ ...logo, variantNote: 'Logo da coleção (Booster Box)' }, [common, prerelease, staff])).toEqual({ row: prerelease, base: false });
    expect(pickProduct({ ...logo, variantNote: 'Logo da coleção (Booster Box)' }, [common, setStamp, prerelease])).toEqual({ row: setStamp, base: false });
    // Logo com Staff: o produto de Staff; sem ele, a carta base (nunca o Prerelease comum como se fosse exato).
    const logoStaff = en({ variant: 'staff', stampKeys: ['set-logo', 'staff'] });
    expect(pickProduct(logoStaff, [common, prerelease, staff])).toEqual({ row: staff, base: false });
    expect(pickProduct(logoStaff, [common, prerelease])).toEqual({ row: common, base: true });
  });

  it('carta que só existe com selo e só tem o produto sem selo: esse produto é a própria carta (sem "≈ Aproximado")', () => {
    const logo = en({ variant: 'wPromo', stampKeys: ['set-logo'], variantNote: 'Logo da coleção (Booster Box)' });
    expect(pickProduct(logo, [common])).toEqual({ row: common, base: true });
    expect(pickProduct(logo, [common], true)).toEqual({ row: common, base: false });
    // Com o produto do selo, ele continua valendo.
    expect(pickProduct(logo, [common, setStamp], true)).toEqual({ row: setStamp, base: false });
  });

  it('"Outra" versão: o preço da carta comum só como carta base', () => {
    expect(pickProduct(en({ variant: 'other', variantNote: 'erro de impressão' }), all)).toEqual({ row: common, base: true });
    expect(pickProduct(en({ variant: 'other' }), all)).toEqual({ row: common, base: true });
  });

  it('1ª edição e Shadowless: a coleção "(Shadowless)" quando existe', () => {
    const unlimited = row(null, 'Base Set');
    const shadowless = row(null, 'Base Set (Shadowless)');
    expect(pickProduct(en({ variant: 'shadowless' }), [unlimited, shadowless])).toEqual({ row: shadowless, base: false });
    expect(pickProduct(en({ variant: 'firstEdition' }), [unlimited, shadowless])).toEqual({ row: shadowless, base: false });
    expect(pickProduct(en({ variant: 'firstEdition' }), [unlimited])).toEqual({ row: unlimited, base: false });
    expect(pickProduct(en(), [shadowless, unlimited])).toEqual({ row: unlimited, base: false });
  });

  it('carta gigante: só pelo selo exato do produto dela, nunca pelo preço da carta comum; sem produto, nada', () => {
    expect(pickProduct(en(), [jumbo])).toBeUndefined();
    expect(pickProduct(en(), [jumbo, common])).toEqual({ row: common, base: false });
    expect(pickProduct(en({ variant: 'wPromo', variantNote: 'Jumbo Card' }), [jumbo, common])).toEqual({ row: jumbo, base: false });
    // Selo de carta gigante sem esse produto, ou salvo em outra variação: sem preço.
    expect(pickProduct(en({ variant: 'wPromo', variantNote: 'Jumbo Cards · CoroCoro Promo' }), [jumbo, common])).toBeUndefined();
    expect(pickProduct(en({ variant: 'holo', variantNote: 'Jumbo Card' }), [jumbo, common])).toBeUndefined();
    expect(pickProduct(en(), [])).toBeUndefined();
  });

  it('mais de um produto possível: ambíguo (sem preço), nunca o primeiro achado', () => {
    // O mesmo Pikachu (basep-1) na "WoTC Promo" e na "Pikachu World Collection Promos", os dois sem selo.
    const wotc = row(null, 'WoTC Promo');
    const world = row(null, 'Pikachu World Collection Promos');
    expect(pickProduct(en(), [wotc, world])).toEqual({ ambiguous: true });
    expect(pickProduct(en(), [world, wotc])).toEqual({ ambiguous: true });
    expect(pickProduct(en({ variant: 'pokeball' }), [wotc, world])).toEqual({ ambiguous: true });
    expect(pickProduct(en({ variant: 'firstEdition' }), [wotc, world])).toEqual({ ambiguous: true });
    // O produto próprio da versão continua achado.
    expect(pickProduct(en({ variant: 'pokeball' }), [wotc, world, ball])).toEqual({ row: ball, base: false });
    // Dois produtos com o mesmo selo (os decks da Battle Academy 2024): ambíguo.
    const deck1 = row('Battle Academy 2024');
    const deck2 = row('Battle Academy 2024');
    expect(pickProduct(en({ variant: 'wPromo', variantNote: 'Battle Academy 2024' }), [common, deck1, deck2])).toEqual({ ambiguous: true });
    expect(pickProduct(en({ variant: 'pokeball' }), [common, ball, row('Poke Ball Pattern')])).toEqual({ ambiguous: true });
  });
});

const price = (sub_type: string, market: number | null = 1): PriceRow => ({ product_id: 1, sub_type, low: 0.5, mid: 1, market, built_at: AT });

describe('pickSubType (impressão do produto)', () => {
  it('impressão única: ela, quando é da mesma espécie da variação (nunca o preço de outra versão)', () => {
    expect(pickSubType(en({ variant: 'holo' }), [price('Normal')], false)?.sub_type).toBe('Normal');
    expect(pickSubType(en(), [price('Holofoil')], false)?.sub_type).toBe('Holofoil');
    expect(pickSubType(en({ variant: 'reverse' }), [price('Reverse Holofoil')], false)?.sub_type).toBe('Reverse Holofoil');
    // Reverse com só a impressão comum (a 212-0, basep-33, só tem "Normal"), e o contrário: sem preço.
    expect(pickSubType(en({ variant: 'reverse' }), [price('Normal')], false)).toBeUndefined();
    expect(pickSubType(en(), [price('Reverse Holofoil')], false)).toBeUndefined();
    expect(pickSubType(en({ variant: 'firstEdition' }), [price('Unlimited')], false)).toBeUndefined();
    expect(pickSubType(en({ variant: 'shadowless' }), [price('1st Edition Holofoil')], false)).toBeUndefined();
    // Carta base (versão sem produto próprio): a impressão do produto base.
    expect(pickSubType(en({ variant: 'pokeball' }), [price('Normal')], true)?.sub_type).toBe('Normal');
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
    expect(pickSubType(en({ variant: 'wPromo' }), rows, true)?.sub_type).toBe('Holofoil');
    expect(pickSubType(en({ variant: 'pokeball' }), [price('Normal'), price('Reverse Holofoil')], false)?.sub_type).toBe('Normal');
  });

  it('Normal e Holofoil sem nada que diga qual é a carta (Prize Pack): sem preço, na dúvida', () => {
    const rows = [price('Normal'), price('Holofoil')];
    expect(pickSubType(en({ variant: 'wPromo', variantNote: 'Prize Pack Series Cards' }), rows, false, true)).toBeUndefined();
    expect(pickSubType(en({ variant: 'staff' }), rows, false, true)).toBeUndefined();
    // A variação que diz a impressão continua com preço.
    expect(pickSubType(en({ variant: 'holo' }), rows, false)?.sub_type).toBe('Holofoil');
    expect(pickSubType(en({ variant: 'normal' }), rows, false)?.sub_type).toBe('Normal');
  });

  it('variação sem impressão própria também acha as impressões Unlimited, nunca a 1ª edição', () => {
    expect(pickSubType(en({ variant: 'wPromo', variantNote: 'Red Cheeks' }), [price('1st Edition'), price('Unlimited')], false, true)?.sub_type).toBe('Unlimited');
    expect(pickSubType(en({ variant: 'wPromo' }), [price('1st Edition Holofoil'), price('Unlimited Holofoil')], false, true)?.sub_type).toBe('Unlimited Holofoil');
    expect(pickSubType(en({ variant: 'wPromo' }), [price('1st Edition Holofoil'), price('1st Edition')], false, true)).toBeUndefined();
  });
});

describe('variantFromPrints (variação padrão da carta japonesa só do catálogo)', () => {
  it('só 1ª edição: 1ª edição; só holofoil: holo; o resto: nada (fica a normal)', () => {
    expect(variantFromPrints(['1st Edition'])).toBe('firstEdition');
    expect(variantFromPrints(['1st Edition Holofoil'])).toBe('firstEdition');
    // Charizard DP3 605896: "1st Edition Holofoil" + "Unlimited Holofoil".
    expect(variantFromPrints(['1st Edition Holofoil', 'Unlimited Holofoil'])).toBe('holo');
    expect(variantFromPrints(['Holofoil'])).toBe('holo');
    expect(variantFromPrints(['1st Edition', 'Unlimited'])).toBeUndefined();
    expect(variantFromPrints(['Normal', 'Holofoil'])).toBeUndefined();
    expect(variantFromPrints(['Reverse Holofoil'])).toBeUndefined();
    expect(variantFromPrints([])).toBeUndefined();
  });

  it('com a variação das impressões, a carta tem preço (a normal ficava sem)', () => {
    const prints = [price('1st Edition Holofoil', 69.99), price('Unlimited Holofoil', 66.32)];
    const charizard = ja({ cardId: 'tcgp-605896', variant: 'normal' });
    expect(pickSubType(charizard, prints, false)).toBeUndefined();
    const v = variantFromPrints(prints.map((p) => p.sub_type))!;
    expect(pickSubType({ ...charizard, variant: v }, prints, false)?.sub_type).toBe('Unlimited Holofoil');
    const first = [price('1st Edition', 3)];
    expect(pickSubType({ ...charizard, variant: variantFromPrints(['1st Edition'])! }, first, false)?.sub_type).toBe('1st Edition');
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

  it('tcgplayerDue: só cartas em inglês e japonês; renova com cópia nova do TCGCSV (no máximo 1×/hora)', () => {
    const now = Date.parse(AT);
    const hour = 3_600_000;
    expect(tcgplayerDue(entry({ lang: 'pt' }), undefined, now)).toBe(false);
    const ja = entry({ lang: 'ja', cardId: 'M5-088' });
    expect(tcgplayerDue(ja, undefined, now)).toBe(true);
    expect(tcgplayerDue({ ...ja, tcgplayer: tcg(ja, { builtAt: '2026-10-19' }) }, '2026-10-20', now + 2 * hour)).toBe(true);
    // Japonesa ainda sem o produto achado: olhada de novo no máximo a cada hora.
    const missing = { ...ja, tcgplayer: tcg(ja, { min: undefined, avg: undefined, max: undefined, notFound: 'carta fora do catálogo da TCGplayer' }) };
    expect(tcgplayerDue(missing, '2026-10-20', now + hour / 2)).toBe(false);
    expect(tcgplayerDue(missing, '2026-10-20', now + 2 * hour)).toBe(true);
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

// ---------- Cartas japonesas (categoria 85) ----------

let jaId = 900_000;
/** Produto da TCGplayer japonesa (85): Dhelmise 088/081 de "M5: Abyss Eye", ou o pedido. */
const jrow = (stamp: string | null, over: Partial<CatalogRow> = {}): CatalogRow => ({
  product_id: jaId++,
  category: 85,
  group_id: 24711,
  name: 'Dhelmise',
  full_name: stamp ? `Dhelmise - 088/081 (${stamp})` : 'Dhelmise - 088/081',
  number: '088/081',
  rarity: 'Art Rare',
  image: 'https://tcgplayer-cdn.tcgplayer.com/product/695039_in_1000x1000.jpg',
  stamp,
  tcgdex_id: null,
  tcg_groups: { name: 'M5: Abyss Eye', abbr: 'M5', published_on: '2026-05-22' },
  ...over,
});

const ja = (over: Partial<Entry> = {}) =>
  entry({ id: '781-0', dex: 781, lang: 'ja', cardId: 'M5-088', setId: 'M5', localId: '088', setTotal: 81, variant: 'holo', ...over });

describe('tcgplayerCovers', () => {
  it('inglês e japonês; português não', () => {
    expect(tcgplayerCovers('en')).toBe(true);
    expect(tcgplayerCovers('ja')).toBe(true);
    expect(tcgplayerCovers('pt')).toBe(false);
    expect(tcgplayerCovers(null)).toBe(false);
  });
});

describe('pickProduct na 85 (carta japonesa)', () => {
  const plain = jrow(null);
  const mirror = jrow('Mirror Holofoil');
  const ball = jrow('Poke Ball Pattern');
  const energy = jrow('Energy Symbol Pattern');

  it('normal e holo: o produto sem selo', () => {
    expect(pickProduct(ja(), [mirror, ball, energy, plain])).toEqual({ row: plain, base: false });
    expect(pickProduct(ja({ variant: 'normal' }), [plain, mirror])).toEqual({ row: plain, base: false });
  });

  it('reverse: o produto Mirror/Reverse; sem ele, a carta comum como carta base (aproximado)', () => {
    expect(pickProduct(ja({ variant: 'reverse' }), [plain, mirror])).toEqual({ row: mirror, base: false });
    const reverseHolo = jrow('Reverse Holofoil');
    expect(pickProduct(ja({ variant: 'reverse' }), [plain, reverseHolo])).toEqual({ row: reverseHolo, base: false });
    // "MIrror Holofoil" (assim no catálogo) também.
    const typo = jrow('MIrror Holofoil');
    expect(pickProduct(ja({ variant: 'reverse' }), [plain, typo])).toEqual({ row: typo, base: false });
    expect(pickProduct(ja({ variant: 'reverse' }), [plain, ball])).toEqual({ row: plain, base: true });
  });

  it('Poké Ball e Master Ball: o "Pattern" da versão; sem ele, a carta base', () => {
    expect(pickProduct(ja({ variant: 'pokeball' }), [plain, mirror, ball])).toEqual({ row: ball, base: false });
    expect(pickProduct(ja({ variant: 'masterball' }), [plain, mirror, ball])).toEqual({ row: plain, base: true });
  });

  it('o selo salvo escolhe o produto com exatamente esse selo e a mesma variação', () => {
    expect(pickProduct(ja({ variant: 'wPromo', variantNote: 'Energy Symbol Pattern' }), [plain, energy])).toEqual({ row: energy, base: false });
    expect(pickProduct(ja({ variant: 'reverse', variantNote: 'Mirror Holofoil' }), [plain, mirror])).toEqual({ row: mirror, base: false });
    // Promo com um selo que a TCGplayer não vende à parte: a carta base; sem selo marcado, a própria carta.
    expect(pickProduct(ja({ variant: 'wPromo', variantNote: 'Pokémon Center' }), [plain, energy])).toEqual({ row: plain, base: true });
    expect(pickProduct(ja({ variant: 'wPromo' }), [plain, energy])).toEqual({ row: plain, base: false });
  });

  it('carta gigante: só pelo selo exato do produto dela, nunca pelo preço da carta comum', () => {
    const jumbo = jrow('Jumbo Card');
    expect(pickProduct(ja({ variant: 'wPromo', variantNote: 'Jumbo Card' }), [plain, jumbo])).toEqual({ row: jumbo, base: false });
    expect(pickProduct(ja({ variant: 'wPromo', variantNote: 'Jumbo Card' }), [plain])).toBeUndefined();
  });

  it('mais de um produto possível: ambíguo (sem preço), nunca o primeiro', () => {
    const twin = jrow(null);
    expect(pickProduct(ja(), [plain, twin])).toEqual({ ambiguous: true });
    expect(pickProduct(ja({ variant: 'reverse' }), [plain, twin])).toEqual({ ambiguous: true });
    expect(pickProduct(ja({ variant: 'reverse' }), [plain, mirror, jrow('Mirror Holo')])).toEqual({ ambiguous: true });
  });

  it('produto da categoria 3 nunca serve para a japonesa; sem selo comum, nada', () => {
    expect(pickProduct(ja(), [jrow(null, { category: 3 })])).toBeUndefined();
    expect(pickProduct(ja(), [mirror])).toBeUndefined();
    expect(pickProduct(ja(), [])).toBeUndefined();
  });
});

describe('pickSubType na 85 (a impressão única não dá a uma versão o preço de outra)', () => {
  const price85 = (sub_type: string) => ({ ...price(sub_type), product_id: 2 });

  it('a única impressão da mesma espécie vale; reverse ou 1ª edição não ficam com o preço da comum', () => {
    expect(pickSubType(ja(), [price85('Normal')], false)?.sub_type).toBe('Normal');
    expect(pickSubType(ja({ variant: 'normal' }), [price85('Holofoil')], false)?.sub_type).toBe('Holofoil');
    expect(pickSubType(ja({ variant: 'firstEdition' }), [price85('Normal')], false)).toBeUndefined();
    expect(pickSubType(ja({ variant: 'firstEdition' }), [price85('1st Edition')], false)?.sub_type).toBe('1st Edition');
    expect(pickSubType(ja(), [price85('1st Edition Holofoil')], false)).toBeUndefined();
  });

  it('produto próprio da versão (Mirror, cuja impressão é "Holofoil") e carta base: a impressão dele', () => {
    expect(pickSubType(ja({ variant: 'reverse' }), [price85('Holofoil')], false, true)?.sub_type).toBe('Holofoil');
    expect(pickSubType(ja({ variant: 'reverse' }), [price85('Normal'), price85('Holofoil')], false, true)?.sub_type).toBe('Holofoil');
    expect(pickSubType(ja({ variant: 'reverse' }), [price85('Normal')], true)?.sub_type).toBe('Normal');
  });

  it('carta base em produto de 1ª edição + Unlimited: a impressão Unlimited, nunca a 1ª edição', () => {
    expect(pickSubType(ja({ variant: 'reverse' }), [price85('1st Edition'), price85('Unlimited')], true)?.sub_type).toBe('Unlimited');
    expect(pickSubType(ja({ variant: 'reverse' }), [price85('1st Edition Holofoil'), price85('Unlimited Holofoil')], true)?.sub_type).toBe('Unlimited Holofoil');
  });

  it('na 3 também (carta em inglês): o reverse não fica com o preço da comum', () => {
    expect(pickSubType(en({ variant: 'reverse' }), [price('Normal')], false)).toBeUndefined();
  });
});

describe('tcgplayerPricesFrom (preço de cada carta a partir do banco)', () => {
  const fx = { day: '2026-11-06', sell: 5.5 };
  const product = jrow(null, { product_id: 695039 });
  const prices = new Map<number, PriceRow[]>([[695039, [{ product_id: 695039, sub_type: 'Holofoil', low: 0.4, mid: 0.6, market: 0.5, built_at: AT }]]]);
  const run = (e: Entry, rows: CatalogRow[], p = prices) => tcgplayerPricesFrom([e], new Map([[e.id, rows]]), p, fx, LATER).get(e.id)!;

  it('carta "tcgp-" da 85 com preço: em reais pela PTAX, com o produto (que dá a foto)', () => {
    const e = ja({ cardId: 'tcgp-695039' });
    expect(run(e, [product])).toMatchObject({
      cardId: 'tcgp-695039',
      productId: 695039,
      subType: 'Holofoil',
      usdMarket: 0.5,
      min: 2.2,
      avg: 2.75,
      max: 3.3,
      fx: 5.5,
      fxDay: '2026-11-06',
      checkedAt: LATER,
    });
    expect(run(e, [product]).base).toBeUndefined();
  });

  it('carta japonesa apontando para um produto da 3 (a carta em inglês): sem preço', () => {
    const e = ja({ cardId: 'tcgp-1' });
    const out = run(e, [{ ...product, category: 3 }]);
    expect(out.notFound).toBe(TCG_NOT_FOUND.otherLanguage);
    expect(out.avg).toBeUndefined();
    expect(out.productId).toBeUndefined();
    // E a inglesa nunca fica com o preço do produto japonês.
    expect(run(en(), [product]).notFound).toBe(TCG_NOT_FOUND.otherLanguage);
  });

  it('mais de um produto possível: sem preço ("mais de um produto")', () => {
    const out = run(ja(), [product, jrow(null)]);
    expect(out).toMatchObject({ notFound: TCG_NOT_FOUND.ambiguous });
    expect(out.avg).toBeUndefined();
    expect(tcgplayerReason(out.notFound)).toBe('mais de um produto');
  });

  it('reverse sem o produto Mirror: o preço da carta comum, como carta base ("≈ Aproximado")', () => {
    const e = ja({ variant: 'reverse' });
    const out = run(e, [product]);
    expect(out).toMatchObject({ productId: 695039, base: true, avg: 2.75 });
    const v = valuation({ ...e, tcgplayer: out });
    expect(v.basis).toBe('tcgplayer');
    expect(v.approx).toBe('base');
  });

  it('sem produto, sem a versão, sem vendas ou sem câmbio: o motivo', () => {
    expect(run(ja(), []).notFound).toBe(TCG_NOT_FOUND.offCatalog);
    expect(run(ja(), [jrow('Mirror Holofoil')]).notFound).toBe(TCG_NOT_FOUND.noVersion);
    expect(run(ja(), [product], new Map()).notFound).toBe(TCG_NOT_FOUND.noProductPrice);
    const noSales = new Map([[695039, [{ ...prices.get(695039)![0], market: null }]]]);
    expect(run(ja(), [product], noSales)).toMatchObject({ productId: 695039, notFound: TCG_NOT_FOUND.noSales });
    // 1ª edição japonesa sem a impressão própria: não fica com o preço da comum.
    expect(run(ja({ variant: 'firstEdition' }), [product]).notFound).toBe(TCG_NOT_FOUND.noPrint);
    const e = ja();
    expect(tcgplayerPricesFrom([e], new Map([[e.id, [product]]]), prices, undefined, LATER).get(e.id)?.notFound).toBe(TCG_NOT_FOUND.noFx);
  });

  it('carta em inglês reverse com o produto só na impressão "Normal" (a 212-0): sem preço, nunca o da comum como exato', () => {
    const e = en({ id: '212-0', cardId: 'basep-33', variant: 'reverse' });
    const wotc = row(null, 'WoTC Promo', { product_id: 88960, tcgdex_id: 'basep-33' });
    const out = run(e, [wotc], new Map([[88960, [{ ...price('Normal'), product_id: 88960 }]]]));
    expect(out).toMatchObject({ productId: 88960, notFound: TCG_NOT_FOUND.noPrint });
    expect(out.avg).toBeUndefined();
    expect(valuation({ ...e, tcgplayer: out }).basis).toBeUndefined();
    // A versão normal da mesma carta tem o preço.
    expect(run({ ...e, variant: 'normal' }, [wotc], new Map([[88960, [{ ...price('Normal'), product_id: 88960 }]]]))).toMatchObject({ avg: 5.5 });
  });

  // Casos reais (PTAX 5,5013), pelo caminho inteiro: produto, impressão e reais.
  const ptax = { day: '2026-11-06', sell: 5.5013 };
  const round = (n: number) => Math.round(n * 100) / 100;
  const usd = (product_id: number, sub_type: string, market: number | null): PriceRow => ({ product_id, sub_type, low: null, mid: null, market, built_at: AT });
  const real = (e: Entry, rows: CatalogRow[], p: PriceRow[]) =>
    tcgplayerPricesFrom([e], new Map([[e.id, rows]]), new Map(p.map((r) => [r.product_id, p.filter((x) => x.product_id === r.product_id)])), ptax, LATER).get(e.id)!;

  it('carta gigante salva com o selo do produto Jumbo: o preço dele; sem preço próprio, sem preço (nunca o da comum)', () => {
    const pikachu = en({ cardId: 'basep-1', variant: 'wPromo', variantNote: 'Jumbo Cards' });
    const wotc = row(null, 'WoTC Promo', { product_id: 88001, tcgdex_id: 'basep-1' });
    const jumbo = row('Jumbo Cards', 'WoTC Promo', { product_id: 211500, tcgdex_id: 'basep-1' });
    const out = real(pikachu, [wotc, jumbo], [usd(88001, 'Holofoil', 10.95), usd(211500, 'Holofoil', 34.49)]);
    expect(out).toMatchObject({ productId: 211500, avg: 189.74 });
    expect(out.base).toBeUndefined();
    // Charizard base1-4 "Jumbo Cards · CoroCoro Promo" (179079, sem preço): nunca os R$ 5.430,50 da Base Set.
    const charizard = en({ cardId: 'base1-4', variant: 'wPromo', variantNote: 'Jumbo Cards · CoroCoro Promo' });
    const baseSet = row(null, 'Base Set', { product_id: 42382, tcgdex_id: 'base1-4' });
    const coro = row('Jumbo Cards · CoroCoro Promo', 'Base Set', { product_id: 179079, tcgdex_id: 'base1-4' });
    const none = real(charizard, [baseSet, coro], [usd(42382, 'Unlimited Holofoil', 987.13)]);
    expect(none).toMatchObject({ productId: 179079, notFound: TCG_NOT_FOUND.noProductPrice });
    expect(none.avg).toBeUndefined();
    expect(valuation({ ...charizard, tcgplayer: none }).basis).toBeUndefined();
    // Selo Jumbo sem o produto entre as linhas: também sem preço.
    expect(real(charizard, [baseSet], [usd(42382, 'Unlimited Holofoil', 987.13)]).avg).toBeUndefined();
  });

  it('Prize Pack com Normal e Holofoil, sem saber a impressão: sem preço (na dúvida)', () => {
    const e = en({ cardId: 'swsh9-115', variant: 'wPromo', variantNote: 'Prize Pack Series Cards' });
    const prize = row('Prize Pack Series Cards', 'Prize Pack Series', { product_id: 476051, tcgdex_id: 'swsh9-115' });
    const out = real(e, [row(null, 'Brilliant Stars', { tcgdex_id: 'swsh9-115' }), prize], [usd(476051, 'Holofoil', 11.62), usd(476051, 'Normal', 4.55)]);
    expect(out).toMatchObject({ productId: 476051, notFound: TCG_NOT_FOUND.noPrint });
    expect(out.avg).toBeUndefined();
  });

  it('produto só com 1st Edition e Unlimited (Pikachu "Red Cheeks"): a Unlimited, nunca sem preço', () => {
    const e = en({ cardId: 'base1-58', variant: 'wPromo', variantNote: 'Red Cheeks' });
    const red = row('Red Cheeks', 'Base Set', { product_id: 147229, tcgdex_id: 'base1-58' });
    const out = real(e, [row(null, 'Base Set', { tcgdex_id: 'base1-58' }), red], [usd(147229, '1st Edition', 429.98), usd(147229, 'Unlimited', 106.9)]);
    expect(out).toMatchObject({ productId: 147229, subType: 'Unlimited', avg: round(106.9 * 5.5013) });
  });

  it('"Outra" versão em inglês: o preço da carta comum como carta base ("≈ Aproximado"), nunca como exato', () => {
    const e = en({ cardId: 'base1-4', variant: 'other', variantNote: 'erro de impressão' });
    const out = real(e, [row(null, 'Base Set', { product_id: 42382, tcgdex_id: 'base1-4' })], [usd(42382, 'Holofoil', 987.13)]);
    expect(out).toMatchObject({ productId: 42382, base: true });
    expect(valuation({ ...e, tcgplayer: out }).approx).toBe('base');
  });

  it('carta em inglês com dois produtos comuns possíveis: sem preço ("mais de um produto")', () => {
    const e = en({ cardId: 'basep-1' });
    const out = run(e, [row(null, 'WoTC Promo', { product_id: 121772 }), row(null, 'Pikachu World Collection Promos', { product_id: 161750 })]);
    expect(out).toMatchObject({ notFound: TCG_NOT_FOUND.ambiguous });
    expect(out.productId).toBeUndefined();
  });
});

describe('"Meu valor" da carta japonesa na junção das cópias', () => {
  it('o mercado da TCGplayer mais novo e acima dele apaga o "Meu valor"; o MYP não', () => {
    const e = ja({ myValue: { value: 2, setAt: AT }, updatedAt: AT });
    const remote = { ...e, tcgplayer: tcg(e, { avg: 2.75, checkedAt: LATER }) };
    expect(mergeEntry(e, remote)).toMatchObject({ myValue: null, myValueReplaced: { value: 2, mypValue: 2.75, source: 'tcgplayer' } });
    const withMyp = { ...e, mypApi: { cardId: e.cardId, variant: e.variant, checkedAt: LATER, avg: 99 } };
    expect(mergeEntry(e, withMyp).myValue).toEqual({ value: 2, setAt: AT });
  });
});

describe('"Meu valor" ao gravar um preço novo sem conta (applyTcgplayerPrice / applyMypPrice)', () => {
  const mine = { myValue: { value: 2, setAt: AT } };

  it('TCGplayer: apaga o "Meu valor" da japonesa e da inglesa quando o mercado passa dele; da portuguesa, não', () => {
    const jp = ja(mine);
    expect(tcgplayerMyValuePatch(jp, tcg(jp, { avg: 2.75, checkedAt: LATER }))).toEqual({
      myValue: null,
      myValueReplaced: { value: 2, mypValue: 2.75, at: LATER, source: 'tcgplayer' },
    });
    const english = en(mine);
    expect(tcgplayerMyValuePatch(english, tcg(english, { avg: 3, checkedAt: LATER }))).toMatchObject({ myValue: null });
    const pt = entry(mine);
    expect(tcgplayerMyValuePatch(pt, tcg(pt, { avg: 3, checkedAt: LATER }))).toEqual({});
    // Preço de outra versão, ou abaixo do "Meu valor": nada muda.
    expect(tcgplayerMyValuePatch(jp, tcg(jp, { variant: 'reverse', avg: 3, checkedAt: LATER }))).toEqual({});
    expect(tcgplayerMyValuePatch(jp, tcg(jp, { avg: 1.5, checkedAt: LATER }))).toEqual({});
  });

  it('MYP: só na carta em português; na japonesa e na inglesa é só referência', () => {
    const price = (e: Entry) => ({ cardId: e.cardId, variant: e.variant, checkedAt: LATER, avg: 99 });
    const pt = entry(mine);
    expect(mypMyValuePatch(pt, price(pt))).toMatchObject({ myValue: null, myValueReplaced: { source: 'myp', mypValue: 99 } });
    const jp = ja(mine);
    expect(mypMyValuePatch(jp, price(jp))).toEqual({});
    const english = en(mine);
    expect(mypMyValuePatch(english, price(english))).toEqual({});
  });
});

describe('hasTcgplayerCards (o refresher só consulta o banco com carta em inglês ou japonês)', () => {
  it('uma coleção só de japonesas busca preço; só de portuguesas, não', () => {
    expect(hasTcgplayerCards([ja(), ja({ id: '807-0' })])).toBe(true);
    expect(hasTcgplayerCards([entry(), en()])).toBe(true);
    expect(hasTcgplayerCards([entry(), entry({ id: '2-0' })])).toBe(false);
    expect(hasTcgplayerCards([])).toBe(false);
  });
});
