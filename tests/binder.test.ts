import {
  customPhysicalMoves,
  customPlaceText,
  dexRange,
  extraSlots,
  fitPocket,
  indexOfEntry,
  isPlaced,
  isPlacedCustom,
  KEYBOARD_MIN,
  pagePocketText,
  physicalLabel,
  physicalMoves,
  physicalPosition,
  regionsIn,
  sheetsNeeded,
  spineSide,
  spreadOf,
  squeezedByKeyboard,
  totalPages,
  volumesNeeded,
  volumesText,
} from '@/lib/binder';

import { binder, settings } from './fixtures';

/** Pokédex completa (1025) em 3×3, frente e verso, 1 espaço por Pokémon. */
const full = settings();
const kanto = settings({ dexTo: 151 });

describe('lado da lombada e dos furos', () => {
  it('frente e verso: pág. 1, 3, 5… à esquerda; pág. 2, 4, 6… à direita', () => {
    expect([0, 1, 2, 3, 4, 5].map((p) => spineSide(true, p))).toEqual(['left', 'right', 'left', 'right', 'left', 'right']);
  });

  it('só frente: sempre à esquerda', () => {
    expect([0, 1, 2, 3].map((p) => spineSide(false, p))).toEqual(['left', 'left', 'left', 'left']);
  });

  it('concorda com a frente e o verso da posição física', () => {
    for (let page = 0; page < 12; page++) {
      const { side } = physicalPosition(full, page * 9);
      expect(spineSide(true, page)).toBe(side === 'frente' ? 'left' : 'right');
    }
  });

  it('com duas páginas abertas, a lombada fica sempre no miolo', () => {
    for (const pages of [2, 3, 6, 7, 114]) {
      for (let page = 0; page < pages; page++) {
        const shown = spreadOf(page, pages);
        if (shown.length === 2) {
          // Verso à esquerda, frente à direita, e as duas páginas seguidas.
          expect(shown[1]).toBe(shown[0] + 1);
          expect(spineSide(true, shown[0])).toBe('right');
          expect(spineSide(true, shown[1])).toBe('left');
        } else if (shown[0] === 0) {
          // Pág. 1 à direita, com o verso da capa à esquerda.
          expect(spineSide(true, 0)).toBe('left');
        } else {
          // A última sozinha, à esquerda da contracapa.
          expect(shown[0]).toBe(pages - 1);
          expect(spineSide(true, shown[0])).toBe('right');
        }
      }
    }
  });
});

describe('fitPocket (a folha cabe na tela)', () => {
  const base = { rows: 3, cols: 3, gap: 8, ratio: 63 / 88, priceHeight: (w: number) => (w < 80 ? 21 : 24), min: 56 };

  it('com altura sobrando, quem manda é a largura', () => {
    expect(fitPocket({ ...base, width: 324, height: 2000 })).toEqual({ width: 102, height: 3 * (142 + 24) + 16, overflow: false });
  });

  it('com pouca altura, o bolso encolhe até caber', () => {
    const fit = fitPocket({ ...base, width: 324, height: 440 });
    expect(fit.width).toBeLessThan(102);
    expect(fit.height).toBeLessThanOrEqual(440);
    expect(fit.overflow).toBe(false);
  });

  it('o bloco de preço menor do bolso pequeno entra na conta', () => {
    const fit = fitPocket({ ...base, width: 324, height: 406 });
    expect(fit.width).toBe(78);
    expect(fit.height).toBeLessThanOrEqual(406);
  });

  it('denso demais: para no mínimo e só então a área da folha rola', () => {
    const fit = fitPocket({ ...base, rows: 8, width: 324, height: 300 });
    expect(fit.width).toBe(56);
    expect(fit.overflow).toBe(true);
  });

  it('nunca passa da largura, nem para chegar ao mínimo', () => {
    expect(fitPocket({ ...base, cols: 6, width: 300, height: 2000 }).width).toBe(43);
  });

  it('respeita o máximo e conta sem preços quando eles estão desligados', () => {
    expect(fitPocket({ ...base, width: 2000, height: 4000, max: 220 }).width).toBe(220);
    const withPrice = fitPocket({ ...base, width: 324, height: 440 }).width;
    expect(fitPocket({ ...base, priceHeight: () => 0, width: 324, height: 440 }).width).toBeGreaterThan(withPrice);
  });
});

describe('squeezedByKeyboard (busca aberta no celular)', () => {
  it('a área encolheu muito, ou o sistema avisou do teclado: a folha guarda a altura', () => {
    expect(squeezedByKeyboard(420, 140, 0)).toBe(true);
    expect(squeezedByKeyboard(420, 420, 280)).toBe(true);
  });

  it('encolheu pouco (aviso ou dica que entrou): vale a medida nova', () => {
    expect(squeezedByKeyboard(420, 376, 0)).toBe(false);
    expect(squeezedByKeyboard(420, 420 - KEYBOARD_MIN, 0)).toBe(false);
  });

  it('a área cresceu: vale a medida nova', () => {
    expect(squeezedByKeyboard(420, 464, 0)).toBe(false);
  });
});

