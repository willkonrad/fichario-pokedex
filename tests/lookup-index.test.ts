import { Platform } from 'react-native';

import { LOOKUP_FORMAT } from '@/lib/lookup-types';

import { RAW_HEADER } from './lookup-fixtures';

// Índice na memória: download, formato, foco, cache por seção, número, sigla e chave. Disco e banco de mentira.

type IndexRow = { md5: string; format: number; body?: string };
type Result = { data: IndexRow | null; error: Error | null };

const mockServer: { row: IndexRow | null; error: Error | null; calls: string[]; pending: Promise<void> | null } = { row: null, error: null, calls: [], pending: null };
const mockDisk: { saved: { md5: string; body: string } | null; failWrite: boolean; reads: number; writes: number; readPending: Promise<void> | null } = {
  saved: null,
  failWrite: false,
  reads: 0,
  writes: 0,
  readPending: null,
};

jest.mock('@/lib/supabase', () => ({
  isNetworkError: (err: unknown) => err instanceof Error && err.message === 'network request failed',
  supabase: {
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({
          maybeSingle: async (): Promise<Result> => {
            mockServer.calls.push(columns);
            await mockServer.pending;
            if (mockServer.error) return { data: null, error: mockServer.error };
            if (!mockServer.row) return { data: null, error: null };
            const { body, ...manifest } = mockServer.row;
            return { data: columns.includes('body') ? { ...manifest, body } : manifest, error: null };
          },
        }),
      }),
    }),
  },
}));

jest.mock('@/lib/lookup-store', () => ({
  storedMd5: async () => mockDisk.saved?.md5 ?? null,
  readStoredBody: async () => {
    mockDisk.reads += 1;
    await mockDisk.readPending;
    return mockDisk.saved;
  },
  writeStoredBody: async (md5: string, body: string) => {
    if (mockDisk.failWrite) throw new Error('disco cheio');
    mockDisk.writes += 1;
    mockDisk.saved = { md5, body };
  },
  clearStoredBody: async () => {
    mockDisk.saved = null;
  },
}));

// Quantas linhas viraram chave de número e quantas foram lidas como carta: mostra quando o índice é varrido.
const mockCalls = { numberKeys: 0, parseRow: 0 };
jest.mock('@/lib/lookup-format', () => {
  const actual = jest.requireActual<typeof import('@/lib/lookup-format')>('@/lib/lookup-format');
  return {
    ...actual,
    numberKeys: (...args: Parameters<typeof actual.numberKeys>) => {
      mockCalls.numberKeys += 1;
      return actual.numberKeys(...args);
    },
    parseRow: (...args: Parameters<typeof actual.parseRow>) => {
      mockCalls.parseRow += 1;
      return actual.parseRow(...args);
    },
  };
});

type Index = typeof import('@/lib/lookup-index');

// O Platform que o módulo isolado lê na hora de cada chamada é o de fora (o react-native o carrega sob demanda).
const ORIGINAL_OS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
afterEach(() => setOS(ORIGINAL_OS));

/** Índice novo a cada teste (a memória fica no módulo). */
function load(os?: string): Index {
  let mod!: Index;
  jest.isolateModules(() => {
    mod = jest.requireActual('@/lib/lookup-index');
  });
  if (os) setOS(os);
  return mod;
}

const line = (...cols: string[]) => cols.join('\t');
const HEAD = JSON.stringify(RAW_HEADER);

const CHARIZARD = line('42382', '604', 'Charizard', '4/102', '', 'Holo Rare', '', '', '120', 'Fire', 'Stage 2', 'base1-4', 'H:9000:9500:10000', 'ep');
const UMBREON = line('567024', '23353', 'Umbreon', '070/108', '', 'Common', '', '', '110', '', '', '', 'N:500:600:700', 'j');
const VIGOROTH = line('609309', '23353', 'Vigoroth', '070/108', '', 'Common', '', '', '80', '', '', '', '', 'j');
const PIKACHU_PROMO = line('680962', '1938', 'Pikachu', '120/SV-P', '291/SV-P', 'Promo', '', '', '60', '', '', '', '', 'e');
const PIKACHU_TG = line('700000', '604', 'Pikachu VMAX', 'TG05/TG30', '', 'Trainer Gallery', '', '', '', '', '', 'swsh12tg-TG05', '', 'e');
const OAK = line('900', '604', 'Professor Oak', '88/102', '', 'Uncommon', '', '', '', 'Trainer', '', 'base1-88', '', 'e', 'Professor Carvalho');
// Duas espécies na mesma carta: a linha entra nas duas seções.
const TEAM_UP = line('800', '604', 'Pikachu & Zekrom', '33/181', '', 'Rare', '', '', '240', '', '', '', '', 'e');

