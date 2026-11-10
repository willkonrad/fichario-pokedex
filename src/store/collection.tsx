import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { buildBackup, parseBackup, stripLegacyFields, type CollectionBackup } from '@/lib/backup';
import { customTotalSlots, extraSlots, inDexRange } from '@/lib/binder';
import { upgradeEntry } from '@/lib/entry-upgrade';
import { mypApiMatches } from '@/lib/myp-api';
import { describeSyncError, fetchAllPages, isMissingInServer, supabase } from '@/lib/supabase';
import { clearCatalogCache, freeCatalogCache, pruneStaleCache } from '@/lib/tcgdex';
import { tcgplayerCovers, tcgplayerFor } from '@/lib/tcgplayer';
import { DEFAULT_SETTINGS, POKEDEX_BINDER, type BinderSettings, type CustomBinder, type Entry, type MypApiPrice, type TcgplayerPrice } from '@/lib/types';
import { myValuePatch } from '@/lib/valuation';

const SETTINGS_KEY = 'binder:settings';
/** Formato até a 2.8: todas as cartas numa chave só. É lido uma vez e passado para uma chave por carta. */
const LEGACY_ENTRIES_KEY = 'binder:entries';
/** Uma chave por carta ("binder:e:<id>"): cada mudança regrava só a carta que mudou. */
const ENTRY_PREFIX = 'binder:e:';
const ACTIVE_KEY = 'binder:active';
/** Cartas removidas que a nuvem ainda não confirmou: id → quando foi removida. */
const DELETED_KEY = 'binder:deleted';
/** Cartas alteradas que a nuvem ainda não confirmou: id → quando. */
const PENDING_KEY = 'binder:pending';
/** Dono, cursor e datas da sincronização (ver SyncMeta). */
const SYNC_KEY = 'binder:sync';
/** Cópia do que não deu para ler (JSON estragado), para não perder nada. */
const UNREADABLE_PREFIX = 'binder:ilegivel:';
/** Coleção de outra conta guardada à parte ("binder:conta:<conta>:…") até ela entrar de novo neste aparelho. */
const STASH_PREFIX = 'binder:conta:';
/** Troca de conta em andamento ({ from, to }): se o app morrer no meio, a abertura seguinte termina a troca. */
const SWAP_KEY = 'binder:troca';
/** Antes de sair da conta, espera o envio da fila por no máximo este tempo. */
const SIGN_OUT_SEND_MS = 15_000;

/** Gravações no aparelho são agrupadas por este tempo. */
const WRITE_DELAY_MS = 400;
/** Alterações vão para a nuvem juntas, este tempo depois da última. */
const PUSH_DELAY_MS = 300;
/** Volta ao app ou relógio: não sincroniza de novo antes disso (se não houver nada pendente). */
const MIN_AUTO_SYNC_MS = 60_000;
const AUTO_SYNC_EVERY_MS = 15 * 60_000;
/** A sincronização completa (compara tudo) roda ao entrar no app e pelo menos 1×/dia; no resto, só o que mudou. */
const FULL_SYNC_EVERY_MS = 24 * 3_600_000;
/** Busca incremental volta este tempo antes do cursor (gravações que terminaram fora de ordem no servidor). */
const CURSOR_OVERLAP_MS = 2 * 60_000;
/**
 * Folga entre o relógio do aparelho e o do servidor: uma alteração daqui ainda não enviada, feita até este tempo antes
 * de uma remoção vinda da nuvem, continua valendo (ex.: carta posta logo depois de esvaziar o bolso, num aparelho com
 * o relógio um pouco atrasado).
 */
const CLOCK_SKEW_MS = 2 * 60_000;
/** Nova tentativa depois de uma falha: 30 s, 2 min e depois a cada 10 min. */
const RETRY_STEPS_MS = [30_000, 2 * 60_000, 10 * 60_000];
const UPSERT_CHUNK = 500;
/** Ids por consulta `.in()` (a lista vai na URL). */
const IN_CHUNK = 150;
/** Fichário apagado é lembrado por 1 ano (para a remoção chegar a um aparelho que ficou muito tempo fechado). */
const REMOVED_BINDER_TTL_MS = 365 * 24 * 3_600_000;

const READ_FAILED =
  'Não consegui ler a coleção salva neste aparelho. Nada foi apagado: feche e abra o app de novo. Até lá, as mudanças não são gravadas no aparelho.';
const UNREADABLE = 'Parte dos dados salvos neste aparelho estava ilegível. Guardei uma cópia à parte e segui com o resto.';
const STORAGE_FULL = 'O armazenamento do aparelho está cheio: as últimas mudanças ainda não foram gravadas nele.';
/** saveEntriesNow: as cartas pedidas não ficaram gravadas no aparelho (gravação falhou, leitura travada ou troca de conta). */
export const NOT_ON_DEVICE = 'As cartas não foram gravadas neste aparelho.';
const SWAP_FAILED =
  'Não consegui separar neste aparelho a coleção da outra conta, então nada foi enviado para a nuvem. Feche e abra o app de novo.';

/** Id da carta no fichário Pokédex: "<dex>-<espaço>". */
export const entryId = (dex: number, slot: number) => `${dex}-${slot}`;
/** Id da carta num fichário livre: "<fichário>:<bolso>". */
export const customEntryId = (binderId: string, slot: number) => `${binderId}:${slot}`;
/** Id da carta em qualquer fichário. */
export const keyOf = (binderId: string | undefined, dex: number, slot: number) =>
  binderId && binderId !== POKEDEX_BINDER ? customEntryId(binderId, slot) : entryId(dex, slot);

/** Número de Pokémon ou de bolso que o banco aceita: inteiro de 0 até o limite do int4. */
const validIndex = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 2147483647;

/** Carta com Pokémon ou bolso inválido ("NaN-0", "25-NaN") não entra: travaria todo envio para a nuvem. */
function checkPlace(input: Pick<Entry, 'dex' | 'slot'>) {
  if (!validIndex(input.dex)) throw new Error('Pokémon inválido.');
  if (!validIndex(input.slot)) throw new Error('Bolso inválido.');
}

/** Cartas de um fichário (Pokédex = as sem `binderId`). */
export function entriesOf(entries: Record<string, Entry>, binderId: string) {
  return Object.values(entries).filter((e) => (e.binderId ?? POKEDEX_BINDER) === binderId);
}

export type SyncState = 'local' | 'syncing' | 'ok' | 'offline' | 'error';

/** Estado da sincronização, com a mensagem pronta para a tela (em português). */
export type SyncStatus = {
  /**
   * `local`: sem conta (salvo só neste aparelho); `syncing`: enviando ou buscando; `ok`: em dia; `offline`: sem
   * conexão (as alterações esperam no aparelho); `error`: outro problema (na nuvem ou no armazenamento do aparelho).
   */
  state: SyncState;
  /** Última sincronização que terminou bem (também de vezes anteriores em que o app foi aberto). */
  lastSyncAt?: string;
  /** Alterações (cartas, remoções e configuração) esperando a nuvem confirmar. */
  pending: number;
  message?: string;
};

/** Destino de uma carta: fichário livre (`binderId`) ou Pokédex (`dex`), e o bolso/espaço. */
export type MoveTarget = { binderId?: string; dex?: number; slot: number };
export type ImportResult = {
  added: number;
  updated: number;
  skipped: number;
  /**
   * A junção com a nuvem ficou para depois (a cópia foi juntada só ao que está neste aparelho): `signIn`, sem conta
   * (acontece ao entrar); `sync`, a nuvem não respondeu (acontece na próxima sincronização). Nos dois casos, em cada
   * carta vale a edição mais recente.
   */
  cloudLater?: 'signIn' | 'sync';
};
export type SyncResult = { sent: number; received: number };
export type { CollectionBackup };

export type CollectionActions = {
  saveSettings: (s: BinderSettings) => Promise<void>;
  saveEntry: (e: Omit<Entry, 'id' | 'updatedAt'>) => Promise<void>;
  /** @deprecated use moveEntryTo. Fichário livre: move a carta para outro bolso do mesmo fichário. */
  moveEntry: (id: string, toSlot: number) => Promise<void>;
  /**
   * Move a carta para outro bolso, de qualquer fichário (inclusive o Pokédex), levando tudo dela (estado, observações,
   * "Meu valor", origem, preços). Se o destino estiver ocupado, as duas trocam de lugar. Lança erro (em português) se
   * o destino não existir (fichário apagado, bolso além do último, Pokémon fora da faixa do Pokédex) ou se uma das
   * cartas for parar no espaço de outro Pokémon no fichário Pokédex.
   */
  moveEntryTo: (id: string, target: MoveTarget) => Promise<void>;
  /**
   * Coloca várias cartas de uma vez: uma gravação e um envio só. Só entra em bolso vazio: o que estiver ocupado agora
   * (ex.: uma sincronização no meio) fica de fora. Devolve os ids das que entraram.
   */
  saveEntries: (list: Omit<Entry, 'id' | 'updatedAt'>[]) => Promise<string[]>;
  /** Remove a carta pelo id (ver `keyOf`). */
  removeEntry: (id: string) => Promise<void>;
  /** Remove várias cartas de uma vez (o "Desfazer" do lote): uma gravação e um envio só. */
  removeEntries: (ids: string[]) => Promise<void>;
  /**
   * Recoloca exatamente uma carta removida ou substituída (o "Desfazer"). Lança erro (em português) se o fichário dela
   * tiver sido apagado.
   */
  restoreEntry: (entry: Entry) => Promise<void>;
  /**
   * Grava os preços do MYP buscados no celular. Com conta: no banco, mesclando só o preço sobre a carta como está lá
   * e aplicando a regra do "Meu valor" com o valor atual do banco (função patch_entry_myp). Sem conta: só neste
   * aparelho. Preço não conta como edição: não muda o updatedAt da carta.
   */
  applyMypPrice: (id: string, price: MypApiPrice) => Promise<void>;
  /** Grava o preço da TCGplayer de uma carta em inglês ou japonês (mesma ideia, pela função patch_entry_tcgplayer). */
  applyTcgplayerPrice: (id: string, price: TcgplayerPrice) => Promise<void>;
  setActiveBinder: (id: string) => Promise<void>;
  saveBinder: (b: CustomBinder) => Promise<void>;
  /** Apaga o fichário livre e as cartas dele. */
  deleteBinder: (id: string) => Promise<void>;
  /** Força a sincronização completa com a nuvem. */
  syncNow: () => Promise<SyncResult>;
  /** Cópia da coleção (sem os preços das fontes, a menos que `withPrices`). Ver lib/backup.ts para o arquivo. */
  exportCollection: (opts?: { withPrices?: boolean }) => CollectionBackup;
  /**
   * Junta uma cópia à coleção, carta por carta, com a mesma regra da sincronização (vence a edição mais recente, e no
   * empate a carta daqui; os preços, o mais novo). Com conta, sincroniza antes, e as cartas da cópia que caem em bolsos
   * vazios entram (com a data da cópia). Fichários da cópia que não existem aqui são recriados. Lança erro (em
   * português) se o arquivo não for uma cópia válida.
   */
  importCollection: (data: unknown) => Promise<ImportResult>;
  /**
   * Antes de sair da conta, com ela ainda aberta: tenta enviar a fila. Devolve o aviso (em português) quando algo ficou
   * sem enviar (fica guardado neste aparelho e vai quando esta conta entrar de novo); null quando está tudo na nuvem.
   */
  prepareSignOut: () => Promise<string | null>;
};

