import { supabase } from './supabase';
import { mypFitsVariant, type ValueRange } from './valuation';

/** Um dia do histórico da coleção: soma dos mínimos, das médias (`value`) e dos máximos das cartas com preço. */
export type HistoryPoint = { day: string; value: number; min: number; max: number; cards: number };

type Row = { entry_id: string; day: string; variant: string | null; sources: Record<string, unknown> | null };

/**
 * Valor de uma carta num dia, pela mesma regra do app (src/lib/valuation.ts): "Meu valor" (mínimo, média e máximo
 * iguais), senão mínimo/média/máximo do MYP. Fontes antigas gravadas nas fotos (vendas reais, menor anúncio, oferta
 * por estado) não entram.
 */
function dayRange(s: Record<string, unknown> | null, variant: string | null): ValueRange | undefined {
  if (!s) return undefined;
  const manual = (s.manual as { value?: number } | undefined)?.value;
  if (typeof manual === 'number') return { min: manual, avg: manual, max: manual };
  // Produto no MYP: vale para a versão comum, ou para a versão com selo quando o produto é dela.
  const api = s.mypApi as { min?: number; avg?: number; max?: number; own?: boolean } | undefined;
  if (typeof api?.avg !== 'number' || !(api.own || mypFitsVariant(variant ?? 'normal'))) return undefined;
  const avg = api.avg;
  return {
    min: typeof api.min === 'number' ? Math.min(api.min, avg) : avg,
    avg,
    max: typeof api.max === 'number' ? Math.max(api.max, avg) : avg,
  };
}

/**
 * Histórico diário do valor da coleção (gravado pelo servidor às 23:50), da conta conectada.
 * Sem conta, devolve null.
 */
export async function collectionHistory(): Promise<HistoryPoint[] | null> {
  if (!supabase) return null;
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return null;
  const rows: Row[] = [];
  // Busca em páginas de 1.000 linhas (limite da API).
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('price_history')
      .select('entry_id, day, variant, sources')
      .order('day', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const byDay = new Map<string, HistoryPoint>();
  for (const r of rows) {
    const v = dayRange(r.sources, r.variant);
    if (!v) continue;
    const p = byDay.get(r.day) ?? { day: r.day, value: 0, min: 0, max: 0, cards: 0 };
    p.value += v.avg;
    p.min += v.min;
    p.max += v.max;
    p.cards++;
    byDay.set(r.day, p);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
