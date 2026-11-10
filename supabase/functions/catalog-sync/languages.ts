// Etapa 7 do catalog-sync: copia da TCGdex para tcgdex_lang o que ela tem em português, coreano, chinês (tradicional e
// simplificado) e japonês, e a lista de coleções do TCG Pocket, que o lookup_build() do banco usa para montar o índice
// da Consulta. Um idioma por execução, o mais antigo, e só depois de 7 dias. Só grava com tudo do idioma lido: num erro
// ou 503, fica o que já existe e tenta na próxima. Sem importar nada: index.ts roda no Deno, este arquivo também nos
// testes.

const TCGDEX = 'https://api.tcgdex.net/v2';
const USER_AGENT = 'FicharioPokedex/1.0 (https://github.com/willkonrad/fichario-pokedex)';
const PAUSE_MS = 150;

/** O Pocket vem primeiro: as outras listas precisam saber quais coleções excluir. */
export const LANGS = ['tcgp', 'pt', 'ko', 'zh-tw', 'zh-cn', 'ja'] as const;
export type Lang = (typeof LANGS)[number];

const REFRESH_AFTER_MS = 7 * 86_400_000;
/** Depois de uma falha, o idioma espera isto e a vez passa ao próximo: um idioma quebrado não trava os outros. */
const FAILED_WAIT_MS = 6 * 3_600_000;
/** 403 ou 429: é um "não" da fonte. A etapa inteira para por este tempo, e o aviso fica em report.errors. */
const REFUSED_WAIT_MS = 24 * 3_600_000;
/** Marca em qvmc_cache (a tabela de marcadores do servidor) com as falhas por idioma: sobrevive de uma execução para outra. */
export const FAILURES_KEY = 'tcgdex-lang:falhas';
/** Depois de reler zh-tw ou zh-cn, as datas das coleções ainda sem data são buscadas nas execuções das 12 h seguintes. */
const DATES_WINDOW_MS = 12 * 3_600_000;
const DATES_PER_RUN = 40;
/** A única coleção do zh-cn com texto simplificado de verdade; as outras repetem cartas do zh-tw. */
const ZH_CN_OWN_SET = 'CSMPiC';

type ListCard = { id: string; localId: string; name: string; image?: string };
type ListSet = { id: string; name: string; cardCount?: { total?: number; official?: number } };

/** Carta guardada: `image` sem o domínio (pt/sv/sv03/060). */
export type StoredCard = { id: string; localId: string; name: string; image?: string };
/** `date` ausente: ainda não perguntada. `date: null`: a TCGdex não tem. */
export type StoredSet = { name: string; official: number | null; total: number | null; date?: string | null };
export type LangData = { cards: StoredCard[]; hp: Record<string, number>; sets: Record<string, StoredSet> };
export type LangStamp = { lang: string; fetched_at: string };
export type LangReport = { lang: Lang; cards?: number; sets?: number; hp?: number; dates?: number; outOfTime?: true };
/** Quando cada idioma falhou pela última vez e quando a fonte recusou (403 ou 429). */
export type LangFailures = { failed?: Record<string, string>; refusedAt?: string };

type Result<T> = { data: T | null; error: unknown };
/** O pedaço do cliente do Supabase que esta etapa usa. */
export type LangDb = {
  from(table: 'tcgdex_lang'): {
    select(columns: 'lang, fetched_at'): PromiseLike<Result<LangStamp[]>>;
    select(columns: 'sets'): { eq(column: 'lang', value: string): { maybeSingle(): PromiseLike<Result<{ sets: Record<string, StoredSet> }>> } };
    upsert(row: LangData & { lang: Lang; fetched_at: string }): PromiseLike<Result<unknown>>;
    update(row: { sets: Record<string, StoredSet> }): { eq(column: 'lang', value: string): PromiseLike<Result<unknown>> };
  };
  from(table: 'qvmc_cache'): {
    select(columns: 'data'): { eq(column: 'key', value: string): { maybeSingle(): PromiseLike<Result<{ data: LangFailures }>> } };
    upsert(row: { key: string; data: LangFailures; fetched_at: string }): PromiseLike<Result<unknown>>;
  };
};

class OutOfTime extends Error {}
/** A TCGdex respondeu 403 ou 429. */
export class TcgdexRefused extends Error {}

export type LangDeps = { fetchJson: <T>(path: string) => Promise<T>; pause: (ms: number) => Promise<void> };

