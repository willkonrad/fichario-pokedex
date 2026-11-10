// Tudo do lado do servidor que alimenta o índice da Consulta (3.4.0): campos novos do catalog-sync, etapa 7 (TCGdex por
// idioma), os scripts das espécies e a migração, conferida como texto (o ensaio do SQL em si é o scripts/lookup-audit.sql).
import {
  chooseLanguage,
  imagePath,
  languagesWithPendingDates,
  LANGS,
  readLanguage,
  syncTcgdexLanguages,
  TcgdexRefused,
  undatedSets,
  withKnownDates,
  isRefused,
  type LangData,
  type LangDb,
  type LangFailures,
  type LangReport,
  type StoredSet,
} from '../supabase/functions/catalog-sync/languages';
import {
  cardColumns,
  emptyFields,
  missingHpError,
  parseHp,
  productField,
  productReleasedOn,
  type Product,
} from '../supabase/functions/catalog-sync/products';

declare const __dirname: string;
const { readFileSync } = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');

const addNames = jest.requireActual<{
  parseCsv(text: string): string[][];
  namesFromCsv(text: string): Record<string, { ko?: string; zhHant?: string; zhHans?: string }>;
  withNames(p: { id: number; name: string; ja: string }[], names: Record<string, object>): object[];
}>('../scripts/add-species-names.js');
const speciesSql = jest.requireActual<{
  speciesKey(s: string): string;
  speciesRows(p: { id: number; name: string; ja: string; zhHant?: string; zhHans?: string }[]): { key: string; dex: number; kind: string }[];
  speciesSql(rows: { key: string; dex: number; kind: string }[]): string;
  replaceBetweenMarkers(text: string, sql: string): string;
}>('../scripts/make-species-sql.js');

const read = (file: string) => readFileSync(`${__dirname}/../${file}`, 'utf8');
const MIGRATION = 'supabase/migrations/20261109a_consulta.sql';

const product = (fields: ([string, string] | [string, string, string])[], presale?: Product['presaleInfo']): Product => ({
  productId: 1,
  name: 'x',
  extendedData: fields.map(([name, value, displayName]) => ({ name, value, ...(displayName ? { displayName } : {}) })),
  ...(presale ? { presaleInfo: presale } : {}),
});

