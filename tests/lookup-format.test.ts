import { allowsLang, numberKey, numberKeys, parseHeader, parseRow, sectionTable, stampKind } from '@/lib/lookup-format';
import { LOOKUP_FORMAT } from '@/lib/lookup-types';

import { header, jaCard, lookupCard, RAW_HEADER, zhCard } from './lookup-fixtures';

// Formato 1 do índice (seção 5 da especificação): cabeçalho, seções, colunas cortadas e números.

const YEAR_NOW = new Date().getFullYear();

describe('parseHeader', () => {
  const h = header();

  it('lê data dos preços, câmbio, siglas, coleções sem cartas e limites', () => {
    expect(h.v).toBe(LOOKUP_FORMAT);
    expect(h.pricesDay).toBe('2026-11-08');
    expect(h.fxDay).toBe('2026-11-06');
    expect(h.fxSell).toBe(5.5);
    expect(h.tdAbbr.get('base1')).toBe('BS');
    expect(h.only).toEqual([{ lang: 'ko', name: 'Coleção sem lista', date: '2024-07-01', total: 60 }]);
    expect(h.limits).toEqual({ ko: '2024-06', zh: '2025-05' });
  });

  it('coleção sem lista repetida pela fonte aparece uma vez; sem total quando as repetidas não concordam', () => {
    const only = (rows: unknown[]) => parseHeader(JSON.stringify({ v: LOOKUP_FORMAT, only: rows })).only;
    // Como a TCGdex coreana em 11/2026: CS1a, CS4… e S11 com o nome de Triplet Beat.
    expect(
      only([
        ['ko', '트리플렛비트', null, 101],
        ['ko', '트리플렛비트', null, 101],
        ['ko', '트리플렛비트', null, 100],
        ['zh-tw', '三連音爆', '2024-04-26', 101],
        ['zh-tw', '三連音爆', '2024-04-26', 101],
        ['ko', '스카이레전드', '2019-04-26', 54],
      ]),
    ).toEqual([
      { lang: 'ko', name: '트리플렛비트', date: null, total: null },
      { lang: 'zh-tw', name: '三連音爆', date: '2024-04-26', total: 101 },
      { lang: 'ko', name: '스카이레전드', date: '2019-04-26', total: 54 },
    ]);
    // O mesmo nome em outra língua é outra coleção.
    expect(only([['zh-tw', 'X', null, 1], ['zh-cn', 'X', null, 2]])).toHaveLength(2);
  });

  it('lê cada coleção, sem data e sem total como null', () => {
    expect(h.sets.get('604')).toEqual({ key: '604', lang: 'en', name: 'Base Set', abbr: 'BS', date: '1999-01-09', total: 102, yearFrom: null, yearTo: null, pricesDay: null });
    expect(h.sets.get('zh-cn:CSM1')).toMatchObject({ lang: 'zh-cn', date: null, total: null });
  });

  it('dia do preço só quando difere e faixa de promos, com fim 0 até o ano atual', () => {
    expect(h.sets.get('23353')?.pricesDay).toBe('2026-11-07');
    expect(h.sets.get('1938')).toMatchObject({ yearFrom: 2023, yearTo: 2025 });
    expect(h.sets.get('3000')).toMatchObject({ yearFrom: 2025, yearTo: YEAR_NOW });
  });

  it('formato maior que o conhecido devolve a versão, para quem chamou tratar como sem índice', () => {
    const later = parseHeader(JSON.stringify({ ...RAW_HEADER, v: LOOKUP_FORMAT + 1, novo: { qualquer: 1 } }));
    expect(later.v).toBeGreaterThan(LOOKUP_FORMAT);
  });

  it('cabeçalho quebrado ou sem versão lança erro', () => {
    expect(() => parseHeader('{"v":1,')).toThrow();
    expect(() => parseHeader('{"prices":"2026-11-08"}')).toThrow();
  });
});

