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

/** Busca por nome (EN/PT ou JP) ou número, ex.: "pika", "25", "#025". */
export function searchSpecies(query: string): Species | undefined {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return undefined;
  if (/^\d+$/.test(q)) return getSpecies(Number(q));
  return (
    POKEDEX.find((s) => s.name.toLowerCase() === q || s.ja === query.trim()) ??
    POKEDEX.find((s) => s.name.toLowerCase().startsWith(q)) ??
    POKEDEX.find((s) => s.name.toLowerCase().includes(q) || s.ja.includes(query.trim()))
  );
}

/**
 * Pokémon citado no nome da carta ("Nidorina da Equipe Rocket", "Giovanni's Nidorina", "Mega Charizard X ex").
 * Fica com o nome mais longo que aparece como palavra inteira, para "Mewtwo" não virar "Mew".
 */
export function speciesInCardName(cardName: string): Species | undefined {
  const name = cardName.toLowerCase();
  let best: Species | undefined;
  for (const s of POKEDEX) {
    const n = s.name.toLowerCase();
    const at = name.indexOf(n);
    if (at < 0) continue;
    const before = name[at - 1];
    const after = name[at + n.length];
    const isWord = (!before || !/\p{L}/u.test(before)) && (!after || !/\p{L}/u.test(after));
    if ((isWord || name.includes(s.ja)) && (!best || n.length > best.name.length)) best = s;
  }
  return best ?? POKEDEX.find((s) => cardName.includes(s.ja));
}
