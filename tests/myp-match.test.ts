import { num, parseMypCode, pickMypProduct, price, type MypProduct } from '@/lib/myp-match';

describe('num e parseMypCode', () => {
  it.each([
    ['007', '7'],
    ['SWSH001', 'swsh1'],
    ['TG06', 'tg6'],
    ['0', '0'],
    [' 25 ', '25'],
  ])('num(%s) → %s', (input, out) => {
    expect(num(input)).toBe(out);
  });

  it.each([
    ['pokemon_meg_001/132p1', { number: '1', version: 'p1' }],
    ['pokemon_meg_001/132P2', { number: '1', version: 'p2' }],
    ['pokemon_svp_218', { number: '218', version: undefined }],
    ['pokemon_svp_218p1', { number: '218', version: 'p1' }],
    // Erro de digitação no prefixo: só vale o trecho depois do último "_".
    ['pokemomn_meg_045/132', { number: '45', version: undefined }],
    ['pokemon_swsh_SWSH001', { number: 'swsh1', version: undefined }],
    ['pokemon_bs_079a/102', { number: '79a', version: undefined }],
  ])('parseMypCode(%s)', (code, out) => {
    expect(parseMypCode(code)).toEqual(out);
  });

  it('price: texto da API → número', () => {
    expect(price('15.00')).toBe(15);
    expect(price('0.5')).toBe(0.5);
    expect(price('')).toBeUndefined();
    expect(price(null)).toBeUndefined();
    expect(price(undefined)).toBeUndefined();
  });
});

let nextCode = 1;
const product = (card_code: string, over: Partial<MypProduct> = {}): MypProduct => ({
  internal_code: nextCode++,
  card_code,
  edition_code: 'MEG',
  name_en: 'Pikachu - 001/132',
  name_pt: 'Pikachu - 001/132',
  min_price: '1.00',
  avg_price: '2.00',
  max_price: '3.00',
  available_quantity: 5,
  ...over,
});

describe('pickMypProduct', () => {
  it('mesma edição e mesmo número', () => {
    const hit = product('pokemon_meg_001/132');
    const got = pickMypProduct([product('pokemon_meg_002/132'), hit, product('pokemon_svi_001/198', { edition_code: 'SVI' })], 'MEG', '001', 'normal');
    expect(got).toEqual({ product: hit, ownVersion: false });
  });

  it('sigla com ":" e listas de siglas e de números', () => {
    const hit = product('pokemon_svp_085', { edition_code: 'SVP' });
    expect(pickMypProduct([hit], 'SVP: Black Star Promos', '85', 'normal')?.product).toBe(hit);
    expect(pickMypProduct([hit], ['PR-SV', 'svp'], ['SVP085', '085'], 'normal')?.product).toBe(hit);
  });

  it('outra edição ou outro número: nada', () => {
    expect(pickMypProduct([product('pokemon_meg_001/132')], 'SVI', '001', 'normal')).toBeUndefined();
    expect(pickMypProduct([product('pokemon_meg_001/132')], 'MEG', '010', 'normal')).toBeUndefined();
  });

  it('produtos comuns repetidos: o com mais unidades à venda', () => {
    const few = product('pokemon_meg_001/132', { available_quantity: 2 });
    const many = product('pokemon_meg_001/132', { available_quantity: 40 });
    const none = product('pokemon_meg_001/132', { available_quantity: null });
    expect(pickMypProduct([few, none, many], 'MEG', '1', 'normal')?.product).toBe(many);
  });

  it('versão comum nunca fica com o produto de uma versão com selo', () => {
    const stamped = product('pokemon_meg_001/132p1', { name_en: 'Pikachu (Pokemon Center) - 001/132' });
    expect(pickMypProduct([stamped], 'MEG', '001', 'normal')).toBeUndefined();
    const common = product('pokemon_meg_001/132');
    expect(pickMypProduct([stamped, common], 'MEG', '001', 'holo')).toEqual({ product: common, ownVersion: false });
  });

  it('promo com selo: o produto próprio só quando o nome traz uma palavra do selo', () => {
    const common = product('pokemon_meg_001/132');
    const center = product('pokemon_meg_001/132p1', { name_en: 'Pikachu (Pokemon Center) - 001/132' });
    const day = product('pokemon_meg_001/132p2', { name_en: 'Pikachu (Pokemon Day 2026) - 001/132' });
    const list = [common, center, day];
    expect(pickMypProduct(list, 'MEG', '001', 'wPromo', 'Pokémon Center')).toEqual({ product: center, ownVersion: true });
    // "30th Pokeday" (TCGdex) = "Pokemon Day" (MYP).
    expect(pickMypProduct(list, 'MEG', '001', 'staff', '30th Pokeday')).toEqual({ product: day, ownVersion: true });
    // Selo que nenhum produto traz: o produto comum, que não vale só para a versão.
    expect(pickMypProduct(list, 'MEG', '001', 'wPromo', 'Worlds 2025')).toEqual({ product: common, ownVersion: false });
    // Sem selo marcado: o comum.
    expect(pickMypProduct(list, 'MEG', '001', 'wPromo')).toEqual({ product: common, ownVersion: false });
  });

  it('palavras do nome da carta não contam como selo', () => {
    const common = product('pokemon_meg_001/132', { name_en: 'Pikachu ex - 001/132' });
    const own = product('pokemon_meg_001/132p1', { name_en: 'Pikachu ex (Prerelease) - 001/132' });
    expect(pickMypProduct([common, own], 'MEG', '001', 'staff', 'Pikachu')).toEqual({ product: common, ownVersion: false });
    expect(pickMypProduct([common, own], 'MEG', '001', 'staff', 'Pre-Release')).toEqual({ product: own, ownVersion: true });
  });

  it('número com letra no fim, como o MYP cadastra algumas promos', () => {
    const hit = product('pokemon_meg_079a/132');
    expect(pickMypProduct([hit], 'MEG', '079', 'normal')?.product).toBe(hit);
  });

  it('coleções numeradas de outro jeito: pelo nome, só quando há um produto com ele', () => {
    const charizard = product('pokemon_bs_004/102', { edition_code: 'BS', name_en: 'Charizard - 004/102' });
    const blastoise = product('pokemon_bs_002/102', { edition_code: 'BS', name_en: 'Blastoise - 002/102' });
    expect(pickMypProduct([charizard, blastoise], 'BS', '6', 'normal', '', ['Charizard'])?.product).toBe(charizard);
    expect(pickMypProduct([charizard, blastoise], 'BS', '6', 'normal')).toBeUndefined();
    const twin = product('pokemon_bs_104/102', { edition_code: 'BS', name_en: 'Charizard - 104/102' });
    expect(pickMypProduct([charizard, twin], 'BS', '6', 'normal', '', ['Charizard'])).toBeUndefined();
  });
});
