// Ambiente dos testes: sem nuvem (supabase null, como o app sem .env) e com o armazenamento do aparelho em memória.
// Nenhum teste acessa a rede.

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/lib/supabase', () => ({
  supabase: null,
  PAGE_SIZE: 1000,
  fetchAllPages: async () => [],
  errorText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  isNetworkError: () => false,
  isMissingInServer: () => false,
  describeSyncError: () => ({ kind: 'error', message: '' }),
}));
