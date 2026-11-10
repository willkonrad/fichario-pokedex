// Cópia do catálogo do TCGCSV (Edge Function catalog-sync): cartas japonesas sem número, data de lançamento falsa,
// endereço dos preços (products.ts) e a ligação/selo com número nulo (link.ts).
import { cardHits, linkAndStamp, linkByTotal, productName, type TcgdexSet } from '../supabase/functions/catalog-sync/link';
import {
  cardProducts,
  droppedExamples,
  ENGLISH,
  HttpError,
  httpStatus,
  isCardProduct,
  JA_COPY_VERSION,
  JAPANESE,
  pricesNotFoundUpdate,
  pricesUrl,
  productNumber,
  productsNotFoundUpdate,
  releaseDay,
  syncedGroupUpdate,
  type Product,
} from '../supabase/functions/catalog-sync/products';

/** A condição de catalog_due_groups; tests/server-functions.test.ts confere que o SQL é este. */
const isDue = (g: { category: number; synced_at: string | null; modified_on?: string | null; link_version?: number | null }) =>
  !g.synced_at ||
  (!!g.modified_on && new Date(g.modified_on) > new Date(g.synced_at)) ||
  (g.category === JAPANESE && (g.link_version ?? 0) < JA_COPY_VERSION);

let nextId = 1;
/** Produto do TCGCSV com os campos do extendedData ([name, value] ou [name, value, displayName]). */
const product = (name: string, fields: ([string, string] | [string, string, string])[] = []): Product => ({
  productId: nextId++,
  name,
  extendedData: fields.map(([n, value, displayName]) => ({ name: n, value, ...(displayName ? { displayName } : {}) })),
});

describe('isCardProduct: carta avulsa ou produto lacrado', () => {
  it('com número é carta nas duas categorias', () => {
    const p = product('Dhelmise - 088/081', [['Number', '088/081'], ['Rarity', 'Art Rare']]);
    expect(isCardProduct(p, ENGLISH)).toBe(true);
    expect(isCardProduct(p, JAPANESE)).toBe(true);
    expect(productNumber(p)).toBe('088/081');
  });

  it('na 85, sem número mas com um campo de carta, é carta (cartas antigas sem número impresso)', () => {
    expect(isCardProduct(product('Charizard', [['Rarity', 'Holo Rare']]), JAPANESE)).toBe(true);
    expect(isCardProduct(product('Pikachu', [['Rarity', 'None']]), JAPANESE)).toBe(true);
    expect(isCardProduct(product('Blastoise', [['CardType', 'Water', 'Card Type']]), JAPANESE)).toBe(true);
    expect(isCardProduct(product('Venusaur', [['HP', '100']]), JAPANESE)).toBe(true);
    expect(isCardProduct(product('Mewtwo', [['Stage', 'Basic']]), JAPANESE)).toBe(true);
    expect(isCardProduct(product('Mew', [['Attack1', '[P] Psywave', 'Attack 1']]), JAPANESE)).toBe(true);
    expect(isCardProduct(product('Bill', [['CardText', 'Draw 2 cards.', 'Card Text']]), JAPANESE)).toBe(true);
    expect(isCardProduct(product('Onix', [['Weakness', 'Grass']]), JAPANESE)).toBe(true);
  });

  it('compara o name e o displayName sem caixa nem espaço', () => {
    expect(isCardProduct(product('Ditto', [['x', 'Colorless', 'Card Type']]), JAPANESE)).toBe(true);
    expect(isCardProduct(product('Ditto', [['card type', 'Colorless']]), JAPANESE)).toBe(true);
    expect(isCardProduct(product('Ditto', [['ATTACK 1', 'Transform']]), JAPANESE)).toBe(true);
  });

  it('produto lacrado (sem campo de carta) fica de fora', () => {
    expect(isCardProduct(product('Expansion Pack Booster Box'), JAPANESE)).toBe(false);
    expect(isCardProduct(product('Pokemon Jungle Booster Pack', [['Description', '10 cards']]), JAPANESE)).toBe(false);
    expect(isCardProduct(product('Starter Deck', [['UPC', '4521329000000']]), JAPANESE)).toBe(false);
    expect(isCardProduct({ productId: 9, name: 'Premium File' }, JAPANESE)).toBe(false);
  });

  it('campo de carta vazio não conta', () => {
    expect(isCardProduct(product('Display', [['Rarity', ''], ['HP', '  ']]), JAPANESE)).toBe(false);
  });

  it('a palavra no nome não decide: "Tool Box" com campos de carta é carta', () => {
    expect(isCardProduct(product('Tool Box', [['Rarity', 'Uncommon'], ['CardType', 'Trainer']]), JAPANESE)).toBe(true);
  });

  it('na 3 nada muda: sem número não é carta, mesmo com raridade', () => {
    expect(isCardProduct(product('Charizard', [['Rarity', 'Holo Rare'], ['HP', '120']]), ENGLISH)).toBe(false);
    expect(isCardProduct(product('Pikachu', [['Number', '']]), ENGLISH)).toBe(false);
  });
});

