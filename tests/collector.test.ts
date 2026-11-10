// Bloco "Para colecionador" e ano do título (src/lib/collector.ts): as cartas de exemplo do spec, com os dados reais da
// TCGdex e do catálogo (conferidos no banco e na API), e cada regra à parte. Nenhum teste acessa a rede.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { catalogProduct, type CatalogRow } from '@/lib/catalog';
import {
  cleanNumber,
  collectorDex,
  collectorFacts,
  collectorRarity,
  inRange,
  isClassicCollection,
  isoDay,
  isPromoSeries,
  jaNumberless,
  printedCardNumber,
  releaseFact,
  type CollectorFacts,
  type CollectorInput,
  type FactKey,
} from '@/lib/collector';
import { cardDetail, type CardDetail } from '@/lib/tcgdex';

jest.mock('@/lib/catalog', () => ({ ...jest.requireActual('@/lib/catalog'), catalogProduct: jest.fn() }));

// ---------- Ajudantes ----------

/** Linha do catálogo (categoria 3, sem selo, sem data) com o grupo dela. */
function row(o: Partial<CatalogRow> & { product_id: number; group_id: number }, group?: { name: string; published_on?: string | null }): CatalogRow {
  return {
    category: 3,
    name: 'Carta',
    full_name: 'Carta',
    number: null,
    rarity: null,
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${o.product_id}_in_1000x1000.jpg`,
    stamp: null,
    tcgdex_id: null,
    released_on: null,
    tcg_groups: group ? { name: group.name, abbr: null, published_on: group.published_on ?? null } : null,
    ...o,
  };
}

function input(o: Partial<CollectorInput> & { cardId: string }): CollectorInput {
  return { lang: 'en', dataLang: 'en', detail: null, enDetail: null, rows: [], dex: [], ...o };
}

/** Todas as saídas calculadas aqui, para as regras que valem em qualquer carta (nota = linha larga, sem valor vazio). */
const ALL: CollectorFacts[] = [];
function facts(i: CollectorInput) {
  const f = collectorFacts(i);
  ALL.push(f);
  return f;
}

const rowOf = (f: CollectorFacts, key: FactKey) => f.rows.find((r) => r.key === key);
/** "valor | nota" de cada linha, pela chave. */
const shown = (f: CollectorFacts) => Object.fromEntries(f.rows.map((r) => [r.key, r.note ? `${r.value} | ${r.note}` : r.value]));
const labelOf = (f: CollectorFacts, key: FactKey) => rowOf(f, key)?.label;
const textOf = (f: CollectorFacts) => f.rows.map((r) => `${r.label} ${r.value} ${r.note ?? ''} ${r.spoken}`).join(' ');

// ---------- Fichas (dados reais da TCGdex) ----------

const VARIANTS = { normal: true, holo: false, reverse: false, firstEdition: false, wPromo: false };

const scizorEn: CardDetail = {
  id: 'basep-33',
  localId: '33',
  name: 'Scizor',
  rarity: 'Common',
  illustrator: 'Hironobu Yoshida',
  dexId: [212],
  set: { id: 'basep', name: 'Wizards Black Star Promos', cardCount: { official: 53, total: 53 } },
  variants: VARIANTS,
};

const pikachuPt: CardDetail = {
  id: 'sv03.5-025',
  localId: '025',
  name: 'Pikachu',
  rarity: 'Comum',
  illustrator: 'Naoyo Kimura',
  dexId: [25],
  set: { id: 'sv03.5', name: '151', cardCount: { official: 165, total: 207 } },
  variants: { ...VARIANTS, reverse: true },
};
const pikachuEn: CardDetail = { ...pikachuPt, rarity: 'Common', set: { ...pikachuPt.set } };

const charizardEn: CardDetail = {
  id: 'base1-4',
  localId: '4',
  name: 'Charizard',
  rarity: 'Rare',
  illustrator: 'Mitsuhiro Arita',
  dexId: [6],
  set: { id: 'base1', name: 'Base Set', cardCount: { official: 102, total: 102 } },
  variants: { ...VARIANTS, normal: false, holo: true, firstEdition: true },
};
const BASE_SET = { name: 'Base Set', published_on: '1999-01-09' };
const charizardRows = [
  row({ product_id: 42382, group_id: 604, tcgdex_id: 'base1-4', number: '004/102', rarity: 'Holo Rare' }, BASE_SET),
  row({ product_id: 106999, group_id: 1663, tcgdex_id: 'base1-4', number: '004/102', rarity: 'Holo Rare' }, { name: 'Base Set (Shadowless)', published_on: '1999-01-09' }),
  row({ product_id: 179079, group_id: 1528, tcgdex_id: 'base1-4', number: '004/102', rarity: 'Promo', stamp: 'Jumbo Cards · CoroCoro Promo' }, { name: 'Jumbo Cards', published_on: '2015-04-01' }),
  row({ product_id: 252517, group_id: 2374, tcgdex_id: 'base1-4', number: '004/102', rarity: 'Promo', stamp: 'Celebrations Metal Card' }, { name: 'Miscellaneous Cards & Products' }),
  row({ product_id: 657516, group_id: 604, tcgdex_id: 'base1-4', number: '004/102', rarity: 'Holo Rare', stamp: 'Black Dot Error' }, BASE_SET),
];
const BASE_FACTS = { day: '1999-01-09', serieId: 'base', serie: 'Base' };

const ccCharizard: CardDetail = {
  id: 'cel25cc-CC002',
  localId: 'CC002',
  name: 'Charizard',
  rarity: 'Classic Collection',
  illustrator: 'Mitsuhiro Arita',
  dexId: [6],
  set: { id: 'cel25cc', name: 'Celebrations Classic Collection', cardCount: { official: 25, total: 25 } },
  variants: { ...VARIANTS, normal: false, holo: true },
};
const ccRows = [
  row(
    { product_id: 250320, group_id: 2931, tcgdex_id: 'cel25cc-CC002', number: '4/102', rarity: 'Classic Collection' },
    { name: 'Celebrations: Classic Collection', published_on: '2021-10-08' },
  ),
];

const charizard30Pt: CardDetail = {
  id: '30th-c-001',
  localId: '001',
  name: 'Charizard',
  rarity: 'None',
  illustrator: 'Mitsuhiro Arita',
  dexId: [6],
  set: { id: '30th-c', name: 'Coleção Clássica de 30 Anos', cardCount: { official: 30, total: 30 } },
  variants: { ...VARIANTS, normal: false, holo: true },
};
const charizard30En: CardDetail = { ...charizard30Pt, set: { ...charizard30Pt.set, name: '30th Classic Collection' } };
const cc30Rows = [
  row(
    { product_id: 714372, group_id: 24837, tcgdex_id: '30th-c-001', number: '4/102', rarity: 'Classic Collection', released_on: '2026-09-16' },
    { name: 'ME: 30th Celebration Classic Collection', published_on: '2026-09-16' },
  ),
];

/** Ficha de uma carta só do catálogo ("tcgp-"), como cardDetail monta. */
function tcgpDetail(o: { pid: number; name: string; group: number; groupName: string; number?: string; releasedOn?: string; publishedOn?: string; rarity?: string; category?: number }): CardDetail {
  return {
    id: `tcgp-${o.pid}`,
    localId: (o.number ?? '').split('/')[0],
    name: o.name,
    rarity: o.rarity,
    set: { id: `tcgp${o.group}`, name: o.groupName },
    imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${o.pid}_in_1000x1000.jpg`,
    catalog: { productId: o.pid, category: o.category ?? 3, groupId: o.group, number: o.number, releasedOn: o.releasedOn, publishedOn: o.publishedOn },
  };
}

// ---------- As cartas de exemplo ----------

describe('1. basep-33 Scizor (EN)', () => {
  const f = () =>
    facts(
      input({
        cardId: 'basep-33',
        detail: scizorEn,
        enDetail: scizorEn,
        set: { day: '1999-07-01', serieId: 'base', serie: 'Base' },
        rows: [row({ product_id: 88960, group_id: 1418, tcgdex_id: 'basep-33', number: '33/53', rarity: 'Promo' }, { name: 'WoTC Promo', published_on: '1999-07-01' })],
        dex: [212],
      }),
    );

  it('sem ano no título (série de promos) e raridade "Promo": [EN] [Promo]', () => {
    expect(f().badge).toBeUndefined();
    expect(f().rarity).toBe('Promo');
  });

  it('linhas, rótulos e rodapé', () => {
    const out = f();
    expect(shown(out)).toEqual({
      set: 'Wizards Black Star Promos',
      release: '1999–2003 | A fonte não data cada carta.',
      serie: 'Base',
      number: '33',
      rarity: 'Promo',
      illustrator: 'Hironobu Yoshida',
      pokemon: '#212 Scizor | Em japonês: ハッサム',
    });
    expect(labelOf(out, 'release')).toBe('Série de promos');
    expect(out.release).toEqual({ kind: 'range', from: 1999, to: 2003 });
    expect(out.footer).toBe('Fontes: TCGdex · TCGplayer · lista do app · PokéAPI.');
  });

  it('o leitor de tela ouve rótulo, valor e nota por extenso', () => {
    const out = f();
    expect(rowOf(out, 'release')?.spoken).toBe('Série de promos: de 1999 a 2003. A fonte não data cada carta.');
    expect(rowOf(out, 'pokemon')?.spoken).toBe('Pokémon: número 212 da Pokédex, Scizor. Em japonês: ハッサム');
  });
});

