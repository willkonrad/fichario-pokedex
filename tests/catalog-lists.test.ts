// Listas de cartas (busca e Pokémon) com o catálogo do TCGCSV, a TCGdex e o Zukan simulados: carta que só existe com
// selo, ordem das coleções só do catálogo, Nidoran e reserva japonesa, carta antiga sem número, anos das coleções.
// Nenhum teste acessa a rede.
import { plainName, type CatalogRow } from '@/lib/catalog';
import { cardsForDexResult, searchCardsResult, setFacts, setNameIn, setReleaseYears, type CardBrief, type CardDetail } from '@/lib/tcgdex';
import { versionOptions, withCatalogVersions } from '@/lib/variants';

const mockDb = { rows: [] as CatalogRow[], names: [] as string[], dates: {} as Record<string, string> };

// O catálogo filtra pelo nome sem acento como o banco (name_plain ilike %busca%).
jest.mock('@/lib/catalog', () => {
  const actual = jest.requireActual('@/lib/catalog');
  return {
    ...actual,
    catalogByName: jest.fn(async (name: string, category = 3) => {
      mockDb.names.push(name);
      const q = actual.plainName(name);
      return mockDb.rows.filter((r) => r.category === category && actual.plainName(r.name).includes(q));
    }),
    catalogByTcgdexIds: jest.fn(async (ids: string[], category = 3) =>
      mockDb.rows.filter((r) => r.category === category && !!r.tcgdex_id && ids.includes(r.tcgdex_id)),
    ),
    catalogGroupSet: jest.fn(async () => []),
    catalogGroupDates: jest.fn(async () => mockDb.dates),
  };
});

// A ligação exata TCGdex japonesa → 85 não acha nada aqui (o resto do módulo é o de verdade).
jest.mock('@/lib/ja-catalog', () => ({ ...jest.requireActual('@/lib/ja-catalog'), japaneseProducts: jest.fn(async () => new Map()) }));

type Card = { id: string; localId: string; name: string };
/** Respostas da TCGdex pelo caminho ("en/cards?name=like:Mew VMAX", "ja/cards/PMCG1-021"…). */
const tcgdex = new Map<string, unknown>();
const SETS: Record<string, { id: string; name: string; cardCount?: { total?: number; official?: number } }[]> = {
  en: [
    { id: 'ex6', name: 'FireRed & LeafGreen' },
    { id: 'ex7', name: 'Team Rocket Returns' },
    { id: 'me02', name: 'Phantasmal Flames' },
    { id: '30th-c', name: '30th Classic Collection' },
    { id: '30th', name: '30th Celebration' },
    { id: 'sv01', name: 'Scarlet & Violet' },
  ],
  pt: [
    { id: '30th-c', name: 'Coleção Clássica' },
    { id: 'sv01', name: 'Escarlate e Violeta' },
  ],
  ja: [
    { id: 'PMCG1', name: '拡張パック', cardCount: { total: 102, official: 102 } },
    { id: 'neo2', name: '遺跡をこえて...', cardCount: { total: 57, official: 56 } },
    { id: 'SV2a', name: 'ポケモンカード151', cardCount: { total: 210, official: 165 } },
  ],
};

/** Séries da TCGdex (/v2/<idioma>/series): a lista em português não tem neo, gym, ecard… */
const SERIES: Record<string, { id: string; name: string }[]> = {
  pt: [
    { id: 'base', name: 'Coleção Básica' },
    { id: 'sv', name: 'Escarlate e Violeta' },
  ],
  en: [
    { id: 'base', name: 'Base' },
    { id: 'neo', name: 'Neo' },
    { id: 'sv', name: 'Scarlet & Violet' },
  ],
};

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input));
    if (url.startsWith('https://www.zukan.com.br/mcp')) return json({ result: { isError: true } });
    if (url.endsWith('/v2/graphql')) {
      const query = JSON.parse(String(init?.body)).query;
      expect(query).toContain('releaseDate');
      expect(query).toContain('serie { id }');
      return json({
        data: {
          sets: [
            { id: 'neo1', releaseDate: '2000-12-16', serie: { id: 'neo' } },
            { id: 'neo2', releaseDate: '2001-06-01', serie: { id: 'neo' } },
            { id: 'base1', releaseDate: '1999-01-09', serie: { id: 'base' } },
            { id: 'sv03.5', releaseDate: '2023-09-22', serie: { id: 'sv' } },
          ],
        },
      });
    }
    const m = url.match(/\/v2\/(en|pt|ja)\/(.+)$/);
    if (!m) return json(null, 404);
    const [, lang, path] = m;
    if (path === 'sets') return json(SETS[lang]);
    if (path === 'series') return json(SERIES[lang] ?? []);
    if (path === 'series/tcgp') return json({ sets: [] });
    const hit = tcgdex.get(`${lang}/${path}`);
    if (hit !== undefined) return json(hit);
    // Listas sem resposta própria: vazias; fichas: 404.
    return /^cards\?/.test(path) ? json([]) : json(null, 404);
  }) as unknown as typeof fetch;
});

