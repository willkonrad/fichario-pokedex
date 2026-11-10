import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import { isSpecialCard } from '@/components/binder-slot';
import { digitsInSystemFont } from '@/components/digits';
import { FoilRing } from '@/components/foil';
import type { PressState } from '@/components/icon-button';
import { heading } from '@/components/layer-a11y';
import { OwnedBadge, useOwnership } from '@/components/owned-badge';
import { LINK_BROWSER } from '@/components/lookup-bar';
import { Badge, Button, ExternalLink, gridColumns } from '@/components/ui';
import { japaneseAliases, savedAliasIds } from '@/lib/add-card';
import { LOOKUP_PRICE } from '@/lib/copy';
import { formatBRL, formatBRLShort, formatBRLTight, formatDate } from '@/lib/format';
import { cardByKey } from '@/lib/lookup-index';
import { cellPrice } from '@/lib/lookup-price';
import type { CellPrice, LookupCard, LookupHeader, LookupLang, VariantFilter } from '@/lib/lookup-types';
import { cardPhoto, languagesOf, toBrief, type YearGroup } from '@/lib/lookup-view';
import { useEntries } from '@/store/collection';
import { CARD_RATIO, colors, radius, semantic, space, TOUCH, typography } from '@/theme';

const GAP = space.sm;
const ROW_GAP = space.md;
/** Largura desejada de uma célula: 3 colunas no celular, mais em telas largas. */
const CELL = 150;
/** Com 2 a 4 cartas: duas colunas, sem passar disto (foto maior, sem ficar enorme no computador). */
const BIG_CELL_MAX = 260;
/** Coluna do trilho de anos, à direita da grade. */
export const RAIL_SPACE = TOUCH + space.xs;
const YEAR_HEIGHT = 40;
const TITLE_HEIGHT = TOUCH + space.sm;
const NO_HP_HEIGHT = TOUCH;
/** Espessura do filete foil. */
const FOIL = 2;
/** O texto cresce só até aqui: a altura das linhas entra na conta da rolagem. */
export const LOOKUP_FONT_SCALE = 1.2;
/** Quantas fotos entram com prioridade alta. */
const FIRST_PHOTOS = 6;

/** Trilho de anos: só com mais de 2 anos e mais de 18 cartas. */
export function usesYearRail(years: number, cards: number) {
  return years > 2 && cards > 18;
}

/** Colunas e largura de cada carta: mais de 4 cartas, `gridColumns`; de 2 a 4, duas colunas com foto maior. */
export function lookupGridSize(width: number, count: number, rail: boolean) {
  const usable = Math.max(0, width - (rail ? RAIL_SPACE : 0));
  if (count >= 2 && count <= 4) return { cols: 2, itemWidth: Math.min(Math.floor((usable - GAP) / 2), BIG_CELL_MAX), big: true };
  const cols = gridColumns(usable, { cell: CELL, gap: GAP });
  return { cols, itemWidth: Math.floor((usable - GAP * (cols - 1)) / cols), big: false };
}

/** Altura da foto e da célula inteira (foto, linha de preço e linha de identificação). */
export function lookupCellHeight(itemWidth: number, fontScale: number) {
  const photo = Math.round(itemWidth / CARD_RATIO);
  const scale = Math.min(Math.max(fontScale, 1), LOOKUP_FONT_SCALE);
  return { photo, height: photo + space.xs + Math.ceil((typography.numeric.lineHeight + typography.caption.lineHeight) * scale) };
}

export type GridRow =
  | { kind: 'title'; key: string }
  | { kind: 'year'; key: string; title: string; count: number; year: number | null }
  | { kind: 'cards'; key: string; cards: LookupCard[]; start: number }
  | { kind: 'noHp'; key: string; count: number; open: boolean };

