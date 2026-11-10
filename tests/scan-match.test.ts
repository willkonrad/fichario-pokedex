// Casamento da leitura com o índice da Consulta: um índice pequeno, em texto, lido pelo módulo de verdade (sem rede).
import { ensureLookupLoaded } from '@/lib/lookup-index';
import type { CardNumber, CardReading } from '@/lib/card-ocr';
import { matchReading, ocrDictionaries, PT_OR_EN, readingNote, readingQuery, relaxedQuery, type LotLang } from '@/lib/scan-match';

type Row = {
  id: string | number;
  set: string;
  name: string;
  no?: string;
  rarity?: string;
  stamp?: string;
  q?: string;
  hp?: number;
  td?: string;
  prices?: string;
  marks: string;
  twin?: number;
  pn?: string;
};

const NORMAL = 'N:10:20:30';
const REVERSE = 'R:40:50:60';

const header = {
  v: 1,
  prices: '2026-11-08',
  fx: ['2026-11-06', 5.5],
  sets: {
    base: ['en', 'Base Set', 'BS', '1999-01-09', 102],
    shadow: ['en', 'Base Set (Shadowless)', 'BS', '1999-01-09', 102],
    cel: ['en', 'Celebrations: Classic Collection', 'CEL', '2021-10-08', 25],
    gymH: ['en', 'Gym Heroes', 'G1', '2000-08-14', 132],
    gymC: ['en', 'Gym Challenge', 'G2', '2000-10-16', 132],
    mew: ['en', '151', 'MEW', '2023-09-22', 165],
    ba24: ['en', 'Battle Academy 2024', 'BA24', '2024-01-26', 165],
    svi: ['en', 'Scarlet & Violet', 'SVI', '2023-03-31', 198],
    ssh: ['en', 'Sword & Shield', 'SSH', '2020-02-07', 202],
    dupA: ['en', 'Coleção A', 'DUP', '2020-01-01', 100],
    dupB: ['en', 'Coleção B', 'DUP', '2021-01-01', 200],
    pop: ['en', 'POP Series 5', 'POP', '2007-03-01', 17],
    prm: ['en', 'Promos', 'PR', '2007-03-01', 0],
    ptOnly: ['pt', 'Coleção só PT', 'XPT', '2015-01-01', 146],
    jp4a: ['ja', 'Shiny Treasure ex', 'SV4a', '2023-12-01', 190],
    jp8: ['ja', 'Outra japonesa', 'SV8', '2024-10-01', 190],
    sv5k: ['ja', 'Wild Force', 'SV5K', '2024-01-26', 71],
    jpOld: ['ja', 'Old Set', 'OLD', '2009-01-01', 0],
    'zh-tw:SV5K': ['zh-tw', '狂野之力', 'SV5K', '2024-03-01', 71],
  },
  td: { base1: 'BS', sv01: 'SVI', 'sv03.5': 'MEW' },
  only: [],
  limits: {},
};

const line = (r: Row) => [r.id, r.set, r.name, r.no ?? '', '', r.rarity ?? '', r.stamp ?? '', r.q ?? '', r.hp ?? '', '', '', r.td ?? '', r.prices ?? '', r.marks, r.pn ?? '', r.twin ?? ''].join('\t');

