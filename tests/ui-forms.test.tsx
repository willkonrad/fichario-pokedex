import { createElement, type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import type { Root, TestInstance } from 'test-renderer';

import { gutterFor, semantic, TOUCH, widths } from '@/theme';

// Controles dos formulários (ui.tsx e a faixa de valor): número fora da Kanit, alvo de 48, teclado na web, foco visível
// na opção branca, margem da barra fixa e o erro lido no celular.

jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock('expo-router/react-navigation', () => ({
  HeaderTitle: (props: object) => jest.requireActual('react').createElement('HeaderTitle', props),
}));
// O alvo de toque com as próprias props (estilo já resolvido), para achar e acionar.
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const React = jest.requireActual('react');
  const resolve = (v: unknown) => (typeof v === 'function' ? v({ pressed: false }) : v);
  function PressableMock(props: Record<string, unknown>) {
    return React.createElement('Pressable', { ...props, style: resolve(props.style) }, resolve(props.children));
  }
  return { __esModule: true, default: PressableMock };
});

type Mods = {
  ui: typeof import('@/components/ui');
  range: typeof import('@/components/value-range');
  header: typeof import('@/components/header-title');
  rn: typeof import('react-native');
};
type Rendered = { root: Root; act: (fn: () => void) => Promise<void> };

/**
 * Desenha num registro de módulos próprio, com o `Platform.OS` pedido: o ui.tsx lê a plataforma ao abrir. `before`
 * roda no mesmo registro antes do desenho (ex.: espiar o AccessibilityInfo de lá).
 */
async function renderOn(os: 'android' | 'web', build: (mods: Mods) => ReactElement, before?: (mods: Mods) => void): Promise<Rendered> {
  let out!: Rendered;
  await jest.isolateModulesAsync(async () => {
    const rn = jest.requireActual<typeof import('react-native')>('react-native');
    rn.Platform.OS = os;
    const { act } = jest.requireActual<typeof import('react')>('react');
    const { createRoot } = jest.requireActual<typeof import('test-renderer')>('test-renderer');
    const mods: Mods = {
      ui: jest.requireActual('@/components/ui'),
      range: jest.requireActual('@/components/value-range'),
      header: jest.requireActual('@/components/header-title'),
      rn,
    };
    before?.(mods);
    const root = createRoot();
    await act(async () => root.render(build(mods)));
    out = { root, act: async (fn) => act(async () => fn()) };
  });
  return out;
}

const hosts = (root: Root, type: string) => root.container.queryAll((n: TestInstance) => n.type === type);
const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const flat = (n: TestInstance) => StyleSheet.flatten(n.props.style) ?? {};
const radios = (root: Root) => hosts(root, 'Pressable').filter((n) => n.props.role === 'radio');
const keyDown = (key: string) => ({ key, preventDefault: jest.fn(), stopPropagation: jest.fn() });

/** Os trechos de texto aninhados (os números na fonte do sistema) dentro de um Text. */
const nestedTexts = (n: TestInstance) => n.queryAll((c: TestInstance) => c.type === 'Text').map(textOf);

const RANGE = { min: 5, avg: 10, max: 20 };

afterEach(() => jest.restoreAllMocks());

describe('número fora da Kanit', () => {
  it('título de seção dinâmico ("Mover Porygon2 para…"): o 2 vai num trecho na fonte do sistema', async () => {
    const { root } = await renderOn('android', ({ ui }) => <ui.Section title="Mover Porygon2 para…">{null}</ui.Section>);
    const title = hosts(root, 'Text').find((n) => n.props.role === 'heading')!;
    expect(textOf(title)).toBe('Mover Porygon2 para…');
    expect(nestedTexts(title)).toEqual(['2']);
  });

  it('título do cabeçalho padrão ("Bolso 5 · Trocas"): o número sai da Kanit e o estilo é o do cabeçalho', async () => {
    const { root } = await renderOn('android', ({ header }) => header.renderHeaderTitle({ children: 'Bolso 5 · Trocas', tintColor: '#FFFFFF' }));
    const title = hosts(root, 'HeaderTitle')[0];
    expect(title.props.style).toEqual(expect.objectContaining({ fontSize: 20, fontWeight: 'normal' }));
    expect(title.props.tintColor).toBe('#FFFFFF');
    expect(nestedTexts(title)).toEqual(['5']);
  });
});

