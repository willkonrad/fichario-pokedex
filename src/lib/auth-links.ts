// Conta fechada (uso pessoal) e links dos e-mails do Supabase (nova senha, confirmação do cadastro). Só lógica pura:
// as telas account.tsx e nova-senha.tsx chamam o Supabase; aqui ficam a leitura do link e os textos em português.
// Docs: https://supabase.com/docs/guides/auth/passwords#resetting-a-password e
// https://supabase.com/docs/guides/auth/native-mobile-deep-linking

/** Tamanho mínimo de uma senha nova (o mesmo do Supabase, em Authentication > Providers > Email). */
export const MIN_PASSWORD = 8;

/**
 * Para onde volta o link de nova senha. Sem barra no começo, como na doc do expo-linking: `Linking.createURL` dá
 * `pokedexbinder://nova-senha` no APK e `https://<site>/nova-senha` na web (com a barra, o APK ganharia `:///`).
 */
export const RESET_PATH = 'nova-senha';

/** Para onde volta o link de confirmação do cadastro: a tela de conta, para entrar. */
export const SIGNUP_CONFIRM_PATH = 'account';

/** O que um link de e-mail do Supabase traz ao voltar para o app. */
export type AuthLink =
  /** Fluxo implícito (o padrão do supabase-js, o deste app): a sessão vem depois do #. */
  | { kind: 'session'; accessToken: string; refreshToken: string; type: string | null }
  /** Fluxo PKCE (`flowType: 'pkce'`): um código para trocar pela sessão, só no aparelho que pediu o link. */
  | { kind: 'code'; code: string }
  /** Link vencido, já usado ou recusado: o Supabase devolve o erro no endereço. */
  | { kind: 'error'; code: string; message: string };

function decode(s: string) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** "a=1&b=2" → { a: '1', b: '2' }. À mão: o URL do celular (esquema próprio) e o do Node não leem igual. */
function parseParams(part: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of part.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decode(eq < 0 ? pair : pair.slice(0, eq));
    if (key) out[key] = decode(eq < 0 ? '' : pair.slice(eq + 1));
  }
  return out;
}

/** Parâmetros depois do # e depois do ? (os do ? valem mais, como no supabase-js). */
function linkParams(url: string) {
  const hashAt = url.indexOf('#');
  const fragment = hashAt < 0 ? '' : url.slice(hashAt + 1);
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt < 0 ? '' : beforeHash.slice(queryAt + 1);
  return { fragment: parseParams(fragment), all: { ...parseParams(fragment), ...parseParams(query) } };
}

/** Lê o link que abriu o app (ou a página). null quando ele não veio de um e-mail do Supabase. */
export function readAuthLink(url: string | null | undefined): AuthLink | null {
  if (!url) return null;
  const p = linkParams(url).all;
  if (p.error || p.error_code || p.error_description) {
    return { kind: 'error', code: p.error_code || p.error || '', message: p.error_description || p.error || '' };
  }
  if (p.access_token && p.refresh_token) {
    return { kind: 'session', accessToken: p.access_token, refreshToken: p.refresh_token, type: p.type || null };
  }
  if (p.code) return { kind: 'code', code: p.code };
  return null;
}

/**
 * O link aponta para a tela de nova senha (https://<site>/nova-senha, pokedexbinder://nova-senha,
 * exp://…/--/nova-senha). Um link de outra tela (a confirmação do cadastro volta para /account) não troca senha.
 */
export function isResetLink(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = withoutFragment(url).split('?')[0];
  return new RegExp(`(^|/)${RESET_PATH}/?$`).test(path);
}

/** O endereço tem tokens ou erro do Supabase depois do # (para tirar da barra de endereço na web). */
export function hasAuthFragment(url: string): boolean {
  const f = linkParams(url).fragment;
  return !!(f.access_token || f.refresh_token || f.error_code || f.error_description);
}

/** O endereço sem o que vem depois do #. */
export function withoutFragment(url: string): string {
  const hashAt = url.indexOf('#');
  return hashAt < 0 ? url : url.slice(0, hashAt);
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url (o do JWT) → texto UTF-8. À mão: o `atob` não existe em todo lugar onde o app roda. */
function base64UrlText(s: string): string {
  const bytes: string[] = [];
  let value = 0;
  let bits = 0;
  for (const ch of s.replace(/=+$/, '')) {
    const i = BASE64URL.indexOf(ch === '+' ? '-' : ch === '/' ? '_' : ch);
    if (i < 0) throw new Error('base64 inválido');
    value = (value << 6) | i;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push('%' + ((value >> bits) & 0xff).toString(16).padStart(2, '0'));
      value &= (1 << bits) - 1;
    }
  }
  return decodeURIComponent(bytes.join(''));
}

/** O que a tela usa do token de acesso (JWT) do Supabase: conta, sessão e validade. null quando não dá para ler. */
export function tokenClaims(token: string | null | undefined): { sub: string | null; sessionId: string | null; exp: number | null } | null {
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const p = JSON.parse(base64UrlText(part)) as { sub?: unknown; session_id?: unknown; exp?: unknown };
    return {
      sub: typeof p.sub === 'string' ? p.sub : null,
      sessionId: typeof p.session_id === 'string' ? p.session_id : null,
      exp: typeof p.exp === 'number' ? p.exp : null,
    };
  } catch {
    return null;
  }
}

