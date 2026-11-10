// Chamadas às fontes de fora do Supabase (TCGdex, Zukan, pokemontcg.io, GitHub, MYP Cards) com tempo máximo.

/** Tempo máximo padrão de uma chamada, da conexão até o fim da leitura da resposta. */
export const FETCH_TIMEOUT_MS = 20_000;

/** Erro de tempo esgotado: é falha da fonte (vale a cópia guardada, a lista fica incompleta), não cancelamento. */
export class FetchTimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Tempo esgotado (${Math.round(ms / 1000)} s): ${url}`);
    this.name = 'FetchTimeoutError';
  }
}

const abortError = () => Object.assign(new Error('Busca cancelada'), { name: 'AbortError' });

export type TimedInit = RequestInit & {
  /** Tempo máximo desta chamada (padrão FETCH_TIMEOUT_MS). */
  timeoutMs?: number;
};

/**
 * fetch com tempo máximo que vale até o fim de `read` (onde se lê o corpo: `res.json()`, `res.text()`…). No celular o
 * fetch global (expo/fetch, sobre o OkHttp) não tem limite: uma conexão que fica muda depois de conectar deixaria a
 * promessa parada para sempre (e quem espera a mesma busca junto, também). Passado o tempo, a chamada é cancelada e a
 * promessa falha com FetchTimeoutError, mesmo que o corpo nunca termine de chegar. O cancelamento de quem chamou
 * (`signal`) falha na hora, como AbortError.
 */
export function timedFetch<T>(url: string, read: (res: Response) => Promise<T> | T, init: TimedInit = {}): Promise<T> {
  const { timeoutMs = FETCH_TIMEOUT_MS, signal: outer, ...rest } = init;
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
      settle();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new FetchTimeoutError(url, timeoutMs)));
      controller.abort();
    }, timeoutMs);
    const onAbort = () => {
      finish(() => reject(abortError()));
      controller.abort();
    };
    if (outer?.aborted) return onAbort();
    outer?.addEventListener('abort', onAbort);
    Promise.resolve()
      .then(() => fetch(url, { ...rest, signal: controller.signal }))
      .then(read)
      .then(
        (value) => finish(() => resolve(value)),
        (e) => finish(() => reject(e)),
      );
  });
}
