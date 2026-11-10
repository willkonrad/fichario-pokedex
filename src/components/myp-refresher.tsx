import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { registerMypBackground } from '@/components/myp-background';
import { MYP_API_INTERVAL_MS, mypPriority, onMypPriority } from '@/lib/myp-api';
import { MypRunStopped, nextMypGroup, runMypGroup } from '@/lib/myp-queue';
import { useCollection } from '@/store/collection';

/** Sem nada para buscar, olha de novo a cada 5 min (ou antes, quando a coleção muda). */
const IDLE_MS = 5 * 60_000;
/** Etiqueta da tela acesa (expo-keep-awake): só esta busca liga e desliga. */
const AWAKE_TAG = 'myp-precos';

/**
 * Busca, com o app aberto, o mínimo/média/máximo das cartas da coleção na API pública do MYP Cards, pela fila de
 * `src/lib/myp-queue.ts`: cartas novas e alteradas primeiro, depois as que passaram de 7 dias, no máximo uma consulta a
 * cada 6,5 s (sem token, o limite é 10 por minuto). Roda só no app do celular: sem token, a API não atende o servidor
 * (403) nem o navegador (sem CORS). Com conta, começa depois da primeira sincronização, e cada preço é gravado no banco
 * mesclado sobre a carta atual (applyMypPrice), onde também vale a regra do "Meu valor".
 *
 * Enquanto há cartas na fila, a tela não apaga sozinha (o Android pausa o app com a tela apagada); sem internet, apaga,
 * até uma consulta dar certo de novo. Com o app em segundo
 * plano, esta busca espera, e quem continua é a tarefa de `myp-background` (só no APK; o Expo Go não roda tarefas em
 * segundo plano no Android).
 */
export function MypRefresher() {
  const { ready, session, lastSyncAt, entries, applyMypPrice } = useCollection();
  const entriesRef = useRef(entries);
  const applyRef = useRef(applyMypPrice);
  const wakeRef = useRef<() => void>(() => {});
  // Com conta, espera a primeira sincronização: assim a busca parte das cartas como estão na nuvem.
  const canRun = Platform.OS !== 'web' && ready && (!session || !!lastSyncAt);

  useEffect(() => {
    entriesRef.current = entries;
    applyRef.current = applyMypPrice;
    // Carta nova ou alterada: acorda a busca, se ela estiver ociosa.
    wakeRef.current();
  }, [entries, applyMypPrice]);

  useEffect(() => {
    if (Platform.OS !== 'web') void registerMypBackground();
  }, []);

  useEffect(() => {
    if (!canRun) return;
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          timers.delete(t);
          resolve();
        }, ms);
        timers.add(t);
      });
    // Espera ociosa: termina antes se a coleção mudar.
    const idle = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          timers.delete(t);
          wakeRef.current = () => {};
          resolve();
        }, ms);
        timers.add(t);
        wakeRef.current = () => {
          clearTimeout(t);
          timers.delete(t);
          wakeRef.current = () => {};
          resolve();
        };
      });
    // Com o app em segundo plano, nenhuma consulta daqui: espera o app voltar (a tarefa em segundo plano, quando existe,
    // segue a fila nesse meio-tempo). Termina com MypRunStopped se a busca for desligada.
    let stopWaiting: (() => void) | null = null;
    const foreground = () =>
      AppState.currentState !== 'background'
        ? undefined
        : new Promise<void>((resolve, reject) => {
            const sub = AppState.addEventListener('change', (st) => {
              if (st === 'background') return;
              sub.remove();
              stopWaiting = null;
              resolve();
            });
            stopWaiting = () => {
              sub.remove();
              reject(new MypRunStopped());
            };
          });
    // Tela acesa enquanto há fila. Pedido feito com o app em segundo plano pode falhar: tenta de novo na próxima carta.
    let awake = false;
    const keepAwake = (on: boolean) => {
      if (on === awake) return;
      awake = on;
      if (on) activateKeepAwakeAsync(AWAKE_TAG).catch(() => (awake = false));
      else void deactivateKeepAwake(AWAKE_TAG).catch(() => {});
    };

    // A tela de uma carta sem preço pede a vez dela: acorda a busca, se estiver ociosa.
    onMypPriority(() => wakeRef.current());

    (async () => {
      // Sem internet, a fila não anda: a tela volta a apagar sozinha até uma consulta dar certo de novo.
      let offline = false;
      while (alive) {
        const urgent = mypPriority();
        const group = nextMypGroup(entriesRef.current, Date.now(), urgent);
        if (!group) {
          urgent.clear();
          keepAwake(false);
          await idle(IDLE_MS);
          continue;
        }
        if (!offline) keepAwake(true);
        for (const e of group) urgent.delete(e.id);
        const step = await runMypGroup(group, {
          pause,
          beforeCall: foreground,
          apply: (id, price) => applyRef.current(id, price),
          current: (id) => entriesRef.current[id],
        });
        if (!alive || step === 'stopped') break;
        if (step === 'offline') {
          offline = true;
          keepAwake(false);
        } else if (step === 'done') offline = false;
        // Falha sem consulta (ex.: sem internet): uma pausa, para a fila não passar por todas as cartas de uma vez.
        if (step === 'failed' || step === 'offline') await pause(MYP_API_INTERVAL_MS);
      }
    })();

    return () => {
      alive = false;
      for (const t of timers) clearTimeout(t);
      stopWaiting?.();
      wakeRef.current = () => {};
      onMypPriority(() => {});
      keepAwake(false);
    };
  }, [canRun]);

  return null;
}