describe('faixa e bolsos livres', () => {
  it('dexRange limita à Pokédex', () => {
    expect(dexRange(full)).toEqual({ from: 1, to: 1025, count: 1025 });
    expect(dexRange(settings({ dexFrom: 0, dexTo: 2000 }))).toEqual({ from: 1, to: 1025, count: 1025 });
    expect(dexRange(settings({ dexFrom: 200, dexTo: 100 }))).toEqual({ from: 200, to: 200, count: 1 });
  });

  it('bolsos livres = o que sobra na última página', () => {
    expect(totalPages(full)).toBe(114);
    expect(extraSlots(full)).toBe(1);
    expect(extraSlots(kanto)).toBe(2);
    expect(extraSlots(settings({ dexTo: 151, rows: 4, cols: 5 }))).toBe(9);
    expect(extraSlots(settings({ dexTo: 153 }))).toBe(0);
  });

  it('regionsIn corta as regiões na faixa do fichário', () => {
    expect(regionsIn(settings({ dexFrom: 100, dexTo: 200 }))).toEqual([
      { id: 'kanto', label: 'Kanto', from: 100, to: 151, count: 52 },
      { id: 'johto', label: 'Johto', from: 152, to: 200, count: 49 },
    ]);
    expect(regionsIn(full)).toHaveLength(9);
  });
});

describe('isPlaced (carta aparece na configuração atual?)', () => {
  it('espaço do Pokémon', () => {
    expect(isPlaced(full, { dex: 25, slot: 0 })).toBe(true);
    expect(isPlaced(full, { dex: 25, slot: 1 })).toBe(false);
    expect(isPlaced(settings({ slotsPerPokemon: 2 }), { dex: 25, slot: 1 })).toBe(true);
    expect(isPlaced(kanto, { dex: 152, slot: 0 })).toBe(false);
    expect(isPlaced(settings({ dexFrom: 26 }), { dex: 25, slot: 0 })).toBe(false);
    expect(isPlaced(full, { dex: 25, slot: -1 })).toBe(false);
  });

  it('bolso livre (dex 0) só enquanto existir na última página', () => {
    expect(isPlaced(kanto, { dex: 0, slot: 0 })).toBe(true);
    expect(isPlaced(kanto, { dex: 0, slot: 1 })).toBe(true);
    expect(isPlaced(kanto, { dex: 0, slot: 2 })).toBe(false);
    expect(isPlaced(full, { dex: 0, slot: 1 })).toBe(false);
  });

  it('fichário livre: só os bolsos das páginas dele', () => {
    const b = binder({ pages: 20 });
    expect(isPlacedCustom(b, { slot: 0 })).toBe(true);
    expect(isPlacedCustom(b, { slot: 179 })).toBe(true);
    expect(isPlacedCustom(b, { slot: 180 })).toBe(false);
    expect(isPlacedCustom(b, { slot: -1 })).toBe(false);
  });
});

describe('physicalPosition (folha, lado e bolso)', () => {
  it('frente e verso', () => {
    expect(physicalPosition(full, 0)).toEqual({ page: 1, sheet: 1, side: 'frente', pocket: 1 });
    expect(physicalPosition(full, 8)).toEqual({ page: 1, sheet: 1, side: 'frente', pocket: 9 });
    expect(physicalPosition(full, 9)).toEqual({ page: 2, sheet: 1, side: 'verso', pocket: 1 });
    expect(physicalPosition(full, 18)).toEqual({ page: 3, sheet: 2, side: 'frente', pocket: 1 });
  });

  it('folhas só de frente', () => {
    expect(physicalPosition(settings({ doubleSided: false }), 9)).toEqual({ page: 2, sheet: 2, side: null, pocket: 1 });
  });

  it('com as folhas informadas: o volume (fichário físico) e a folha dentro dele', () => {
    const s = settings({ sheets: 40 });
    expect(physicalPosition(s, 719)).toEqual({ page: 80, sheet: 40, side: 'verso', pocket: 9, volume: 1, volumeSheet: 40 });
    expect(physicalPosition(s, 720)).toEqual({ page: 81, sheet: 41, side: 'frente', pocket: 1, volume: 2, volumeSheet: 1 });
    expect(physicalPosition(settings({ sheets: 0 }), 720)).not.toHaveProperty('volume');
  });

  it('posição corrida da carta do Pokédex', () => {
    expect(indexOfEntry(full, { dex: 25, slot: 0 })).toBe(24);
    expect(indexOfEntry(settings({ dexFrom: 10, slotsPerPokemon: 2 }), { dex: 12, slot: 1 })).toBe(5);
    expect(indexOfEntry(full, { dex: 0, slot: 0 })).toBe(1025);
  });
});

