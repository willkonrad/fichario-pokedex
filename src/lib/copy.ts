// Vocabulário do valor, num lugar só: todas as telas usam estes nomes e textos (nenhuma regra de preço mora aqui).

import { formatBRL, formatBRLShort, formatBRLTight, formatDay, formatInt, formatPct, formatRate, formatUSD, formatWhen } from './format';
import type { ValueBasis } from './types';
import type { ApproxReason, SourceId, Valuation } from './valuation';

export const MYP_URL = 'https://mypcards.com';
export const TCGPLAYER_URL = 'https://www.tcgplayer.com';
export const TCGCSV_URL = 'https://tcgcsv.com';

/** Nome de cada fonte do valor. */
export const SOURCE_NAME: Record<SourceId, string> = {
  manual: 'Meu valor',
  tcgplayer: 'TCGplayer (EUA)',
  myp: 'MYP Cards',
};

/** "Valor" sempre com o escopo: de uma carta, do fichário aberto ou da coleção inteira. */
export const VALUE_SCOPE = {
  card: 'Valor da carta',
  binder: 'Valor deste fichário',
  collection: 'Valor da coleção',
} as const;

/** "Valor da coleção · 3 fichários" (o Pokédex conta como fichário). */
export function collectionValueLabel(binderCount: number) {
  return binderCount > 1 ? `${VALUE_SCOPE.collection} · ${binderCount} fichários` : VALUE_SCOPE.collection;
}

/** Rodapé da estante: "Total da coleção R$ 5.779". */
export function collectionTotalText(value: number) {
  return `Total da coleção ${formatBRLTight(value)}`;
}

/** De onde é a faixa de preços: de uma fonte (na carta) ou a soma da coleção. */
export type RangeSource = 'myp' | 'tcgplayer' | 'total';

/**
 * Rótulos verdadeiros da faixa, por fonte: `short` nas colunas, `long` para leitor de tela e detalhes. Na TCGplayer,
 * o "mínimo" é o menor anúncio, a "média" é o valor de mercado (vendas recentes) e o "máximo" é a mediana dos anúncios
 * (quando um deles cai do lado errado do mercado, a coluna some: ver tcgplayerColumns).
 */
export const RANGE_LABELS: Record<RangeSource, Record<ValueBasis, { short: string; long: string }>> = {
  myp: {
    min: { short: 'Menor anúncio', long: 'Menor anúncio no MYP Cards' },
    avg: { short: 'Média dos anúncios', long: 'Média dos anúncios no MYP Cards' },
    max: { short: 'Maior anúncio', long: 'Maior anúncio no MYP Cards' },
  },
  tcgplayer: {
    min: { short: 'Menor anúncio', long: 'Menor anúncio na TCGplayer' },
    avg: { short: 'Mercado', long: 'Valor de mercado na TCGplayer (vendas recentes)' },
    max: { short: 'Mediana', long: 'Mediana dos anúncios na TCGplayer' },
  },
  total: {
    min: { short: 'Pelo menor anúncio', long: 'Se cada carta saísse pelo menor anúncio' },
    avg: { short: 'Pela média', long: 'Se cada carta saísse pela média (o mercado, nas cartas em inglês)' },
    max: { short: 'Pelo maior anúncio', long: 'Soma dos anúncios mais caros, que não é preço de venda' },
  },
};

/** Rótulos curtos da faixa de uma fonte: { min: "Menor anúncio", avg: "Mercado", … }. */
export function rangeLabelsOf(source: RangeSource): Record<ValueBasis, string> {
  const l = RANGE_LABELS[source];
  return { min: l.min.short, avg: l.avg.short, max: l.max.short };
}

/** O seletor de cada carta: qual dos três preços entra na soma. */
export const USE_IN_SUM = 'Usar na soma';
/** Legenda da coluna escolhida. */
export const IN_SUM = 'na soma';

/**
 * Base do valor da carta quando não é a padrão, para mostrar embaixo do valor (Mais valiosas, listas):
 * "pelo menor anúncio", "pela mediana", "✎ Meu valor". Na média (padrão), nada.
 */
