import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BackupCard } from '@/components/collection-backup';
import { SyncNotice, syncSummary } from '@/components/collection-notices';
import { Button, Card, Input, Notice, Section, showToast } from '@/components/ui';
import { formatWhen } from '@/lib/format';
import { clearHistoryCache } from '@/lib/history';
import { supabase } from '@/lib/supabase';
import { useCollection } from '@/store/collection';
import { colors, radius, space, typography, widths } from '@/theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

/**
 * Conta e sincronização, e a cópia da coleção (S7). `primeira=1`: veio da primeira abertura ("Já uso em outro
 * aparelho"); quando o fichário chega da nuvem, volta direto para ele. `secao=copia`: a cópia vem primeiro.
 */
export default function AccountScreen() {
  const params = useLocalSearchParams<{ primeira?: string; secao?: string }>();
  const backupFirst = params.secao === 'copia';
  const title = backupFirst ? 'Cópia da coleção' : 'Conta';

  if (!supabase) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title }} />
        <Notice tone="info">A nuvem não está configurada neste app: a coleção fica salva só neste aparelho. Exporte uma cópia de vez em quando.</Notice>
        <BackupCard />
      </ScrollView>
    );
  }
  return <AccountContent firstRun={params.primeira === '1'} backupFirst={backupFirst} title={title} />;
}

