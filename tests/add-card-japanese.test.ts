// Carta japonesa no "+ Carta": código pela sigla da TCGplayer japonesa (85), a carta montada para salvar e o idioma
// lembrado no lote. Banco do catálogo e TCGdex simulados: nenhum teste acessa a rede.
import {
  alreadyInPocket,
  buildNewEntry,
  cardParams,
  cardsByCode,
  initialCardLang,
  isCopyOf,
  japaneseAliases,
  japaneseProductOf,
  parseCardCode,
  pickParams,
  placeOptions,
  rememberCardLang,
  savedAliasIds,
  searchStartLang,
  type Destination,
} from '@/lib/add-card';
import type { CardBrief } from '@/lib/tcgdex';
import type { Entry } from '@/lib/types';

import { fakeQueries, fakeTables } from './fake-catalog-db';
import { AT, entry, settings } from './fixtures';

jest.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => jest.requireActual('./fake-catalog-db').fakeFrom(t) } }));
jest.mock('@/store/collection', () => ({
  entryId: (dex: number, slot: number) => `${dex}-${slot}`,
  customEntryId: (binderId: string, slot: number) => `${binderId}:${slot}`,
}));

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const photo = (id: number) => `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_1000x1000.jpg`;
const product = (product_id: number, group_id: number, name: string, number: string, stamp: string | null = null, category = 85) => ({
  product_id,
  category,
  group_id,
  name,
  number,
  image: photo(product_id),
  stamp,
  tcgdex_id: null,
});

beforeAll(() => {
  // TCGdex japonesa: só a coleção PMCG1 (reserva quando a 85 não tem a sigla).
  globalThis.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (/\/v2\/ja\/sets\/PMCG1$/i.test(url)) return json({ id: 'PMCG1', name: '拡張パック', cards: [{ id: 'PMCG1-025', localId: '025', name: 'ピカチュウ' }] });
    return json(null, 404);
  }) as unknown as typeof fetch;
});

beforeEach(() => {
  fakeQueries.length = 0;
  fakeTables.tcg_groups = [
    { group_id: 24711, category: 85, abbr: 'M5', name: 'M5: Abyss Eye', published_on: '2026-01-23' },
    { group_id: 23300, category: 85, abbr: 'SV2a', name: 'SV2a: Pokemon Card 151', published_on: '2023-06-16' },
    // Mesma sigla na categoria 3: nunca entra numa carta japonesa.
    { group_id: 1, category: 3, abbr: 'M5', name: 'Coleção em inglês', published_on: '2026-01-01' },
  ];
  fakeTables.tcg_catalog = [
    product(695039, 24711, 'Dhelmise', '088/081'),
    product(695040, 24711, 'Dhelmise', '088/081', 'Mirror Holofoil'),
    product(695041, 24711, 'Tropius', '001/081'),
    product(511111, 23300, 'Pikachu', '025/165'),
    product(511112, 23300, 'Pikachu', '025/165', 'Master Ball Pattern'),
    product(511113, 23300, 'Pikachu', '025/165', 'Poke Ball Pattern'),
    product(9, 1, 'Dhelmise', '088/100', null, 3),
  ];
});

