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

/**
 * Complemento entre parênteses ou colchetes, com outro dentro ("(Meadow [Pink])"). Sem o fecho de fora, vai até o fim do
 * nome (a TCGplayer tem "Chesnaught - XY68 (Prerelease [Staff]").
 */
const QUALIFIER = /\s*[([]((?:[^()[\]]|[([][^()[\]]*[)\]])*)(?:[)\]]|$)/g;
/** Complemento que é versão da carta (brilho ou padrão), não o nome de uma promo: o app o lê em stampVariant. */
const VERSION_MARK = /mirror|reverse|holo|pok[eé] ?ball|master ?ball|ball pattern/i;

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
  const base = name.replace(QUALIFIER, '').trim();
  const keepLetter = /(^|\s)(unown|nidoran)$/i.test(base);
  return name
    .replace(QUALIFIER, (_, q: string) => (keepLetter && /^[a-z?!]$/i.test(q.trim()) ? ` ${q.trim()}` : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Número colado no fim do nome, sem o " - " de sempre: "Finizen 60/197", "Electivire- 43/147", "Charizard ex -196". */
const TRAILING_NUMBER = /(?:\s+|-\s+)[a-z]*\d+[a-z]?\/[a-z-]*\d*$|\s+-[a-z]*\d+[a-z]?$/i;

/**
 * Nome da carta no produto da TCGplayer: o que vem antes de " - " (fora dos parênteses), com os complementos que
 * estiverem ali ("Professor's Research [Professor Sada]"; a ligação tenta também sem eles, ver linkCard), menos o
 * marcador de versão, que vira selo ("Ampharos (Mirror Holofoil) - 033/070" → "Ampharos"; ver linkAndStamp) ou, sem número
 * no nome, o nome sem os complementos (withoutQualifiers). Número colado no fim do nome sai ("Finizen 60/197"); um
 * número sem barra e sem hífen é parte do nome ("Energy Removal 2", "Giratina Lv. 70").
 */
export function productName(fullName: string) {
  const cut = outerDash(fullName);
  const name =
    cut > 0
      ? fullName
          .slice(0, cut)
          .replace(QUALIFIER, (group: string, q: string) => (VERSION_MARK.test(q) ? '' : group))
          .trim()
      : withoutQualifiers(fullName);
  return name.replace(TRAILING_NUMBER, '').trim();
}

/** "007/165", "SWSH001", "TG06" → "7", "swsh1", "tg6"; sem número (cartas japonesas antigas), "". */
export const num = (s?: string | null) => (s ?? '').split('/')[0].trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1');
/** Complementos entre parênteses ou colchetes: "Pikachu - 225 (World Championship 2025) [Winner]". */
export const qualifiers = (s: string) => [...s.matchAll(QUALIFIER)].map((m) => m[1].trim()).filter(Boolean);

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
 * conhecido (SET_ALIASES) ou nome mais parecido. A carta só é ligada se número E nome baterem, e só numa candidata que
 * cobre boa parte da coleção (ver linkAndStamp): uma candidata que só divide uma palavra do nome ("ME06: Delta Reign" ×
 * "Delta Species") não liga uma carta por coincidência de nome e número.
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

/** Carta da TCGdex achada numa coleção candidata. */
type Hit = { set: TcgdexSet; id: string };

/**
 * Cartas da TCGdex com o mesmo número e o mesmo nome nas coleções candidatas (no máximo uma por coleção). Sem acerto
 * pelo nome inteiro, aceita o nome sem letras soltas e sem "Star" (ex.: "Unown (M)" da TCGplayer = "Unown" M da TCGdex),
 * sempre com o mesmo número. A TCGdex às vezes tem no nome o complemento que vem antes do " - " ("Professor's Research
 * (Professor Magnolia)"), às vezes não ("Professor's Research [Professor Sada] - 189/198" = "Professor's Research"
 * sv01-189): tenta com ele e, sem acerto, sem ele. A TCGdex guarda como nome o que a TCGplayer põe entre colchetes ou
 * parênteses e o productName tira ("Professor's Research [Professor Oak]" = "Professor's Research (Professor Oak)"): por
 * último, tenta o nome junto com cada complemento do produto (`fullName`), sempre com o mesmo número.
 */
export function cardHits(name: string, number: string | null, candidates: TcgdexSet[], fullName = ''): Hit[] {
  const n = num(number);
  const find = (same: (t: TcgdexCard) => boolean) =>
    candidates.flatMap((set) => {
      const hit = (set.cards ?? []).find((t) => num(t.localId) === n && same(t));
      return hit ? [{ set, id: hit.id }] : [];
    });
  const byName = (cardName: string) => {
    const strict = nameWords(cardName);
    const direct = find((t) => nameWords(t.name) === strict);
    if (direct.length) return direct;
    const loose = looseName(cardName);
    return loose ? find((t) => looseName(t.name) === loose) : [];
  };
  const hits = byName(name);
  if (hits.length) return hits;
  const bare = withoutQualifiers(name);
  if (bare && bare !== name) {
    const found = byName(bare);
    if (found.length) return found;
  }
  for (const q of qualifiers(fullName)) {
    const found = byName(`${bare || name} ${q}`);
    if (found.length) return found;
  }
  return [];
}

/**
 * A mesma carta em mais de uma candidata (ex.: as duas metades de um kit de treinador, cada uma numerada de 1 a 30; ou
 * "Alakazam 1" em Base Set e em Expedition): vale a que o complemento do produto (`fullName`) cita, "Tierno (20 -
 * Suicune Deck)" → a metade do Suicune; senão, a candidata com mais cartas da coleção (`score`); senão, a primeira.
 */
function chooseHit(hits: Hit[], fullName: string, score?: Map<string, number>) {
  if (hits.length <= 1) return hits[0]?.id ?? null;
  const quals = setWords(qualifiers(fullName).join(' '));
  const cited = hits.find(({ set }) => [...setWords(set.name ?? '')].some((w) => quals.has(w)));
  if (cited) return cited.id;
  if (!score) return hits[0].id;
  return hits.reduce((a, b) => ((score.get(b.set.id) ?? 0) > (score.get(a.set.id) ?? 0) ? b : a)).id;
}

/** Id da TCGdex da carta: mesmo número e mesmo nome numa das coleções candidatas (cardHits e chooseHit). */
export function linkCard(name: string, number: string | null, candidates: TcgdexSet[], fullName = '') {
  return chooseHit(cardHits(name, number, candidates, fullName), fullName);
}

/**
 * Ligação pelo número completo "N/T", em qualquer coleção da TCGdex com T cartas oficiais: para os produtos de
 * coleções "de tudo um pouco" da TCGplayer (ex.: "Miscellaneous Cards & Products"), onde ficam versões com selo de
 * cartas de outras coleções ("Bulbasaur - 133/132 (Mega Evolution Stamped)"). Só liga se houver exatamente uma carta
 * com esse nome e número entre essas coleções; sem acerto, tenta o nome sem os complementos, como em linkCard
 * ("Boss's Orders [Cyrus] - 132/172" = "Boss's Orders" swsh9-132).
 */
export function linkByTotal(name: string, number: string | null, sets: TcgdexSet[], official: Map<string, number>) {
  const total = Number(number?.split('/')[1]);
  if (!number || !total) return null;
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
 * Ligações por nome de cada carta nela, ou null se ela não cobrir a maior parte da coleção. Conta cartas diferentes da
 * TCGdex, não produtos: 19 versões de "Pikachu" no mesmo Pikachu não fazem de uma coleção a reimpressão de outra.
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
    const n = new Set(links.filter(Boolean)).size;
    if (n > bestHits) [best, bestHits] = [links, n];
  }
  const distinct = new Set(names.map(nameWords)).size;
  return best && bestHits >= 5 && bestHits > distinct / 2 ? best : null;
}

/** Coleção genérica da TCGplayer: o nome dela não diz nada do selo (os complementos dizem). */
const GENERIC_GROUP = /^miscellaneous/i;
/**
 * Fatia mínima da coleção (ou da candidata, se for menor) que uma candidata precisa cobrir para ligar cartas numeradas
 * "N/T": abaixo disso, os acertos de nome e número são coincidência (ex.: Groudon 111 em "ME06: Delta Reign" e em
 * "Delta Species").
 */
const MIN_SHARE = 0.3;
/** Total impresso ("/103") que a maioria das cartas da coleção tem: é o da própria coleção. */
function ownTotal(cards: CardIn[]) {
  const count = new Map<string, number>();
  for (const c of cards) {
    const total = c.number?.split('/')[1]?.trim();
    if (total) count.set(total, (count.get(total) ?? 0) + 1);
  }
  const [total, n] = [...count].sort((a, b) => b[1] - a[1])[0] ?? [];
  return total && n > cards.length / 2 ? total : null;
}

/** Produto da coleção; `number` nulo só nas cartas japonesas sem número (a 85 não é ligada à TCGdex). */
export type CardIn = { product_id: number; name: string; number: string | null; full_name: string };

/**
 * Ligação à TCGdex e selo de cada carta de uma coleção do TCGCSV:
 *   - ligação pela coleção candidata (mesma sigla/nome), só nas candidatas que cobrem ao menos 30% da coleção (ou da
 *     candidata, se menor); a mesma carta em duas candidatas vai para a citada no produto ou para a que cobre mais
 *     (chooseHit). Numa coleção que quase não liga pelo número mas liga pelo nome numa candidata, é uma reimpressão
 *     numerada de outro jeito (linkRenumbered); senão, pelo número completo "N/T" em outra coleção (linkByTotal). Carta
 *     com o total da própria coleção ("/103" numa coleção de cartas "/103") só liga assim numa coleção que a coleção
 *     cobre quase inteira (é a mesma, com outro nome) ou que recebe 5 ou mais cartas dela: numa coleção nova, ainda
 *     fora da TCGdex, as cartas ficam sem ligação em vez de cair numa carta de mesmo nome e número de outra coleção;
 *   - selo: os complementos a mais que a versão comum da mesma carta na coleção ("(Pokemon Center Exclusive)"); na
 *     carta sem número sem o produto sem complemento de mesmo nome, só o marcador de versão (VERSION_MARK). Carta
 *     ligada pelo número completo é de outra coleção: o selo é o nome da coleção (menos a genérica "Miscellaneous")
 *     mais os complementos, ex.: "Jumbo Cards · Prismatic Evolutions Stamped", "First Partner Pack". O marcador de versão
 *     escrito antes do número ("Ampharos (Mirror Holofoil) - 033/070") é sempre selo.
 */
export function linkAndStamp(groupName: string, cards: CardIn[], candidates: TcgdexSet[], sets: TcgdexSet[], official: Map<string, number>) {
  const parsed = cards.map((c) => {
    const cut = c.full_name.indexOf(' - ');
    // Marcador antes do número: o mesmo " - " do productName, que tira do nome o que aqui vira selo.
    const dash = outerDash(c.full_name);
    const marks = dash > 0 ? qualifiers(c.full_name.slice(0, dash)).filter((q) => VERSION_MARK.test(q)) : [];
    return { ...c, marks, quals: qualifiers(cut > 0 ? c.full_name.slice(cut) : c.full_name) };
  });
  // Versão comum de cada carta (nome + número): a com menos complementos. Sem número, só o nome, e só o produto sem
  // nenhum complemento é a versão comum: promos sem número com o mesmo nome ("Pikachu (Birthday)", "Pikachu (Ivy)")
  // podem ser cartas diferentes, nenhuma é versão da outra. O produto com marcador antes do número nunca é a comum.
  const keyOf = (c: CardIn) => `${nameWords(c.name)}|${num(c.number)}`;
  const base = new Map<string, string[]>();
  for (const c of parsed) {
    if (c.marks.length || (!c.number && c.quals.length)) continue;
    const cur = base.get(keyOf(c));
    if (!cur || c.quals.length < cur.length) base.set(keyOf(c), c.quals);
  }
  // Quantas cartas da coleção cada candidata tem (pelo nome e número): só ligam as que cobrem uma boa parte.
  const hits = parsed.map((c) => cardHits(c.name, c.number, candidates, c.full_name));
  const score = new Map<string, number>();
  for (const h of hits) for (const id of new Set(h.map((x) => x.set.id))) score.set(id, (score.get(id) ?? 0) + 1);
  const sizeOf = new Map(candidates.map((s) => [s.id, s.cards?.length ?? 0]));
  const covers = (id: string) => (score.get(id) ?? 0) >= MIN_SHARE * Math.min(parsed.length, sizeOf.get(id) || parsed.length);
  // Número com total ("111/103") é de coleção numerada, onde nome e número se repetem entre coleções; o de promo
  // ("SWSH167", "221") já diz qual é a carta.
  const direct = parsed.map((c, i) =>
    chooseHit(c.number?.includes('/') ? hits[i].filter((h) => covers(h.set.id)) : hits[i], c.full_name, score),
  );
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
  // Carta com o total da própria coleção ligada por fora a uma coleção que recebe poucas (menos de 5) é coincidência de
  // nome e número; 5 ou mais da mesma coleção são versões com selo dela (ex.: exclusivas de uma região com selo da Liga).
  const total = ownTotal(cards);
  for (const x of linked) {
    const set = x.cross ? setOf(x.cross) : '';
    if (x.cross && !home.has(set) && (count.get(set) ?? 0) < 5 && total && x.c.number?.split('/')[1]?.trim() === total) x.cross = null;
  }
  // Sem nenhuma ligação, vale a carta de mesmo número e mesma primeira palavra numa candidata que cobre a coleção: é a
  // mesma carta com o nome escrito de outro jeito ("Dusknoir LV.X" = "Dusknoir" dp7-96, "Unit Energy FDY", "Miracle Sphere
  // Alpha" = "Miracle Sphere α"). Nunca troca uma ligação existente, só preenche quem está sem nenhuma.
  const sameSlot = (c: CardIn) => {
    if (!c.number || renumbered) return null;
    const n = num(c.number);
    const first = nameWords(c.name).split(' ')[0];
    const found = candidates
      .filter((s) => covers(s.id))
      .flatMap((s) => (s.cards ?? []).filter((t) => num(t.localId) === n && nameWords(t.name).split(' ')[0] === first));
    return found.length === 1 ? found[0].id : null;
  };
  const tag = GENERIC_GROUP.test(groupName) ? [] : [groupName];
  return linked.map(({ c, direct: own, cross }) => {
    const other = !!cross && !home.has(setOf(cross));
    const common = base.get(keyOf(c));
    // Sem a versão comum (carta sem número sem o produto sem complemento), o selo é só o marcador de versão do próprio
    // produto ("Mirror Holofoil", "Master Ball Pattern"); o resto do complemento é o nome da promo, não um selo.
    const extra = other
      ? [...tag, ...c.quals]
      : common
        ? c.quals.filter((q) => !common.includes(q))
        : c.quals.filter((q) => VERSION_MARK.test(q));
    const stamps = [...new Set([...c.marks, ...extra])];
    return { product_id: c.product_id, tcgdex_id: own ?? cross ?? sameSlot(c), stamp: stamps.length ? stamps.join(' · ') : null };
  });
}
