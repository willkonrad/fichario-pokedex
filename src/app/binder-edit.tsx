import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { digitsInSystemFont } from '@/components/digits';
import { useKeyboardAvoid } from '@/components/keyboard-avoid';
import {
  BOTTOM_BAR_SPACE,
  BottomBar,
  Button,
  Card,
  Chip,
  ChipGroup,
  ColorPicker,
  Input,
  Loading,
  Notice,
  coverFill, onCover,
  Row,
  Section,
  showToast,
  Stepper,
  Toggle,
  useLayout,
} from '@/components/ui';
import { customPhysicalMoves, customSheets, customTotalSlots, isPlacedCustom, newBinderId, pageSize } from '@/lib/binder';
import { formatInt } from '@/lib/format';
import { BINDER_PURPOSES, DEFAULT_CUSTOM_BINDER, LANG_LABEL, type BinderPurpose, type CardLang, type CustomBinder } from '@/lib/types';
import { entriesOf, useCollection } from '@/store/collection';
import { colors, radius, space, typography, widths } from '@/theme';

const GRID_PRESETS = [
  { rows: 2, cols: 2, label: '4 (2×2)' },
  { rows: 3, cols: 3, label: '9 (3×3)' },
  { rows: 3, cols: 4, label: '12 (3×4)' },
  { rows: 4, cols: 4, label: '16 (4×4)' },
  { rows: 4, cols: 5, label: '20 (4×5)' },
];
const PAGE_PRESETS = [10, 20, 40, 60, 100];

/**
 * O que muda no fichário físico (F7): "3 cartas mudam de lugar no fichário físico." e as que ficam de fora (bolsos
 * que deixam de existir), que continuam salvas.
 */
function changesText(moved: number, outside: number) {
  const parts: string[] = [];
  if (moved) parts.push(`${formatInt(moved)} ${moved === 1 ? 'carta muda' : 'cartas mudam'} de lugar no fichário físico.`);
  if (outside) {
    parts.push(
      outside === 1
        ? '1 carta fica fora do fichário com esse tamanho. Continua salva e volta se você aumentar o fichário.'
        : `${formatInt(outside)} cartas ficam fora do fichário com esse tamanho. Continuam salvas e voltam se você aumentar o fichário.`,
    );
  }
  return parts.join(' ');
}

