import type { CatalogRow } from '@/lib/catalog';
import {
  clearJapaneseCatalogCache,
  groupsForSet,
  japaneseCandidatesFrom,
  japaneseNumber,
  japaneseProducts,
  nameHasSpecies,
  pickJapaneseProduct,
  type JaCardRef,
  type JaGroup,
} from '@/lib/ja-catalog';
import { supabase } from '@/lib/supabase';

import { japaneseCatalogTables, queriesOf, type FakeDb } from './ja-catalog-fake-db';

// O catálogo vem de um banco de mentira na memória (nenhuma rede).
jest.mock('@/lib/supabase', () => jest.requireActual('./ja-catalog-fake-db').fakeSupabaseModule());

const db = supabase as unknown as FakeDb;
const tables = japaneseCatalogTables();
const groups = tables.tcg_groups.filter((g) => g.category === 85) as unknown as JaGroup[];
const rows = tables.tcg_catalog as unknown as CatalogRow[];
const byId = (id: number) => rows.find((r) => r.product_id === id)!;

/** As duas japonesas salvas na coleção (TCGdex japonesa, sem foto nem preço). */
const dhelmise: JaCardRef = { cardId: 'M5-088', setId: 'M5', localId: '088', setTotal: 81, dex: 781, variant: 'holo' };
const zeraora: JaCardRef = { cardId: 'M5-026', setId: 'M5', localId: '026', setTotal: 81, dex: 807, variant: 'holo' };
const mew: JaCardRef = { cardId: 'SI-171', setId: 'SI', localId: '171', setTotal: 414, dex: 151 };
const flareon: JaCardRef = { cardId: 'SMH-001', setId: 'SMH', localId: '1', setTotal: 38, dex: 136 };

beforeEach(() => {
  db.reset(japaneseCatalogTables());
  clearJapaneseCatalogCache();
});

describe('japaneseNumber (número impresso na carta japonesa)', () => {
  it('3 dígitos / total com 3 dígitos', () => {
    expect(japaneseNumber('088', 81)).toBe('088/081');
    expect(japaneseNumber('88', 81)).toBe('088/081');
    expect(japaneseNumber(' 1 ', 38)).toBe('001/038');
    expect(japaneseNumber('171', 414)).toBe('171/414');
    expect(japaneseNumber('1', 1000)).toBe('001/1000');
  });

  it('sem número, número com letras ou sem total: nada', () => {
    expect(japaneseNumber(undefined, 81)).toBeUndefined();
    expect(japaneseNumber('SV001', 81)).toBeUndefined();
    expect(japaneseNumber('088', undefined)).toBeUndefined();
    expect(japaneseNumber('088', 0)).toBeUndefined();
  });
});

describe('groupsForSet e nameHasSpecies', () => {
  it('sigla sem diferenciar maiúsculas, com sigla repetida', () => {
    expect(groupsForSet(groups, 'm5').map((g) => g.group_id)).toEqual([24711, 99001]);
    expect(groupsForSet(groups, 'SI').map((g) => g.group_id)).toEqual([23859, 24019]);
    expect(groupsForSet(groups, '')).toEqual([]);
    expect(groupsForSet(groups, undefined)).toEqual([]);
  });

  it('nome do Pokémon em palavras inteiras', () => {
    expect(nameHasSpecies('Mega Zeraora ex', 'Zeraora')).toBe(true);
    expect(nameHasSpecies('Dhelmise', 'Dhelmise')).toBe(true);
    expect(nameHasSpecies('Mewtwo', 'Mew')).toBe(false);
    expect(nameHasSpecies('Kadabra', 'Abra')).toBe(false);
    expect(nameHasSpecies('Galarian Mr. Mime', 'Mr. Mime')).toBe(true);
    expect(nameHasSpecies('Mime Jr.', 'Mr. Mime')).toBe(false);
    expect(nameHasSpecies("Farfetch'd", 'Farfetch’d')).toBe(true);
    expect(nameHasSpecies('Flabebe', 'Flabébé')).toBe(true);
  });

  it('palavras juntas no catálogo ("NidoranF") também; sem o sexo, não', () => {
    expect(nameHasSpecies('NidoranF', 'Nidoran♀')).toBe(true);
    expect(nameHasSpecies("Team Rocket's Nidoran F", 'Nidoran♀')).toBe(true);
    expect(nameHasSpecies('Nidoran M', 'Nidoran♀')).toBe(false);
    expect(nameHasSpecies('Nidoran', 'Nidoran♀')).toBe(false);
  });
});

