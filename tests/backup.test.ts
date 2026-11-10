import { Directory, File as NativeFile } from 'expo-file-system';
import { Platform, Share } from 'react-native';

import { backupFileName, backupToCsv, buildBackup, parseBackup, pickBackupFile, saveBackupFile, stripLegacyFields } from '@/lib/backup';
import { mergeEntry } from '@/store/collection';

import { AT, entry, LATER, myp, settings, tcg } from './fixtures';

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
