// Aviso (toast): a ação ("Desfazer") roda uma vez só por aviso, mesmo com dois toques seguidos ou um clique duplo.
import { hideToast, runToastAction, showToast } from '@/components/toast';

describe('runToastAction', () => {
  it('aciona a ação uma vez só, mesmo com dois toques durante a saída', () => {
    const onAction = jest.fn();
    const id = showToast({ message: 'Pikachu entrou no lugar de Pikachu V', actionLabel: 'Desfazer', onAction });
    runToastAction(id);
    runToastAction(id);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('não aciona a ação de um aviso que já está saindo', () => {
    const onAction = jest.fn();
    const id = showToast({ message: 'Charizard saiu do fichário', actionLabel: 'Desfazer', onAction });
    hideToast(id);
    runToastAction(id);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('não aciona a ação de um aviso que já foi trocado por outro', () => {
    const first = jest.fn();
    const second = jest.fn();
    const id = showToast({ message: 'Gengar foi para Trocas', actionLabel: 'Desfazer', onAction: first });
    const next = showToast({ message: 'Mew foi para Trocas', actionLabel: 'Desfazer', onAction: second });
    runToastAction(id);
    expect(first).not.toHaveBeenCalled();
    runToastAction(next);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
