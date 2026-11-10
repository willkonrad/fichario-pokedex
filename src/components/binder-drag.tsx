import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type ViewInstance,
} from 'react-native';

import { CardImage, POCKET_FONT_SCALE } from '@/components/card-image';
import { NATIVE_DRIVER } from '@/components/motion';
import { autoScrollStep, dropOutcome, edgeFlipDirection, FLIP_HOLD_MS, movedEnough, pocketAt, type PocketRect } from '@/lib/binder-drag';
import { entryImageUrl } from '@/lib/catalog';
import { mypPtImage } from '@/lib/myp-api';
import type { Entry } from '@/lib/types';
import { binderColors as B, elevation, radius, semantic } from '@/theme';

const WEB = Platform.OS === 'web';
/** Quanto a carta cresce ao levantar. */
const LIFT_SCALE = 1.08;
const LIFT_MS = 120;
const RETURN_MS = 160;
/** Intervalo da rolagem automática (com timer: num painel oculto, o requestAnimationFrame para). */
const TICK_MS = 16;

/** A carta levantada: o bolso de onde saiu e o tamanho dele. */
export type LiftedCard = { slot: number; entry: Entry; width: number; height: number };

export type CardDragOptions = {
  /** Vão entre os bolsos. */
  gap: number;
  /** Quanto a folha passa dos bolsos, de cada lado (margem e lombada). */
  sheetPad: number;
  /** Quanto a área da folha rola (0: ela cabe e não rola). */
  maxScroll: number;
  canFlip: (dir: 1 | -1) => boolean;
  onFlip: (dir: 1 | -1) => void;
  onDrop: (entry: Entry, slot: number) => Promise<void>;
  onPeek: (entry: Entry) => void;
  reduceMotion: boolean;
};

/** O que a página dá ao bolso para ele entrar no arraste. */
export type SlotDrag = Pick<CardDragController, 'register' | 'lift' | 'pressOut'>;

/**
 * O gesto inteiro fica aqui, fora do React: a posição anda por valores animados e o bolso sob o dedo só muda o destaque,
 * sem desenhar a página de novo. A tela só redesenha ao levantar e ao soltar (`onLifted`).
 *
 * As medidas usam `measure` (pageX/pageY), e não `measureInWindow`: no Android, o `measureInWindow` pode vir deslocado
 * pela barra de status em relação ao toque.
 */
export class CardDragController {
  readonly position = new Animated.ValueXY();
  readonly scale = new Animated.Value(1);
  readonly targetX = new Animated.Value(0);
  readonly targetY = new Animated.Value(0);
  readonly targetOpacity = new Animated.Value(0);

  private readonly onLifted: (card: LiftedCard | null) => void;
  private options: CardDragOptions | null = null;
  /** 'held': levantou, mas o toque ainda é do bolso; 'dragging': o toque já é da tela. */
  private phase: 'idle' | 'held' | 'dragging' = 'idle';
  private card: LiftedCard | null = null;
  private shown = false;
  private moved = false;
  private over: number | null = null;

  private readonly pockets = new Map<number, ViewInstance>();
  private rects: PocketRect[] = [];
  /** Cada medição tem um número: resposta de uma medição antiga é ignorada. */
  private generation = 0;

  private root: ViewInstance | null = null;
  private stage: ViewInstance | null = null;
  private scroller: ScrollViewInstance | null = null;
  private unguard: (() => void) | undefined;

  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private grabX = 0;
  private grabY = 0;
  private originX = 0;
  private originY = 0;
  private stageTop = 0;
  private stageBottom = 0;
  private scrollY = 0;
  /** Rolagem na hora da medição: o que rolou depois disso é somado ao dedo. */
  private measuredScroll = 0;

  private flipDir: -1 | 0 | 1 = 0;
  private flipTimer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor(onLifted: (card: LiftedCard | null) => void) {
    this.onLifted = onLifted;
  }

  configure(options: CardDragOptions | null) {
    this.options = options;
  }

  /** Página nova ou área da folha diferente durante o arraste: os bolsos à vista são outros, ou estão em outro lugar. */
  pageChanged() {
    if (this.phase !== 'idle') this.measureAll();
  }

  dispose() {
    this.stopTimers();
    this.generation++;
    this.phase = 'idle';
    this.card = null;
    this.shown = false;
  }

