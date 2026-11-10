import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HowWeCalculateSheet, SourceCreditsLine } from '@/components/collection-value';
import { digitsInSystemFont } from '@/components/digits';
import { type PressState } from '@/components/icon-button';
import { Badge, Button, IconButton, InfoButton, coverFill, onCover, PokeballIcon, useLayout, type IconName } from '@/components/ui';
import { TOTAL_SPECIES } from '@/data/pokedex';
import { customTotalSlots, dexRange, isPlaced, isPlacedCustom } from '@/lib/binder';
import { collectionTotalText } from '@/lib/copy';
import { formatBRL, formatBRLTight, formatInt } from '@/lib/format';
import { collectionTotals } from '@/lib/quotes';
import { BINDER_PURPOSES, POKEDEX_BINDER } from '@/lib/types';
import { entriesOf, useCollection } from '@/store/collection';
import { colors, radius, semantic, space, typography, widths } from '@/theme';

/** Estante: todos os fichários do usuário, para abrir, editar ou criar um novo. */
export default function BindersScreen() {
  const { settings, entries, binders, activeBinderId, setActiveBinder } = useCollection();
  const { gutter } = useLayout();
  const [info, setInfo] = useState(false);

  const rows = useMemo(() => {
    const pokedex = entriesOf(entries, POKEDEX_BINDER);
    const range = settings ? dexRange(settings) : null;
    return [
      {
        id: POKEDEX_BINDER,
        name: settings?.name || 'Fichário Pokédex',
        color: settings?.color ?? colors.primary,
        icon: null as IconName | null,
        kind: range && range.count < TOTAL_SPECIES ? `Pokédex #${range.from}–#${range.to}` : 'Pokédex completa',
        // Pokémon com carta num espaço que existe na configuração atual, como no topo da tela inicial (F2).
        filled: new Set(pokedex.filter((e) => e.dex > 0 && (!settings || isPlaced(settings, e))).map((e) => e.dex)).size,
        total: range?.count ?? 0,
        unit: 'Pokémon',
        totals: collectionTotals(pokedex),
      },
      ...binders.map((b) => {
        const list = entriesOf(entries, b.id);
        const purpose = BINDER_PURPOSES.find((p) => p.id === b.purpose) ?? BINDER_PURPOSES[0];
        return {
          id: b.id,
          name: b.name,
          color: b.color,
          icon: purpose.icon as IconName,
          // Descrição; senão a finalidade; e o tamanho quando o nome já diz a finalidade.
          kind: b.description || (purpose.label !== b.name ? purpose.label : `${b.rows * b.cols} bolsos por página · ${b.pages} páginas`),
          // Só as cartas que cabem nas páginas (as de fora continuam no valor), como na tela inicial (F2).
          filled: list.filter((e) => isPlacedCustom(b, e)).length,
          total: customTotalSlots(b),
          unit: 'bolsos',
          totals: b.showPrices ? collectionTotals(list) : null,
        };
      }),
    ];
  }, [settings, entries, binders]);
  // Total da coleção inteira (o mesmo de Minha coleção), também com os fichários que escondem os preços.
  const all = useMemo(() => collectionTotals(Object.values(entries)), [entries]);

  async function open(id: string) {
    await setActiveBinder(id);
    router.dismissTo('/');
  }

  return (
    <ScrollView contentContainerStyle={[styles.screen, { paddingHorizontal: gutter }]}>
      {rows.map((r) => {
        const active = r.id === activeBinderId;
        const ink = onCover(r.color);
        const value = r.totals?.valued ? r.totals.value : null;
        return (
          // Linha com dois botões lado a lado (abrir e personalizar): botão dentro de botão é inválido na web.
          <View key={r.id} style={[styles.card, active && styles.cardActive]}>
            <Pressable
              onPress={() => open(r.id)}
              style={(s) => {
                const { pressed, hovered } = s as PressState;
                return [styles.main, hovered && styles.mainHover, pressed && { opacity: 0.85 }];
              }}
              role="button"
              accessibilityLabel={`Abrir ${r.name}, ${formatInt(r.filled)} de ${formatInt(r.total)} ${r.unit}${value != null ? `, ${formatBRL(value)}` : ''}${active ? ', aberto' : ''}`}>
              <View style={[styles.spine, { backgroundColor: coverFill(r.color) }]}>
                {r.icon ? <Ionicons name={r.icon} size={22} color={ink} /> : <PokeballIcon size={24} color={ink} />}
              </View>
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>
                  {digitsInSystemFont(r.name)}
                </Text>
                {/* O selo fica aqui: ao lado do título em maiúsculas, cortava o nome em quase todo celular. */}
                <View style={styles.kindRow}>
                  <Text style={styles.kind} numberOfLines={1}>
                    {r.kind}
                  </Text>
                  {active ? <Badge label="aberto" tone="selected" /> : null}
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.min(100, (r.filled / Math.max(1, r.total)) * 100)}%` }]} />
                </View>
                <View style={styles.statsRow}>
                  <Text style={styles.stat}>
                    {formatInt(r.filled)}/{formatInt(r.total)} {r.unit}
                  </Text>
                  {value != null ? <Text style={styles.value}>{formatBRLTight(value)}</Text> : null}
                </View>
              </View>
            </Pressable>
            <IconButton
              icon="settings-outline"
              label={`Personalizar ${r.name}`}
              color={colors.textMuted}
              style={styles.edit}
              onPress={() => (r.id === POKEDEX_BINDER ? router.push('/setup') : router.push({ pathname: '/binder-edit', params: { id: r.id } }))}
            />
          </View>
        );
      })}

      {all.valued ? (
        <View style={styles.footer}>
          <View style={styles.totalRow}>
            <Text style={styles.total}>{collectionTotalText(all.value)}</Text>
            <InfoButton label="Como calculamos o valor" onPress={() => setInfo(true)} />
          </View>
          {/* Crédito das fontes (o MYP Cards sempre, com link). */}
          <SourceCreditsLine byBasis={all.byBasis} style={styles.center} />
        </View>
      ) : null}

      <View style={styles.newBinder}>
        <Button title="Novo fichário" icon="add" onPress={() => router.push('/binder-edit')} />
        <Text style={[styles.hint, styles.center]}>Para trocas, deck, favoritas ou uma coleção</Text>
      </View>

      <HowWeCalculateSheet visible={info} onClose={() => setInfo(false)} totals={all} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // A margem lateral vem do useLayout().gutter: 16 no celular, 24 no tablet, 32 no computador.
  screen: { paddingTop: space.lg, gap: space.md, maxWidth: widths.reading, width: '100%', alignSelf: 'center', paddingBottom: space.xxxl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardActive: { borderColor: semantic.selected.border },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  mainHover: { backgroundColor: semantic.hover.onLight },
  // A borda separa a capa preta do cartão grafite.
  spine: { width: 56, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.border },
  body: { flex: 1, minWidth: 0, padding: space.lg, gap: space.xxs },
  name: { ...typography.heading, color: colors.heading },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kind: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  track: { height: 6, backgroundColor: semantic.progress.track, borderRadius: 3, overflow: 'hidden', marginTop: space.sm },
  fill: { height: 6, borderRadius: 3, backgroundColor: semantic.progress.fill },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm, marginTop: space.xs },
  stat: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  value: { ...typography.numeric, color: semantic.money.fg },
  edit: { marginHorizontal: space.xs },
  footer: { gap: space.xxs, alignItems: 'center', paddingVertical: space.xs },
  totalRow: { flexDirection: 'row', alignItems: 'center' },
  total: { ...typography.bodyStrong, ...typography.tabular, color: semantic.money.fg },
  center: { textAlign: 'center' },
  newBinder: { gap: space.sm, marginTop: space.sm },
  hint: { ...typography.caption, color: colors.textMuted },
});
