// O lote da câmera: bolso a bolso, nunca substituir, lote salvo, desfazer, um commit só no store e as telas sem o módulo nativo.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'test-renderer';

import ScanReviewScreen from '@/app/scan-review';
import ScanScreen from '@/app/scan';
import { CardScanner, type ScanVerdict } from '@/components/card-scanner';
import { LookupPhoto } from '@/components/lookup-photo';
import { buildNewEntry, type Destination } from '@/lib/add-card';
import type { CardReading } from '@/lib/card-ocr';
import type { LookupCard, LookupSet } from '@/lib/lookup-types';
import { toBrief } from '@/lib/lookup-view';
import {
  afterBatch,
  alreadyOwned,
  applyPick,
  batchEntries,
  briefOf,
  cardOf,
  clearLot,
  defaultPrint,
  deliverScanPick,
  isLookupOnly,
  itemLang,
  loadLastBatch,
  loadLot,
  lotBlock,
  newLotItem,
  onScanPick,
  pickPictureSize,
  planBatch,
  saveLastBatch,
  saveLot,
  shouldAccept,
  thumbCrop,
  undoTargets,
  type LotItem,
} from '@/lib/scan-lot';
import type { ScanMatch } from '@/lib/scan-match';
import { POKEDEX_BINDER } from '@/lib/types';
import { keyOf, subscribeCollection, useCollectionActions as collectionActions } from '@/store/collection';

import { binder, entry, settings } from './fixtures';
import type { OcrResult } from '../modules/card-ocr';

const mockOcr = { available: false, recognize: jest.fn() };
const mockCamera = { loads: 0, take: jest.fn(), mounted: 0 };
const mockDeleted: string[] = [];
const mockFocus = { value: true };
const mockPicker = jest.fn();

jest.mock('../modules/card-ocr', () => ({
  get isOcrAvailable() {
    return mockOcr.available;
  },
  recognizeCard: (...args: unknown[]) => mockOcr.recognize(...args),
}));

// Sem o módulo de leitura estes pacotes nem podem carregar: num APK sem eles, o import já derruba a tela.
jest.mock('expo-camera', () => {
  mockCamera.loads += 1;
  const { createElement: h, useEffect, useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  return {
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
    CameraView: (p: { ref: unknown; onCameraReady?: () => void }) => {
      useImperativeHandle(p.ref as never, () => ({ takePictureAsync: mockCamera.take, getAvailablePictureSizesAsync: async () => ['1920x1080', '2560x1440', '4000x3000'] }));
      useEffect(() => {
        mockCamera.mounted += 1;
        p.onCameraReady?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return h('CameraView', {});
    },
  };
});
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    exists = true;
    constructor(uri: string) {
      this.uri = uri;
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  },
  Directory: class {},
  Paths: { cache: 'cache' },
}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...args: unknown[]) => mockPicker(...args) }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => false },
  Stack: { Screen: () => null },
  useFocusEffect: jest.fn(),
  useIsFocused: () => mockFocus.value,
  useLocalSearchParams: () => ({}),
}));
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/add-sheet', () => ({ AddCardSheet: () => null }));
jest.mock('@/lib/lookup-store', () => ({
  readStoredBody: async () => null,
  writeStoredBody: async () => {},
  clearStoredBody: async () => {},
  storedMd5: async () => null,
}));

const set: LookupSet = { key: 'mew', lang: 'en', name: '151', abbr: 'MEW', date: '2023-09-22', total: 165, yearFrom: null, yearTo: null, pricesDay: null };

function card(over: Partial<LookupCard> = {}): LookupCard {
  return {
    key: '25001',
    productId: 25001,
    set,
    name: 'Pikachu',
    number: '025/165',
    rarity: 'Common',
    hp: 60,
    hpFromTwin: false,
    tcgdexId: 'sv03.5-025',
    prints: [{ code: 'N', low: 10, mid: 20, market: 30 }],
    marks: 'ep',
    year: { kind: 'year', year: 2023, origin: 'set' },
    dex: 25,
    ...over,
  };
}

const reading: CardReading = { name: 'Pikachu', speciesId: 25, speciesFrom: 'nome', hp: 60, number: { left: '025', total: '165', kind: 'slash', score: 10 }, setCode: 'MEW', langTag: 'PT', regulation: null, year: null, hpWord: 'PS', langWords: null, level: null, script: 'latin' };

