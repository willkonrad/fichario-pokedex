import type { Entry } from './types';

/**
 * Valor da carta (em reais), só com preços do MYP Cards (https://mypcards.com):
 *
 *   1. "Meu valor" digitado pelo usuário, quando existe;
 *   2. senão, a menor oferta no MYP no ESTADO e IDIOMA da carta (API do MYP, quando disponível);
 *   3. senão, o menor anúncio no MYP no idioma da carta (via Zukan) — vale para qualquer estado, então
 *      pode ficar abaixo do preço de uma carta NM; por isso tem confiança média.
 *
 * Sem nenhum desses, a carta fica sem valor (melhor do que mostrar um preço de outra fonte).
 */

export type SourceId = 'manual' | 'mypOffer' | 'myp';
export type Confidence = 'alta' | 'media' | 'baixa';

export type SourceRow = {
  id: SourceId;
  label: string;
  /** Valor em reais. */
  brl: number;
  /** É o valor da carta. */
  used: boolean;
  /** Detalhe curto: "menor oferta NM em português"… */
  detail?: string;
};

export type Valuation = {
  value?: number;
  confidence?: Confidence;
  /** De onde veio o valor. */
  basis?: SourceId;
  sources: SourceRow[];
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  manual: 'Meu valor',
  mypOffer: 'MYP Cards · seu estado',
  myp: 'MYP Cards',
};

/** Fontes disponíveis para a carta, na ordem de prioridade. */
export function priceSources(e: Entry): Omit<SourceRow, 'used'>[] {
  const rows: Omit<SourceRow, 'used'>[] = [];
  if (e.myValue?.value != null) {
    rows.push({ id: 'manual', label: SOURCE_LABEL.manual, brl: e.myValue.value, detail: 'digitado por você' });
  }
  // Menor oferta no estado e idioma (só vale se o estado/idioma ainda forem os da carta).
  const offers = e.mypOffers;
  if (offers?.min != null && offers.condition === e.condition && offers.lang === e.lang) {
    rows.push({
      id: 'mypOffer',
      label: `MYP Cards · ${e.condition}`,
      brl: offers.min,
      detail: `menor oferta no seu estado e idioma (${offers.count} ${offers.count === 1 ? 'oferta' : 'ofertas'})`,
    });
  }
  if (e.myp?.price != null) {
    rows.push({
      id: 'myp',
      label: SOURCE_LABEL.myp,
      brl: e.myp.price,
      detail: e.lang === 'en' ? 'menor anúncio NM em inglês' : 'menor anúncio no idioma (qualquer estado)',
    });
  }
  return rows;
}

const CONFIDENCE_BY_SOURCE: Record<SourceId, Confidence> = { manual: 'alta', mypOffer: 'alta', myp: 'media' };

/** Valor da carta (ver comentário do módulo): a primeira fonte disponível, na ordem de prioridade. */
export function valuation(e: Entry): Valuation {
  const all = priceSources(e);
  const best = all[0];
  if (!best) return { sources: [] };
  return {
    value: best.brl,
    confidence: CONFIDENCE_BY_SOURCE[best.id],
    basis: best.id,
    sources: all.map((r) => ({ ...r, used: r === best })),
  };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa' };
