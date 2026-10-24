import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Tema "Pokédex": fundo claro e cartões brancos (como a interface do Nintendo Switch), vermelho Pokémon
 * nas barras e na ação principal, amarelo-foil para carta especial e progresso.
 *
 * Cada cor tem um significado fixo (veja `semantic` e docs/design.md): dinheiro em tinta neutra, seleção em
 * grafite, vermelho só nas superfícies da marca e no botão principal, verde e vermelho só para variação.
 * Os textos passam no contraste AA (4,5:1) sobre o fundo, os cartões e o cinza claro. Branco sobre o vermelho da marca
 * (`primary`) dá 4,4:1: só para texto grande (o título do cabeçalho, 19 px em negrito) e ícones; texto menor sobre a
 * barra vermelha vai num cartão `semantic.brand.bgStrong` (6,4:1).
 */
export const colors = {
  background: '#F1F2F6',
  /** Fundo da barra fixa do rodapé (quase opaco, deixa ver a rolagem por baixo). */
  backgroundTranslucent: 'rgba(241, 242, 246, 0.97)',
  surface: '#FFFFFF',
  surfaceAlt: '#EBEDF2',
  /** Divisórias e bordas de cartão (decorativas). */
  border: '#DFE2E9',
  /** Borda de controle (campo, interruptor desligado): 3:1 sobre o branco e o fundo. */
  borderStrong: '#7F8592',
  text: '#16181D',
  textMuted: '#5A606D',
  /** Texto de apoio (legendas, rótulos pequenos): AA sobre branco, fundo e cinza claro. */
  textFaint: '#646A77',
  /** Ícones decorativos e enfeites; nunca para texto. */
  iconFaint: '#969CA8',
  /** Vermelho Pokémon: barras do topo e superfícies da marca. */
  primary: '#E3350D',
  /** Vermelho escuro: texto vermelho sobre fundo claro e fundo de cartões de valor sobre a barra vermelha. */
  primaryDark: '#B5280A',
  /** Texto vermelho sobre fundo claro (AA). */
  primaryText: '#B5280A',
  /** Fundo do botão principal: quase o vermelho da marca, com texto branco AA. */
  primaryAction: '#DA320C',
  primarySoft: 'rgba(227, 53, 13, 0.10)',
  onPrimary: '#FFFFFF',
  /** Amarelo do logo Pokémon (foil): carta especial e progresso. */
  yellow: '#FFCB05',
  /** Azul do logo Pokémon: só texto tocável (links). */
  blue: '#2F5BD3',
  /** Valores em reais: tinta neutra (o dinheiro não tem cor). */
  money: '#16181D',
  danger: '#C5221F',
  /** Confirmação e alta (texto e ícone, AA). */
  success: '#167A45',
  /** Aviso (texto e ícone, AA). */
  warning: '#965A00',
  /** Grafite das folhas do fichário: seleção e segunda cor da marca. */
  graphite: '#22262E',
  /** Foco do teclado e destaque sobre fundo claro (o ciano da folha escura fica fraco no branco). */
  focus: '#0B7A86',
  /** Fundo escurecido atrás de folhas e diálogos. */
  backdrop: 'rgba(11, 16, 32, 0.45)',
  /** @deprecated use `colors.primary` (superfície) ou `colors.primaryText` (texto). */
  accent: '#E3350D',
  /** @deprecated use `colors.primarySoft`. */
  accentSoft: 'rgba(227, 53, 13, 0.10)',
  /** @deprecated use `colors.warning`. */
  gold: '#965A00',
};

/** Página do fichário: escura, como as folhas plásticas de um fichário de verdade. */
export const binderColors = {
  page: '#22262E',
  pageBorder: '#323844',
  pocket: '#2B303A',
  pocketBorder: '#3A414E',
  text: '#E9EBF0',
  textMuted: '#A4AAB6',
  /** AA sobre a folha e o bolso. */
  textFaint: '#9399A5',
  /** Destaque do bolso (resultado da busca, carta recém-colocada): ciano do Nintendo Switch. */
  highlight: '#2EE6F2',
  /** Borda e selo da carta especial (amarelo-foil). */
  special: '#FFCB05',
  /** Cápsula de preço neutra sobre a folha. */
  priceBg: 'rgba(255, 255, 255, 0.08)',
  priceFg: '#E9EBF0',
};

