import type { LookupCard, LookupHeader, MypKeys } from '@/lib/lookup-types';
import type { MypProduct } from '@/lib/myp-match';
import type { MypFailures, MypRunner } from '@/lib/myp-queue';

import { AT, entry } from './fixtures';
import { header, lookupCard, lookupSet } from './lookup-fixtures';

// MYP na hora (seção 8): fila em espera, janela de 9/min, 429, comportamento de sempre em fetchMypPrice e nenhuma TCGdex.

type Queue = typeof import('@/lib/myp-queue');
type Api = typeof import('@/lib/myp-api');

jest.mock('@/lib/supabase', () => ({
  supabase: null,
  isNetworkError: (err: unknown) => err instanceof Error && /network request failed/i.test(err.message),
}));

const T0 = new Date(AT).getTime();
const product = (over: Partial<MypProduct> = {}): MypProduct => ({
  internal_code: 77,
  card_code: 'pokemon_bs_004/102',
  edition_code: 'BS',
  name_en: 'Charizard',
  min_price: '480.00',
  avg_price: '600.00',
  max_price: '700.00',
  available_quantity: 12,
  link: 'https://mypcards.com/pokemon/produto/77',
  ...over,
});

type FetchCall = { url: string; method: string };
const urls = (calls: FetchCall[]) => calls.map((c) => c.url);

/** Rede de mentira: por endereço. Guarda cada chamada. */
function mockFetch(route: (url: string) => { status?: number; body?: unknown } | undefined) {
  const calls: FetchCall[] = [];
  const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    const res = route(url) ?? { status: 404, body: {} };
    const status = res.status ?? 200;
    return { status, ok: status >= 200 && status < 300, json: async () => res.body } as Response;
  });
  return { calls, spy };
}

const byName = (url: string) => decodeURIComponent(url).split('/carta/')[1];

function load() {
  let queue!: Queue;
  let api!: Api;
  jest.isolateModules(() => {
    api = jest.requireActual('@/lib/myp-api');
    queue = jest.requireActual('@/lib/myp-queue');
  });
  return { queue, api };
}

