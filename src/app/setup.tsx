import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOTTOM_BAR_SPACE, BottomBar, Button, Card, Chip, ColorPicker, Input, Loading, Row, Section, Stepper } from '@/components/ui';
import { TOTAL_SPECIES } from '@/data/pokedex';
import { capacity, dexRange, extraSlots, pageSize, totalPages, totalSlots } from '@/lib/binder';
import { DEFAULT_SETTINGS, LANG_LABEL, type BinderSettings, type CardLang } from '@/lib/types';
import { useCollection } from '@/store/collection';
import { colors, MAX_WIDTH, radius } from '@/theme';

const PRESETS = [
  { rows: 3, cols: 3, label: '9 (3×3)' },
  { rows: 3, cols: 4, label: '12 (3×4)' },
  { rows: 4, cols: 4, label: '16 (4×4)' },
  { rows: 4, cols: 5, label: '20 (4×5)' },
  { rows: 2, cols: 2, label: '4 (2×2)' },
];

/** Regiões da Pokédex nacional, para fichários de uma geração só. */
const REGIONS = [
  { label: 'Todas', from: 1, to: TOTAL_SPECIES },
  { label: 'Kanto', from: 1, to: 151 },
  { label: 'Johto', from: 152, to: 251 },
  { label: 'Hoenn', from: 252, to: 386 },
  { label: 'Sinnoh', from: 387, to: 493 },
  { label: 'Unova', from: 494, to: 649 },
  { label: 'Kalos', from: 650, to: 721 },
  { label: 'Alola', from: 722, to: 809 },
  { label: 'Galar', from: 810, to: 905 },
  { label: 'Paldea', from: 906, to: TOTAL_SPECIES },
];

export default function SetupScreen() {
  const { ready } = useCollection();
  // Espera carregar a configuração salva, para o formulário não começar com o padrão.
  if (!ready) return <Loading />;
  return <SetupForm />;
}