  // ----- Ligações com a tela -----

  /** Bolso à vista (com carta ou vazio, que também é destino). Devolve a função que o tira da lista. */
  register = (slot: number, node: ViewInstance) => {
    this.pockets.set(slot, node);
    return () => {
      if (this.pockets.get(slot) === node) this.pockets.delete(slot);
    };
  };

  setRoot = (node: ViewInstance | null) => {
    this.root = node;
  };

  setStage = (node: ViewInstance | null) => {
    this.stage = node;
  };

  setScroller = (node: ScrollViewInstance | null) => {
    this.scroller = node;
  };

  /**
   * Na web, sobre as folhas: o navegador não arrasta link nem imagem por conta própria, e o `dragstart` não sobe até o
   * document (lá, o react-native-web o trata como cancelamento e a carta voltaria). Com a carta na mão, não rola a tela,
   * nem com a roda, nem abre o menu. `touchmove` e `wheel` precisam existir antes do gesto, para poderem ser cancelados.
   */
  setViewport = (node: ViewInstance | null) => {
    this.unguard?.();
    this.unguard = undefined;
    if (!WEB || !node) return;
    const element = node as unknown as HTMLElement;
    const never = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const whileHolding = (e: Event) => {
      if (this.phase !== 'idle') e.preventDefault();
    };
    element.addEventListener('dragstart', never);
    element.addEventListener('contextmenu', whileHolding);
    element.addEventListener('touchmove', whileHolding, { passive: false });
    element.addEventListener('wheel', whileHolding, { passive: false });
    this.unguard = () => {
      element.removeEventListener('dragstart', never);
      element.removeEventListener('contextmenu', whileHolding);
      element.removeEventListener('touchmove', whileHolding);
      element.removeEventListener('wheel', whileHolding);
    };
  };

