import type { MypFailures, MypRunner } from '@/lib/myp-queue';
import type { Entry, MypApiPrice } from '@/lib/types';

import { AT, entry, myp, tcg } from './fixtures';

// A rede fica de fora: a busca do preço só faz a consulta pelo nome da carta (pelo `consult` da fila).
jest.mock('@/lib/myp-api', () => ({
  ...jest.requireActual('@/lib/myp-api'),
  fetchMypPrice: jest.fn(),
  searchMypByName: jest.fn(),
  searchMypByCode: jest.fn(),
}));

type Api = typeof import('@/lib/myp-api');
type Queue = typeof import('@/lib/myp-queue');

/** Fila nova a cada teste (o ritmo e as buscas guardadas ficam no módulo). */
function load() {
  let api!: jest.Mocked<Api>;
  let queue!: Queue;
  jest.isolateModules(() => {
    api = jest.requireMock('@/lib/myp-api');
    queue = jest.requireActual('@/lib/myp-queue');
  });
  return { api, queue };
}

const T0 = new Date(AT).getTime();
const DAY = 24 * 60 * 60_000;
const byId = (...list: Entry[]) => Object.fromEntries(list.map((e) => [e.id, e]));

describe('nextMypGroup (próximas cartas da fila do MYP)', () => {
  const { queue } = load();
  const fresh = entry({ id: 'a', mypApi: myp(entry()) });

  it('não devolve nada quando todos os preços estão em dia', () => {
    expect(queue.nextMypGroup(byId(fresh), T0 + DAY, new Set(), new Map())).toBeUndefined();
  });

  it('a nunca buscada vem antes da busca mais antiga, com todas as cópias da mesma carta', () => {
    const old = entry({ id: 'old', mypApi: myp(entry()) });
    const neverPt = entry({ id: 'n1', cardId: 'sv03.5-006', cardName: 'Charizard' });
    const neverEn = entry({ id: 'n2', cardId: 'sv03.5-006', cardName: 'Charizard', lang: 'en' });
    const other = entry({ id: 'x', cardId: 'sv03.5-006', variant: 'reverse' });
    const group = queue.nextMypGroup(byId(old, neverPt, neverEn, other), T0 + 8 * DAY, new Set(), new Map());
    expect(group?.map((e) => e.id).sort()).toEqual(['n1', 'n2']);
  });

  it('carta aberta na tela passa na frente e tenta de novo sem esperar a pausa da falha', () => {
    const never = entry({ id: 'n', cardId: 'sv03.5-006' });
    const urgent = entry({ id: 'u', cardId: 'sv03.5-004' });
    const fails: MypFailures = new Map([[queue.mypGroupKey(urgent), { count: 1, until: T0 + DAY }]]);
    expect(queue.nextMypGroup(byId(never, urgent), T0, new Set(['u']), fails)?.[0].id).toBe('u');
    // Sem pedir a vez, espera a pausa.
    expect(queue.nextMypGroup(byId(urgent), T0, new Set(), fails)).toBeUndefined();
    // Depois de 3 falhas, só na próxima abertura do app, mesmo aberta na tela.
    fails.set(queue.mypGroupKey(urgent), { count: 3, until: 0 });
    expect(queue.nextMypGroup(byId(urgent), T0 + 2 * DAY, new Set(['u']), fails)).toBeUndefined();
  });

  it('carta em inglês com preço da TCGplayer vai depois das que dependem do MYP', () => {
    const en = entry({ id: 'en', lang: 'en', cardId: 'sv08-057' });
    const withTcg = { ...en, tcgplayer: tcg(en) };
    const old = entry({ id: 'old', mypApi: myp(entry()) });
    expect(queue.nextMypGroup(byId(withTcg, old), T0 + 8 * DAY, new Set(), new Map())?.[0].id).toBe('old');
  });
});