const matchOf = (c: LookupCard[], over: Partial<ScanMatch> = {}): ScanMatch => ({ status: 'exact', candidates: c, lang: 'pt', reasons: [], needsVersion: false, signals: 3, ...over });

let nextId = 1;
const item = (c: LookupCard = card(), over: Partial<LotItem> = {}): LotItem => ({ ...newLotItem(reading, matchOf([c]), undefined, `i${nextId++}`), ...over });

const plan = (items: LotItem[], over: Partial<Parameters<typeof planBatch>[1]> = {}) => planBatch(items, { settings: settings(), binders: [], entries: {}, target: 'auto', ...over });

/** Pokédex só até o #27: 27 bolsos em páginas de 9, sem bolso livre no fim. */
const noExtras = settings({ dexFrom: 1, dexTo: 27 });

describe('item novo do lote', () => {
  it('certa já vem marcada, dúvida e não lida não', () => {
    expect(newLotItem(reading, matchOf([card()])).checked).toBe(true);
    expect(newLotItem(reading, matchOf([card(), card({ key: '2' })], { status: 'doubt' })).checked).toBe(false);
    expect(newLotItem(reading, matchOf([], { status: 'none', lang: null })).checked).toBe(false);
  });

  it('"confira a versão" também vem marcada', () => {
    const it2 = newLotItem(reading, matchOf([card()], { needsVersion: true }));
    expect(it2.checked).toBe(true);
    expect(lotBlock(it2)).toBe('version');
  });

  it('coreana e chinesa: só consulta, desmarcadas, sem idioma de coleção', () => {
    for (const lang of ['ko', 'zh'] as const) {
      const it2 = newLotItem(reading, matchOf([card({ marks: 'jk' })], { lang }));
      expect(it2).toMatchObject({ checked: false, lang: null });
      expect(isLookupOnly(it2)).toBe(true);
      expect(lotBlock(it2)).toBe('lookup');
    }
  });

  it('os blocos da conferência', () => {
    expect(lotBlock(newLotItem(reading, matchOf([card()])))).toBe('sure');
    expect(lotBlock(newLotItem(reading, matchOf([card(), card({ key: '2' })], { status: 'doubt' })))).toBe('attention');
    expect(lotBlock(newLotItem(reading, matchOf([], { status: 'none' })))).toBe('attention');
  });

  it('versão padrão: Normal + Reverse dá normal, só Holofoil dá holo', () => {
    expect(defaultPrint(card({ prints: [{ code: 'R', low: 1, mid: 2, market: 3 }, { code: 'N', low: 1, mid: 2, market: 3 }] }))).toBe('N');
    expect(defaultPrint(card({ prints: [{ code: 'H', low: 1, mid: 2, market: 3 }] }))).toBe('H');
    expect(defaultPrint(card({ prints: [] }))).toBeNull();
  });
});

describe('planBatch', () => {
  it('duas do mesmo Pokémon não disputam o mesmo bolso', () => {
    const out = plan([item(), item()], { settings: settings({ slotsPerPokemon: 2 }) });
    expect(out.map((p) => [p.dest?.kind, p.dest?.dex, p.dest?.slot])).toEqual([
      ['dex', 25, 0],
      ['dex', 25, 1],
    ]);
  });

  it('a segunda vai para o próximo bolso livre, e o lote respeita a ordem: Pokémon, fichário aberto, outros, bolso livre', () => {
    const a = binder({ id: 'a', name: 'A', pages: 1, rows: 1, cols: 1, doubleSided: false });
    const b = binder({ id: 'b', name: 'B', pages: 1, rows: 1, cols: 1, doubleSided: false });
    const out = plan([item(), item(), item(), item(), item()], { binders: [a, b], activeBinderId: 'b' });
    expect(out.map((p) => [p.dest?.kind, p.dest?.binderId])).toEqual([
      ['dex', undefined],
      ['binder', 'b'],
      ['binder', 'a'],
      ['extra', undefined],
      [undefined, undefined],
    ]);
  });

  it('sem espaço: fica sem destino', () => {
    const out = plan([item()], { settings: noExtras, entries: { '25-0': entry() } });
    expect(out).toEqual([expect.objectContaining({ dest: null })]);
  });

  it('nunca substitui: com o espaço do Pokémon ocupado, nenhum destino é "replace" nem usa o bolso cheio', () => {
    const out = plan([item(), item()], { entries: { '25-0': entry() }, binders: [binder({ pages: 1 })] });
    expect(out.every((p) => p.dest && p.dest.kind !== 'replace')).toBe(true);
    expect(out.map((p) => keyOf(p.dest!.binderId, p.dest!.dex, p.dest!.slot))).not.toContain('25-0');
  });

  it('não mexe na coleção recebida', () => {
    const entries = {};
    plan([item()], { entries });
    expect(entries).toEqual({});
  });

  it('cópias reservam um bolso cada', () => {
    const out = plan([item(card(), { copies: 3 })], { settings: settings({ slotsPerPokemon: 3 }) });
    expect(out.map((p) => p.dest?.slot)).toEqual([0, 1, 2]);
  });

  it('só entram as marcadas e com idioma de coleção', () => {
    expect(plan([item(card(), { checked: false })])).toEqual([]);
    expect(plan([item(card(), { lang: null })])).toEqual([]);
  });

  it('destino escolhido: só nele', () => {
    const b1 = binder({ pages: 1, rows: 1, cols: 1, doubleSided: false });
    const out = plan([item(), item()], { binders: [b1], target: 'b1' });
    expect(out.map((p) => p.dest?.binderId)).toEqual(['b1', undefined]);
  });

  it('fichário Pokédex: espaço do Pokémon e depois o bolso livre', () => {
    const out = plan([item(), item(), item()], { target: POKEDEX_BINDER, binders: [binder()] });
    expect(out.map((p) => p.dest?.kind)).toEqual(['dex', 'extra', undefined]);
  });
});