function SetupForm() {
  const { settings, saveSettings, entries } = useCollection();
  const firstTime = !settings;
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<BinderSettings>(settings ?? DEFAULT_SETTINGS);
  const [sheetsText, setSheetsText] = useState(s.sheets ? String(s.sheets) : '');
  const [saving, setSaving] = useState(false);
  const range = dexRange(s);
  const [fromText, setFromText] = useState(String(range.from));
  const [toText, setToText] = useState(String(range.to));
  const update = (patch: Partial<BinderSettings>) => setS((prev) => ({ ...prev, ...patch }));
  function setRange(from: number, to: number) {
    setFromText(String(from));
    setToText(String(to));
    update({ dexFrom: from === 1 ? undefined : from, dexTo: to === TOTAL_SPECIES ? undefined : to });
  }

  const cap = capacity(s);
  // Cartas do fichário Pokédex que ficam fora da faixa escolhida (continuam salvas, só não aparecem).
  // Cartas especiais dos bolsos livres também ficam de fora se sobrarem menos bolsos livres na última página.
  const free = extraSlots(s);
  const outside = Object.values(entries).filter(
    (e) => !e.binderId && (e.dex === 0 ? e.slot >= free : e.dex < range.from || e.dex > range.to),
  ).length;
  const needed = totalSlots(s);
  const rangeLabel = range.count === TOTAL_SPECIES ? `${TOTAL_SPECIES} Pokémon` : `${range.count} Pokémon (#${range.from}–#${range.to})`;

  function toggleLang(l: CardLang) {
    const has = s.languages.includes(l);
    if (has && s.languages.length === 1) return;
    update({ languages: has ? s.languages.filter((x) => x !== l) : [...s.languages, l] });
  }

  /** Faixa digitada nos campos (vale mesmo se o usuário tocar em Salvar sem sair do campo). */
  function typedRange() {
    const from = Math.min(TOTAL_SPECIES, Math.max(1, Number(fromText) || 1));
    const to = Math.min(TOTAL_SPECIES, Math.max(from, Number(toText) || TOTAL_SPECIES));
    return { dexFrom: from === 1 ? undefined : from, dexTo: to === TOTAL_SPECIES ? undefined : to };
  }

  async function save() {
    setSaving(true);
    await saveSettings({ ...s, ...typedRange() });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: firstTime ? 'Bem-vindo!' : 'Fichário Pokédex', headerBackVisible: !firstTime }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: BOTTOM_BAR_SPACE + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {firstTime ? (
          <View style={styles.welcome}>
            <MaterialCommunityIcons name="pokeball" size={44} color={colors.primary} />
            <Text style={styles.welcomeTitle}>Monte seu fichário Pokédex</Text>
            <Text style={styles.lead}>
              Conte como é o seu fichário físico. O app monta as páginas iguais às dele, então cada carta fica na mesma posição no app e no
              fichário. Dá para mudar tudo depois.
            </Text>
          </View>
        ) : (
          <Text style={styles.lead}>
            O app monta as páginas iguais às do seu fichário físico: cada carta fica na mesma posição no app e no fichário.
          </Text>
        )}

        <Card style={styles.card}>
          <Section title="Nome e capa">
            <Input value={s.name ?? ''} onChangeText={(name) => update({ name: name || undefined })} placeholder="Fichário Pokédex" maxLength={40} accessibilityLabel="Nome do fichário" />
            <ColorPicker value={s.color ?? colors.primary} onChange={(color) => update({ color })} />
          </Section>
        </Card>

        <Card style={styles.card}>
          <Section title="Pokémon do fichário" hint="Escolha uma região para um fichário por geração, ou digite a faixa da Pokédex.">
            <View style={styles.wrap}>
              {REGIONS.map((r) => (
                <Chip key={r.label} label={r.label} selected={range.from === r.from && range.to === r.to} onPress={() => setRange(r.from, r.to)} />
              ))}
            </View>
            <View style={styles.rangeRow}>
              <Input
                value={fromText}
                onChangeText={(t) => setFromText(t.replace(/\D/g, ''))}
                onEndEditing={() => {
                  const from = Math.min(TOTAL_SPECIES, Math.max(1, Number(fromText) || 1));
                  setRange(from, Math.max(from, range.to));
                }}
                keyboardType="number-pad"
                style={styles.rangeInput}
                accessibilityLabel="Do número da Pokédex"
              />
              <Text style={styles.until}>até</Text>
              <Input
                value={toText}
                onChangeText={(t) => setToText(t.replace(/\D/g, ''))}
                onEndEditing={() => setRange(range.from, Math.min(TOTAL_SPECIES, Math.max(range.from, Number(toText) || TOTAL_SPECIES)))}
                keyboardType="number-pad"
                style={styles.rangeInput}
                accessibilityLabel="Até o número da Pokédex"
              />
            </View>
            {outside ? (
              <Text style={styles.warn}>
                {outside > 1
                  ? `${outside} cartas ficam fora do fichário com essa configuração. Elas continuam salvas e voltam a aparecer se você voltar atrás.`
                  : '1 carta fica fora do fichário com essa configuração. Ela continua salva e volta a aparecer se você voltar atrás.'}
              </Text>
            ) : null}
          </Section>
        </Card>

        <Card style={styles.card}>
          <Section title="Bolsos por página">
            <View style={styles.wrap}>
              {PRESETS.map((p) => (
                <Chip key={p.label} label={p.label} selected={s.rows === p.rows && s.cols === p.cols} onPress={() => update({ rows: p.rows, cols: p.cols })} />
              ))}
            </View>
            <Row label="Linhas">
              <Stepper value={s.rows} onChange={(rows) => update({ rows })} max={8} label="linhas" />
            </Row>
            <Row label="Colunas">
              <Stepper value={s.cols} onChange={(cols) => update({ cols })} max={6} label="colunas" />
            </Row>
          </Section>
          <Section title="Folhas do fichário" hint="Opcional. Serve para avisar se todas as cartas cabem.">
            <Input
              value={sheetsText}
              onChangeText={(t) => {
                const clean = t.replace(/\D/g, '');
                setSheetsText(clean);
                update({ sheets: clean ? Number(clean) : undefined });
              }}
              keyboardType="number-pad"
              placeholder="Ex.: 40"
              accessibilityLabel="Número de folhas"
            />
            <View style={styles.wrap}>
              <Chip label="Frente e verso" selected={s.doubleSided} onPress={() => update({ doubleSided: true })} />
              <Chip label="Só frente" selected={!s.doubleSided} onPress={() => update({ doubleSided: false })} />
            </View>
          </Section>
        </Card>

        <Card style={styles.card}>
          <Section
            title="Espaços por Pokémon"
            hint="1 = desafio clássico, uma carta para cada Pokémon. Use mais espaços para guardar várias versões do mesmo Pokémon lado a lado.">
            <Row label="Espaços">
              <Stepper value={s.slotsPerPokemon} onChange={(slotsPerPokemon) => update({ slotsPerPokemon })} max={6} label="espaços por Pokémon" />
            </Row>
          </Section>
          <Section title="Idiomas das cartas" hint="Quais idiomas aparecem na hora de escolher a carta.">
            <View style={styles.wrap}>
              {(Object.keys(LANG_LABEL) as CardLang[]).map((l) => (
                <Chip key={l} label={LANG_LABEL[l]} selected={s.languages.includes(l)} onPress={() => toggleLang(l)} />
              ))}
            </View>
          </Section>
        </Card>

        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            {rangeLabel} × {s.slotsPerPokemon} = {needed} espaços · {pageSize(s)} por página · {totalPages(s)} páginas
            {free ? ` · ${free} ${free === 1 ? 'bolso livre' : 'bolsos livres'} na última página para cartas especiais` : ''}
          </Text>
          {cap != null ? (
            <Text style={[styles.summaryText, { color: cap >= needed ? colors.success : colors.danger, marginTop: 6, fontWeight: '700' }]}>
              {cap >= needed
                ? `Cabe tudo: o fichário tem ${cap} bolsos.`
                : `Faltam ${needed - cap} bolsos: o fichário tem ${cap}. Você vai precisar de mais fichários.`}
            </Text>
          ) : null}
        </View>
      </ScrollView>
      <BottomBar bottomInset={insets.bottom}>
        <Button title={firstTime ? 'Começar' : 'Salvar fichário'} icon="checkmark-circle-outline" onPress={save} busy={saving} />
      </BottomBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center', gap: 12 },
  welcome: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  welcomeTitle: { color: colors.text, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  lead: { color: colors.textMuted, fontSize: 15, lineHeight: 21, textAlign: 'center', marginBottom: 4 },
  card: { paddingBottom: 0 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rangeInput: { flex: 1, textAlign: 'center' },
  until: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  warn: { color: colors.warning, fontSize: 13, lineHeight: 18 },
  summary: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 14 },
  summaryText: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
