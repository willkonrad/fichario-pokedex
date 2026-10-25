import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { hasAuthFragment, withoutFragment } from './auth-links';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Tempo máximo de cada chamada à nuvem. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * fetch com tempo máximo. O do React Native (OkHttp no Android) não tem limite: uma conexão que morre em silêncio (troca
 * de Wi-Fi para 4G) prenderia a sincronização até fechar o app. Passado o tempo, a chamada falha como erro de rede
 * ("aborted") e a nova tentativa da sincronização cuida do resto. Respeita o cancelamento de quem chamou.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort());
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

/**
 * Na web, tira da barra de endereço (e do histórico) os tokens de um link de e-mail do Supabase
 * (`#access_token=…&type=recovery`), deixando o caminho e o `?`. Não mexe em nenhum outro endereço.
 */
export function stripAuthFromAddressBar() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const href = window.location.href;
  if (!hasAuthFragment(href)) return;
  try {
    window.history.replaceState(window.history.state, '', withoutFragment(href));
  } catch {}
}

/**
 * Na web, o endereço com que a página abriu, quando veio de um link de e-mail do Supabase (nova senha, confirmação
 * do cadastro). Guardado quando o app carrega; só a tela /nova-senha usa o que ficou guardado. null no celular, onde o
 * link chega pelo expo-linking. Os tokens saem da barra já aqui, mas o roteador pode ter lido o endereço antes e
 * guardar o # como parâmetro '#' da tela (e escrevê-lo de volta): a tela /nova-senha limpa os dois depois.
 */
const webAuthLink: string | null =
  Platform.OS === 'web' && typeof window !== 'undefined' && hasAuthFragment(window.location.href) ? window.location.href : null;
stripAuthFromAddressBar();

export function initialWebAuthLink() {
  return webAuthLink;
}

/**
 * null quando o .env não está configurado — o app funciona só local. `detectSessionInUrl: false` (de propósito): nenhum
 * endereço entra sozinho na conta; o link de nova senha é lido só pela tela /nova-senha. O fluxo é o implícito, o
 * padrão do supabase-js: a sessão volta depois do # e o link vale mesmo aberto fora do aparelho que pediu (no PKCE,
 * só no mesmo).
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
        global: { fetch: fetchWithTimeout },
      })
    : null;

// No celular, os timers param em segundo plano: renova a sessão só com o app aberto (como pede o Supabase para React
// Native). Sem isso, a primeira sincronização ao voltar para o app pode falhar com a sessão vencida.
if (supabase && Platform.OS !== 'web') {
  const sb = supabase;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') sb.auth.startAutoRefresh();
    else sb.auth.stopAutoRefresh();
  });
}

/** Linhas por página: a API do Supabase devolve no máximo 1000 de cada vez. */
export const PAGE_SIZE = 1000;

/**
 * Lê todas as páginas de uma consulta. `page(from, to)` monta a consulta com uma ordem estável (ex.: `.order('id')`) e
 * `.range(from, to)`. Qualquer página com erro faz tudo falhar (nada de lista cortada pela metade).
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

/** Texto cru do erro (Error, erro do Supabase ou qualquer outra coisa). */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) return String((err as { code: unknown }).code ?? '') || undefined;
  return undefined;
}

/** Sem internet ou servidor inalcançável. */
export function isNetworkError(err: unknown): boolean {
  return /failed to fetch|network ?request failed|networkerror|load failed|fetch failed|network error|timed? ?out|timeout|aborted|ECONN|ENOTFOUND|EAI_AGAIN/i.test(
    errorText(err),
  );
}

/** A tabela ou a função não existe no banco (migração ainda não aplicada). */
export function isMissingInServer(err: unknown): boolean {
  const code = errorCode(err);
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || code === '42883') return true;
  return /could not find the (function|table)|does not exist/i.test(errorText(err));
}

/**
 * Erro da nuvem explicado em português, para mostrar na tela: `offline` quando é falta de conexão (as alterações
 * ficam no aparelho e vão depois), `error` nos outros casos.
 */
export function describeSyncError(err: unknown): { kind: 'offline' | 'error'; message: string } {
  const raw = errorText(err);
  const code = errorCode(err);
  if (isNetworkError(err)) {
    return { kind: 'offline', message: 'Sem conexão com a nuvem. As alterações ficam salvas neste aparelho e vão quando a internet voltar.' };
  }
  if (code === 'PGRST301' || code === 'PGRST303' || /jwt|token (is )?expired|invalid claim|refresh token|not authenticated|auth session missing/i.test(raw)) {
    return { kind: 'error', message: 'Sua sessão expirou. Saia e entre na conta de novo para sincronizar.' };
  }
  if (code === '42501' || /row-level security|permission denied/i.test(raw)) {
    return { kind: 'error', message: 'A nuvem recusou a gravação. Saia e entre na conta de novo.' };
  }
  if (isMissingInServer(err)) {
    return { kind: 'error', message: 'O banco da nuvem ainda não tem a atualização desta versão do app.' };
  }
  if (/\b(500|502|503|504)\b|service unavailable|bad gateway|internal server error/i.test(raw)) {
    return { kind: 'error', message: 'A nuvem está fora do ar agora. Tento de novo em alguns minutos.' };
  }
  return { kind: 'error', message: `Não consegui sincronizar com a nuvem (${raw}). Tento de novo em alguns minutos.` };
}
