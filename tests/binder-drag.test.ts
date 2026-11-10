// Arrastar cartas nos fichários livres: as contas do gesto e o caminho do dedo (levantar, andar, soltar, virar a página).
import type { GestureResponderEvent, ViewInstance } from 'react-native';

import { CardDragController, type CardDragOptions, type LiftedCard } from '@/components/binder-drag';
import {
  AUTO_SCROLL_MAX,
  autoScrollStep,
  dropOutcome,
  edgeFlipDirection,
  FLIP_HOLD_MS,
  movedEnough,
  pocketAt,
  type PocketRect,
} from '@/lib/binder-drag';
import type { Entry } from '@/lib/types';

/** Duas colunas e duas linhas de bolsos 100 × 140, com vão de 8. */
const GRID: PocketRect[] = [
  { slot: 0, x: 0, y: 0, width: 100, height: 140 },
  { slot: 1, x: 108, y: 0, width: 100, height: 140 },
  { slot: 2, x: 0, y: 148, width: 100, height: 140 },
  { slot: 3, x: 108, y: 148, width: 100, height: 140 },
];

describe('movedEnough', () => {
  it('menos de 8 px é "segurou sem mexer"', () => {
    expect(movedEnough(4, 5)).toBe(false);
    expect(movedEnough(0, 7.9)).toBe(false);
  });

  it('8 px ou mais é arraste, em qualquer direção', () => {
    expect(movedEnough(8, 0)).toBe(true);
    expect(movedEnough(-6, 6)).toBe(true);
  });
});

describe('pocketAt', () => {
  it('acha o bolso sob o dedo', () => {
    expect(pocketAt(GRID, 50, 70)).toBe(0);
    expect(pocketAt(GRID, 150, 200)).toBe(3);
  });

  it('no vão, vale o bolso mais perto, até o meio', () => {
    expect(pocketAt(GRID, 102, 70, 4)).toBe(0);
    expect(pocketAt(GRID, 106, 70, 4)).toBe(1);
    expect(pocketAt(GRID, 50, 142, 4)).toBe(0);
    expect(pocketAt(GRID, 50, 146, 4)).toBe(2);
  });

  it('sem tolerância, o vão não é bolso', () => {
    expect(pocketAt(GRID, 104, 70)).toBeNull();
  });

  it('fora da folha, além do meio do vão, não há bolso', () => {
    expect(pocketAt(GRID, -5, 70, 4)).toBeNull();
    expect(pocketAt(GRID, 50, 300, 4)).toBeNull();
    expect(pocketAt([], 50, 70, 4)).toBeNull();
  });
});

describe('autoScrollStep', () => {
  it('no meio da área, a folha fica parada', () => {
    expect(autoScrollStep(300, 100, 500)).toBe(0);
  });

  it('perto de cima sobe, perto de baixo desce', () => {
    expect(autoScrollStep(120, 100, 500)).toBeLessThan(0);
    expect(autoScrollStep(480, 100, 500)).toBeGreaterThan(0);
  });

  it('mais perto da borda, mais rápido; fora da área, na velocidade máxima', () => {
    expect(Math.abs(autoScrollStep(105, 100, 500))).toBeGreaterThan(Math.abs(autoScrollStep(160, 100, 500)));
    expect(autoScrollStep(40, 100, 500)).toBe(-AUTO_SCROLL_MAX);
    expect(autoScrollStep(700, 100, 500)).toBe(AUTO_SCROLL_MAX);
  });

  it('numa área baixa sobra um meio parado, e sem área não rola', () => {
    expect(autoScrollStep(150, 100, 200)).toBe(0);
    expect(autoScrollStep(100, 100, 100)).toBe(0);
  });
});

describe('edgeFlipDirection', () => {
  it('perto das bordas da folha, indica o lado', () => {
    expect(edgeFlipDirection(30, 16, 344)).toBe(-1);
    expect(edgeFlipDirection(330, 16, 344)).toBe(1);
  });

  it('vale também um pouco para fora da folha', () => {
    expect(edgeFlipDirection(0, 16, 344)).toBe(-1);
    expect(edgeFlipDirection(360, 16, 344)).toBe(1);
  });

  it('no meio da folha ou longe dela, nada', () => {
    expect(edgeFlipDirection(180, 16, 344)).toBe(0);
    expect(edgeFlipDirection(500, 16, 344)).toBe(0);
  });
});