/** Linhas da grade: faixa de ano seguida das cartas, e no fim as cartas sem HP conhecido (recolhidas). */
export function buildGridRows(groups: YearGroup[], withoutHp: LookupCard[], noHpOpen: boolean, cols: number, hasTitle: boolean): GridRow[] {
  const rows: GridRow[] = hasTitle ? [{ kind: 'title', key: 'title' }] : [];
  let start = 0;
  const addCards = (list: LookupCard[], prefix: string) => {
    for (let i = 0; i < list.length; i += cols) {
      rows.push({ kind: 'cards', key: `${prefix}:${i}`, cards: list.slice(i, i + cols), start });
      start += Math.min(cols, list.length - i);
    }
  };
  for (const g of groups) {
    rows.push({ kind: 'year', key: `y:${g.key}`, title: g.title, count: g.cards.length, year: g.from != null && g.from === g.to ? g.from : null });
    addCards(g.cards, g.key);
  }
  if (withoutHp.length) {
    rows.push({ kind: 'noHp', key: 'noHp', count: withoutHp.length, open: noHpOpen });
    if (noHpOpen) addCards(withoutHp, 'noHp');
  }
  return rows;
}

function rowHeight(row: GridRow, cellHeight: number) {
  if (row.kind === 'title') return TITLE_HEIGHT;
  if (row.kind === 'year') return YEAR_HEIGHT;
  if (row.kind === 'noHp') return NO_HP_HEIGHT;
  return cellHeight + ROW_GAP;
}

/** Tabela de deslocamentos das linhas: todas têm altura conhecida, sem medir nada na rolagem. */
export function rowOffsets(rows: GridRow[], cellHeight: number) {
  const offsets = new Array<number>(rows.length);
  const heights = new Array<number>(rows.length);
  let y = 0;
  rows.forEach((r, i) => {
    offsets[i] = y;
    heights[i] = rowHeight(r, cellHeight);
    y += heights[i];
  });
  return { offsets, heights };
}

const COLLECTABLE: readonly LookupLang[] = ['pt', 'en', 'ja'];
const isCollectable = (l: LookupLang): l is 'pt' | 'en' | 'ja' => COLLECTABLE.includes(l);
const LANG_TAG: Record<LookupLang, string> = { pt: 'PT', en: 'EN', ja: 'JP', ko: 'KO', zh: 'ZH' };

/** Foto da grade; com 2 a 4 cartas, a versão maior. */
export function gridPhotoUrl(card: LookupCard, lang: LookupLang | null, big: boolean) {
  const url = cardPhoto(card, lang ?? languagesOf(card)[0] ?? 'en', 'grid').url;
  return big && url ? url.replace('_200w', '_400w') : url;
}

/** Etiqueta de idioma da célula: "JP", "EN·PT"; com um idioma escolhido, só ele. */
export function langTag(card: LookupCard, lang: LookupLang | null) {
  if (lang) return LANG_TAG[lang];
  return languagesOf(card)
    .map((l) => LANG_TAG[l])
    .join('·');
}

/** O que o leitor de tela diz do preço da célula. */
function priceSpeech(p: CellPrice) {
  const ref = p.ref === 'en' ? `, ${LOOKUP_PRICE.refEn}` : p.ref === 'ja' ? `, ${LOOKUP_PRICE.refJa}` : '';
  if (p.kind === 'none' || p.brl == null) return 'sem preço';
  const more = p.morePrints ? `, mais ${p.morePrints} ${p.morePrints === 1 ? 'impressão' : 'impressões'}` : '';
  if (p.kind === 'listing') return `${LOOKUP_PRICE.low.toLowerCase()} ${formatBRL(p.brl)}${ref}${more}`;
  return `${formatBRL(p.brl)}, ${LOOKUP_PRICE.market}${ref}${more}`;
}

function yearSpeech(card: LookupCard) {
  if (card.year.kind === 'year') return String(card.year.year);
  if (card.year.kind === 'range') return `de ${card.year.from} a ${card.year.to}`;
  return 'sem ano';
}

const LANG_SPEECH: Record<LookupLang, string> = { pt: 'português', en: 'inglês', ja: 'japonês', ko: 'coreano', zh: 'chinês' };

/** O que o leitor de tela diz da carta sob o cursor do teclado (computador): o mesmo nome da célula. */
export function cursorSpeech(card: LookupCard, lang: LookupLang | null, header: LookupHeader, variant: VariantFilter | null) {
  const twin = card.twinProductId ? cardByKey(String(card.twinProductId), card.dex) : null;
  return lookupCellLabel(card, cellPrice(card, lang, header, twin, variant), null, lang);
}

