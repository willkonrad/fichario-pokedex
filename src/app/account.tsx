import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Input, Section } from '@/components/ui';
import { formatWhen } from '@/lib/quotes';
import { supabase } from '@/lib/supabase';
import { useCollection } from '@/store/collection';
import { colors, radius } from '@/theme';

export default function AccountScreen() {
  const { session, syncError, syncNow, lastSyncAt } = useCollection();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!supabase) {
    return (
      <View style={styles.screen}>
        <Text style={styles.text}>
          A sincronização na nuvem ainda não foi configurada. Por enquanto a coleção fica salva só neste aparelho.
        </Text>
        <Text style={styles.text}>
          Para ativar: crie um projeto gratuito no Supabase, rode o arquivo supabase/schema.sql e preencha o .env com
          EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY.
        </Text>
      </View>
    );
  }
  const sb = supabase;

  async function run(op: 'in' | 'up') {
    setBusy(true);
    setMessage(null);
    const { error, data } =
      op === 'in'
        ? await sb.auth.signInWithPassword({ email: email.trim(), password })
        : await sb.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) setMessage(error.message);
    else if (op === 'up' && !data.session) setMessage('Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.');
  }

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const { sent, received } = await syncNow();
      setMessage(`Sincronizado: ${sent} cartas enviadas, ${received} recebidas da nuvem.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  if (session) {
    return (
      <View style={styles.screen}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.email} numberOfLines={1}>
              {session.user.email}
            </Text>
            <View style={styles.status}>
              <Ionicons
                name={syncError ? 'alert-circle' : 'cloud-done'}
                size={14}
                color={syncError ? colors.danger : colors.success}
              />
              <Text style={[styles.statusText, { color: syncError ? colors.danger : colors.success }]}>
                {syncError ? 'Erro na sincronização' : lastSyncAt ? `Sincronizado em ${formatWhen(lastSyncAt)}` : 'Sincronização automática'}
              </Text>
            </View>
          </View>
        </View>
        {syncError ? <Text style={[styles.text, { color: colors.danger }]}>{syncError}</Text> : null}
        {message ? <Text style={styles.text}>{message}</Text> : null}
        <Button title={busy ? 'Sincronizando…' : 'Sincronizar agora'} onPress={sync} disabled={busy} />
        <Button title="Sair da conta" variant="secondary" onPress={() => sb.auth.signOut()} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <Ionicons name="cloud-upload-outline" size={28} color={colors.accent} />
        <Text style={styles.introTitle}>Guarde sua coleção na nuvem</Text>
        <Text style={styles.text}>Suas cartas e cotações ficam salvas e aparecem em qualquer aparelho.</Text>
      </View>
      <Section title="Entrar">
        <Input value={email} onChangeText={setEmail} placeholder="E-mail" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Input
          value={password}
          onChangeText={setPassword}
          placeholder="Senha (mín. 6 caracteres)"
          secureTextEntry
          autoComplete="password"
          returnKeyType="go"
          onSubmitEditing={() => {
            if (!busy && email && password.length >= 6) run('in');
          }}
        />
      </Section>
      {message ? <Text style={styles.text}>{message}</Text> : null}
      <Button title="Entrar" onPress={() => run('in')} disabled={busy || !email || password.length < 6} />
      <Button title="Criar conta" variant="secondary" onPress={() => run('up')} disabled={busy || !email || password.length < 6} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 20, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  text: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  email: { color: colors.text, fontSize: 16, fontWeight: '700' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  statusText: { fontSize: 13, fontWeight: '600' },
  intro: { alignItems: 'flex-start', gap: 6, marginBottom: 8 },
  introTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
});
