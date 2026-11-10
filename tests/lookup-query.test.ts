import { hpTermToNumber, parseLookupQuery, rarityCode, rarityLabel, toggleTerm, type QueryContext } from '@/lib/lookup-query';

// O campo único da Consulta (seção 7.4): cada linha da gramática, nomes difíceis, HP × número e os chips.

const CHARIZARD = 6;
const PIKACHU = 25;
const YEAR_NOW = new Date().getFullYear();

const hps: Record<number, number[]> = { [CHARIZARD]: [120, 150], [PIKACHU]: [60, 70, 120] };
const ctx: QueryContext = {
  hpsOf: (dex) => new Set(hps[dex] ?? []),
  countOf: (dex) => (dex === CHARIZARD ? 318 : dex === 4 ? 180 : 10),
  abbrsOf: (dex) => new Set(dex === CHARIZARD ? ['sv3a', 'M6A', 'EX'] : []),
  isSetAbbr: (abbr) => ['MEG', 'SVI', 'TR'].includes(abbr.toUpperCase()),
};
const parse = (text: string, c: QueryContext = ctx) => parseLookupQuery(text, c);

describe('correções do leilão', () => {
  it('número com zero à esquerda é número, nunca HP', () => {
    expect(parse('pikachu 060')).toMatchObject({ filters: { hp: null, number: '60' } });
    expect(parse('pikachu 060').hpOrNumber).toBeUndefined();
    expect(parse('pikachu 60')).toMatchObject({ hpOrNumber: '60', filters: { hp: 60, number: null } });
  });

  it.each(['hp 60', 'hp120', 'ps 60', '120hp'])('%s sem espécie é HP, não a sigla HP ou PS', (text) => {
    const q = parse(text);
    expect(q.code).toBeUndefined();
    expect(q.mode).toBe('empty');
    expect(q.filters.hp).not.toBeNull();
  });

  it('a coleção HP com número e total continua sendo sigla', () => {
    expect(parse('HP 60/110')).toMatchObject({ mode: 'code', code: { abbr: 'HP' } });
  });

  it('o chip de HP não apaga um número que só parece HP', () => {
    const read = (t: string) => parse(t);
    expect(read('charizard 30')).toMatchObject({ filters: { number: '30', hp: null } });
    expect(toggleTerm('charizard 30', '120', read)).toBe('charizard 30 120');
    // Sendo mesmo HP, o novo troca o antigo.
    expect(toggleTerm('charizard 150', '120', read)).toBe('charizard 120');
  });
});

describe('nome', () => {
  it('vazio', () => {
    expect(parse('   ').mode).toBe('empty');
  });

  it('espécie igual, com a sugestão em primeiro', () => {
    const q = parse('charizard');
    expect(q).toMatchObject({ mode: 'species', dex: CHARIZARD });
    expect(q.suggestions[0]).toMatchObject({ species: { id: CHARIZARD }, count: 318 });
  });

  it('começo do nome: quem tem mais cartas é o 1º lugar', () => {
    const q = parse('char');
    expect(q.dex).toBe(CHARIZARD);
    expect(q.suggestions[1].species.id).toBe(4);
  });

  it.each([
    ['Mr Mime', 122],
    ['mr. mime', 122],
    ['Ho-Oh', 250],
    ['ho oh', 250],
    ['Porygon Z', 474],
    ['porygon 2', 233],
    ['Type Null', 772],
    ['Type: Null', 772],
    ['farfetchd', 83],
    ['flabebe', 669],
    ['nidoran femea', 29],
  ])('nome difícil: %s', (text, dex) => {
    expect(parse(text)).toMatchObject({ mode: 'species', dex });
  });

  it('nome difícil seguido de filtro', () => {
    expect(parse('mr mime 2016')).toMatchObject({ dex: 122, filters: { year: 2016 } });
    expect(parse('porygon z 90 jp')).toMatchObject({ dex: 474, filters: { lang: 'ja' } });
  });

  it('nome igual vale em qualquer posição: "mega charizard" não é Meganium', () => {
    expect(parse('mega charizard')).toMatchObject({ dex: CHARIZARD, filters: { nameTerms: ['mega'] } });
    expect(parse('jp umbreon')).toMatchObject({ dex: 197, filters: { lang: 'ja' } });
    expect(parse('team rocket mewtwo')).toMatchObject({ dex: 150, filters: { nameTerms: ['team', 'rocket'] } });
  });

  it('palavra de filtro antes de um pedaço de nome', () => {
    expect(parse('jp umbr')).toMatchObject({ dex: 197, filters: { lang: 'ja' } });
    expect(parse('mega char')).toMatchObject({ dex: CHARIZARD, filters: { nameTerms: ['mega'] } });
    expect(parse('hp 120 char')).toMatchObject({ dex: CHARIZARD, filters: { hp: 120 } });
  });
});

