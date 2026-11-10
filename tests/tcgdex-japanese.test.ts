// Lista e busca de cartas japonesas: TCGplayer japonesa (catálogo 85) como base e a TCGdex japonesa só de reserva, com
// o catálogo, a ligação TCGdex → 85 (japaneseProducts) e a TCGdex simulados. Nenhum teste acessa a rede.
import { isCopyOf, pickParams, savedAliasIds } from '@/lib/add-card';
import type { CatalogRow } from '@/lib/catalog';
import type { JaCardRef } from '@/lib/ja-catalog';
import {
  canSearchName,
  cardsForDexResult,
  dateOrder,
  isJapaneseText,
  japaneseSeries,
  searchCardsResult,
  seriesOf,
  sortCards,
  type CardBrief,
} from '@/lib/tcgdex';

import { entry } from './fixtures';

// Só os ids das cartas vêm do store (para o pickParams).
jest.mock('@/store/collection', () => ({
  entryId: (dex: number, slot: number) => `${dex}-${slot}`,
  customEntryId: (binderId: string, slot: number) => `${binderId}:${slot}`,
}));

const mockCatalog = { byCategory: new Map<number, CatalogRow[]>(), calls: [] as { name: string; category: number }[] };
const mockJa = { products: new Map<string, CatalogRow>(), refs: [] as JaCardRef[] };

jest.mock('@/lib/catalog', () => ({
  ...jest.requireActual('@/lib/catalog'),
  catalogByName: jest.fn(async (name: string, category = 3) => {
    mockCatalog.calls.push({ name, category });
    return mockCatalog.byCategory.get(category) ?? [];
  }),
  catalogByTcgdexIds: jest.fn(async () => []),
  catalogGroupSet: jest.fn(async () => []),
}));

jest.mock('@/lib/ja-catalog', () => ({
  ...jest.requireActual('@/lib/ja-catalog'),
  japaneseProducts: jest.fn(async (refs: JaCardRef[]) => {
    mockJa.refs.push(...refs);
    return new Map([...mockJa.products].filter(([id]) => refs.some((r) => r.cardId === id)));
  }),
}));

type Card = { id: string; localId: string; name: string; image?: string };
/** Respostas da TCGdex japonesa: cartas por Pokémon ("dex|781"), por nome ("name|ダダリン") e por busca ("like|…"). */
const tcgdex = new Map<string, Card[]>();
const JA_SETS = [
  { id: 'PMCG2', name: 'ポケモンジャングル', cardCount: { total: 48, official: 48 } },
  { id: 'SM4A', name: '超次元の暴獣', cardCount: { total: 50, official: 50 } },
  { id: 'M5', name: 'アビスアイ', cardCount: { total: 118, official: 81 } },
  // Para o "sem repetir" sem a ligação exata (ver probablePairs): sigla com "+" na 85, promo e grupo sem sigla.
  { id: 'SM4p', name: 'GXバトルブースト', cardCount: { total: 125, official: 114 } },
  { id: 'SV-P', name: 'スカーレット&バイオレット プロモカード', cardCount: { total: 288, official: 0 } },
  { id: 'MC', name: 'スタートデッキ100 バトルコレクション', cardCount: { total: 774, official: 742 } },
  { id: 'E4', name: '裂けた大地', cardCount: { total: 91, official: 88 } },
];

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = decodeURIComponent(String(input));
    const m = url.match(/\/v2\/(en|pt|ja)\/(.+)$/);
    if (!m) return json(null, 404);
    const [, lang, path] = m;
    if (path === 'series/tcgp') return json({ sets: [] });
    if (lang !== 'ja') return json(null, 404);
    if (path === 'sets') return json(JA_SETS);
    let k = path.match(/^cards\?dexId=eq:(\d+)$/);
    if (k) return json(tcgdex.get(`dex|${k[1]}`) ?? []);
    k = path.match(/^cards\?name=like:(.+)$/);
    if (k) return json(tcgdex.get(`like|${k[1]}`) ?? []);
    k = path.match(/^cards\?name=(.+)$/);
    if (k) return json(tcgdex.get(`name|${k[1]}`) ?? []);
    return json(null, 404);
  }) as unknown as typeof fetch;
});

