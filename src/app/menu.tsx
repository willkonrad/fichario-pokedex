import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LineChart } from '@/components/line-chart';
import { Card, Chip, GroupLabel, type IconName } from '@/components/ui';
import { TOTAL_SPECIES } from '@/data/pokedex';
import { dexRange } from '@/lib/binder';
import { collectionHistory, type HistoryPoint } from '@/lib/history';
import { collectionTotals, entryValue, formatBRL, formatBRLShort, formatBRLTight, formatWhen, priceFreshness } from '@/lib/quotes';
import { clearCatalogCache } from '@/lib/tcgdex';
import { POKEDEX_BINDER, type Entry } from '@/lib/types';
import { entriesOf, useCollection } from '@/store/collection';
import { colors, MAX_WIDTH, radius, shadow } from '@/theme';

const RANGES = [
  { id: '1M', label: '1M', days: 30 },
  { id: '3M', label: '3M', days: 91 },
  { id: '6M', label: '6M', days: 182 },
  { id: '1A', label: '1A', days: 365 },
] as const;

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
    router.push(e.binderId ? { pathname: '/card', params: { binder: e.binderId, slot: e.slot } } : { pathname: '/card', params: { dex: e.dex, slot: e.slot } });
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {/* Valor da coleção */}
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <MaterialCommunityIcons name="pokeball" size={18} color="rgba(255,255,255,0.85)" />
          <Text style={styles.heroLabel}>Valor da coleção</Text>
        </View>
        <Text style={styles.heroValue}>{stats.valued ? formatBRL(stats.value) : '—'}</Text>
        {stats.valued && (stats.low !== stats.value || stats.high !== stats.value) ? (
          <Text style={styles.heroNote}>
            Faixa no MYP: {formatBRL(stats.low)} (mínimos) a {formatBRL(stats.high)} (máximos)
          </Text>
        ) : null}
        <Text style={styles.heroNote}>
          {stats.valued
            ? [
                `${stats.valued} de ${stats.cards} cartas com preço`,
                stats.newest ? `atualizado em ${formatWhen(stats.newest)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : stats.cards
              ? `Nenhuma das ${stats.cards} cartas tem preço ainda. Os preços chegam em alguns minutos.`
              : 'Coloque cartas no fichário para ver o valor da coleção.'}
        </Text>
        <Text style={styles.heroSource}>
          Valor de cada carta: média dos anúncios do{' '}
          <Text style={styles.heroLink} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync('https://mypcards.com')}>
            MYP Cards
          </Text>
          ; sem preço lá, vendas reais finalizadas do{' '}
          <Text style={styles.heroLink} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync('https://quantovaleminhacarta.com.br')}>
            Quanto vale minha carta?
          </Text>{' '}
          (ou &quot;Meu valor&quot;, fixo até a média do MYP passar dele).
        </Text>
      </View>

      <CollectionChart signedIn={!!session} />

      <View style={styles.stats}>
        <Stat icon="grid-outline" label="Pokédex" value={`${stats.species}`} sub={`de ${range.count} · ${pct}%`} />
        <Stat icon="albums-outline" label="Cartas" value={String(stats.cards)} sub={binders.length ? `em ${binders.length + 1} fichários` : 'no fichário'} />
      </View>

      {top.length ? (
        <>
          <GroupLabel>Mais valiosas</GroupLabel>
          <View style={styles.group}>
            {top.map(({ e, value }, i) => (
              <View key={e.id}>
                {i > 0 ? <View style={[styles.divider, { marginLeft: 50 }]} /> : null}
                <Pressable style={({ pressed }) => [styles.topRow, pressed && { opacity: 0.7 }]} onPress={() => openCard(e)} accessibilityRole="button" accessibilityLabel={`${e.cardName}, ${formatBRL(value)}`}>
                  <View style={[styles.rank, i === 0 && { backgroundColor: colors.yellow }]}>
                    <Text style={styles.rankText}>{i + 1}</Text>
                  </View>
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

      <GroupLabel>Ajustes</GroupLabel>
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
          subtitle={session ? (session.user.email ?? 'Conectado') : 'Entre para salvar na nuvem'}
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

/** Valor da coleção ao longo do tempo (histórico diário gravado pelo servidor), com 1M/3M/6M/1A. */
function CollectionChart({ signedIn }: { signedIn: boolean }) {
  const [history, setHistory] = useState<HistoryPoint[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]['id']>('1M');

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    collectionHistory()
      .then((h) => alive && setHistory(h))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const days = RANGES.find((r) => r.id === rangeId)!.days;
  const points = useMemo(() => {
    if (!history?.length) return [];
    const lastDay = new Date(`${history[history.length - 1].day}T12:00:00`).getTime();
    return history
      .map((h) => ({ t: new Date(`${h.day}T12:00:00`).getTime(), v: h.value }))
      .filter((p) => p.t >= lastDay - days * 86_400_000);
  }, [history, days]);
  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last && first.v > 0 ? ((last.v - first.v) / first.v) * 100 : null;

  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.chartHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.chartTitle}>Evolução do valor</Text>
          {change != null && points.length > 1 ? (
            <Text style={[styles.change, { color: change >= 0 ? colors.success : colors.danger }]}>
              {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1).replace('.', ',')}% no período
            </Text>
          ) : null}
        </View>
        <View style={styles.ranges}>
          {RANGES.map((r) => (
            <Chip key={r.id} label={r.label} selected={rangeId === r.id} onPress={() => setRangeId(r.id)} />
          ))}
        </View>
      </View>
      {!signedIn ? (
        <Text style={styles.chartNote}>Entre na sua conta (em Conta e sincronização) para guardar o histórico do valor da coleção.</Text>
      ) : error ? (
        <Text style={styles.chartNote}>Não consegui carregar o histórico ({error}).</Text>
      ) : history === undefined ? (
        <Text style={styles.chartNote}>Carregando o histórico…</Text>
      ) : points.length < 2 ? (
        <>
          {points.length ? <LineChart points={points} format={formatBRLShort} /> : null}
          <Text style={styles.chartNote}>O valor da coleção é guardado todo dia às 23:50. O gráfico ganha forma a cada dia.</Text>
        </>
      ) : (
        <LineChart points={points} format={formatBRLShort} />
      )}
    </Card>
  );
}

function Stat({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        <Ionicons name={icon} size={14} color={colors.primary} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function Item({ icon, title, subtitle, onPress }: { icon: IconName; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]} onPress={onPress} accessibilityRole="button">
      <View style={styles.itemIcon}>
        <Ionicons name={icon} size={18} color={colors.primary} />
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
  screen: { padding: 16, gap: 12, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  hero: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: 20, ...shadow },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroValue: { color: colors.onPrimary, fontSize: 36, fontWeight: '900', marginTop: 6 },
  heroNote: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 6, lineHeight: 18 },
  heroSource: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 8, lineHeight: 17 },
  heroLink: { color: colors.yellow, fontWeight: '800', textDecorationLine: 'underline' },
  chartHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' },
  chartTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  change: { fontSize: 13, fontWeight: '800', marginTop: 2 },
  ranges: { flexDirection: 'row', gap: 4 },
  chartNote: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, ...shadow },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { color: colors.text, fontSize: 26, fontWeight: '900', marginTop: 4 },
  statSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', ...shadow },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 60 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  itemIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  itemSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  rank: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: colors.text, fontSize: 13, fontWeight: '900' },
  topValue: { color: colors.money, fontSize: 15, fontWeight: '900' },
  error: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  errorText: { color: colors.danger, fontSize: 13, flex: 1 },
});
