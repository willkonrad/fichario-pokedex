import { APPROX_REASON, offersText, RANGE_LABELS, rangeLabelsOf, SOURCE_NAME } from './copy';
import { formatBRL, formatUSD } from './format';
import { tcgplayerColumns, tcgplayerFor } from './tcgplayer';
import type { Entry, MypApiPrice, ValueBasis } from './types';

/**
 * Valor da carta (em reais), na ordem:
 *
 *   1. "Meu valor" digitado pelo usuário: o único valor fixo (mínimo, média e máximo iguais a ele). Quando a média da
 *      fonte da carta passa dele, ele é apagado e a carta volta a usar a fonte (ver myValuePatch);
 *   2. carta em INGLÊS: a TCGplayer (EUA), em reais pela PTAX — mínimo = menor anúncio, média = valor de mercado
 *      (vendas recentes), máximo = mediana dos anúncios (lib/tcgplayer.ts); o MYP aparece só como referência;
 *   3. o MÍNIMO, a MÉDIA e o MÁXIMO dos anúncios do produto no MYP Cards (API pública do MYP), como a API informa —
 *      confiança média, porque juntam todos os estados e idiomas. Versão especial (selo, Poké Ball…) sem produto
 *      próprio usa o da carta base, que tem valor parecido — confiança baixa ("aproximado"). Carta em inglês sem preço
 *      na TCGplayer também usa o MYP, com confiança baixa.
 *
 * O VALOR da carta (o da soma, dos bolsos, das mais valiosas e do gráfico) é um dos três, escolhido na carta
 * (`valueBasis`, "Usar na soma"): a média por padrão; o mínimo costuma ser o valor real de cartas novas. Sem nenhuma
 * fonte, a carta fica sem valor (o app não estima). A mesma regra vale no servidor (snapshot_prices e
 * collection_history, em supabase/migrations) e nas fotos diárias (lib/history.ts).
 */

export type SourceId = 'manual' | 'tcgplayer' | 'myp';

/**
 * Versões especiais (com selo, Poké Ball, Master Ball, 1ª edição, Shadowless): o preço exato é o do produto próprio da
 * versão no MYP; sem ele, vale o da carta base (valor parecido), com confiança baixa.
 */
export const SPECIAL_VARIANTS = ['wPromo', 'staff', 'pokeball', 'masterball', 'firstEdition', 'shadowless', 'other'];
export function mypFitsVariant(variant: string) {
  return !SPECIAL_VARIANTS.includes(variant);
}

/** O MYP tem preço de cartas em português e inglês; japonês, não (as edições japonesas ficam de fora da API). */
export function mypCovers(lang: string) {
  return lang === 'pt' || lang === 'en';
}

/** O app ainda não buscou o preço desta carta (nesta versão e selo): na TCGplayer (em inglês) ou no MYP. */
export function pricePending(e: Entry) {
  if (e.lang === 'en') return !tcgplayerFor(e);
  return mypCovers(e.lang) && !mypApiFor(e);
}

/** A busca na API do MYP é desta carta, versão e selo (senão o app ainda vai buscar de novo)? */
export function mypApiFor(e: Entry): MypApiPrice | undefined {
  const s = e.mypApi;
  const note = e.variant === 'wPromo' || e.variant === 'staff' ? (e.variantNote ?? '').trim() : '';
  if (!s?.checkedAt || s.cardId !== e.cardId || s.variant !== e.variant || (s.note ?? '') !== note) return undefined;
  return s;
}

/**
 * Os preços do produto no MYP são exatamente desta versão (produto próprio, ou versão comum)? Senão, são da carta base
 * (versão especial que o MYP não vende à parte): valem como valor, com confiança baixa.
 */
export function mypApiFitsVariant(e: Entry, s: MypApiPrice) {
  return !!s.ownVersion || mypFitsVariant(e.variant);
}

/**
 * "Meu valor" é fixo até a média da fonte passar dele (a do MYP; nas cartas em inglês, o valor de mercado da
 * TCGplayer): aí ele é apagado (fica o registro da troca, mostrado na tela da carta) e a carta volta a usar mínimo,
 * média e máximo da fonte, com a escolha de "Usar na soma" (que pode ficar abaixo do valor digitado, ex.: o mínimo).
 */