describe('dropOutcome', () => {
  it('sem mexer, espia a carta, mesmo sobre outro bolso', () => {
    expect(dropOutcome(false, 3, null)).toBe('peek');
    expect(dropOutcome(false, 3, 4)).toBe('peek');
  });

  it('no próprio bolso ou fora dos bolsos, volta', () => {
    expect(dropOutcome(true, 3, 3)).toBe('cancel');
    expect(dropOutcome(true, 3, null)).toBe('cancel');
  });

  it('em outro bolso, muda de lugar', () => {
    expect(dropOutcome(true, 3, 4)).toBe('move');
    expect(dropOutcome(true, 0, 1)).toBe('move');
  });
});

describe('CardDragController', () => {
  const ENTRY = { id: 'b1:0', cardName: 'Gengar' } as Entry;
  const CARD: LiftedCard = { slot: 0, entry: ENTRY, width: 100, height: 140 };

  const event = (pageX: number, pageY: number) => ({ nativeEvent: { pageX, pageY } }) as GestureResponderEvent;
  const node = (r: Partial<PocketRect> = {}) =>
    ({
      measure: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => cb(0, 0, r.width ?? 0, r.height ?? 0, r.x ?? 0, r.y ?? 0),
    }) as unknown as ViewInstance;

  function setup(overrides: Partial<CardDragOptions> = {}, rects: PocketRect[] = GRID) {
    const onDrop = jest.fn((_entry: Entry, _slot: number) => Promise.resolve());
    const onPeek = jest.fn();
    const onFlip = jest.fn();
    const onLifted = jest.fn();
    const drag = new CardDragController(onLifted);
    drag.configure({ gap: 8, sheetPad: 0, maxScroll: 0, canFlip: () => true, onFlip, onDrop, onPeek, reduceMotion: true, ...overrides });
    const unregister = rects.map((r) => drag.register(r.slot, node(r)));
    drag.setRoot(node());
    return { drag, onDrop, onPeek, onFlip, onLifted, unregister };
  }

  /** Levanta a carta do bolso 0 e passa o toque para a tela, como no primeiro movimento do dedo. */
  function grab(drag: CardDragController) {
    drag.lift(CARD, event(50, 70));
    expect(drag.rootProps.onMoveShouldSetResponderCapture()).toBe(true);
  }

  it('sem carta levantada, a tela não pega o toque (folhear e toque seguem normais)', () => {
    const { drag } = setup();
    expect(drag.rootProps.onMoveShouldSetResponderCapture()).toBe(false);
    expect(drag.rootProps.onStartShouldSetResponderCapture()).toBe(false);
  });

  it('segurou e soltou sem mexer: abre a prévia e não grava nada', () => {
    const { drag, onDrop, onPeek, onLifted } = setup();
    drag.lift(CARD, event(50, 70));
    expect(onLifted).toHaveBeenLastCalledWith(CARD);
    drag.pressOut(event(52, 72));
    expect(onPeek).toHaveBeenCalledWith(ENTRY);
    expect(onDrop).not.toHaveBeenCalled();
    expect(onLifted).toHaveBeenLastCalledWith(null);
  });

  it('escorregou antes do toque longo e soltou parado: é a prévia, nunca uma troca', () => {
    const { drag, onDrop, onPeek } = setup();
    drag.lift(CARD, event(96, 70));
    drag.pressOut(event(105, 70));
    expect(onPeek).toHaveBeenCalledWith(ENTRY);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('gesto cortado com a carta ainda no bolso (sem coordenadas): ela só volta', () => {
    const { drag, onDrop, onPeek, onLifted } = setup();
    drag.lift(CARD, event(50, 70));
    drag.pressOut({ nativeEvent: {} } as GestureResponderEvent);
    expect(onPeek).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(onLifted).toHaveBeenLastCalledWith(null);
  });

  it('a área da folha mudou no meio do arraste: mede de novo e o alvo acompanha', () => {
    const { drag, onDrop } = setup({}, []);
    let shift = 0;
    GRID.forEach((r) => {
      const moving = { measure: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => cb(0, 0, r.width, r.height, r.x, r.y + shift) };
      drag.register(r.slot, moving as unknown as ViewInstance);
    });
    grab(drag);
    // Um aviso empurrou as folhas 44 px: em y 150 agora está o bolso 1 (y 44 a 184), não o 3.
    shift = 44;
    drag.pageChanged();
    drag.rootProps.onResponderMove(event(150, 150));
    drag.rootProps.onResponderRelease(event(150, 150));
    expect(onDrop).toHaveBeenCalledWith(ENTRY, 1);
  });

  it('o bolso perder o toque para a tela não solta a carta', () => {
    const { drag, onPeek } = setup();
    drag.lift(CARD, event(50, 70));
    drag.rootProps.onMoveShouldSetResponderCapture();
    drag.pressOut(event(50, 70));
    expect(onPeek).not.toHaveBeenCalled();
  });

  it('tremeu menos de 8 px depois de pegar o toque: ainda é a prévia', () => {
    const { drag, onPeek, onDrop } = setup();
    grab(drag);
    drag.rootProps.onResponderMove(event(53, 72));
    drag.rootProps.onResponderRelease(event(53, 72));
    expect(onPeek).toHaveBeenCalledWith(ENTRY);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('soltou em outro bolso: move para ele', async () => {
    const { drag, onDrop, onPeek, onLifted } = setup();
    grab(drag);
    drag.rootProps.onResponderMove(event(150, 200));
    drag.rootProps.onResponderRelease(event(150, 200));
    expect(onDrop).toHaveBeenCalledWith(ENTRY, 3);
    expect(onPeek).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(onLifted).toHaveBeenLastCalledWith(null);
  });

  it('andou e voltou ao próprio bolso, ou soltou fora: nada é gravado', () => {
    const { drag, onDrop, onPeek, onLifted } = setup();
    grab(drag);
    drag.rootProps.onResponderMove(event(150, 70));
    drag.rootProps.onResponderMove(event(50, 70));
    drag.rootProps.onResponderRelease(event(50, 70));
    expect(onDrop).not.toHaveBeenCalled();
    expect(onPeek).not.toHaveBeenCalled();
    expect(onLifted).toHaveBeenLastCalledWith(null);

    grab(drag);
    drag.rootProps.onResponderMove(event(800, 900));
    drag.rootProps.onResponderRelease(event(800, 900));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('gesto cortado pelo sistema: a carta volta e nada é gravado', () => {
    const { drag, onDrop, onLifted } = setup();
    grab(drag);
    drag.rootProps.onResponderMove(event(150, 200));
    drag.rootProps.onResponderTerminate();
    expect(onDrop).not.toHaveBeenCalled();
    expect(onLifted).toHaveBeenLastCalledWith(null);
  });

  it('a tela não solta o toque no meio do arraste', () => {
    const { drag } = setup();
    expect(drag.rootProps.onResponderTerminationRequest()).toBe(false);
    expect(drag.rootProps.onResponderGrant()).toBe(true);
  });

  describe('virar a página pela borda', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('dedo parado na borda pelo tempo certo: vira e segue arrastando na página nova', () => {
      const { drag, onDrop, onFlip, unregister } = setup();
      grab(drag);
      drag.rootProps.onResponderMove(event(200, 70));
      jest.advanceTimersByTime(FLIP_HOLD_MS - 1);
      expect(onFlip).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(onFlip).toHaveBeenCalledWith(1);

      // Página nova: os bolsos 0 a 3 saíram e entrou o 4, no lugar do 0.
      unregister.forEach((off) => off());
      drag.register(4, node({ x: 0, y: 0, width: 100, height: 140 }));
      drag.pageChanged();
      drag.rootProps.onResponderMove(event(50, 70));
      drag.rootProps.onResponderRelease(event(50, 70));
      expect(onDrop).toHaveBeenCalledWith(ENTRY, 4);
    });

    it('saiu da borda antes do tempo: não vira', () => {
      const { drag, onFlip } = setup();
      grab(drag);
      drag.rootProps.onResponderMove(event(200, 70));
      jest.advanceTimersByTime(FLIP_HOLD_MS / 2);
      drag.rootProps.onResponderMove(event(100, 70));
      jest.advanceTimersByTime(FLIP_HOLD_MS * 2);
      expect(onFlip).not.toHaveBeenCalled();
      drag.rootProps.onResponderRelease(event(100, 70));
    });

    it('sem página para aquele lado, não vira', () => {
      const { drag, onFlip } = setup({ canFlip: () => false });
      grab(drag);
      drag.rootProps.onResponderMove(event(200, 70));
      jest.advanceTimersByTime(FLIP_HOLD_MS * 2);
      expect(onFlip).not.toHaveBeenCalled();
      drag.rootProps.onResponderRelease(event(200, 70));
    });

    it('segurar sem mexer perto da borda não vira a página', () => {
      const { drag, onFlip } = setup();
      drag.lift(CARD, event(4, 70));
      drag.rootProps.onMoveShouldSetResponderCapture();
      drag.rootProps.onResponderMove(event(5, 70));
      jest.advanceTimersByTime(FLIP_HOLD_MS * 2);
      expect(onFlip).not.toHaveBeenCalled();
      drag.rootProps.onResponderRelease(event(5, 70));
    });
  });

  describe('rolagem automática', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('perto da borda de baixo a folha rola, e o alvo acompanha a rolagem', () => {
      const scrollTo = jest.fn();
      const { drag, onDrop } = setup({ maxScroll: 200 }, [...GRID, { slot: 6, x: 0, y: 460, width: 100, height: 140 }]);
      drag.setStage(node({ x: 0, y: 0, width: 208, height: 400 }));
      drag.setScroller({ scrollTo } as never);
      grab(drag);

      // Dedo a 10 px da borda de baixo: o bolso 6 (y 460) só chega embaixo dele depois de rolar.
      drag.rootProps.onResponderMove(event(50, 390));
      jest.advanceTimersByTime(16 * 12);
      expect(scrollTo).toHaveBeenCalled();
      const last = scrollTo.mock.calls[scrollTo.mock.calls.length - 1][0].y;
      expect(last).toBeGreaterThan(70);
      expect(last).toBeLessThanOrEqual(200);

      drag.rootProps.onResponderRelease(event(50, 390));
      expect(onDrop).toHaveBeenCalledWith(ENTRY, 6);
    });

    it('não passa do fim da rolagem', () => {
      const scrollTo = jest.fn();
      const { drag } = setup({ maxScroll: 30 });
      drag.setStage(node({ x: 0, y: 0, width: 208, height: 400 }));
      drag.setScroller({ scrollTo } as never);
      grab(drag);
      drag.rootProps.onResponderMove(event(50, 395));
      jest.advanceTimersByTime(16 * 40);
      expect(scrollTo.mock.calls[scrollTo.mock.calls.length - 1][0].y).toBe(30);
      drag.rootProps.onResponderRelease(event(50, 200));
    });

    it('com o dedo fora da área da folha, o bolso cortado pela rolagem não é destino: a carta volta', () => {
      const { drag, onDrop, onLifted } = setup({ maxScroll: 200 }, [...GRID, { slot: 6, x: 0, y: 460, width: 100, height: 140 }]);
      drag.setStage(node({ x: 0, y: 0, width: 208, height: 400 }));
      drag.setScroller({ scrollTo: jest.fn() } as never);
      grab(drag);
      drag.rootProps.onResponderMove(event(50, 470));
      drag.rootProps.onResponderRelease(event(50, 470));
      expect(onDrop).not.toHaveBeenCalled();
      expect(onLifted).toHaveBeenLastCalledWith(null);
    });
  });

  describe('guardas da área das folhas, na web', () => {
    /** O controlador carregado como na web (o `Platform.OS` é lido ao abrir o módulo). */
    function webDrag() {
      let Controller!: typeof CardDragController;
      jest.isolateModules(() => {
        jest.requireActual<typeof import('react-native')>('react-native').Platform.OS = 'web';
        Controller = jest.requireActual<typeof import('@/components/binder-drag')>('@/components/binder-drag').CardDragController;
      });
      const drag = new Controller(jest.fn());
      drag.configure({ gap: 8, sheetPad: 0, maxScroll: 0, canFlip: () => true, onFlip: jest.fn(), onDrop: () => Promise.resolve(), onPeek: jest.fn(), reduceMotion: true });
      drag.setRoot(node());
      const handlers = new Map<string, (e: Event) => void>();
      const element = {
        addEventListener: (type: string, fn: (e: Event) => void) => handlers.set(type, fn),
        removeEventListener: (type: string) => handlers.delete(type),
      };
      drag.setViewport(element as unknown as ViewInstance);
      return { drag, handlers };
    }
    const domEvent = () => ({ preventDefault: jest.fn(), stopPropagation: jest.fn() });
    const fire = (handler: ((e: Event) => void) | undefined) => {
      const e = domEvent();
      handler?.(e as unknown as Event);
      return e;
    };

    it('o dragstart não sobe até o document, onde derrubaria o arraste', () => {
      const { handlers } = webDrag();
      const e = fire(handlers.get('dragstart'));
      expect(e.preventDefault).toHaveBeenCalled();
      expect(e.stopPropagation).toHaveBeenCalled();
    });

    it('a roda do mouse só é barrada com a carta na mão', () => {
      const { drag, handlers } = webDrag();
      expect(fire(handlers.get('wheel')).preventDefault).not.toHaveBeenCalled();
      drag.lift(CARD, event(50, 70));
      expect(fire(handlers.get('wheel')).preventDefault).toHaveBeenCalled();
    });

    it('sem a área, os guardas saem', () => {
      const { drag, handlers } = webDrag();
      drag.setViewport(null);
      expect(handlers.size).toBe(0);
    });
  });
});
