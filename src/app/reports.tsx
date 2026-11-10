import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useIosAnnouncement } from '@/components/add-card-list';
import { HEADING_3, MoversCard } from '@/components/collection-chart';
import { SyncNotice } from '@/components/collection-notices';
import { PurchasesCard } from '@/components/collection-purchases';
import { TopCards, topCards } from '@/components/collection-top';
import { SourceCreditsLine } from '@/components/collection-value';
import { activityCountsText, ActivitySections, ActivitySkeleton, activityStartWithin, useActivity, type ActivityState } from '@/components/report-activity';
import { NoPriceCard, SetsCard, useRecentValueChange } from '@/components/report-highlights';
import { Button, Card, EmptyState, Loading, Notice, Segmented, useLayout } from '@/components/ui';
import { periodChangeSpoken, periodChangeText } from '@/lib/copy';
import { entryParams, entryPlace, placeText } from '@/lib/lists';
import { collectionTotals, purchaseSummary } from '@/lib/quotes';
import { noPriceSummary, setSummaries } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { BinderSettings, Entry } from '@/lib/types';
import { useBinders, useCollectionReady, useEntries, useSession, useSettings, useSyncStatus } from '@/store/collection';
import { colors, semantic, space, typography, widths } from '@/theme';

/** Períodos da atividade; o escolhido fica no parâmetro de URL `periodo` (padrão 30 dias). */
const PERIODS = [
  { id: '7', label: '7 dias', days: 7 },
  { id: '30', label: '30 dias', days: 30 },
  { id: '90', label: '90 dias', days: 90 },
] as const;
const DEFAULT_PERIOD = PERIODS[1];
/** Largura do seletor de período ao lado do título (computador). */
const PERIOD_WIDTH = 300;

/**
 * Relatórios: o que mudou na coleção no período (cartas adicionadas, trocas no fichário Pokédex, movidas e removidas,
 * lidas do registro de mudanças na nuvem) e os destaques que saem das cartas do aparelho (altas e quedas, mais
 * valiosas, por coleção, compras e sem preço).
 */
export default function ReportsScreen() {
  const ready = useCollectionReady();
  if (!ready) return <Loading />;
  return <Reports />;
}

function Reports() {
  const settings = useSettings();
  if (!settings) {
    return (
      <EmptyState
        title="Configure o fichário primeiro"
        text="Os relatórios saem das cartas do fichário Pokédex e dos fichários livres."
        action={<Button title="Configurar" onPress={() => router.replace('/setup')} />}
      />
    );
  }
  return <ReportsBody settings={settings} />;
}

