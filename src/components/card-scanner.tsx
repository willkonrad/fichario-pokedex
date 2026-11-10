// Câmera em laço: fotografa, lê no aparelho, entrega a leitura e apaga a foto. Nada sai do aparelho.
import type { CameraView as CameraRef } from 'expo-camera';
import { useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Chip, ChipGroup, EmptyState, Loading } from '@/components/ui';
import { chainStep, type OcrPage } from '@/lib/card-ocr';
import { pickPictureSize, thumbCrop } from '@/lib/scan-lot';
import { CARD_RATIO, colors, radius, space, typography } from '@/theme';

import { isOcrAvailable, recognizeCard, type OcrResult, type OcrScript } from '../../modules/card-ocr';

/** Fotografa sozinho, sem esperar o botão. Desligar transforma o lote em manual. */
export const AUTO_SCAN = true;

export const OCR_UNAVAILABLE = 'A leitura de cartas só funciona no aplicativo instalado (APK).';

const SILENCE_MS = 20_000;
const SINGLE_HINT_MS = 4_000;
const ERROR_WAIT_MS = 300;
const IDLE_WAIT_MS = 120;
const MAX_ERRORS = 8;
const THUMB_WIDTH = 400;
/**
 * Fração do zoom máximo, que muda de aparelho para aparelho (de 4× a 30×): o rótulo não promete multiplicador nenhum. Para
 * ler a carta numa TV.
 */
const ZOOM_STEPS = [
  { label: 'Normal', value: 0 },
  { label: 'Perto', value: 0.25 },
  { label: 'Mais perto', value: 0.5 },
] as const;

/**
 * Só carregam com o módulo de leitura presente: num APK sem eles, importar estes pacotes já derrubaria a tela
 * (e a Consulta digitada importa este arquivo).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const cameraLib = () => require('expo-camera') as typeof import('expo-camera');
const filesLib = () => require('expo-file-system') as typeof import('expo-file-system');
const imageLib = () => require('expo-image-manipulator') as typeof import('expo-image-manipulator');
/* eslint-enable @typescript-eslint/no-require-imports */

export type ScanVerdict = 'keep' | 'next' | 'stop';
type Pause = 'silence' | 'limit' | 'error';

const PAUSE_TEXT: Record<Pause, string> = {
  silence: 'Toque para continuar',
  limit: 'Não consegui ler. Toque para tentar de novo',
  error: 'A câmera não respondeu. Toque para tentar de novo',
};

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

type Props = {
  mode: 'single' | 'batch';
  script: 'auto' | OcrScript;
  /** `manual`: a foto veio do botão Fotografar, então vale mesmo sem estabilizar. */
  onPage: (page: OcrResult, uri: string, manual: boolean) => Promise<ScanVerdict>;
  limitMs?: number;
  /** Desenhado dentro da moldura (última lida, dica). */
  overlay?: ReactNode;
  /** Faixa logo acima dos botões (a bandeja do lote). */
  tray?: ReactNode;
  /** Ações ao lado do Fotografar. */
  actions?: ReactNode;
};

/** Sem o módulo nativo (Expo Go, web, APK antigo), a câmera nem monta. */
export function CardScanner(p: Props): ReactElement {
  if (!isOcrAvailable) return <EmptyState title="Leitura indisponível" text={OCR_UNAVAILABLE} />;
  return <Permission {...p} />;
}

function Permission(p: Props) {
  const [permission, askPermission, checkPermission] = cameraLib().useCameraPermissions({ request: true });
  const granted = !!permission?.granted;

  // A permissão dada nos ajustes do sistema só aparece ao voltar ao app: o hook olha uma vez, ao montar.
  useEffect(() => {
    if (granted) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') checkPermission().catch(() => {});
    });
    return () => sub.remove();
  }, [granted, checkPermission]);

  if (!permission) return <Loading label="Abrindo a câmera" />;
  if (!permission.granted) {
    return (
      <EmptyState
        title="Câmera sem permissão"
        text="O app usa a câmera só para ler o texto das cartas, e a foto é apagada em seguida."
        action={<Button title={permission.canAskAgain ? 'Permitir câmera' : 'Abrir ajustes'} variant="secondary" onPress={() => (permission.canAskAgain ? askPermission() : Linking.openSettings())} />}
      />
    );
  }
  return <Capture {...p} />;
}

