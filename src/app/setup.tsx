import { router, Stack, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardAvoid } from '@/components/keyboard-avoid';
import {
  BOTTOM_BAR_SPACE,
  BottomBar,
  Button,
  Card,
  Chip,
  ChipGroup,
  ColorPicker,
  COVER_COLORS,
  Input,
  Loading,
  Notice,
  PokeballIcon,
  Row,
  Section,
  showToast,
  Stepper,
  useLayout,
} from '@/components/ui';
import { TOTAL_SPECIES } from '@/data/pokedex';
import {
  capacity,
  dexRange,
  extraSlots,
  isPlaced,
  MAX_COLS,
  MAX_ROWS,
  MAX_SLOTS_PER_POKEMON,
  pageSize,
  physicalMoves,
  REGIONS,
  totalPages,
  totalSlots,
  volumesText,
} from '@/lib/binder';
import { formatInt } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { DEFAULT_SETTINGS, LANG_LABEL, POKEDEX_BINDER, type BinderSettings, type CardLang } from '@/lib/types';
import { entriesOf, useCollection } from '@/store/collection';
import { colors, radius, semantic, space, typography, widths } from '@/theme';

const PRESETS = [
  { rows: 3, cols: 3, label: '9 (3×3)' },
  { rows: 3, cols: 4, label: '12 (3×4)' },
  { rows: 4, cols: 4, label: '16 (4×4)' },
  { rows: 4, cols: 5, label: '20 (4×5)' },
  { rows: 2, cols: 2, label: '4 (2×2)' },
];

/** Regiões da Pokédex nacional (as mesmas da régua da tela inicial), para fichários de uma geração só. */
const REGION_CHIPS = [{ id: 'all', label: 'Todas', from: 1, to: TOTAL_SPECIES }, ...REGIONS];

/**
 * O que muda no fichário físico (F7): "3 cartas mudam de lugar no fichário físico.", as que ficam de fora por causa
 * desta mudança (continuam salvas e voltam ao desfazer), as que voltam a ter bolso e, à parte, as que já estavam fora
 * (`stillOut`: desfazer esta mudança não as traz de volta).
 */