  /** Rolagem da área da folha. Durante o arraste, quem manda nela é a rolagem automática. */
  onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (this.phase === 'idle') this.scrollY = e.nativeEvent.contentOffset.y;
  };

  /**
   * Na raiz da tela, acima do folhear: com a carta levantada, a raiz pega o toque na captura, antes de todos. Devolver
   * `true` na concessão impede o Android de entregar o toque à rolagem nativa.
   */
  readonly rootProps = {
    onStartShouldSetResponderCapture: () => this.claim(),
    onMoveShouldSetResponderCapture: () => this.claim(),
    onResponderGrant: () => true,
    onResponderMove: (e: GestureResponderEvent) => this.move(e.nativeEvent.pageX, e.nativeEvent.pageY),
    onResponderRelease: (e: GestureResponderEvent) => this.release(e.nativeEvent.pageX, e.nativeEvent.pageY),
    onResponderTerminate: () => this.cancel(),
    onResponderTerminationRequest: () => false,
  };

  // ----- O gesto -----

  /** Toque longo no bolso com carta. */
  lift = (card: LiftedCard, e: GestureResponderEvent) => {
    if (!this.options || this.phase !== 'idle' || this.card) return;
    this.phase = 'held';
    this.card = card;
    this.shown = false;
    this.moved = false;
    this.startX = this.lastX = e.nativeEvent.pageX;
    this.startY = this.lastY = e.nativeEvent.pageY;
    this.measureAll();
  };

  /**
   * O bolso perdeu o toque. Se ninguém pegou o gesto, é o dedo saindo sem ter andado desde que levantou: vale a posição
   * guardada (o que escorregou antes do toque longo não é arraste). Sem coordenadas, o sistema cortou o gesto: a carta só volta.
   */
  pressOut = (e: GestureResponderEvent) => {
    if (this.phase !== 'held') return;
    if (Number.isFinite(e.nativeEvent.pageX)) this.release(this.lastX, this.lastY);
    else this.cancel();
  };

  /** Marca aqui, e não na concessão: na web, o bolso perde o toque (`pressOut`) antes de a raiz ganhar. */
  private claim() {
    if (this.phase === 'idle') return false;
    if (this.phase === 'held') {
      this.phase = 'dragging';
      if (this.options?.maxScroll) this.ticker = setInterval(this.tick, TICK_MS);
    }
    return true;
  }

  private measureAll() {
    const run = ++this.generation;
    this.rects = [];
    this.setOver(null);
    this.measuredScroll = this.scrollY;
    const read = (node: ViewInstance | null, done: (x: number, y: number, width: number, height: number) => void) =>
      node?.measure((_x, _y, width, height, pageX, pageY) => {
        if (run === this.generation) done(pageX, pageY, width, height);
      });
    read(this.root, (x, y) => {
      this.originX = x;
      this.originY = y;
    });
    read(this.stage, (_x, y, _width, height) => {
      this.stageTop = y;
      this.stageBottom = y + height;
    });
    let pending = this.pockets.size;
    this.pockets.forEach((node, slot) =>
      read(node, (x, y, width, height) => {
        if (width > 0) this.rects.push({ slot, x, y, width, height });
        if (slot === this.card?.slot) this.showCard(x, y);
        if (--pending === 0) this.refresh();
      }),
    );
  }

  private showCard(x: number, y: number) {
    if (this.shown || !this.card) return;
    this.shown = true;
    // Onde o dedo pegou a carta: ela não pula para baixo dele.
    this.grabX = this.startX - x;
    this.grabY = this.startY - y;
    this.placeCard();
    if (this.options?.reduceMotion) this.scale.setValue(LIFT_SCALE);
    else {
      this.scale.setValue(1);
      Animated.timing(this.scale, { toValue: LIFT_SCALE, duration: LIFT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER }).start();
    }
    this.onLifted(this.card);
  }

  private placeCard() {
    this.position.setValue({ x: this.lastX - this.grabX - this.originX, y: this.lastY - this.grabY - this.originY });
  }

  private move(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.lastX = x;
    this.lastY = y;
    if (!this.moved && movedEnough(x - this.startX, y - this.startY)) this.moved = true;
    if (this.shown) this.placeCard();
    this.refresh();
  }

  private refresh() {
    this.updateTarget();
    this.updateFlip();
  }

  /** Quanto a folha rolou desde a medição. */
  private get scrolled() {
    return this.scrollY - this.measuredScroll;
  }

  private updateTarget() {
    if (!this.card || !this.options) return;
    // Na folha que rola, com o dedo fora da área (sobre a base ou a barra) o que está sob ele é um bolso cortado, invisível.
    const outside = this.options.maxScroll > 0 && (this.lastY < this.stageTop || this.lastY > this.stageBottom);
    const under = this.moved && !outside ? pocketAt(this.rects, this.lastX, this.lastY + this.scrolled, this.options.gap / 2) : null;
    this.setOver(under === this.card.slot ? null : under);
  }

  private setOver(slot: number | null) {
    this.over = slot;
    const rect = slot == null ? undefined : this.rects.find((r) => r.slot === slot);
    if (!rect) {
      this.targetOpacity.setValue(0);
      return;
    }
    this.targetX.setValue(rect.x - this.originX);
    this.targetY.setValue(rect.y - this.scrolled - this.originY);
    this.targetOpacity.setValue(1);
  }

  private updateFlip() {
    const options = this.options;
    if (!options || !this.moved || !this.rects.length) return;
    const pad = options.sheetPad;
    const left = Math.min(...this.rects.map((r) => r.x)) - pad;
    const right = Math.max(...this.rects.map((r) => r.x + r.width)) + pad;
    const edge = edgeFlipDirection(this.lastX, left, right);
    const dir = edge !== 0 && options.canFlip(edge) ? edge : 0;
    if (dir === this.flipDir) return;
    clearTimeout(this.flipTimer);
    this.flipDir = dir;
    if (dir) this.flipTimer = setTimeout(this.flip, FLIP_HOLD_MS);
  }

  private flip = () => {
    const dir = this.flipDir;
    this.flipDir = 0;
    if (!dir || !this.options?.canFlip(dir)) return;
    // Até medir a página nova (`pageChanged`), nenhum bolso é alvo.
    this.generation++;
    this.rects = [];
    this.setOver(null);
    this.options.onFlip(dir);
  };

  private tick = () => {
    if (this.phase !== 'dragging' || !this.moved || !this.options) return;
    const next = Math.max(0, Math.min(this.options.maxScroll, this.scrollY + autoScrollStep(this.lastY, this.stageTop, this.stageBottom)));
    if (next === this.scrollY) return;
    this.scrollY = next;
    this.scroller?.scrollTo({ y: next, animated: false });
    this.updateTarget();
  };

  private release(x: number, y: number) {
    if (this.phase === 'idle' || !this.card) return;
    this.move(x, y);
    this.stopTimers();
    this.phase = 'idle';
    const { entry, slot } = this.card;
    const target = this.over;
    const outcome = dropOutcome(this.moved, slot, target);
    if (outcome === 'peek') {
      this.clear();
      this.options?.onPeek(entry);
    } else if (outcome === 'move' && target != null && this.options) {
      this.setOver(null);
      // A carta flutuante fica até a gravação trocar os bolsos: nada pisca no meio.
      this.options.onDrop(entry, target).finally(() => this.clear());
    } else this.returnCard();
  }

  private cancel() {
    if (this.phase === 'idle') return;
    this.stopTimers();
    this.phase = 'idle';
    this.returnCard();
  }

  /** Volta para o bolso de origem; com ele fora da tela (virou a página), só some. */
  private returnCard() {
    this.setOver(null);
    const rect = this.rects.find((r) => r.slot === this.card?.slot);
    if (!rect || !this.shown || this.options?.reduceMotion) {
      this.clear();
      return;
    }
    const toValue = { x: rect.x - this.originX, y: rect.y - this.scrolled - this.originY };
    Animated.parallel([
      Animated.timing(this.position, { toValue, duration: RETURN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(this.scale, { toValue: 1, duration: RETURN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER }),
    ]).start(() => this.clear());
  }

  private clear() {
    this.stopTimers();
    this.generation++;
    this.phase = 'idle';
    this.card = null;
    this.shown = false;
    this.moved = false;
    this.rects = [];
    this.setOver(null);
    this.onLifted(null);
  }

  private stopTimers() {
    clearTimeout(this.flipTimer);
    clearInterval(this.ticker);
    this.flipDir = 0;
  }
}

/**
 * Arrastar as cartas da página (fichário livre; `null` nos outros). `pageKey`: muda quando os bolsos à vista mudam de
 * página, de lugar ou de tamanho. `lifted`: a carta na mão, ou null (só muda ao levantar e ao soltar).
 */
export function useCardDrag(options: CardDragOptions | null, pageKey: string) {
  const [lifted, setLifted] = useState<LiftedCard | null>(null);
  const [drag] = useState(() => new CardDragController(setLifted));
  useEffect(() => {
    drag.configure(options);
  });
  // Os efeitos dos bolsos novos rodam antes deste: eles já estão na lista.
  useEffect(() => {
    drag.pageChanged();
  }, [drag, pageKey]);
  useEffect(() => () => drag.dispose(), [drag]);
  return { drag, lifted };
}

/** O que flutua durante o arraste, por cima de tudo: o contorno do bolso sob o dedo e a carta. Não recebe toques. */
export function CardDragLayer({ drag, lifted }: { drag: CardDragController; lifted: LiftedCard | null }) {
  if (!lifted) return null;
  const { entry, width, height } = lifted;
  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} aria-hidden>
      <Animated.View style={[styles.target, { width, height, opacity: drag.targetOpacity, transform: [{ translateX: drag.targetX }, { translateY: drag.targetY }] }]} />
      <Animated.View style={[styles.card, { width, height, transform: [...drag.position.getTranslateTransform(), { scale: drag.scale }] }]}>
        <CardImage
          image={entry.image}
          imageUrl={entryImageUrl(entry)}
          cardId={entry.lang === 'ja' ? undefined : entry.cardId}
          localId={entry.localId}
          label={entry.cardName}
          labelMaxScale={POCKET_FONT_SCALE}
          dex={entry.dex || undefined}
          compact
          dark
          stampKeys={entry.stampKeys}
          photo={entry.stampPhoto}
          ptImage={mypPtImage(entry)}
          recyclingKey={entry.id}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 20, pointerEvents: 'none' },
  target: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: radius.sm,
    borderWidth: 3,
    borderColor: semantic.highlight.onSheet,
    backgroundColor: semantic.highlight.soft,
  },
  card: { position: 'absolute', left: 0, top: 0, borderRadius: radius.card, overflow: 'hidden', backgroundColor: B.page, ...elevation[2] },
});
