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

/**
 * Palavras do nome da carta, com os símbolos que a TCGdex usa escritos como a TCGplayer escreve: "Nidoran♀" = "Nidoran
 * F", "Jolteon ☆" = "Jolteon Star", "Giratina ◇" = "Giratina Prism Star". O δ e o "(Delta Species)" saem dos dois lados
 * (a TCGplayer às vezes põe o complemento no nome, às vezes não; o número já diz qual carta é).
 */
export const nameWords = (s: string) =>
  words(
    s
      .replace(/♀/g, ' f ')
      .replace(/♂/g, ' m ')
      .replace(/[☆★]/g, ' star ')
      .replace(/◇/g, ' prism star ')
      .replace(/δ/g, ' ')
      .replace(/\bdelta species\b/gi, ' '),
  );

/**
 * Nome sem as letras soltas do Unown e do Nidoran (letra do Unown, F/M), sem "Prism Star"/"Star" e sem o "Basic" das
 * energias básicas ("Basic Fire Energy" da TCGplayer = "Fire Energy" da TCGdex): só para conferir junto do número. Nos
 * outros nomes a letra solta fica, porque diz qual é a carta ("Mega Charizard X ex" não é a "Y", "Pikachu V" não é
 * "Pikachu").
 */
const LOOSE_DROP = new Set(['prism', 'star']);
export const looseName = (s: string) => {
  let w = nameWords(s)
    .split(' ')
    .filter((x) => x && !LOOSE_DROP.has(x));
  if (w[0] === 'unown' || w[0] === 'nidoran') w = w.filter((x) => x.length > 1);
  return (w[0] === 'basic' && w[w.length - 1] === 'energy' ? w.slice(1) : w).join(' ');
};

/** Posição do " - " fora de parênteses e colchetes ("Psychic Energy (#8 - Latias)" não tem nenhum); -1 sem ele. */
function outerDash(fullName: string) {
  let depth = 0;
  for (let i = 0; i < fullName.length; i++) {
    const ch = fullName[i];
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    else if (depth === 0 && fullName.startsWith(' - ', i)) return i;
  }
  return -1;
}

/**
 * Nome sem os complementos entre parênteses ou colchetes, menos a letra do Unown e o F/M do Nidoran ("Unown [M]" →
 * "Unown M", "Nidoran (F)" → "Nidoran F", "Psychic Energy (#8 - Latias)" → "Psychic Energy", "Professor's Research
 * [Professor Sada]" → "Professor's Research").
 */
