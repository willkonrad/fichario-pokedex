// Exportar e importar a cópia pelo store da coleção (sem nuvem: o supabase é null nos testes e o armazenamento do
// aparelho fica em memória). Os testes rodam em ordem sobre o mesmo store.
import { useCollectionActions as collectionActions } from '@/store/collection';

import { AT, entry, LATER, myp } from './fixtures';

// useCollectionActions só devolve o objeto fixo das ações (não usa nenhum hook do React): dá para chamar aqui.
const actions = collectionActions();

/** As cartas como estão no store (com os preços e o registro do "Meu valor" trocado). */
const stored = () => actions.exportCollection({ withPrices: true }).entries;

const replaced = { value: 30, mypValue: 40, at: LATER, source: 'myp' as const };
const pika = entry({ updatedAt: AT, notes: 'da cópia' });
const bulba = entry({ id: '1-0', dex: 1, cardId: 'sv03.5-001', cardName: 'Bulbasaur', localId: '001', updatedAt: AT });

describe('cópia da coleção pelo store', () => {
  it('não exporta antes de ler a coleção do aparelho (a cópia sairia vazia)', () => {
    expect(() => actions.exportCollection()).toThrow('carregada');
  });

  it('carta da cópia num bolso vazio entra com a data da própria cópia (não com a de agora)', async () => {
    const withPrice = { ...bulba, myValue: null, myValueReplaced: replaced, mypApi: myp(bulba, { checkedAt: LATER, avg: 40 }) };
    const r = await actions.importCollection({ entries: [pika, withPrice] });
    expect(r).toEqual({ added: 2, updated: 0, skipped: 0 });
    expect(stored()).toEqual([
      expect.objectContaining({ id: '1-0', updatedAt: AT, myValueReplaced: replaced }),
      expect.objectContaining({ id: '25-0', updatedAt: AT, notes: 'da cópia' }),
    ]);
  });

  it('importar a cópia recém-exportada não muda nada (o empate fica com a carta daqui)', async () => {
    const copy = actions.exportCollection();
    expect(copy.entries.find((e) => e.id === '1-0')?.myValueReplaced).toBeUndefined();
    const r = await actions.importCollection(JSON.stringify(copy));
    expect(r).toEqual({ added: 0, updated: 0, skipped: 2 });
    expect(stored().find((e) => e.id === '1-0')).toMatchObject({ myValueReplaced: replaced, mypApi: { avg: 40 } });
  });

  it('carta mais nova na cópia: vale a da cópia, com os preços e o "Meu valor" trocado daqui', async () => {
    const r = await actions.importCollection({ entries: [{ ...bulba, notes: 'editada', updatedAt: LATER }] });
    expect(r).toEqual({ added: 0, updated: 1, skipped: 0 });
    expect(stored().find((e) => e.id === '1-0')).toMatchObject({
      notes: 'editada',
      updatedAt: LATER,
      myValueReplaced: replaced,
      mypApi: { avg: 40 },
    });
  });

  it('carta mais velha na cópia não passa por cima da carta que está no bolso', async () => {
    const old = entry({ cardId: 'sv01-050', cardName: 'Outra', updatedAt: '2026-10-01T12:00:00.000Z' });
    const r = await actions.importCollection({ entries: [old] });
    expect(r).toEqual({ added: 0, updated: 0, skipped: 1 });
    expect(stored().find((e) => e.id === '25-0')).toMatchObject({ cardId: pika.cardId, notes: 'da cópia' });
  });
});
