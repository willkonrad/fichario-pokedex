import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Tema "moldura preta": fundo preto, superfícies grafite em degraus (sem sombra), texto branco. A arte da carta é o que
 * tem cor na tela. Referência de estilo: páginas oficiais do Pokémon TCG (só o estilo; logos, artes e textos não entram).
 *
 * Cada cor tem um significado fixo (veja `semantic` e DESIGN.md): dinheiro em branco, seleção em branco com texto
 * preto, títulos de seção em amarelo-claro, foil só em carta especial, vermelho só na ação principal e no fio da barra do
 * topo. Os textos passam no contraste AA (4,5:1) sobre o preto e as superfícies. Branco sobre o vermelho da ação dá 4,66:1.
 */
export const colors = {
  background: '#000000',
  /** Fundo da barra fixa do rodapé (quase opaco, deixa ver a rolagem por baixo). */
  backgroundTranslucent: 'rgba(0, 0, 0, 0.94)',
  surface: '#16181A',
  surfaceAlt: '#232629',
  /** Divisórias e bordas de cartão (decorativas). */
  border: '#2E3236',
  /** Borda de controle (campo, interruptor desligado): 3:1 sobre o preto e as superfícies. */
  borderStrong: '#7E858F',
  text: '#FFFFFF',
  textMuted: '#C4C9D0',
  /** Texto de apoio (legendas, rótulos pequenos): AA sobre o preto e as superfícies. */
  textFaint: '#A0A6AE',
  /** Ícones decorativos e enfeites; nunca para texto. */
  iconFaint: '#6F757E',
  /** Títulos de seção: amarelo-claro. */
  heading: '#FFF690',
  /** Tinta escura: texto sobre fundo claro (selo amarelo, capa clara, aviso flutuante). */
  ink: '#16181D',
  /** Vermelho Pokédex: ação principal e fio da barra do topo. */
  primary: '#E6171E',
  /** Fim do gradiente da ação principal e mouse por cima. */
  primaryDark: '#C40D13',
  /** Texto vermelho sobre fundo escuro (AA). */
  primaryText: '#FF8F85',
  /** Fundo do botão principal, com texto branco AA. */
  primaryAction: '#E6171E',
  primarySoft: 'rgba(230, 23, 30, 0.20)',
  onPrimary: '#FFFFFF',
  /** Amarelo do selo de carta especial. */
  yellow: '#FFCB05',
  /** Azul claro: só texto tocável (links). */
  blue: '#8AB4FF',
  /** Valores em reais: branco (o dinheiro não tem cor). */
  money: '#FFFFFF',
  danger: '#FF8A80',
  /** Confirmação e alta (texto e ícone, AA). */
  success: '#6BE0A6',
  /** Aviso (texto e ícone, AA). */
  warning: '#FFD27A',
  /** Grafite: superfície de destaque. */
  graphite: '#232629',
  /** Foco do teclado. */
  focus: '#FFFFFF',
  /** Fundo escurecido atrás de folhas e diálogos. */
  backdrop: 'rgba(0, 0, 0, 0.72)',
  /** @deprecated use `colors.primary` (superfície) ou `colors.primaryText` (texto). */
  accent: '#E6171E',
  /** @deprecated use `colors.primarySoft`. */
  accentSoft: 'rgba(230, 23, 30, 0.20)',
  /** @deprecated use `colors.warning`. */
  gold: '#FFD27A',
};

/** Filete metálico da carta especial (o movimento assinatura do visual): só nela. */
export const foil = ['#FDF4BB', '#E4C154', '#B98F57', '#E1BD54', '#FDF4BB'] as const;

/** Gradiente da ação principal. */
export const brandGradient = ['#E6171E', '#C40D13'] as const;