beforeEach(() => {
  tcgdex.clear();
  mockCatalog.byCategory.clear();
  mockCatalog.calls = [];
  mockJa.products.clear();
  mockJa.refs = [];
});

const GROUPS: Record<number, { name: string; abbr: string | null; published_on: string | null }> = {
  24711: { name: 'M5: Abyss Eye', abbr: 'M5', published_on: '2026-01-23' },
  604: { name: 'Pokemon Jungle', abbr: null, published_on: '1997-03-05' },
  3150: { name: 'Vending Machine 1', abbr: null, published_on: null },
  23707: { name: 'SM4+: GX Battle Boost', abbr: 'SM4+', published_on: '2017-10-20' },
  23779: { name: 'SV-P Promotional Cards', abbr: 'SV-P', published_on: '2024-10-18' },
  24567: { name: 'Start Deck 100 Battle Collection', abbr: '', published_on: '2025-12-19' },
  23733: { name: 'Split Earth', abbr: '', published_on: '2002-08-23' },
};

function row(product_id: number, group_id: number, name: string, number: string | null, stamp: string | null = null, category = 85): CatalogRow {
  return {
    product_id,
    category,
    group_id,
    name,
    full_name: name,
    number,
    rarity: null,
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${product_id}_in_1000x1000.jpg`,
    stamp,
    tcgdex_id: null,
    tcg_groups: GROUPS[group_id] ?? { name: `Grupo ${group_id}`, abbr: null, published_on: null },
  };
}

describe('épocas e ordem das japonesas', () => {
  it.each([
    ['1996-10-20', 'Pocket Monsters (1996–2001)'],
    ['2001-03-31', 'Pocket Monsters (1996–2001)'],
    ['2001-10-20', 'Pocket Monsters (1996–2001)'],
    ['2001-12-01', 'e-Card, ADV e PCG (2001–2006)'],
    ['2006-07-15', 'e-Card, ADV e PCG (2001–2006)'],
    ['2006-10-27', 'Diamante e Pérola (2006–2010)'],
    ['2010-07-08', 'Diamante e Pérola (2006–2010)'],
    ['2010-09-18', 'Preto e Branco (2010–2013)'],
    ['2013-07-13', 'Preto e Branco (2010–2013)'],
    ['2013-12-13', 'XY (2013–2016)'],
    ['2016-11-18', 'Sol e Lua (2016–2019)'],
    ['2019-11-29', 'Espada e Escudo (2019–2022)'],
    ['2022-12-02', 'Espada e Escudo (2019–2022)'],
    ['2023-01-20', 'Escarlate e Violeta (2023–2025)'],
    ['2025-06-06', 'Escarlate e Violeta (2023–2025)'],
    ['2025-08-01', 'Megaevolução (2025–)'],
    [null, 'Sem data'],
    ['', 'Sem data'],
  ])('japaneseSeries(%j) → %s', (date, series) => {
    expect(japaneseSeries(date)).toBe(series);
  });

  it('dateOrder: pela data; sem data, -1 (no fim, nas mais novas primeiro)', () => {
    expect(dateOrder('2026-01-23')).toBe(20260123);
    expect(dateOrder('1996-10-20')).toBeLessThan(dateOrder('1997-03-05'));
    expect(dateOrder(null)).toBe(-1);
  });

  it('sem data fica no fim nas duas ordens (mais novas e mais antigas)', () => {
    const card = (id: string, setOrder: number) => ({ id, localId: '1', name: 'Pikachu', lang: 'ja' as const, setId: id, setName: id, setNameEn: id, setOrder });
    const list = [card('sem-data', -1), card('1996', 19961020), card('2026', 20260123)];
    expect(sortCards(list, 'newest').map((c) => c.id)).toEqual(['2026', '1996', 'sem-data']);
    expect(sortCards(list, 'oldest').map((c) => c.id)).toEqual(['1996', '2026', 'sem-data']);
  });

  it('isJapaneseText: kana ou kanji', () => {
    expect(isJapaneseText('ピカチュウ')).toBe(true);
    expect(isJapaneseText('ピカチュウex')).toBe(true);
    expect(isJapaneseText('超次元')).toBe(true);
    expect(isJapaneseText('Pikachu')).toBe(false);
    expect(isJapaneseText('M5 088')).toBe(false);
  });
});

describe('lista de um Pokémon em japonês (cardsForDexResult)', () => {
  it('produtos da 85 com foto, coleção, ano e época; Mirror à parte como reverse; a TCGdex só como reserva', async () => {
    mockCatalog.byCategory.set(85, [
      row(695039, 24711, 'Dhelmise', '088/081'),
      row(695040, 24711, 'Dhelmise', '088/081', 'Mirror Holofoil'),
      // Carta antiga (Pocket Monsters), sem número impresso.
      row(500001, 604, 'Dhelmise', null),
    ]);
    // A 3 nunca é lida para a lista japonesa.
    mockCatalog.byCategory.set(3, [row(1, 1, 'Dhelmise', '001/100', null, 3)]);
    tcgdex.set('dex|781', [
      { id: 'M5-088', localId: '088', name: 'ダダリン' },
      { id: 'SM4A-010', localId: '010', name: 'ダダリン' },
    ]);
    // A TCGdex M5-088 é o produto 695039 (sigla M5 + 088/081 + Dhelmise).
    mockJa.products.set('M5-088', row(695039, 24711, 'Dhelmise', '088/081'));

    const res = await cardsForDexResult(781, 'ja', { force: true });
    expect(mockCatalog.calls).toEqual([{ name: 'Dhelmise', category: 85 }]);
    expect(mockJa.refs).toEqual(
      expect.arrayContaining([
        { cardId: 'M5-088', setId: 'M5', localId: '088', setTotal: 81, dex: 781 },
        { cardId: 'SM4A-010', setId: 'SM4A', localId: '010', setTotal: 50, dex: 781 },
      ]),
    );
    const ids = res.cards.map((c) => `${c.id}${c.stamp ? ` · ${c.stamp.label}` : ''}`);
    // Mais nova primeiro; a TCGdex que casa com a 85 não se repete.
    expect(ids).toEqual(['tcgp-695039', 'tcgp-695040 · Mirror Holofoil', 'SM4A-010', 'tcgp-500001']);

    const [dhelmise, mirror, reserve, old] = res.cards;
    expect(dhelmise).toMatchObject({
      lang: 'ja',
      dataLang: undefined,
      localId: '088',
      setId: 'tcgp24711',
      setName: 'M5: Abyss Eye',
      imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/695039_in_1000x1000.jpg',
      series: 'Megaevolução (2025–)',
      // Para o "tenho" das cartas já salvas com o id da TCGdex (M5-088).
      tcgdexId: 'M5-088',
    });
    expect(mirror).toMatchObject({ stamp: { variant: 'reverse', label: 'Mirror Holofoil', keys: [] }, image: undefined });
    expect(mirror.imageUrl).toContain('695040');
    expect(reserve).toMatchObject({ lang: 'ja', setName: '超次元の暴獣', series: 'Sol e Lua (2016–2019)' });
    expect(old).toMatchObject({ localId: '', setName: 'Pokemon Jungle', series: 'Pocket Monsters (1996–2001)' });
    expect(seriesOf(old)).toBe('Pocket Monsters (1996–2001)');
    expect(res.partial).toBe(false);
  });

  it('coleção sem data vai para o fim (e para a série "Sem data"); sem a 85, fica a reserva da TCGdex', async () => {
    mockCatalog.byCategory.set(85, [row(600001, 3150, 'Pikachu', null), row(600002, 24711, 'Pikachu', '010/081')]);
    tcgdex.set('dex|25', [{ id: 'PMCG2-024', localId: '024', name: 'ピカチュウ' }]);
    const res = await cardsForDexResult(25, 'ja', { force: true });
    expect(res.cards.map((c) => c.id)).toEqual(['tcgp-600002', 'PMCG2-024', 'tcgp-600001']);
    expect(res.cards[1].series).toBe('Pocket Monsters (1996–2001)');
    expect(res.cards[2].series).toBe('Sem data');
  });

  it('o nome do Pokémon é conferido por palavra: "Mew" não pega "Mewtwo"', async () => {
    mockCatalog.byCategory.set(85, [row(700001, 24711, 'Mew ex', '050/081'), row(700002, 24711, 'Mewtwo', '051/081')]);
    const res = await cardsForDexResult(151, 'ja', { force: true });
    expect(res.cards.map((c) => c.name)).toEqual(['Mew ex']);
  });

  it('a reserva com par provável na 85 não se repete, mesmo sem a ligação exata (sigla "+", promo, grupo sem sigla)', async () => {
    mockCatalog.byCategory.set(85, [
      row(574289, 23707, 'Dhelmise', '044/114'),
      row(669780, 24567, 'Dhelmise', '060/742'),
      row(587758, 23779, 'Dhelmise', '001/SV-P'),
      // Grupo sem sigla e com outro total: não é a E4-033 (que tem 88).
      row(576215, 23733, 'Dhelmise', '033/090'),
    ]);
    tcgdex.set('dex|781', [
      { id: 'SM4p-044', localId: '044', name: 'ダダリン' },
      { id: 'MC-060', localId: '060', name: 'ダダリン' },
      { id: 'SV-P-001', localId: '001', name: 'ダダリン' },
      { id: 'E4-033', localId: '033', name: 'ダダリン' },
      // Mesmo grupo e outro número: fica.
      { id: 'SM4p-045', localId: '045', name: 'ダダリン' },
    ]);
    // japaneseProducts não acha nenhuma (sigla diferente, promo sem total, grupo sem sigla).
    const res = await cardsForDexResult(781, 'ja', { force: true });
    // Saem SM4p-044 (SM4+ 044/114), MC-060 (sem sigla, 060/742) e SV-P-001 (001/SV-P).
    expect(res.cards.map((c) => c.id).sort()).toEqual(['E4-033', 'SM4p-045', 'tcgp-574289', 'tcgp-576215', 'tcgp-587758', 'tcgp-669780']);
    // E o produto fica ligado à carta da reserva (o mesmo tcgdexId da ligação exata), para o "tenho" das já salvas.
    const alias = Object.fromEntries(res.cards.map((c) => [c.id, c.tcgdexId]));
    expect(alias).toMatchObject({ 'tcgp-574289': 'SM4p-044', 'tcgp-669780': 'MC-060', 'tcgp-587758': 'SV-P-001' });
    expect(alias['tcgp-576215']).toBeUndefined();
  });

  it('a reserva com um só par sem selo: a SM4p-044 salva é o produto tcgp-574289 ("tenho" e o bolso abrem a salva)', async () => {
    // Dados reais (SELECT de 07/11/2026 e TCGdex): ダダリン SM4p-044 ↔ SM4+ 044/114; MC-060 ↔ 060/742 (grupo sem sigla).
    mockCatalog.byCategory.set(85, [row(574289, 23707, 'Dhelmise', '044/114'), row(669780, 24567, 'Dhelmise', '060/742')]);
    tcgdex.set('dex|781', [
      { id: 'SM4p-044', localId: '044', name: 'ダダリン' },
      { id: 'MC-060', localId: '060', name: 'ダダリン' },
    ]);
    const res = await cardsForDexResult(781, 'ja', { force: true });
    const sm4 = res.cards.find((c) => c.id === 'tcgp-574289')!;
    const mc = res.cards.find((c) => c.id === 'tcgp-669780')!;
    // A SM4p-044 salva no bolso 781-1 antes da 3.2.0, sem preço ligado (a ligação exata não acha: "fora do catálogo").
    const saved = entry({ id: '781-1', dex: 781, slot: 1, cardId: 'SM4p-044', lang: 'ja', variant: 'holo' });
    expect(savedAliasIds(sm4, new Map())).toEqual(['SM4p-044']);
    expect(isCopyOf(saved, sm4)).toBe(true);
    expect(isCopyOf(saved, mc)).toBe(false);
    // Tocar no produto no bolso dela abre a carta salva, sem "Substituir" nem chave nova.
    expect(pickParams(sm4, saved).cardId).toBe('SM4p-044');
    expect(pickParams(mc, entry({ ...saved, cardId: 'MC-060' })).cardId).toBe('MC-060');
  });

  it('par provável: liga só ao produto comum; com selo ou mais de uma carta da reserva no mesmo par, nenhum tcgdexId', async () => {
    mockCatalog.byCategory.set(85, [
      row(574289, 23707, 'Dhelmise', '044/114'),
      row(574290, 23707, 'Dhelmise', '044/114', 'Mirror Holofoil'),
      // Só a versão Mirror do 045: a reserva sai (o par está na lista), mas nada é ligado.
      row(574300, 23707, 'Dhelmise', '045/114', 'Mirror Holofoil'),
      row(669780, 24567, 'Dhelmise', '060/742'),
      row(669781, 24567, 'Dhelmise', '060/742', 'Mirror Holofoil'),
    ]);
    tcgdex.set('dex|781', [
      // Duas cartas da reserva com o mesmo par (SM4+ 044/114): na dúvida, o produto fica sem tcgdexId.
      { id: 'SM4p-044', localId: '044', name: 'ダダリン' },
      { id: 'SM4+-044', localId: '044', name: 'ダダリン' },
      { id: 'SM4p-045', localId: '045', name: 'ダダリン' },
      // Comum e Mirror com o mesmo número: liga ao comum.
      { id: 'MC-060', localId: '060', name: 'ダダリン' },
    ]);
    const res = await cardsForDexResult(781, 'ja', { force: true });
    expect(res.cards.map((c) => `${c.id}${c.tcgdexId ? ` = ${c.tcgdexId}` : ''}`).sort()).toEqual([
      'tcgp-574289',
      'tcgp-574290',
      'tcgp-574300',
      'tcgp-669780 = MC-060',
      'tcgp-669781',
    ]);
  });

  it('a lista base vai para a tela dizendo o que falta: "mais cartas" (não há versões com selo a buscar)', async () => {
    mockCatalog.byCategory.set(85, [row(695039, 24711, 'Dhelmise', '088/081')]);
    tcgdex.set('dex|781', [{ id: 'SM4A-010', localId: '010', name: 'ダダリン' }]);
    const progress: [CardBrief[], string][] = [];
    await cardsForDexResult(781, 'ja', { force: true, onProgress: (cards, pending) => progress.push([cards, pending]) });
    expect(progress).toHaveLength(1);
    expect(progress[0][0].map((c) => c.id)).toEqual(['tcgp-695039']);
    expect(progress[0][1]).toBe('mais cartas');
  });
});

describe('busca em japonês (searchCardsResult)', () => {
  it('texto latino: pelo nome em inglês no catálogo 85 (como no inglês), sem a TCGdex', async () => {
    mockCatalog.byCategory.set(85, [row(695049, 24711, 'Mega Zeraora ex', '026/081'), row(695051, 24711, 'Mega Zeraora ex', '112/081')]);
    const res = await searchCardsResult('Zeraora', 'ja', { force: true });
    expect(mockCatalog.calls).toEqual([{ name: 'Zeraora', category: 85 }]);
    expect(res.cards.map((c) => c.id)).toEqual(['tcgp-695049', 'tcgp-695051']);
    expect(res.cards[0]).toMatchObject({ lang: 'ja', dataLang: undefined, setName: 'M5: Abyss Eye' });
    // Com o número no fim, filtra pelo número da carta.
    const one = await searchCardsResult('Zeraora 112', 'ja', { force: true });
    expect(one.cards.map((c) => c.id)).toEqual(['tcgp-695051']);
  });

  it('texto em japonês: TCGdex japonesa; a que casa com a 85 vira o produto (com o Pokémon pelo nome japonês)', async () => {
    tcgdex.set('like|ゼラオラ', [
      { id: 'M5-026', localId: '026', name: 'メガゼラオラex' },
      { id: 'SM7-020', localId: '020', name: 'ゼラオラ' },
    ]);
    mockJa.products.set('M5-026', row(695049, 24711, 'Mega Zeraora ex', '026/081'));
    const res = await searchCardsResult('ゼラオラ', 'ja', { force: true });
    // O catálogo pelo nome só é lido para os pares prováveis da reserva sem ligação exata (a SM7-020, de Zeraora).
    expect(mockCatalog.calls).toEqual([{ name: 'Zeraora', category: 85 }]);
    expect(mockJa.refs.find((r) => r.cardId === 'M5-026')).toMatchObject({ setId: 'M5', localId: '026', setTotal: 81, dex: 807 });
    expect(res.cards.map((c) => c.id)).toEqual(['tcgp-695049', 'SM7-020']);
    expect(res.cards[0]).toMatchObject({ tcgdexId: 'M5-026', imageUrl: expect.stringContaining('695049') });
  });

  it('texto em japonês: a reserva com um só par sem selo vira o produto (ダダリン SM4p-044 → 574289, MC-060 → 669780)', async () => {
    tcgdex.set('like|ダダリン', [
      { id: 'M5-088', localId: '088', name: 'ダダリン' },
      { id: 'SM4p-044', localId: '044', name: 'ダダリン' },
      { id: 'MC-060', localId: '060', name: 'ダダリン' },
      // Só a versão Mirror na 85: fica a reserva (a busca não mostra os outros produtos do Pokémon).
      { id: 'SM4p-045', localId: '045', name: 'ダダリン' },
      // Sem par (o grupo sem sigla tem outro total): fica a reserva.
      { id: 'E4-033', localId: '033', name: 'ダダリン' },
    ]);
    mockJa.products.set('M5-088', row(695039, 24711, 'Dhelmise', '088/081'));
    mockCatalog.byCategory.set(85, [
      row(695039, 24711, 'Dhelmise', '088/081'),
      row(574289, 23707, 'Dhelmise', '044/114'),
      row(574300, 23707, 'Dhelmise', '045/114', 'Mirror Holofoil'),
      row(669780, 24567, 'Dhelmise', '060/742'),
      row(576215, 23733, 'Dhelmise', '033/090'),
      // Outro produto do Pokémon, sem carta na busca: não entra.
      row(566162, 24711, 'Dhelmise', '011/081'),
    ]);
    const res = await searchCardsResult('ダダリン', 'ja', { force: true });
    expect(mockCatalog.calls).toEqual([{ name: 'Dhelmise', category: 85 }]);
    expect(res.cards.map((c) => `${c.id}${c.tcgdexId ? ` = ${c.tcgdexId}` : ''}`)).toEqual([
      'tcgp-695039 = M5-088',
      'tcgp-669780 = MC-060',
      'tcgp-574289 = SM4p-044',
      'SM4p-045',
      'E4-033',
    ]);
    const sm4 = res.cards.find((c) => c.id === 'tcgp-574289')!;
    expect(sm4).toMatchObject({ lang: 'ja', localId: '044', setName: 'SM4+: GX Battle Boost', imageUrl: expect.stringContaining('574289') });
    // A SM4p-044 já salva: "tenho" e o bolso dela abrem a salva.
    const saved = entry({ id: '781-0', dex: 781, cardId: 'SM4p-044', lang: 'ja', variant: 'holo' });
    expect(isCopyOf(saved, sm4)).toBe(true);
    expect(pickParams(sm4, saved).cardId).toBe('SM4p-044');
  });

  it('texto latino curto (2 letras) não lê o catálogo inteiro', async () => {
    mockCatalog.byCategory.set(85, [row(1, 24711, 'Mr. Mime', '001/081')]);
    const res = await searchCardsResult('Mr', 'ja', { force: true });
    expect(res.cards).toEqual([]);
    expect(mockCatalog.calls).toEqual([]);
  });

  it('canSearchName: a tela só busca o que a busca atende (3 letras latinas no japonês; 2 no resto)', () => {
    expect(canSearchName('Mr', 'ja')).toBe(false);
    expect(canSearchName('M r', 'ja')).toBe(false);
    expect(canSearchName('Mew', 'ja')).toBe(true);
    expect(canSearchName('ミュ', 'ja')).toBe(true);
    expect(canSearchName('ミ', 'ja')).toBe(false);
    expect(canSearchName('Mr', 'en')).toBe(true);
    expect(canSearchName('M', 'pt')).toBe(false);
  });
});
