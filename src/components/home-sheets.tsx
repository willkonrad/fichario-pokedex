import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import { CardImage } from '@/components/card-image';
import { type PressState } from '@/components/icon-button';
import { Button, ExternalLink, InfoParagraph, InfoSheet, ListRow, SELECTED_FOCUS, withMarkIcons } from '@/components/ui';
import { entryImageUrl } from '@/lib/catalog';
import { MYP_URL, pricePendingText, RANGE_LABELS, SOURCE_NAME, TCGPLAYER_URL, valueMark } from '@/lib/copy';
import { formatBRL, formatInt } from '@/lib/format';
import { cardNumber } from '@/lib/lists';
import { mypPtImage } from '@/lib/myp-api';
import { LANG_SHORT, VARIANTS, type Entry } from '@/lib/types';
import { pricePending, rangeSource, valuation } from '@/lib/valuation';
import { binderColors, CARD_RATIO, colors, radius, semantic, space, TOUCH, typography } from '@/theme';

const VARIANT_LABEL = Object.fromEntries(VARIANTS.map((v) => [v.id, v.label])) as Record<string, string>;

/** "Ir para a página" (H5): a grade das páginas, cada uma com quanto já tem carta. */
export function GoToPageSheet({
  visible,
  onClose,
  pages,
  current,
  fillOf,
  labelOf,
  onGo,
}: {
  visible: boolean;
  onClose: () => void;
  pages: number;
  /** Páginas abertas agora (uma ou duas). */
  current: number[];
  /** Fração dos bolsos da página com carta (0 a 1). */
  fillOf: (page: number) => number;
  /** Rótulo curto embaixo do número (ex.: "#241"). */
  labelOf?: (page: number) => string | undefined;
  onGo: (page: number) => void;
}) {
  return (
    <InfoSheet visible={visible} onClose={onClose} title="Ir para a página">
      {visible ? (
        <View style={styles.grid}>
          {Array.from({ length: pages }, (_, p) => {
            const fill = fillOf(p);
            const sub = labelOf?.(p);
            const open = current.includes(p);
            return (
              <Pressable
                key={p}
                onPress={() => onGo(p)}
                role="button"
                accessibilityLabel={`Página ${p + 1}${sub ? `, ${sub}` : ''}, ${Math.round(fill * 100)}% com carta${open ? ', aberta' : ''}`}
                style={(s) => {
                  const { pressed, hovered } = s as PressState;
                  return [styles.cell, fill >= 1 && styles.cellFull, open && styles.cellOpen, open && SELECTED_FOCUS, hovered && !open && styles.cellHover, pressed && { opacity: 0.7 }];
                }}>
                <Text style={[styles.cellNumber, open && styles.cellTextOpen]}>{p + 1}</Text>
                {sub ? <Text style={[styles.cellSub, open && styles.cellTextOpen]}>{sub}</Text> : null}
                <View style={[styles.cellBar, open && styles.cellBarOpen]}>
                  <View style={[styles.cellFill, open && styles.cellFillOpen, { width: `${Math.round(fill * 100)}%` }]} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </InfoSheet>
  );
}

/** Preço da carta em uma linha, com a fonte (e o link do MYP Cards ou da TCGplayer, obrigatório onde há preço deles). */
function PeekPrice({ entry }: { entry: Entry }) {
  const v = valuation(entry);
  if (v.value == null) return <Text style={styles.peekMuted}>{pricePending(entry) ? pricePendingText(Platform.OS === 'web').peek : 'Sem preço'}</Text>;
  const mark = valueMark(v);
  const source = rangeSource(v);
  return (
    <View style={styles.peekPrice}>
      <Text style={styles.peekValue}>
        {mark.mark ? withMarkIcons(`${mark.mark} `, { size: typography.figure.fontSize, color: semantic.money.fg }) : ''}
        {formatBRL(v.value)}
      </Text>
      <Text style={styles.peekMuted}>
        {v.basis === 'manual' ? (
          SOURCE_NAME.manual
        ) : source ? (
          <>
            {RANGE_LABELS[source][v.pick ?? 'avg'].short} ·{' '}
            <ExternalLink href={source === 'myp' ? MYP_URL : TCGPLAYER_URL} variant="inline" arrow>
              {source === 'myp' ? 'MYP Cards' : 'TCGplayer'}
            </ExternalLink>
          </>
        ) : null}
        {mark.mark === '≈' ? ' · aproximado' : ''}
      </Text>
    </View>
  );
}

/** Espiar a carta sem sair da página (toque longo no bolso, H3): imagem, coleção, versão, estado, preço e "Abrir". */
export function CardPeekSheet({ entry, position, onClose, onOpen }: { entry?: Entry; position?: string; onClose: () => void; onOpen: () => void }) {
  const variant = entry && entry.variant !== 'normal' ? [VARIANT_LABEL[entry.variant], entry.variantNote?.trim()].filter(Boolean).join(' · ') : '';
  return (
    <InfoSheet
      visible={!!entry}
      onClose={onClose}
      title={entry?.cardName ?? ''}
      footer={entry ? <Button title="Abrir carta" icon="open-outline" onPress={onOpen} /> : undefined}>
      {entry ? (
        <View style={styles.peek}>
          {/* Decorativa: o título da folha já diz a carta (na web, sairia como imagem sem nome). */}
          <View style={styles.peekImage} aria-hidden>
            <CardImage
              image={entry.image}
              imageUrl={entryImageUrl(entry)}
              cardId={entry.lang === 'ja' ? undefined : entry.cardId}
              localId={entry.localId}
              label={entry.cardName}
              dex={entry.dex || undefined}
              quality="high"
              dark
              stampKeys={entry.stampKeys}
              photo={entry.stampPhoto}
              ptImage={mypPtImage(entry)}
              recyclingKey={entry.id}
              priority="high"
            />
          </View>
          <View style={styles.peekInfo}>
            <Text style={styles.peekSet}>
              {entry.setName}
              {entry.localId ? ` · ${cardNumber(entry)}` : ''}
            </Text>
            <Text style={styles.peekMuted}>{[LANG_SHORT[entry.lang], variant, entry.condition].filter(Boolean).join(' · ')}</Text>
            <PeekPrice entry={entry} />
            {position ? <Text style={styles.peekMuted}>{position}</Text> : null}
          </View>
        </View>
      ) : null}
    </InfoSheet>
  );
}

/** Linhas por vez em "cartas fora do fichário": a folha não é virtualizada e cada linha carrega uma miniatura. */
export const OUTSIDE_PAGE = 30;

type OutsideListProps = { entries: Entry[]; reasonOf: (e: Entry) => string; onOpen: (e: Entry) => void };

/** Montada a cada abertura da folha: volta à primeira leva. */
function OutsideList({ entries, reasonOf, onOpen }: OutsideListProps) {
  const [limit, setLimit] = useState(OUTSIDE_PAGE);
  const rest = entries.length - limit;
  // "Ver mais": o foco vai para a primeira linha nova (o botão desce para o fim da lista ou some).
  const firstNew = useRef<ViewInstance>(null);
  useEffect(() => {
    if (Platform.OS === 'web' && limit > OUTSIDE_PAGE) (firstNew.current as unknown as HTMLElement | null)?.focus();
  }, [limit]);
  const anchor = limit - OUTSIDE_PAGE;
  return (
    <>
      {entries.slice(0, limit).map((e, i) => (
        <View key={e.id} ref={i === anchor ? firstNew : undefined} tabIndex={Platform.OS === 'web' && i === anchor ? -1 : undefined}>
          <ListRow
            title={e.cardName}
            subtitle={`${e.setName} · ${reasonOf(e)}`}
            onPress={() => onOpen(e)}
            accessibilityLabel={`${e.cardName}, ${e.setName}, ${reasonOf(e)}. Abrir`}
            left={
              <View style={styles.rowThumb}>
                <CardImage
                  image={e.image}
                  imageUrl={entryImageUrl(e)}
                  cardId={e.lang === 'ja' ? undefined : e.cardId}
                  localId={e.localId}
                  photo={e.stampPhoto}
                  ptImage={mypPtImage(e)}
                  compact
                  recyclingKey={e.id}
                />
              </View>
            }
          />
        </View>
      ))}
      {rest > 0 ? (
        <>
          <Text style={styles.outsideCount}>{`${formatInt(limit)} de ${formatInt(entries.length)}`}</Text>
          <Button title="Ver mais" variant="secondary" label={`Ver mais ${formatInt(Math.min(rest, OUTSIDE_PAGE))} cartas`} onPress={() => setLimit(limit + OUTSIDE_PAGE)} />
        </>
      ) : null}
    </>
  );
}

/** Cartas sem bolso na configuração atual do fichário (F2): continuam salvas e no valor; daqui se abre cada uma. */
export function OutsideCardsSheet({
  visible,
  onClose,
  entries,
  reasonOf,
  onOpen,
  onEdit,
}: {
  visible: boolean;
  onClose: () => void;
  entries: Entry[];
  reasonOf: (e: Entry) => string;
  onOpen: (e: Entry) => void;
  onEdit: () => void;
}) {
  return (
    <InfoSheet
      visible={visible}
      onClose={onClose}
      title={`${entries.length} ${entries.length === 1 ? 'carta fora do fichário' : 'cartas fora do fichário'}`}
      footer={<Button title="Ajustar o fichário" variant="secondary" icon="settings-outline" onPress={onEdit} />}>
      <InfoParagraph>Continuam salvas e no valor, mas não têm bolso na configuração atual.</InfoParagraph>
      {visible ? <OutsideList entries={entries} reasonOf={reasonOf} onOpen={onOpen} /> : null}
    </InfoSheet>
  );
}

const PEEK_W = 150;
const THUMB_W = 40;

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: {
    width: 58,
    minHeight: TOUCH + 12,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xs,
    gap: 2,
  },
  cellFull: { borderColor: semantic.progress.fill },
  cellOpen: { backgroundColor: semantic.selected.bg, borderColor: semantic.selected.border },
  cellHover: { borderColor: colors.borderStrong },
  cellNumber: { color: colors.text, fontSize: 15, lineHeight: 18, fontWeight: '800', ...typography.tabular },
  cellSub: { color: colors.textMuted, fontSize: 11, lineHeight: 13, ...typography.tabular },
  cellTextOpen: { color: semantic.selected.fg },
  cellBar: { width: 40, height: 3, borderRadius: 2, backgroundColor: semantic.progress.track, overflow: 'hidden', marginTop: 2 },
  // Na página aberta o fundo é branco: a barra precisa de tinta escura.
  cellBarOpen: { backgroundColor: colors.textMuted },
  cellFill: { height: 3, backgroundColor: semantic.progress.fill },
  cellFillOpen: { backgroundColor: semantic.selected.fg },
  peek: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  peekImage: { width: PEEK_W, height: Math.round(PEEK_W / CARD_RATIO), borderRadius: radius.card, overflow: 'hidden', backgroundColor: binderColors.pocket },
  peekInfo: { flex: 1, minWidth: 0, gap: space.sm },
  peekSet: { ...typography.bodyStrong, color: colors.text },
  peekPrice: { gap: 2 },
  peekValue: { ...typography.figure, color: semantic.money.fg },
  peekMuted: { ...typography.caption, color: colors.textMuted },
  rowThumb: { width: THUMB_W, height: Math.round(THUMB_W / CARD_RATIO), borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  outsideCount: { ...typography.caption, ...typography.tabular, color: colors.textMuted, textAlign: 'center', marginTop: space.sm },
});
