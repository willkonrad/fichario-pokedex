// Testes de unidade (jest-expo) da lógica pura que decide o que aparece na tela: valor e preço das cartas, posição no
// fichário, códigos de carta, cópias da coleção. Os testes ficam em tests/ (*.test.ts). Rode com: npm test
// Docs: https://docs.expo.dev/develop/unit-testing/ (o jest-expo lê os atalhos "@/..." dos paths do tsconfig).

// Datas no fuso do usuário (os workers do jest herdam o ambiente), para os testes de dia e hora não mudarem de máquina.
process.env.TZ = 'America/Sao_Paulo';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/**/*.test.ts?(x)'],
  setupFiles: ['<rootDir>/tests/setup.ts'],
};
