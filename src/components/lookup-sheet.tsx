import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewInstance, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isSpecialCard } from '@/components/binder-slot';
import { digitsInSystemFont } from '@/components/digits';
import { FoilRing } from '@/components/foil';
import { IconButton, type PressState } from '@/components/icon-button';
import { focusNode, heading, TAB_INSIDE } from '@/components/layer-a11y';
import { LINK_BROWSER } from '@/components/lookup-bar';
import { NATIVE_DRIVER, useReducedMotion } from '@/components/motion';
import { Badge, Button, Chip, ChipGroup, ExternalLink, Notice, Segmented, Skeleton, useLayout } from '@/components/ui';
import { ownershipOf } from '@/components/owned-badge';
import { isCopyOf } from '@/lib/add-card';
import { LOOKUP_PRICE, lookupChipPrice, lookupChipSpeech, lookupDatesText, MYP_NO_ANSWER, MYP_OFFLINE, MYP_URL, mypOffersText, mypPauseText } from '@/lib/copy';
import { formatAgo, formatBRL, formatBRLTight } from '@/lib/format';
import { entryPlace, placeText } from '@/lib/lists';
import { lookupBrief, printOfVariant } from '@/lib/lookup-brief';
import { allowsLang } from '@/lib/lookup-format';
import { portalLinks } from '@/lib/lookup-links';
import { cardByKey, sectionCards } from '@/lib/lookup-index';
import { useMypNow } from '@/lib/lookup-myp';
import { cellPrice, priceBlock } from '@/lib/lookup-price';
import { rarityCode } from '@/lib/lookup-query';
import type { LookupCard, LookupHeader, LookupLang, MypNow, PortalLink, PrintCode, PriceBlock, VariantFilter, YearInfo } from '@/lib/lookup-types';
import { cardPhoto, defaultSheetLang, languagesOf, siblings } from '@/lib/lookup-view';
import type { CardBrief } from '@/lib/tcgdex';
import { CONDITIONS, type Condition } from '@/lib/types';
import { useBinders, useEntries, useSettings } from '@/store/collection';
import { CARD_RATIO, colors, elevation, radius, semantic, space, TOUCH, typography } from '@/theme';

const WEB = Platform.OS === 'web';
const ANDROID = Platform.OS === 'android';
/** Entrada da folha: tem de ser quase imediata, no meio de um leilão. */
const ENTER_MS = 140;
const FOIL = 4;
const PHOTO_MAX = 200;
/** O foco vai para o título ao abrir a folha, sem o contorno do navegador: não é um controle. */
const NO_OUTLINE = WEB ? ({ outlineWidth: 0 } as ViewStyle) : null;

const LANG_NAME: Record<LookupLang, string> = { pt: 'Português', en: 'Inglês', ja: 'Japonês', ko: 'Coreano', zh: 'Chinês' };
const LANG_SHORT: Record<LookupLang, string> = { pt: 'PT', en: 'EN', ja: 'JP', ko: 'KO', zh: 'ZH' };

/** Só PT, EN e JP entram na coleção: coreana e chinesa são consulta. */
export function collectableLang(lang: LookupLang): lang is 'pt' | 'en' | 'ja' {
  return lang === 'pt' || lang === 'en' || lang === 'ja';
}

function yearText(y: YearInfo) {
  if (y.kind === 'year') return String(y.year);
  if (y.kind === 'range') return `${y.from}–${y.to}`;
  return 'Sem ano';
}

function twinOf(card: LookupCard) {
  return card.twinProductId ? cardByKey(String(card.twinProductId), card.dex) : null;
}

/** Idioma ao abrir: o pedido por quem abriu (o da leitura, o da versão anterior), se a carta existe nele; senão, o padrão. */
function startLang(card: LookupCard, openLang: LookupLang | null | undefined, activeLang: LookupLang | null) {
  return openLang && allowsLang(card, openLang) ? openLang : defaultSheetLang(card, activeLang);
}