describe('cardProducts: cartas de uma coleção e a conta das sem número', () => {
  const japanese = [
    product('Base Expansion Booster Box'),
    product('Charizard', [['Rarity', 'Holo Rare']]),
    product('Pikachu - 016/128', [['Number', '016/128'], ['Rarity', 'Common']]),
    product('Blastoise', [['Rarity', 'Holo Rare']]),
    product('Venusaur', [['HP', '100']]),
    product('Mewtwo', [['Stage', 'Basic']]),
    product('Theme Deck'),
    product('Premium File', [['Description', 'File']]),
    product('Booster Pack'),
    product('Starter Set'),
  ];

  it('na 85 guarda as sem número que são carta (número nulo) e conta guardadas e descartadas, com até 3 nomes', () => {
    const { cards, unnumbered } = cardProducts(japanese, JAPANESE);
    expect(cards.map((c) => [c.p.name, c.number])).toEqual([
      ['Charizard', null],
      ['Pikachu - 016/128', '016/128'],
      ['Blastoise', null],
      ['Venusaur', null],
      ['Mewtwo', null],
    ]);
    expect(unnumbered).toEqual({
      kept: 4,
      dropped: 5,
      keptNames: ['Charizard', 'Blastoise', 'Venusaur'],
      droppedNames: ['Base Expansion Booster Box', 'Theme Deck', 'Premium File'],
      droppedFields: [[], [], ['Description']],
    });
  });

  it('na nova cópia da 85, até 30 descartados com os nomes dos campos de cada (sem os valores)', () => {
    const sealed = Array.from({ length: 35 }, (_, i) =>
      product(`Booster Box ${i}`, [['Description', `${i} packs`], ['UPC', `45213290${i}`], ['Rarity', '']]),
    );
    const promo = product('Pikachu (Old Promo)', [['Rarity', 'Promo'], ['CardType', 'Lightning']]);
    const oldJa = { category: JAPANESE, link_version: 7 };
    const { cards, unnumbered } = cardProducts([...sealed, promo], JAPANESE, droppedExamples(oldJa));
    expect(cards.map((c) => c.p.name)).toEqual(['Pikachu (Old Promo)']);
    expect(unnumbered?.dropped).toBe(35);
    expect(unnumbered?.droppedNames).toEqual(sealed.slice(0, 30).map((p) => p.name));
    // droppedFields[i] é de droppedNames[i]: o campo vazio aparece (mostra por que o produto não é carta).
    expect(unnumbered?.droppedFields).toHaveLength(30);
    expect(unnumbered?.droppedFields[0]).toEqual(['Description', 'UPC', 'Rarity']);
    // Relatório pequeno: nenhum valor de campo.
    const report = JSON.stringify(unnumbered);
    expect(report).not.toContain('packs');
    expect(report).not.toContain('45213290');
    expect(report).not.toContain('Lightning');
  });

  it('30 exemplos de descartados só na 85 copiada pela primeira vez com a versão atual; 3 nas outras', () => {
    expect(droppedExamples({ category: JAPANESE, link_version: 7 })).toBe(30);
    // Coleção nova ou zerada pela migração (link_version 0, synced_at nulo).
    expect(droppedExamples({ category: JAPANESE, link_version: 0 })).toBe(30);
    expect(droppedExamples({ category: JAPANESE, link_version: JA_COPY_VERSION })).toBe(3);
    expect(droppedExamples({ category: ENGLISH, link_version: 0 })).toBe(3);
    // Sem o limite, os 3 de sempre.
    const sealed = Array.from({ length: 10 }, (_, i) => product(`Deck ${i}`));
    expect(cardProducts(sealed, JAPANESE).unnumbered?.droppedNames).toHaveLength(3);
    expect(cardProducts(sealed, JAPANESE, droppedExamples({ category: JAPANESE, link_version: JA_COPY_VERSION })).unnumbered?.droppedFields).toHaveLength(3);
  });

  it('na 3 só entram as com número e não há conta', () => {
    const { cards, unnumbered } = cardProducts(japanese, ENGLISH);
    expect(cards.map((c) => c.number)).toEqual(['016/128']);
    expect(unnumbered).toBeNull();
  });

  it('coleção japonesa com todas as cartas numeradas: sem conta', () => {
    const { cards, unnumbered } = cardProducts([product('Tropius', [['Number', '001/081']])], JAPANESE);
    expect(cards).toHaveLength(1);
    expect(unnumbered).toBeNull();
  });
});

