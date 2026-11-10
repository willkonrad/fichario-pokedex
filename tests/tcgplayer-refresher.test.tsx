import { act, createElement } from 'react';
import { createRoot, type Root } from 'test-renderer';

import { TcgplayerRefresher } from '@/components/tcgplayer-refresher';
import { fetchTcgplayerPrices } from '@/lib/tcgplayer';
import type { Entry, TcgplayerPrice } from '@/lib/types';

import { entry } from './fixtures';

// Busca da TCGplayer em segundo plano: carta que entra na coleção durante uma busca é buscada quando ela termina (sem
// esperar outra mudança ou as 3 horas). Store e banco de mentira.

type MockStore = { entries: Record<string, Entry>; listeners: Set<() => void> };
jest.mock('@/store/collection', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  const store: MockStore = { entries: {}, listeners: new Set() };
  const subscribe = (fn: () => void) => {
    store.listeners.add(fn);
    return () => store.listeners.delete(fn);
  };
  const applyTcgplayerPrice = jest.fn(async () => {});
  return {
    __store: store,
    useCollection: () => {
      const entries = useSyncExternalStore(subscribe, () => store.entries);
      return { ready: true, session: null, lastSyncAt: null, entries, applyTcgplayerPrice };
    },
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/tcgplayer', () => ({
  fetchTcgplayerPrices: jest.fn(),
  hasTcgplayerCards: () => true,
  latestPriceBuild: async () => 'b1',
  sameTcgplayerPrice: () => false,
  tcgplayerDue: () => true,
  tcgplayerFor: () => undefined,
  tcgplayerNote: () => '',
}));

const store = jest.requireMock<{ __store: MockStore }>('@/store/collection').__store;
const fetchPrices = jest.mocked(fetchTcgplayerPrices);

function setEntries(list: Entry[]) {
  store.entries = Object.fromEntries(list.map((e) => [e.id, e]));
  store.listeners.forEach((fn) => fn());
}

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
});

it('carta nova durante uma busca é buscada logo que ela termina', async () => {
  const a = entry({ id: 'a', lang: 'en' });
  const b = entry({ id: 'b', lang: 'en', cardId: 'sv03.5-006' });
  let finish!: (m: Map<string, TcgplayerPrice>) => void;
  fetchPrices.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve))).mockResolvedValue(new Map());
  setEntries([a]);
  root = createRoot();
  await act(async () => root!.render(createElement(TcgplayerRefresher)));
  expect(fetchPrices).toHaveBeenCalledTimes(1);

  // Entra uma carta enquanto a primeira busca está no ar.
  await act(async () => setEntries([a, b]));
  expect(fetchPrices).toHaveBeenCalledTimes(1);

  await act(async () => finish(new Map()));
  expect(fetchPrices).toHaveBeenCalledTimes(2);
  expect(fetchPrices.mock.calls[1][0].map((e) => e.id)).toEqual(['a', 'b']);
});
