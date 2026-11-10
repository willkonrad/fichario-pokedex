// Erros da nuvem: o tempo limite do Postgres não é falta de internet. tests/setup.ts troca o módulo por um de mentira;
// aqui vale o de verdade.
const { describeSyncError, isNetworkError } = jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase');

const statementTimeout = { code: '57014', details: null, hint: null, message: 'canceling statement due to statement timeout' };

describe('tempo limite do Postgres (57014)', () => {
  it('não é falta de internet, mesmo com "timeout" no texto', () => {
    expect(isNetworkError(statementTimeout)).toBe(false);
  });

  it('também sem o código, só pelo texto do banco', () => {
    expect(isNetworkError(new Error('canceling statement due to statement timeout'))).toBe(false);
  });

  it('o código sozinho basta', () => {
    expect(isNetworkError({ code: '57014', message: 'timeout' })).toBe(false);
  });

  it('a sincronização explica em português, sem o texto cru do banco e sem dizer que está sem conexão', () => {
    const d = describeSyncError(statementTimeout);
    expect(d.kind).toBe('error');
    expect(d.message).not.toMatch(/canceling|statement|sem conexão/i);
  });
});

describe('falta de internet de verdade continua sendo', () => {
  it.each([
    'Network request failed',
    'Failed to fetch',
    'TypeError: fetch failed',
    'The operation was aborted',
    'request timed out',
    'connect ETIMEDOUT',
    'gateway timeout',
  ])('%s', (message) => {
    expect(isNetworkError(new Error(message))).toBe(true);
    expect(describeSyncError(new Error(message)).kind).toBe('offline');
  });
});

describe('outros erros do banco não mudam', () => {
  it('permissão negada não é falta de internet', () => {
    const err = { code: '42501', message: 'permission denied for table entries' };
    expect(isNetworkError(err)).toBe(false);
    expect(describeSyncError(err)).toEqual({ kind: 'error', message: 'A nuvem recusou a gravação. Saia e entre na conta de novo.' });
  });
});