/** Pergunta antes de salvar (no celular, um alerta; na web, a confirmação do navegador). */
function confirmSave(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${message}\n\nSalvar mesmo assim?`));
  return new Promise((resolve) => {
    Alert.alert(
      'Salvar mesmo assim?',
      message,
      [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Salvar', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

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
  const { gutter } = useLayout();
  // Teclado aberto no Android: o fim da rolagem ganha o espaço dele e o campo em foco sai de baixo.
  const scrollRef = useRef<ScrollViewInstance>(null);
  const keyboard = useKeyboardAvoid(scrollRef);
  const existing = binders.find((b) => b.id === id);
  const [b, setB] = useState<CustomBinder>(existing ?? { ...DEFAULT_CUSTOM_BINDER, id: newBinderId(), createdAt: new Date().toISOString() });
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<CustomBinder>) => setB((prev) => ({ ...prev, ...patch }));

  const cards = existing ? entriesOf(entries, existing.id) : [];
  const total = customTotalSlots(b);
  // Cartas em bolsos que deixam de existir (fichário diminuído): continuam salvas, a tela inicial lista as de fora (F2).
  const outside = cards.filter((e) => !isPlacedCustom(b, e)).length;
  // Cartas que mudam de folha, lado ou bolso no fichário físico com a grade, as páginas ou frente e verso novos (F7).
  const { moved, hidden } = existing ? customPhysicalMoves(existing, b, cards) : { moved: 0, hidden: 0 };
  const name = b.name.trim();
  const purpose = BINDER_PURPOSES.find((p) => p.id === b.purpose) ?? BINDER_PURPOSES[0];
  const ink = onCover(b.color);

  function choosePurpose(next: BinderPurpose) {
    const label = BINDER_PURPOSES.find((p) => p.id === next)?.label ?? '';
    const autoName = !name || BINDER_PURPOSES.some((p) => p.label === name);
    update({ purpose: next, ...(existing ? {} : PURPOSE_DEFAULTS[next]), ...(autoName ? { name: label } : {}) });
  }

  async function save() {
    if (saving) return;
    if ((moved || hidden) && !(await confirmSave(changesText(moved, outside)))) return;
    setSaving(true);
    const final = { ...b, name: name || purpose.label || 'Fichário', description: b.description?.trim() || undefined };
    try {
      await saveBinder(final);
    } catch {
      setSaving(false);
      showToast({ message: 'Não consegui salvar o fichário. Tente de novo.', tone: 'error' });
      return;
    }
    if (existing) {
      showToast({ message: 'Fichário salvo' });
      router.back();
    } else {
      await setActiveBinder(final.id);
      // "Fichário" na frente: o nome pode ser de qualquer gênero ("Coleção 151", "Trocas").
      showToast({ message: `Fichário "${final.name}" criado` });
      router.dismissTo('/');
    }
  }

  function confirmDelete() {
    const msg = cards.length
      ? `Apagar "${b.name}" e as ${formatInt(cards.length)} cartas registradas nele? As cartas do fichário Pokédex não são afetadas.`
      : `Apagar "${b.name}"?`;
    const run = async () => {
      try {
        await deleteBinder(b.id);
      } catch {
        showToast({ message: 'Não consegui apagar o fichário. Tente de novo.', tone: 'error' });
        return;
      }
      showToast({ message: `Fichário "${existing?.name ?? b.name}" apagado` });
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
      <Stack.Screen options={{ title: existing ? `Personalizar ${existing.name}` : 'Novo fichário' }} />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingHorizontal: gutter, paddingBottom: keyboard.bottomPad(BOTTOM_BAR_SPACE + insets.bottom) }]}
        keyboardShouldPersistTaps="handled"
        {...keyboard.scrollProps}>
        {/* Prévia da capa */}
        <View style={[styles.preview, { backgroundColor: coverFill(b.color) }]} accessible accessibilityLabel={`Prévia da capa: ${name || purpose.label}`}>
          <View style={[styles.previewRing, { borderColor: ink }]}>
            <Ionicons name={purpose.icon as never} size={26} color={ink} />
          </View>
          <Text style={[styles.previewName, { color: ink }]} numberOfLines={2}>
            {digitsInSystemFont(name || purpose.label)}
          </Text>
          <Text style={[styles.previewSub, { color: ink }]}>
            {formatInt(pageSize(b))} bolsos por página · {formatInt(b.pages)} páginas · {formatInt(total)} bolsos
          </Text>
        </View>

        <Card style={styles.card}>
          <Section title="Para que serve">
            <ChipGroup label="Para que serve">
              {BINDER_PURPOSES.map((p) => (
                <Chip key={p.id} label={p.label} icon={p.icon as never} selected={b.purpose === p.id} onPress={() => choosePurpose(p.id)} />
              ))}
            </ChipGroup>
          </Section>
          <Section title="Nome">
            <Input value={b.name} onChangeText={(t) => update({ name: t })} placeholder={`${purpose.label} (ou digite: Coleção 151, Favoritas…)`} maxLength={40} accessibilityLabel="Nome do fichário" onFocus={keyboard.onFocus} />
            <Input value={b.description ?? ''} onChangeText={(t) => update({ description: t })} placeholder="Descrição (opcional)" maxLength={120} accessibilityLabel="Descrição" onFocus={keyboard.onFocus} />
          </Section>
          <Section title="Cor da capa">
            <ColorPicker value={b.color} onChange={(color) => update({ color })} />
          </Section>
        </Card>

        <Card style={styles.card}>
          {/* Sem legenda: quando a grade muda alguma carta de lugar, o aviso perto do Salvar diz quantas. */}
          <Section title="Bolsos por página">
            <ChipGroup label="Bolsos por página">
              {GRID_PRESETS.map((p) => (
                <Chip key={p.label} label={p.label} selected={b.rows === p.rows && b.cols === p.cols} onPress={() => update({ rows: p.rows, cols: p.cols })} />
              ))}
            </ChipGroup>
            <Row label="Linhas">
              <Stepper value={b.rows} onChange={(rows) => update({ rows })} max={8} label="linhas" />
            </Row>
            <Row label="Colunas">
              <Stepper value={b.cols} onChange={(cols) => update({ cols })} max={6} label="colunas" />
            </Row>
          </Section>
          <Section title="Páginas" hint={`${formatInt(customSheets(b))} folhas ${b.doubleSided ? '(frente e verso)' : '(só frente)'} · ${formatInt(total)} bolsos`}>
            <ChipGroup label="Páginas">
              {PAGE_PRESETS.map((n) => (
                <Chip key={n} label={String(n)} accessibilityLabel={`${n} páginas`} selected={b.pages === n} onPress={() => update({ pages: n })} />
              ))}
            </ChipGroup>
            <Row label="Páginas">
              <Stepper value={b.pages} onChange={(pages) => update({ pages })} max={500} label="páginas" />
            </Row>
            <ChipGroup label="Folhas">
              <Chip label="Frente e verso" selected={b.doubleSided} onPress={() => update({ doubleSided: true })} />
              <Chip label="Só frente" selected={!b.doubleSided} onPress={() => update({ doubleSided: false })} />
            </ChipGroup>
          </Section>
        </Card>

        <Card style={styles.card}>
          <Section title="Exibição">
            <Toggle label="Mostrar preços" hint="O valor de cada carta, embaixo dela" value={b.showPrices} onChange={(showPrices) => update({ showPrices })} />
            <Toggle label="Numerar os bolsos vazios" value={b.showPocketNumbers} onChange={(showPocketNumbers) => update({ showPocketNumbers })} />
          </Section>
          <Section title="Idioma da busca" hint="O que aparece primeiro ao escolher uma carta">
            <ChipGroup label="Idioma da busca">
              {(Object.keys(LANG_LABEL) as CardLang[]).map((l) => (
                <Chip key={l} label={LANG_LABEL[l]} selected={b.searchLang === l} onPress={() => update({ searchLang: l })} />
              ))}
            </ChipGroup>
          </Section>
        </Card>

        {moved || outside ? <Notice tone="warning">{changesText(moved, outside)}</Notice> : null}

        {existing ? <Button title="Apagar fichário" variant="danger" icon="trash-outline" onPress={confirmDelete} /> : null}
      </ScrollView>
      <BottomBar bottomInset={insets.bottom} width="form">
        <Button
          title={existing ? 'Salvar' : 'Criar fichário'}
          icon="checkmark-circle-outline"
          onPress={save}
          busy={saving}
        />
      </BottomBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // A margem lateral vem do useLayout().gutter.
  content: { paddingTop: space.lg, gap: space.md, maxWidth: widths.form, width: '100%', alignSelf: 'center' },
  // A borda mantém a capa preta visível sobre o fundo preto.
  preview: { borderRadius: radius.lg, padding: space.xl, gap: space.xs, minHeight: 140, justifyContent: 'flex-end', borderWidth: 1, borderColor: colors.border },
  previewRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 'auto',
  },
  previewName: { ...typography.title },
  // Sem opacidade: texto sobre a capa na cor sólida (contraste).
  previewSub: { ...typography.caption, fontWeight: '600' },
  card: { paddingBottom: 0 },
});