describe('campos novos do produto', () => {
  describe('productField', () => {
    it('acha pelo name, sem caixa nem espaço', () => {
      expect(productField(product([['HP', '120']]), 'HP')).toBe('120');
      expect(productField(product([['card type', 'Fire']]), 'Card Type')).toBe('Fire');
      expect(productField(product([['CardType', 'Water']]), 'Card Type')).toBe('Water');
      expect(productField(product([['STAGE', 'Stage 2']]), 'Stage')).toBe('Stage 2');
    });

    it('acha pelo displayName quando o name é outro', () => {
      expect(productField(product([['X1', 'Lightning', 'Card Type']]), 'Card Type')).toBe('Lightning');
    });

    it('vazio ou sem o campo: null', () => {
      expect(productField(product([['HP', '   ']]), 'HP')).toBeNull();
      expect(productField(product([['Rarity', 'Rare']]), 'HP')).toBeNull();
      expect(productField({ productId: 1, name: 'x' }, 'Stage')).toBeNull();
    });

    it('tira os espaços das pontas', () => {
      expect(productField(product([['Stage', ' Basic ']]), 'Stage')).toBe('Basic');
    });
  });

  describe('parseHp', () => {
    it.each([
      ['120', 120],
      ['60 HP', 60],
      ['HP 240', 240],
      ['10', 10],
      ['400', 400],
      ['90+', 90],
    ])('%j → %d', (raw, hp) => {
      expect(parseHp(raw)).toBe(hp);
    });

    it.each([[null], [''], ['—'], ['0'], ['5'], ['65'], ['410'], ['1000']])('%j não é HP', (raw) => {
      expect(parseHp(raw)).toBeNull();
    });

    it('vale o 1º inteiro', () => {
      expect(parseHp('120/240')).toBe(120);
    });
  });

  describe('productReleasedOn', () => {
    it('devolve o dia da data da fonte', () => {
      expect(productReleasedOn(product([], { releasedOn: '2023-08-11T00:00:00' }))).toBe('2023-08-11');
    });

    it('sem data, vazia ou data falsa da fonte: null', () => {
      expect(productReleasedOn(product([]))).toBeNull();
      expect(productReleasedOn(product([], { releasedOn: null }))).toBeNull();
      expect(productReleasedOn(product([], { releasedOn: '' }))).toBeNull();
      expect(productReleasedOn(product([], { releasedOn: '0001-01-01T00:00:00' }))).toBeNull();
    });
  });

  describe('cardColumns e report.fields', () => {
    it('grava as quatro colunas e soma o que veio', () => {
      const fields = emptyFields();
      const row = cardColumns(product([['HP', '120'], ['Card Type', 'Fire'], ['Stage', 'Stage 2']], { releasedOn: '1999-01-09T00:00:00' }), '004/102', fields);
      expect(row).toEqual({ hp: 120, card_type: 'Fire', stage: 'Stage 2', released_on: '1999-01-09' });
      expect(fields).toEqual({ hp: 1, cardType: 1, stage: 1, releasedOn: 1, rejectedHp: [], numbered: 1 });
    });

    it('treinador e energia não contam para o alarme de HP; tipo vazio conta', () => {
      const fields = emptyFields();
      cardColumns(product([['Card Type', 'Energy']]), '1/40', fields);
      cardColumns(product([['Card Type', 'Trainer']]), '2/40', fields);
      expect(fields.numbered).toBe(0);
      expect(missingHpError(fields)).toBeNull();
      cardColumns(product([]), '3/40', fields);
      expect(fields.numbered).toBe(1);
      expect(missingHpError(fields)).toContain('1');
    });

    it('carta sem número não conta como numerada', () => {
      const fields = emptyFields();
      cardColumns(product([['HP', '50']]), null, fields);
      expect(fields.numbered).toBe(0);
      expect(fields.hp).toBe(1);
    });

    it('guarda até 5 exemplos diferentes de HP recusado', () => {
      const fields = emptyFields();
      for (const raw of ['65', '65', '75', '85', '95', '105', '115']) cardColumns(product([['HP', raw]]), '1/1', fields);
      expect(fields.rejectedHp).toEqual(['65', '75', '85', '95', '105']);
      expect(fields.hp).toBe(0);
    });

    it('sem dígito não é HP recusado', () => {
      const fields = emptyFields();
      cardColumns(product([['HP', 'None']]), '1/1', fields);
      expect(fields.rejectedHp).toEqual([]);
    });
  });

  describe('report.errors com HP zero', () => {
    it('copiou carta numerada e nenhuma trouxe HP: erro', () => {
      expect(missingHpError({ ...emptyFields(), numbered: 12 })).toContain('12');
    });

    it('com algum HP, sem erro', () => {
      expect(missingHpError({ ...emptyFields(), numbered: 12, hp: 1 })).toBeNull();
    });

    it('execução sem carta numerada, sem erro', () => {
      expect(missingHpError(emptyFields())).toBeNull();
    });

    it('a função põe o erro em report.errors', () => {
      const index = read('supabase/functions/catalog-sync/index.ts');
      expect(index).toMatch(/const noHp = missingHpError\(report\.fields\);\s+if \(noHp\) report\.errors\.push\(noHp\);/);
    });
  });
});

