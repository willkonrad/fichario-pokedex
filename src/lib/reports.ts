import { collectionTotals } from './quotes';
import { tcgplayerCovers, tcgplayerFor } from './tcgplayer';
import type { Entry } from './types';
import { mypApiFor, pricePending, valuation } from './valuation';

// Destaques da tela Relatórios calculados no aparelho (funções puras). O valor sai sempre de valuation /
// collectionTotals: nada de estimar.

// ---------- Por coleção ----------

/** Uma coleção (set) da carta: quantas cartas, o valor somado e quantas têm valor. */
export type SetSummary = { key: string; setId: string; setName: string; count: number; value: number; valued: number };

/** Nome mais comum do grupo (empate: o que apareceu primeiro); o catálogo pode ter mudado o nome de algumas cartas. */
function commonName(list: Entry[]) {
  const counts = new Map<string, number>();
  for (const e of list) {
    const name = e.setName?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best = '';
  let most = 0;
  for (const [name, n] of counts) {
    if (n > most) {
      best = name;
      most = n;
    }
  }
  return best;
}

/**
 * Cartas por coleção (setId; setName do mais comum), ordem: mais cartas, depois maior valor. `max` padrão 8. Carta
 * sem setId fica junto das outras com o mesmo nome de coleção.
 */
export function setSummaries(entries: Entry[], max = 8): SetSummary[] {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = e.setId || (e.setName?.trim() ? `nome:${e.setName.trim()}` : '');
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out: SetSummary[] = [];
  for (const [key, list] of groups) {
    const t = collectionTotals(list);
    out.push({ key, setId: list[0].setId || '', setName: commonName(list), count: list.length, value: t.value, valued: t.valued });
  }
  return out
    .sort((a, b) => b.count - a.count || b.value - a.value || a.setName.localeCompare(b.setName, 'pt-BR'))
    .slice(0, Math.max(0, max));
}

// ---------- Sem preço ----------

/** pending = ainda vai buscar; notFound = buscou e não achou; noSource = nenhuma fonte achou nem disse por quê. */
export type NoPriceReason = 'pending' | 'notFound' | 'noSource';

/** Por que a carta (sem valor) está sem preço. */
export function noPriceReason(e: Entry): NoPriceReason {
  // Em inglês sem preço na TCGplayer, o app ainda busca no MYP (como no painel de preço da carta); a japonesa só
  // espera a TCGplayer (o MYP não tem cartas japonesas).
  if (pricePending(e) || (e.lang === 'en' && !mypApiFor(e))) return 'pending';
  // A TCGplayer só vale para carta em inglês e japonês (como no painel); a em português pode guardar uma busca velha.
  if (mypApiFor(e)?.notFound || (tcgplayerCovers(e.lang) && tcgplayerFor(e)?.notFound)) return 'notFound';
  return 'noSource';
}

const timeOf = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * Cartas sem valor (valuation(e).value == null) e o motivo: pending = pricePending(e), ou carta em inglês ainda sem
 * busca no MYP; notFound = busca feita e não achou (mypApiFor com notFound, ou tcgplayerFor só em inglês e japonês);
 * noSource = resto. Itens do mais recente (updatedAt).
 */
export function noPriceSummary(entries: Entry[]): { total: number; byReason: Record<NoPriceReason, number>; items: Entry[] } {
  const byReason: Record<NoPriceReason, number> = { pending: 0, notFound: 0, noSource: 0 };
  const items = entries.filter((e) => valuation(e).value == null);
  for (const e of items) byReason[noPriceReason(e)]++;
  // Pela hora, não pelo texto (o servidor grava "+00:00", o aparelho "Z").
  items.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt) || a.id.localeCompare(b.id));
  return { total: items.length, byReason, items };
}