function mypWhen(at: string) {
  const ago = formatAgo(at);
  return ago === 'agora mesmo' ? 'agora' : ago;
}

type BodyProps = {
  card: LookupCard;
  header: LookupHeader;
  /** Idioma do filtro (null: "Todos"). */
  activeLang: LookupLang | null;
  /** Idioma em que a carta foi aberta, quando quem abriu sabe (leitura da foto, "Outras versões"). */
  openLang?: LookupLang | null;
  variant: VariantFilter | null;
  /** Largura útil (para o tamanho da foto). */
  width: number;
  /** Veio da conferência do lote: a ação principal escolhe a carta. */
  pick: boolean;
  /** Dar o foco acessível ao abrir (folha e painel; na célula única, não). */
  focusOnMount?: boolean;
  onOpenCard: (card: LookupCard, lang?: LookupLang) => void;
  onAdd: (brief: CardBrief) => void;
  onPick: (card: LookupCard, lang: 'pt' | 'en' | 'ja') => void;
  /** A foto grande abriu ou fechou: o Esc dela não fecha a carta. */
  onPhoto?: (open: boolean) => void;
};

/** Conteúdo da carta: usado na folha, no painel do computador e direto na tela quando só há uma carta. */
export function LookupCardBody(p: BodyProps) {
  return <CardBody key={p.card.key} {...p} />;
}