describe('etapa 7: escolha do idioma', () => {
  const NOW = Date.parse('2026-11-09T12:00:00Z');
  const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

  it('nada lido ainda: o 1º da lista (o Pocket, que diz quais coleções excluir)', () => {
    expect(chooseLanguage([], NOW)).toBe('tcgp');
    expect(LANGS[0]).toBe('tcgp');
  });

  it('os que nunca foram lidos vêm antes dos antigos, na ordem da lista', () => {
    expect(chooseLanguage([{ lang: 'tcgp', fetched_at: daysAgo(30) }], NOW)).toBe('pt');
  });

  it('todos lidos: o mais antigo com mais de 7 dias', () => {
    const rows = LANGS.map((lang, i) => ({ lang: lang as string, fetched_at: daysAgo(8 + i) }));
    expect(chooseLanguage(rows, NOW)).toBe('ja');
  });

  it('todos em dia: nada', () => {
    expect(chooseLanguage(LANGS.map((lang) => ({ lang: lang as string, fetched_at: daysAgo(6.9) })), NOW)).toBeNull();
  });

  it('exatamente 7 dias ainda está em dia', () => {
    expect(chooseLanguage(LANGS.map((lang) => ({ lang: lang as string, fetched_at: daysAgo(7) })), NOW)).toBeNull();
  });

  it('quem falhou há menos de 6 h espera: a vez é do próximo', () => {
    const failed = { failed: { tcgp: new Date(NOW - 3_600_000).toISOString() } };
    expect(chooseLanguage([], NOW, failed)).toBe('pt');
    const old = { failed: { tcgp: new Date(NOW - 7 * 3_600_000).toISOString() } };
    expect(chooseLanguage([], NOW, old)).toBe('tcgp');
  });

  it('todos os que faltam falhando: nada nesta execução', () => {
    const at = new Date(NOW - 3_600_000).toISOString();
    const failed = { failed: Object.fromEntries(LANGS.map((l) => [l, at])) };
    expect(chooseLanguage([], NOW, failed)).toBeNull();
  });

  it('recusa vale por 24 h', () => {
    expect(isRefused({ refusedAt: new Date(NOW - 23 * 3_600_000).toISOString() }, NOW)).toBe(true);
    expect(isRefused({ refusedAt: new Date(NOW - 25 * 3_600_000).toISOString() }, NOW)).toBe(false);
    expect(isRefused({}, NOW)).toBe(false);
  });

  it('as datas pendentes só valem nas 12 h depois de reler zh-tw ou zh-cn', () => {
    const rows = [
      { lang: 'zh-tw', fetched_at: daysAgo(0.25) },
      { lang: 'zh-cn', fetched_at: daysAgo(1) },
      { lang: 'pt', fetched_at: daysAgo(0.1) },
    ];
    expect(languagesWithPendingDates(rows, NOW)).toEqual(['zh-tw']);
  });
});

describe('etapa 7: leitura de um idioma', () => {
  const list = (over: Record<string, unknown>) => async <T,>(url: string): Promise<T> => {
    if (url in over) return over[url] as T;
    throw new Error(`inesperado: ${url}`);
  };
  const SET = { id: 'SV5K', name: 'x', cardCount: { total: 71, official: 71 } };

  it('imagePath tira só o domínio', () => {
    expect(imagePath('https://assets.tcgdex.net/pt/sv/sv03/060')).toBe('pt/sv/sv03/060');
    expect(imagePath(undefined)).toBeUndefined();
  });

  it('pt: cartas com a imagem sem domínio, coleções com total e sem data', async () => {
    const data = await readLanguage('pt', list({
      '/pt/cards': [{ id: 'sv03-060', localId: '060', name: 'Finizen', image: 'https://assets.tcgdex.net/pt/sv/sv03/060' }, { id: 'sv03-061', localId: '061', name: 'Finizen' }],
      '/pt/sets': [{ id: 'sv03', name: 'Chamas Obsidianas', cardCount: { total: 230, official: 197 } }],
    }));
    expect(data.cards).toEqual([{ id: 'sv03-060', localId: '060', name: 'Finizen', image: 'pt/sv/sv03/060' }, { id: 'sv03-061', localId: '061', name: 'Finizen' }]);
    expect(data.sets).toEqual({ sv03: { name: 'Chamas Obsidianas', official: 197, total: 230 } });
    expect(data.hp).toEqual({});
  });

  it('zh-tw: pergunta o HP de 10 a 400 e guarda por carta', async () => {
    const asked: string[] = [];
    const read = async <T,>(url: string): Promise<T> => {
      asked.push(url);
      if (url === '/zh-tw/cards') return [{ id: 'SV5K-001', localId: '001', name: '毒薔薇' }] as T;
      if (url === '/zh-tw/sets') return [SET] as T;
      if (url === '/zh-tw/cards?hp=eq:60') return [{ id: 'SV5K-001' }] as T;
      return [] as T;
    };
    const data = await readLanguage('zh-tw', read);
    expect(asked.filter((u) => u.includes('hp=eq:'))).toHaveLength(40);
    expect(asked).toContain('/zh-tw/cards?hp=eq:400');
    expect(data.hp).toEqual({ 'SV5K-001': 60 });
  });

  it('zh-cn: guarda só as cartas de CSMPiC, as outras repetem o zh-tw', async () => {
    const data = await readLanguage('zh-cn', list({
      '/zh-cn/cards': [{ id: 'CSMPiC-001', localId: '001', name: '宝可梦' }, { id: 'SV7-001', localId: '001', name: '芭瓢蟲' }],
      '/zh-cn/sets': [{ id: 'CSMPiC', name: 'x' }, { id: 'SV7', name: 'y' }],
    }));
    expect(data.cards.map((c) => c.id)).toEqual(['CSMPiC-001']);
    expect(Object.keys(data.sets)).toEqual(['CSMPiC', 'SV7']);
  });

  it('tcgp: só as coleções, sem cartas', async () => {
    const data = await readLanguage('tcgp', list({ '/en/series/tcgp': { sets: [{ id: 'A1', name: 'Genetic Apex' }] } }));
    expect(data.cards).toEqual([]);
    expect(Object.keys(data.sets)).toEqual(['A1']);
  });

  it('lista vazia é erro: nunca grava meia lista', async () => {
    await expect(readLanguage('ko', list({ '/ko/cards': [], '/ko/sets': [SET] }))).rejects.toThrow('lista vazia');
  });

  it('as datas já conhecidas continuam ao reler a lista; ausente é "ainda não perguntada"', () => {
    const fresh: Record<string, StoredSet> = { A: { name: 'a', official: 1, total: 1 }, B: { name: 'b', official: 1, total: 1 }, C: { name: 'c', official: 1, total: 1 } };
    const out = withKnownDates(fresh, { A: { ...fresh.A, date: '2024-01-01' }, B: { ...fresh.B, date: null } });
    expect(out.A.date).toBe('2024-01-01');
    expect(out.B.date).toBeNull();
    expect('date' in out.C).toBe(false);
    expect(undatedSets(out)).toEqual(['C']);
  });

  it('no máximo 40 datas por execução', () => {
    const sets = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`S${i}`, { name: 'x', official: 1, total: 1 } as StoredSet]));
    expect(undatedSets(sets)).toHaveLength(40);
  });
});