describe('batchEntries', () => {
  it('monta a carta só com o índice: raridade, total e versão, sem nenhum preço', () => {
    const it2 = item(card({ prints: [{ code: 'H', low: 1, mid: 2, market: 3 }], rarity: 'Holo Rare' }), { printCode: 'H' });
    const [e] = batchEntries(plan([it2]), 'NM');
    expect(e).toMatchObject({ cardId: 'sv03.5-025', lang: 'pt', dex: 25, slot: 0, condition: 'NM', rarity: 'Holo Rare', setTotal: 165, variant: 'holo' });
    expect(Object.keys(e).filter((k) => /tcgplayer|myp|myValue|price/i.test(k))).toEqual([]);
  });

  it('em inglês usa o id da TCGdex; em japonês, o do produto', () => {
    expect(batchEntries(plan([item(card(), { lang: 'en' })]), 'NM')[0]).toMatchObject({ cardId: 'sv03.5-025', lang: 'en' });
    expect(batchEntries(plan([item(card({ marks: 'j', tcgdexId: undefined }), { lang: 'ja' })]), 'NM')[0]).toMatchObject({ cardId: 'tcgp-25001', lang: 'ja' });
  });

  it('versão com selo escolhida entra com o selo', () => {
    const plain = card();
    const stamped = card({ key: '25002', productId: 25002, stamp: 'Master Ball Pattern', marks: 'e' });
    const it2 = { ...newLotItem(reading, matchOf([plain, stamped])), lang: 'en' as const, stampKey: '25002' };
    expect(cardOf(it2)?.key).toBe('25002');
    const [e] = batchEntries(plan([it2]), 'NM');
    expect(e.variantNote).toBe('Master Ball Pattern');
  });

  it('carta sem bolso fica de fora', () => {
    expect(batchEntries(plan([item()], { settings: noExtras, entries: { '25-0': entry() } }), 'NM')).toEqual([]);
  });
});

describe('buildNewEntry com known', () => {
  const dest: Destination = { key: 'dex', kind: 'dex', dex: 25, slot: 0, title: '#025 Pikachu', detail: '', where: '' };
  const brief = toBrief(card(), 'pt');

  it('sem ficha, usa o que o índice sabe', () => {
    const e = buildNewEntry({ card: brief, facts: null, version: null, condition: 'SP', dest, known: { rarity: 'Rare', setTotal: 165, variant: 'reverse' } });
    expect(e).toMatchObject({ rarity: 'Rare', setTotal: 165, variant: 'reverse', condition: 'SP' });
  });

  it('com ficha, `known` não vale', () => {
    const facts = { detail: null, enDetail: null, versions: [] };
    const e = buildNewEntry({ card: brief, facts, version: null, condition: 'NM', dest, known: { rarity: 'Rare', setTotal: 165, variant: 'reverse' } });
    expect(e).toMatchObject({ variant: 'normal' });
    expect(e.rarity).toBeUndefined();
    expect(e.setTotal).toBeUndefined();
  });

  it('sem `known`, continua como antes', () => {
    expect(buildNewEntry({ card: brief, facts: null, version: null, condition: 'NM', dest })).toMatchObject({ variant: 'normal' });
  });
});