function CardBody({ card, header, activeLang, openLang, variant, width, pick, focusOnMount, onOpenCard, onAdd, onPick, onPhoto }: BodyProps) {
  const langs = languagesOf(card);
  const [lang, setLang] = useState<LookupLang>(() => startLang(card, openLang, activeLang));
  const [print, setPrint] = useState<PrintCode | null>(() => printOfVariant(card, variant));
  const [condition, setCondition] = useState<Condition>('NM');
  const [about, setAbout] = useState(false);
  const [full, setFull] = useState(false);
  const focusRef = useRef<ViewInstance>(null);

  // O idioma da busca mudou com a carta aberta (chip, " ko" digitado): a folha acompanha, e coreana não fica como japonesa.
  const [seenActive, setSeenActive] = useState(activeLang);
  if (seenActive !== activeLang) {
    setSeenActive(activeLang);
    setLang(activeLang && allowsLang(card, activeLang) ? activeLang : startLang(card, openLang, activeLang));
    setPrint(printOfVariant(card, variant));
  }

  const twin = twinOf(card);
  const block = priceBlock(card, lang, header, twin, print);
  const myp = useMypNow(card, lang);
  const mypUrl = myp.status === 'ok' ? myp.url : undefined;
  const { main, more } = useMemo(() => portalLinks({ card, lang, condition, mypUrl }), [card, lang, condition, mypUrl]);
  const section = useMemo(() => sectionCards(card.dex), [card.dex]);
  const others = useMemo(() => siblings(card, section), [card, section]);

  const entries = useEntries();
  const settings = useSettings();
  const binders = useBinders();
  const collectable = collectableLang(lang);
  // A impressão na tela (chip ou a do preço) vai junto: o "Adicionar" já marca a 1ª edição, a Shadowless, a reverse…
  const brief = collectable ? lookupBrief(card, lang, block.printCode ?? print) : null;
  // A cópia conta como "tenho" só com o mesmo selo; a Master Ball da mesma carta é "outra versão".
  const sameCard = brief ? Object.values(entries).filter((e) => isCopyOf(e, brief)) : [];
  const exactCopies = brief ? sameCard.filter((e) => ownershipOf([e], brief)?.exact) : [];
  const copies = exactCopies.length ? exactCopies : sameCard;
  const ownedWord = exactCopies.length ? 'tenho' : 'outra versão';

  useEffect(() => {
    if (focusOnMount) focusNode(focusRef.current);
  }, [focusOnMount]);

  useEffect(() => {
    if (!full) return;
    onPhoto?.(true);
    return () => onPhoto?.(false);
  }, [full, onPhoto]);

  // O navegador já prepara a primeira loja: o link abre na hora.
  const firstLink = main[0]?.url;
  useEffect(() => {
    if (ANDROID && firstLink) WebBrowser.mayInitWithUrlAsync(firstLink).catch(() => {});
  }, [firstLink]);

  const photoWidth = Math.min(Math.round(width * 0.42), PHOTO_MAX);
  const special = isSpecialCard({ variant: brief?.stamp?.variant ?? 'normal', rarity: card.rarity });
  const code = rarityCode(card.rarity);
  const line3 = [code ?? card.rarity, card.qualifier].filter(Boolean).join(' · ');
  const name = lang === 'pt' && card.ptName ? card.ptName : card.name;
  const hp = card.hp != null ? `${card.hpFromTwin ? 'HP JP' : 'HP'} ${card.hp}` : '';
  const line2 = [yearText(card.year), hp].filter(Boolean).join(' · ');
  const line1 = [card.number, card.set.abbr || card.set.name].filter(Boolean).join(' · ');

  const photoTag = cardPhoto(card, lang, 'large').tag;
  const showPT = lang === 'pt' && card.marks.includes('u');
  const showKO = lang === 'ko' && card.marks.includes('i');

  return (
    <View style={styles.body}>
      <View style={styles.head}>
        <SheetPhoto card={card} lang={lang} width={photoWidth} special={special} name={name} onFull={() => setFull(true)} />
        <View style={styles.info}>
          <View ref={focusRef} accessible accessibilityLabel={[name, line1, line2, line3].filter(Boolean).join(', ')} tabIndex={-1} style={[styles.titleBlock, NO_OUTLINE]}>
            <Text style={styles.title} {...heading(2)}>
              {digitsInSystemFont(name)}
            </Text>
            {line1 ? <Text style={styles.line}>{line1}</Text> : null}
            <Text style={styles.line}>{line2}</Text>
            {line3 ? <Text style={styles.lineMuted}>{line3}</Text> : null}
          </View>
          {card.stamp ? <Badge label={card.stamp} tone={special ? 'special' : 'neutral'} /> : null}
          {showPT ? <Badge label="PT não confirmada" /> : null}
          {showKO ? <Badge label="KO · pela coleção" /> : null}
          {langs.length > 1 ? (
            <Segmented
              label="Idioma da carta"
              value={lang}
              options={langs.map((l) => ({ id: l, label: LANG_SHORT[l], hint: LANG_NAME[l] }))}
              onChange={(l) => {
                setLang(l);
                setPrint(printOfVariant(card, variant));
              }}
            />
          ) : null}
          {copies.length ? (
            <Text style={styles.owned} numberOfLines={2}>
              {ownedWord}: {placeText(entryPlace(copies[0], settings, binders))}
              {copies.length > 1 ? ` (+${copies.length - 1})` : ''}
            </Text>
          ) : null}
        </View>
      </View>

      {lang === 'pt' ? <MypLine now={myp} lang={lang} main /> : null}
      <PriceArea block={block} onlyLookup={!collectable} />
      {block.prints.length > 1 ? (
        <ChipGroup label="Impressão">
          {block.prints.map((x) => (
            <Chip
              key={x.code}
              // A legenda de cima já diz de que versão é o preço; sem preço nesta impressão, não há legenda.
              label={x.brl != null ? `${x.label} ${lookupChipPrice(x.brl, x.kind, block.kind === 'none' ? block.printsRef : null)}` : x.label}
              selected={x.code === (block.printCode ?? print)}
              accessibilityLabel={`${x.label}: ${x.brl != null ? lookupChipSpeech(x.brl, x.kind, block.printsRef) : 'sem preço'}`}
              onPress={() => setPrint(x.code)}
            />
          ))}
        </ChipGroup>
      ) : null}
      {lang === 'en' ? <MypLine now={myp} lang={lang} /> : null}

      {others.length ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Outras versões</Text>
          <ChipGroup label="Outras versões" mode="button">
            {others.map((s) => {
              const price = cellPrice(s, lang, header, twinOf(s), null);
              const title = s.stamp || s.set.abbr || s.set.name;
              return (
                <Chip
                  key={s.key}
                  mode="button"
                  label={price.brl != null ? `${title} ${lookupChipPrice(price.brl, price.kind, price.ref)}` : title}
                  accessibilityLabel={`${title}, ${price.brl != null ? lookupChipSpeech(price.brl, price.kind, price.ref) : 'sem preço'}. Abrir esta versão`}
                  onPress={() => onOpenCard(s, lang)}
                />
              );
            })}
          </ChipGroup>
        </View>
      ) : null}

      {card.productId != null || card.twinProductId != null ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Estado no link</Text>
          <Segmented label="Estado no link da TCGplayer" value={condition} options={CONDITIONS.map((c) => ({ id: c.id, label: c.label, hint: c.desc }))} onChange={setCondition} />
        </View>
      ) : null}

      <PortalLinks links={main} />
      {more.length ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Mais</Text>
          <PortalLinks links={more} />
        </View>
      ) : null}

      {brief ? (
        pick ? (
          <Button title="Usar esta carta" icon="checkmark" onPress={() => onPick(card, brief.lang as 'pt' | 'en' | 'ja')} />
        ) : (
          <Button title="Adicionar à coleção" icon="add" onPress={() => onAdd(brief)} />
        )
      ) : (
        <Notice>{LOOKUP_PRICE.onlyLookup}</Notice>
      )}

      <AboutData open={about} onToggle={() => setAbout((o) => !o)} card={card} lang={lang} photoTag={photoTag} />

      {full ? <FullPhoto url={cardPhoto(card, lang, 'full').url} name={name} onClose={() => setFull(false)} /> : null}
    </View>
  );
}

