import type { MypKeys } from '@/lib/lookup-types';
import {
  fetchMypByKeys,
  fetchMypPrice,
  MYP_API_INTERVAL_MS,
  MYP_MATCHER,
  mypApiDue,
  mypApiMatches,
  mypApiNote,
  MypRateLimited,
  searchMypByCode,
  searchMypByName,
} from '@/lib/myp-api';
import type { MypProduct } from '@/lib/myp-match';
import { isNetworkError } from '@/lib/supabase';
import { tcgplayerFor } from '@/lib/tcgplayer';
import type { Entry, MypApiPrice } from '@/lib/types';

/**
 * Fila das buscas no MYP Cards, usada pela busca com o app aberto (MypRefresher) e pela de segundo plano
 * (myp-background). As duas dividem o ritmo (uma consulta a cada 6,5 s), a pausa depois de um 429, as falhas por
 * carta e as buscas guardadas, então nunca passam juntas do limite de 10 consultas por minuto. A Consulta de cartas
 * entra na mesma conta (consultMypNow), sem esperar a vez da fila.
 */

/** Carta que falhou: espera 1 h; depois de 3 falhas seguidas, só na próxima vez que o app abrir. */
const RETRY_MS = 60 * 60_000;
const MAX_FAILS = 3;
/** Resultado de uma busca por nome reaproveitado pelas outras cartas com o mesmo nome. */
const SEARCH_CACHE_MS = 30 * 60_000;
/** Depois de um "muitas consultas" (429), nenhuma consulta por este tempo. */
const RATE_LIMIT_PAUSE_MS = 65_000;
/**
 * Renovação que não acha uma carta já encontrada (pode ser uma falha passageira do MYP): o preço achado fica, e a carta
 * tenta de novo mais tarde; só vira "não encontrada" quando esse preço passa de 30 dias.
 */
const KEEP_FOUND_MS = 30 * 24 * 60 * 60_000;
/** Soma na ordem da fila das cartas em inglês com preço da TCGplayer (passa de qualquer data em milissegundos). */
const AFTER_MYP = 1e15;

export type MypFailures = Map<string, { count: number; until: number }>;

/** Falhas por carta (só enquanto o app está aberto), para uma carta com problema não travar a fila. */
const failures: MypFailures = new Map();
/** Quando a próxima consulta da fila pode sair. */
let nextCallAt = 0;
/** Até quando ninguém consulta, depois de um 429. */
let pausedUntil = 0;
const recent = new Map<string, { at: number; products: MypProduct[] }>();

/** Janela deslizante: no máximo 9 consultas em 60 s, somando a fila e a Consulta. */
const WINDOW_MS = 60_000;
const WINDOW_MAX = 9;
const calls: number[] = [];

/** Quanto falta para abrir uma vaga na janela. */
function windowWait(now: number) {
  while (calls.length && now - calls[0] >= WINDOW_MS) calls.shift();
  return calls.length < WINDOW_MAX ? 0 : calls[0] + WINDOW_MS - now;
}

/** Com a Consulta na frente, a fila olha de novo a cada segundo. */
const HOLD_POLL_MS = 1000;
let holds = 0;

/** A fila espera enquanto alguém segura (a Consulta em foco deixa as vagas para o preço na hora); devolve quem solta. */
export function holdMypQueue(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
  };
}

function queueWait(now: number) {
  if (holds > 0) return HOLD_POLL_MS;
  return Math.max(nextCallAt - now, pausedUntil - now, windowWait(now));
}

/** Carta, versão e selo: uma busca serve todos os bolsos com a mesma carta (a API não separa idioma). */
export const mypGroupKey = (e: Entry) => `${e.cardId}|${e.variant}|${mypApiNote(e)}`;

/**
 * Próximas cartas da fila (todas as cópias da mesma carta, versão e selo), ou undefined se não há nada para buscar.
 * Carta aberta na tela (`urgent`) primeiro, mesmo se falhou há pouco; depois as nunca buscadas (ou de outra
 * carta/versão/selo); depois a busca mais antiga. Carta em inglês com preço da TCGplayer vai depois de todas as que
 * dependem do MYP.
 */