const sections: Record<number, Row[]> = {
  1: [
    { id: 't:pt:xy1-1', set: 'ptOnly', name: 'Bulbasaur', no: '1/146', marks: 'p', hp: 60 },
    { id: 11, set: 'mew', name: 'Bulbasaur', no: '001/165', marks: 'e', hp: 40, prices: NORMAL },
    { id: 12, set: 'svi', name: 'Bulbasaur', no: '002/198', marks: 'e', hp: 70, prices: NORMAL },
  ],
  6: [
    { id: 42382, set: 'base', name: 'Charizard', no: '4/102', hp: 120, td: 'base1-4', marks: 'ep', prices: 'UH:1:2:3' },
    { id: 106999, set: 'shadow', name: 'Charizard', no: '4/102', hp: 120, marks: 'e', prices: '1H:1:2:3|UH:1:2:3' },
    { id: 250320, set: 'cel', name: 'Charizard', no: '4/102', hp: 120, marks: 'e', prices: 'H:1:2:3' },
  ],
  7: [
    { id: 70, set: 'mew', name: 'Squirtle', no: '007/165', hp: 40, marks: 'e', prices: NORMAL },
    { id: 71, set: 'svi', name: 'Squirtle', no: '007/198', hp: 60, marks: 'e', prices: NORMAL },
  ],
  8: [
    { id: 80, set: 'mew', name: 'Wartortle', no: '008/165', hp: 70, marks: 'e', prices: NORMAL },
    { id: 81, set: 'svi', name: 'Wartortle', no: '008/198', marks: 'e', prices: NORMAL },
  ],
  19: Array.from({ length: 10 }, (_, i) => ({ id: 1900 + i, set: 'mew', name: 'Rattata', no: `${i + 10}/165`, hp: 30, marks: 'e', prices: NORMAL })),
  25: [
    { id: 25001, set: 'mew', name: 'Pikachu', no: '025/165', hp: 60, td: 'sv03.5-025', marks: 'ep', prices: `${NORMAL}|${REVERSE}` },
    { id: 25002, set: 'ba24', name: 'Pikachu', no: '025/165', hp: 60, marks: 'e', prices: NORMAL },
    { id: 25003, set: 'pop', name: 'Pikachu', no: '12/17', hp: 60, marks: 'e', prices: NORMAL },
    { id: 25004, set: 'prm', name: 'Pikachu', no: 'PR 7', hp: 50, marks: 'e', prices: NORMAL },
    { id: 25005, set: 'jpOld', name: 'Pikachu', q: 'LV.12', marks: 'j', hp: 40, prices: NORMAL },
    { id: 25006, set: 'jpOld', name: 'Pikachu', q: 'LV.15', marks: 'j', hp: 60, prices: NORMAL },
  ],
  43: [{ id: 430, set: 'gymH', name: "Erika's Oddish", no: '39/132', hp: 50, marks: 'e', prices: NORMAL }],
  92: [{ id: 920, set: 'gymC', name: "Sabrina's Gastly", no: '39/132', hp: 40, marks: 'e', prices: NORMAL }],
  132: [{ id: 1320, set: 'dupA', name: 'Ditto', no: '10/100', hp: 60, marks: 'e', prices: NORMAL }],
  133: [
    { id: 1330, set: 'dupB', name: 'Eevee', no: '10/200', hp: 60, marks: 'e', prices: NORMAL },
    { id: 1331, set: 'jp8', name: 'Eevee', no: '031/190', stamp: 'Poke Ball Pattern', marks: 'j', hp: 60, prices: NORMAL },
  ],
  143: [{ id: 1430, set: 'ssh', name: 'Snorlax', no: '143/202', hp: 170, marks: 'e', prices: NORMAL }],
  150: [{ id: 15000, set: 'mew', name: 'Mewtwo', no: '150/165', hp: 130, marks: 'e', prices: 'H:1:2:3' }],
  151: [
    { id: 15100, set: 'mew', name: 'Mew', no: '151/165', hp: 60, td: 'sv03.5-151', marks: 'ep', prices: 'H:1:2:3' },
    { id: 15101, set: 'mew', name: 'Mew', no: '151/165', hp: 60, td: 'sv03.5-151', stamp: 'Jumbo', marks: 'e', prices: 'H:1:2:3' },
    { id: 15102, set: 'mew', name: 'Mew', no: '151/165', hp: 60, td: 'sv03.5-151', stamp: 'Master Ball Pattern', marks: 'e', prices: 'H:1:2:3' },
  ],
  197: [{ id: 567024, set: 'jp4a', name: 'Umbreon', no: '070/108', hp: 110, marks: 'j', prices: NORMAL }],
  288: [{ id: 609309, set: 'jp8', name: 'Vigoroth', no: '070/108', hp: 90, marks: 'j', prices: NORMAL }],
  315: [
    { id: 568335, set: 'sv5k', name: 'Roselia', no: '001/071', hp: 60, marks: 'jk', prices: NORMAL },
    { id: 't:zh-tw:SV5K-001', set: 'zh-tw:SV5K', name: '毒薔薇', no: '001/071', hp: 60, marks: 't', twin: 568335 },
  ],
  948: [{ id: 948001, set: 'svi', name: 'Toedscool', no: '025/198', hp: 60, td: 'sv01-025', marks: 'ep', prices: `${NORMAL}|${REVERSE}` }],
  0: [
    { id: 90, set: 'svi', name: 'Ultra Ball', no: '186/198', marks: 'e', prices: NORMAL },
    { id: 91, set: 'mew', name: 'Ultra Ball', no: '158/165', marks: 'e', prices: NORMAL },
    { id: 92, set: 'svi', name: "Professor's Research", no: '189/198', marks: 'ep', pn: 'Pesquisa do Professor', prices: NORMAL },
  ],
};

