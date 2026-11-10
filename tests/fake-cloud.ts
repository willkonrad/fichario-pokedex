// Nuvem de mentira para os testes do store da coleção: o módulo '@/lib/supabase' inteiro, com a conta (sessão, eventos,
// sessão guardada), as tabelas entries, binder_settings e entry_tombstones em memória (RLS por conta, updated_at do
// servidor e registro de remoções) e a função delete_entries. Uso: jest.mock('@/lib/supabase', () =>
// jest.requireActual('./fake-cloud').cloudModule()). Nenhum teste acessa a rede.

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };
type AuthListener = (event: string, session: FakeSession | null) => void;

export type FakeSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
};

/** Chave onde o supabase-js de mentira "guarda" a sessão (o store lê de lá a sessão com o token vencido). */
export const AUTH_STORAGE_KEY = 'sb-teste-auth-token';

const NETWORK_ERROR = { message: 'TypeError: Network request failed' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function makeSession(uid: string, expiresInS = 3600): FakeSession {
  return {
    access_token: `token-${uid}`,
    refresh_token: `refresh-${uid}`,
    expires_at: Math.floor(Date.now() / 1000) + expiresInS,
    user: { id: uid, email: `${uid.toLowerCase()}@exemplo.com` },
  };
}

export function createCloud() {
  const tables: Record<string, Row[]> = { entries: [], binder_settings: [], entry_tombstones: [] };
  let clock = Date.parse('2026-11-01T00:00:00.000Z');
  const serverNow = () => new Date((clock += 1000)).toISOString();
  const listeners = new Set<AuthListener>();
  const holds = new Map<string, Promise<void>>();

  const cloud = {
    tables,
    /** Conta do token que vai em cada chamada (null: só a chave pública, como sem sessão válida). */
    uid: null as string | null,
    /** Sessão que getSession devolve. */
    session: null as FakeSession | null,
    /** Troca o que getSession devolve (ex.: renovação do token que falha sem internet). */
    getSession: null as null | (() => Result),
    offline: false,
    /** Chamadas às tabelas (tabela e operação), para conferir o que foi pedido. */
    calls: [] as { table: string; op: string; uid: string | null }[],

    rows(uid: string, table = 'entries') {
      return tables[table].filter((r) => r.user_id === uid);
    },
    /** Linhas já na nuvem de uma conta (cartas: o id e a carta; configuração: { settings }). */
    seed(uid: string, data: { entries?: { id: string; dex: number; slot: number }[]; settings?: object }) {
      for (const e of data.entries ?? []) tables.entries.push({ user_id: uid, id: e.id, dex: e.dex, slot: e.slot, data: clone(e), updated_at: serverNow() });
      if (data.settings) tables.binder_settings.push({ user_id: uid, data: clone(data.settings), updated_at: serverNow() });
    },
    emit(event: string, session: FakeSession | null) {
      for (const fn of listeners) fn(event, session);
    },
    signIn(uid: string) {
      cloud.uid = uid;
      cloud.session = makeSession(uid);
      cloud.emit('SIGNED_IN', cloud.session);
    },
    signOut() {
      cloud.uid = null;
      cloud.session = null;
      cloud.emit('SIGNED_OUT', null);
    },
    /** A próxima leitura da tabela guarda o resultado de agora e só responde quando `release` for chamada. */
    hold(table: string) {
      let release!: () => void;
      holds.set(table, new Promise<void>((r) => (release = r)));
      return () => {
        holds.delete(table);
        release();
      };
    },
  };

  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'upsert' | 'delete' = 'select';
    let payload: Row[] = [];
    let single = false;
    let range: [number, number] | null = null;
    const run = async (): Promise<Result> => {
      cloud.calls.push({ table, op, uid: cloud.uid });
      if (cloud.offline) return { data: null, error: NETWORK_ERROR };
      const uid = cloud.uid;
      // RLS: cada conta só vê e grava as próprias linhas; sem conta, nada.
      const mine = (r: Row) => uid !== null && r.user_id === uid && filters.every((f) => f(r));
      if (op === 'select') {
        let rows = clone(tables[table].filter(mine));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        const hold = holds.get(table);
        if (hold) await hold;
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      }
      if (op === 'delete') {
        for (const r of tables[table].filter(mine)) remove(r);
        return { data: null, error: null };
      }
      for (const r of payload) {
        if (uid === null || r.user_id !== uid) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
        // A coluna é timestamptz: texto que não é data falha antes do gatilho do servidor.
        if ('updated_at' in r && Number.isNaN(Date.parse(String(r.updated_at)))) {
          return { data: null, error: { code: '22007', message: `invalid input syntax for type timestamp with time zone: "${String(r.updated_at)}"` } };
        }
      }
      for (const r of payload) {
        const same = (x: Row) => x.user_id === r.user_id && (table === 'binder_settings' || x.id === r.id);
        const at = tables[table].findIndex(same);
        const row = { ...clone(r), updated_at: serverNow() };
        if (at >= 0) tables[table][at] = row;
        else {
          tables[table].push(row);
          if (table === 'entries') tables.entry_tombstones = tables.entry_tombstones.filter((t) => !(t.user_id === r.user_id && t.id === r.id));
        }
      }
      return { data: null, error: null };
    };
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return q;
      },
      gt: (col: string, v: string) => {
        filters.push((r) => String(r[col]) > v);
        return q;
      },
      in: (col: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[col]));
        return q;
      },
      not: () => q,
      order: () => q,
      limit: () => q,
      range: (a: number, b: number) => {
        range = [a, b];
        return q;
      },
      maybeSingle: () => {
        single = true;
        return q;
      },
      upsert: (rows: Row | Row[]) => {
        op = 'upsert';
        payload = Array.isArray(rows) ? rows : [rows];
        return q;
      },
      delete: () => {
        op = 'delete';
        return q;
      },
      then: (ok: (r: Result) => unknown, fail?: (e: unknown) => unknown) => run().then(ok, fail),
    };
    return q;
  }

  function remove(r: Row) {
    tables.entries = tables.entries.filter((x) => x !== r);
    tables.entry_tombstones = tables.entry_tombstones.filter((t) => !(t.user_id === r.user_id && t.id === r.id));
    tables.entry_tombstones.push({ user_id: r.user_id, id: r.id, deleted_at: serverNow() });
  }

  async function rpc(name: string, args: Record<string, unknown>): Promise<Result> {
    cloud.calls.push({ table: `rpc:${name}`, op: 'rpc', uid: cloud.uid });
    if (cloud.offline) return { data: null, error: NETWORK_ERROR };
    if (name !== 'delete_entries') return { data: null, error: null };
    const uid = cloud.uid;
    const gone: string[] = [];
    for (const [id, removedAt] of Object.entries((args.p ?? {}) as Record<string, string>)) {
      const r = tables.entries.find((x) => uid !== null && x.user_id === uid && x.id === id);
      if (!r || String((r.data as { updatedAt?: string }).updatedAt ?? '') > removedAt) continue;
      remove(r);
      gone.push(id);
    }
    return { data: gone, error: null };
  }

  const supabase = {
    from,
    rpc,
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      getSession: async () => (cloud.getSession ? cloud.getSession() : { data: { session: cloud.session }, error: null }),
      onAuthStateChange: (fn: AuthListener) => {
        listeners.add(fn);
        return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
      },
    },
  };
  return { cloud, supabase };
}

export type Cloud = ReturnType<typeof createCloud>['cloud'];

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
const isNetworkError = (err: unknown) => /network ?request failed|failed to fetch|timed? ?out|aborted/i.test(errorText(err));

/** O módulo '@/lib/supabase' com a nuvem de mentira (`cloud` controla a conta e as tabelas). */
export function cloudModule() {
  const { cloud, supabase } = createCloud();
  return {
    cloud,
    supabase,
    PAGE_SIZE: 1000,
    fetchAllPages: async <T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) => {
      const out: T[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await page(from, from + 999);
        if (error) throw error;
        out.push(...(data ?? []));
        if ((data ?? []).length < 1000) return out;
      }
    },
    errorText,
    isNetworkError,
    isMissingInServer: () => false,
    describeSyncError: (err: unknown) =>
      isNetworkError(err) ? { kind: 'offline' as const, message: 'Sem conexão com a nuvem.' } : { kind: 'error' as const, message: errorText(err) },
  };
}