/** Dois níveis de foto: a miniatura que a grade já trouxe e, por cima, a maior. Tocar abre a maior de todas. */
function SheetPhoto({ card, lang, width, special, name, onFull }: { card: LookupCard; lang: LookupLang; width: number; special: boolean; name: string; onFull: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const small = cardPhoto(card, lang, 'grid');
  const large = cardPhoto(card, lang, 'large');
  const height = Math.round(width / CARD_RATIO);
  const inner = special ? height - FOIL * 2 : height;
  const body = (
    <View style={[styles.photo, { height: inner }]}>
      {small.url ? <Image source={small.url} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={`${card.key}:s`} transition={null} /> : null}
      {large.url ? (
        <Image
          source={large.url}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`${card.key}:l`}
          transition={null}
          priority="high"
          onLoad={() => setLoaded(true)}
        />
      ) : null}
      {!small.url && !large.url ? (
        <View style={styles.noPhoto} aria-hidden>
          <Text style={styles.noPhotoAbbr} numberOfLines={1}>
            {card.set.abbr || '—'}
          </Text>
          {card.number ? <Text style={styles.noPhotoNumber}>{card.number}</Text> : null}
        </View>
      ) : null}
      {large.tag ? (
        <View style={styles.photoTag}>
          <Badge label={large.tag} />
        </View>
      ) : null}
    </View>
  );
  return (
    <Pressable onPress={onFull} disabled={!large.url} role="button" aria-disabled={!large.url} accessibilityLabel={`Ver a foto grande de ${name}`} style={{ width }}>
      <View style={special ? styles.foilGap : undefined}>
        {special && loaded ? (
          <FoilRing radius={radius.card + FOIL} width={FOIL} style={StyleSheet.absoluteFill}>
            {null}
          </FoilRing>
        ) : null}
        {body}
      </View>
    </Pressable>
  );
}

