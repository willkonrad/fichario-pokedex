import type { Entry } from './types';

/**
 * Valor de referência da carta (em reais), no padrão do mercado brasileiro:
 *
 *   1. "Meu valor" digitado pelo usuário, quando existe;
 *   2. senão, a MENOR OFERTA NO MYP no estado e idioma da carta (lista de ofertas, atualizada toda semana);
 *   3. senão, o MENOR ANÚNCIO NA LIGA no acabamento da carta — a não ser que as fontes brasileiras
 *      (vendas reais, MYP, CardTrader) concordem num valor acima dele (2+ fontes ou 3+ vendas): aí vale o
 *      que elas indicam, porque o mínimo da Liga provavelmente é uma cópia jogada;
 *   4. sem Liga, a mediana ponderada das outras fontes (descartando as fora da curva).
 *
 * As outras fontes conferem o valor da Liga e definem a confiança:
 *
 *   sold       — mediana de VENDAS REAIS no idioma e estado da carta ("Quanto vale minha carta?")
 *   myp        — menor anúncio no MYP Cards, no idioma da carta (via Zukan)
 *   cardtrader — menor anúncio no CardTrader, no estado e idioma da carta (API oficial)
 *   tcgplayer  — preço de mercado nos EUA (US$ → R$)
 *   cardmarket — média de 30 dias na Europa (€ → R$)
 *
 * O menor anúncio da Liga vale para qualquer estado: se as outras fontes indicam um valor bem mais alto
 * (mais de 2,5×), ele provavelmente é de uma carta jogada ou danificada — o valor fica marcado como
 * "suspeito" (confiança baixa) para o usuário conferir na Liga e preencher "Meu valor".
 */

export type SourceId = 'manual' | 'mypOffer' | 'liga' | 'myp' | 'sold' | 'cardtrader' | 'tcgplayer' | 'cardmarket';
export type Confidence = 'alta' | 'media' | 'baixa';

export type SourceRow = {
  id: SourceId;
  label: string;
  /** Valor em reais (já convertido). */
  brl: number;
  /** Valor na moeda original, quando não é real (ex.: "US$ 17,19"). */
  original?: string;
  weight: number;
  /** É o valor da carta (manual ou Liga) ou entrou na mediana (sem Liga). */
  used: boolean;
  /** Detalhe curto: "8 vendas em NM", "menor NM em inglês"… */
  detail?: string;
};

export type Valuation = {
  value?: number;
  confidence?: Confidence;
  /** Como o valor foi definido: digitado, menor anúncio da Liga ou mediana das fontes. */
  basis?: 'manual' | 'mypOffer' | 'liga' | 'brasil' | 'median';
  /** Conferência das outras fontes (mediana ponderada), quando o valor vem da Liga. */
  check?: number;
  /** O menor anúncio da Liga está muito abaixo das outras fontes (provavelmente carta jogada/danificada). */
  suspect?: boolean;
  sources: SourceRow[];
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  manual: 'Meu valor',
  mypOffer: 'MYP Cards · seu estado',
  liga: 'Liga Pokémon',
  myp: 'MYP Cards',
  sold: 'Vendas reais',
  cardtrader: 'CardTrader',
  tcgplayer: 'TCGplayer',
  cardmarket: 'Cardmarket',
};

/** Acima de quantas vezes o menor anúncio da Liga as outras fontes tornam o mínimo suspeito. */
const SUSPECT_RATIO = 2.5;

const money = (v: number, prefix: string) => `${prefix} ${v.toFixed(2).replace('.', ',')}`;

/** Todas as fontes disponíveis para a carta, em reais (a Liga primeiro). */
export function priceSources(e: Entry): Omit<SourceRow, 'used'>[] {
  const rows: Omit<SourceRow, 'used'>[] = [];
  const fx = e.intl?.fx;

  // Menor oferta no MYP no estado e idioma da carta (só vale se o estado/idioma ainda forem os da carta).
  const offers = e.mypOffers;
  if (offers?.min != null && offers.condition === e.condition && offers.lang === e.lang) {
    rows.push({
      id: 'mypOffer',
      label: `MYP Cards · ${e.condition}`,
      brl: offers.min,
      weight: 1,
      detail: `menor oferta no seu estado e idioma (${offers.count} ${offers.count === 1 ? 'oferta' : 'ofertas'})`,
    });
  }

  const ligaMin = e.price?.min ?? e.price?.avg;
  if (ligaMin != null) rows.push({ id: 'liga', label: SOURCE_LABEL.liga, brl: ligaMin, weight: 1, detail: 'menor anúncio no acabamento' });

  const sold = e.sold?.byCondition?.[e.condition];
  if (sold?.value != null) {
    rows.push({
      id: 'sold',
      label: SOURCE_LABEL.sold,
      brl: sold.value,
      weight: sold.count >= 3 ? 2 : 1,
      detail: `${sold.count} ${sold.count === 1 ? 'venda' : 'vendas'} em ${e.condition}`,
    });
  }

  if (e.myp?.price != null) {
    rows.push({ id: 'myp', label: SOURCE_LABEL.myp, brl: e.myp.price, weight: 1, detail: e.lang === 'en' ? 'menor NM em inglês' : 'menor anúncio no idioma' });
  }

  const ct = e.intl?.cardtrader;
  if (ct?.min != null && fx) {
    const rate = ct.currency === 'USD' ? fx.usd : ct.currency === 'BRL' ? 1 : fx.eur;
    rows.push({
      id: 'cardtrader',
      label: SOURCE_LABEL.cardtrader,
      brl: ct.min * rate,
      original: money(ct.min, ct.currency === 'USD' ? 'US$' : ct.currency === 'BRL' ? 'R$' : '€'),
      weight: 1,
      detail: `menor ${ct.condition ?? ''} em ${(ct.language ?? '').toUpperCase()}`.trim(),
    });
  }

  const tp = e.intl?.tcgplayer;
  const tpValue = tp?.market ?? tp?.mid;
  if (tpValue != null && fx) {
    rows.push({ id: 'tcgplayer', label: SOURCE_LABEL.tcgplayer, brl: tpValue * fx.usd, original: money(tpValue, 'US$'), weight: 0.5, detail: 'mercado nos EUA' });
  }

  const cm = e.intl?.cardmarket;
  const cmValue = cm?.avg30 ?? cm?.trend ?? cm?.avg;
  if (cmValue != null && fx) {
    rows.push({ id: 'cardmarket', label: SOURCE_LABEL.cardmarket, brl: cmValue * fx.eur, original: money(cmValue, '€'), weight: 0.5, detail: 'média de 30 dias na Europa' });
  }
  return rows;
}

