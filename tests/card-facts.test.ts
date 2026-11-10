// Ficha da carta: os nomes de energia que a TCGdex manda em português viram a cor certa e o termo do jogo no Brasil.
import { cardAttributeItems, energyKey, hasCardFacts } from '@/components/card-facts';
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

describe('"Sobre a carta" só com os fatos de jogo', () => {
  it('raridade e ilustrador foram para "Para colecionador"', () => {
    const detail = { id: 'x', localId: '1', name: 'x', rarity: 'Comum', illustrator: 'Naoyo Kimura', hp: 60, regulationMark: 'G' } as CardDetail;
    const labels = cardAttributeItems(detail).map(([label]) => label);
    expect(labels).not.toContain('Ilustrador');
    expect(labels).not.toContain('Raridade');
    expect(labels).toEqual(['Categoria', 'HP', 'Tipo', 'Estágio', 'Evolui de', 'Marca de regulamento']);
  });

  it('sem nenhum fato de jogo (treinador só do catálogo: raridade e número, mais nada), a seção não aparece', () => {
    const tcgpTrainer = {
      id: 'tcgp-1',
      localId: '1',
      name: 'Lillie',
      rarity: 'Uncommon',
      set: { id: 'tcgp1', name: 'X' },
      catalog: { productId: 1, category: 85, groupId: 1, cardType: 'Supporter' },
    } as CardDetail;
    expect(hasCardFacts(tcgpTrainer)).toBe(false);
    expect(hasCardFacts(null)).toBe(false);
    // Qualquer fato de jogo basta: categoria, HP, ataque, recuo (até 0)…
    expect(hasCardFacts({ ...tcgpTrainer, category: 'Treinador' })).toBe(true);
    expect(hasCardFacts({ ...tcgpTrainer, hp: 50 })).toBe(true);
    expect(hasCardFacts({ ...tcgpTrainer, attacks: [{ name: 'Choque', cost: ['Lightning'], damage: 10 }] } as CardDetail)).toBe(true);
    expect(hasCardFacts({ ...tcgpTrainer, retreat: 0 })).toBe(true);
    // "None" não conta como valor.
    expect(hasCardFacts({ ...tcgpTrainer, regulationMark: 'None' })).toBe(false);
  });
});
