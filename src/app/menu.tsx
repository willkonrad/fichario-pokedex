import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { moverItems, MoversCard, useValueHistory, ValueChartCard, type RangeId } from '@/components/collection-chart';
import { MyValueNotice, SyncNotice, syncSummary } from '@/components/collection-notices';
import { PurchasesCard } from '@/components/collection-purchases';
import { TopCards, topCards } from '@/components/collection-top';
import { HowWeCalculateSheet, ValueHero } from '@/components/collection-value';
import { Card, GroupLabel, gridColumns, ListRow, Loading, showToast, useLayout, type IconName } from '@/components/ui';
import { TOTAL_SPECIES } from '@/data/pokedex';
import { dexRange, isPlaced } from '@/lib/binder';
import { formatPct } from '@/lib/format';
import { entryParams } from '@/lib/lists';
import { collectionTotals, priceFreshness, purchaseSummary } from '@/lib/quotes';
import { supabase } from '@/lib/supabase';
import { clearCatalogCache } from '@/lib/tcgdex';
import { POKEDEX_BINDER, type Entry } from '@/lib/types';
import { entriesOf, useBinders, useCollectionReady, useEntries, useSession, useSettings, useSyncStatus, type SyncStatus } from '@/store/collection';
import { colors, radius, semantic, shadow, space, typography, widths } from '@/theme';

