import { StyleSheet, Text, View } from 'react-native';

import { HEADING_3 } from '@/components/collection-chart';
import { Card } from '@/components/ui';
import { purchaseText } from '@/lib/copy';
import { formatPct, formatSignedBRL } from '@/lib/format';
import type { purchaseSummary } from '@/lib/quotes';
import { colors, semantic, space, typography } from '@/theme';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Compras (E4): quanto foi pago pelas cartas compradas e quanto elas valem hoje (só as que têm valor pago e preço), e a
 * origem das cartas. Some quando nenhuma carta é de compra.
 */
export function PurchasesCard({ summary }: { summary: ReturnType<typeof purchaseSummary> }) {
  const s = summary;
  if (!s.bought) return null;
  const tone = s.diff > 0.005 ? semantic.gain.fg : s.diff < -0.005 ? semantic.loss.fg : colors.textMuted;
  const origins = [
    plural(s.byOrigin.purchase, 'comprada', 'compradas'),
    s.byOrigin.booster ? `${s.byOrigin.booster} de booster` : null,
    s.byOrigin.trade ? plural(s.byOrigin.trade, 'de troca', 'de troca') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const missing = [
    s.withoutPrice ? plural(s.withoutPrice, 'compra sem valor pago', 'compras sem valor pago') : null,
    s.unvalued ? plural(s.unvalued, 'compra sem preço atual', 'compras sem preço atual') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card style={styles.card}>
      <Text style={styles.title} {...HEADING_3}>
        Compras
      </Text>
      {s.counted ? (
        <View style={styles.row}>
          {/* A porcentagem vai na diferença, colorida (alta ou queda). */}
          <Text style={styles.main}>{purchaseText({ paid: s.paid, current: s.current })}</Text>
          <Text style={[styles.diff, { color: tone }]}>
            {formatSignedBRL(s.diff)}
            {s.pct != null ? ` (${formatPct(s.pct, { sign: true })})` : ''}
          </Text>
        </View>
      ) : (
        <Text style={styles.note}>Preencha o valor pago nas cartas compradas para comparar com o valor de hoje.</Text>
      )}
      <Text style={styles.note}>{origins}</Text>
      {missing ? <Text style={styles.note}>{missing}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs },
  title: { ...typography.heading, color: colors.text, marginBottom: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.sm },
  main: { ...typography.bodyStrong, ...typography.tabular, color: semantic.money.fg },
  diff: { ...typography.numeric },
  note: { ...typography.caption, color: colors.textMuted },
});
