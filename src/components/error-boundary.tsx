import { router, usePathname, type ErrorBoundaryProps } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PokeballIcon } from '@/components/icons';
import { Button } from '@/components/ui';
import { colors, radius, space, TOUCH, typography } from '@/theme';

/**
 * Tela amigável no lugar de uma tela que quebrou (G2): diz o que houve em português, garante que as cartas
 * continuam salvas e oferece tentar de novo. O erro técnico fica em "Detalhes", para quando for preciso relatar.
 */
function ErrorScreen({
  error,
  retry,
  secondary,
  topInset = 0,
}: {
  error: Error;
  retry: () => unknown;
  secondary?: { title: string; onPress: () => void };
  topInset?: number;
}) {
  const [details, setDetails] = useState(false);
  const message = `${error?.name ?? 'Erro'}: ${error?.message ?? String(error)}`;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: topInset + space.xxl }]}>
      <View style={styles.inner} role="alert">
        <PokeballIcon size={48} color={colors.iconFaint} />
        <Text style={styles.title} role="heading">
          Algo deu errado
        </Text>
        <Text style={styles.text}>Esta tela encontrou um erro e não pôde ser mostrada. Suas cartas continuam salvas.</Text>
        <View style={styles.actions}>
          <Button title="Tentar de novo" icon="refresh" onPress={() => void retry()} />
          {secondary ? <Button title={secondary.title} variant="secondary" onPress={secondary.onPress} /> : null}
        </View>
        <Pressable
          onPress={() => setDetails((d) => !d)}
          role="button"
          aria-expanded={details}
          style={({ pressed }) => [styles.detailsToggle, pressed && { opacity: 0.6 }]}>
          <Text style={styles.detailsToggleText}>{details ? 'Esconder detalhes' : 'Detalhes do erro'}</Text>
        </Pressable>
        {details ? (
          <Text style={styles.details} selectable>
            {message}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** Erro numa tela (o cabeçalho continua, com o voltar): tentar de novo ou voltar ao fichário. */
export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const home = pathname === '/';
  return (
    <ErrorScreen
      error={error}
      retry={retry}
      // O fichário (/) não tem cabeçalho: a tela de erro desce abaixo da barra de status.
      topInset={home ? insets.top : 0}
      // No fichário, sem voltar nem barra de endereço (Expo Go), a saída é a Minha coleção, que tem a própria tela de
      // erro e leva à Conta, à cópia e à configuração.
      secondary={
        home
          ? { title: 'Abrir Minha coleção', onPress: () => router.push('/menu') }
          : { title: 'Voltar ao fichário', onPress: () => router.dismissTo('/') }
      }
    />
  );
}

/** Erro no layout raiz (antes das telas, ex.: ao abrir a coleção): tentar de novo ou, na web, recarregar. */
export function RootErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const insets = useSafeAreaInsets();
  return (
    <ErrorScreen
      error={error}
      retry={retry}
      topInset={insets.top}
      secondary={Platform.OS === 'web' ? { title: 'Recarregar a página', onPress: () => window.location.reload() } : undefined}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: space.xl, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 480, alignItems: 'center', gap: space.md },
  title: { ...typography.title, color: colors.text, textAlign: 'center', marginTop: space.xs },
  text: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.sm },
  detailsToggle: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: space.md },
  detailsToggleText: { ...typography.caption, color: colors.textMuted, textDecorationLine: 'underline' },
  details: {
    ...typography.caption,
    ...typography.tabular,
    alignSelf: 'stretch',
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: space.md,
  },
});
