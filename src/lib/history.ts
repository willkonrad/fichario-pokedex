import { supabase } from './supabase';
import { mypFitsVariant } from './valuation';

/** Um dia do histórico da coleção: soma do valor das cartas com preço naquele dia. */
export type HistoryPoint = { day: string; value: number; cards: number };

type Row = { entry_id: string; day: string; variant: string | null; sources: Record<string, unknown> | null };

/**
 * Valor de uma carta num dia, pela mesma regra do app (src/lib/valuation.ts): "Meu valor", senão a média do MYP.
 * Fontes antigas gravadas nas fotos (vendas reais, menor anúncio, oferta por estado) não entram mais.
 */
function dayValue(s: Record<string, unknown> | null, variant: string | null): number | undefined {
  if (!s) return undefined;
  const manual = (s.manual as { value?: number } | undefined)?.value;
  if (typeof manual === 'number') return manual;
  // Média do produto no MYP: vale para a versão comum, ou para a versão com selo quando o produto é dela.
  const api = s.mypApi as { avg?: number; own?: boolean } | undefined;
  if (typeof api?.avg === 'number' && (api.own || mypFitsVariant(variant ?? 'normal'))) return api.avg;
  return undefined;
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
    const v = dayValue(r.sources, r.variant);
    if (v == null) continue;
    const p = byDay.get(r.day) ?? { day: r.day, value: 0, cards: 0 };
    p.value += v;
    p.cards++;
    byDay.set(r.day, p);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
