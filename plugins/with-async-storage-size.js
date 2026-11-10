// Aumenta o limite do AsyncStorage no Android (o padrão é 6 MB), gravando a propriedade em android/gradle.properties
// no prebuild. Mudar o valor exige build novo.

const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'AsyncStorage_db_size_in_MB';

module.exports = function withAsyncStorageSize(config, { sizeInMB }) {
  return withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter((item) => !(item.type === 'property' && item.key === KEY));
    c.modResults.push({ type: 'property', key: KEY, value: String(sizeInMB) });
    return c;
  });
};
