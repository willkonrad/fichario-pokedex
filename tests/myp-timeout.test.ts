// Tempo máximo das chamadas da busca no MYP (API do MYP e sigla da coleção na TCGdex): uma conexão que fica muda não
// prende a fila do MYP nem a Consulta de cartas. Sem rede: o fetch nunca responde (ou para no meio da leitura).
import type { MypKeys } from '@/lib/lookup-types';

type Api = typeof import('@/lib/myp-api');
type Queue = typeof import('@/lib/myp-queue');

const never = () => new Promise<never>(() => {});
const stalled = { ok: true, status: 200, json: never } as unknown as Response;

/** Módulos novos a cada teste (o ritmo e as buscas guardadas da fila ficam no módulo). */
function load() {
  let api!: Api;
  let queue!: Queue;
  jest.isolateModules(() => {
    api = jest.requireActual('@/lib/myp-api');
    queue = jest.requireActual('@/lib/myp-queue');
  });
  return { api, queue };
}

const keys: MypKeys = {
  names: ['Charizard'],
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
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('busca no MYP com tempo máximo', () => {
  it('busca pelo nome sem resposta falha em 15 s como tempo esgotado', async () => {
    const { api } = load();
    jest.spyOn(globalThis, 'fetch').mockImplementation(never);
    const p = api.searchMypByName('Charizard');
    const failed = expect(p).rejects.toMatchObject({ name: 'FetchTimeoutError' });
    await jest.advanceTimersByTimeAsync(api.MYP_FETCH_TIMEOUT_MS);
    await failed;
  });

  it('resposta que para no meio da leitura também (busca pelo código)', async () => {
    const { api } = load();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(stalled);
    const p = api.searchMypByCode('pokemon_bs_004/102');
    const failed = expect(p).rejects.toMatchObject({ name: 'FetchTimeoutError' });
    await jest.advanceTimersByTimeAsync(api.MYP_FETCH_TIMEOUT_MS);
    await failed;
  });

  it('a Consulta de cartas recebe "sem internet" em vez de ficar carregando para sempre', async () => {
    const { api, queue } = load();
    jest.spyOn(globalThis, 'fetch').mockImplementation(never);
    const p = queue.consultMypNow(keys);
    await jest.advanceTimersByTimeAsync(api.MYP_FETCH_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ offline: true });
  });
});
