import { Kanit_700Bold_Italic } from '@expo-google-fonts/kanit/700Bold_Italic';
import { useFonts } from 'expo-font';
import { DarkTheme, router, Stack, ThemeProvider, useIsFocused } from 'expo-router';
import { HeaderBackButton } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactElement } from 'react';
import { Platform, StyleSheet, View, type ColorValue } from 'react-native';

import { RootErrorBoundary, ScreenErrorBoundary } from '@/components/error-boundary';
import { HEADER_TITLE_STYLE, renderHeaderTitle } from '@/components/header-title';
import { MypRefresher } from '@/components/myp-refresher';
import { TcgplayerRefresher } from '@/components/tcgplayer-refresher';
import { LookupWarmup } from '@/components/lookup-warmup';
import { ToastHost } from '@/components/toast';
import { CollectionProvider } from '@/store/collection';
import { colors, font, semantic } from '@/theme';

const APP_NAME = 'Fichário Pokédex';

// A abertura fica até a fonte dos títulos chegar (um instante: o arquivo vem junto com o app).
SplashScreen.preventAutoHideAsync().catch(() => {});

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.background, card: semantic.shell.bg, primary: colors.primary, text: colors.text, border: colors.border },
};

export const unstable_settings = {
  // O fichário fica sempre por baixo: ao recarregar a página numa carta (ou abrir um link direto), a seta de voltar
  // continua levando de volta ao fichário em vez de sumir.
  anchor: 'index',
  // Erro numa tela: tela amigável no lugar dela, com o cabeçalho (e o voltar) no lugar.
  screenErrorBoundary: ScreenErrorBoundary,
};

// Erro no próprio layout (ex.: ao abrir a coleção salva): tela amigável no lugar do app inteiro.
export const ErrorBoundary = RootErrorBoundary;

/** Servidores das imagens das cartas (TCGdex, catálogo da TCGplayer, Scrydex). */
const IMAGE_HOSTS = ['https://assets.tcgdex.net', 'https://tcgplayer-cdn.tcgplayer.com', 'https://images.scrydex.com'];

/**
 * Na web, abre logo a conexão com os servidores das imagens e com a nuvem (Supabase), para as primeiras miniaturas e a
 * sincronização não esperarem o aperto de mão. As imagens vão sem CORS; a nuvem, por fetch com CORS (crossorigin).
 */
function preconnect() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const links = IMAGE_HOSTS.map((href) => ({ href, cors: false }));
  try {
    const cloud = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (cloud) links.push({ href: new URL(cloud).origin, cors: true });
  } catch {}
  for (const { href, cors } of links) {
    // Recarregar o módulo (ex.: no desenvolvimento) não repete o link.
    if (document.head.querySelector(`link[rel="preconnect"][href^="${href}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    if (cors) link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
}

preconnect();

// Na web, o voltar do cabeçalho é anunciado como "Voltar" (e não "Meu fichário, back"). Uma tela que não deve
// ter voltar (ex.: a primeira abertura) usa headerLeft: () => null, que vale também na web.
const webBack =
  Platform.OS === 'web'
    ? {
        headerLeft: ({ canGoBack, tintColor, href }: { canGoBack?: boolean; tintColor?: ColorValue; href?: string }) =>
          canGoBack ? <HeaderBackButton tintColor={tintColor} href={href} displayMode="minimal" accessibilityLabel="Voltar" onPress={() => router.back()} /> : null,
      }
    : null;

/**
 * Na web, o título da aba acompanha a tela aberta ("Charizard · Fichário Pokédex"), pelo `title` de cada tela. Um
 * título que já começa com o nome do app (o fichário sem nome: "Fichário Pokédex · pág. 1") não o repete no fim.
 */
function DocumentTitle({ title }: { title?: string }) {
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    document.title = !title || title.startsWith(APP_NAME) ? title || APP_NAME : `${title} · ${APP_NAME}`;
  }, [focused, title]);
  return null;
}

/** Toda tela com barra do topo ganha o fio vermelho embaixo dela; na web, o título da aba acompanha a tela. */
function screenLayout({ children, options }: { children: ReactElement; options: { title?: string; headerShown?: boolean } }) {
  return (
    <View style={styles.screen}>
      {Platform.OS === 'web' ? <DocumentTitle title={typeof options.title === 'string' ? options.title : undefined} /> : null}
      {options.headerShown === false ? null : <View style={styles.rule} aria-hidden />}
      {children}
    </View>
  );
}

export default function RootLayout() {
  // Sem a fonte (erro ao carregar), os títulos ficam na fonte do sistema.
  const [fontLoaded, fontError] = useFonts({ [font.display]: Kanit_700Bold_Italic });
  const ready = fontLoaded || !!fontError;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;

  return (
    <ThemeProvider value={theme}>
      <CollectionProvider>
        {/* Preços do MYP Cards das cartas, buscados aos poucos pelo app no celular. */}
        <MypRefresher />
        <TcgplayerRefresher />
        {/* Índice da Consulta atualizado em segundo plano e volta à Consulta na abertura (só no celular). */}
        <LookupWarmup />
        {/* Texto claro na barra de status: as barras do topo são pretas. */}
        <StatusBar style="light" />
        <Stack
          screenLayout={screenLayout}
          screenOptions={{
            headerStyle: { backgroundColor: semantic.shell.bg },
            headerTintColor: semantic.shell.fg,
            headerTitleStyle: HEADER_TITLE_STYLE,
            // Número não vai em Kanit: "Bolso 5 · Trocas", "Personalizar Coleção 151".
            headerTitle: renderHeaderTitle,
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.background },
            ...webBack,
          }}>
          <Stack.Screen name="index" options={{ headerShown: false, title: 'Meu fichário' }} />
          <Stack.Screen name="setup" options={{ title: APP_NAME }} />
          <Stack.Screen name="binders" options={{ title: 'Meus fichários', presentation: 'modal' }} />
          <Stack.Screen name="binder-edit" options={{ title: 'Fichário' }} />
          <Stack.Screen name="search" options={{ title: 'Escolher carta' }} />
          <Stack.Screen name="menu" options={{ title: 'Minha coleção', presentation: 'modal' }} />
          <Stack.Screen name="account" options={{ title: 'Conta' }} />
          <Stack.Screen name="nova-senha" options={{ title: 'Nova senha' }} />
          <Stack.Screen name="pokemon/[dex]" options={{ title: 'Escolher carta' }} />
          <Stack.Screen name="card" options={{ title: 'Carta' }} />
          {/* Telas novas da 3.0 (cada uma pode trocar o título com <Stack.Screen options={{ title }} />). */}
          <Stack.Screen name="find" options={{ title: 'Buscar na coleção' }} />
          <Stack.Screen name="lists" options={{ title: 'Listas' }} />
          <Stack.Screen name="about" options={{ title: 'Sobre e fontes' }} />
          <Stack.Screen name="reports" options={{ title: 'Relatórios' }} />
          {/* Consulta para leilão: no computador, a própria tela liga a barra normal. */}
          <Stack.Screen name="consulta" options={{ title: 'Consulta de cartas', headerShown: false }} />
          <Stack.Screen name="scan" options={{ title: 'Adicionar pela câmera' }} />
          <Stack.Screen name="scan-review" options={{ title: 'Conferir cartas' }} />
          <Stack.Screen name="ocr-probe" options={{ title: 'Medida da leitura' }} />
        </Stack>
        {/* Avisos rápidos com "Desfazer" (U3), por cima das telas. */}
        <ToastHost />
      </CollectionProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  rule: { height: semantic.shell.ruleWidth, backgroundColor: semantic.shell.rule },
});