/** Nome da célula para o leitor de tela: tudo o que a célula mostra em siglas e etiquetas. */
export function lookupCellLabel(card: LookupCard, price: CellPrice, own?: { label: string; exact: boolean } | null, lang: LookupLang | null = null) {
  return [
    card.name,
    (lang ? [lang] : languagesOf(card)).map((l) => LANG_SPEECH[l]).join(' e '),
    card.number ? `número ${card.number}` : '',
    card.set.name,
    yearSpeech(card),
    card.hp != null ? `HP ${card.hpFromTwin ? 'da versão japonesa ' : ''}${card.hp}` : '',
    card.stamp ? `selo ${card.stamp}` : '',
    priceSpeech(price),
    own ? (own.exact ? `você já tem (${own.label})` : 'você tem outra versão') : '',
  ]
    .filter(Boolean)
    .join(', ');
}

type GridProps = {
  groups: YearGroup[];
  withoutHp: LookupCard[];
  width: number;
  fontScale: number;
  lang: LookupLang | null;
  variant: VariantFilter | null;
  header: LookupHeader;
  /** Linha do título, que rola junto (null: sem título). */
  title: ReactElement | null;
  /** O que vem depois da última linha. */
  footer: ReactElement | null;
  /** Carta sob o cursor do teclado (computador). */
  cursorKey: string | null;
  bottomPad: number;
  /** Conferência do lote: segurar só abre a carta, então não há ação de adicionar para o leitor de tela. */
  pick?: boolean;
  /** `from`: a célula tocada, para o foco voltar a ela quando a carta fechar. */
  onOpen: (card: LookupCard, from?: ViewInstance | null) => void;
  onAdd: (card: LookupCard) => void;
};

/**
 * Grade própria da Consulta: preço na célula, grupos por ano com faixa fixa e trilho. Toda linha tem altura conhecida
 * (`getItemLayout`), para qualquer Pokémon abrir na hora. Só redesenha quando as cartas ou os filtros mudam.
 */