const BODY = [HEAD, '@6', CHARIZARD, '@25', PIKACHU_PROMO, PIKACHU_TG, TEAM_UP, '@197', UMBREON, '@288', VIGOROTH, '@644', TEAM_UP, '@0', OAK, ''].join('\n');

beforeEach(() => {
  mockServer.row = { md5: 'v1', format: LOOKUP_FORMAT, body: BODY };
  mockServer.error = null;
  mockServer.calls = [];
  mockServer.pending = null;
  mockDisk.saved = null;
  mockDisk.failWrite = false;
  mockDisk.reads = 0;
  mockDisk.writes = 0;
  mockDisk.readPending = null;
});

describe('carregar', () => {
  it('sem arquivo guardado, baixa, guarda e fica pronto', async () => {
    const idx = load();
    await idx.ensureLookupLoaded();
    expect(mockServer.calls).toEqual(['md5, format', 'md5, format, body']);
    expect(mockDisk.saved?.md5).toBe('v1');
    expect(idx.lookupHeader()?.pricesDay).toBe('2026-11-08');
    expect(idx.sectionCards(6)[0].name).toBe('Charizard');
  });

  it('com arquivo guardado, lê do disco sem rede', async () => {
    mockDisk.saved = { md5: 'v1', body: BODY };
    const idx = load();
    await idx.ensureLookupLoaded();
    expect(mockServer.calls).toEqual([]);
    expect(idx.sectionCards(197)[0].key).toBe('567024');
  });

  it('já carregado não lê de novo', async () => {
    mockDisk.saved = { md5: 'v1', body: BODY };
    const idx = load();
    await idx.ensureLookupLoaded();
    await idx.ensureLookupLoaded();
    expect(mockDisk.reads).toBe(1);
  });

  it('chamadas ao mesmo tempo baixam uma vez só', async () => {
    const idx = load();
    await Promise.all([idx.ensureLookupLoaded(), idx.ensureLookupLoaded()]);
    expect(mockServer.calls).toHaveLength(2);
  });

  it('disco cheio não impede de usar o índice nesta sessão', async () => {
    mockDisk.failWrite = true;
    const idx = load();
    await idx.ensureLookupLoaded();
    expect(idx.sectionCards(6)).toHaveLength(1);
  });

  it('arquivo guardado que não presta é apagado e baixado de novo', async () => {
    mockDisk.saved = { md5: 'ruim', body: '{quebrado\n@6\n' };
    const idx = load();
    await idx.ensureLookupLoaded();
    expect(mockDisk.saved?.md5).toBe('v1');
    expect(idx.sectionCards(6)).toHaveLength(1);
  });
});

