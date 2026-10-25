import { cardImage } from '@/lib/tcgdex';

describe('cardImage (endereço da foto da TCGdex)', () => {
  it('põe o sufixo de qualidade', () => {
    expect(cardImage('https://assets.tcgdex.net/pt/xy/xy3/60')).toBe('https://assets.tcgdex.net/pt/xy/xy3/60/low.webp');
    expect(cardImage('https://assets.tcgdex.net/en/sv/sv03/225', 'high')).toBe('https://assets.tcgdex.net/en/sv/sv03/225/high.webp');
    expect(cardImage(undefined)).toBeUndefined();
  });

  it('foto em português tirada de uma cópia com selo (Machop 44/111 com o selo da Liga): usa a foto em inglês', () => {
    expect(cardImage('https://assets.tcgdex.net/pt/xy/xy3/44')).toBe('https://assets.tcgdex.net/en/xy/xy3/44/low.webp');
    expect(cardImage('https://assets.tcgdex.net/en/xy/xy3/44', 'high')).toBe('https://assets.tcgdex.net/en/xy/xy3/44/high.webp');
  });
});