describe('2. sv03.5-025 Pikachu (PT, dados em português)', () => {
  const f = () =>
    facts(
      input({
        cardId: 'sv03.5-025',
        lang: 'pt',
        dataLang: 'pt',
        detail: pikachuPt,
        enDetail: pikachuEn,
        set: { day: '2023-09-22', serieId: 'sv', serie: 'Escarlate e Violeta' },
        rows: [
          row({ product_id: 517033, group_id: 23237, tcgdex_id: 'sv03.5-025', number: '025/165', rarity: 'Common' }, { name: 'SV: Scarlet & Violet 151', published_on: '2023-09-22' }),
          row({ product_id: 559566, group_id: 2374, tcgdex_id: 'sv03.5-025', number: '025/165', rarity: 'Promo', stamp: 'Pokemon Together' }, { name: 'Miscellaneous Cards & Products' }),
        ],
        dex: [25],
      }),
    );

  it('ano do título: o da coleção em inglês', () => {
    expect(f().badge).toEqual({ text: '2023 · EN', spoken: 'Ano da coleção em inglês: 2023' });
  });

  it('linhas e rodapé', () => {
    const out = f();
    expect(shown(out)).toEqual({
      set: '151',
      release: '22/09/2023',
      serie: 'Escarlate e Violeta',
      number: '025/165',
      size: '207 | 165 no total impresso e 42 fora dele.',
      rarity: 'Comum',
      illustrator: 'Naoyo Kimura',
      pokemon: '#025 Pikachu | Em japonês: ピカチュウ',
    });
    expect(labelOf(out, 'release')).toBe('Lançamento em inglês');
    expect(out.footer).toBe('Fontes: TCGdex · PokéAPI.');
  });

  it('por extenso: a data e o número', () => {
    const out = f();
    expect(rowOf(out, 'release')?.spoken).toBe('Lançamento em inglês: 22 de setembro de 2023');
    expect(rowOf(out, 'number')?.spoken).toBe('Número: 025 de 165');
  });

  it('"Nome em inglês" só quando é outro nome (Pikachu = Pikachu)', () => {
    expect(rowOf(f(), 'nameEn')).toBeUndefined();
    const out = facts(input({ cardId: 'sv03.5-025', lang: 'pt', dataLang: 'pt', detail: { ...pikachuPt, name: 'Pikachu de Ash' }, enDetail: pikachuEn }));
    expect(shown(out).nameEn).toBe('Pikachu');
    // Dados em inglês: a ficha já é a inglesa.
    expect(rowOf(facts(input({ cardId: 'sv03.5-025', lang: 'pt', dataLang: 'en', detail: pikachuEn, enDetail: { ...pikachuEn, name: 'Outro' } })), 'nameEn')).toBeUndefined();
  });
});

describe('3. tcgp-575766 Dark Kadabra (JA, só do catálogo)', () => {
  const kadabra = tcgpDetail({ pid: 575766, name: 'Dark Kadabra', group: 23724, groupName: 'Rocket Gang', rarity: 'Uncommon', publishedOn: '1997-11-21', category: 85 });
  const f = () => facts(input({ cardId: 'tcgp-575766', lang: 'ja', dataLang: 'ja', detail: kadabra, dex: [64] }));

  it('ano da coleção pela data do grupo da TCGplayer', () => {
    expect(f().badge).toEqual({ text: '1997', spoken: 'Ano da coleção: 1997' });
  });

  it('linhas e rodapé (sem série, número, tamanho nem ilustrador)', () => {
    const out = f();
    expect(shown(out)).toEqual({
      set: 'Rocket Gang | Nome da coleção na TCGplayer, em inglês.',
      release: '21/11/1997 | Data da TCGplayer.',
      rarity: 'Uncommon',
      pokemon: '#064 Kadabra | Em japonês: ユンゲラー',
    });
    expect(labelOf(out, 'release')).toBe('Lançamento da coleção');
    expect(out.number).toBe('');
    expect(out.footer).toBe('Fontes: TCGplayer · PokéAPI.');
  });
});

describe('4. TCGdex japonesa (M5-088, PMCG1-021, neo1, VS1-001, SV2P-045)', () => {
  const ja = (o: { id: string; localId: string; set: string; setName: string; official: number; total: number; dex?: number }): CardDetail => ({
    id: o.id,
    localId: o.localId,
    name: 'カード',
    rarity: 'Rare',
    illustrator: 'Artista',
    dexId: o.dex ? [o.dex] : [],
    set: { id: o.set, name: o.setName, cardCount: { official: o.official, total: o.total } },
    variants: { ...VARIANTS, holo: true },
  });

  it('M5-088: nome em japonês com o da TCGplayer, data e série da coleção japonesa, número acima do total', () => {
    const out = facts(
      input({
        cardId: 'M5-088',
        lang: 'ja',
        dataLang: 'ja',
        detail: ja({ id: 'M5-088', localId: '088', set: 'M5', setName: 'アビスアイ', official: 81, total: 118, dex: 781 }),
        set: { day: '2026-05-22', serieId: 'M', serie: 'ポケモンカードゲーム MEGA' },
        jaGroupName: 'M5: Abyss Eye',
        dex: [781],
      }),
    );
    expect(shown(out)).toMatchObject({
      set: 'アビスアイ | Na TCGplayer: M5: Abyss Eye',
      release: '22/05/2026',
      serie: 'ポケモンカードゲーム MEGA',
      number: '088/081 | Número acima do total da coleção.',
      size: '118 | 81 no total impresso e 37 fora dele.',
    });
    expect(labelOf(out, 'release')).toBe('Lançamento da coleção');
    expect(out.badge).toEqual({ text: '2026', spoken: 'Ano da coleção: 2026' });
    expect(out.footer).toBe('Fontes: TCGdex · TCGplayer · PokéAPI.');
  });

  it('PMCG1-021: sem número nem tamanho (não são impressos); a série em japonês', () => {
    const out = facts(
      input({
        cardId: 'PMCG1-021',
        lang: 'ja',
        dataLang: 'ja',
        detail: ja({ id: 'PMCG1-021', localId: '021', set: 'PMCG1', setName: '拡張パック', official: 102, total: 110, dex: 6 }),
        set: { day: '1996-10-20', serieId: 'PMCG', serie: 'ポケットモンスターカードゲーム' },
        dex: [6],
      }),
    );
    expect(rowOf(out, 'number')).toBeUndefined();
    expect(rowOf(out, 'size')).toBeUndefined();
    expect(out.number).toBe('');
    expect(shown(out).serie).toBe('ポケットモンスターカードゲーム');
    // Sem a ficha (sem internet): pelo id, o título também não mostra "021/102".
    expect(printedCardNumber(input({ cardId: 'PMCG1-021', lang: 'ja', dataLang: 'ja', saved: { setId: 'PMCG1', setName: '拡張パック', localId: '021', setTotal: 102 } }))).toBe('');
  });

  it('neo1: o dia da coleção japonesa (2000-02-04), nunca o 2000-12-16 da inglesa de mesmo id', () => {
    const out = facts(
      input({
        cardId: 'neo1-001',
        lang: 'ja',
        dataLang: 'ja',
        detail: ja({ id: 'neo1-001', localId: '001', set: 'neo1', setName: '金、銀、新世界へ...', official: 96, total: 96 }),
        set: { day: '2000-02-04', serieId: 'neo', serie: 'ポケモンカード★neo' },
      }),
    );
    expect(shown(out).release).toBe('04/02/2000');
    expect(out.badge?.text).toBe('2000');
    expect(rowOf(out, 'number')).toBeUndefined();
  });

  it('VS1-001: as coleções VS têm número: "001/141"', () => {
    const out = facts(
      input({ cardId: 'VS1-001', lang: 'ja', dataLang: 'ja', detail: ja({ id: 'VS1-001', localId: '001', set: 'VS1', setName: 'ポケモンカード★VS', official: 141, total: 143 }) }),
    );
    expect(out.number).toBe('001/141');
  });

  it('SV2P-045: coleção comum (só termina em "P"): data, número com o total e tamanho', () => {
    const out = facts(
      input({
        cardId: 'SV2P-045',
        lang: 'ja',
        dataLang: 'ja',
        detail: ja({ id: 'SV2P-045', localId: '045', set: 'SV2P', setName: 'スノーハザード', official: 71, total: 99 }),
        set: { day: '2023-04-14', serieId: 'SV', serie: 'ポケモンカードゲーム スカーレット&バイオレット' },
      }),
    );
    expect(isPromoSeries('SV2P', 'ja')).toBe(false);
    expect(shown(out)).toMatchObject({ release: '14/04/2023', number: '045/071', size: '99 | 71 no total impresso e 28 fora dele.' });
    expect(labelOf(out, 'release')).toBe('Lançamento da coleção');
  });

  it('SV-P (promos japonesas espelhadas): série de promos 2022–2025, sem ano no título', () => {
    const out = facts(
      input({
        cardId: 'SV-P-001',
        lang: 'ja',
        dataLang: 'ja',
        detail: ja({ id: 'SV-P-001', localId: '001', set: 'SV-P', setName: 'スカーレット&バイオレット プロモカード', official: 0, total: 288 }),
        set: { day: '2022-11-29', serieId: 'SV', serie: 'ポケモンカードゲーム スカーレット&バイオレット' },
      }),
    );
    expect(shown(out).release).toBe('2022–2025 | A fonte não data cada carta.');
    expect(out.badge).toBeUndefined();
    expect(out.number).toBe('001');
  });
});