export function nextMypGroup(
  entries: Record<string, Entry>,
  now: number,
  urgent: ReadonlySet<string> = new Set(),
  fails: MypFailures = failures,
): Entry[] | undefined {
  const due = Object.values(entries).filter((e) => {
    if (!mypApiDue(e, now)) return false;
    const f = fails.get(mypGroupKey(e));
    return !f || (f.count < MAX_FAILS && (f.until <= now || urgent.has(e.id)));
  });
  if (!due.length) return undefined;
  const order = (e: Entry) => {
    if (urgent.has(e.id)) return -1;
    const last = e.mypApi && mypApiMatches(e, e.mypApi) ? new Date(e.mypApi.checkedAt).getTime() : 0;
    return e.lang === 'en' && tcgplayerFor(e)?.avg != null ? AFTER_MYP + last : last;
  };
  const first = due.reduce((a, b) => (order(b) < order(a) ? b : a));
  const key = mypGroupKey(first);
  return due.filter((e) => mypGroupKey(e) === key);
}

/** Quem chamou parou a busca (tela fechada, tempo da tarefa em segundo plano acabou): a carta não conta como falha. */
export class MypRunStopped extends Error {}

export type MypRunner = {
  /** Espera (com o app aberto, uma espera que termina se a tela fechar). */
  pause: (ms: number) => Promise<void>;
  /** Antes de cada consulta ao MYP: pode esperar (app em segundo plano) ou lançar MypRunStopped para parar. */
  beforeCall?: () => Promise<void> | void;
  /** Grava o preço numa carta (applyMypPrice do store). */
  apply: (id: string, price: MypApiPrice) => Promise<void>;
  /** A carta como está agora no store. */
  current: (id: string) => Entry | undefined;
};

/** `offline`: falhou sem chegar ao MYP ou à TCGdex (sem internet ou sem resposta no tempo); a carta espera como em `failed`. */
export type MypStep = 'done' | 'failed' | 'offline' | 'rateLimited' | 'stopped';

/** Sem internet, ou a chamada passou do tempo (timedFetch). */
const offline = (err: unknown) => isNetworkError(err) || (err as { name?: unknown } | null)?.name === 'FetchTimeoutError';

function fail(key: string, fails: MypFailures) {
  const f = fails.get(key);
  fails.set(key, { count: (f?.count ?? 0) + 1, until: Date.now() + RETRY_MS });
}

/**
 * Busca o preço de um grupo da fila e grava em todas as cópias. Uma consulta por vez, no ritmo da fila (vale também
 * para a segunda tentativa pelo nome em PT e pelo código). A busca por nome traz todas as cartas com aquele nome: fica
 * guardada por 30 min e serve as outras (ex.: vários Gengar da coleção com uma consulta só).
 */