/**
 * Significado fixo de cada cor (AR1). As telas usam estes nomes, e não a cor solta.
 * - money: dinheiro sempre em tinta neutra, com algarismos tabulares (`type.numeric`).
 * - myValue: o "Meu valor" digitado; mesma tinta do dinheiro, com a marca ✎ e um selo neutro.
 * - special: carta especial e progresso (amarelo-foil), nada mais.
 * - selected: opção escolhida (Chip, Segmented, faixa de valor): grafite com texto branco.
 * - highlight/focus: destaque e foco; ciano na folha escura, petróleo no fundo claro.
 * - gain/loss: variação de valor (alta e queda). O gráfico fica em tinta neutra.
 * - success/warning/danger: confirmação, aviso e erro (texto, ícone e fundo suave).
 *   O fundo suave (`bg`) de gain/loss/success/warning/danger é opaco: translúcido sobre o fundo cinza, o texto
 *   verde e o âmbar ficavam abaixo de 4,5:1.
 * - link: texto tocável (azul); sobre a barra vermelha, branco sublinhado.
 * - confidence: neutra; o prefixo só aparece quando acrescenta informação (≈ aproximado, ✎ Meu valor).
 * - brand: superfícies da marca (barra do topo, capa vermelha) e o botão principal.
 * - inverse: avisos flutuantes (toast) sobre tinta escura.
 * - tag: selos neutros (idioma PT/EN/JP, "carta base"…).
 */
export const semantic = {
  money: { fg: '#16181D', fgMuted: '#5A606D', onSheet: '#E9EBF0', onSheetMuted: '#A4AAB6', onBrand: '#FFFFFF' },
  myValue: { fg: '#16181D', mark: '✎', tagBg: '#EBEDF2', tagFg: '#3D4350' },
  special: { fill: '#FFCB05', onFill: '#16181D', border: '#FFCB05', soft: 'rgba(255, 203, 5, 0.18)' },
  selected: { bg: '#22262E', fg: '#FFFFFF', border: '#22262E', soft: 'rgba(34, 38, 46, 0.08)' },
  highlight: { onSheet: '#2EE6F2', onLight: '#0B7A86', soft: 'rgba(11, 122, 134, 0.10)' },
  focus: { ring: '#0B7A86', onDark: '#2EE6F2', width: 2, offset: 2 },
  gain: { fg: '#167A45', bg: '#E8F2EC', onSheet: '#6BE0A6' },
  loss: { fg: '#B5280A', bg: '#F9EEEB', onSheet: '#FF9B85' },
  success: { fg: '#167A45', bg: '#E8F2EC', solid: '#167A45', onSolid: '#FFFFFF' },
  warning: { fg: '#965A00', bg: '#F5EFE6', solid: '#965A00', onSolid: '#FFFFFF' },
  danger: { fg: '#C5221F', bg: '#FAEDED', border: 'rgba(197, 34, 31, 0.35)', solid: '#C5221F', onSolid: '#FFFFFF' },
  link: { fg: '#2F5BD3', soft: 'rgba(47, 91, 211, 0.08)', onBrand: '#FFFFFF', onInverse: '#2EE6F2' },
  confidence: {
    alta: { fg: '#16181D', mark: '' },
    media: { fg: '#16181D', mark: '' },
    baixa: { fg: '#5A606D', mark: '≈' },
  },
  brand: {
    bg: '#E3350D',
    /** Cartão sobre a barra vermelha (evita vermelho sobre vermelho e dá contraste ao texto branco). */
    bgStrong: '#B5280A',
    action: '#DA320C',
    fg: '#FFFFFF',
    /** Botão redondo sobre a barra vermelha. */
    soft: 'rgba(255, 255, 255, 0.16)',
    /** Trilho da barra de progresso sobre a barra vermelha. */
    track: 'rgba(0, 0, 0, 0.22)',
  },
  inverse: { bg: '#16181D', fg: '#FFFFFF', fgMuted: '#B8BDC8', action: '#2EE6F2' },
  tag: { bg: '#EBEDF2', fg: '#3D4350', border: '#DFE2E9' },
  /** Mouse por cima (web): véu sobre o fundo claro e sobre a barra vermelha. */
  hover: { onLight: 'rgba(22, 24, 29, 0.06)', onBrand: 'rgba(255, 255, 255, 0.26)' },
} as const;

