import type { CatalogRow } from '@/lib/catalog';

// Foto do Zukan para a carta só do catálogo de uma coleção nova (sem a TCGdex e sem a foto da TCGplayer). Sem rede: o
// catálogo e o Zukan são de mentira.
jest.mock('@/lib/catalog', () => ({ ...jest.requireActual('@/lib/catalog'), catalogProduct: jest.fn() }));

type Catalog = typeof import('@/lib/catalog');
type Tcgdex = typeof import('@/lib/tcgdex');

/** Módulos novos a cada teste (o cache da memória fica no módulo). */
function load() {
  let catalog!: jest.Mocked<Catalog>;
  let tcgdex!: Tcgdex;
  jest.isolateModules(() => {
    catalog = jest.requireMock('@/lib/catalog');
    tcgdex = jest.requireActual('@/lib/tcgdex');
  });
  return { catalog, tcgdex };
}

const row = (name: string, number: string, group = 'ME06: Delta Reign'): CatalogRow => ({
  product_id: 726510,
  category: 3,
  group_id: 24831,
  name,
  full_name: `${name} - ${number}`,
  number,
  rarity: 'Common',
  image: 'https://tcgplayer-cdn.tcgplayer.com/product/726510_in_1000x1000.jpg',
  stamp: null,
  tcgdex_id: null,
  tcg_groups: { name: group, abbr: 'DLR' },
});

/** Resposta do servidor MCP do Zukan para get_card, por idioma. */
function zukanReplies(cards: Record<string, { name: string; image?: string } | undefined>) {
  const calls: { id: string; lang: string }[] = [];
  globalThis.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
    const args = JSON.parse(init?.body ?? '{}').params.arguments as { id: string; lang: string };
    calls.push(args);
    const card = cards[args.lang];
    return {
      ok: true,
      json: async () => ({ result: card ? { content: [{ type: 'text', text: JSON.stringify({ id: args.id, ...card }) }] } : { isError: true } }),
    };
  }) as unknown as typeof fetch;
  return calls;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('zukanCatalogImage', () => {
  it('acha a carta pelo prefixo da coleção e o número ("ME06" 003/103 → me06-003), em português', async () => {
    const { catalog, tcgdex } = load();
    catalog.catalogProduct.mockResolvedValue(row('Masquerain', '003/103'));
    const image = 'https://images.zukan.com.br/cards/me06-003/pt/high.webp';
    const calls = zukanReplies({ pt: { name: 'Masquerain', image } });
    expect(await tcgdex.zukanCatalogImage('tcgp-726510')).toEqual({ small: image, large: image });
    expect(calls).toEqual([{ id: 'me06-003', lang: 'pt' }]);
  });

  it('nome em português diferente (treinador): confere pelo nome em inglês', async () => {
    const { catalog, tcgdex } = load();
    catalog.catalogProduct.mockResolvedValue(row("Zinnia's Trust", '140/103'));
    const image = 'https://images.zukan.com.br/cards/me06-140/pt/high.webp';
    const calls = zukanReplies({ pt: { name: 'Confiança da Zínia', image }, en: { name: "Zinnia's Trust" } });
    expect(await tcgdex.zukanCatalogImage('tcgp-726576')).toEqual({ small: image, large: image });
    expect(calls.map((c) => c.lang)).toEqual(['pt', 'en']);
  });

  it('outra carta no mesmo número: sem imagem', async () => {
    const { catalog, tcgdex } = load();
    catalog.catalogProduct.mockResolvedValue(row('Groudon', '111/103'));
    zukanReplies({ pt: { name: 'Kyogre', image: 'https://images.zukan.com.br/cards/me06-111/pt/high.webp' }, en: { name: 'Kyogre' } });
    expect(await tcgdex.zukanCatalogImage('tcgp-726563')).toBeNull();
  });

  it('coleção sem prefixo de série ("Miscellaneous…") nem pergunta ao Zukan', async () => {
    const { catalog, tcgdex } = load();
    catalog.catalogProduct.mockResolvedValue(row('Pikachu', '025/165', 'Miscellaneous Cards & Products'));
    const calls = zukanReplies({});
    expect(await tcgdex.zukanCatalogImage('tcgp-1')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('carta da TCGdex (sem "tcgp-") não passa por aqui', async () => {
    const { tcgdex } = load();
    const calls = zukanReplies({});
    expect(await tcgdex.zukanCatalogImage('me06-003')).toBeNull();
    expect(calls).toEqual([]);
  });
});