describe('5. base1-4 Charizard (Base Set)', () => {
  it('EN: 1999, Base Set, data da coleção, série, "4/102" sem tamanho, raridade "Holo Rare" do catálogo', () => {
    const out = facts(input({ cardId: 'base1-4', detail: charizardEn, enDetail: charizardEn, set: BASE_FACTS, rows: charizardRows, dex: [6] }));
    expect(out.badge).toEqual({ text: '1999', spoken: 'Ano da coleção: 1999' });
    expect(shown(out)).toMatchObject({ set: 'Base Set', release: '09/01/1999', serie: 'Base', number: '4/102', rarity: 'Holo Rare' });
    expect(labelOf(out, 'release')).toBe('Lançamento da coleção');
    expect(rowOf(out, 'size')).toBeUndefined();
    expect(out.footer).toBe('Fontes: TCGdex · TCGplayer · PokéAPI.');
  });

  it.each([
    ['Shadowless', { variant: 'shadowless' as const }],
    ['1ª edição', { variant: 'firstEdition' as const }],
  ])('versão %s: os mesmos fatos (a gêmea "Base Set (Shadowless)" não atrapalha a raridade), sem linha de versão', (_name, version) => {
    const out = facts(input({ cardId: 'base1-4', detail: charizardEn, enDetail: charizardEn, set: BASE_FACTS, rows: charizardRows, dex: [6], version }));
    expect(shown(out)).toMatchObject({ set: 'Base Set', release: '09/01/1999', number: '4/102', rarity: 'Holo Rare' });
    expect(rowOf(out, 'version')).toBeUndefined();
    expect(out.badge).toEqual({ text: '1999', spoken: 'Ano da coleção: 1999' });
  });

  it('versão de outro produto da base1-4 (Celebrations Metal Card, Miscellaneous sem data): o produto, sem data e sem ano', () => {
    const out = facts(
      input({ cardId: 'base1-4', detail: charizardEn, enDetail: charizardEn, set: BASE_FACTS, rows: charizardRows, version: { variant: 'wPromo', stamp: 'Celebrations Metal Card' } }),
    );
    expect(shown(out).version).toBe('Miscellaneous Cards & Products | A fonte não dá a data desta versão.');
    // Nunca o 1999 da carta original no título de um produto de 2021.
    expect(out.badge).toBeUndefined();
    expect(shown(out).release).toBe('09/01/1999');
  });

  it('base1-22 continua "Rare" (o catálogo também diz Rare)', () => {
    const pidgeotto: CardDetail = { ...charizardEn, id: 'base1-22', localId: '22', name: 'Pidgeotto', rarity: 'Rare', dexId: [17] };
    const rows = [row({ product_id: 42400, group_id: 604, tcgdex_id: 'base1-22', number: '022/102', rarity: 'Rare' }, BASE_SET)];
    expect(facts(input({ cardId: 'base1-22', detail: pidgeotto, enDetail: pidgeotto, set: BASE_FACTS, rows })).rarity).toBe('Rare');
  });

  it('PT com dados em inglês: nome em português com o em inglês, série escondida (= coleção), "Lançamento em inglês"', () => {
    const out = facts(
      input({
        cardId: 'base1-4',
        lang: 'pt',
        dataLang: 'en',
        detail: charizardEn,
        enDetail: charizardEn,
        ptSetName: 'Coleção Básica',
        set: { ...BASE_FACTS, serie: 'Coleção Básica' },
        rows: charizardRows,
        dex: [6],
      }),
    );
    expect(shown(out).set).toBe('Coleção Básica | Em inglês: Base Set. Dados da carta em inglês: a fonte não a tem em português.');
    expect(rowOf(out, 'serie')).toBeUndefined();
    expect(labelOf(out, 'release')).toBe('Lançamento em inglês');
    expect(out.rarity).toBe('Holo Rare');
    expect(out.badge).toEqual({ text: '1999 · EN', spoken: 'Ano da coleção em inglês: 1999' });
  });
});

describe('6. Coleção Clássica (cel25cc-CC002, 30th-c)', () => {
  it('cel25cc-CC002: "4/102" do catálogo, lançamento desta reimpressão, TCGplayer no rodapé', () => {
    const out = facts(input({ cardId: 'cel25cc-CC002', detail: ccCharizard, enDetail: ccCharizard, set: { day: '2021-10-08', serieId: 'swsh', serie: 'Sword & Shield' }, rows: ccRows, dex: [6] }));
    expect(out.number).toBe('4/102');
    expect(shown(out)).toMatchObject({ number: '4/102', release: '08/10/2021', rarity: 'Classic Collection' });
    expect(labelOf(out, 'release')).toBe('Lançamento desta reimpressão');
    expect(rowOf(out, 'release')?.note).toBeUndefined();
    expect(out.badge).toEqual({ text: '2021', spoken: 'Ano desta reimpressão: 2021' });
    expect(out.footer).toContain('TCGplayer');
    expect(rowOf(out, 'size')).toBeUndefined();
  });

  it('cel25cc-CC002 sem as linhas do catálogo: sem número, e "CC002" em lugar nenhum', () => {
    const out = facts(input({ cardId: 'cel25cc-CC002', detail: ccCharizard, enDetail: ccCharizard, set: { day: '2021-10-08', serieId: 'swsh', serie: 'Sword & Shield' }, rows: [] }));
    expect(out.number).toBe('');
    expect(rowOf(out, 'number')).toBeUndefined();
    expect(textOf(out)).not.toContain('CC002');
  });

  it('30th-c-001 (PT): raridade "None" na TCGdex vira a do catálogo, "4/102", data da coleção em inglês', () => {
    const out = facts(
      input({
        cardId: '30th-c-001',
        lang: 'pt',
        dataLang: 'pt',
        detail: charizard30Pt,
        enDetail: charizard30En,
        set: { day: '2026-09-16', serieId: 'me', serie: 'Megaevolução' },
        rows: cc30Rows,
        dex: [6],
      }),
    );
    expect(out.rarity).toBe('Classic Collection');
    expect(out.number).toBe('4/102');
    expect(shown(out)).toMatchObject({
      set: 'Coleção Clássica de 30 Anos | Em inglês: 30th Classic Collection',
      release: '16/09/2026 | Data da coleção em inglês.',
      number: '4/102',
    });
    expect(labelOf(out, 'release')).toBe('Lançamento desta reimpressão');
    expect(out.badge).toEqual({ text: '2026 · EN', spoken: 'Ano desta reimpressão em inglês: 2026' });
  });

  it('30th-c-001 sem internet: ainda Coleção Clássica pelo id, nunca "001/030"', () => {
    const offline = input({
      cardId: '30th-c-001',
      lang: 'pt',
      dataLang: 'pt',
      saved: { setId: '30th-c', setName: 'Coleção Clássica de 30 Anos', localId: '001', setTotal: 30, rarity: 'None' },
    });
    expect(isClassicCollection(offline)).toBe(true);
    const out = facts(offline);
    expect(out.number).toBe('');
    expect(textOf(out)).not.toContain('001/030');
    // O que a carta salva tem continua: coleção (sem raridade "None").
    expect(shown(out)).toEqual({ set: 'Coleção Clássica de 30 Anos' });
    expect(out.rarity).toBeUndefined();
  });

  it('30th-c-019 (sem ligação no catálogo): sem número', () => {
    const detail = { ...charizard30Pt, id: '30th-c-019', localId: '019' };
    expect(printedCardNumber(input({ cardId: '30th-c-019', lang: 'pt', dataLang: 'pt', detail, rows: [] }))).toBe('');
  });

  it('carta só do catálogo da Coleção Clássica: o número do produto e a data como reimpressão', () => {
    const palkia = tcgpDetail({
      pid: 716203,
      name: 'Palkia LV.X',
      group: 24837,
      groupName: 'ME: 30th Celebration Classic Collection',
      number: '106/106',
      releasedOn: '2026-09-16',
      publishedOn: '2026-09-16',
      rarity: 'Classic Collection',
    });
    const out = facts(input({ cardId: 'tcgp-716203', detail: palkia }));
    expect(out.number).toBe('106/106');
    expect(labelOf(out, 'release')).toBe('Lançamento desta reimpressão');
    expect(out.badge?.spoken).toBe('Ano desta reimpressão: 2026');
  });
});