beforeEach(() => {
  tcgdex.clear();
  mockDb.rows = [];
  mockDb.names = [];
  mockDb.dates = {};
});

function row(o: Partial<CatalogRow> & { product_id: number; group_id: number; name: string }, group: CatalogRow['tcg_groups'] = null): CatalogRow {
  return {
    category: 3,
    full_name: o.name,
    number: null,
    rarity: null,
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${o.product_id}_in_1000x1000.jpg`,
    stamp: null,
    tcgdex_id: null,
    tcg_groups: group ?? { name: `Grupo ${o.group_id}`, abbr: null, published_on: null },
    ...o,
  };
}

const label = (c: CardBrief) => `${c.id}${c.stamp ? ` · ${c.stamp.label}` : ''}`;

describe('carta que só existe com selo (Coleção Clássica de 30 anos)', () => {
  // Dados reais da TCGdex: a 30th-c-026 tem uma impressão só, holo com o selo 30th Anniversary (e holo: true nas marcações).
  const mewVmax = {
    id: '30th-c-026',
    localId: '026',
    name: 'Mew VMAX',
    set: { id: '30th-c', name: '30th Classic Collection' },
    variants: { normal: false, holo: true, reverse: false },
    variants_detailed: [{ type: 'holo', size: 'standard', stamp: ['30th-anniversary'] }],
  };
  const card: Card = { id: '30th-c-026', localId: '026', name: 'Mew VMAX' };
  // A TCGplayer tem um produto só, sem o selo no nome.
  const product = () => row({ product_id: 700026, group_id: 24837, name: 'Mew VMAX', number: '026/030', tcgdex_id: '30th-c-026' });

  it('na busca: uma célula só, a com selo, com a foto do produto', async () => {
    tcgdex.set('pt/cards?name=like:Mew VMAX', [card]);
    tcgdex.set('en/cards?name=like:Mew VMAX', [card]);
    tcgdex.set('en/cards/30th-c-026', mewVmax);
    mockDb.rows = [product()];
    const res = await searchCardsResult('Mew VMAX', 'pt', { force: true });
    expect(res.cards.map(label)).toEqual(['30th-c-026 · 30th Anniversary']);
    expect(res.cards[0]).toMatchObject({ setName: 'Coleção Clássica', stamp: { variant: 'wPromo', keys: ['30th-anniversary'] } });
  });

  it('na lista do Pokémon: sem a célula comum ao lado da com selo', async () => {
    tcgdex.set('pt/cards?dexId=eq:151', [card]);
    tcgdex.set('en/cards?dexId=eq:151', [card]);
    tcgdex.set('en/cards/30th-c-026', mewVmax);
    mockDb.rows = [product()];
    const res = await cardsForDexResult(151, 'pt', { force: true });
    expect(res.cards.map(label)).toEqual(['30th-c-026 · 30th Anniversary']);
  });

  it('sem imagem na TCGdex, a versão com selo fica com a foto do produto sem selo', async () => {
    tcgdex.set('en/cards?name=like:Mew VMAX', [card]);
    tcgdex.set('en/cards/30th-c-026', mewVmax);
    mockDb.rows = [product()];
    const res = await searchCardsResult('Mew VMAX', 'en', { force: true });
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].imageUrl).toBe(product().image);
  });

  it('carta com a impressão comum e a com selo continua com as duas', async () => {
    const pikachu: Card = { id: 'sv01-063', localId: '063', name: 'Pikachu' };
    tcgdex.set('en/cards?name=like:Pikachu', [pikachu]);
    tcgdex.set('en/cards/sv01-063', {
      ...pikachu,
      set: { id: 'sv01', name: 'Scarlet & Violet' },
      variants_detailed: [{ type: 'normal' }, { type: 'reverse' }, { type: 'reverse', stamp: ['set-logo'] }],
    });
    mockDb.rows = [row({ product_id: 500063, group_id: 22873, name: 'Pikachu', number: '063/198', tcgdex_id: 'sv01-063' })];
    const res = await searchCardsResult('Pikachu', 'en', { force: true });
    expect(res.cards.map((c) => [c.id, c.stamp?.keys ?? null])).toEqual([
      ['sv01-063', null],
      ['sv01-063', ['set-logo']],
    ]);
  });
});

describe('selo só do logo sem o "<Coleção> Stamped": o par é o produto Prerelease', () => {
  const pikachu: Card = { id: 'sv01-063', localId: '063', name: 'Pikachu' };
  const detail = {
    ...pikachu,
    set: { id: 'sv01', name: 'Scarlet & Violet' },
    variants_detailed: [{ type: 'normal' }, { type: 'reverse', stamp: ['set-logo'] }],
  } as CardDetail;
  const rows = () => [
    row({ product_id: 500063, group_id: 22873, name: 'Pikachu', number: '063/198', tcgdex_id: 'sv01-063' }),
    row({ product_id: 500064, group_id: 22873, name: 'Pikachu', number: '063/198', tcgdex_id: 'sv01-063', stamp: 'Prerelease' }),
    row({ product_id: 500065, group_id: 22873, name: 'Pikachu', number: '063/198', tcgdex_id: 'sv01-063', stamp: 'Staff Prerelease' }),
  ];

  it('uma célula só para o logo, com o nome e a foto do Prerelease; o de Staff continua à parte', async () => {
    tcgdex.set('en/cards?name=like:Pikachu', [pikachu]);
    tcgdex.set('en/cards/sv01-063', detail);
    mockDb.rows = rows();
    const res = await searchCardsResult('Pikachu', 'en', { force: true });
    expect(res.cards.map(label)).toEqual(['sv01-063', 'sv01-063 · Logo da coleção (Pré-release)', 'sv01-063 · Staff Prerelease']);
    const logo = res.cards[1];
    expect(logo).toMatchObject({ imageUrl: rows()[1].image, stamp: { variant: 'wPromo', keys: ['set-logo'] } });
    // O mesmo nome do "Qual é a sua versão?": o "Adicionar" não ganha a versão repetida.
    const picker = withCatalogVersions(versionOptions(detail, detail), rows(), 'Scarlet & Violet');
    expect(picker.filter((o) => o.stamp === logo.stamp?.label)).toHaveLength(1);
  });

  it('com o "<Coleção> Stamped", o Prerelease é outra versão e o logo é o da Booster Box', async () => {
    tcgdex.set('en/cards?name=like:Pikachu', [pikachu]);
    tcgdex.set('en/cards/sv01-063', detail);
    mockDb.rows = [...rows().slice(0, 2), row({ product_id: 500066, group_id: 22873, name: 'Pikachu', number: '063/198', tcgdex_id: 'sv01-063', stamp: 'Scarlet & Violet Stamped' })];
    const res = await searchCardsResult('Pikachu', 'en', { force: true });
    expect(res.cards.map(label)).toEqual(['sv01-063', 'sv01-063 · Prerelease', 'sv01-063 · Logo da coleção (Booster Box)']);
  });
});

describe('ordem "Mais novas" das coleções que só existem no catálogo', () => {
  it('pela data de lançamento, não pelo id do grupo', async () => {
    const eevee = (id: string): Card => ({ id, localId: '1', name: 'Eevee' });
    tcgdex.set('en/cards?name=like:Eevee', [eevee('ex6-1'), eevee('ex7-1'), eevee('me02-1'), eevee('30th-1')]);
    const g = (name: string, published_on: string) => ({ name, abbr: null, published_on });
    mockDb.rows = [
      row({ product_id: 1, group_id: 1000, name: 'Eevee', number: '1', tcgdex_id: 'ex6-1' }, g('EX FireRed & LeafGreen', '2004-08-30')),
      row({ product_id: 2, group_id: 1001, name: 'Eevee', number: '1', tcgdex_id: 'ex7-1' }, g('EX Team Rocket Returns', '2004-11-08')),
      row({ product_id: 3, group_id: 24000, name: 'Eevee', number: '1', tcgdex_id: 'me02-1' }, g('ME02: Phantasmal Flames', '2025-11-14')),
      row({ product_id: 4, group_id: 24451, name: 'Eevee', number: '1', tcgdex_id: '30th-1' }, g('30th Celebration', '2026-02-27')),
      // Só no catálogo: o id do grupo não segue a data (o 1853 é de 2004; o 24864, de 2023, é maior que o 24451, de 2026).
      row({ product_id: 5, group_id: 1853, name: 'Eevee', number: '5' }, g('EX Battle Stadium', '2004-10-18')),
      row({ product_id: 6, group_id: 24864, name: 'Eevee', number: '6' }, g('Southeast Asia Exclusives', '2023-08-05')),
      row({ product_id: 7, group_id: 24900, name: 'Eevee', number: '7' }, g('ME06: Delta Reign', '2026-05-22')),
    ];
    const res = await searchCardsResult('Eevee', 'en', { force: true });
    expect([...new Set(res.cards.map((c) => c.setId))]).toEqual(['tcgp24900', '30th', 'me02', 'tcgp24864', 'ex7', 'tcgp1853', 'ex6']);
  });
});

describe('lista japonesa (85 como base, TCGdex japonesa de reserva)', () => {
  const ja = (product_id: number, group_id: number, name: string, number: string | null, published_on: string | null, stamp: string | null = null) =>
    row({ product_id, group_id, name, number, stamp, category: 85 }, { name: `Grupo ${group_id}`, abbr: null, published_on });

  it('Nidoran♂: também os produtos com as palavras juntas ("NidoranM"), sem os da fêmea', async () => {
    mockDb.rows = [
      ja(1, 604, 'NidoranM', null, '1997-03-05'),
      ja(2, 24711, 'Nidoran M', '030/081', '2026-01-23'),
      ja(3, 604, 'NidoranF', null, '1997-03-05'),
      ja(4, 604, 'Nidorino', null, '1997-03-05'),
    ];
    const res = await cardsForDexResult(32, 'ja', { force: true });
    expect(res.cards.map((c) => c.id).sort()).toEqual(['tcgp-1', 'tcgp-2']);
    expect(mockDb.names).toEqual(expect.arrayContaining(['Nidoran♂', 'nidoranm']));
    const female = await cardsForDexResult(29, 'ja', { force: true });
    expect(female.cards.map((c) => c.id)).toEqual(['tcgp-3']);
  });

  it('reserva pelo nome: sem os Pokémon de nome mais longo (コイル ≠ レアコイル, ジバコイル)', async () => {
    tcgdex.set('ja/cards?name=コイル', [
      { id: 'SV2a-081', localId: '081', name: 'コイル' },
      { id: 'SV2a-082', localId: '082', name: 'レアコイル' },
      { id: 'SV2a-083', localId: '083', name: 'ジバコイル' },
      { id: 'SV2a-201', localId: '201', name: 'ロケット団のコイル' },
    ]);
    const res = await cardsForDexResult(81, 'ja', { force: true });
    expect(res.cards.map((c) => c.id).sort()).toEqual(['SV2a-081', 'SV2a-201']);
  });

  it('carta antiga sem número impresso: o produto que a TCGdex liga a ela entra no lugar (sem repetir)', async () => {
    // Dados reais: PMCG1-021 リザードン ↔ 575604 (holo) e 577031 (sem o símbolo de raridade), grupo sem sigla e sem número.
    mockDb.rows = [ja(575604, 600, 'Charizard', null, '1996-10-20'), ja(577031, 600, 'Charizard', null, '1996-10-20'), ja(695100, 24711, 'Mega Charizard X ex', '010/081', '2026-01-23')];
    tcgdex.set('ja/cards?dexId=eq:6', [{ id: 'PMCG1-021', localId: '021', name: 'リザードン' }]);
    tcgdex.set('ja/cards/PMCG1-021', {
      id: 'PMCG1-021',
      localId: '021',
      name: 'リザードン',
      set: { id: 'PMCG1', name: '拡張パック' },
      variants_detailed: [
        { type: 'holo', size: 'standard', thirdParty: { tcgplayer: 575604 } },
        { type: 'holo', subtype: 'no-rarity', size: 'standard', thirdParty: { tcgplayer: 577031 } },
      ],
    });
    const res = await cardsForDexResult(6, 'ja', { force: true });
    expect(res.cards.map((c) => `${c.id}${c.tcgdexId ? ` = ${c.tcgdexId}` : ''}`)).toEqual(['tcgp-695100', 'tcgp-575604 = PMCG1-021', 'tcgp-577031']);
    expect(res.partial).toBe(false);
  });

  it('Japanese CD Promo: na época e na ordem de 1998, não de 2025 (data errada no TCGCSV)', async () => {
    mockDb.rows = [ja(800001, 24568, 'Charizard', null, '2025-12-01'), ja(800002, 604, 'Charizard', null, '1997-03-05'), ja(800003, 24711, 'Charizard ex', '011/081', '2026-01-23')];
    const res = await cardsForDexResult(6, 'ja', { force: true });
    expect(res.cards.map((c) => c.id)).toEqual(['tcgp-800003', 'tcgp-800001', 'tcgp-800002']);
    expect(res.cards[1]).toMatchObject({ series: 'Pocket Monsters (1996–2001)', setOrder: 19980101 });
  });
});

describe('setReleaseYears (ano ao lado da coleção)', () => {
  it('na lista em português e inglês: a data da TCGdex e do catálogo, com o CD Promo em 1998', async () => {
    mockDb.dates = { tcgp24568: '2025-12-01', tcgp604: '1997-03-05' };
    const years = await setReleaseYears();
    expect(years).toEqual({ neo1: 2000, neo2: 2001, base1: 1999, 'sv03.5': 2023, tcgp604: 1997, tcgp24568: 1998 });
  });

  it('na lista japonesa: a coleção da reserva com o ano dela (neo2 de 2000), nunca o da inglesa de mesmo id', async () => {
    tcgdex.set('ja/sets/neo2', { id: 'neo2', name: '遺跡をこえて...', releaseDate: '2000-07-07' });
    const years = await setReleaseYears('ja', ['neo2', 'PMCG9', 'tcgp604']);
    expect(years.neo2).toBe(2000);
    expect(years.tcgp604).toBe(1997);
    expect(years.tcgp24568).toBe(1998);
    // Sem a coleção japonesa (404) e as inglesas: sem ano.
    expect(years.PMCG9).toBeUndefined();
    expect(years.base1).toBeUndefined();
  });
});

describe('setFacts e setNameIn (bloco "Para colecionador")', () => {
  it('português: o dia da TCGdex (o da coleção em inglês) e a série em português', async () => {
    expect(await setFacts('sv03.5', 'pt')).toEqual({ day: '2023-09-22', serieId: 'sv', serie: 'Escarlate e Violeta' });
    expect(await setFacts('base1', 'pt')).toEqual({ day: '1999-01-09', serieId: 'base', serie: 'Coleção Básica' });
  });

  it('português sem o nome traduzido da série (neo2): o nome em inglês', async () => {
    expect(await setFacts('neo2', 'pt')).toEqual({ day: '2001-06-01', serieId: 'neo', serie: 'Neo' });
    expect(await setFacts('neo2', 'en')).toEqual({ day: '2001-06-01', serieId: 'neo', serie: 'Neo' });
  });

  it('japonês: o dia da coleção japonesa (neo1 de 2000-02-04, nunca o 2000-12-16 da inglesa) e a série em japonês', async () => {
    tcgdex.set('ja/sets/neo1', { id: 'neo1', name: '金、銀、新世界へ...', releaseDate: '2000-02-04', serie: { id: 'neo', name: 'ポケモンカード★neo' } });
    tcgdex.set('ja/sets/M5', { id: 'M5', name: 'アビスアイ', releaseDate: '2026-05-22', serie: { id: 'M', name: 'ポケモンカードゲーム MEGA' } });
    expect(await setFacts('neo1', 'ja')).toEqual({ day: '2000-02-04', serieId: 'neo', serie: 'ポケモンカード★neo' });
    expect(await setFacts('M5', 'ja')).toEqual({ day: '2026-05-22', serieId: 'M', serie: 'ポケモンカードゲーム MEGA' });
    // Coleção japonesa que a TCGdex não tem (404): nada.
    expect(await setFacts('PMCG8', 'ja')).toEqual({});
  });

  it('coleção só do catálogo, sem id ou desconhecida: nada', async () => {
    expect(await setFacts('tcgp604', 'pt')).toEqual({});
    expect(await setFacts('', 'en')).toEqual({});
    expect(await setFacts('xx9', 'en')).toEqual({});
  });

  it('setNameIn: o nome da coleção na lista do idioma', async () => {
    expect(await setNameIn('30th-c', 'pt')).toBe('Coleção Clássica');
    expect(await setNameIn('base1', 'pt')).toBeUndefined();
    expect(await setNameIn('', 'pt')).toBeUndefined();
  });
});

// O plainName real (usado pela busca simulada do catálogo).
it('plainName junta o ♂ como "m"', () => {
  expect(plainName('Nidoran♂')).toBe('nidoran m');
});