export function withoutQualifiers(name: string) {
  const base = name.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
  const keepLetter = /(^|\s)(unown|nidoran)$/i.test(base);
  return name
    .replace(/\s*[([]([^)\]]*)[)\]]/g, (_, q: string) => (keepLetter && /^[a-z?!]$/i.test(q.trim()) ? ` ${q.trim()}` : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nome da carta no produto da TCGplayer: o que vem antes de " - " (fora dos parênteses), com os complementos que
 * estiverem ali ("Professor's Research [Professor Sada]"; a ligação tenta também sem eles, ver linkCard) ou, sem número
 * no nome, o nome sem os complementos (withoutQualifiers).
 */
export function productName(fullName: string) {
  const cut = outerDash(fullName);
  return cut > 0 ? fullName.slice(0, cut).trim() : withoutQualifiers(fullName);
}

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
 * Coleções que a TCGplayer e a TCGdex nomeiam de jeitos que não se cruzam pelo nome nem pela sigla (principalmente as
 * de promos): nome da coleção na TCGplayer → id da TCGdex.
 */
const SET_ALIASES: [RegExp, string][] = [
  [/^swsh: sword & shield promo cards$/i, 'swshp'],
  [/^diamond and pearl promos$/i, 'dpp'],
  [/^black and white promos$/i, 'bwp'],
  [/^hgss promos$/i, 'hgssp'],
  [/^xy promos$/i, 'xyp'],
  [/^sm promos$/i, 'smp'],
  [/^sv: scarlet & violet promo cards$/i, 'svp'],
  [/^me: mega evolution promo$/i, 'mep'],
  [/^nintendo promos$/i, 'np'],
  [/^wotc promo$/i, 'basep'],
  [/^sve: scarlet & violet energies$/i, 'sve'],
  [/^mee: mega evolution energies$/i, 'mee'],
];

/**
 * Coleções da TCGdex candidatas a uma coleção do TCGCSV: mesma sigla, código igual ao id (SWSH08 ↔ swsh8), apelido
 * conhecido (SET_ALIASES) ou nome mais parecido. A carta só é ligada se número E nome baterem, então candidatas a mais
 * não geram ligações erradas.
 */
export function candidatesFor(g: { name: string; abbr: string | null }, sets: TcgdexSet[]) {
  const out = new Set<TcgdexSet>();
  const aliases = SET_ALIASES.filter(([re]) => re.test(g.name.trim())).map(([, id]) => id);
  for (const s of sets) {
    if (g.abbr && (s.abbr === g.abbr || code(s.id) === code(g.abbr))) out.add(s);
    if (aliases.includes(s.id)) out.add(s);
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

/**
 * Id da TCGdex da carta: mesmo número e mesmo nome numa das coleções candidatas. Sem acerto pelo nome inteiro, aceita o
 * nome sem letras soltas e sem "Star" (ex.: "Unown (M)" da TCGplayer = "Unown" M da TCGdex), sempre com o mesmo número.
 * A mesma carta em duas candidatas (ex.: as duas metades de um kit de treinador, cada uma numerada de 1 a 30): vale a
 * que o complemento do produto (`fullName`) cita, "Tierno (20 - Suicune Deck)" → a metade do Suicune; senão, a primeira.
 * A TCGdex às vezes tem no nome o complemento que vem antes do " - " ("Professor's Research (Professor Magnolia)"), às
 * vezes não ("Professor's Research [Professor Sada] - 189/198" = "Professor's Research" sv01-189): tenta com ele e, sem
 * acerto, sem ele.
 */
export function linkCard(name: string, number: string, candidates: TcgdexSet[], fullName = '') {
  const n = num(number);
  const pick = (same: (t: TcgdexCard) => boolean) => {
    const hits = candidates.flatMap((s) => {
      const hit = (s.cards ?? []).find((t) => num(t.localId) === n && same(t));
      return hit ? [{ s, hit }] : [];
    });
    if (hits.length <= 1) return hits[0]?.hit.id ?? null;
    const quals = setWords(qualifiers(fullName).join(' '));
    const cited = hits.find(({ s }) => [...setWords(s.name ?? '')].some((w) => quals.has(w)));
    return (cited ?? hits[0]).hit.id;
  };
  const byName = (cardName: string) => {
    const strict = nameWords(cardName);
    const direct = pick((t) => nameWords(t.name) === strict);
    if (direct) return direct;
    const loose = looseName(cardName);
    return loose ? pick((t) => looseName(t.name) === loose) : null;
  };
  const bare = withoutQualifiers(name);
  return byName(name) ?? (bare && bare !== name ? byName(bare) : null);
}

/**
 * Ligação pelo número completo "N/T", em qualquer coleção da TCGdex com T cartas oficiais: para os produtos de
 * coleções "de tudo um pouco" da TCGplayer (ex.: "Miscellaneous Cards & Products"), onde ficam versões com selo de
 * cartas de outras coleções ("Bulbasaur - 133/132 (Mega Evolution Stamped)"). Só liga se houver exatamente uma carta
 * com esse nome e número entre essas coleções; sem acerto, tenta o nome sem os complementos, como em linkCard
 * ("Boss's Orders [Cyrus] - 132/172" = "Boss's Orders" swsh9-132).
 */
export function linkByTotal(name: string, number: string, sets: TcgdexSet[], official: Map<string, number>) {
  const total = Number(number.split('/')[1]);
  if (!total) return null;
  const inTotal = sets.filter((s) => official.get(s.id) === total);
  const hitsFor = (cardName: string) =>
    inTotal.flatMap((s) => (s.cards ?? []).filter((t) => num(t.localId) === num(number) && nameWords(t.name) === nameWords(cardName)));
  let hits = hitsFor(name);
  const bare = withoutQualifiers(name);
  if (!hits.length && bare && bare !== name) hits = hitsFor(bare);
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
    for (const t of s.cards ?? []) byName.set(nameWords(t.name), [...(byName.get(nameWords(t.name)) ?? []), t]);
    const links = names.map((n) => {
      const hits = byName.get(nameWords(n)) ?? [];
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
  const keyOf = (c: CardIn) => `${nameWords(c.name)}|${num(c.number)}`;
  const base = new Map<string, string[]>();
  for (const c of parsed) {
    const cur = base.get(keyOf(c));
    if (!cur || c.quals.length < cur.length) base.set(keyOf(c), c.quals);
  }
  const direct = parsed.map((c) => linkCard(c.name, c.number, candidates, c.full_name));
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