const liveDeps: LangDeps = {
  fetchJson: async <T,>(path: string) => {
    const res = await fetch(`${TCGDEX}${path}`, { headers: { 'User-Agent': USER_AGENT } });
    if (res.status === 403 || res.status === 429) throw new TcgdexRefused(`${path} ${res.status}`);
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return (await res.json()) as T;
  },
  pause: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Lê um caminho da TCGdex com a pausa de sempre, parando se o tempo da execução acabou. */
function reader(deps: LangDeps, deadline: number) {
  return async <T,>(path: string): Promise<T> => {
    if (Date.now() >= deadline) throw new OutOfTime();
    const data = await deps.fetchJson<T>(path);
    await deps.pause(PAUSE_MS);
    return data;
  };
}
type Reader = ReturnType<typeof reader>;

/**
 * Idioma desta execução: o que nunca foi lido ou o de fetched_at mais antigo, se tiver mais de 7 dias; null se todos estão
 * em dia. No empate, a ordem de LANGS. Quem falhou há menos de 6 h espera: a vez é do próximo.
 */
export function chooseLanguage(rows: LangStamp[], now: number, failures: LangFailures = {}): Lang | null {
  const at = new Map(rows.map((r) => [r.lang, new Date(r.fetched_at).getTime()]));
  let best: Lang | null = null;
  let bestAt = Infinity;
  for (const lang of LANGS) {
    const failedAt = failures.failed?.[lang];
    if (failedAt && now - new Date(failedAt).getTime() < FAILED_WAIT_MS) continue;
    const fetched = at.get(lang) ?? 0;
    if (now - fetched > REFRESH_AFTER_MS && fetched < bestAt) {
      best = lang;
      bestAt = fetched;
    }
  }
  return best;
}

const storedSet = (s: ListSet): StoredSet => ({
  name: s.name,
  official: s.cardCount?.official ?? null,
  total: s.cardCount?.total ?? null,
});

/** Tira o domínio da imagem: "https://assets.tcgdex.net/pt/sv/sv03/060" → "pt/sv/sv03/060". */
export function imagePath(image: string | undefined): string | undefined {
  return image?.replace(/^https?:\/\/assets\.tcgdex\.net\//, '') || undefined;
}

const storedCard = ({ id, localId, name, image }: ListCard): StoredCard => {
  const path = imagePath(image);
  return path ? { id, localId, name, image: path } : { id, localId, name };
};

function mustBeList<T>(list: T[] | null | undefined, what: string): T[] {
  if (!Array.isArray(list) || !list.length) throw new Error(`${what}: lista vazia`);
  return list;
}

const setsById = (list: ListSet[]) => Object.fromEntries(list.map((s) => [s.id, storedSet(s)]));

/** Tudo de um idioma, ou uma exceção: nunca devolve meia lista. */
export async function readLanguage(lang: Lang, read: <T>(path: string) => Promise<T>): Promise<LangData> {
  if (lang === 'tcgp') {
    const serie = await read<{ sets?: ListSet[] }>('/en/series/tcgp');
    return { cards: [], hp: {}, sets: setsById(mustBeList(serie?.sets, 'tcgp')) };
  }
  const cards = mustBeList(await read<ListCard[]>(`/${lang}/cards`), `${lang}/cards`);
  const sets = mustBeList(await read<ListSet[]>(`/${lang}/sets`), `${lang}/sets`);
  const hp: Record<string, number> = {};
  if (lang === 'zh-tw') {
    for (let value = 10; value <= 400; value += 10) {
      const list = await read<{ id: string }[]>(`/zh-tw/cards?hp=eq:${value}`);
      if (!Array.isArray(list)) throw new Error(`zh-tw hp ${value}: resposta inválida`);
      for (const c of list) hp[c.id] = value;
    }
  }
  const kept = lang === 'zh-cn' ? cards.filter((c) => c.id.startsWith(`${ZH_CN_OWN_SET}-`)) : cards;
  return { cards: kept.map(storedCard), hp, sets: setsById(sets) };
}

/** As datas já conhecidas continuam ao reler a lista (que não traz data). */
export function withKnownDates(fresh: Record<string, StoredSet>, previous: Record<string, StoredSet> | null | undefined) {
  const out: Record<string, StoredSet> = {};
  for (const [id, set] of Object.entries(fresh)) {
    const known = previous?.[id];
    out[id] = known && 'date' in known ? { ...set, date: known.date } : set;
  }
  return out;
}

/** Coleções que ainda não tiveram a data perguntada, no máximo 40. */
export function undatedSets(sets: Record<string, StoredSet>): string[] {
  return Object.keys(sets)
    .filter((id) => !('date' in sets[id]))
    .slice(0, DATES_PER_RUN);
}

/** zh-tw e zh-cn lidos há menos de 12 h: nessas pode faltar data (fora dessa janela, nem lê a coluna `sets`). */
export function languagesWithPendingDates(rows: LangStamp[], now: number): Lang[] {
  const at = new Map(rows.map((r) => [r.lang, new Date(r.fetched_at).getTime()]));
  return (['zh-tw', 'zh-cn'] as const).filter((lang) => {
    const fetched = at.get(lang);
    return fetched !== undefined && now - fetched < DATES_WINDOW_MS;
  });
}

/** A fonte recusou há menos de 24 h: a etapa inteira espera. */
export function isRefused(failures: LangFailures, now: number) {
  return !!failures.refusedAt && now - new Date(failures.refusedAt).getTime() < REFUSED_WAIT_MS;
}

/** Sem a marca (ou sem conseguir ler), nenhuma falha conhecida: a etapa segue. */
async function loadFailures(admin: LangDb): Promise<LangFailures> {
  const { data, error } = await admin.from('qvmc_cache').select('data').eq('key', FAILURES_KEY).maybeSingle();
  return error ? {} : (data?.data ?? {});
}

async function saveFailures(admin: LangDb, failures: LangFailures, fail: (where: string, e: unknown) => void) {
  const { error } = await admin.from('qvmc_cache').upsert({ key: FAILURES_KEY, data: failures, fetched_at: new Date().toISOString() });
  if (error) fail('tcgdex marca de falhas', error);
}

async function storedSets(admin: LangDb, lang: Lang) {
  const { data, error } = await admin.from('tcgdex_lang').select('sets').eq('lang', lang).maybeSingle();
  if (error) throw error;
  return data?.sets ?? null;
}

/** Busca as datas que faltam de um idioma. Um erro para a busca e guarda as que já vieram. Devolve quantas buscou. */
async function fillDates(admin: LangDb, lang: Lang, sets: Record<string, StoredSet>, read: Reader, fail: (where: string, e: unknown) => void, onRefused: () => Promise<void>) {
  let got = 0;
  for (const id of undatedSets(sets)) {
    try {
      const detail = await read<{ releaseDate?: string | null }>(`/${lang}/sets/${encodeURIComponent(id)}`);
      sets[id] = { ...sets[id], date: /^\d{4}-\d{2}-\d{2}/.test(detail?.releaseDate ?? '') ? detail.releaseDate!.slice(0, 10) : null };
      got++;
    } catch (e) {
      if (!(e instanceof OutOfTime)) fail(`tcgdex ${lang} datas`, e);
      if (e instanceof TcgdexRefused) await onRefused();
      break;
    }
  }
  if (!got) return 0;
  const { error } = await admin.from('tcgdex_lang').update({ sets }).eq('lang', lang);
  if (error) throw error;
  return got;
}

export async function syncTcgdexLanguages(
  admin: LangDb,
  report: { languages?: LangReport },
  fail: (where: string, e: unknown) => void,
  deadline: number,
  deps: LangDeps = liveDeps,
): Promise<void> {
  if (Date.now() >= deadline) return;
  const { data, error } = await admin.from('tcgdex_lang').select('lang, fetched_at');
  if (error) throw error;
  const rows = data ?? [];
  const now = Date.now();
  const failures = await loadFailures(admin);
  if (isRefused(failures, now)) {
    fail('tcgdex por idioma', new Error(`a TCGdex recusou (403 ou 429) em ${failures.refusedAt}: etapa parada por 24 h`));
    return;
  }
  const read = reader(deps, deadline);
  const lang = chooseLanguage(rows, now, failures);
  const markRefused = () => saveFailures(admin, { ...failures, refusedAt: new Date().toISOString() }, fail);

  if (!lang) {
    // Em dia: usa a vaga para as datas que ainda faltam.
    for (const pending of languagesWithPendingDates(rows, now)) {
      const sets = await storedSets(admin, pending);
      if (!sets || !undatedSets(sets).length) continue;
      report.languages = { lang: pending, dates: await fillDates(admin, pending, sets, read, fail, markRefused) };
      return;
    }
    return;
  }

  let fresh: LangData;
  try {
    fresh = await readLanguage(lang, read);
  } catch (e) {
    if (e instanceof OutOfTime) {
      report.languages = { lang, outOfTime: true };
    } else {
      fail(`tcgdex ${lang}`, e);
      if (e instanceof TcgdexRefused) await markRefused();
      else await saveFailures(admin, { ...failures, failed: { ...failures.failed, [lang]: new Date().toISOString() } }, fail);
    }
    return;
  }
  const sets = lang === 'zh-tw' || lang === 'zh-cn' ? withKnownDates(fresh.sets, await storedSets(admin, lang)) : fresh.sets;
  const { error: saveError } = await admin
    .from('tcgdex_lang')
    .upsert({ lang, cards: fresh.cards, hp: fresh.hp, sets, fetched_at: new Date().toISOString() });
  if (saveError) throw saveError;
  report.languages = { lang, cards: fresh.cards.length, sets: Object.keys(sets).length, hp: Object.keys(fresh.hp).length };
  if (failures.failed?.[lang]) {
    const { [lang]: _ok, ...others } = failures.failed;
    await saveFailures(admin, { ...failures, failed: others }, fail);
  }
}