describe('afterBatch', () => {
  it('tira o que entrou e deixa o que ficou sem bolso', () => {
    const a = item();
    const b = item();
    const out = plan([a, b], { settings: noExtras });
    expect(afterBatch([a, b], out, new Set(['25-0']))).toEqual([b]);
  });

  it('cópias: desconta só as que entraram', () => {
    const a = item(card(), { copies: 3 });
    const out = plan([a], { settings: settings({ slotsPerPokemon: 2 }) });
    expect(afterBatch([a], out, new Set(['25-0', '25-1']))).toEqual([{ ...a, copies: 1 }]);
  });
});

describe('o que o dono escolhe', () => {
  it('escolha na Consulta entra como candidata, marcada', () => {
    const a = newLotItem(reading, matchOf([], { status: 'none', lang: null }));
    const picked = applyPick(a, card({ key: '999', marks: 'e' }));
    expect(picked).toMatchObject({ picked: '999', lang: 'en', checked: true });
    expect(picked.match.status).toBe('doubt');
    expect(cardOf(picked)?.key).toBe('999');
  });

  it('escolha na Consulta entra no idioma mostrado na folha', () => {
    const a = newLotItem(reading, matchOf([], { status: 'none', lang: null }));
    expect(applyPick(a, card({ key: 'ep', marks: 'ep' }), 'en').lang).toBe('en');
    expect(applyPick(a, card({ key: 'ep', marks: 'ep' })).lang).toBe('pt');
    // Idioma que a carta não tem não vale.
    expect(applyPick(a, card({ key: 'e', marks: 'e' }), 'pt').lang).toBe('en');
  });

  it('a Consulta entrega o idioma junto com a carta', () => {
    const seen: (string | undefined)[] = [];
    const off = onScanPick((_id, _card, lang) => seen.push(lang));
    deliverScanPick('x', card(), 'en');
    off();
    expect(seen).toEqual(['en']);
  });

  it('carta sem PT nunca é salva como PT, e a candidata seguinte volta a valer', () => {
    const classic = card({ key: 'cel', marks: 'e', tcgdexId: undefined, productId: 250320 });
    const base = card({ key: 'base', marks: 'ep', tcgdexId: 'base1-4' });
    const a = newLotItem(reading, matchOf([classic, base]));
    expect(itemLang(a)).toBe('en');
    expect(briefOf(a)).toMatchObject({ lang: 'en', dataLang: undefined });
    const [saved] = batchEntries(plan([a]), 'NM');
    expect(saved).toMatchObject({ lang: 'en' });
    expect(itemLang({ ...a, picked: 'base' })).toBe('pt');
  });

  it('versão com selo sem PT vira EN; ao voltar para a sem selo, volta a PT', () => {
    const plain = card({ key: 'plain', marks: 'ep' });
    const staff = card({ key: 'staff', marks: 'e', stamp: 'Staff' });
    const a = newLotItem(reading, matchOf([plain, staff]));
    expect(itemLang({ ...a, stampKey: 'staff' })).toBe('en');
    expect(itemLang({ ...a, stampKey: null })).toBe('pt');
  });

  it('coreana continua sem idioma de coleção, mesmo com a linha japonesa', () => {
    const a = newLotItem(reading, matchOf([card({ marks: 'jk' })], { lang: 'ko' }));
    expect(itemLang(a)).toBeNull();
  });

  it('"você já tem" usa a mesma regra da busca', () => {
    const a = item();
    expect(alreadyOwned(a, { '1-0': entry({ cardId: 'sv03.5-025', lang: 'pt' }) })).toBe(true);
    expect(alreadyOwned(a, { '1-0': entry({ cardId: 'sv03.5-025', lang: 'en' }) })).toBe(false);
  });

  it('carta escolhida na Consulta chega à conferência, aberta ou ainda por abrir', () => {
    const seen: string[] = [];
    deliverScanPick('antes', card());
    const off = onScanPick((id) => seen.push(id));
    deliverScanPick('depois', card());
    off();
    expect(seen).toEqual(['antes', 'depois']);
  });
});

