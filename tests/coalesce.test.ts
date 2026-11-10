import { coalesce, onlyPricesChanged } from '@/lib/coalesce';
import type { Entry } from '@/lib/types';

import { entry, myp, tcg } from './fixtures';

// Rodada de preços na home: cada preço gravado refazia as contas da coleção inteira (23 ms por gravação com 3.000
// cartas). As gravações só de preço entram juntas, no máximo uma vez por janela; o resto passa na hora.

type Entries = Record<string, Entry>;

function fakeStore(initial: Entries) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(next: Entries) {
      state = next;
      listeners.forEach((l) => l());
    },
  };
}

const pika = entry();
const eevee = entry({ id: '133-0', dex: 133, cardId: 'sv03.5-133', cardName: 'Eevee', localId: '133' });

describe('onlyPricesChanged', () => {
  it('aceita o que a busca de preço grava: preço das fontes, "Meu valor" trocado e a data', () => {
    const before = { [pika.id]: pika, [eevee.id]: eevee };
    const after = {
      ...before,
      [pika.id]: { ...pika, tcgplayer: tcg(pika), mypApi: myp(pika), myValue: null, myValueReplaced: { value: 5, mypValue: 10, at: 'x' }, updatedAt: 'y' },
    };
    expect(onlyPricesChanged(before, after)).toBe(true);
  });

  it('recusa carta nova, removida ou trocada de bolso', () => {
    const before = { [pika.id]: pika };
    expect(onlyPricesChanged(before, { ...before, [eevee.id]: eevee })).toBe(false);
    expect(onlyPricesChanged(before, {})).toBe(false);
    expect(onlyPricesChanged(before, { [eevee.id]: eevee })).toBe(false);
  });

  it('recusa a troca de lugar de duas cópias da mesma carta em versões diferentes (o bolso muda de cara)', () => {
    const a = entry({ id: 'b1:0', binderId: 'b1', slot: 0, variant: 'normal' });
    const b = entry({ id: 'b1:1', binderId: 'b1', slot: 1, variant: 'reverse' });
    const before = { [a.id]: a, [b.id]: b };
    const after = { [a.id]: { ...a, variant: b.variant }, [b.id]: { ...b, variant: a.variant } };
    expect(onlyPricesChanged(before, after)).toBe(false);
  });

  it('recusa a troca de imagem e de "Usar na soma"', () => {
    const before = { [pika.id]: pika };
    expect(onlyPricesChanged(before, { [pika.id]: { ...pika, image: 'https://x/y' } })).toBe(false);
    expect(onlyPricesChanged(before, { [pika.id]: { ...pika, valueBasis: 'min' } })).toBe(false);
  });

  it('a lista que volta do banco como objeto novo, com o mesmo conteúdo, não conta como mudança', () => {
    const stamped = entry({ stampKeys: ['set-logo'] });
    const before = { [stamped.id]: stamped };
    expect(onlyPricesChanged(before, { [stamped.id]: { ...stamped, stampKeys: ['set-logo'], tcgplayer: tcg(stamped) } })).toBe(true);
  });
});

describe('coalesce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('uma rodada de 3.000 preços avisa a home uma vez por janela, não 3.000', () => {
    const many: Entries = {};
    for (let i = 0; i < 3000; i++) many[`${i}-0`] = entry({ id: `${i}-0`, dex: i, cardId: `c-${i}` });
    const store = fakeStore(many);
    const shown = coalesce(store, onlyPricesChanged, 1000);
    const seen = jest.fn();
    shown.subscribe(seen);
    for (let i = 0; i < 3000; i++) {
      const id = `${i}-0`;
      store.set({ ...store.get(), [id]: { ...store.get()[id], tcgplayer: tcg(store.get()[id]) } });
      if (i % 100 === 99) jest.advanceTimersByTime(100);
    }
    jest.advanceTimersByTime(1000);
    expect(seen.mock.calls.length).toBeLessThanOrEqual(4);
    expect(shown.getSnapshot()).toBe(store.get());
  });

  it('o preço espera a janela e chega no fim dela', () => {
    const store = fakeStore({ [pika.id]: pika });
    const shown = coalesce(store, onlyPricesChanged, 1000);
    const seen = jest.fn();
    shown.subscribe(seen);
    const first = shown.getSnapshot();
    store.set({ [pika.id]: { ...pika, tcgplayer: tcg(pika) } });
    expect(seen).not.toHaveBeenCalled();
    expect(shown.getSnapshot()).toBe(first);
    jest.advanceTimersByTime(1000);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(shown.getSnapshot()[pika.id].tcgplayer).toEqual(tcg(pika));
  });

  it('carta nova passa na hora e leva junto o preço que esperava', () => {
    const store = fakeStore({ [pika.id]: pika });
    const shown = coalesce(store, onlyPricesChanged, 1000);
    const seen = jest.fn();
    shown.subscribe(seen);
    store.set({ [pika.id]: { ...pika, tcgplayer: tcg(pika) } });
    store.set({ ...store.get(), [eevee.id]: eevee });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(shown.getSnapshot()).toBe(store.get());
    jest.advanceTimersByTime(1000);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('sem ninguém ouvindo, vale a coleção de agora', () => {
    const store = fakeStore({ [pika.id]: pika });
    const shown = coalesce(store, onlyPricesChanged, 1000);
    const stop = shown.subscribe(() => {});
    store.set({ [pika.id]: { ...pika, tcgplayer: tcg(pika) } });
    stop();
    expect(shown.getSnapshot()).toBe(store.get());
  });
});
