// Coleção inteira em listas (E1, E2): onde está cada carta, busca sem internet, "Preciso", "Tenho repetida" e o texto
// para mandar no WhatsApp. Nada aqui busca preço: o valor mostrado é o que a carta já tem (valuation).

import { formatDex, getSpecies, type Species } from '@/data/pokedex';

import { indexOfEntry, isPlaced, isPlacedCustom, physicalPosition, regionsIn, volumesNeeded } from './binder';
import { printedNumber } from './card-number';
import { plainName } from './catalog';
import { isPromoSeries, jaNumberless } from './collector';
import { MYP_URL, sourceCredits, TCGPLAYER_URL, valueMark } from './copy';
import { formatBRL } from './format';
import { collectionTotals } from './quotes';
import { matchesNumber } from './tcgdex';
import { LANG_SHORT, POKEDEX_BINDER, VARIANTS, type BinderSettings, type CustomBinder, type Entry } from './types';
import { valuation } from './valuation';

// ---------- Onde está a carta ----------

export type EntryPlace = {
  /** Nome do fichário. */
  binder: string;
  page: number;
  pocket: number;
  sheet: number;
  side: string | null;
  /** "pág. 3, bolso 7". */
  short: string;
  /** "pág. 3 (folha 2, verso), bolso 7"; com a Pokédex em mais de um fichário físico, "pág. 89 (fichário 2, folha 5, frente), bolso 8". */
  long: string;
  /** A carta está fora das páginas (faixa da Pokédex, espaços por Pokémon ou páginas do fichário diminuídos). */
  hidden: boolean;
};

function placeOf(binder: string, p: ReturnType<typeof physicalPosition>, hidden: boolean, volumes = 1): EntryPlace {
  const short = `pág. ${p.page}, bolso ${p.pocket}`;
  // F8: em mais de um fichário físico, a folha é contada dentro do fichário dela (a mesma da tela da carta).
  const sheet = volumes > 1 && p.volume != null ? `fichário ${p.volume}, folha ${p.volumeSheet}` : p.side ? `folha ${p.sheet}` : '';
  const long = sheet ? `pág. ${p.page} (${sheet}${p.side ? `, ${p.side}` : ''}), bolso ${p.pocket}` : short;
  return { binder, page: p.page, pocket: p.pocket, sheet: p.sheet, side: p.side, short, long, hidden };
}

/** Posição física da carta: fichário, página (folha e lado) e bolso; null se o fichário dela não existe mais. */
export function entryPlace(e: Entry, settings: BinderSettings | null, binders: CustomBinder[]): EntryPlace | null {
  if (e.binderId && e.binderId !== POKEDEX_BINDER) {
    const b = binders.find((x) => x.id === e.binderId);
    if (!b) return null;
    return placeOf(b.name || 'Fichário', physicalPosition(b, e.slot), !isPlacedCustom(b, e));
  }
  if (!settings) return null;
  return placeOf(
    settings.name || 'Fichário Pokédex',
    physicalPosition(settings, indexOfEntry(settings, e)),
    !isPlaced(settings, e),
    volumesNeeded(settings),
  );
}

/** "Fichário Pokédex · pág. 2, bolso 5" (ou "fora das páginas"). */
export function placeText(p: EntryPlace | null, long = false) {
  if (!p) return 'fichário apagado';
  return `${p.binder} · ${p.hidden ? 'fora das páginas' : long ? p.long : p.short}`;
}

/** Parâmetros da tela da carta para abrir uma carta salva. */
export function entryParams(e: Entry) {
  return e.binderId && e.binderId !== POKEDEX_BINDER ? { binder: e.binderId, slot: e.slot } : { dex: e.dex, slot: e.slot };
}

// ---------- Descrição curta ----------

/**
 * "025/165", "1/64", "TG05/TG30", "SWSH020": o número como impresso, com a regra da tela da carta (promo pela lista
 * fechada de isPromoSeries: "045/071" numa SV2P, "1/12" num tk-ex-p; japonesa antiga, nenhum). Sem número, nada. Só a
 * Coleção Clássica fica diferente: a tela usa o número do catálogo ("4/102"), que a lista não tem, e aqui fica o da
 * TCGdex ("CC002", "001/030"). Sem a coleção da TCGdex (ou na carta só do catálogo), promo pelo nome (isPromoSet).
 */
export function cardNumber(e: Pick<Entry, 'localId' | 'setTotal'> & Partial<Pick<Entry, 'setId' | 'setName' | 'lang'>>) {
  const setId = e.setId?.trim();
  const tcgdexSet = !!setId && !setId.startsWith('tcgp');
  if (tcgdexSet && e.lang === 'ja' && jaNumberless(setId)) return '';
  const promo = tcgdexSet ? isPromoSeries(setId, e.lang ?? 'pt') : undefined;
  return printedNumber({ localId: e.localId, total: e.setTotal, setId: e.setId, setName: e.setName, promo });
}