describe('lote salvo', () => {
  afterEach(async () => {
    await clearLot();
  });

  it('no aparelho, sem as fotos', async () => {
    await saveLot([item(card(), { thumb: 'file:///cache/scan/1.jpg' })]);
    const raw = JSON.parse((await AsyncStorage.getItem('scan:lot'))!);
    expect(raw).toHaveLength(1);
    expect(raw[0].thumb).toBeUndefined();
  });

  it('na mesma sessão, com as miniaturas', async () => {
    await saveLot([item(card(), { thumb: 'file:///cache/scan/1.jpg' })]);
    expect((await loadLot())?.[0].thumb).toBe('file:///cache/scan/1.jpg');
  });

  it('app fechado no meio: volta do aparelho, inteiro', async () => {
    const a = item();
    await saveLot([a]);
    const raw = (await AsyncStorage.getItem('scan:lot'))!;
    await clearLot();
    expect(await loadLot()).toBeNull();
    await AsyncStorage.setItem('scan:lot', raw);
    expect(await loadLot()).toEqual([a]);
    expect(cardOf((await loadLot())![0])?.key).toBe('25001');
  });

  it('lote vazio apaga o que estava guardado', async () => {
    await saveLot([item()]);
    await saveLot([]);
    expect(await AsyncStorage.getItem('scan:lot')).toBeNull();
    expect(await loadLot()).toBeNull();
  });

  it('dado estragado não vira lote', async () => {
    await AsyncStorage.setItem('scan:lot', '{isso não é json');
    expect(await loadLot()).toBeNull();
    await AsyncStorage.setItem('scan:lot', JSON.stringify([{ id: 1 }]));
    expect(await loadLot()).toBeNull();
  });
});

describe('desfazer o último lote', () => {
  const cards = [
    { id: '25-0', cardId: 'sv03.5-025' },
    { id: '1-0', cardId: 'sv03.5-001' },
  ];

  it('guarda por 24 h', async () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    await saveLastBatch(cards, now);
    expect((await loadLastBatch(now + 23 * 3_600_000))?.cards).toEqual(cards);
    expect(await loadLastBatch(now + 25 * 3_600_000)).toBeNull();
  });

  it('só sai o que continua sendo a carta colocada', () => {
    const last = { at: '2026-11-09T12:00:00Z', cards };
    const entries = { '25-0': entry(), '1-0': entry({ id: '1-0', dex: 1, cardId: 'outra' }) };
    expect(undoTargets(last, entries)).toEqual(['25-0']);
  });
});

describe('aceite e foto', () => {
  const only = { ...reading };

  it('sigla, número e nome numa carta única aceita com uma leitura', () => {
    expect(shouldAccept([only], matchOf([card()]))).toBe(true);
  });

  it('nos outros casos, duas leituras iguais', () => {
    const noCode = { ...reading, setCode: null };
    expect(shouldAccept([noCode], matchOf([card()]))).toBe(false);
    expect(shouldAccept([noCode, noCode], matchOf([card()]))).toBe(true);
    expect(shouldAccept([only], matchOf([card(), card()], { status: 'doubt' }))).toBe(false);
  });

  it('o menor tamanho de foto com lado maior de pelo menos 2.400', () => {
    expect(pickPictureSize(['1920x1080', '4000x3000', '2560x1440', 'Photo'])).toBe('2560x1440');
    expect(pickPictureSize(['1920x1080'])).toBeUndefined();
  });

  it('recorte na área com texto, na escala da imagem e dentro dela', () => {
    const page = { width: 1000, height: 2000, lines: [{ text: 'a', box: { x: 100, y: 100, w: 800, h: 100 } }, { text: 'b', box: { x: 100, y: 1800, w: 800, h: 100 } }] };
    const c = thumbCrop(page, 500, 1000)!;
    expect(c.originX).toBeGreaterThanOrEqual(0);
    expect(c.originX + c.width).toBeLessThanOrEqual(500);
    expect(c.originY + c.height).toBeLessThanOrEqual(1000);
    expect(c.height).toBeGreaterThan(900);
  });

  it('foto deitada ou sem texto: sem recorte', () => {
    const page = { width: 1000, height: 2000, lines: [{ text: 'a', box: { x: 0, y: 0, w: 10, h: 10 } }] };
    expect(thumbCrop(page, 2000, 1000)).toBeNull();
    expect(thumbCrop({ width: 1000, height: 2000, lines: [] }, 1000, 2000)).toBeNull();
  });
});

