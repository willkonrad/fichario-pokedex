import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';
import { clearCatalogCache, pruneStaleCache } from '@/lib/tcgdex';
import { DEFAULT_SETTINGS, POKEDEX_BINDER, type BinderSettings, type CustomBinder, type Entry } from '@/lib/types';

const SETTINGS_KEY = 'binder:settings';
const ENTRIES_KEY = 'binder:entries';
const ACTIVE_KEY = 'binder:active';
/** Cartas removidas que a nuvem ainda não confirmou: id → quando foi removida. */
const DELETED_KEY = 'binder:deleted';

/** Id da carta no fichário Pokédex: "<dex>-<espaço>". */
export const entryId = (dex: number, slot: number) => `${dex}-${slot}`;
/** Id da carta num fichário livre: "<fichário>:<bolso>". */
export const customEntryId = (binderId: string, slot: number) => `${binderId}:${slot}`;
/** Id da carta em qualquer fichário. */
export const keyOf = (binderId: string | undefined, dex: number, slot: number) =>
  binderId && binderId !== POKEDEX_BINDER ? customEntryId(binderId, slot) : entryId(dex, slot);

/** Cartas de um fichário (Pokédex = as sem `binderId`). */
export function entriesOf(entries: Record<string, Entry>, binderId: string) {
  return Object.values(entries).filter((e) => (e.binderId ?? POKEDEX_BINDER) === binderId);
}

type Ctx = {
  ready: boolean;
  settings: BinderSettings | null;
  entries: Record<string, Entry>;
  session: Session | null;
  syncError: string | null;
  /** Quando a última sincronização completa terminou bem (ISO). */
  lastSyncAt: string | null;
  saveSettings: (s: BinderSettings) => Promise<void>;
  saveEntry: (e: Omit<Entry, 'id' | 'updatedAt'>) => Promise<void>;
  /** Fichário livre: move a carta para outro bolso (troca de lugar se o bolso estiver ocupado). */
  moveEntry: (id: string, toSlot: number) => Promise<void>;
  /** Remove a carta pelo id (ver `keyOf`). */
  removeEntry: (id: string) => Promise<void>;
  /** Fichário aberto na tela inicial (`pokedex` ou o id de um fichário livre). */
  activeBinderId: string;
  setActiveBinder: (id: string) => Promise<void>;
  /** Fichários livres. */
  binders: CustomBinder[];
  saveBinder: (b: CustomBinder) => Promise<void>;
  /** Apaga o fichário livre e as cartas dele. */
  deleteBinder: (id: string) => Promise<void>;
  /** Força a sincronização completa com a nuvem. */
  syncNow: () => Promise<{ sent: number; received: number }>;
};

const CollectionContext = createContext<Ctx | null>(null);

