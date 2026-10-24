import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { type IconName, type PressState } from '@/components/icon-button';
import { ExternalLink } from '@/components/ui';
import { sourceCredits, VALUE_SCOPE } from '@/lib/copy';
import { formatBRL, formatBRLTight } from '@/lib/format';
import type { SourceId } from '@/lib/valuation';
import { colors, radius, semantic, space, TOUCH, typography } from '@/theme';

/** Variação do valor para mostrar na home: o texto pronto ("▲ R$ 52 (1,2%) em 7 dias") e o sentido. */
export type HomeChange = { text: string; direction: 'up' | 'down' | 'flat' };

export type HomeValue = {
  value: number;
  valued: number;
  byBasis: Record<SourceId, number>;
  /** Cartas esperando a busca do preço (MYP no celular, TCGplayer). */
  pending: number;
  /** Cartas sem preço (a busca terminou sem achar). */
  unpriced: number;
};

/**
 * Valor deste fichário (V1), com a variação recente (V5) e de onde vêm os preços (V6): "Preços: MYP Cards ↗ (41) ·
 * TCGplayer ↗ (5) · Meu valor (2)" — a contagem só aparece quando há mais de uma fonte. Sem mín/méd/máx (V3). O toque
 * no valor abre a coleção. `layout="panel"`: maior, para o painel do computador.
 */
export function HomeValueSummary({
  data,
  change,
  layout = 'row',
  onOpenCollection,
}: {
  data: HomeValue;
  change?: HomeChange | null;
  layout?: 'row' | 'panel';
  onOpenCollection: () => void;
}) {
  const panel = layout === 'panel';
  const credits = sourceCredits(data.byBasis);
  const withCounts = credits.length > 1;
  const tags = [
    data.pending ? (Platform.OS === 'web' ? `${data.pending} esperando preço` : `buscando ${data.pending}…`) : null,
    data.unpriced ? `${data.unpriced} sem preço` : null,
  ].filter((t): t is string => !!t);

  return (
    <View style={[styles.wrap, panel && styles.wrapPanel]}>
      <Pressable
        onPress={onOpenCollection}
        role="button"
        accessibilityLabel={`${VALUE_SCOPE.binder}: ${data.valued ? formatBRL(data.value) : 'sem valor ainda'}${change ? `, ${change.text}` : ''}. Abrir minha coleção`}
        style={(s) => {
          const { pressed, hovered } = s as PressState;
          return [styles.valueBtn, panel && styles.valueBtnPanel, hovered && styles.hover, pressed && { opacity: 0.7 }];
        }}>
        <Text style={[styles.label, panel && styles.labelPanel]}>{VALUE_SCOPE.binder}</Text>
        {data.valued ? (
          <Text style={[styles.value, panel && styles.valuePanel]}>{formatBRLTight(data.value)}</Text>
        ) : (
          <Text style={styles.valueEmpty}>sem preço ainda</Text>
        )}
        {change ? (
          <Text
            style={[styles.change, { color: change.direction === 'up' ? semantic.gain.fg : change.direction === 'down' ? semantic.loss.fg : colors.textMuted }]}>
            {change.text}
          </Text>
        ) : null}
        {panel ? null : <Ionicons name="chevron-forward" size={16} color={colors.iconFaint} style={styles.chevron} />}
      </Pressable>

      {/* Crédito obrigatório das fontes onde há preço (vale também para as cápsulas dos bolsos). */}
      <Text style={styles.credits}>
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
            {withCounts && c.count ? ` (${c.count})` : null}
          </Fragment>
        ))}
        {tags.length ? <Text style={styles.tags}>{` · ${tags.join(' · ')}`}</Text> : null}
      </Text>
    </View>
  );
}

export type HomeNotice = {
  text: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  /** Ícone próprio (ex.: nuvem riscada no "Sem internet"); sem ele, o do tom. */
  icon?: IconName;
  action?: { label: string; onPress: () => void };
};

const NOTICE_TONE: Record<NonNullable<HomeNotice['tone']>, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: colors.surfaceAlt, fg: colors.textMuted, icon: 'information-circle-outline' },
  success: { bg: semantic.success.bg, fg: semantic.success.fg, icon: 'checkmark-circle-outline' },
  warning: { bg: semantic.warning.bg, fg: semantic.warning.fg, icon: 'warning-outline' },
  danger: { bg: semantic.danger.bg, fg: semantic.danger.fg, icon: 'alert-circle-outline' },
};

