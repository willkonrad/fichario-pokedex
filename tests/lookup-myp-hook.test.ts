import { act, createElement } from 'react';
import { Keyboard, Platform } from 'react-native';
import { createRoot } from 'test-renderer';

import { mypPauseText } from '@/lib/copy';
import { useMypNow } from '@/lib/lookup-myp';
import type { LookupCard, LookupLang, MypNow } from '@/lib/lookup-types';
import { consultMypNow } from '@/lib/myp-queue';
import type { MypApiPrice } from '@/lib/types';

import { entry, myp } from './fixtures';
import { header, jaCard, lookupCard, print } from './lookup-fixtures';

// useMypNow (seção 8): 300 ms depois de abrir (1 s com o teclado aberto), só PT e EN, só no celular, com a pausa contada na
// tela.

jest.mock('@/lib/lookup-index', () => ({
  useLookupIndex: () => ({ status: 'ready', header: mockHeader() }),
}));
jest.mock('@/lib/myp-queue', () => ({ consultMypNow: jest.fn() }));

const stableHeader = header();
// Mesmo objeto a cada desenho: o efeito depende dele.
function mockHeader() {
  return stableHeader;
}

const consult = jest.mocked(consultMypNow);
type Result = Awaited<ReturnType<typeof consultMypNow>>;

const okPrice: MypApiPrice = myp(entry(), { min: 480, avg: 600, max: 700, qty: 12, url: 'https://mypcards.com/pokemon/produto/77' });

async function render(card: LookupCard | null, lang: LookupLang, result: Result | (() => Promise<Result>)) {
  consult.mockImplementation(typeof result === 'function' ? result : async () => result);
  const seen: MypNow[] = [];
  const Probe = ({ shown }: { shown: LookupCard | null }) => {
    seen.push(useMypNow(shown, lang));
    return null;
  };
  const root = createRoot();
  await act(async () => {
    root.render(createElement(Probe, { shown: card }));
  });
  return {
    last: () => seen[seen.length - 1],
    unmount: () => act(async () => root.unmount()),
    /** Outra carta no mesmo lugar (a carta única que muda enquanto se digita). */
    show: (next: LookupCard) =>
      act(async () => {
        root.render(createElement(Probe, { shown: next }));
      }),
  };
}

/** Teclado de mentira: aberto ou não no começo, e os avisos de abrir e fechar. */
const keyboard: { open: boolean; handlers: Map<string, () => void> } = { open: false, handlers: new Map() };
const emitKeyboard = (event: 'keyboardDidShow' | 'keyboardDidHide') =>
  act(async () => {
    keyboard.open = event === 'keyboardDidShow';
    keyboard.handlers.get(event)?.();
  });

const tick = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

const setOS = (os: string) => {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
};
const original = Platform.OS;

beforeEach(() => {
  jest.useFakeTimers();
  consult.mockReset();
  setOS('android');
  keyboard.open = false;
  keyboard.handlers.clear();
  jest.spyOn(Keyboard, 'isVisible').mockImplementation(() => keyboard.open);
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, fn: () => void) => {
    keyboard.handlers.set(event, fn);
    return { remove: () => keyboard.handlers.delete(event) };
  }) as unknown as typeof Keyboard.addListener);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setOS(original);
});

