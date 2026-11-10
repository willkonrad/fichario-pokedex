import { requireOptionalNativeModule } from 'expo';

export type OcrScript = 'latin' | 'japanese' | 'korean' | 'chinese';
export type OcrBox = { x: number; y: number; w: number; h: number };
export type OcrWord = { text: string; box: OcrBox | null };
export type OcrLine = { text: string; block: number; box: OcrBox | null; angle: number; confidence: number; lang: string; words: OcrWord[] };
export type OcrResult = { width: number; height: number; ms: number; lines: OcrLine[] };

type NativeCardOcr = { recognize(uri: string, script: OcrScript): Promise<OcrResult> };

// null no Expo Go, na web e em APK antigo: nada quebra, a função só não aparece.
const native = requireOptionalNativeModule<NativeCardOcr>('CardOcr');

export const isOcrAvailable = native != null;

export function recognizeCard(uri: string, script: OcrScript = 'latin'): Promise<OcrResult> {
  if (!native) return Promise.reject(new Error('A leitura de cartas só funciona no aplicativo instalado (APK).'));
  return native.recognize(uri, script);
}