describe('releaseDay: data de lançamento da coleção', () => {
  const built = new Date('2026-11-06T20:05:43Z');

  it('data real antes do dia do build fica', () => {
    expect(releaseDay('2023-01-20T00:00:00', built)).toBe('2023-01-20');
    expect(releaseDay('2026-11-05T00:00:00', built)).toBe('2026-11-05');
  });

  it('a data do dia do build (coleção sem data no TCGCSV) ou posterior vira null', () => {
    expect(releaseDay('2026-11-06T00:00:00', built)).toBeNull();
    expect(releaseDay('2026-11-07T00:00:00', built)).toBeNull();
  });

  it('sem data ou com data estragada: null', () => {
    expect(releaseDay(undefined, built)).toBeNull();
    expect(releaseDay(null, built)).toBeNull();
    expect(releaseDay('', built)).toBeNull();
    expect(releaseDay('sem data', built)).toBeNull();
  });

  it('sem a hora do build, a data fica como veio', () => {
    expect(releaseDay('2026-11-06T00:00:00', new Date(NaN))).toBe('2026-11-06');
  });
});

describe('pricesUrl: arquivo de preços pela categoria da coleção', () => {
  it('inglês e japonês', () => {
    expect(pricesUrl('https://tcgcsv.com', ENGLISH, 2545)).toBe('https://tcgcsv.com/tcgplayer/3/2545/prices');
    expect(pricesUrl('https://tcgcsv.com', JAPANESE, 24711)).toBe('https://tcgcsv.com/tcgplayer/85/24711/prices');
  });
});

describe('nova cópia da 85 pela versão da cópia (sem passo no banco)', () => {
  const LINK_VERSION = 7;
  const copied = '2026-11-01T10:00:00.000Z';
  /** Coleção japonesa copiada pela função até a 3.1.0 (link_version = a versão da ligação da época, 0 a 7). */
  const oldJa = { category: JAPANESE, synced_at: copied, modified_on: '2026-10-01T00:00:00.000Z', link_version: 7 };

  it('a coleção da 85 copiada com a versão antiga é pendente, mesmo sem mudança na TCGplayer e com synced_at', () => {
    expect(JA_COPY_VERSION).toBeGreaterThan(7);
    expect(isDue(oldJa)).toBe(true);
    expect(isDue({ ...oldJa, link_version: 0 })).toBe(true);
    expect(isDue({ ...oldJa, link_version: JA_COPY_VERSION })).toBe(false);
  });

  it('na 3 a versão não pede cópia (a religação cuida dela, sem baixar de novo)', () => {
    expect(isDue({ ...oldJa, category: ENGLISH, link_version: 0 })).toBe(false);
  });

  it('nunca copiada ou alterada depois da cópia: pendente nas duas categorias', () => {
    for (const category of [ENGLISH, JAPANESE]) {
      expect(isDue({ category, synced_at: null, modified_on: null, link_version: JA_COPY_VERSION })).toBe(true);
      expect(isDue({ category, synced_at: copied, modified_on: '2026-11-02T00:00:00Z', link_version: JA_COPY_VERSION })).toBe(true);
    }
  });

  it('depois da cópia a coleção grava a versão da cópia (85) ou da ligação (3) e deixa de ser pendente', () => {
    const now = '2026-11-07T12:00:00.000Z';
    const ja = syncedGroupUpdate(oldJa, 0, LINK_VERSION, now);
    expect(ja).toEqual({ synced_at: now, link_version: JA_COPY_VERSION });
    expect(isDue({ ...oldJa, ...ja })).toBe(false);
    const en = syncedGroupUpdate({ ...oldJa, category: ENGLISH, link_version: 3 }, 0, LINK_VERSION, now);
    expect(en).toEqual({ synced_at: now, link_version: LINK_VERSION });
  });

  it('a nova cópia que guardou cartas sem número lê os preços da coleção de novo (os lidos antes não as têm)', () => {
    const now = '2026-11-07T12:00:00.000Z';
    expect(syncedGroupUpdate(oldJa, 3, LINK_VERSION, now)).toEqual({ synced_at: now, link_version: JA_COPY_VERSION, prices_at: null });
    // Coleção nunca copiada: os preços ainda não foram lidos (nada a refazer).
    expect(syncedGroupUpdate({ ...oldJa, synced_at: null }, 3, LINK_VERSION, now)).not.toHaveProperty('prices_at');
    // Cópia de uma coleção já na versão nova (alterada na TCGplayer): as sem número já estavam no catálogo.
    expect(syncedGroupUpdate({ ...oldJa, link_version: JA_COPY_VERSION }, 3, LINK_VERSION, now)).not.toHaveProperty('prices_at');
    expect(syncedGroupUpdate({ ...oldJa, category: ENGLISH }, 3, LINK_VERSION, now)).not.toHaveProperty('prices_at');
  });
});