describe('etapa 7: o que grava', () => {
  type Saved = LangData & { lang: string; fetched_at: string };
  const FUTURE = () => Date.now() + 60_000;

  function fakeDb(rows: { lang: string; fetched_at: string; sets?: Record<string, StoredSet> }[] = [], failures: LangFailures = {}) {
    const saved: Saved[] = [];
    const updates: { lang: string; sets: Record<string, StoredSet> }[] = [];
    const marks: LangFailures[] = [];
    const cache = {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { data: marks[marks.length - 1] ?? failures }, error: null }) }) }),
      upsert: async (row: { data: LangFailures }) => {
        marks.push(row.data);
        return { data: null, error: null };
      },
    };
    const db = {
      from: (table: string) => table === 'qvmc_cache' ? cache : ({
        select: (columns: string) =>
          columns === 'sets'
            ? { eq: (_c: string, lang: string) => ({ maybeSingle: async () => ({ data: { sets: rows.find((r) => r.lang === lang)?.sets ?? {} }, error: null }) }) }
            : Promise.resolve({ data: rows.map(({ lang, fetched_at }) => ({ lang, fetched_at })), error: null }),
        upsert: async (row: Saved) => {
          saved.push(row);
          return { data: null, error: null };
        },
        update: (row: { sets: Record<string, StoredSet> }) => ({
          eq: async (_c: string, lang: string) => {
            updates.push({ lang, sets: row.sets });
            return { data: null, error: null };
          },
        }),
      }),
    } as unknown as LangDb;
    return { db, saved, updates, marks };
  }

  const deps = (fn: (path: string) => unknown) => ({ fetchJson: async <T,>(p: string) => fn(p) as T, pause: async () => {} });
  const FRESH = new Date().toISOString();
  const allFresh = LANGS.map((lang) => ({ lang: lang as string, fetched_at: FRESH }));

  it('lê um idioma só e grava tudo junto', async () => {
    const { db, saved } = fakeDb();
    const report: { languages?: LangReport } = {};
    const errors: string[] = [];
    await syncTcgdexLanguages(db, report, (w) => errors.push(w), FUTURE(), deps(() => ({ sets: [{ id: 'A1', name: 'x' }] })));
    expect(saved.map((s) => s.lang)).toEqual(['tcgp']);
    expect(report.languages?.lang).toBe('tcgp');
    expect(errors).toEqual([]);
  });

  it('num 503 mantém o que existe, anota e não grava', async () => {
    const { db, saved } = fakeDb(allFresh.filter((r) => r.lang !== 'pt'));
    const errors: string[] = [];
    await syncTcgdexLanguages(db, {}, (w) => errors.push(w), FUTURE(), deps(() => {
      throw new Error('503');
    }));
    expect(saved).toEqual([]);
    expect(errors).toEqual(['tcgdex pt']);
  });

  it('num erro comum marca o idioma, e o próximo já pode rodar', async () => {
    const { db, marks } = fakeDb(allFresh.filter((r) => r.lang !== 'pt' && r.lang !== 'ko'));
    await syncTcgdexLanguages(db, {}, () => {}, FUTURE(), deps(() => {
      throw new Error('503');
    }));
    expect(Object.keys(marks[0].failed ?? {})).toEqual(['pt']);
    expect(marks[0].refusedAt).toBeUndefined();
    const fn = jest.fn(() => [{ id: 'k-1', localId: '1', name: 'x' }]);
    const again: { languages?: LangReport } = {};
    await syncTcgdexLanguages(db, again, () => {}, FUTURE(), deps(fn));
    expect(again.languages?.lang).toBe('ko');
  });

  it('403 ou 429: para a etapa por 24 h e mantém o aviso em report.errors', async () => {
    const { db, marks } = fakeDb(allFresh.filter((r) => r.lang !== 'pt'));
    const errors: string[] = [];
    await syncTcgdexLanguages(db, {}, (w) => errors.push(w), FUTURE(), deps(() => {
      throw new TcgdexRefused('/pt/cards 429');
    }));
    expect(marks[0].refusedAt).toBeTruthy();
    expect(errors).toEqual(['tcgdex pt']);
    const fn = jest.fn(() => []);
    const later: string[] = [];
    await syncTcgdexLanguages(db, {}, (w) => later.push(w), FUTURE(), deps(fn));
    expect(fn).not.toHaveBeenCalled();
    expect(later).toEqual(['tcgdex por idioma']);
  });

  it('leu tudo depois de uma falha: a marca do idioma sai', async () => {
    const { db, marks } = fakeDb([], { failed: { tcgp: new Date(Date.now() - 7 * 3_600_000).toISOString(), ko: new Date().toISOString() } });
    await syncTcgdexLanguages(db, {}, () => {}, FUTURE(), deps(() => ({ sets: [{ id: 'A1', name: 'x' }] })));
    expect(Object.keys(marks[0].failed ?? {})).toEqual(['ko']);
  });

  it('uma lista com erro no meio (HP do zh-tw) não grava nada', async () => {
    const { db, saved } = fakeDb(allFresh.filter((r) => r.lang !== 'zh-tw'));
    const errors: string[] = [];
    await syncTcgdexLanguages(db, {}, (w) => errors.push(w), FUTURE(), deps((p) => {
      if (p === '/zh-tw/cards') return [{ id: 'S-1', localId: '1', name: 'x' }];
      if (p === '/zh-tw/sets') return [{ id: 'S', name: 'x' }];
      if (p.endsWith('hp=eq:200')) throw new Error('503');
      return [];
    }));
    expect(saved).toEqual([]);
    expect(errors).toEqual(['tcgdex zh-tw']);
  });

  it('sem tempo não faz nada', async () => {
    const { db, saved } = fakeDb();
    const fn = jest.fn(() => []);
    await syncTcgdexLanguages(db, {}, () => {}, Date.now() - 1, deps(fn));
    expect(saved).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('o tempo acaba no meio: não é erro e não grava', async () => {
    const { db, saved } = fakeDb(allFresh.filter((r) => r.lang !== 'pt'));
    const report: { languages?: LangReport } = {};
    const errors: string[] = [];
    const start = Date.now();
    let now = start;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      await syncTcgdexLanguages(db, report, (w) => errors.push(w), start + 1_000, deps((p) => {
        now = start + 5_000; // a 1ª leitura já passou do limite: a 2ª não acontece
        return p === '/pt/cards' ? [{ id: 'a-1', localId: '1', name: 'x' }] : [];
      }));
    } finally {
      spy.mockRestore();
    }
    expect(saved).toEqual([]);
    expect(errors).toEqual([]);
    expect(report.languages).toEqual({ lang: 'pt', outOfTime: true });
  });

  it('em dia: usa a vaga para as datas do zh-tw, guardando as que vieram', async () => {
    const sets = { S1: { name: 'a', official: 1, total: 1 }, S2: { name: 'b', official: 1, total: 1 }, S3: { name: 'c', official: 1, total: 1, date: '2020-01-01' } };
    const { db, updates, saved } = fakeDb(allFresh.map((r) => (r.lang === 'zh-tw' ? { ...r, sets } : r)));
    const report: { languages?: LangReport } = {};
    await syncTcgdexLanguages(db, report, () => {}, FUTURE(), deps((p) => (p.endsWith('/S1') ? { releaseDate: '2024-04-26' } : {})));
    expect(saved).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0].sets.S1.date).toBe('2024-04-26');
    expect(updates[0].sets.S2.date).toBeNull();
    expect(updates[0].sets.S3.date).toBe('2020-01-01');
    expect(report.languages).toEqual({ lang: 'zh-tw', dates: 2 });
  });

  it('um erro nas datas guarda as que já vieram e anota', async () => {
    const sets = { S1: { name: 'a', official: 1, total: 1 }, S2: { name: 'b', official: 1, total: 1 } };
    const { db, updates } = fakeDb(allFresh.map((r) => (r.lang === 'zh-tw' ? { ...r, sets } : r)));
    const errors: string[] = [];
    await syncTcgdexLanguages(db, {}, (w) => errors.push(w), FUTURE(), deps((p) => {
      if (p.endsWith('/S2')) throw new Error('503');
      return { releaseDate: '2024-04-26' };
    }));
    expect(updates[0].sets.S1.date).toBe('2024-04-26');
    expect('date' in updates[0].sets.S2).toBe(false);
    expect(errors).toEqual(['tcgdex zh-tw datas']);
  });

  it('a etapa 7 roda depois dos preços e com o limite de tempo da execução', () => {
    const index = read('supabase/functions/catalog-sync/index.ts');
    expect(index.indexOf('await syncPrices(')).toBeLessThan(index.indexOf('await syncTcgdexLanguages('));
    expect(index).toContain('syncTcgdexLanguages(admin as never, report, fail, runStarted + RUN_PRICE_DEADLINE_MS)');
    expect(index).toMatch(/const LINK_VERSION = 9;/);
    expect(index).toContain('release_date: set.releaseDate ?? null');
  });

  it('JA_COPY_VERSION não sobe (zeraria preços de coleções com carta sem número)', () => {
    expect(read('supabase/functions/catalog-sync/products.ts')).toMatch(/export const JA_COPY_VERSION = 8;/);
  });
});