export function useCollection() {
  const ctx = use(CollectionContext);
  if (!ctx) throw new Error('useCollection fora do CollectionProvider');
  return ctx;
}

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<BinderSettings | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [session, setSession] = useState<Session | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [activeBinderId, setActiveBinderId] = useState<string>(POKEDEX_BINDER);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const deletedRef = useRef<Record<string, string>>({});
  // Sincronização em andamento: chamadas seguidas reaproveitam a mesma, em vez de rodarem juntas.
  const syncingRef = useRef<Promise<{ sent: number; received: number }> | null>(null);

  // Carrega o que está salvo no aparelho.
  useEffect(() => {
    (async () => {
      try {
        const [s, e, a, d] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(ENTRIES_KEY),
          AsyncStorage.getItem(ACTIVE_KEY),
          AsyncStorage.getItem(DELETED_KEY),
        ]);
        if (d) deletedRef.current = JSON.parse(d);
        if (s) {
          settingsRef.current = JSON.parse(s);
          setSettings(settingsRef.current);
        }
        if (e) setEntries(JSON.parse(e));
        if (a) setActiveBinderId(a);
      } catch {}
      setReady(true);
      pruneStaleCache();
    })();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Ao entrar na conta: junta nuvem + aparelho (vence o mais recente) e envia o que faltar.
  const userId = session?.user.id;
  useEffect(() => {
    if (ready && userId) syncAll(userId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sincroniza só ao abrir o app ou trocar de conta
  }, [ready, userId]);

  // Ao voltar para o app, e a cada 15 min com ele aberto, busca o que mudou na nuvem
  // (ex.: preços gravados pela cotação automática às 6h, 13h e 20h).
  useEffect(() => {
    if (!ready || !userId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncAll(userId).catch(() => {});
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') syncAll(userId).catch(() => {});
    }, 15 * 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mesmo motivo do efeito acima
  }, [ready, userId]);

  /** Junta nuvem + aparelho. Devolve quantas cartas foram enviadas e quantas vieram da nuvem. */
  function syncAll(uid: string): Promise<{ sent: number; received: number }> {
    if (!syncingRef.current) {
      syncingRef.current = runSync(uid).finally(() => {
        syncingRef.current = null;
      });
    }
    return syncingRef.current;
  }

  async function runSync(uid: string): Promise<{ sent: number; received: number }> {
    if (!supabase) throw new Error('Supabase não configurado');
    const sb = supabase;
    try {
      const [{ data: remoteSettings, error: e1 }, { data: remoteRows, error: e2 }] = await Promise.all([
        sb.from('binder_settings').select('data').eq('user_id', uid).maybeSingle(),
        sb.from('entries').select('data').eq('user_id', uid),
      ]);
      if (e1 || e2) throw e1 ?? e2;

      // Configuração: vence a versão mais recente (a da nuvem em caso de empate).
      const remoteS = remoteSettings?.data as BinderSettings | undefined;
      const localS = settingsRef.current;
      if (remoteS && (!localS || (remoteS.updatedAt ?? '') >= (localS.updatedAt ?? ''))) {
        await persistSettings(remoteS);
      } else if (localS) {
        const { error } = await sb.from('binder_settings').upsert({ user_id: uid, data: localS, updated_at: new Date().toISOString() });
        if (error) throw error;
      }

      const merged = { ...entriesRef.current };
      const toPush: Entry[] = [];
      let received = 0;
      const remote = new Map((remoteRows ?? []).map((r) => [(r.data as Entry).id, r.data as Entry]));

      // Cartas removidas sem internet: apaga na nuvem, a menos que tenham sido recolocadas depois em outro aparelho.
      const deleted = { ...deletedRef.current };
      for (const [id, at] of Object.entries(deleted)) {
        const r = remote.get(id);
        if (r && r.updatedAt > at) {
          delete deleted[id];
          continue;
        }
        if (r) {
          const { error } = await sb.from('entries').delete().eq('user_id', uid).eq('id', id);
          if (error) throw error;
          remote.delete(id);
        }
        delete deleted[id];
      }
      await persistDeleted(deleted);
      for (const [id, r] of remote) {
        const local = merged[id];
        if (!local || local.updatedAt < r.updatedAt) {
          merged[id] = r;
          received++;
        }
      }
      for (const local of Object.values(entriesRef.current)) {
        const r = remote.get(local.id);
        if (!r || r.updatedAt < local.updatedAt) toPush.push(local);
      }
      await persistEntries(merged);
      if (toPush.length) {
        const { error } = await sb.from('entries').upsert(toPush.map((e) => toRow(uid, e)));
        if (error) throw error;
      }
      setSyncError(null);
      setLastSyncAt(new Date().toISOString());
      return { sent: toPush.length, received };
    } catch (err) {
      const msg = errorMessage(err);
      setSyncError(msg);
      throw new Error(msg);
    }
  }

  async function persistDeleted(next: Record<string, string>) {
    deletedRef.current = next;
    await AsyncStorage.setItem(DELETED_KEY, JSON.stringify(next)).catch(() => {});
  }

  async function persistSettings(s: BinderSettings) {
    settingsRef.current = s;
    setSettings(s);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  async function persistEntries(next: Record<string, Entry>) {
    setEntries(next);
    entriesRef.current = next;
    const value = JSON.stringify(next);
    try {
      await AsyncStorage.setItem(ENTRIES_KEY, value);
    } catch {
      // Armazenamento cheio: libera o cache do catálogo (pode ser baixado de novo) e grava as cartas.
      await clearCatalogCache();
      await AsyncStorage.setItem(ENTRIES_KEY, value);
    }
  }

  async function remote(op: () => PromiseLike<{ error: unknown }>) {
    if (!supabase || !userId) return;
    try {
      const { error } = await op();
      setSyncError(error ? errorMessage(error) : null);
    } catch (err) {
      setSyncError(errorMessage(err));
    }
  }

  const binders = settings?.extras ?? [];
  // Fichário ativo que foi apagado (ex.: em outro aparelho): volta para o Pokédex.
  const active = activeBinderId === POKEDEX_BINDER || binders.some((b) => b.id === activeBinderId) ? activeBinderId : POKEDEX_BINDER;

  async function saveSettingsNow(input: BinderSettings) {
    const s = { ...input, updatedAt: new Date().toISOString() };
    await persistSettings(s);
    await remote(() => supabase!.from('binder_settings').upsert({ user_id: userId, data: s, updated_at: s.updatedAt }));
  }

  const value: Ctx = {
    ready,
    settings,
    entries,
    session,
    syncError,
    lastSyncAt,
    activeBinderId: active,
    binders,
    async setActiveBinder(id) {
      setActiveBinderId(id);
      await AsyncStorage.setItem(ACTIVE_KEY, id).catch(() => {});
    },
    async saveBinder(b) {
      const base = settingsRef.current ?? DEFAULT_SETTINGS;
      const extras = base.extras ?? [];
      const next = extras.some((x) => x.id === b.id) ? extras.map((x) => (x.id === b.id ? b : x)) : [...extras, b];
      await saveSettingsNow({ ...base, extras: next });
    },
    async deleteBinder(id) {
      const base = settingsRef.current ?? DEFAULT_SETTINGS;
      await saveSettingsNow({ ...base, extras: (base.extras ?? []).filter((x) => x.id !== id) });
      const next = { ...entriesRef.current };
      const now = new Date().toISOString();
      const gone = { ...deletedRef.current };
      for (const e of Object.values(next)) {
        if (e.binderId !== id) continue;
        delete next[e.id];
        gone[e.id] = now;
      }
      await persistEntries(next);
      await persistDeleted(gone);
      await remote(() => supabase!.from('entries').delete().eq('user_id', userId!).like('id', `${id}:%`));
      if (activeBinderId === id) await value.setActiveBinder(POKEDEX_BINDER);
    },
    async saveSettings(s) {
      // Mantém os fichários livres: a tela do Pokédex não mexe neles.
      await saveSettingsNow({ ...s, extras: settingsRef.current?.extras ?? s.extras });
    },
    async saveEntry(input) {
      const e: Entry = { ...input, id: keyOf(input.binderId, input.dex, input.slot), updatedAt: new Date().toISOString() };
      await persistEntries({ ...entriesRef.current, [e.id]: e });
      if (deletedRef.current[e.id]) {
        const { [e.id]: _gone, ...rest } = deletedRef.current;
        await persistDeleted(rest);
      }
      await remote(() => supabase!.from('entries').upsert(toRow(userId!, e)));
      // O preço do MYP Cards é buscado só pelo servidor (função myp-sync) e chega aqui na próxima sincronização.
    },
    async syncNow() {
      if (!userId) throw new Error('Entre na sua conta primeiro.');
      return syncAll(userId);
    },
    async moveEntry(id, toSlot) {
      const e = entriesRef.current[id];
      if (!e?.binderId || e.slot === toSlot) return;
      const targetId = customEntryId(e.binderId, toSlot);
      const other = entriesRef.current[targetId];
      const now = new Date().toISOString();
      const moved: Entry = { ...e, id: targetId, slot: toSlot, updatedAt: now };
      const swapped: Entry | undefined = other ? { ...other, id: e.id, slot: e.slot, updatedAt: now } : undefined;
      const next = { ...entriesRef.current, [targetId]: moved };
      if (swapped) next[e.id] = swapped;
      else delete next[e.id];
      await persistEntries(next);
      const rows = swapped ? [moved, swapped] : [moved];
      await remote(() => supabase!.from('entries').upsert(rows.map((r) => toRow(userId!, r))));
      if (!swapped) {
        await persistDeleted({ ...deletedRef.current, [e.id]: now });
        await remote(() => supabase!.from('entries').delete().eq('user_id', userId!).eq('id', e.id));
      }
    },
    async removeEntry(id) {
      const next = { ...entriesRef.current };
      delete next[id];
      await persistEntries(next);
      // Lembra a remoção até a nuvem confirmar (sem internet, a carta voltaria na próxima sincronização).
      await persistDeleted({ ...deletedRef.current, [id]: new Date().toISOString() });
      await remote(() => supabase!.from('entries').delete().eq('user_id', userId!).eq('id', id));
    },
  };

  return <CollectionContext value={value}>{children}</CollectionContext>;
}

function toRow(userId: string, e: Entry) {
  return { user_id: userId, id: e.id, dex: e.dex, slot: e.slot, data: e, updated_at: e.updatedAt };
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}