describe('7. Promos', () => {
  const svp = (o: Partial<CardDetail> = {}): CardDetail => ({
    id: 'svp-183',
    localId: '183',
    name: 'Mew',
    rarity: 'Promo',
    illustrator: 'Artista',
    dexId: [151],
    set: { id: 'svp', name: 'SVP Black Star Promos', cardCount: { official: 0, total: 230 } },
    variants: VARIANTS,
    ...o,
  });
  const SVP_FACTS = { day: '2023-03-31', serieId: 'sv', serie: 'Scarlet & Violet' };
  const SVP_GROUP = { name: 'SV: Scarlet & Violet Promo Cards', published_on: '2023-03-31' };
  const svpRows = [
    row({ product_id: 623235, group_id: 22872, tcgdex_id: 'svp-183', number: '183', rarity: 'Promo', released_on: '2025-04-11' }, SVP_GROUP),
    row({ product_id: 624472, group_id: 22872, tcgdex_id: 'svp-183', number: '183', rarity: 'Promo', stamp: 'Staff' }, SVP_GROUP),
  ];

  it('svp-183: o dia do produto (único, nos anos da série, depois da coleção)', () => {
    const out = facts(input({ cardId: 'svp-183', detail: svp(), enDetail: svp(), set: SVP_FACTS, rows: svpRows }));
    expect(shown(out).release).toBe('11/04/2025 | Data da TCGplayer.');
    expect(labelOf(out, 'release')).toBe('Lançamento da carta');
    expect(out.badge).toEqual({ text: '2025', spoken: 'Ano da carta: 2025' });
    expect(out.number).toBe('183');
    expect(rowOf(out, 'size')).toBeUndefined();
  });

  it('svp-183 com a versão Staff (mesmo grupo): a nota diz que a data é a da carta sem selo', () => {
    const out = facts(input({ cardId: 'svp-183', detail: svp(), enDetail: svp(), set: SVP_FACTS, rows: svpRows, version: { variant: 'staff', stamp: 'Staff' } }));
    expect(shown(out).release).toBe('11/04/2025 | Data da carta sem selo, na TCGplayer.');
    expect(rowOf(out, 'version')).toBeUndefined();
  });

  it('swshp-SWSH093: 19/03/2021', () => {
    const detail = svp({ id: 'swshp-SWSH093', localId: 'SWSH093', set: { id: 'swshp', name: 'SWSH Black Star Promos' } });
    const rows = [
      row(
        { product_id: 234283, group_id: 2545, tcgdex_id: 'swshp-SWSH093', number: 'SWSH093', rarity: 'Promo', released_on: '2021-03-19' },
        { name: 'SWSH: Sword & Shield Promo Cards', published_on: '2019-11-15' },
      ),
    ];
    const out = facts(input({ cardId: 'swshp-SWSH093', detail, enDetail: detail, set: { day: '2019-11-15', serieId: 'swsh', serie: 'Sword & Shield' }, rows }));
    expect(shown(out).release).toBe('19/03/2021 | Data da TCGplayer.');
    expect(out.number).toBe('SWSH093');
  });

  it('mep-021: "desde 2025", sem ano no título; a raridade continua "Promo"', () => {
    const detail = svp({ id: 'mep-021', localId: '021', name: 'Weavile', dexId: [461], set: { id: 'mep', name: 'MEP Black Star Promos', cardCount: { official: 0, total: 112 } } });
    const rows = [row({ product_id: 664063, group_id: 24451, tcgdex_id: 'mep-021', number: '021', rarity: 'Holo Rare' }, { name: 'ME: Mega Evolution Promo', published_on: '2025-09-26' })];
    const out = facts(input({ cardId: 'mep-021', detail, enDetail: detail, set: { day: '2025-09-26', serieId: 'me', serie: 'Mega Evolution' }, rows }));
    expect(shown(out).release).toBe('desde 2025 | A fonte não data cada carta.');
    expect(rowOf(out, 'release')?.spoken).toBe('Série de promos: desde 2025. A fonte não data cada carta.');
    expect(out.badge).toBeUndefined();
    expect(out.rarity).toBe('Promo');
  });

  it('np-1: sem lançamento, sem série e sem ano', () => {
    const detail = svp({ id: 'np-1', localId: '1', set: { id: 'np', name: 'Nintendo Black Star Promos' } });
    const out = facts(input({ cardId: 'np-1', detail, enDetail: detail, set: { day: '2003-10-01', serieId: 'pop', serie: 'POP' } }));
    expect(rowOf(out, 'release')).toBeUndefined();
    expect(rowOf(out, 'serie')).toBeUndefined();
    expect(out.badge).toBeUndefined();
  });

  it.each([
    ['data fora dos anos da série', [row({ product_id: 1, group_id: 22872, tcgdex_id: 'svp-183', released_on: '2026-02-01' })]],
    [
      'duas datas',
      [
        row({ product_id: 1, group_id: 22872, tcgdex_id: 'svp-183', released_on: '2024-01-01' }),
        row({ product_id: 2, group_id: 22872, tcgdex_id: 'svp-183', released_on: '2024-06-01' }),
      ],
    ],
    [
      'só a linha com selo tem data',
      [row({ product_id: 1, group_id: 22872, tcgdex_id: 'svp-183' }), row({ product_id: 2, group_id: 22872, tcgdex_id: 'svp-183', stamp: 'Staff', released_on: '2024-01-01' })],
    ],
    ['linha de outro grupo', [row({ product_id: 1, group_id: 2374, tcgdex_id: 'svp-183', released_on: '2024-01-01' })]],
    ['data antes da coleção', [row({ product_id: 1, group_id: 22872, tcgdex_id: 'svp-183', released_on: '2023-01-02' })]],
    ['outra carta', [row({ product_id: 1, group_id: 22872, tcgdex_id: 'svp-184', released_on: '2024-01-01' })]],
    ['sem linhas', []],
  ])('volta para o período da série: %s', (_name, rows) => {
    const out = facts(input({ cardId: 'svp-183', detail: svp(), enDetail: svp(), set: SVP_FACTS, rows: rows as CatalogRow[] }));
    expect(out.release).toEqual({ kind: 'range', from: 2023, to: 2025 });
    expect(shown(out).release).toBe('2023–2025 | A fonte não data cada carta.');
    expect(out.badge).toBeUndefined();
  });

  it('me01-133 (PT): "133/132" acima do total, "Lançamento em inglês" 26/09/2025', () => {
    const pt: CardDetail = {
      id: 'me01-133',
      localId: '133',
      name: 'Bulbasaur',
      rarity: 'Rara Ilustração',
      illustrator: 'Artista',
      dexId: [1],
      set: { id: 'me01', name: 'Megaevolução', cardCount: { official: 132, total: 188 } },
      variants: VARIANTS,
    };
    const en: CardDetail = { ...pt, rarity: 'Illustration Rare', set: { ...pt.set, name: 'Mega Evolution' } };
    const out = facts(input({ cardId: 'me01-133', lang: 'pt', dataLang: 'pt', detail: pt, enDetail: en, set: { day: '2025-09-26', serieId: 'me', serie: 'Megaevolução' } }));
    expect(shown(out)).toMatchObject({ number: '133/132 | Número acima do total da coleção.', release: '26/09/2025' });
    expect(labelOf(out, 'release')).toBe('Lançamento em inglês');
    // A série tem o mesmo nome da coleção: não se repete.
    expect(rowOf(out, 'serie')).toBeUndefined();
  });

  it('me01-133 com o selo da Booster Box (promo com selo, produto "Mega Evolution Stamped" sem data): a data da coleção', () => {
    const pt: CardDetail = {
      id: 'me01-133',
      localId: '133',
      name: 'Bulbasaur',
      rarity: 'Rara Ilustração',
      dexId: [1],
      set: { id: 'me01', name: 'Megaevolução', cardCount: { official: 132, total: 188 } },
      variants: VARIANTS,
    };
    const rows = [
      row({ product_id: 654472, group_id: 24380, tcgdex_id: 'me01-133', number: '133/132', rarity: 'Illustration Rare' }, { name: 'ME01: Mega Evolution', published_on: '2025-09-26' }),
      row(
        { product_id: 654703, group_id: 2374, tcgdex_id: 'me01-133', number: '133/132', rarity: 'Illustration Rare', stamp: 'Mega Evolution Stamped' },
        { name: 'Miscellaneous Cards & Products' },
      ),
    ];
    const out = facts(
      input({
        cardId: 'me01-133',
        lang: 'pt',
        dataLang: 'pt',
        detail: pt,
        enDetail: { ...pt, set: { ...pt.set, name: 'Mega Evolution' } },
        set: { day: '2025-09-26', serieId: 'me', serie: 'Megaevolução' },
        rows,
        version: { variant: 'wPromo', stamp: 'Logo da coleção (Booster Box)' },
      }),
    );
    expect(shown(out)).toMatchObject({ release: '26/09/2025', number: '133/132 | Número acima do total da coleção.' });
    expect(rowOf(out, 'version')).toBeUndefined();
    expect(out.badge).toEqual({ text: '2025 · EN', spoken: 'Ano da coleção em inglês: 2025' });
  });

  it('"tcgp-" em "Miscellaneous" (de tudo um pouco) sem data do produto: sem lançamento', () => {
    const misc = tcgpDetail({ pid: 252517, name: 'Charizard', group: 2374, groupName: 'Miscellaneous Cards & Products', number: '004/102' });
    expect(releaseFact(input({ cardId: 'tcgp-252517', detail: misc }))).toBeUndefined();
    const dated = tcgpDetail({ pid: 1, name: 'X', group: 2374, groupName: 'Miscellaneous Cards & Products', releasedOn: '2024-05-01' });
    expect(releaseFact(input({ cardId: 'tcgp-1', detail: dated }))).toEqual({ kind: 'day', day: '2024-05-01', source: 'catalog-product' });
  });

  it('"tcgp-" no Japanese CD Promo (24568): "Série de promos" 1998–1999, sem ano no título', () => {
    const cd = tcgpDetail({ pid: 800001, name: 'Charizard', group: 24568, groupName: 'Japanese CD Promo', publishedOn: '2025-12-01', category: 85 });
    const out = facts(input({ cardId: 'tcgp-800001', lang: 'ja', dataLang: 'ja', detail: cd }));
    expect(shown(out).release).toBe('1998–1999 | A fonte não data cada carta.');
    expect(labelOf(out, 'release')).toBe('Série de promos');
    expect(out.badge).toBeUndefined();
  });

  it('"tcgp-" em promos sem série espelhada: só a data do produto ou a do grupo com o ano no nome', () => {
    const p = tcgpDetail({ pid: 2, name: 'Pikachu', group: 24143, groupName: 'P Promotional cards', publishedOn: '2001-07-01', category: 85 });
    expect(releaseFact(input({ cardId: 'tcgp-2', lang: 'ja', detail: p }))).toBeUndefined();
    const mc2011 = tcgpDetail({ pid: 3, name: 'Snivy', group: 1401, groupName: "McDonald's Promos 2011", publishedOn: '2011-06-17' });
    const out = facts(input({ cardId: 'tcgp-3', detail: mc2011 }));
    expect(shown(out).release).toBe('17/06/2011 | Data da TCGplayer.');
    expect(labelOf(out, 'release')).toBe('Lançamento da coleção');
    const mc2024 = tcgpDetail({ pid: 4, name: 'Pikachu', group: 24163, groupName: "McDonald's Promos 2024", publishedOn: '2025-01-21' });
    expect(releaseFact(input({ cardId: 'tcgp-4', detail: mc2024 }))).toBeUndefined();
    const nintendo = tcgpDetail({ pid: 5, name: 'Mew', group: 1423, groupName: 'Nintendo Promos' });
    expect(releaseFact(input({ cardId: 'tcgp-5', detail: nintendo }))).toBeUndefined();
  });

  it('"tcgp-" com sufixo no número: "001/BW-P"; série de promos espelhada 2010–2013', () => {
    const bw = tcgpDetail({ pid: 6, name: 'Pikachu', group: 24342, groupName: 'BW-P Promotional cards', number: '001/BW-P', publishedOn: '2010-12-01', category: 85 });
    const out = facts(input({ cardId: 'tcgp-6', lang: 'ja', dataLang: 'ja', detail: bw }));
    expect(out.number).toBe('001/BW-P');
    expect(shown(out)).toMatchObject({ number: '001/BW-P', release: '2010–2013 | A fonte não data cada carta.' });
    // Com a data do produto dentro dos anos: o dia.
    const dated = tcgpDetail({ pid: 7, name: 'Pikachu', group: 24342, groupName: 'BW-P Promotional cards', number: '002/BW-P', releasedOn: '2012-03-01', category: 85 });
    expect(releaseFact(input({ cardId: 'tcgp-7', lang: 'ja', detail: dated }))).toEqual({ kind: 'day', day: '2012-03-01', source: 'catalog-product' });
  });

  it('"tcgp-" sem a ficha (sem internet, ou antes de a ficha nova chegar): o número da carta salva, sem lançamento', () => {
    const out = facts(input({ cardId: 'tcgp-8', saved: { setId: 'tcgp24900', setName: 'ME06: Delta Reign', localId: '104', rarity: 'Common' }, dex: [] }));
    // Como antes da ficha v2: o título não perde o número (o código de energia "FIR" não é número).
    expect(out.number).toBe('104');
    expect(printedCardNumber(input({ cardId: 'tcgp-9', saved: { setId: 'tcgp24420', setName: 'X', localId: 'FIR' } }))).toBe('');
    expect(shown(out)).toEqual({ set: 'ME06: Delta Reign', number: '104', rarity: 'Common' });
    expect(out.footer).toBe('Fonte: TCGplayer.');
  });
});

