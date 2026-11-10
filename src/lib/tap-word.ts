import { Platform } from 'react-native';

/** "Toque" no celular, "Clique" no navegador (W3), no começo da frase (`Tap`) ou no meio dela (`tap`). */
export function tapWord(web: boolean) {
  const Tap = web ? 'Clique' : 'Toque';
  return { Tap, tap: Tap.toLowerCase() };
}

export const { Tap: TAP, tap: TAP_LOWER } = tapWord(Platform.OS === 'web');
