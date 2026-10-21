import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { customTotalSlots, dexRange } from '@/lib/binder';
import { collectionTotals, formatBRLTight } from '@/lib/quotes';
import { BINDER_PURPOSES, POKEDEX_BINDER } from '@/lib/types';
import { entriesOf, useCollection } from '@/store/collection';
import { colors, radius } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** Estante: todos os fichários do usuário, para abrir, editar ou criar um novo. */
export default function BindersScreen() {
  const { settings, entries, binders, activeBinderId, setActiveBinder } = useCollection();

  const rows = useMemo(() => {
    const pokedex = entriesOf(entries, POKEDEX_BINDER);
    const range = settings ? dexRange(settings) : null;
    return [
      {
        id: POKEDEX_BINDER,
        name: settings?.name || 'Fichário Pokédex',
        color: settings?.color ?? colors.accent,
        icon: 'grid-outline' as IconName,
        kind: range && range.count < 1025 ? `Pokédex ${range.from}–${range.to}` : 'Pokédex completa',
        filled: new Set(pokedex.map((e) => e.dex)).size,
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
          kind:
            b.description ||
            (purpose.label !== b.name ? purpose.label : `${b.rows * b.cols} bolsos por página · ${b.pages} páginas`),
          filled: list.length,
          total: customTotalSlots(b),
          unit: 'bolsos',
          totals: b.showPrices ? collectionTotals(list) : null,
        };
      }),
    ];
  }, [settings, entries, binders]);

  async function open(id: string) {
    await setActiveBinder(id);
    router.dismissTo('/');
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {rows.map((r) => {
        const active = r.id === activeBinderId;
        return (
          <Pressable
            key={r.id}
            onPress={() => open(r.id)}
            style={({ pressed }) => [styles.card, active && styles.cardActive, pressed && { opacity: 0.8 }]}
            accessibilityLabel={`Abrir ${r.name}`}>
            <View style={[styles.spine, { backgroundColor: r.color }]}>
              <Ionicons name={r.icon} size={20} color="rgba(255,255,255,0.9)" />
            </View>
            <View style={styles.body}>
              <View style={styles.titleRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.name}
                </Text>
                {active ? (
                  <View style={styles.activeTag}>
                    <Text style={styles.activeText}>aberto</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.kind}>{r.kind}</Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, (r.filled / Math.max(1, r.total)) * 100)}%`, backgroundColor: r.color }]} />
              </View>
              <View style={styles.statsRow}>
                <Text style={styles.stat}>
                  {r.filled}/{r.total} {r.unit}
                </Text>
                {r.totals?.valued ? <Text style={styles.value}>{formatBRLTight(r.totals.value)}</Text> : null}
              </View>
            </View>
            <Pressable
              hitSlop={10}
              style={styles.edit}
              onPress={() =>
                r.id === POKEDEX_BINDER ? router.push('/setup') : router.push({ pathname: '/binder-edit', params: { id: r.id } })
              }
              accessibilityLabel={`Personalizar ${r.name}`}>
              <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
            </Pressable>
          </Pressable>
        );
      })}

      <Button title="Novo fichário" onPress={() => router.push('/binder-edit')} />
      <Text style={styles.hint}>
        Fichários livres servem para o que você quiser: coleções completas, favoritas, trocas, deck ou graduadas. Você escolhe a carta de cada
        bolso, a capa, o tamanho e o número de páginas.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardActive: { borderColor: colors.accent },
  spine: { width: 52, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 14, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: colors.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  activeTag: { backgroundColor: colors.accentSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  activeText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  kind: { color: colors.textMuted, fontSize: 12 },
  track: { height: 4, backgroundColor: colors.surfaceAlt, borderRadius: 2, overflow: 'hidden', marginTop: 6 },
  fill: { height: 4, borderRadius: 2 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  stat: { color: colors.textMuted, fontSize: 12 },
  value: { color: colors.gold, fontSize: 12, fontWeight: '700' },
  edit: { padding: 14 },
  hint: { color: colors.textFaint, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