const mockBody = [JSON.stringify(header), ...Object.entries(sections).map(([dex, rows]) => `@${dex}\n${rows.map(line).join('\n')}`)].join('\n');

jest.mock('@/lib/lookup-store', () => ({
  readStoredBody: async () => ({ md5: 'teste', body: mockBody }),
  writeStoredBody: async () => {},
  clearStoredBody: async () => {},
  storedMd5: async () => 'teste',
}));

const num = (left: string, total: string | null, kind: CardNumber['kind'] = 'slash'): CardNumber => ({ left, total, kind, score: 10 });

function read(over: Partial<CardReading>): CardReading {
  return { name: null, speciesId: null, speciesFrom: null, hp: null, number: null, setCode: null, langTag: null, regulation: null, year: null, hpWord: null, langWords: null, level: null, script: 'latin', ...over };
}

const english = { hpWord: 'HP', langWords: 'en' } as const;
const match = (r: Partial<CardReading>, lotLang: LotLang = 'auto') => matchReading(read(r), { lotLang });
const keys = (m: ReturnType<typeof match>) => m.candidates.map((c) => c.key);

beforeAll(async () => {
  await ensureLookupLoaded();
});

describe('os passos, do mais forte para o mais fraco', () => {
  it('1. sigla e número com nome e HP: exata', () => {
    const m = match({ speciesId: 948, name: 'Toedscool', hp: 60, number: num('025', '198'), setCode: 'SVI', langTag: 'EN', ...english });
    expect(m).toMatchObject({ status: 'exact', lang: 'en', signals: 4 });
    expect(keys(m)).toEqual(['948001']);
    expect(m.reasons[0]).toBe('Sigla e número');
  });

  it('1. sigla e número batem na categoria do idioma: a mesma sigla japonesa não entra numa carta em inglês', () => {
    expect(match({ number: num('001', '071'), setCode: 'SV5K', script: 'kana' }, 'ja')).toMatchObject({ status: 'exact', lang: 'ja' });
    expect(match({ number: num('001', '071'), setCode: 'SV5K', ...english }, 'en').status).toBe('none');
  });

  it('2. número com total e espécie: exata, sem a sigla', () => {
    const m = match({ speciesId: 197, hp: 110, number: num('070', '108'), script: 'kana' });
    expect(m).toMatchObject({ status: 'exact', lang: 'ja', signals: 3 });
    expect(keys(m)).toEqual(['567024']);
  });

  it('3. número com total sozinho é sempre dúvida, mesmo com uma candidata e o HP certo', () => {
    expect(match({ number: num('143', '202'), hp: 170, ...english })).toMatchObject({ status: 'doubt', lang: 'en' });
    const two = match({ number: num('070', '108'), script: 'kana' });
    expect(two.status).toBe('doubt');
    expect(keys(two).sort()).toEqual(['567024', '609309']);
  });

  it('4. espécie e HP: exata quando só uma carta tem aquele HP', () => {
    const m = match({ speciesId: 7, hp: 60, ...english });
    expect(m).toMatchObject({ status: 'exact', signals: 2 });
    expect(keys(m)).toEqual(['71']);
  });

  it('4. carta da espécie sem HP conhecido impede a certeza', () => {
    const m = match({ speciesId: 8, hp: 70, ...english });
    expect(m.status).toBe('doubt');
    expect(m.reasons).toContain('Há cartas sem HP conhecido');
  });

  it('5. espécie sozinha fica em dúvida', () => {
    const m = match({ speciesId: 7, ...english });
    expect(m).toMatchObject({ status: 'doubt', signals: 1 });
    expect(keys(m)).toHaveLength(2);
  });

  it('6. treinador pelo nome: duas impressões, dúvida', () => {
    const m = match({ name: 'Ultra Ball', ...english });
    expect(m.status).toBe('doubt');
    expect(keys(m).sort()).toEqual(['90', '91']);
  });

  it('6. treinador com sigla e número, ou número e nome: exata', () => {
    expect(match({ name: 'Ultra Ball', setCode: 'SVI', number: num('186', '198'), ...english }).status).toBe('exact');
    expect(match({ name: 'Ultra Ball', number: num('186', '198'), ...english }).status).toBe('exact');
  });

  it('nada no índice: não reconhecida', () => {
    expect(match({ name: 'Coisa nenhuma' })).toMatchObject({ status: 'none', candidates: [], signals: 0 });
  });

  it('mais de 8 candidatas: não reconhecida', () => {
    const m = match({ speciesId: 19, hp: 30, ...english });
    expect(m).toMatchObject({ status: 'none', candidates: [] });
    expect(m.reasons[0]).toContain('mais de 8');
  });
});

