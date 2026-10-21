import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOTTOM_BAR_SPACE, BottomBar, Button, Card, Chip, ColorPicker, Input, Loading, onCover, Row, Section, Stepper, Toggle } from '@/components/ui';
import { customSheets, customTotalSlots, newBinderId, pageSize } from '@/lib/binder';
import { BINDER_PURPOSES, DEFAULT_CUSTOM_BINDER, LANG_LABEL, type BinderPurpose, type CardLang, type CustomBinder } from '@/lib/types';
import { entriesOf, useCollection } from '@/store/collection';
import { colors, MAX_WIDTH, radius, shadow } from '@/theme';

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
  if (!ready) return <Loading />;
  return <BinderForm />;
}

function BinderForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { binders, entries, saveBinder, deleteBinder, setActiveBinder } = useCollection();
  const insets = useSafeAreaInsets();
  const existing = binders.find((b) => b.id === id);
  const [b, setB] = useState<CustomBinder>(existing ?? { ...DEFAULT_CUSTOM_BINDER, id: newBinderId(), createdAt: new Date().toISOString() });
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<CustomBinder>) => setB((prev) => ({ ...prev, ...patch }));

  const cards = existing ? entriesOf(entries, existing.id) : [];
  const total = customTotalSlots(b);
  // Cartas que ficariam em bolsos que deixam de existir (fichário diminuído).
  const outside = cards.filter((e) => e.slot >= total).length;
  const name = b.name.trim();
  const purpose = BINDER_PURPOSES.find((p) => p.id === b.purpose) ?? BINDER_PURPOSES[0];
  const ink = onCover(b.color);

  function choosePurpose(next: BinderPurpose) {
    const label = BINDER_PURPOSES.find((p) => p.id === next)?.label ?? '';
    const autoName = !name || BINDER_PURPOSES.some((p) => p.label === name);
    update({ purpose: next, ...(existing ? {} : PURPOSE_DEFAULTS[next]), ...(autoName ? { name: label } : {}) });
  }

  async function save() {
    setSaving(true);
    const final = { ...b, name: name || purpose.label || 'Fichário', description: b.description?.trim() || undefined };
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
    <View style={styles.screen}>
      <Stack.Screen options={{ title: existing ? 'Personalizar fichário' : 'Novo fichário' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: BOTTOM_BAR_SPACE + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {/* Prévia da capa */}
        <View style={[styles.preview, { backgroundColor: b.color }]}>
          <View style={[styles.previewRing, { borderColor: ink }]}>
            <Ionicons name={purpose.icon as never} size={26} color={ink} />
          </View>
          <Text style={[styles.previewName, { color: ink }]} numberOfLines={2}>
            {name || purpose.label}
          </Text>
          <Text style={[styles.previewSub, { color: ink }]}>
            {pageSize(b)} bolsos por página · {b.pages} páginas · {total} bolsos
          </Text>
        </View>

        <Card style={styles.card}>
          <Section title="Para que serve">
            <View style={styles.wrap}>
              {BINDER_PURPOSES.map((p) => (
                <Chip key={p.id} label={p.label} icon={p.icon as never} selected={b.purpose === p.id} onPress={() => choosePurpose(p.id)} />
              ))}
            </View>
          </Section>
          <Section title="Nome">
            <Input value={b.name} onChangeText={(t) => update({ name: t })} placeholder={`${purpose.label} (ou digite: Coleção 151, Favoritas…)`} maxLength={40} accessibilityLabel="Nome do fichário" />
            <Input value={b.description ?? ''} onChangeText={(t) => update({ description: t })} placeholder="Descrição (opcional)" maxLength={120} accessibilityLabel="Descrição" />
          </Section>
          <Section title="Cor da capa">
            <ColorPicker value={b.color} onChange={(color) => update({ color })} />
          </Section>
        </Card>

        <Card style={styles.card}>
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
            <Row label="Linhas">
              <Stepper value={b.rows} onChange={(rows) => update({ rows })} max={8} label="linhas" />
            </Row>
            <Row label="Colunas">
              <Stepper value={b.cols} onChange={(cols) => update({ cols })} max={6} label="colunas" />
            </Row>
          </Section>
          <Section title="Páginas" hint={`${customSheets(b)} folhas ${b.doubleSided ? '(frente e verso)' : '(só frente)'} · ${total} bolsos no total.`}>
            <View style={styles.wrap}>
              {PAGE_PRESETS.map((n) => (
                <Chip key={n} label={String(n)} selected={b.pages === n} onPress={() => update({ pages: n })} />
              ))}
            </View>
            <Row label="Páginas">
              <Stepper value={b.pages} onChange={(pages) => update({ pages })} max={500} label="páginas" />
            </Row>
            <View style={styles.wrap}>
              <Chip label="Frente e verso" selected={b.doubleSided} onPress={() => update({ doubleSided: true })} />
              <Chip label="Só frente" selected={!b.doubleSided} onPress={() => update({ doubleSided: false })} />
            </View>
          </Section>
        </Card>

        <Card style={styles.card}>
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
        </Card>

        {outside ? (
          <Text style={styles.warn}>
            {outside} carta{outside > 1 ? 's ficariam' : ' ficaria'} fora do fichário com esse tamanho. Aumente as páginas ou os bolsos por página.
          </Text>
        ) : null}

        {existing ? <Button title="Apagar fichário" variant="danger" icon="trash-outline" onPress={confirmDelete} /> : null}
      </ScrollView>
      <BottomBar bottomInset={insets.bottom}>
        <Button
          title={existing ? 'Salvar' : 'Criar fichário'}
          icon="checkmark-circle-outline"
          onPress={save}
          busy={saving}
          disabled={outside > 0}
        />
      </BottomBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 12, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  preview: { borderRadius: radius.lg, padding: 20, gap: 6, minHeight: 140, justifyContent: 'flex-end', ...shadow },
  previewRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 'auto',
  },
  previewName: { fontSize: 24, fontWeight: '900' },
  previewSub: { fontSize: 13, fontWeight: '600', opacity: 0.85 },
  card: { paddingBottom: 0 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  warn: { color: colors.danger, fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