function FullPhoto({ url, name, onClose }: { url: string | null; name: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent aria-label={WEB ? `Foto de ${name}` : undefined}>
      {/* View e não Pressable: o fundo fecha ao toque, sem entrar no Tab nem repetir o "Fechar a foto" do botão. */}
      <View style={styles.fullRoot} onStartShouldSetResponder={() => true} onResponderRelease={onClose}>
        {url ? (
          <Image source={url} style={styles.fullImage} contentFit="contain" cachePolicy="memory-disk" transition={null} priority="high" accessibilityLabel={`Foto de ${name}`} />
        ) : null}
      </View>
      <View style={[styles.fullClose, { top: insets.top + space.sm }]}>
        <IconButton icon="close" label="Fechar a foto" onPress={onClose} tone="soft" />
      </View>
    </Modal>
  );
}

/** Preço do índice: legenda da fonte antes do número, câmbio e data sempre juntos. Sem preço, nunca estima. */
function PriceArea({ block, onlyLookup }: { block: PriceBlock; onlyLookup: boolean }) {
  if (block.kind === 'none' || block.brl == null) {
    return <Text style={styles.noPrice}>Sem preço no índice</Text>;
  }
  const legend = block.ref === 'en' ? LOOKUP_PRICE.refEn : block.ref === 'ja' ? LOOKUP_PRICE.refJa : 'TCGplayer';
  const kind = block.kind === 'market' ? LOOKUP_PRICE.market : LOOKUP_PRICE.low;
  const details = [
    block.lowBrl != null && block.kind === 'market' ? `${LOOKUP_PRICE.low} ${formatBRLTight(block.lowBrl)}` : '',
    block.midBrl != null ? `${LOOKUP_PRICE.mid} ${formatBRLTight(block.midBrl)}` : '',
  ].filter(Boolean);
  return (
    <View style={styles.price}>
      <Text style={styles.legend}>{legend}</Text>
      <View style={styles.priceRow} accessible accessibilityLabel={`${block.ref ? 'Referência, ' : ''}${legend}: ${formatBRL(block.brl)}, ${kind}${onlyLookup ? ', não entra na coleção' : ''}`}>
        <Text style={block.kind === 'market' ? styles.money : styles.moneySmall}>{formatBRL(block.brl)}</Text>
        <Text style={styles.priceKind}>{kind}</Text>
      </View>
      <Text style={styles.detail}>{lookupDatesText(block)}</Text>
      {details.length ? <Text style={styles.detail}>{details.join(' · ')}</Text> : null}
      {block.kind === 'listing' ? <Text style={styles.detail}>{LOOKUP_PRICE.noSales}</Text> : null}
    </View>
  );
}

/** MYP na hora, com o crédito. Enquanto chega, um esqueleto só nesta linha: o resto já está na tela. */
function MypLine({ now, lang, main = false }: { now: MypNow; lang: LookupLang; main?: boolean }) {
  if (now.status === 'unavailable' && now.reason === 'language') return null;
  if (now.status === 'unavailable') {
    return <Text style={styles.detail}>{now.reason === 'web' ? LOOKUP_PRICE.mypMobileOnly : now.reason === 'error' ? MYP_NO_ANSWER : MYP_OFFLINE}</Text>;
  }
  const credit = (href: string) => (
    <ExternalLink href={href} variant="inline" arrow browserOptions={LINK_BROWSER}>
      MYP Cards
    </ExternalLink>
  );
  switch (now.status) {
    case 'limited':
      return (
        <Text style={styles.detail}>
          {mypPauseText(now.retryInS, now.by)} · {credit(MYP_URL)}
        </Text>
      );
    case 'notFound':
      return <Text style={styles.detail}>{credit(MYP_URL)}: sem oferta agora</Text>;
    case 'ok':
      return (
        <Text style={main ? styles.mypMain : styles.detail}>
          {credit(now.url ?? MYP_URL)}: {mypOffersText(now)} · {mypWhen(now.at)}
        </Text>
      );
    default:
      return (
        <View accessible aria-busy accessibilityLabel="Buscando o preço do MYP Cards" style={styles.mypSkeleton}>
          <Skeleton width="72%" height={typography.caption.lineHeight} />
        </View>
      );
  }
}