describe('8. swsh12tg-TG05 Gardevoir (PT, galeria)', () => {
  it('nome em português com o em inglês, data, série e "TG05/TG30" sem nota nem tamanho', () => {
    const pt: CardDetail = {
      id: 'swsh12tg-TG05',
      localId: 'TG05',
      name: 'Gardevoir',
      rarity: 'Rara Holo',
      illustrator: 'AKIRA EGAWA',
      dexId: [282],
      set: { id: 'swsh12tg', name: 'Tempestade Prateada Galeria de Treinador', cardCount: { official: 30, total: 30 } },
      variants: { ...VARIANTS, normal: false, holo: true },
    };
    const en: CardDetail = { ...pt, rarity: 'Holo Rare', set: { ...pt.set, name: 'Silver Tempest Trainer Gallery' } };
    const rows = [
      row(
        { product_id: 452019, group_id: 17674, tcgdex_id: 'swsh12tg-TG05', number: 'TG05/TG30', rarity: 'Ultra Rare' },
        { name: 'SWSH12: Silver Tempest Trainer Gallery', published_on: '2022-11-11' },
      ),
    ];
    const out = facts(
      input({ cardId: 'swsh12tg-TG05', lang: 'pt', dataLang: 'pt', detail: pt, enDetail: en, set: { day: '2022-11-11', serieId: 'swsh', serie: 'Espada e Escudo' }, rows, dex: [282] }),
    );
    expect(shown(out)).toEqual({
      set: 'Tempestade Prateada Galeria de Treinador | Em inglês: Silver Tempest Trainer Gallery',
      release: '11/11/2022',
      serie: 'Espada e Escudo',
      number: 'TG05/TG30',
      rarity: 'Rara Holo',
      illustrator: 'AKIRA EGAWA',
      pokemon: '#282 Gardevoir | Em japonês: サーナイト',
    });
    expect(labelOf(out, 'release')).toBe('Lançamento em inglês');
  });
});

describe('9. tcgp-726557 Masquerain (PT, só do catálogo)', () => {
  it('"104/103" acima do total, data do produto, nome da coleção na TCGplayer, sem série', () => {
    const masquerain = tcgpDetail({
      pid: 726557,
      name: 'Masquerain',
      group: 24900,
      groupName: 'ME06: Delta Reign',
      number: '104/103',
      releasedOn: '2026-11-06',
      publishedOn: '2026-11-06',
      rarity: 'Illustration Rare',
    });
    const out = facts(input({ cardId: 'tcgp-726557', lang: 'pt', dataLang: 'pt', detail: masquerain, dex: [284] }));
    expect(shown(out)).toMatchObject({
      set: 'ME06: Delta Reign | Nome da coleção na TCGplayer, em inglês.',
      release: '06/11/2026 | Data da carta na TCGplayer.',
      number: '104/103 | Número acima do total da coleção.',
      rarity: 'Illustration Rare',
    });
    expect(labelOf(out, 'release')).toBe('Lançamento em inglês');
    expect(out.badge).toEqual({ text: '2026 · EN', spoken: 'Ano da carta em inglês: 2026' });
    expect(rowOf(out, 'serie')).toBeUndefined();
    expect(rowOf(out, 'illustrator')).toBeUndefined();
  });
});

describe('10. Versão de outro produto', () => {
  const eeveePt: CardDetail = {
    id: 'swsh8-167',
    localId: '167',
    name: 'Eevee',
    rarity: 'Comum',
    illustrator: 'Artista',
    dexId: [133],
    set: { id: 'swsh8', name: 'Golpe Fusão', cardCount: { official: 264, total: 284 } },
    variants: VARIANTS,
  };
  const eeveeRows = [
    row({ product_id: 250000, group_id: 2906, tcgdex_id: 'swsh8-167', number: '167/264', rarity: 'Common' }, { name: 'SWSH08: Fusion Strike', published_on: '2021-11-12' }),
    row(
      { product_id: 268239, group_id: 3051, tcgdex_id: 'swsh8-167', number: '167/264', stamp: 'Battle Academy 2022 · Eevee Stamped' },
      { name: 'Battle Academy 2022', published_on: '2022-04-01' },
    ),
  ];
  const SWSH8 = { day: '2021-11-12', serieId: 'swsh', serie: 'Espada e Escudo' };

  it('swsh8-167 Battle Academy 2022: a linha da versão com a data do grupo (ano no nome) e o ano dela no título', () => {
    const out = facts(
      input({
        cardId: 'swsh8-167',
        lang: 'pt',
        dataLang: 'pt',
        detail: eeveePt,
        enDetail: { ...eeveePt, set: { ...eeveePt.set, name: 'Fusion Strike' } },
        set: SWSH8,
        rows: eeveeRows,
        version: { variant: 'wPromo', stamp: 'Battle Academy 2022 · Eevee Stamped' },
      }),
    );
    expect(shown(out)).toMatchObject({ release: '12/11/2021', version: 'Battle Academy 2022 | Data na TCGplayer: 01/04/2022.' });
    expect(labelOf(out, 'release')).toBe('Lançamento em inglês');
    expect(labelOf(out, 'version')).toBe('Esta versão');
    expect(rowOf(out, 'version')?.spoken).toBe('Esta versão: Battle Academy 2022. Data na TCGplayer: 1º de abril de 2022.');
    expect(out.badge).toEqual({ text: '2022 · EN', spoken: 'Ano desta versão em inglês: 2022' });
    expect(out.footer).toContain('TCGplayer');
  });

  it('me03-012 Prize Pack (sem data do produto, grupo de tudo um pouco): sem data e sem ano no título', () => {
    const detail: CardDetail = { ...eeveePt, id: 'me03-012', localId: '012', set: { id: 'me03', name: 'Me03', cardCount: { official: 88, total: 124 } } };
    const rows = [
      row({ product_id: 700012, group_id: 24600, tcgdex_id: 'me03-012', number: '012/088' }, { name: 'ME03: Perfect Order', published_on: '2026-03-27' }),
      row({ product_id: 704410, group_id: 22880, tcgdex_id: 'me03-012', number: '012/088', stamp: 'Prize Pack Series Cards' }, { name: 'Prize Pack Series Cards', published_on: '2022-11-30' }),
    ];
    const out = facts(
      input({
        cardId: 'me03-012',
        lang: 'pt',
        dataLang: 'pt',
        detail,
        set: { day: '2026-03-27', serieId: 'me', serie: 'Megaevolução' },
        rows,
        version: { variant: 'wPromo', stamp: 'Prize Pack Series Cards' },
      }),
    );
    expect(shown(out).version).toBe('Prize Pack Series Cards | A fonte não dá a data desta versão.');
    expect(out.badge).toBeUndefined();
    // O lançamento continua o da coleção, com o rótulo de sempre.
    expect(shown(out).release).toBe('27/03/2026');
  });

  it('grupo sem o ano no nome (Southeast Asia Exclusives, 2023 numa carta de 2025): sem data', () => {
    const rows = [
      row({ product_id: 1, group_id: 24380, tcgdex_id: 'me01-028', number: '028/132' }, { name: 'ME01: Mega Evolution', published_on: '2025-09-26' }),
      row({ product_id: 2, group_id: 24864, tcgdex_id: 'me01-028', stamp: 'Southeast Asia Exclusives · GYM' }, { name: 'Southeast Asia Exclusives', published_on: '2023-08-05' }),
    ];
    const detail: CardDetail = { ...eeveePt, id: 'me01-028', localId: '028', set: { id: 'me01', name: 'Megaevolução' } };
    const out = facts(input({ cardId: 'me01-028', lang: 'pt', dataLang: 'pt', detail, rows, set: { day: '2025-09-26' }, version: { variant: 'holo', stamp: 'Southeast Asia Exclusives · GYM' } }));
    expect(shown(out).version).toBe('Southeast Asia Exclusives | A fonte não dá a data desta versão.');
    expect(out.badge).toBeUndefined();
  });

  it('a data do próprio produto vale mesmo num grupo de tudo um pouco', () => {
    const rows = [
      row({ product_id: 1, group_id: 2906, tcgdex_id: 'swsh8-167' }, { name: 'SWSH08: Fusion Strike', published_on: '2021-11-12' }),
      row({ product_id: 2, group_id: 2374, tcgdex_id: 'swsh8-167', stamp: 'Holiday Calendar', released_on: '2023-10-01' }, { name: 'Miscellaneous Cards & Products' }),
    ];
    const out = facts(input({ cardId: 'swsh8-167', lang: 'pt', dataLang: 'pt', detail: eeveePt, rows, set: SWSH8, version: { variant: 'wPromo', stamp: 'Holiday Calendar' } }));
    expect(shown(out).version).toBe('Miscellaneous Cards & Products | Data na TCGplayer: 01/10/2023.');
    expect(out.badge?.text).toBe('2023 · EN');
  });

  it('versão no mesmo grupo da carta (bolas da Ascended Heroes): nada de versão, o ano é o da coleção', () => {
    const rows = [
      row({ product_id: 676000, group_id: 24541, tcgdex_id: 'me02.5-012', number: '012/217' }, { name: 'ME: Ascended Heroes', published_on: '2026-01-30' }),
      row({ product_id: 676861, group_id: 24541, tcgdex_id: 'me02.5-012', number: '012/217', stamp: 'Love Ball' }, { name: 'ME: Ascended Heroes', published_on: '2026-01-30' }),
    ];
    const detail: CardDetail = { ...eeveePt, id: 'me02.5-012', localId: '012', set: { id: 'me02.5', name: 'Heróis Ascendentes' } };
    const out = facts(input({ cardId: 'me02.5-012', lang: 'pt', dataLang: 'pt', detail, rows, set: { day: '2026-01-30' }, version: { variant: 'wPromo', stamp: 'Love Ball' } }));
    expect(rowOf(out, 'version')).toBeUndefined();
    expect(out.badge).toEqual({ text: '2026 · EN', spoken: 'Ano da coleção em inglês: 2026' });
  });
});

