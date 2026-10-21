import { router } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Chip, Input, Section, Stepper } from '@/components/ui';
import { TOTAL_SPECIES } from '@/data/pokedex';
import { capacity, dexRange, pageSize, totalPages, totalSlots } from '@/lib/binder';
import { BINDER_COLORS, DEFAULT_SETTINGS, LANG_LABEL, type BinderSettings, type CardLang } from '@/lib/types';
import { useCollection } from '@/store/collection';
import { colors, radius } from '@/theme';

const PRESETS = [
  { rows: 3, cols: 3, label: '9 bolsos (3×3)' },
  { rows: 3, cols: 4, label: '12 bolsos (3×4)' },
  { rows: 4, cols: 4, label: '16 bolsos (4×4)' },
  { rows: 4, cols: 5, label: '20 bolsos (4×5)' },
  { rows: 2, cols: 2, label: '4 bolsos (2×2)' },
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
  if (!ready) return <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />;
  return <SetupForm />;
}

function SetupForm() {
  const { settings, saveSettings, entries } = useCollection();
  const [s, setS] = useState<BinderSettings>(settings ?? DEFAULT_SETTINGS);
  const [sheetsText, setSheetsText] = useState(s.sheets ? String(s.sheets) : '');
  const range = dexRange(s);
  const [fromText, setFromText] = useState(String(range.from));
  const [toText, setToText] = useState(String(range.to));
  function setRange(from: number, to: number) {
    setFromText(String(from));
    setToText(String(to));
    update({ dexFrom: from === 1 ? undefined : from, dexTo: to === TOTAL_SPECIES ? undefined : to });
  }
  const update = (patch: Partial<BinderSettings>) => setS((prev) => ({ ...prev, ...patch }));

  const cap = capacity(s);
  // Cartas do fichário Pokédex que ficam fora da faixa escolhida (continuam salvas, só não aparecem).
  const outside = Object.values(entries).filter((e) => !e.binderId && (e.dex < range.from || e.dex > range.to)).length;
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
    await saveSettings({ ...s, ...typedRange() });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        Conte como é o seu fichário físico. O app monta as páginas iguais às dele, então cada carta fica na mesma posição do app e do fichário.
      </Text>

      <Section title="Nome e capa">
        <Input value={s.name ?? ''} onChangeText={(name) => update({ name: name || undefined })} placeholder="Fichário Pokédex" maxLength={40} />
        <View style={styles.wrap}>
          {BINDER_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => update({ color: c })}
              style={[styles.swatch, { backgroundColor: c }, (s.color ?? colors.accent) === c && styles.swatchActive]}
              accessibilityLabel={`Cor ${c}`}>
              {(s.color ?? colors.accent) === c ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="Pokémon do fichário" hint="Use uma região para montar um fichário por geração, ou digite a faixa da Pokédex.">
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
            accessibilityLabel="Do número"
          />
          <Text style={styles.label}>até</Text>
          <Input
            value={toText}
            onChangeText={(t) => setToText(t.replace(/\D/g, ''))}
            onEndEditing={() => setRange(range.from, Math.min(TOTAL_SPECIES, Math.max(range.from, Number(toText) || TOTAL_SPECIES)))}
            keyboardType="number-pad"
            style={styles.rangeInput}
            accessibilityLabel="Até o número"
          />
        </View>
      </Section>

      {outside ? (
        <Text style={styles.warn}>
          {outside > 1
            ? `${outside} cartas ficam fora dessa faixa. Elas continuam salvas e voltam a aparecer se você aumentar a faixa.`
            : '1 carta fica fora dessa faixa. Ela continua salva e volta a aparecer se você aumentar a faixa.'}
        </Text>
      ) : null}

      <Section title="Bolsos por página">
        <View style={styles.wrap}>
          {PRESETS.map((p) => (
            <Chip
              key={p.label}
              label={p.label}
              selected={s.rows === p.rows && s.cols === p.cols}
              onPress={() => update({ rows: p.rows, cols: p.cols })}
            />
          ))}
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Linhas</Text>
          <Stepper value={s.rows} onChange={(rows) => update({ rows })} max={8} />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Colunas</Text>
          <Stepper value={s.cols} onChange={(cols) => update({ cols })} max={6} />
        </View>
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
        />
        <View style={styles.wrap}>
          <Chip label="Frente e verso" selected={s.doubleSided} onPress={() => update({ doubleSided: true })} />
          <Chip label="Só frente" selected={!s.doubleSided} onPress={() => update({ doubleSided: false })} />
        </View>
      </Section>

      <Section
        title="Espaços por Pokémon"
        hint="1 = desafio clássico, uma carta para cada Pokémon. Use mais espaços se quiser guardar várias versões do mesmo Pokémon lado a lado.">
        <View style={styles.row}>
          <Text style={styles.label}>Espaços</Text>
          <Stepper value={s.slotsPerPokemon} onChange={(slotsPerPokemon) => update({ slotsPerPokemon })} max={6} />
        </View>
      </Section>

      <Section title="Idiomas das cartas" hint="Quais idiomas aparecem na hora de escolher a carta.">
        <View style={styles.wrap}>
          {(Object.keys(LANG_LABEL) as CardLang[]).map((l) => (
            <Chip key={l} label={LANG_LABEL[l]} selected={s.languages.includes(l)} onPress={() => toggleLang(l)} />
          ))}
        </View>
      </Section>

      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {rangeLabel} × {s.slotsPerPokemon} = {needed} espaços · {pageSize(s)} por página · {totalPages(s)} páginas
        </Text>
        {cap != null ? (
          <Text style={[styles.summaryText, { color: cap >= needed ? colors.success : colors.danger, marginTop: 6 }]}>
            {cap >= needed
              ? `Cabe tudo: o fichário tem ${cap} bolsos.`
              : `Faltam ${needed - cap} bolsos: o fichário tem ${cap}. Você vai precisar de mais fichários.`}
          </Text>
        ) : null}
      </View>

      <Button title="Salvar fichário" onPress={save} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48, maxWidth: 640, width: '100%', alignSelf: 'center' },
  lead: { color: colors.textMuted, fontSize: 15, lineHeight: 21, marginBottom: 24 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: colors.text, fontSize: 15 },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: '#fff' },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rangeInput: { flex: 1, textAlign: 'center' },
  warn: { color: colors.gold, fontSize: 13, lineHeight: 18, marginTop: -12, marginBottom: 20 },
  summary: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginBottom: 16 },
  summaryText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
});
