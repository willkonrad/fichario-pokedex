import { supabase } from './supabase';
import { mypFitsVariant, soldMatchesVariant } from './valuation';

/** Um dia do histórico da coleção: soma do valor das cartas com preço naquele dia. */
export type HistoryPoint = { day: string; value: number; cards: number };

type Row = { entry_id: string; day: string; variant: string | null; sources: Record<string, unknown> | null };

/**
 * Valor de uma carta num dia, pela mesma ordem do app (src/lib/valuation.ts): "Meu valor" > MYP no estado >
 * MYP no idioma > vendas reais (reserva).
 */
function dayValue(s: Record<string, unknown> | null, variant: string | null): number | undefined {
  if (!s) return undefined;
  const manual = (s.manual as { value?: number } | undefined)?.value;
  if (typeof manual === 'number') return manual;
  // Menor oferta no estado/idioma/versão (número, nas fotos novas; objeto com "min", nas antigas).
  const offer = typeof s.mypOffer === 'number' ? s.mypOffer : (s.mypOffer as { min?: number } | undefined)?.min;
  if (typeof offer === 'number') return offer;
  // Vendas reais só da mesma variação da carta (o nome da variação das vendas vem junto).
  const raw = s.sold as { value?: number; count?: number; variant?: string } | undefined;
  const sold = raw && soldMatchesVariant(variant ?? 'normal', raw.variant) ? raw : undefined;
  if (typeof s.myp === 'number' && mypFitsVariant(variant ?? 'normal')) return s.myp;
  return typeof sold?.value === 'number' ? sold.value : undefined;
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
