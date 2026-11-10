import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardImage } from '@/components/card-image';
import { HEADING_3 } from '@/components/collection-chart';
import { type PressState } from '@/components/icon-button';
import { Button, Card, ListRow, withMarkIcons } from '@/components/ui';
import { entryImageUrl } from '@/lib/catalog';
import { basisNote, valueMark } from '@/lib/copy';
import { formatBRL, formatBRLTight, formatPct } from '@/lib/format';
import { mypPtImage } from '@/lib/myp-api';
import type { Entry } from '@/lib/types';
import { valuation, type Valuation } from '@/lib/valuation';
import { binderColors, CARD_RATIO, colors, radius, semantic, space, typography } from '@/theme';

export type TopItem = { e: Entry; ref: Valuation & { value: number } };

/** Cartas com valor, da mais valiosa para a menos (pelo valor que entra na soma). */
export function topCards(entries: Record<string, Entry>, max = 20): TopItem[] {
  return Object.values(entries)
    .map((e) => ({ e, ref: valuation(e) }))
    .filter((x): x is TopItem => x.ref.value != null && x.ref.value > 0)
    .sort((a, b) => b.ref.value - a.ref.value)
    .slice(0, max);
}

/** Quanto a carta representa do total: "13%" (com uma casa abaixo de 10%). */
function shareText(value: number, total: number) {
  if (!(total > 0)) return '';
  const pct = (value / total) * 100;
  return formatPct(pct, { digits: pct < 10 ? 1 : 0 });
}

function spoken(item: TopItem, total: number) {
  const mark = valueMark(item.ref);
  // Sem o ✎ (o leitor de tela leria o nome do símbolo).
  const basis = basisNote(item.ref).replace(/^✎\s*/, '');
  const share = shareText(item.ref.value, total);
  return [
    item.e.cardName,
    item.e.setName,
    formatBRL(item.ref.value),
    mark.label && mark.mark !== '✎' ? mark.label.toLowerCase() : null,
    basis || null,
    share ? `${share} do total` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function Thumb({ e, style }: { e: Entry; style: object }) {
  return (
    <View style={style}>
      <CardImage
        image={e.image}
        imageUrl={entryImageUrl(e)}
        cardId={e.lang === 'ja' ? undefined : e.cardId}
        localId={e.localId}
        dex={e.dex || undefined}
        compact
        dark
        stampKeys={e.stampKeys}
        photo={e.stampPhoto}
        ptImage={mypPtImage(e)}
        recyclingKey={e.id}
      />
    </View>
  );
}

/**
 * "Mais valiosas" (V2/V5/AR4/W8): no celular, lista com a miniatura da carta, o valor, a base (quando não é a média) e
 * quanto ela representa do total; no computador, uma vitrine de cartas. Tocar abre a carta sem trocar o fichário aberto
 * na tela inicial (U8).
 */
export function TopCards({
  items,
  total,
  columns,
  onOpen,
}: {
  items: TopItem[];
  /** Valor da coleção, para a participação de cada carta. */
  total: number;
  /** Colunas da vitrine (computador); sem elas, lista. */
  columns?: number;
  onOpen: (e: Entry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const base = columns ?? 5;
  const shown = items.slice(0, expanded ? items.length : base);
  if (!items.length) return null;
  const more = items.length > base;

  return (
    <Card style={styles.card}>
      <Text style={styles.title} {...HEADING_3}>
        Mais valiosas
      </Text>
      {columns ? (
        <View style={styles.grid}>
          {chunk(shown, columns).map((row, i) => (
            <View key={i} style={styles.gridRow}>
              {row.map((item) => (
                <ShowcaseCard key={item.e.id} item={item} total={total} onPress={() => onOpen(item.e)} />
              ))}
              {/* Espaços vazios para a última fileira não esticar as cartas. */}
              {Array.from({ length: columns - row.length }, (_, k) => (
                <View key={`f${k}`} style={styles.showcase} />
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View>
          {shown.map((item, i) => (
            <ListRow
              key={item.e.id}
              title={`${i + 1}. ${item.e.cardName}`}
              // A base vem antes da coleção, para não ser cortada na tela estreita.
              subtitle={[basisNote(item.ref) || null, item.e.setName].filter(Boolean).join(' · ')}
              left={<Thumb e={item.e} style={styles.thumb} />}
              right={<Value item={item} total={total} />}
              onPress={() => onOpen(item.e)}
              accessibilityLabel={spoken(item, total)}
            />
          ))}
        </View>
      )}
      {more ? (
        <Button
          title={expanded ? 'Ver menos' : `Ver as ${items.length} mais valiosas`}
          variant="ghost"
          icon={expanded ? 'chevron-up' : 'chevron-down'}
          onPress={() => setExpanded((x) => !x)}
        />
      ) : null}
    </Card>
  );
}

/**
 * O valor (com "≈" quando aproximado) e quanto a carta representa do total. Na vitrine (`card`), também a base,
 * quando não é a média (na lista, ela vai na linha de apoio).
 */
function Value({ item, total, card }: { item: TopItem; total: number; card?: boolean }) {
  const mark = valueMark(item.ref).mark;
  const share = shareText(item.ref.value, total);
  const basis = card ? basisNote(item.ref) : '';
  return (
    <View style={[styles.value, card && styles.valueStart]}>
      <Text style={styles.money}>
        {mark && mark !== '✎' ? `${mark} ` : ''}
        {formatBRLTight(item.ref.value)}
      </Text>
      {basis ? (
        <Text style={styles.note} numberOfLines={1}>
          {withMarkIcons(basis, { size: typography.caption.fontSize, color: colors.textMuted })}
        </Text>
      ) : null}
      {share ? (
        <Text style={styles.note} numberOfLines={1}>
          {card ? `${share} do total` : share}
        </Text>
      ) : null}
    </View>
  );
}

function ShowcaseCard({ item, total, onPress }: { item: TopItem; total: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityLabel={spoken(item, total)}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [styles.showcase, hovered && styles.showcaseHover, pressed && { opacity: 0.8 }];
      }}>
      <Thumb e={item.e} style={styles.showcaseImage} />
      <Text style={styles.showcaseName} numberOfLines={1}>
        {item.e.cardName}
      </Text>
      <Value item={item} total={total} card />
    </Pressable>
  );
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  title: { ...typography.heading, color: colors.heading },
  thumb: { width: 40, height: 40 / CARD_RATIO, borderRadius: radius.card, overflow: 'hidden', backgroundColor: binderColors.pocket },
  value: { alignItems: 'flex-end', maxWidth: 150 },
  valueStart: { alignItems: 'flex-start', maxWidth: '100%' },
  money: { ...typography.numeric, color: semantic.money.fg },
  note: { ...typography.caption, color: colors.textMuted },
  grid: { gap: space.lg },
  gridRow: { flexDirection: 'row', gap: space.lg },
  showcase: { flex: 1, minWidth: 0, gap: space.xs, borderRadius: radius.sm, padding: space.xs },
  showcaseHover: { backgroundColor: semantic.hover.onLight },
  showcaseImage: { width: '100%', aspectRatio: CARD_RATIO, borderRadius: radius.card, overflow: 'hidden', backgroundColor: binderColors.pocket, marginBottom: space.xs },
  showcaseName: { ...typography.bodyStrong, color: colors.text },
});