describe('11. miscp e jumbo (série "misc")', () => {
  it.each(['miscp-001', 'jumbo-1'])('%s: sem lançamento e sem ano', (cardId) => {
    const detail: CardDetail = { id: cardId, localId: '1', name: 'Pikachu', set: { id: cardId.split('-')[0], name: 'Miscellaneous' }, variants: VARIANTS };
    const out = facts(input({ cardId, detail, set: { day: cardId.startsWith('jumbo') ? '2000-02-01' : '1996-01-01', serieId: 'misc', serie: 'Miscellaneous' } }));
    expect(rowOf(out, 'release')).toBeUndefined();
    expect(rowOf(out, 'serie')).toBeUndefined();
    expect(out.badge).toBeUndefined();
  });
});

describe('12. Ficha do Zukan (nome da coleção = id)', () => {
  const zukan: CardDetail = { id: 'me06-001', localId: '001', name: 'Heracross', rarity: 'Comum', illustrator: 'Artista', set: { id: 'me06', name: 'me06' }, source: 'zukan' };

  it('sem a coleção da ficha: a da carta salva; o rodapé cita o Zukan', () => {
    const out = facts(input({ cardId: 'me06-001', lang: 'pt', dataLang: 'pt', detail: zukan, saved: { setId: 'me06', setName: 'Reinado Delta', localId: '001' }, dex: [214] }));
    expect(shown(out).set).toBe('Reinado Delta');
    expect(out.footer).toContain('Zukan');
    const bare = facts(input({ cardId: 'me06-001', lang: 'pt', dataLang: 'pt', detail: zukan }));
    expect(rowOf(bare, 'set')).toBeUndefined();
    expect(bare.footer).toBe('Fonte: Zukan.');
  });

  it('ficha guardada antes da marca `source`, sem as impressões: também é do Zukan', () => {
    const { source: _source, ...old } = zukan;
    expect(facts(input({ cardId: 'me06-001', lang: 'pt', dataLang: 'pt', detail: old })).footer).toBe('Fonte: Zukan.');
  });
});

// ---------- Regras ----------

describe('isPromoSeries (lista fechada)', () => {
  it.each(['tk-ex-p', 'tk-xy-p', 'sp', 'SV2P', 'S10P', 'SM1p', 'SM4p', 'sv03.5', 'P-A'])('%s não é série de promos', (id) => {
    expect(isPromoSeries(id, 'en')).toBe(false);
    expect(isPromoSeries(id, 'ja')).toBe(false);
  });

  it('as espelhadas, as sem anos e as japonesas "-P"', () => {
    for (const id of ['basep', 'dpp', 'hgssp', 'bwp', 'xyp', 'smp', 'swshp', 'svp', 'mep', 'np', 'wp', 'miscp']) expect(isPromoSeries(id, 'en')).toBe(true);
    expect(isPromoSeries('SV-P', 'ja')).toBe(true);
    expect(isPromoSeries('M-P', 'ja')).toBe(true);
    expect(isPromoSeries('S-P', 'ja')).toBe(true);
    expect(isPromoSeries('S-P', 'en')).toBe(false);
  });
});

describe('jaNumberless e cleanNumber', () => {
  it('sem número impresso só Expansion Pack (PMCG) e neo; VS e web têm', () => {
    expect(jaNumberless('PMCG1')).toBe(true);
    expect(jaNumberless('PMCG6')).toBe(true);
    expect(jaNumberless('neo1')).toBe(true);
    expect(jaNumberless('neo4')).toBe(true);
    expect(jaNumberless('VS1')).toBe(false);
    expect(jaNumberless('web1')).toBe(false);
    expect(jaNumberless('SV2a')).toBe(false);
  });

  it.each([
    ['001/BW-P', '001/BW-P'],
    ['133/132 (Mega Evolution Stamped)', '133/132'],
    ['071/076 / 072/076', '071/076'],
    ['TG05/TG30', 'TG05/TG30'],
    ['SWSH020', 'SWSH020'],
    [' 4/102 ', '4/102'],
    ['088/081', '088/081'],
    ['', ''],
  ])('cleanNumber(%j) = %j', (raw, want) => {
    expect(cleanNumber(raw)).toBe(want);
  });

  it('sem número: ""', () => {
    expect(cleanNumber(null)).toBe('');
    expect(cleanNumber(undefined)).toBe('');
    expect(cleanNumber('Promo')).toBe('');
  });
});

describe('isoDay e inRange', () => {
  it('isoDay: os 10 primeiros caracteres de uma data de 1991 em diante', () => {
    expect(isoDay('2023-09-22')).toBe('2023-09-22');
    expect(isoDay('2023-09-22T00:00:00+00:00')).toBe('2023-09-22');
    expect(isoDay('1990-12-31')).toBeUndefined();
    expect(isoDay('2023-9-22')).toBeUndefined();
    expect(isoDay(null)).toBeUndefined();
    expect(isoDay('')).toBeUndefined();
  });

  it('inRange: pelo ano, com o fim aberto', () => {
    expect(inRange('2025-04-11', { from: 2023, to: 2025 })).toBe(true);
    expect(inRange('2026-01-01', { from: 2023, to: 2025 })).toBe(false);
    expect(inRange('2022-12-31', { from: 2023, to: 2025 })).toBe(false);
    expect(inRange('2030-01-01', { from: 2025, to: null })).toBe(true);
  });
});

describe('raridade: a da TCGdex, com a troca estreita pela do catálogo', () => {
  const card = (rarity: string | undefined, rows: CatalogRow[], o: Partial<CollectorInput> = {}) =>
    collectorRarity(input({ cardId: 'x-1', detail: { id: 'x-1', localId: '1', name: 'X', rarity, set: { id: 'x', name: 'X' }, variants: VARIANTS }, rows, ...o }));
  const r = (rarity: string, stamp: string | null = null, group = 1) => row({ product_id: Math.random(), group_id: group, tcgdex_id: 'x-1', rarity, stamp });

  it('dados em inglês: Common/Uncommon/Rare/None/sem raridade viram "Promo" ou "Holo Rare"', () => {
    expect(card('Common', [r('Promo')])).toBe('Promo');
    expect(card('Uncommon', [r('Promo')])).toBe('Promo');
    expect(card('Rare', [r('Holo Rare')])).toBe('Holo Rare');
    expect(card('None', [r('Holo Rare')])).toBe('Holo Rare');
    expect(card(undefined, [r('Promo')])).toBe('Promo');
  });

  it('nunca o contrário nem outra troca (mep-021, svp-199 continuam "Promo"; TG05 continua "Holo Rare")', () => {
    expect(card('Promo', [r('Holo Rare')])).toBe('Promo');
    expect(card('Holo Rare', [r('Ultra Rare')])).toBe('Holo Rare');
    expect(card('Rare', [r('Ultra Rare')])).toBe('Rare');
  });

  it('dados em português: a da TCGdex', () => {
    expect(card('Comum', [r('Promo')], { lang: 'pt', dataLang: 'pt' })).toBe('Comum');
  });

  it('"Classic Collection" do catálogo quando a TCGdex não dá nenhuma, em qualquer idioma', () => {
    expect(card('None', [r('Classic Collection')], { lang: 'pt', dataLang: 'pt' })).toBe('Classic Collection');
    expect(card(undefined, [r('Classic Collection')], { lang: 'pt', dataLang: 'pt' })).toBe('Classic Collection');
    expect(card('Rara', [r('Classic Collection')], { lang: 'pt', dataLang: 'pt' })).toBe('Rara');
  });

  it('só a raridade única das linhas sem selo: duas raridades ou só linhas com selo, nada muda', () => {
    expect(card('Rare', [r('Holo Rare'), r('Rare')])).toBe('Rare');
    expect(card('Common', [r('Promo', 'Jumbo Cards · CoroCoro Promo')])).toBe('Common');
    // Gêmeas sem selo com a mesma raridade (Base Set e Shadowless): vale.
    expect(card('Rare', [r('Holo Rare', null, 604), r('Holo Rare', null, 1663)])).toBe('Holo Rare');
  });

  it('"None" nunca aparece', () => {
    expect(card('None', [])).toBeUndefined();
  });
});

describe('vários Pokémon e rodapé', () => {
  it('carta com dois Pokémon: os dois, sem o nome em japonês', () => {
    const out = facts(input({ cardId: 'x-1', dex: [25, 133, 25, 0] }));
    expect(shown(out).pokemon).toBe('#025 Pikachu · #133 Eevee');
    expect(rowOf(out, 'pokemon')?.spoken).toBe('Pokémon: número 25 da Pokédex, Pikachu; número 133 da Pokédex, Eevee');
    expect(out.footer).toBe('Fonte: PokéAPI.');
  });

  it('sem nada: nenhuma linha e nenhum rodapé', () => {
    const out = facts(input({ cardId: 'x-1' }));
    expect(out.rows).toEqual([]);
    expect(out.footer).toBe('');
  });
});