export function myValuePatch(e: Entry, s: { avg?: number; checkedAt: string }, source: 'myp' | 'tcgplayer'): Partial<Entry> {
  const mine = e.myValue?.value;
  if (mine == null || s.avg == null || s.avg <= mine) return {};
  return { myValue: null, myValueReplaced: { value: mine, mypValue: s.avg, at: s.checkedAt, source } };
}

/**
 * A média que apaga o "Meu valor" desta carta (a mesma regra de myValuePatch e das funções patch_entry_*): nas cartas
 * em inglês, o mercado da TCGplayer; nas outras, a média do MYP. Sem preço da fonte, undefined.
 */
export function myValueTrigger(e: Entry): { avg: number; source: 'myp' | 'tcgplayer' } | undefined {
  const avg = e.lang === 'en' ? tcgplayerFor(e)?.avg : mypApiFor(e)?.avg;
  return avg != null ? { avg, source: e.lang === 'en' ? 'tcgplayer' : 'myp' } : undefined;
}

/** "Meu valor" abaixo da média da fonte: é apagado na próxima atualização do preço (a tela avisa antes). */
export function myValueBelowSource(e: Entry) {
  const mine = e.myValue?.value;
  const t = myValueTrigger(e);
  return mine != null && t && t.avg > mine ? t : undefined;
}

export type Confidence = 'alta' | 'media' | 'baixa';

/**
 * Por que o valor é aproximado (confiança baixa): preço da carta base (versão especial que a fonte não vende à parte)
 * ou, numa carta em inglês sem preço na TCGplayer, os anúncios do MYP de todos os idiomas.
 */
export type ApproxReason = 'base' | 'otherLanguages';

export type SourceRow = {
  id: SourceId;
  label: string;
  /** Valor em reais. */
  brl: number;
  /** É o valor da carta. */
  used: boolean;
  /** Detalhe curto: "mín R$ 6,99 · máx R$ 60,00 · 21 anúncios"… */
  detail?: string;
};

/** Mínimo, média e máximo do valor (com "Meu valor", os três são ele). */
export type ValueRange = { min: number; avg: number; max: number };

export type Valuation = {
  /** O valor da carta: o mínimo, a média ou o máximo escolhido (`pick`), ou o "Meu valor". */
  value?: number;
  /** Mínimo, média e máximo como a fonte informa (com "Meu valor", os três são ele). */
  range?: ValueRange;
  /** Qual dos três é o valor (sem efeito no "Meu valor"). */
  pick?: ValueBasis;
  confidence?: Confidence;
  /** Por que o valor é aproximado (só com confiança baixa). */
  approx?: ApproxReason;
  /** De onde veio o valor. */
  basis?: SourceId;
  sources: SourceRow[];
};

/** @deprecated use SOURCE_NAME de lib/copy.ts. */
export const SOURCE_LABEL: Record<SourceId, string> = SOURCE_NAME;

/** A faixa tem mínimo e máximo diferentes (senão é um valor só, como o "Meu valor"). */
export function isSpread(r: ValueRange) {
  return r.max - r.min >= 0.005;
}

/** Fontes disponíveis para a carta, na ordem de prioridade. */
export function priceSources(e: Entry): Omit<SourceRow, 'used'>[] {
  const rows: Omit<SourceRow, 'used'>[] = [];
  if (e.myValue?.value != null) {
    rows.push({ id: 'manual', label: SOURCE_NAME.manual, brl: e.myValue.value, detail: 'digitado por você' });
  }
  // Carta em inglês: TCGplayer (EUA), em reais pela PTAX.
  const tcg = e.lang === 'en' ? tcgplayerFor(e) : undefined;
  if (tcg?.avg != null) {
    const usd = tcg.usdMarket != null ? ` ${formatUSD(tcg.usdMarket)}` : '';
    rows.push({ id: 'tcgplayer', label: SOURCE_NAME.tcgplayer, brl: tcg.avg, detail: `mercado${usd} · todos os estados${tcg.base ? ' · carta base' : ''}` });
  }
  // Média dos anúncios do produto no MYP (API pública), com mínimo e máximo (de versão especial sem produto próprio,
  // os da carta base).
  const api = mypApiFor(e);
  if (api?.avg != null) {
    const parts = [
      api.min != null ? `mín ${formatBRL(api.min)}` : null,
      api.max != null ? `máx ${formatBRL(api.max)}` : null,
      api.qty != null ? offersText(api.qty) : null,
    ].filter(Boolean);
    const scope = mypApiFitsVariant(e, api) ? 'todos os estados e idiomas' : 'carta base, todos os estados e idiomas';
    rows.push({ id: 'myp', label: SOURCE_NAME.myp, brl: api.avg, detail: `${parts.join(' · ')} (${scope})` });
  }
  return rows;
}