describe('japaneseCandidatesFrom e pickJapaneseProduct (funções puras)', () => {
  it('coleção, número com o total e Pokémon: só os produtos da carta', () => {
    expect(japaneseCandidatesFrom(dhelmise, groups, rows).map((r) => r.product_id)).toEqual([695039]);
    expect(japaneseCandidatesFrom(zeraora, groups, rows).map((r) => r.product_id)).toEqual([695049]);
    expect(japaneseCandidatesFrom(mew, groups, rows).map((r) => r.product_id)).toEqual([714000, 714045]);
  });

  it('nome do Pokémon diferente, carta "tcgp-", sem total ou coleção desconhecida: nenhum', () => {
    expect(japaneseCandidatesFrom({ ...dhelmise, dex: 25 }, groups, rows)).toEqual([]);
    expect(japaneseCandidatesFrom({ ...dhelmise, cardId: 'tcgp-695039' }, groups, rows)).toEqual([]);
    expect(japaneseCandidatesFrom({ ...dhelmise, setTotal: undefined }, groups, rows)).toEqual([]);
    expect(japaneseCandidatesFrom({ ...dhelmise, setId: 'M4' }, groups, rows)).toEqual([]);
    // Carta sem Pokémon (dex 0): só pelo número.
    expect(japaneseCandidatesFrom({ ...dhelmise, dex: 0 }, groups, rows).map((r) => r.product_id)).toEqual([695039]);
  });

  it('a versão escolhe o produto; zero ou mais de um, nenhum', () => {
    const mewRows = [byId(714000), byId(714045)];
    expect(pickJapaneseProduct({}, mewRows)?.product_id).toBe(714000);
    expect(pickJapaneseProduct({ variant: 'holo' }, mewRows)?.product_id).toBe(714000);
    expect(pickJapaneseProduct({ variant: 'reverse' }, mewRows)?.product_id).toBe(714045);
    expect(pickJapaneseProduct({ variant: 'reverse', variantNote: 'Mirror Holo' }, mewRows)?.product_id).toBe(714045);
    expect(pickJapaneseProduct({ variant: 'pokeball' }, mewRows)).toBeUndefined();
    // Reverse sem o produto Mirror: fica de fora (o preço usa a carta base à parte, em lib/tcgplayer.ts).
    expect(pickJapaneseProduct({ variant: 'reverse' }, [byId(695039)])).toBeUndefined();
    expect(pickJapaneseProduct({ variant: 'normal' }, [byId(800001), byId(800002)])).toBeUndefined();
    expect(pickJapaneseProduct({}, [])).toBeUndefined();
  });
});

describe('japaneseProducts (em lote, pelo banco)', () => {
  it('as duas japonesas salvas: 695039 e 695049', async () => {
    const map = await japaneseProducts([dhelmise, zeraora]);
    expect(map.get('M5-088')?.product_id).toBe(695039);
    expect(map.get('M5-026')?.product_id).toBe(695049);
    expect(map.get('M5-088')?.image).toBe('https://tcgplayer-cdn.tcgplayer.com/product/695039_in_1000x1000.jpg');
  });

  it('ambíguo, sem Mirror para o reverse, Pokémon errado ou "tcgp-": fica fora do mapa', async () => {
    const map = await japaneseProducts([
      flareon,
      { ...dhelmise, cardId: 'M5-088', variant: 'reverse' },
      { cardId: 'M5-037', setId: 'M5', localId: '037', setTotal: 81, dex: 25 },
      { cardId: 'tcgp-695039' },
      { ...mew, variant: 'reverse' },
    ]);
    expect([...map.keys()]).toEqual(['SI-171']);
    expect(map.get('SI-171')?.product_id).toBe(714045);
  });

  it('nunca o produto de outra categoria, mesmo com a mesma sigla e número', async () => {
    const map = await japaneseProducts([dhelmise]);
    expect(map.get('M5-088')?.category).toBe(85);
    const groupReads = queriesOf(db, 'tcg_groups');
    expect(groupReads).toHaveLength(1);
    expect(groupReads[0].filters).toEqual([['eq', 'category', 85]]);
    for (const q of queriesOf(db, 'tcg_catalog')) expect(q.filters).toContainEqual(['eq', 'category', 85]);
  });

  it('lê em lote: os grupos uma vez (guardados) e uma consulta de produtos por grupo', async () => {
    const lot: JaCardRef[] = [
      dhelmise,
      zeraora,
      { cardId: 'M5-037', setId: 'M5', localId: '037', setTotal: 81, dex: 781 },
      { cardId: 'M5-096', setId: 'M5', localId: '096', setTotal: 81, dex: 807 },
      mew,
      flareon,
    ];
    await japaneseProducts(lot);
    expect(queriesOf(db, 'tcg_groups')).toHaveLength(1);
    // M5 tem dois grupos com a sigla (24711 e 99001), SI dois (23859 e 24019) e SMH um: 5 consultas para 6 cartas.
    const reads = queriesOf(db, 'tcg_catalog');
    expect(reads).toHaveLength(5);
    const m5 = reads.find((q) => q.filters.some(([op, col, v]) => op === 'eq' && col === 'group_id' && v === 24711))!;
    expect(m5.filters).toContainEqual(['in', 'number', ['088/081', '026/081', '037/081', '096/081']]);
    // Os grupos ficam na memória: a segunda leitura não os pede de novo.
    await japaneseProducts([dhelmise]);
    expect(queriesOf(db, 'tcg_groups')).toHaveLength(1);
  });

  it('nada para ler: nenhuma consulta', async () => {
    expect((await japaneseProducts([{ cardId: 'tcgp-1' }, { cardId: 'X-1', setId: 'X' }])).size).toBe(0);
    expect(db.queries).toEqual([]);
  });
});