describe('ficha da carta só do catálogo (cardDetail "tcgp-")', () => {
  it('traz o produto, as datas, o número completo, HP, tipo e estágio (só os do jogo)', async () => {
    jest.mocked(catalogProduct).mockResolvedValueOnce({
      product_id: 575766,
      category: 85,
      group_id: 23724,
      name: 'Dark Kadabra',
      full_name: 'Dark Kadabra',
      number: null,
      rarity: 'Uncommon',
      image: 'https://tcgplayer-cdn.tcgplayer.com/product/575766_in_1000x1000.jpg',
      stamp: null,
      tcgdex_id: null,
      tcg_groups: { name: 'Rocket Gang', abbr: null, published_on: '1997-11-21' },
      released_on: null,
      hp: 50,
      card_type: 'Psychic',
      stage: 'Stage 1',
    });
    const d = await cardDetail('tcgp-575766', 'ja');
    expect(catalogProduct).toHaveBeenCalledWith(575766, { facts: true });
    expect(d).toMatchObject({
      id: 'tcgp-575766',
      localId: '',
      hp: 50,
      types: ['Psychic'],
      stage: 'Stage 1',
      set: { id: 'tcgp23724', name: 'Rocket Gang' },
      catalog: { productId: 575766, category: 85, groupId: 23724, publishedOn: '1997-11-21', cardType: 'Psychic' },
    });
    expect(d.catalog?.releasedOn).toBeUndefined();
    // Guardada na chave nova (a antiga, sem as datas, sai na limpeza).
    expect(await AsyncStorage.getItem('tcgdex:card:v2:ja:tcgp-575766')).toContain('Rocket Gang');
  });

  it('tipo e estágio que não são do jogo ficam de fora', async () => {
    jest.mocked(catalogProduct).mockResolvedValueOnce({
      product_id: 716203,
      category: 3,
      group_id: 24837,
      name: 'Palkia LV.X',
      full_name: 'Palkia LV.X',
      number: '106/106',
      rarity: 'Classic Collection',
      image: '',
      stamp: null,
      tcgdex_id: null,
      tcg_groups: { name: 'ME: 30th Celebration Classic Collection', abbr: null, published_on: '2026-09-16' },
      released_on: '2026-09-16',
      hp: null,
      card_type: 'Trainer',
      stage: 'Level Up',
    });
    const d = await cardDetail('tcgp-716203', 'en');
    expect(d.hp).toBeUndefined();
    expect(d.types).toBeUndefined();
    expect(d.stage).toBeUndefined();
    // O tipo do produto fica no catálogo da ficha: diz que é treinador (a linha Pokémon não aparece).
    expect(d.catalog).toMatchObject({ number: '106/106', releasedOn: '2026-09-16', cardType: 'Trainer' });
  });
});

// ---------- Revisão: o que a primeira versão do bloco errava ----------

describe('revisão do bloco', () => {
  it('a data ocupa a largura toda mesmo sem nota (o rótulo não cabe em meia célula a 360 dp)', () => {
    const out = facts(input({ cardId: 'sv03.5-025', lang: 'pt', dataLang: 'pt', detail: pikachuPt, enDetail: pikachuEn, set: { day: '2023-09-22' } }));
    const release = rowOf(out, 'release');
    expect(release?.note).toBeUndefined();
    expect(release?.wide).toBe(true);
  });

  it('"Cartas na coleção": as cartas a mais ficam "fora" do total impresso, não "acima" (Generations: RC1–RC32, 28a, 73a)', () => {
    const g1: CardDetail = {
      id: 'g1-19',
      localId: '19',
      name: 'Pikachu',
      rarity: 'Common',
      dexId: [25],
      set: { id: 'g1', name: 'Generations', cardCount: { official: 83, total: 117 } },
      variants: VARIANTS,
    };
    const out = facts(input({ cardId: 'g1-19', detail: g1, enDetail: g1, set: { day: '2016-02-22', serieId: 'xy', serie: 'XY' } }));
    expect(shown(out).size).toBe('117 | 83 no total impresso e 34 fora dele.');
    expect(textOf(out)).not.toContain('acima dele');
  });

  it('xya (Yellow A Alternate): sem a data do XY (2014) e o número do catálogo, nunca "54a/06"', () => {
    const zygarde: CardDetail = {
      id: 'xya-54a',
      localId: '54a',
      name: 'Zygarde-EX',
      rarity: 'Rare Holo',
      dexId: [718],
      set: { id: 'xya', name: 'Yellow A Alternate', cardCount: { official: 6, total: 6 } },
      variants: { ...VARIANTS, normal: false, holo: true },
    };
    const rows = [row({ product_id: 131698, group_id: 1938, tcgdex_id: 'xya-54a', number: '054a/124', rarity: 'Promo' }, { name: 'Alternate Art Promos' })];
    const xya = { day: '2014-02-05', serieId: 'xy', serie: 'XY' };
    const out = facts(input({ cardId: 'xya-54a', detail: zygarde, enDetail: zygarde, set: xya, rows, dex: [718] }));
    expect(out.number).toBe('054a/124');
    expect(out.release).toBeUndefined();
    expect(out.badge).toBeUndefined();
    expect(rowOf(out, 'release')).toBeUndefined();
    expect(rowOf(out, 'size')).toBeUndefined();
    expect(textOf(out)).not.toContain('2014');
    expect(textOf(out)).not.toContain('54a/06');
    // Sem as linhas do catálogo (sem internet): sem número, nunca o da TCGdex com o total 6.
    expect(printedCardNumber(input({ cardId: 'xya-54a', detail: zygarde, set: xya }))).toBe('');
  });

  it('Coleção Clássica de uma promo da Wizards (cel25cc-CC008): "24", sem o "/53" que a TCGplayer dá às promos', () => {
    const pikachu: CardDetail = {
      ...ccCharizard,
      id: 'cel25cc-CC008',
      localId: 'CC008',
      name: "_____'s Pikachu",
      dexId: [25],
    };
    const rows = [
      row(
        { product_id: 250325, group_id: 2931, tcgdex_id: 'cel25cc-CC008', number: '24/53', rarity: 'Classic Collection' },
        { name: 'Celebrations: Classic Collection', published_on: '2021-10-08' },
      ),
    ];
    const out = facts(input({ cardId: 'cel25cc-CC008', detail: pikachu, enDetail: pikachu, rows, set: { day: '2021-10-08' } }));
    expect(out.number).toBe('24');
    expect(textOf(out)).not.toContain('24/53');
    // As outras continuam com o número do catálogo ("4/102").
    expect(printedCardNumber(input({ cardId: 'cel25cc-CC002', detail: ccCharizard, rows: ccRows }))).toBe('4/102');
  });

  it('"tcgp-" japonesa das coleções sem número impresso: nada do nº da Pokédex ("229") nem da posição no deck', () => {
    const ja = (o: { pid: number; group: number; groupName: string; number: string; publishedOn?: string }) =>
      printedCardNumber(input({ cardId: `tcgp-${o.pid}`, lang: 'ja', dataLang: 'ja', detail: tcgpDetail({ ...o, name: 'X', category: 85 }) }));
    expect(ja({ pid: 577165, group: 23729, groupName: 'Darkness, and to Light...', number: '229', publishedOn: '2001-04-20' })).toBe('');
    expect(ja({ pid: 1, group: 24169, groupName: 'Intro Pack (Squirtle)', number: '32', publishedOn: '1999-07-30' })).toBe('');
    expect(ja({ pid: 2, group: 24208, groupName: 'Vending Machine cards Series 3 (Green)', number: '12' })).toBe('');
    // Com o total, é o número impresso (VS, web, as promos "P"); depois de 2001, o número solto também.
    expect(ja({ pid: 3, group: 24180, groupName: 'Pokemon VS', number: '130/141', publishedOn: '2001-08-19' })).toBe('130/141');
    expect(ja({ pid: 4, group: 24143, groupName: 'P Promotional cards', number: '009/P', publishedOn: '2001-07-01' })).toBe('009/P');
    expect(ja({ pid: 5, group: 23950, groupName: 'Pokemon TCG Classic: Charizard', number: '034', publishedOn: '2023-11-03' })).toBe('034');
    // Na categoria 3 (inglês), o número solto vale.
    const en = tcgpDetail({ pid: 6, name: 'X', group: 604, groupName: 'Base Set', number: '4', publishedOn: '1999-01-09' });
    expect(printedCardNumber(input({ cardId: 'tcgp-6', detail: en }))).toBe('4');
  });

  it('"tcgp-" em grupo de tudo um pouco fora do espelho (energias de uma época, Southeast Asia Exclusives): sem a data do grupo', () => {
    const energy = tcgpDetail({ pid: 589074, name: 'Basic Fire Energy', group: 24420, groupName: 'Scarlet & Violet Era Unnumbered Energies', publishedOn: '2025-08-01', category: 85 });
    const out = facts(input({ cardId: 'tcgp-589074', lang: 'ja', dataLang: 'ja', detail: energy }));
    expect(out.release).toBeUndefined();
    expect(out.badge).toBeUndefined();
    for (const [pid, group, name, day] of [
      [1, 24862, 'LEGEND Era Unnumbered Energies', '2009-02-10'],
      [2, 24153, 'XY Era Unnumbered Energies', '2013-11-08'],
      [3, 24785, 'Sun & Moon Era Unnumbered Energies', '2016-12-09'],
      [4, 24817, 'Sword & Shield Era Unnumbered Energies', '2019-12-06'],
      [5, 24781, 'Mega Evolution Era Unnumbered Energies', '2025-09-05'],
    ] as const) {
      const d = tcgpDetail({ pid, name: 'Energy', group, groupName: name, publishedOn: day, category: 85 });
      expect(releaseFact(input({ cardId: `tcgp-${pid}`, lang: 'ja', detail: d }))).toBeUndefined();
    }
    const run = tcgpDetail({ pid: 723261, name: 'Pokemon Run Pikachu', group: 24864, groupName: 'Southeast Asia Exclusives', publishedOn: '2023-08-05' });
    expect(facts(input({ cardId: 'tcgp-723261', detail: run })).badge).toBeUndefined();
    // A data do próprio produto continua valendo.
    const dated = tcgpDetail({ pid: 7, name: 'X', group: 24864, groupName: 'Southeast Asia Exclusives', publishedOn: '2023-08-05', releasedOn: '2024-03-01' });
    expect(releaseFact(input({ cardId: 'tcgp-7', detail: dated }))).toEqual({ kind: 'day', day: '2024-03-01', source: 'catalog-product' });
  });

  it('collectorDex: o Pokémon da ficha; o da tela só quando a carta não é treinador nem energia', () => {
    const trainer = { id: 'sm9-1', localId: '1', name: 'Manectric Spirit Link', category: 'Trainer', set: { id: 'sm9', name: 'X' } } as CardDetail;
    expect(collectorDex(trainer, 310)).toEqual([]);
    expect(collectorDex({ ...trainer, category: 'Treinador' }, 310)).toEqual([]);
    expect(collectorDex({ ...trainer, category: 'Energia' }, 310)).toEqual([]);
    const tcgpTrainer: CardDetail = { ...tcgpDetail({ pid: 9, name: 'Manectric Spirit Link', group: 1, groupName: 'X' }), catalog: { productId: 9, category: 3, groupId: 1, cardType: 'Trainer - Pokémon Tool' } };
    expect(collectorDex(tcgpTrainer, 310)).toEqual([]);
    expect(collectorDex({ ...tcgpTrainer, catalog: { ...tcgpTrainer.catalog!, cardType: 'Basic Energy' } }, 310)).toEqual([]);
    // Pokémon: os da ficha; sem eles (ficha do catálogo ou sem ficha), o da tela.
    expect(collectorDex({ ...trainer, category: 'Pokemon', dexId: [25, 133] }, 310)).toEqual([25, 133]);
    expect(collectorDex({ ...tcgpTrainer, catalog: { ...tcgpTrainer.catalog!, cardType: 'Psychic' } }, 64)).toEqual([64]);
    expect(collectorDex(null, 64)).toEqual([64]);
    expect(collectorDex(null, 0)).toEqual([]);
  });
});