function ReportsBody({ settings }: { settings: BinderSettings }) {
  const params = useLocalSearchParams<{ periodo?: string }>();
  const period = PERIODS.find((p) => p.id === params.periodo) ?? DEFAULT_PERIOD;
  const entries = useEntries();
  const binders = useBinders();
  const session = useSession();
  const syncStatus = useSyncStatus();
  const { isDesktop, gutter } = useLayout();
  const userId = session?.user.id;
  // Sem conta (e com a nuvem configurada): o convite para entrar no lugar da atividade.
  const canSignIn = !session && !!supabase;
  const activity = useActivity(userId, period.days);
  const change = useRecentValueChange(userId, period.days);
  // Altas e quedas: sempre os últimos 7 dias, como na home.
  const weekChange = useRecentValueChange(userId, 7);

  const list = useMemo(() => Object.values(entries), [entries]);
  const totals = useMemo(() => collectionTotals(list), [list]);
  const purchases = useMemo(() => purchaseSummary(list), [list]);
  const top = useMemo(() => topCards(entries), [entries]);
  // Todas as coleções: o cartão mostra 8 e o resto no "Ver mais".
  const sets = useMemo(() => setSummaries(list, Infinity), [list]);
  const noPrice = useMemo(() => noPriceSummary(list), [list]);

  const status = statusText(activity, period.days, canSignIn);
  // O resumo é uma região ao vivo (Android e web); no iOS, anunciado à parte ao trocar de período (A7).
  useIosAnnouncement(status);
  // Período que começa antes do registro de mudanças (24/10): as contagens valem só dali em diante.
  const startNote = activity.status === 'ok' && activity.items.length ? activityStartWithin(activity.since) : null;

  // Sem `origem`: remover e mover voltam para cá (router.back); a tela da carta acha o fichário pelo parâmetro.
  const openCard = (e: Entry) => router.push({ pathname: '/card', params: entryParams(e) });
  const placeOf = (e: Entry) => placeText(entryPlace(e, settings, binders));

  // Variação só com as mesmas cartas nos dois dias (como no gráfico da Minha coleção).
  const valueChange = change && change.same > 0 ? change : null;
  const tone = !valueChange ? colors.textMuted : valueChange.diff > 0.005 ? semantic.gain.fg : valueChange.diff < -0.005 ? semantic.loss.fg : colors.textMuted;

  const summary = (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={[styles.title, styles.headTitle]} {...HEADING_3}>
          Resumo do período
        </Text>
        {/* Sem conta, o período não muda nada (a atividade e a variação vêm da nuvem). */}
        {activity.status !== 'signedOut' ? (
          <View style={isDesktop ? styles.periodDesktop : styles.periodPhone}>
            <Segmented label="Período" options={PERIODS} value={period.id} onChange={(id) => router.setParams({ periodo: id })} />
          </View>
        ) : null}
      </View>
      <View style={styles.stack}>
        {/* Sempre montado: o leitor de tela anuncia quando o resumo muda (troca de período, fim do carregando). */}
        <Text style={activity.status === 'ok' ? styles.counts : styles.note} role="status" aria-live="polite" accessibilityLiveRegion="polite">
          {status}
        </Text>
        {startNote ? <Text style={styles.note}>{`O registro de mudanças começa em ${startNote}.`}</Text> : null}
        {activity.status === 'signedOut' && canSignIn ? (
          <Button title="Entrar" variant="secondary" icon="log-in-outline" onPress={() => router.push('/account')} style={styles.signIn} />
        ) : null}
        {activity.status === 'error' ? (
          <>
            <Notice tone="danger">{activity.error}</Notice>
            <Button title="Tentar de novo" variant="secondary" icon="refresh" onPress={activity.retry} />
          </>
        ) : null}
      </View>
      {valueChange ? (
        <View style={styles.stack}>
          <Text style={[styles.change, { color: tone }]} accessibilityLabel={periodChangeSpoken(valueChange)}>
            {periodChangeText(valueChange)}
          </Text>
          <SourceCreditsLine byBasis={totals.byBasis} />
        </View>
      ) : null}
    </Card>
  );

  // `key`: trocar de período volta cada cartão às primeiras linhas.
  const activityCards =
    activity.status === 'ok' ? (
      <ActivitySections key={period.id} items={activity.items} ctx={{ entries, settings, binders, onOpen: openCard, now: activity.now }} />
    ) : activity.status === 'loading' ? (
      <ActivitySkeleton />
    ) : null;

  const highlights = (
    <>
      <MoversCard change={weekChange} entries={entries} onOpen={openCard} />
      <TopCards items={top} total={totals.value} onOpen={openCard} />
      <SetsCard sets={sets} />
      <PurchasesCard summary={purchases} />
      <NoPriceCard summary={noPrice} mypPending={totals.mypPending} placeOf={placeOf} onOpen={openCard} />
      {list.length ? (
        // Atribuição das fontes do valor mostrado nos cartões acima (regra fixa: MYP Cards com link).
        <SourceCreditsLine byBasis={totals.byBasis} style={styles.credits} />
      ) : (
        <EmptyState title="Nenhuma carta ainda" text="Coloque cartas no fichário para ver os destaques da coleção." />
      )}
    </>
  );

  return (
    <ScrollView contentContainerStyle={[styles.screen, { maxWidth: isDesktop ? widths.wide : widths.reading }, isDesktop && styles.screenDesktop, { paddingHorizontal: gutter }]}>
      <SyncNotice status={syncStatus} />
      {isDesktop ? (
        // Computador: a atividade à esquerda e os destaques à direita.
        <View style={styles.row}>
          <View style={styles.col7}>
            {summary}
            {activityCards}
          </View>
          <View style={styles.col5}>{highlights}</View>
        </View>
      ) : (
        <>
          {summary}
          {activityCards}
          {highlights}
        </>
      )}
    </ScrollView>
  );
}

/** A linha do resumo em cada estado da atividade (região ao vivo). */
function statusText(activity: ActivityState, days: number, canSignIn: boolean) {
  switch (activity.status) {
    case 'loading':
      return 'Carregando as mudanças…';
    case 'signedOut':
      return canSignIn ? 'O histórico de mudanças fica na nuvem. Entre na conta para ver.' : 'O histórico de mudanças fica na nuvem.';
    case 'notMigrated':
      return 'O histórico de mudanças aparece depois da atualização do banco.';
    case 'error':
      // A mensagem vai no aviso de erro, logo abaixo.
      return '';
    default: {
      if (activity.items.length) return activityCountsText(activity.items);
      // Período mais longo que o registro: "nada mudou" só vale desde o começo dele.
      const start = activityStartWithin(activity.since);
      return start ? `Nada mudou desde ${start}.` : `Nada mudou nos últimos ${days} dias.`;
    }
  }
}

const styles = StyleSheet.create({
  screen: { padding: space.lg, gap: space.md, width: '100%', alignSelf: 'center', paddingBottom: space.xxxl },
  screenDesktop: { padding: space.xxl, gap: space.lg },
  row: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  col5: { flex: 5, minWidth: 0, gap: space.lg },
  col7: { flex: 7, minWidth: 0, gap: space.lg },
  card: { gap: space.md },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  headTitle: { flexShrink: 1 },
  periodPhone: { width: '100%' },
  periodDesktop: { width: PERIOD_WIDTH },
  title: { ...typography.heading, color: colors.heading },
  stack: { gap: space.xs },
  counts: { ...typography.bodyStrong, ...typography.tabular, color: colors.text },
  note: { ...typography.caption, color: colors.textMuted },
  change: { ...typography.bodyStrong, ...typography.tabular },
  signIn: { alignSelf: 'flex-start' },
  credits: { paddingHorizontal: space.xs },
});