/** Minha coleção: o valor, a evolução, as cartas que mais pesam, as compras e os ajustes. */
export default function MenuScreen() {
  const ready = useCollectionReady();
  const entries = useEntries();
  const settings = useSettings();
  const binders = useBinders();
  const session = useSession();
  const syncStatus = useSyncStatus();
  const { isDesktop, width } = useLayout();
  const [rangeId, setRangeId] = useState<RangeId>('1M');
  const [info, setInfo] = useState(false);
  const signedIn = !!session;
  // Sem conta (e com a nuvem configurada): no lugar do gráfico, o convite para entrar.
  const canSignIn = !signedIn && !!supabase;
  const history = useValueHistory(session?.user.id, rangeId);

  const range = settings ? dexRange(settings) : { from: 1, to: TOTAL_SPECIES, count: TOTAL_SPECIES };
  const list = useMemo(() => Object.values(entries), [entries]);
  const totals = useMemo(() => collectionTotals(list), [list]);
  const freshness = useMemo(() => priceFreshness(list), [list]);
  const purchases = useMemo(() => purchaseSummary(list), [list]);
  const top = useMemo(() => topCards(entries), [entries]);
  const moves = useMemo(() => moverItems(history.change, entries), [history.change, entries]);
  // Pokémon com carta num espaço que existe na configuração atual, como no topo da tela inicial e na estante (F2).
  const species = useMemo(
    () => new Set(entriesOf(entries, POKEDEX_BINDER).filter((e) => e.dex > 0 && (!settings || isPlaced(settings, e))).map((e) => e.dex)).size,
    [entries, settings],
  );
  const binderCount = binders.length + 1;
  if (!ready) return <Loading />;

  // Abre a carta sem trocar o fichário aberto na tela inicial (U8): a tela da carta acha o fichário pelo parâmetro.
  // `origem: 'colecao'`: remover, mover e trocar voltam para cá (router.back) em vez de fechar a Minha coleção.
  function openCard(e: Entry) {
    router.push({ pathname: '/card', params: { ...entryParams(e), origem: 'colecao' } });
  }

  const stats: StatItem[] = [
    { icon: 'grid-outline', label: 'Pokédex', value: String(species), sub: `de ${range.count} · ${formatPct((species / Math.max(1, range.count)) * 100)}`, progress: species / Math.max(1, range.count) },
    { icon: 'albums-outline', label: 'Cartas', value: String(list.length), sub: binders.length ? `em ${binderCount} fichários` : 'no fichário' },
    ...(isDesktop
      ? [
          { icon: 'pricetag-outline' as IconName, label: 'Com preço', value: String(totals.valued), sub: `de ${list.length} ${list.length === 1 ? 'carta' : 'cartas'}` },
          {
            icon: 'library-outline' as IconName,
            label: 'Fichários',
            value: String(binderCount),
            sub: binders.length ? `Pokédex + ${binders.length} ${binders.length === 1 ? 'livre' : 'livres'}` : 'Pokédex',
          },
        ]
      : []),
  ];

  const hero = <ValueHero totals={totals} cards={list.length} binderCount={binderCount} freshness={freshness} onInfo={() => setInfo(true)} />;
  const chart = signedIn ? <ValueChartCard data={history} rangeId={rangeId} onRange={setRangeId} height={isDesktop ? 240 : 170} /> : null;
  const historyPrompt = !canSignIn ? null : (
    <Card style={styles.rowCard}>
      <ListRow
        title="Guarde o histórico do valor"
        subtitle="Entre na conta para ver a evolução"
        left={<RowIcon icon="trending-up-outline" />}
        right={<Chevron />}
        onPress={() => router.push('/account')}
        accessibilityLabel="Guarde o histórico do valor: entrar na conta"
      />
    </Card>
  );
  const movers = <MoversCard change={history.change} entries={entries} onOpen={openCard} />;
  const purchasesCard = <PurchasesCard summary={purchases} />;
  // Buscar na coleção (E2) e as listas para trocar (E1).
  const findGroup = (
    <View>
      <GroupLabel>Buscar e trocar</GroupLabel>
      <LinkRows
        items={[
          { icon: 'search-outline', title: 'Buscar na coleção', subtitle: 'Tenho essa carta? Onde ela está?', onPress: () => router.push('/find') },
          { icon: 'list-outline', title: 'Preciso', subtitle: 'Pokémon que faltam no fichário', onPress: () => router.push('/lists') },
          {
            icon: 'copy-outline',
            title: 'Tenho repetida',
            subtitle: 'Cartas repetidas e de trocas',
            onPress: () => router.push({ pathname: '/lists', params: { tab: 'have' } }),
          },
        ]}
      />
    </View>
  );
  const settingsGroup = (
    <View>
      <GroupLabel>Ajustes</GroupLabel>
      <SettingsGroup
        email={session?.user.email}
        syncStatus={syncStatus}
        bindersSubtitle={
          binders.length
            ? `Pokédex + ${binders.length} ${binders.length > 1 ? 'fichários livres' : 'fichário livre'}`
            : 'Crie fichários para trocas, deck, favoritas…'
        }
      />
    </View>
  );
  // Vitrine do computador: cartas de ~140 px que cabem na largura útil (a tela tem no máximo `widths.wide`, com 32 px
  // de margem, e o cartão tem 16 px de cada lado).
  const columns = isDesktop
    ? gridColumns(Math.min(width, widths.wide) - space.xxl * 2 - space.lg * 2, { cell: 140, gap: space.lg, min: 4, max: 8 })
    : undefined;

  // A coluna da esquerda (computador) só existe se algum dos seus cartões for aparecer.
  const hasLower = moves.up.length + moves.down.length > 0 || purchases.bought > 0 || canSignIn;

  return (
    <ScrollView contentContainerStyle={[styles.screen, { maxWidth: isDesktop ? widths.wide : widths.reading }, isDesktop && styles.screenDesktop]}>
      <SyncNotice status={syncStatus} />
      <MyValueNotice entries={entries} />

      {isDesktop ? (
        <>
          {/* Computador (W8): o valor ao lado do gráfico (ou, sem conta, dos indicadores). */}
          <View style={styles.row}>
            <View style={styles.col5}>{hero}</View>
            <View style={styles.col7}>{chart ?? <Stats items={stats} columns={2} />}</View>
          </View>
          {chart ? <Stats items={stats} columns={4} /> : null}
        </>
      ) : (
        <>
          {hero}
          {chart}
          <Stats items={stats} columns={2} />
        </>
      )}

      <TopCards items={top} total={totals.value} columns={columns} onOpen={openCard} />

      {isDesktop ? (
        <View style={styles.row}>
          {hasLower ? (
            <View style={styles.col7}>
              {movers}
              {purchasesCard}
              {historyPrompt}
            </View>
          ) : null}
          <View style={hasLower ? styles.col5 : styles.colFull}>
            {findGroup}
            {settingsGroup}
          </View>
        </View>
      ) : (
        <>
          {movers}
          {purchasesCard}
          {historyPrompt}
          {findGroup}
          {settingsGroup}
        </>
      )}

      <HowWeCalculateSheet visible={info} onClose={() => setInfo(false)} totals={totals} />
    </ScrollView>
  );
}

type StatItem = { icon: IconName; label: string; value: string; sub: string; progress?: number };

