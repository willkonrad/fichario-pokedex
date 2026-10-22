// Regra de ligação do catálogo do TCGCSV à TCGdex e do selo de cada carta (funções puras, sem rede, testáveis).
// Usada pela Edge Function catalog-sync (index.ts).

export const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(' ');
/** "007/165", "SWSH001", "TG06" → "7", "swsh1", "tg6". */
export const num = (s?: string) => (s ?? '').split('/')[0].trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1');
/** Complementos entre parênteses ou colchetes: "Pikachu - 225 (World Championship 2025) [Winner]". */
export const qualifiers = (s: string) => [...s.matchAll(/[([]([^)\]]+)[)\]]/g)].map((m) => m[1].trim());

export type TcgdexCard = { id: string; localId: string; name: string };
export type TcgdexSet = { id: string; abbr: string | null; name: string | null; cards: TcgdexCard[] | null };

/** "SWSH08", "SM05", "sv03.5" → "swsh8", "sm5", "sv3.5": compara o código da TCGplayer com o id da TCGdex. */
export const code = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, '').replace(/([a-z])0+(?=\d)/g, '$1');
const STOP = new Set(['the', 'and', 'of', 'pokemon', 'tcg', 'set', 'sets', 'cards', 'card', 'series', 'black', 'star', 'expansion']);
/** Palavras do nome da coleção, sem o prefixo de série ("SWSH08: ", "SM - ") e sem plural. */
export const setWords = (s: string) =>
  new Set(
    words(s.replace(/^[A-Za-z]{1,5}\d{0,3}(\.\d)?\s*[:–-]\s+/, ''))
      .split(' ')
      .map((w) => w.replace(/s$/, ''))
      .filter((w) => w && !STOP.has(w)),
  );

/**
 * Coleções da TCGdex candidatas a uma coleção do TCGCSV: mesma sigla, código igual ao id (SWSH08 ↔ swsh8) ou nome
 * mais parecido. A carta só é ligada se número E nome baterem, então candidatas a mais não geram ligações erradas.
 */
export function candidatesFor(g: { name: string; abbr: string | null }, sets: TcgdexSet[]) {
  const out = new Set<TcgdexSet>();
  for (const s of sets) {
    if (g.abbr && (s.abbr === g.abbr || code(s.id) === code(g.abbr))) out.add(s);
  }
  const gw = setWords(g.name);
  let best = 0;
  const scored = sets.map((s) => {
    const sw = setWords(s.name ?? '');
    const shared = [...gw].filter((w) => sw.has(w)).length;
    best = Math.max(best, shared);
    return { s, shared };
  });
  if (best > 0) for (const x of scored) if (x.shared === best) out.add(x.s);
  return [...out];
}

/** Id da TCGdex da carta (mesmo número e mesmo nome numa das coleções candidatas). */
export function linkCard(name: string, number: string, candidates: TcgdexSet[]) {
  for (const s of candidates) {
    const hit = (s.cards ?? []).find((t) => num(t.localId) === num(number) && words(t.name) === words(name));
    if (hit) return hit.id;
  }
  return null;
}

/**
 * Ligação pelo número completo "N/T", em qualquer coleção da TCGdex com T cartas oficiais: para os produtos de
 * coleções "de tudo um pouco" da TCGplayer (ex.: "Miscellaneous Cards & Products"), onde ficam versões com selo de
 * cartas de outras coleções ("Bulbasaur - 133/132 (Mega Evolution Stamped)"). Só liga se houver exatamente uma carta
 * com esse nome e número entre essas coleções.
 */
