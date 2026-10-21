import { Platform } from 'react-native';

/**
 * Tema "Pokédex": fundo claro e cartões brancos (como a interface do Nintendo Switch), vermelho Pokémon
 * nas barras e ações principais, amarelo e azul do logo Pokémon como destaques.
 */
export const colors = {
  background: '#F1F2F6',
  surface: '#FFFFFF',
  surfaceAlt: '#EBEDF2',
  border: '#DFE2E9',
  text: '#16181D',
  textMuted: '#5A606D',
  textFaint: '#969CA8',
  /** Vermelho Pokémon: barras do topo e ações principais. */
  primary: '#E3350D',
  primaryDark: '#B5280A',
  primarySoft: 'rgba(227, 53, 13, 0.10)',
  onPrimary: '#FFFFFF',
  /** Amarelo do logo Pokémon (destaques sobre o vermelho). */
  yellow: '#FFCB05',
  /** Azul do logo Pokémon (links e informação). */
  blue: '#2F5BD3',
  /** Valores em reais. */
  money: '#1A7F4B',
  danger: '#D93025',
  success: '#1E9E5A',
  warning: '#B26B00',
  // Aliases usados pelas telas.
  accent: '#E3350D',
  accentSoft: 'rgba(227, 53, 13, 0.10)',
  gold: '#B26B00',
};

/** Página do fichário: escura, como as folhas plásticas de um fichário de verdade. */
export const binderColors = {
  page: '#22262E',
  pageBorder: '#323844',
  pocket: '#2B303A',
  pocketBorder: '#3A414E',
  text: '#E9EBF0',
  textMuted: '#A4AAB6',
  textFaint: '#6C7380',
};

/** Confiança do valor: verde (alta), âmbar (média), cinza (baixa). */
export const confidenceColors = {
  light: { alta: '#1E9E5A', media: '#B26B00', baixa: '#7A808C' },
  /** Sobre a página escura do fichário. */
  dark: {
    alta: { bg: 'rgba(76, 195, 138, 0.20)', fg: '#6BE0A6' },
    media: { bg: 'rgba(255, 203, 5, 0.18)', fg: '#FFD84D' },
    baixa: { bg: 'rgba(164, 170, 182, 0.16)', fg: '#B8BDC8' },
  },
};

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' });

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };

/** Sombra leve dos cartões brancos (iOS/web) e elevação (Android). */
export const shadow = Platform.select({
  android: { elevation: 2 },
  default: { shadowColor: '#0B1020', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
});

// Proporção real de uma carta (63 × 88 mm).
export const CARD_RATIO = 63 / 88;

/** Largura máxima do conteúdo em telas grandes (tablet, web). */
export const MAX_WIDTH = 720;
