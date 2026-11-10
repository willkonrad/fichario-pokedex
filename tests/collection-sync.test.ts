// Sincronização do store da coleção com a nuvem de mentira (tests/fake-cloud.ts): troca de conta no mesmo aparelho,
// abertura sem internet com o token vencido, remoções no meio de uma busca, cartas sem data e o que fica gravado no
// aparelho. Cada teste começa com o app "aberto do zero" (módulos e armazenamento novos) e o relógio de mentira.
import type { Entry } from '@/lib/types';

import { AUTH_STORAGE_KEY, makeSession, type Cloud } from './fake-cloud';
import { AT, binder, entry, LATER, settings } from './fixtures';

jest.mock('@/lib/supabase', () => jest.requireActual('./fake-cloud').cloudModule());

type Store = typeof import('@/store/collection');
type Storage = { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void>; getAllKeys: () => Promise<string[]> };

let stops: (() => void)[] = [];

/** App novo: módulos (store, nuvem e armazenamento) recarregados. `seed` grava no aparelho antes de abrir o app. */
async function boot(seed: Record<string, unknown> = {}) {
  jest.resetModules();
  const as = jest.requireMock('@react-native-async-storage/async-storage') as Storage & { default?: Storage };
  const storage: Storage = as.default ?? as;
  for (const [k, v] of Object.entries(seed)) await storage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  const cloud = (jest.requireMock('@/lib/supabase') as { cloud: Cloud }).cloud;
  const col = jest.requireActual('@/store/collection') as Store;
  return { cloud, col, storage, start: () => stops.push(col.startCollection()) };
}

/** Avança o relógio de mentira até a condição valer (os timers e as promessas do store rodam no caminho). */
async function until(cond: () => boolean, ms = 20_000) {
  for (let t = 0; t <= ms; t += 50) {
    if (cond()) return;
    await jest.advanceTimersByTimeAsync(50);
  }
  throw new Error('a condição não aconteceu');
}

const input = (e: Entry): Omit<Entry, 'id' | 'updatedAt'> => {
  const { id: _id, updatedAt: _u, ...rest } = e;
  return rest;
};
const cardData = (cloud: Cloud, uid: string) => cloud.rows(uid).map((r) => r.data as Entry);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-09T12:00:00.000Z'));
});

afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  jest.useRealTimers();
});