describe('cardsByCode em japonês (sigla da TCGplayer japonesa)', () => {
  it.each(['M5 088', 'M5 088/081', 'M5-088', 'm5 88', '088/081 M5'])('%s → Dhelmise 088/081 com foto, e a versão Mirror à parte', async (text) => {
    const code = parseCardCode(text);
    expect(code).not.toBeNull();
    const res = await cardsByCode(code!, 'ja');
    expect(res.partial).toBe(false);
    expect(res.cards.map((c) => `${c.id}${c.stamp ? ` · ${c.stamp.variant}` : ''}`)).toEqual(['tcgp-695039', 'tcgp-695040 · reverse']);
    expect(res.cards[0]).toMatchObject({
      lang: 'ja',
      localId: '088',
      name: 'Dhelmise',
      setId: 'tcgp24711',
      setName: 'M5: Abyss Eye',
      imageUrl: photo(695039),
      series: 'Megaevolução (2025–)',
    });
    // Dados da própria carta japonesa: nada de "só em inglês". O produto 9 (mesma sigla e número na categoria 3, em
    // inglês) não entra.
    expect(res.cards[0].dataLang).toBeUndefined();
  });

  it('a mesma sigla em inglês e em japonês: cada idioma lê só a sua categoria (e guarda à parte)', async () => {
    fakeTables.tcg_groups.push(
      { group_id: 2, category: 3, abbr: 'XX9', name: 'Inglesa', published_on: null },
      { group_id: 3, category: 85, abbr: 'XX9', name: 'Japonesa', published_on: null },
    );
    fakeTables.tcg_catalog.push(product(31, 2, 'Pikachu', '010/100', null, 3), product(32, 3, 'Pikachu', '010/050'));
    const ja = await cardsByCode(parseCardCode('XX9 010')!, 'ja');
    const en = await cardsByCode(parseCardCode('XX9 010')!, 'en');
    expect(ja.cards.map((c) => c.id)).toEqual(['tcgp-32']);
    expect(en.cards.map((c) => c.id)).toEqual(['tcgp-31']);
    const groups = fakeQueries.filter((q) => q.table === 'tcg_groups').map((q) => q.filters[0]);
    expect(groups).toEqual(expect.arrayContaining(['category=85', 'category=3']));
  });

  it('padrões Poké Ball e Master Ball viram as variações deles', async () => {
    const res = await cardsByCode(parseCardCode('SV2a 025')!, 'ja');
    expect(res.cards.map((c) => [c.id, c.stamp?.variant ?? 'comum'])).toEqual([
      ['tcgp-511111', 'comum'],
      ['tcgp-511112', 'masterball'],
      ['tcgp-511113', 'pokeball'],
    ]);
  });

  it('sigla que a 85 não tem: a reserva da TCGdex japonesa pelo id da coleção', async () => {
    const res = await cardsByCode(parseCardCode('PMCG1-025')!, 'ja');
    expect(res.cards.map((c) => c.id)).toEqual(['PMCG1-025']);
    expect(res.cards[0]).toMatchObject({ lang: 'ja', name: 'ピカチュウ' });
  });

  it('número que não existe: nenhuma carta (sem cair na carta em inglês de mesma sigla)', async () => {
    const res = await cardsByCode(parseCardCode('M5 099')!, 'ja');
    expect(res.cards).toEqual([]);
  });
});

describe('carta japonesa só do catálogo pronta para salvar (buildNewEntry)', () => {
  const dest: Destination = { key: 'dex', kind: 'dex', dex: 781, slot: 0, title: '#781 Dhelmise', detail: '', where: '' };
  const base: CardBrief = {
    id: 'tcgp-695039',
    localId: '088',
    name: 'Dhelmise',
    lang: 'ja',
    setId: 'tcgp24711',
    setName: 'M5: Abyss Eye',
    setNameEn: 'M5: Abyss Eye',
    setOrder: 20260123,
    imageUrl: photo(695039),
  };

  it('comum: variação normal, foto da 85 e sem dataLang', () => {
    const e = buildNewEntry({ card: base, facts: null, version: null, condition: 'NM', dest });
    expect(e).toMatchObject({ cardId: 'tcgp-695039', lang: 'ja', variant: 'normal', imageUrl: photo(695039), setId: 'tcgp24711', dex: 781 });
    expect(e.dataLang).toBeUndefined();
    expect(e.variantNote).toBeUndefined();
  });

  it('Mirror: reverse, com o selo e a foto da versão', () => {
    const mirror: CardBrief = { ...base, id: 'tcgp-695040', imageUrl: photo(695040), stamp: { variant: 'reverse', label: 'Mirror Holofoil', keys: [] } };
    const e = buildNewEntry({ card: mirror, facts: null, version: null, condition: 'NM', dest });
    expect(e).toMatchObject({ cardId: 'tcgp-695040', variant: 'reverse', variantNote: 'Mirror Holofoil', stampPhoto: photo(695040) });
    expect(cardParams(mirror)).toMatchObject({ lang: 'ja', dataLang: 'ja', variant: 'reverse', stamp: 'Mirror Holofoil', photo: photo(695040) });
  });
});

describe('idioma lembrado no lote', () => {
  it('o último idioma tocado vale nas próximas telas (se for um dos permitidos)', () => {
    expect(initialCardLang('pt', ['pt', 'en', 'ja'])).toBe('pt');
    rememberCardLang('ja');
    expect(initialCardLang('pt', ['pt', 'en', 'ja'])).toBe('ja');
    expect(initialCardLang('en')).toBe('ja');
    // Fichário configurado sem japonês: o padrão dele.
    expect(initialCardLang('pt', ['pt', 'en'])).toBe('pt');
  });
});

describe('idioma inicial da busca (searchStartLang)', () => {
  it('no bolso de um fichário livre, o idioma dele vale antes do lembrado no lote', () => {
    rememberCardLang('ja');
    expect(searchStartLang({ pocketLang: 'en', fallback: 'pt' })).toBe('en');
  });

  it('no "+ Carta" e no fichário sem idioma, o lembrado no lote vale primeiro', () => {
    rememberCardLang('ja');
    expect(searchStartLang({ preferredLang: 'en', fallback: 'pt' })).toBe('ja');
    expect(searchStartLang({ fallback: 'pt' })).toBe('ja');
  });
});