/** Indicadores (Pokédex, cartas…): 2 por linha no celular, 4 no computador. */
function Stats({ items, columns }: { items: StatItem[]; columns: number }) {
  const rows: StatItem[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return (
    <View style={styles.statsGrid}>
      {rows.map((row, i) => (
        <View key={i} style={styles.statsRow}>
          {row.map((s) => (
            <View key={s.label} style={styles.stat} accessible accessibilityLabel={`${s.label}: ${s.value}, ${s.sub}`}>
              <View style={styles.statHead}>
                <Ionicons name={s.icon} size={14} color={colors.textMuted} />
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
              <Text style={styles.statValue}>{s.value}</Text>
              {s.progress != null ? (
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.min(100, Math.max(s.progress > 0 ? 2 : 0, s.progress * 100))}%` }]} />
                </View>
              ) : null}
              <Text style={styles.statSub}>{s.sub}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function RowIcon({ icon, color = colors.text }: { icon: IconName; color?: string }) {
  return (
    <View style={styles.rowIcon}>
      <Ionicons name={icon} size={18} color={color} />
    </View>
  );
}

function Chevron() {
  return <Ionicons name="chevron-forward" size={18} color={colors.iconFaint} />;
}

/** Ajustes: fichários, conta (com o estado da sincronização), cópia, cache e Sobre. */
function SettingsGroup({ email, syncStatus, bindersSubtitle }: { email?: string | null; syncStatus: SyncStatus; bindersSubtitle: string }) {
  const sync = syncSummary(syncStatus, email, { signInHint: true });
  const [clearing, setClearing] = useState(false);
  async function clearCache() {
    if (clearing) return;
    setClearing(true);
    const n = await clearCatalogCache();
    setClearing(false);
    showToast({ message: n ? `Catálogo recarregado: ${n} ${n === 1 ? 'item apagado' : 'itens apagados'} do cache` : 'O cache já estava vazio' });
  }
  const items: LinkItem[] = [
    { icon: 'library-outline', title: 'Meus fichários', subtitle: bindersSubtitle, onPress: () => router.push('/binders') },
    { icon: 'book-outline', title: 'Fichário Pokédex', subtitle: 'Nome, capa, região, bolsos e idiomas', onPress: () => router.push('/setup') },
    { icon: sync.icon, iconColor: sync.color, title: 'Conta e sincronização', subtitle: sync.text, onPress: () => router.push('/account') },
    {
      icon: 'document-text-outline',
      title: 'Cópia da coleção',
      subtitle: 'Exportar ou importar um arquivo',
      onPress: () => router.push({ pathname: '/account', params: { secao: 'copia' } }),
    },
    { icon: 'refresh-outline', title: 'Recarregar catálogo e imagens', subtitle: clearing ? 'Apagando o cache…' : 'Suas cartas continuam salvas', onPress: clearCache },
    { icon: 'information-circle-outline', title: 'Sobre e fontes', subtitle: 'Como calculamos, créditos e versão', onPress: () => router.push('/about') },
  ];
  return <LinkRows items={items} />;
}

type LinkItem = { icon: IconName; iconColor?: string; title: string; subtitle: string; onPress: () => void };

/** Cartão com linhas que levam a outra tela (ícone, título, linha de apoio e a seta). */
function LinkRows({ items }: { items: LinkItem[] }) {
  return (
    <Card style={styles.rowCard}>
      {items.map((it, i) => (
        <Divided key={it.title} first={i === 0}>
          <ListRow
            title={it.title}
            subtitle={it.subtitle}
            left={<RowIcon icon={it.icon} color={it.iconColor} />}
            right={<Chevron />}
            onPress={it.onPress}
            accessibilityLabel={`${it.title}: ${it.subtitle}`}
          />
        </Divided>
      ))}
    </Card>
  );
}

function Divided({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {first ? null : <View style={styles.divider} />}
      {children}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space.lg, gap: space.md, width: '100%', alignSelf: 'center', paddingBottom: space.xxxl },
  screenDesktop: { padding: space.xxl, gap: space.lg },
  row: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  col5: { flex: 5, minWidth: 0, gap: space.lg },
  col7: { flex: 7, minWidth: 0, gap: space.lg },
  colFull: { flex: 1, minWidth: 0, maxWidth: widths.reading, gap: space.lg },
  statsGrid: { gap: space.md },
  statsRow: { flexDirection: 'row', gap: space.md },
  stat: { flex: 1, minWidth: 0, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.xxs, ...shadow },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  statLabel: { ...typography.label, color: colors.textMuted },
  statValue: { ...typography.title, ...typography.tabular, color: colors.text },
  statSub: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginVertical: space.xxs },
  fill: { height: 4, borderRadius: 2, backgroundColor: semantic.special.fill },
  rowCard: { paddingVertical: space.xs },
  rowIcon: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 48 },
});
