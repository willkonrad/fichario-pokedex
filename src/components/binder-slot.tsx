import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type PressableStateCallbackType, type ViewStyle } from 'react-native';

import { CardImage } from '@/components/card-image';
import { NATIVE_DRIVER, useReducedMotion } from '@/components/motion';
import { formatDex, getSpecies, spriteUrl } from '@/data/pokedex';
import { valueMark } from '@/lib/copy';
import { formatBRL, formatCompact } from '@/lib/format';
import { mypPtImage } from '@/lib/myp-api';
import { VARIANTS, type Entry } from '@/lib/types';
import { pricePending, valuation } from '@/lib/valuation';
import { binderColors as B, CARD_RATIO, radius, semantic, typography } from '@/theme';

const WEB = Platform.OS === 'web';
/** Sem o contorno de foco do navegador no link do bolso (o foco aparece no anel do próprio bolso). */
const NO_OUTLINE = WEB ? ({ outlineWidth: 0, outlineStyle: 'none' } as unknown as ViewStyle) : null;

/** O texto do bolso cresce com a fonte do sistema até 1,3× (acima disso, o preço e o nome seriam cortados). */
export const POCKET_FONT_SCALE = 1.3;

/** Variações que são especiais de verdade (borda amarela); holo e reverse ganham só o selo de canto. */
const SPECIAL_VARIANTS = new Set<string>(['firstEdition', 'shadowless', 'pokeball', 'masterball', 'wPromo', 'staff']);
/** Raridades altas (TCGdex em inglês e em português): Illustration, Ultra, Hyper, Secret, Shiny e Rare Holo Star. */
const HIGH_RARITY = /illustration|ilustra|\bultra\b|hyper|hiper|secret|shiny|brilhante|\bstar\b|estrela|☆/i;
/** Selo de canto da variação (sem borda): ✦ holo, R reverse. */
const CORNER: Partial<Record<string, string>> = { holo: '✦', reverse: 'R' };
const VARIANT_LABEL = Object.fromEntries(VARIANTS.map((v) => [v.id, v.label])) as Record<string, string>;

/** Carta especial de verdade (1ª edição, Shadowless, Poké/Master Ball, selo, staff ou raridade alta): borda amarela. */
export function isSpecialCard(e: Pick<Entry, 'variant' | 'rarity'>) {
  return SPECIAL_VARIANTS.has(e.variant) || (!!e.rarity && HIGH_RARITY.test(e.rarity));
}

const scaleOf = (fontScale: number) => Math.min(Math.max(fontScale, 1), POCKET_FONT_SCALE);

/** Altura reservada para o preço embaixo de cada bolso (vazio ou não), para as linhas ficarem alinhadas. */
export function priceBlockHeight(width: number, fontScale = 1) {
  return Math.ceil((width < 80 ? 17 : 20) * scaleOf(fontScale)) + 4;
}

/** O que o leitor de tela diz do preço da carta (a cápsula fica escondida dele). */
function priceSpeech(entry: Entry) {
  const v = valuation(entry);
  if (v.value == null) return pricePending(entry) ? 'buscando preço' : 'sem preço';
  const mark = valueMark(v);
  return `${v.basis === 'manual' ? 'Meu valor' : 'valor'} ${formatBRL(v.value)}${mark.mark === '≈' ? ', aproximado' : ''}`;
}

