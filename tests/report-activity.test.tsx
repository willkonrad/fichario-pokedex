import { act, createElement } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import { ActivitySections, detailsOf, useActivity, type ActivityState } from '@/components/report-activity';
import { clearActivityCache, loadActivity, type ActivityItem, type ActivityResult, type CardSummary } from '@/lib/activity';

import { entry, settings } from './fixtures';

// Atividade da tela Relatórios: releitura quando a fila de envio esvazia (C0) e miniaturas fora do leitor de tela (C2).

/** Store de mentira: só a contagem de alterações esperando a nuvem. Criado no mock: o componente já assina o store ao ser importado. */
type MockStore = { pending: number; listeners: Set<() => void> };
jest.mock('@/store/collection', () => {
  const store: MockStore = { pending: 0, listeners: new Set() };
  return {
    __store: store,
    collectionState: () => ({ syncStatus: { state: 'ok', pending: store.pending } }),
    subscribeCollection: (fn: () => void) => {
      store.listeners.add(fn);
      return () => {
        store.listeners.delete(fn);
      };
    },
  };
});
const mockStore = jest.requireMock<{ __store: MockStore }>('@/store/collection').__store;
/** A assinatura feita na importação do componente (vale com Relatórios fechada). */
const moduleListeners = [...mockStore.listeners];
jest.mock('@/lib/activity', () => ({
  ...jest.requireActual('@/lib/activity'),
  loadActivity: jest.fn(),
  clearActivityCache: jest.fn(),
}));
// Ícones sem a fonte (o jest não tem o registro de assets).
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }));
// A miniatura vira um elemento simples (sem expo-image), para achar onde ela fica na árvore.
jest.mock('@/components/card-image', () => ({
  CardImage: (props: object) => jest.requireActual('react').createElement('CardImage', props),
}));

const load = jest.mocked(loadActivity);
const clear = jest.mocked(clearActivityCache);

function setPending(n: number) {
  mockStore.pending = n;
  mockStore.listeners.forEach((fn) => fn());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const AT = '2026-11-05T15:00:00.000Z';
const card = (over: Partial<CardSummary> = {}): CardSummary => ({ cardId: 'sv03.5-025', cardName: 'Pikachu', dex: 25, slot: 0, ...over });
const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'i1',
  kind: 'added',
  at: AT,
  dayOnly: false,
  source: 'app',
  entryId: '25-0',
  card: card(),
  ...over,
});
const ok = (items: ActivityItem[]): ActivityResult => ({ state: 'ok', items, since: '2026-10-06T15:00:00.000Z' });
const ids = (s: ActivityState) => (s.status === 'ok' ? s.items.map((i) => i.id) : s.status);

/** Mostra o estado do hook como prop de um elemento simples (lido com stateOf). */
function Probe({ userId, days }: { userId?: string; days: number }) {
  const state = useActivity(userId, days);
  return createElement('ActivityProbe', { state });
}
const stateOf = (root: Root) => (root.container.children[0] as TestInstance).props.state as ActivityState;