export function basisNote(v: Pick<Valuation, 'basis' | 'pick'>) {
  if (v.basis === 'manual') return `✎ ${SOURCE_NAME.manual}`;
  if (v.pick === 'min') return 'pelo menor anúncio';
  if (v.pick === 'max') return v.basis === 'tcgplayer' ? 'pela mediana dos anúncios' : 'pelo maior anúncio';
  return '';
}

/**
 * Marca da confiança, só quando acrescenta informação (sem ponto colorido): nada no caso comum, "≈ Aproximado" quando o
 * preço não é exatamente o desta carta e "✎ Meu valor" no valor digitado.
 */
export function valueMark(v: Pick<Valuation, 'basis' | 'approx'>): { mark: '' | '≈' | '✎'; label: string; reason: string } {
  if (v.basis === 'manual') return { mark: '✎', label: SOURCE_NAME.manual, reason: 'digitado por você' };
  if (v.approx) return { mark: '≈', label: 'Aproximado', reason: APPROX_REASON[v.approx] };
  return { mark: '', label: '', reason: '' };
}

export const APPROX_REASON: Record<ApproxReason, string> = {
  base: 'preço da carta base: esta versão não é vendida à parte',
  otherLanguages: 'sem preço na TCGplayer: anúncios do MYP Cards, de todos os idiomas',
};

/** "43 anúncios", "1 anúncio". */
export function offersText(qty: number) {
  return `${formatInt(qty)} ${qty === 1 ? 'anúncio' : 'anúncios'}`;
}

/** Conta da TCGplayer: "US$ 7,87 × PTAX 5,0383 de 22/10". */
export function usdConversionText(p: { usdMarket?: number; fx?: number; fxDay?: string }) {
  return `${formatUSD(p.usdMarket)} × PTAX ${formatRate(p.fx)}${p.fxDay ? ` de ${formatDay(p.fxDay)}` : ''}`;
}

/** Uma fonte na linha de créditos ("Preços: MYP Cards ↗ (41) · TCGplayer ↗ (5) · Meu valor (2)"). */
export type SourceCredit = { id: SourceId; label: string; count: number; url?: string };

/**
 * Fontes que formam o valor, com quantas cartas cada uma avalia. O MYP Cards aparece sempre (a atribuição com link é
 * obrigatória onde há preço dele); a TCGplayer e o Meu valor, só quando avaliam alguma carta.
 */
export function sourceCredits(byBasis: Record<SourceId, number>): SourceCredit[] {
  const out: SourceCredit[] = [{ id: 'myp', label: 'MYP Cards', count: byBasis.myp, url: MYP_URL }];
  if (byBasis.tcgplayer > 0) out.push({ id: 'tcgplayer', label: 'TCGplayer', count: byBasis.tcgplayer, url: TCGPLAYER_URL });
  if (byBasis.manual > 0) out.push({ id: 'manual', label: SOURCE_NAME.manual, count: byBasis.manual });
  return out;
}

/** A linha de créditos em texto corrido (leitor de tela): "Preços: MYP Cards (41) · TCGplayer (5) · Meu valor (2)". */
export function sourceCreditsText(byBasis: Record<SourceId, number>) {
  return `Preços: ${sourceCredits(byBasis)
    .map((c) => (c.count ? `${c.label} (${c.count})` : c.label))
    .join(' · ')}`;
}

/** "5 cartas em inglês pelo preço dos EUA". */
export function englishByUsText(count: number) {
  return `${count} ${count === 1 ? 'carta em inglês' : 'cartas em inglês'} pelo preço dos EUA`;
}

/**
 * Como a soma foi feita (a escolha de cada carta fica visível): "Soma do valor de cada carta: média em 46, menor
 * anúncio em 7, Meu valor em 2".
 */
