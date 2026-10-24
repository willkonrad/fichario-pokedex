import { ownershipOf } from '@/components/owned-badge';
import type { Entry } from '@/lib/types';

// O selo "tenho" lê a coleção pelo store; aqui só a regra pura importa.
jest.mock('@/store/collection', () => ({ useEntries: () => ({}) }));

type Copy = Pick<Entry, 'variant' | 'variantNote'>;
const copy = (variant: Copy['variant'], variantNote?: string): Copy => ({ variant, variantNote });
const noStamp = { stamp: null };
const stamp = (label: string) => ({ stamp: { label } });

describe('ownershipOf (posse por versão)', () => {
  it('sem cópias: nada', () => {
    expect(ownershipOf(undefined, noStamp)).toBeNull();
    expect(ownershipOf([], noStamp)).toBeNull();
  });

  it('carta sem selo com uma cópia normal: "tenho"', () => {
    expect(ownershipOf([copy('normal')], noStamp)).toEqual({ exact: true, label: 'tenho', count: 1 });
    expect(ownershipOf([copy('reverse'), copy('normal')], noStamp)).toEqual({ exact: true, label: 'tenho', count: 2 });
  });

  it('só variações especiais sem selo: diz qual', () => {
    expect(ownershipOf([copy('reverse')], noStamp)?.label).toBe('tenho · reverse');
    expect(ownershipOf([copy('firstEdition'), copy('firstEdition')], noStamp)).toEqual({ exact: true, label: 'tenho · 1ª ed.', count: 2 });
    expect(ownershipOf([copy('reverse'), copy('holo')], noStamp)?.label).toBe('tenho · 2 versões');
  });

  it('versão do catálogo escolhida em outra variação (Cosmos Holo, Poke Ball Pattern) conta pelo selo; "Outra" é texto livre', () => {
    expect(ownershipOf([copy('holo', 'Cosmos Holo')], stamp('Cosmos Holo'))?.label).toBe('tenho');
    expect(ownershipOf([copy('holo', 'Cosmos Holo')], noStamp)?.label).toBe('outra versão');
    expect(ownershipOf([copy('pokeball', 'Poke Ball Pattern')], stamp('Poke Ball Pattern'))?.exact).toBe(true);
    expect(ownershipOf([copy('other', 'assinada')], noStamp)?.label).toBe('tenho · outra');
  });

  it('versão com selo: "tenho" só com uma cópia desse selo, sem depender de acento ou caixa', () => {
    expect(ownershipOf([copy('wPromo', 'pokemon center')], stamp('Pokémon Center'))).toEqual({ exact: true, label: 'tenho', count: 1 });
    expect(ownershipOf([copy('staff', ' Pokémon  Center! ')], stamp('Pokemon Center'))?.exact).toBe(true);
    expect(ownershipOf([copy('normal'), copy('wPromo', 'Worlds 2025')], stamp('Pokémon Center'))).toEqual({
      exact: false,
      label: 'outra versão',
      count: 2,
    });
  });

  it('carta sem selo e só cópias com selo: "outra versão"', () => {
    expect(ownershipOf([copy('wPromo', 'Pokemon Center')], noStamp)).toEqual({ exact: false, label: 'outra versão', count: 1 });
  });

  it('selo em japonês é comparado como foi escrito', () => {
    expect(ownershipOf([copy('wPromo', 'ポケモンセンター')], stamp('ポケモンセンター'))?.exact).toBe(true);
    expect(ownershipOf([copy('wPromo', 'ポケモンセンター')], stamp('ジム'))?.exact).toBe(false);
  });
});
