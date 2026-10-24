import { cardsDeltaText, myValueBelowText, myValueReplacedNotice, myValueReplacedText } from '@/lib/copy';
import { formatBRL, formatBRLShort as short } from '@/lib/format';

import { AT } from './fixtures';

describe('"Meu valor" trocado pelo mercado', () => {
  const r = { cardName: 'Gengar', value: 75, mypValue: 163.46, at: AT, source: 'myp' as const };

  it('na média, a seta leva à média que passou dele', () => {
    const text = `Gengar passou do seu valor: seu ${short(75)} → média do MYP ${short(163.46)}`;
    expect(myValueReplacedNotice([r])).toBe(text);
    expect(myValueReplacedNotice([{ ...r, now: { value: 163.46, basis: 'myp', pick: 'avg' } }])).toBe(text);
  });

  it('com "Usar na soma" no menor anúncio, a seta leva ao valor que a carta tem agora (que pode ser menor)', () => {
    const now = { value: 50, basis: 'myp' as const, pick: 'min' as const };
    expect(myValueReplacedNotice([{ ...r, now }])).toBe(
      `Gengar passou do seu valor: seu ${short(75)} → ${short(50)} pelo menor anúncio (média do MYP ${short(163.46)})`,
    );
    expect(myValueReplacedNotice([{ ...r, now }, { ...r, cardName: 'Mew' }])).toBe(
      `2 cartas passaram do seu valor: Gengar (seu ${short(75)} → ${short(50)} pelo menor anúncio), Mew (seu ${short(75)} → ${short(163.46)})`,
    );
    expect(myValueReplacedText(r, now)).toContain(`Agora a carta vale ${formatBRL(50)}, pelo menor anúncio`);
    expect(myValueReplacedText(r)).not.toContain('Agora');
  });

  it('valor digitado abaixo da média da fonte', () => {
    expect(myValueBelowText({ avg: 150, source: 'tcgplayer' })).toContain('Menor que o mercado da TCGplayer');
    expect(myValueBelowText({ avg: 60, source: 'myp' })).toContain('Menor que a média do MYP');
  });
});

describe('cardsDeltaText', () => {
  it('separa cartas novas das que só ganharam preço', () => {
    expect(cardsDeltaText({ added: 1, priced: 42, removed: 0, changed: 10 })).toBe('+1 carta nova · 42 ganharam preço · 10 trocadas ou com outra fonte');
    expect(cardsDeltaText({ added: 0, priced: 1, removed: 2 })).toBe('1 ganhou preço · −2 removidas');
  });
});
