import {
  authErrorText,
  hasAuthFragment,
  isResetLink,
  isSignupDisabled,
  linkSessionCheck,
  MIN_PASSWORD,
  newPasswordProblem,
  readAuthLink,
  RESET_PATH,
  SIGNUP_CLOSED_TEXT,
  tokenClaims,
  withoutFragment,
} from '@/lib/auth-links';

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Texto → base64url (UTF-8), como no JWT. */
function base64Url(text: string) {
  let out = '';
  let value = 0;
  let bits = 0;
  for (const b of new TextEncoder().encode(text)) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64URL[(value >> bits) & 63];
    }
    value &= (1 << bits) - 1;
  }
  return bits > 0 ? out + B64URL[(value << (6 - bits)) & 63] : out;
}

/** JWT de mentira (sem assinatura válida), só para ler os campos. */
function fakeJwt(payload: Record<string, unknown>) {
  const part = (o: unknown) => base64Url(JSON.stringify(o));
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.assinatura`;
}

// Formato do link que o Supabase devolve no fluxo implícito (o padrão do supabase-js), com tokens de mentira.
const TOKENS = 'access_token=aaa.bbb.ccc&expires_at=1761300000&expires_in=3600&refresh_token=rrr&token_type=bearer&type=recovery';

describe('link de e-mail do Supabase', () => {
  it('lê a sessão depois do #, na web e no APK', () => {
    const session = { kind: 'session', accessToken: 'aaa.bbb.ccc', refreshToken: 'rrr', type: 'recovery' };
    expect(readAuthLink(`https://fichario.expo.app/nova-senha#${TOKENS}`)).toEqual(session);
    expect(readAuthLink(`pokedexbinder://nova-senha#${TOKENS}`)).toEqual(session);
    expect(readAuthLink(`exp://192.168.0.10:8081/--/nova-senha#${TOKENS}`)).toEqual(session);
  });

  it('erro do link (vencido ou já usado), depois do # ou do ?', () => {
    const hash = 'https://fichario.expo.app/nova-senha#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    expect(readAuthLink(hash)).toEqual({ kind: 'error', code: 'otp_expired', message: 'Email link is invalid or has expired' });
    expect(readAuthLink('pokedexbinder://nova-senha?error=access_denied&error_description=Expired')).toEqual({ kind: 'error', code: 'access_denied', message: 'Expired' });
  });

  it('código do fluxo PKCE no ?', () => {
    expect(readAuthLink('https://fichario.expo.app/nova-senha?code=34e770dd-9ff9')).toEqual({ kind: 'code', code: '34e770dd-9ff9' });
  });

  it('endereço comum não é link de e-mail', () => {
    expect(readAuthLink(null)).toBeNull();
    expect(readAuthLink('')).toBeNull();
    expect(readAuthLink('https://fichario.expo.app/nova-senha')).toBeNull();
    expect(readAuthLink('pokedexbinder://card?id=sv1-1#top')).toBeNull();
    // Sem o refresh_token não há como manter a sessão.
    expect(readAuthLink('https://fichario.expo.app/nova-senha#access_token=aaa')).toBeNull();
  });

  it('tira os tokens da barra de endereço só quando eles estão lá', () => {
    expect(hasAuthFragment(`https://fichario.expo.app/nova-senha#${TOKENS}`)).toBe(true);
    expect(hasAuthFragment('https://fichario.expo.app/account#error_code=otp_expired')).toBe(true);
    expect(hasAuthFragment('https://fichario.expo.app/card?id=1#top')).toBe(false);
    expect(hasAuthFragment('https://fichario.expo.app/')).toBe(false);
    expect(withoutFragment(`https://fichario.expo.app/nova-senha?x=1#${TOKENS}`)).toBe('https://fichario.expo.app/nova-senha?x=1');
    expect(withoutFragment('https://fichario.expo.app/')).toBe('https://fichario.expo.app/');
  });

  it('só o link da tela de nova senha troca senha', () => {
    expect(RESET_PATH).toBe('nova-senha');
    expect(isResetLink(`https://fichario.expo.app/nova-senha#${TOKENS}`)).toBe(true);
    expect(isResetLink('http://localhost:8081/nova-senha/')).toBe(true);
    expect(isResetLink(`pokedexbinder://nova-senha#${TOKENS}`)).toBe(true);
    expect(isResetLink('pokedexbinder:///nova-senha')).toBe(true);
    expect(isResetLink('exp://192.168.0.10:8081/--/nova-senha?error=access_denied')).toBe(true);
    expect(isResetLink(`https://fichario.expo.app/account#${TOKENS}`)).toBe(false);
    expect(isResetLink('https://fichario.expo.app/minha-nova-senha')).toBe(false);
    expect(isResetLink(null)).toBe(false);
  });
});