function weightedMedian(rows: { brl: number; weight: number }[]) {
  const sorted = [...rows].sort((a, b) => a.brl - b.brl);
  const total = sorted.reduce((s, r) => s + r.weight, 0);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i].weight;
    // Empate exato no meio (ex.: duas fontes de mesmo peso): média das duas, para não puxar para baixo.
    if (Math.abs(acc - total / 2) < 1e-9 && i + 1 < sorted.length) return (sorted[i].brl + sorted[i + 1].brl) / 2;
    if (acc > total / 2) return sorted[i].brl;
  }
  return sorted[sorted.length - 1]?.brl;
}

/** Mediana ponderada sem as fontes fora da curva (< 40% ou > 250% da primeira mediana). */
function robustMedian<T extends { brl: number; weight: number }>(rows: T[]) {
  const first = weightedMedian(rows)!;
  const inCurve = rows.filter((r) => r.brl >= first * 0.4 && r.brl <= first * 2.5);
  const keep = inCurve.length ? inCurve : rows;
  return { value: weightedMedian(keep)!, keep };
}

/** Valor de referência da carta (ver comentário do módulo). */
export function valuation(e: Entry): Valuation {
  const all = priceSources(e);

  // 1) Valor digitado pelo usuário: é o valor da carta; as fontes ficam só como referência.
  if (e.myValue?.value != null) {
    const manual: SourceRow = { id: 'manual', label: SOURCE_LABEL.manual, brl: e.myValue.value, weight: 1, used: true, detail: 'digitado por você' };
    return { value: e.myValue.value, confidence: 'alta', basis: 'manual', sources: [manual, ...all.map((r) => ({ ...r, used: false }))] };
  }
  if (!all.length) return { sources: [] };

  // 2) Menor oferta no MYP no estado e idioma: o preço exato da carta; as outras fontes ficam de referência.
  const offer = all.find((r) => r.id === 'mypOffer');
  if (offer) {
    const rest = all.filter((r) => r.id !== 'mypOffer');
    const check = rest.length ? robustMedian(rest).value : undefined;
    const ratio = check != null ? check / Math.max(0.01, offer.brl) : 1;
    const confidence: Confidence = (e.mypOffers?.count ?? 0) >= 2 && ratio >= 0.4 && ratio <= 2.5 ? 'alta' : 'media';
    return { value: offer.brl, confidence, basis: 'mypOffer', check, sources: all.map((r) => ({ ...r, used: r.id === 'mypOffer' })) };
  }

  const liga = all.find((r) => r.id === 'liga');
  const others = all.filter((r) => r.id !== 'liga');

  // 3) Menor anúncio na Liga, conferido pelas outras fontes.
  if (liga) {
    const sources = all.map((r) => ({ ...r, used: r.id === 'liga' }));
    if (!others.length) return { value: liga.brl, confidence: 'media', basis: 'liga', sources };
    const check = robustMedian(others).value;
    const ratio = check / Math.max(0.01, liga.brl);
    const suspect = ratio > SUSPECT_RATIO;
    const firmSold = others.some((r) => r.id === 'sold' && r.weight >= 2);
    const confidence: Confidence = suspect ? 'baixa' : ratio >= 0.5 && ratio <= 2 && (firmSold || others.length >= 2) ? 'alta' : 'media';

    // Fontes brasileiras (vendas reais, MYP, CardTrader) concordando num valor ACIMA do menor anúncio da Liga:
    // o mínimo da Liga é provavelmente uma cópia jogada; vale o que o mercado brasileiro indica.
    const br = others.filter((r) => r.id === 'sold' || r.id === 'myp' || r.id === 'cardtrader');
    const brFirm = br.length >= 2 || br.some((r) => r.id === 'sold' && r.weight >= 2);
    const brValue = br.length ? robustMedian(br).value : undefined;
    if (!suspect && brFirm && brValue != null && brValue > liga.brl && brValue <= liga.brl * SUSPECT_RATIO) {
      const used = new Set(robustMedian(br).keep);
      return {
        value: brValue,
        confidence: 'alta',
        basis: 'brasil',
        check,
        sources: all.map((r) => ({ ...r, used: used.has(r) })),
      };
    }
    return { value: liga.brl, confidence, basis: 'liga', check, suspect, sources };
  }

  // 4) Sem Liga: mediana ponderada das outras fontes.
  const { value, keep } = robustMedian(others);
  const sources = all.map((r) => ({ ...r, used: keep.includes(r) }));
  const firmSold = keep.some((r) => r.id === 'sold' && r.weight >= 2);
  const spread = Math.max(...keep.map((r) => r.brl)) / Math.max(0.01, Math.min(...keep.map((r) => r.brl)));
  const confidence: Confidence = firmSold || (keep.length >= 3 && spread <= 2) ? 'media' : 'baixa';
  return { value, confidence, basis: 'median', sources };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa' };