function AccountContent({ firstRun, backupFirst, title }: { firstRun: boolean; backupFirst: boolean; title: string }) {
  const { ready, session, settings, syncNow, syncStatus, lastSyncAt } = useCollection();
  const sb = supabase!;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | 'reset' | 'sync' | 'out' | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  // Qual botão foi tocado por último (para marcar só os campos que ele precisa).
  const [checked, setChecked] = useState<'login' | 'reset' | null>(null);
  // Se o aparelho estava mesmo sem fichário quando a coleção terminou de carregar (recarregar a página em
  // /account?primeira=1 com o fichário já montado não é "receber da nuvem").
  const [startedEmpty, setStartedEmpty] = useState<boolean | null>(null);
  if (ready && startedEmpty === null) setStartedEmpty(!settings);

  // Primeira abertura: o fichário chegou da nuvem depois de entrar (a nuvem vence num aparelho novo, S3).
  const arrived = firstRun && startedEmpty === true && !!session && !!settings;
  useEffect(() => {
    if (!arrived) return;
    showToast({ message: 'Fichário recebido da nuvem' });
    // A configuração da primeira abertura fica por baixo (o fichário não está na pilha): sai das duas, e o fichário
    // vira a única tela (senão o voltar levaria de novo à configuração).
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  }, [arrived]);

  const validEmail = EMAIL.test(email.trim());
  const validPassword = password.length >= MIN_PASSWORD;

  async function run(op: 'in' | 'up') {
    if (busy) return;
    setChecked('login');
    // Os botões ficam sempre ativos: o que falta é dito ao tocar (U4).
    if (!validEmail) return setMessage({ text: 'Digite um e-mail válido.', error: true });
    if (!validPassword) return setMessage({ text: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`, error: true });
    setBusy(op);
    setMessage(null);
    try {
      const { error, data } =
        op === 'in'
          ? await sb.auth.signInWithPassword({ email: email.trim(), password })
          : await sb.auth.signUp({ email: email.trim(), password });
      if (error) setMessage({ text: translateAuthError(error.message), error: true });
      else if (op === 'up' && !data.session) setMessage({ text: 'Conta criada! Confirme pelo link enviado ao seu e-mail e depois entre.' });
    } catch (e) {
      setMessage({ text: translateAuthError(e instanceof Error ? e.message : String(e)), error: true });
    }
    setBusy(null);
  }

  async function resetPassword() {
    if (!validEmail) {
      setChecked('reset');
      return setMessage({ text: 'Digite seu e-mail acima para receber o link de nova senha.', error: true });
    }
    setBusy('reset');
    setMessage(null);
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim());
      setMessage(error ? { text: translateAuthError(error.message), error: true } : { text: `Enviamos um link para ${email.trim()} criar uma nova senha.` });
    } catch (e) {
      setMessage({ text: translateAuthError(e instanceof Error ? e.message : String(e)), error: true });
    }
    setBusy(null);
  }

  async function sync() {
    setBusy('sync');
    setMessage(null);
    try {
      const { sent, received } = await syncNow();
      setMessage({ text: `Sincronizado: ${sent} ${sent === 1 ? 'carta enviada' : 'cartas enviadas'}, ${received} ${received === 1 ? 'recebida' : 'recebidas'} da nuvem.` });
    } catch (e) {
      // syncNow já rejeita com a mensagem em português (pronta para a tela).
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    }
    setBusy(null);
  }

  async function signOut() {
    setBusy('out');
    setMessage(null);
    try {
      const { error } = await sb.auth.signOut();
      // O histórico guardado na memória é desta conta.
      clearHistoryCache();
      if (error) setMessage({ text: translateAuthError(error.message), error: true });
    } catch (e) {
      setMessage({ text: translateAuthError(e instanceof Error ? e.message : String(e)), error: true });
    }
    setBusy(null);
  }

  const backup = <BackupCard />;

  if (session) {
    const sum = syncSummary(syncStatus, session.user.email);
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Stack.Screen options={{ title }} />
        {backupFirst ? backup : null}
        <Card style={styles.profile}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={22} color={colors.text} />
          </View>
          <View style={styles.profileText}>
            <Text style={styles.email} numberOfLines={1}>
              {session.user.email}
            </Text>
            <View style={styles.status}>
              <Ionicons name={sum.icon} size={14} color={sum.color} />
              <Text style={[styles.statusText, { color: sum.color }]}>{sum.text}</Text>
            </View>
          </View>
        </Card>
        <SyncNotice status={syncStatus} />
        {firstRun && !settings ? (
          // Só depois de uma sincronização completa nesta abertura (logo após entrar, o estado ainda é "ok" por um instante).
          syncStatus.state === 'ok' && lastSyncAt ? (
            <>
              <Notice tone="info">Esta conta ainda não tem fichário salvo. Volte e monte o seu.</Notice>
              <Button title="Montar meu fichário" icon="arrow-back" onPress={() => router.back()} />
            </>
          ) : (
            <Notice tone="info">Buscando sua coleção na nuvem…</Notice>
          )
        ) : null}
        {message ? <Notice tone={message.error ? 'danger' : 'success'}>{message.text}</Notice> : null}
        <Text style={styles.text}>
          As alterações vão para a nuvem na hora e chegam aos outros aparelhos ao abrir o app.
          {syncStatus.lastSyncAt && syncStatus.state !== 'ok' ? ` Última sincronização: ${formatWhen(syncStatus.lastSyncAt)}.` : ''}
        </Text>
        <Button title={busy === 'sync' ? 'Sincronizando…' : 'Sincronizar agora'} icon="sync" onPress={sync} busy={busy === 'sync'} />
        <Button title="Sair da conta" variant="secondary" icon="log-out-outline" busy={busy === 'out'} onPress={signOut} />
        {backupFirst ? null : backup}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />
      {backupFirst ? backup : null}
      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <Ionicons name="cloud-upload-outline" size={26} color={colors.text} />
        </View>
        <Text style={styles.introTitle} role="heading">
          {firstRun ? 'Entre para trazer sua coleção' : 'Guarde sua coleção na nuvem'}
        </Text>
        <Text style={[styles.text, styles.center]}>Suas cartas em qualquer aparelho, com o histórico do valor.</Text>
      </View>
      <Card>
        <Section title="Entrar ou criar conta">
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="E-mail"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            accessibilityLabel="E-mail"
            invalid={!!checked && !validEmail}
          />
          <View style={styles.field}>
            <Input
              value={password}
              onChangeText={setPassword}
              placeholder="Senha"
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              accessibilityLabel="Senha"
              accessibilityHint={`Pelo menos ${MIN_PASSWORD} caracteres`}
              invalid={checked === 'login' && !validPassword}
              onSubmitEditing={() => run('in')}
            />
            <Text style={styles.fieldHint}>Pelo menos {MIN_PASSWORD} caracteres</Text>
          </View>
        </Section>
        {message ? (
          <View style={styles.message}>
            <Notice tone={message.error ? 'danger' : 'success'}>{message.text}</Notice>
          </View>
        ) : null}
        <View style={styles.buttons}>
          <Button title="Entrar" icon="log-in-outline" onPress={() => run('in')} busy={busy === 'in'} />
          <Button title="Criar conta" variant="secondary" onPress={() => run('up')} busy={busy === 'up'} />
          <Button title="Esqueci minha senha" variant="ghost" onPress={resetPassword} busy={busy === 'reset'} />
        </View>
      </Card>
      {backupFirst ? null : backup}
    </ScrollView>
  );
}

/** Mensagens comuns do login em português. */
function translateAuthError(msg: string) {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(msg)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/already registered|already exists/i.test(msg)) return 'Já existe uma conta com esse e-mail. Use "Entrar".';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
  if (/password/i.test(msg) && /(weak|short|least|characters)/i.test(msg)) return 'Senha fraca: use uma senha mais longa, com letras e números.';
  if (/network|fetch/i.test(msg)) return 'Sem conexão com a internet.';
  return `Não consegui concluir agora (${msg}). Tente de novo em instantes.`;
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: space.lg, gap: space.md, maxWidth: widths.form, width: '100%', alignSelf: 'center', paddingBottom: space.xxxl },
  text: { ...typography.caption, color: colors.textMuted },
  center: { textAlign: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  profileText: { flex: 1, minWidth: 0 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  email: { ...typography.bodyStrong, color: colors.text },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xxs },
  statusText: { ...typography.caption, fontWeight: '600', flexShrink: 1 },
  intro: { alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  introIcon: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  introTitle: { ...typography.title, color: colors.text, textAlign: 'center' },
  field: { gap: space.xs },
  fieldHint: { ...typography.caption, color: colors.textMuted },
  message: { marginBottom: space.md },
  buttons: { gap: space.sm },
});