/**
 * Lugar fixo de um aviso da home (A7). A região "ao vivo" fica montada, vazia e fora do fluxo quando não há aviso:
 * o leitor de tela da web e do Android costuma ignorar uma região que já entra preenchida. O iOS não lê regiões ao
 * vivo: lá o aviso novo é anunciado à parte (o que já estava ao abrir a tela, não).
 */
export function NoticeSlot({ notice }: { notice: HomeNotice | null }) {
  const live = notice?.tone === 'danger' ? 'assertive' : 'polite';
  const text = notice?.text;
  const said = useRef(text);
  useEffect(() => {
    if (said.current === text) return;
    said.current = text;
    if (Platform.OS === 'ios' && text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
  return (
    <View style={notice ? null : styles.slotEmpty} aria-live={live} accessibilityLiveRegion={live}>
      {notice ? <InlineNotice notice={notice} live={false} /> : null}
    </View>
  );
}

/**
 * Aviso de uma linha da home, com uma ação opcional ("Próxima", "Ver"): resultado da busca, cartas fora do fichário,
 * sincronização. Região "ao vivo" (A7): o leitor de tela lê quando muda; o erro, na hora. `live={false}` dentro do
 * NoticeSlot, que já é a região (sem duas regiões, o aviso não é lido duas vezes).
 */
export function InlineNotice({ notice, live: isLive = true }: { notice: HomeNotice; live?: boolean }) {
  const tone = notice.tone ?? 'info';
  const t = NOTICE_TONE[tone];
  const live: 'assertive' | 'polite' = tone === 'danger' ? 'assertive' : 'polite';
  const region = isLive ? { role: tone === 'danger' ? ('alert' as const) : ('status' as const), 'aria-live': live, accessibilityLiveRegion: live } : null;
  return (
    <View style={[styles.notice, { backgroundColor: t.bg }]} {...region}>
      <Ionicons name={notice.icon ?? t.icon} size={16} color={t.fg} style={styles.noticeIcon} />
      <Text style={[styles.noticeText, { color: tone === 'info' ? colors.textMuted : t.fg }]}>{notice.text}</Text>
      {notice.action ? (
        <Pressable
          onPress={notice.action.onPress}
          role="button"
          style={(s) => {
            const { pressed, hovered } = s as PressState;
            return [styles.noticeAction, hovered && styles.hover, pressed && { opacity: 0.7 }];
          }}>
          <Text style={styles.noticeActionText}>{notice.action.label}</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Sem aviso: a região continua montada, mas fora do fluxo (não abre espaço no `gap` de quem a contém).
  slotEmpty: { position: 'absolute', width: 0, height: 0, overflow: 'hidden' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingLeft: space.md, paddingRight: space.xs, minHeight: TOUCH },
  noticeIcon: { alignSelf: 'center' },
  noticeText: { ...typography.caption, flex: 1, paddingVertical: space.sm },
  noticeAction: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: TOUCH, paddingHorizontal: space.sm, borderRadius: radius.sm },
  noticeActionText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  wrap: { gap: space.xxs },
  wrapPanel: { gap: space.xs },
  valueBtn: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: space.sm,
    rowGap: space.xxs,
    borderRadius: radius.sm,
    paddingVertical: space.xxs,
    alignSelf: 'flex-start',
  },
  valueBtnPanel: { flexDirection: 'column', alignItems: 'flex-start' },
  hover: { backgroundColor: semantic.hover.onLight },
  label: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  labelPanel: { ...typography.label, color: colors.textMuted },
  value: { color: semantic.money.fg, fontSize: 22, lineHeight: 28, fontWeight: '800', ...typography.tabular },
  valuePanel: { ...typography.display, color: semantic.money.fg, ...typography.tabular },
  // Sem nenhum preço ainda: texto discreto (um "—" no tamanho do valor parecia uma barra preta).
  valueEmpty: { ...typography.body, color: colors.textMuted },
  change: { ...typography.caption, fontWeight: '700', ...typography.tabular },
  chevron: { alignSelf: 'center' },
  credits: { ...typography.caption, color: colors.textMuted },
  tags: { color: colors.textMuted, fontStyle: 'italic' },
});
