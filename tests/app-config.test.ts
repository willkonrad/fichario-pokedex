/**
 * @jest-environment node
 */
// Configuração nativa do APK: roda os plugins do app.json como o `npx expo config --type introspect` e confere o que
// eles gravam em android/gradle.properties. Partes nativas que o app não usa ficam fora do APK:
// - leitor de código de barras do ML Kit no expo-camera (~5,8 MB: libbarhopper_v3.so e modelos .tflite);
// - leitor de documentos do expo-camera (~380 KB);
// - GIF e WebP do <Image> do React Native (Fresco, ~0,8 MB de .so): o app só usa o expo-image, que usa o Glide.

import app from '../app.json';
import withCameraDocumentScanner from '../plugins/with-camera-document-scanner';

type GradleItem = { type: 'property'; key: string; value: string } | { type: 'comment' | 'empty'; value?: string };
type Plugin = string | [string, Record<string, unknown>];

// O projeto não instala @types/node: só o que o teste usa.
declare const __dirname: string;
const { resolve } = jest.requireActual<{ resolve(...parts: string[]): string }>('path');

const ROOT = resolve(__dirname, '..');

function properties(items: GradleItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of items) if (item.type === 'property') out[item.key] = item.value;
  return out;
}

// O mesmo caminho do `expo config --type introspect`, sem pasta android/ (o gradle.properties começa vazio e só
// mostra o que os plugins gravam).
async function introspectGradleProperties(): Promise<Record<string, string>> {
  const { getPrebuildConfigAsync } = jest.requireActual<{
    getPrebuildConfigAsync(root: string, options: { platforms: string[] }): Promise<{ exp: unknown }>;
  }>('@expo/prebuild-config');
  const { compileModsAsync } = jest.requireActual<{
    compileModsAsync(
      exp: unknown,
      options: { projectRoot: string; introspect: boolean; platforms: string[]; assertMissingModProviders: boolean },
    ): Promise<{ _internal: { modResults: { android: { gradleProperties: GradleItem[] } } } }>;
  }>('@expo/config-plugins/build/plugins/mod-compiler.js');
  const { exp } = await getPrebuildConfigAsync(ROOT, { platforms: ['android'] });
  const config = await compileModsAsync(exp, {
    projectRoot: ROOT,
    introspect: true,
    platforms: ['android'],
    assertMissingModProviders: false,
  });
  return properties(config._internal.modResults.android.gradleProperties);
}

function pluginOptions(name: string): Record<string, unknown> | undefined {
  const entry = (app.expo.plugins as Plugin[]).find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(entry) ? entry[1] : undefined;
}

describe('app.json: partes nativas fora do APK', () => {
  test('o expo-camera vai sem o leitor de código de barras e sem gravar áudio', () => {
    expect(pluginOptions('expo-camera')).toEqual({ recordAudioAndroid: false, barcodeScannerEnabled: false });
  });

  test('os plugins gravam as propriedades que tiram ML Kit e Fresco do build', async () => {
    const props = await introspectGradleProperties();
    // Lidas pelo android/build.gradle do expo-camera: "false" troca implementation por compileOnly.
    expect(props['expo.camera.barcode-scanner-enabled']).toBe('false');
    expect(props['expo.camera.document-scanner-enabled']).toBe('false');
    // Lidas pelo android/app/build.gradle do template: só "true" põe animated-gif e webpsupport no APK.
    expect(props['expo.gif.enabled']).toBe('false');
    expect(props['expo.webp.enabled']).toBe('false');
    // O que já estava continua.
    expect(props.reactNativeArchitectures).toBe('arm64-v8a');
    expect(props.AsyncStorage_db_size_in_MB).toBe('50');
  }, 60000);
});

describe('plugins/with-camera-document-scanner', () => {
  // Roda só o mod do plugin sobre uma lista de propriedades, sem o resto do prebuild.
  async function run(options: { enabled?: boolean } | undefined, start: GradleItem[]) {
    const config = withCameraDocumentScanner({ name: 't', slug: 't' } as never, options as never) as unknown as {
      mods: { android: { gradleProperties: (c: unknown) => Promise<{ modResults: GradleItem[] }> } };
    };
    const out = await config.mods.android.gradleProperties({
      modResults: start,
      modRequest: { platform: 'android', modName: 'gradleProperties', projectRoot: ROOT, introspect: true },
    });
    return out.modResults;
  }

  const KEY = 'expo.camera.document-scanner-enabled';

  test('desligado grava "false" uma vez só, mesmo rodando de novo sobre a lista', async () => {
    const once = await run({ enabled: false }, [{ type: 'property', key: 'outra', value: '1' }]);
    const twice = await run({ enabled: false }, once);
    expect(twice.filter((i) => i.type === 'property' && i.key === KEY)).toHaveLength(1);
    expect(properties(twice)).toEqual({ outra: '1', [KEY]: 'false' });
  });

  test('ligado (ou sem opção) tira a propriedade e deixa o padrão do expo-camera', async () => {
    const start: GradleItem[] = [{ type: 'property', key: KEY, value: 'false' }];
    expect(properties(await run({ enabled: true }, start))).toEqual({});
    expect(properties(await run(undefined, start))).toEqual({});
  });
});

describe('fim de linha dos arquivos que entram no fingerprint', () => {
  // O @expo/fingerprint lê os plugins locais byte a byte: um plugin em LF numa cópia do Windows (onde o git grava CRLF)
  // muda o runtimeVersion na próxima vez que o git reescrever o arquivo, e o `eas update` não chega mais ao APK. Cada
  // um tem de estar como o git grava nesta cópia (o fim de linha do tsconfig.json, que ninguém edita).
  const { readFileSync, readdirSync } = jest.requireActual<{ readFileSync(p: string, enc: string): string; readdirSync(p: string): string[] }>('fs');
  const eolOf = (file: string) => {
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    const crlf = (text.match(/\r\n/g) ?? []).length;
    const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
    return crlf && !lf ? 'crlf' : lf && !crlf ? 'lf' : 'misturado';
  };

  test('plugins/, app.json e eas.json com o mesmo fim de linha da cópia do git', () => {
    const expected = eolOf('tsconfig.json');
    expect(expected).not.toBe('misturado');
    const files = [...readdirSync(resolve(ROOT, 'plugins')).map((f) => `plugins/${f}`), 'app.json', 'eas.json'];
    expect(files).toContain('plugins/with-camera-document-scanner.js');
    for (const file of files) expect([file, eolOf(file)]).toEqual([file, expected]);
  });
});