describe('troca de conta no mesmo aparelho', () => {
  it('outra conta que entra não recebe a coleção da anterior, e ela volta inteira quando a anterior entra de novo', async () => {
    const { cloud, col, start } = await boot();
    const s = () => col.collectionState();
    const act = col.collectionActions;
    // B já tem uma carta no mesmo bolso (editada antes da de A) e o fichário Pokédex dela.
    cloud.seed('B', { entries: [entry({ notes: 'de B', updatedAt: AT })], settings: settings({ updatedAt: AT }) });
    cloud.uid = 'A';
    cloud.session = makeSession('A');
    start();
    await until(() => !!s().lastSyncAt);

    await act.saveSettings(settings({ rows: 4 }));
    await act.saveBinder(binder({ id: 'a1', name: 'Fichário de A' }));
    await act.saveEntry(input(entry({ notes: 'de A', purchasePrice: 50 })));
    await until(() => cardData(cloud, 'A').length === 1 && s().syncStatus.pending === 0);

    // Uma alteração que não chega à nuvem: o aviso de "Sair da conta" diz que ela ficou guardada aqui.
    cloud.offline = true;
    await act.saveEntry(input(entry({ id: '1-0', dex: 1, cardId: 'sv03.5-001', cardName: 'Bulbasaur', notes: 'sem enviar' })));
    const warning = await act.prepareSignOut();
    expect(warning).toMatch(/^1 alteração ainda não foi para a nuvem/);
    cloud.offline = false;
    cloud.signOut();
    await until(() => !s().session);
    // Sem conta, a coleção de A continua aqui.
    expect(Object.keys(s().entries).sort()).toEqual(['1-0', '25-0']);

    cloud.signIn('B');
    await until(() => s().session?.user.id === 'B' && !!s().lastSyncAt && s().ready);
    expect(Object.values(s().entries)).toEqual([expect.objectContaining({ id: '25-0', notes: 'de B' })]);
    expect(s().settings?.extras ?? []).toEqual([]);
    expect(s().settings?.rows).toBe(settings().rows);
    // Nada de A foi para a nuvem de B (nem a carta, nem o fichário, nem a remoção).
    expect(cardData(cloud, 'B')).toEqual([expect.objectContaining({ id: '25-0', notes: 'de B' })]);
    expect((cloud.rows('B', 'binder_settings')[0].data as { extras?: unknown[] }).extras ?? []).toEqual([]);

    cloud.signOut();
    await until(() => !s().session);
    cloud.signIn('A');
    await until(() => s().session?.user.id === 'A' && !!s().lastSyncAt && s().ready && s().syncStatus.pending === 0);
    expect(s().entries['25-0']).toMatchObject({ notes: 'de A', purchasePrice: 50 });
    expect(s().entries['1-0']).toMatchObject({ notes: 'sem enviar' });
    expect(s().settings?.extras?.map((b) => b.id)).toEqual(['a1']);
    // A alteração que tinha ficado na fila de A foi para a nuvem de A, e nada de B entrou em A.
    expect(cardData(cloud, 'A').map((e) => e.notes).sort()).toEqual(['de A', 'sem enviar']);
    expect(cardData(cloud, 'B')).toHaveLength(1);
  });

  it('aparelho usado sem conta: ao entrar, a coleção daqui vai para a conta', async () => {
    const { cloud, col, start } = await boot();
    start();
    await until(() => col.collectionState().ready);
    await col.collectionActions.saveEntry(input(entry({ notes: 'feita sem conta' })));
    cloud.signIn('A');
    await until(() => cardData(cloud, 'A').length === 1);
    expect(cardData(cloud, 'A')[0]).toMatchObject({ notes: 'feita sem conta' });
  });

  it('o app morreu no meio da troca: a abertura seguinte termina a troca sem perder a coleção da anterior', async () => {
    const pika = entry({ notes: 'de A' });
    const { cloud, col, storage, start } = await boot({
      'binder:e:25-0': pika,
      'binder:sync': { owner: 'A', holder: 'A' },
      'binder:conta:A:e:25-0': pika,
      'binder:conta:A:estado': { settings: settings(), activeBinderId: 'pokedex', pending: {}, deleted: {}, meta: { owner: 'A', holder: 'A' } },
      'binder:troca': { from: 'A', to: 'B' },
    });
    start();
    await until(() => col.collectionState().ready);
    expect(col.collectionState().entries).toEqual({});
    const keys = await storage.getAllKeys();
    expect(keys).not.toContain('binder:e:25-0');
    expect(keys).not.toContain('binder:troca');
    expect(JSON.parse((await storage.getItem('binder:sync')) ?? '{}')).toEqual({ holder: 'B' });

    cloud.signIn('A');
    await until(() => col.collectionState().session?.user.id === 'A' && !!col.collectionState().entries['25-0']);
    expect(col.collectionState().entries['25-0']).toMatchObject({ notes: 'de A' });
  });
});

describe('abertura sem internet com o token vencido', () => {
  const expired = () => makeSession('A', -600);
  const offlineRefresh = () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Network request failed', status: 0 } });

  it('a conta continua aberta e "sem conexão", sem buscar nada com a chave pública; o token renovado sincroniza', async () => {
    const { cloud, col, start } = await boot({
      [AUTH_STORAGE_KEY]: expired(),
      'binder:sync': { owner: 'A', holder: 'A', lastSyncAt: AT },
      'binder:e:25-0': entry({ notes: 'aqui' }),
      'binder:pending': { '25-0': LATER },
    });
    cloud.getSession = offlineRefresh;
    start();
    cloud.emit('INITIAL_SESSION', null);
    await until(() => col.collectionState().syncStatus.state === 'offline');
    expect(col.collectionState().session?.user.id).toBe('A');
    expect(col.collectionState().session?.user.email).toBe('a@exemplo.com');
    expect(cloud.calls).toEqual([]);

    // Voltou a internet: o supabase-js renova o token.
    const fresh = makeSession('A');
    cloud.getSession = null;
    cloud.session = fresh;
    cloud.uid = 'A';
    cloud.emit('TOKEN_REFRESHED', fresh);
    await until(() => col.collectionState().syncStatus.state === 'ok' && col.collectionState().syncStatus.pending === 0);
    expect(cardData(cloud, 'A')).toEqual([expect.objectContaining({ notes: 'aqui' })]);
    expect(cloud.calls.every((c) => c.uid === 'A')).toBe(true);
  });

  it('sai da conta no SIGNED_OUT ou quando não ficou sessão guardada', async () => {
    const { cloud, col, start } = await boot({ [AUTH_STORAGE_KEY]: expired() });
    cloud.getSession = offlineRefresh;
    start();
    await until(() => col.collectionState().session?.user.id === 'A');
    cloud.emit('SIGNED_OUT', null);
    await until(() => !col.collectionState().session);
    expect(col.collectionState().syncStatus.state).toBe('local');

    const fresh = await boot();
    fresh.cloud.getSession = offlineRefresh;
    fresh.start();
    fresh.cloud.emit('INITIAL_SESSION', null);
    await until(() => fresh.col.collectionState().ready);
    await jest.advanceTimersByTimeAsync(100);
    expect(fresh.col.collectionState().session).toBeNull();
  });
});

