import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'test-renderer';

import { MypRefresher } from '@/components/myp-refresher';
import { nextMypGroup, runMypGroup, type MypStep } from '@/lib/myp-queue';

import { entry } from './fixtures';

// Busca do MYP com o app aberto: sem internet, a fila não anda e a tela volta a apagar sozinha; ela fica acesa de novo
// só depois de uma consulta que deu certo. Fila e store de mentira, relógio de mentira.

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(async () => {}),
}));
jest.mock('@/components/myp-background', () => ({ registerMypBackground: jest.fn(async () => {}) }));
jest.mock('@/lib/myp-queue', () => ({
  MypRunStopped: class extends Error {},
  nextMypGroup: jest.fn(),
  runMypGroup: jest.fn(),
}));
jest.mock('@/lib/myp-api', () => ({ MYP_API_INTERVAL_MS: 6500, mypPriority: () => new Set(), onMypPriority: () => {} }));
jest.mock('@/store/collection', () => {
  const entries = { a: jest.requireActual('./fixtures').entry({ id: 'a' }) };
  const applyMypPrice = jest.fn(async () => {});
  return { useCollection: () => ({ ready: true, session: null, lastSyncAt: null, entries, applyMypPrice }) };
});

const awake = jest.mocked(activateKeepAwakeAsync);
const asleep = jest.mocked(deactivateKeepAwake);

let root: Root | null = null;
beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  jest.useRealTimers();
});

it('sem internet a tela apaga e só fica acesa de novo depois de uma consulta que deu certo', async () => {
  const steps: MypStep[] = ['offline', 'offline', 'offline', 'done', 'done'];
  jest.mocked(nextMypGroup).mockReturnValue([entry({ id: 'a' })]);
  jest.mocked(runMypGroup).mockImplementation(async () => steps.shift() ?? 'stopped');
  root = createRoot();
  await act(async () => root!.render(createElement(MypRefresher)));
  // Primeira carta: acende; falhou sem internet: apaga.
  expect(awake).toHaveBeenCalledTimes(1);
  expect(asleep).toHaveBeenCalledTimes(1);
  // As outras falhas sem internet (a 6,5 s cada) não acendem de novo.
  await act(async () => jest.advanceTimersByTimeAsync(2 * 6500));
  expect(awake).toHaveBeenCalledTimes(1);
  // Uma consulta deu certo: a próxima carta acende de novo.
  await act(async () => jest.advanceTimersByTimeAsync(6500));
  expect(awake).toHaveBeenCalledTimes(2);
});