describe('colisões já mapeadas', () => {
  it('Base Set × Shadowless: mesma sigla, número e HP: dúvida entre as duas', () => {
    const m = match({ speciesId: 6, hp: 120, number: num('4', '102'), setCode: 'BS', ...english });
    expect(m.status).toBe('doubt');
    expect(keys(m).sort()).toEqual(['106999', '42382']);
  });

  it('Base Set × Classic Collection: sem sigla, dúvida', () => {
    const m = match({ speciesId: 6, hp: 120, number: num('4', '102'), ...english });
    expect(m.status).toBe('doubt');
    expect(keys(m)).toEqual(expect.arrayContaining(['42382', '250320']));
  });

  it('Gym Heroes × Gym Challenge: o número sozinho não decide, a espécie decide', () => {
    expect(match({ number: num('39', '132'), ...english }).status).toBe('doubt');
    const m = match({ speciesId: 92, hp: 40, number: num('39', '132'), ...english });
    expect(m.status).toBe('exact');
    expect(keys(m)).toEqual(['920']);
  });

  it('Battle Academy 2024: a carta repetida da coleção de origem fica em dúvida', () => {
    const m = match({ speciesId: 25, hp: 60, number: num('025', '165'), ...english });
    expect(m.status).toBe('doubt');
    expect(keys(m).sort()).toEqual(['25001', '25002']);
  });
});

describe('contradição derruba', () => {
  const base = { number: num('025', '198'), setCode: 'SVI', langTag: 'EN', ...english };

  it('HP diferente nunca é exata', () => {
    const m = match({ ...base, speciesId: 948, hp: 90 });
    expect(m.status).toBe('doubt');
    expect(m.reasons.join(' ')).toContain('HP diferente');
  });

  it('outra espécie nunca é exata', () => {
    const m = match({ ...base, speciesId: 25, hp: 60 });
    expect(m.status).toBe('doubt');
    expect(m.reasons.join(' ')).toContain('Outra espécie');
  });

  it('número com total diferente nunca é exata, mesmo com espécie e HP certos', () => {
    const m = match({ speciesId: 7, hp: 60, number: num('999', '999'), ...english });
    expect(m.status).toBe('doubt');
    expect(m.reasons.join(' ')).toContain('Número diferente');
  });

  it('linha sem número no índice não contradiz o número lido', () => {
    const m = match({ speciesId: 25, hp: 60, level: 15, number: num('12', '99'), script: 'kana' }, 'ja');
    expect(keys(m)).toEqual(['25006']);
    expect(m.reasons.join(' ')).not.toContain('Número diferente');
  });

  it('Mew não vale para Mewtwo: o nome é comparado em palavra inteira', () => {
    const m = match({ speciesId: 151, number: num('150', '165'), ...english });
    expect(m.status).not.toBe('exact');
  });

  it('sem HP no índice não é contradição', () => {
    const m = match({ number: num('158', '165'), name: 'Ultra Ball', setCode: 'MEW', hp: 60, ...english });
    expect(m.status).toBe('exact');
  });
});