type Ctx = CollectionActions & {
  ready: boolean;
  settings: BinderSettings | null;
  entries: Record<string, Entry>;
  session: Session | null;
  /** Mensagem do erro da sincronização (sem conexão ou outro), ou null. Ver também `syncStatus`. */
  syncError: string | null;
  /**
   * Quando a última sincronização desta abertura do app terminou bem (ISO); null até a primeira. As buscas de preço
   * esperam por ela. Para mostrar na tela, use `syncStatus.lastSyncAt`.
   */
  lastSyncAt: string | null;
  syncStatus: SyncStatus;
  /** Fichário aberto na tela inicial (`pokedex` ou o id de um fichário livre). */
  activeBinderId: string;
  /** Fichários livres. */
  binders: CustomBinder[];
};

type SyncMeta = {
  /** Conta com a qual este aparelho já sincronizou. */
  owner?: string;
  /**
   * Conta dona da coleção deste aparelho: a última que entrou aqui, mesmo antes da primeira sincronização (nos aparelhos
   * que sincronizaram antes desta regra, vale `owner`). Outra conta que entra não recebe esta coleção (ver claimDevice).
   */
  holder?: string;
  /** Maior updated_at (relógio do servidor) já recebido: a busca incremental parte dele. */
  cursor?: string;
  lastSyncAt?: string;
  lastFullAt?: string;
  /** Configuração alterada que a nuvem ainda não confirmou. */
  settingsDirty?: boolean;
};

type StoreState = {
  ready: boolean;
  settings: BinderSettings | null;
  entries: Record<string, Entry>;
  session: Session | null;
  activeBinderId: string;
  lastSyncAt: string | null;
  syncStatus: SyncStatus;
};

type RemoteRow = { id: string; data: unknown; updated_at: string };
type Tombstone = { id: string; deleted_at: string };
type MetaKey = 'settings' | 'active' | 'pending' | 'deleted' | 'meta';
type ReadResult = { ok: true; value: string | null } | { ok: false };
/** Tudo o que é de uma conta neste aparelho (a coleção, a fila e a sincronização). */
type AccountData = {
  settings: BinderSettings | null;
  activeBinderId: string;
  entries: Record<string, Entry>;
  pending: Record<string, string>;
  deleted: Record<string, string>;
  meta: SyncMeta;
};

const NO_BINDERS: CustomBinder[] = [];

/** Fichário aberto na tela inicial; um fichário livre que foi apagado (ex.: em outro aparelho) volta para o Pokédex. */
function activeBinderOf(s: StoreState): string {
  const id = s.activeBinderId;
  if (id === POKEDEX_BINDER) return id;
  return (s.settings?.extras ?? NO_BINDERS).some((b) => b.id === id) ? id : POKEDEX_BINDER;
}