/**
 * Confiança do valor: verde (alta), âmbar (média), cinza (baixa).
 * @deprecated use `semantic.confidence` (neutra, com prefixo só quando acrescenta informação).
 */
export const confidenceColors = {
  light: { alta: '#1E9E5A', media: '#B26B00', baixa: '#7A808C' },
  /** Sobre a página escura do fichário. */
  dark: {
    alta: { bg: 'rgba(76, 195, 138, 0.20)', fg: '#6BE0A6' },
    media: { bg: 'rgba(255, 203, 5, 0.18)', fg: '#FFD84D' },
    baixa: { bg: 'rgba(164, 170, 182, 0.16)', fg: '#B8BDC8' },
  },
};

/** @deprecated use `type.numeric` ou `type.tabular` (algarismos tabulares na fonte do sistema). */
export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' });

/**
 * Escala tipográfica (AR5): 7 estilos e os números. Nada abaixo de 11 px e sem peso 900.
 * Misture com a cor: `[type.body, { color: colors.textMuted }]`.
 */
export const type = {
  /** Número grande da tela (valor da coleção). */
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  /** Título de tela ou de carta. */
  title: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  /** Título de bloco (Section, folha de informação). */
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  /** Rótulo em maiúsculas que separa grupos (eyebrow). */
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  /** Legenda de uma linha, explicação curta, atribuição. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** Valores e contagens: algarismos tabulares, que não "pulam" ao mudar. */
  numeric: { fontSize: 15, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  /** Só os algarismos tabulares, para misturar com outro estilo. */
  tabular: { fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;

/** O mesmo que `type`, para quem prefere não importar um nome igual à palavra-chave do TypeScript. */
export const typography = type;

/** Espaçamentos (múltiplos de 4). */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** Alvo mínimo de toque (44 × 44): botões, chips, ícones e links soltos (A10). */
export const TOUCH = 44;

/** hitSlop que leva um ícone de `size` px ao alvo de 44 px (no celular; na web use padding). */
export function hitSlopFor(size: number) {
  const s = Math.max(0, Math.ceil((TOUCH - size) / 2));
  return { top: s, bottom: s, left: s, right: s };
}

/** `card`: arte da carta; `sm` a `lg`: controles e cartões; `pill`: cápsulas. */
export const radius = { card: 4, sm: 8, md: 14, lg: 20, pill: 999 };

/** Sombra leve dos cartões brancos (iOS/web) e elevação (Android). */
export const shadow = Platform.select({
  android: { elevation: 2 },
  default: { shadowColor: '#0B1020', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
});

/** Elevação: 0 (plano), 1 (cartão, = `shadow`), 2 (o que flutua: toast, folha de baixo). */
export const elevation: Record<0 | 1 | 2, ViewStyle> = {
  0: {},
  1: shadow,
  2: Platform.select({
    android: { elevation: 8 },
    default: { shadowColor: '#0B1020', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  }),
};

// Proporção real de uma carta (63 × 88 mm).
export const CARD_RATIO = 63 / 88;

/** Largura máxima do conteúdo em telas grandes (tablet, web). Para outros tipos de tela, veja `widths`. */
export const MAX_WIDTH = 720;

/**
 * Larguras máximas por tipo de conteúdo (W7):
 * - reading: textos e listas simples (= MAX_WIDTH);
 * - form: formulários (configuração, conta);
 * - content: telas com duas colunas (carta, coleção);
 * - wide: grades de cartas e painéis;
 * - spread: fichário aberto em duas páginas.
 */
export const widths = { reading: MAX_WIDTH, form: 640, content: 960, wide: 1200, spread: 1440 } as const;

/** Pontos de quebra da largura da janela. */
export const breakpoints = { tablet: 600, desktop: 960, wide: 1280 } as const;

/** Margem lateral pela largura da janela: 16 no celular, 24 no tablet, 32 no computador. */
export function gutterFor(width: number) {
  return width >= breakpoints.desktop ? space.xxl : width >= breakpoints.tablet ? space.xl : space.lg;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Luminância relativa (WCAG) de uma cor #RGB ou #RRGGBB; null se a cor não for hexadecimal. */
export function luminance(color: string): number | null {
  const m = HEX.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste WCAG entre duas cores (1 a 21); null se alguma não for hexadecimal. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