/** Valor da carta (ver comentário do módulo): "Meu valor", senão a TCGplayer (cartas em inglês), senão o MYP. */
export function valuation(e: Entry): Valuation {
  const all = priceSources(e);
  const best = all[0];
  if (!best) return { sources: [] };
  const api = best.id === 'myp' ? mypApiFor(e) : undefined;
  const tcg = best.id === 'tcgplayer' ? tcgplayerFor(e) : undefined;
  const src = tcg ?? api;
  const range = { min: Math.min(src?.min ?? best.brl, best.brl), avg: best.brl, max: Math.max(src?.max ?? best.brl, best.brl) };
  // Na TCGplayer, a mediana abaixo do mercado (ou o menor anúncio acima dele) vira o próprio mercado na faixa: a carta
  // soma o mercado e é chamada por ele (o valor é o mesmo; muda só o nome).
  const chosen = e.valueBasis ?? 'avg';
  const pick: ValueBasis = tcg && !tcgplayerColumns(tcg).includes(chosen) ? 'avg' : chosen;
  // Preço da carta base para uma versão especial, ou MYP numa carta em inglês sem preço na TCGplayer: aproximado.
  const approx: ApproxReason | undefined = tcg
    ? tcg.base
      ? 'base'
      : undefined
    : api
      ? !mypApiFitsVariant(e, api)
        ? 'base'
        : e.lang === 'en'
          ? 'otherLanguages'
          : undefined
      : undefined;
  return {
    value: range[pick],
    range,
    pick,
    confidence: best.id === 'manual' ? 'alta' : approx ? 'baixa' : 'media',
    approx,
    basis: best.id,
    sources: all.map((r) => ({ ...r, used: r === best })),
  };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa' };

/** De qual fonte é a faixa do valor (para os rótulos); "Meu valor" e carta sem preço não têm faixa. */
export function rangeSource(v: Pick<Valuation, 'basis'>): 'myp' | 'tcgplayer' | undefined {
  return v.basis === 'myp' || v.basis === 'tcgplayer' ? v.basis : undefined;
}

/**
 * Rótulos da faixa conforme a fonte do valor: no MYP, "Menor anúncio · Média dos anúncios · Maior anúncio"; na
 * TCGplayer, "Menor anúncio · Mercado · Mediana". Sem fonte (Meu valor), undefined.
 */
export function rangeLabels(v: Pick<Valuation, 'basis'>): Record<ValueBasis, string> | undefined {
  const s = rangeSource(v);
  return s ? rangeLabelsOf(s) : undefined;
}

/** Nome completo do preço escolhido na carta: "Média dos anúncios no MYP Cards", "Valor de mercado na TCGplayer…". */
export function pickLabel(v: Pick<Valuation, 'basis' | 'pick'>) {
  if (v.basis === 'manual') return SOURCE_NAME.manual;
  const s = rangeSource(v);
  return s ? RANGE_LABELS[s][v.pick ?? 'avg'].long : '';
}

/** Motivo do "≈ Aproximado" em texto, ou "" quando o valor é exato. */
export function approxText(v: Pick<Valuation, 'approx'>) {
  return v.approx ? APPROX_REASON[v.approx] : '';
}

/**
 * Carta em inglês avaliada pela TCGplayer cuja média fica longe da média dos anúncios do MYP no Brasil (fora de 0,67×
 * a 1,5×): a tela explica a diferença ("Preço dos EUA convertido em reais…"), sem mudar a fonte nem estimar nada.
 */
export function usPriceGap(e: Entry, v: Valuation = valuation(e)) {
  if (v.basis !== 'tcgplayer' || !v.range) return undefined;
  const api = mypApiFor(e);
  if (api?.avg == null || api.avg <= 0) return undefined;
  const ratio = v.range.avg / api.avg;
  if (ratio >= 0.67 && ratio <= 1.5) return undefined;
  return { min: api.min, avg: api.avg, max: api.max, qty: api.qty, url: api.url, ratio };
}
