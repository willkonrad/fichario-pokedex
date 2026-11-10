import { Directory, File as NativeFile } from 'expo-file-system';
import { Platform, Share } from 'react-native';

import { backupFileName, backupToCsv, buildBackup, cleanSettings, parseBackup, pickBackupFile, saveBackupFile, stripLegacyFields } from '@/lib/backup';
import { TOTAL_SPECIES } from '@/data/pokedex';
import { customSlotsOnPage, MAX_COLS, MAX_PAGES, MAX_ROWS, MAX_SLOTS_PER_POKEMON, pageSize, slotsOnPage } from '@/lib/binder';
import { MYP_URL, storeUrl } from '@/lib/copy';
import { DEFAULT_CUSTOM_BINDER, DEFAULT_SETTINGS } from '@/lib/types';
import { mergeEntry, mergeSettings } from '@/store/collection';

import { AT, binder, entry, LATER, myp, settings, tcg } from './fixtures';

const mockCache = new Map<string, string>();

jest.mock('expo-file-system', () => {
  class File {
    static pickFileAsync = jest.fn();
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}${name}`;
    }
    create() {}
    async write(text: string) {
      mockCache.set(this.uri, text);
    }
  }
  class Directory {
    static pickDirectoryAsync = jest.fn();
  }
  return { File, Directory, Paths: { cache: 'file:///cache/' } };
});

describe('parseBackup (ler uma cópia da coleção)', () => {
  it('lê a cópia do app, com as cartas e a configuração', () => {
    const file = JSON.stringify(buildBackup(settings({ name: 'Meu fichário' }), [entry()]));
    const r = parseBackup(file);
    expect(r.invalid).toBe(0);
    expect(r.entries).toEqual([entry()]);
    expect(r.settings?.name).toBe('Meu fichário');
    expect(r.exportedAt).toEqual(expect.any(String));
  });

  it('aceita BOM, lista solta e o formato antigo do aparelho (id → carta)', () => {
    expect(parseBackup(`﻿${JSON.stringify({ entries: [entry()] })}`).entries).toHaveLength(1);
    expect(parseBackup([entry(), entry({ id: '1-0', dex: 1 })]).entries).toHaveLength(2);
    expect(parseBackup({ '25-0': entry(), '1-0': entry({ id: '1-0', dex: 1 }) }).entries).toHaveLength(2);
    expect(parseBackup({ entries: { '25-0': entry() } }).entries).toHaveLength(1);
  });

  it('cartas sem o essencial são contadas e ignoradas', () => {
    const r = parseBackup({
      entries: [
        entry(),
        { ...entry(), cardId: '' },
        { ...entry(), dex: -1 },
        { ...entry(), slot: 1.5 },
        { ...entry(), lang: 'fr' },
        { ...entry(), binderId: 7 },
        'carta',
        null,
      ],
    });
    expect(r.entries).toHaveLength(1);
    expect(r.invalid).toBe(7);
  });

  it('completa o que falta e tira campos com formato errado ou antigos', () => {
    const raw = {
      dex: 25,
      slot: 0,
      cardId: 'sv03.5-025',
      lang: 'pt',
      variant: 'brilhante',
      condition: 'novinha',
      updatedAt: '2026-10-20T12:00:00Z',
      myValue: { value: 'dez' },
      valueBasis: 'mediana',
      purchasePrice: '10',
      origin: 'achada',
      stampKeys: [1, 2],
      mypApi: { cardId: 'sv03.5-025', variant: 'normal' },
      tcgplayer: tcg(entry()),
      ligaImage: 'https://exemplo/1.png',
      myp: { avg: 1 },
      notes: 'mantém',
    };
    const [e] = parseBackup({ entries: [raw] }).entries;
    expect(e).toMatchObject({ id: '', cardName: '', setName: '', setId: '', localId: '', variant: 'normal', condition: 'NM', notes: 'mantém' });
    expect(e.updatedAt).toBe('2026-10-20T12:00:00.000Z');
    expect(e.tcgplayer).toEqual(tcg(entry()));
    for (const k of ['myValue', 'valueBasis', 'purchasePrice', 'origin', 'stampKeys', 'mypApi', 'ligaImage', 'myp']) {
      expect(e).not.toHaveProperty(k);
    }
    expect(parseBackup({ entries: [{ ...raw, updatedAt: 'ontem' }] }).entries[0].updatedAt).toBe('');
  });

  it('configuração: o que falta vem do padrão; fichários livres sem o mínimo saem', () => {
    const r = parseBackup({
      exportedAt: AT,
      settings: { rows: 4, cols: 4, slotsPerPokemon: 1, languages: ['pt'], extras: [{ id: 'b1', name: 'Trocas', rows: 3, cols: 3, pages: 10 }, { id: '', name: 'x' }] },
      entries: [],
    });
    expect(r.settings).toMatchObject({ rows: 4, cols: 4, doubleSided: true, languages: ['pt'] });
    expect(r.settings?.extras).toHaveLength(1);
    expect(r.settings?.extras?.[0]).toMatchObject({ id: 'b1', name: 'Trocas', pages: 10, purpose: 'collection', createdAt: AT, showPrices: true });
    expect(parseBackup({ settings: settings(), entries: [] }).settings).not.toHaveProperty('extras');
  });

  it.each([
    ['{ não é json', 'não é JSON'],
    [JSON.stringify({ version: 99, entries: [] }), 'versão mais nova'],
    [JSON.stringify({ app: 'fichario-pokedex', version: 1 }), 'não tem a lista'],
    [JSON.stringify({ entries: [] }), 'Nenhuma carta'],
    ['42', 'não é uma cópia'],
  ])('erro em português: %s', (text, message) => {
    expect(() => parseBackup(text)).toThrow(message);
  });
});

describe('configuração de uma cópia forjada ou editada à mão (limites da tela)', () => {
  const NOW = '2026-11-09T12:00:00.000Z';
  const file = (over: object, extras?: object[]) => ({
    exportedAt: AT,
    settings: { rows: 3, cols: 3, slotsPerPokemon: 1, languages: ['pt'], ...over, ...(extras ? { extras } : {}) },
    entries: [],
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  it.each([
    ['2000 × 2000', { rows: 2000, cols: 2000 }],
    ['10000 × 10000', { rows: 10_000, cols: 10_000 }],
    ['linhas 0 e colunas negativas', { rows: 0, cols: -3 }],
    ['linhas 2.5 e colunas 1e9', { rows: 2.5, cols: 1e9 }],
  ])('grade fora dos limites vira a padrão: %s', (_, over) => {
    const s = parseBackup(file(over)).settings!;
    expect([s.rows, s.cols]).toEqual([DEFAULT_SETTINGS.rows, DEFAULT_SETTINGS.cols]);
    // A página que a tela desenha volta a ter o tamanho de sempre (2000 × 2000 levava quase 2 s por chamada).
    expect(slotsOnPage(s, 0)).toHaveLength(pageSize(DEFAULT_SETTINGS));
  });

  it('os limites da tela continuam valendo: 8 linhas, 6 colunas, 6 espaços por Pokémon e 500 páginas', () => {
    const s = parseBackup(file({ rows: 8, cols: 6, slotsPerPokemon: 6 }, [{ id: 'b1', name: 'X', rows: 8, cols: 6, pages: 500 }])).settings!;
    expect(s).toMatchObject({ rows: MAX_ROWS, cols: MAX_COLS, slotsPerPokemon: MAX_SLOTS_PER_POKEMON });
    expect(s.extras?.[0]).toMatchObject({ rows: MAX_ROWS, cols: MAX_COLS, pages: MAX_PAGES });
    const zero = parseBackup(file({ slotsPerPokemon: 0, languages: ['fr'], doubleSided: 'sim', sheets: -2, dexFrom: 'x' })).settings!;
    expect(zero).toMatchObject({ slotsPerPokemon: 1, languages: DEFAULT_SETTINGS.languages, doubleSided: true });
    expect(zero).not.toHaveProperty('sheets');
    expect(zero).not.toHaveProperty('dexFrom');
  });

  it('fichário livre: páginas 1e6 e grade fora dos limites viram as padrão; sem id, sai', () => {
    const extras = [
      { id: 'b1', name: 'Trocas', rows: 10_000, cols: 10_000, pages: 1e6 },
      { id: 'b2', name: 'Zero', rows: 3, cols: 3, pages: 0, purpose: 'roubo', searchLang: 'fr', showPrices: 'sim', description: 7 },
      { id: '', name: 'sem id', rows: 3, cols: 3, pages: 10 },
    ];
    const [a, b, ...rest] = parseBackup(file({}, extras)).settings!.extras!;
    expect(rest).toEqual([]);
    expect(a).toMatchObject({ id: 'b1', rows: DEFAULT_CUSTOM_BINDER.rows, cols: DEFAULT_CUSTOM_BINDER.cols, pages: DEFAULT_CUSTOM_BINDER.pages });
    expect(customSlotsOnPage(a, 0)).toHaveLength(pageSize(DEFAULT_CUSTOM_BINDER));
    expect(b).toMatchObject({ pages: DEFAULT_CUSTOM_BINDER.pages, purpose: 'collection', searchLang: 'pt', showPrices: true });
    expect(b).not.toHaveProperty('description');
  });

  it('datas no futuro ficam em agora, e a cópia forjada não vence a edição feita depois', () => {
    const future = '9999-12-31T23:59:59.999Z';
    const s = parseBackup(
      file({ rows: 2000, cols: 2000, updatedAt: future }, [{ id: 'b1', name: 'X', rows: 3, cols: 3, pages: 1e6, createdAt: future, updatedAt: future }]),
    ).settings!;
    expect(s.updatedAt).toBe(NOW);
    expect(s.extras?.[0]).toMatchObject({ createdAt: NOW, updatedAt: NOW, pages: DEFAULT_CUSTOM_BINDER.pages });
    // Como em importCollection: a cópia (agora) vence a configuração mais velha daqui, mas com a grade padrão.
    const local = settings({ rows: 4, updatedAt: AT });
    expect(mergeSettings(local, s)).toMatchObject({ rows: DEFAULT_SETTINGS.rows, cols: DEFAULT_SETTINGS.cols });
    // Uma edição feita depois da importação vence a cópia (antes, a data 9999 vencia para sempre).
    jest.setSystemTime(new Date('2026-11-09T12:00:01.000Z'));
    const edited = settings({ rows: 5, updatedAt: new Date().toISOString() });
    expect(mergeSettings(edited, s)?.rows).toBe(5);
    expect(parseBackup(file({ updatedAt: 'zzz' })).settings).not.toHaveProperty('updatedAt');
  });

  it('cartas da cópia: edição, preços e "Meu valor" no futuro ficam em agora, e o que vem depois vence', () => {
    const future = '9999-12-31T23:59:59.999Z';
    const card = entry({ lang: 'en' });
    const forged = {
      ...card,
      updatedAt: future,
      mypApi: myp(card, { checkedAt: future }),
      tcgplayer: tcg(card, { checkedAt: '+010000-01-01T00:00:00.000Z' }),
      myValue: { value: 50, setAt: future },
      myValueReplaced: { value: 5, mypValue: 10, at: future },
    };
    const past = { ...entry({ id: '1-0', dex: 1 }), updatedAt: AT, mypApi: myp(card, { checkedAt: AT }), myValue: { value: 9, setAt: AT } };
    const noDate = { ...entry({ id: '4-0', dex: 4 }), updatedAt: undefined };
    const parsed = parseBackup({ app: 'fichario-pokedex', version: 1, exportedAt: future, entries: [forged, past, noDate] });
    // A data da cópia vale para as cartas sem data (importCollection): também em agora.
    expect(parsed.exportedAt).toBe(NOW);
    const [a, b, c] = parsed.entries;
    expect(a.updatedAt).toBe(NOW);
    expect(a.mypApi?.checkedAt).toBe(NOW);
    expect(a.tcgplayer?.checkedAt).toBe(NOW);
    expect(a.myValue).toEqual({ value: 50, setAt: NOW });
    expect(a.myValueReplaced).toEqual({ value: 5, mypValue: 10, at: NOW });
    // As do passado ficam como estão.
    expect(b).toMatchObject({ updatedAt: AT, mypApi: { checkedAt: AT }, myValue: { value: 9, setAt: AT } });
    expect(c.updatedAt).toBe('');
    // Uma edição e um preço buscados depois da importação vencem a carta da cópia (antes, a data 9999 vencia para
    // sempre: a edição seguinte ganhava "+010000-…", que no texto vem antes, e o banco guarda o preço de data maior).
    jest.setSystemTime(new Date('2026-11-09T12:00:01.000Z'));
    const later = new Date().toISOString();
    const edited = { ...a, notes: 'editada', updatedAt: later, mypApi: myp(card, { checkedAt: later, avg: 11 }) };
    const merged = mergeEntry(a, edited);
    expect(merged).toMatchObject({ notes: 'editada', mypApi: { avg: 11 } });
  });

  it('carta com Pokémon ou bolso acima do que o app tem é ignorada (acima do int do banco, travaria o envio de tudo)', () => {
    const max = MAX_PAGES * MAX_ROWS * MAX_COLS - 1;
    const parsed = parseBackup({
      entries: [
        { dex: 25, slot: 3_000_000_000, cardId: 'base1-58', lang: 'pt' },
        { dex: 99_999, slot: 0, cardId: 'base1-58', lang: 'pt' },
        { dex: TOTAL_SPECIES, slot: max, cardId: 'base1-58', lang: 'pt', binderId: 'b1' },
        { dex: 0, slot: 0, cardId: 'base1-58', lang: 'pt', binderId: 'b1' },
      ],
    });
    expect(parsed.invalid).toBe(2);
    expect(parsed.entries.map((e) => [e.dex, e.slot])).toEqual([
      [TOTAL_SPECIES, max],
      [0, 0],
    ]);
  });

  it('link das lojas de outro site sai do preço (o botão "MYP Cards" volta para a busca do MYP)', () => {
    const card = entry({ lang: 'en' });
    const priced = (mypUrl: string, tcgUrl: string) => ({ ...card, mypApi: { ...myp(card), url: mypUrl }, tcgplayer: { ...tcg(card), url: tcgUrl } });
    const [forged, good] = parseBackup({
      entries: [
        priced('https://site-falso.example/login', 'javascript:alert(1)'),
        { ...priced('https://mypcards.com/pokemon/produto/77', 'https://www.tcgplayer.com/product/42382'), id: '1-0', dex: 1 },
      ],
    }).entries;
    expect(forged.mypApi).not.toHaveProperty('url');
    expect(forged.tcgplayer).not.toHaveProperty('url');
    // O resto do preço fica.
    expect(forged.mypApi?.avg).toBe(myp(card).avg);
    expect(good.mypApi?.url).toBe('https://mypcards.com/pokemon/produto/77');
    expect(good.tcgplayer?.url).toBe('https://www.tcgplayer.com/product/42382');
    // "https://mypcards.com.example/…" não é o MYP.
    expect(storeUrl('https://mypcards.com.example/x', MYP_URL)).toBeUndefined();
  });

  it('cleanSettings: configuração válida (aparelho, nuvem) sai igual, com os campos que esta versão não conhece', () => {
    const valid = settings({
      rows: 4,
      sheets: 40,
      name: 'Meu',
      color: '#2F5BD3',
      dexFrom: 1,
      dexTo: 151,
      updatedAt: LATER,
      extras: [binder({ updatedAt: LATER, description: 'nota' }), binder({ id: 'b2' })],
      removedBinders: { b9: AT },
    });
    const withFuture = { ...valid, futureField: { a: 1 } };
    expect(cleanSettings(withFuture)).toEqual(withFuture);
    // Sem `latest` (aparelho e nuvem), a data não é cortada em agora (um teto que muda a cada leitura venceria toda edição
    // daqui); só a longe demais no futuro sai, e aí a edição seguinte vence.
    expect(cleanSettings({ ...valid, updatedAt: '2027-01-01T00:00:00.000Z' })?.updatedAt).toBe('2027-01-01T00:00:00.000Z');
    const forged = cleanSettings({ ...valid, updatedAt: '9999-12-31T23:59:59.999Z', extras: [binder({ updatedAt: '9999-12-31T23:59:59.999Z' })] })!;
    expect(forged).not.toHaveProperty('updatedAt');
    expect(forged.extras?.[0]).toMatchObject({ createdAt: AT });
    expect(forged.extras?.[0]).not.toHaveProperty('updatedAt');
    expect(mergeSettings(settings({ rows: 5, updatedAt: NOW }), forged)?.rows).toBe(5);
    expect(cleanSettings('x')).toBeNull();
    expect(cleanSettings({ rows: 2000, cols: 2000 })).toMatchObject({ rows: 3, cols: 3, slotsPerPokemon: 1, languages: DEFAULT_SETTINGS.languages });
  });
});

describe('buildBackup e arquivos', () => {
  it('sem preços por padrão, com tudo do colecionador, em ordem de posição', () => {
    const a = { ...entry({ id: '30-0', dex: 30 }), mypApi: myp(entry()), myValue: { value: 9, setAt: AT }, notes: 'nota' };
    const b = { ...entry({ id: 'b1:0', binderId: 'b1', dex: 1 }), tcgplayer: tcg(entry()), ligaImage: 'x' };
    const c = entry({ id: '2-0', dex: 2 });
    const backup = buildBackup(null, [a, b, c]);
    expect(backup.withPrices).toBe(false);
    expect(backup.entries.map((e) => e.id)).toEqual(['2-0', '30-0', 'b1:0']);
    expect(backup.entries[1]).not.toHaveProperty('mypApi');
    expect(backup.entries[1]).toMatchObject({ myValue: { value: 9 }, notes: 'nota' });
    expect(backup.entries[2]).not.toHaveProperty('tcgplayer');
    expect(backup.entries[2]).not.toHaveProperty('ligaImage');
    const full = buildBackup(null, [a], { withPrices: true });
    expect(full.entries[0].mypApi).toEqual(a.mypApi);
  });

  it('stripLegacyFields devolve o mesmo objeto quando não há nada para tirar', () => {
    const e = entry();
    expect(stripLegacyFields(e)).toBe(e);
  });

  it('CSV para planilha em português, sem fórmulas', () => {
    const e = { ...entry({ notes: '=HYPERLINK("x")', variantNote: 'a;b' }), myValue: { value: 1234.5, setAt: AT } };
    const csv = backupToCsv(buildBackup(settings(), [e]));
    expect(csv.startsWith('﻿')).toBe(true);
    const line = csv.split('\r\n')[1].split(';');
    expect(line.slice(0, 4)).toEqual(['Pokédex', '25', '1', 'Pikachu']);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"a;b"');
    expect(csv).toContain(';1234,50;');
  });

  it('CSV: o número impresso, como na tela e nas listas (promo sem total, galeria, japonesa antiga sem número)', () => {
    const cards = [
      entry({ id: '1-0', dex: 1, cardId: 'mep-010', lang: 'en', setId: 'mep', setName: 'MEP Black Star Promos', localId: '010', setTotal: 89 }),
      entry({ id: '2-0', dex: 2, cardId: 'me02-115', lang: 'en', setId: 'me02', setName: 'Phantasmal Flames', localId: '115', setTotal: 94 }),
      entry({ id: '3-0', dex: 3, cardId: 'swsh11tg-TG06', lang: 'en', setId: 'swsh11tg', setName: 'Lost Origin Trainer Gallery', localId: 'TG06', setTotal: 30 }),
      entry({ id: '4-0', dex: 4, cardId: 'PMCG1-021', lang: 'ja', setId: 'PMCG1', setName: '拡張パック', localId: '021', setTotal: 102 }),
      entry({ id: '5-0', dex: 5, setTotal: 165 }),
    ];
    const lines = backupToCsv(buildBackup(settings(), cards)).split('\r\n');
    const column = lines[0].split(';').indexOf('Número');
    expect(lines.slice(1, 6).map((l) => l.split(';')[column])).toEqual(['010', '115/094', 'TG06/TG30', '', '025/165']);
  });

  it('nome do arquivo com o dia', () => {
    expect(backupFileName('json', new Date(2026, 9, 24))).toBe('fichario-pokedex-2026-10-24.json');
    expect(backupFileName('csv', new Date(2026, 0, 5))).toBe('fichario-pokedex-2026-01-05.csv');
  });
});

describe('saveBackupFile e pickBackupFile (arquivo no celular)', () => {
  const NAME = 'fichario-pokedex-2026-11-09.json';
  const pickFolder = Directory.pickDirectoryAsync as jest.Mock;
  const pickFile = NativeFile.pickFileAsync as unknown as jest.Mock;
  const cancelled = () => Object.assign(new Error('The file picker was cancelled by the user'), { code: 'ERR_PICKER_CANCELLED' });
  let share: jest.SpyInstance;

  /** Pasta escolhida no seletor, com o arquivo que ela cria. */
  function folderWith(write: (text: string) => Promise<void> = async () => {}) {
    const file = { write: jest.fn(write), delete: jest.fn() };
    const folder = { createFile: jest.fn(() => file) };
    pickFolder.mockResolvedValue(folder);
    return { file, folder };
  }

  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
    share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    pickFolder.mockReset();
    pickFile.mockReset();
    mockCache.clear();
  });

  afterEach(() => jest.restoreAllMocks());

  it('Android: cópia grande vai inteira para a pasta escolhida, sem passar pelo limite do Intent', async () => {
    const { file, folder } = folderWith();
    // Bem mais que o limite de cerca de 1 MB do menu de compartilhar do Android.
    const content = 'x'.repeat(3_000_000);
    await expect(saveBackupFile(content, NAME)).resolves.toBe(`${NAME} salvo`);
    expect(folder.createFile).toHaveBeenCalledWith(NAME, 'application/json');
    expect(file.write).toHaveBeenCalledWith(content);
    expect(share).not.toHaveBeenCalled();
  });

  it('Android: planilha sai com o tipo CSV', async () => {
    const { folder } = folderWith();
    await saveBackupFile('a;b', 'x.csv', 'text/csv');
    expect(folder.createFile).toHaveBeenCalledWith('x.csv', 'text/csv');
  });

  it('Android: voltar sem escolher a pasta não é erro', async () => {
    pickFolder.mockRejectedValue(cancelled());
    await expect(saveBackupFile('{}', NAME)).resolves.toBeNull();
  });

  it('Android: falha na pasta sai em português', async () => {
    pickFolder.mockRejectedValue(new Error('No Activity found to handle Intent'));
    await expect(saveBackupFile('{}', NAME)).rejects.toThrow('Não consegui salvar o arquivo');
  });

  it('Android: gravação que falha sai em português e não deixa arquivo pela metade', async () => {
    const { file } = folderWith(async () => {
      throw new Error('ENOSPC: no space left on device');
    });
    await expect(saveBackupFile('{}', NAME)).rejects.toThrow('Não consegui salvar o arquivo');
    expect(file.delete).toHaveBeenCalled();
  });

  it('iPhone: o menu de compartilhar recebe o arquivo, não o texto', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await expect(saveBackupFile('{"a":1}', NAME)).resolves.toBeNull();
    expect(mockCache.get(`file:///cache/${NAME}`)).toBe('{"a":1}');
    expect(share).toHaveBeenCalledWith({ url: `file:///cache/${NAME}` });
    expect(pickFolder).not.toHaveBeenCalled();
  });

  it('importar: lê o texto do arquivo escolhido', async () => {
    const file = JSON.stringify(buildBackup(null, [entry()]));
    pickFile.mockResolvedValue({ canceled: false, result: { size: file.length, text: async () => file } });
    const text = await pickBackupFile();
    expect(text).toBe(file);
    expect(parseBackup(text).entries).toHaveLength(1);
  });

  it('importar: cancelar devolve null', async () => {
    pickFile.mockResolvedValue({ canceled: true, result: null });
    await expect(pickBackupFile()).resolves.toBeNull();
  });

  it('importar: arquivo enorme nem é lido, e falha de leitura sai em português', async () => {
    const text = jest.fn(async () => '');
    pickFile.mockResolvedValue({ canceled: false, result: { size: 2_000_000_000, text } });
    await expect(pickBackupFile()).rejects.toThrow('grande demais');
    expect(text).not.toHaveBeenCalled();
    pickFile.mockResolvedValue({ canceled: false, result: { size: 10, text: () => Promise.reject(new Error('Permission denied')) } });
    await expect(pickBackupFile()).rejects.toThrow('Não consegui ler o arquivo.');
  });
});