export function linkByTotal(name: string, number: string, sets: TcgdexSet[], official: Map<string, number>) {
  const total = Number(number.split('/')[1]);
  if (!total) return null;
  const hits = sets
    .filter((s) => official.get(s.id) === total)
    .flatMap((s) => (s.cards ?? []).filter((t) => num(t.localId) === num(number) && words(t.name) === words(name)));
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Coleção candidata que a TCGplayer numera de outro jeito (ex.: as coleções clássicas, com o número da carta
 * original: "Charizard 4/102" = 30th-c-001 na TCGdex): a candidata em que mais cartas da coleção têm nome único.
 * Ligações por nome de cada carta nela, ou null se ela não cobrir a maior parte da coleção.
 */
function linkRenumbered(names: string[], candidates: TcgdexSet[]) {
  let best: (string | null)[] | null = null;
  let bestHits = 0;
  for (const s of candidates) {
    const byName = new Map<string, TcgdexCard[]>();
    for (const t of s.cards ?? []) byName.set(words(t.name), [...(byName.get(words(t.name)) ?? []), t]);
    const links = names.map((n) => {
      const hits = byName.get(words(n)) ?? [];
      return hits.length === 1 ? hits[0].id : null;
    });
    const n = links.filter(Boolean).length;
    if (n > bestHits) [best, bestHits] = [links, n];
  }
  return best && bestHits >= 5 && bestHits > names.length / 2 ? best : null;
}

/** Coleção genérica da TCGplayer: o nome dela não diz nada do selo (os complementos dizem). */
const GENERIC_GROUP = /^miscellaneous/i;

export type CardIn = { product_id: number; name: string; number: string; full_name: string };

/**
 * Ligação à TCGdex e selo de cada carta de uma coleção do TCGCSV:
 *   - ligação pela coleção candidata (mesma sigla/nome); numa coleção que quase não liga pelo número mas liga pelo
 *     nome numa candidata, é uma reimpressão numerada de outro jeito (linkRenumbered); senão, pelo número completo
 *     "N/T" em outra coleção (linkByTotal);
 *   - selo: os complementos a mais que a versão comum da mesma carta na coleção ("(Pokemon Center Exclusive)"). Carta
 *     ligada pelo número completo é de outra coleção: o selo é o nome da coleção (menos a genérica "Miscellaneous")
 *     mais os complementos, ex.: "Jumbo Cards · Prismatic Evolutions Stamped", "First Partner Pack".
 */
export function linkAndStamp(groupName: string, cards: CardIn[], candidates: TcgdexSet[], sets: TcgdexSet[], official: Map<string, number>) {
  const parsed = cards.map((c) => {
    const cut = c.full_name.indexOf(' - ');
    return { ...c, quals: qualifiers(cut > 0 ? c.full_name.slice(cut) : c.full_name) };
  });
  // Versão comum de cada carta (nome + número): a com menos complementos.
  const keyOf = (c: CardIn) => `${words(c.name)}|${num(c.number)}`;
  const base = new Map<string, string[]>();
  for (const c of parsed) {
    const cur = base.get(keyOf(c));
    if (!cur || c.quals.length < cur.length) base.set(keyOf(c), c.quals);
  }
  const direct = parsed.map((c) => linkCard(c.name, c.number, candidates));
  const directCount = direct.filter(Boolean).length;
  const renumbered = directCount < parsed.length / 5 ? linkRenumbered(parsed.map((c) => c.name), candidates) : null;
  const linked = parsed.map((c, i) => {
    const own = direct[i] ?? renumbered?.[i] ?? null;
    // Reimpressão renumerada: as cartas que não ligam pelo nome ficam sem ligação (nada de "selo" com o nome dela).
    return { c, direct: own, cross: own || renumbered ? null : linkByTotal(c.name, c.number, sets, official) };
  });
  // Coleção da TCGdex que a coleção do TCGCSV cobre quase inteira pelo número completo é a própria coleção (com nome
  // diferente nas duas fontes; um kit de treinador tem duas): essas cartas são as comuns, não versões com selo. Já
  // um punhado de cartas de uma coleção grande (ex.: Battle Academy com cartas de Golpe Fusão) são versões com selo.
  const setOf = (id: string) => id.slice(0, id.lastIndexOf('-'));
  const size = new Map(sets.map((s) => [s.id, s.cards?.length ?? 0]));
  const count = new Map<string, number>();
  for (const x of linked) if (x.cross) count.set(setOf(x.cross), (count.get(setOf(x.cross)) ?? 0) + 1);
  const home = new Set([...count].filter(([s, n]) => n >= 5 && n >= (size.get(s) ?? Infinity) * 0.5).map(([s]) => s));
  const tag = GENERIC_GROUP.test(groupName) ? [] : [groupName];
  return linked.map(({ c, direct: own, cross }) => {
    const other = !!cross && !home.has(setOf(cross));
    const extra = other ? [...new Set([...tag, ...c.quals])] : c.quals.filter((q) => !(base.get(keyOf(c)) ?? []).includes(q));
    return { product_id: c.product_id, tcgdex_id: own ?? cross, stamp: extra.length ? extra.join(' · ') : null };
  });
}