export function pickSummary(byPick: Record<ValueBasis | 'manual', number>) {
  const parts = [
    byPick.avg ? `média em ${byPick.avg}` : null,
    byPick.min ? `menor anúncio em ${byPick.min}` : null,
    byPick.max ? `maior anúncio em ${byPick.max}` : null,
    byPick.manual ? `Meu valor em ${byPick.manual}` : null,
  ].filter(Boolean);
  return parts.length ? `Soma do valor de cada carta: ${parts.join(', ')}` : '';
}

/**
 * As somas dos extremos com outro nome e menos peso que o valor: "Se cada carta saísse pelo menor anúncio R$ 3.816 ·
 * pela média R$ 6.903". A soma dos maiores anúncios fica só em "Como calculamos".
 */
export function totalsRangeText(t: { min: number; avg: number }) {
  return `Se cada carta saísse pelo menor anúncio ${formatBRLTight(t.min)} · pela média ${formatBRLTight(t.avg)}`;
}

/** A soma dos maiores anúncios, com o aviso. */
export function maxSumText(max: number) {
  return `Soma dos maiores anúncios ${formatBRLTight(max)}: são os anúncios mais caros, não é preço de venda.`;
}

/**
 * Carta em inglês cujo preço dos EUA fica longe dos anúncios daqui (ver usPriceGap em valuation.ts): explica a
 * diferença sem mudar o valor.
 */
export function usPriceGapText(gap: { min?: number; max?: number; avg: number }) {
  const range = gap.min != null && gap.max != null && gap.max - gap.min >= 0.005 ? `vão de ${formatBRLShort(gap.min)} a ${formatBRLShort(gap.max)}` : `têm média de ${formatBRLShort(gap.avg)}`;
  return `Preço dos EUA convertido em reais. No Brasil, os anúncios desta carta (todos os idiomas) ${range} no MYP Cards.`;
}

/** Atalhos do "Meu valor" no quadro de preço. */
export const SET_MY_VALUE = '✎ Definir meu valor';
export const USE_MY_VALUE = '✎ Usar meu valor';
/** Dica de uma linha no campo "Meu valor". */
export const MY_VALUE_HINT = 'Opcional · vale até o mercado passar dele';
/** A regra do "Meu valor", para a folha de explicação. */
export const MY_VALUE_RULE =
  'Seu valor vale até a média da fonte passar dele (a média dos anúncios no MYP Cards; nas cartas em inglês, o valor de ' +
  'mercado na TCGplayer). Aí o app avisa você e a carta volta ao preço escolhido em "Usar na soma", que pode ser menor ' +
  'que o seu valor (ex.: o menor anúncio). Um valor digitado abaixo dessa média é trocado na próxima atualização do preço.';

/**
 * Carta em inglês com o preço dos EUA acima do daqui (usPriceGap): um "Meu valor" com o preço daqui ficaria abaixo do
 * mercado e seria trocado na próxima cópia da TCGplayer, então o quadro explica em vez de oferecer o atalho.
 */
export const MY_VALUE_BELOW_US = 'Um Meu valor menor que o mercado da TCGplayer não fica: o app volta ao preço dos EUA na próxima atualização, todo dia.';

/** De onde veio a média que apagou o "Meu valor" ("a média do MYP"; sem o artigo, "média do MYP"). */
function replacedSource(source?: 'myp' | 'tcgplayer', article = true) {
  const name = source === 'tcgplayer' ? 'mercado da TCGplayer' : 'média do MYP';
  return article ? `${source === 'tcgplayer' ? 'o' : 'a'} ${name}` : name;
}

/** "Meu valor" digitado abaixo da média da fonte (myValueBelowSource): "Menor que a média do MYP (R$ 60,00): …". */
export function myValueBelowText(t: { avg: number; source: 'myp' | 'tcgplayer' }) {
  return `Menor que ${replacedSource(t.source)} (${formatBRL(t.avg)}): o app troca este valor na próxima atualização do preço.`;
}

/** Valor da carta depois da troca, quando não é a média (ex.: "Usar na soma" no menor anúncio): o valor e o nome. */
type ReplacedNow = Pick<Valuation, 'value' | 'basis' | 'pick'>;
function replacedNow(now?: ReplacedNow) {
  if (now?.value == null || now.basis === 'manual') return undefined;
  const note = basisNote(now);
  return note ? { value: now.value, note } : undefined;
}

