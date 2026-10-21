import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { CollectionProvider } from '@/store/collection';
import { colors } from '@/theme';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.background, card: colors.background, primary: colors.accent, text: colors.text, border: colors.border },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <CollectionProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}>
          <Stack.Screen name="index" options={{ headerShown: false, title: 'Meu Fichário' }} />
          <Stack.Screen name="setup" options={{ title: 'Fichário Pokédex' }} />
          <Stack.Screen name="binders" options={{ title: 'Meus fichários', presentation: 'modal' }} />
          <Stack.Screen name="binder-edit" options={{ title: 'Fichário' }} />
          <Stack.Screen name="search" options={{ title: 'Escolher carta' }} />
          <Stack.Screen name="menu" options={{ title: 'Menu', presentation: 'modal' }} />
          <Stack.Screen name="account" options={{ title: 'Conta' }} />
          <Stack.Screen name="pokemon/[dex]" options={{ title: 'Escolher carta' }} />
          <Stack.Screen name="card" options={{ title: 'Carta' }} />
        </Stack>
      </CollectionProvider>
    </ThemeProvider>
  );
}
