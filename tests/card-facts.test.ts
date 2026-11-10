// Ficha da carta: os nomes de energia que a TCGdex manda em português viram a cor certa e o termo do jogo no Brasil.
import { cardAttributeItems, energyKey } from '@/components/card-facts';
import type { CardDetail } from '@/lib/tcgdex';

const typeShown = (types: string[]) => cardAttributeItems({ id: 'x', localId: '1', name: 'x', types } as CardDetail).find(([label]) => label === 'Tipo')?.[1];

describe('energia da ficha', () => {
  it.each([
    ['Sombrio', 'darkness', 'Escuridão'],
    ['Elétrico', 'lightning', 'Raios'],
    ['Lutador', 'fighting', 'Luta'],
  ])('%s, como vem da TCGdex, é %s e aparece como %s', (raw, key, shown) => {
    expect(energyKey(raw)).toBe(key);
    expect(typeShown([raw])).toBe(shown);
  });

  it('reconhece todos os tipos de /pt/types', () => {
    const keys = ['Dragão', 'Elétrico', 'Fada', 'Fogo', 'Incolor', 'Lutador', 'Metal', 'Planta', 'Psíquico', 'Sombrio', 'Água'].map(energyKey);
    expect(keys).toEqual(['dragon', 'lightning', 'fairy', 'fire', 'colorless', 'fighting', 'metal', 'grass', 'psychic', 'darkness', 'water']);
  });

  it('os nomes da ficha e os em inglês continuam valendo', () => {
    expect(energyKey('Raios')).toBe('lightning');
    expect(energyKey('Luta')).toBe('fighting');
    expect(energyKey('Escuridão')).toBe('darkness');
    expect(energyKey('Lightning')).toBe('lightning');
    expect(energyKey('Darkness')).toBe('darkness');
    expect(energyKey('eletrico')).toBe('lightning');
    expect(energyKey('agua')).toBe('water');
  });

  it('tipo desconhecido aparece como veio', () => {
    expect(typeShown(['Outro'])).toBe('Outro');
  });
});