export async function runMypGroup(group: Entry[], run: MypRunner, fails: MypFailures = failures): Promise<MypStep> {
  const key = mypGroupKey(group[0]);
  const limited = async (cacheKey: string, load: () => Promise<MypProduct[]>) => {
    const hit = recent.get(cacheKey);
    if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.products;
    await run.beforeCall?.();
    // Em laço: a outra busca (aberta ou em segundo plano) pode ter usado a vez enquanto esta esperava. A cada volta confere
    // de novo se ainda pode consultar: com a Consulta segurando a fila, o prazo da tarefa em segundo plano continua valendo.
    for (let wait = queueWait(Date.now()); wait > 0; wait = queueWait(Date.now())) {
      await run.pause(wait);
      await run.beforeCall?.();
    }
    nextCallAt = Date.now() + MYP_API_INTERVAL_MS;
    calls.push(Date.now());
    const products = await load();
    recent.set(cacheKey, { at: Date.now(), products });
    return products;
  };
  const consult = (name: string) => limited(`nome:${name}`, () => searchMypByName(name));
  // Pelo código do produto, quando o nome não acha (o MYP cadastra algumas cartas com o número no nome).
  const consultCode = (code: string) => limited(`codigo:${code}`, () => searchMypByCode(code));

  // A busca serve o grupo todo; pela cópia em português, que também traz a foto em português do MYP.
  const target = group.find((e) => e.lang === 'pt') ?? group[0];
  try {
    const price = await fetchMypPrice(target, consult, consultCode);
    // Renovação que não achou uma carta já encontrada: fica o preço achado (ver KEEP_FOUND_MS).
    const priced = (e: Entry) => !!e.mypApi && mypApiMatches(e, e.mypApi) && e.mypApi.avg != null;
    const found = group.find(priced)?.mypApi;
    if (price.notFound && found && Date.now() - new Date(found.checkedAt).getTime() < KEEP_FOUND_MS) {
      // As cópias do grupo ainda sem preço ficam com o achado (a busca serve o grupo todo), em vez de esperar.
      for (const e of group) if (!priced(e)) await run.apply(e.id, found);
      fail(key, fails);
      return 'done';
    }
    for (const e of group) await run.apply(e.id, price);
    // Preço que não ficou gravado (ex.: carta que ainda não chegou ao banco): espera como uma falha, para a busca
    // guardada por nome não virar um laço sem pausa.
    const after = run.current(group[0].id);
    if (after && mypApiDue(after, Date.now())) fail(key, fails);
    else fails.delete(key);
    return 'done';
  } catch (err) {
    if (err instanceof MypRunStopped) return 'stopped';
    if (err instanceof MypRateLimited) {
      // Limite do MYP: mais de um minuto sem nenhuma consulta, nas duas buscas e na Consulta.
      pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
      return 'rateLimited';
    }
    // Sem internet, erro do MYP/TCGdex ou do banco: esta carta espera; as outras seguem.
    fail(key, fails);
    return offline(err) ? 'offline' : 'failed';
  }
}

/** Quem segura a consulta: 'myp' é a pausa depois de um 429 do MYP; 'app', a janela de 9 por minuto do próprio app. */
export type MypLimitBy = 'myp' | 'app';

/** A janela ou a pausa do 429 não deixam consultar agora. */
class NowLimited extends Error {
  constructor(
    readonly ms: number,
    readonly by: MypLimitBy,
  ) {
    super('MYP sem vaga');
  }
}

/**
 * Preço na hora para a Consulta: com as chaves prontas (sem TCGdex), sem esperar a vez da fila enquanto a janela tiver
 * vaga. Divide com a fila a janela, a pausa do 429 e as buscas guardadas por 30 min. Veio da busca guardada: `checkedAt`
 * é a hora dela, para a tela não dizer "agora" de um preço de meia hora. `failed`: o MYP respondeu com erro (não é falta
 * de internet).
 */
export async function consultMypNow(keys: MypKeys): Promise<{ price: MypApiPrice } | { limitedForMs: number; by: MypLimitBy } | { offline: true } | { failed: true }> {
  let oldestHit = Infinity;
  const limited = async (cacheKey: string, load: () => Promise<MypProduct[]>) => {
    const hit = recent.get(cacheKey);
    if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) {
      oldestHit = Math.min(oldestHit, hit.at);
      return hit.products;
    }
    const now = Date.now();
    const pause = pausedUntil - now;
    const wait = Math.max(pause, windowWait(now));
    if (wait > 0) throw new NowLimited(wait, pause > 0 && pause >= wait ? 'myp' : 'app');
    calls.push(now);
    const products = await load();
    recent.set(cacheKey, { at: Date.now(), products });
    return products;
  };
  const base = { cardId: keys.cardId, variant: keys.variant, note: keys.note || undefined, checkedAt: new Date().toISOString(), v: MYP_MATCHER };
  try {
    const price = await fetchMypByKeys(
      keys,
      base,
      (name) => limited(`nome:${name}`, () => searchMypByName(name)),
      (code) => limited(`codigo:${code}`, () => searchMypByCode(code)),
    );
    return { price: Number.isFinite(oldestHit) ? { ...price, checkedAt: new Date(oldestHit).toISOString() } : price };
  } catch (err) {
    if (err instanceof NowLimited) return { limitedForMs: err.ms, by: err.by };
    if (err instanceof MypRateLimited) {
      pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
      return { limitedForMs: RATE_LIMIT_PAUSE_MS, by: 'myp' };
    }
    return offline(err) ? { offline: true } : { failed: true };
  }
}