describe('sectionTable', () => {
  const body = 'cabecalho\n@6\nlinha-a\nlinha-b\n@25\nlinha-c\n@150\n@0\nlinha-d\n';
  const table = sectionTable(body);
  const text = (dex: number) => {
    const range = table.get(dex)!;
    return body.slice(range.start, range.end);
  };

  it('marca cada seção sem a linha do título, na ordem do arquivo', () => {
    expect([...table.keys()]).toEqual([6, 25, 150, 0]);
    expect(text(6)).toBe('linha-a\nlinha-b');
    expect(text(25)).toBe('linha-c');
    expect(text(0)).toBe('linha-d\n');
  });

  it('seção vazia e arquivo sem seção', () => {
    expect(text(150)).toBe('');
    expect(sectionTable('cabecalho').size).toBe(0);
  });

  it('título no fim, sem quebra de linha', () => {
    const last = 'cabecalho\n@6\nlinha\n@7';
    expect(sectionTable(last).get(7)).toEqual({ start: last.length, end: last.length });
    expect(sectionTable(last).get(6)).toEqual({ start: 13, end: 18 });
  });
});

describe('parseRow', () => {
  const h = header();
  const row = (cols: string[], dex = 6) => parseRow(cols.join('\t'), dex, h);

  it('lê todas as colunas', () => {
    const cols = ['42382', '604', 'Charizard', '4/102', '', 'Holo Rare', '', 'Lv.13', '120', 'Fire', 'Stage 2', 'base1-4', '1H:9000:9500:10000|U::2000:', 'ep', 'Charizard PT', '', '', 'en/base/base1/4'];
    expect(row(cols)).toEqual({
      key: '42382',
      productId: 42382,
      set: h.sets.get('604'),
      name: 'Charizard',
      ptName: 'Charizard PT',
      number: '4/102',
      altNumber: undefined,
      rarity: 'Holo Rare',
      stamp: undefined,
      qualifier: 'Lv.13',
      hp: 120,
      hpFromTwin: false,
      cardType: 'Fire',
      stage: 'Stage 2',
      tcgdexId: 'base1-4',
      prints: [
        { code: '1H', low: 9000, mid: 9500, market: 10000 },
        { code: 'U', low: null, mid: 2000, market: null },
      ],
      marks: 'ep',
      twinProductId: undefined,
      year: { kind: 'year', year: 1999, origin: 'set' },
      imagePath: 'en/base/base1/4',
      dex: 6,
    });
  });

  it('colunas vazias no fim vêm cortadas', () => {
    const c = parseRow('t:pt:base1-4\tpt:sv03\tCharizard', 6, h);
    expect(c).toMatchObject({ key: 't:pt:base1-4', productId: null, number: '', hp: null, prints: [], marks: '' });
    expect(c.imagePath).toBeUndefined();
    expect(c.rarity).toBeUndefined();
  });

  it('impressão com código desconhecido fica de fora', () => {
    expect(row(['1', '604', 'X', '', '', '', '', '', '', '', '', '', 'N:1:2:3|Z:9:9:9']).prints.map((p) => p.code)).toEqual(['N']);
  });

  it('HP da gêmea vem marcado; HP estranho vira desconhecido', () => {
    expect(row(['1', '604', 'X', '', '', '', '', '', '60j'])).toMatchObject({ hp: 60, hpFromTwin: true });
    expect(row(['1', '604', 'X', '', '', '', '', '', '??'])).toMatchObject({ hp: null, hpFromTwin: false });
  });

  it('gêmea em ZH', () => {
    expect(row(['t:zh-tw:SV5K-001', 'zh-tw:SV5K', '毒薔薇', '001/071', '', '', '', '', '60j', '', '', 'SV5K-001', '', 't', '', '568335']).twinProductId).toBe(568335);
  });

  const yearOf = (set: string, year: string) => row(['1', set, 'X', '', '', '', '', '', '', '', '', '', '', '', '', '', year]).year;

  it('ano: coluna vence a coleção, com a origem', () => {
    expect(yearOf('604', '2004n')).toEqual({ kind: 'year', year: 2004, origin: 'name' });
    expect(yearOf('604', '1999o')).toEqual({ kind: 'year', year: 1999, origin: 'original' });
    expect(yearOf('604', '2023j')).toEqual({ kind: 'year', year: 2023, origin: 'japan' });
    expect(yearOf('604', '-')).toEqual({ kind: 'none' });
  });

  it('ano vazio: o da coleção; faixa de promos; coleção sem data', () => {
    expect(yearOf('604', '')).toEqual({ kind: 'year', year: 1999, origin: 'set' });
    expect(yearOf('1938', '')).toEqual({ kind: 'range', from: 2023, to: 2025 });
    expect(yearOf('zh-cn:CSM1', '')).toEqual({ kind: 'none' });
  });

  it('coleção que o cabeçalho não traz não quebra a linha', () => {
    expect(row(['1', '999', 'X'])).toMatchObject({ name: 'X', set: { key: '999', name: '', date: null } });
  });
});