describe('link com a conta já aberta no aparelho', () => {
  const now = Date.UTC(2026, 9, 24, 12);
  const exp = (minutes: number) => Math.floor(now / 1000) + minutes * 60;
  const linkToken = fakeJwt({ sub: 'u1', session_id: 's-link', exp: exp(50), email: 'joão@exemplo.com' });

  it('lê conta, sessão e validade do token (com acento no e-mail)', () => {
    expect(tokenClaims(linkToken)).toEqual({ sub: 'u1', sessionId: 's-link', exp: exp(50) });
    expect(tokenClaims('não.é-um.jwt')).toBeNull();
    expect(tokenClaims('aaa')).toBeNull();
    expect(tokenClaims(null)).toBeNull();
  });

  it('sem conta aberta, usa o link', () => {
    expect(linkSessionCheck(linkToken, null, now)).toBe('apply');
  });

  it('o mesmo link de novo (Android reabrindo pela lista de recentes) não é lido outra vez', () => {
    const current = { accessToken: fakeJwt({ sub: 'u1', session_id: 's-link', exp: exp(60) }), userId: 'u1' };
    expect(linkSessionCheck(linkToken, current, now)).toBe('same');
  });

  it('link vencido, de outra conta ou ilegível não troca a sessão aberta', () => {
    const current = { accessToken: fakeJwt({ sub: 'u1', session_id: 's-atual', exp: exp(60) }), userId: 'u1' };
    expect(linkSessionCheck(fakeJwt({ sub: 'u1', session_id: 's-velho', exp: exp(-5) }), current, now)).toBe('stale');
    expect(linkSessionCheck(fakeJwt({ sub: 'u2', session_id: 's-outro', exp: exp(50) }), current, now)).toBe('other');
    expect(linkSessionCheck('lixo', current, now)).toBe('stale');
    // Link novo da mesma conta (pedido em outro aparelho): entra com ele.
    expect(linkSessionCheck(linkToken, current, now)).toBe('apply');
  });
});

describe('senha nova', () => {
  it(`pede pelo menos ${MIN_PASSWORD} caracteres e as duas iguais`, () => {
    expect(MIN_PASSWORD).toBe(8);
    expect(newPasswordProblem('1234567', '1234567')).toContain('pelo menos 8 caracteres');
    expect(newPasswordProblem('12345678', '12345679')).toContain('não são iguais');
    expect(newPasswordProblem('12345678', '12345678')).toBeNull();
  });
});

describe('erros do login em português', () => {
  it('cadastro fechado no Supabase ("Allow new users to sign up" desligado)', () => {
    const err = { code: 'signup_disabled', message: 'Signups not allowed for this instance', status: 422 };
    expect(isSignupDisabled(err)).toBe(true);
    expect(authErrorText(err)).toBe(SIGNUP_CLOSED_TEXT);
    expect(SIGNUP_CLOSED_TEXT).toBe('Cadastro fechado: este app é de uso pessoal. Entre com a conta existente.');
    // Sem o código, pelo texto do servidor.
    expect(isSignupDisabled(new Error('Sign ups (new account creation) are disabled on the server.'))).toBe(true);
    expect(isSignupDisabled({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(false);
  });

  it('login, senha e link', () => {
    expect(authErrorText({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('E-mail ou senha incorretos.');
    expect(authErrorText({ code: 'weak_password', message: 'Password should be at least 8 characters.' })).toContain('pelo menos 8 caracteres');
    expect(authErrorText({ code: 'same_password', message: 'New password should be different from the old password.' })).toContain('diferente da atual');
    expect(authErrorText({ code: 'otp_expired', message: 'Email link is invalid or has expired' })).toContain('O link expirou');
    expect(authErrorText({ code: '403', message: 'Email link is invalid or has expired' })).toContain('O link expirou');
    expect(authErrorText(new Error('Auth session missing!'))).toContain('Peça outro');
    expect(authErrorText({ code: 'refresh_token_already_used', message: 'Invalid Refresh Token: Already Used' })).toContain('Peça outro');
    expect(authErrorText({ code: 'validation_failed', message: 'Unable to validate email address: invalid format' })).toBe('Digite um e-mail válido.');
  });

  it('e-mail do Supabase (SMTP padrão: poucos por hora, só para a equipe do projeto)', () => {
    expect(authErrorText({ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })).toContain('máximo de e-mails');
    expect(authErrorText({ code: 'email_address_not_authorized', message: 'Email address not authorized' })).toContain('não envia para esse endereço');
    expect(authErrorText({ code: 'over_request_rate_limit', message: 'Request rate limit reached' })).toContain('Muitas tentativas');
  });

  it('sem internet e erro desconhecido', () => {
    expect(authErrorText(new TypeError('Network request failed'))).toBe('Sem conexão com a internet.');
    expect(authErrorText('algo estranho')).toBe('Não consegui concluir agora (algo estranho). Tente de novo em instantes.');
    expect(authErrorText(null)).toContain('erro desconhecido');
  });
});