export const LookupGrid = memo(function LookupGrid({
  groups,
  withoutHp,
  width,
  fontScale,
  lang,
  variant,
  header,
  title,
  footer,
  cursorKey,
  bottomPad,
  pick = false,
  onOpen,
  onAdd,
}: GridProps) {
  const [noHpOpen, setNoHpOpen] = useState(false);
  const listRef = useRef<FlatList<GridRow>>(null);
  const count = useMemo(() => groups.reduce((n, g) => n + g.cards.length, 0), [groups]);
  const years = useMemo(() => groups.filter((g) => g.from != null && g.from === g.to).map((g) => g.from as number), [groups]);
  const rail = usesYearRail(years.length, count);
  const { cols, itemWidth, big } = lookupGridSize(width, count, rail);
  const { photo, height } = lookupCellHeight(itemWidth, fontScale);
  const rows = useMemo(() => buildGridRows(groups, withoutHp, noHpOpen, cols, !!title), [groups, withoutHp, noHpOpen, cols, title]);
  const { offsets, heights } = useMemo(() => rowOffsets(rows, height), [rows, height]);
  const sticky = useMemo(() => rows.flatMap((r, i) => (r.kind === 'year' ? [i] : [])), [rows]);

  // Mesmo "tenho" da CardGrid: também a carta japonesa salva com outro id.
  const ownership = useOwnership();
  const entries = useEntries();
  const aliases = useMemo(() => japaneseAliases(Object.values(entries)), [entries]);
  /** "Tenho" da linha: confere cada idioma que entra na coleção; linha com dois idiomas diz qual ("tenho · PT"). */
  const ownedOf = (card: LookupCard) => {
    // Coreana e chinesa nunca entram na coleção: "tenho" não vale para elas, nem na linha japonesa que as representa.
    if (lang === 'ko' || lang === 'zh') return null;
    const langs = languagesOf(card).filter(isCollectable);
    for (const l of langs) {
      const brief = toBrief(card, l);
      const found = [brief, ...savedAliasIds(brief, aliases).map((id) => ({ ...brief, id }))].map((x) => ownership(x)).filter((o) => !!o);
      const best = found.find((o) => o.exact) ?? found[0];
      if (best) return { exact: best.exact, label: langs.length > 1 ? `${best.label} · ${LANG_TAG[l]}` : best.label };
    }
    return null;
  };

  // Lista nova: volta ao começo.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [groups]);

  // Cursor do teclado: a linha dele fica à vista.
  useEffect(() => {
    if (!cursorKey) return;
    const index = rows.findIndex((r) => r.kind === 'cards' && r.cards.some((c) => c.key === cursorKey));
    if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
  }, [cursorKey, rows]);

  const jumpTo = (year: number) => {
    const index = rows.findIndex((r) => r.kind === 'year' && r.year === year);
    if (index >= 0) listRef.current?.scrollToOffset({ offset: offsets[index], animated: false });
  };

  // O trilho fica por cima da ponta direita: o que ocupa a linha inteira para antes dele.
  const railGap = rail ? styles.railGap : undefined;

  const renderRow = ({ item: row }: { item: GridRow }) => {
    if (row.kind === 'title') return <View style={[{ height: TITLE_HEIGHT }, railGap]}>{title}</View>;
    if (row.kind === 'year') {
      return (
        // Título de grupo (h2 na web), lido como "2026, 79 cartas".
        <View style={[styles.year, railGap]} accessible accessibilityLabel={`${row.title}, ${row.count} ${row.count === 1 ? 'carta' : 'cartas'}`} {...heading(2)}>
          <Text style={styles.yearTitle} numberOfLines={1} maxFontSizeMultiplier={LOOKUP_FONT_SCALE}>
            {digitsInSystemFont(row.title)}
          </Text>
          <View style={styles.yearRule} aria-hidden />
          <Text style={styles.yearCount} maxFontSizeMultiplier={LOOKUP_FONT_SCALE}>
            {row.count} {row.count === 1 ? 'carta' : 'cartas'}
          </Text>
        </View>
      );
    }
    if (row.kind === 'noHp') {
      return (
        <Pressable
          onPress={() => setNoHpOpen((o) => !o)}
          role="button"
          aria-expanded={row.open}
          accessibilityLabel={`${row.count} ${row.count === 1 ? 'carta' : 'cartas'} sem HP conhecido${row.open ? ', recolher' : ', mostrar'}`}
          style={styles.noHp}>
          <Ionicons name={row.open ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
          <Text style={styles.noHpText} numberOfLines={1} maxFontSizeMultiplier={LOOKUP_FONT_SCALE}>
            {row.count} {row.count === 1 ? 'carta' : 'cartas'} sem HP conhecido
          </Text>
        </Pressable>
      );
    }
    return (
      <View style={[styles.row, { height: height + ROW_GAP }]}>
        {row.cards.map((card, i) => {
          const own = ownedOf(card);
          return (
            <LookupCell
              key={card.key}
              card={card}
              width={itemWidth}
              photoHeight={photo}
              height={height}
              lang={lang}
              variant={variant}
              header={header}
              big={big}
              priority={row.start + i < FIRST_PHOTOS}
              ownLabel={own?.label}
              ownExact={!!own?.exact}
              cursor={card.key === cursorKey}
              pick={pick}
              onOpen={onOpen}
              onAdd={onAdd}
            />
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        data={rows}
        extraData={[ownership, aliases, cursorKey, itemWidth]}
        keyExtractor={(r) => r.key}
        renderItem={renderRow}
        getItemLayout={(_, index) => ({ length: heights[index], offset: offsets[index], index })}
        stickyHeaderIndices={sticky}
        windowSize={5}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: bottomPad }}
        ListFooterComponent={footer ? <View style={railGap}>{footer}</View> : undefined}
      />
      {rail ? (
        <ScrollView style={styles.rail} contentContainerStyle={styles.railContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {years.map((y) => (
            <Pressable
              key={y}
              onPress={() => jumpTo(y)}
              role="button"
              accessibilityLabel={`Ir para ${y}`}
              style={(s) => {
                const { pressed, hovered } = s as PressState;
                return [styles.railItem, hovered && styles.railHover, pressed && { opacity: 0.7 }];
              }}>
              <Text style={styles.railText}>{String(y).slice(-2)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
});

type CellProps = {
  card: LookupCard;
  width: number;
  photoHeight: number;
  height: number;
  lang: LookupLang | null;
  variant: VariantFilter | null;
  header: LookupHeader;
  big: boolean;
  priority: boolean;
  ownLabel?: string;
  ownExact: boolean;
  cursor: boolean;
  pick: boolean;
  onOpen: (card: LookupCard, from?: ViewInstance | null) => void;
  onAdd: (card: LookupCard) => void;
};

/** Uma carta: foto grande, preço e identificação, nessa ordem. Sem foto, a sigla e o número no lugar dela. */
const LookupCell = memo(function LookupCell({
  card,
  width,
  photoHeight,
  height,
  lang,
  variant,
  header,
  big,
  priority,
  ownLabel,
  ownExact,
  cursor,
  pick,
  onOpen,
  onAdd,
}: CellProps) {
  const ref = useRef<ViewInstance>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const twin = card.twinProductId ? cardByKey(String(card.twinProductId), card.dex) : null;
  const price = cellPrice(card, lang, header, twin, variant);
  const brief = languagesOf(card).filter(isCollectable)[0];
  const stamp = brief && card.stamp ? toBrief(card, brief).stamp : undefined;
  const special = isSpecialCard({ variant: stamp?.variant ?? 'normal', rarity: card.rarity });
  const shownUrl = gridPhotoUrl(card, lang, big);
  const own = ownLabel ? { label: ownLabel, exact: ownExact } : null;
  // Na conferência do lote, segurar só abre a carta (o mesmo do toque): nada a oferecer ao leitor de tela.
  const canAdd = !pick && isCollectable(lang ?? languagesOf(card)[0] ?? 'en');
  const imageHeight = special ? photoHeight - FOIL * 2 : photoHeight;

  const id = [price.ref === 'en' ? LOOKUP_PRICE.refShortEn : price.ref === 'ja' ? LOOKUP_PRICE.refShortJa : card.set.abbr, card.hp != null ? `HP${card.hp}` : '']
    .filter(Boolean)
    .join('·');

  return (
    <Pressable
      ref={ref}
      onPress={() => onOpen(card, ref.current)}
      onLongPress={() => onAdd(card)}
      role="button"
      accessibilityLabel={lookupCellLabel(card, price, own, lang)}
      accessibilityHint="Abre o preço e os links"
      // Segurar não existe para quem usa leitor de tela: vira uma ação da célula.
      accessibilityActions={canAdd ? [{ name: 'longpress', label: 'Adicionar à coleção' }] : undefined}
      onAccessibilityAction={canAdd ? () => onAdd(card) : undefined}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [{ width, height }, hovered && styles.cellHover, pressed && styles.cellPressed, cursor && styles.cellCursor];
      }}>
      <View style={special ? styles.foilGap : undefined}>
        {special && loaded ? (
          <FoilRing radius={radius.card + FOIL} width={FOIL} style={StyleSheet.absoluteFill}>
            {null}
          </FoilRing>
        ) : null}
        <View style={[styles.photo, { height: imageHeight }]}>
          {shownUrl && !failed ? (
            <Image
              source={shownUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={card.key}
              transition={null}
              priority={priority ? 'high' : 'normal'}
              onLoad={special ? () => setLoaded(true) : undefined}
              onError={() => setFailed(true)}
            />
          ) : (
            <View style={styles.noPhoto} aria-hidden>
              <Text style={styles.noPhotoAbbr} numberOfLines={1}>
                {card.set.abbr || '—'}
              </Text>
              {card.number ? (
                <Text style={styles.noPhotoNumber} numberOfLines={1}>
                  {card.number}
                </Text>
              ) : null}
            </View>
          )}
          {ownLabel ? <OwnedBadge label={ownLabel} partial={!ownExact} /> : null}
          {/* Com o selo "tenho" no canto, o idioma desce uma linha: "tenho · PT" fica inteiro. */}
          <View style={[styles.langTag, ownLabel ? styles.langTagBelow : null]} aria-hidden>
            <Badge label={langTag(card, lang)} />
          </View>
          {card.number && shownUrl && !failed ? (
            <View style={styles.numberTag} aria-hidden>
              <Text style={styles.numberText} numberOfLines={1}>
                {card.number}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <PriceLine price={price} />
      <Text style={styles.id} numberOfLines={1} maxFontSizeMultiplier={LOOKUP_FONT_SCALE}>
        {id || '—'}
      </Text>
    </Pressable>
  );
});

/** Sem preço: "—". Só anúncio: "anúncio R$ X", em tom menor. Mais de uma impressão: "+1". */
function PriceLine({ price }: { price: CellPrice }) {
  const more =
    price.morePrints > 0 ? (
      <Text style={styles.more} numberOfLines={1} maxFontSizeMultiplier={LOOKUP_FONT_SCALE}>
        {`+${price.morePrints}`}
      </Text>
    ) : null;
  if (price.kind === 'none' || price.brl == null) {
    return (
      <Text style={styles.noPrice} maxFontSizeMultiplier={LOOKUP_FONT_SCALE}>
        —
      </Text>
    );
  }
  // Na célula estreita quem encurta é a palavra: o número e o "+1" ficam inteiros.
  if (price.kind === 'listing') {
    return (
      <View style={styles.priceRow}>
        <Text style={[styles.listing, styles.shrink]} numberOfLines={1} maxFontSizeMultiplier={LOOKUP_FONT_SCALE}>
          {LOOKUP_PRICE.listing}
        </Text>
        <Text style={[styles.listing, styles.noShrink]} numberOfLines={1} maxFontSizeMultiplier={LOOKUP_FONT_SCALE}>
          {formatBRLShort(price.brl)}
        </Text>
        {more}
      </View>
    );
  }
  return (
    <View style={styles.priceRow}>
      <Text style={[styles.price, styles.shrink]} numberOfLines={1} maxFontSizeMultiplier={LOOKUP_FONT_SCALE}>
        {formatBRLTight(price.brl)}
      </Text>
      {more}
    </View>
  );
}

/** Links das coleções sem lista: no MYP, no idioma; no eBay, pelo nome. Só endereços. */
function onlyLinks(term: string, lang: 'ko' | 'zh') {
  const q = encodeURIComponent(term);
  return [
    { id: 'myp', label: 'MYP', url: `https://mypcards.com/pokemon?ProdutoSearch%5Bquery%5D=${q}&ProdutoSearch%5BidiomasSelecionados%5D%5B%5D=${lang === 'ko' ? 8 : 10}` },
    { id: 'ebay', label: 'eBay vendidos', url: `https://www.ebay.com/sch/i.html?_nkw=${q}&_sacat=183454&LH_Sold=1&LH_Complete=1` },
  ];
}

/** Fim da lista: coleções coreanas e chinesas sem lista de cartas e o caminho para a busca do app. */
export function LookupListFoot({ lang, header, speciesName, onSearch }: { lang: LookupLang | null; header: LookupHeader; speciesName?: string; onSearch: () => void }) {
  const [open, setOpen] = useState(false);
  const asian = lang === 'ko' || lang === 'zh' ? lang : null;
  const list = asian ? header.only.filter((o) => (asian === 'ko' ? o.lang === 'ko' : o.lang.startsWith('zh'))) : [];
  const limit = asian === 'ko' ? header.limits.ko : asian === 'zh' ? header.limits.zh : undefined;
  const [limitYear, limitMonth] = (limit ?? '').split('-');
  return (
    <View style={styles.foot}>
      {asian && list.length ? (
        <>
          <Pressable
            onPress={() => setOpen((o) => !o)}
            role="button"
            aria-expanded={open}
            accessibilityLabel={`Coleções sem lista de cartas: ${list.length}${open ? ', recolher' : ', mostrar'}`}
            style={styles.noHp}>
            <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
            <Text style={styles.noHpText}>Coleções sem lista de cartas ({list.length})</Text>
          </Pressable>
          {open ? (
            <View style={styles.onlyList}>
              {limit ? (
                <Text style={styles.footText}>
                  Lista {asian === 'ko' ? 'coreana' : 'chinesa'} até {limitMonth}/{limitYear}
                </Text>
              ) : null}
              {list.map((o) => (
                <View key={`${o.lang}:${o.name}`} style={styles.onlyRow}>
                  <Text style={styles.onlyName}>{o.name}</Text>
                  <Text style={styles.footText}>{[o.date ? formatDate(o.date) : '', o.total != null ? cartasText(o.total) : ''].filter(Boolean).join(' · ')}</Text>
                  <View style={styles.onlyLinks}>
                    {onlyLinks(speciesName ?? o.name, asian).map((l) => (
                      <ExternalLink
                        key={l.id}
                        href={l.url}
                        variant="button"
                        arrow
                        browserOptions={LINK_BROWSER}
                        accessibilityLabel={`${l.label}: ${o.name}, abrir fora do app`}
                        containerStyle={styles.onlyLink}
                        style={styles.onlyLinkText}>
                        {l.label}
                      </ExternalLink>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      {!lang && header.only.length ? <Text style={styles.footText}>Há coleções coreanas e chinesas sem lista de cartas: elas aparecem ao filtrar KO ou ZH.</Text> : null}
      <Button title="Não achou? Buscar no app" variant="ghost" onPress={onSearch} />
    </View>
  );
}

const cartasText = (n: number) => `${n} ${n === 1 ? 'carta' : 'cartas'}`;

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0 },
  row: { flexDirection: 'row', gap: GAP },
  year: { height: YEAR_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.background },
  yearTitle: { ...typography.heading, color: colors.heading, flexShrink: 1 },
  yearRule: { flex: 1, height: 1, backgroundColor: colors.border },
  yearCount: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  noHp: { minHeight: NO_HP_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  noHpText: { ...typography.bodyStrong, ...typography.tabular, color: colors.textMuted },
  cellHover: { opacity: 0.9 },
  cellPressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  // Cursor do teclado: anel branco, a cor do foco.
  cellCursor: { outlineColor: semantic.focus.ring, outlineWidth: semantic.focus.width, outlineStyle: 'solid', outlineOffset: semantic.focus.offset, borderRadius: radius.card },
  foilGap: { padding: FOIL },
  photo: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surface },
  noPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xs, gap: space.xxs },
  noPhotoAbbr: { ...typography.figure, color: colors.text },
  noPhotoNumber: { ...typography.numeric, color: colors.textMuted },
  langTag: { position: 'absolute', top: 4, right: 4 },
  langTagBelow: { top: 26 },
  numberTag: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    maxWidth: '80%',
    backgroundColor: colors.backdrop,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  numberText: { ...typography.tabular, color: colors.text, fontSize: 11, fontWeight: '700' },
  // O espaço entre as partes vem do gap: espaço no fim de um Text de uma linha some na web.
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  shrink: { flexShrink: 1, minWidth: 0 },
  noShrink: { flexShrink: 0 },
  price: { ...typography.numeric, color: semantic.money.fg },
  listing: { ...typography.caption, ...typography.tabular, lineHeight: typography.numeric.lineHeight, color: semantic.money.fgMuted },
  noPrice: { ...typography.numeric, color: colors.textFaint, marginTop: space.xs },
  more: { ...typography.caption, ...typography.tabular, lineHeight: typography.numeric.lineHeight, color: colors.textMuted, flexShrink: 0 },
  id: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  railGap: { paddingRight: RAIL_SPACE },
  rail: { position: 'absolute', top: 0, right: 0, bottom: 0, width: TOUCH },
  railContent: { gap: space.sm, paddingVertical: space.sm },
  railItem: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  railHover: { backgroundColor: colors.surfaceAlt },
  railText: { ...typography.caption, ...typography.tabular, color: colors.text, fontWeight: '700' },
  foot: { gap: space.sm, paddingTop: space.lg, alignItems: 'stretch' },
  footText: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  onlyList: { gap: space.md },
  onlyRow: { gap: space.xxs, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: colors.border },
  onlyName: { ...typography.bodyStrong, color: colors.text },
  onlyLinks: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  onlyLink: { flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.border },
  onlyLinkText: { color: colors.text },
});