describe('sigla repetida', () => {
  it('confere o total', () => {
    expect(keys(match({ number: num('10', '200'), setCode: 'DUP', ...english }))).toEqual(['1330']);
    expect(keys(match({ number: num('10', '100'), setCode: 'DUP', ...english }))).toEqual(['1320']);
  });

  it('sem total, confere o nome', () => {
    expect(keys(match({ number: num('10', null, 'bare'), setCode: 'DUP', speciesId: 133, ...english }))).toEqual(['1330']);
  });

  it('PR e POP nunca decidem sozinhas', () => {
    expect(match({ number: num('12', '17'), setCode: 'POP', ...english }).reasons[0]).toBe('Só o número');
    expect(match({ number: num('12', '17'), setCode: 'POP', ...english }).status).toBe('doubt');
    const withName = match({ number: num('12', '17'), setCode: 'POP', speciesId: 25, ...english });
    expect(keys(withName)).toEqual(['25003']);
    expect(withName.signals).toBe(2);
  });
});

describe('PT × EN', () => {
  const noHint = { speciesId: 948, hp: 60, number: num('025', '198'), setCode: 'SVI', hpWord: 'HP' } as const;

  it('carta com as duas línguas e nenhuma pista: dúvida, com PT já escolhido', () => {
    const m = match(noHint);
    expect(m).toMatchObject({ status: 'doubt', lang: 'pt' });
    expect(m.reasons).toContain(PT_OR_EN);
  });

  it('cada pista impressa decide', () => {
    expect(match({ ...noHint, langTag: 'PT' })).toMatchObject({ status: 'exact', lang: 'pt' });
    expect(match({ ...noHint, langTag: 'EN' })).toMatchObject({ status: 'exact', lang: 'en' });
    expect(match({ ...noHint, hpWord: 'PS' })).toMatchObject({ status: 'exact', lang: 'pt' });
    expect(match({ ...noHint, langWords: 'pt' })).toMatchObject({ status: 'exact', lang: 'pt' });
    expect(match({ ...noHint, langWords: 'en' })).toMatchObject({ status: 'exact', lang: 'en' });
  });

  it('lote com idioma fixo pula a detecção', () => {
    expect(match(noHint, 'pt')).toMatchObject({ status: 'exact', lang: 'pt' });
    expect(match(noHint, 'en')).toMatchObject({ status: 'exact', lang: 'en' });
  });

  it('carta que só existe em inglês, ou só em português, não pergunta', () => {
    expect(match({ speciesId: 143, hp: 170, number: num('143', '202') })).toMatchObject({ status: 'exact', lang: 'en' });
    expect(match({ speciesId: 1, hp: 60, number: num('1', '146') })).toMatchObject({ status: 'exact', lang: 'pt' });
  });

  it('etiqueta de língua fora do app nunca é exata', () => {
    const m = match({ ...noHint, langTag: 'ES' });
    expect(m.status).toBe('doubt');
    expect(m.reasons.join(' ')).toContain('Etiqueta ES');
  });
});

describe('coreana e chinesa nunca viram japonesa', () => {
  const printed = { speciesId: 315, hp: 60, number: num('001', '071'), setCode: 'SV5K' };

  it('hangul é coreana, mesmo em lote de japonesas', () => {
    expect(match({ ...printed, script: 'hangul' }).lang).toBe('ko');
    expect(match({ ...printed, script: 'hangul' }, 'ja').lang).toBe('ko');
  });

  it('hanzi sem kana é chinesa, mesmo em lote de japonesas', () => {
    expect(match({ ...printed, script: 'hanzi' }).lang).toBe('zh');
    expect(match({ ...printed, script: 'hanzi' }, 'ja').lang).toBe('zh');
  });

  it('carta coreana sem gêmea marcada não cai na linha japonesa', () => {
    expect(match({ speciesId: 197, hp: 110, number: num('070', '108'), script: 'hangul' })).toMatchObject({ status: 'none', lang: 'ko' });
  });

  it('em lote de japonesas, sem kana na leitura não é exata', () => {
    const m = match({ ...printed, script: 'latin' }, 'ja');
    expect(m).toMatchObject({ status: 'doubt', lang: 'ja' });
    expect(match({ ...printed, script: 'kana' }, 'ja').status).toBe('exact');
  });

  it('latino sem pista nunca escolhe a linha japonesa', () => {
    expect(match({ speciesId: 197, hp: 110, number: num('070', '108') }).status).toBe('none');
  });
});

