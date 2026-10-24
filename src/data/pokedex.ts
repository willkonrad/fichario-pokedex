import raw from './pokedex.json';

export type Species = { id: number; name: string; ja: string };

export const POKEDEX: Species[] = raw as Species[];
export const TOTAL_SPECIES = POKEDEX.length;

export function getSpecies(dex: number): Species | undefined {
  return POKEDEX[dex - 1];
}

export function spriteUrl(dex: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dex}.png`;
}

export function formatDex(dex: number) {
  return `#${String(dex).padStart(3, '0')}`;
}

/**
 * Nome para comparar na busca de Pokémon: sem acento, pontuação nem espaço, com ♀/♂ como f/m.
 * "Farfetch’d" → "farfetchd", "Mr. Mime" → "mrmime", "Ho-Oh" → "hooh", "Type: Null" → "typenull", "Nidoran♀" → "nidoranf".
 */
export function speciesKey(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .replace(/[^a-z0-9]+/g, '');
}

/** Chaves de busca de cada Pokémon (calculadas uma vez): o nome e, nos Nidoran, "fêmea/macho" e "female/male". */
const KEYS: { s: Species; keys: string[] }[] = POKEDEX.map((s) => {
  const key = speciesKey(s.name);
  const base = speciesKey(s.name.replace(/[♀♂]/g, ''));
  const extra = s.name.includes('♀') ? [`${base}femea`, `${base}female`] : s.name.includes('♂') ? [`${base}macho`, `${base}male`] : [];
  return { s, keys: [key, ...extra] };
});

/**
 * Pokémon que combinam com a busca, do melhor para o pior: número ("25", "#025"), nome igual, nome que começa com a
 * busca e nome que contém a busca, sem depender de acento, apóstrofo, ponto, hífen ou espaço ("farfetch'd", "flabebe",
 * "mr mime", "ho oh", "porygon z", "type null", "nidoran macho"). Também pelo nome em japonês.
 */
export function searchSpeciesList(query: string, max = 8): Species[] {
  const q = query.trim().replace(/^#/, '');
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const s = getSpecies(Number(q));
    return s ? [s] : [];
  }
  const key = speciesKey(q);
  const ja = q.normalize('NFC');
  const ranked: Species[][] = [[], [], [], []];
  for (const { s, keys } of KEYS) {
    if (key && keys.includes(key)) ranked[0].push(s);
    else if (s.ja === ja) ranked[0].push(s);
    else if (key && keys.some((k) => k.startsWith(key))) ranked[1].push(s);
    else if (s.ja.startsWith(ja)) ranked[2].push(s);
    else if ((key.length >= 2 && keys.some((k) => k.includes(key))) || s.ja.includes(ja)) ranked[3].push(s);
  }
  return ranked.flat().slice(0, max);
}

/** Busca por nome (EN/PT ou JP) ou número, ex.: "pika", "25", "#025", "farfetchd", "nidoran macho". */
export function searchSpecies(query: string): Species | undefined {
  return searchSpeciesList(query, 1)[0];
}

/** Apóstrofo e símbolo escritos de um jeito só, para achar "Farfetch’d" em "Farfetch'd" e "Nidoran♀" em "Nidoran ♀". */
const tidy = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘`´ʼ]/g, "'")
    .replace(/\s+([♀♂])/g, '$1');

/**
 * Pokémon citado no nome da carta ("Nidorina da Equipe Rocket", "Giovanni's Nidorina", "Mega Charizard X ex").
 * Fica com o nome mais longo que aparece como palavra inteira, para "Mewtwo" não virar "Mew".
 */
export function speciesInCardName(cardName: string): Species | undefined {
  const name = tidy(cardName);
  let best: Species | undefined;
  for (const s of POKEDEX) {
    const n = tidy(s.name);
    const at = name.indexOf(n);
    if (at < 0) continue;
    const before = name[at - 1];
    const after = name[at + n.length];
    const isWord = (!before || !/\p{L}/u.test(before)) && (!after || !/\p{L}/u.test(after));
    if ((isWord || name.includes(s.ja)) && (!best || n.length > tidy(best.name).length)) best = s;
  }
  return best ?? POKEDEX.find((s) => cardName.includes(s.ja));
}