describe('gramática dos termos', () => {
  it.each([
    ['charizard 070/108', '70/108'],
    ['charizard 4/102', '4/102'],
    ['charizard TG05/TG30', 'tg5/tg30'],
    ['pikachu 001/SV-P', '1/svp'],
  ])('com barra é número: %s', (text, number) => {
    expect(parse(text).filters.number).toBe(number);
  });

  it.each(['hp120', 'ps120', '120hp', 'HP120', 'hp 120', 'ps 120'])('HP escrito: %s', (term) => {
    const q = parse(`charizard ${term}`);
    expect(q.filters.hp).toBe(120);
    expect(q.filters.number).toBeNull();
    expect(q.hpOrNumber).toBeUndefined();
  });

  it('4 dígitos de 1996 ao ano atual são ano', () => {
    expect(parse('pikachu 2016').filters.year).toBe(2016);
    expect(parse('pikachu 1996').filters.year).toBe(1996);
    expect(parse(`pikachu ${YEAR_NOW}`).filters.year).toBe(YEAR_NOW);
  });

  it('fora da faixa de anos é número', () => {
    expect(parse('pikachu 1995')).toMatchObject({ filters: { year: null, number: '1995' } });
    expect(parse(`pikachu ${YEAR_NOW + 1}`)).toMatchObject({ filters: { year: null, number: String(YEAR_NOW + 1) } });
  });

  it('múltiplo de 10 que existe como HP desta espécie é HP', () => {
    expect(parse('charizard 150').filters.hp).toBe(150);
  });

  it('múltiplo de 10 sem esse HP é número', () => {
    expect(parse('charizard 60')).toMatchObject({ filters: { hp: null, number: '60' } });
  });

  it('outros dígitos são número, sem os zeros', () => {
    expect(parse('pikachu 25').filters.number).toBe('25');
    expect(parse('pikachu 025').filters.number).toBe('25');
  });

  it.each([
    ['pt', 'pt'],
    ['en', 'en'],
    ['jp', 'ja'],
    ['ja', 'ja'],
    ['ko', 'ko'],
    ['kr', 'ko'],
    ['zh', 'zh'],
    ['cn', 'zh'],
    ['tw', 'zh'],
  ])('idioma: %s', (word, lang) => {
    expect(parse(`pikachu ${word}`).filters.lang).toBe(lang);
  });

  it.each([
    ['sar', 'SAR'],
    ['ar', 'AR'],
    ['sr', 'SR'],
    ['ur', 'UR'],
    ['hr', 'HR'],
  ])('raridade: %s', (word, code) => {
    expect(parse(`pikachu ${word}`).filters.rarity).toBe(code);
  });

  it.each([
    ['holo', 'holo'],
    ['rev', 'reverse'],
    ['reverse', 'reverse'],
    ['1ed', 'firstEdition'],
    ['selo', 'stamp'],
    ['promo', 'stamp'],
    ['staff', 'staff'],
    ['pokeball', 'pokeball'],
    ['masterball', 'masterball'],
    ['mirror', 'mirror'],
  ])('variação: %s', (word, variant) => {
    expect(parse(`pikachu ${word}`).filters.variant).toBe(variant);
  });

  it('sigla da coleção da espécie, sem depender de maiúscula', () => {
    expect(parse('charizard sv3a').filters.setKey).toBe('sv3a');
    expect(parse('charizard m6a').filters.setKey).toBe('M6A');
  });

  it('número com letras fora das siglas', () => {
    expect(parse('charizard TG05').filters.number).toBe('tg5');
  });

  it.each(['ex', 'gx', 'v', 'vmax', 'mega'])('resto é parte do nome: %s', (word) => {
    // "EX" é sigla de coleção do Charizard neste contexto: como parte de nome, ganha.
    expect(parse(`charizard ${word}`).filters).toMatchObject({ nameTerms: [word], setKey: null });
  });

  it('junta vários termos', () => {
    expect(parse('charizard 120 2023 jp sar').filters).toMatchObject({ hp: 120, year: 2023, lang: 'ja', rarity: 'SAR' });
  });

  it('palavra que existe em objetos do JavaScript não vira filtro', () => {
    const q = parse('pikachu constructor');
    expect(q.filters).toMatchObject({ lang: null, variant: null, nameTerms: ['constructor'] });
    expect(parse('constructor').filters.lang).toBeNull();
  });
});