/** Versão em texto: "Holo / Foil", "Pokémon Center" (selo), "Holo / Foil · Cosmos Holo"; a normal não aparece. */
export function versionText(e: Pick<Entry, 'variant' | 'variantNote'>) {
  const label = e.variant === 'normal' ? '' : (VARIANTS.find((v) => v.id === e.variant)?.label ?? '');
  const note = e.variantNote?.trim();
  if (!note) return label;
  return label && !['wPromo', 'staff', 'other'].includes(e.variant) ? `${label} · ${note}` : note;
}

/** "Escarlate e Violeta 151 · 025/165 · Holo / Foil · NM · PT". */
export function entrySummary(e: Entry) {
  return [e.setName, cardNumber(e), versionText(e), e.condition, LANG_SHORT[e.lang]].filter(Boolean).join(' · ');
}

// ---------- Busca na coleção (E2) ----------

/**
 * Cartas da coleção que combinam com a busca, sem internet: cada palavra tem de aparecer no nome, no Pokémon, na
 * coleção, no selo ou no nome do fichário, sem depender de acento; palavra com número também acha pelo número da
 * carta ("pikachu 25", "tg06") ou da Pokédex. Texto em japonês: como foi digitado.
 */
export function findInCollection(entries: Entry[], query: string, binderName: (e: Entry) => string): Entry[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];
  const words = plainName(query).split(' ').filter(Boolean);
  const hayOf = (e: Entry) => `${e.cardName} ${e.dex ? (getSpecies(e.dex)?.name ?? '') : ''} ${e.setName} ${versionText(e)} ${binderName(e)}`;
  const hits = !words.length
    ? entries.filter((e) => hayOf(e).toLowerCase().includes(raw))
    : entries.filter((e) => {
        const hay = ` ${plainName(hayOf(e))} `;
        return words.every((w) => hay.includes(w) || (/\d/.test(w) && (matchesNumber(e.localId, w) || (/^\d+$/.test(w) && Number(w) === e.dex))));
      });
  return hits.sort(byName(binderName));
}

const byName = (binderName: (e: Entry) => string) => (a: Entry, b: Entry) =>
  a.cardName.localeCompare(b.cardName, 'pt-BR') || binderName(a).localeCompare(binderName(b), 'pt-BR') || a.dex - b.dex || a.slot - b.slot;

// ---------- "Preciso" (E1) ----------

export type RegionNeed = { region: string; species: Species[] };

/**
 * Pokémon da faixa do fichário Pokédex sem nenhuma carta nas páginas dele, por região (como a home e o menu contam).
 * `elsewhere` = os que têm carta em outro fichário (dá para mover em vez de comprar); `offPage` = os que têm carta no
 * Pokédex, mas fora das páginas (F2: espaços por Pokémon diminuídos, por exemplo).
 */
export function missingByRegion(settings: BinderSettings, entries: Entry[]) {
  const have = new Set<number>();
  const elsewhere = new Set<number>();
  const offPage = new Set<number>();
  for (const e of entries) {
    if (!e.dex) continue;
    if (e.binderId && e.binderId !== POKEDEX_BINDER) elsewhere.add(e.dex);
    else if (isPlaced(settings, e)) have.add(e.dex);
    else offPage.add(e.dex);
  }
  const groups: RegionNeed[] = [];
  let total = 0;
  // Regiões já cortadas na faixa do fichário (as mesmas da régua da tela inicial).
  for (const r of regionsIn(settings)) {
    const species: Species[] = [];
    for (let d = r.from; d <= r.to; d++) {
      const s = getSpecies(d);
      if (s && !have.has(d)) species.push(s);
    }
    if (species.length) groups.push({ region: r.label, species });
    total += species.length;
  }
  return { groups, total, elsewhere, offPage };
}

/** Texto do "Preciso" para mandar: por região, "#025 Pikachu, #039 Jigglypuff…". */
export function needShareText(binderName: string, groups: RegionNeed[], total: number) {
  const head = `*Preciso* · ${binderName} · ${total} Pokémon`;
  const body = groups.map((g) => `*${g.region}* (${g.species.length})\n${g.species.map((s) => `${formatDex(s.id)} ${s.name}`).join(', ')}`);
  return [head, ...body].join('\n\n');
}

// ---------- "Tenho repetida" (E1) ----------

export type CopyGroup = {
  key: string;
  copies: Entry[];
  /** A cópia sobrando: a de um fichário de trocas, senão a de outro fichário livre, senão a última. */
  spare: Entry;
};

const copyKey = (e: Entry) => `${e.cardId}|${e.lang}|${e.variant}|${(e.variantNote ?? '').trim().toLowerCase()}`;

/** Cartas iguais (mesma carta, idioma, variação e selo) em mais de um bolso. */
export function repeatedCards(entries: Entry[], binders: CustomBinder[]): CopyGroup[] {
  const purpose = new Map(binders.map((b) => [b.id, b.purpose]));
  const groups = new Map<string, Entry[]>();
  for (const e of entries) groups.set(copyKey(e), [...(groups.get(copyKey(e)) ?? []), e]);
  const rank = (e: Entry) => (e.binderId && purpose.get(e.binderId) === 'trade' ? 2 : e.binderId && e.binderId !== POKEDEX_BINDER ? 1 : 0);
  const out: CopyGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const copies = [...list].sort((a, b) => rank(a) - rank(b) || a.slot - b.slot);
    out.push({ key, copies, spare: copies[copies.length - 1] });
  }
  return out.sort((a, b) => a.spare.cardName.localeCompare(b.spare.cardName, 'pt-BR'));
}

