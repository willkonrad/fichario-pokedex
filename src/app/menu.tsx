import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TOTAL_SPECIES } from '@/data/pokedex';
import { dexRange } from '@/lib/binder';
import { collectionTotals, entryValue, formatBRL, formatBRLTight, formatWhen, priceFreshness } from '@/lib/quotes';
import { clearCatalogCache } from '@/lib/tcgdex';
import { POKEDEX_BINDER, type Entry } from '@/lib/types';
import { entriesOf, useCollection } from '@/store/collection';
import { colors, radius } from '@/theme';

export default function MenuScreen() {
  const { entries, session, syncError, binders, settings, setActiveBinder } = useCollection();
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);
  const range = settings ? dexRange(settings) : { from: 1, to: TOTAL_SPECIES, count: TOTAL_SPECIES };
  const stats = useMemo(() => {
    const list = Object.values(entries);
    const pokedex = entriesOf(entries, POKEDEX_BINDER).filter((e) => e.dex >= range.from && e.dex <= range.to);
    return { cards: list.length, species: new Set(pokedex.map((e) => e.dex)).size, ...collectionTotals(list), ...priceFreshness(list) };
  }, [entries, range.from, range.to]);
  const pct = Math.round((stats.species / range.count) * 1000) / 10;
  // As 5 cartas mais valiosas.
  const top = useMemo(
    () =>
      Object.values(entries)
        .map((e) => ({ e, value: entryValue(e) }))
        .filter((x): x is { e: Entry; value: number } => x.value != null)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
    [entries],
  );

  async function openCard(e: Entry) {
    await setActiveBinder(e.binderId ?? POKEDEX_BINDER);
    router.push(
      e.binderId
        ? { pathname: '/card', params: { binder: e.binderId, slot: e.slot } }
        : { pathname: '/card', params: { dex: e.dex, slot: e.slot } },
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Valor da coleção</Text>
        <Text style={styles.heroValue}>{stats.valued ? formatBRL(stats.value) : '—'}</Text>
        {stats.valued ? (
          <Text style={styles.heroNote}>
            {[
              stats.byConfidence.alta && `${stats.byConfidence.alta} com confiança alta`,
              stats.byConfidence.media && `${stats.byConfidence.media} média`,
              stats.byConfidence.baixa && `${stats.byConfidence.baixa} baixa`,
              stats.unvalued && `${stats.unvalued} ainda sem valor`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
        <Text style={styles.heroNote}>
          {stats.valued ? (
            <>
              Preços do{' '}
              <Text style={styles.link} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync('https://mypcards.com')}>
                MYP Cards
              </Text>
              : menor anúncio de cada carta (ou &quot;Meu valor&quot;, quando você preenche).
            </>
          ) : stats.cards ? (
            `Nenhuma das ${stats.cards} cartas tem valor ainda. Os preços do MYP Cards chegam em algumas horas.`
          ) : (
            'Coloque cartas no fichário para ver o valor da coleção.'
          )}
        </Text>
        {stats.newest ? (
          <Text style={styles.heroNote}>
            Última atualização: {formatWhen(stats.newest)}
            {stats.oldest && stats.oldest !== stats.newest ? ` · mais antiga: ${formatWhen(stats.oldest)}` : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.stats}>
        <Stat icon="grid-outline" label="Pokémon" value={`${stats.species}`} sub={`de ${range.count} · ${pct}%`} />
        <Stat icon="albums-outline" label="Cartas" value={String(stats.cards)} sub={binders.length ? `em ${binders.length + 1} fichários` : 'no fichário'} />
      </View>

      {top.length ? (
        <>
          <Text style={styles.sectionTitle}>Mais valiosas</Text>
          <View style={styles.group}>
            {top.map(({ e, value }, i) => (
              <View key={e.id}>
                {i > 0 ? <View style={[styles.divider, { marginLeft: 14 }]} /> : null}
                <Pressable style={({ pressed }) => [styles.topRow, pressed && { opacity: 0.7 }]} onPress={() => openCard(e)}>
                  <Text style={styles.topRank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {e.cardName}
                    </Text>
                    <Text style={styles.itemSub} numberOfLines={1}>
                      {e.setName}
                    </Text>
                  </View>
                  <Text style={styles.topValue}>{formatBRLTight(value)}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>Ajustes</Text>
      <View style={styles.group}>
        <Item
          icon="library-outline"
          title="Meus fichários"
          subtitle={binders.length ? `Pokédex + ${binders.length} fichário${binders.length > 1 ? 's' : ''} livre${binders.length > 1 ? 's' : ''}` : 'Crie fichários de coleção, trocas, deck…'}
          onPress={() => router.push('/binders')}
        />
        <View style={styles.divider} />
        <Item icon="book-outline" title="Fichário Pokédex" subtitle="Nome, capa, região, bolsos e idiomas" onPress={() => router.push('/setup')} />
        <View style={styles.divider} />
        <Item
          icon={session ? 'cloud-done-outline' : 'cloud-offline-outline'}
          title="Conta e sincronização"
          subtitle={session ? session.user.email ?? 'Conectado' : 'Entre para salvar na nuvem'}
          onPress={() => router.push('/account')}
        />
        <View style={styles.divider} />
        <Item
          icon="refresh-outline"
          title="Limpar cache de cartas"
          subtitle={cacheMsg ?? 'Baixa de novo listas e imagens (suas cartas não são apagadas)'}
          onPress={async () => setCacheMsg(`${await clearCatalogCache()} itens apagados do cache`)}
        />
      </View>
      {syncError ? (
        <View style={styles.error}>
          <Ionicons name="warning-outline" size={16} color={colors.danger} />
          <Text style={styles.errorText}>Erro de sincronização: {syncError}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

type IconName =ComponentProps<typeof Ionicons>['name'];

function Stat({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        <Ionicons name={icon} size={14} color={colors.textMuted} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function Item({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={styles.itemIcon}>
        <Ionicons name={icon} size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18, borderWidth: 1, borderColor: colors.border },
  heroLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  heroValue: { color: colors.gold, fontSize: 32, fontWeight: '800', marginTop: 4 },
  heroNote: { color: colors.textMuted, fontSize: 12, marginTop: 10, lineHeight: 17 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.border },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 6 },
  statSub: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  group: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 60 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  itemIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  itemSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  error: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  topRank: { color: colors.textFaint, fontSize: 14, fontWeight: '800', width: 16, textAlign: 'center' },
  topValue: { color: colors.gold, fontSize: 14, fontWeight: '800' },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },
});