describe('selos e versões', () => {
  const mew = { speciesId: 151, hp: 60, number: num('151', '165'), setCode: 'MEW', langTag: 'EN', ...english };

  it('linha com selo não empata: vira opção de versão, com Jumbo por último', () => {
    const m = match(mew);
    expect(m).toMatchObject({ status: 'exact', needsVersion: true });
    expect(keys(m)).toEqual(['15100', '15102', '15101']);
  });

  it('só linhas com selo: dúvida, nunca exata', () => {
    expect(match({ number: num('031', '190'), setCode: 'SV8', speciesId: 133, script: 'kana' }, 'ja').status).toBe('doubt');
  });

  it('uma impressão só e sem selo: não pede versão', () => {
    expect(match({ speciesId: 143, hp: 170, number: num('143', '202') }).needsVersion).toBe(false);
  });

  it('mais de uma impressão: pede versão', () => {
    expect(match({ speciesId: 948, hp: 60, number: num('025', '198'), setCode: 'SVI', langTag: 'EN' }).needsVersion).toBe(true);
  });
});

describe('dicas', () => {
  it('LV.xx separa as japonesas antigas', () => {
    expect(keys(match({ speciesId: 25, level: 12, script: 'kana' }))).toEqual(['25005']);
    expect(keys(match({ speciesId: 25, level: 15, script: 'kana' }))).toEqual(['25006']);
  });

  it('o © só põe na frente quem bate o ano, sem tirar ninguém', () => {
    const m = match({ speciesId: 6, hp: 120, number: num('4', '102'), year: 2021, ...english });
    expect(keys(m)[0]).toBe('250320');
    expect(keys(m)).toHaveLength(3);
  });
});

describe('dicionários do leitor', () => {
  it('nomes das línguas, siglas das coleções e da TCGdex, treinadores', () => {
    const dict = ocrDictionaries();
    expect(dict.species[24].names).toEqual(['Pikachu', 'ピカチュウ', '피카츄', '皮卡丘', '皮卡丘']);
    expect(dict.setCodes).toEqual(expect.arrayContaining(['SVI', 'MEW', 'BS', 'SV5K', 'POP']));
    expect(dict.trainers).toEqual(expect.arrayContaining(['Ultra Ball', "Professor's Research", 'Pesquisa do Professor']));
  });

  it('é calculado uma vez por índice', () => {
    expect(ocrDictionaries()).toBe(ocrDictionaries());
  });
});

describe('texto para o campo da Consulta', () => {
  const umbreon = { dex: 197, name: 'Umbreon', hp: 110, number: num('070', '108') };

  it('leva o que foi lido', () => {
    expect(readingQuery(umbreon)).toBe('umbreon 110 070/108');
    expect(readingQuery({ dex: 197, name: null, hp: null, number: null })).toBe('umbreon');
    expect(readingNote(umbreon)).toBe('Lido: Umbreon · HP 110 · 070/108');
    expect(readingNote({ dex: null, name: null, hp: null, number: null })).toBe('Não consegui ler o nome da carta');
  });

  it('com resultado, não tira nada', () => {
    expect(relaxedQuery(umbreon, 'ja')).toEqual({ text: 'umbreon 110 070/108', dropped: null });
  });

  it('sem resultado, tira o número e avisa', () => {
    expect(relaxedQuery({ ...umbreon, number: num('071', '108') }, 'ja')).toEqual({ text: 'umbreon 110', dropped: 'Sem o nº lido (071/108)' });
  });

  it('e depois o HP', () => {
    expect(relaxedQuery({ ...umbreon, hp: 200, number: num('071', '108') }, 'ja')).toEqual({ text: 'umbreon', dropped: 'Sem o nº lido (071/108) · Sem o HP lido (200)' });
  });

  it('o idioma do chip restringe a conta', () => {
    expect(relaxedQuery(umbreon, 'en')).toEqual({ text: 'umbreon 110 070/108', dropped: null });
  });
});
