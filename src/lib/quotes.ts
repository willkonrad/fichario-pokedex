import { tcgplayerFor } from './tcgplayer';
import type { Entry, Origin, ValueBasis } from './types';
import { mypApiFor, pricePending, valuation, type SourceId } from './valuation';

// Totais da coleção (valor, faixa, compras, idade dos preços). Os formatadores moram em lib/format.ts; os de baixo
// continuam exportados daqui para as telas antigas.
export {
  /** @deprecated use formatBRL de lib/format.ts. */
  formatBRL,
  /** @deprecated use formatBRLShort de lib/format.ts. */
  formatBRLShort,
  /** @deprecated use formatBRLTight de lib/format.ts. */
  formatBRLTight,
  /** @deprecated use formatRange de lib/format.ts. */
  formatRange,
  /** @deprecated use formatWhen de lib/format.ts. */
  formatWhen,
} from './format';

/**
 * Totais da coleção: o valor (`value`, a soma do valor escolhido em cada carta: mínimo, média ou máximo; a média por
 * padrão), a soma dos mínimos, das médias e dos máximos (cartas com "Meu valor" entram com ele em tudo) e quantas
 * cartas têm valor: por confiança, por escolha (`byPick`: "média em 46, menor anúncio em 7, Meu valor em 2") e por
 * fonte (`byBasis`: "MYP Cards (41) · TCGplayer (5) · Meu valor (2)"). `approx` = cartas com valor aproximado;
 * `mypPending` = cartas sem valor (fora as em inglês) esperando a busca no MYP, que só o app no celular faz.
 */
export function collectionTotals(entries: Entry[]) {
  let value = 0;
  let valued = 0;
  let min = 0;
  let avg = 0;
  let max = 0;
  const byConfidence = { alta: 0, media: 0, baixa: 0 };
  const byPick: Record<ValueBasis | 'manual', number> = { min: 0, avg: 0, max: 0, manual: 0 };
  const byBasis: Record<SourceId, number> = { myp: 0, tcgplayer: 0, manual: 0 };
  let approx = 0;
  let mypPending = 0;
  for (const e of entries) {
    const ref = valuation(e);
    if (!ref.range || ref.value == null) {
      if (e.lang !== 'en' && pricePending(e)) mypPending++;
      continue;
    }
    value += ref.value;
    min += ref.range.min;
    avg += ref.range.avg;
    max += ref.range.max;
    valued++;
    if (ref.confidence) byConfidence[ref.confidence]++;
    if (ref.basis) byBasis[ref.basis]++;
    byPick[ref.basis === 'manual' ? 'manual' : (ref.pick ?? 'avg')]++;
    if (ref.approx) approx++;
  }
  return { value, valued, min, avg, max, range: { min, avg, max }, byConfidence, byPick, byBasis, approx, unvalued: entries.length - valued, mypPending };
}

/** Uma semana: o MYP é consultado de novo depois disso; preço mais velho é "de mais de 7 dias". */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Idade dos preços que formam o valor (ISO): de cada carta, só a fonte que dá o valor dela — a busca no MYP
 * (`checkedAt`) ou a cópia da TCGplayer (`builtAt`); "Meu valor" e cartas sem preço não contam. `stale` = cartas com
 * preço de mais de 7 dias (no MYP, o app no celular renova; na web ele não é consultado).
 */
export function priceFreshness(entries: Entry[], now = Date.now()) {
  const times: { at: string; ms: number }[] = [];
  let stale = 0;
  for (const e of entries) {
    const v = valuation(e);
    const at =
      v.basis === 'myp' ? mypApiFor(e)?.checkedAt : v.basis === 'tcgplayer' ? (tcgplayerFor(e)?.builtAt ?? tcgplayerFor(e)?.checkedAt) : undefined;
    const ms = at ? new Date(at).getTime() : NaN;
    if (!at || !Number.isFinite(ms)) continue;
    times.push({ at, ms });
    if (now - ms > STALE_MS) stale++;
  }
  // Pela hora, não pelo texto: o builtAt vem do banco ("…+00:00", com microssegundos) e o checkedAt do app ("…Z").
  times.sort((a, b) => a.ms - b.ms);
  return { newest: times[times.length - 1]?.at, oldest: times[0]?.at, stale };
}

/**
 * O que foi gasto × quanto vale hoje: soma do valor pago (`purchasePrice`) das cartas compradas e o valor atual delas
 * (as compradas sem valor pago ficam de fora das duas somas, contadas em `withoutPrice`; as sem valor atual, em
 * `unvalued`). `byOrigin` conta todas as cartas por origem ("none" = sem origem).
 */
export function purchaseSummary(entries: Entry[]) {
  let paid = 0;
  let current = 0;
  let counted = 0;
  let withoutPrice = 0;
  let unvalued = 0;
  const byOrigin: Record<Origin | 'none', number> = { trade: 0, booster: 0, purchase: 0, none: 0 };
  for (const e of entries) {
    // Origem desconhecida (dado antigo ou de outra versão) conta como sem origem.
    byOrigin[e.origin && Object.prototype.hasOwnProperty.call(byOrigin, e.origin) ? e.origin : 'none']++;
    if (e.origin !== 'purchase') continue;
    if (e.purchasePrice == null || !(e.purchasePrice > 0)) {
      withoutPrice++;
      continue;
    }
    const v = valuation(e).value;
    if (v == null) {
      unvalued++;
      continue;
    }
    paid += e.purchasePrice;
    current += v;
    counted++;
  }
  const diff = current - paid;
  return { bought: byOrigin.purchase, counted, paid, current, diff, pct: paid > 0 ? (diff / paid) * 100 : null, withoutPrice, unvalued, byOrigin };
}

/**
 * Cartas cujo "Meu valor" foi apagado porque o mercado passou dele (e que não ganharam outro), da troca mais recente
 * para a mais antiga; com `since` (ISO), só as trocas depois dele (para avisar só das novas). `now` é o valor atual da
 * carta, pela escolha de "Usar na soma" (pode ser menor que o valor digitado).
 */
export function myValueReplacements(entries: Entry[], since?: string) {
  return entries
    .filter((e) => e.myValue == null && e.myValueReplaced && (!since || e.myValueReplaced.at > since))
    .map((e) => ({ entry: e, cardName: e.cardName, ...e.myValueReplaced!, now: valuation(e) }))
    .sort((a, b) => b.at.localeCompare(a.at));
}
