// Liga ou desliga o leitor de documentos do expo-camera no Android, gravando a propriedade em
// android/gradle.properties no prebuild. O plugin do expo-camera só tem opção para o leitor de código de barras;
// o de documentos vem ligado e põe no APK o play-services-mlkit-document-scanner (~380 KB), que o app não usa
// (nenhuma tela chama scanDocumentAsync). Mudar o valor exige build novo.

const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'expo.camera.document-scanner-enabled';

module.exports = function withCameraDocumentScanner(config, { enabled = true } = {}) {
  return withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter((item) => !(item.type === 'property' && item.key === KEY));
    // Como no plugin do expo-camera: só grava quando desligado; ligado é o padrão do build.gradle dele.
    if (enabled === false) c.modResults.push({ type: 'property', key: KEY, value: 'false' });
    return c;
  });
};