describe('quando consultar', () => {
  it('sem carta, parado', async () => {
    const r = await render(null, 'pt', { price: okPrice });
    expect(r.last()).toEqual({ status: 'idle' });
    await tick(1000);
    expect(consult).not.toHaveBeenCalled();
  });

  it('na web não consulta', async () => {
    setOS('web');
    const r = await render(lookupCard(), 'pt', { price: okPrice });
    expect(r.last()).toEqual({ status: 'unavailable', reason: 'web' });
    await tick(1000);
    expect(consult).not.toHaveBeenCalled();
  });

  it.each(['ja', 'ko', 'zh'] as const)('%s: só link', async (lang) => {
    const r = await render(jaCard(), lang, { price: okPrice });
    expect(r.last()).toEqual({ status: 'unavailable', reason: 'language' });
    await tick(1000);
    expect(consult).not.toHaveBeenCalled();
  });

  it.each(['pt', 'en'] as const)('%s: dispara 300 ms depois de abrir', async (lang) => {
    const r = await render(lookupCard(), lang, { price: okPrice });
    expect(r.last()).toEqual({ status: 'loading' });
    await tick(299);
    expect(consult).not.toHaveBeenCalled();
    await tick(1);
    expect(consult).toHaveBeenCalledTimes(1);
    expect(r.last()).toEqual({ status: 'ok', min: 480, avg: 600, max: 700, qty: 12, url: 'https://mypcards.com/pokemon/produto/77', at: okPrice.checkedAt });
  });

  it('fechar a folha antes dos 300 ms não gasta consulta', async () => {
    const r = await render(lookupCard(), 'en', { price: okPrice });
    await r.unmount();
    await tick(1000);
    expect(consult).not.toHaveBeenCalled();
  });

  it('quantidade só se vier', async () => {
    const r = await render(lookupCard(), 'pt', { price: { ...okPrice, qty: undefined } });
    await tick(300);
    expect(r.last()).toMatchObject({ status: 'ok', qty: undefined });
  });
});

describe('respostas', () => {
  it('não encontrada', async () => {
    const r = await render(lookupCard(), 'pt', { price: { ...okPrice, notFound: 'não achou' } });
    await tick(300);
    expect(r.last()).toEqual({ status: 'notFound' });
  });

  it('sem internet', async () => {
    const r = await render(lookupCard(), 'pt', { offline: true });
    await tick(300);
    expect(r.last()).toEqual({ status: 'unavailable', reason: 'offline' });
  });

  it('pausa: conta os segundos e tenta de novo ao terminar', async () => {
    let n = 0;
    const r = await render(lookupCard(), 'pt', async () => (++n === 1 ? { limitedForMs: 2000, by: 'myp' } : { price: okPrice }));
    await tick(300);
    expect(r.last()).toEqual({ status: 'limited', retryInS: 2, by: 'myp' });
    await tick(1000);
    expect(r.last()).toEqual({ status: 'limited', retryInS: 1, by: 'myp' });
    await tick(1000);
    expect(consult).toHaveBeenCalledTimes(2);
    expect(r.last()).toMatchObject({ status: 'ok' });
  });

  it('fechar durante a pausa para a contagem', async () => {
    const r = await render(lookupCard(), 'pt', { limitedForMs: 2000, by: 'myp' });
    await tick(300);
    await r.unmount();
    await tick(5000);
    expect(consult).toHaveBeenCalledTimes(1);
  });
});

describe('limite do app × pausa do MYP', () => {
  it('janela cheia do app: diz que é o limite de consultas, não uma pausa do MYP', async () => {
    const r = await render(lookupCard(), 'pt', { limitedForMs: 52_000, by: 'app' });
    await tick(300);
    expect(r.last()).toEqual({ status: 'limited', retryInS: 52, by: 'app' });
    expect(mypPauseText(52, 'app')).toBe('Limite de consultas: 52 s');
  });

  it('429 de verdade continua "MYP pediu uma pausa"', () => {
    expect(mypPauseText(58, 'myp')).toBe('MYP pediu uma pausa: 58 s');
    expect(mypPauseText(58)).toBe('MYP pediu uma pausa: 58 s');
  });
});