// ---------- Regras de junção (puras) ----------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Data ISO normalizada (o servidor manda "+00:00" e microssegundos; o app grava "Z" com milissegundos). */
function iso(ts: string | undefined | null): string | undefined {
  if (!ts) return undefined;
  const ms = Date.parse(ts.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** Agora, mas sempre depois de todas as datas dadas (edições em sequência e relógios um pouco adiantados). */
function stampAfter(...prev: (string | undefined | null)[]): string {
  let ms = Date.now();
  for (const p of prev) {
    const t = p ? Date.parse(p) : NaN;
    if (!Number.isNaN(t) && t >= ms) ms = t + 1;
  }
  return new Date(ms).toISOString();
}

/** JSON com as chaves em ordem (para comparar o que veio do banco com o do aparelho). */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableJson(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}

const sameJson = (a: unknown, b: unknown) => a === b || stableJson(a) === stableJson(b);

/**
 * Carta lida do aparelho ou da nuvem: sem os campos antigos, com o id do bolso e como o app de hoje a entende
 * (upgradeEntry: ex.: o Mirror japonês salvo sem selo); null se não for uma carta.
 */
function cleanEntry(raw: unknown, id: string): Entry | null {
  if (!isObject(raw) || typeof raw.cardId !== 'string') return null;
  const e = upgradeEntry(stripLegacyFields(raw as unknown as Entry));
  if (e.id === id && typeof e.updatedAt === 'string') return e;
  return { ...e, id, updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '' };
}

const checkedAt = (p?: { checkedAt?: string }) => p?.checkedAt ?? '';
/**
 * O preço guardado em `from` serve para a carta `e`: mesma carta, versão e idioma (o selo é conferido por quem usa o
 * preço). O idioma é o da carta onde o preço estava (o preço não guarda o idioma): ao substituir a carta por ela mesma
 * em outro idioma (EN → PT no mesmo id), o preço da anterior não passa para a nova.
 */
const priceFits = (e: Entry, from: Entry, p?: { cardId: string; variant: string }) =>
  !!p && from.lang === e.lang && p.cardId === e.cardId && p.variant === e.variant;

/**
 * Junta duas cópias da mesma carta (deste aparelho e da nuvem, ou de uma cópia importada), por grupo de campos:
 * - os dados do usuário (carta, versão, estado, "Meu valor", observações…) vêm da edição mais recente (`updatedAt`;
 *   no empate, a da nuvem, `remote`);
 * - cada preço (MYP e TCGplayer) é o mais novo (`checkedAt`), se for desta carta, versão e idioma;
 * - um preço mais novo que o "Meu valor" e acima dele apaga o "Meu valor" (mesma regra do banco), venha ele de qualquer
 *   um dos lados (uma cópia pode ter o preço novo e o "Meu valor" velho).
 */
export function mergeEntry(local: Entry, remote: Entry): Entry {
  const base = local.updatedAt > remote.updatedAt ? local : remote;
  const other = base === local ? remote : local;
  let out = base;
  if (other.mypApi && priceFits(base, other, other.mypApi) && checkedAt(other.mypApi) > checkedAt(base.mypApi)) {
    out = { ...out, mypApi: other.mypApi };
  }
  if (other.tcgplayer && priceFits(base, other, other.tcgplayer) && checkedAt(other.tcgplayer) > checkedAt(base.tcgplayer)) {
    out = { ...out, tcgplayer: other.tcgplayer };
  }
  return applyMyValueRule(out);
}

/**
 * Regra do "Meu valor" sobre a carta: o preço da fonte dela (TCGplayer nas cartas em inglês e japonês, MYP nas
 * outras), desta carta, versão e selo, mais novo que o "Meu valor" e com a média acima dele, apaga o "Meu valor" e deixa
 * o registro da troca. Devolve a mesma carta quando nada muda.
 */
function applyMyValueRule(e: Entry): Entry {
  if (!e.myValue) return e;
  const tcg = tcgplayerCovers(e.lang);
  const price = tcg ? tcgplayerFor(e) : e.mypApi && mypApiMatches(e, e.mypApi) ? e.mypApi : undefined;
  if (!price || !(price.checkedAt > (e.myValue.setAt ?? ''))) return e;
  const patch = myValuePatch(e, price, tcg ? 'tcgplayer' : 'myp');
  return 'myValue' in patch ? { ...e, ...patch } : e;
}

/**
 * "Meu valor" depois de um preço novo do MYP gravado sem conta (o banco faz o mesmo em patch_entry_myp): só nas cartas
 * em que o MYP é a fonte. Nas em inglês (e nas japonesas, que o MYP não tem) ele é só referência: não apaga.
 */
export function mypMyValuePatch(cur: Entry, price: MypApiPrice): Partial<Entry> {
  return mypApiMatches(cur, price) && !tcgplayerCovers(cur.lang) ? myValuePatch(cur, price, 'myp') : {};
}

/**
 * "Meu valor" depois de um preço novo da TCGplayer gravado sem conta (o banco faz o mesmo em patch_entry_tcgplayer):
 * nas cartas em inglês e japonês, quando o preço é desta carta, versão e selo.
 */
export function tcgplayerMyValuePatch(cur: Entry, price: TcgplayerPrice): Partial<Entry> {
  return tcgplayerCovers(cur.lang) && tcgplayerFor({ ...cur, tcgplayer: price }) ? myValuePatch(cur, price, 'tcgplayer') : {};
}

/**
 * Mantém na carta editada os preços mais novos já guardados (a tela pode ter uma cópia um pouco atrasada). Carta
 * substituída por outra (ou pela mesma em outro idioma): os preços da anterior não valem para ela.
 */
function keepNewerPrices(next: Entry, cur: Entry): Entry {
  let out = next;
  if (cur.mypApi && priceFits(next, cur, cur.mypApi) && checkedAt(cur.mypApi) > checkedAt(next.mypApi)) out = { ...out, mypApi: cur.mypApi };
  if (cur.tcgplayer && priceFits(next, cur, cur.tcgplayer) && checkedAt(cur.tcgplayer) > checkedAt(next.tcgplayer)) {
    out = { ...out, tcgplayer: cur.tcgplayer };
  }
  return out;
}

const binderStamp = (b: CustomBinder) => b.updatedAt ?? b.createdAt ?? '';

/**
 * Junta a configuração deste aparelho com a da nuvem:
 * - o fichário Pokédex (grade, faixa, idiomas…) vem da alteração mais recente (`updatedAt`), ou da nuvem quando
 *   `remoteWinsBase` (aparelho que nunca sincronizou com esta conta: a configuração de primeira vez não passa por cima);
 * - os fichários livres são juntados um a um (vence a alteração mais recente de cada um), e os apagados num aparelho
 *   saem dos outros.
 */
export function mergeSettings(
  l: BinderSettings | null,
  r: BinderSettings | null,
  remoteWinsBase = false,
): BinderSettings | null {
  if (!r) return l;
  if (!l) return r;
  const base = remoteWinsBase || (r.updatedAt ?? '') >= (l.updatedAt ?? '') ? r : l;
  const oldest = new Date(Date.now() - REMOVED_BINDER_TTL_MS).toISOString();
  const removed: Record<string, string> = {};
  for (const map of [l.removedBinders, r.removedBinders]) {
    for (const [id, at] of Object.entries(map ?? {})) if (at >= oldest && (!removed[id] || at > removed[id])) removed[id] = at;
  }
  const byId = new Map<string, CustomBinder>();
  for (const b of r.extras ?? []) byId.set(b.id, b);
  for (const b of l.extras ?? []) {
    const other = byId.get(b.id);
    if (!other || binderStamp(b) > binderStamp(other)) byId.set(b.id, b);
  }
  // Ordem: a da nuvem, com os fichários só deste aparelho no fim.
  const order = [...new Set([...(r.extras ?? []).map((b) => b.id), ...(l.extras ?? []).map((b) => b.id)])];
  const extras = order.map((id) => byId.get(id)!).filter((b) => !(removed[b.id] && removed[b.id] >= binderStamp(b)));
  const { extras: _e, removedBinders: _r, ...rest } = base;
  const out: BinderSettings = { ...rest, extras };
  if (Object.keys(removed).length) out.removedBinders = removed;
  return out;
}

function toRow(userId: string, e: Entry) {
  // O updated_at da linha é do servidor (gatilho entries_touch), mas a coluna é timestamptz: vai sempre uma data válida.
  // Uma carta sem data (lista feita à mão) faria o envio falhar a cada tentativa e travar a sincronização.
  return { user_id: userId, id: e.id, dex: e.dex, slot: e.slot, data: e, updated_at: iso(e.updatedAt) ?? new Date().toISOString() };
}

/** Só os valores que são datas (texto) de um mapa id → quando. */
function datesOf(v: unknown): Record<string, string> {
  if (!isObject(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([, at]) => typeof at === 'string')) as Record<string, string>;
}

const emptyAccount = (): AccountData => ({ settings: null, activeBinderId: POKEDEX_BINDER, entries: {}, pending: {}, deleted: {}, meta: {} });

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function readKey(key: string): Promise<ReadResult> {
  try {
    return { ok: true, value: await AsyncStorage.getItem(key) };
  } catch {
    return { ok: false };
  }
}

/** Guarda à parte um valor ilegível, para não perdê-lo. */
async function keepUnreadable(key: string, raw: string) {
  try {
    await AsyncStorage.setItem(`${UNREADABLE_PREFIX}${key}`, raw);
    return true;
  } catch {
    return false;
  }
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Grava; com o armazenamento cheio, libera o cache do catálogo (pode ser baixado de novo) e tenta de novo. Primeiro só
 * as listas e as fichas (a parte maior); se ainda não couber, o cache inteiro.
 */
async function withRoom(write: () => Promise<void>) {
  try {
    await write();
  } catch {
    await freeCatalogCache();
    try {
      await write();
    } catch {
      await clearCatalogCache();
      await write();
    }
  }
}

const stashKey = (uid: string, part: string) => `${STASH_PREFIX}${uid}:${part}`;

/** A coleção de uma conta guardada à parte, ou null se não há (ou ficou pela metade). Falha de leitura propaga. */
async function readStash(uid: string): Promise<AccountData | null> {
  const raw = await AsyncStorage.getItem(stashKey(uid, 'estado'));
  const st = raw ? parseJson(raw) : undefined;
  // O "estado" é gravado por último: sem ele, a cópia não terminou (e a coleção continuou nas chaves de sempre).
  if (!isObject(st)) return null;
  const prefix = stashKey(uid, 'e:');
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  const entries: Record<string, Entry> = {};
  for (const part of chunks(keys, 500)) {
    for (const [key, value] of await AsyncStorage.multiGet(part)) {
      if (value == null) continue;
      const id = key.slice(prefix.length);
      const e = cleanEntry(parseJson(value), id);
      if (e) entries[id] = e;
      else if (!(await keepUnreadable(key, value))) throw new Error('Carta guardada ilegível');
    }
  }
  return {
    settings: isObject(st.settings) ? (st.settings as BinderSettings) : null,
    activeBinderId: typeof st.activeBinderId === 'string' ? st.activeBinderId : POKEDEX_BINDER,
    entries,
    pending: datesOf(st.pending),
    deleted: datesOf(st.deleted),
    meta: isObject(st.meta) ? (st.meta as SyncMeta) : {},
  };
}

/** Guarda à parte a coleção de uma conta (a cópia anterior dela sai antes). */
async function writeStash(uid: string, d: AccountData) {
  const prefix = stashKey(uid, '');
  const { entries, ...rest } = d;
  await withRoom(async () => {
    const old = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
    for (const part of chunks(old, 500)) await AsyncStorage.multiRemove(part);
    const sets = Object.values(entries).map((e): [string, string] => [stashKey(uid, `e:${e.id}`), JSON.stringify(e)]);
    for (const part of chunks(sets, 500)) await AsyncStorage.multiSet(part);
    await AsyncStorage.setItem(stashKey(uid, 'estado'), JSON.stringify(rest));
  });
}

async function removeStash(uid: string) {
  const prefix = stashKey(uid, '');
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  for (const part of chunks(keys, 500)) await AsyncStorage.multiRemove(part);
}

/** Grava a coleção de uma conta nas chaves de sempre; as cartas que não são dela saem. */
async function writeMain(d: AccountData) {
  await withRoom(async () => {
    const ids = new Set(Object.keys(d.entries));
    const sets: [string, string][] = Object.values(d.entries).map((e) => [ENTRY_PREFIX + e.id, JSON.stringify(e)]);
    sets.push([ACTIVE_KEY, d.activeBinderId], [PENDING_KEY, JSON.stringify(d.pending)], [DELETED_KEY, JSON.stringify(d.deleted)]);
    sets.push([SYNC_KEY, JSON.stringify(d.meta)]);
    if (d.settings) sets.push([SETTINGS_KEY, JSON.stringify(d.settings)]);
    const removes = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(ENTRY_PREFIX) && !ids.has(k.slice(ENTRY_PREFIX.length)));
    removes.push(LEGACY_ENTRIES_KEY);
    if (!d.settings) removes.push(SETTINGS_KEY);
    for (const part of chunks(sets, 500)) await AsyncStorage.multiSet(part);
    for (const part of chunks(removes, 500)) await AsyncStorage.multiRemove(part);
  });
}

/** Termina uma troca de conta: a coleção de `to` (a guardada à parte, ou nenhuma) vai para as chaves de sempre. */
async function finishSwap(to: string): Promise<AccountData> {
  const d = (await readStash(to)) ?? emptyAccount();
  d.meta = { ...d.meta, holder: to };
  await writeMain(d);
  await AsyncStorage.removeItem(SWAP_KEY);
  // Sobra da cópia da conta atual não atrapalha: a próxima vez que ela for guardada, a anterior sai antes.
  await removeStash(to).catch(() => {});
  return d;
}

/** A sessão que o supabase-js guardou no aparelho (mesmo com o token vencido), ou null. */
async function storedSession(sb: SupabaseClient): Promise<Session | null> {
  // `storageKey` é protegido no tipo do auth-js, mas é onde ele grava a sessão (o padrão "sb-<projeto>-auth-token").
  const key = (sb.auth as unknown as { storageKey?: unknown }).storageKey;
  if (typeof key !== 'string') return null;
  const r = await readKey(key);
  const s = r.ok && r.value ? parseJson(r.value) : undefined;
  if (!isObject(s) || typeof s.access_token !== 'string' || typeof s.refresh_token !== 'string') return null;
  return isObject(s.user) && typeof s.user.id === 'string' ? (s as unknown as Session) : null;
}

const countLabel = (n: number) => `${n} ${n === 1 ? 'alteração aguardando' : 'alterações aguardando'} envio.`;

// ---------- Store ----------

/**
 * A coleção fica num store fora do React (as telas leem com useSyncExternalStore): as ações são estáveis, e quem
 * lê só uma parte (useEntries, useSettings, useSyncStatus…) só desenha de novo quando ela muda. Toda mudança passa
 * por aqui: grava no aparelho (agrupado, uma chave por carta) e manda para a nuvem (agrupado, em fila única).
 */
class CollectionStore {
  private state: StoreState = {
    ready: false,
    settings: null,
    entries: {},
    session: null,
    activeBinderId: POKEDEX_BINDER,
    lastSyncAt: null,
    syncStatus: { state: 'local', pending: 0 },
  };
  private listeners = new Set<() => void>();
  private uid: string | null = null;
  private pending: Record<string, string> = {};
  private deleted: Record<string, string> = {};
  private meta: SyncMeta = {};
  /** Chaves cuja leitura falhou: não grava por cima do que não deu para ler (nesta abertura do app). */
  private locked = new Set<'entries' | MetaKey>();
  private storageError: string | null = null;
  private remoteError: { kind: 'offline' | 'error'; message: string } | null = null;
  private busy = 0;
  private loading: Promise<void> | null = null;
  /** A leitura do aparelho terminou (`ready` também fica falso durante uma troca de conta). */
  private loaded = false;

  private dirtyEntries = new Set<string>();
  private dirtyKeys = new Set<MetaKey>();
  private dropLegacyKey = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** Gravações no aparelho que falharam nesta abertura (writeEntriesNow confere se a dela foi uma delas). */
  private writeFailures = 0;

  private syncing: { uid: string; full: boolean; promise: Promise<SyncResult> } | null = null;
  private flushing: Promise<number> | null = null;
  private flushAgain = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryStep = 0;
  private lastAutoSync = 0;
  /** Conta que já teve a sincronização completa nesta abertura do app. */
  private fullDoneFor: string | null = null;
  /** O banco tem a migração 3.0 (registro de remoções e updated_at do servidor)? */
  private serverV3 = true;
  private settingsVersion = 0;
  private settingsChain: Promise<void> = Promise.resolve();
  private ctxCache: { state: StoreState; ctx: Ctx } | null = null;
  /**
   * A sessão é a guardada no aparelho com o token vencido (o app abriu sem internet): a conta continua aberta, mas nada
   * vai à nuvem antes de o token renovar (sem ele, a nuvem responderia como se não houvesse conta).
   */
  private staleAuth = false;
  /** Conta do último evento de sessão (um evento mais novo descarta a leitura da sessão guardada de um mais velho). */
  private authSeq = 0;
  /** Conta que não sincroniza nesta abertura do app: a coleção daqui não pôde ser separada da de outra conta. */
  private blockedFor: string | null = null;
  /** Sincronizações começadas (a busca de cada uma é a desta contagem). */
  private syncGen = 0;
  /**
   * Remoções que a nuvem confirmou: id → data da remoção e `syncGen` na confirmação. Uma busca começada antes da
   * confirmação ainda pode trazer a carta (ver applyRemote); a primeira que terminar depois dela já não traz.
   */
  private confirmedGone = new Map<string, { at: string; gen: number }>();

  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  readonly getSnapshot = () => this.state;

  readonly actions: CollectionActions = {
    saveSettings: (s) => this.saveSettings(s),
    saveEntry: (e) => this.saveEntry(e),
    saveEntries: (list) => this.saveEntries(list),
    moveEntry: (id, toSlot) => this.moveEntry(id, toSlot),
    moveEntryTo: (id, target) => this.moveEntryTo(id, target),
    removeEntry: (id) => this.removeEntry(id),
    removeEntries: (ids) => this.removeEntries(ids),
    restoreEntry: (e) => this.restoreEntry(e),
    applyMypPrice: (id, price) =>
      this.applyPrice(id, 'patch_entry_myp', { p_id: id, p_myp: price }, { mypApi: price }, (cur) => mypMyValuePatch(cur, price)),
    applyTcgplayerPrice: (id, price) =>
      this.applyPrice(id, 'patch_entry_tcgplayer', { p_id: id, p_tcg: price }, { tcgplayer: price }, (cur) => tcgplayerMyValuePatch(cur, price)),
    setActiveBinder: (id) => this.setActiveBinder(id),
    saveBinder: (b) => this.saveBinder(b),
    deleteBinder: (id) => this.deleteBinder(id),
    syncNow: () => {
      if (!supabase) return Promise.reject(new Error('A nuvem não está configurada neste app.'));
      if (!this.uid) return Promise.reject(new Error('Entre na sua conta primeiro.'));
      return this.sync(this.uid, 'full');
    },
    exportCollection: (opts) => {
      // Coleção ainda não lida, ou leitura do aparelho que falhou (sem a coleção completa vinda da nuvem nesta
      // abertura): a cópia sairia vazia ou pela metade.
      if (!this.state.ready) throw new Error('A coleção ainda está sendo carregada. Tente de novo em instantes.');
      if (this.locked.has('entries') && !(this.uid && this.fullDoneFor === this.uid)) {
        throw new Error(
          'Não consegui ler a coleção salva neste aparelho, então a cópia sairia incompleta. Feche e abra o app de novo antes de exportar.',
        );
      }
      return buildBackup(this.state.settings, Object.values(this.state.entries), opts);
    },
    importCollection: (data) => this.importCollection(data),
    prepareSignOut: () => this.prepareSignOut(),
  };

  /** O que useCollection devolve (mesmo objeto enquanto nada mudar). */
  contextFor(s: StoreState): Ctx {
    if (this.ctxCache?.state === s) return this.ctxCache.ctx;
    const binders = s.settings?.extras ?? NO_BINDERS;
    const active = activeBinderOf(s);
    const failing = s.syncStatus.state === 'error' || s.syncStatus.state === 'offline';
    const ctx: Ctx = {
      ...this.actions,
      ready: s.ready,
      settings: s.settings,
      entries: s.entries,
      session: s.session,
      syncError: failing ? (s.syncStatus.message ?? null) : null,
      lastSyncAt: s.lastSyncAt,
      syncStatus: s.syncStatus,
      activeBinderId: active,
      binders,
    };
    this.ctxCache = { state: s, ctx };
    return ctx;
  }

  private starts = 0;
  private stopListening: (() => void) | null = null;

  /**
   * Começa (carrega o aparelho, acompanha a conta e o app). Devolve a função que desliga os ouvintes. Pode ser chamada
   * por mais de um (as telas e a busca em segundo plano com o app fechado): os ouvintes são ligados uma vez só e
   * desligados quando o último desliga.
   */
  start(): () => void {
    if (this.starts++ === 0) this.stopListening = this.listen();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--this.starts === 0) {
        this.stopListening?.();
        this.stopListening = null;
      }
    };
  }

  private listen(): () => void {
    if (!this.loading) this.loading = this.load();
    const stops: (() => void)[] = [];
    if (supabase) {
      const sb = supabase;
      sb.auth.getSession().then(
        ({ data }) => this.onAuth(null, data.session),
        () => this.onAuth(null, null),
      );
      // Fora do callback: o Supabase pede para não chamar o cliente dentro dele.
      const { data } = sb.auth.onAuthStateChange((event, s) => {
        setTimeout(() => this.onAuth(event, s), 0);
      });
      stops.push(() => data.subscription.unsubscribe());
    }
    // Ao voltar para o app, busca o que mudou na nuvem; ao sair, grava já o que estiver esperando.
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') this.autoSync();
      else void this.writeNow();
    });
    stops.push(() => app.remove());
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') this.autoSync();
    }, AUTO_SYNC_EVERY_MS);
    stops.push(() => clearInterval(timer));
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const onHide = () => void this.writeNow();
      window.addEventListener('pagehide', onHide);
      stops.push(() => window.removeEventListener('pagehide', onHide));
    }
    return () => stops.forEach((stop) => stop());
  }

  // ----- estado -----

  private pendingCount() {
    return Object.keys(this.pending).length + Object.keys(this.deleted).length + (this.meta.settingsDirty ? 1 : 0);
  }

  private computeStatus(session: Session | null): SyncStatus {
    const lastSyncAt = this.meta.lastSyncAt;
    if (!supabase || !session) {
      if (this.storageError) return { state: 'error', pending: 0, message: this.storageError };
      return {
        state: 'local',
        pending: 0,
        message: supabase ? 'Salvo só neste aparelho. Entre na conta para guardar uma cópia na nuvem.' : 'Salvo só neste aparelho.',
      };
    }
    const pending = this.pendingCount();
    const waiting = pending ? countLabel(pending) : undefined;
    if (this.storageError) return { state: 'error', pending, lastSyncAt, message: this.storageError };
    if (this.busy > 0) return { state: 'syncing', pending, lastSyncAt, message: 'Sincronizando…' };
    if (this.remoteError) {
      return { state: this.remoteError.kind, pending, lastSyncAt, message: [this.remoteError.message, waiting].filter(Boolean).join(' ') };
    }
    return { state: 'ok', pending, lastSyncAt, message: waiting };
  }

  /** Publica o novo estado (só avisa as telas se algo mudou). */
  private commit(patch: Partial<StoreState> = {}) {
    const next: StoreState = { ...this.state, ...patch };
    const status = this.computeStatus(next.session);
    next.syncStatus = sameJson(status, this.state.syncStatus) ? this.state.syncStatus : status;
    const keys = Object.keys(next) as (keyof StoreState)[];
    if (keys.every((k) => next[k] === this.state[k])) return;
    this.state = next;
    for (const fn of this.listeners) fn();
  }

  private whenLoaded() {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  // ----- aparelho -----

  /** Aviso do armazenamento do aparelho (o de leitura falha, mais grave, não é trocado por outro). */
  private setStorageError(msg: string) {
    if (this.storageError !== READ_FAILED) this.storageError = msg;
  }

  /** Não grava mais por cima desta chave nesta abertura do app (a leitura falhou). */
  private lock(k: 'entries' | MetaKey) {
    this.locked.add(k);
    this.storageError = READ_FAILED;
  }

  private lockAll() {
    (['entries', 'settings', 'active', 'pending', 'deleted', 'meta'] as const).forEach((k) => this.lock(k));
  }

  /** Objeto JSON guardado numa chave; ilegível vira uma cópia à parte (ou trava a chave, se nem a cópia der certo). */
  private async readObject(k: MetaKey, key: string, r: ReadResult): Promise<Record<string, unknown>> {
    if (!r.ok) {
      this.lock(k);
      return {};
    }
    if (!r.value) return {};
    const v = parseJson(r.value);
    if (isObject(v)) return v;
    if (await keepUnreadable(key, r.value)) this.setStorageError(UNREADABLE);
    else this.lock(k);
    return {};
  }

  private async load() {
    let settings: BinderSettings | null = null;
    const entries: Record<string, Entry> = {};
    let activeBinderId = POKEDEX_BINDER;
    try {
      // Troca de conta que não terminou (o app morreu no meio): a coleção da conta nova vai para as chaves de sempre
      // (a da anterior já estava guardada à parte). Sem conseguir, nada é gravado por cima nesta abertura.
      const swap = await readKey(SWAP_KEY);
      if (!swap.ok) this.lockAll();
      else if (swap.value) {
        const m = parseJson(swap.value);
        const to = isObject(m) && typeof m.to === 'string' && m.to ? m.to : null;
        if (!to) this.lockAll();
        else await finishSwap(to).catch(() => this.lockAll());
      }

      // Cada chave é lida à parte: uma falha não derruba as outras nem vira coleção vazia.
      const s = await readKey(SETTINGS_KEY);
      if (!s.ok) this.lock('settings');
      else if (s.value) {
        const parsed = parseJson(s.value);
        if (isObject(parsed)) settings = parsed as BinderSettings;
        else if (await keepUnreadable(SETTINGS_KEY, s.value)) this.setStorageError(UNREADABLE);
        else this.lock('settings');
      }

      let entriesOk = true;
      let keys: readonly string[] = [];
      try {
        keys = await AsyncStorage.getAllKeys();
      } catch {
        entriesOk = false;
      }
      if (entriesOk && keys.includes(LEGACY_ENTRIES_KEY)) {
        const r = await readKey(LEGACY_ENTRIES_KEY);
        if (!r.ok) entriesOk = false;
        else if (r.value) {
          const parsed = parseJson(r.value);
          if (isObject(parsed)) {
            for (const [id, raw] of Object.entries(parsed)) {
              const e = cleanEntry(raw, id);
              if (!e) continue;
              entries[id] = e;
              this.dirtyEntries.add(id);
            }
            this.dropLegacyKey = true;
          } else if (await keepUnreadable(LEGACY_ENTRIES_KEY, r.value)) {
            this.dropLegacyKey = true;
            this.setStorageError(UNREADABLE);
          } else entriesOk = false;
        } else this.dropLegacyKey = true;
      }
      const entryKeys = keys.filter((k) => k.startsWith(ENTRY_PREFIX));
      for (const part of chunks(entryKeys, 500)) {
        if (!entriesOk) break;
        let pairs: readonly (readonly [string, string | null])[];
        try {
          pairs = await AsyncStorage.multiGet(part);
        } catch {
          entriesOk = false;
          break;
        }
        for (const [key, value] of pairs) {
          if (value == null) continue;
          const id = key.slice(ENTRY_PREFIX.length);
          const raw = parseJson(value);
          const e = cleanEntry(raw, id);
          if (!e) {
            // Com a cópia guardada, a chave sai na gravação (sem carta); sem a cópia, fica como está.
            if (await keepUnreadable(key, value)) this.dirtyEntries.add(id);
            this.setStorageError(UNREADABLE);
            continue;
          }
          // Mesma carta também na chave antiga (versão antiga do app aberta depois desta): fica a edição mais recente.
          const legacy = entries[id];
          if (legacy && legacy.updatedAt > e.updatedAt) continue;
          entries[id] = e;
          // Carta com campos antigos: regrava limpa.
          if (e !== raw) this.dirtyEntries.add(id);
        }
      }
      if (!entriesOk) {
        this.lock('entries');
        this.dirtyEntries.clear();
        this.dropLegacyKey = false;
      }

      const [active, deleted, pending, meta] = await Promise.all([ACTIVE_KEY, DELETED_KEY, PENDING_KEY, SYNC_KEY].map(readKey));
      if (active.ok && active.value) activeBinderId = active.value;
      this.deleted = datesOf(await this.readObject('deleted', DELETED_KEY, deleted));
      this.pending = datesOf(await this.readObject('pending', PENDING_KEY, pending));
      this.meta = (await this.readObject('meta', SYNC_KEY, meta)) as SyncMeta;
      // O app morreu entre gravar a remoção e apagar a carta (mover ou remover): a carta que ficou sai agora. Só a que
      // não foi alterada depois da remoção (recolocada no mesmo bolso, a remoção já não vale).
      for (const [id, at] of Object.entries(this.deleted)) {
        const e = entries[id];
        if (!e || e.updatedAt > at) continue;
        delete entries[id];
        this.dirtyEntries.add(id);
      }
    } catch {
      // Erro inesperado: segue com o que deu para ler, sem gravar por cima.
      this.lockAll();
    }
    this.loaded = true;
    this.commit({ ready: true, settings, entries, activeBinderId });
    if (this.dirtyEntries.size || this.dirtyKeys.size || this.dropLegacyKey) this.scheduleWrite();
    pruneStaleCache();
    if (this.uid) this.startSync(this.uid, 'full');
  }

  private scheduleWrite() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.writeNow();
    }, WRITE_DELAY_MS);
  }

  /** Grava já o que estiver esperando (em fila: uma gravação por vez, na ordem). */
  writeNow(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.writing = this.writing.then(() => this.writeOnce());
    return this.writing;
  }

  /**
   * Grava já no aparelho e confere que as cartas `ids` ficaram nele. Rejeita (NOT_ON_DEVICE) quando não ficaram: a
   * gravação falhou (armazenamento cheio mesmo depois de liberar o cache; a nova tentativa só sai daqui a 30 s), a coleção
   * salva não pôde ser lida nesta abertura (nada é gravado por cima) ou ela não está pronta (troca de conta). Para quem
   * apaga algo que só existe nessas cartas (o lote da câmera): writeNow sozinho nunca avisa da falha.
   */
  async writeEntriesNow(ids: string[]): Promise<void> {
    const notOnDevice = () => !this.state.ready || this.locked.has('entries');
    // Uma carta alterada de novo durante a gravação (um preço que chegou) volta para a fila depois de gravada: sem falha,
    // ela já está no aparelho; as voltas a mais só cobrem a gravação que não rodou (coleção deixou de estar pronta).
    for (let round = 0; round < 3; round++) {
      if (notOnDevice()) throw new Error(NOT_ON_DEVICE);
      const failures = this.writeFailures;
      await this.writeNow();
      if (this.writeFailures !== failures) throw new Error(NOT_ON_DEVICE);
      if (!ids.some((id) => this.dirtyEntries.has(id))) return;
    }
    if (notOnDevice()) throw new Error(NOT_ON_DEVICE);
  }

  private serialize(k: MetaKey): [string, string | null] {
    switch (k) {
      case 'settings':
        return [SETTINGS_KEY, this.state.settings ? JSON.stringify(this.state.settings) : null];
      case 'active':
        return [ACTIVE_KEY, this.state.activeBinderId];
      case 'pending':
        return [PENDING_KEY, JSON.stringify(this.pending)];
      case 'deleted':
        return [DELETED_KEY, JSON.stringify(this.deleted)];
      case 'meta':
        return [SYNC_KEY, JSON.stringify(this.meta)];
    }
  }

  private async writeOnce() {
    if (!this.state.ready) return;
    const ids = this.locked.has('entries') ? [] : [...this.dirtyEntries];
    const keys = [...this.dirtyKeys].filter((k) => !this.locked.has(k));
    const dropLegacy = this.dropLegacyKey && !this.locked.has('entries');
    if (!ids.length && !keys.length && !dropLegacy) return;
    ids.forEach((id) => this.dirtyEntries.delete(id));
    keys.forEach((k) => this.dirtyKeys.delete(k));
    const sets: [string, string][] = [];
    const removes: string[] = [];
    for (const id of ids) {
      const e = this.state.entries[id];
      if (e) sets.push([ENTRY_PREFIX + id, JSON.stringify(e)]);
      else removes.push(ENTRY_PREFIX + id);
    }
    for (const k of keys) {
      const [key, value] = this.serialize(k);
      if (value == null) removes.push(key);
      else sets.push([key, value]);
    }
    // A chave antiga só sai junto com a primeira gravação de todas as cartas na chave nova.
    if (dropLegacy) removes.push(LEGACY_ENTRIES_KEY);
    const write = async () => {
      if (sets.length) await AsyncStorage.multiSet(sets);
      if (removes.length) await AsyncStorage.multiRemove(removes);
    };
    try {
      await withRoom(write);
      if (dropLegacy) this.dropLegacyKey = false;
      if (this.storageError === STORAGE_FULL) {
        this.storageError = null;
        this.commit();
      }
    } catch {
      this.writeFailures++;
      ids.forEach((id) => this.dirtyEntries.add(id));
      keys.forEach((k) => this.dirtyKeys.add(k));
      this.setStorageError(STORAGE_FULL);
      this.commit();
      // Tenta de novo daqui a pouco (ou na próxima mudança).
      setTimeout(() => this.scheduleWrite(), 30_000);
    }
  }

  private markMeta(...keys: MetaKey[]) {
    keys.forEach((k) => this.dirtyKeys.add(k));
    this.scheduleWrite();
  }

  /** Aplica mudanças nas cartas (null = remove), agenda a gravação no aparelho e avisa as telas. */
  private applyEntries(changes: Record<string, Entry | null>) {
    const ids = Object.keys(changes);
    if (!ids.length) return;
    const next = { ...this.state.entries };
    for (const id of ids) {
      const e = changes[id];
      if (e) next[id] = e;
      else delete next[id];
      this.dirtyEntries.add(id);
    }
    this.scheduleWrite();
    this.commit({ entries: next });
  }

  private setSettingsLocal(s: BinderSettings) {
    this.markMeta('settings');
    this.commit({ settings: s });
  }

  /**
   * Carta alterada aqui que a nuvem precisa receber. Vale também sem conta: ao entrar, a sincronização completa junta
   * tudo antes de enviar, e só uma alteração ainda não enviada vence uma remoção vinda da nuvem (ver applyRemote).
   */
  private markPending(id: string) {
    this.pending[id] = new Date().toISOString();
    this.markMeta('pending');
  }

  private dropPending(id: string) {
    if (!(id in this.pending)) return;
    delete this.pending[id];
    this.markMeta('pending');
  }

  private forgetDeleted(id: string) {
    if (!(id in this.deleted)) return;
    delete this.deleted[id];
    this.markMeta('deleted');
  }

  // ----- conta e sincronização -----

  /**
   * Evento da conta. Sessão nula sem "saiu da conta" (SIGNED_OUT) não tira a conta do aparelho: aberto sem internet com
   * o token vencido, o supabase-js não consegue renovar e entrega null, mas a sessão continua guardada. Aí a conta segue
   * aberta, sem sincronizar até o token renovar, e o estado fica "sem conexão". Sai só sem sessão guardada.
   */
  private onAuth(event: AuthChangeEvent | null, s: Session | null) {
    const seq = ++this.authSeq;
    if (s || event === 'SIGNED_OUT' || !supabase) {
      this.setSession(s);
      return;
    }
    void storedSession(supabase).then((kept) => {
      if (seq !== this.authSeq) return; // chegou outro evento enquanto lia
      const valid = !!kept?.expires_at && kept.expires_at * 1000 > Date.now();
      this.setSession(kept, !!kept && !valid);
    });
  }

  /** `stale`: sessão guardada com o token vencido (ver staleAuth). */
  private setSession(s: Session | null, stale = false) {
    const uid = s?.user.id ?? null;
    const changed = uid !== this.uid;
    // O token renovou depois de uma abertura sem internet: agora a nuvem atende esta conta.
    const renewed = !changed && !!uid && this.staleAuth && !stale;
    this.uid = uid;
    this.staleAuth = !!uid && stale;
    if (changed) {
      this.fullDoneFor = null;
      this.remoteError = null;
      this.retryStep = 0;
      this.serverV3 = true;
      this.confirmedGone.clear();
      this.clearRetry();
      if (uid) {
        // A coleção daqui pode ser de outra conta: antes de qualquer busca ou envio, ela é separada (ver claimDevice).
        // Ações e sincronizações esperam por isso (whenLoaded). Sendo de outra, já sai da tela enquanto isso.
        const holder = this.holder();
        if (this.loaded && holder && holder !== uid) this.commit({ ready: false });
        const waits = [this.syncing?.promise, this.flushing, this.settingsChain];
        this.loading = this.whenLoaded()
          .then(() => this.claimDevice(uid, waits))
          .catch(() => {
            this.blockedFor = uid;
          });
      }
    }
    // "Última sincronização desta abertura" é da conta: as buscas de preço esperam a da conta nova.
    this.commit(changed ? { session: s, lastSyncAt: null } : { session: s });
    if ((changed || renewed) && uid && this.loaded) this.startSync(uid, 'full');
  }

  /**
   * Conta que entrou neste aparelho. A coleção daqui é de quem entrou por último (`holder`). Sem dono (o app era usado
   * sem conta): a coleção vai para esta conta, na sincronização completa. De outra conta: fica guardada à parte, até ela
   * entrar de novo, e esta conta volta com o que guardou aqui antes (ou parte do zero) e recebe o resto da nuvem. Nada de
   * uma conta vai para a outra.
   */
  private async claimDevice(uid: string, waits: (Promise<unknown> | null | undefined)[]) {
    try {
      // Antes, termina o que a conta anterior estava fazendo (sem a sessão dela, falha; a fila fica guardada com ela).
      await Promise.all(waits.map((p) => p?.catch(() => undefined)));
      if (this.uid !== uid) return; // trocou de novo enquanto esperava: a próxima chamada resolve
      if (this.blockedFor === uid) this.blockedFor = null;
      if (this.locked.has('meta')) {
        // Sem saber de quem é a coleção daqui, nada vai para a nuvem (a leitura falhou: o aviso pede para abrir de novo).
        this.blockedFor = uid;
        return;
      }
      const holder = this.holder();
      if (holder && holder !== uid) {
        await this.swapAccount(holder, uid);
        return;
      }
      if (this.meta.holder !== uid) {
        this.meta = { ...this.meta, holder: uid };
        this.markMeta('meta');
      }
    } finally {
      // Escondida durante a espera e a troca (ver setSession); sem troca, ou com ela falhando, a coleção daqui volta.
      if (!this.state.ready) {
        this.commit({ ready: true });
        this.scheduleWrite();
      }
    }
  }

  /** Conta dona da coleção deste aparelho (ver SyncMeta.holder). */
  private holder() {
    return this.meta.holder ?? this.meta.owner;
  }

  /** Guarda à parte a coleção de `from` e passa a usar a de `to` (a guardada aqui antes, ou nenhuma). */
  private async swapAccount(from: string, to: string) {
    // Parte da coleção daqui não foi lida: guardar à parte só o resto perderia o que ficou de fora.
    if (this.locked.size) {
      this.blockedFor = to;
      return;
    }
    await this.writeNow();
    // As telas esperam (sem mostrar a coleção da outra conta nesta), e nada é gravado no meio da troca.
    this.commit({ ready: false });
    let marked = false;
    try {
      const s = this.state;
      await writeStash(from, {
        settings: s.settings,
        activeBinderId: s.activeBinderId,
        entries: s.entries,
        pending: this.pending,
        deleted: this.deleted,
        meta: this.meta,
      });
      await AsyncStorage.setItem(SWAP_KEY, JSON.stringify({ from, to }));
      marked = true;
      this.useAccount(await finishSwap(to));
    } catch {
      // Antes da marca, o aparelho continua só com a coleção anterior (a troca tenta de novo na próxima abertura).
      // Depois dela, quem termina a troca é a próxima abertura: até lá, nada é gravado por cima.
      if (marked) this.lockAll();
      this.blockedFor = to;
    }
  }

  /** Passa a usar a coleção de uma conta (já gravada nas chaves de sempre). */
  private useAccount(d: AccountData) {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    this.dirtyEntries.clear();
    this.dirtyKeys.clear();
    this.dropLegacyKey = false;
    this.pending = d.pending;
    this.deleted = d.deleted;
    this.meta = d.meta;
    // Um envio da configuração da conta anterior que ainda termine não marca a desta como enviada.
    this.settingsVersion++;
    this.fullDoneFor = null;
    this.confirmedGone.clear();
    this.commit({ ready: true, settings: d.settings, entries: d.entries, activeBinderId: d.activeBinderId });
  }

  /** Antes de sair da conta (ver CollectionActions.prepareSignOut). */
  private async prepareSignOut(): Promise<string | null> {
    await this.whenLoaded();
    const uid = this.uid;
    if (!supabase || !uid) return null;
    // Duas voltas: uma sincronização que já estava no meio pode não levar o que mudou depois do envio dela.
    const deadline = Date.now() + SIGN_OUT_SEND_MS;
    for (let round = 0; round < 2 && this.pendingCount() && this.uid === uid && Date.now() < deadline; round++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const sent = this.sync(uid, this.fullDoneFor === uid ? 'auto' : 'full').then(
        () => true,
        () => false,
      );
      const late = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), deadline - Date.now());
      });
      const ok = await Promise.race([sent, late]);
      clearTimeout(timer);
      if (!ok) break;
    }
    const n = this.pendingCount();
    if (!n) return null;
    return n === 1
      ? '1 alteração ainda não foi para a nuvem. Ela fica guardada neste aparelho e vai quando você entrar de novo nesta conta.'
      : `${n} alterações ainda não foram para a nuvem. Elas ficam guardadas neste aparelho e vão quando você entrar de novo nesta conta.`;
  }

  private startSync(uid: string, mode: 'auto' | 'full') {
    this.sync(uid, mode).catch(() => {});
  }

  private autoSync() {
    if (this.uid && this.state.ready) this.startSync(this.uid, 'auto');
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private scheduleRetry() {
    if (this.retryTimer || !this.uid) return;
    const ms = RETRY_STEPS_MS[Math.min(this.retryStep, RETRY_STEPS_MS.length - 1)];
    this.retryStep++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.autoSync();
    }, ms);
  }

  private onRemoteOk() {
    // O aviso de erro só sai quando a fila esvazia (a nova tentativa já agendada continua: busca o que veio da nuvem).
    if (this.remoteError && !this.pendingCount()) this.remoteError = null;
    this.commit();
  }

  private onRemoteError(err: unknown) {
    this.remoteError = describeSyncError(err);
    this.scheduleRetry();
    this.commit();
  }

  /**
   * Junta nuvem + aparelho. `full` compara tudo (ao entrar no app, 1×/dia e no "Sincronizar agora"); `auto` busca só
   * o que mudou desde a última vez e não roda de novo antes de 1 min. Chamadas seguidas reaproveitam a que está rodando.
   */
  private sync(uid: string, mode: 'auto' | 'full'): Promise<SyncResult> {
    if (!supabase) return Promise.reject(new Error('A nuvem não está configurada neste app.'));
    const running = this.syncing;
    if (running && running.uid === uid) {
      if (mode === 'auto' || running.full) return running.promise;
      return running.promise.catch(() => undefined).then(() => this.sync(uid, 'full'));
    }
    if (mode === 'auto' && !this.remoteError && !this.pendingCount() && Date.now() - this.lastAutoSync < MIN_AUTO_SYNC_MS) {
      return Promise.resolve({ sent: 0, received: 0 });
    }
    const lastFull = Date.parse(this.meta.lastFullAt ?? '');
    const full =
      mode === 'full' ||
      !this.serverV3 ||
      this.fullDoneFor !== uid ||
      !this.meta.cursor ||
      this.meta.owner !== uid ||
      !(Date.now() - lastFull < FULL_SYNC_EVERY_MS);
    const promise = this.runSync(uid, full);
    const entry = { uid, full, promise };
    this.syncing = entry;
    void promise
      .catch(() => undefined)
      .then(() => {
        if (this.syncing === entry) this.syncing = null;
      });
    return promise;
  }

  private async fetchTombstones(uid: string, since: string | undefined): Promise<Tombstone[]> {
    const sb = supabase!;
    try {
      const rows = await fetchAllPages<Tombstone>((from, to) => {
        let q = sb.from('entry_tombstones').select('id, deleted_at').eq('user_id', uid);
        if (since) q = q.gt('deleted_at', since);
        return q.order('id').range(from, to);
      });
      this.serverV3 = true;
      return rows;
    } catch (err) {
      // Banco ainda sem a migração 3.0: sincroniza sempre por completo, como antes.
      if (isMissingInServer(err)) {
        this.serverV3 = false;
        return [];
      }
      throw err;
    }
  }

  private async runSync(uid: string, full: boolean): Promise<SyncResult> {
    const sb = supabase!;
    await this.whenLoaded();
    if (this.blockedFor === uid) {
      this.remoteError = { kind: 'error', message: SWAP_FAILED };
      this.commit();
      throw new Error(SWAP_FAILED);
    }
    this.busy++;
    this.commit();
    try {
      if (this.staleAuth) {
        // Token vencido de uma abertura sem internet: renova antes (sem internet, falha e tenta de novo mais tarde).
        const { data, error } = await sb.auth.getSession();
        if (this.uid !== uid) return { sent: 0, received: 0 };
        if (data.session?.user.id !== uid) throw error ?? new Error('Auth session missing');
        this.setSession(data.session);
      }
      const neverSynced = this.meta.owner !== uid;
      const cursorMs = Date.parse(this.meta.cursor ?? '');
      const since = full || Number.isNaN(cursorMs) ? undefined : new Date(cursorMs - CURSOR_OVERLAP_MS).toISOString();
      const gen = ++this.syncGen;
      const [settingsRes, rows, tombs] = await Promise.all([
        sb.from('binder_settings').select('data').eq('user_id', uid).maybeSingle(),
        fetchAllPages<RemoteRow>((from, to) => {
          let q = sb.from('entries').select('id, data, updated_at').eq('user_id', uid);
          if (since) q = q.gt('updated_at', since);
          return q.order('id').range(from, to);
        }),
        this.fetchTombstones(uid, since),
      ]);
      if (settingsRes.error) throw settingsRes.error;
      // Trocou de conta no meio: o resultado é da conta anterior.
      if (this.uid !== uid) return { sent: 0, received: 0 };

      // Configuração: num aparelho que nunca sincronizou com esta conta, a da nuvem vence.
      const remoteSettings = isObject(settingsRes.data?.data) ? (settingsRes.data.data as BinderSettings) : null;
      const settingsVersion = this.settingsVersion;
      const pushSettings = this.reconcileSettings(remoteSettings, neverSynced);

      // Cartas: aplica sobre o estado de agora (o que mudou durante a busca continua valendo).
      const received = this.applyRemote(rows, tombs, full, gen);

      const sent = await this.flush(uid);
      if (pushSettings) await this.pushSettings(uid);
      else if (settingsVersion === this.settingsVersion && this.meta.settingsDirty) {
        this.meta = { ...this.meta, settingsDirty: false };
      }

      let maxMs = full ? 0 : cursorMs || 0;
      for (const r of rows) maxMs = Math.max(maxMs, Date.parse(iso(r.updated_at) ?? '') || 0);
      for (const t of tombs) maxMs = Math.max(maxMs, Date.parse(iso(t.deleted_at) ?? '') || 0);
      const now = new Date().toISOString();
      // As remoções confirmadas antes desta busca já não voltam numa próxima (o servidor já não tinha a carta).
      for (const [id, c] of this.confirmedGone) if (c.gen < gen) this.confirmedGone.delete(id);
      this.meta = {
        ...this.meta,
        owner: uid,
        holder: uid,
        cursor: new Date(maxMs).toISOString(),
        lastSyncAt: now,
        lastFullAt: full ? now : this.meta.lastFullAt,
      };
      this.markMeta('meta');
      if (full) this.fullDoneFor = uid;
      this.lastAutoSync = Date.now();
      this.remoteError = null;
      this.retryStep = 0;
      this.clearRetry();
      this.commit({ lastSyncAt: now });
      return { sent, received };
    } catch (err) {
      const d = describeSyncError(err);
      this.remoteError = d;
      this.scheduleRetry();
      throw new Error(d.message);
    } finally {
      this.busy--;
      this.commit();
    }
  }

  /** Junta a configuração da nuvem com a daqui. Devolve se a nuvem precisa receber a junção. */
  private reconcileSettings(remote: BinderSettings | null, remoteWinsBase: boolean): boolean {
    const local = this.state.settings;
    const merged = mergeSettings(local, remote, remoteWinsBase);
    if (!merged) return false;
    if (!local || !sameJson(merged, local)) {
      this.setSettingsLocal(merged);
      this.dropCardsOfRemovedBinders();
    }
    return !remote || !sameJson(merged, remote);
  }

  /**
   * Cartas de fichários apagados (aqui ou em outro aparelho) saem daqui e da nuvem: sem o fichário, elas ficariam
   * invisíveis e ainda somadas no valor.
   */
  private dropCardsOfRemovedBinders(): number {
    const s = this.state.settings;
    const removed = s?.removedBinders;
    if (!removed) return 0;
    const alive = new Set((s.extras ?? []).map((b) => b.id));
    const changes: Record<string, Entry | null> = {};
    for (const e of Object.values(this.state.entries)) {
      const at = e.binderId ? removed[e.binderId] : undefined;
      if (!at || alive.has(e.binderId!)) continue;
      changes[e.id] = null;
      this.dropPending(e.id);
      this.deleted[e.id] = stampAfter(e.updatedAt, at);
    }
    const n = Object.keys(changes).length;
    if (n) {
      this.markMeta('deleted');
      this.applyEntries(changes);
    }
    return n;
  }

  /** Aplica o que veio da nuvem (na busca `gen`) sobre as cartas de agora. Devolve quantas mudaram aqui. */
  private applyRemote(rows: RemoteRow[], tombs: Tombstone[], full: boolean, gen: number): number {
    const cur = this.state.entries;
    const changes: Record<string, Entry | null> = {};
    let received = 0;
    const tombAt = new Map<string, string>();
    for (const t of tombs) {
      const at = iso(t.deleted_at);
      if (at) tombAt.set(t.id, at);
    }
    // Remoções feitas em outro aparelho (ou confirmação das feitas aqui).
    for (const [id, at] of tombAt) {
      this.forgetDeleted(id);
      const local = cur[id];
      if (!local) continue;
      // Só uma alteração daqui ainda não enviada, feita depois da remoção (com a folga do relógio), continua valendo.
      // A cópia já enviada é a que o servidor tinha quando apagou: comparar a data dela (relógio deste aparelho) com a
      // da remoção (relógio do servidor) ressuscitaria a carta num aparelho com o relógio adiantado.
      if (id in this.pending && Date.parse(local.updatedAt) > Date.parse(at) - CLOCK_SKEW_MS) {
        this.markPending(id);
        continue;
      }
      changes[id] = null;
      this.dropPending(id);
      received++;
    }
    const remoteIds = new Set<string>();
    for (const row of rows) {
      const id = row.id;
      const remote = cleanEntry(row.data, id);
      if (!remote) continue;
      remoteIds.add(id);
      // Lida junto com o registro de remoção (consultas em paralelo): vale o mais recente.
      const tomb = tombAt.get(id);
      if (tomb && tomb >= (iso(row.updated_at) ?? '')) continue;
      // Removida aqui e confirmada pela nuvem depois que esta busca começou: a linha é de antes da remoção.
      const done = this.confirmedGone.get(id);
      if (done && done.gen >= gen && remote.updatedAt <= done.at) continue;
      const gone = this.deleted[id];
      if (gone) {
        if (remote.updatedAt > gone) this.forgetDeleted(id); // recolocada em outro aparelho depois da remoção daqui
        else continue; // a remoção daqui ainda vai para a nuvem
      }
      const local = id in changes ? (changes[id] ?? undefined) : cur[id];
      if (!local) {
        changes[id] = remote;
        this.dropPending(id);
        received++;
        continue;
      }
      const merged = mergeEntry(local, remote);
      if (merged !== local && !sameJson(merged, local)) {
        changes[id] = merged;
        received++;
      }
      if (sameJson(merged, remote)) this.dropPending(id);
      else this.markPending(id);
    }
    if (full) {
      // Só neste aparelho e sem registro de remoção: envia (nunca apaga daqui o que a nuvem não conhece).
      for (const local of Object.values(cur)) {
        if (remoteIds.has(local.id) || local.id in changes || tombAt.has(local.id)) continue;
        this.markPending(local.id);
      }
    }
    this.applyEntries(changes);
    this.dropCardsOfRemovedBinders();
    return received;
  }

  /** Manda para a nuvem a fila de alterações daqui a pouco (várias mudanças seguidas vão juntas). */
  private requestFlush() {
    if (!this.uid || !supabase) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const uid = this.uid;
      if (!uid) return;
      if (this.fullDoneFor !== uid) {
        // Antes da sincronização completa com esta conta (ao abrir o app, ao entrar ou depois de uma importação sem
        // resposta da nuvem), nada sobe às cegas: ela junta a nuvem primeiro e envia a fila; o que mudar enquanto isso
        // vai logo depois.
        this.sync(uid, 'full').then(
          () => {
            if (this.fullDoneFor === uid && this.pendingCount()) this.requestFlush();
          },
          () => {}, // runSync já mostrou o erro e agendou a nova tentativa
        );
        return;
      }
      this.flush(uid).then(
        () => this.onRemoteOk(),
        (err) => this.onRemoteError(err),
      );
    }, PUSH_DELAY_MS);
  }

  /**
   * Envia a fila (remoções e cartas alteradas). Uma vez por vez; o que mudar durante o envio vai em seguida. O envio em
   * segundo plano não muda o estado para "syncing" (só a contagem de pendentes), para não redesenhar as telas à toa.
   */
  private flush(uid: string): Promise<number> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    const run = async () => {
      let sent = 0;
      try {
        do {
          this.flushAgain = false;
          sent += await this.flushOnce(uid);
        } while (this.flushAgain && this.uid === uid);
        return sent;
      } finally {
        this.flushing = null;
      }
    };
    this.flushing = run();
    return this.flushing;
  }

  private async flushOnce(uid: string): Promise<number> {
    const sb = supabase!;
    let sent = 0;

    // 1. Remoções: a nuvem apaga só as que não foram alteradas depois (recolocadas em outro aparelho).
    const dels = { ...this.deleted };
    const delIds = Object.keys(dels);
    if (delIds.length) {
      let gone: string[];
      const res = await sb.rpc('delete_entries', { p: dels });
      if (!res.error) gone = (res.data as string[] | null) ?? [];
      else if (isMissingInServer(res.error)) {
        // Banco ainda sem a migração 3.0: confere a data de cada uma e apaga direto.
        const newer = new Set<string>();
        for (const part of chunks(delIds, IN_CHUNK)) {
          const { data, error } = await sb.from('entries').select('id, data').eq('user_id', uid).in('id', part);
          if (error) throw error;
          for (const r of (data ?? []) as { id: string; data: Entry }[]) if ((r.data?.updatedAt ?? '') > dels[r.id]) newer.add(r.id);
        }
        gone = delIds.filter((id) => !newer.has(id));
        for (const part of chunks(gone, IN_CHUNK)) {
          const { error } = await sb.from('entries').delete().eq('user_id', uid).in('id', part);
          if (error) throw error;
        }
      } else throw res.error;
      const goneSet = new Set(gone);
      // Uma busca que já estava rodando ainda pode trazer estas cartas (ver confirmedGone).
      if (this.uid === uid) for (const id of gone) if (dels[id]) this.confirmedGone.set(id, { at: dels[id], gen: this.syncGen });
      // As que não saíram: não estavam na nuvem ou foram recolocadas depois em outro aparelho (essas voltam para cá).
      const kept = delIds.filter((id) => !goneSet.has(id));
      const back: Record<string, Entry | null> = {};
      for (const part of chunks(kept, IN_CHUNK)) {
        const { data, error } = await sb.from('entries').select('id, data').eq('user_id', uid).in('id', part);
        if (error) throw error;
        for (const r of (data ?? []) as { id: string; data: unknown }[]) {
          const remote = cleanEntry(r.data, r.id);
          if (remote && this.deleted[r.id] === dels[r.id] && !this.state.entries[r.id]) back[r.id] = remote;
        }
      }
      for (const id of delIds) if (this.deleted[id] === dels[id]) delete this.deleted[id];
      this.markMeta('deleted');
      this.applyEntries(back);
      // Carta de fichário apagado que voltou (alterada em outro aparelho): sai de novo, na próxima volta da fila.
      if (this.dropCardsOfRemovedBinders()) this.flushAgain = true;
      sent += gone.length;
    }

    // 2. Cartas alteradas.
    const ids = Object.keys(this.pending);
    if (!ids.length) return sent;
    const batch: Entry[] = [];
    for (const id of ids) {
      const e = this.state.entries[id];
      if (e) batch.push(e);
      else delete this.pending[id];
    }
    for (const part of chunks(batch, UPSERT_CHUNK)) {
      const { error } = await sb.from('entries').upsert(part.map((e) => toRow(uid, e)));
      if (error) throw error;
    }
    // Sai da fila só o que não mudou durante o envio.
    for (const e of batch) if (this.state.entries[e.id] === e) delete this.pending[e.id];
    this.markMeta('pending');
    this.commit();
    return sent + batch.length;
  }

  /** Lê a configuração da nuvem, junta com a daqui e grava a junção lá (fichários alterados em outro aparelho ficam). */
  private async pushSettings(uid: string) {
    const sb = supabase!;
    const version = this.settingsVersion;
    const { data, error } = await sb.from('binder_settings').select('data').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (this.uid !== uid) return;
    // Aparelho que ainda não sincronizou com esta conta não passa a configuração dele por cima da nuvem (S3).
    const push = this.reconcileSettings(isObject(data?.data) ? (data.data as BinderSettings) : null, this.meta.owner !== uid);
    if (push && this.state.settings) {
      const { error: e2 } = await sb.from('binder_settings').upsert({ user_id: uid, data: this.state.settings, updated_at: new Date().toISOString() });
      if (e2) throw e2;
    }
    if (version === this.settingsVersion && this.meta.settingsDirty) {
      this.meta = { ...this.meta, settingsDirty: false };
      this.markMeta('meta');
      this.commit();
    }
  }

  /** Configuração alterada aqui: grava e manda para a nuvem (em fila). */
  private settingsChanged() {
    this.settingsVersion++;
    const uid = this.uid;
    if (!uid || !supabase) return;
    this.meta = { ...this.meta, settingsDirty: true };
    this.markMeta('meta');
    this.commit();
    // Token vencido (sem internet ao abrir): vai na sincronização, que renova antes.
    if (this.staleAuth) {
      this.requestFlush();
      return;
    }
    this.settingsChain = this.settingsChain
      .then(() => this.pushSettings(uid))
      .then(
        () => this.onRemoteOk(),
        (err) => this.onRemoteError(err),
      );
  }

  // ----- ações -----

  private async saveSettings(input: BinderSettings) {
    await this.whenLoaded();
    const cur = this.state.settings;
    // Mantém os fichários livres: a tela do Pokédex não mexe neles.
    const next: BinderSettings = {
      ...input,
      extras: cur?.extras ?? input.extras,
      removedBinders: cur?.removedBinders,
      updatedAt: stampAfter(cur?.updatedAt),
    };
    if (!next.removedBinders) delete next.removedBinders;
    this.setSettingsLocal(next);
    this.settingsChanged();
  }

  private async saveBinder(b: CustomBinder) {
    await this.whenLoaded();
    const base = this.state.settings ?? DEFAULT_SETTINGS;
    const extras = base.extras ?? [];
    const prev = extras.find((x) => x.id === b.id);
    const binder: CustomBinder = { ...b, updatedAt: stampAfter(prev ? binderStamp(prev) : undefined) };
    const next = prev ? extras.map((x) => (x.id === b.id ? binder : x)) : [...extras, binder];
    this.setSettingsLocal({ ...base, extras: next });
    this.settingsChanged();
  }

  private async deleteBinder(id: string) {
    await this.whenLoaded();
    const base = this.state.settings ?? DEFAULT_SETTINGS;
    const prev = (base.extras ?? []).find((x) => x.id === id);
    const at = stampAfter(prev ? binderStamp(prev) : undefined);
    const next: BinderSettings = {
      ...base,
      extras: (base.extras ?? []).filter((x) => x.id !== id),
      removedBinders: { ...base.removedBinders, [id]: at },
    };
    this.setSettingsLocal(next);
    const changes: Record<string, Entry | null> = {};
    for (const e of Object.values(this.state.entries)) {
      if (e.binderId !== id) continue;
      changes[e.id] = null;
      this.dropPending(e.id);
      this.deleted[e.id] = stampAfter(e.updatedAt);
    }
    this.markMeta('deleted');
    this.applyEntries(changes);
    if (this.state.activeBinderId === id) await this.setActiveBinder(POKEDEX_BINDER);
    this.settingsChanged();
    this.requestFlush();
  }

  private async setActiveBinder(id: string) {
    await this.whenLoaded();
    this.markMeta('active');
    this.commit({ activeBinderId: id });
  }

  private async saveEntry(input: Omit<Entry, 'id' | 'updatedAt'>) {
    checkPlace(input);
    await this.whenLoaded();
    const id = keyOf(input.binderId, input.dex, input.slot);
    const cur = this.state.entries[id];
    let e = stripLegacyFields({ ...input, id, updatedAt: stampAfter(cur?.updatedAt, this.deleted[id]) } as Entry);
    if (cur) e = keepNewerPrices(e, cur);
    this.forgetDeleted(id);
    this.markPending(id);
    this.applyEntries({ [id]: e });
    this.requestFlush();
    // Os preços chegam depois: os do MYP Cards pelo app no celular (MypRefresher), os da TCGplayer pelo TcgplayerRefresher.
  }

  private async saveEntries(list: Omit<Entry, 'id' | 'updatedAt'>[]): Promise<string[]> {
    // Uma carta inválida recusa o lote inteiro (nada pela metade).
    for (const input of list) checkPlace(input);
    await this.whenLoaded();
    const changes: Record<string, Entry | null> = {};
    for (const input of list) {
      const id = keyOf(input.binderId, input.dex, input.slot);
      if (this.state.entries[id] || changes[id]) continue;
      changes[id] = stripLegacyFields({ ...input, id, updatedAt: stampAfter(this.deleted[id]) } as Entry);
      this.forgetDeleted(id);
      this.markPending(id);
    }
    const ids = Object.keys(changes);
    if (!ids.length) return ids;
    this.applyEntries(changes);
    this.requestFlush();
    return ids;
  }

  private async removeEntry(id: string) {
    await this.whenLoaded();
    const e = this.state.entries[id];
    this.dropPending(id);
    // Lembra a remoção até a nuvem confirmar (sem internet, a carta voltaria na próxima sincronização).
    this.deleted[id] = stampAfter(e?.updatedAt);
    this.markMeta('deleted');
    if (e) this.applyEntries({ [id]: null });
    else this.commit();
    this.requestFlush();
  }

  private async removeEntries(ids: string[]) {
    await this.whenLoaded();
    if (!ids.length) return;
    const changes: Record<string, Entry | null> = {};
    for (const id of ids) {
      const e = this.state.entries[id];
      this.dropPending(id);
      this.deleted[id] = stampAfter(e?.updatedAt);
      if (e) changes[id] = null;
    }
    this.markMeta('deleted');
    if (Object.keys(changes).length) this.applyEntries(changes);
    else this.commit();
    this.requestFlush();
  }

  private async restoreEntry(entry: Entry) {
    await this.whenLoaded();
    const clean = stripLegacyFields(entry);
    const binderId = clean.binderId && clean.binderId !== POKEDEX_BINDER ? clean.binderId : undefined;
    // Sem o fichário, a carta ficaria invisível e ainda somada no valor.
    if (binderId && !(this.state.settings?.extras ?? []).some((b) => b.id === binderId)) {
      throw new Error('Fichário não encontrado. Ele pode ter sido apagado em outro aparelho.');
    }
    const id = keyOf(binderId, clean.dex, clean.slot);
    const cur = this.state.entries[id];
    // Data nova: a carta volta também nos outros aparelhos, mesmo que a remoção já tenha chegado lá.
    const e: Entry = { ...clean, id, updatedAt: stampAfter(clean.updatedAt, cur?.updatedAt, this.deleted[id]) };
    this.forgetDeleted(id);
    this.markPending(id);
    this.applyEntries({ [id]: e });
    this.requestFlush();
  }

  private async moveEntry(id: string, toSlot: number) {
    const e = this.state.entries[id];
    if (!e?.binderId || e.slot === toSlot) return;
    await this.moveEntryTo(id, { binderId: e.binderId, slot: toSlot });
  }

  private async moveEntryTo(id: string, target: MoveTarget) {
    await this.whenLoaded();
    const e = this.state.entries[id];
    if (!e) throw new Error('Carta não encontrada. Ela pode ter sido removida em outro aparelho.');
    if (!Number.isInteger(target.slot) || target.slot < 0) throw new Error('Bolso inválido.');
    const settings = this.state.settings;
    const toBinder = target.binderId && target.binderId !== POKEDEX_BINDER ? target.binderId : undefined;
    const toDex = target.dex ?? e.dex;
    if (!Number.isInteger(toDex) || toDex < 0) throw new Error('Pokémon inválido.');
    // O destino precisa existir no fichário (fora dele, a carta ficaria invisível e ainda somada no valor).
    if (toBinder) {
      const binder = settings?.extras?.find((b) => b.id === toBinder);
      if (!binder) throw new Error('Fichário não encontrado. Ele pode ter sido apagado em outro aparelho.');
      if (target.slot >= customTotalSlots(binder)) throw new Error('Bolso inválido: o fichário não tem tantos bolsos.');
    } else {
      if (toDex !== 0 && e.dex !== 0 && e.dex !== toDex) {
        throw new Error('Esta carta é de outro Pokémon. No fichário Pokédex, ela só pode ir para o espaço do próprio Pokémon ou para um bolso livre.');
      }
      const exists = !settings || (toDex === 0 ? target.slot < extraSlots(settings) : inDexRange(settings, toDex) && target.slot < settings.slotsPerPokemon);
      if (!exists) throw new Error('Este espaço não existe no fichário Pokédex.');
    }
    const targetId = keyOf(toBinder, toDex, target.slot);
    if (targetId === id) return;
    const fromBinder = e.binderId && e.binderId !== POKEDEX_BINDER ? e.binderId : undefined;
    const other = this.state.entries[targetId];
    // No Pokédex, cada espaço é de um Pokémon: a carta do destino só vem para cá se for do mesmo (ou para os extras).
    if (other && !fromBinder && e.dex !== 0 && other.dex !== e.dex) {
      throw new Error('O bolso de destino tem a carta de outro Pokémon, que não pode vir para este espaço do fichário Pokédex. Escolha um bolso vazio.');
    }
    const at = stampAfter(e.updatedAt, other?.updatedAt, this.deleted[targetId]);
    const moved: Entry = { ...e, id: targetId, binderId: toBinder, dex: toDex, slot: target.slot, updatedAt: at };
    if (!toBinder) delete moved.binderId;
    const changes: Record<string, Entry | null> = { [targetId]: moved };
    if (other) {
      const swapped: Entry = { ...other, id, binderId: fromBinder, dex: fromBinder ? other.dex : e.dex, slot: e.slot, updatedAt: at };
      if (!fromBinder) delete swapped.binderId;
      changes[id] = swapped;
    } else changes[id] = null;
    this.forgetDeleted(targetId);
    this.markPending(targetId);
    if (other) {
      this.forgetDeleted(id);
      this.markPending(id);
    } else {
      // Bolso de origem vazio: a carta sai de lá também na nuvem e nos outros aparelhos.
      this.dropPending(id);
      this.deleted[id] = at;
      this.markMeta('deleted');
    }
    this.applyEntries(changes);
    this.requestFlush();
  }

  /**
   * Grava um preço buscado (MYP ou TCGplayer) sobre a carta. Com conta: no banco, pela função `rpc`, que mescla só o
   * preço sobre a carta como está lá e aplica a regra do "Meu valor"; o resultado é juntado à carta daqui (edições
   * ainda não enviadas continuam valendo). Sem conta: só neste aparelho (`local` diz o que muda além do preço).
   */
  private async applyPrice(
    id: string,
    rpc: 'patch_entry_myp' | 'patch_entry_tcgplayer',
    args: Record<string, unknown>,
    patch: Pick<Entry, 'mypApi'> | Pick<Entry, 'tcgplayer'>,
    local: (cur: Entry) => Partial<Entry>,
  ) {
    await this.whenLoaded();
    const cur = this.state.entries[id];
    if (!cur) return; // removida enquanto a busca acontecia
    const uid = this.uid;
    // Com o token vencido (ver staleAuth), o preço fica só aqui: a sincronização leva a carta com ele.
    if (supabase && uid && !this.staleAuth) {
      const { data, error } = await supabase.rpc(rpc, args);
      if (error) {
        this.onRemoteError(error);
        throw error; // a busca tenta de novo mais tarde
      }
      if (this.uid !== uid) return;
      const latest = this.state.entries[id];
      if (!latest) return;
      const res = data as { prev?: string | null; data?: unknown } | null;
      const remote = res?.data ? cleanEntry(res.data, id) : null;
      if (!remote) {
        // Carta que ainda não está no banco: guarda o preço aqui; a fila (ou a próxima sincronização) envia a carta
        // com ele, ou a tira daqui se foi removida em outro aparelho.
        this.applyEntries({ [id]: { ...latest, ...patch, ...local(latest) } });
        return;
      }
      const merged = mergeEntry(latest, remote);
      if (merged !== latest && !sameJson(merged, latest)) this.applyEntries({ [id]: merged });
      // Edição daqui ainda na fila: vai de novo, já com o preço novo.
      if (this.pending[id]) this.requestFlush();
      return;
    }
    this.applyEntries({ [id]: { ...cur, ...patch, ...local(cur) } });
  }

  private async importCollection(data: unknown): Promise<ImportResult> {
    await this.whenLoaded();
    const parsed = parseBackup(data);
    let added = 0;
    let updated = 0;
    let skipped = parsed.invalid;

    // Com conta, a cópia se junta à coleção em dia com a nuvem: um bolso vazio aqui está vazio também lá (a carta da
    // cópia entra, mesmo que tenha sido removida depois) e nenhuma edição mais nova da nuvem fica para trás. Sem conta
    // ou sem resposta da nuvem, quem junta é a próxima sincronização completa (vence a edição mais recente de cada carta).
    let cloudLater: ImportResult['cloudLater'];
    const uid = this.uid;
    if (supabase && !uid) cloudLater = 'signIn';
    else if (supabase && uid) {
      try {
        await this.sync(uid, 'full');
      } catch {
        cloudLater = 'sync';
        // A fila só sobe depois de uma sincronização completa (ver requestFlush): a cópia não passa por cima da nuvem.
        this.fullDoneFor = null;
      }
    }

    // Fichários da cópia que não existem aqui voltam (com data nova, mesmo que tenham sido apagados antes).
    if (parsed.settings) {
      const local = this.state.settings;
      const incoming = parsed.settings;
      const localIds = new Set((local?.extras ?? []).map((b) => b.id));
      const now = new Date().toISOString();
      const prepared: BinderSettings = {
        ...incoming,
        extras: (incoming.extras ?? []).map((b) => (localIds.has(b.id) ? b : { ...b, updatedAt: now })),
      };
      delete prepared.removedBinders;
      const merged = mergeSettings(local, prepared, false);
      if (merged && !sameJson(merged, local)) {
        this.setSettingsLocal(merged);
        this.settingsChanged();
      }
    }

    const binderIds = new Set((this.state.settings?.extras ?? []).map((b) => b.id));
    const changes: Record<string, Entry | null> = {};
    // Carta sem data (lista feita à mão): vale a data da cópia, se ela tiver; sem nenhuma, a carta perde para qualquer
    // edição (e o envio leva uma data válida, ver toRow).
    const copyDate = iso(parsed.exportedAt) ?? '';
    for (const raw of parsed.entries) {
      const binderId = raw.binderId && raw.binderId !== POKEDEX_BINDER ? raw.binderId : undefined;
      if (binderId && !binderIds.has(binderId)) {
        skipped++;
        continue;
      }
      const id = keyOf(binderId, raw.dex, raw.slot);
      const entry: Entry = { ...raw, id, binderId, updatedAt: raw.updatedAt || copyDate };
      if (!binderId) delete entry.binderId;
      const local = changes[id] ?? this.state.entries[id];
      if (!local) {
        // Bolso vazio: a carta entra com a data da cópia (uma data nova passaria por cima de edições mais recentes da
        // nuvem). Com a coleção em dia com a nuvem, o envio recoloca a carta lá também e apaga o registro de remoção.
        changes[id] = entry;
        added++;
        continue;
      }
      // Mesma regra da sincronização, mas o empate fica com a carta daqui: a cópia sai sem os preços e sem o registro
      // do "Meu valor" trocado, que também ficam quando a carta da cópia é mais nova (mesma carta).
      let merged = mergeEntry(entry, local);
      if (merged.myValue == null && !merged.myValueReplaced && local.myValueReplaced && merged.cardId === local.cardId) {
        merged = { ...merged, myValueReplaced: local.myValueReplaced };
      }
      if (sameJson(merged, local)) skipped++;
      else {
        changes[id] = merged;
        updated++;
      }
    }
    this.applyEntries(changes);
    for (const id of Object.keys(changes)) {
      this.forgetDeleted(id);
      this.markPending(id);
    }
    this.commit();
    this.requestFlush();
    return cloudLater ? { added, updated, skipped, cloudLater } : { added, updated, skipped };
  }
}