/** Raízes abertas: desmontadas depois de cada teste, mesmo quando ele falha (o relógio de 60 s prenderia o jest). */
const roots: Root[] = [];
function mount() {
  const root = createRoot();
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

beforeEach(() => {
  load.mockReset();
  clear.mockReset();
  mockStore.pending = 0;
  mockStore.listeners.clear();
});

describe('useActivity: releitura depois do envio', () => {
  it('quando a fila esvazia, esquece o cache e relê, com as linhas de antes na tela até a nova leitura chegar', async () => {
    const first = deferred<ActivityResult>();
    load.mockReturnValueOnce(first.promise);
    const root = mount();
    await act(async () => root.render(<Probe userId="u1" days={30} />));
    expect(stateOf(root).status).toBe('loading');
    await act(async () => first.resolve(ok([item({ id: 'a' })])));
    expect(ids(stateOf(root))).toEqual(['a']);
    expect(load).toHaveBeenCalledTimes(1);

    // A carta removida daqui entra na fila: nada é relido enquanto a nuvem não confirma.
    await act(async () => setPending(1));
    await act(async () => setPending(2));
    expect(load).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();

    const second = deferred<ActivityResult>();
    load.mockReturnValueOnce(second.promise);
    await act(async () => setPending(0));
    expect(clear).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith({ days: 30, force: false });
    // Sem "Carregando…" nem esqueleto: as linhas de antes continuam.
    expect(ids(stateOf(root))).toEqual(['a']);
    await act(async () => second.resolve(ok([item({ id: 'b', kind: 'removed' }), item({ id: 'a' })])));
    expect(ids(stateOf(root))).toEqual(['b', 'a']);

    // Outras mudanças do store com a fila vazia não releem.
    await act(async () => setPending(0));
    expect(load).toHaveBeenCalledTimes(2);

    // Ao sair da tela, para de ouvir o store.
    roots.splice(roots.indexOf(root), 1);
    await act(async () => root.unmount());
    expect(mockStore.listeners.size).toBe(0);
  });

  it('sem conta, não ouve a fila nem lê', async () => {
    const root = mount();
    await act(async () => root.render(<Probe days={30} />));
    expect(stateOf(root).status).toBe('signedOut');
    await act(async () => setPending(1));
    await act(async () => setPending(0));
    expect(load).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('"Tentar de novo" continua mostrando o carregando (e lê com force)', async () => {
    load.mockRejectedValueOnce(new Error('falhou'));
    const root = mount();
    await act(async () => root.render(<Probe userId="u1" days={7} />));
    expect(stateOf(root).status).toBe('error');
    const again = deferred<ActivityResult>();
    load.mockReturnValueOnce(again.promise);
    await act(async () => stateOf(root).retry());
    expect(stateOf(root).status).toBe('loading');
    expect(load).toHaveBeenLastCalledWith({ days: 7, force: true });
    await act(async () => again.resolve(ok([])));
    expect(ids(stateOf(root))).toEqual([]);
  });
});

/** A miniatura está dentro de algo escondido do leitor de tela? */
function hiddenFromReader(node: TestInstance) {
  for (let n: TestInstance | null = node; n; n = n.parent) {
    if (n.props['aria-hidden'] === true || n.props.accessibilityElementsHidden === true || n.props.importantForAccessibility === 'no-hide-descendants') {
      return true;
    }
  }
  return false;
}

describe('ActivitySections: miniaturas fora do leitor de tela', () => {
  it('nas linhas tocáveis e nas só de leitura (removida, várias de uma vez, troca)', async () => {
    const pikachu = entry();
    const items: ActivityItem[] = [
      // Ainda no bolso: linha tocável.
      item({ id: 'added', card: card({ lang: 'pt', variant: 'normal' }) }),
      // Removida e "N cartas de uma vez": linhas só de leitura.
      item({ id: 'removed', kind: 'removed', entryId: '4-0', card: card({ cardId: 'sv03.5-004', cardName: 'Charmander', dex: 4 }) }),
      item({
        id: 'bulk',
        kind: 'bulk',
        entryId: '1-0',
        count: 30,
        card: card({ cardId: 'a', cardName: 'Bulbasaur', dex: 1 }),
        cards: [card({ cardId: 'a', cardName: 'Bulbasaur', dex: 1 }), card({ cardId: 'b', cardName: 'Ivysaur', dex: 2 }), card({ cardId: 'c', cardName: 'Venusaur', dex: 3 })],
      }),
      item({ id: 'swap', kind: 'replaced', entryId: '7-0', prev: card({ cardId: 'x', cardName: 'Squirtle', dex: 7 }), card: card({ cardId: 'y', cardName: 'Squirtle', dex: 7 }) }),
    ];
    const root = mount();
    await act(async () =>
      root.render(<ActivitySections items={items} ctx={{ entries: { [pikachu.id]: pikachu }, settings: settings(), binders: [], onOpen: () => {}, now: Date.parse(AT) }} />),
    );
    const thumbs = root.container.queryAll((n) => n.type === 'CardImage');
    // 1 (adicionada) + 1 (removida) + 3 (leque) + 2 (troca).
    expect(thumbs).toHaveLength(7);
    expect(thumbs.filter((t) => !hiddenFromReader(t))).toHaveLength(0);
  });
});

describe('número da carta na atividade (como a tela da carta)', () => {
  it('galeria com a sigla no total e promo sem o total que a TCGdex inventa', () => {
    expect(detailsOf(card({ setId: 'swsh12tg', setName: 'Silver Tempest Trainer Gallery', localId: 'TG05', setTotal: 30 }))).toBe('Silver Tempest Trainer Gallery · TG05/TG30');
    expect(detailsOf(card({ setId: 'basep', setName: 'Wizards Black Star Promos', localId: '1', setTotal: 53 }))).toBe('Wizards Black Star Promos · 1');
    expect(detailsOf(card({ setId: 'swshp', setName: 'SWSH Black Star Promos', localId: 'SWSH020', setTotal: 307 }))).toBe('SWSH Black Star Promos · SWSH020');
    // Coleção comum: o total de sempre.
    expect(detailsOf(card({ setId: 'base2', setName: 'Jungle', localId: '1', setTotal: 64, variant: 'holo' }))).toBe('Jungle · 1/64 · Holo / Foil');
  });
});

describe('cache com Relatórios fechada', () => {
  it('a assinatura da importação esquece o cache quando a fila esvazia, sem tela montada', () => {
    expect(moduleListeners).toHaveLength(1);
    mockStore.listeners.add(moduleListeners[0]);
    setPending(1);
    expect(clear).not.toHaveBeenCalled();
    setPending(0);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });
});