let now = T0;
beforeEach(() => {
  now = T0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

const keysFor = (name: string, over: Partial<MypKeys> = {}): MypKeys => ({
  names: [name],
  abbrs: ['BS'],
  guessed: false,
  localId: '4',
  total: 102,
  byName: false,
  promoSet: false,
  numberKnown: true,
  cardId: 'base1-4',
  variant: 'normal',
  note: '',
  ...over,
});

/** A TCGdex da carta comum: a sigla da coleção. Sem a ficha, a busca fica com o nome salvo na carta. */
const setsRoute = (url: string) => (url.includes('/en/sets/') ? { body: { abbreviation: { official: 'BS' } } } : undefined);
const fetchFound = () => mockFetch((url) => (url.includes('/carta/') ? { body: { cards: [product({ name_en: byName(url) })] } } : setsRoute(url)));

describe('consultMypNow', () => {
  it('devolve o preço com as chaves prontas', async () => {
    const { calls } = fetchFound();
    const { queue } = load();
    const r = await queue.consultMypNow(keysFor('Charizard'));
    expect(r).toEqual({ price: expect.objectContaining({ cardId: 'base1-4', variant: 'normal', min: 480, avg: 600, max: 700, qty: 12, url: 'https://mypcards.com/pokemon/produto/77' }) });
    expect(calls).toHaveLength(1);
  });

  it('nome sem produto: busca pelo código e responde "não encontrada"', async () => {
    const { calls } = mockFetch(() => ({ status: 404, body: {} }));
    const { queue } = load();
    const r = await queue.consultMypNow(keysFor('Charizard'));
    expect(r).toEqual({ price: expect.objectContaining({ notFound: expect.stringContaining('não encontrada') }) });
    expect(urls(calls).some((u) => u.includes('/precos/'))).toBe(true);
  });

  it('sem internet avisa, em vez de dar erro', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    const { queue } = load();
    expect(await queue.consultMypNow(keysFor('Charizard'))).toEqual({ offline: true });
  });

  it('erro HTTP do MYP não é "sem internet"', async () => {
    // 403 é recusa e para tudo (ver "403: o MYP recusou"); um erro do servidor é só uma falha.
    mockFetch((url) => (url.includes('/carta/') ? { status: 500, body: {} } : undefined));
    const { queue } = load();
    expect(await queue.consultMypNow(keysFor('Charizard'))).toEqual({ failed: true });
  });

  it('o preço vindo da busca guardada diz a hora dela, e não "agora"', async () => {
    fetchFound();
    const { queue } = load();
    await queue.consultMypNow(keysFor('Charizard'));
    now += 29 * 60_000;
    const again = await queue.consultMypNow(keysFor('Charizard', { cardId: 'outra-4' }));
    if (!('price' in again)) throw new Error('sem preço');
    expect(again.price.checkedAt).toBe(new Date(T0).toISOString());
  });

  it('busca guardada por 30 min não gasta consulta', async () => {
    const { calls } = fetchFound();
    const { queue } = load();
    await queue.consultMypNow(keysFor('Charizard'));
    now += 29 * 60_000;
    await queue.consultMypNow(keysFor('Charizard', { cardId: 'outra-4' }));
    expect(calls).toHaveLength(1);
    now += 2 * 60_000;
    await queue.consultMypNow(keysFor('Charizard'));
    expect(calls).toHaveLength(2);
  });

  it('não pede a foto em português: uma consulta só', async () => {
    const { calls } = mockFetch((url) => (url.includes('/carta/') ? { body: { cards: [product({ img_pt: 'https://img.mypcards.com/a.jpg' })] } } : undefined));
    const { queue } = load();
    await queue.consultMypNow(keysFor('Charizard'));
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
});

describe('janela de 9 consultas em 60 s', () => {
  const consultMany = async (queue: Queue, from: number, count: number) => {
    const out = [];
    for (let i = from; i < from + count; i++) out.push(await queue.consultMypNow(keysFor(`Carta${i}`)));
    return out;
  };

  it('não espera enquanto tiver vaga', async () => {
    const { calls } = fetchFound();
    const { queue } = load();
    const results = await consultMany(queue, 0, 9);
    expect(results.every((r) => 'price' in r)).toBe(true);
    expect(calls).toHaveLength(9);
  });

  it('a décima consulta na janela não sai e diz quanto falta', async () => {
    const { calls } = fetchFound();
    const { queue } = load();
    await consultMany(queue, 0, 9);
    now += 15_000;
    expect(await queue.consultMypNow(keysFor('Carta9'))).toEqual({ limitedForMs: 45_000, by: 'app' });
    expect(calls).toHaveLength(9);
  });

  it('abre vaga quando a consulta mais antiga sai da janela', async () => {
    fetchFound();
    const { queue } = load();
    await consultMany(queue, 0, 9);
    now += 60_000;
    expect('price' in (await queue.consultMypNow(keysFor('Carta9')))).toBe(true);
  });

  it('a janela soma fila e Consulta: a fila espera a vaga que a Consulta usou', async () => {
    fetchFound();
    const { queue } = load();
    await consultMany(queue, 0, 9);
    const r = runner(queue);
    await r.group('Fila');
    expect(r.pauses).toEqual([60_000]);
  });

  it('a fila, no ritmo dela, também gasta a janela da Consulta', async () => {
    const { calls } = fetchFound();
    const { queue } = load();
    const r = runner(queue);
    for (let i = 0; i < 5; i++) await r.group(`Fila${i}`);
    expect(r.pauses).toEqual([6500, 6500, 6500, 6500]);
    await consultMany(queue, 0, 4);
    const myp = calls.filter((c) => c.url.includes('/carta/'));
    expect(myp).toHaveLength(9);
    expect(await queue.consultMypNow(keysFor('Agora'))).toEqual({ limitedForMs: 60_000 - 26_000, by: 'app' });
  });
});

/** Fila de verdade, com a espera andando no relógio de mentira. */
function runner(queue: Queue) {
  const pauses: number[] = [];
  const run: MypRunner = {
    pause: async (ms) => {
      pauses.push(ms);
      now += ms;
    },
    apply: async () => {},
    current: () => undefined,
  };
  const fails: MypFailures = new Map();
  return {
    pauses,
    run,
    fails,
    group: (name: string) => queue.runMypGroup([{ ...entry({ id: name, cardName: name, lang: 'en', localId: '4', setId: 'base1', setTotal: 102 }), cardId: 'base1-4' }], run, fails),
  };
}

describe('holdMypQueue', () => {
  it('fila espera enquanto segurada e volta quando soltam', async () => {
    const { calls } = fetchFound();
    const { queue } = load();
    const release = queue.holdMypQueue();
    const r = runner(queue);
    r.run.pause = async (ms) => {
      r.pauses.push(ms);
      now += ms;
      if (r.pauses.length === 5) release();
    };
    await r.group('Charizard');
    expect(r.pauses).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(calls.filter((c) => c.url.includes('/carta/'))).toHaveLength(1);
  });

  it('fila segurada confere de novo se ainda pode consultar a cada espera (a tarefa em segundo plano tem prazo)', async () => {
    fetchFound();
    const { queue } = load();
    queue.holdMypQueue();
    const r = runner(queue);
    let checks = 0;
    r.run.beforeCall = () => {
      checks += 1;
      if (checks === 3) throw new queue.MypRunStopped();
    };
    expect(await r.group('Charizard')).toBe('stopped');
    expect(checks).toBe(3);
    expect(r.pauses).toEqual([1000, 1000]);
  });

  it('a Consulta continua consultando com a fila segurada', async () => {
    const { calls } = fetchFound();
    const { queue } = load();
    queue.holdMypQueue();
    expect('price' in (await queue.consultMypNow(keysFor('Charizard')))).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('soltar duas vezes conta uma só', async () => {
    fetchFound();
    const { queue } = load();
    const a = queue.holdMypQueue();
    const b = queue.holdMypQueue();
    a();
    a();
    const r = runner(queue);
    r.run.pause = async (ms) => {
      r.pauses.push(ms);
      now += ms;
      if (r.pauses.length === 2) b();
    };
    await r.group('Charizard');
    // Com um "a" contando duas vezes, a fila não teria esperado.
    expect(r.pauses).toEqual([1000, 1000]);
  });
});

describe('429', () => {
  let blocked = true;
  beforeEach(() => {
    blocked = true;
  });
  const limited = () =>
    mockFetch((url) => {
      if (!url.includes('mypcards.com')) return setsRoute(url);
      return blocked ? { status: 429, body: {} } : { body: { cards: [product({ name_en: byName(url) })] } };
    });

  it('a Consulta avisa a pausa de 65 s', async () => {
    limited();
    const { queue } = load();
    expect(await queue.consultMypNow(keysFor('Charizard'))).toEqual({ limitedForMs: 65_000, by: 'myp' });
  });

  it('durante a pausa nada sai, nem a Consulta', async () => {
    const { calls } = limited();
    const { queue } = load();
    await queue.consultMypNow(keysFor('Charizard'));
    now += 5_000;
    expect(await queue.consultMypNow(keysFor('Outra'))).toEqual({ limitedForMs: 60_000, by: 'myp' });
    expect(calls).toHaveLength(1);
  });

  it('a pausa vale também para a fila', async () => {
    limited();
    const { queue } = load();
    await queue.consultMypNow(keysFor('Charizard'));
    blocked = false;
    const r = runner(queue);
    await r.group('Outra');
    expect(r.pauses).toEqual([65_000]);
  });

  it('um 429 na fila vale para a Consulta', async () => {
    limited();
    const { queue } = load();
    const r = runner(queue);
    expect(await r.group('Charizard')).toBe('rateLimited');
    expect(await queue.consultMypNow(keysFor('Outra'))).toEqual({ limitedForMs: 65_000, by: 'myp' });
  });

  it('nunca tenta contornar: uma consulta por chamada', async () => {
    const { calls } = limited();
    const { queue } = load();
    await queue.consultMypNow(keysFor('Charizard', { names: ['Charizard', 'Charizard PT'] }));
    expect(calls).toHaveLength(1);
  });
});

describe('403: o MYP recusou', () => {
  const BLOCK_KEY = 'myp:blocked-at';
  type Storage = { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<unknown> };
  /** Fila nova (app reaberto) com o armazenamento do aparelho que ela usa. */
  function loadWithStorage() {
    let queue!: Queue;
    let storage!: Storage;
    jest.isolateModules(() => {
      storage = jest.requireMock('@react-native-async-storage/async-storage');
      queue = jest.requireActual('@/lib/myp-queue');
    });
    return { queue, storage };
  }
  const refused = () => mockFetch((url) => (url.includes('mypcards.com') ? { status: 403, body: {} } : setsRoute(url)));
  const mypCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.includes('mypcards.com'));
  const waiting = () => ({ x: { ...entry({ id: 'x', lang: 'en' }), cardId: 'base1-5' } });

  it('a fila para no app inteiro: nenhuma outra consulta sai, nem a da Consulta, e a carta não conta como falha', async () => {
    const { calls } = refused();
    const { queue } = load();
    expect(queue.nextMypGroup(waiting(), now, new Set(), new Map())).toBeDefined();
    const r = runner(queue);
    expect(await r.group('Charizard')).toBe('blocked');
    expect(r.fails.size).toBe(0);
    expect(mypCalls(calls)).toHaveLength(1);
    // Fila vazia (nem a carta aberta na tela passa), outra carta não consulta, a Consulta também não.
    expect(queue.nextMypGroup(waiting(), now, new Set(['x']), new Map())).toBeUndefined();
    now += 60 * 60_000;
    expect(await r.group('Outra')).toBe('blocked');
    expect(await queue.consultMypNow(keysFor('Outra'))).toEqual({ blocked: true });
    expect(mypCalls(calls)).toHaveLength(1);
    expect(queue.mypBlockedUntil(now)).toBe(T0 + queue.MYP_BLOCK_MS);
  });

  it('pelo código do produto, o 403 não vira "não encontrada": para tudo, sem tentar o outro código', async () => {
    const { calls } = mockFetch((url) => (url.includes('/precos/') ? { status: 403, body: {} } : { body: { cards: [] } }));
    const { queue } = load();
    expect(await queue.consultMypNow(keysFor('Charizard'))).toEqual({ blocked: true });
    expect(urls(calls).filter((u) => u.includes('/precos/'))).toHaveLength(1);
  });

  it('a recusa fica guardada no aparelho: vale depois de reabrir o app e acaba em 24 h', async () => {
    const { calls } = refused();
    const first = loadWithStorage();
    expect(await first.queue.consultMypNow(keysFor('Charizard'))).toEqual({ blocked: true });
    const saved = await first.storage.getItem(BLOCK_KEY);
    expect(saved).toBe(new Date(T0).toISOString());
    // App reaberto (módulo novo, sem nada na memória), com a marca no aparelho.
    const again = loadWithStorage();
    await again.storage.setItem(BLOCK_KEY, saved!);
    now += 23 * 60 * 60_000;
    expect(await again.queue.consultMypNow(keysFor('Outra'))).toEqual({ blocked: true });
    expect(again.queue.nextMypGroup(waiting(), now, new Set(), new Map())).toBeUndefined();
    expect(mypCalls(calls)).toHaveLength(1);
    // Passadas as 24 h, uma consulta sai (recusada de novo, tudo para de novo).
    now += 60 * 60_000;
    expect(again.queue.mypBlockedUntil(now)).toBe(0);
    expect(await again.queue.consultMypNow(keysFor('Outra'))).toEqual({ blocked: true });
    expect(mypCalls(calls)).toHaveLength(2);
  });

  it('"Tentar de novo" libera a próxima consulta e apaga a marca do aparelho', async () => {
    let refuse = true;
    const { calls } = mockFetch((url) =>
      url.includes('mypcards.com') ? (refuse ? { status: 403, body: {} } : { body: { cards: [product({ name_en: byName(url) })] } }) : setsRoute(url),
    );
    const { queue, storage } = loadWithStorage();
    await queue.consultMypNow(keysFor('Charizard'));
    refuse = false;
    queue.clearMypBlock();
    expect(await storage.getItem(BLOCK_KEY)).toBeNull();
    expect('price' in (await queue.consultMypNow(keysFor('Outra')))).toBe(true);
    expect(mypCalls(calls)).toHaveLength(2);
  });
});

describe('fetchMypPrice sem mudar o comportamento', () => {
  const consultFrom = (results: Record<string, MypProduct[]>) => jest.fn(async (name: string) => results[name] ?? []);
  const tcgdexRoute = (url: string) => {
    if (url.includes('/en/cards/')) return { body: { name: 'Charizard', set: { cardCount: { official: 102 } } } };
    if (url.includes('/en/sets/')) return { body: { abbreviation: { official: 'BS' } } };
    return undefined;
  };

  it('procura pelo nome inglês e devolve os campos de sempre', async () => {
    mockFetch(tcgdexRoute);
    const { api } = load();
    const e = entry({ cardId: 'base1-4', cardName: 'Charizard', setId: 'base1', localId: '4', setTotal: 102, lang: 'en' });
    const consult = consultFrom({ Charizard: [product()] });
    const price = await api.fetchMypPrice(e, consult);
    expect(consult).toHaveBeenCalledWith('Charizard');
    expect(price).toMatchObject({ cardId: 'base1-4', variant: 'normal', productId: 77, code: 'pokemon_bs_004/102', min: 480, avg: 600, max: 700, qty: 12, v: api.MYP_MATCHER });
    expect(price.notFound).toBeUndefined();
    expect(price.imagePt).toBeUndefined();
  });

  it('link do produto fora do site do MYP não vai para o botão "MYP Cards"', async () => {
    mockFetch(tcgdexRoute);
    const { api } = load();
    const e = entry({ cardId: 'base1-4', cardName: 'Charizard', setId: 'base1', localId: '4', setTotal: 102, lang: 'en' });
    const price = await api.fetchMypPrice(e, consultFrom({ Charizard: [product({ link: 'https://outro-site.example/produto/77' })] }));
    expect(price.avg).toBe(600);
    expect(price.url).toBeUndefined();
  });

  it('carta em português consulta também a foto em português', async () => {
    const { calls } = mockFetch((url) => (url.startsWith('https://img.') ? { status: 200 } : tcgdexRoute(url)));
    const { api } = load();
    const e = entry({ cardId: 'base1-4', cardName: 'Charizard', setId: 'base1', localId: '4', setTotal: 102 });
    const price = await api.fetchMypPrice(e, consultFrom({ Charizard: [product({ img_pt: 'https://img.mypcards.com/a.jpg' })] }));
    expect(price.imagePt).toBe('https://img.mypcards.com/a.jpg');
    expect(calls.filter((c) => c.method === 'HEAD')).toHaveLength(1);
  });

  it('coleção sem sigla responde a mensagem de sempre', async () => {
    mockFetch((url) => (url.includes('/en/sets/') ? { body: {} } : tcgdexRoute(url)));
    const { api } = load();
    const price = await api.fetchMypPrice(entry({ cardId: 'xx1-4', setId: 'xx1', localId: '4' }), consultFrom({}));
    expect(price.notFound).toBe('coleção sem sigla para buscar no MYP');
  });

  it('sem achar pelo nome, procura pelo código nas duas formas do total', async () => {
    mockFetch(tcgdexRoute);
    const { api } = load();
    const e = entry({ cardId: 'base1-4', cardName: 'Charizard', setId: 'base1', localId: '4', setTotal: 64, lang: 'en' });
    const consultCode = jest.fn(async (_code: string) => [] as MypProduct[]);
    const price = await api.fetchMypPrice(e, consultFrom({}), consultCode);
    expect(consultCode.mock.calls.map((c) => c[0])).toEqual(['pokemon_bs_004/064', 'pokemon_bs_004/64']);
    expect(price.notFound).toContain('não encontrada no MYP');
  });

  it('a carta comum ainda consulta a TCGdex: quem não consulta é a Consulta', async () => {
    const { calls } = mockFetch(tcgdexRoute);
    const { api } = load();
    await api.fetchMypPrice(entry({ cardId: 'base1-4', setId: 'base1', localId: '4', lang: 'en' }), consultFrom({ Pikachu: [] }));
    expect(urls(calls).some((u) => u.includes('api.tcgdex.net'))).toBe(true);
  });

  it('as nomes variantes continuam', () => {
    const { api } = load();
    expect(api.nameVariants('Alakazam EX')).toEqual(['Alakazam EX', 'Alakazam-EX']);
    expect(api.nameVariants('Nidoran♀')).toEqual(['Nidoran♀', 'Nidoran Fêmea']);
  });

  it('as siglas da coleção não mudam', () => {
    const { api } = load();
    expect(api.editionsFor('30th-c', 'XXX')).toEqual({ abbrs: ['30CC'], guessed: false });
    expect(api.editionsFor('sv03', 'OBF')).toEqual({ abbrs: ['OBF'], guessed: false });
    expect(api.editionsFor('swshp', null)).toEqual({ abbrs: ['PR-SW', 'SWSHP', 'PRSW'], guessed: true });
    expect(api.editionsFor('xx1', null)).toEqual({ abbrs: [], guessed: false });
  });
});

describe('mypKeysFor: chaves só do índice', () => {
  function keysOf(card: LookupCard, h: LookupHeader = header()) {
    let mod!: typeof import('@/lib/lookup-myp');
    jest.isolateModules(() => {
      mod = jest.requireActual('@/lib/lookup-myp');
    });
    return mod.mypKeysFor(card, h);
  }

  it('monta tudo com o que o índice já tem', () => {
    expect(keysOf(lookupCard({ ptName: 'Charizard PT' }))).toEqual({
      names: ['Charizard', 'Charizard PT'],
      abbrs: ['BS'],
      guessed: false,
      localId: '4',
      total: 102,
      byName: false,
      promoSet: false,
      numberKnown: true,
      cardId: 'base1-4',
      variant: 'normal',
      note: '',
    });
  });

  it('sigla do grupo entra depois da oficial', () => {
    expect(keysOf(lookupCard({ tcgdexId: 'sv03-125', set: lookupSet({ abbr: 'SV03' }) })).abbrs).toEqual(['OBF', 'SV03']);
  });

  it('carta só do catálogo: o produto e a sigla do grupo', () => {
    expect(keysOf(lookupCard({ tcgdexId: undefined, set: lookupSet({ abbr: 'MCAP' }), number: '004/102' }))).toMatchObject({ cardId: 'tcgp-42382', abbrs: ['MCAP'], localId: '004', total: 102 });
  });

  it('promo pela coleção', () => {
    expect(keysOf(lookupCard({ tcgdexId: undefined, set: lookupSet({ name: 'SM Black Star Promos', abbr: 'SMP' }), number: 'SM01' }))).toMatchObject({ promoSet: true });
    expect(keysOf(lookupCard({ tcgdexId: 'svp-027', number: '027', set: lookupSet({ abbr: 'SVP' }) }), header({ td: { svp: 'SVP' } }))).toMatchObject({ promoSet: true, localId: '027', abbrs: ['SVP'] });
  });

  it('coleção clássica: o número da carta original, com total', () => {
    expect(keysOf(lookupCard({ tcgdexId: '30th-c-018', number: '94/102', name: 'Gengar' }))).toMatchObject({ abbrs: ['30CC', 'BS'], byName: true, localId: '94', total: 102 });
  });

  it('total do número; sem ele, o da coleção', () => {
    expect(keysOf(lookupCard({ number: 'TG05/TG30' })).total).toBe(102);
  });

  it('selo vira versão e nota, quando importa', () => {
    expect(keysOf(lookupCard({ stamp: 'Staff' }))).toMatchObject({ variant: 'staff', note: 'Staff' });
    expect(keysOf(lookupCard({ stamp: 'Pokemon Center Exclusive' }))).toMatchObject({ variant: 'wPromo', note: 'Pokemon Center Exclusive' });
    expect(keysOf(lookupCard({ stamp: 'Cosmos Holo' }))).toMatchObject({ variant: 'holo', note: '' });
  });

  it('nenhuma chamada à TCGdex nem ao banco, até no código das coleções clássicas', async () => {
    const { calls } = mockFetch((url) => (url.includes('/precos/') ? { status: 404 } : { body: { cards: [] } }));
    const { queue } = load();
    await queue.consultMypNow(keysOf(lookupCard({ tcgdexId: '30th-c-018', number: '94/102', name: 'Gengar' })));
    expect(urls(calls).length).toBeGreaterThan(0);
    for (const url of urls(calls)) expect(url).toMatch(/^https:\/\/mypcards\.com\/api\/v1\/pokemon\//);
    const codes = urls(calls)
      .filter((u) => u.includes('/precos/'))
      .map((u) => atob(decodeURIComponent(u.split('/precos/')[1])));
    expect(codes).toContain('pokemon_30cc_094/102');
  });
});
