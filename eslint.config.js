// https://docs.expo.dev/guides/using-eslint/
// Checa o projeto inteiro (npx eslint . ou npm run lint): o app, os testes, as Edge Functions (Deno) e os scripts.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/** Globais do Node usados pelos scripts de linha de comando (scripts/). */
const NODE_GLOBALS = {
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  exports: 'writable',
  module: 'writable',
  process: 'readonly',
  require: 'readonly',
};

module.exports = defineConfig([
  expoConfig,
  {
    // Gerados (build da web, tipos do Expo Router) e o que a CLI do Supabase guarda no aparelho.
    ignores: ['dist/*', 'web-build/*', '.expo/', 'supabase/.temp/'],
  },
  {
    // Edge Functions (Deno): importam pacotes por "npm:"/"jsr:" (o Deno resolve, o eslint não) e usam o global Deno.
    files: ['supabase/functions/**/*.ts'],
    languageOptions: { globals: { Deno: 'readonly' } },
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^npm:', '^jsr:', '^https?://'] }],
    },
  },
  {
    // Scripts em Node (CommonJS), rodados à mão: node scripts/<nome>.js
    files: ['scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: NODE_GLOBALS },
    // make-icons.js junta atribuições com vírgula ("(col = …), (alpha = 1)") no laço de pixels.
    rules: { 'no-unused-expressions': 'off' },
  },
]);
