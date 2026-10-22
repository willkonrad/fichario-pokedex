import type { Entry, MypApiPrice } from './types';

/**
 * Valor da carta (em reais). Só duas fontes:
 *
 *   1. "Meu valor" digitado pelo usuário: o único valor fixo (mínimo, média e máximo iguais a ele). Quando a média do
 *      MYP passa dele, ele é apagado e a carta volta a usar o MYP (ver myValuePatch);
 *   2. o MÍNIMO, a MÉDIA e o MÁXIMO dos anúncios do produto no MYP Cards (API pública do MYP), como a API informa —
 *      confiança média, porque juntam todos os estados e idiomas.
 *
 * A faixa (mín/méd/máx) é o valor da carta e entra nos totais da coleção e no gráfico de rendimento; a média é o ponto
 * do meio (ordena as mais valiosas e aparece nos bolsos). Sem nenhuma das duas fontes, a carta fica sem valor.
 */

export type SourceId = 'manual' | 'myp';

/**
 * Versões especiais (com selo, Poké Ball, Master Ball, 1ª edição, Shadowless) valem outra coisa que a versão comum:
 * preços do produto comum no MYP não entram no valor delas (só quando o MYP tem um produto próprio da versão).
 */
export const SPECIAL_VARIANTS = ['wPromo', 'staff', 'pokeball', 'masterball', 'firstEdition', 'shadowless', 'other'];
export function mypFitsVariant(variant: string) {
  return !SPECIAL_VARIANTS.includes(variant);
}

/** O MYP tem preço de cartas em português e inglês; japonês, não (as edições japonesas ficam de fora da API). */
export function mypCovers(lang: string) {
  return lang === 'pt' || lang === 'en';
}

/** O app ainda não buscou o preço desta carta (nesta versão e selo) no MYP. */
export function pricePending(e: Entry) {
  return mypCovers(e.lang) && !mypApiFor(e);
}

/** A busca na API do MYP é desta carta, versão e selo (senão o app ainda vai buscar de novo)? */
export function mypApiFor(e: Entry): MypApiPrice | undefined {
  const s = e.mypApi;
  const note = e.variant === 'wPromo' || e.variant === 'staff' ? (e.variantNote ?? '').trim() : '';
  if (!s?.checkedAt || s.cardId !== e.cardId || s.variant !== e.variant || (s.note ?? '') !== note) return undefined;
  return s;
}

/** Os preços do produto no MYP valem para a versão da carta? (produto comum só para as versões comuns) */
export function mypApiFitsVariant(e: Entry, s: MypApiPrice) {
  return !!s.ownVersion || mypFitsVariant(e.variant);
}

/**
 * "Meu valor" é fixo até a média do MYP passar dele: aí ele é apagado (fica o registro da troca, mostrado na tela da
 * carta) e a carta volta a usar mínimo/média/máximo do MYP.
 */
export function myValuePatch(e: Entry, s: MypApiPrice): Partial<Entry> {
  const mine = e.myValue?.value;
  if (mine == null || s.avg == null || !mypApiFitsVariant(e, s) || s.avg <= mine) return {};
  return { myValue: null, myValueReplaced: { value: mine, mypValue: s.avg, at: s.checkedAt } };
}

export type Confidence = 'alta' | 'media' | 'baixa';

export type SourceRow = {
  id: SourceId;
  label: string;
  /** Valor em reais. */
  brl: number;
  /** É o valor da carta. */
  used: boolean;
  /** Detalhe curto: "mín R$ 6,99 · máx R$ 60,00 · 21 un."… */
  detail?: string;
};

/** Mínimo, média e máximo do valor (com "Meu valor", os três são ele). */
export type ValueRange = { min: number; avg: number; max: number };

export type Valuation = {
  /** A média (ou o "Meu valor"). */
  value?: number;
  /** Mínimo, média e máximo: o valor da carta como o MYP informa. */
  range?: ValueRange;
  confidence?: Confidence;
  /** De onde veio o valor. */
  basis?: SourceId;
  sources: SourceRow[];
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  manual: 'Meu valor',
  myp: 'MYP Cards · mín/méd/máx',
};

/** A faixa tem mínimo e máximo diferentes (senão é um valor só, como o "Meu valor"). */
export function isSpread(r: ValueRange) {
  return r.max - r.min >= 0.005;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Fontes disponíveis para a carta, na ordem de prioridade. */
export function priceSources(e: Entry): Omit<SourceRow, 'used'>[] {
  const rows: Omit<SourceRow, 'used'>[] = [];
  if (e.myValue?.value != null) {
    rows.push({ id: 'manual', label: SOURCE_LABEL.manual, brl: e.myValue.value, detail: 'digitado por você' });
  }
  // Média dos anúncios do produto no MYP (API pública), com mínimo e máximo.
  const api = mypApiFor(e);
  if (api?.avg != null && mypApiFitsVariant(e, api)) {
    const parts = [
      api.min != null ? `mín ${brl(api.min)}` : null,
      api.max != null ? `máx ${brl(api.max)}` : null,
      api.qty != null ? `${api.qty} un. à venda` : null,
    ].filter(Boolean);
    rows.push({ id: 'myp', label: SOURCE_LABEL.myp, brl: api.avg, detail: `${parts.join(' · ')} (todos os estados e idiomas)` });
  }
  return rows;
}

/** Valor da carta (ver comentário do módulo): "Meu valor", senão mínimo/média/máximo do MYP. */
export function valuation(e: Entry): Valuation {
  const all = priceSources(e);
  const best = all[0];
  if (!best) return { sources: [] };
  const api = best.id === 'myp' ? mypApiFor(e) : undefined;
  return {
    value: best.brl,
    range: { min: Math.min(api?.min ?? best.brl, best.brl), avg: best.brl, max: Math.max(api?.max ?? best.brl, best.brl) },
    confidence: best.id === 'manual' ? 'alta' : 'media',
    basis: best.id,
    sources: all.map((r) => ({ ...r, used: r === best })),
  };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa' };