describe('volumes e rótulo', () => {
  it('Pokédex completa em 3×3 frente e verso: 57 folhas, 2 fichários de 40', () => {
    expect(sheetsNeeded(full)).toBe(57);
    expect(volumesNeeded(full)).toBe(1);
    expect(volumesNeeded(settings({ sheets: 40 }))).toBe(2);
    expect(volumesNeeded(settings({ sheets: 60 }))).toBe(1);
    expect(volumesText(settings({ sheets: 40 }))).toBe('Cabe em 2 fichários de 40 folhas');
    expect(volumesText(settings({ sheets: 60 }))).toBeUndefined();
    expect(volumesText(full)).toBeUndefined();
  });

  it('physicalLabel', () => {
    const s = settings({ sheets: 40 });
    expect(physicalLabel(physicalPosition(s, 720), 2)).toBe('Fichário 2 · folha 1 (frente) · bolso 1');
    expect(physicalLabel(physicalPosition(s, 720))).toBe('Pág. 81 · folha 41 (frente) · bolso 1');
    expect(physicalLabel(physicalPosition(full, 720), 2)).toBe('Pág. 81 · folha 41 (frente) · bolso 1');
    expect(physicalLabel(physicalPosition(settings({ doubleSided: false }), 9))).toBe('Pág. 2 · bolso 1');
  });
});

describe('physicalMoves (aviso antes de salvar a configuração)', () => {
  const card = (dex: number, slot = 0, binderId?: string) => ({ dex, slot, binderId });

  it('conta as cartas que mudam de lugar e ignora as de fichários livres e as que já estavam fora', () => {
    const entries = [card(1), card(10), card(0), card(5, 0, 'b1'), card(25, 1)];
    // 4×4: o #1 fica no bolso 1; o #10 sai do verso da folha 1 e vai para o bolso 10; o bolso livre muda de folha.
    expect(physicalMoves(full, settings({ rows: 4, cols: 4 }), entries)).toEqual({ moved: 2, hidden: 0, shown: 0 });
    expect(physicalMoves(full, full, entries)).toEqual({ moved: 0, hidden: 0, shown: 0 });
  });

  it('cartas que saem da faixa ficam de fora; as que voltam para a faixa contam à parte', () => {
    expect(physicalMoves(full, kanto, [card(1), card(151), card(200)])).toEqual({ moved: 0, hidden: 1, shown: 0 });
    expect(physicalMoves(kanto, full, [card(1), card(151), card(200)])).toEqual({ moved: 0, hidden: 0, shown: 1 });
    // Já fora (o #200 em Kanto) e só a grade muda: não é efeito desta mudança.
    expect(physicalMoves(kanto, settings({ dexTo: 151, rows: 4, cols: 5 }), [card(200)])).toEqual({ moved: 0, hidden: 0, shown: 0 });
  });

  it('o volume só conta quando as duas configurações informam as folhas', () => {
    const entries = [card(1), card(721)];
    expect(physicalMoves(settings({ sheets: 60 }), settings({ sheets: 40 }), entries)).toEqual({ moved: 1, hidden: 0, shown: 0 });
    expect(physicalMoves(full, settings({ sheets: 40 }), entries)).toEqual({ moved: 0, hidden: 0, shown: 0 });
  });

  it('fichário livre: menos páginas deixam as do fim de fora; outra grade muda de lugar', () => {
    const before = binder({ pages: 20 });
    const entries = [
      { binderId: 'b1', slot: 0 },
      { binderId: 'b1', slot: 9 },
      { binderId: 'b1', slot: 135 },
      { binderId: 'b2', slot: 0 },
    ];
    expect(customPhysicalMoves(before, { ...before, pages: 10 }, entries)).toEqual({ moved: 0, hidden: 1, shown: 0 });
    expect(customPhysicalMoves(before, { ...before, rows: 4 }, entries)).toEqual({ moved: 2, hidden: 0, shown: 0 });
    // Aumentar de novo: a carta de fora volta a ter bolso.
    expect(customPhysicalMoves({ ...before, pages: 10 }, before, entries)).toEqual({ moved: 0, hidden: 0, shown: 1 });
  });
});

describe('texto do lugar (bolso na página e nº corrido)', () => {
  it('bolso é a posição na página; o fichário livre mostra também o nº corrido', () => {
    const b = binder({ rows: 4, cols: 5, pages: 10 });
    expect(pagePocketText(b, 24)).toBe('pág. 2, bolso 5');
    expect(pagePocketText(full, 0)).toBe('pág. 1, bolso 1');
    expect(customPlaceText(b, 24)).toBe('pág. 2, bolso 5 · nº 25');
    expect(customPlaceText(b, 19)).toBe('pág. 1, bolso 20 · nº 20');
  });
});
