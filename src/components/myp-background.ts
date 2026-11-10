import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { MYP_API_INTERVAL_MS } from '@/lib/myp-api';
import { loadMypBlock, MypRunStopped, nextMypGroup, runMypGroup } from '@/lib/myp-queue';
import { supabase } from '@/lib/supabase';
import {
  allowBackgroundSync,
  collectionActions,
  collectionState,
  saveCollectionNow,
  startCollection,
  subscribeCollection,
} from '@/store/collection';

/** Nome da tarefa no aparelho. Não troque: o registro fica salvo no Android. */
const TASK = 'myp-precos';
/** O Android roda a tarefa no máximo a cada 15 min, e só quando quer (bateria, rede, economia de energia). */
const EVERY_MIN = 15;
/** Cada vez, busca por até 3 min (o Android dá no máximo 10 min à tarefa); depois disso não começa outra carta. */
const RUN_MS = 3 * 60_000;
/** Com o app fechado, espera a coleção carregar e a primeira sincronização por até 1 min. */
const LOAD_MS = 60_000;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Espera a coleção chegar a `ok` por até `ms`; false se não chegar. */
function waitCollection(ok: () => boolean, ms: number) {
  if (ok()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeCollection(() => {
      if (!ok()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
    timer = setTimeout(() => {
      unsubscribe();
      resolve(ok());
    }, Math.max(0, ms));
  });
}

/** A coleção carregada e, com conta, sincronizada nesta abertura (como a busca com o app aberto espera)? */
async function collectionReady(ms: number) {
  const signedIn = supabase ? !!(await supabase.auth.getSession()).data.session : false;
  return waitCollection(() => {
    const s = collectionState();
    return s.ready && (!signedIn || (!!s.session && !!s.lastSyncAt));
  }, ms);
}

/**
 * Segue a fila do MYP com o app em segundo plano: no ritmo de sempre (uma consulta a cada 6,5 s), por até 3 min.
 * Com o app aberto não faz nada (quem busca é o MypRefresher). Com o app fechado pelo sistema, liga a coleção antes, no
 * modo da tarefa: sem tela, a coleção só sincroniza quando pedida, e a incremental basta (a completa fica para quando
 * a pessoa abrir o app).
 */
async function runInBackground() {
  if (AppState.currentState === 'active') return;
  const stop = startCollection({ background: true });
  try {
    const loadBy = Date.now() + LOAD_MS;
    if (!(await waitCollection(() => collectionState().ready, LOAD_MS))) return;
    // Recusa do MYP (403) guardada no aparelho: com ela, a fila fica vazia e a tarefa termina sem consultar.
    await loadMypBlock();
    // Nenhuma carta deste aparelho na fila: termina sem sincronizar. As cartas novas de outro aparelho chegam quando a
    // pessoa abrir o app, ou numa execução em que a fila daqui tenha alguma.
    if (!nextMypGroup(collectionState().entries, Date.now())) return;
    allowBackgroundSync();
    if (!(await collectionReady(loadBy - Date.now()))) return;
    const deadline = Date.now() + RUN_MS;
    // Para antes de uma consulta quando o tempo acaba ou o app volta (o MypRefresher continua de onde parou).
    const beforeCall = () => {
      if (Date.now() > deadline || AppState.currentState === 'active') throw new MypRunStopped();
    };
    while (Date.now() < deadline && AppState.currentState !== 'active') {
      const group = nextMypGroup(collectionState().entries, Date.now());
      if (!group) break;
      const step = await runMypGroup(group, {
        pause,
        beforeCall,
        apply: collectionActions.applyMypPrice,
        current: (id) => collectionState().entries[id],
      });
      // Limite do MYP (429) ou recusa (403): para por aqui; a próxima vez já respeita a pausa.
      if (step === 'stopped' || step === 'rateLimited' || step === 'blocked') break;
      if (step === 'failed' || step === 'offline') await pause(MYP_API_INTERVAL_MS);
    }
  } finally {
    await saveCollectionNow().catch(() => {});
    stop();
  }
}

// A tarefa precisa existir antes de qualquer tela (o Android pode abrir o app só para rodá-la): este arquivo é o
// primeiro que a entrada do app (index.ts) carrega.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(TASK, async () => {
    try {
      await runInBackground();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/**
 * Pede ao Android para rodar a busca a cada 15 min ou mais com o app em segundo plano (WorkManager). Só no APK: o Expo
 * Go não roda tarefas em segundo plano no Android, e a web não tem como (a API do MYP não atende o navegador).
 */
export async function registerMypBackground() {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (!(await TaskManager.isAvailableAsync())) return;
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: EVERY_MIN });
  } catch {
    // Sem a tarefa, a busca segue só com o app aberto.
  }
}