/** Situação do índice lida pelo hook, numa árvore de teste. */
describe('situação', () => {
  /** O módulo isolado tem o próprio React: a árvore precisa ser do mesmo. */
  function loadWithReact(os?: string) {
    let idx!: Index;
    let react!: typeof import('react');
    let renderer!: typeof import('test-renderer');
    jest.isolateModules(() => {
      react = jest.requireActual('react');
      renderer = jest.requireActual('test-renderer');
      idx = jest.requireActual('@/lib/lookup-index');
    });
    if (os) setOS(os);
    return { idx, react, renderer };
  }

  type Seen = ReturnType<Index['useLookupIndex']>;

  async function stateOf(run: (idx: Index) => Promise<void>, os?: string) {
    const { idx, react, renderer } = loadWithReact(os);
    const { act, createElement } = react;
    const { createRoot } = renderer;
    const seen: Seen[] = [];
    const Probe = () => {
      seen.push(idx.useLookupIndex());
      return null;
    };
    const root = createRoot();
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      await run(idx);
    });
    return seen.at(-1);
  }

  const statusOf = async (run: (idx: Index) => Promise<void>, os?: string) => (await stateOf(run, os))?.status;

  it('pronto', async () => {
    expect(await statusOf((idx) => idx.ensureLookupLoaded())).toBe('ready');
  });

  it('banco sem índice', async () => {
    mockServer.row = null;
    expect(await statusOf((idx) => idx.ensureLookupLoaded())).toBe('noIndex');
  });

  it('formato maior que o conhecido é sem índice', async () => {
    mockServer.row = { md5: 'v9', format: LOOKUP_FORMAT + 1, body: BODY };
    expect(await statusOf((idx) => idx.ensureLookupLoaded())).toBe('noIndex');
    expect(mockServer.calls).toEqual(['md5, format']);
  });

  it('cabeçalho de formato maior no corpo é sem índice', async () => {
    mockServer.row = { md5: 'v9', format: LOOKUP_FORMAT, body: BODY.replace('"v":1', `"v":${LOOKUP_FORMAT + 1}`) };
    expect(await statusOf((idx) => idx.ensureLookupLoaded())).toBe('noIndex');
  });

  it('sem internet e sem arquivo', async () => {
    mockServer.error = new Error('network request failed');
    expect(await statusOf((idx) => idx.ensureLookupLoaded())).toBe('noNetwork');
  });

  it('outro erro do servidor é sem índice', async () => {
    mockServer.error = new Error('500');
    expect(await statusOf((idx) => idx.ensureLookupLoaded())).toBe('noIndex');
  });

  it('o motivo separa o servidor (tentar de novo) do formato que o app não lê (atualizar)', async () => {
    mockServer.error = new Error('PGRST002');
    expect(await stateOf((idx) => idx.ensureLookupLoaded())).toMatchObject({ status: 'noIndex', problem: 'server' });
    mockServer.error = null;
    mockServer.row = null;
    expect(await stateOf((idx) => idx.ensureLookupLoaded())).toMatchObject({ status: 'noIndex', problem: 'server' });
    mockServer.row = { md5: 'v9', format: LOOKUP_FORMAT + 1, body: BODY };
    expect(await stateOf((idx) => idx.ensureLookupLoaded())).toMatchObject({ status: 'noIndex', problem: 'format' });
    mockServer.row = { md5: 'v9', format: LOOKUP_FORMAT, body: BODY.replace('"v":1', `"v":${LOOKUP_FORMAT + 1}`) };
    expect(await stateOf((idx) => idx.ensureLookupLoaded())).toMatchObject({ status: 'noIndex', problem: 'format' });
  });

  it('pronto não carrega motivo', async () => {
    expect(await stateOf((idx) => idx.ensureLookupLoaded())).toMatchObject({ status: 'ready', problem: null });
  });

  it('erro passageiro do servidor: "Tentar de novo" baixa quando ele volta', async () => {
    mockServer.error = new Error('503');
    expect(
      await statusOf(async (idx) => {
        await idx.ensureLookupLoaded();
        mockServer.error = null;
        await idx.ensureLookupLoaded();
      }),
    ).toBe('ready');
  });

  it('limpar volta ao começo e apaga o disco', async () => {
    expect(
      await statusOf(async (idx) => {
        await idx.ensureLookupLoaded();
        await idx.clearLookup();
      }),
    ).toBe('idle');
    expect(mockDisk.saved).toBeNull();
  });
});

describe('aquecimento que começa durante a leitura do arquivo', () => {
  /** 'travou' se a promessa não terminar logo. */
  const settles = (p: Promise<unknown>) => Promise.race([p.then(() => 'ok'), new Promise((r) => setTimeout(() => r('travou'), 300))]);

  it.each([
    ['arquivo que não presta', { md5: 'ruim', body: '{quebrado\n@6\n' }],
    ['sem arquivo', null],
  ])('%s: abrir e aquecer terminam, sem "Preparando" para sempre', async (_, saved) => {
    let release!: () => void;
    mockDisk.readPending = new Promise<void>((r) => {
      release = r;
    });
    mockDisk.saved = saved;
    const idx = load();
    const open = idx.ensureLookupLoaded();
    const warm = idx.warmLookup();
    release();
    expect(await settles(open)).toBe('ok');
    expect(await settles(warm)).toBe('ok');
    expect(idx.sectionCards(6)).toHaveLength(1);
    // O aquecimento vê o arquivo que a abertura gravou: não baixa de novo.
    expect(mockDisk.writes).toBe(1);
  });
});

