// Busca por nome (searchCardsResult) com a TCGdex, o Zukan e o catálogo simulados: nenhum teste acessa a rede.
import type { CatalogRow } from '@/lib/catalog';
import { searchCardsResult } from '@/lib/tcgdex';

const mockCatalog = { rows: [] as CatalogRow[], groupSet: [] as string[] };

jest.mock('@/lib/catalog', () => ({
  ...jest.requireActual('@/lib/catalog'),
  catalogByName: jest.fn(async () => mockCatalog.rows),
  catalogByTcgdexIds: jest.fn(async () => []),
  catalogGroupSet: jest.fn(async () => mockCatalog.groupSet),
}));

type Card = { id: string; localId: string; name: string };
/** Respostas da TCGdex por busca ("en|Mr. Mime") e do Zukan por Pokémon ("30"). */
const tcgdexByName = new Map<string, Card[]>();
const zukanByDex = new Map<string, (Card & { setNamePt?: string })[]>();

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://www.zukan.com.br/mcp')) {
      const { params } = JSON.parse(String(init?.body));
      if (params.name !== 'get_pokemon') return json({ result: { isError: true } });
      return json({ result: { structuredContent: { cards: zukanByDex.get(String(params.arguments.query)) ?? [] } } });
    }
    const m = url.match(/\/v2\/(en|pt|ja)\/(.+)$/);
    if (!m) return json(null, 404);
    const [, lang, path] = m;
    if (path === 'sets') return json([{ id: 'base2', name: 'Jungle' }, { id: 'ex1', name: 'Ruby & Sapphire' }, { id: 'mep', name: 'MEP Black Star Promos' }]);
    if (path === 'series/tcgp') return json({ sets: [] });
    const like = path.match(/^cards\?name=like:(.+)$/);
    if (like) return json(tcgdexByName.get(`${lang}|${decodeURIComponent(like[1])}`) ?? []);
    return json(null, 404);
  }) as unknown as typeof fetch;
});

beforeEach(() => {
  tcgdexByName.clear();
  zukanByDex.clear();
  mockCatalog.rows = [];
  mockCatalog.groupSet = [];
});

describe('searchCardsResult', () => {
  it('grafias que a TCGdex trata diferente não dividem a lista guardada ("mr mime" × "Mr. Mime")', async () => {
    tcgdexByName.set('en|Mr. Mime', [{ id: 'base2-6', localId: '6', name: 'Mr. Mime' }]);
    const first = await searchCardsResult('mr mime', 'en');
    expect(first.cards).toEqual([]);
    const second = await searchCardsResult('Mr. Mime', 'en');
    expect(second.cards.map((c) => c.id)).toEqual(['base2-6']);
  });

  it('junta a carta do Zukan com a do catálogo sem ligação (Nidorina MEP 101), na busca pelo nome e pelo número', async () => {
    const row = (product_id: number, stamp: string | null): CatalogRow => ({
      product_id,
      category: 3,
      group_id: 24451,
      name: 'Nidorina',
      full_name: `Nidorina - 101 (30th Celebration)${stamp ? ` (${stamp})` : ''}`,
      number: '101',
      rarity: 'Promo',
      image: `https://tcgplayer-cdn.tcgplayer.com/product/${product_id}_in_1000x1000.jpg`,
      stamp,
      tcgdex_id: null,
      tcg_groups: { name: 'ME: Mega Evolution Promo', abbr: 'MEP' },
    });
    mockCatalog.rows = [row(713260, null), row(713261, 'Pokemon Center Exclusive')];
    mockCatalog.groupSet = ['mep-001', 'mep-050'];
    tcgdexByName.set('pt|Nidorina', [{ id: 'ex1-50', localId: '50', name: 'Nidorina' }]);
    tcgdexByName.set('en|Nidorina', [{ id: 'ex1-50', localId: '50', name: 'Nidorina' }]);
    zukanByDex.set('30', [
      { id: 'mep-101', localId: '101', name: 'Nidorina', setNamePt: 'Promos MEP' },
      { id: 'ex1-50', localId: '50', name: 'Nidorina' },
    ]);

    const res = await searchCardsResult('Nidorina', 'pt');
    const ids = res.cards.map((c) => `${c.id}${c.stamp ? ` · ${c.stamp.label}` : ''}`);
    expect(ids).toEqual(expect.arrayContaining(['mep-101', 'mep-101 · Pokemon Center Exclusive', 'ex1-50']));
    expect(ids.some((id) => id.startsWith('tcgp-'))).toBe(false);
    expect(res.cards.find((c) => c.id === 'mep-101' && !c.stamp)?.imageUrl).toBe(row(713260, null).image);

    const byNumber = await searchCardsResult('Nidorina 101', 'pt');
    expect(byNumber.numberMatched).toBe(true);
    expect(byNumber.cards.map((c) => c.id)).toEqual(['mep-101', 'mep-101']);
  });
});
