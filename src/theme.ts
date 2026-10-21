import { Platform } from 'react-native';

export const colors = {
  background: '#0B0B0D',
  surface: '#17171A',
  surfaceAlt: '#1F1F23',
  border: '#2A2A2F',
  text: '#F2F2F4',
  textMuted: '#8A8A93',
  textFaint: '#55555D',
  accent: '#F5A524',
  accentSoft: 'rgba(245, 165, 36, 0.15)',
  gold: '#E8C25A',
  danger: '#F06262',
  success: '#4CC38A',
};

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' });

export const radius = { sm: 8, md: 14, lg: 20 };

// Proporção real de uma carta (63 × 88 mm).
export const CARD_RATIO = 63 / 88;