describe('web', () => {
  it('cópia guardada igual à do servidor: usa sem baixar', async () => {
    mockDisk.saved = { md5: 'v1', body: BODY };
    const idx = load('web');
    await idx.ensureLookupLoaded();
    expect(mockServer.calls).toEqual(['md5, format']);
    expect(idx.sectionCards(6)).toHaveLength(1);
  });

  it('cópia de outro dia: baixa a nova, guarda e usa', async () => {
    mockDisk.saved = { md5: 'v0', body: BODY.replace('Charizard', 'Charizard Velho') };
    const idx = load('web');
    await idx.ensureLookupLoaded();
    expect(mockServer.calls).toEqual(['md5, format', 'md5, format, body']);
    expect(mockDisk.saved?.md5).toBe('v1');
    expect(idx.sectionCards(6)[0].name).toBe('Charizard');
  });

  it('primeira vez: lê o manifesto uma vez só', async () => {
    const idx = load('web');
    await idx.ensureLookupLoaded();
    expect(mockServer.calls).toEqual(['md5, format', 'md5, format, body']);
    expect(mockDisk.writes).toBe(1);
  });

  it('sem internet: usa a cópia guardada', async () => {
    mockDisk.saved = { md5: 'v0', body: BODY };
    mockServer.error = new Error('network request failed');
    const idx = load('web');
    await idx.ensureLookupLoaded();
    expect(idx.sectionCards(6)).toHaveLength(1);
  });

  it('servidor com formato que o app não lê: fica a cópia guardada', async () => {
    mockDisk.saved = { md5: 'v0', body: BODY };
    mockServer.row = { md5: 'v9', format: LOOKUP_FORMAT + 1, body: BODY };
    const idx = load('web');
    await idx.ensureLookupLoaded();
    expect(mockServer.calls).toEqual(['md5, format']);
    expect(idx.sectionCards(6)).toHaveLength(1);
  });

  it('cópia com o md5 certo mas que não presta: baixa de novo', async () => {
    mockDisk.saved = { md5: 'v1', body: '{quebrado\n@6\n' };
    const idx = load('web');
    await idx.ensureLookupLoaded();
    expect(idx.sectionCards(6)).toHaveLength(1);
  });

  it('o aquecimento não roda na web', async () => {
    await load('web').warmLookup();
    expect(mockServer.calls).toEqual([]);
  });
});

describe('warmLookup', () => {
  it('confere o manifesto e não baixa se não mudou', async () => {
    mockDisk.saved = { md5: 'v1', body: BODY };
    const idx = load();
    await idx.warmLookup();
    expect(mockServer.calls).toEqual(['md5, format']);
  });

  it('versão nova só vai para o disco: nada entra na memória', async () => {
    mockDisk.saved = { md5: 'v0', body: BODY };
    const idx = load();
    await idx.warmLookup();
    expect(mockDisk.saved?.md5).toBe('v1');
    expect(idx.lookupHeader()).toBeNull();
    expect(mockDisk.reads).toBe(0);
  });

  it('formato maior: mantém o que tem', async () => {
    mockDisk.saved = { md5: 'v0', body: BODY };
    mockServer.row = { md5: 'v9', format: LOOKUP_FORMAT + 1, body: BODY };
    const idx = load();
    await idx.warmLookup();
    expect(mockDisk.saved?.md5).toBe('v0');
  });

  it('sem rede não quebra e continua com o que tem', async () => {
    mockDisk.saved = { md5: 'v0', body: BODY };
    mockServer.error = new Error('network request failed');
    await expect(load().warmLookup()).resolves.toBeUndefined();
    expect(mockDisk.saved?.md5).toBe('v0');
  });

  it('aquecendo e abrindo ao mesmo tempo, baixa uma vez só', async () => {
    let release!: () => void;
    mockServer.pending = new Promise<void>((r) => {
      release = r;
    });
    const idx = load();
    const warm = idx.warmLookup();
    const open = idx.ensureLookupLoaded();
    release();
    await Promise.all([warm, open]);
    expect(mockServer.calls).toEqual(['md5, format', 'md5, format, body']);
    expect(mockDisk.writes).toBe(1);
    expect(idx.sectionCards(6)).toHaveLength(1);
  });

  it('com arquivo guardado, abrir não espera o aquecimento', async () => {
    mockDisk.saved = { md5: 'v0', body: BODY };
    mockServer.pending = new Promise<void>(() => {});
    const idx = load();
    void idx.warmLookup();
    await idx.ensureLookupLoaded();
    expect(idx.sectionCards(6)).toHaveLength(1);
  });
});

