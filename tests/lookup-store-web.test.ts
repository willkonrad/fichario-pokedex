// Índice da Consulta na web: guardado no IndexedDB, sobrevive a recarregar a página; md5 e corpo andam juntos.

type Store = typeof import('@/lib/lookup-store.web');

class FakeRequest {
  result: unknown;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}

/** IndexedDB de mentira: um banco, um store, transações que só gravam ao terminar (ou nada, se falharem). */
function fakeIndexedDB() {
  const data = new Map<string, unknown>();
  const reads: string[] = [];
  const state = { created: false, failWrites: false };
  const db = {
    objectStoreNames: { contains: () => state.created },
    createObjectStore: () => {
      state.created = true;
    },
    close: () => {},
    onversionchange: null as null | (() => void),
    onclose: null as null | (() => void),
    transaction: (_name: string, mode: 'readonly' | 'readwrite') => {
      const steps: (() => void)[] = [];
      const ask = (step: (r: FakeRequest) => void) => {
        const r = new FakeRequest();
        steps.push(() => step(r));
        return r;
      };
      const tx = {
        error: null as Error | null,
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        objectStore: () => ({
          get: (key: string) =>
            ask((r) => {
              reads.push(key);
              r.result = structuredClone(data.get(key));
            }),
          put: (value: unknown, key: string) => ask(() => data.set(key, structuredClone(value))),
          clear: () => ask(() => data.clear()),
        }),
      };
      setTimeout(() => {
        if (mode === 'readwrite' && state.failWrites) {
          tx.error = new Error('QuotaExceededError');
          tx.onabort?.();
          return;
        }
        steps.forEach((step) => step());
        tx.oncomplete?.();
      }, 0);
      return tx;
    },
  };
  const api = {
    open: () => {
      const req = new FakeRequest();
      setTimeout(() => {
        req.result = db;
        if (!state.created) req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  return { api, data, reads, state };
}

const g = globalThis as { indexedDB?: unknown };
let fake: ReturnType<typeof fakeIndexedDB>;

/** Módulo novo, como numa página recarregada: só o que está no IndexedDB continua. */
function load(): Store {
  let mod!: Store;
  jest.isolateModules(() => {
    mod = jest.requireActual('@/lib/lookup-store.web');
  });
  return mod;
}

beforeEach(() => {
  fake = fakeIndexedDB();
  g.indexedDB = fake.api;
});
afterAll(() => {
  delete g.indexedDB;
});

describe('lookup-store na web', () => {
  it('sem nada guardado', async () => {
    const store = load();
    expect(await store.storedMd5()).toBeNull();
    expect(await store.readStoredBody()).toBeNull();
  });

  it('grava e lê; conferir a versão não lê o índice', async () => {
    const store = load();
    await store.writeStoredBody('abc', 'corpo');
    fake.reads.length = 0;
    expect(await store.storedMd5()).toBe('abc');
    expect(fake.reads).toEqual(['md5']);
    expect(await store.readStoredBody()).toEqual({ md5: 'abc', body: 'corpo' });
  });

  it('recarregar a página mantém o índice', async () => {
    await load().writeStoredBody('abc', 'corpo');
    const reloaded = load();
    expect(await reloaded.storedMd5()).toBe('abc');
    expect(await reloaded.readStoredBody()).toEqual({ md5: 'abc', body: 'corpo' });
  });

  it('versão nova troca a antiga', async () => {
    const store = load();
    await store.writeStoredBody('velho', 'um');
    await store.writeStoredBody('novo', 'dois');
    expect(await store.readStoredBody()).toEqual({ md5: 'novo', body: 'dois' });
    expect(await store.storedMd5()).toBe('novo');
  });

  it('gravação que falha não deixa o md5 novo com o corpo velho', async () => {
    const store = load();
    await store.writeStoredBody('velho', 'um');
    fake.state.failWrites = true;
    await expect(store.writeStoredBody('novo', 'dois')).rejects.toThrow('QuotaExceededError');
    expect(await store.storedMd5()).toBe('velho');
    expect(await store.readStoredBody()).toEqual({ md5: 'velho', body: 'um' });
  });

  it('limpar apaga tudo e pode ser chamado sem nada guardado', async () => {
    const store = load();
    await store.clearStoredBody();
    await store.writeStoredBody('abc', 'corpo');
    await store.clearStoredBody();
    expect(await store.readStoredBody()).toBeNull();
    expect(await store.storedMd5()).toBeNull();
  });

  it('registro estranho no banco não vira índice', async () => {
    const store = load();
    await store.writeStoredBody('abc', 'corpo');
    fake.data.set('index', { md5: 'abc' });
    expect(await store.readStoredBody()).toBeNull();
  });

  it('sem IndexedDB (aba anônima, bloqueio): nada guardado, e gravar avisa o erro', async () => {
    delete g.indexedDB;
    const store = load();
    expect(await store.storedMd5()).toBeNull();
    expect(await store.readStoredBody()).toBeNull();
    await expect(store.writeStoredBody('abc', 'corpo')).rejects.toThrow();
    // Volta a funcionar quando o IndexedDB aparece: a falha não fica guardada.
    g.indexedDB = fake.api;
    await store.writeStoredBody('abc', 'corpo');
    expect(await store.storedMd5()).toBe('abc');
  });
});
