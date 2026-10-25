import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { router, Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, type TextInputInstance } from 'react-native';

import { Button, Card, Input, Loading, Notice, Section, showToast } from '@/components/ui';
import {
  authErrorText,
  hasAuthFragment,
  isResetLink,
  LINK_EXPIRED_TEXT,
  linkSessionCheck,
  MIN_PASSWORD,
  newPasswordProblem,
  readAuthLink,
  type AuthLink,
} from '@/lib/auth-links';
import { initialWebAuthLink, isNetworkError, stripAuthFromAddressBar, supabase } from '@/lib/supabase';
import { colors, space, typography, widths } from '@/theme';

const TITLE = 'Nova senha';

const NO_LINK_TEXT = 'Abra esta tela pelo link do e-mail de nova senha. Para receber um, toque em "Esqueci minha senha" na tela da conta.';
const LINK_FAILED_SIGNED_IN =
  'O link do e-mail não vale mais (venceu ou já foi usado), mas você já está na conta neste aparelho: crie a senha nova aqui mesmo.';
const LINK_OTHER_ACCOUNT =
  'O link do e-mail é de outra conta e não foi usado. Aqui você troca a senha da conta deste aparelho; para a outra, saia desta e peça um novo link.';
const OFFLINE_TEXT = 'Sem conexão com a internet. Quando ela voltar, toque em "Tentar de novo": o link do e-mail ainda vale.';

/** Resultado de um link: o erro em português (null quando deu certo), e se vale tentar de novo (falta de internet). */
type LinkResult = { error: string | null; retry?: boolean; note?: string };

/** Cada link vale uma vez (o refresh_token dele não serve de novo): a tela desenhada outra vez reaproveita o resultado. */
const opened = new Map<string, Promise<LinkResult>>();

/** Entra na conta pelo link do e-mail (nada a fazer sem link). Sem internet, o link fica para outra tentativa. */
function openLink(sb: SupabaseClient, url: string | null): Promise<LinkResult> {
  const link = readAuthLink(url);
  if (!url || !link) return Promise.resolve({ error: null });
  let job = opened.get(url);
  if (!job) {
    job = applyLink(sb, link);
    opened.set(url, job);
    void job.then((r) => {
      if (r.retry) opened.delete(url);
    });
  }
  return job;
}

const offline = (e: unknown) => isAuthRetryableFetchError(e) || isNetworkError(e);

async function applyLink(sb: SupabaseClient, link: AuthLink): Promise<LinkResult> {
  if (link.kind === 'error') return { error: authErrorText({ code: link.code, message: link.message }) };
  try {
    if (link.kind === 'session') {
      // Com a conta já aberta, um link velho ou repetido não é lido (ver linkSessionCheck): o setSession com um token
      // gasto tiraria a conta do aparelho.
      const { data } = await sb.auth.getSession();
      const current = data.session ? { accessToken: data.session.access_token, userId: data.session.user.id } : null;
      const check = linkSessionCheck(link.accessToken, current);
      if (check === 'same') return { error: null };
      if (check === 'stale') return { error: LINK_EXPIRED_TEXT };
      if (check === 'other') return { error: LINK_OTHER_ACCOUNT, note: LINK_OTHER_ACCOUNT };
    }
    const { error } =
      link.kind === 'session'
        ? await sb.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
        : await sb.auth.exchangeCodeForSession(link.code);
    if (!error) return { error: null };
    return offline(error) ? { error: OFFLINE_TEXT, retry: true } : { error: authErrorText(error) };
  } catch (e) {
    return offline(e) ? { error: OFFLINE_TEXT, retry: true } : { error: authErrorText(e) };
  }
}

/** Volta para o fichário como única tela (pelo link, esta tela abre por cima dele ou de outra). */
function goHome() {
  if (router.canDismiss()) router.dismissAll();
  router.replace('/');
}

type Phase =
  | { kind: 'form'; email: string | null; warning: string | null }
  | { kind: 'blocked'; message: string; tone: 'info' | 'danger'; retry?: boolean };

/**
 * Nova senha pelo link do e-mail ("Esqueci minha senha" na conta). O Supabase volta para cá com a sessão depois do #
 * (fluxo implícito): pokedexbinder://nova-senha#access_token=…&type=recovery no APK, https://<site>/nova-senha#… na
 * web. A tela entra na conta com essa sessão e pede a senha nova (supabase.auth.updateUser). Aberta sem link, com a
 * conta já entrada neste aparelho, também troca a senha.
 */
export default function NewPasswordScreen() {
  if (!supabase) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title: TITLE }} />
        <Notice tone="info">A nuvem não está configurada neste app: não há conta nem senha para trocar.</Notice>
        <Button title="Voltar ao fichário" icon="arrow-back" onPress={goHome} />
      </ScrollView>
    );
  }
  return <NewPasswordContent sb={supabase} />;
}

