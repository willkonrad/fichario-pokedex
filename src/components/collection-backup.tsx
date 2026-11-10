import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { HEADING_3 } from '@/components/collection-chart';
import { Button, Card, Input, Notice, showToast } from '@/components/ui';
import { backupFileName, backupToCsv, backupToJson, pickBackupFile, saveBackupFile } from '@/lib/backup';
import { useCollectionActions, type ImportResult } from '@/store/collection';
import { colors, space, typography } from '@/theme';

const WEB = Platform.OS === 'web';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A cópia foi juntada só ao que está neste aparelho: quando acontece a junção com a nuvem. */
const CLOUD_LATER: Record<NonNullable<ImportResult['cloudLater']>, string> = {
  signIn: 'Ao entrar na conta, ela se junta à coleção da nuvem: em cada carta vale a edição mais recente.',
  sync: 'A nuvem não respondeu: ela se junta à coleção da nuvem na próxima sincronização, e em cada carta vale a edição mais recente.',
};

/** Resultado da importação numa frase: "Cópia importada: 3 cartas novas · 1 atualizada · 40 sem mudança." */
function importText(r: ImportResult) {
  if (!r.added && !r.updated) {
    return r.skipped
      ? `Nada mudou: ${plural(r.skipped, 'carta já estava igual', 'cartas já estavam iguais')} ou sem lugar aqui.`
      : 'A cópia não tem cartas para importar.';
  }
  const parts = [
    r.added ? plural(r.added, 'carta nova', 'cartas novas') : null,
    r.updated ? plural(r.updated, 'atualizada', 'atualizadas') : null,
    r.skipped ? plural(r.skipped, 'sem mudança', 'sem mudança') : null,
  ].filter(Boolean);
  return `Cópia importada: ${parts.join(' · ')}.${r.cloudLater ? ` ${CLOUD_LATER[r.cloudLater]}` : ''}`;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Não consegui concluir. Tente de novo.');

/**
 * Cópia da coleção (S7): exportar em JSON (para restaurar) ou CSV (planilha), sem os preços das fontes, e importar uma
 * cópia, que se junta à coleção carta por carta (vence a edição mais recente; nada é apagado). Sai como arquivo (na
 * web, baixado; no Android, numa pasta escolhida) e volta escolhendo o arquivo. No celular dá para colar o conteúdo.
 */
export function BackupCard() {
  const { exportCollection, importCollection } = useCollectionActions();
  const [busy, setBusy] = useState<'json' | 'csv' | 'import' | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  async function exportAs(kind: 'json' | 'csv') {
    setBusy(kind);
    setMessage(null);
    try {
      const backup = exportCollection();
      const content = kind === 'json' ? backupToJson(backup) : backupToCsv(backup);
      const saved = await saveBackupFile(content, backupFileName(kind), kind === 'json' ? 'application/json' : 'text/csv');
      if (saved) showToast({ message: saved });
    } catch (e) {
      setMessage({ text: errorMessage(e), error: true });
    }
    setBusy(null);
  }

  async function runImport(text: string | null) {
    if (text == null) return;
    setBusy('import');
    setMessage(null);
    try {
      const result = await importCollection(text);
      setMessage({ text: importText(result) });
      setPasted('');
      setPasting(false);
    } catch (e) {
      setMessage({ text: errorMessage(e), error: true });
    }
    setBusy(null);
  }

  async function pickAndImport() {
    try {
      await runImport(await pickBackupFile());
    } catch (e) {
      setMessage({ text: errorMessage(e), error: true });
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title} {...HEADING_3}>
          Cópia da coleção
        </Text>
        <Text style={styles.note}>Suas cartas, fichários e anotações, sem os preços (o app busca de novo).</Text>
        {Platform.OS === 'android' ? <Text style={styles.note}>Ao exportar, escolha uma pasta, como Documents. O Android não libera a pasta Download.</Text> : null}
      </View>
      <View style={styles.buttons}>
        <Button title="Exportar cópia" icon="download-outline" variant="secondary" onPress={() => exportAs('json')} busy={busy === 'json'} style={styles.button} />
        <Button title="Planilha (CSV)" icon="grid-outline" variant="secondary" onPress={() => exportAs('csv')} busy={busy === 'csv'} style={styles.button} />
      </View>
      {pasting ? (
        <View style={styles.paste}>
          <Input
            value={pasted}
            onChangeText={setPasted}
            placeholder="Cole aqui o conteúdo do arquivo .json"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Conteúdo da cópia"
            style={styles.pasteInput}
          />
          {/* Contorno: o vermelho da tela da conta é o "Entrar" ou o "Sincronizar agora". */}
          <Button title="Importar" variant="secondary" icon="push-outline" onPress={() => runImport(pasted)} busy={busy === 'import'} disabled={!pasted.trim()} />
          <Button title="Cancelar" variant="ghost" onPress={() => setPasting(false)} />
        </View>
      ) : (
        <>
          <Button title="Importar cópia" icon="push-outline" variant="ghost" onPress={pickAndImport} busy={busy === 'import'} />
          {/* Cópias antigas saíram do celular como texto. */}
          {WEB ? null : <Button title="Colar o conteúdo" variant="ghost" onPress={() => setPasting(true)} />}
        </>
      )}
      {message ? <Notice tone={message.error ? 'danger' : 'success'}>{message.text}</Notice> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { gap: space.xxs },
  title: { ...typography.heading, color: colors.heading },
  note: { ...typography.caption, color: colors.textMuted },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  button: { flexGrow: 1, flexBasis: 160 },
  paste: { gap: space.sm },
  pasteInput: { minHeight: 120, textAlignVertical: 'top' },
});