const store = new CollectionStore();

/** Liga a coleção ao app (carrega o aparelho, acompanha a conta e sincroniza). Fica no _layout. */
export function CollectionProvider({ children }: { children: ReactNode }) {
  useEffect(() => store.start(), []);
  return <>{children}</>;
}

/** A coleção inteira e as ações (desenha de novo a cada mudança; prefira os hooks abaixo nas telas novas). */
export function useCollection(): Ctx {
  const s = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return store.contextFor(s);
}

/** Só as ações (o objeto nunca muda: não desenha de novo). */
export function useCollectionActions(): CollectionActions {
  return store.actions;
}

/** Fora das telas (a busca em segundo plano): a coleção como está agora, as ações e como ligar e gravar. */
export const collectionState = () => store.getSnapshot();
export const subscribeCollection = (fn: () => void) => store.subscribe(fn);
export const collectionActions: CollectionActions = store.actions;
/** Liga a coleção sem tela aberta (como o CollectionProvider); devolve como desligar. */
export const startCollection = () => store.start();
/**
 * Grava já no aparelho o que estiver esperando (com o app em segundo plano, a gravação agrupada pode atrasar). Não avisa
 * de falha: quem precisa saber se as cartas ficaram no aparelho usa saveEntriesNow.
 */
export const saveCollectionNow = () => store.writeNow();
/** Grava já no aparelho e rejeita (NOT_ON_DEVICE) se as cartas `ids` não ficaram gravadas nele. */
export const saveEntriesNow = (ids: string[]) => store.writeEntriesNow(ids);

