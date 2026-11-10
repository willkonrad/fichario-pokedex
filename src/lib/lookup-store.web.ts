// Na web o índice fica no IndexedDB do navegador: recarregar a página ou abrir outra aba não baixa tudo de novo.
// Quem decide se a cópia ainda vale é o lookup-index, pelo md5 do manifesto.

const DB_NAME = 'consulta';
const STORE = 'lookup';
/** O md5 fica numa chave própria: conferir a versão não lê os ~5 MB do índice. */
const MD5_KEY = 'md5';
const BODY_KEY = 'index';

type Stored = { md5: string; body: string };

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') throw new Error('navegador sem IndexedDB');
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Outra aba com versão nova do banco, ou o navegador fechou a conexão: a próxima chamada abre de novo.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      db.onclose = () => {
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB não abriu'));
  }).catch((err: unknown) => {
    opening = null;
    throw err;
  });
  return opening;
}

/** Uma transação; resolve quando ela termina (o que foi gravado está mesmo gravado), com o resultado de cada pedido. */
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest[]): Promise<T[]> {
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const requests = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(requests.map((r) => r.result as T));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB falhou'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB cancelou a gravação'));
  });
}

/** Versão guardada, sem ler o índice. Sem IndexedDB (aba anônima, bloqueio), nada guardado. */
export async function storedMd5(): Promise<string | null> {
  try {
    const [md5] = await run<unknown>('readonly', (store) => [store.get(MD5_KEY)]);
    return typeof md5 === 'string' ? md5 : null;
  } catch {
    return null;
  }
}

export async function readStoredBody(): Promise<Stored | null> {
  try {
    const [row] = await run<Partial<Stored> | undefined>('readonly', (store) => [store.get(BODY_KEY)]);
    return typeof row?.md5 === 'string' && typeof row.body === 'string' ? { md5: row.md5, body: row.body } : null;
  } catch {
    return null;
  }
}

/** Índice e md5 na mesma transação: nunca fica o md5 de uma versão com o corpo de outra. */
export async function writeStoredBody(md5: string, body: string): Promise<void> {
  await run('readwrite', (store) => [store.put({ md5, body } satisfies Stored, BODY_KEY), store.put(md5, MD5_KEY)]);
}

export async function clearStoredBody(): Promise<void> {
  await run('readwrite', (store) => [store.clear()]);
}