describe('sem espécie', () => {
  it('só dígitos é a espécie daquele número', () => {
    expect(parse('25')).toMatchObject({ mode: 'species', dex: PIKACHU });
    expect(parse('#25')).toMatchObject({ mode: 'species', dex: PIKACHU });
    expect(parse('025')).toMatchObject({ mode: 'species', dex: PIKACHU });
  });

  it('só dígitos além da Pokédex é número', () => {
    expect(parse('9999')).toMatchObject({ mode: 'number', dex: null, filters: { number: '9999' } });
  });

  it.each([
    ['070/108', '70/108'],
    ['4/102', '4/102'],
    ['TG05/TG30', 'tg5/tg30'],
    ['001/SV-P', '1/svp'],
  ])('número com barra, em todas as cartas: %s', (text, number) => {
    const q = parse(text);
    expect(q).toMatchObject({ mode: 'number', dex: null, filters: { number } });
    expect(q.code).toBeUndefined();
  });

  it('número com barra e filtro não vira sigla', () => {
    expect(parse('070/108 jp')).toMatchObject({ mode: 'number', filters: { number: '70/108', lang: 'ja' } });
    expect(parse('pt 4/102')).toMatchObject({ mode: 'number', filters: { number: '4/102', lang: 'pt' } });
    expect(parse('4/102 holo')).toMatchObject({ mode: 'number', filters: { number: '4/102', variant: 'holo' } });
    expect(parse('217/187 sar')).toMatchObject({ mode: 'number', filters: { number: '217/187', rarity: 'SAR' } });
  });

  it.each([
    ['M5 088', 'M5', '088'],
    ['SVI 25', 'SVI', '25'],
    ['sv3a 25', 'SV3A', '25'],
    ['MEG 133/132', 'MEG', '133'],
    ['133/132 MEG', 'MEG', '133'],
  ])('sigla + número: %s', (text, abbr, number) => {
    expect(parse(text)).toMatchObject({ mode: 'code', dex: null, code: { abbr, number } });
  });

  it('sigla que também começa um nome: "MEG 133" não é Meganium', () => {
    expect(parse('MEG 133')).toMatchObject({ mode: 'code', code: { abbr: 'MEG' } });
    // Sem saber as siglas, fica o nome.
    const { isSetAbbr: _ignored, ...plain } = ctx;
    expect(parse('MEG 133', plain).mode).toBe('species');
  });

  it('pedaço de nome que é sigla, sem número, continua sendo o nome', () => {
    expect(parse('meg')).toMatchObject({ mode: 'species', dex: 154 });
  });

  it('sigla que também é raridade continua sigla quando a coleção existe', () => {
    expect(parse('TR 25')).toMatchObject({ mode: 'code', code: { abbr: 'TR', number: '25' } });
  });

  it('sigla + número continua aceitando filtros', () => {
    expect(parse('SVI 25 jp')).toMatchObject({ mode: 'code', filters: { lang: 'ja' } });
  });

  it('3 letras ou mais sem espécie: treinador ou energia', () => {
    expect(parse('professor oak')).toMatchObject({ mode: 'trainer', text: 'professor oak' });
    expect(parse('zzq')).toMatchObject({ mode: 'trainer', text: 'zzq' });
  });

  it('menos de 3 letras sem espécie não busca', () => {
    expect(parse('zq').mode).toBe('empty');
  });

  it('chinês sem espécie também vai para treinador', () => {
    expect(parse('訓練家')).toMatchObject({ mode: 'trainer', text: '訓練家' });
  });
});