describe('remoções', () => {
  it('carta movida ou removida pouco antes de o app morrer não volta duplicada ao abrir', async () => {
    const { col, storage, start } = await boot({
      'binder:e:25-0': entry({ updatedAt: AT }),
      'binder:e:26-0': entry({ id: '26-0', dex: 26, cardId: 'sv03.5-026', updatedAt: LATER }),
      'binder:deleted': { '25-0': LATER, '26-0': AT },
    });
    start();
    await until(() => col.collectionState().ready);
    // A que tem a remoção depois da última edição sai; a recolocada depois da remoção fica.
    expect(Object.keys(col.collectionState().entries)).toEqual(['26-0']);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await storage.getItem('binder:e:25-0')).toBeNull();
  });

  it('remoção enviada enquanto uma busca já estava no ar não é desfeita pela linha antiga', async () => {
    const { cloud, col, start } = await boot();
    const s = () => col.collectionState();
    cloud.seed('A', { entries: [entry()], settings: settings() });
    cloud.signIn('A');
    start();
    await until(() => !!s().lastSyncAt && !!s().entries['25-0']);

    const release = cloud.hold('entries');
    const sync = col.collectionActions.syncNow();
    await jest.advanceTimersByTimeAsync(10);
    await col.collectionActions.removeEntry('25-0');
    // A remoção vai e a nuvem confirma antes de a busca responder.
    await until(() => cloud.rows('A').length === 0 && s().syncStatus.pending === 0);
    release();
    await sync;
    expect(s().entries['25-0']).toBeUndefined();
    // A próxima sincronização traz o registro da remoção: continua fora.
    await col.collectionActions.syncNow();
    expect(s().entries['25-0']).toBeUndefined();
  });
});

describe('cópia importada', () => {
  it('carta sem data (lista feita à mão) vai para a nuvem e não trava a sincronização', async () => {
    const { cloud, col, start } = await boot();
    const s = () => col.collectionState();
    cloud.signIn('A');
    start();
    await until(() => !!s().lastSyncAt);
    const r = await col.collectionActions.importCollection('[{"dex":25,"slot":0,"cardId":"base1-58","lang":"en"}]');
    expect(r).toMatchObject({ added: 1 });
    await until(() => cardData(cloud, 'A').length === 1);
    expect(Number.isNaN(Date.parse(String(cloud.rows('A')[0].updated_at)))).toBe(false);
    await expect(col.collectionActions.syncNow()).resolves.toEqual(expect.objectContaining({ sent: 0 }));
    expect(s().syncStatus).toMatchObject({ state: 'ok', pending: 0 });
  });

  it('carta sem data de uma cópia com data fica com a data da cópia', async () => {
    const { col, start } = await boot();
    start();
    await until(() => col.collectionState().ready);
    await col.collectionActions.importCollection({ exportedAt: LATER, entries: [{ dex: 25, slot: 0, cardId: 'base1-58', lang: 'en' }] });
    expect(col.collectionState().entries['25-0']?.updatedAt).toBe(LATER);
  });
});