/** Links para os sites de preço: neutros (o vermelho é da ação principal). Nada é lido desses sites. */
function PortalLinks({ links }: { links: PortalLink[] }) {
  return (
    <View style={styles.links}>
      {links.map((l) => (
        <ExternalLink
          key={l.id}
          href={l.url}
          variant="button"
          arrow
          browserOptions={LINK_BROWSER}
          accessibilityLabel={`${l.label}: abrir fora do app`}
          containerStyle={styles.link}
          style={styles.linkText}>
          {l.label}
        </ExternalLink>
      ))}
    </View>
  );
}

function aboutLines(card: LookupCard, lang: LookupLang, photoTag: string | undefined) {
  const out: string[] = [];
  if (card.hpFromTwin) out.push('HP JP: o HP vem da versão japonesa desta carta.');
  if (card.hp == null) out.push('A fonte não informa o HP desta carta.');
  if (card.year.kind === 'range') out.push(`Promos ${card.year.from}–${card.year.to}: a fonte não data cada carta.`);
  else if (card.year.kind === 'none') out.push('A fonte não informa o ano desta carta.');
  else if (card.year.origin === 'name') out.push('Ano tirado do nome do produto.');
  else if (card.year.origin === 'original') out.push('Ano original da carta: a coleção reúne cartas de anos diferentes.');
  else if (card.year.origin === 'japan') out.push('Lançamento JP: o ano é o da versão japonesa.');
  if (photoTag === 'Foto JP') out.push('Foto JP: esta língua não tem foto própria; a imagem é da versão japonesa.');
  if (photoTag === 'Foto EN') out.push('Foto EN: a imagem é da versão inglesa.');
  if (photoTag === 'Sem foto') out.push('Sem foto disponível para esta língua.');
  if (lang === 'pt' && card.marks.includes('u')) out.push('PT não confirmada: a coleção saiu em português, mas a carta não está na lista.');
  if (lang === 'ko' && card.marks.includes('i')) out.push('KO · pela coleção: a coleção coreana tem o mesmo total da japonesa.');
  out.push('TCGplayer: preço de Near Mint; o estado escolhido muda só o link.');
  if (lang === 'pt' || lang === 'en') out.push('MYP Cards: todos os estados e idiomas juntos.');
  return out;
}

