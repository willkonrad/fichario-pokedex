import {
  activityCounts,
  cardSummaryOf,
  classifyEntryEvents,
  currentEntryOf,
  entryKey,
  isPokedexSwap,
  loadActivity,
  type ActivityItem,
  type CardSummary,
  type EntryEventRow,
} from '@/lib/activity';

import { entry, myp } from './fixtures';

// Fatos crus como o gatilho grava: hora em minutos depois de T0; happened_at = at, salvo quando o teste muda.
const T0 = Date.parse('2026-11-05T15:00:00.000Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();

let seq = 0;
beforeEach(() => {
  seq = 0;
});

type Over = Partial<EntryEventRow> & { done?: number };

function row(entry_id: string, before: CardSummary | null, after: CardSummary | null, min: number, over: Over = {}): EntryEventRow {
  const { done, ...rest } = over;
  const kind = !before ? 'added' : !after ? 'removed' : 'replaced';
  return {
    id: ++seq,
    entry_id,
    op: kind === 'added' ? 'insert' : kind === 'removed' ? 'delete' : 'update',
    kind,
    changed: null,
    before,
    after,
    before_key: before ? entryKey(before) : null,
    after_key: after ? entryKey(after) : null,
    at: iso(min),
    happened_at: iso(done ?? min),
    tx: String(1000 + seq),
    source: 'app',
    ...rest,
  };
}
const added = (id: string, c: CardSummary, min: number, over?: Over) => row(id, null, c, min, over);
const removed = (id: string, c: CardSummary, min: number, over?: Over) => row(id, c, null, min, over);
const replaced = (id: string, from: CardSummary, to: CardSummary, min: number, over?: Over) => row(id, from, to, min, over);

const pikachu: CardSummary = { cardId: 'sv03.5-025', cardName: 'Pikachu', lang: 'pt', variant: 'normal', dex: 25, slot: 0 };
const pikachuHolo: CardSummary = { ...pikachu, variant: 'holo' };
const raichu: CardSummary = { cardId: 'sv03.5-026', cardName: 'Raichu', lang: 'pt', variant: 'normal', dex: 26, slot: 0 };
const charmander: CardSummary = { cardId: 'sv03.5-004', cardName: 'Charmander', lang: 'pt', variant: 'normal', dex: 4, slot: 0 };
const kinds = (items: ActivityItem[]) => items.map((i) => i.kind);
const SEC = 1 / 60;

describe('entryKey (igual à função SQL entry_key)', () => {
  it('cardId|lang|variant|selo, com pt e normal como padrão', () => {
    expect(entryKey({ cardId: 'sv03.5-025' })).toBe('sv03.5-025|pt|normal|');
    expect(entryKey({ cardId: 'x', lang: 'en', variant: 'holo', variantNote: 'Cosmos Holo' })).toBe('x|en|holo|Cosmos Holo');
    // Sempre 4 partes, como o coalesce da SQL.
    expect(entryKey({ cardId: undefined as unknown as string })).toBe('|pt|normal|');
  });

  it('selo sem espaços nas pontas (como o btrim: só espaços)', () => {
    expect(entryKey({ cardId: 'x', variant: 'wPromo', variantNote: '  Pokémon Center ' })).toBe('x|pt|wPromo|Pokémon Center');
    expect(entryKey({ cardId: 'x', variantNote: '   ' })).toBe('x|pt|normal|');
    // O btrim padrão não tira tab nem quebra de linha.
    expect(entryKey({ cardId: 'x', variantNote: '\tA\n' })).toBe('x|pt|normal|\tA\n');
  });

  it('a carta do aparelho e o resumo dela dão a mesma chave', () => {
    const e = entry({ lang: 'en', variant: 'wPromo', variantNote: ' Prize Pack ' });
    expect(entryKey(cardSummaryOf(e))).toBe(entryKey(e));
    expect(entryKey(e)).toBe('sv03.5-025|en|wPromo|Prize Pack');
  });
});

describe('cardSummaryOf (o mesmo resumo do entry_summary)', () => {
  it('campos da carta, imagePt do MYP e nada vazio', () => {
    const base = entry({ binderId: 'b1', slot: 4, stampKeys: ['set-logo'], origin: 'purchase', purchasePrice: 12 });
    const s = cardSummaryOf({ ...base, mypApi: myp(base, { imagePt: 'https://exemplo/pt.png' }), notes: 'não vai' });
    expect(s).toEqual({
      cardId: 'sv03.5-025',
      cardName: 'Pikachu',
      setName: '151',
      setId: 'sv03.5',
      localId: '025',
      lang: 'pt',
      variant: 'normal',
      stampKeys: ['set-logo'],
      imagePt: 'https://exemplo/pt.png',
      condition: 'NM',
      origin: 'purchase',
      purchasePrice: 12,
      binderId: 'b1',
      dex: 25,
      slot: 4,
    });
    expect(Object.values(s).every((v) => v != null)).toBe(true);
  });
});

describe('classifyEntryEvents: um bolso', () => {
  it('adicionada', () => {
    const [i, ...rest] = classifyEntryEvents([added('25-0', pikachu, 0, { done: -1 })]);
    expect(rest).toEqual([]);
    expect(i).toEqual({ id: 'e1', kind: 'added', at: iso(-1), dayOnly: false, source: 'app', entryId: '25-0', card: pikachu });
  });

  it('removida', () => {
    const items = classifyEntryEvents([removed('25-0', pikachu, 0)]);
    expect(items).toMatchObject([{ kind: 'removed', entryId: '25-0', card: pikachu }]);
    expect(items[0].prev).toBeUndefined();
  });

  it('trocada por outra carta', () => {
    const items = classifyEntryEvents([replaced('25-0', pikachu, raichu, 0)]);
    expect(items).toMatchObject([{ kind: 'replaced', card: raichu, prev: pikachu, versionOnly: false }]);
  });

  it('trocada só a versão (mesmo cardId): versionOnly', () => {
    const items = classifyEntryEvents([replaced('25-0', pikachu, pikachuHolo, 0)]);
    expect(items).toMatchObject([{ kind: 'replaced', card: pikachuHolo, prev: pikachu, versionOnly: true }]);
  });

  it('desfazer de adicionar, de remover e de trocar some', () => {
    expect(classifyEntryEvents([added('25-0', pikachu, 0), removed('25-0', pikachu, 5 * SEC)])).toEqual([]);
    expect(classifyEntryEvents([removed('25-0', pikachu, 0), added('25-0', pikachu, 5 * SEC)])).toEqual([]);
    expect(classifyEntryEvents([replaced('25-0', pikachu, raichu, 0), replaced('25-0', raichu, pikachu, 5 * SEC)])).toEqual([]);
  });

  it('digitação do selo em vários envios vira uma troca só, com o selo final', () => {
    const promo = (variantNote?: string): CardSummary => ({ ...pikachu, variant: 'wPromo', ...(variantNote ? { variantNote } : {}) });
    const rows = [
      replaced('25-0', pikachu, promo(), 0),
      replaced('25-0', promo(), promo('Pok'), 0.7),
      replaced('25-0', promo('Pok'), promo('Pokémon'), 1.4),
      replaced('25-0', promo('Pokémon'), promo('Pokémon Center'), 2.1),
    ];
    const items = classifyEntryEvents(rows);
    expect(items).toEqual([
      { id: 'e4', kind: 'replaced', at: iso(2.1), dayOnly: false, source: 'app', entryId: '25-0', card: promo('Pokémon Center'), prev: pikachu, versionOnly: true },
    ]);
    // Qualquer ordem de chegada.
    expect(classifyEntryEvents([...rows].reverse())).toEqual(items);
  });

  it('adicionou e logo trocou a versão: adicionada, já na versão nova', () => {
    expect(classifyEntryEvents([added('25-0', pikachu, 0), replaced('25-0', pikachu, pikachuHolo, 1)])).toMatchObject([
      { kind: 'added', card: pikachuHolo },
    ]);
  });

  it('10 min ou mais entre dois fatos do mesmo bolso: momentos separados', () => {
    expect(classifyEntryEvents([added('25-0', pikachu, 0), removed('25-0', pikachu, 9.9)])).toEqual([]);
    expect(kinds(classifyEntryEvents([added('25-0', pikachu, 0), removed('25-0', pikachu, 10)]))).toEqual(['removed', 'added']);
  });

  it('a hora do item é a do último fato (quando a pessoa fez)', () => {
    const items = classifyEntryEvents([added('25-0', pikachu, 0, { done: -0.5 }), replaced('25-0', pikachu, raichu, 3, { done: 2 })]);
    expect(items[0].at).toBe(iso(2));
  });
});

describe('classifyEntryEvents: mover', () => {
  it('para bolso vazio, com o DELETE antes do INSERT: movida', () => {
    const items = classifyEntryEvents([removed('25-0', pikachu, 0, { done: -0.1 }), added('0-3', pikachu, 0.01, { done: -0.1 })]);
    expect(items).toEqual([
      { id: 'm1-2', kind: 'moved', at: iso(-0.1), dayOnly: false, source: 'app', entryId: '0-3', fromEntryId: '25-0', card: pikachu },
    ]);
  });

  it('para bolso vazio, com o INSERT chegando antes do DELETE: movida', () => {
    const items = classifyEntryEvents([added('0-3', pikachu, 0, { done: -0.1 }), removed('25-0', pikachu, 0.02, { done: -0.1 })]);
    expect(items).toMatchObject([{ kind: 'moved', entryId: '0-3', fromEntryId: '25-0', card: pikachu }]);
  });

  it('pareia 1:1 e prefere a hora idêntica', () => {
    const items = classifyEntryEvents([
      removed('25-0', pikachu, 0, { done: 1 }),
      removed('25-1', pikachu, 0.5, { done: 2 }),
      added('b1:0', pikachu, 2.1, { done: 2 }),
    ]);
    expect(items).toMatchObject([
      { kind: 'moved', entryId: 'b1:0', fromEntryId: '25-1' },
      { kind: 'removed', entryId: '25-0' },
    ]);
    const two = classifyEntryEvents([removed('25-0', pikachu, 0), removed('25-1', pikachu, 0), added('b1:0', pikachu, 1), added('b1:1', pikachu, 1)]);
    expect(kinds(two)).toEqual(['moved', 'moved']);
    expect(new Set(two.map((i) => i.fromEntryId))).toEqual(new Set(['25-0', '25-1']));
  });

  it('mais de 10 min entre sair e entrar, ou outra carta: não é movida', () => {
    expect(kinds(classifyEntryEvents([removed('25-0', pikachu, 0), added('0-3', pikachu, 11)]))).toEqual(['added', 'removed']);
    expect(kinds(classifyEntryEvents([removed('25-0', pikachu, 0), added('0-3', pikachuHolo, 0)]))).toEqual(['added', 'removed']);
  });

  it('troca de lugar no mesmo envio: duas movidas', () => {
    const items = classifyEntryEvents([
      replaced('25-0', pikachu, charmander, 0, { tx: '77' }),
      replaced('4-0', charmander, pikachu, 0, { tx: '77' }),
    ]);
    expect(items).toEqual([
      { id: 's1-2', kind: 'moved', at: iso(0), dayOnly: false, source: 'app', entryId: '25-0', fromEntryId: '4-0', card: charmander },
      { id: 's2-1', kind: 'moved', at: iso(0), dayOnly: false, source: 'app', entryId: '4-0', fromEntryId: '25-0', card: pikachu },
    ]);
  });

  it('troca de lugar em envios diferentes: até 10 min', () => {
    expect(kinds(classifyEntryEvents([replaced('25-0', pikachu, charmander, 0), replaced('4-0', charmander, pikachu, 3)]))).toEqual(['moved', 'moved']);
    expect(kinds(classifyEntryEvents([replaced('25-0', pikachu, charmander, 0), replaced('4-0', charmander, pikachu, 11)]))).toEqual([
      'replaced',
      'replaced',
    ]);
  });

  it('desfazer do mover (bolso vazio e troca de lugar) some', () => {
    const moveBack = [
      removed('25-0', pikachu, 0),
      added('0-3', pikachu, 0.01),
      // Desfazer: sai do destino e volta para a origem.
      removed('0-3', pikachu, 0.1),
      added('25-0', pikachu, 0.11),
    ];
    expect(classifyEntryEvents(moveBack)).toEqual([]);
    const swapBack = [
      replaced('25-0', pikachu, charmander, 0, { tx: '1' }),
      replaced('4-0', charmander, pikachu, 0, { tx: '1' }),
      replaced('25-0', charmander, pikachu, 0.1, { tx: '2' }),
      replaced('4-0', pikachu, charmander, 0.1, { tx: '2' }),
    ];
    expect(classifyEntryEvents(swapBack)).toEqual([]);
  });

  it('desfazer do mover com horas diferentes nos dois bolsos também some', () => {
    const rows = [
      removed('25-0', pikachu, 0, { done: 0 }),
      added('0-3', pikachu, 0.01, { done: 0 }),
      removed('0-3', pikachu, 0.1, { done: 0.1 }),
      added('25-0', pikachu, 0.11, { done: 0.105 }),
    ];
    expect(classifyEntryEvents(rows)).toEqual([]);
    // Mover e depois mover de volta (a mesma carta de b para a, até 10 min): nada.
    expect(
      classifyEntryEvents([removed('25-0', pikachu, 0), added('0-3', pikachu, 0), removed('0-3', pikachu, 5), added('25-0', pikachu, 5)]),
    ).toEqual([]);
  });

  // Mover seguido de outra ação no mesmo bolso, em menos de 10 min: o mover continua sendo movida.
  it('moveu e pôs outra carta na origem: movida + adicionada', () => {
    const items = classifyEntryEvents([removed('25-0', pikachu, 0), added('0-3', pikachu, 0), added('25-0', raichu, 2)]);
    expect(items).toMatchObject([
      { kind: 'added', entryId: '25-0', card: raichu },
      { kind: 'moved', entryId: '0-3', fromEntryId: '25-0', card: pikachu },
    ]);
    expect(items).toHaveLength(2);
  });

  it('moveu e trocou a versão no destino: movida + versão trocada', () => {
    const items = classifyEntryEvents([removed('25-0', pikachu, 0), added('b1:0', pikachu, 0), replaced('b1:0', pikachu, pikachuHolo, 1)]);
    expect(items).toMatchObject([
      { kind: 'replaced', entryId: 'b1:0', card: pikachuHolo, prev: pikachu, versionOnly: true },
      { kind: 'moved', entryId: 'b1:0', fromEntryId: '25-0', card: pikachu },
    ]);
    expect(items).toHaveLength(2);
  });

  it('trocou a versão e depois moveu: versão trocada + movida', () => {
    const items = classifyEntryEvents([replaced('25-0', pikachu, pikachuHolo, 0), removed('25-0', pikachuHolo, 1), added('b1:0', pikachuHolo, 1)]);
    expect(items).toMatchObject([
      { kind: 'moved', entryId: 'b1:0', fromEntryId: '25-0', card: pikachuHolo },
      { kind: 'replaced', entryId: '25-0', card: pikachuHolo, prev: pikachu, versionOnly: true },
    ]);
    expect(items).toHaveLength(2);
  });

  it('removeu a carta do bolso e moveu outra para lá: removida + movida', () => {
    const items = classifyEntryEvents([removed('b1:0', raichu, 0), removed('25-0', pikachu, 1), added('b1:0', pikachu, 1)]);
    expect(items).toMatchObject([
      { kind: 'moved', entryId: 'b1:0', fromEntryId: '25-0', card: pikachu },
      { kind: 'removed', entryId: 'b1:0', card: raichu },
    ]);
    expect(items).toHaveLength(2);
  });

  it('troca de lugar e depois outra carta num dos bolsos: duas movidas + trocada', () => {
    const items = classifyEntryEvents([
      replaced('25-0', pikachu, charmander, 0, { tx: '77' }),
      replaced('4-0', charmander, pikachu, 0, { tx: '77' }),
      replaced('25-0', charmander, raichu, 2),
    ]);
    expect(items).toMatchObject([
      { kind: 'replaced', entryId: '25-0', card: raichu, prev: charmander },
      { kind: 'moved', entryId: '25-0', fromEntryId: '4-0', card: charmander },
      { kind: 'moved', entryId: '4-0', fromEntryId: '25-0', card: pikachu },
    ]);
    expect(items).toHaveLength(3);
  });

  it('o mover do app com hora diferente nos dois bolsos (relógio adiantado) ainda pareia', () => {
    const items = classifyEntryEvents([removed('25-0', pikachu, 0), added('0-3', pikachu, 0.002), added('25-0', raichu, 1)]);
    expect(kinds(items)).toEqual(['added', 'moved']);
  });

  it('adicionou e desfez num bolso, perto de uma remoção da mesma carta em outro: só a removida', () => {
    const items = classifyEntryEvents([removed('25-0', pikachu, 0), added('0-3', pikachu, 1), removed('0-3', pikachu, 1.1)]);
    expect(items).toMatchObject([{ kind: 'removed', entryId: '25-0', card: pikachu }]);
    expect(items).toHaveLength(1);
  });

  // Sem internet o mover esquece a remoção do bolso que recebe ou que dá lugar a outra carta: esse bolso sobe como
  // UPDATE (replaced), e só uma metade dele é da movida.
  it('sem internet, removeu a carta do bolso e moveu outra para lá: movida + removida', () => {
    const items = classifyEntryEvents([
      removed('25-0', pikachu, 120, { done: 1, tx: 'del' }),
      replaced('b1:0', raichu, pikachu, 120.01, { done: 1, tx: 'ups' }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.kind === 'moved')).toEqual({
      id: 'h1-2',
      kind: 'moved',
      at: iso(1),
      dayOnly: false,
      source: 'app',
      entryId: 'b1:0',
      fromEntryId: '25-0',
      card: pikachu,
    });
    expect(items.find((i) => i.kind === 'removed')).toMatchObject({ entryId: 'b1:0', card: raichu, at: iso(1) });
    expect(activityCounts(items)).toEqual({ added: 0, replaced: 0, moved: 1, removed: 1 });
    // A carta que saiu tinha entrado pouco antes: as duas se anulam e fica só a movida.
    const quick = classifyEntryEvents([
      added('b1:0', raichu, 0),
      removed('25-0', pikachu, 3, { done: 2, tx: 'del' }),
      replaced('b1:0', raichu, pikachu, 3.01, { done: 2, tx: 'ups' }),
    ]);
    expect(quick).toMatchObject([{ kind: 'moved', entryId: 'b1:0', fromEntryId: '25-0', card: pikachu }]);
    expect(quick).toHaveLength(1);
  });

  it('sem internet, moveu e pôs outra carta na origem: movida + adicionada', () => {
    const raichuHolo: CardSummary = { ...raichu, variant: 'holo' };
    // Os dois bolsos no mesmo envio; a carta nova veio 30 min depois do mover e logo teve a versão trocada.
    const items = classifyEntryEvents([
      added('0-3', pikachu, 120, { done: 1, tx: 'ups' }),
      replaced('25-0', pikachu, raichu, 120, { done: 31, tx: 'ups' }),
      replaced('25-0', raichu, raichuHolo, 121, { done: 32 }),
    ]);
    expect(items).toMatchObject([
      { kind: 'added', entryId: '25-0', card: raichuHolo, at: iso(32) },
      { kind: 'moved', entryId: '0-3', fromEntryId: '25-0', card: pikachu, at: iso(1) },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].prev).toBeUndefined();
    // Em envios diferentes: até 10 min, como a movida.
    expect(kinds(classifyEntryEvents([replaced('25-0', pikachu, raichu, 0), added('0-3', pikachu, 3)]))).toEqual(['moved', 'added']);
    expect(kinds(classifyEntryEvents([replaced('25-0', pikachu, raichu, 0), added('0-3', pikachu, 11)]))).toEqual(['added', 'replaced']);
  });

  it('sem internet, duas movidas passando pelo mesmo bolso: duas movidas', () => {
    const pairs = (items: ActivityItem[]) => items.filter((i) => i.kind === 'moved').map((i) => [i.card.cardId, i.fromEntryId, i.entryId]);
    // Moveu Raichu de b1:0 para b1:1 (vazio) e depois Pikachu de 25-0 para b1:0.
    const first = classifyEntryEvents([
      removed('25-0', pikachu, 120, { done: 2, tx: 'del' }),
      added('b1:1', raichu, 120.01, { done: 1, tx: 'ups' }),
      replaced('b1:0', raichu, pikachu, 120.01, { done: 2, tx: 'ups' }),
    ]);
    expect(first).toHaveLength(2);
    expect(pairs(first)).toEqual([
      [pikachu.cardId, '25-0', 'b1:0'],
      [raichu.cardId, 'b1:0', 'b1:1'],
    ]);
    expect(activityCounts(first)).toEqual({ added: 0, replaced: 0, moved: 2, removed: 0 });
    // Moveu Pikachu de 25-0 para b1:0 (vazio) e depois Charmander de b1:1 para 25-0.
    const second = classifyEntryEvents([
      removed('b1:1', charmander, 120, { done: 2, tx: 'del' }),
      added('b1:0', pikachu, 120.01, { done: 1, tx: 'ups' }),
      replaced('25-0', pikachu, charmander, 120.01, { done: 2, tx: 'ups' }),
    ]);
    expect(second).toHaveLength(2);
    expect(pairs(second)).toEqual([
      [charmander.cardId, 'b1:1', '25-0'],
      [pikachu.cardId, '25-0', 'b1:0'],
    ]);
  });

  it('troca de lugar continua troca de lugar com a mesma carta entrando noutro bolso no mesmo envio', () => {
    const items = classifyEntryEvents([
      replaced('25-0', pikachu, charmander, 0, { tx: '77' }),
      replaced('4-0', charmander, pikachu, 0, { tx: '77' }),
      added('b1:0', pikachu, 0, { tx: '77' }),
    ]);
    expect(items).toHaveLength(3);
    expect(items.filter((i) => i.kind === 'moved').map((i) => [i.fromEntryId, i.entryId])).toEqual([
      ['4-0', '25-0'],
      ['25-0', '4-0'],
    ]);
    expect(items.find((i) => i.kind === 'added')).toMatchObject({ entryId: 'b1:0', card: pikachu });
  });
});

describe('classifyEntryEvents: lote, backfill, restore e ordem', () => {
  const many = (n: number, over: Over = {}) =>
    Array.from({ length: n }, (_, k) => added(`${k + 1}-0`, { ...pikachu, cardId: `c-${k + 1}`, dex: k + 1 }, 0, { done: k / 10, tx: '500', ...over }));

  it('mais de 20 cartas no mesmo envio: um item "N cartas de uma vez"', () => {
    const items = classifyEntryEvents(many(21));
    expect(items).toHaveLength(1);
    const [bulk] = items;
    expect(bulk).toMatchObject({ id: 'b500', kind: 'bulk', count: 21, entryId: '1-0', at: iso(2), source: 'app', dayOnly: false });
    expect(bulk.card.cardId).toBe('c-1');
    expect(bulk.cards?.map((c) => c.cardId)).toEqual(['c-1', 'c-2', 'c-3']);
    expect(activityCounts(items)).toEqual({ added: 21, replaced: 0, moved: 0, removed: 0 });
  });

  it('carta do lote igual a uma removida há pouco em outro bolso: continua no lote', () => {
    // Hora diferente da carta do lote (a importação usa a data da cópia; não repete a hora exata de uma remoção).
    const items = classifyEntryEvents([removed('b1:0', { ...pikachu, cardId: 'c-1', dex: 1 }, 0, { done: -0.5 }), ...many(21)]);
    expect(items).toMatchObject([
      { kind: 'bulk', count: 21 },
      { kind: 'removed', entryId: 'b1:0' },
    ]);
    expect(items).toHaveLength(2);
  });

  // Sem internet as remoções sobem num delete_entries e as entradas num upsert: um envio para cada lado, com a hora
  // do mover nos dois.
  const offline = (moves: number, fresh = 0) => {
    const card = (k: number): CardSummary => ({ ...pikachu, cardId: `c-${k + 1}`, dex: k + 1 });
    const out = Array.from({ length: moves }, (_, k) => removed(`b1:${k}`, card(k), 60, { done: k / 2, tx: 'del' }));
    const into = Array.from({ length: moves }, (_, k) => added(`b2:${k}`, card(k), 60.01, { done: k / 2, tx: 'ups' }));
    const news = Array.from({ length: fresh }, (_, k) => added(`b3:${k}`, card(100 + k), 60.01, { done: 20 + k / 2, tx: 'ups' }));
    return [...out, ...into, ...news];
  };

  it('mais de 20 movidas sem internet (um envio só): movidas, não lote', () => {
    const items = classifyEntryEvents(offline(21));
    expect(kinds(items)).toEqual(Array(21).fill('moved'));
    expect(items.at(-1)).toMatchObject({ entryId: 'b2:0', fromEntryId: 'b1:0', card: { cardId: 'c-1' } });
    expect(activityCounts(items)).toEqual({ added: 0, replaced: 0, moved: 21, removed: 0 });
  });

  it('movidas e cartas novas no mesmo envio: o lote conta só as que sobram', () => {
    // 5 movidas + 18 novas: sobram 18, não é lote.
    expect(activityCounts(classifyEntryEvents(offline(5, 18)))).toEqual({ added: 18, replaced: 0, moved: 5, removed: 0 });
    expect(kinds(classifyEntryEvents(offline(5, 18)))).not.toContain('bulk');
    // 5 movidas + 21 novas: 5 movidas + "21 cartas de uma vez".
    const items = classifyEntryEvents(offline(5, 21));
    expect(kinds(items).filter((k) => k !== 'moved')).toEqual(['bulk']);
    expect(items.find((i) => i.kind === 'bulk')).toMatchObject({ count: 21, card: { cardId: 'c-101' } });
    expect(activityCounts(items)).toEqual({ added: 21, replaced: 0, moved: 5, removed: 0 });
    // 21 movidas + 1 carta igual a uma removida 3 min antes noutro bolso: sobra 1, não é lote, e ela pareia com folga.
    const card200: CardSummary = { ...pikachu, cardId: 'c-200', dex: 200 };
    const plusOne = classifyEntryEvents([
      ...offline(21),
      removed('b4:0', card200, 57, { done: 7, tx: 'del2' }),
      added('b3:0', card200, 60.01, { done: 10, tx: 'ups' }),
    ]);
    expect(activityCounts(plusOne)).toEqual({ added: 0, replaced: 0, moved: 22, removed: 0 });
  });

  it('a carta que sobra de uma movida sem internet (veio de um UPDATE) não entra no lote', () => {
    // Moveu Pikachu de 25-0 para b1:0 e pôs Raichu em 25-0, no mesmo envio de 20 cartas novas.
    const items = classifyEntryEvents([
      ...many(20, { tx: 'ups' }),
      added('b1:0', pikachu, 0, { done: 3, tx: 'ups' }),
      replaced('25-0', pikachu, raichu, 0, { done: 4, tx: 'ups' }),
    ]);
    expect(kinds(items)).not.toContain('bulk');
    expect(activityCounts(items)).toEqual({ added: 21, replaced: 0, moved: 1, removed: 0 });
    expect(items.find((i) => i.kind === 'added' && i.entryId === '25-0')).toMatchObject({ card: raichu });
  });

  it('carta do lote com a versão trocada logo depois: continua no lote, na hora do envio', () => {
    // Importou 21 (com a data da cópia) e trocou a versão de uma 2 min depois, noutro envio.
    const c1: CardSummary = { ...pikachu, cardId: 'c-1', dex: 1 };
    const items = classifyEntryEvents([...many(21), replaced('1-0', c1, { ...c1, variant: 'holo' }, 2, { done: 30 })]);
    expect(items).toHaveLength(1);
    // A hora do lote é a do último INSERT, não a da troca.
    expect(items[0]).toMatchObject({ kind: 'bulk', count: 21, entryId: '1-0', at: iso(2) });
    expect(items[0].cards?.[0]).toEqual({ ...c1, variant: 'holo' });
  });

  it('20 cartas, ou sem envio (tx nula), ficam uma a uma', () => {
    expect(kinds(classifyEntryEvents(many(20)))).toEqual(Array(20).fill('added'));
    expect(kinds(classifyEntryEvents(many(25, { tx: null, source: 'backfill' })))).toEqual(Array(25).fill('added'));
  });

  it('backfill: só o dia (dayOnly) e cada fato sozinho', () => {
    const items = classifyEntryEvents([
      added('25-0', pikachu, 0, { tx: null, source: 'backfill' }),
      removed('25-0', pikachu, 5, { tx: null, source: 'backfill' }),
    ]);
    expect(items).toMatchObject([
      { kind: 'removed', dayOnly: true, source: 'backfill' },
      { kind: 'added', dayOnly: true, source: 'backfill' },
    ]);
  });

  it('restore: tipo normal, marcado como restore, sem anular o que o app fez', () => {
    const items = classifyEntryEvents([removed('25-0', pikachu, 0), added('25-0', pikachu, 1, { source: 'restore' })]);
    expect(items).toMatchObject([
      { kind: 'added', source: 'restore', dayOnly: false },
      { kind: 'removed', source: 'app' },
    ]);
  });

  it('ordem final: do mais recente (happened_at) para o mais antigo; empate pelo fato mais novo', () => {
    const rows = [
      added('1-0', { ...pikachu, cardId: 'a' }, 0),
      added('2-0', { ...pikachu, cardId: 'b' }, 30),
      // Importação: chegou agora, mas com a data antiga da carta.
      added('3-0', { ...pikachu, cardId: 'c' }, 60, { done: -100 }),
      removed('4-0', { ...pikachu, cardId: 'd' }, 30),
    ];
    const items = classifyEntryEvents([rows[2], rows[0], rows[3], rows[1]]);
    expect(items.map((i) => i.card.cardId)).toEqual(['d', 'b', 'a', 'c']);
  });
});

describe('activityCounts, isPokedexSwap e currentEntryOf', () => {
  it('conta por tipo (lote conta as cartas como adicionadas)', () => {
    const items: ActivityItem[] = [
      { id: '1', kind: 'added', at: iso(0), dayOnly: false, source: 'app', entryId: '1-0', card: pikachu },
      { id: '2', kind: 'bulk', at: iso(0), dayOnly: false, source: 'app', entryId: '2-0', card: pikachu, count: 30 },
      { id: '3', kind: 'replaced', at: iso(0), dayOnly: false, source: 'app', entryId: '3-0', card: raichu, prev: pikachu },
      { id: '4', kind: 'moved', at: iso(0), dayOnly: false, source: 'app', entryId: '4-0', card: pikachu },
      { id: '5', kind: 'removed', at: iso(0), dayOnly: false, source: 'app', entryId: '5-0', card: pikachu },
      { id: '6', kind: 'removed', at: iso(0), dayOnly: false, source: 'app', entryId: '6-0', card: pikachu },
    ];
    expect(activityCounts(items)).toEqual({ added: 31, replaced: 1, moved: 1, removed: 2 });
    expect(activityCounts([])).toEqual({ added: 0, replaced: 0, moved: 0, removed: 0 });
  });

  it('troca no Pokédex: trocada, antes e depois sem fichário livre', () => {
    const [swap] = classifyEntryEvents([replaced('25-0', pikachu, raichu, 0)]);
    expect(isPokedexSwap(swap)).toBe(true);
    expect(isPokedexSwap({ ...swap, prev: { ...pikachu, binderId: 'pokedex' } })).toBe(true);
    const [free] = classifyEntryEvents([replaced('b1:0', { ...pikachu, binderId: 'b1' }, { ...raichu, binderId: 'b1' }, 0)]);
    expect(isPokedexSwap(free)).toBe(false);
    const [add] = classifyEntryEvents([added('25-0', pikachu, 0)]);
    expect(isPokedexSwap(add)).toBe(false);
  });

  it('a carta ainda no bolso (mesma chave) devolve a carta atual', () => {
    const [item] = classifyEntryEvents([added('25-0', { ...pikachu, variant: 'wPromo', variantNote: 'Pokémon Center' }, 0)]);
    const now = entry({ variant: 'wPromo', variantNote: ' Pokémon Center ' });
    expect(currentEntryOf(item, { '25-0': now })).toBe(now);
    // Trocada depois, ou o bolso vazio: sem carta para abrir.
    expect(currentEntryOf(item, { '25-0': entry({ variant: 'holo' }) })).toBeUndefined();
    expect(currentEntryOf(item, {})).toBeUndefined();
  });
});

describe('loadActivity (leitura do registro na nuvem)', () => {
  type Activity = typeof import('@/lib/activity');
  type Page = { data: EntryEventRow[] | null; error: unknown };
  /** Uma consulta montada: os filtros na ordem e a faixa da página. */
  type Query = { calls: [string, ...unknown[]][] };

  const NOW = T0 + 60 * 60_000;
  const DAY = 86_400_000;
  /** Páginas pequenas, para a leitura em páginas aparecer no teste. */
  const PAGE = 2;

  /** Carrega um activity.ts novo com um cliente falso do Supabase (sessão, linhas ou erro da tabela). */
  function setup(opts: { user?: string | null; rows?: EntryEventRow[]; error?: unknown }) {
    const queries: Query[] = [];
    const client = {
      auth: { getSession: async () => ({ data: { session: opts.user ? { user: { id: opts.user } } : null } }) },
      from(table: string) {
        const q: Query = { calls: [['from', table]] };
        queries.push(q);
        const chain = {
          select: (...a: unknown[]) => (q.calls.push(['select', ...a]), chain),
          eq: (...a: unknown[]) => (q.calls.push(['eq', ...a]), chain),
          gte: (...a: unknown[]) => (q.calls.push(['gte', ...a]), chain),
          order: (...a: unknown[]) => (q.calls.push(['order', ...a]), chain),
          range: async (a: number, b: number): Promise<Page> => {
            q.calls.push(['range', a, b]);
            return opts.error ? { data: null, error: opts.error } : { data: (opts.rows ?? []).slice(a, b + 1), error: null };
          },
        };
        return chain;
      },
    };
    // Sem o resetModules, o activity.ts novo receberia o supabase null do tests/setup.ts já carregado no topo.
    jest.resetModules();
    jest.doMock('@/lib/supabase', () => ({
      supabase: client,
      // Como a fetchAllPages de verdade: páginas até vir uma incompleta; erro em qualquer página lança.
      fetchAllPages: async <T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) => {
        const out: T[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await page(from, from + PAGE - 1);
          if (error) throw error;
          out.push(...(data ?? []));
          if ((data ?? []).length < PAGE) return out;
        }
      },
      isMissingInServer: (err: unknown) => (err as { code?: string } | null)?.code === 'PGRST205',
    }));
    const mod: Activity = jest.requireActual('@/lib/activity');
    return { mod, queries };
  }

  let now = NOW;
  beforeEach(() => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sem nuvem configurada (supabase null) ou sem sessão: signedOut, sem ler nada', async () => {
    await expect(loadActivity({ days: 30 })).resolves.toEqual({ state: 'signedOut' });
    const { mod, queries } = setup({ user: null });
    await expect(mod.loadActivity({ days: 30 })).resolves.toEqual({ state: 'signedOut' });
    expect(queries).toHaveLength(0);
  });

  it('tabela ainda não existe (PGRST205): notMigrated; outro erro: lança', async () => {
    await expect(setup({ user: 'u1', error: { code: 'PGRST205', message: 'no table' } }).mod.loadActivity({ days: 30 })).resolves.toEqual({
      state: 'notMigrated',
    });
    const boom = { code: '500', message: 'falhou' };
    await expect(setup({ user: 'u1', error: boom }).mod.loadActivity({ days: 30 })).rejects.toBe(boom);
  });

  it('lê do usuário, desde o início do período menos 10 min, em páginas, e tira o que a pessoa fez antes', async () => {
    const start = NOW - 7 * DAY;
    const minAt = (ms: number) => (ms - T0) / 60_000;
    const rows = [
      added('1-0', { ...pikachu, cardId: 'a' }, minAt(NOW - 60_000)),
      // Importação: chegou agora, com a data antiga da carta.
      added('2-0', { ...pikachu, cardId: 'b' }, minAt(NOW - 60_000), { done: minAt(start - DAY) }),
      added('3-0', { ...pikachu, cardId: 'c' }, minAt(start + 60_000)),
    ];
    const { mod, queries } = setup({ user: 'u1', rows });
    const res = await mod.loadActivity({ days: 7 });
    expect(res).toEqual({ state: 'ok', since: new Date(start).toISOString(), items: expect.any(Array) });
    expect(res.state === 'ok' && res.items.map((i) => i.card.cardId)).toEqual(['a', 'c']);
    // 3 linhas em páginas de 2: duas consultas iguais, cada uma com a sua faixa.
    expect(queries).toHaveLength(2);
    expect(queries[0].calls).toEqual([
      ['from', 'entry_events'],
      ['select', expect.stringContaining('happened_at')],
      ['eq', 'user_id', 'u1'],
      ['gte', 'at', new Date(start - 10 * 60_000).toISOString()],
      ['order', 'id', { ascending: true }],
      ['range', 0, 1],
    ]);
    expect(queries[1].calls.at(-1)).toEqual(['range', 2, 3]);
  });

  it('guarda 2 min por usuário e período; force lê de novo; clearActivityCache esquece', async () => {
    const { mod, queries } = setup({ user: 'u1', rows: [added('1-0', pikachu, 0)] });
    const first = await mod.loadActivity({ days: 30 });
    expect(queries).toHaveLength(1);
    now += 60_000;
    await expect(mod.loadActivity({ days: 30 })).resolves.toBe(first);
    expect(queries).toHaveLength(1);
    // Outro período é outra leitura.
    await mod.loadActivity({ days: 7 });
    expect(queries).toHaveLength(2);
    await mod.loadActivity({ days: 30, force: true });
    expect(queries).toHaveLength(3);
    mod.clearActivityCache();
    await mod.loadActivity({ days: 30 });
    expect(queries).toHaveLength(4);
    // Passados 2 min, lê de novo.
    now += 2 * 60_000;
    await mod.loadActivity({ days: 30 });
    expect(queries).toHaveLength(5);
  });

  it('duas chamadas ao mesmo tempo fazem uma leitura só', async () => {
    const { mod, queries } = setup({ user: 'u1', rows: [] });
    const [a, b] = await Promise.all([mod.loadActivity({ days: 30 }), mod.loadActivity({ days: 30 })]);
    expect(a).toBe(b);
    expect(queries).toHaveLength(1);
  });
});
