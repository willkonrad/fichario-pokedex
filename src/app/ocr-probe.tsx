// Tela de medida: só para o primeiro APK. Tira foto, lê, mostra as linhas e o tempo e exporta o JSON da leitura.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, Loading, Notice, Segmented } from '@/components/ui';
import { colors, space, typography } from '@/theme';

import { isOcrAvailable, recognizeCard, type OcrResult, type OcrScript } from '../../modules/card-ocr';

const SCRIPTS: readonly { id: OcrScript; label: string }[] = [
  { id: 'latin', label: 'Latino' },
  { id: 'japanese', label: 'Japonês' },
  { id: 'korean', label: 'Coreano' },
  { id: 'chinese', label: 'Chinês' },
];

type Reading = { script: OcrScript; captureMs: number; result: OcrResult };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function OcrProbe() {
  return (
    <>
      <Stack.Screen options={{ title: 'Medida da leitura' }} />
      {/* Sem o módulo (Expo Go, web, APK antigo), a câmera nem é consultada. */}
      {isOcrAvailable ? (
        <Probe />
      ) : (
        <EmptyState title="Leitura indisponível" text="A leitura de cartas só funciona no aplicativo instalado (APK)." />
      )}
    </>
  );
}

function Probe() {
  const insets = useSafeAreaInsets();
  const [permission, askPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [script, setScript] = useState<OcrScript>('latin');
  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!permission) return <Loading label="Abrindo a câmera" />;
  if (!permission.granted) {
    return (
      <EmptyState
        title="Câmera sem permissão"
        text="Esta tela precisa da câmera para fotografar a carta."
        action={
          <Button
            title={permission.canAskAgain ? 'Permitir câmera' : 'Abrir ajustes'}
            onPress={() => (permission.canAskAgain ? askPermission() : Linking.openSettings())}
          />
        }
      />
    );
  }

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      const startedAt = Date.now();
      const photo = await camera.current?.takePictureAsync({ shutterSound: false, skipProcessing: true });
      const captureMs = Date.now() - startedAt;
      if (photo) setReading({ script, captureMs, result: await recognizeCard(photo.uri, script) });
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  const exportJson = () => {
    if (reading) Share.share({ message: JSON.stringify(reading) }).catch((e) => setError(errorText(e)));
  };

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + space.sm }]}>
      <CameraView ref={camera} style={styles.camera} animateShutter={false} />
      <View style={styles.controls}>
        <Segmented label="Escrita da leitura" options={SCRIPTS} value={script} onChange={setScript} />
        <View style={styles.actions}>
          <Button title="Ler carta" onPress={read} busy={busy} style={styles.action} />
          <Button title="Exportar JSON" variant="secondary" onPress={exportJson} disabled={!reading} style={styles.action} />
        </View>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </View>
      <ScrollView style={styles.lines} contentContainerStyle={styles.linesContent}>
        {reading ? (
          <Text style={styles.timing}>
            foto {reading.captureMs} ms · OCR {reading.result.ms} ms · {reading.result.width}×{reading.result.height}
          </Text>
        ) : (
          <Text style={styles.line}>Aponte para a carta e toque em Ler carta.</Text>
        )}
        {reading?.result.lines.map((l, i) => (
          <Text key={i} style={styles.line}>
            {JSON.stringify([l.text, l.box, l.angle, l.confidence, l.lang])}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: space.sm },
  camera: { flex: 1 },
  controls: { gap: space.sm, paddingHorizontal: space.lg },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flexGrow: 1 },
  lines: { flex: 1 },
  linesContent: { gap: space.xs, paddingHorizontal: space.lg },
  timing: { ...typography.numeric, color: colors.text },
  line: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
});
