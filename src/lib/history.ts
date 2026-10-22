import { supabase } from './supabase';
import type { ValueBasis } from './types';
import type { ValueRange } from './valuation';

/**
 * Um dia do histórico da coleção: o valor calculado (`value`, a soma do valor escolhido em cada carta: mínimo, média ou
 * máximo) e as somas dos mínimos, das médias e dos máximos das cartas com preço.
 */
export type HistoryPoint = { day: string; value: number; min: number; avg: number; max: number; cards: number };

type Row = { entry_id: string; day: string; variant: string | null; sources: Record<string, unknown> | null };

/**
 * Valor de uma carta num dia, pela mesma regra do app (src/lib/valuation.ts): "Meu valor" (mínimo, média e máximo
 * iguais), senão mínimo/média/máximo do MYP (da carta base, para versão especial que o MYP não vende à parte). Fontes
 * antigas gravadas nas fotos (vendas reais, menor anúncio, oferta por estado) não entram.
 */
function dayRange(s: Record<string, unknown> | null): (ValueRange & { pick: number }) | undefined {
  if (!s) return undefined;
  const manual = (s.manual as { value?: number } | undefined)?.value;
  if (typeof manual === 'number') return { min: manual, avg: manual, max: manual, pick: manual };
  // Produto no MYP: o da versão, ou o da carta base para versão especial que o MYP não vende à parte (valor parecido).
  const api = s.mypApi as { min?: number; avg?: number; max?: number } | undefined;
  if (typeof api?.avg !== 'number') return undefined;
  const avg = api.avg;
  const range = {
    min: typeof api.min === 'number' ? Math.min(api.min, avg) : avg,
    avg,
    max: typeof api.max === 'number' ? Math.max(api.max, avg) : avg,
  };
  // Valor escolhido na carta naquele dia (fotos antigas, sem a escolha: a média).
  const basis = s.basis as ValueBasis | undefined;
  return { ...range, pick: range[basis === 'min' || basis === 'max' ? basis : 'avg'] };
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
    const v = dayRange(r.sources);
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
