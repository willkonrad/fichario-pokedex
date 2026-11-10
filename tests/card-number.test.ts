import { isPromoSet, printedNumber } from '@/lib/card-number';
import { collectorFacts, setOfCard } from '@/lib/collector';
import { ligaQuery } from '@/lib/liga';
import { cardNumber } from '@/lib/lists';

// Número da carta como impresso (tela da carta, listas e busca da Liga). Dados das coleções conferidos na TCGdex.

describe('printedNumber', () => {
  it('`promo` dado por quem chama vale no lugar de isPromoSet; sem ele, nada muda', () => {
    // SV2P (Snow Hazard) termina em "P", mas é coleção comum: "045/071".
    expect(printedNumber({ localId: '045', total: 71, setId: 'SV2P', promo: false })).toBe('045/071');
    expect(printedNumber({ localId: '045', total: 71, setId: 'SV2P' })).toBe('045');
    expect(printedNumber({ localId: '1', total: 12, setId: 'tk-ex-p', promo: false })).toBe('1/12');
    expect(printedNumber({ localId: '1', total: 12, setId: 'tk-ex-p' })).toBe('1');
    expect(printedNumber({ localId: '33', total: 53, setId: 'basep', promo: true })).toBe('33');
    expect(printedNumber({ localId: '33', total: 53, setId: 'basep' })).toBe('33');
    expect(printedNumber({ localId: '025', total: 165, setId: 'sv03.5', setName: 'Promos', promo: false })).toBe('025/165');
  });

  it('total com zeros só até a largura do número', () => {
    // Jungle: Clefable é "1/64", não "1/064".
    expect(printedNumber({ localId: '1', total: 64, setId: 'base2' })).toBe('1/64');
    expect(printedNumber({ localId: '4', total: 102, setId: 'base1' })).toBe('4/102');
    expect(printedNumber({ localId: '025', total: 165, setId: 'sv03.5' })).toBe('025/165');
    expect(printedNumber({ localId: '011', total: 94 })).toBe('011/094');
    // Secreta: o número passa do total.
    expect(printedNumber({ localId: '201', total: 165, setId: 'sv03.5' })).toBe('201/165');
  });

  it('galeria: a sigla vai também no total', () => {
    expect(printedNumber({ localId: 'TG05', total: 30, setId: 'swsh12tg' })).toBe('TG05/TG30');
    expect(printedNumber({ localId: 'GG01', total: 70, setId: 'swsh12.5gg' })).toBe('GG01/GG70');
    expect(printedNumber({ localId: 'SV1', total: 94, setId: 'sma' })).toBe('SV1/SV94');
  });

  it('número com letras na coleção principal: só o número (o total não é o da sub-coleção)', () => {
    // Gerações: 83 cartas oficiais, mas a Radiant Collection é "RC5/RC32".
    expect(printedNumber({ localId: 'RC5', total: 83, setId: 'g1' })).toBe('RC5');
  });

  it('promo: sem o total que a TCGdex inventa', () => {
    expect(printedNumber({ localId: 'SWSH020', total: 307, setId: 'swshp' })).toBe('SWSH020');
    expect(printedNumber({ localId: '001', total: 225, setId: 'svp' })).toBe('001');
    expect(printedNumber({ localId: '1', total: 53, setId: 'basep' })).toBe('1');
    // Carta só do catálogo, sem id da coleção: pelo nome.
    expect(printedNumber({ localId: '085', total: 200, setName: 'SV: Scarlet & Violet Promo Cards' })).toBe('085');
  });

  it('sem total ou sem número', () => {
    expect(printedNumber({ localId: '025' })).toBe('025');
    expect(printedNumber({ localId: '025', total: 0 })).toBe('025');
    expect(printedNumber({ localId: '', total: 165 })).toBe('');
    expect(printedNumber({})).toBe('');
  });

  it('isPromoSet: ids terminados em "p" e nomes com "Promo"', () => {
    expect(isPromoSet({ setId: 'mep' })).toBe(true);
    expect(isPromoSet({ setId: 'SV-P' })).toBe(true);
    expect(isPromoSet({ setName: 'ESES Promos' })).toBe(true);
    expect(isPromoSet({ setId: 'sv03.5', setName: 'Escarlate e Violeta 151' })).toBe(false);
  });
});