describe('404 do TCGCSV: a coleção não fica na fila em toda execução', () => {
  const built = '2026-11-06T20:05:43.000Z';
  const now = '2026-11-07T12:00:00.000Z';
  const url = 'https://tcgcsv.com/tcgplayer/85/24711/prices';

  it('o erro do get guarda o status (e a mensagem de antes, "url status")', () => {
    const e = new HttpError(url, 404);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe(`${url} 404`);
    expect(httpStatus(e)).toBe(404);
    expect(httpStatus(new HttpError(url, 503))).toBe(503);
    // Erro de rede ou JSON estragado: sem status.
    expect(httpStatus(new TypeError('fetch failed'))).toBeNull();
    expect(httpStatus(new SyntaxError('Unexpected token'))).toBeNull();
    expect(httpStatus(null)).toBeNull();
    expect(httpStatus('404')).toBeNull();
  });

  it('preços: 404 grava prices_at = build (tenta só no próximo build); outros erros repetem na próxima execução', () => {
    expect(pricesNotFoundUpdate(httpStatus(new HttpError(url, 404)), built)).toEqual({ prices_at: built });
    // A fila dos preços pede prices_at nulo ou menor que o build: com o build gravado, a coleção sai até o próximo.
    const priceDue = (pricesAt: string | null, b: string) => !pricesAt || pricesAt < b;
    expect(priceDue(pricesNotFoundUpdate(404, built)!.prices_at, built)).toBe(false);
    expect(priceDue(pricesNotFoundUpdate(404, built)!.prices_at, '2026-11-07T20:05:43.000Z')).toBe(true);
    for (const status of [500, 502, 503, 429, 403, null]) expect(pricesNotFoundUpdate(status, built)).toBeNull();
  });

  it('cópia: 404 em /products na 85 marca a coleção como copiada nesta versão e ela sai da fila', () => {
    const oldJa = { category: JAPANESE, synced_at: '2026-11-01T10:00:00.000Z', modified_on: '2026-10-01T00:00:00.000Z', link_version: 7 };
    const update = productsNotFoundUpdate(oldJa, 404, now);
    expect(update).toEqual({ synced_at: now, link_version: JA_COPY_VERSION });
    expect(isDue(oldJa)).toBe(true);
    expect(isDue({ ...oldJa, ...update })).toBe(false);
    // Nunca copiada (ex.: zerada pela migração): também sai da fila.
    const never = { ...oldJa, synced_at: null, link_version: 0 };
    expect(isDue({ ...never, ...productsNotFoundUpdate(never, 404, now) })).toBe(false);
    // Volta quando a TCGplayer altera a coleção.
    expect(isDue({ ...oldJa, ...update, modified_on: '2026-11-08T00:00:00.000Z' })).toBe(true);
  });

  it('cópia: na 3 e em outro erro na 85, nada muda (a coleção continua pendente e o erro é anotado)', () => {
    const en = { category: ENGLISH, synced_at: null };
    expect(productsNotFoundUpdate(en, 404, now)).toBeNull();
    for (const status of [500, 503, 429, null]) expect(productsNotFoundUpdate({ category: JAPANESE }, status, now)).toBeNull();
  });
});

