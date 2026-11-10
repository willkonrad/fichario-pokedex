import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { MYP_API_INTERVAL_MS } from '@/lib/myp-api';
import { MypRunStopped, nextMypGroup, runMypGroup } from '@/lib/myp-queue';
import { supabase } from '@/lib/supabase';
import { collectionActions, collectionState, saveCollectionNow, startCollection, subscribeCollection } from '@/store/collection';

/** Nome da tarefa no aparelho. Não troque: o registro fica salvo no Android. */
const TASK = 'myp-precos';
/** O Android roda a tarefa no máximo a cada 15 min, e só quando quer (bateria, rede, economia de energia). */
const EVERY_MIN = 15;
/** Cada vez, busca por até 3 min (o Android dá no máximo 10 min à tarefa); depois disso não começa outra carta. */
const RUN_MS = 3 * 60_000;
/** Com o app fechado, espera a coleção carregar e a primeira sincronização por até 1 min. */
const LOAD_MS = 60_000;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A coleção carregada e, com conta, sincronizada nesta abertura (como a busca com o app aberto espera)? */
async function collectionReady(ms: number) {
  const signedIn = supabase ? !!(await supabase.auth.getSession()).data.session : false;
  const ok = () => {
    const s = collectionState();
    return s.ready && (!signedIn || (!!s.session && !!s.lastSyncAt));
  };
  if (ok()) return true;
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
    }, ms);
  });
}

/**
 * Segue a fila do MYP com o app em segundo plano: no ritmo de sempre (uma consulta a cada 6,5 s), por até 3 min.
 * Com o app aberto não faz nada (quem busca é o MypRefresher). Com o app fechado pelo sistema, liga a coleção antes.
 */
async function runInBackground() {
  if (AppState.currentState === 'active') return;
  const stop = startCollection();
  try {
    if (!(await collectionReady(LOAD_MS))) return;
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
      // Limite do MYP (429): para por aqui; a próxima vez já respeita a pausa.
      if (step === 'stopped' || step === 'rateLimited') break;
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
