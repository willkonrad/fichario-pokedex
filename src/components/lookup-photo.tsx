// Foto e print na Consulta: o que foi lido vira texto no mesmo campo. Nada é gravado e a imagem não sai do aparelho.
import { useEffect, useEffectEvent, useRef, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardScanner, OCR_UNAVAILABLE, removeFile } from '@/components/card-scanner';
import { Button, EmptyState, IconButton, Loading } from '@/components/ui';
import { printLang, readCard, readPrint, type CardReading, type Dictionaries, type OcrPage } from '@/lib/card-ocr';
import type { LookupCard, LookupLang } from '@/lib/lookup-types';
import { shouldAccept } from '@/lib/scan-lot';
import { matchReading, ocrDictionaries, readingNote, relaxedQuery, type LotLang, type ScanMatch } from '@/lib/scan-match';
import { colors, space } from '@/theme';

import { isOcrAvailable, recognizeCard, type OcrResult, type OcrScript } from '../../modules/card-ocr';

const PHOTO_LIMIT_MS = 6_000;
const READERS: OcrScript[] = ['latin', 'japanese', 'korean', 'chinese'];
const READER_OF: Record<LookupLang, OcrScript> = { pt: 'latin', en: 'latin', ja: 'japanese', ko: 'korean', zh: 'chinese' };
const LANG_TOKEN: Record<'pt' | 'ja' | 'ko' | 'zh', string> = { pt: 'pt', ja: 'jp', ko: 'ko', zh: 'zh' };

/** `open`: a carta lida com certeza; `openLang`: o idioma em que ela foi lida (coreana nunca abre como japonesa). */
export type LookupPhotoResult = { text: string; note: string; open?: LookupCard; openLang?: LookupLang; others?: number[] };
type Props = { mode: 'photo' | 'print'; lang: LookupLang | null; onResult: (r: LookupPhotoResult) => void; onCancel: () => void };

const NOT_READ = 'Não consegui ler o nome da carta';

/** Monta o resultado: o texto com o que deu resultado, o aviso do que saiu e o idioma que a escrita entregou. */
function buildResult(
  read: { dex: number | null; name: string | null; hp: number | null; number: CardReading['number'] },
  lang: LookupLang | null,
  detected: 'pt' | 'ja' | 'ko' | 'zh' | null,
  extra: Pick<LookupPhotoResult, 'open' | 'openLang' | 'others'>,
): LookupPhotoResult {
  const { text, dropped } = relaxedQuery(read, lang ?? detected);
  const token = !lang && detected && text ? ` ${LANG_TOKEN[detected]}` : '';
  const note = readingNote(read);
  return { text: `${text}${token}`, note: dropped ? `${note} · ${dropped}` : note, ...extra };
}

function readingDetected(r: CardReading): 'pt' | 'ja' | 'ko' | 'zh' | null {
  if (r.script === 'kana') return 'ja';
  if (r.script === 'hangul') return 'ko';
  if (r.script === 'hanzi') return 'zh';
  return r.hpWord === 'PS' ? 'pt' : null;
}

const lotLangOf = (lang: LookupLang | null): LotLang => (lang === 'pt' || lang === 'en' || lang === 'ja' ? lang : 'auto');

function resultOfCard(r: CardReading, match: ScanMatch, lang: LookupLang | null) {
  const open = match.status === 'exact' ? match.candidates[0] : undefined;
  return buildResult({ dex: r.speciesId, name: r.name, hp: r.hp, number: r.number }, lang, readingDetected(r), { open, openLang: open && match.lang ? match.lang : undefined });
}

export function LookupPhoto(p: Props): ReactElement | null {
  if (!isOcrAvailable) return <EmptyState title="Leitura indisponível" text={OCR_UNAVAILABLE} action={<Button title="Voltar" variant="secondary" onPress={p.onCancel} />} />;
  return p.mode === 'photo' ? <PhotoRead {...p} /> : <PrintRead {...p} />;
}

function PhotoRead({ lang, onResult, onCancel }: Props) {
  const history = useRef<CardReading[]>([]);

  async function onPage(page: OcrResult, _uri: string, manual: boolean) {
    // A cada foto, e não ao montar: a câmera pode abrir antes de o índice chegar (o dicionário fica guardado por índice).
    const reading = readCard(page, ocrDictionaries());
    history.current.push(reading);
    const match = matchReading(reading, { lotLang: lotLangOf(lang) });
    const useful = !!(reading.number || reading.speciesId || reading.name);
    if (!useful && !manual) return 'keep' as const;
    if (!manual && !shouldAccept(history.current, match)) return 'keep' as const;
    onResult(useful ? resultOfCard(reading, match, lang) : { text: '', note: NOT_READ });
    return 'stop' as const;
  }

  return (
    <View style={styles.fill}>
      <CardScanner mode="single" script={lang ? READER_OF[lang] : 'auto'} onPage={onPage} limitMs={PHOTO_LIMIT_MS} />
      <IconButton icon="close" label="Fechar a câmera" tone="soft" onPress={onCancel} style={styles.close} />
    </View>
  );
}

/** Lê com o leitor do chip ou tenta um por um, até algum achar uma espécie. */
async function readImage(uri: string, lang: LookupLang | null, dict: Dictionaries) {
  const readers = lang ? [READER_OF[lang]] : READERS;
  let best: { page: OcrPage; print: ReturnType<typeof readPrint> } | null = null;
  for (const script of readers) {
    const page = await recognizeCard(uri, script);
    const print = readPrint(page, dict);
    if (print.dex != null) return { page, print };
    if (!best || (!best.print.number && print.number)) best = { page, print };
  }
  return best;
}

function PrintRead({ lang, onResult, onCancel }: Props) {
  const started = useRef(false);

  const run = useEffectEvent(async () => {
    try {
      // Só carrega aqui: num APK sem o pacote, importar já derrubaria a Consulta.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
      // Sem `allowsEditing`: o seletor do sistema abre sem pedir permissão e os prints recentes vêm primeiro.
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
      if (picked.canceled || !picked.assets.length) return onCancel();
      const { uri } = picked.assets[0];
      try {
        const got = await readImage(uri, lang, ocrDictionaries());
        if (!got || (got.print.dex == null && !got.print.number)) return onResult({ text: '', note: NOT_READ });
        onResult(buildResult(got.print, lang, printLang(got.page), { others: got.print.others }));
      } finally {
        removeFile(uri);
      }
    } catch {
      onResult({ text: '', note: 'Não consegui ler esta imagem' });
    }
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, []);

  return <Loading label="Lendo a imagem" />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  close: { position: 'absolute', top: space.sm, right: space.sm },
});