describe('alvo de toque', () => {
  it('chip curto ("10" páginas) tem pelo menos 48 de largura, com o texto no meio', async () => {
    const { root } = await renderOn('android', ({ ui }) => createElement(ui.Chip, { label: '10', selected: false, onPress: () => {} }));
    const style = flat(hosts(root, 'Pressable')[0]);
    expect(style.minWidth).toBe(TOUCH);
    expect(style.minHeight).toBe(TOUCH);
    expect(style.justifyContent).toBe('center');
  });

  it('segmentado de seis opções (estado da carta) fica sem as folgas entre as partes; com menos, elas continuam', async () => {
    const six = ['M', 'NM', 'SP', 'MP', 'HP', 'D'].map((id) => ({ id, label: id }));
    const tight = await renderOn('android', ({ ui }) => createElement(ui.Segmented, { options: six, value: 'NM', onChange: () => {}, label: 'Estado' }));
    const group = (root: Root) => hosts(root, 'View').find((n) => n.props.role === 'radiogroup')!;
    expect(flat(group(tight.root)).gap).toBe(0);
    // 6 × 48 + 4 de trilho cabe nos 296 do cartão de 360.
    expect(6 * TOUCH + 2 * (flat(group(tight.root)).padding as number)).toBeLessThanOrEqual(296);

    const two = await renderOn('android', ({ ui }) => createElement(ui.Segmented, { options: six.slice(0, 2), value: 'M', onChange: () => {}, label: 'Estado' }));
    expect(flat(group(two.root)).gap).toBe(2);
  });
});

describe('foco do teclado na opção escolhida (web)', () => {
  it('a cor escolhida mostra a seleção pela borda branca e deixa o contorno para o foco, com folga', async () => {
    const { root } = await renderOn('web', ({ ui }) => createElement(ui.ColorPicker, { value: ui.COVER_COLORS[5].color, onChange: () => {} }));
    const [active] = radios(root).filter((n) => n.props['aria-checked']);
    const style = flat(active);
    expect(style.borderColor).toBe(semantic.selected.border);
    // Sem outlineStyle fixo: o contorno só aparece quando o navegador liga o foco (:focus-visible).
    expect(style.outlineStyle).toBeUndefined();
    expect(style.outlineOffset).toBe(semantic.focus.offset);
    expect(style.outlineColor).toBe(semantic.focus.ring);
  });

  it('chip e segmento escolhidos (brancos) põem o anel de foco fora deles, sobre o fundo escuro', async () => {
    const chip = await renderOn('web', ({ ui }) => createElement(ui.Chip, { label: 'NM', selected: true, onPress: () => {} }));
    expect(flat(hosts(chip.root, 'Pressable')[0]).outlineOffset).toBe(semantic.focus.offset);

    const options = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ];
    const seg = await renderOn('web', ({ ui }) => createElement(ui.Segmented, { options, value: 'a', onChange: () => {}, label: 'Lista' }));
    const [on, off] = radios(seg.root);
    expect(flat(on).outlineOffset).toBe(semantic.focus.offset);
    expect(flat(off).outlineOffset).toBeUndefined();
  });
});