/**
 * Com uma conta já aberta no aparelho, o que fazer com a sessão de um link de e-mail:
 * - `same`: é a sessão que já está em uso (o link já foi lido aqui). O Android reabre o app pela lista de recentes com
 *   o mesmo link de antes; ler de novo gravaria um refresh_token já gasto, e o Supabase derruba a sessão inteira.
 * - `stale`: o token do link já venceu (link velho). O setSession tentaria renová-lo e, com o token gasto, tiraria a
 *   conta do aparelho.
 * - `other`: o link é de outra conta: não troca a conta aberta por baixo do usuário.
 * - `apply`: link novo desta conta (ou nenhuma conta aberta): entra com ele.
 */
export function linkSessionCheck(
  linkAccessToken: string,
  current: { accessToken: string; userId: string } | null,
  now = Date.now(),
): 'apply' | 'same' | 'stale' | 'other' {
  if (!current) return 'apply';
  const link = tokenClaims(linkAccessToken);
  if (!link) return 'stale';
  const mine = tokenClaims(current.accessToken);
  if (link.sessionId && mine?.sessionId === link.sessionId) return 'same';
  if (link.sub && link.sub !== current.userId) return 'other';
  if (link.exp == null || link.exp * 1000 <= now) return 'stale';
  return 'apply';
}

/** O que falta na senha nova (null quando ela pode ser salva). */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (password !== confirm) return 'As duas senhas não são iguais. Digite a mesma nas duas caixas.';
  return null;
}

function authErrorParts(err: unknown): { code: string; message: string } {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown };
    return { code: e.code == null ? '' : String(e.code), message: e.message == null ? '' : String(e.message) };
  }
  return { code: '', message: err == null ? '' : String(err) };
}

/** O servidor recusou o cadastro porque "Allow new users to sign up" está desligado no Supabase. */
export function isSignupDisabled(err: unknown): boolean {
  const { code, message } = authErrorParts(err);
  return code === 'signup_disabled' || /signups? not allowed|sign ?ups?\b.*\bdisabled/i.test(message);
}

export const SIGNUP_CLOSED_TEXT = 'Cadastro fechado: este app é de uso pessoal. Entre com a conta existente.';
export const LINK_EXPIRED_TEXT = 'O link expirou ou já foi usado. Peça outro em "Esqueci minha senha".';

/**
 * Erro do login, do cadastro ou da senha nova explicado em português. Vale o código do Supabase (`error.code`, ver
 * https://supabase.com/docs/guides/auth/debugging/error-codes) e, sem ele, o texto em inglês.
 */
export function authErrorText(err: unknown): string {
  const { code, message: msg } = authErrorParts(err);
  if (isSignupDisabled(err)) return SIGNUP_CLOSED_TEXT;
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered|already exists/i.test(msg)) {
    return 'Já existe uma conta com esse e-mail. Use "Entrar".';
  }
  if (code === 'same_password' || /different from the old password/i.test(msg)) return 'A senha nova precisa ser diferente da atual.';
  if (code === 'weak_password' || (/password/i.test(msg) && /(weak|short|least|characters)/i.test(msg))) {
    return `Senha fraca: use pelo menos ${MIN_PASSWORD} caracteres, com letras e números.`;
  }
  if (code === 'otp_expired' || code === 'flow_state_expired' || code === 'flow_state_not_found' || /link is invalid|has expired|code verifier/i.test(msg)) {
    return LINK_EXPIRED_TEXT;
  }
  if (
    code === 'session_not_found' ||
    code === 'session_expired' ||
    code === 'refresh_token_not_found' ||
    code === 'refresh_token_already_used' ||
    code === 'bad_jwt' ||
    /auth session missing|refresh token/i.test(msg)
  ) {
    return 'A sessão do link terminou. Peça outro em "Esqueci minha senha".';
  }
  if (code === 'reauthentication_needed') return 'Por segurança, saia e entre de novo na conta antes de trocar a senha.';
  if (code === 'email_address_not_authorized' || /email address not authorized/i.test(msg)) {
    return 'O e-mail do Supabase não envia para esse endereço. Confira o e-mail digitado: o envio padrão só vai para quem é da equipe do projeto.';
  }
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(msg)) {
    return 'O servidor já mandou o máximo de e-mails desta hora. Use o link que já chegou ou tente de novo mais tarde.';
  }
  if (code === 'over_request_rate_limit' || /rate limit|too many/i.test(msg)) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
  // "Unable to validate email address: invalid format" (validation_failed) e domínio de teste recusado.
  if (code === 'email_address_invalid' || /email address.*invalid/i.test(msg)) return 'Digite um e-mail válido.';
  if (/network|fetch|timed? ?out|aborted/i.test(msg)) return 'Sem conexão com a internet.';
  if (code === 'access_denied') return LINK_EXPIRED_TEXT;
  return `Não consegui concluir agora (${msg || code || 'erro desconhecido'}). Tente de novo em instantes.`;
}