describe('nome de treinador que começa como espécie', () => {
  // Treinadores do índice de mentira: cada frase com todas as palavras de um deles acha cartas.
  const TRAINERS = ['dark patch', 'great ball', 'poke ball', 'dusk ball', 'air balloon', 'pal pad', "pikachu's summer vacation"];
  const withTrainers: QueryContext = {
    ...ctx,
    trainerCount: (words) => TRAINERS.filter((t) => words.toLowerCase().split(' ').every((w) => t.includes(w))).length,
  };
  const read = (text: string) => parse(text, withTrainers);

  it.each(['dark patch', 'great ball', 'poke ball', 'dusk ball', 'air balloon', 'pal pad'])('%s é o treinador', (text) => {
    expect(read(text)).toMatchObject({ mode: 'trainer', text, dex: null, suggestions: [] });
  });

  it('filtros digitados continuam valendo no treinador', () => {
    expect(read('great ball jp')).toMatchObject({ mode: 'trainer', text: 'great ball', filters: { lang: 'ja' } });
  });

  it('sem treinador com essas palavras, continua a espécie', () => {
    expect(read('dark zzz')).toMatchObject({ mode: 'species', dex: 491, filters: { nameTerms: ['zzz'] } });
  });

  it('ex, V, VMAX… são parte do nome: "pika v" segue Pikachu V', () => {
    const always: QueryContext = { ...ctx, trainerCount: () => 5 };
    expect(parse('pika v', always)).toMatchObject({ mode: 'species', dex: PIKACHU, filters: { nameTerms: ['v'] } });
    expect(parse('char ex', always)).toMatchObject({ mode: 'species', dex: CHARIZARD });
  });

  it('nome igual não é trocado por treinador', () => {
    const always: QueryContext = { ...ctx, trainerCount: () => 5 };
    expect(parse('charizard patch', always)).toMatchObject({ mode: 'species', dex: CHARIZARD });
  });

  it('sem saber dos treinadores, fica como antes', () => {
    expect(parse('dark patch')).toMatchObject({ mode: 'species', dex: 491 });
  });
});

describe('número e nome escritos de outro jeito', () => {
  it.each([
    ['charizard-gx', CHARIZARD, 'gx'],
    ['charizard-ex', CHARIZARD, 'ex'],
    ['Pikachu-GX', PIKACHU, 'GX'],
    ['mewtwo-ex', 150, 'ex'],
    ['mew-ex', 151, 'ex'],
  ])('hífen antes de EX ou GX: %s', (text, dex, term) => {
    expect(parse(text)).toMatchObject({ mode: 'species', dex, filters: { nameTerms: [term] } });
  });

  it('"M Charizard-EX" é Charizard, não Mewtwo', () => {
    expect(parse('M Charizard-EX')).toMatchObject({ mode: 'species', dex: CHARIZARD });
  });

  it('o hífen de outros nomes fica', () => {
    expect(parse('Ho-Oh')).toMatchObject({ mode: 'species', dex: 250 });
    expect(parse('pikachu 001/SV-P').filters.number).toBe('1/svp');
  });

  it.each(['070 / 108', '70 / 108', '070 /108', '070/ 108', '70 108'])('número com espaços: %s', (text) => {
    expect(parse(text)).toMatchObject({ mode: 'number', dex: null, filters: { number: '70/108' } });
  });

  it('com espaços, o total de letras também junta', () => {
    expect(parse('001 / SV-P').filters.number).toBe('1/svp');
    expect(parse('charizard 4 / 102').filters.number).toBe('4/102');
  });

  it('dois números depois do nome são número e total', () => {
    expect(parse('pikachu 4 102')).toMatchObject({ dex: PIKACHU, filters: { number: '4/102', hp: null } });
    // HP que a espécie tem continua sendo HP.
    expect(parse('charizard 4 120')).toMatchObject({ filters: { number: '4', hp: 120 } });
  });

  it('barra entre nomes não vira número', () => {
    expect(parse('Pikachu / Zekrom')).toMatchObject({ mode: 'species', dex: PIKACHU });
  });
});

describe('sigla que também é nome de espécie (MEW)', () => {
  const MEW = 151;
  const withMew = (mewHas: string[], codeHits = 1): QueryContext => ({
    ...ctx,
    isSetAbbr: (abbr) => ['MEG', 'SVI', 'TR', 'MEW'].includes(abbr.toUpperCase()),
    matchCount: (dex, f) => (dex === MEW && (f.number == null || mewHas.includes(f.number)) ? 3 : 0),
    codeCount: (abbr) => (abbr.toUpperCase() === 'MEW' ? codeHits : 0),
  });

  it.each(['MEW 199', 'MEW 199/165', '199/165 MEW'])('o Mew sem esse número dá a vez à sigla: %s', (text) => {
    expect(parse(text, withMew(['6']))).toMatchObject({ mode: 'code', dex: null, code: { abbr: 'MEW', number: '199' } });
  });

  it('"mew 6" é o Mew ex 006/044, não o Charizard ex 006/165', () => {
    expect(parse('mew 6', withMew(['6']))).toMatchObject({ mode: 'species', dex: MEW, filters: { number: '6' } });
  });

  it('sem carta na sigla também, fica o Mew (com o aviso dos filtros)', () => {
    expect(parse('MEW 199', withMew(['6'], 0))).toMatchObject({ mode: 'species', dex: MEW });
  });

  it('só o nome continua sendo o Mew', () => {
    expect(parse('mew', withMew([]))).toMatchObject({ mode: 'species', dex: MEW });
  });

  it('a sigla leva os outros filtros, não os do Mew', () => {
    expect(parse('MEW 199 jp', withMew([]))).toMatchObject({ mode: 'code', filters: { lang: 'ja', number: null } });
  });
});

