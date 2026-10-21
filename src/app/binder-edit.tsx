import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Button, Chip, Input, Section, Stepper } from '@/components/ui';
import { customSheets, customTotalSlots, newBinderId, pageSize } from '@/lib/binder';
import {
  BINDER_COLORS,
  BINDER_PURPOSES,
  DEFAULT_CUSTOM_BINDER,
  LANG_LABEL,
  type BinderPurpose,
  type CardLang,
  type CustomBinder,
} from '@/lib/types';
import { entriesOf, useCollection } from '@/store/collection';
import { colors, radius } from '@/theme';

const GRID_PRESETS = [
  { rows: 2, cols: 2, label: '4 (2×2)' },
  { rows: 3, cols: 3, label: '9 (3×3)' },
  { rows: 3, cols: 4, label: '12 (3×4)' },
  { rows: 4, cols: 4, label: '16 (4×4)' },
  { rows: 4, cols: 5, label: '20 (4×5)' },
];
const PAGE_PRESETS = [10, 20, 40, 60, 100];

/** Sugestão de tamanho para cada finalidade (só aplicada ao criar). */
const PURPOSE_DEFAULTS: Partial<Record<BinderPurpose, Partial<CustomBinder>>> = {
  deck: { rows: 3, cols: 3, pages: 8, showPrices: false },
  trade: { showPrices: true },
  graded: { rows: 2, cols: 2, pages: 10 },
};

export default function BinderEditScreen() {
  const { ready } = useCollection();
  // O formulário só monta depois de carregar a coleção: senão um fichário existente abriria como novo.
  if (!ready) return <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />;
  return <BinderForm />;
}

function BinderForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { binders, entries, saveBinder, deleteBinder, setActiveBinder } = useCollection();
  const existing = binders.find((b) => b.id === id);
  const [b, setB] = useState<CustomBinder>(
    existing ?? { ...DEFAULT_CUSTOM_BINDER, id: newBinderId(), createdAt: new Date().toISOString() },
  );
  const update = (patch: Partial<CustomBinder>) => setB((prev) => ({ ...prev, ...patch }));

  const cards = existing ? entriesOf(entries, existing.id) : [];
  const total = customTotalSlots(b);
  // Cartas que ficariam em bolsos que deixam de existir (fichário diminuído).
  const outside = cards.filter((e) => e.slot >= total).length;
  const name = b.name.trim();

  function choosePurpose(purpose: BinderPurpose) {
    const label = BINDER_PURPOSES.find((p) => p.id === purpose)?.label ?? '';
    const autoName = !name || BINDER_PURPOSES.some((p) => p.label === name);
    update({ purpose, ...(existing ? {} : PURPOSE_DEFAULTS[purpose]), ...(autoName ? { name: label } : {}) });
  }

  async function save() {
    const final = { ...b, name: name || BINDER_PURPOSES.find((p) => p.id === b.purpose)?.label || 'Fichário', description: b.description?.trim() || undefined };
    await saveBinder(final);
    if (existing) {
      router.back();
    } else {
      await setActiveBinder(final.id);
      router.dismissTo('/');
    }
  }

  function confirmDelete() {
    const msg = cards.length
      ? `Apagar "${b.name}" e as ${cards.length} cartas registradas nele? As cartas do fichário Pokédex não são afetadas.`
      : `Apagar "${b.name}"?`;
    const run = async () => {
      await deleteBinder(b.id);
      router.dismissTo('/');
    };
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) run();
      return;
    }
    Alert.alert('Apagar fichário', msg, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: run },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Personalizar fichário' : 'Novo fichário' }} />

      {/* Prévia da capa */}
      <View style={[styles.preview, { backgroundColor: b.color }]}>
        <Ionicons
          name={(BINDER_PURPOSES.find((p) => p.id === b.purpose)?.icon ?? 'albums-outline') as never}
          size={28}
          color="rgba(255,255,255,0.92)"
        />
        <Text style={styles.previewName} numberOfLines={2}>
          {name || 'Meu fichário'}
        </Text>
        <Text style={styles.previewSub}>
          {pageSize(b)} bolsos por página · {b.pages} páginas
        </Text>
      </View>

      <Section title="Finalidade">
        <View style={styles.wrap}>
          {BINDER_PURPOSES.map((p) => (
            <Chip key={p.id} label={p.label} selected={b.purpose === p.id} onPress={() => choosePurpose(p.id)} />
          ))}
        </View>
      </Section>

      <Section title="Nome">
        <Input value={b.name} onChangeText={(t) => update({ name: t })} placeholder="Ex.: Coleção 151, Trocas, Favoritas" maxLength={40} />
        <Input
          value={b.description ?? ''}
          onChangeText={(t) => update({ description: t })}
          placeholder="Descrição (opcional)"
          maxLength={120}
        />
      </Section>

      <Section title="Cor da capa">
        <View style={styles.wrap}>
          {BINDER_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => update({ color: c })}
              style={[styles.swatch, { backgroundColor: c }, b.color === c && styles.swatchActive]}
              accessibilityLabel={`Cor ${c}`}>
              {b.color === c ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
            </Pressable>
          ))}
        </View>
      </Section>

      <Section
        title="Bolsos por página"
        hint={
          existing && cards.length && (existing.rows !== b.rows || existing.cols !== b.cols)
            ? 'As cartas mantêm a ordem (bolso 1, 2, 3…), mas mudam de página e posição no fichário físico.'
            : undefined
        }>
        <View style={styles.wrap}>
          {GRID_PRESETS.map((p) => (
            <Chip key={p.label} label={p.label} selected={b.rows === p.rows && b.cols === p.cols} onPress={() => update({ rows: p.rows, cols: p.cols })} />
          ))}
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Linhas</Text>
          <Stepper value={b.rows} onChange={(rows) => update({ rows })} max={8} />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Colunas</Text>
          <Stepper value={b.cols} onChange={(cols) => update({ cols })} max={6} />
        </View>
      </Section>

      <Section title="Páginas" hint={`${customSheets(b)} folhas ${b.doubleSided ? '(frente e verso)' : '(só frente)'} · ${total} bolsos no total.`}>
        <View style={styles.wrap}>
          {PAGE_PRESETS.map((n) => (
            <Chip key={n} label={String(n)} selected={b.pages === n} onPress={() => update({ pages: n })} />
          ))}
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Páginas</Text>
          <Stepper value={b.pages} onChange={(pages) => update({ pages })} max={500} />
        </View>
        <View style={styles.wrap}>
          <Chip label="Frente e verso" selected={b.doubleSided} onPress={() => update({ doubleSided: true })} />
          <Chip label="Só frente" selected={!b.doubleSided} onPress={() => update({ doubleSided: false })} />
        </View>
      </Section>

      <Section title="Exibição">
        <Toggle label="Mostrar preços" hint="Valor de cada carta no MYP Cards, embaixo dela." value={b.showPrices} onChange={(showPrices) => update({ showPrices })} />
        <Toggle label="Numerar os bolsos vazios" value={b.showPocketNumbers} onChange={(showPocketNumbers) => update({ showPocketNumbers })} />
      </Section>

      <Section title="Idioma da busca" hint="Idioma que aparece primeiro ao escolher uma carta para um bolso.">
        <View style={styles.wrap}>
          {(Object.keys(LANG_LABEL) as CardLang[]).map((l) => (
            <Chip key={l} label={LANG_LABEL[l]} selected={b.searchLang === l} onPress={() => update({ searchLang: l })} />
          ))}
        </View>
      </Section>

      {outside ? (
        <Text style={styles.warn}>
          {outside} carta{outside > 1 ? 's ficariam' : ' ficaria'} fora do fichário com esse tamanho. Aumente as páginas ou os bolsos por página.
        </Text>
      ) : null}

      <View style={{ gap: 10 }}>
        <Button title={existing ? 'Salvar' : 'Criar fichário'} onPress={save} disabled={outside > 0} />
        {existing ? <Button title="Apagar fichário" variant="danger" onPress={confirmDelete} /> : null}
      </View>
    </ScrollView>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.surfaceAlt }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48, maxWidth: 640, width: '100%', alignSelf: 'center' },
  preview: { borderRadius: radius.lg, padding: 20, marginBottom: 24, gap: 6, minHeight: 130, justifyContent: 'flex-end' },
  previewName: { color: '#fff', fontSize: 22, fontWeight: '800' },
  previewSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: colors.text, fontSize: 15 },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: '#fff' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  warn: { color: colors.danger, fontSize: 13, marginBottom: 12, lineHeight: 18 },
});
