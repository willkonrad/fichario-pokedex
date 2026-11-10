import { keepTabInside, openerOf } from '@/components/layer-a11y';

// Foco das camadas na web (folha da carta, filtros): o Tab dá a volta dentro delas e nunca cai no que está atrás.

type Fake = { name: string; focus: jest.Mock; getClientRects: () => unknown[]; compareDocumentPosition: (other: Fake) => number; tagName?: string };

const g = globalThis as unknown as { document?: { activeElement: unknown; body: unknown } };

function layer(names: string[]) {
  const order: Fake[] = [];
  const make = (name: string, visible = true): Fake => {
    const el: Fake = {
      name,
      focus: jest.fn(),
      getClientRects: () => (visible ? [{}] : []),
      // 4: o outro vem depois; 2: vem antes (Node.compareDocumentPosition).
      compareDocumentPosition: (other) => (order.indexOf(other) > order.indexOf(el) ? 4 : order.indexOf(other) < order.indexOf(el) ? 2 : 0),
    };
    order.push(el);
    return el;
  };
  const title = make('título');
  const items = names.map((n) => make(n));
  const hidden = make('escondido', false);
  const box = { querySelectorAll: () => [...items, hidden], contains: (x: unknown) => order.includes(x as Fake) };
  return { title, items, box };
}

function tab(box: object, at: unknown, shiftKey = false) {
  g.document = { activeElement: at, body: {} };
  const e = { key: 'Tab', shiftKey, currentTarget: box, preventDefault: jest.fn() };
  keepTabInside(e);
  return e;
}

afterEach(() => {
  delete g.document;
});

describe('keepTabInside', () => {
  it('Tab no último volta ao primeiro; Shift+Tab no primeiro vai ao último', () => {
    const { items, box } = layer(['fechar', 'link', 'adicionar']);
    expect(tab(box, items[2]).preventDefault).toHaveBeenCalled();
    expect(items[0].focus).toHaveBeenCalled();
    expect(tab(box, items[0], true).preventDefault).toHaveBeenCalled();
    expect(items[2].focus).toHaveBeenCalled();
  });

  it('no meio, o navegador segue sozinho', () => {
    const { items, box } = layer(['fechar', 'link', 'adicionar']);
    const e = tab(box, items[1]);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(items.some((el) => el.focus.mock.calls.length)).toBe(false);
  });

  it('no título (foco ao abrir, fora do Tab): Shift+Tab dá a volta, Tab segue', () => {
    const { title, items, box } = layer(['fechar', 'link']);
    expect(tab(box, title, true).preventDefault).toHaveBeenCalled();
    expect(items[1].focus).toHaveBeenCalled();
    expect(tab(box, title).preventDefault).not.toHaveBeenCalled();
  });

  it('foco fora da camada volta para dentro; o escondido não conta; outra tecla, nada', () => {
    const { items, box } = layer(['fechar', 'link']);
    expect(tab(box, { name: 'atrás' }).preventDefault).toHaveBeenCalled();
    expect(items[0].focus).toHaveBeenCalled();
    expect(tab(box, items[1]).preventDefault).toHaveBeenCalled();
    g.document = { activeElement: items[1], body: {} };
    const other = { key: 'Enter', currentTarget: box, preventDefault: jest.fn() };
    keepTabInside(other);
    expect(other.preventDefault).not.toHaveBeenCalled();
  });
});

describe('openerOf', () => {
  it('o nó tocado vale sempre; sem ele, no celular, nada', () => {
    const node = { célula: 1 };
    expect(openerOf(node)).toBe(node);
    expect(openerOf(undefined)).toBeNull();
  });
});
