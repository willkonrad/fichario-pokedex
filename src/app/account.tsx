import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, EmptyState, Input, Section } from '@/components/ui';
import { formatWhen } from '@/lib/quotes';
import { supabase } from '@/lib/supabase';
import { useCollection } from '@/store/collection';
import { colors, MAX_WIDTH, radius } from '@/theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AccountScreen() {
  const { session, syncError, syncNow, lastSyncAt } = useCollection();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | 'reset' | 'sync' | 'out' | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  if (!supabase) {
    return (
      <EmptyState
        title="Sincronização desativada"
        text="A nuvem ainda não foi configurada neste app. Por enquanto a coleção fica salva só neste aparelho."
      />
    );
  }
  const sb = supabase;
  const validEmail = EMAIL.test(email.trim());
  const canSubmit = !busy && validEmail && password.length >= 6;

  async function run(op: 'in' | 'up') {
    setBusy(op);
    setMessage(null);
    const { error, data } =
      op === 'in'
        ? await sb.auth.signInWithPassword({ email: email.trim(), password })
        : await sb.auth.signUp({ email: email.trim(), password });
    setBusy(null);
    if (error) setMessage({ text: translateAuthError(error.message), error: true });
    else if (op === 'up' && !data.session) setMessage({ text: 'Conta criada! Confirme pelo link enviado ao seu e-mail e depois entre.' });
  }

  async function resetPassword() {
    if (!validEmail) return setMessage({ text: 'Digite seu e-mail acima para receber o link de nova senha.', error: true });
    setBusy('reset');
    setMessage(null);
    const { error } = await sb.auth.resetPasswordForEmail(email.trim());
    setBusy(null);
    setMessage(error ? { text: translateAuthError(error.message), error: true } : { text: `Enviamos um link para ${email.trim()} criar uma nova senha.` });
  }

  async function sync() {
    setBusy('sync');
    setMessage(null);
    try {
      const { sent, received } = await syncNow();
      setMessage({ text: `Sincronizado: ${sent} ${sent === 1 ? 'carta enviada' : 'cartas enviadas'}, ${received} ${received === 1 ? 'recebida' : 'recebidas'} da nuvem.` });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    }
    setBusy(null);
  }

  if (session) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Card style={styles.profile}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.email} numberOfLines={1}>
              {session.user.email}
            </Text>
            <View style={styles.status}>
              <Ionicons name={syncError ? 'alert-circle' : 'cloud-done'} size={14} color={syncError ? colors.danger : colors.success} />
              <Text style={[styles.statusText, { color: syncError ? colors.danger : colors.success }]}>
                {syncError ? 'Erro na sincronização' : lastSyncAt ? `Sincronizado em ${formatWhen(lastSyncAt)}` : 'Sincronização automática'}
              </Text>
            </View>
          </View>
        </Card>
        <Text style={styles.text}>Suas cartas são enviadas para a nuvem a cada alteração e sincronizadas ao abrir o app.</Text>
        {syncError ? <Text style={[styles.text, { color: colors.danger }]}>{syncError}</Text> : null}
        {message ? <Text style={[styles.text, message.error && { color: colors.danger }]}>{message.text}</Text> : null}
        <Button title={busy === 'sync' ? 'Sincronizando…' : 'Sincronizar agora'} icon="sync" onPress={sync} busy={busy === 'sync'} />
        <Button
          title="Sair da conta"
          variant="secondary"
          icon="log-out-outline"
          busy={busy === 'out'}
          onPress={async () => {
            setBusy('out');
            await sb.auth.signOut();
            setBusy(null);
          }}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <Ionicons name="cloud-upload-outline" size={26} color={colors.primary} />
        </View>
        <Text style={styles.introTitle}>Guarde sua coleção na nuvem</Text>
        <Text style={[styles.text, { textAlign: 'center' }]}>
          Suas cartas ficam salvas e aparecem em qualquer aparelho. Com a conta, o app também guarda o histórico do valor da coleção.
        </Text>
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
          />
          <Input
            value={password}
            onChangeText={setPassword}
            placeholder="Senha (mínimo 6 caracteres)"
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            accessibilityLabel="Senha"
            onSubmitEditing={() => {
              if (canSubmit) run('in');
            }}
          />
        </Section>
        {message ? <Text style={[styles.text, styles.message, message.error && { color: colors.danger }]}>{message.text}</Text> : null}
        <View style={{ gap: 10 }}>
          <Button title="Entrar" icon="log-in-outline" onPress={() => run('in')} disabled={!canSubmit} busy={busy === 'in'} />
          <Button title="Criar conta" variant="secondary" onPress={() => run('up')} disabled={!canSubmit} busy={busy === 'up'} />
          <Button title="Esqueci minha senha" variant="ghost" onPress={resetPassword} busy={busy === 'reset'} />
        </View>
      </Card>
    </ScrollView>
  );
}

/** Mensagens comuns do login em português. */
function translateAuthError(msg: string) {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(msg)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/already registered|already exists/i.test(msg)) return 'Já existe uma conta com esse e-mail. Use "Entrar".';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
  if (/network|fetch/i.test(msg)) return 'Sem conexão com a internet.';
  return msg;
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 16, gap: 12, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  text: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  message: { marginBottom: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  email: { color: colors.text, fontSize: 16, fontWeight: '800' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  statusText: { fontSize: 13, fontWeight: '700' },
  intro: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  introIcon: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  introTitle: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
});
