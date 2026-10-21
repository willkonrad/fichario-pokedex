import type { Entry } from './types';
import { valuation } from './valuation';

/** Valor da carta no total da coleção (só MYP Cards; ver valuation.ts). */
export function entryValue(e: Entry) {
  return valuation(e).value;
}

/** Totais da coleção: soma do valor de cada carta e quantas cartas têm valor, por confiança. */
export function collectionTotals(entries: Entry[]) {
  let value = 0;
  let valued = 0;
  const byConfidence = { alta: 0, media: 0, baixa: 0 };
  for (const e of entries) {
    const ref = valuation(e);
    if (ref.value == null) continue;
    value += ref.value;
    valued++;
    if (ref.confidence) byConfidence[ref.confidence]++;
  }
  return { value, valued, byConfidence, unvalued: entries.length - valued };
}

/** Atualização mais recente e mais antiga dos preços do MYP na coleção (ISO). */
export function priceFreshness(entries: Entry[]) {
  const times = entries
    .map((e) => e.mypOffers?.checkedAt ?? e.myp?.checkedAt)
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
