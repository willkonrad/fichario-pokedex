// Carta gigante (Jumbo) no MYP: como na TCGplayer, só o produto próprio dela; nunca o preço da carta comum (o MYP só
// cadastra o Charizard comum da Base Set, e a busca caía nele como "carta base"). Caminho inteiro: a busca do MYP pela
// carta salva, o valor da carta e a nova busca das cartas que já tinham o preço da comum.
import type { MypProduct } from '@/lib/myp-match';
import type { Entry } from '@/lib/types';

import { AT, entry, myp, tcg } from './fixtures';

type Api = typeof import('@/lib/myp-api');
type Valuation = typeof import('@/lib/valuation');

jest.mock('@/lib/supabase', () => ({
  supabase: null,
  isNetworkError: (err: unknown) => err instanceof Error && /network request failed/i.test(err.message),
}));

/** Charizard comum da Base Set no MYP (o que a busca pelo nome devolve). */
const common: MypProduct = {
  internal_code: 77,
  card_code: 'pokemon_bs_004/102',
  edition_code: 'BS',
  name_en: 'Charizard',
  min_price: '480.00',
  avg_price: '600.00',
  max_price: '700.00',
  available_quantity: 12,
  link: 'https://mypcards.com/pokemon/produto/77',
};

/** A ficha da TCGdex e a sigla da coleção (a busca do MYP precisa delas). */
function mockTcgdex() {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes('/en/cards/')
      ? { name: 'Charizard', set: { cardCount: { official: 102 } } }
      : url.includes('/en/sets/')
        ? { abbreviation: { official: 'BS' } }
        : {};
    return { status: 200, ok: true, json: async () => body } as Response;
  });
}

function load() {
  let api!: Api;
  let val!: Valuation;
  jest.isolateModules(() => {
    api = jest.requireActual('@/lib/myp-api');
    val = jest.requireActual('@/lib/valuation');
  });
  return { api, val };
}

afterEach(() => jest.restoreAllMocks());

/** O Charizard Jumbo da lista ("Jumbo Cards · CoroCoro Promo"), salvo em inglês. */
const jumbo = (over: Partial<Entry> = {}) =>
  entry({
    id: '6-0',
    dex: 6,
    cardId: 'base1-4',
    cardName: 'Charizard',
    setId: 'base1',
    setName: 'Base Set',
    localId: '4',
    setTotal: 102,
    lang: 'en',
    variant: 'wPromo',
    variantNote: 'Jumbo Cards · CoroCoro Promo',
    ...over,
  });
const consultFrom = (list: MypProduct[]) => jest.fn(async (_name: string) => list);

describe('carta Jumbo no MYP', () => {
  it('só com o produto comum: sem preço (nunca o da carta comum como valor aproximado)', async () => {
    mockTcgdex();
    const { api, val } = load();
    const e = jumbo();
    const consultCode = jest.fn(async (_code: string) => [common]);
    const price = await api.fetchMypPrice(e, consultFrom([common]), consultCode);
    expect(price).toMatchObject({ cardId: 'base1-4', variant: 'wPromo', note: 'Jumbo Cards · CoroCoro Promo', notFound: 'sem o produto Jumbo no MYP' });
    expect(price.avg).toBeUndefined();
    expect(price.productId).toBeUndefined();
    // A TCGplayer também não tem o produto Jumbo: a carta fica sem valor (não entra na soma).
    const saved: Entry = { ...e, mypApi: price, tcgplayer: tcg(e, { note: e.variantNote, notFound: 'sem o produto desta versão na TCGplayer', min: undefined, avg: undefined, max: undefined }) };
    expect(val.valuation(saved).value).toBeUndefined();
    expect(val.priceSources(saved)).toEqual([]);
  });

  it('com o produto Jumbo próprio no MYP: o preço dele, como a versão exata', async () => {
    mockTcgdex();
    const { api, val } = load();
    const own: MypProduct = { ...common, internal_code: 78, card_code: 'pokemon_bs_004/102p1', name_en: 'Charizard (Jumbo CoroCoro Promo)', avg_price: '900.00', min_price: '800.00', max_price: '1000.00' };
    const e = jumbo();
    const price = await api.fetchMypPrice(e, consultFrom([common, own]));
    expect(price).toMatchObject({ productId: 78, avg: 900, ownVersion: true });
    expect(price.notFound).toBeUndefined();
    const v = val.valuation({ ...e, mypApi: price, tcgplayer: tcg(e, { note: e.variantNote, notFound: 'sem o produto desta versão na TCGplayer', min: undefined, avg: undefined, max: undefined }) });
    expect(v.value).toBe(900);
    expect(v.approx).toBe('otherLanguages');
  });

  it('Jumbo marcado em outra variação (selo "Jumbo" num holo): sem consultar o MYP, sem preço', async () => {
    mockTcgdex();
    const { api } = load();
    const consult = consultFrom([common]);
    const price = await api.fetchMypPrice(jumbo({ variant: 'holo', variantNote: 'Jumbo' }), consult);
    expect(consult).not.toHaveBeenCalled();
    expect(price).toMatchObject({ variant: 'holo', notFound: 'sem o produto Jumbo no MYP' });
    expect(price.note).toBeUndefined();
  });

  it('a carta comum continua com o preço do produto comum', async () => {
    mockTcgdex();
    const { api } = load();
    const price = await api.fetchMypPrice(jumbo({ variant: 'normal', variantNote: undefined }), consultFrom([common]));
    expect(price).toMatchObject({ productId: 77, avg: 600 });
  });

  it('Jumbo já salvo com o preço da carta comum (regra antiga) é buscado de novo, sem esperar os 7 dias', () => {
    const { api } = load();
    const now = new Date(AT).getTime() + 60_000;
    const e = jumbo();
    const old = myp(e, { note: e.variantNote, productId: 77, avg: 600, v: api.MYP_MATCHER });
    expect(api.mypApiDue({ ...e, mypApi: old }, now)).toBe(true);
    // Já com a resposta da regra nova (sem preço, ou o produto próprio): só depois dos 7 dias.
    expect(api.mypApiDue({ ...e, mypApi: { ...old, avg: undefined, productId: undefined, notFound: 'sem o produto Jumbo no MYP' } }, now)).toBe(false);
    expect(api.mypApiDue({ ...e, mypApi: { ...old, productId: 78, ownVersion: true } }, now)).toBe(false);
    // Carta comum com o preço do produto comum: nada muda.
    const plain = jumbo({ variant: 'normal', variantNote: undefined });
    expect(api.mypApiDue({ ...plain, mypApi: myp(plain, { v: api.MYP_MATCHER }) }, now)).toBe(false);
  });
});