/**
 * Na carta: "Seu valor de R$ 40,00 foi trocado em 20/10, 06:05: a média do MYP passou dele (R$ 52,00)." Com `now` (o
 * valor atual da carta) fora da média, diz também quanto ela vale agora ("Agora a carta vale R$ 30,00, pelo menor
 * anúncio…"), porque pode ser menos que o valor digitado.
 */
export function myValueReplacedText(r: { value: number; mypValue: number; at: string; source?: 'myp' | 'tcgplayer' }, now?: ReplacedNow) {
  const text = `Seu valor de ${formatBRL(r.value)} foi trocado em ${formatWhen(r.at)}: ${replacedSource(r.source)} passou dele (${formatBRL(r.mypValue)}).`;
  const n = replacedNow(now);
  return n ? `${text} Agora a carta vale ${formatBRL(n.value)}, ${n.note}, como escolhido em "${USE_IN_SUM}".` : text;
}

/**
 * Aviso da coleção quando o mercado passa de valores digitados: "Charizard passou do seu valor: seu R$ 40 → média do
 * MYP R$ 52" ou "2 cartas passaram do seu valor: Charizard (seu R$ 40 → R$ 52), Gengar (…)". Com `now` (o valor atual
 * da carta) fora da média, a seta leva a ele: "seu R$ 75 → R$ 50 pelo menor anúncio (média do MYP R$ 163)".
 */
export function myValueReplacedNotice(list: { cardName: string; value: number; mypValue: number; source?: 'myp' | 'tcgplayer'; now?: ReplacedNow }[]) {
  if (!list.length) return '';
  if (list.length === 1) {
    const r = list[0];
    const n = replacedNow(r.now);
    const trigger = `${replacedSource(r.source, false)} ${formatBRLShort(r.mypValue)}`;
    return n
      ? `${r.cardName} passou do seu valor: seu ${formatBRLShort(r.value)} → ${formatBRLShort(n.value)} ${n.note} (${trigger})`
      : `${r.cardName} passou do seu valor: seu ${formatBRLShort(r.value)} → ${trigger}`;
  }
  const shown = list.slice(0, 3).map((r) => {
    const n = replacedNow(r.now);
    return `${r.cardName} (seu ${formatBRLShort(r.value)} → ${n ? `${formatBRLShort(n.value)} ${n.note}` : formatBRLShort(r.mypValue)})`;
  });
  return `${list.length} cartas passaram do seu valor: ${shown.join(', ')}${list.length > 3 ? '…' : ''}`;
}

/** Idade dos preços: "Preços de 15/10 a 22/10" (ou de um dia só) e, se houver, as cartas com preço velho. */
export function freshnessText(f: { newest?: string; oldest?: string; stale?: number }) {
  if (!f.newest) return '';
  const from = f.oldest ? formatDay(f.oldest) : undefined;
  const to = formatDay(f.newest);
  const span = from && from !== to ? `Preços de ${from} a ${to}` : `Preços de ${to}`;
  return f.stale ? `${span} · ${staleText(f.stale)}` : span;
}

/** "3 cartas com preço de mais de 7 dias". */
export function staleText(count: number) {
  return `${count} ${count === 1 ? 'carta' : 'cartas'} com preço de mais de 7 dias`;
}

/** Variação do valor: "▲ R$ 52 (1,2%) em 7 dias" (ou "desde 15/10"). */
export function changeText(c: { diff: number; pct?: number | null; days?: number; since?: string }) {
  const arrow = c.diff > 0.005 ? '▲' : c.diff < -0.005 ? '▼' : '=';
  const pct = c.pct != null && Number.isFinite(c.pct) ? ` (${formatPct(Math.abs(c.pct))})` : '';
  const when = c.days ? ` em ${c.days} ${c.days === 1 ? 'dia' : 'dias'}` : c.since ? ` desde ${formatDay(c.since)}` : '';
  return `${arrow} ${formatBRLShort(Math.abs(c.diff))}${pct}${when}`;
}