describe('nomes das espécies', () => {
  const pokedex = JSON.parse(read('src/data/pokedex.json')) as { id: number; name: string; ja: string; ko?: string; zhHant?: string; zhHans?: string }[];

  describe('add-species-names', () => {
    const CSV = [
      'pokemon_species_id,local_language_id,name,genus',
      '25,1,ピカチュウ,"ねずみ, ポケモン"',
      '25,3,피카츄,',
      '25,4,皮卡丘,',
      '25,12,皮卡丘,',
      '25,9,Pikachu,Mouse',
    ].join('\n');

    it('aceita vírgula entre aspas', () => {
      expect(addNames.parseCsv('a,"b, c"\n1,2')).toEqual([['a', 'b, c'], ['1', '2']]);
    });

    it('lê só coreano e os dois chineses', () => {
      expect(addNames.namesFromCsv(CSV)).toEqual({ 25: { ko: '피카츄', zhHant: '皮卡丘', zhHans: '皮卡丘' } });
    });

    it('espécie sem nome em algum idioma é erro: não grava pela metade', () => {
      expect(() => addNames.withNames([{ id: 26, name: 'Raichu', ja: 'ライチュウ' }], addNames.namesFromCsv(CSV))).toThrow('Raichu');
    });

    it('não mexe nos outros campos', () => {
      expect(addNames.withNames([{ id: 25, name: 'Pikachu', ja: 'ピカチュウ' }], addNames.namesFromCsv(CSV))).toEqual([
        { id: 25, name: 'Pikachu', ja: 'ピカチュウ', ko: '피카츄', zhHant: '皮卡丘', zhHans: '皮卡丘' },
      ]);
    });
  });

  it('pokedex.json tem os três nomes novos em todas as 1.025 espécies', () => {
    expect(pokedex).toHaveLength(1025);
    expect(pokedex.every((s) => s.ko && s.zhHant && s.zhHans && s.ja && s.name)).toBe(true);
    expect(pokedex[24]).toMatchObject({ id: 25, name: 'Pikachu', ja: 'ピカチュウ', ko: '피카츄', zhHant: '皮卡丘', zhHans: '皮卡丘' });
  });

  it('speciesKey igual à do app', () => {
    const { speciesKey } = jest.requireActual('@/data/pokedex') as { speciesKey(s: string): string };
    for (const s of pokedex) expect(speciesSql.speciesKey(s.name)).toBe(speciesKey(s.name));
  });

  describe('sementes', () => {
    const rows = speciesSql.speciesRows(pokedex);
    const keyOf = new Map(rows.map((r) => [r.key, r]));

    it.each([
      ['nidoranf', 29],
      ['nidoranm', 32],
      ['mrmime', 122],
      ['hooh', 250],
      ['typenull', 772],
      ['porygonz', 474],
      ['flabebe', 669],
      ['farfetchd', 83],
      ['ironvaliant', 1006],
    ])('%s → #%d', (key, dex) => {
      expect(keyOf.get(key)).toMatchObject({ dex, kind: 'en' });
    });

    it('uma chave por nome; o mesmo nome nas duas escritas chinesas não repete', () => {
      expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
      expect(keyOf.get('皮卡丘')).toMatchObject({ dex: 25, kind: 'zh' });
      expect(rows.filter((r) => r.key === '皮卡丘')).toHaveLength(1);
    });

    it('nome igual em duas espécies é erro', () => {
      expect(() =>
        speciesSql.speciesRows([
          { id: 1, name: 'Um', ja: 'イチ', zhHant: '同名' },
          { id: 2, name: 'Dois', ja: 'ニ', zhHant: '同名' },
        ]),
      ).toThrow('同名');
    });

    it('o SQL é idempotente, escapa apóstrofo e não quebra o formato', () => {
      const sql = speciesSql.speciesSql([{ key: "o'neil", dex: 1, kind: 'en' }]);
      expect(sql).toContain("('o''neil',1,'en')");
      expect(sql).toMatch(/on conflict \(key\) do update set dex = excluded\.dex, kind = excluded\.kind;$/);
    });

    it('troca só o trecho entre os marcadores, mantendo o fim de linha', () => {
      const text = 'antes\r\n-- species:begin\r\nvelho\r\n-- species:end\r\ndepois\r\n';
      expect(speciesSql.replaceBetweenMarkers(text, 'novo\nnovo2')).toBe('antes\r\n-- species:begin\r\nnovo\r\nnovo2\r\n-- species:end\r\ndepois\r\n');
    });

    it('a migração e o schema.sql trazem as sementes atuais', () => {
      const between = (text: string) => text.slice(text.indexOf('-- species:begin') + 16, text.indexOf('-- species:end')).replace(/\r\n/g, '\n').trim();
      const expected = speciesSql.speciesSql(rows);
      expect(between(read(MIGRATION))).toBe(expected);
      expect(between(read('supabase/schema.sql'))).toBe(expected);
    });
  });
});

