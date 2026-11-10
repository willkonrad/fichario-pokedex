import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { EntryRow } from '@/components/add-entry-row';
import { HEADING_3 } from '@/components/collection-chart';
import { MoreButton, PAGE } from '@/components/report-activity';
import { Card, Notice } from '@/components/ui';
import { MYP_ON_PHONE, NO_PRICE_HINT, NO_PRICE_REASON, noPriceText, setCardsText } from '@/lib/copy';
import { formatBRL, formatBRLTight } from '@/lib/format';
import { recentChange, type CollectionChange } from '@/lib/history';
import { noPriceReason, type noPriceSummary, type SetSummary } from '@/lib/reports';
import type { Entry } from '@/lib/types';
import { colors, radius, semantic, space, typography } from '@/theme';

// Destaques da tela Relatórios que saem das cartas do aparelho (por coleção, sem preço) e a variação do valor.

const WEB = Platform.OS === 'web';
/** Cartas sem preço mostradas antes do "Ver mais". */
const NO_PRICE_FIRST = 5;

/**
 * Variação do valor nos últimos `days` dias (com conta e 2 dias ou mais de histórico); null enquanto carrega, sem
 * conta ou sem histórico. Falha na leitura: a variação só não aparece.
 */
export function useRecentValueChange(userId: string | undefined, days: number) {
  const [state, setState] = useState<{ key: string; change: (CollectionChange & { days: number }) | null }>();
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const key = `${userId}:${days}`;
    recentChange(days)
      .then((change) => {
        if (alive) setState({ key, change });
      })
      .catch(() => {
        if (alive) setState({ key, change: null });
      });
    return () => {
      alive = false;
    };
  }, [userId, days]);
  return userId && state?.key === `${userId}:${days}` ? state.change : null;
}

/**
 * "Por coleção": as coleções com mais cartas, com o valor somado (só das cartas com preço) e uma barra do tamanho de
 * cada uma perto da maior. Só leitura: a busca na coleção acha por palavra (traria cartas de outras coleções).
 */
export function SetsCard({ sets }: { sets: SetSummary[] }) {
  const [shown, setShown] = useState(PAGE);
  if (!sets.length) return null;
  const most = Math.max(1, ...sets.map((s) => s.count));
  const rest = sets.length - shown;
  return (
    <Card style={styles.card}>
      <Text style={styles.title} {...HEADING_3}>
        Por coleção
      </Text>
      <View>
        {sets.slice(0, shown).map((s) => (
          <SetRow key={s.key} set={s} share={s.count / most} />
        ))}
      </View>
      {rest > 0 ? <MoreButton rest={rest} onPress={() => setShown((n) => n + PAGE)} /> : null}
    </Card>
  );
}

function SetRow({ set, share }: { set: SetSummary; share: number }) {
  const name = set.setName || 'Coleção sem nome';
  const cards = setCardsText(set);
  const label = `${name}: ${cards}${set.valued ? `, ${formatBRL(set.value)}` : ''}`;
  // No celular, lida de uma vez; na web, o texto corrido (sem papel, o rótulo não seria lido lá).
  return (
    <View style={styles.setRow} {...(WEB ? null : { accessible: true, accessibilityLabel: label })}>
      <View style={styles.setHead}>
        <Text style={styles.setName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.money}>{set.valued ? formatBRLTight(set.value) : '—'}</Text>
      </View>
      <Text style={styles.note} numberOfLines={1}>
        {cards}
      </Text>
      <View style={styles.track} aria-hidden>
        <View style={[styles.fill, { width: `${Math.max(2, Math.min(100, share * 100))}%` }]} />
      </View>
    </View>
  );
}

/**
 * "Sem preço": quantas cartas não têm valor e por quê (aguardando a busca, não encontradas, sem fonte), com as mais
 * recentes. Some quando todas têm preço. Na web, lembra que o MYP só é consultado pelo app no celular.
 */
export function NoPriceCard({
  summary,
  mypPending,
  placeOf,
  onOpen,
}: {
  summary: ReturnType<typeof noPriceSummary>;
  /** Cartas esperando a busca no MYP (collectionTotals). */
  mypPending: number;
  placeOf: (e: Entry) => string;
  onOpen: (e: Entry) => void;
}) {
  const [shown, setShown] = useState(NO_PRICE_FIRST);
  if (!summary.total) return null;
  const rest = summary.items.length - shown;
  const hint = summary.byReason.notFound + summary.byReason.noSource > 0 ? NO_PRICE_HINT : '';
  return (
    <Card style={styles.card}>
      <View style={styles.stack}>
        <Text style={styles.title} {...HEADING_3}>
          Sem preço
        </Text>
        <Text style={[styles.note, styles.tabular]}>{noPriceText(summary.total, summary.byReason)}</Text>
      </View>
      {WEB && mypPending > 0 ? <Notice>{MYP_ON_PHONE}</Notice> : null}
      <View>
        {summary.items.slice(0, shown).map((e) => (
          <EntryRow key={e.id} entry={e} note={NO_PRICE_REASON[noPriceReason(e)]} place={placeOf(e)} onPress={() => onOpen(e)} />
        ))}
      </View>
      {rest > 0 ? <MoreButton rest={rest} onPress={() => setShown((n) => n + PAGE)} /> : null}
      {hint ? <Text style={styles.note}>{hint}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  stack: { gap: space.xxs },
  title: { ...typography.heading, color: colors.heading },
  note: { ...typography.caption, color: colors.textMuted },
  tabular: { ...typography.tabular },
  setRow: { gap: space.xxs, paddingVertical: space.sm, paddingHorizontal: space.xs, borderRadius: radius.sm },
  setHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  setName: { ...typography.bodyStrong, color: colors.text, flex: 1, minWidth: 0 },
  money: { ...typography.numeric, color: semantic.money.fg },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginTop: space.xxs },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.textMuted },
});