/**
 * Cartas que entraram e saíram no período (fora da variação): "+3 cartas novas · 2 ganharam preço · −1 removida · 2
 * trocadas".
 */
export function cardsDeltaText(d: { added: number; removed: number; changed?: number; priced?: number }) {
  return [
    d.added ? `+${d.added} ${d.added === 1 ? 'carta nova' : 'cartas novas'}` : null,
    d.priced ? `${d.priced} ${d.priced === 1 ? 'ganhou preço' : 'ganharam preço'}` : null,
    d.removed ? `−${d.removed} ${d.removed === 1 ? 'removida' : 'removidas'}` : null,
    d.changed ? `${d.changed} ${d.changed === 1 ? 'trocada' : 'trocadas'} ou com outra fonte` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Total pago × valor atual das cartas compradas: "Pagou R$ 1.200 · vale R$ 1.530 (+27,5%)". */
export function purchaseText(p: { paid: number; current: number; pct?: number | null }) {
  const pct = p.pct != null && Number.isFinite(p.pct) ? ` (${formatPct(p.pct, { sign: true })})` : '';
  return `Pagou ${formatBRLTight(p.paid)} · vale ${formatBRLTight(p.current)}${pct}`;
}

/** Na web, cartas que esperam o preço do MYP Cards (só o app no celular consulta o MYP). */
export const MYP_ON_PHONE = 'Os preços do MYP Cards são buscados pelo app no celular; abra o app para atualizar.';

/** Data em que a regra de preço atual entrou em vigor (versão 2.8.0); o histórico do valor começa nela. */
export const PRICE_RULE_SINCE = '2026-10-22';

/**
 * "Como calculamos o valor": tópicos curtos para a folha de explicação (InfoSheet) e para a tela Sobre. Cada tela
 * fica só com uma linha de crédito e um ⓘ que abre isto.
 */
export const HOW_WE_CALCULATE: { title: string; since: string; topics: { title: string; body: string }[] } = {
  title: 'Como calculamos o valor',
  since: PRICE_RULE_SINCE,
  topics: [
    {
      title: 'De onde vem o preço',
      body:
        'Cartas em português: menor anúncio, média e maior anúncio do MYP Cards, que juntam todos os estados e idiomas. ' +
        'Cartas em inglês: TCGplayer (EUA), convertida em reais pela PTAX do Banco Central.',
    },
    {
      title: 'Qual número entra na soma',
      body:
        'A média, a não ser que você escolha outro em "Usar na soma" na carta. O menor anúncio costuma ser o valor real de ' +
        'cartas novas; a média, o das antigas. Na TCGplayer, a média é o valor de mercado (vendas recentes).',
    },
    { title: 'Meu valor', body: MY_VALUE_RULE },
    {
      title: '≈ Aproximado',
      body:
        'Quando a versão (selo, Poké Ball…) não é vendida à parte, usamos o preço da carta base, que costuma ser parecido. ' +
        'Carta em inglês sem preço na TCGplayer usa os anúncios do MYP Cards, de todos os idiomas.',
    },
    {
      title: 'Maior anúncio',
      body: 'A soma dos maiores anúncios mostra o teto do que está anunciado, não o preço de venda: um anúncio caro demais puxa esse número.',
    },
    {
      title: 'O que o app não faz',
      body: 'O app não estima preço nem dá desconto pelo estado da carta. Sem anúncio, a carta fica sem valor até você preencher "Meu valor".',
    },
    {
      title: 'Atualização',
      body:
        'O MYP Cards é consultado pelo app no celular (cada carta, uma vez por semana). A TCGplayer é copiada uma vez por dia. ' +
        'O histórico do valor é gravado todo dia às 23:50.',
    },
  ],
};

/** Crédito das fontes (tela Sobre, rodapés). */
export const PRICE_CREDITS = 'Preços do MYP Cards (mypcards.com) e da TCGplayer, via TCGCSV. Câmbio: PTAX do Banco Central.';
