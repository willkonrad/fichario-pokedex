import { act, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';

import { withMarkIcons } from '@/components/icons';
import { ExternalLink } from '@/components/ui';
import { basisNote, SET_MY_VALUE } from '@/lib/copy';
import { colors, semantic } from '@/theme';

// Marcas desenhadas como ícone: o ✎ dos textos vira lápis e o "abre fora" do link vira open-outline.

// O ícone vira um elemento simples (o jest não tem o registro de assets), para achar onde ele fica na árvore.
jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: (props: object) => jest.requireActual('react').createElement('Ionicons', props),
}));

const OPTS = { size: 13, color: colors.text };

function list(node: ReactNode) {
  return node as (string | ReactElement<Record<string, unknown>>)[];
}

describe('withMarkIcons', () => {
  it('texto sem ✎ volta igual', () => {
    expect(withMarkIcons('R$ 45,00', OPTS)).toBe('R$ 45,00');
    expect(withMarkIcons('', OPTS)).toBe('');
  });

  it('troca o ✎ por um lápis escondido do leitor de tela, com o tamanho e a cor pedidos', () => {
    const [icon, rest] = list(withMarkIcons(`${semantic.myValue.mark} R$ 45,00`, OPTS));
    expect(isValidElement(icon)).toBe(true);
    expect((icon as ReactElement<Record<string, unknown>>).props).toMatchObject({ name: 'pencil', size: 13, color: colors.text, 'aria-hidden': true });
    expect(rest).toBe(' R$ 45,00');
  });

  it('mantém o texto em volta e troca cada ✎ da frase', () => {
    const parts = list(withMarkIcons('antes ✎ meio ✎', OPTS));
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('antes ');
    expect(isValidElement(parts[1])).toBe(true);
    expect(parts[2]).toBe(' meio ');
    expect(isValidElement(parts[3])).toBe(true);
    // Cada ícone com a própria chave (lista de filhos do <Text>).
    expect((parts[1] as ReactElement).key).not.toBe((parts[3] as ReactElement).key);
  });

  it('as frases de copy.ts continuam com o ✎ (só o desenho muda)', () => {
    expect(basisNote({ basis: 'manual', pick: undefined })).toBe('✎ Meu valor');
    expect(SET_MY_VALUE).toBe('✎ Definir meu valor');
    expect(list(withMarkIcons(basisNote({ basis: 'manual', pick: undefined }), OPTS))[1]).toBe(' Meu valor');
  });
});

describe('ExternalLink: marca de "abre fora"', () => {
  const roots: Root[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
  });

  async function render(arrow: boolean) {
    const root = createRoot();
    roots.push(root);
    await act(async () =>
      root.render(
        <ExternalLink href="https://mypcards.com" variant="inline" arrow={arrow}>
          MYP Cards
        </ExternalLink>,
      ),
    );
    return root;
  }
  const icons = (root: Root) => root.container.queryAll((n: TestInstance) => n.type === 'Ionicons');

  it('com `arrow`, o ícone embutido fica escondido do leitor de tela e herda a cor do link', async () => {
    const [icon, ...others] = icons(await render(true));
    expect(others).toHaveLength(0);
    expect(icon.props.name).toBe('open-outline');
    expect(icon.props.color).toBeUndefined();
    expect(icon.parent?.props['aria-hidden']).toBe(true);
  });

  it('sem `arrow`, sem ícone', async () => {
    expect(icons(await render(false))).toHaveLength(0);
  });
});
