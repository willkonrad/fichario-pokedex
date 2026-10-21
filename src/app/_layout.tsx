import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { CollectionProvider } from '@/store/collection';
import { colors } from '@/theme';

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background, card: colors.primary, primary: colors.primary, text: colors.text, border: colors.border },
};

// O fichário fica sempre por baixo: ao recarregar a página numa carta (ou abrir um link direto), a seta de voltar
// continua levando de volta ao fichário em vez de sumir.
export const unstable_settings = { anchor: 'index' };

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <CollectionProvider>
        {/* Texto claro na barra de status: as barras do topo são vermelhas. */}
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: colors.onPrimary,
            headerTitleStyle: { fontWeight: '800' },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.background },
          }}>
          <Stack.Screen name="index" options={{ headerShown: false, title: 'Meu fichário' }} />
          <Stack.Screen name="setup" options={{ title: 'Fichário Pokédex' }} />
          <Stack.Screen name="binders" options={{ title: 'Meus fichários', presentation: 'modal' }} />
          <Stack.Screen name="binder-edit" options={{ title: 'Fichário' }} />
          <Stack.Screen name="search" options={{ title: 'Escolher carta' }} />
          <Stack.Screen name="menu" options={{ title: 'Minha coleção', presentation: 'modal' }} />
          <Stack.Screen name="account" options={{ title: 'Conta' }} />
          <Stack.Screen name="pokemon/[dex]" options={{ title: 'Escolher carta' }} />
          <Stack.Screen name="card" options={{ title: 'Carta' }} />
        </Stack>
      </CollectionProvider>
    </ThemeProvider>
  );
}