function AboutData({ open, onToggle, card, lang, photoTag }: { open: boolean; onToggle: () => void; card: LookupCard; lang: LookupLang; photoTag?: string }) {
  return (
    <View>
      <Pressable
        onPress={onToggle}
        role="button"
        aria-expanded={open}
        accessibilityLabel="Sobre os dados"
        style={(s) => {
          const { pressed, hovered } = s as PressState;
          return [styles.aboutHead, hovered && { backgroundColor: semantic.hover.onLight }, pressed && { opacity: 0.7 }];
        }}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
        <Text style={styles.aboutTitle}>Sobre os dados</Text>
      </Pressable>
      {open ? (
        <View style={styles.aboutBody}>
          {aboutLines(card, lang, photoTag).map((t) => (
            <Text key={t} style={styles.detail}>
              {t}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type SheetProps = Omit<BodyProps, 'width' | 'focusOnMount'> & { onClose: () => void };

/** Folha da carta no celular: uma camada da própria tela, que entra em 140 ms e fecha pelo voltar do Android. */
export function LookupSheet({ onClose, ...body }: SheetProps) {
  const L = useLayout();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [enter] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: reduceMotion ? 0 : ENTER_MS, useNativeDriver: NATIVE_DRIVER }).start();
  }, [enter, reduceMotion]);

  useEffect(() => {
    if (WEB) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 32, 0] });
  return (
    <View style={styles.layer}>
      {/* View e não Pressable: na web o fundo não pode entrar no Tab. */}
      <View style={styles.backdrop} aria-hidden onStartShouldSetResponder={() => true} onResponderRelease={onClose} />
      <Animated.View
        role="dialog"
        aria-modal
        aria-label={body.card.name}
        onAccessibilityEscape={onClose}
        // Na web, o Tab dá a volta dentro da folha; o Esc e o foco de volta ficam com a tela.
        {...TAB_INSIDE}
        style={[styles.sheet, { maxHeight: L.height * 0.94 - insets.top, paddingBottom: insets.bottom + space.lg, opacity: enter, transform: [{ translateY }] }]}>
        <View style={styles.sheetHead}>
          <View style={styles.grabber} aria-hidden />
          <View style={styles.closeBox}>
            <IconButton icon="close" label="Fechar" onPress={onClose} color={colors.textMuted} />
          </View>
        </View>
        {/* A chave volta a rolagem ao começo ao trocar de versão. */}
        <ScrollView key={body.card.key} style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" bounces={false}>
          <LookupCardBody {...body} width={Math.min(L.width, 720) - L.gutter * 2} focusOnMount />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/** Painel fixo à direita (computador): troca de carta sem abrir nada. */
export function LookupPanel({ empty, width, ...body }: Omit<BodyProps, 'card' | 'width'> & { card: LookupCard | null; empty: ReactNode; width: number }) {
  const { card } = body;
  return (
    <View style={[styles.panel, { width }]} role="complementary" aria-label="Carta escolhida">
      {card ? (
        <ScrollView key={card.key} contentContainerStyle={styles.panelContent}>
          <LookupCardBody {...body} card={card} width={width - space.lg * 2} />
        </ScrollView>
      ) : (
        <View style={styles.panelEmpty}>{empty}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, zIndex: 20, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, ...elevation[2] },
  sheetHead: { height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  closeBox: { position: 'absolute', right: space.xs, top: 0 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  panel: { alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radius.lg },
  panelContent: { padding: space.lg },
  panelEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  body: { gap: space.md },
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  info: { flex: 1, minWidth: 0, gap: space.sm },
  titleBlock: { gap: space.xxs },
  title: { ...typography.title, color: colors.text },
  line: { ...typography.bodyStrong, ...typography.tabular, color: colors.text },
  lineMuted: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  owned: { ...typography.caption, color: colors.textMuted },
  foilGap: { padding: FOIL },
  photo: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  noPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.sm, gap: space.xs },
  noPhotoAbbr: { ...typography.figure, color: colors.text },
  noPhotoNumber: { ...typography.numeric, color: colors.textMuted },
  photoTag: { position: 'absolute', left: 4, bottom: 4 },
  fullRoot: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  fullImage: { width: '100%', height: '100%' },
  fullClose: { position: 'absolute', right: space.sm },
  price: { gap: space.xxs },
  legend: { ...typography.caption, color: colors.textMuted },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.sm },
  money: { ...typography.display, ...typography.tabular, color: semantic.money.fg },
  moneySmall: { ...typography.figure, color: semantic.money.fg },
  priceKind: { ...typography.caption, color: colors.textMuted },
  detail: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  noPrice: { ...typography.bodyStrong, color: colors.textMuted },
  mypMain: { ...typography.bodyStrong, ...typography.tabular, color: colors.text },
  mypSkeleton: { minHeight: typography.caption.lineHeight, justifyContent: 'center' },
  group: { gap: space.sm },
  groupLabel: { ...typography.label, color: colors.textMuted },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // Grafite com texto branco: neutro, sem competir com a ação principal.
  link: { flexGrow: 1, minWidth: '30%', backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.border },
  linkText: { color: colors.text },
  aboutHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: TOUCH, borderRadius: radius.sm },
  aboutTitle: { ...typography.bodyStrong, color: colors.textMuted },
  aboutBody: { gap: space.xs, paddingLeft: space.lg + space.xxs },
});
