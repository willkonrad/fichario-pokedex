import type { Entry } from './types';
import { valuation } from './valuation';

/** Faixa de preço real da carta na Liga (menor / médio / maior), do acabamento dela. */
export function entryRange(e: Entry): { min?: number; avg?: number; max?: number } | undefined {
  if (e.price && (e.price.avg != null || e.price.min != null)) return e.price;
  return undefined;
}

/**
 * Valor de vendas reais da carta no estado dela (mediana do "Quanto vale minha carta?"), quando houver.
 * É o valor mais fiel: vendas concluídas, no idioma e no estado da carta.
 */
export function soldValue(e: Entry): { value: number; count: number; lowConfidence: boolean } | undefined {
  const c = e.sold?.byCondition?.[e.condition];
  if (c?.value == null) return undefined;
  return { value: c.value, count: c.count, lowConfidence: !!e.sold?.lowConfidence && c.count < 3 };
}

/** Valor da carta no total da coleção: o valor de referência, que cruza todas as fontes (ver valuation.ts). */
export function entryValue(e: Entry) {
  return valuation(e).value;
}

/**
 * Totais da coleção. `value` soma o valor de cada carta (venda real ou, sem ela, a média da Liga);
 * `min`/`avg`/`max` somam só a faixa de anúncios da Liga (referência).
 */
export function collectionTotals(entries: Entry[]) {
  let min = 0;
  let avg = 0;
  let max = 0;
  let priced = 0;
  let value = 0;
  let valued = 0;
  const byConfidence = { alta: 0, media: 0, baixa: 0 };
  for (const e of entries) {
    const v = entryValue(e);
    if (v != null) {
      value += v;
      valued++;
      const c = valuation(e).confidence;
      if (c) byConfidence[c]++;
    }
    const r = entryRange(e);
    if (!r) continue;
    priced++;
    const mid = r.avg ?? r.min ?? 0;
    min += r.min ?? mid;
    avg += mid;
    max += r.max ?? mid;
  }
  return { min, avg, max, priced, unpriced: entries.length - priced, value, valued, byConfidence, unvalued: entries.length - valued };
}

/** Cotação mais recente e mais antiga da coleção (ISO), para mostrar quando os valores foram atualizados. */
export function priceFreshness(entries: Entry[]) {
  const times = entries
    .map((e) => (e.price?.source === 'site' ? e.price.updatedAt : undefined))
    .filter((t): t is string => !!t)
    .sort();
  return { newest: times[times.length - 1], oldest: times[0] };
}

/** Data e hora curtas: "20/10, 06:05". */
export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatBRL(n?: number) {
  return n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Reais sem centavos a partir de R$ 100 (cabe em colunas estreitas): "R$ 82,52", "R$ 1.537". */
export function formatBRLTight(n?: number) {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: n >= 100 ? 0 : 2 });
}

/** Versão curta para espaços pequenos (ex.: no fichário): "R$ 0,82", "R$ 82", "R$ 1,2 mil". */
export function formatBRLShort(n?: number) {
  if (n == null) return '—';
  if (n < 10) return `R$ ${n.toFixed(2).replace('.', ',')}`;
  if (n < 1000) return `R$ ${Math.round(n)}`;
  return `R$ ${(n / 1000).toFixed(1).replace('.', ',')} mil`;
}
