import { keyboardBottomPad } from '@/components/keyboard-avoid';
import { TOTAL_SPECIES } from '@/data/pokedex';
import { cardRoute, routeInt } from '@/lib/card-route';
import { tapWord } from '@/lib/tap-word';
import { space } from '@/theme';

// Parâmetros da tela da carta vindos de um link (externo ou digitado), espaço do teclado e "Toque"/"Clique".

describe('cardRoute', () => {
  it('bolso do fichário Pokédex: números de verdade', () => {
    expect(cardRoute({ dex: '25', slot: '0' })).toEqual({ dex: 25, slot: 0 });
    expect(cardRoute({ dex: '0', slot: '7', lang: 'en', dataLang: 'en', variant: 'holo' })).toEqual({
      dex: 0,
      slot: 7,
      lang: 'en',
      dataLang: 'en',
      variant: 'holo',
    });
  });

  it('bolso que não é número: nada de bolso NaN (o envio para a nuvem falhava para sempre)', () => {
    expect(cardRoute({ dex: '25', slot: 'abc' })).toBeNull();
    expect(cardRoute({ dex: '25', slot: '1.5' })).toBeNull();
    expect(cardRoute({ dex: '25', slot: '-1' })).toBeNull();
    expect(cardRoute({ dex: '25', slot: '1e3' })).toBeNull();
    expect(cardRoute({ dex: '25', slot: ' 1' })).toBeNull();
    expect(cardRoute({ dex: '25', slot: ['1', '2'] })).toBeNull();
    // Maior que a coluna int do banco.
    expect(cardRoute({ dex: '25', slot: '9999999999' })).toBeNull();
  });

  it('link sem dex ou sem bolso (pokedexbinder://card?cardId=…): não grava a carta "NaN-0"', () => {
    expect(cardRoute({ slot: '0' })).toBeNull();
    expect(cardRoute({ dex: '25' })).toBeNull();
    expect(cardRoute({})).toBeNull();
    expect(cardRoute({ dex: 'x', slot: '0' })).toBeNull();
    expect(cardRoute({ dex: String(TOTAL_SPECIES + 1), slot: '0' })).toBeNull();
    expect(cardRoute({ dex: String(TOTAL_SPECIES), slot: '0' })?.dex).toBe(TOTAL_SPECIES);
  });

  it('fichário livre: o dex do endereço não conta, o bolso sim', () => {
    expect(cardRoute({ binder: 'b1', slot: '3' })).toEqual({ binder: 'b1', dex: 0, slot: 3 });
    expect(cardRoute({ binder: 'b1', dex: 'x', slot: '3' })).toEqual({ binder: 'b1', dex: 0, slot: 3 });
    expect(cardRoute({ binder: 'b1', slot: 'x' })).toBeNull();
  });

  it('idioma que o app não tem: a tela não cai (LANG_LABEL.ko não existe)', () => {
    expect(cardRoute({ dex: '25', slot: '0', lang: 'ko' })).toBeNull();
    expect(cardRoute({ dex: '25', slot: '0', dataLang: 'zh' })).toBeNull();
    expect(cardRoute({ dex: '25', slot: '0', lang: '' })).toEqual({ dex: 25, slot: 0 });
  });

  it('variação desconhecida é ignorada', () => {
    expect(cardRoute({ dex: '25', slot: '0', variant: 'xyz' })).toEqual({ dex: 25, slot: 0 });
  });

  it('routeInt', () => {
    expect(routeInt('12')).toBe(12);
    expect(routeInt('012')).toBe(12);
    expect(routeInt(12)).toBeNull();
    expect(routeInt(undefined)).toBeNull();
    expect(routeInt('5', 4)).toBeNull();
  });
});

describe('keyboardBottomPad', () => {
  it('teclado fechado: o espaço de sempre', () => {
    expect(keyboardBottomPad(80, 0, 48)).toBe(80);
  });

  it('teclado aberto no Android: o fim da rolagem sai de baixo do teclado e da barra de navegação', () => {
    // 300 de teclado + 48 da barra de navegação + a folga de sempre.
    expect(keyboardBottomPad(80, 300, 48)).toBe(300 + 48 + space.xxl);
    // Carta nova: a barra do "Colocar" já reserva mais que o teclado pequeno.
    expect(keyboardBottomPad(500, 300, 48)).toBe(500);
  });
});

describe('tapWord', () => {
  it('"Toque" no celular, "Clique" no navegador', () => {
    expect(tapWord(false)).toEqual({ Tap: 'Toque', tap: 'toque' });
    expect(tapWord(true)).toEqual({ Tap: 'Clique', tap: 'clique' });
  });
});
