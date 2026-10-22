import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, onCover, type IconName } from '@/components/ui';
import { TOTAL_SPECIES } from '@/data/pokedex';
import { customTotalSlots, dexRange } from '@/lib/binder';
import { collectionTotals, formatBRLTight, formatRange } from '@/lib/quotes';
import { BINDER_PURPOSES, POKEDEX_BINDER } from '@/lib/types';
import { isSpread } from '@/lib/valuation';
import { entriesOf, useCollection } from '@/store/collection';
import { colors, MAX_WIDTH, radius, shadow } from '@/theme';

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
        color: settings?.color ?? colors.primary,
        icon: null as IconName | null,
        kind: range && range.count < TOTAL_SPECIES ? `Pokédex #${range.from}–#${range.to}` : 'Pokédex completa',
        filled: new Set(pokedex.filter((e) => !range || (e.dex >= range.from && e.dex <= range.to)).map((e) => e.dex)).size,
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
        const ink = onCover(r.color);
        return (
          // Linha com dois botões lado a lado (abrir e personalizar): botão dentro de botão é inválido na web.
          <View key={r.id} style={[styles.card, active && styles.cardActive]}>
          <Pressable
            onPress={() => open(r.id)}
            style={({ pressed }) => [styles.main, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={`Abrir ${r.name}${active ? ' (aberto)' : ''}`}>
            <View style={[styles.spine, { backgroundColor: r.color }]}>
              {r.icon ? <Ionicons name={r.icon} size={22} color={ink} /> : <MaterialCommunityIcons name="pokeball" size={24} color={ink} />}
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
              <Text style={styles.kind} numberOfLines={1}>
                {r.kind}
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, (r.filled / Math.max(1, r.total)) * 100)}%`, backgroundColor: r.color }]} />
              </View>
              <View style={styles.statsRow}>
                <Text style={styles.stat}>
                  {r.filled}/{r.total} {r.unit}
                </Text>
                {r.totals?.valued ? <Text style={styles.value}>{formatBRLTight(r.totals.value)}</Text> : null}
              </View>
              {/* Mínimo a máximo numa linha própria (ao lado do valor, seria cortado no celular). */}
              {r.totals?.valued && isSpread(r.totals.range) ? (
                <Text style={styles.valueRange}>({formatRange(r.totals.min, r.totals.max)})</Text>
              ) : null}
            </View>
          </Pressable>
            <Pressable
              hitSlop={10}
              style={styles.edit}
              onPress={() => (r.id === POKEDEX_BINDER ? router.push('/setup') : router.push({ pathname: '/binder-edit', params: { id: r.id } }))}
              accessibilityRole="button"
              accessibilityLabel={`Personalizar ${r.name}`}>
              <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        );
      })}

      {/* Crédito obrigatório da API do MYP Cards (os valores dos fichários vêm dela). */}
      <Text style={styles.hint}>
        Valores: média dos anúncios do{' '}
        <Text style={styles.link} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync('https://mypcards.com')}>
          MYP Cards ↗
        </Text>{' '}
        e, entre parênteses, a soma dos mínimos e dos máximos (ou &quot;Meu valor&quot;).
      </Text>

      <Button title="Novo fichário" icon="add" onPress={() => router.push('/binder-edit')} />
      <Text style={styles.hint}>
        Fichários livres servem para o que você quiser: coleções completas, favoritas, trocas, deck ou graduadas. Você escolhe a carta de cada
        bolso, a capa, o tamanho e o número de páginas.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    ...shadow,
  },
  cardActive: { borderColor: colors.primary },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  spine: { width: 56, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 14, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: colors.text, fontSize: 17, fontWeight: '900', flexShrink: 1 },
  activeTag: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  activeText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  kind: { color: colors.textMuted, fontSize: 12 },
  track: { height: 6, backgroundColor: colors.surfaceAlt, borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  fill: { height: 6, borderRadius: 3 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  stat: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  value: { color: colors.money, fontSize: 13, fontWeight: '800' },
  valueRange: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'right', marginTop: 1 },
  edit: { padding: 14, alignSelf: 'stretch', justifyContent: 'center' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  link: { color: colors.blue, fontWeight: '800' },
});