/** Página do fichário: escura, como as folhas plásticas de um fichário de verdade. */
export const binderColors = {
  page: '#1E2023',
  pageBorder: '#33373C',
  pocket: '#2A2D31',
  pocketBorder: '#3D4147',
  text: '#E9EBF0',
  textMuted: '#A4AAB6',
  /** AA sobre a folha e o bolso. */
  textFaint: '#9399A5',
  /** Destaque do bolso (resultado da busca, carta recém-colocada): amarelo-claro. */
  highlight: '#FFF690',
  /** Borda e selo da carta especial (amarelo-foil). */
  special: '#FFCB05',
  /** Cápsula de preço neutra sobre a folha. */
  priceBg: 'rgba(255, 255, 255, 0.08)',
  priceFg: '#E9EBF0',
};

/**
 * Significado fixo de cada cor (AR1). As telas usam estes nomes, e não a cor solta.
 * - shell: a moldura (barras do topo) em preto, com o fio vermelho embaixo.
 * - money: dinheiro sempre branco, com algarismos tabulares (`type.numeric`).
 * - myValue: o "Meu valor" digitado; mesma tinta do dinheiro, com a marca ✎ e um selo neutro.
 * - special: carta especial (filete `foil` e selo amarelo), nada mais.
 * - progress: barras de progresso, em amarelo-claro.
 * - selected: opção escolhida (Chip, Segmented, faixa de valor): branco com texto preto.
 * - highlight/focus: destaque em amarelo-claro e foco em branco. (`onLight` é "fora da folha do fichário".)
 * - gain/loss: variação de valor (alta e queda). O gráfico fica em tinta neutra.
 * - success/warning/danger: confirmação, aviso e erro (texto, ícone e fundo suave). O fundo suave (`bg`) é opaco.
 * - link: texto tocável (azul claro).
 * - confidence: neutra; o prefixo só aparece quando acrescenta informação (≈ aproximado, ✎ Meu valor).
 * - brand: o vermelho da ação principal.
 * - inverse: avisos flutuantes (toast), claros sobre o fundo preto.
 * - tag: selos neutros (idioma PT/EN/JP, "carta base"…).
 */
