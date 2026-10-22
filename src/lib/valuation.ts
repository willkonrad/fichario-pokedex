import { LANG_LABEL, VARIANTS, type CardLang, type Entry, type MypApiPrice, type MypCondition, type MypOffers } from './types';

/**
 * Valor da carta (em reais). Na ordem:
 *
 *   1. "Meu valor" digitado pelo usuário: o único valor fixo. Quando a média do MYP passa dele, ele é apagado e a
 *      carta volta a usar o MYP (ver myValuePatch);
 *   2. a menor oferta no MYP no ESTADO, IDIOMA e VERSÃO da carta (função myp-scan, quando o MYP liberar esse dado);
 *   3. a MÉDIA dos anúncios do produto no MYP Cards (API pública do MYP; mostrada com o mínimo e o máximo) —
 *      confiança média, porque junta todos os estados e idiomas;
 *   4. sem preço no MYP: a mediana de VENDAS REAIS no estado e idioma da carta — confiança média com 3 ou mais
 *      vendas, baixa com só 1 ou 2;
 *   5. sem a média do MYP (ainda não buscada, ou carta não achada na API): o menor anúncio geral (via Zukan) — confiança
 *      baixa, porque costuma ser de uma carta danificada ou de outro idioma.
 *
 * O valor (média) é o que entra nos totais da coleção e no gráfico de rendimento. Sem nenhum desses, a carta fica sem
 * valor (melhor do que mostrar um preço de outra fonte).
 */

export type SourceId = 'manual' | 'mypOffer' | 'myp' | 'sold' | 'zukan';

/** Com menos que isto de vendas no estado, o valor das vendas reais é só uma referência inicial (confiança baixa). */
const FIRM_SALES = 3;

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

/** Nenhuma fonte de preço foi consultada ainda para esta carta. */
export function pricePending(e: Entry) {
  return !e.myp?.checkedAt && !e.sold?.checkedAt && !e.mypOffers?.checkedAt && !e.mypApi?.checkedAt;
}

/** Estado do app → estado no MYP (o MYP não tem "M"; "D" lá é "DM"). */
export function mypCondition(condition: string): MypCondition {
  return condition === 'M' ? 'NM' : condition === 'D' ? 'DM' : (condition as MypCondition);
}

/** A leitura das ofertas do MYP é desta carta, idioma e versão (senão o servidor ainda vai ler de novo)? */
export function mypScanFor(e: Entry): MypOffers | undefined {
  const s = e.mypOffers;
  const note = e.variant === 'wPromo' || e.variant === 'staff' ? (e.variantNote ?? '') : '';
  if (!s?.checkedAt || s.cardId !== e.cardId || s.lang !== e.lang || s.variant !== e.variant || (s.note ?? '') !== note) return undefined;
  return s;
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
  myp: 'MYP Cards · média',
  sold: 'Vendas reais',
  zukan: 'MYP Cards · menor anúncio',
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Fontes disponíveis para a carta, na ordem de prioridade. */
export function priceSources(e: Entry): Omit<SourceRow, 'used'>[] {
  const rows: Omit<SourceRow, 'used'>[] = [];
  if (e.myValue?.value != null) {
    rows.push({ id: 'manual', label: SOURCE_LABEL.manual, brl: e.myValue.value, detail: 'digitado por você' });
  }
  // Menor oferta no MYP no estado, idioma e versão da carta (quando o MYP liberar esse dado).
  const scan = mypScanFor(e);
  const offer = scan?.byCondition?.[mypCondition(e.condition)];
  if (offer) {
    const version = VARIANTS.find((v) => v.id === e.variant)?.label ?? e.variant;
    rows.push({
      id: 'mypOffer',
      label: `MYP Cards · ${mypCondition(e.condition)}`,
      brl: offer.min,
      detail: `menor oferta em ${mypCondition(e.condition)}, ${LANG_LABEL[e.lang as CardLang]?.toLowerCase() ?? e.lang}, ${version.toLowerCase()} (${offer.count} un.)`,
    });
  }
  // Média dos anúncios do produto no MYP (API pública), com mínimo e máximo.
  const api = mypApiFor(e);
  const usableApi = api?.avg != null && mypApiFitsVariant(e, api);
  if (api?.avg != null && usableApi) {
    const parts = [
      api.min != null ? `mín ${brl(api.min)}` : null,
      api.max != null ? `máx ${brl(api.max)}` : null,
      api.qty != null ? `${api.qty} un. à venda` : null,
    ].filter(Boolean);
    rows.push({ id: 'myp', label: SOURCE_LABEL.myp, brl: api.avg, detail: `${parts.join(' · ')} (todos os estados e idiomas)` });
  }
  // Vendas reais no estado da carta (o site já separa por idioma: cada idioma é uma página), só se forem da
  // mesma variação da carta.
  const sold = soldMatchesVariant(e.variant, e.sold?.variant) ? e.sold?.byCondition?.[e.condition] : undefined;
  if (sold?.value != null) {
    rows.push({
      id: 'sold',
      label: SOURCE_LABEL.sold,
      brl: sold.value,
      detail: `${sold.count} ${sold.count === 1 ? 'venda finalizada' : 'vendas finalizadas'} em ${e.condition}${sold.count < FIRM_SALES ? ' · poucas vendas' : ''}`,
    });
  }
  // Menor anúncio geral (Zukan): só sem a média do MYP (ainda não buscada, ou carta não achada na API).
  if (!usableApi && e.myp?.price != null && mypFitsVariant(e.variant)) {
    rows.push({ id: 'zukan', label: SOURCE_LABEL.zukan, brl: e.myp.price, detail: 'menor anúncio de qualquer estado (provisório)' });
  }
  return rows;
}

/** Confiança de cada fonte quando ela define o valor. */
function confidenceOf(r: Omit<SourceRow, 'used'>): Confidence {
  if (r.id === 'sold') return /poucas vendas/.test(r.detail ?? '') ? 'baixa' : 'media';
  if (r.id === 'myp') return 'media';
  if (r.id === 'zukan') return 'baixa';
  return 'alta';
}

/** Valor da carta (ver comentário do módulo): a primeira fonte disponível, na ordem de prioridade. */
export function valuation(e: Entry): Valuation {
  const all = priceSources(e);
  const best = all[0];
  if (!best) return { sources: [] };
  return {
    value: best.brl,
    confidence: confidenceOf(best),
    basis: best.id,
    sources: all.map((r) => ({ ...r, used: r === best })),
  };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa' };
