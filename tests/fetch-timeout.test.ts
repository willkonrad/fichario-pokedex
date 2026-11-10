// Tempo máximo das chamadas às fontes de fora do Supabase (timedFetch): uma conexão que fica muda, antes ou durante a
// leitura da resposta, vira erro, e a busca guardada em andamento (`inflight` do cache) é liberada. Sem rede.
import { FETCH_TIMEOUT_MS, FetchTimeoutError, timedFetch } from '@/lib/fetch-timeout';
import { cardDetail } from '@/lib/tcgdex';

const never = () => new Promise<never>(() => {});
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

afterEach(() => {
  jest.useRealTimers();
});

describe('timedFetch', () => {
  it('conexão que não responde: falha com FetchTimeoutError (não como cancelamento)', async () => {
    globalThis.fetch = jest.fn(never) as unknown as typeof fetch;
    const p = timedFetch('https://api.tcgdex.net/v2/en/sets', (res) => res.json(), { timeoutMs: 20 });
    await expect(p).rejects.toBeInstanceOf(FetchTimeoutError);
    await expect(p).rejects.toMatchObject({ name: 'FetchTimeoutError' });
  });

  it('resposta que para no meio do corpo: o tempo vale até o fim de res.json()', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, json: never })) as unknown as typeof fetch;
    await expect(timedFetch('https://example.test/a.json', (res) => res.json(), { timeoutMs: 20 })).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it('cancela a requisição quando o tempo acaba', async () => {
    let signal: AbortSignal | undefined;
    globalThis.fetch = jest.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return never();
    }) as unknown as typeof fetch;
    await expect(timedFetch('https://example.test/b', (res) => res.text(), { timeoutMs: 20 })).rejects.toBeInstanceOf(FetchTimeoutError);
    expect(signal?.aborted).toBe(true);
  });

  it('cancelamento de quem chamou: AbortError na hora', async () => {
    globalThis.fetch = jest.fn(never) as unknown as typeof fetch;
    const controller = new AbortController();
    const p = timedFetch('https://example.test/c', (res) => res.json(), { signal: controller.signal, timeoutMs: 60_000 });
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('resposta a tempo: o valor de `read`', async () => {
    globalThis.fetch = jest.fn(async () => okJson({ id: 'x' })) as unknown as typeof fetch;
    await expect(timedFetch('https://example.test/d', (res) => res.json(), { timeoutMs: 20 })).resolves.toEqual({ id: 'x' });
  });
});

describe('ficha da TCGdex com a conexão muda', () => {
  it('falha depois do tempo máximo, e a próxima abertura busca de novo (não espera a promessa morta)', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn(never);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const first = cardDetail('stall-1', 'en');
    // Abrir de novo enquanto espera: a mesma busca.
    const again = cardDetail('stall-1', 'en');
    const settled = Promise.allSettled([first, again]);
    await jest.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 100);
    const [a, b] = await settled;
    expect(a).toMatchObject({ status: 'rejected', reason: expect.any(FetchTimeoutError) });
    expect(b.status).toBe('rejected');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // "Tentar de novo": nova requisição, que agora responde.
    fetchMock.mockImplementation((async () => okJson({ id: 'stall-1', localId: '1', name: 'Pikachu', set: { id: 'stall', name: 'Stall' } })) as never);
    await expect(cardDetail('stall-1', 'en')).resolves.toMatchObject({ name: 'Pikachu' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
