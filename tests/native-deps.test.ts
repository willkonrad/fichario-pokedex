// Bibliotecas que o app não usa ficam fora do APK (revisão de tamanho antes do primeiro build):
// - expo-symbols não fica instalado: o expo-router o carrega quando existe (require opcional) e o Metro punha no APK
//   a fonte Material Symbols (971 KB) e o symbols.json, só usados pelos ícones "md" das NativeTabs.
// - reanimated, worklets e gesture-handler continuam instalados (o react-native-drawer-layout do expo-router os exige
//   como peers, e o npm os reinstalaria), mas saem do autolinking: o EAS não compila o C++ deles nem põe as .so no APK.
// Quem passar a usar um deles tira o nome de "expo.autolinking.exclude" no package.json e gera um build novo; sem isso o
// app quebra no aparelho (módulo nativo ausente), e este teste avisa antes.
// O projeto não tem @types/node: só os tipos do que o teste usa.
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { recursive: true; encoding: 'utf8' }): string[];
}>('fs');
const { execFileSync } = jest.requireActual<{
  execFileSync(
    file: string,
    args: string[],
    options: { cwd: string; encoding: 'utf8'; timeout: number; windowsHide: boolean },
  ): string;
}>('child_process');
declare const process: { execPath: string };
const root = expect.getState().testPath!.replace(/[\\/]tests[\\/][^\\/]+$/, '');
const readJson = (path: string) => JSON.parse(fs.readFileSync(`${root}/${path}`, 'utf8'));

const EXCLUDED_NATIVE = ['react-native-gesture-handler', 'react-native-reanimated', 'react-native-worklets'];
const UNINSTALLED = ['expo-symbols', '@expo-google-fonts/material-symbols'];
// Telas do expo-router que dependem dessas bibliotecas (Drawer exige gestos e reanimated; NativeTabs usa expo-symbols).
const ROUTER_ENTRIES = ['expo-router/drawer', 'expo-router/unstable-native-tabs'];

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');

/** Arquivos de código do app (o que vai para o bundle), sem node_modules. */
function appSources(): string[] {
  const files = ['index.ts'];
  for (const dir of ['src', 'modules']) {
    const entries = fs.readdirSync(`${root}/${dir}`, { recursive: true, encoding: 'utf8' });
    for (const entry of entries) {
      const path = `${dir}/${entry.replace(/\\/g, '/')}`;
      if (/\.(ts|tsx|js|jsx)$/.test(path) && !path.includes('/node_modules/')) files.push(path);
    }
  }
  return files;
}

/** Nomes importados pelo arquivo: import … from 'x', import 'x', import('x'), require('x'), export … from 'x'. */
function importedNames(code: string): string[] {
  const names: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const match of code.matchAll(re)) names.push(match[1]);
  return names;
}

describe('dependências nativas fora do APK', () => {
  it('expo-symbols e a fonte Material Symbols não ficam instalados', () => {
    for (const name of UNINSTALLED) {
      expect(pkg.dependencies[name]).toBeUndefined();
      expect(pkg.devDependencies[name]).toBeUndefined();
      // O EAS instala pelo lock (npm ci): sem a entrada, a fonte não volta ao bundle por outro caminho.
      expect(lock.packages[`node_modules/${name}`]).toBeUndefined();
    }
  });

  it('reanimated, worklets e gesture-handler ficam fora do autolinking', () => {
    expect([...pkg.expo.autolinking.exclude].sort()).toEqual(EXCLUDED_NATIVE);
  });

  it('o código do app não importa o que ficou fora do APK', () => {
    const forbidden = [...EXCLUDED_NATIVE, ...UNINSTALLED, 'react-native-drawer-layout'];
    const files = appSources();
    expect(files.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const file of files) {
      const code = fs.readFileSync(`${root}/${file}`, 'utf8');
      for (const name of importedNames(code)) {
        const hit =
          forbidden.some((f) => name === f || name.startsWith(`${f}/`)) ||
          ROUTER_ENTRIES.some((e) => name === e || name.startsWith(`${e}/`));
        if (hit) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('o comando de autolinking do Gradle não liga as três bibliotecas no Android', () => {
    // O mesmo comando que o expo-autolinking-settings-plugin roda no build Android (rnConfigCommand).
    const out = execFileSync(
      process.execPath,
      [
        '--no-warnings',
        '--eval',
        "require('expo/bin/autolinking')",
        'expo-modules-autolinking',
        'react-native-config',
        '--platform',
        'android',
        '--json',
      ],
      { cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true },
    );
    const linked = Object.keys(JSON.parse(out).dependencies);
    // O que o app usa continua ligado (sem isso o teste passaria com uma lista vazia).
    expect(linked).toEqual(expect.arrayContaining(['react-native-screens', 'react-native-safe-area-context', 'react-native-svg']));
    for (const name of EXCLUDED_NATIVE) expect(linked).not.toContain(name);
  }, 60_000);
});
