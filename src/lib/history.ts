import { PRICE_RULE_SINCE } from './copy';
import { supabase } from './supabase';
import type { Entry, ValueBasis } from './types';
import type { SourceId, ValueRange } from './valuation';

/**
 * Histórico do valor, a partir das fotos diárias que o servidor grava às 23:50 (tabela price_history, função
 * snapshot_prices): uma linha por carta com preço por dia, com as fontes daquele dia. Começa no dia da regra de preço
 * atual (PRICE_RULE_SINCE): as fotos de antes guardam fontes que saíram, e a soma delas cobre só parte das cartas.
 *
 * O total por dia vem somado do servidor (função collection_history, uma requisição por período); a variação de um
 * período compara só as mesmas cartas nos dois dias (carta nova, removida, trocada ou com outra fonte fica à parte),
 * e o histórico de uma carta filtra a carta e a versão, para não misturar cartas trocadas no mesmo bolso. Os
 * resultados ficam guardados na memória por 30 min (a tela é montada de novo a cada abertura).
 */

/**
 * Um dia do histórico da coleção: o valor (`value`, a soma do valor escolhido em cada carta: mínimo, média ou máximo)
 * e as somas dos mínimos, das médias e dos máximos das cartas com preço.
 */
export type HistoryPoint = { day: string; value: number; min: number; avg: number; max: number; cards: number };

/** Valor de uma carta numa foto: a faixa, o valor escolhido (`pick`) e a fonte. */
export type SnapshotValue = ValueRange & { pick: number; source: SourceId };

/** Linha da tabela price_history (a foto de uma carta num dia). */
export type HistoryRow = {
  entry_id: string;
  day: string;
  card_id: string | null;
  lang: string | null;
  variant: string | null;
  sources: Record<string, unknown> | null;
};

type Prices = { min?: unknown; avg?: unknown; max?: unknown } | undefined;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Escolha da carta ("Usar na soma") gravada na foto; fotos antigas, sem a escolha: a média. */
function basisOf(s: Record<string, unknown> | null | undefined): ValueBasis {
  const b = s?.basis;
  return b === 'min' || b === 'max' ? b : 'avg';
}

/**
 * Valor de uma carta numa foto diária, pela mesma regra do app (src/lib/valuation.ts) e do servidor
 * (public.history_value): "Meu valor" (mínimo, média e máximo iguais), senão a TCGplayer — só nas cartas em inglês,
 * já em reais —, senão mínimo/média/máximo do MYP. Fontes antigas gravadas nas fotos (vendas reais, menor anúncio,
 * oferta por estado) não entram. Com `basis`, usa essa escolha no lugar da gravada (para comparar dois dias pela
 * mesma escolha).
 */
export function snapshotValue(
  s: Record<string, unknown> | null | undefined,
  lang: string | null | undefined,
  basis?: ValueBasis,
): SnapshotValue | undefined {
  if (!s) return undefined;
  const manual = num((s.manual as { value?: unknown } | undefined)?.value);
  if (manual != null) return { min: manual, avg: manual, max: manual, pick: manual, source: 'manual' };
  // TCGplayer (só nas cartas em inglês: uma carta trocada para outro idioma pode ter ficado com o preço antigo), senão
  // o produto no MYP.
  const tcg = lang === 'en' ? (s.tcgplayer as Prices) : undefined;
  const useTcg = num(tcg?.avg) != null;
  const p = useTcg ? tcg : (s.mypApi as Prices);
  const avg = num(p?.avg);
  if (avg == null) return undefined;
  const lo = num(p?.min);
  const hi = num(p?.max);
  const range = { min: lo != null ? Math.min(lo, avg) : avg, avg, max: hi != null ? Math.max(hi, avg) : avg };
  return { ...range, pick: range[basis ?? basisOf(s)], source: useTcg ? 'tcgplayer' : 'myp' };
}

const DAY_MS = 86_400_000;
const PAGE = 1000;