/** O estado pode vir "unknown" antes do primeiro aviso do sistema: só fundo e inativo contam como fora. */
const isForeground = (s: string | null | undefined) => s !== 'background' && s !== 'inactive';

/** No Android a prop `active` não existe: a câmera só fica montada com a tela à vista (a rota segue montada por baixo). */
function Capture(p: Props) {
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(isForeground(AppState.currentState));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(isForeground(s)));
    return () => sub.remove();
  }, []);

  return focused && appActive ? <LiveCapture {...p} /> : <View style={styles.root} />;
}

function LiveCapture({ mode, script, onPage, limitMs, overlay, tray, actions }: Props) {
  const { CameraView } = cameraLib();
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string>();
  const [pause, setPause] = useState<Pause | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [stopped, setStopped] = useState(false);
  // Muda ao tentar de novo depois de um erro ao abrir: só uma câmera nova sai desse erro.
  const [mountKey, setMountKey] = useState(0);
  const mountFailed = useRef(false);
  const sizeChecked = useRef(false);
  const state = useRef({
    locked: null as OcrScript | null,
    manual: false,
    errors: 0,
    startedAt: 0,
    lastText: 0,
    running: Promise.resolve() as Promise<unknown>,
  });

  /** Leitor fixo, o que já resolveu esta carta, ou a cadeia: latino, japonês, coreano, chinês. */
  async function read(uri: string): Promise<OcrResult> {
    if (script !== 'auto') return recognizeCard(uri, script);
    const s = state.current;
    if (s.locked) return recognizeCard(uri, s.locked);
    const pages = new Map<OcrScript, OcrResult>();
    let current: OcrScript = 'latin';
    for (;;) {
      const page = pages.get(current) ?? (await recognizeCard(uri, current));
      pages.set(current, page);
      const step = chainStep(current, page);
      if ('next' in step) {
        current = step.next;
        continue;
      }
      if (step.sure) s.locked = step.resolved;
      return pages.get(step.resolved) ?? recognizeCard(uri, step.resolved);
    }
  }

  function track(page: OcrResult, verdict: ScanVerdict) {
    const s = state.current;
    const now = Date.now();
    if (page.lines.length) s.lastText = now;
    if (!page.lines.length || verdict !== 'keep') s.locked = null;
    if (verdict === 'stop') setStopped(true);
    else if (limitMs && now - s.startedAt > limitMs) setPause('limit');
    else if (now - s.lastText > SILENCE_MS) setPause('silence');
    if (mode === 'single') setHint(now - s.startedAt > SINGLE_HINT_MS ? 'Aproxime ou incline um pouco' : null);
  }

  const takeOne = useEffectEvent(async (): Promise<ScanVerdict | null> => {
    const cam = camera.current;
    if (!cam) return null;
    const s = state.current;
    const manual = s.manual;
    s.manual = false;
    let uri: string | undefined;
    try {
      const photo = await cam.takePictureAsync({ shutterSound: false, skipProcessing: true });
      uri = photo.uri;
      const page = await read(uri);
      const verdict = await onPage(page, uri, manual);
      s.errors = 0;
      track(page, verdict);
      return verdict;
    } catch {
      s.errors++;
      if (s.errors >= MAX_ERRORS) setPause('error');
      return null;
    } finally {
      if (uri) removeFile(uri);
    }
  });

  // Uma foto de cada vez; ao voltar do fundo ou da pausa, o laço novo espera a foto que ainda estiver em andamento.
  useEffect(() => {
    if (!ready || pause || stopped) return;
    let alive = true;
    const s = state.current;
    s.startedAt = Date.now();
    s.lastText = s.startedAt;
    s.errors = 0;
    (async () => {
      while (alive) {
        if (!AUTO_SCAN && !s.manual) {
          await wait(IDLE_WAIT_MS);
          continue;
        }
        const run = s.running.then(() => (alive ? takeOne() : null));
        s.running = run.catch(() => null);
        const verdict = await run;
        if (verdict === null) await wait(ERROR_WAIT_MS);
        if (verdict === 'stop') return;
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, pause, stopped]);

  async function onCameraReady() {
    if (!sizeChecked.current) {
      sizeChecked.current = true;
      try {
        const best = pickPictureSize((await camera.current?.getAvailablePictureSizesAsync()) ?? []);
        if (best) setPictureSize(best);
      } catch {
        // Sem a lista, fica o tamanho padrão da câmera.
      }
    }
    setReady(true);
  }

  function resume() {
    setPause(null);
    if (!mountFailed.current) return;
    mountFailed.current = false;
    setMountKey((k) => k + 1);
  }

  function shoot() {
    state.current.manual = true;
    resume();
  }

  function onMountError() {
    mountFailed.current = true;
    setReady(false);
    setPause('error');
  }

  const frameH = Math.max(0, Math.min(area.h - space.xl * 2, (area.w - space.xl * 2) / CARD_RATIO));
  const frameW = frameH * CARD_RATIO;

  return (
    <View style={styles.root}>
      <View style={styles.preview} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <CameraView
          key={mountKey}
          ref={camera}
          style={StyleSheet.absoluteFill}
          animateShutter={false}
          pictureSize={pictureSize}
          zoom={ZOOM_STEPS[zoom].value}
          onCameraReady={onCameraReady}
          onMountError={onMountError}
        />
        <View style={styles.center} pointerEvents="box-none">
          <View style={[styles.frame, { width: frameW, height: frameH }]} aria-hidden={!overlay && !hint}>
            <View style={styles.frameInfo}>
              {hint ? <Text style={styles.hint}>{hint}</Text> : null}
              {overlay}
            </View>
          </View>
        </View>
        {pause ? (
          <Pressable style={styles.paused} onPress={resume} role="button" accessibilityLabel={PAUSE_TEXT[pause]}>
            <Text style={styles.pausedText}>{PAUSE_TEXT[pause]}</Text>
          </Pressable>
        ) : !ready ? (
          <View style={styles.paused} pointerEvents="none">
            <Text style={styles.pausedText}>Abrindo a câmera…</Text>
          </View>
        ) : null}
      </View>
      {mode === 'single' ? (
        <ChipGroup label="Aproximação" style={styles.zoomRow}>
          {ZOOM_STEPS.map((z, i) => (
            <Chip key={z.label} label={z.label} accessibilityLabel={`Aproximação ${z.label}`} selected={zoom === i} onPress={() => setZoom(i)} />
          ))}
        </ChipGroup>
      ) : null}
      {tray}
      <View style={styles.controls}>
        <Chip label="Fotografar" icon="camera-outline" mode="button" onPress={shoot} />
        {actions}
      </View>
    </View>
  );
}

/** Apaga um arquivo temporário; se já não existe, tudo bem. */
export function removeFile(uri: string) {
  try {
    const file = new (filesLib().File)(uri);
    if (file.exists) file.delete();
  } catch {
    // A pasta temporária é limpa pelo sistema.
  }
}

function scanDir(lot?: string) {
  const { Directory, Paths } = filesLib();
  return lot ? new Directory(Paths.cache, 'scan', lot) : new Directory(Paths.cache, 'scan');
}

/** Recorte de 400 px da carta aceita, em `Paths.cache/scan/<lote>/`. Falhou: a carta segue sem miniatura. */
export async function saveThumb(uri: string, page: OcrPage, lot: string, id: string): Promise<string | undefined> {
  try {
    const { ImageManipulator, SaveFormat } = imageLib();
    const { File } = filesLib();
    const context = ImageManipulator.manipulate(uri);
    const loaded = await context.renderAsync();
    const crop = thumbCrop(page, loaded.width, loaded.height);
    if (crop) context.crop(crop);
    context.resize({ width: THUMB_WIDTH });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
    const dir = scanDir(lot);
    dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, `${id}.jpg`);
    await new File(saved.uri).move(target, { overwrite: true });
    return target.uri;
  } catch {
    return undefined;
  }
}

/** Apaga as miniaturas de todos os lotes. */
export function clearScanFiles() {
  try {
    const dir = scanDir();
    if (dir.exists) dir.delete();
  } catch {
    // A pasta temporária é limpa pelo sistema.
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  preview: { flex: 1, overflow: 'hidden', backgroundColor: colors.surface },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { borderWidth: 2, borderColor: colors.text, borderRadius: radius.md, justifyContent: 'flex-end', overflow: 'hidden' },
  frameInfo: { gap: space.xs, padding: space.sm, alignItems: 'center' },
  hint: { ...typography.caption, color: colors.text, backgroundColor: colors.backdrop, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm },
  paused: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.backdrop },
  pausedText: { ...typography.bodyStrong, color: colors.text, textAlign: 'center' },
  zoomRow: { paddingHorizontal: space.lg, paddingTop: space.sm, justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
});