describe('cardNumber (listas e relatórios)', () => {
  it('usa a mesma regra da tela da carta', () => {
    expect(cardNumber({ localId: '1', setTotal: 64, setId: 'base2' })).toBe('1/64');
    expect(cardNumber({ localId: 'SWSH020', setTotal: 307, setId: 'swshp' })).toBe('SWSH020');
    expect(cardNumber({ localId: '025', setTotal: 165 })).toBe('025/165');
    expect(cardNumber({ localId: '', setTotal: 165 })).toBe('');
  });

  it('o mesmo número do título da carta: promo pela lista fechada, japonesa antiga sem número', () => {
    const screen = (cardId: string, lang: 'pt' | 'en' | 'ja', localId: string, total: number, setName = '') =>
      collectorFacts({ cardId, lang, dataLang: lang, detail: null, enDetail: null, rows: [], dex: [], saved: { setId: setOfCard(cardId), setName, localId, setTotal: total } }).number;
    const list = (cardId: string, lang: 'pt' | 'en' | 'ja', localId: string, total: number, setName = '') =>
      cardNumber({ localId, setTotal: total, setId: setOfCard(cardId), setName, lang });
    const cases: [string, 'pt' | 'en' | 'ja', string, number, string, string][] = [
      // SV2P (Snow Hazard) e tk-ex-p (kit) terminam em "P", mas são coleções comuns.
      ['SV2P-045', 'ja', '045', 71, '', '045/071'],
      ['tk-ex-p-1', 'en', '1', 12, 'EX trainer Kit (Plusle)', '1/12'],
      ['svp-027', 'pt', '027', 225, '', '027'],
      ['S-P-001', 'ja', '001', 200, '', '001'],
      ['PMCG1-021', 'ja', '021', 102, '', ''],
      ['sv03.5-025', 'pt', '025', 165, '151', '025/165'],
    ];
    for (const [cardId, lang, localId, total, setName, expected] of cases) {
      expect(list(cardId, lang, localId, total, setName)).toBe(expected);
      expect(list(cardId, lang, localId, total, setName)).toBe(screen(cardId, lang, localId, total, setName));
    }
    // Carta só do catálogo: promo pelo nome do grupo, como antes.
    expect(cardNumber({ localId: '085', setTotal: 200, setId: 'tcgp22872', setName: 'SV: Scarlet & Violet Promo Cards', lang: 'en' })).toBe('085');
  });
});

describe('ligaQuery', () => {
  it('nome em inglês e o número como impresso', () => {
    expect(ligaQuery('Alakazam EX', '25', 124)).toBe('Alakazam EX (25/124)');
    expect(ligaQuery('Charmander', '011', 94)).toBe('Charmander (011/094)');
    expect(ligaQuery('Clefable', '1', 64, { setId: 'base2' })).toBe('Clefable (1/64)');
    expect(ligaQuery('Gardevoir', 'TG05', 30, { setId: 'swsh12tg' })).toBe('Gardevoir (TG05/TG30)');
  });

  it('sem total impresso (promo), só o nome, como na Consulta', () => {
    expect(ligaQuery('Pikachu', 'SWSH020', 307, { setId: 'swshp' })).toBe('Pikachu');
    expect(ligaQuery('Pikachu', 'SWSH020', 307, { setName: 'SWSH Black Star Promos' })).toBe('Pikachu');
    expect(ligaQuery('Pikachu')).toBe('Pikachu');
  });

  it('`promo` dado pela tela vale no lugar de isPromoSet ("045/071" na SV2P)', () => {
    expect(ligaQuery('Abomasnow', '045', 71, { setId: 'SV2P', promo: false })).toBe('Abomasnow (045/071)');
  });
});