describe('ligação e selo com número nulo (cartas japonesas sem número)', () => {
  const cards = [
    { product_id: 1, name: 'Charizard', number: null, full_name: 'Charizard' },
    { product_id: 2, name: 'Charizard', number: null, full_name: 'Charizard (Mirror Holofoil)' },
    { product_id: 3, name: 'Pikachu', number: '016/128', full_name: 'Pikachu - 016/128' },
    { product_id: 4, name: 'Pikachu', number: null, full_name: 'Pikachu' },
    { product_id: 5, name: 'Pikachu', number: '016/128', full_name: 'Pikachu - 016/128 (Master Ball Pattern)' },
  ];

  it('na 85 (sem candidatas): sem ligação; o selo compara só pelo nome entre as sem número', () => {
    expect(linkAndStamp('Expansion Pack', cards, [], [], new Map())).toEqual([
      { product_id: 1, tcgdex_id: null, stamp: null },
      { product_id: 2, tcgdex_id: null, stamp: 'Mirror Holofoil' },
      { product_id: 3, tcgdex_id: null, stamp: null },
      // A sem número não é a versão comum da numerada (nem o contrário).
      { product_id: 4, tcgdex_id: null, stamp: null },
      { product_id: 5, tcgdex_id: null, stamp: 'Master Ball Pattern' },
    ]);
  });

  it('promos sem número com o mesmo nome e sem a versão sem complemento: nenhuma vira versão da outra', () => {
    const mk = (product_id: number, full_name: string) => ({ product_id, name: productName(full_name), number: null, full_name });
    const promos = [
      mk(1, 'Pikachu (Birthday)'),
      mk(2, 'Pikachu (Ivy)'),
      mk(3, 'Mew (Mirror Holofoil)'),
      mk(4, 'Pikachu (Birthday) (Master Ball Pattern)'),
    ];
    const expected = [
      { product_id: 1, tcgdex_id: null, stamp: null },
      { product_id: 2, tcgdex_id: null, stamp: null },
      // Só o marcador de versão conhecido fica como selo (Mirror ⇒ reverse, padrões ⇒ pokeball/masterball no app).
      { product_id: 3, tcgdex_id: null, stamp: 'Mirror Holofoil' },
      { product_id: 4, tcgdex_id: null, stamp: 'Master Ball Pattern' },
    ];
    expect(linkAndStamp('CoroCoro Promotional Cards', promos, [], [], new Map())).toEqual(expected);
    // A ordem dos produtos não muda o resultado.
    const reversed = linkAndStamp('CoroCoro Promotional Cards', [...promos].reverse(), [], [], new Map());
    expect(reversed.sort((a, b) => a.product_id - b.product_id)).toEqual(expected);
  });

  it('sem número, com a versão sem complemento na coleção, as outras de mesmo nome ganham o complemento como selo', () => {
    const out = linkAndStamp(
      'Vending Machine cards Series 3',
      [
        { product_id: 1, name: 'Pikachu', number: null, full_name: 'Pikachu (Ivy)' },
        { product_id: 2, name: 'Pikachu', number: null, full_name: 'Pikachu' },
      ],
      [],
      [],
      new Map(),
    );
    expect(out.map((o) => o.stamp)).toEqual(['Ivy', null]);
  });

  it('com número nada muda: a de menos complementos é a versão comum', () => {
    const out = linkAndStamp(
      'Pokemon Card 151',
      [
        { product_id: 1, name: 'Pikachu', number: '025/165', full_name: 'Pikachu - 025/165 (Birthday)' },
        { product_id: 2, name: 'Pikachu', number: '025/165', full_name: 'Pikachu - 025/165 (Birthday) (Master Ball Pattern)' },
      ],
      [],
      [],
      new Map(),
    );
    expect(out.map((o) => o.stamp)).toEqual([null, 'Master Ball Pattern']);
  });

  it('não quebra nem liga com coleções da TCGdex por perto', () => {
    const base1: TcgdexSet = { id: 'base1', abbr: null, name: 'Base Set', cards: [{ id: 'base1-4', localId: '4', name: 'Charizard' }] };
    const out = linkAndStamp('Expansion Pack', cards.slice(0, 2), [base1], [base1], new Map([['base1', 102]]));
    expect(out.map((o) => o.tcgdex_id)).toEqual([null, null]);
    expect(linkByTotal('Charizard', null, [base1], new Map([['base1', 102]]))).toBeNull();
    expect(cardHits('Charizard', null, [base1])).toEqual([]);
  });
});
