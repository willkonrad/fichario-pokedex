import { router } from 'expo-router';
import { Fragment } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { Button, ExternalLink, InfoButton, InfoParagraph, InfoSheet, InfoTopic, PokeballIcon } from '@/components/ui';
import { collectionValueLabel, freshnessText, HOW_WE_CALCULATE, maxSumText, MYP_ON_PHONE, pickSummary, sourceCredits, totalsRangeText } from '@/lib/copy';
import { formatBRLTight, formatDate } from '@/lib/format';
import type { collectionTotals } from '@/lib/quotes';
import type { SourceId } from '@/lib/valuation';
import { binderColors, colors, radius, semantic, shadow, space, typography } from '@/theme';

export type CollectionTotals = ReturnType<typeof collectionTotals>;

/**
 * Linha de créditos das fontes do valor: "Preços: MYP Cards ↗ (41) · TCGplayer ↗ (5) · Meu valor (2)". O MYP Cards
 * aparece sempre, com link (atribuição obrigatória onde há preço dele).
 */
export function SourceCreditsLine({ byBasis, onDark, style }: { byBasis: Record<SourceId, number>; onDark?: boolean; style?: StyleProp<TextStyle> }) {
  const credits = sourceCredits(byBasis);
  return (
    <Text style={[styles.credits, onDark && styles.creditsOnDark, style]}>
      Preços:{' '}
      {credits.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 ? ' · ' : null}
          {c.url ? (
            <ExternalLink href={c.url} variant="inline" tone={onDark ? 'onBrand' : 'default'} arrow>
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
 * Cartão do valor da coleção (V1/V2/V3/V6): grafite, para não empilhar vermelho sobre a barra vermelha (AR3). O valor
 * em destaque; embaixo, uma linha para cada coisa: como a soma foi feita (só quando há escolhas diferentes da média),
 * as somas pelo menor anúncio e pela média, a cobertura e a idade dos preços e as fontes.
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
  const status = [coverage, freshnessText(freshness) || null].filter(Boolean).join(' · ');
  const showRange = valued > 0 && totals.min !== totals.avg;
  // Na web o MYP não é consultado (só o app no celular): os preços dessas cartas não chegam aqui sozinhos.
  const waiting = Platform.OS === 'web' && totals.mypPending > 0 ? MYP_ON_PHONE : 'Os preços chegam em alguns minutos.';
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <PokeballIcon size={18} color={binderColors.textMuted} />
        <Text style={styles.heroLabel}>{collectionValueLabel(binderCount)}</Text>
      </View>
      {/* O ⓘ fica ao lado do número (na linha do rótulo, ele cortaria "· 2 fichários" no celular). */}
      <View style={styles.valueRow}>
        <Text style={styles.heroValue} numberOfLines={1}>
          {valued ? formatBRLTight(totals.value) : 'sem preço ainda'}
        </Text>
        <InfoButton label="Como calculamos o valor" onPress={onInfo} color={binderColors.textMuted} />
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
          {valued ? <SourceCreditsLine byBasis={totals.byBasis} onDark /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  credits: { ...typography.caption, color: colors.textMuted },
  creditsOnDark: { color: binderColors.textMuted },
  hero: { backgroundColor: colors.graphite, borderRadius: radius.lg, padding: space.lg, gap: space.xs, ...shadow },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  heroLabel: { ...typography.label, color: binderColors.textMuted, flex: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  heroValue: { ...typography.display, ...typography.tabular, color: semantic.money.onSheet, flexShrink: 1 },
  heroCaption: { ...typography.caption, color: binderColors.text },
  heroFoot: {
    gap: space.xs,
    marginTop: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: binderColors.pocketBorder,
  },
  heroNote: { ...typography.caption, ...typography.tabular, color: binderColors.textMuted },
});
