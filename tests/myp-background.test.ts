// Tarefa de segundo plano do MYP (src/components/myp-background.ts) num processo novo, com a nuvem de mentira: sem carta
// na fila, não sincroniza; com carta na fila, a sincronização é a incremental (a completa fica para quando a pessoa
// abrir o app), e só depois a busca no MYP começa.
import type { Entry } from '@/lib/types';

import { makeSession, type Cloud } from './fake-cloud';
import { entry, myp } from './fixtures';

jest.mock('@/lib/supabase', () => jest.requireActual('./fake-cloud').cloudModule());
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isAvailableAsync: jest.fn(async () => true) }));
jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => {}),
}));
// A busca no MYP em si não roda aqui (seria a rede): o teste só confere se ela começa, e com qual grupo.
jest.mock('@/lib/myp-queue', () => ({ ...jest.requireActual('@/lib/myp-queue'), runMypGroup: jest.fn(async () => 'stopped') }));

type Storage = { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void> };

const NOW = '2026-11-09T12:00:00.000Z';
const hourAgo = '2026-11-09T11:00:00.000Z';
const meta = { owner: 'A', holder: 'A', cursor: '2026-11-05T00:00:00.000Z', lastSyncAt: hourAgo, lastFullAt: hourAgo };

/** Processo novo aberto pelo Android só para a tarefa (sem tela), com a conta A aberta e o aparelho em dia com ela. */
async function boot(card: Entry) {
  jest.resetModules();
  const as = jest.requireMock('@react-native-async-storage/async-storage') as Storage & { default?: Storage };
  const storage: Storage = as.default ?? as;
  await storage.setItem(`binder:e:${card.id}`, JSON.stringify(card));
  await storage.setItem('binder:sync', JSON.stringify(meta));
  const cloud = (jest.requireMock('@/lib/supabase') as { cloud: Cloud }).cloud;
  cloud.seed('A', { entries: [card] });
  cloud.uid = 'A';
  cloud.session = makeSession('A');
  const { AppState } = jest.requireActual('react-native') as typeof import('react-native');
  Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true });
  jest.requireActual('@/components/myp-background');
  const defineTask = (jest.requireMock('expo-task-manager') as { defineTask: jest.Mock }).defineTask;
  const task = defineTask.mock.calls.at(-1)?.[1] as () => Promise<number>;
  const runMypGroup = (jest.requireMock('@/lib/myp-queue') as { runMypGroup: jest.Mock }).runMypGroup;
  const col = jest.requireActual('@/store/collection') as typeof import('@/store/collection');
  return { cloud, storage, task, runMypGroup, col };
}

/** Roda a tarefa até o fim, avançando o relógio de mentira. */
async function run(task: () => Promise<number>) {
  let result: number | undefined;
  void task().then((r) => (result = r));
  for (let t = 0; t <= 120_000 && result === undefined; t += 50) await jest.advanceTimersByTimeAsync(50);
  return result;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
});

afterEach(() => jest.useRealTimers());

it('sem carta deste aparelho na fila do MYP, termina sem sincronizar com a nuvem', async () => {
  const fresh = entry({ mypApi: myp(entry(), { checkedAt: hourAgo }) });
  const { cloud, task, runMypGroup, col } = await boot(fresh);
  expect(await run(task)).toBe(1);
  // A tarefa rodou (a coleção do aparelho foi lida), mas nada foi pedido à nuvem.
  expect(col.collectionState().ready).toBe(true);
  expect(cloud.calls).toEqual([]);
  expect(runMypGroup).not.toHaveBeenCalled();
});

it('com carta na fila, sincroniza pela incremental (sem baixar a coleção inteira) e então busca no MYP', async () => {
  const due = entry();
  const { cloud, storage, task, runMypGroup } = await boot(due);
  expect(await run(task)).toBe(1);
  expect(cloud.calls.filter((c) => c.table === 'entries' && c.op === 'select')).toHaveLength(1);
  expect(JSON.parse((await storage.getItem('binder:sync')) ?? '{}')).toMatchObject({ lastFullAt: hourAgo });
  expect(runMypGroup).toHaveBeenCalledTimes(1);
  expect(runMypGroup.mock.calls[0][0]).toEqual([expect.objectContaining({ id: '25-0' })]);
});