describe('runMypGroup (busca e grava o preço de um grupo)', () => {
  let now = T0;
  beforeEach(() => {
    now = T0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  /** Busca de mentira: consulta pelo nome e devolve um preço achado. */
  function setup() {
    const { api, queue } = load();
    api.fetchMypPrice.mockImplementation(async (e, consult) => {
      await consult(e.cardName ?? '');
      return myp(e, { checkedAt: new Date(now).toISOString() });
    });
    api.searchMypByName.mockResolvedValue([]);
    const saved: Record<string, MypApiPrice> = {};
    const pauses: number[] = [];
    const fails: MypFailures = new Map();
    const run: MypRunner = {
      pause: async (ms) => {
        pauses.push(ms);
        now += ms;
      },
      apply: async (id, price) => {
        saved[id] = price;
      },
      current: (id) => (saved[id] ? entry({ id, mypApi: saved[id] }) : undefined),
    };
    return { api, queue, saved, pauses, fails, run };
  }

  it('grava o preço em todas as cópias e espera 6,5 s entre consultas', async () => {
    const { api, queue, saved, pauses, fails, run } = setup();
    const pt = entry({ id: 'pt' });
    const en = entry({ id: 'en', lang: 'en' });
    expect(await queue.runMypGroup([pt, en], run, fails)).toBe('done');
    expect(Object.keys(saved).sort()).toEqual(['en', 'pt']);
    expect(await queue.runMypGroup([entry({ id: 'c', cardName: 'Charizard' })], run, fails)).toBe('done');
    expect(api.searchMypByName).toHaveBeenCalledTimes(2);
    expect(pauses).toEqual([api.MYP_API_INTERVAL_MS]);
    expect(fails.size).toBe(0);
  });

  it('a busca pelo mesmo nome fica guardada e não gasta outra consulta', async () => {
    const { api, queue, fails, run } = setup();
    await queue.runMypGroup([entry({ id: 'a' })], run, fails);
    await queue.runMypGroup([entry({ id: 'b', variant: 'reverse' })], run, fails);
    expect(api.searchMypByName).toHaveBeenCalledTimes(1);
  });

  it('depois de um 429, a próxima consulta espera mais de um minuto', async () => {
    const { api, queue, pauses, fails, run } = setup();
    api.searchMypByName.mockRejectedValueOnce(new api.MypRateLimited('MYP 429'));
    expect(await queue.runMypGroup([entry({ id: 'a' })], run, fails)).toBe('rateLimited');
    expect(fails.size).toBe(0);
    await queue.runMypGroup([entry({ id: 'a' })], run, fails);
    expect(pauses).toEqual([65_000]);
  });

  it('parar antes da consulta não conta como falha', async () => {
    const { api, queue, fails, run } = setup();
    const stopped = { ...run, beforeCall: () => { throw new queue.MypRunStopped(); } };
    expect(await queue.runMypGroup([entry({ id: 'a' })], stopped, fails)).toBe('stopped');
    expect(api.searchMypByName).not.toHaveBeenCalled();
    expect(fails.size).toBe(0);
  });

  it('erro na busca: a carta espera 1 h', async () => {
    const { api, queue, fails, run } = setup();
    api.searchMypByName.mockRejectedValueOnce(new Error('sem internet'));
    expect(await queue.runMypGroup([entry({ id: 'a' })], run, fails)).toBe('failed');
    expect(fails.get(queue.mypGroupKey(entry()))).toEqual({ count: 1, until: T0 + 60 * 60_000 });
  });

  it('chamada que passou do tempo: avisa "offline" (a tela pode apagar) e a carta espera 1 h como numa falha', async () => {
    const { api, queue, fails, run } = setup();
    api.searchMypByName.mockRejectedValueOnce(Object.assign(new Error('Tempo esgotado (15 s)'), { name: 'FetchTimeoutError' }));
    expect(await queue.runMypGroup([entry({ id: 'a' })], run, fails)).toBe('offline');
    expect(fails.get(queue.mypGroupKey(entry()))).toEqual({ count: 1, until: T0 + 60 * 60_000 });
  });
});
