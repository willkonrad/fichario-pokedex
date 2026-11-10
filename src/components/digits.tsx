import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';

import { typography } from '@/theme';

// Número inteiro ("12", "#025", "1.234,56"); o separador só conta entre algarismos.
const NUMBER = /(#?\d+(?:[.,]\d+)*)/;

/**
 * Conteúdo de um título em Kanit com os números na fonte do sistema, tabulares (número nunca em Kanit). Fica dentro do
 * <Text> do título, então o texto continua um só para o leitor de tela.
 */
export function digitsInSystemFont(title: string): ReactNode {
  const parts = title.split(NUMBER);
  if (parts.length === 1) return title;
  // Com o grupo de captura no split, os índices ímpares são os números.
  return parts.map((part, i) =>
    i % 2 ? (
      <Text key={i} style={styles.digits}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

const styles = StyleSheet.create({
  digits: {
    ...typography.tabular,
    // O trecho aninhado herda a Kanit: a fonte precisa ser dita. 'System' a web troca pela lista de fontes do sistema.
    fontFamily: Platform.select({ android: 'sans-serif', default: 'System' }),
    fontWeight: '700',
    fontStyle: 'normal',
  },
});
