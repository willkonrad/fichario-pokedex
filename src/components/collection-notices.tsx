import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Notice, type IconName } from '@/components/ui';
import { myValueReplacedNotice } from '@/lib/copy';
import { formatWhen } from '@/lib/format';
import { myValueReplacements } from '@/lib/quotes';
import { supabase } from '@/lib/supabase';
import type { Entry } from '@/lib/types';
import type { SyncStatus } from '@/store/collection';
import { colors, semantic, space, TOUCH, typography } from '@/theme';

const waitingText = (n: number) => `${n} ${n === 1 ? 'alteração aguardando' : 'alterações aguardando'} envio`;

/**
 * Estado da sincronização em uma linha (S10), para o item do menu e o cartão da conta: sem conta, "Salvo só neste
 * aparelho"; com conta, "Sincronizado em …", "Sincronizando…", "Sem conexão · 2 alterações aguardando envio" ou o erro.
 * `signInHint`: acrescenta "· Entrar" sem conta (só onde a linha leva à tela da conta).
 */
export function syncSummary(s: SyncStatus, email?: string | null, opts: { signInHint?: boolean } = {}): { icon: IconName; text: string; color: string } {
  switch (s.state) {
    case 'local':
      return {
        icon: 'phone-portrait-outline',
        text: supabase && opts.signInHint ? 'Salvo só neste aparelho · Entrar' : 'Salvo só neste aparelho',
        color: colors.textMuted,
      };
    case 'syncing':
      return { icon: 'sync-outline', text: 'Sincronizando…', color: colors.textMuted };
    case 'offline':
      return { icon: 'cloud-offline-outline', text: s.pending ? `Sem conexão · ${waitingText(s.pending)}` : 'Sem conexão', color: semantic.warning.fg };
    case 'error':
      return { icon: 'alert-circle-outline', text: 'Erro na sincronização', color: semantic.danger.fg };
    default:
      return {
        icon: 'cloud-done-outline',
        text: s.pending ? waitingText(s.pending) : s.lastSyncAt ? `Sincronizado em ${formatWhen(s.lastSyncAt)}` : (email ?? 'Conectado'),
        color: s.pending ? colors.textMuted : semantic.success.fg,
      };
  }
}

/** Aviso da sincronização quando há algo a dizer (sem conexão ou erro), com a mensagem do store em português. */
export function SyncNotice({ status }: { status: SyncStatus }) {
  if (status.state !== 'error' && status.state !== 'offline') return null;
  return <Notice tone={status.state === 'error' ? 'danger' : 'warning'}>{status.message ?? (status.state === 'error' ? 'Erro na sincronização.' : 'Sem conexão.')}</Notice>;
}

const SEEN_KEY = 'ui:myvalue-seen';

/**
 * Aviso de "Meu valor" trocado pelo mercado (V8): só das trocas que este aparelho ainda não mostrou. O último aviso
 * visto fica guardado no aparelho (se o armazenamento falhar, o aviso só volta a aparecer).
 */
export function MyValueNotice({ entries }: { entries: Record<string, Entry> }) {
  const [seen, setSeen] = useState<{ loaded: boolean; at?: string }>({ loaded: false });
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SEEN_KEY)
      .then((at) => alive && setSeen({ loaded: true, at: at ?? undefined }))
      .catch(() => alive && setSeen({ loaded: true }));
    return () => {
      alive = false;
    };
  }, []);
  if (!seen.loaded) return null;
  const list = myValueReplacements(Object.values(entries), seen.at);
  if (!list.length) return null;
  const dismiss = () => {
    const at = list[0].at;
    setSeen({ loaded: true, at });
    AsyncStorage.setItem(SEEN_KEY, at).catch(() => {});
  };
  return (
    <View style={styles.wrap}>
      <Notice tone="warning" icon="pricetag-outline">
        {myValueReplacedNotice(list)}
      </Notice>
      <Pressable onPress={dismiss} role="button" accessibilityLabel="Entendi, esconder o aviso" style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
        <Text style={styles.actionText}>Entendi</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xxs },
  action: { alignSelf: 'flex-end', minHeight: TOUCH, paddingHorizontal: space.md, justifyContent: 'center' },
  actionText: { ...typography.bodyStrong, color: colors.primaryText },
});