describe('digitando com a carta única na tela', () => {
  it('com o teclado aberto, espera 1 s em vez de 300 ms', async () => {
    keyboard.open = true;
    await render(lookupCard(), 'en', { price: okPrice });
    await tick(999);
    expect(consult).not.toHaveBeenCalled();
    await tick(1);
    expect(consult).toHaveBeenCalledTimes(1);
  });

  it('"OBF 1" e "OBF 12" a caminho de "OBF 125": só a última carta gasta consulta', async () => {
    keyboard.open = true;
    const r = await render(lookupCard({ key: 'oddish', name: 'Oddish', tcgdexId: 'sv03-1' }), 'en', { price: okPrice });
    await tick(600);
    await r.show(lookupCard({ key: 'trevenant', name: 'Trevenant', tcgdexId: 'sv03-12' }));
    await tick(600);
    await r.show(lookupCard({ key: 'alvo', name: 'Alvo', tcgdexId: 'sv03-125' }));
    await tick(1000);
    expect(consult).toHaveBeenCalledTimes(1);
    expect(consult.mock.calls[0][0].cardId).toBe('sv03-125');
  });

  it('fechar o teclado libera a consulta na hora', async () => {
    keyboard.open = true;
    await render(lookupCard(), 'en', { price: okPrice });
    await tick(500);
    expect(consult).not.toHaveBeenCalled();
    await emitKeyboard('keyboardDidHide');
    await tick(0);
    expect(consult).toHaveBeenCalledTimes(1);
  });

  it('abrir o teclado depois da consulta não consulta de novo', async () => {
    await render(lookupCard(), 'en', { price: okPrice });
    await tick(300);
    await emitKeyboard('keyboardDidShow');
    await tick(2000);
    expect(consult).toHaveBeenCalledTimes(1);
  });

  it('teclado abrindo durante a espera estica para 1 s', async () => {
    await render(lookupCard(), 'en', { price: okPrice });
    await tick(100);
    await emitKeyboard('keyboardDidShow');
    await tick(500);
    expect(consult).not.toHaveBeenCalled();
    await tick(400);
    expect(consult).toHaveBeenCalledTimes(1);
  });
});

describe('versão da carta', () => {
  it('com selo e sem produto próprio: nunca o preço da carta base', async () => {
    const r = await render(lookupCard({ stamp: 'Staff' }), 'en', { price: { ...okPrice, variant: 'staff', ownVersion: undefined } });
    await tick(300);
    expect(r.last()).toEqual({ status: 'notFound' });
  });

  it('Poké Ball sem produto próprio também não', async () => {
    const r = await render(lookupCard({ stamp: 'Poké Ball Pattern' }), 'en', { price: { ...okPrice, variant: 'pokeball' } });
    await tick(300);
    expect(r.last()).toEqual({ status: 'notFound' });
  });

  it('com selo e produto próprio mostra o preço', async () => {
    const r = await render(lookupCard({ stamp: 'Staff' }), 'en', { price: { ...okPrice, variant: 'staff', ownVersion: true } });
    await tick(300);
    expect(r.last()).toMatchObject({ status: 'ok', avg: 600 });
  });

  it('"Cosmos Holo" é a própria carta: mostra o preço', async () => {
    const r = await render(lookupCard({ stamp: 'Cosmos Holo' }), 'en', { price: { ...okPrice, variant: 'holo' } });
    await tick(300);
    expect(r.last()).toMatchObject({ status: 'ok', avg: 600 });
  });

  // O "≈ Aproximado" da Reverse Foil pelo MYP é só do valor da carta salva (valuation): a Consulta segue igual.
  it('carta com impressão Reverse: consulta a carta comum e mostra o preço do produto', async () => {
    const r = await render(lookupCard({ prints: [print('N', 100), print('R', 300)] }), 'pt', { price: okPrice });
    await tick(300);
    expect(consult.mock.calls[0][0].variant).toBe('normal');
    expect(r.last()).toMatchObject({ status: 'ok', avg: 600 });
  });

  it('selo "Reverse Holofoil" sem produto próprio no MYP: mostra o preço (não é versão especial)', async () => {
    const r = await render(lookupCard({ stamp: 'Reverse Holofoil' }), 'pt', { price: { ...okPrice, variant: 'reverse', ownVersion: undefined } });
    await tick(300);
    expect(consult.mock.calls[0][0].variant).toBe('reverse');
    expect(r.last()).toMatchObject({ status: 'ok', avg: 600 });
  });
});