/** Rótulo do bolso com carta (A3): nome, coleção, variação, estado, preço, bolso e destaque. */
function cardLabel(entry: Entry, { pocket, showPrices, highlighted }: { pocket?: number; showPrices: boolean; highlighted?: boolean }) {
  const variant = entry.variant !== 'normal' ? [VARIANT_LABEL[entry.variant], entry.variantNote?.trim()].filter(Boolean).join(' ') : '';
  return [
    entry.cardName,
    entry.setName,
    variant,
    `estado ${entry.condition}`,
    showPrices ? priceSpeech(entry) : '',
    pocket != null ? `bolso nº ${pocket}` : '',
    highlighted ? 'destacado' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

/**
 * Um bolso da página do fichário (folha escura): a carta numa capa plástica, ou o Pokémon/número do bolso quando
 * vazio. Na web, com `href`, o bolso é um link de verdade (Ctrl+clique abre noutra aba). No celular, o toque longo
 * (`onLongPress`) espia a carta.
 */
export function BinderSlot({
  dex,
  pocket,
  width,
  entry,
  highlighted,
  showPrices = true,
  free = false,
  onPress,
  href,
  onLongPress,
}: {
  /** Fichário Pokédex: Pokémon deste espaço (mostra o sprite quando vazio). */
  dex?: number;
  /**
   * Fichário livre: nº corrido do bolso no fichário (1, 2… até o último), mostrado no canto e lido como "bolso nº 25"
   * (o "bolso 5" dos outros textos é a posição na página). Omitido = não mostra.
   */
  pocket?: number;
  width: number;
  entry?: Entry;
  highlighted?: boolean;
  /** Reserva o espaço e mostra o preço embaixo da carta. */
  showPrices?: boolean;
  /** Bolso livre do fichário Pokédex (sobra da última página, para cartas especiais). */
  free?: boolean;
  onPress: () => void;
  /** Endereço do toque (na web vira <a href>; o toque no celular continua em `onPress`). */
  href?: Href;
  onLongPress?: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  const height = Math.floor(width / CARD_RATIO);
  const small = width < 80;
  const tiny = width < 66;
  const scale = scaleOf(fontScale);
  const species = dex ? getSpecies(dex) : undefined;

  // Borda especial só depois de a imagem aparecer (senão o bolso fica uma moldura vazia enquanto carrega). A chave é a
  // da imagem, não a da versão: trocar só a variação não recarrega a imagem (o onLoad não viria de novo).
  const imageKey = entry ? [entry.id, entry.cardId, entry.image, entry.imageUrl, entry.stampPhoto, mypPtImage(entry)].join('|') : '';
  const [loadedKey, setLoadedKey] = useState('');
  const special = !!entry && isSpecialCard(entry) && loadedKey === imageKey;

  // Carta recém-colocada entra com um leve "assentar" (desligado com "reduzir movimento").
  const reduceMotion = useReducedMotion();
  const [enter] = useState(() => new Animated.Value(1));
  const prevCard = useRef(entry?.cardId);
  useEffect(() => {
    const prev = prevCard.current;
    prevCard.current = entry?.cardId;
    if (prev || !entry?.cardId || reduceMotion) return;
    enter.setValue(0.9);
    Animated.spring(enter, { toValue: 1, speed: 16, bounciness: 7, useNativeDriver: NATIVE_DRIVER }).start();
  }, [entry?.cardId, reduceMotion, enter]);

  const label = entry
    ? cardLabel(entry, { pocket, showPrices, highlighted })
    : [
        free ? 'Bolso livre para carta especial' : dex ? `${formatDex(dex)} ${species?.name ?? ''}` : pocket != null ? `Bolso nº ${pocket}` : 'Bolso',
        'vazio, escolher carta',
        highlighted ? 'destacado' : '',
      ]
        .filter(Boolean)
        .join(', ');

  const visual = ({ pressed, hovered, focused }: PressState) => {
    const frame = [
      styles.pocket,
      { width, height, padding: small ? 2 : 3 },
      !entry && styles.empty,
      !entry && !dex && styles.dashed,
      free && !entry && styles.free,
      special && styles.special,
      hovered && !highlighted && styles.hover,
      highlighted && styles.highlight,
      focused && styles.focus,
      pressed && styles.pressed,
      { transform: [{ scale: enter }, { translateY: hovered && !pressed ? -2 : 0 }] },
    ];
    let inner: ReactNode;
    if (entry) {
      const corner = CORNER[entry.variant];
      inner = (
        <>
          <View style={styles.card}>
            <CardImage
              image={entry.image}
              imageUrl={entry.imageUrl}
              cardId={entry.lang === 'ja' ? undefined : entry.cardId}
              localId={entry.localId}
              label={entry.cardName}
              dex={entry.dex || undefined}
              compact
              dark
              stampKeys={entry.stampKeys}
              photo={entry.stampPhoto}
              ptImage={mypPtImage(entry)}
              recyclingKey={entry.id}
              onLoad={() => setLoadedKey(imageKey)}
            />
          </View>
          {/* Brilho da capa plástica. */}
          <View style={styles.sheen} />
          {corner ? (
            <View style={[styles.corner, small && styles.cornerSmall]}>
              <Text style={styles.cornerText} maxFontSizeMultiplier={1}>
                {corner}
              </Text>
            </View>
          ) : null}
        </>
      );
    } else if (dex) {
      // Espaço vazio do Pokédex (H3): número no canto, arte do Pokémon e o nome legíveis.
      inner = (
        <>
          <Text style={[styles.dexNumber, { fontSize: small ? 10 : 11 }]} maxFontSizeMultiplier={POCKET_FONT_SCALE}>
            {formatDex(dex)}
          </Text>
          <Image source={spriteUrl(dex)} style={[styles.sprite, { width: width * 0.92, height: width * 0.92 }]} contentFit="contain" cachePolicy="memory-disk" />
          <View style={styles.names}>
            <Text style={[styles.name, { fontSize: small ? 10 : 12 }]} numberOfLines={1} maxFontSizeMultiplier={POCKET_FONT_SCALE}>
              {species?.name}
            </Text>
            {tiny ? null : (
              <Text style={styles.sub} numberOfLines={1} maxFontSizeMultiplier={POCKET_FONT_SCALE}>
                {species?.ja}
              </Text>
            )}
          </View>
        </>
      );
    } else {
      inner = (
        <>
          {pocket != null ? (
            <Text style={[styles.dexNumber, styles.pocketNumber, { fontSize: small ? 10 : 11 }]} maxFontSizeMultiplier={POCKET_FONT_SCALE}>
              {pocket}
            </Text>
          ) : null}
          <Ionicons name={free ? 'star-outline' : 'add'} size={small ? 18 : 24} color={free ? B.special : B.textFaint} />
          {free && !tiny ? (
            <Text style={styles.freeText} maxFontSizeMultiplier={POCKET_FONT_SCALE}>
              bolso livre
            </Text>
          ) : null}
        </>
      );
    }
    return <Animated.View style={frame}>{inner}</Animated.View>;
  };

  // Estilo achatado: o Link da web (asChild) não aceita estilo em lista nem em função. O foco aparece no anel do
  // bolso (sem o contorno padrão do navegador por cima).
  const hit: ViewStyle = { ...styles.hit, ...NO_OUTLINE, width, height };
  const button =
    WEB && href ? (
      <Link href={href} push asChild>
        <Pressable style={hit} accessibilityLabel={label}>
          {(s) => visual(s as PressState)}
        </Pressable>
      </Link>
    ) : (
      <Pressable style={hit} onPress={onPress} onLongPress={onLongPress} delayLongPress={350} role="button" accessibilityLabel={label}>
        {(s) => visual(s as PressState)}
      </Pressable>
    );

  return (
    <View style={{ width }}>
      {button}
      {showPrices ? (
        <View style={[styles.priceBlock, { minHeight: priceBlockHeight(width, fontScale) }]} aria-hidden>
          {entry ? <SlotPrice entry={entry} small={small} scale={scale} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Valor da carta numa cápsula neutra (o dinheiro não tem cor); ≈ aproximado, ✎ Meu valor. Sem valor: "buscando" ou "sem preço". */
function SlotPrice({ entry, small, scale }: { entry: Entry; small: boolean; scale: number }) {
  const size = small ? 10 : 11;
  const ref = valuation(entry);
  const minHeight = Math.ceil((small ? 15 : 17) * scale);
  if (ref.value == null) {
    // Buscando = o app ainda não buscou o preço desta carta (MYP ou TCGplayer).
    return (
      <View style={[styles.pill, styles.pillPending, { minHeight }]}>
        <Text style={[styles.pendingText, { fontSize: size }]} numberOfLines={1} maxFontSizeMultiplier={POCKET_FONT_SCALE}>
          {pricePending(entry) ? 'buscando…' : 'sem preço'}
        </Text>
      </View>
    );
  }
  const { mark } = valueMark(ref);
  return (
    <View style={[styles.pill, { minHeight }]}>
      <Text style={[styles.priceText, { fontSize: size }]} numberOfLines={1} maxFontSizeMultiplier={POCKET_FONT_SCALE}>
        {mark ? `${mark} ` : ''}
        {/* No bolso pequeno, o "R$" sai (fica no rótulo do bolso para o leitor de tela). */}
        {small ? '' : 'R$ '}
        {formatCompact(ref.value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { borderRadius: radius.sm },
  pocket: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: B.pocket, borderWidth: 1, borderColor: B.pocketBorder },
  card: { flex: 1, borderRadius: radius.card, overflow: 'hidden', backgroundColor: B.page },
  // Faixa diagonal clara, como o reflexo da folha plástica (o mesmo branco translúcido da cápsula, mais fraco).
  sheen: {
    position: 'absolute',
    top: '-40%',
    left: '-30%',
    width: '55%',
    height: '180%',
    backgroundColor: B.priceBg,
    opacity: 0.55,
    transform: [{ rotate: '28deg' }],
    pointerEvents: 'none',
  },
  corner: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: B.page,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerSmall: { top: 3, right: 3, minWidth: 14, height: 14 },
  cornerText: { color: B.text, fontSize: 10, lineHeight: 12, fontWeight: '800' },
  special: { borderColor: B.special, borderWidth: 2 },
  hover: { borderColor: B.textFaint },
  pressed: { opacity: 0.75 },
  // Destaque de busca e "Próxima falta": ciano (diferente do amarelo das cartas especiais).
  highlight: { borderColor: B.highlight, borderWidth: 3 },
  focus: { outlineColor: semantic.focus.onDark, outlineWidth: semantic.focus.width, outlineStyle: 'solid', outlineOffset: semantic.focus.offset },
  empty: { alignItems: 'center', justifyContent: 'center' },
  dashed: { borderStyle: 'dashed' },
  free: { borderColor: B.special, gap: 4 },
  freeText: { color: B.textMuted, fontSize: 11, fontWeight: '700' },
  dexNumber: { position: 'absolute', top: 4, right: 5, color: B.textFaint, fontWeight: '600', ...typography.tabular },
  pocketNumber: { top: 5 },
  sprite: { opacity: 0.5, marginTop: -6 },
  names: { position: 'absolute', left: 2, right: 2, bottom: 5, alignItems: 'center' },
  name: { color: B.textMuted, fontWeight: '700' },
  sub: { color: B.textFaint, fontSize: 10, marginTop: 1 },
  priceBlock: { paddingTop: 3 },
  pill: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: B.priceBg },
  pillPending: { backgroundColor: 'transparent' },
  pendingText: { color: B.textFaint, fontStyle: 'italic' },
  priceText: { color: B.priceFg, fontWeight: '700', includeFontPadding: false, ...typography.tabular },
});
