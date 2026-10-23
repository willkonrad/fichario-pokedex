import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import {
  fetchMypPrice,
  MYP_API_INTERVAL_MS,
  mypApiDue,
  mypApiMatches,
  mypApiNote,
  mypPriority,
  MypRateLimited,
  onMypPriority,
  searchMypByCode,
  searchMypByName,
} from '@/lib/myp-api';
import type { MypProduct } from '@/lib/myp-match';
import type { Entry } from '@/lib/types';
import { useCollection } from '@/store/collection';

/** Sem nada para buscar, olha de novo a cada 5 min (ou antes, quando a coleção muda). */
const IDLE_MS = 5 * 60_000;
/** Carta que falhou: espera 1 h; depois de 3 falhas seguidas, só na próxima vez que o app abrir. */
const RETRY_MS = 60 * 60_000;
const MAX_FAILS = 3;
/** Resultado de uma busca por nome reaproveitado pelas outras cartas com o mesmo nome. */
const SEARCH_CACHE_MS = 30 * 60_000;

/** Carta, versão e selo: uma busca serve todos os bolsos com a mesma carta (a API não separa idioma). */
const groupKey = (e: Entry) => `${e.cardId}|${e.variant}|${mypApiNote(e)}`;

/**
 * Busca, em segundo plano, o mínimo/média/máximo das cartas da coleção na API pública do MYP Cards: cartas novas e
 * alteradas primeiro, depois as que passaram de 7 dias, no máximo uma consulta a cada 6,5 s (sem token, o limite é 10
 * por minuto). Roda só no app do celular: sem token, a API não atende o servidor (403) nem o navegador (sem CORS).
 * Com conta, começa depois da primeira sincronização, e cada preço é gravado no banco mesclado sobre a carta atual
 * (applyMypPrice), onde também vale a regra do "Meu valor".
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
    if (!canRun) return;
    let alive = true;
    let lastCall = 0;
    // Falhas por carta (só nesta sessão), para uma carta com problema não travar a fila.
    const failures = new Map<string, { count: number; until: number }>();
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
    // Uma consulta por vez, com o intervalo mínimo entre elas (vale também para a segunda tentativa pelo nome em PT).
    // A busca por nome traz todas as cartas com aquele nome: fica guardada por 30 min e serve as outras (ex.: vários
    // Gengar da coleção com uma consulta só).
    const recent = new Map<string, { at: number; products: MypProduct[] }>();
    const limited = async (key: string, load: () => Promise<MypProduct[]>) => {
      const hit = recent.get(key);
      if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.products;
      const wait = lastCall + MYP_API_INTERVAL_MS - Date.now();
      if (wait > 0) await pause(wait);
      lastCall = Date.now();
      const products = await load();
      recent.set(key, { at: Date.now(), products });
      return products;
    };
    const consult = (name: string) => limited(`nome:${name}`, () => searchMypByName(name));
    // Pelo código do produto, quando o nome não acha (o MYP cadastra algumas cartas com o número no nome).
    const consultCode = (code: string) => limited(`codigo:${code}`, () => searchMypByCode(code));

    // A tela de uma carta sem preço pede a vez dela: acorda a busca, se estiver ociosa.
    onMypPriority(() => wakeRef.current());

    (async () => {
      while (alive) {
        const now = Date.now();
        const urgent = mypPriority();
        const due = Object.values(entriesRef.current).filter((e) => {
          if (!mypApiDue(e, now)) return false;
          const f = failures.get(groupKey(e));
          // Carta aberta na tela tenta de novo sem esperar a pausa de uma falha.
          return !f || (f.count < MAX_FAILS && (f.until <= now || urgent.has(e.id)));
        });
        if (!due.length) {
          urgent.clear();
          await idle(IDLE_MS);
          continue;
        }
        // Carta aberta na tela primeiro; depois as nunca buscadas (ou de outra carta/versão/selo); depois a busca
        // mais antiga.
        const order = (e: Entry) =>
          urgent.has(e.id) ? -1 : e.mypApi && mypApiMatches(e, e.mypApi) ? new Date(e.mypApi.checkedAt).getTime() : 0;
        due.sort((a, b) => order(a) - order(b));
        const key = groupKey(due[0]);
        const group = due.filter((e) => groupKey(e) === key);
        for (const e of group) urgent.delete(e.id);
        try {
          const price = await fetchMypPrice(group[0], consult, consultCode);
          if (!alive) break;
          for (const e of group) await applyRef.current(e.id, price);
          // Preço que não ficou gravado (ex.: carta que ainda não chegou ao banco): espera como uma falha, para a
          // busca guardada por nome não virar um laço sem pausa.
          const after = entriesRef.current[group[0].id];
          if (after && mypApiDue(after, Date.now())) {
            const f = failures.get(key);
            failures.set(key, { count: (f?.count ?? 0) + 1, until: Date.now() + RETRY_MS });
          } else failures.delete(key);
        } catch (err) {
          if (err instanceof MypRateLimited) {
            // Limite do MYP: espera mais de um minuto antes de qualquer consulta.
            await pause(65_000);
          } else {
            // Sem internet, erro do MYP/TCGdex ou do banco: esta carta espera; as outras seguem.
            const f = failures.get(key);
            failures.set(key, { count: (f?.count ?? 0) + 1, until: Date.now() + RETRY_MS });
            await pause(MYP_API_INTERVAL_MS);
          }
        }
      }
    })();

    return () => {
      alive = false;
      for (const t of timers) clearTimeout(t);
      wakeRef.current = () => {};
      onMypPriority(() => {});
    };
  }, [canRun]);

  return null;
}