describe('HP × número', () => {
  it('"120" que é HP vale HP e a tela oferece trocar', () => {
    expect(parse('charizard 120')).toMatchObject({ hpOrNumber: '120', filters: { hp: 120, number: null } });
  });

  it('trocar para número: o termo passa a valer número', () => {
    const swapped = hpTermToNumber('charizard 120', '120');
    expect(swapped).toBe('charizard #120');
    expect(parse(swapped)).toMatchObject({ filters: { hp: null, number: '120' } });
    expect(parse(swapped).hpOrNumber).toBeUndefined();
  });
});

describe('toggleTerm', () => {
  it.each([
    ['pikachu', '120'],
    ['pikachu', 'sar'],
    ['pikachu', 'holo'],
    ['pikachu', '2016'],
    ['pikachu 60', 'ex'],
    ['', 'charizard'],
  ])('ida e volta: %s + %s', (text, term) => {
    const on = toggleTerm(text, term);
    expect(on).not.toBe(text);
    expect(toggleTerm(on, term)).toBe(text);
  });

  it('chip tira o termo em qualquer grafia', () => {
    expect(toggleTerm('pikachu hp120', '120')).toBe('pikachu');
    expect(toggleTerm('pikachu 120hp', '120')).toBe('pikachu');
    expect(toggleTerm('pikachu SAR', 'sar')).toBe('pikachu');
    expect(toggleTerm('pikachu rev', 'reverse')).toBe('pikachu');
  });

  it('o chip novo tira o anterior do mesmo tipo', () => {
    expect(toggleTerm('pikachu 60', '120')).toBe('pikachu 120');
    expect(toggleTerm('pikachu 2016', '2023')).toBe('pikachu 2023');
    expect(toggleTerm('pikachu sar', 'ar')).toBe('pikachu ar');
    expect(toggleTerm('pikachu holo', 'reverse')).toBe('pikachu reverse');
  });

  it('não mexe nos outros termos', () => {
    expect(toggleTerm('pikachu 60 2016 ex', 'sar')).toBe('pikachu 60 2016 ex sar');
    expect(toggleTerm('pikachu 60 2016', '70')).toBe('pikachu 2016 70');
  });
});

describe('rarityCode', () => {
  it.each([
    ['Common', 'C'],
    ['Uncommon', 'U'],
    ['Rare', 'R'],
    ['Double Rare', 'RR'],
    ['Triple Rare', 'RRR'],
    ['Art Rare', 'AR'],
    ['Illustration Rare', 'AR'],
    ['Special Art Rare', 'SAR'],
    ['Special Illustration Rare', 'SAR'],
    ['Super Rare', 'SR'],
    ['Super Rare Holo', 'SR'],
    ['Hyper Rare', 'HR'],
    ['Ultra Rare', 'UR'],
    ['Character Rare', 'CHR'],
    ['Character Super Rare', 'CSR'],
    ['Shiny Rare', 'S'],
    ['Shiny Secret Rare', 'SSR'],
    ['ACE Rare', 'ACE'],
    ['ACE SPEC Rare', 'ACE'],
    ['Trainer Rare', 'TR'],
    ['Promo', 'PR'],
  ])('%s → %s', (rarity, code) => {
    expect(rarityCode(rarity)).toBe(code);
  });

  it('fora da tabela, o nome da fonte; None e vazio, nada', () => {
    expect(rarityCode('Holo Rare')).toBe('Holo Rare');
    expect(rarityCode('None')).toBeNull();
    expect(rarityCode('')).toBeNull();
    expect(rarityCode(undefined)).toBeNull();
  });

  it('texto do chip', () => {
    expect(rarityLabel('SAR')).toBe('SAR · Special Art Rare');
    expect(rarityLabel('Holo Rare')).toBe('Holo Rare');
  });
});

describe('nome em japonês ou coreano com o final ou o começo colado', () => {
  it.each([
    ['リザードンex', 'リザードン ex'],
    ['メガリザードンXex', 'mega リザードン X ex'],
    ['かがやくリザードン', 'radiant リザードン'],
    ['리자몽V', '리자몽 V'],
  ])('%s lê como "%s"', (glued, spaced) => {
    const q = parse(glued);
    expect(q.dex).toBe(CHARIZARD);
    expect(q.filters.nameTerms.length).toBeGreaterThan(0);
    expect(q.filters).toEqual(parse(spaced).filters);
  });
});