describe('saveEntries e removeEntries', () => {
  const actions = collectionActions();
  const dest = (dex: number, slot = 0) => ({ dex, slot, cardId: `c-${dex}-${slot}`, lang: 'pt' as const, cardName: 'X', setName: 'S', setId: 's', localId: '1', variant: 'normal' as const, condition: 'NM' as const });
  const spy = jest.fn();
  let off: () => void;

  beforeAll(async () => {
    // Termina de ler o aparelho antes de contar os avisos.
    await actions.saveEntries([]);
  });

  beforeEach(() => {
    spy.mockClear();
    off = subscribeCollection(spy);
  });

  afterEach(() => off());

  it('várias cartas num commit só', async () => {
    const ids = await actions.saveEntries([dest(1), dest(2), dest(3)]);
    expect(ids.sort()).toEqual(['1-0', '2-0', '3-0']);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('nunca substitui uma carta que já está no bolso', async () => {
    const before = actions.exportCollection({ withPrices: true }).entries.find((e) => e.id === '1-0');
    const ids = await actions.saveEntries([{ ...dest(1), cardId: 'outra' }, dest(4)]);
    expect(ids).toEqual(['4-0']);
    expect(actions.exportCollection({ withPrices: true }).entries.find((e) => e.id === '1-0')).toEqual(before);
  });

  it('duas para o mesmo bolso na mesma lista: entra a primeira', async () => {
    expect(await actions.saveEntries([{ ...dest(5), cardId: 'primeira' }, { ...dest(5), cardId: 'segunda' }])).toEqual(['5-0']);
    expect(actions.exportCollection({ withPrices: true }).entries.find((e) => e.id === '5-0')?.cardId).toBe('primeira');
  });

  it('tudo ocupado: nenhum commit', async () => {
    expect(await actions.saveEntries([dest(1)])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('desfazer tira todas num commit só', async () => {
    await actions.removeEntries(['2-0', '3-0', '4-0']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(actions.exportCollection().entries.map((e) => e.id)).not.toEqual(expect.arrayContaining(['2-0']));
  });
});

const texts = (root: Root) =>
  root.container
    .queryAll((i) => i.type === 'Text')
    .flatMap((i) => i.children)
    .filter((c): c is string => typeof c === 'string');

const roots: Root[] = [];
async function show(el: ReactElement) {
  const root = createRoot();
  roots.push(root);
  await act(async () => root.render(el));
  return root;
}

const untilCalled = async (fn: jest.Mock, times: number) => {
  for (let i = 0; i < 200 && fn.mock.calls.length < times; i++) await new Promise((done) => setTimeout(done, 1));
};

const ocrPage = (lines: { text: string; y: number }[]): OcrResult => ({ width: 1000, height: 1400, ms: 1, lines: lines.map((l) => ({ text: l.text, block: 0, box: { x: 10, y: l.y, w: 500, h: 60 }, angle: 0, confidence: 1, lang: 'en', words: [] })) });

describe('as telas', () => {
  beforeEach(() => {
    mockOcr.available = false;
    mockOcr.recognize.mockReset();
    mockCamera.take.mockReset();
    mockCamera.mounted = 0;
    mockPicker.mockReset();
    mockDeleted.length = 0;
    mockFocus.value = true;
  });

  afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount());
  });

  describe('sem o módulo nativo (Expo Go, web, APK antigo)', () => {
    it.each([
      ['/scan', () => createElement(ScanScreen), 'Câmera indisponível'],
      ['/scan-review', () => createElement(ScanReviewScreen), 'Câmera indisponível'],
      ['CardScanner', () => createElement(CardScanner, { mode: 'batch', script: 'auto', onPage: async () => 'keep' as const }), 'Leitura indisponível'],
      ['foto na Consulta', () => createElement(LookupPhoto, { mode: 'photo', lang: null, onResult: () => {}, onCancel: () => {} }), 'Leitura indisponível'],
      ['print na Consulta', () => createElement(LookupPhoto, { mode: 'print', lang: null, onResult: () => {}, onCancel: () => {} }), 'Leitura indisponível'],
    ])('%s explica, sem quebrar', async (_name, make, title) => {
      const root = await show(make());
      expect(texts(root)).toContain(title);
      expect(texts(root).join(' ')).toContain('APK');
    });

    it('não carrega a câmera nem o seletor de imagens', () => {
      expect(mockCamera.loads).toBe(0);
      expect(mockPicker).not.toHaveBeenCalled();
    });
  });

  describe('câmera em laço', () => {
    beforeEach(() => {
      mockOcr.available = true;
      let n = 0;
      mockCamera.take.mockImplementation(async () => ({ uri: `file:///foto${++n}.jpg` }));
      mockOcr.recognize.mockResolvedValue(ocrPage([{ text: 'Mew', y: 50 }]));
    });

    it('uma foto de cada vez, apaga cada uma depois de ler e para no "stop"', async () => {
      let busy = 0;
      let most = 0;
      const verdicts: ScanVerdict[] = ['keep', 'next', 'stop'];
      const onPage = jest.fn(async () => {
        busy += 1;
        most = Math.max(most, busy);
        await Promise.resolve();
        busy -= 1;
        return verdicts.shift() ?? 'keep';
      });
      await show(createElement(CardScanner, { mode: 'batch', script: 'latin', onPage }));
      await act(async () => untilCalled(onPage, 3));
      await act(async () => new Promise((done) => setTimeout(done, 5)));
      expect(onPage).toHaveBeenCalledTimes(3);
      expect(most).toBe(1);
      expect(mockDeleted).toEqual(['file:///foto1.jpg', 'file:///foto2.jpg', 'file:///foto3.jpg']);
      expect(mockOcr.recognize).toHaveBeenCalledWith('file:///foto1.jpg', 'latin');
      expect(mockCamera.take).toHaveBeenCalledWith({ shutterSound: false, skipProcessing: true });
    });

    it('fora de foco a câmera nem monta', async () => {
      mockFocus.value = false;
      const onPage = jest.fn(async () => 'keep' as const);
      await show(createElement(CardScanner, { mode: 'batch', script: 'latin', onPage }));
      expect(mockCamera.mounted).toBe(0);
      expect(onPage).not.toHaveBeenCalled();
    });

    it('em "Auto", sem pista de idioma e com número, passa pela cadeia de leitores', async () => {
      const seen: string[] = [];
      mockOcr.recognize.mockImplementation(async (_uri: string, script: string) => {
        seen.push(script);
        if (script === 'latin') return ocrPage([{ text: 'Fia HP60', y: 50 }, { text: '001/071', y: 1300 }]);
        if (script === 'korean') return ocrPage([{ text: '로젤리아', y: 50 }, { text: '001/071', y: 1300 }]);
        return ocrPage([{ text: '001/071', y: 1300 }]);
      });
      const onPage = jest.fn(async () => 'stop' as const);
      await show(createElement(CardScanner, { mode: 'batch', script: 'auto', onPage }));
      await act(async () => untilCalled(onPage, 1));
      expect(seen).toEqual(['latin', 'japanese', 'korean']);
      expect(onPage.mock.calls[0]).toBeDefined();
    });
  });

  describe('print na Consulta', () => {
    beforeEach(() => {
      mockOcr.available = true;
    });

    it('abre o seletor sem pedir recorte, lê, apaga a cópia e devolve texto', async () => {
      mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/print.jpg' }] });
      mockOcr.recognize.mockResolvedValue(ocrPage([{ text: 'Umbreon', y: 50 }, { text: 'HP 110', y: 52 }, { text: '070/108', y: 1300 }]));
      const onResult = jest.fn();
      await show(createElement(LookupPhoto, { mode: 'print', lang: 'en', onResult, onCancel: () => {} }));
      await act(async () => untilCalled(onResult, 1));
      expect(mockPicker).toHaveBeenCalledWith({ mediaTypes: ['images'] });
      expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ text: 'umbreon 110 070/108', note: 'Lido: Umbreon · HP 110 · 070/108' }));
      expect(mockDeleted).toEqual(['file:///cache/print.jpg']);
    });

    it('cancelar o seletor fecha, sem ler nada', async () => {
      mockPicker.mockResolvedValue({ canceled: true, assets: [] });
      const onCancel = jest.fn();
      await show(createElement(LookupPhoto, { mode: 'print', lang: null, onResult: () => {}, onCancel }));
      await act(async () => untilCalled(onCancel, 1));
      expect(onCancel).toHaveBeenCalled();
      expect(mockOcr.recognize).not.toHaveBeenCalled();
    });
  });
});