describe('mergeEntry (junção de duas cópias da mesma carta)', () => {
  const base = entry({ updatedAt: AT });

  it('dados do usuário: vence a edição mais recente; no empate, a da nuvem', () => {
    const local = { ...base, notes: 'local', updatedAt: LATER };
    const remote = { ...base, notes: 'nuvem' };
    expect(mergeEntry(local, remote).notes).toBe('local');
    expect(mergeEntry({ ...local, updatedAt: AT }, remote).notes).toBe('nuvem');
  });

  it('preço: o mais novo, só se for desta carta, versão e idioma', () => {
    const newer = myp(base, { checkedAt: LATER, avg: 11 });
    const local = { ...base, notes: 'local', updatedAt: LATER, mypApi: myp(base) };
    const remote = { ...base, mypApi: newer };
    expect(mergeEntry(local, remote)).toMatchObject({ notes: 'local', mypApi: newer });
    // Preço mais velho não volta.
    expect(mergeEntry({ ...local, mypApi: newer }, { ...remote, mypApi: myp(base) }).mypApi).toBe(newer);
    // Outra versão ou outro idioma: o preço não passa.
    expect(mergeEntry({ ...local, variant: 'holo', mypApi: undefined }, remote).mypApi).toBeUndefined();
    expect(mergeEntry({ ...local, lang: 'en', mypApi: undefined }, remote).mypApi).toBeUndefined();
  });

  it('preço mais novo e acima do "Meu valor" apaga o "Meu valor"', () => {
    const mine = { ...base, myValue: { value: 30, setAt: AT }, updatedAt: LATER };
    const merged = mergeEntry(mine, { ...base, mypApi: myp(base, { checkedAt: LATER, avg: 40 }) });
    expect(merged.myValue).toBeNull();
    expect(merged.myValueReplaced).toEqual({ value: 30, mypValue: 40, at: LATER, source: 'myp' });
    // Abaixo do "Meu valor", ou mais velho que ele: fica.
    expect(mergeEntry(mine, { ...base, mypApi: myp(base, { checkedAt: LATER, avg: 20 }) }).myValue).toEqual({ value: 30, setAt: AT });
    const later = { ...mine, myValue: { value: 30, setAt: LATER } };
    expect(mergeEntry(later, { ...base, mypApi: myp(base, { checkedAt: AT, avg: 40 }) }).myValue).toEqual({ value: 30, setAt: LATER });
  });

  it('a regra do "Meu valor" vale também quando o preço novo e o "Meu valor" velho vêm do mesmo lado', () => {
    // Ex.: a nuvem ficou com o "Meu valor" de um envio atrasado e o preço que já tinha passado dele.
    const stale = { ...base, myValue: { value: 30, setAt: AT }, mypApi: myp(base, { checkedAt: LATER, avg: 40 }) };
    const merged = mergeEntry({ ...base, notes: 'local' }, stale);
    expect(merged.myValue).toBeNull();
    expect(merged.myValueReplaced).toEqual({ value: 30, mypValue: 40, at: LATER, source: 'myp' });
    // Nada a mudar: devolve a mesma carta (a sincronização compara pela identidade antes do JSON).
    const fine = { ...base, myValue: { value: 50, setAt: AT }, mypApi: myp(base, { checkedAt: LATER, avg: 40 }) };
    expect(mergeEntry({ ...base, notes: 'local' }, fine)).toBe(fine);
  });

  it('carta em inglês: quem apaga o "Meu valor" é a TCGplayer, não o MYP', () => {
    const en = entry({ lang: 'en', updatedAt: LATER, myValue: { value: 30, setAt: AT } });
    const remote = { ...en, updatedAt: AT, mypApi: myp(en, { checkedAt: LATER, avg: 40 }) };
    expect(mergeEntry(en, remote).myValue).toEqual({ value: 30, setAt: AT });
    const viaTcg = mergeEntry(en, { ...en, updatedAt: AT, tcgplayer: tcg(en, { checkedAt: LATER, avg: 45 }) });
    expect(viaTcg.myValue).toBeNull();
    expect(viaTcg.myValueReplaced?.source).toBe('tcgplayer');
  });
});
