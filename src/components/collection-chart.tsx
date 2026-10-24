import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { LineChart } from '@/components/line-chart';
import { Button, Card, Chip, ChipGroup, ListRow, Notice, Skeleton } from '@/components/ui';
import { cardsDeltaText, changeText } from '@/lib/copy';
import { formatBRL, formatBRLShort, formatBRLTight, formatDay, formatPct, formatSignedBRL } from '@/lib/format';
import { collectionChange, collectionHistory, dayTime, type CardMove, type CollectionChange, type HistoryPoint } from '@/lib/history';
import { isNetworkError } from '@/lib/supabase';
import type { Entry } from '@/lib/types';
import { colors, radius, semantic, space, typography } from '@/theme';

export const RANGES = [
  { id: '1M', label: '1M', name: '1 mês', days: 30 },
  { id: '3M', label: '3M', name: '3 meses', days: 91 },
  { id: '6M', label: '6M', name: '6 meses', days: 182 },
  { id: '1A', label: '1A', name: '1 ano', days: 365 },
] as const;
export type RangeId = (typeof RANGES)[number]['id'];

const DAY_MS = 86_400_000;

/** Título de bloco: na web vira <h3> (o React Native não tem aria-level nos tipos). */
export const HEADING_3 = { role: 'heading' as const, ...((Platform.OS === 'web' ? { 'aria-level': 3 } : {}) as object) };

type Point = { t: number; v: number; day: string };

/**
 * Histórico do valor da coleção (conta conectada, `userId`) e a variação do período escolhido, só com as mesmas cartas
 * nos dois dias (P1): carta nova, que só ganhou preço, removida ou trocada fica à parte (`change.added`, `priced`…).
 * O histórico começa no dia da regra de preço atual (ver collectionHistory). O que foi carregado vale só para
 * a conta que o carregou: ao sair ou trocar de conta, nada do histórico anterior aparece.
 */
export function useValueHistory(userId: string | undefined, rangeId: RangeId) {
  const signedIn = !!userId;
  const [history, setHistory] = useState<{ user: string; attempt: number; points: HistoryPoint[] | null; error?: string } | undefined>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    collectionHistory({ force: attempt > 0 })
      .then((points) => alive && setHistory({ user: userId, attempt, points }))
      .catch(
        (e) =>
          alive &&
          setHistory({
            user: userId,
            attempt,
            points: null,
            error: isNetworkError(e) ? 'Sem conexão: confira a internet e tente de novo.' : 'Não consegui carregar o histórico.',
          }),
      );
    return () => {
      alive = false;
    };
  }, [userId, attempt]);

  // Enquanto a nova tentativa não volta, a tela mostra o carregando (e não o erro antigo).
  const current = userId && history?.user === userId && history.attempt === attempt ? history : undefined;
  const days = RANGES.find((r) => r.id === rangeId)!.days;
  const points = useMemo<Point[]>(() => {
    const list = current?.points;
    if (!list?.length) return [];
    const lastDay = dayTime(list[list.length - 1].day);
    return list.map((h) => ({ t: dayTime(h.day), v: h.value, day: h.day })).filter((p) => p.t >= lastDay - days * DAY_MS);
  }, [current, days]);

  const key = userId && points.length > 1 ? `${userId}|${points[0].day}|${points[points.length - 1].day}` : null;
  const [change, setChange] = useState<{ key: string; value: CollectionChange | null } | undefined>();
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const [, from, to] = key.split('|');
    collectionChange(from, to)
      .then((value) => alive && setChange({ key, value }))
      .catch(() => alive && setChange({ key, value: null }));
    return () => {
      alive = false;
    };
  }, [key]);

  return {
    loading: signedIn && !current,
    error: current?.error,
    /** Dias com histórico na conta (todos os períodos). */
    totalDays: current?.points?.length ?? 0,
    points,
    change: key && change?.key === key ? change.value : undefined,
    retry: () => setAttempt((n) => n + 1),
  };
}

/** Dias corridos entre o primeiro e o último ponto. */
function spanDays(points: Point[]) {
  return points.length > 1 ? Math.round((points[points.length - 1].t - points[0].t) / DAY_MS) : 0;
}

/** "Alta de R$ 52 (1,2%) em 30 dias", para o leitor de tela (no lugar de ▲/▼). */
function changeSpoken(c: CollectionChange, days: number) {
  const word = c.diff > 0.005 ? 'Alta' : c.diff < -0.005 ? 'Queda' : 'Sem variação';
  if (word === 'Sem variação') return `Sem variação em ${days} dias`;
  const pct = c.pct != null && Number.isFinite(c.pct) ? ` (${formatPct(Math.abs(c.pct))})` : '';
  return `${word} de ${formatBRL(Math.abs(c.diff))}${pct} em ${days} dias, com as mesmas cartas`;
}

