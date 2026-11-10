import { router } from 'expo-router';
import { Fragment } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { HEADING_3 } from '@/components/collection-chart';
import { Button, ExternalLink, InfoButton, InfoParagraph, InfoSheet, InfoTopic, PokeballIcon } from '@/components/ui';
import { freshnessText, HOW_WE_CALCULATE, maxSumText, MYP_ON_PHONE, pickSummary, sourceCredits, totalsRangeText, VALUE_SCOPE } from '@/lib/copy';
import { formatBRLTight, formatDate } from '@/lib/format';
import type { collectionTotals } from '@/lib/quotes';
import type { SourceId } from '@/lib/valuation';
import { colors, radius, semantic, space, typography } from '@/theme';

export type CollectionTotals = ReturnType<typeof collectionTotals>;

/**
 * Linha de créditos das fontes do valor: "Preços: MYP Cards (41) · TCGplayer (5) · Meu valor (2)". O MYP Cards
 * aparece sempre, com link (atribuição obrigatória onde há preço dele).
 */
export function SourceCreditsLine({ byBasis, style }: { byBasis: Record<SourceId, number>; style?: StyleProp<TextStyle> }) {
  const credits = sourceCredits(byBasis);
  return (
    <Text style={[styles.credits, style]}>
      Preços:{' '}
      {credits.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 ? ' · ' : null}
          {c.url ? (
            <ExternalLink href={c.url} variant="inline" arrow>
              {c.label}
            </ExternalLink>
          ) : (
            c.label
          )}
          {c.count ? ` (${c.count})` : null}
        </Fragment>
      ))}
    </Text>
  );
}

/**
 * "Como calculamos o valor" (U2): os tópicos curtos de lib/copy.ts, para a folha do ⓘ e a tela Sobre. Com `totals`,
 * acrescenta como a soma desta coleção foi feita e a soma dos maiores anúncios (que fica fora da tela, V3).
 */
export function HowWeCalculate({ totals }: { totals?: CollectionTotals }) {
  const pick = totals?.valued ? pickSummary(totals.byPick) : '';
  return (
    <>
      {HOW_WE_CALCULATE.topics.map((t) => (
        <InfoTopic key={t.title} title={t.title}>
          {t.body}
        </InfoTopic>
      ))}
      {totals?.valued ? (
        <InfoTopic title="Na sua coleção">
          {[pick ? `${pick}.` : null, maxSumText(totals.max)].filter(Boolean).join(' ')}
        </InfoTopic>
      ) : null}
      <InfoParagraph>Regra em vigor desde {formatDate(HOW_WE_CALCULATE.since)}.</InfoParagraph>
    </>
  );
}

/** A folha do ⓘ "Como calculamos o valor" (menu e estante), com o atalho para a tela Sobre e fontes. */
export function HowWeCalculateSheet({ visible, onClose, totals }: { visible: boolean; onClose: () => void; totals?: CollectionTotals }) {
  return (
    <InfoSheet
      visible={visible}
      onClose={onClose}
      title={HOW_WE_CALCULATE.title}
      footer={
        <Button
          title="Fontes e créditos"
          variant="ghost"
          icon="information-circle-outline"
          onPress={() => {
            onClose();
            router.push('/about');
          }}
        />
      }>
      <HowWeCalculate totals={totals} />
    </InfoSheet>
  );
}

/**
 * Cartão do valor da coleção (V1/V2/V3/V6): um degrau acima dos outros cartões, porque é o número mais importante da
 * tela. O valor em branco e grande; embaixo, uma linha para cada coisa: como a soma foi feita (só quando há escolhas
 * diferentes da média), as somas pelo menor anúncio e pela média, os fichários, a cobertura e a idade dos preços e as
 * fontes.
 */
export function ValueHero({
  totals,
  cards,
  binderCount,
  freshness,
  onInfo,
}: {
  totals: CollectionTotals;
  /** Cartas na coleção (com e sem preço). */
  cards: number;
  /** Fichários, contando o Pokédex. */
  binderCount: number;
  freshness: { newest?: string; oldest?: string; stale?: number };
  onInfo: () => void;
}) {
  const valued = totals.valued;
  // A legenda só aparece quando alguma carta usa outra coisa que não a média (senão ela não diz nada).
  const mixed = totals.byPick.min + totals.byPick.max + totals.byPick.manual > 0;
  const coverage = valued < cards ? `${valued} de ${cards} cartas com preço` : null;
  const status = [binderCount > 1 ? `${binderCount} fichários` : null, coverage, freshnessText(freshness) || null].filter(Boolean).join(' · ');
  const showRange = valued > 0 && totals.min !== totals.avg;
  // Na web o MYP não é consultado (só o app no celular): os preços dessas cartas não chegam aqui sozinhos.
  const waiting = Platform.OS === 'web' && totals.mypPending > 0 ? MYP_ON_PHONE : 'Os preços chegam em alguns minutos.';
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <PokeballIcon size={18} color={colors.textMuted} />
        <Text style={styles.heroTitle} {...HEADING_3}>
          {VALUE_SCOPE.collection}
        </Text>
      </View>
      {/* O ⓘ fica ao lado do número, que é o que ele explica. */}
      <View style={styles.valueRow}>
        <Text style={[styles.heroValue, !valued && styles.heroNoValue]} numberOfLines={1}>
          {valued ? formatBRLTight(totals.value) : 'sem preço ainda'}
        </Text>
        <InfoButton label="Como calculamos o valor" onPress={onInfo} />
      </View>
      {valued > 0 && mixed ? <Text style={styles.heroCaption}>{pickSummary(totals.byPick)}</Text> : null}
      {!valued ? (
        <Text style={styles.heroCaption}>
          {cards ? `Nenhuma das ${cards} cartas tem preço ainda. ${waiting}` : 'Coloque cartas no fichário para ver o valor.'}
        </Text>
      ) : null}
      {showRange || status || valued ? (
        <View style={styles.heroFoot}>
          {showRange ? <Text style={styles.heroNote}>{totalsRangeText(totals)}</Text> : null}
          {status ? <Text style={styles.heroNote}>{status}</Text> : null}
          {valued ? <SourceCreditsLine byBasis={totals.byBasis} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  credits: { ...typography.caption, color: colors.textMuted },
  hero: { backgroundColor: colors.graphite, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  heroTitle: { ...typography.heading, color: colors.heading, flex: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  heroValue: { ...typography.display, ...typography.tabular, color: semantic.money.fg, flexShrink: 1 },
  // A frase no tamanho do número grande seria cortada em celular de 360 dp.
  heroNoValue: typography.figure,
  heroCaption: { ...typography.caption, color: colors.text },
  heroFoot: {
    gap: space.xs,
    marginTop: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    // Sobre o grafite, a `border` comum some.
    borderTopColor: colors.borderStrong,
  },
  heroNote: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
});