describe('a mesma carta japonesa com dois ids (produto da 85 e carta da TCGdex japonesa salva)', () => {
  /** A Dhelmise salva antes das japonesas pela TCGplayer: id da TCGdex japonesa, holo. */
  const savedM5: Entry = entry({
    id: '781-0',
    dex: 781,
    cardId: 'M5-088',
    lang: 'ja',
    cardName: 'ダダリン',
    setName: 'アビスアイ',
    setId: 'M5',
    localId: '088',
    setTotal: 81,
    variant: 'holo',
  });
  /** O mesmo, com o preço já ligado pela busca de preço ao produto 695039. */
  const pricedM5: Entry = { ...savedM5, tcgplayer: { cardId: 'M5-088', variant: 'holo', productId: 695039, checkedAt: AT } };
  const product: CardBrief = {
    id: 'tcgp-695039',
    localId: '088',
    name: 'Dhelmise',
    lang: 'ja',
    setId: 'tcgp24711',
    setName: 'M5: Abyss Eye',
    setNameEn: 'M5: Abyss Eye',
    setOrder: 20260123,
    imageUrl: photo(695039),
  };
  /** Na lista do Pokémon e na busca em japonês: a lista ligou o produto à M5-088. */
  const listed: CardBrief = { ...product, tcgdexId: 'M5-088' };
  const mirror: CardBrief = { ...product, id: 'tcgp-695040', imageUrl: photo(695040), stamp: { variant: 'reverse', label: 'Mirror Holofoil', keys: [] } };

  it('japaneseProductOf: o produto comum do preço da carta da TCGdex japonesa salva', () => {
    expect(japaneseProductOf(pricedM5)).toBe('tcgp-695039');
    // Sem preço ligado, preço de outra carta, carta só do catálogo ou de outro idioma: nenhum.
    expect(japaneseProductOf(savedM5)).toBeUndefined();
    expect(japaneseProductOf({ ...pricedM5, tcgplayer: { ...pricedM5.tcgplayer!, cardId: 'M5-037' } })).toBeUndefined();
    expect(japaneseProductOf({ ...pricedM5, cardId: 'tcgp-695039', tcgplayer: { ...pricedM5.tcgplayer!, cardId: 'tcgp-695039' } })).toBeUndefined();
    expect(japaneseProductOf({ ...pricedM5, lang: 'en' })).toBeUndefined();
    // Reverse pelo produto Mirror (com selo): não é o comum. Reverse "≈ aproximado" pela comum: é.
    const reverse = { ...pricedM5, variant: 'reverse' as const, tcgplayer: { ...pricedM5.tcgplayer!, variant: 'reverse', productId: 695040 } };
    expect(japaneseProductOf(reverse)).toBeUndefined();
    expect(japaneseProductOf({ ...reverse, tcgplayer: { ...reverse.tcgplayer, productId: 695039, base: true } })).toBe('tcgp-695039');
  });

  it('japaneseAliases e savedAliasIds: o produto comum leva às cartas da TCGdex salvas (pela lista ou pelo preço)', () => {
    const aliases = japaneseAliases([pricedM5, entry()]);
    expect([...aliases]).toEqual([['tcgp-695039', ['M5-088']]]);
    // Busca latina e por código: o produto vem sem tcgdexId, e o preço da salva liga os dois.
    expect(savedAliasIds(product, aliases)).toEqual(['M5-088']);
    expect(savedAliasIds(listed, new Map())).toEqual(['M5-088']);
    expect(savedAliasIds(listed, aliases)).toEqual(['M5-088']);
    // Versão com selo e cartas de outro idioma: só o próprio id.
    expect(savedAliasIds(mirror, aliases)).toEqual([]);
    expect(savedAliasIds({ ...product, lang: 'en' }, aliases)).toEqual([]);
  });

  it('isCopyOf: a M5-088 salva é cópia do produto 695039 (e o inverso), nunca da versão Mirror', () => {
    expect(isCopyOf(savedM5, listed)).toBe(true);
    expect(isCopyOf(savedM5, product)).toBe(false);
    expect(isCopyOf(pricedM5, product)).toBe(true);
    expect(isCopyOf(pricedM5, mirror)).toBe(false);
    expect(isCopyOf({ ...pricedM5, lang: 'pt' }, product)).toBe(false);
    // Tela da carta da M5-088 salva: o produto comum dela acha a cópia salva como "tcgp-".
    const copy = entry({ id: '781-1', cardId: 'tcgp-695039', lang: 'ja', variant: 'normal' });
    expect(isCopyOf(copy, { id: 'M5-088', lang: 'ja', product: japaneseProductOf(pricedM5) })).toBe(true);
    expect(isCopyOf(copy, { id: 'M5-088', lang: 'ja' })).toBe(false);
    // Sempre: mesmo id e idioma.
    expect(isCopyOf(copy, { id: 'tcgp-695039', lang: 'ja' })).toBe(true);
  });

  it('pickParams: tocar no produto no bolso da M5-088 abre a carta salva (sem "Substituir" nem chave nova)', () => {
    expect(pickParams(listed, savedM5)).toMatchObject({ cardId: 'M5-088', lang: 'ja', dataLang: 'ja', variant: undefined, stamp: undefined });
    // Busca latina ou por código (sem tcgdexId): pelo preço ligado.
    expect(pickParams(product, pricedM5).cardId).toBe('M5-088');
    // Bolso vazio, outra carta no bolso, ou a versão Mirror: o produto, como sempre.
    expect(pickParams(listed).cardId).toBe('tcgp-695039');
    expect(pickParams(listed, entry({ id: '781-0', cardId: 'M5-037', lang: 'ja' })).cardId).toBe('tcgp-695039');
    expect(pickParams(mirror, pricedM5).cardId).toBe('tcgp-695040');
    // A tela da carta recebe o id da TCGdex para achar as cópias.
    expect(cardParams(listed).tcgdexId).toBe('M5-088');
  });

  describe('"+ Carta" com o bolso do Pokémon ocupado pela mesma carta (placeOptions)', () => {
    const options = (pocket: Entry, card: CardBrief, picked?: { variant: Entry['variant']; stamp?: string } | null) =>
      placeOptions({ dex: 781, settings: settings(), binders: [], entries: { [pocket.id]: pocket }, card, picked });

    it('a M5-088 no bolso e o produto tcgp-695039 escolhido: sem "Substituir", com o bolso onde ela já está', () => {
      const { dests, here } = options(savedM5, listed);
      expect(dests.map((d) => d.kind)).toEqual(['extra']);
      expect(here).toMatchObject({ kind: 'replace', dex: 781, slot: 0, replaces: savedM5 });
      // A folha mostra "Esta carta já está neste bolso: #781 Dhelmise · pág. 87, bolso 7."
      expect(here!.detail).toBe('#781 Dhelmise · pág. 87, bolso 7');
      // Pela busca latina ou por código (sem tcgdexId): pelo preço ligado. E a própria carta, com o mesmo id.
      expect(options(pricedM5, product).here).toBeDefined();
      const copy = entry({ id: '781-0', dex: 781, cardId: 'tcgp-695039', lang: 'ja', variant: 'normal' });
      expect(options(copy, product).here).toBeDefined();
    });

    it('outra carta, a versão Mirror ou outro idioma no bolso: "Substituir" continua (nunca marcado sozinho)', () => {
      const other = entry({ id: '781-0', dex: 781, cardId: 'M5-037', lang: 'ja', cardName: 'ダダリン' });
      for (const [pocket, card] of [
        [other, listed],
        [pricedM5, mirror],
        [{ ...savedM5, lang: 'en' as const }, listed],
      ] as [Entry, CardBrief][]) {
        const { dests, here } = options(pocket, card);
        expect(here).toBeUndefined();
        expect(dests.map((d) => d.kind)).toEqual(['extra', 'replace']);
      }
    });

    it('como a tela da carta: a versão tocada (ou o selo da carta da lista) diferente da salva é troca', () => {
      // Sem tocar em nenhuma versão vale a carta; tocando, a variação dela.
      expect(alreadyInPocket(savedM5, listed)).toBe(true);
      expect(alreadyInPocket(savedM5, listed, { variant: 'holo' })).toBe(true);
      expect(alreadyInPocket(savedM5, listed, { variant: 'reverse' })).toBe(false);
      expect(options(savedM5, listed, { variant: 'reverse' }).here).toBeUndefined();
      // Português: a mesma carta comum é "já está"; a versão com selo da lista (mesmo id) é troca, como na tela da carta.
      const pt = entry({ id: '25-0' });
      const common: CardBrief = { id: 'sv03.5-025', localId: '025', name: 'Pikachu', lang: 'pt', setId: 'sv03.5', setName: '151', setNameEn: '151', setOrder: 1 };
      const stamped: CardBrief = { ...common, stamp: { variant: 'wPromo', label: 'Pokémon Center', keys: ['pokemon-center'] } };
      expect(alreadyInPocket(pt, common)).toBe(true);
      expect(alreadyInPocket(pt, stamped)).toBe(false);
      expect(alreadyInPocket({ ...pt, variant: 'wPromo', variantNote: 'Pokémon Center' }, stamped)).toBe(true);
      expect(alreadyInPocket(undefined, common)).toBe(false);
    });
  });
});