/** Evolução do valor (gráfico), com o período e a variação das mesmas cartas. */
export function ValueChartCard({
  data,
  rangeId,
  onRange,
  height = 170,
}: {
  data: ReturnType<typeof useValueHistory>;
  rangeId: RangeId;
  onRange: (id: RangeId) => void;
  height?: number;
}) {
  const { points, loading, error, totalDays } = data;
  // Sem nenhuma carta presente nos dois dias, não há variação a mostrar (só as cartas novas e removidas).
  const delta = data.change ? cardsDeltaText(data.change) : '';
  const change = data.change && data.change.same > 0 ? data.change : null;
  const days = spanDays(points);
  const first = points[0];
  const last = points[points.length - 1];
  const tone = change ? (change.diff > 0.005 ? semantic.gain.fg : change.diff < -0.005 ? semantic.loss.fg : colors.textMuted) : colors.textMuted;
  const chartLabel =
    first && last && points.length > 1
      ? `Valor da coleção de ${formatDay(first.t)} a ${formatDay(last.t)}: de ${formatBRLTight(first.v)} para ${formatBRLTight(last.v)}${change ? `. ${changeSpoken(change, days)}` : ''}`
      : last
        ? `Valor da coleção em ${formatDay(last.t)}: ${formatBRLTight(last.v)}`
        : undefined;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.title} {...HEADING_3}>
            Evolução do valor
          </Text>
          {change ? (
            <Text style={[styles.change, { color: tone }]} accessibilityLabel={changeSpoken(change, days)}>
              {changeText({ diff: change.diff, pct: change.pct, days })}
            </Text>
          ) : null}
          {delta ? <Text style={styles.note}>{delta}</Text> : null}
        </View>
        {/* Os períodos só aparecem quando há mais de um dia para escolher. */}
        {totalDays > 1 ? (
          <ChipGroup label="Período" style={styles.ranges}>
            {RANGES.map((r) => (
              <Chip key={r.id} label={r.label} accessibilityLabel={r.name} selected={rangeId === r.id} onPress={() => onRange(r.id)} />
            ))}
          </ChipGroup>
        ) : null}
      </View>
      {error ? (
        <>
          <Notice tone="danger">{error}</Notice>
          <Button title="Tentar de novo" variant="secondary" icon="refresh" onPress={data.retry} />
        </>
      ) : loading ? (
        <Skeleton height={height} radius={radius.sm} />
      ) : points.length ? (
        <>
          <LineChart points={points} format={formatBRLShort} height={height} accessibilityLabel={chartLabel} />
          {points.length < 2 ? <Text style={styles.note}>O valor é guardado todo dia às 23:50: o gráfico ganha forma a cada dia.</Text> : null}
        </>
      ) : (
        <Text style={styles.note}>O valor é guardado todo dia às 23:50, a partir da primeira carta com preço.</Text>
      )}
    </Card>
  );
}

type MoverItem = { m: CardMove; e: Entry };

/**
 * Até 3 altas e 3 quedas que ainda valem: só a carta que continua no bolso (a mesma carta; um bolso trocado depois
 * não conta). A tela usa para saber se o cartão "Maiores altas e quedas" vai aparecer.
 */
export function moverItems(change: CollectionChange | null | undefined, entries: Record<string, Entry>): { up: MoverItem[]; down: MoverItem[] } {
  if (!change) return { up: [], down: [] };
  const pick = (list: CardMove[]) =>
    list
      .map((m) => ({ m, e: entries[m.entryId] }))
      .filter((x): x is MoverItem => !!x.e && (!x.m.cardId || x.e.cardId === x.m.cardId))
      .slice(0, 3);
  return { up: pick(change.up), down: pick(change.down) };
}

/**
 * Maiores altas e quedas do período (E5), em reais, só das cartas que estão no mesmo bolso desde o primeiro dia (as com
 * "Meu valor" ficam de fora). Some sem histórico ou sem nenhuma mudança.
 */
export function MoversCard({
  change,
  entries,
  onOpen,
}: {
  change: CollectionChange | null | undefined;
  entries: Record<string, Entry>;
  onOpen: (e: Entry) => void;
}) {
  if (!change) return null;
  const { up, down } = moverItems(change, entries);
  if (!up.length && !down.length) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.stack}>
        <Text style={styles.title} {...HEADING_3}>
          Maiores altas e quedas
        </Text>
        <Text style={styles.note}>
          De {formatDay(change.fromDay)} a {formatDay(change.toDay)}, pelo valor que entra na soma
        </Text>
      </View>
      {[...up, ...down].map(({ m, e }) => (
        <MoverRow key={m.entryId} move={m} entry={e} onPress={() => onOpen(e)} />
      ))}
    </Card>
  );
}

function MoverRow({ move, entry, onPress }: { move: CardMove; entry: Entry; onPress: () => void }) {
  const upward = move.diff > 0;
  const pct = move.pct != null && Number.isFinite(move.pct) ? formatPct(move.pct, { sign: true }) : '';
  return (
    <ListRow
      title={entry.cardName}
      subtitle={`${formatBRLTight(move.from)} → ${formatBRLTight(move.to)}`}
      onPress={onPress}
      accessibilityLabel={`${entry.cardName}, ${upward ? 'alta' : 'queda'} de ${formatBRL(Math.abs(move.diff))}${pct ? ` (${pct})` : ''}: de ${formatBRL(move.from)} para ${formatBRL(move.to)}`}
      right={
        <View style={styles.moverRight}>
          <Text style={[styles.moverDiff, { color: upward ? semantic.gain.fg : semantic.loss.fg }]}>{formatSignedBRL(move.diff)}</Text>
          {pct ? <Text style={styles.note}>{pct}</Text> : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexWrap: 'wrap' },
  headText: { flex: 1, minWidth: 160, gap: space.xxs },
  stack: { gap: space.xxs },
  title: { ...typography.heading, color: colors.text },
  change: { ...typography.bodyStrong, ...typography.tabular },
  note: { ...typography.caption, color: colors.textMuted },
  ranges: { gap: space.xs },
  moverRight: { alignItems: 'flex-end' },
  moverDiff: { ...typography.numeric },
});