/** "AAAA-MM-DD" de um instante, no fuso do aparelho. */
export function dayString(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Instante (meio-dia) de um dia "AAAA-MM-DD", para os gráficos. */
export function dayTime(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

// ===== Cache da sessão =====

const CACHE_MS = 30 * 60_000;
const memo = new Map<string, { at: number; data: unknown }>();
const running = new Map<string, Promise<unknown>>();

/** Resultado guardado por 30 min; chamadas iguais ao mesmo tempo esperam a mesma requisição. */
function remember<T>(key: string, load: () => Promise<T>, force = false): Promise<T> {
  const hit = memo.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.data as T);
  const pending = running.get(key);
  if (pending) return pending as Promise<T>;
  const p = load()
    .then((data) => {
      memo.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

/** Esquece o histórico guardado (ex.: ao sair da conta). */
export function clearHistoryCache() {
  memo.clear();
}

/** Conta conectada (sem conta, não há histórico). */
async function currentUser() {
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id;
}

/** A função ainda não existe no banco (migração não aplicada): o app usa o caminho antigo. */
function missingFunction(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '');
}

/** Linhas das fotos, em páginas de 1.000 (limite da API), em ordem total (dia e carta) para não repetir nem pular. */
async function historyRows(f: { from?: string; days?: string[]; entryId?: string; cardId?: string }) {
  const rows: HistoryRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase!.from('price_history').select('entry_id, day, card_id, lang, variant, sources');
    if (f.from) q = q.gte('day', f.from);
    if (f.days) q = q.in('day', f.days);
    if (f.entryId) q = q.eq('entry_id', f.entryId);
    if (f.cardId) q = q.eq('card_id', f.cardId);
    const { data, error } = await q
      .order('day', { ascending: true })
      .order('entry_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as HistoryRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Soma por dia no aparelho (quando o banco ainda não tem collection_history). */
function sumByDay(rows: HistoryRow[]): HistoryPoint[] {
  const byDay = new Map<string, HistoryPoint>();
  for (const r of rows) {
    const v = snapshotValue(r.sources, r.lang);
    if (!v) continue;
    const p = byDay.get(r.day) ?? { day: r.day, value: 0, min: 0, avg: 0, max: 0, cards: 0 };
    p.value += v.pick;
    p.avg += v.avg;
    p.min += v.min;
    p.max += v.max;
    p.cards++;
    byDay.set(r.day, p);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

type DayRow = { day: string; value: number | string; min: number | string; avg: number | string; max: number | string; cards: number | string };

async function loadHistory(from: string): Promise<HistoryPoint[]> {
  const { data, error } = await supabase!.rpc('collection_history', { p_from: from });
  if (!error) {
    return ((data ?? []) as DayRow[]).map((r) => ({
      day: r.day,
      value: Number(r.value),
      min: Number(r.min),
      avg: Number(r.avg),
      max: Number(r.max),
      cards: Number(r.cards),
    }));
  }
  if (!missingFunction(error)) throw error;
  return sumByDay(await historyRows({ from }));
}

/**
 * Histórico diário do valor da coleção da conta conectada, desde `from` ("AAAA-MM-DD"; padrão: 1 ano), nunca antes de
 * PRICE_RULE_SINCE. Sem conta, devolve null. Guardado na memória por 30 min (`force` busca de novo).
 */
export async function collectionHistory(opts: { from?: string; force?: boolean } = {}): Promise<HistoryPoint[] | null> {
  if (!supabase) return null;
  const user = await currentUser();
  if (!user) return null;
  const since = opts.from ?? dayString(Date.now() - 366 * DAY_MS);
  const from = since < PRICE_RULE_SINCE ? PRICE_RULE_SINCE : since;
  return remember(`history:${user}:${from}`, () => loadHistory(from), opts.force);
}

/** Variação do valor de uma carta no período (só cartas com preço do mercado). */
export type CardMove = { entryId: string; cardId: string | null; from: number; to: number; diff: number; pct: number | null };

/**
 * Variação da coleção entre dois dias, só com as mesmas cartas: mesmo bolso, carta, versão, idioma e fonte nos dois
 * dias, pela escolha ("Usar na soma") do último dia — assim carta nova, removida, trocada ou que mudou de fonte (ex.:
 * ganhou "Meu valor") não parece alta ou queda do mercado. Elas aparecem à parte, com o valor que somam.
 */
export type CollectionChange = {
  fromDay: string;
  toDay: string;
  /** Cartas comparadas (presentes nos dois dias, iguais). */
  same: number;
  fromValue: number;
  toValue: number;
  diff: number;
  /** Variação em %, sobre o valor do primeiro dia (null sem valor no primeiro dia). */
  pct: number | null;
  /** Cartas só no último dia, e o valor delas. */
  added: number;
  addedValue: number;
  /** Cartas que estavam no primeiro dia sem preço reconhecido e ganharam preço (não são cartas novas), e o valor delas. */
  priced: number;
  pricedValue: number;
  /** Cartas só no primeiro dia, e o valor delas. */
  removed: number;
  removedValue: number;
  /** Mesmo bolso com outra carta, versão, idioma ou fonte. */
  changed: number;
  /** Maiores altas e quedas em reais (até 5 de cada; sem as cartas com "Meu valor"). */
  up: CardMove[];
  down: CardMove[];
};

/** Compara as fotos de dois dias (função pura; ver CollectionChange). */
export function compareDays(rows: HistoryRow[], fromDay: string, toDay: string): CollectionChange {
  const first = new Map<string, HistoryRow>();
  const last = new Map<string, HistoryRow>();
  for (const r of rows) {
    if (r.day === fromDay) first.set(r.entry_id, r);
    if (r.day === toDay) last.set(r.entry_id, r);
  }
  const out: CollectionChange = {
    fromDay,
    toDay,
    same: 0,
    fromValue: 0,
    toValue: 0,
    diff: 0,
    pct: null,
    added: 0,
    addedValue: 0,
    priced: 0,
    pricedValue: 0,
    removed: 0,
    removedValue: 0,
    changed: 0,
    up: [],
    down: [],
  };
  const moves: CardMove[] = [];
  for (const [id, b] of last) {
    const vb = snapshotValue(b.sources, b.lang);
    if (!vb) continue;
    const a = first.get(id);
    if (!a) {
      out.added++;
      out.addedValue += vb.pick;
      continue;
    }
    const va0 = snapshotValue(a.sources, a.lang);
    const sameCard = a.card_id === b.card_id && (a.variant ?? 'normal') === (b.variant ?? 'normal') && a.lang === b.lang;
    // A mesma carta no bolso, mas sem preço que a regra atual reconheça no primeiro dia (ex.: foto com fontes antigas):
    // ganhou preço, não é carta nova.
    if (sameCard && !va0) {
      out.priced++;
      out.pricedValue += vb.pick;
      continue;
    }
    if (!sameCard || !va0 || va0.source !== vb.source) {
      out.changed++;
      continue;
    }
    // A escolha do último dia nos dois dias: trocar mínimo/média/máximo na carta não é mudança do mercado.
    const va = snapshotValue(a.sources, a.lang, basisOf(b.sources))!;
    out.same++;
    out.fromValue += va.pick;
    out.toValue += vb.pick;
    if (vb.source !== 'manual') {
      const diff = vb.pick - va.pick;
      moves.push({ entryId: id, cardId: b.card_id, from: va.pick, to: vb.pick, diff, pct: va.pick > 0 ? (diff / va.pick) * 100 : null });
    }
  }
  for (const [id, a] of first) {
    if (last.has(id) && snapshotValue(last.get(id)!.sources, last.get(id)!.lang)) continue;
    const va = snapshotValue(a.sources, a.lang);
    if (!va) continue;
    out.removed++;
    out.removedValue += va.pick;
  }
  out.diff = out.toValue - out.fromValue;
  out.pct = out.fromValue > 0 ? (out.diff / out.fromValue) * 100 : null;
  out.up = moves
    .filter((m) => m.diff >= 0.005)
    .sort((x, y) => y.diff - x.diff)
    .slice(0, 5);
  out.down = moves
    .filter((m) => m.diff <= -0.005)
    .sort((x, y) => x.diff - y.diff)
    .slice(0, 5);
  return out;
}

/** Variação entre dois dias do histórico (ver CollectionChange). Sem conta, null. */
export async function collectionChange(fromDay: string, toDay: string, opts: { force?: boolean } = {}): Promise<CollectionChange | null> {
  if (!supabase) return null;
  const user = await currentUser();
  if (!user) return null;
  return remember(
    `change:${user}:${fromDay}:${toDay}`,
    async () => compareDays(await historyRows({ days: [...new Set([fromDay, toDay])] }), fromDay, toDay),
    opts.force,
  );
}

/**
 * Variação dos últimos `days` dias (do primeiro dia gravado no período até o último). Null sem conta ou com menos de
 * 2 dias de histórico no período (aí a tela esconde a variação).
 */
export async function recentChange(days: number, opts: { force?: boolean } = {}): Promise<(CollectionChange & { days: number }) | null> {
  const history = await collectionHistory(opts);
  if (!history || history.length < 2) return null;
  const lastDay = history[history.length - 1].day;
  const start = dayTime(lastDay) - days * DAY_MS;
  const firstDay = history.find((h) => dayTime(h.day) >= start)?.day;
  if (!firstDay || firstDay === lastDay) return null;
  const change = await collectionChange(firstDay, lastDay, opts);
  return change ? { ...change, days: Math.round((dayTime(lastDay) - dayTime(firstDay)) / DAY_MS) } : null;
}

/** Um dia do histórico de uma carta: a faixa, o valor escolhido e a fonte daquele dia. */
export type EntryHistoryPoint = { day: string; value: number; min: number; avg: number; max: number; source: SourceId };

/**
 * Linha do "Histórico do preço" de uma carta (função pura), pela regra de compareDays: só os últimos dias seguidos com
 * a fonte do último dia (a troca do "Meu valor" pela fonte, ou o contrário, não é alta nem queda do mercado) e, nos
 * preços das fontes, a escolha atual da carta (`basis`, "Usar na soma") em todos os dias.
 */
export function entrySeries(points: EntryHistoryPoint[], basis: ValueBasis = 'avg'): EntryHistoryPoint[] {
  const last = points[points.length - 1];
  if (!last) return [];
  let start = points.length - 1;
  while (start > 0 && points[start - 1].source === last.source) start--;
  return points.slice(start).map((p) => (p.source === 'manual' ? p : { ...p, value: p[basis] }));
}

/**
 * Histórico do preço de uma carta: as fotos daquele bolso com a mesma carta, versão e idioma (uma carta trocada no
 * mesmo bolso não entra), desde PRICE_RULE_SINCE. Cada dia com a fonte e a escolha daquele dia (a tela usa
 * entrySeries). Sem conta, null.
 */
export async function entryHistory(
  e: Pick<Entry, 'id' | 'cardId' | 'variant' | 'lang'>,
  opts: { force?: boolean } = {},
): Promise<EntryHistoryPoint[] | null> {
  if (!supabase) return null;
  const user = await currentUser();
  if (!user) return null;
  return remember(
    `entry:${user}:${e.id}:${e.cardId}:${e.variant}:${e.lang}`,
    async () => {
      // A versão é conferida aqui: foto de carta sem versão gravada é a normal (como em compareDays).
      const rows = await historyRows({ from: PRICE_RULE_SINCE, entryId: e.id, cardId: e.cardId });
      const out: EntryHistoryPoint[] = [];
      for (const r of rows) {
        if (r.lang !== e.lang || (r.variant ?? 'normal') !== (e.variant ?? 'normal')) continue;
        const v = snapshotValue(r.sources, r.lang);
        if (v) out.push({ day: r.day, value: v.pick, min: v.min, avg: v.avg, max: v.max, source: v.source });
      }
      return out;
    },
    opts.force,
  );
}