// ---------- Dia 01 da TCGdex (muitas vezes só o mês) ----------

describe('lançamento com o dia 01 na TCGdex', () => {
  // Datas reais: TCGdex (release_date) × catálogo (tcg_groups.published_on).
  const dp1Detail: CardDetail = {
    id: 'dp1-1',
    localId: '1',
    name: 'Dialga',
    rarity: 'Rare Holo',
    dexId: [483],
    set: { id: 'dp1', name: 'Diamond & Pearl', cardCount: { official: 130, total: 130 } },
    variants: VARIANTS,
  };
  const dp1Facts = { day: '2007-05-01', serieId: 'dp', serie: 'Diamond & Pearl' };
  const dp1Rows = [row({ product_id: 87100, group_id: 1430, tcgdex_id: 'dp1-1', number: '1/130', rarity: 'Holo Rare' }, { name: 'Diamond and Pearl', published_on: '2007-05-23T00:00:00' })];
  const dp1 = (o: Partial<CollectorInput> = {}) => facts(input({ cardId: 'dp1-1', detail: dp1Detail, enDetail: dp1Detail, set: dp1Facts, rows: dp1Rows, dex: [483], ...o }));

  it('Diamond & Pearl: o dia da coleção no catálogo (23/05/2007), não o "01/05/2007" da TCGdex', () => {
    const out = dp1();
    expect(out.release).toEqual({ kind: 'day', day: '2007-05-23', source: 'catalog-group' });
    expect(shown(out).release).toBe('23/05/2007 | Data da TCGplayer.');
    expect(labelOf(out, 'release')).toBe('Lançamento da coleção');
    expect(textOf(out)).not.toContain('01/05/2007');
    expect(out.badge).toEqual({ text: '2007', spoken: 'Ano da coleção: 2007' });
  });

  it('FireRed & LeafGreen (ex6): o catálogo pode cair no mês anterior (30/08/2004 contra 01/09/2004)', () => {
    const ex6: CardDetail = { ...dp1Detail, id: 'ex6-1', set: { id: 'ex6', name: 'FireRed & LeafGreen', cardCount: { official: 112, total: 116 } } };
    const out = facts(
      input({
        cardId: 'ex6-1',
        detail: ex6,
        enDetail: ex6,
        set: { day: '2004-09-01', serieId: 'ex', serie: 'EX' },
        rows: [row({ product_id: 87200, group_id: 1419, tcgdex_id: 'ex6-1', number: '1/112' }, { name: 'FireRed & LeafGreen', published_on: '2004-08-30' })],
      }),
    );
    expect(out.release).toEqual({ kind: 'day', day: '2004-08-30', source: 'catalog-group' });
  });

  it('o mesmo dia no catálogo confirma o da TCGdex (Cosmic Eclipse, 01/11/2019)', () => {
    const out = dp1({ set: { day: '2019-11-01', serieId: 'sm', serie: 'Sun & Moon' }, rows: [row({ product_id: 1, group_id: 2534, tcgdex_id: 'dp1-1' }, { name: 'Cosmic Eclipse', published_on: '2019-11-01' })] });
    expect(out.release).toEqual({ kind: 'day', day: '2019-11-01', source: 'set' });
    expect(shown(out).release).toBe('01/11/2019');
  });

  it('sem o catálogo (ou com um dia longe demais): só o mês e o ano, com o selo do ano', () => {
    for (const rows of [[], [row({ product_id: 1, group_id: 1430, tcgdex_id: 'dp1-1' }, { name: 'Diamond and Pearl', published_on: '2008-02-10' })]]) {
      const out = dp1({ rows });
      expect(out.release).toEqual({ kind: 'month', month: '2007-05' });
      expect(shown(out).release).toBe('05/2007 | A fonte não dá o dia.');
      expect(rowOf(out, 'release')?.spoken).toBe('Lançamento da coleção: maio de 2007. A fonte não dá o dia.');
      expect(out.badge).toEqual({ text: '2007', spoken: 'Ano da coleção: 2007' });
      expect(out.footer).toContain('TCGdex');
    }
  });

  it('em português: "Lançamento em inglês", e o dia do grupo do catálogo com a nota de sempre', () => {
    const pt = dp1({ lang: 'pt', dataLang: 'en' });
    expect(labelOf(pt, 'release')).toBe('Lançamento em inglês');
    expect(shown(pt).release).toBe('23/05/2007 | Data da coleção na TCGplayer.');
    expect(pt.badge?.text).toBe('2007 · EN');
    const month = dp1({ lang: 'pt', dataLang: 'en', rows: [] });
    expect(shown(month).release).toBe('05/2007 | A fonte não dá o dia.');
    expect(month.badge).toEqual({ text: '2007 · EN', spoken: 'Ano da coleção em inglês: 2007' });
  });

  it('o grupo de tudo um pouco não dá o dia da coleção', () => {
    const out = dp1({ rows: [row({ product_id: 1, group_id: 2374, tcgdex_id: 'dp1-1' }, { name: 'Miscellaneous Cards & Products', published_on: '2007-05-20' })] });
    expect(out.release).toEqual({ kind: 'month', month: '2007-05' });
  });

  it('outro dia da TCGdex (não 01) continua como veio', () => {
    expect(dp1({ set: { ...dp1Facts, day: '2007-05-23' }, rows: [] }).release).toEqual({ kind: 'day', day: '2007-05-23', source: 'set' });
  });

  it('japonesa: o dia 01 da coleção japonesa é o dia (SV4a, 01/12/2023; o catálogo em inglês não tem a carta)', () => {
    const sv4a: CardDetail = {
      id: 'SV4a-001',
      localId: '001',
      name: 'カード',
      rarity: 'Common',
      dexId: [],
      set: { id: 'SV4a', name: 'シャイニートレジャーex', cardCount: { official: 190, total: 190 } },
      variants: VARIANTS,
    };
    const out = facts(
      input({ cardId: 'SV4a-001', lang: 'ja', dataLang: 'ja', detail: sv4a, set: { day: '2023-12-01', serieId: 'SV', serie: 'ポケモンカードゲーム スカーレット&バイオレット' } }),
    );
    expect(out.release).toEqual({ kind: 'day', day: '2023-12-01', source: 'set' });
    expect(shown(out).release).toBe('01/12/2023');
    expect(textOf(out)).not.toContain('A fonte não dá o dia.');
    expect(out.badge).toEqual({ text: '2023', spoken: 'Ano da coleção: 2023' });
  });
});

// ---------- Regras que valem em toda carta (depois de todos os exemplos) ----------

describe('em todas as cartas acima', () => {
  it('toda linha com nota é larga; coleção, data, versão e Pokémon também', () => {
    const rows = ALL.flatMap((f) => f.rows);
    expect(rows.length).toBeGreaterThan(50);
    for (const r of rows) {
      if (r.note) expect(r.wide).toBe(true);
      if (['set', 'release', 'version', 'pokemon'].includes(r.key)) expect(r.wide).toBe(true);
    }
  });

  it('nenhuma linha vazia ou com "—"', () => {
    for (const r of ALL.flatMap((f) => f.rows)) {
      expect(r.value.trim()).not.toBe('');
      expect(r.value).not.toContain('—');
      expect(r.spoken.startsWith(`${r.label}: `)).toBe(true);
    }
  });

  it('o selo do título é sempre um ano só (nunca período nem "desde"); "· EN" na tela quando o leitor ouve "em inglês"', () => {
    const badges = ALL.flatMap((f) => (f.badge ? [f.badge] : []));
    expect(badges.some((b) => b.text.endsWith(' · EN'))).toBe(true);
    for (const b of badges) {
      expect(b.text).toMatch(/^\d{4}( · EN)?$/);
      expect(b.text.endsWith(' · EN')).toBe(b.spoken.includes('em inglês'));
    }
  });
});