const selectReady = () => store.getSnapshot().ready;
const selectEntries = () => store.getSnapshot().entries;
const selectSettings = () => store.getSnapshot().settings;
const selectBinders = () => store.getSnapshot().settings?.extras ?? NO_BINDERS;
const selectSyncStatus = () => store.getSnapshot().syncStatus;
const selectSession = () => store.getSnapshot().session;
const selectActiveBinderId = () => activeBinderOf(store.getSnapshot());

export function useCollectionReady() {
  return useSyncExternalStore(store.subscribe, selectReady, selectReady);
}

/** Todas as cartas (id → carta). */
export function useEntries() {
  return useSyncExternalStore(store.subscribe, selectEntries, selectEntries);
}

/** Uma carta: só desenha de novo quando ela muda. */
export function useEntry(id: string | undefined) {
  const select = () => (id ? store.getSnapshot().entries[id] : undefined);
  return useSyncExternalStore(store.subscribe, select, select);
}

export function useSettings() {
  return useSyncExternalStore(store.subscribe, selectSettings, selectSettings);
}

/** Fichários livres. */
export function useBinders() {
  return useSyncExternalStore(store.subscribe, selectBinders, selectBinders);
}

/**
 * Fichário aberto na tela inicial (`pokedex` ou o id de um fichário livre; um fichário apagado volta para o Pokédex).
 * Só desenha de novo quando ele muda. Para trocar, `useCollectionActions().setActiveBinder(id)`.
 */
export function useActiveBinderId() {
  return useSyncExternalStore(store.subscribe, selectActiveBinderId, selectActiveBinderId);
}

export function useSyncStatus() {
  return useSyncExternalStore(store.subscribe, selectSyncStatus, selectSyncStatus);
}

export function useSession() {
  return useSyncExternalStore(store.subscribe, selectSession, selectSession);
}
