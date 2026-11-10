import { act, createElement } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import { PricePanel } from '@/components/price-panel';
import { APPROX_REASON, HOW_WE_CALCULATE } from '@/lib/copy';
import type { Entry } from '@/lib/types';

import { entry, myp, tcg } from './fixtures';

// Quadro de preço de uma Reverse Foil: o "≈ Aproximado" pelo produto da carta no MYP vale só em português (a decisão do
// dono e o texto de "Como calculamos o valor"); a inglesa segue como antes, avaliada pela TCGplayer ou, sem ela, pelos
// anúncios do MYP de todos os idiomas.

jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: (props: object) => jest.requireActual('react').createElement('LinearGradient', props) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const React = jest.requireActual('react');
  const resolve = (v: unknown) => (typeof v === 'function' ? v({ pressed: false }) : v);
  function PressableMock(props: Record<string, unknown>) {
    return React.createElement('Pressable', { ...props, style: resolve(props.style) }, resolve(props.children));
  }
  return { __esModule: true, default: PressableMock };
});
jest.mock('@/components/line-chart', () => ({ LineChart: () => null }));
// Sem histórico (nada de banco): o quadro só mostra o preço guardado na carta.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/history', () => ({ ...jest.requireActual('@/lib/history'), entryHistory: jest.fn(async () => []) }));

// O formatBRL separa o "R$" com espaço que não quebra.
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const textOf = (n: TestInstance): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const texts = (root: Root) => root.container.queryAll((n: TestInstance) => n.type === 'Text').map((n) => plain(textOf(n)));

const MYP_BASE_DETAIL = 'O MYP não vende a versão reverse foil à parte: é o preço da carta base.';
const noTcg = (e: Entry) => tcg(e, { min: undefined, avg: undefined, max: undefined, notFound: 'sem vendas recentes na TCGplayer' });

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

/** Desenha o quadro com os "Detalhes da cotação" abertos; devolve os textos da tela. */
async function panel(e: Entry) {
  const root = createRoot();
  roots.push(root);
  await act(async () => root.render(createElement(PricePanel, { entry: e })));
  const toggle = root.container.queryAll((n: TestInstance) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Detalhes da cotação')[0];
  expect(toggle).toBeDefined();
  await act(async () => toggle.props.onPress());
  return texts(root);
}

describe('quadro de preço da Reverse Foil', () => {
  it('em português, pelo produto da carta no MYP: ≈ Aproximado pela carta base, com o aviso nos detalhes', async () => {
    const rev = entry({ variant: 'reverse' });
    const t = await panel({ ...rev, mypApi: myp(rev) });
    expect(t).toContain(`≈ Aproximado · ${APPROX_REASON.base}`);
    expect(t).toContain(MYP_BASE_DETAIL);
  });

  it('em português, com o produto próprio da reverse no MYP: exato, sem o aviso', async () => {
    const rev = entry({ variant: 'reverse' });
    const t = await panel({ ...rev, mypApi: myp(rev, { ownVersion: true }) });
    expect(t.some((s) => s.startsWith('≈'))).toBe(false);
    expect(t).not.toContain(MYP_BASE_DETAIL);
  });

  it('em inglês sem preço na TCGplayer: continua ≈ Aproximado pelos anúncios do MYP de todos os idiomas (como antes)', async () => {
    const rev = entry({ lang: 'en', variant: 'reverse' });
    const t = await panel({ ...rev, tcgplayer: noTcg(rev), mypApi: myp(rev) });
    expect(t).toContain(`≈ Aproximado · ${APPROX_REASON.otherLanguages}`);
    expect(t).not.toContain(`≈ Aproximado · ${APPROX_REASON.base}`);
    expect(t).not.toContain(MYP_BASE_DETAIL);
  });

  it('em inglês pela TCGplayer: a referência do MYP não ganha "carta base" (como antes)', async () => {
    const rev = entry({ lang: 'en', variant: 'reverse' });
    const t = await panel({ ...rev, tcgplayer: tcg(rev), mypApi: myp(rev) });
    expect(t.some((s) => s.startsWith('≈'))).toBe(false);
    const ref = t.find((s) => s.startsWith('No Brasil, no MYP Cards:'));
    expect(ref).toBe('No Brasil, no MYP Cards: R$ 5,00 – R$ 20,00 (7 anúncios, todos os idiomas)');
    expect(t).not.toContain(MYP_BASE_DETAIL);
  });

  it('"Como calculamos o valor" diz que a regra da reverse é a das cartas em português', () => {
    const topic = HOW_WE_CALCULATE.topics.find((t) => t.title === '≈ Aproximado');
    expect(topic?.body).toMatch(/Reverse Foil em português/);
    expect(topic?.body).toMatch(/Carta em inglês sem preço na TCGplayer usa os anúncios do MYP Cards, de todos os idiomas/);
  });
});