function NewPasswordContent({ sb }: { sb: SupabaseClient }) {
  // No celular, o link chega pelo expo-linking (o roteador descarta o que vem depois do #). Na web, vale o endereço
  // guardado ao carregar a página (src/lib/supabase.ts), porque os tokens saem da barra. Só conta um link para esta tela.
  const linked = Linking.useLinkingURL();
  const saved = initialWebAuthLink();
  const candidate = Platform.OS === 'web' && isResetLink(saved) ? saved : linked;
  const url = isResetLink(candidate) ? candidate : null;
  // Tentativa atual (o "Tentar de novo" depois de uma falta de internet lê o link outra vez).
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ url: string | null; attempt: number; phase: Phase } | null>(null);
  const phase = result && result.url === url && result.attempt === attempt ? result.phase : null;

  // Na web, o roteador guarda o que vem depois do # como o parâmetro '#' da tela e o escreve de volta na barra de
  // endereço (https://docs.expo.dev/router/reference/url-parameters/#hash-support). Os tokens saem dos dois: o link já
  // foi guardado quando a página carregou. (router.setParams vale para a tela em foco: só com esta em foco.)
  const focused = useIsFocused();
  const routeHash = useLocalSearchParams<{ '#'?: string }>()['#'];
  useEffect(() => {
    if (Platform.OS !== 'web' || !focused || !routeHash || !hasAuthFragment(`#${routeHash}`)) return;
    router.setParams({ '#': undefined });
    stripAuthFromAddressBar();
  }, [focused, routeHash]);

  useEffect(() => {
    let alive = true;
    (async () => {
      let next: Phase;
      try {
        const link = await openLink(sb, url);
        if (readAuthLink(url) && !link.retry) {
          // Link já lido: sai da barra de endereço (web) e do aparelho, para não ser lido de novo. Sem internet ele fica,
          // para a próxima tentativa.
          stripAuthFromAddressBar();
          if (Platform.OS !== 'web') Linking.clearInitialURL();
        }
        if (link.retry) {
          next = { kind: 'blocked', message: link.error ?? OFFLINE_TEXT, tone: 'danger', retry: true };
        } else {
          const { data } = await sb.auth.getSession();
          const session = data.session;
          if (session) {
            next = { kind: 'form', email: session.user.email ?? null, warning: link.note ?? (link.error ? LINK_FAILED_SIGNED_IN : null) };
          } else {
            next = link.error ? { kind: 'blocked', message: link.error, tone: 'danger' } : { kind: 'blocked', message: NO_LINK_TEXT, tone: 'info' };
          }
        }
      } catch (e) {
        next = offline(e)
          ? { kind: 'blocked', message: OFFLINE_TEXT, tone: 'danger', retry: true }
          : { kind: 'blocked', message: authErrorText(e), tone: 'danger' };
      }
      if (alive) setResult({ url, attempt, phase: next });
    })();
    return () => {
      alive = false;
    };
  }, [sb, url, attempt]);

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: TITLE }} />
      {!phase ? (
        <Loading label={url ? 'Abrindo o link do e-mail…' : 'Carregando…'} />
      ) : phase.kind === 'blocked' ? (
        <>
          <Notice tone={phase.tone}>{phase.message}</Notice>
          {phase.retry ? (
            <Button title="Tentar de novo" icon="refresh" onPress={() => setAttempt((n) => n + 1)} />
          ) : (
            <Button title="Pedir novo link" icon="mail-outline" onPress={() => router.replace('/account')} />
          )}
          <Button title="Voltar ao fichário" variant="ghost" onPress={goHome} />
        </>
      ) : (
        <PasswordForm sb={sb} email={phase.email} warning={phase.warning} />
      )}
    </ScrollView>
  );
}

function PasswordForm({ sb, email, warning }: { sb: SupabaseClient; email: string | null; warning: string | null }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<TextInputInstance>(null);

  async function save() {
    if (busy) return;
    setChecked(true);
    // O botão fica sempre ativo: o que falta é dito ao tocar (U4).
    const problem = newPasswordProblem(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    let failure: string | null = null;
    try {
      const { error: err } = await sb.auth.updateUser({ password });
      if (err) failure = authErrorText(err);
    } catch (e) {
      failure = authErrorText(e);
    }
    setBusy(false);
    if (failure) return setError(failure);
    showToast({ message: 'Senha nova salva' });
    goHome();
  }

  return (
    <>
      {warning ? <Notice tone="warning">{warning}</Notice> : null}
      <Card>
        {/* Ao trocar a senha, o Supabase tira a conta dos outros aparelhos (só esta sessão continua). */}
        <Section
          title="Crie uma senha nova"
          hint={`Pelo menos ${MIN_PASSWORD} caracteres. Vale no celular e na web; os outros aparelhos saem da conta e pedem a senha nova.`}>
          {email ? <Text style={styles.text}>Conta: {email}</Text> : null}
          <Input
            value={password}
            onChangeText={setPassword}
            placeholder="Senha nova"
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            accessibilityLabel="Senha nova"
            accessibilityHint={`Pelo menos ${MIN_PASSWORD} caracteres`}
            invalid={checked && password.length < MIN_PASSWORD}
            onSubmitEditing={() => confirmRef.current?.focus()}
          />
          <Input
            ref={confirmRef}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Repita a senha nova"
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            accessibilityLabel="Repita a senha nova"
            invalid={checked && confirm !== password}
            onSubmitEditing={save}
          />
        </Section>
        {error ? (
          <View style={styles.message}>
            <Notice tone="danger">{error}</Notice>
          </View>
        ) : null}
        <Button title={busy ? 'Salvando…' : 'Salvar senha nova'} icon="checkmark" onPress={save} busy={busy} />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: space.lg, gap: space.md, maxWidth: widths.form, width: '100%', alignSelf: 'center', paddingBottom: space.xxxl },
  text: { ...typography.caption, color: colors.textMuted },
  message: { marginBottom: space.md },
});