/** Cartas dos fichários de trocas (finalidade "Trocas / venda"), menos as já listadas como repetidas. */
export function tradeCards(entries: Entry[], binders: CustomBinder[], skip: Set<string>) {
  return binders
    .filter((b) => b.purpose === 'trade')
    .map((binder) => ({
      binder,
      entries: entries.filter((e) => e.binderId === binder.id && !skip.has(e.id)).sort((a, b) => a.slot - b.slot),
    }))
    .filter((g) => g.entries.length);
}

export type ListPrice = ReturnType<typeof valueMark> & { value: number };

/**
 * Valor da carta para a lista com preços (o que ela já tem; sem preço, null), com a marca de confiança: "≈" aproximado
 * (preço da carta base ou de outros idiomas) e "✎" Meu valor, como na home e na tela da carta.
 */
export function listPrice(e: Entry): ListPrice | null {
  const v = valuation(e);
  return v.value == null ? null : { ...valueMark(v), value: v.value };
}

/** "≈ R$ 45,00", "✎ R$ 45,00" ou "R$ 45,00". */
export function listPriceText(p: ListPrice) {
  return `${p.mark ? `${p.mark} ` : ''}${formatBRL(p.value)}`;
}

/** O preço para o leitor de tela: "R$ 45,00, aproximado: preço da carta base…", "Meu valor R$ 45,00", "sem preço". */
export function listPriceSpeech(p: ListPrice | null) {
  if (!p) return 'sem preço';
  if (p.mark === '✎') return `${p.label} ${formatBRL(p.value)}`;
  return `${formatBRL(p.value)}${p.mark === '≈' ? `, ${p.label.toLowerCase()}: ${p.reason}` : ''}`;
}

/** Legenda do "≈" com os motivos das cartas listadas ("≈ Aproximado (preço da carta base: …)"); "" se nenhuma é aproximada. */
export function approxLegend(entries: Entry[]) {
  const marks = entries.map(listPrice).filter((p): p is ListPrice => p?.mark === '≈');
  if (!marks.length) return '';
  return `≈ ${marks[0].label} (${[...new Set(marks.map((p) => p.reason))].join('; ')})`;
}

/** "Preços: MYP Cards (https://mypcards.com) · TCGplayer (…)" das cartas listadas com valor; "" se nenhuma tem. */
export function priceCreditsText(entries: Entry[]) {
  const t = collectionTotals(entries);
  if (!t.valued) return '';
  const urls: Record<string, string> = { myp: MYP_URL, tcgplayer: TCGPLAYER_URL };
  const parts = sourceCredits(t.byBasis)
    .filter((c) => c.count > 0)
    .map((c) => (urls[c.id] ? `${c.label} (${urls[c.id]})` : c.label));
  return parts.length ? `Preços: ${parts.join(' · ')}` : '';
}

/** Uma linha da lista para mandar; `spare` = quantas cópias sobram para trocar (o "(2×)" só aparece com mais de uma). */
function shareLine(e: Entry, spare: number, prices: boolean) {
  const p = prices ? listPrice(e) : null;
  // O valor aproximado sai com o "≈" (legenda no fim); o digitado, com "(meu valor)".
  const price = !p ? '' : p.mark === '✎' ? ` — ${formatBRL(p.value)} (${p.label.toLowerCase()})` : ` — ${listPriceText(p)}`;
  return `• ${e.cardName} · ${entrySummary(e)}${spare > 1 ? ` (${spare}×)` : ''}${price}`;
}

/**
 * Texto do "Tenho repetida" para mandar; com preços, termina com a legenda do "≈" (se alguma carta for aproximada) e a
 * atribuição das fontes (com link).
 */
export function haveShareText(groups: CopyGroup[], trades: { binder: CustomBinder; entries: Entry[] }[], prices: boolean) {
  const blocks: string[] = [];
  if (groups.length) {
    // Uma das cópias fica no fichário: para trocar, sobram as outras.
    blocks.push(`*Tenho repetida* (${groups.length})\n${groups.map((g) => shareLine(g.spare, g.copies.length - 1, prices)).join('\n')}`);
  }
  for (const t of trades) {
    blocks.push(`*Para troca · ${t.binder.name || 'Trocas'}* (${t.entries.length})\n${t.entries.map((e) => shareLine(e, 1, prices)).join('\n')}`);
  }
  if (prices) {
    const listed = [...groups.map((g) => g.spare), ...trades.flatMap((t) => t.entries)];
    const footer = [approxLegend(listed), priceCreditsText(listed)].filter(Boolean).join('\n');
    if (footer) blocks.push(footer);
  }
  return blocks.join('\n\n');
}
