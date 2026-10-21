import type { Entry } from './types';

/**
 * Valor da carta (em reais). A fonte principal é o MYP Cards (anúncios); o "Quanto vale minha carta?" (vendas reais
 * finalizadas e pagas) é a reserva, para cartas sem anúncio no MYP. Na ordem:
 *
 *   1. "Meu valor" digitado pelo usuário, quando existe;
 *   2. a menor oferta no MYP no ESTADO e IDIOMA da carta (API do MYP, quando disponível);
 *   3. o menor anúncio no MYP no idioma da carta (via Zukan), de qualquer estado — confiança média;
 *   4. sem anúncio no MYP: a mediana de VENDAS REAIS no estado e idioma da carta — confiança média com 3 ou mais
 *      vendas, baixa com só 1 ou 2 (podem ser antigas ou fora do padrão).
 *
 * Sem nenhum desses, a carta fica sem valor (melhor do que mostrar um preço de outra fonte).
 */

export type SourceId = 'manual' | 'mypOffer' | 'sold' | 'myp';

/** Com menos que isto de vendas no estado, o valor das vendas reais é só uma referência inicial (confiança baixa). */
const FIRM_SALES = 3;

/**
 * O preço do MYP que chega pelo Zukan é o da carta, sem separar versões: vale para a versão comum (normal, holo,
 * reverse). Versões especiais (com selo, Poké Ball, Master Ball, 1ª edição, Shadowless) valem outra coisa, então
 * esse preço não entra no valor delas.
 */
export const SPECIAL_VARIANTS = ['wPromo', 'staff', 'pokeball', 'masterball', 'firstEdition', 'shadowless', 'other'];
export function mypFitsVariant(variant: string) {
  return !SPECIAL_VARIANTS.includes(variant);
}

/** O MYP (via Zukan) tem preço de cartas em português e inglês; japonês, não. */
export function mypCovers(lang: string) {
  return lang === 'pt' || lang === 'en';
}

/**
 * Nomes de variação no "Quanto vale minha carta?" que correspondem a cada variação do app. O site precifica cada
 * variação separada e a página mostra a mais vendida; vendas de outra variação não servem como valor da carta.
 * Holo aceita "Normal" porque o site chama de Normal a impressão padrão de cartas que já nascem holo (ex.: "ex").
 */
const SOLD_VARIANTS: Record<string, string[]> = {
  normal: ['normal'],
  holo: ['normal', 'holo'],
  reverse: ['reverse holo', 'reverse'],
  pokeball: ['pokeball'],
  masterball: ['masterball'],
  firstEdition: ['1a edicao'],
  wPromo: ['carimbada', 'promo', 'carimbada + promo'],
  staff: ['carimbada', 'carimbada + promo'],
};
const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ª/g, 'a').trim();

/** As vendas reais gravadas (variação `soldVariant`) são da mesma variação da carta? Sem nome, assume que sim. */
export function soldMatchesVariant(variant: string, soldVariant?: string) {
  if (!soldVariant) return true;
  return (SOLD_VARIANTS[variant] ?? []).includes(plain(soldVariant));
}

/** O servidor ainda não consultou nenhuma fonte de preço para esta carta. */
export function pricePending(e: Entry) {
  return !e.myp?.checkedAt && !e.sold?.checkedAt;
}
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
  sold: 'Vendas reais',
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
  // Vendas reais no estado da carta (o site já separa por idioma: cada idioma é uma página), só se forem da
  // mesma variação da carta.
  const sold = soldMatchesVariant(e.variant, e.sold?.variant) ? e.sold?.byCondition?.[e.condition] : undefined;
  const soldRow =
    sold?.value != null
      ? {
          id: 'sold' as const,
          label: SOURCE_LABEL.sold,
          brl: sold.value,
          detail: `${sold.count} ${sold.count === 1 ? 'venda finalizada' : 'vendas finalizadas'} em ${e.condition}${sold.count < FIRM_SALES ? ' · poucas vendas' : ''}`,
        }
      : undefined;
  if (e.myp?.price != null && mypFitsVariant(e.variant)) {
    rows.push({
      id: 'myp',
      label: SOURCE_LABEL.myp,
      brl: e.myp.price,
      detail: e.myp.label?.replace(' no MYP Cards', '') ?? (e.lang === 'en' ? 'menor anúncio NM (inglês)' : 'menor anúncio (português)'),
    });
  }
  // Vendas reais: reserva, só valem quando o MYP não tem anúncio.
  if (soldRow) rows.push(soldRow);
  return rows;
}

/** Confiança de cada fonte quando ela define o valor. */
function confidenceOf(r: Omit<SourceRow, 'used'>, e: Entry): Confidence {
  if (r.id === 'sold') return /poucas vendas/.test(r.detail ?? '') ? 'baixa' : 'media';
  return r.id === 'myp' ? 'media' : 'alta';
}

/** Valor da carta (ver comentário do módulo): a primeira fonte disponível, na ordem de prioridade. */
export function valuation(e: Entry): Valuation {
  const all = priceSources(e);
  const best = all[0];
  if (!best) return { sources: [] };
  return {
    value: best.brl,
    confidence: confidenceOf(best, e),
    basis: best.id,
    sources: all.map((r) => ({ ...r, used: r === best })),
  };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa' };
