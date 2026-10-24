import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardImage } from '@/components/card-image';
import { type PressState } from '@/components/icon-button';
import { Button, ExternalLink, InfoParagraph, InfoSheet, ListRow } from '@/components/ui';
import { MYP_URL, RANGE_LABELS, SOURCE_NAME, TCGPLAYER_URL, valueMark } from '@/lib/copy';
import { formatBRL } from '@/lib/format';
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
                  return [styles.cell, fill >= 1 && styles.cellFull, open && styles.cellOpen, hovered && !open && styles.cellHover, pressed && { opacity: 0.7 }];
                }}>
                <Text style={[styles.cellNumber, open && styles.cellTextOpen]}>{p + 1}</Text>
                {sub ? <Text style={[styles.cellSub, open && styles.cellTextOpen]}>{sub}</Text> : null}
                <View style={styles.cellBar}>
                  <View style={[styles.cellFill, { width: `${Math.round(fill * 100)}%` }]} />
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
  if (v.value == null) return <Text style={styles.peekMuted}>{pricePending(entry) ? 'Buscando o preço…' : 'Sem preço'}</Text>;
  const mark = valueMark(v);
  const source = rangeSource(v);
  return (
    <View style={styles.peekPrice}>
      <Text style={styles.peekValue}>
        {mark.mark ? `${mark.mark} ` : ''}
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
          <View style={styles.peekImage}>
            <CardImage
              image={entry.image}
              imageUrl={entry.imageUrl}
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
              {entry.localId ? ` · ${entry.localId}${entry.setTotal ? `/${entry.setTotal}` : ''}` : ''}
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
      {entries.map((e) => (
        <ListRow
          key={e.id}
          title={e.cardName}
          subtitle={`${e.setName} · ${reasonOf(e)}`}
          onPress={() => onOpen(e)}
          accessibilityLabel={`${e.cardName}, ${e.setName}, ${reasonOf(e)}. Abrir`}
          left={
            <View style={styles.rowThumb}>
              <CardImage
                image={e.image}
                imageUrl={e.imageUrl}
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
      ))}
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
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xs,
    gap: 2,
  },
  cellFull: { borderColor: semantic.special.border },
  cellOpen: { backgroundColor: semantic.selected.bg, borderColor: semantic.selected.border },
  cellHover: { borderColor: colors.borderStrong },
  cellNumber: { color: colors.text, fontSize: 15, lineHeight: 18, fontWeight: '800', ...typography.tabular },
  cellSub: { color: colors.textMuted, fontSize: 11, lineHeight: 13, ...typography.tabular },
  cellTextOpen: { color: semantic.selected.fg },
  cellBar: { width: 40, height: 3, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginTop: 2 },
  cellFill: { height: 3, backgroundColor: semantic.special.fill },
  peek: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  peekImage: { width: PEEK_W, height: Math.round(PEEK_W / CARD_RATIO), borderRadius: radius.card, overflow: 'hidden', backgroundColor: binderColors.pocket },
  peekInfo: { flex: 1, minWidth: 0, gap: space.sm },
  peekSet: { ...typography.bodyStrong, color: colors.text },
  peekPrice: { gap: 2 },
  peekValue: { ...typography.title, color: semantic.money.fg, ...typography.tabular },
  peekMuted: { ...typography.caption, color: colors.textMuted },
  rowThumb: { width: THUMB_W, height: Math.round(THUMB_W / CARD_RATIO), borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
});