describe('numberKeys', () => {
  const keys = (number: string, altNumber?: string) => numberKeys({ number, altNumber });

  it('normaliza zeros, inclusive depois de letras', () => {
    expect(keys('070/108')).toEqual(['70/108']);
    expect(keys('TG05/TG30')).toEqual(['tg5/tg30']);
    expect(keys('SWSH001')).toEqual(['swsh1']);
    expect(keys('000/100')).toEqual(['0/100']);
  });

  it('"004/102" e "4/102" são a mesma chave', () => {
    expect(keys('004/102')).toEqual(keys('4/102'));
  });

  it('total com letras', () => {
    expect(keys('001/SV-P')).toEqual(['1/svp']);
    expect(keys('120/SV-P', '291/SV-P')).toEqual(['120/svp', '291/svp']);
  });

  it('separa duas cartas num número só', () => {
    expect(keys('099/102 & 100/102')).toEqual(['99/102', '100/102']);
    expect(keys('101/102 + 102/102')).toEqual(['101/102', '102/102']);
    expect(keys('071/076 / 072/076')).toEqual(['71/76', '72/76']);
  });

  it('tira sufixos e complementos', () => {
    expect(keys('101/078 SAR')).toEqual(['101/78']);
    expect(keys('056/184 (Top Left)')).toEqual(['56/184']);
    expect(numberKey('PW 7')).toBe('pw7');
  });

  it('descarta o que não é número', () => {
    expect(keys('WAT')).toEqual([]);
    expect(keys('N/A')).toEqual([]);
    expect(keys('ONE')).toEqual([]);
    expect(keys('')).toEqual([]);
  });

  it('não repete a mesma chave', () => {
    expect(keys('4/102', '004/102')).toEqual(['4/102']);
  });
});

describe('allowsLang', () => {
  it('PT aceita confirmada e não confirmada', () => {
    expect(allowsLang(lookupCard({ marks: 'ep' }), 'pt')).toBe(true);
    expect(allowsLang(lookupCard({ marks: 'eu' }), 'pt')).toBe(true);
    expect(allowsLang(lookupCard({ marks: 'e' }), 'pt')).toBe(false);
  });

  it('KO aceita a gêmea e a "pela coleção"; ZH, as duas escritas', () => {
    expect(allowsLang(jaCard({ marks: 'jk' }), 'ko')).toBe(true);
    expect(allowsLang(jaCard({ marks: 'ji' }), 'ko')).toBe(true);
    expect(allowsLang(jaCard({ marks: 'j' }), 'ko')).toBe(false);
    expect(allowsLang(zhCard({ marks: 't' }), 'zh')).toBe(true);
    expect(allowsLang(zhCard({ marks: 'c' }), 'zh')).toBe(true);
  });

  it('EN e JP pela marca própria', () => {
    expect(allowsLang(lookupCard({ marks: 'ep' }), 'en')).toBe(true);
    expect(allowsLang(lookupCard({ marks: 'ep' }), 'ja')).toBe(false);
    expect(allowsLang(jaCard({ marks: 'j' }), 'ja')).toBe(true);
  });
});

describe('stampKind', () => {
  it.each([
    ['Staff', 'staff'],
    ['Prerelease', 'staff'],
    ['Master Ball Pattern', 'masterball'],
    ['Poké Ball Pattern', 'pokeball'],
    ['Mirror Holofoil', 'mirror'],
    ['Reverse Holofoil', 'reverse'],
    ['Cosmos Holo', 'holo'],
    ['1st Edition', 'firstEdition'],
    ['Pokemon Center Exclusive', 'stamp'],
  ])('%s → %s', (stamp, kind) => {
    expect(stampKind(stamp)).toBe(kind);
  });

  it('"Non-Holo" não muda a versão', () => {
    expect(stampKind('Non-Holo')).toBeNull();
  });
});