export const semantic = {
  shell: { bg: '#000000', fg: '#FFFFFF', rule: '#E6171E', ruleWidth: 2 },
  money: { fg: '#FFFFFF', fgMuted: '#C4C9D0', onSheet: '#E9EBF0', onSheetMuted: '#A4AAB6', onBrand: '#FFFFFF' },
  myValue: { fg: '#FFFFFF', mark: '✎', tagBg: '#2E3236', tagFg: '#E9EBF0' },
  special: { fill: '#FFCB05', onFill: '#16181D', border: '#E4C154', soft: 'rgba(255, 203, 5, 0.18)' },
  progress: { fill: '#FFF690', track: 'rgba(255, 255, 255, 0.14)' },
  selected: { bg: '#FFFFFF', fg: '#000000', border: '#FFFFFF', soft: 'rgba(255, 255, 255, 0.12)' },
  highlight: { onSheet: '#FFF690', onLight: '#FFF690', soft: 'rgba(255, 246, 144, 0.14)' },
  focus: { ring: '#FFFFFF', onDark: '#FFFFFF', width: 2, offset: 2 },
  gain: { fg: '#6BE0A6', bg: '#12291E', onSheet: '#6BE0A6' },
  loss: { fg: '#FF9B85', bg: '#33170F', onSheet: '#FF9B85' },
  success: { fg: '#6BE0A6', bg: '#12291E', solid: '#167A45', onSolid: '#FFFFFF' },
  warning: { fg: '#FFD27A', bg: '#2E2410', solid: '#965A00', onSolid: '#FFFFFF' },
  danger: { fg: '#FF8A80', bg: '#33161A', border: 'rgba(255, 138, 128, 0.45)', solid: '#C5221F', onSolid: '#FFFFFF' },
  link: { fg: '#8AB4FF', soft: 'rgba(138, 180, 255, 0.14)', onBrand: '#FFFFFF', onInverse: '#0B5CAD' },
  confidence: {
    alta: { fg: '#FFFFFF', mark: '' },
    media: { fg: '#FFFFFF', mark: '' },
    baixa: { fg: '#C4C9D0', mark: '≈' },
  },
  brand: {
    bg: '#E6171E',
    /** Fundo escuro de cartão que antes ficava sobre a barra vermelha. */
    bgStrong: '#232629',
    action: '#E6171E',
    fg: '#FFFFFF',
    /** Botão redondo sobre a barra do topo. */
    soft: 'rgba(255, 255, 255, 0.12)',
    /** Trilho da barra de progresso sobre a barra do topo. */
    track: 'rgba(255, 255, 255, 0.14)',
  },
  inverse: { bg: '#FFFFFF', fg: '#16181D', fgMuted: '#4A4F59', action: '#B5280A' },
  tag: { bg: '#2E3236', fg: '#E9EBF0', border: '#3B4046' },
  /** Mouse por cima (web). */
  hover: { onLight: 'rgba(255, 255, 255, 0.08)', onBrand: 'rgba(255, 255, 255, 0.22)' },
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

/** Fonte de títulos (Kanit 700 itálico, licença OFL, carregada em src/app/_layout.tsx). */
export const font = { display: 'Kanit_700Bold_Italic' } as const;

// A fonte já é negrito e itálico: peso e estilo normais, senão o Android engrossa de novo.
const displayFace = { fontFamily: font.display, fontWeight: 'normal', fontStyle: 'normal' } as const;

/**
 * Escala tipográfica (AR5): 7 estilos e os números. Nada abaixo de 11 px e sem peso 900. Títulos na Kanit; texto e
 * números na fonte do sistema, que tem algarismos tabulares e abre na hora.
 * Misture com a cor: `[type.body, { color: colors.textMuted }]`.
 */
export const type = {
  /** Número grande da tela (valor da coleção). */
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  /** Título de tela ou de carta. */
  title: { fontSize: 26, lineHeight: 32, ...displayFace },
  /** Título de bloco (Section, folha de informação). */
  heading: { fontSize: 18, lineHeight: 24, letterSpacing: 0.5, textTransform: 'uppercase', ...displayFace },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  /** Rótulo em maiúsculas de um grupo de campos (nunca empilhado logo acima de um título). */
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  /** Legenda de uma linha, explicação curta, atribuição. */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** Valores e contagens: algarismos tabulares, que não "pulam" ao mudar. */
  numeric: { fontSize: 15, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  /** Número grande dentro de cartão (contagens, valores): fonte do sistema, nunca a Kanit. */
  figure: { fontSize: 26, lineHeight: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  /** Só os algarismos tabulares, para misturar com outro estilo. */
  tabular: { fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;

/** O mesmo que `type`, para quem prefere não importar um nome igual à palavra-chave do TypeScript. */
export const typography = type;

/** Espaçamentos (múltiplos de 4). */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** Alvo mínimo de toque (48 × 48, o do Android): botões, chips, ícones e links soltos (A10). */
export const TOUCH = 48;

/** hitSlop que leva um ícone de `size` px ao alvo de toque (no celular; na web use padding). */
export function hitSlopFor(size: number) {
  const s = Math.max(0, Math.ceil((TOUCH - size) / 2));
  return { top: s, bottom: s, left: s, right: s };
}

/** `card`: arte da carta; `sm` a `lg`: controles e cartões; `pill`: cápsulas. */
export const radius = { card: 4, sm: 8, md: 14, lg: 20, pill: 999 };

/** Sobre o preto a sombra não aparece: a profundidade vem dos degraus de superfície. */
export const shadow: ViewStyle = {};

/** Elevação: 0 (plano), 1 (cartão, = `shadow`), 2 (o que flutua: toast, folha de baixo). */
export const elevation: Record<0 | 1 | 2, ViewStyle> = {
  0: {},
  1: shadow,
  2: Platform.select({
    android: { elevation: 8 },
    default: { shadowColor: '#000000', shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  }) as ViewStyle,
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