function changesText({ moved, hidden, shown }: { moved: number; hidden: number; shown: number }, stillOut: number) {
  const parts: string[] = [];
  if (moved) parts.push(`${formatInt(moved)} ${moved === 1 ? 'carta muda' : 'cartas mudam'} de lugar no fichário físico.`);
  if (hidden) {
    parts.push(
      hidden === 1
        ? '1 carta fica fora do fichário com essa mudança. Continua salva e volta se você desfizer.'
        : `${formatInt(hidden)} cartas ficam fora do fichário com essa mudança. Continuam salvas e voltam se você desfizer.`,
    );
  }
  if (shown) parts.push(shown === 1 ? '1 carta que estava fora volta para o fichário.' : `${formatInt(shown)} cartas que estavam fora voltam para o fichário.`);
  if (stillOut) {
    parts.push(
      stillOut === 1
        ? '1 carta já está fora do fichário nesta configuração (continua salva).'
        : `${formatInt(stillOut)} cartas já estão fora do fichário nesta configuração (continuam salvas).`,
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

export default function SetupScreen() {
  const { ready } = useCollection();
  // Espera carregar a configuração salva, para o formulário não começar com o padrão.
  if (!ready) return <Loading />;
  return <SetupForm />;
}

function SetupForm() {
  const { settings, saveSettings, entries } = useCollection();
  // Primeira abertura: decidido ao montar (a configuração pode chegar da nuvem enquanto a tela está aberta).
  const [firstTime] = useState(!settings);
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  // Teclado aberto no Android: o fim da rolagem ganha o espaço dele e o campo em foco sai de baixo.
  const scrollRef = useRef<ScrollViewInstance>(null);
  const keyboard = useKeyboardAvoid(scrollRef);
  const [s, setS] = useState<BinderSettings>(settings ?? DEFAULT_SETTINGS);
  const [sheetsText, setSheetsText] = useState(s.sheets ? String(s.sheets) : '');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [fromText, setFromText] = useState(() => String(dexRange(s).from));
  const [toText, setToText] = useState(() => String(dexRange(s).to));
  const update = (patch: Partial<BinderSettings>) => setS((prev) => ({ ...prev, ...patch }));
  function setRange(from: number, to: number) {
    setFromText(String(from));
    setToText(String(to));
    update({ dexFrom: from === 1 ? undefined : from, dexTo: to === TOTAL_SPECIES ? undefined : to });
  }

  /** Faixa digitada nos campos (vale mesmo se o usuário tocar em Salvar sem sair do campo). */
  function typedRange() {
    const from = Math.min(TOTAL_SPECIES, Math.max(1, Number(fromText) || 1));
    const to = Math.min(TOTAL_SPECIES, Math.max(from, Number(toText) || TOTAL_SPECIES));
    return { dexFrom: from === 1 ? undefined : from, dexTo: to === TOTAL_SPECIES ? undefined : to };
  }
  // O que vai ser salvo, com a faixa como está digitada: o resumo, os chips e os avisos acompanham a digitação (na web
  // não existe onEndEditing, e o campo pode nem perder o foco antes do Salvar).
  const draft: BinderSettings = { ...s, ...typedRange() };
  const range = dexRange(draft);

  // Quem entrou na conta na primeira abertura recebe o fichário da nuvem (S3): aí esta tela não tem mais o que fazer.
  // Só quando ela está na frente (com a Conta aberta por cima, é a Conta que volta para o fichário).
  const focused = useIsFocused();
  const arrived = firstTime && !!settings;
  useEffect(() => {
    if (!arrived || !focused || savingRef.current) return;
    showToast({ message: 'Fichário recebido da nuvem' });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [arrived, focused]);

  const cap = capacity(draft);
  const free = extraSlots(draft);
  // Cartas do fichário Pokédex que ficam de fora com essa configuração (F2: fora da faixa, num espaço além dos
  // "Espaços por Pokémon" ou num bolso extra que deixou de existir). Continuam salvas, só não aparecem.
  const pokedexCards = entriesOf(entries, POKEDEX_BINDER);
  const outside = pokedexCards.filter((e) => !isPlaced(draft, e)).length;
  // Em relação à configuração salva (F7): cartas que mudam de folha, lado, bolso ou fichário físico, as que saem por
  // causa desta mudança e as que voltam. As que já estavam fora e continuam fora não são efeito dela.
  const changes = !firstTime && settings ? physicalMoves(settings, draft, pokedexCards) : { moved: 0, hidden: 0, shown: 0 };
  const stillOut = outside - changes.hidden;
  const changed = changes.moved || changes.hidden || changes.shown || stillOut;
  const volumes = volumesText(draft);
  const needed = totalSlots(draft);
  const rangeLabel = range.count === TOTAL_SPECIES ? `${formatInt(TOTAL_SPECIES)} Pokémon` : `${formatInt(range.count)} Pokémon (#${range.from}–#${range.to})`;

  function toggleLang(l: CardLang) {
    const has = s.languages.includes(l);
    if (has && s.languages.length === 1) return;
    update({ languages: has ? s.languages.filter((x) => x !== l) : [...s.languages, l] });
  }

  async function save() {
    if (savingRef.current) return;
    // Com o que vai ser salvo (a faixa digitada vale mesmo sem sair do campo): pergunta antes de mexer no físico.
    savingRef.current = true;
    if ((changes.moved || changes.hidden) && !(await confirmSave(changesText(changes, stillOut)))) {
      savingRef.current = false;
      return;
    }
    setSaving(true);
    try {
      await saveSettings(draft);
    } catch {
      savingRef.current = false;
      setSaving(false);
      showToast({ message: 'Não consegui salvar o fichário. Tente de novo.', tone: 'error' });
      return;
    }
    if (!firstTime) showToast({ message: 'Fichário salvo' });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  return (
    <View style={styles.screen}>
      {/* Primeira abertura: sem voltar (não há para onde voltar; na web, headerBackVisible não vale) nem gesto. */}
      <Stack.Screen
        options={{
          title: firstTime ? 'Bem-vindo!' : 'Fichário Pokédex',
          ...(firstTime ? { headerLeft: () => null, headerBackVisible: false, gestureEnabled: false } : null),
        }}
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, { paddingHorizontal: gutter, paddingBottom: keyboard.bottomPad(BOTTOM_BAR_SPACE + insets.bottom) }]}
        keyboardShouldPersistTaps="handled"
        {...keyboard.scrollProps}>
        {firstTime ? (
          <View style={styles.welcome}>
            <PokeballIcon size={112} color={colors.heading} />
            <Text style={styles.welcomeTitle} role="heading" maxFontSizeMultiplier={1.3}>
              Monte seu fichário Pokédex
            </Text>
            <Text style={styles.lead}>Igual ao seu fichário de verdade: cada carta fica no mesmo bolso. Dá para mudar depois.</Text>
            {supabase ? (
              // Sem ícone e com pouco recuo lateral: só assim o texto cabe numa linha já em 360 px.
              <Button
                title="Já uso em outro aparelho · Entrar"
                variant="secondary"
                onPress={() => router.push({ pathname: '/account', params: { primeira: '1' } })}
                style={styles.signIn}
              />
            ) : null}
          </View>
        ) : null}

        <Card style={styles.card}>
          <Section title="Nome e capa">
            <Input value={s.name ?? ''} onChangeText={(name) => update({ name: name || undefined })} placeholder="Fichário Pokédex" maxLength={40} accessibilityLabel="Nome do fichário" onFocus={keyboard.onFocus} />
            {/* Sem capa escolhida, marca o vermelho da paleta (o vermelho da ação principal não é uma das opções). */}
            <ColorPicker value={s.color ?? COVER_COLORS[0].color} onChange={(color) => update({ color })} />
          </Section>
        </Card>

        <Card style={styles.card}>
          <Section title="Pokémon do fichário" hint="Uma região, ou a faixa da Pokédex">
            <ChipGroup label="Região">
              {REGION_CHIPS.map((r) => (
                <Chip key={r.id} label={r.label} selected={range.from === r.from && range.to === r.to} onPress={() => setRange(r.from, r.to)} />
              ))}
            </ChipGroup>
            <View style={styles.rangeRow}>
              {/* Ao sair do campo, o texto vira a faixa válida (onBlur: o onEndEditing não existe na web). */}
              <Input
                value={fromText}
                onChangeText={(t) => setFromText(t.replace(/\D/g, ''))}
                onBlur={() => setRange(range.from, range.to)}
                onFocus={keyboard.onFocus}
                keyboardType="number-pad"
                style={styles.rangeInput}
                accessibilityLabel="Do número da Pokédex"
              />
              <Text style={styles.until}>até</Text>
              <Input
                value={toText}
                onChangeText={(t) => setToText(t.replace(/\D/g, ''))}
                onBlur={() => setRange(range.from, range.to)}
                onFocus={keyboard.onFocus}
                keyboardType="number-pad"
                style={styles.rangeInput}
                accessibilityLabel="Até o número da Pokédex"
              />
            </View>
          </Section>
        </Card>

        <Card style={styles.card}>
          <Section title="Bolsos por página">
            <ChipGroup label="Bolsos por página">
              {PRESETS.map((p) => (
                <Chip key={p.label} label={p.label} selected={s.rows === p.rows && s.cols === p.cols} onPress={() => update({ rows: p.rows, cols: p.cols })} />
              ))}
            </ChipGroup>
            <Row label="Linhas">
              <Stepper value={s.rows} onChange={(rows) => update({ rows })} max={MAX_ROWS} label="linhas" />
            </Row>
            <Row label="Colunas">
              <Stepper value={s.cols} onChange={(cols) => update({ cols })} max={MAX_COLS} label="colunas" />
            </Row>
          </Section>
          <Section title="Folhas do fichário" hint="Opcional: para avisar se todas as cartas cabem">
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
              onFocus={keyboard.onFocus}
            />
            {/* A Pokédex inteira pode não caber num fichário só (F8): a posição da carta passa a dizer qual. */}
            {volumes ? <Text style={styles.fieldHint}>{volumes}</Text> : null}
            <ChipGroup label="Folhas">
              <Chip label="Frente e verso" selected={s.doubleSided} onPress={() => update({ doubleSided: true })} />
              <Chip label="Só frente" selected={!s.doubleSided} onPress={() => update({ doubleSided: false })} />
            </ChipGroup>
          </Section>
        </Card>

        <Card style={styles.card}>
          <Section title="Espaços por Pokémon" hint="Mais de 1 para versões lado a lado">
            <Row label="Espaços">
              <Stepper value={s.slotsPerPokemon} onChange={(slotsPerPokemon) => update({ slotsPerPokemon })} max={MAX_SLOTS_PER_POKEMON} label="espaços por Pokémon" />
            </Row>
          </Section>
          <Section title="Idiomas das cartas" hint="Os que aparecem ao escolher a carta">
            <ChipGroup label="Idiomas" mode="checkbox">
              {(Object.keys(LANG_LABEL) as CardLang[]).map((l) => (
                <Chip
                  key={l}
                  label={LANG_LABEL[l]}
                  mode="checkbox"
                  selected={s.languages.includes(l)}
                  // O último idioma marcado não sai (pelo menos um fica: ver toggleLang).
                  onPress={() => toggleLang(l)}
                />
              ))}
            </ChipGroup>
          </Section>
        </Card>

        {/* Aqui embaixo, perto do Salvar: a faixa, os bolsos, as folhas e os espaços mexem nas cartas (F2, F7). */}
        {changed ? <Notice tone={changes.moved || changes.hidden || stillOut ? 'warning' : 'info'}>{changesText(changes, stillOut)}</Notice> : null}

        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            {rangeLabel} × {formatInt(draft.slotsPerPokemon)} = {formatInt(needed)} espaços · {formatInt(pageSize(draft))} por página ·{' '}
            {formatInt(totalPages(draft))} páginas
            {free ? ` · ${formatInt(free)} ${free === 1 ? 'bolso livre' : 'bolsos livres'} na última página, para cartas especiais` : ''}
          </Text>
          {cap != null ? (
            <Text style={[styles.summaryText, styles.summaryFit, { color: cap >= needed ? semantic.success.fg : semantic.danger.fg }]}>
              {cap >= needed ? `Cabe tudo: o fichário tem ${formatInt(cap)} bolsos.` : `Faltam ${formatInt(needed - cap)} bolsos: o fichário tem ${formatInt(cap)}.`}
            </Text>
          ) : null}
        </View>
      </ScrollView>
      <BottomBar bottomInset={insets.bottom} width="form">
        <Button title={firstTime ? 'Começar' : 'Salvar fichário'} icon="checkmark-circle-outline" onPress={save} busy={saving} />
      </BottomBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // A margem lateral vem do useLayout().gutter.
  content: { paddingTop: space.lg, maxWidth: widths.form, width: '100%', alignSelf: 'center', gap: space.md },
  welcome: { alignItems: 'center', gap: space.md, paddingTop: space.xl, paddingBottom: space.lg },
  welcomeTitle: { ...typography.title, fontSize: 40, lineHeight: 50, color: colors.text, textAlign: 'center' },
  lead: { ...typography.body, color: colors.textMuted, textAlign: 'center', maxWidth: 420 },
  signIn: { alignSelf: 'stretch', marginTop: space.sm, paddingHorizontal: space.xs },
  card: { paddingBottom: 0 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Na web, o campo tem largura própria (min-width auto) e sairia da linha: com 0, os dois dividem o espaço.
  rangeInput: { flex: 1, minWidth: 0, textAlign: 'center' },
  until: { ...typography.bodyStrong, color: colors.textMuted },
  fieldHint: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  summary: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: space.lg, gap: space.xs },
  summaryText: { ...typography.caption, ...typography.tabular, color: colors.textMuted, textAlign: 'center' },
  summaryFit: { fontWeight: '700' },
});