describe('migração da Consulta', () => {
  const migration = read(MIGRATION);
  const schema = read('supabase/schema.sql').replace(/\r\n/g, '\n');
  const fn = (text: string) => text.slice(text.indexOf('create or replace function public.lookup_build()'), text.indexOf('$lookup$;', text.indexOf('as $lookup$')) + 9);
  const body = fn(migration);
  const NEW_TABLES = ['catalog_species', 'tcgdex_lang', 'lookup_overrides', 'lookup_index'];

  it.each(NEW_TABLES)('%s: RLS ligado e policy explícita', (table) => {
    expect(migration).toContain(`alter table public.${table} enable row level security;`);
    expect(migration).toMatch(new RegExp(`create policy "[^"]+" on public\\.${table} for (select|all) to anon, authenticated`));
    expect(migration).toContain(`create table if not exists public.${table} (`);
  });

  it('o app só lê o índice; as outras tabelas ficam fechadas', () => {
    expect(migration).toContain('on public.lookup_index for select to anon, authenticated using (true);');
    for (const table of ['catalog_species', 'tcgdex_lang', 'lookup_overrides']) {
      expect(migration).toContain(`on public.${table} for all to anon, authenticated using (false) with check (false);`);
    }
  });

  it('lookup_build: search_path vazio, sem security definer e fechada para o app', () => {
    expect(body).toMatch(/language plpgsql\s+set search_path = ''/);
    expect(body.toLowerCase()).not.toContain('security definer');
    expect(migration).toContain('revoke all on function public.lookup_build() from public, anon, authenticated;');
  });

  it('lookup_build grava só se o md5 mudou e tem as três travas', () => {
    expect(body).toContain("return 'sem mudança';");
    expect(body).toContain("return 'novo';");
    expect(body).toContain('v_lines < 50000');
    expect(body).toContain('v_lines < v_old.lines * 0.95');
    expect(body).toContain('v_hp < v_old.hp - 10');
    expect(body.indexOf('v_lines < 50000')).toBeLessThan(body.indexOf('insert into public.lookup_index'));
  });

  it('o TCG Pocket fica de fora, e sem a lista dele nenhuma carta só da TCGdex em inglês entra', () => {
    expect(body).toContain("where l.lang = 'tcgp';");
    expect(body.match(/and exists \(select 1 from lk_tcgp\)/g)).toHaveLength(2);
  });

  it('as tabelas temporárias somem com a transação', () => {
    const created = body.match(/create temp table lk_\w+/g) ?? [];
    expect(created.length).toBeGreaterThan(10);
    for (const name of created) expect(body).toMatch(new RegExp(`${name.replace('create temp table ', 'create temp table ')}[^;]*on commit drop`));
  });

  it('idempotente, com o cron e o reload da API', () => {
    expect(migration).toContain("select cron.schedule('lookup-build', '10 0,6 * * *', $$ select public.lookup_build(); $$);");
    expect(migration).toContain("notify pgrst, 'reload schema';");
    expect(migration).toContain('add column if not exists hp smallint');
    expect(migration).toContain('add column if not exists release_date date');
    expect(migration.match(/^insert into public\.lookup_overrides/gm)).toHaveLength(3);
    expect(migration.match(/on conflict \(kind, key\) do update/g)).toHaveLength(3);
  });

  it('as sementes têm as 9 coleções mistas, as 20 faixas e as 3 correções da especificação', () => {
    const mixed = migration.slice(migration.indexOf("select 'year_mixed'"), migration.indexOf("select 'year_range'"));
    for (const name of [
      'World Championship Decks',
      'Prize Pack Series Cards',
      'Miscellaneous Cards & Products',
      'Deck Exclusives',
      'League & Championship Cards',
      'Jumbo Cards',
      'Blister Exclusives',
      'Professor Program Promos',
      'Alternate Art Promos',
    ]) {
      expect(mixed).toContain(`'${name}'`);
    }
    expect(migration.match(/^\s+\((3|85), '[^']+', '\d{4}-(\d{4})?'\)/gm)).toHaveLength(20);
    expect(migration).toContain("(3, 'SV: Scarlet & Violet Promo Cards', '2023-2025')");
    expect(migration).toContain("(85, 'M-P Promotional Cards', '2025-')");
    expect(migration).toContain("('twin_block', 'SM7a'");
    expect(migration).toContain("('twin_block', 'SM10b'");
    expect(migration).toContain("('dex', 'Dark Exeggcutor', '103'");
  });

  it('o schema.sql espelha a função, as tabelas, as colunas e o cron', () => {
    expect(fn(schema)).toBe(body);
    for (const table of NEW_TABLES) expect(schema).toContain(`alter table public.${table} enable row level security;`);
    expect(schema).toContain('add column if not exists hp smallint');
    expect(schema).toContain('add column if not exists released_on date');
    expect(schema).toContain('alter table public.tcgdex_sets add column if not exists release_date date;');
    expect(schema).toContain("select cron.schedule('lookup-build', '10 0,6 * * *', $$ select public.lookup_build(); $$);");
    expect(schema).toContain('retrato completo da versão 3.4.0');
  });

  it('o texto das colunas sai sem TAB e sem quebra de linha, com as 18 colunas na ordem do formato 1', () => {
    expect(body).toContain("translate(r.name, E'\\t\\n\\r', '   ')");
    const columns = /array\[\s*([\s\S]*?)\s*\]::text\[\]/.exec(body)?.[1].split(/,\s*(?![^(]*\))/) ?? [];
    expect(columns).toHaveLength(18);
    expect(columns[0]).toBe('r.id');
    expect(columns[8]).toBe('r.hp');
    expect(columns[17]).toBe('r.img');
  });

  describe('scripts/lookup-audit.sql', () => {
    const audit = read('scripts/lookup-audit.sql');
    const code = audit.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''");

    it('só lê', () => {
      expect(code.toLowerCase()).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|call)\b/);
      expect(code.trim().toLowerCase().startsWith('with ')).toBe(true);
      expect(code.trim().endsWith(';')).toBe(true);
      expect(code.trim().slice(0, -1)).not.toContain(';');
    });

    it.each([
      '42382', '106999', '252517', '250320', '567024', '609309', '568335', '680962', '614744', '571309', '614370', '477355', '42425', '500263',
      '610590', '566726', '617462', '509812', 'SVAM-001', 'Charizard Spirit Link',
    ])('confere a testemunha %s', (witness) => {
      expect(audit).toContain(witness);
    });
  });
});