describe('gravação no aparelho', () => {
  it('saveCollectionNow grava na hora as cartas colocadas (o lote da câmera só sai depois disso)', async () => {
    const { col, storage, start } = await boot();
    start();
    await until(() => col.collectionState().ready);
    const ids = await col.collectionActions.saveEntries([input(entry())]);
    expect(ids).toEqual(['25-0']);
    // Sem avançar o relógio: a gravação agrupada (400 ms) ainda não teria saído.
    await col.saveCollectionNow();
    expect(JSON.parse((await storage.getItem('binder:e:25-0')) ?? 'null')).toMatchObject({ cardId: 'sv03.5-025' });
  });

  it('saveEntriesNow confirma as cartas gravadas no aparelho', async () => {
    const { col, storage, start } = await boot();
    start();
    await until(() => col.collectionState().ready);
    const ids = await col.collectionActions.saveEntries([input(entry())]);
    await expect(col.saveEntriesNow(ids)).resolves.toBeUndefined();
    expect(JSON.parse((await storage.getItem('binder:e:25-0')) ?? 'null')).toMatchObject({ cardId: 'sv03.5-025' });
  });

  it('armazenamento cheio (mesmo depois de liberar o cache): saveEntriesNow rejeita, e saveCollectionNow não avisa', async () => {
    const { col, storage, start } = await boot();
    start();
    await until(() => col.collectionState().ready);
    const full = jest.mocked((storage as unknown as { multiSet: (pairs: [string, string][]) => Promise<void> }).multiSet);
    const real = full.getMockImplementation()!;
    full.mockRejectedValue(new Error('QuotaExceededError'));
    const ids = await col.collectionActions.saveEntries([input(entry())]);
    // O lote da câmera esperava por esta gravação e saía do aparelho com as cartas só na memória.
    await expect(col.saveCollectionNow()).resolves.toBeUndefined();
    await expect(col.saveEntriesNow(ids)).rejects.toThrow(col.NOT_ON_DEVICE);
    expect(await storage.getItem('binder:e:25-0')).toBeNull();
    expect(col.collectionState().syncStatus.message).toMatch(/armazenamento do aparelho está cheio/);
    // Com espaço de novo, a mesma chamada confirma.
    full.mockImplementation(real);
    await expect(col.saveEntriesNow(ids)).resolves.toBeUndefined();
    expect(JSON.parse((await storage.getItem('binder:e:25-0')) ?? 'null')).toMatchObject({ cardId: 'sv03.5-025' });
  });

  it('coleção salva que não pôde ser lida (nada é gravado por cima): saveEntriesNow rejeita', async () => {
    const { col, storage, start } = await boot({ 'binder:e:1-0': entry({ id: '1-0', dex: 1, cardId: 'sv03.5-001', cardName: 'Bulbasaur' }) });
    jest.mocked(storage.getAllKeys).mockRejectedValueOnce(new Error('leitura falhou'));
    start();
    await until(() => col.collectionState().ready);
    const ids = await col.collectionActions.saveEntries([input(entry())]);
    await expect(col.saveEntriesNow(ids)).rejects.toThrow(col.NOT_ON_DEVICE);
    expect(await storage.getItem('binder:e:25-0')).toBeNull();
  });
});

describe('carta salva por uma versão anterior do app', () => {
  // Mirror japonês salvo quando o produto não tinha selo (o marcador estava no nome): ver tests/ja-mirror-saved.test.ts.
  const oldMirror = entry({ id: '0-0', dex: 0, lang: 'ja', cardId: 'tcgp-602601', cardName: "Larry's Efficiency (Mirror Foil)", variant: 'holo', updatedAt: AT });

  it('vem do aparelho já como a versão de hoje e é regravada assim, com a mesma data (sem ir para a nuvem como mudança)', async () => {
    const { col, storage, start } = await boot({ 'binder:e:0-0': oldMirror });
    start();
    await until(() => col.collectionState().ready);
    expect(col.collectionState().entries['0-0']).toMatchObject({ variant: 'reverse', variantNote: 'Mirror Foil', cardName: "Larry's Efficiency", updatedAt: AT });
    expect(col.collectionState().syncStatus.pending).toBe(0);
    await col.saveCollectionNow();
    expect(JSON.parse((await storage.getItem('binder:e:0-0')) ?? 'null')).toMatchObject({ variant: 'reverse', variantNote: 'Mirror Foil' });
  });

  it('vem da nuvem já convertida e não volta para a fila de envio', async () => {
    const { cloud, col, start } = await boot();
    cloud.seed('A', { entries: [oldMirror] });
    cloud.uid = 'A';
    cloud.session = makeSession('A');
    start();
    await until(() => !!col.collectionState().lastSyncAt);
    expect(col.collectionState().entries['0-0']).toMatchObject({ variant: 'reverse', variantNote: 'Mirror Foil', updatedAt: AT });
    expect(col.collectionState().syncStatus.pending).toBe(0);
  });
});

describe('carta com Pokémon ou bolso inválido', () => {
  it('saveEntry e saveEntries recusam NaN, negativo e fracionado, sem gravar nada', async () => {
    const { col, start } = await boot();
    start();
    await until(() => col.collectionState().ready);
    const act = col.collectionActions;
    await expect(act.saveEntry(input(entry({ dex: Number.NaN })))).rejects.toThrow('Pokémon inválido.');
    await expect(act.saveEntry(input(entry({ slot: Number.NaN })))).rejects.toThrow('Bolso inválido.');
    await expect(act.saveEntry(input(entry({ slot: -1 })))).rejects.toThrow('Bolso inválido.');
    await expect(act.saveEntries([input(entry({ slot: 1 })), input(entry({ dex: 1.5 }))])).rejects.toThrow('Pokémon inválido.');
    expect(Object.keys(col.collectionState().entries)).toEqual([]);
    await act.saveEntry(input(entry()));
    expect(Object.keys(col.collectionState().entries)).toEqual(['25-0']);
  });
});