describe('foco', () => {
  const NEW_BODY = BODY.replace('Charizard', 'Charizard Novo');

  async function loadedV1() {
    mockDisk.saved = { md5: 'v1', body: BODY };
    const idx = load();
    await idx.ensureLookupLoaded();
    mockServer.row = { md5: 'v2', format: LOOKUP_FORMAT, body: NEW_BODY };
    return idx;
  }

  it('com foco, índice novo fica no disco e a lista não muda', async () => {
    const idx = await loadedV1();
    idx.setLookupFocused(true);
    await idx.warmLookup();
    expect(mockDisk.saved?.md5).toBe('v2');
    expect(idx.sectionCards(6)[0].name).toBe('Charizard');
  });

  it('ao sair da tela o índice novo entra', async () => {
    const idx = await loadedV1();
    idx.setLookupFocused(true);
    await idx.warmLookup();
    idx.setLookupFocused(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(idx.sectionCards(6)[0].name).toBe('Charizard Novo');
  });

  it('sem foco o índice novo entra na hora', async () => {
    const idx = await loadedV1();
    await idx.warmLookup();
    expect(idx.sectionCards(6)[0].name).toBe('Charizard Novo');
  });
});

describe('leitura', () => {
  async function ready() {
    mockDisk.saved = { md5: 'v1', body: BODY };
    const idx = load();
    await idx.ensureLookupLoaded();
    return idx;
  }

  it('antes de carregar, tudo vazio', () => {
    const idx = load();
    expect(idx.sectionCards(6)).toEqual([]);
    expect(idx.searchTrainers('oak')).toEqual([]);
    expect(idx.lookupByNumber('4/102')).toEqual([]);
    expect(idx.lookupByCode('BS', '4')).toEqual([]);
    expect(idx.cardByKey('42382')).toBeNull();
  });

  it('seção na ordem do arquivo, com o dex em que foi lida', async () => {
    const idx = await ready();
    expect(idx.sectionCards(25).map((c) => c.key)).toEqual(['680962', '700000', '800']);
    expect(idx.sectionCards(644)[0].dex).toBe(644);
    expect(idx.sectionCards(151)).toEqual([]);
  });

  it('LRU de 40 espécies: devolve a mesma lista enquanto está no cache', async () => {
    const idx = await ready();
    const first = idx.sectionCards(6);
    expect(idx.sectionCards(6)).toBe(first);
    for (let dex = 1000; dex < 1041; dex++) idx.sectionCards(dex);
    expect(idx.sectionCards(6)).not.toBe(first);
  });

  it('usar a seção a mantém no cache', async () => {
    const idx = await ready();
    const first = idx.sectionCards(6);
    for (let dex = 1000; dex < 1039; dex++) idx.sectionCards(dex);
    // Cache cheio: renovar a seção faz a próxima a sair ser outra.
    idx.sectionCards(6);
    idx.sectionCards(2000);
    expect(idx.sectionCards(6)).toBe(first);
  });

  it('contagem por seção sem ler as linhas', async () => {
    const idx = await ready();
    expect(idx.sectionCount(25)).toBe(3);
    expect(idx.sectionCount(6)).toBe(1);
    expect(idx.sectionCount(0)).toBe(1);
    expect(idx.sectionCount(151)).toBe(0);
  });

  it('treinador pelo nome em inglês ou português, todas as palavras', async () => {
    const idx = await ready();
    expect(idx.searchTrainers('oak').map((c) => c.key)).toEqual(['900']);
    expect(idx.searchTrainers('professor carvalho').map((c) => c.key)).toEqual(['900']);
    expect(idx.searchTrainers('oak carvalho').map((c) => c.key)).toEqual(['900']);
    expect(idx.searchTrainers('misty')).toEqual([]);
  });

  it('a mesma busca de treinador, pedida duas vezes, não varre de novo', async () => {
    const idx = await ready();
    const first = idx.searchTrainers('oak');
    expect(idx.searchTrainers('oak')).toBe(first);
    expect(idx.searchTrainers('carvalho')).not.toBe(first);
  });

  it('número com total: duas cartas com o mesmo número, zeros normalizados', async () => {
    const idx = await ready();
    expect(idx.lookupByNumber('70/108').map((c) => c.key).sort()).toEqual(['567024', '609309']);
    expect(idx.lookupByNumber('070/108')).toHaveLength(2);
  });

  it('a segunda chave também acha', async () => {
    const idx = await ready();
    expect(idx.lookupByNumber('291/SV-P')[0].key).toBe('680962');
    expect(idx.lookupByNumber('120/SV-P')[0].key).toBe('680962');
  });

  it('carta em duas seções não aparece duas vezes', async () => {
    expect((await ready()).lookupByNumber('33/181')).toHaveLength(1);
  });

  it('número com letras, com ou sem o total', async () => {
    const idx = await ready();
    expect(idx.lookupByNumber('TG05/TG30')[0].key).toBe('700000');
    expect(idx.lookupByNumber('TG05')[0].key).toBe('700000');
  });

  it('número puro sem total não varre todas as cartas', async () => {
    expect((await ready()).lookupByNumber('4')).toEqual([]);
  });

  it('chave que não é número', async () => {
    expect((await ready()).lookupByNumber('WAT')).toEqual([]);
  });

  it('sigla + número, com ou sem total, sem depender de maiúscula', async () => {
    const idx = await ready();
    expect(idx.lookupByCode('BS', '4')[0].key).toBe('42382');
    expect(idx.lookupByCode('bs', '004/102')[0].key).toBe('42382');
    expect(idx.lookupByCode('SV5a', '70').map((c) => c.key).sort()).toEqual(['567024', '609309']);
  });

  it('sigla "Nome: resto" usa só a sigla', async () => {
    expect((await ready()).lookupByCode('BS: Base', '4')[0].key).toBe('42382');
  });

  it('id da coleção na TCGdex também vale como sigla', async () => {
    expect((await ready()).lookupByCode('base1', '4')[0].key).toBe('42382');
  });

  it('letras que fazem parte do número: "TG05" não é a sigla TG', async () => {
    expect((await ready()).lookupByCode('TG', '05')[0].key).toBe('700000');
  });

  it('sigla sem a carta', async () => {
    const idx = await ready();
    expect(idx.lookupByCode('BS', '999')).toEqual([]);
    expect(idx.lookupByCode('ZZZ', '4')).toEqual([]);
  });

  it('carta pela chave, com ou sem dica da seção', async () => {
    const idx = await ready();
    expect(idx.cardByKey('567024', 197)?.name).toBe('Umbreon');
    expect(idx.cardByKey('567024')?.dex).toBe(197);
    expect(idx.cardByKey('567024', 25)?.name).toBe('Umbreon');
    expect(idx.cardByKey('nao-existe')).toBeNull();
  });

  it('nunca chama o TCGCSV nem outra API de preço', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    const idx = load();
    await idx.ensureLookupLoaded();
    idx.sectionCards(6);
    idx.lookupByNumber('4/102');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/**
 * Mapas de número e treinadores montados em fatias logo depois de abrir: a primeira busca por número, sigla ou
 * treinador (e a primeira leitura da câmera) não varre as 67 mil linhas na tecla.
 */
describe('montagem em fatias', () => {
  const NUMBERED = 6000;
  const TRAINERS = 3000;

  /** Seis espécies com 1000 cartas de números diferentes cada e 3000 treinadores sem número. */
  function bigBody() {
    const rows = [HEAD];
    for (let dex = 1; dex <= 6; dex++) {
      rows.push(`@${dex}`);
      for (let i = 1; i <= 1000; i++) {
        const n = (dex - 1) * 1000 + i;
        rows.push(line(`p${n}`, '604', `Card ${n}`, `${n}/9999`));
      }
    }
    rows.push('@0');
    for (let n = 1; n <= TRAINERS; n++) rows.push(line(`t${n}`, '604', `Trainer ${n}`));
    rows.push('');
    return rows.join('\n');
  }

  beforeEach(async () => {
    // Fatias de módulos de outros testes (relógio de verdade) terminam antes de contar.
    await new Promise((r) => setTimeout(r, 20));
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    mockCalls.numberKeys = 0;
    mockCalls.parseRow = 0;
  });
  afterEach(() => jest.useRealTimers());

  async function opened(body = BODY) {
    mockDisk.saved = { md5: 'v1', body };
    const idx = load();
    await idx.ensureLookupLoaded();
    return idx;
  }

  it('depois de abrir, a primeira busca por número, sigla ou treinador não varre o índice', async () => {
    const idx = await opened();
    jest.runAllTimers();
    mockCalls.numberKeys = 0;
    expect(idx.lookupByCode('BS', '4')[0].key).toBe('42382');
    expect(idx.lookupByNumber('70/108')).toHaveLength(2);
    expect(idx.lookupByNumber('TG05')[0].key).toBe('700000');
    expect(mockCalls.numberKeys).toBe(0);
    mockCalls.parseRow = 0;
    expect(idx.searchTrainers('professor carvalho').map((c) => c.key)).toEqual(['900']);
    expect(idx.sectionCards(0).map((c) => c.key)).toEqual(['900']);
    expect(mockCalls.parseRow).toBe(0);
  });

  it('abrir não monta nada na hora, e cada fatia lê só um pedaço', async () => {
    const idx = await opened(bigBody());
    expect(mockCalls.numberKeys).toBe(0);
    expect(mockCalls.parseRow).toBe(0);
    jest.advanceTimersToNextTimer();
    expect(mockCalls.numberKeys).toBeGreaterThan(0);
    expect(mockCalls.numberKeys).toBeLessThan(NUMBERED);
    jest.runAllTimers();
    // Cada linha uma vez só, e os treinadores também.
    expect(mockCalls.numberKeys).toBe(NUMBERED);
    expect(mockCalls.parseRow).toBe(TRAINERS);
    expect(jest.getTimerCount()).toBe(0);
    mockCalls.parseRow = 0;
    expect(idx.lookupByNumber('6000/9999').map((c) => c.key)).toEqual(['p6000']);
    expect(idx.searchTrainers('trainer 3000').map((c) => c.key)).toEqual(['t3000']);
    expect(mockCalls.numberKeys).toBe(NUMBERED);
    expect(mockCalls.parseRow).toBe(1);
  });

  it('busca no meio da montagem completa o resto na hora, sem ler linha duas vezes, e acha o mesmo', async () => {
    const reference = await opened(bigBody());
    // Sem dar tempo às fatias: a montagem inteira, de uma vez, na própria busca.
    const keys = ['1/9999', '2000/9999', '2001/9999', '6000/9999'];
    const expected = keys.map((k) => reference.lookupByNumber(k).map((c) => c.key));
    const expectedCode = reference.lookupByCode('BS', '4500').map((c) => c.key);
    const expectedTrainers = reference.searchTrainers('trainer 2999').map((c) => c.key);
    await reference.clearLookup();
    expect(expected).toEqual([['p1'], ['p2000'], ['p2001'], ['p6000']]);
    expect(expectedCode).toEqual(['p4500']);
    expect(expectedTrainers).toEqual(['t2999']);

    mockCalls.numberKeys = 0;
    const idx = await opened(bigBody());
    jest.advanceTimersToNextTimer();
    expect(mockCalls.numberKeys).toBeLessThan(NUMBERED);
    expect(keys.map((k) => idx.lookupByNumber(k).map((c) => c.key))).toEqual(expected);
    expect(idx.lookupByCode('BS', '4500').map((c) => c.key)).toEqual(expectedCode);
    expect(mockCalls.numberKeys).toBe(NUMBERED);
    // Agora as fatias montam os treinadores; a busca no meio deles também completa, cada linha uma vez.
    mockCalls.parseRow = 0;
    jest.advanceTimersToNextTimer();
    expect(mockCalls.parseRow).toBeGreaterThan(0);
    expect(mockCalls.parseRow).toBeLessThan(TRAINERS);
    expect(idx.searchTrainers('trainer 2999').map((c) => c.key)).toEqual(expectedTrainers);
    expect(mockCalls.parseRow).toBe(TRAINERS);
    jest.runAllTimers();
    expect(mockCalls.numberKeys).toBe(NUMBERED);
    expect(mockCalls.parseRow).toBe(TRAINERS);
  });

  it('limpar o índice cancela a montagem e não segura o índice velho', async () => {
    const idx = await opened(bigBody());
    expect(jest.getTimerCount()).toBe(1);
    await idx.clearLookup();
    expect(jest.getTimerCount()).toBe(0);
    jest.runAllTimers();
    expect(mockCalls.numberKeys).toBe(0);
  });

  it('índice trocado: a montagem é a do novo', async () => {
    const idx = await opened();
    mockServer.row = { md5: 'v2', format: LOOKUP_FORMAT, body: BODY.replace('Charizard', 'Charizard Novo') };
    await idx.warmLookup();
    // A fatia do índice que saiu foi cancelada; só a do novo fica agendada.
    expect(jest.getTimerCount()).toBe(1);
    jest.runAllTimers();
    mockCalls.numberKeys = 0;
    expect(idx.lookupByNumber('4/102')[0].name).toBe('Charizard Novo');
    expect(mockCalls.numberKeys).toBe(0);
  });

  describe('com requestIdleCallback', () => {
    type Deadline = { didTimeout: boolean; timeRemaining: () => number };
    const g = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
    let queue: ((d: Deadline) => void)[];
    let timeouts: (number | undefined)[];
    let cancelled: unknown[];

    beforeEach(() => {
      queue = [];
      timeouts = [];
      cancelled = [];
      g.requestIdleCallback = (run: (d: Deadline) => void, options?: { timeout?: number }) => {
        queue.push(run);
        timeouts.push(options?.timeout);
        return queue.length;
      };
      g.cancelIdleCallback = (handle: unknown) => cancelled.push(handle);
    });
    afterEach(() => {
      delete g.requestIdleCallback;
      delete g.cancelIdleCallback;
    });

    const runNext = (timeRemaining: number, didTimeout = false) => queue.at(-1)!({ didTimeout, timeRemaining: () => timeRemaining });

    it('pede a folga com prazo, devolve a vez quando o aparelho pede e segue na próxima', async () => {
      const idx = await opened(bigBody());
      expect(queue).toHaveLength(1);
      expect(timeouts[0]).toBeGreaterThan(0);
      // Tecla chegando: timeRemaining() 0. A fatia lê só um punhado de linhas.
      runNext(0);
      const small = mockCalls.numberKeys;
      expect(small).toBeGreaterThan(0);
      expect(small).toBeLessThan(100);
      expect(queue).toHaveLength(2);
      // Folga de verdade: lê bem mais.
      runNext(50);
      expect(mockCalls.numberKeys).toBeGreaterThan(small * 10);
      // Na web, a que estourou o prazo tem timeRemaining() 0, mas anda pelo relógio daqui.
      const beforeTimeout = mockCalls.numberKeys;
      runNext(0, true);
      expect(mockCalls.numberKeys - beforeTimeout).toBeGreaterThan(small * 10);
      while (mockCalls.parseRow < TRAINERS) runNext(50);
      expect(mockCalls.numberKeys).toBe(NUMBERED);
      const pending = queue.length;
      await idx.clearLookup();
      // Nada mais agendado depois de pronto: limpar não tem o que cancelar.
      expect(cancelled).toEqual([]);
      expect(queue).toHaveLength(pending);
    });

    it('limpar no meio cancela a folga pedida', async () => {
      const idx = await opened(bigBody());
      runNext(50);
      await idx.clearLookup();
      expect(cancelled).toEqual([queue.length]);
    });
  });
});