describe('"Usar na soma" e versões no teclado (web)', () => {
  const pick = jest.fn();
  beforeEach(() => pick.mockReset());

  it('a barra de espaço marca a opção (o Pressable da web só aceita o espaço em botão)', async () => {
    const { root, act } = await renderOn('web', ({ range }) => createElement(range.ValueRangeRow, { range: RANGE, emphasis: 'avg', onSelect: pick, source: 'myp' }));
    const [min] = radios(root);
    const e = keyDown(' ');
    await act(() => min.props.onKeyDown(e));
    expect(pick).toHaveBeenCalledWith('min');
    expect(e.preventDefault).toHaveBeenCalled();
    // Outras teclas não marcam (o Enter fica com o próprio Pressable).
    await act(() => min.props.onKeyDown(keyDown('a')));
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('só a opção marcada entra no Tab; o grupo anda pelas setas', async () => {
    const { root } = await renderOn('web', ({ range }) => createElement(range.ValueRangeRow, { range: RANGE, emphasis: 'avg', onSelect: pick, source: 'myp' }));
    const [min, avg, max] = radios(root);
    expect(avg.props.tabIndex).toBeUndefined();
    expect(min.props.tabIndex).toBe(-1);
    expect(max.props.tabIndex).toBe(-1);
    const group = hosts(root, 'View').find((n) => n.props.role === 'radiogroup')!;
    expect(typeof group.props.onKeyDown).toBe('function');
    // A escolhida (branca) também ganha o anel de foco com folga.
    expect(flat(avg).outlineOffset).toBe(semantic.focus.offset);
  });

  it('no celular, nada de teclado: só o papel e o estado de opção', async () => {
    const { root } = await renderOn('android', ({ range }) => createElement(range.ValueRangeRow, { range: RANGE, emphasis: 'avg', onSelect: pick, source: 'myp' }));
    const [min, avg] = radios(root);
    expect(min.props.onKeyDown).toBeUndefined();
    expect(min.props.tabIndex).toBeUndefined();
    expect(avg.props['aria-checked']).toBe(true);
  });
});

/** Elementos de mentira com o mínimo do DOM que as setas usam (foco e clique). */
function fakeRadios(n: number) {
  const els = Array.from({ length: n }, () => ({ focus: jest.fn(), click: jest.fn() }));
  const group = { querySelectorAll: () => els };
  return { els, group };
}

describe('moveRadioFocus (setas num grupo de opções)', () => {
  const ui = () => jest.requireActual<typeof import('@/components/ui')>('@/components/ui');
  const event = (key: string, target: unknown, currentTarget: unknown, over: object = {}) => ({ ...keyDown(key), target, currentTarget, ...over });

  it('→ vai para a próxima e a marca; ← na primeira dá a volta até a última', () => {
    const { els, group } = fakeRadios(3);
    const right = event('ArrowRight', els[0], group);
    ui().moveRadioFocus(right);
    expect(els[1].focus).toHaveBeenCalled();
    expect(els[1].click).toHaveBeenCalled();
    expect(right.preventDefault).toHaveBeenCalled();
    // As setas da tela (folhear) não recebem a tecla.
    expect(right.stopPropagation).toHaveBeenCalled();

    ui().moveRadioFocus(event('ArrowLeft', els[0], group));
    expect(els[2].focus).toHaveBeenCalled();
  });

  it('sem marcar ao mover (escolher fecha a janela): só o foco anda', () => {
    const { els, group } = fakeRadios(3);
    ui().moveRadioFocus(event('ArrowDown', els[1], group), false);
    expect(els[2].focus).toHaveBeenCalled();
    expect(els[2].click).not.toHaveBeenCalled();
  });

  it('com modificador, ou outra tecla, nada muda', () => {
    const { els, group } = fakeRadios(3);
    const shifted = event('ArrowRight', els[0], group, { shiftKey: true });
    ui().moveRadioFocus(shifted);
    ui().moveRadioFocus(event('Tab', els[0], group));
    for (const el of els) expect(el.focus).not.toHaveBeenCalled();
    expect(shifted.preventDefault).not.toHaveBeenCalled();
  });
});

describe('barra fixa no rodapé', () => {
  it('segue a margem da tela (gutterFor) e a largura da coluna do formulário', async () => {
    const { root } = await renderOn('android', ({ ui }) => <ui.BottomBar bottomInset={0} width="form">{null}</ui.BottomBar>);
    const [bar, inner] = hosts(root, 'View');
    const { width } = jest.requireActual<typeof import('react-native')>('react-native').Dimensions.get('window');
    const gutter = gutterFor(width);
    expect(flat(bar).paddingHorizontal).toBe(gutter);
    expect(flat(inner).maxWidth).toBe(widths.form - gutter * 2);
  });

  it('sem `width`, a coluna de leitura (lista, carta)', async () => {
    const { root } = await renderOn('android', ({ ui }) => <ui.BottomBar bottomInset={0}>{null}</ui.BottomBar>);
    const inner = hosts(root, 'View')[1];
    const { width } = jest.requireActual<typeof import('react-native')>('react-native').Dimensions.get('window');
    expect(flat(inner).maxWidth).toBe(widths.reading - gutterFor(width) * 2);
  });
});

describe('erro de formulário no celular', () => {
  it('Notice de erro é anunciado ao aparecer e ao mudar (o TalkBack não lê a região que já entra preenchida)', async () => {
    let announce!: jest.SpyInstance;
    const { root } = await renderOn(
      'android',
      ({ ui }) => <ui.Notice tone="danger">E-mail ou senha incorretos.</ui.Notice>,
      ({ rn }) => {
        announce = jest.spyOn(rn.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      },
    );
    expect(announce).toHaveBeenCalledWith('E-mail ou senha incorretos.');
    // Sem a região "ao vivo" junto: o erro não é lido duas vezes.
    const box = hosts(root, 'View')[0];
    expect(box.props.accessibilityLiveRegion).toBe('none');

    const ui = jest.requireActual<typeof import('@/components/ui')>('@/components/ui');
    expect(ui.plainText(['Não consegui salvar. ', createElement('Text', null, 'Tente de novo.')])).toBe('Não consegui salvar. Tente de novo.');
  });

  it('aviso que não é erro não é anunciado à parte (a região educada já é lida)', async () => {
    let announce!: jest.SpyInstance;
    await renderOn(
      'android',
      ({ ui }) => <ui.Notice tone="info">Fichário salvo</ui.Notice>,
      ({ rn }) => {
        announce = jest.spyOn(rn.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      },
    );
    expect(announce).not.toHaveBeenCalled();
  });

  it('na web, o erro é região "alert" assertiva, sem anúncio à parte', async () => {
    let announce!: jest.SpyInstance;
    const { root } = await renderOn(
      'web',
      ({ ui }) => <ui.Notice tone="danger">Falhou</ui.Notice>,
      ({ rn }) => {
        announce = jest.spyOn(rn.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
      },
    );
    expect(announce).not.toHaveBeenCalled();
    const box = hosts(root, 'View')[0];
    expect(box.props.role).toBe('alert');
    expect(box.props['aria-live']).toBe('assertive');
  });

  it('campo inválido diz "inválido" no nome no celular; na web, aria-invalid', async () => {
    const android = await renderOn('android', ({ ui }) => createElement(ui.Input, { accessibilityLabel: 'Senha', invalid: true }));
    expect(hosts(android.root, 'TextInput')[0].props.accessibilityLabel).toBe('Senha, inválido');

    const sem = await renderOn('android', ({ ui }) => createElement(ui.Input, { placeholder: 'Senha nova', invalid: true }));
    expect(hosts(sem.root, 'TextInput')[0].props.accessibilityLabel).toBe('Senha nova, inválido');

    const valid = await renderOn('android', ({ ui }) => createElement(ui.Input, { accessibilityLabel: 'Senha' }));
    expect(hosts(valid.root, 'TextInput')[0].props.accessibilityLabel).toBe('Senha');

    const web = await renderOn('web', ({ ui }) => createElement(ui.Input, { accessibilityLabel: 'Senha', invalid: true }));
    const input = hosts(web.root, 'TextInput')[0];
    expect(input.props['aria-invalid']).toBe(true);
    expect(input.props.accessibilityLabel).toBe('Senha');
  });
});
