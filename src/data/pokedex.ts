import raw from './pokedex.json';

/** `ko`, `zhHant` e `zhHans` servem para achar o Pokémon pelo nome colado (PokéAPI); alguns podem faltar. */
export type Species = { id: number; name: string; ja: string; ko?: string; zhHant?: string; zhHans?: string };

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

/** Letra japonesa, coreana ou chinesa (kana, hangul, ideograma). */
const ASIAN = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ]/;

/**
 * Forma comparável de um nome em japonês, coreano ou chinês: NFKC (meia-largura e largura cheia viram a forma comum:
 * "ﾘｻﾞｰﾄﾞﾝ" → "リザードン", "ポリゴン２" → "ポリゴン2") e hiragana como katakana ("りざーどん" → "リザードン").
 */
export function asianKey(s: string) {
  return s.normalize('NFKC').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** Chaves de busca de cada Pokémon (calculadas uma vez): o nome e, nos Nidoran, "fêmea/macho" e "female/male". */
const KEYS: { s: Species; keys: string[]; ja: string; asian: string[] }[] = POKEDEX.map((s) => {
  const key = speciesKey(s.name);
  const base = speciesKey(s.name.replace(/[♀♂]/g, ''));
  const extra = s.name.includes('♀') ? [`${base}femea`, `${base}female`] : s.name.includes('♂') ? [`${base}macho`, `${base}male`] : [];
  return { s, keys: [key, ...extra], ja: asianKey(s.ja), asian: [s.ko, s.zhHant, s.zhHans].filter((n): n is string => !!n).map(asianKey) };
});

/** Começos colados ao nome em japonês e coreano, com a palavra que a busca entende ("メガリザードン" = "mega リザードン"). */
const ASIAN_PREFIXES: [RegExp, string][] = [
  [/^メガ(?=.)/, 'mega'],
  [/^カガヤク(?=.)/, 'radiant'],
  [/^메가(?=.)/, 'mega'],
];
/** Final latino colado ao nome em japonês, coreano ou chinês: "リザードンex", "リザードンVMAX", "メガリザードンXex". */
const LATIN_SUFFIX = /([XY]?)(vmax|vstar|ex|gx|v)?$/i;

/**
 * Separa do nome em japonês, coreano ou chinês o que vem colado nele: o final latino (ex, V, VMAX, VSTAR, GX e o X/Y
 * da Mega) e o começo メガ/かがやく/메가, que vira "mega"/"radiant". "メガリザードンXex" → "mega リザードン X ex",
 * "かがやくリザードン" → "radiant リザードン", "리자몽ex" → "리자몽 ex". Palavras sem letra asiática ficam como estão.
 */
export function splitNameAffixes(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (!ASIAN.test(word)) return word;
      const parts = splitAsianWord(asianKey(word));
      return [...parts.before, parts.core, ...parts.after].join(' ');
    })
    .join(' ');
}

/** Começo de algum nome de Pokémon em japonês, coreano ou chinês ("メガニウム" é Meganium, não "mega ニウム"). */
const startsSpeciesName = (s: string) => KEYS.some((k) => k.ja.startsWith(s) || k.asian.some((n) => n.startsWith(s)));

function splitAsianWord(word: string): { before: string[]; core: string; after: string[] } {
  let core = word;
  const after: string[] = [];
  const tail = LATIN_SUFFIX.exec(core);
  // Só quando o final vem depois de uma letra asiática (não corta um nome latino) e a palavra não é um nome.
  if (tail && tail[0] && ASIAN.test(core.slice(0, tail.index).slice(-1)) && !startsSpeciesName(core)) {
    after.push(...[tail[1], tail[2]].filter((p): p is string => !!p));
    core = core.slice(0, tail.index);
  }
  const before: string[] = [];
  for (const [re, label] of ASIAN_PREFIXES) {
    if (re.test(core) && !startsSpeciesName(core)) {
      before.push(label);
      core = core.replace(re, '');
      break;
    }
  }
  return { before, core, after };
}

const NONE: string[] = [];

/** Um Pokémon achado e o quanto combina: 0 = número ou nome igual, 1 e 2 = começa com a busca, 3 = contém. */
export type SpeciesHit = { species: Species; rank: 0 | 1 | 2 | 3 };

/** Como searchSpeciesList, dizendo o quanto cada um combina. */
export function searchSpeciesRanked(query: string, max = 8): SpeciesHit[] {
  const q = query.trim().replace(/^#/, '');
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const s = getSpecies(Number(q));
    return s ? [{ species: s, rank: 0 }] : [];
  }
  const ja = asianKey(q);
  const asianQuery = ASIAN.test(ja);
  // Com letra japonesa, coreana ou chinesa, o pedaço latino sozinho não é nome: "リザードンex" não é Exeggutor.
  const key = asianQuery ? '' : speciesKey(ja);
  // Coreano e chinês só com letra de fora do alfabeto latino: a busca em PT, EN e JP segue dando o mesmo resultado.
  const others = /[^\u0000-ɏ]/.test(ja);
  const ranked: Species[][] = [[], [], [], []];
  for (const { s, keys, ja: sJa, asian } of KEYS) {
    const names = others ? asian : NONE;
    if (key && keys.includes(key)) ranked[0].push(s);
    else if (sJa === ja || names.includes(ja)) ranked[0].push(s);
    else if (key && keys.some((k) => k.startsWith(key))) ranked[1].push(s);
    else if (sJa.startsWith(ja) || names.some((n) => n.startsWith(ja))) ranked[2].push(s);
    else if ((key.length >= 2 && keys.some((k) => k.includes(key))) || sJa.includes(ja) || names.some((n) => n.includes(ja))) ranked[3].push(s);
  }
  // Nome com o final ou o começo colado ("リザードンex", "メガリザードンXex", "かがやくリザードン", "리자몽V"): sem nenhum
  // nome igual, vale o nome sem eles (o "ex" separado vira filtro em quem separa as palavras: ver splitNameAffixes).
  if (asianQuery && !ranked[0].length) {
    const { core } = splitAsianWord(ja);
    if (core && core !== ja) {
      const exact = KEYS.filter((k) => k.ja === core || k.asian.includes(core)).map((k) => k.s);
      if (exact.length) {
        for (let r = 1; r < ranked.length; r++) ranked[r] = ranked[r].filter((s) => !exact.includes(s));
        ranked[0].push(...exact);
      }
    }
  }
  return ranked.flatMap((list, rank) => list.map((species) => ({ species, rank: rank as SpeciesHit['rank'] }))).slice(0, max);
}

/**
 * Pokémon que combinam com a busca, do melhor para o pior: número ("25", "#025"), nome igual, nome que começa com a
 * busca e nome que contém a busca, sem depender de acento, apóstrofo, ponto, hífen ou espaço ("farfetch'd", "flabebe",
 * "mr mime", "ho oh", "porygon z", "type null", "nidoran macho"). Também pelo nome em japonês, coreano e chinês.
 */
export function searchSpeciesList(query: string, max = 8): Species[] {
  return searchSpeciesRanked(query, max).map((hit) => hit.species);
}

/** Busca por nome (EN/PT ou JP) ou número, ex.: "pika", "25", "#025", "farfetchd", "nidoran macho". */
export function searchSpecies(query: string): Species | undefined {
  return searchSpeciesList(query, 1)[0];
}

/** Pokémon pela chave do nome (speciesKey) e pelas grafias dos Nidoran ("nidoranfemale"), para speciesInCardName. */
const BY_KEY = new Map(KEYS.flatMap(({ s, keys }) => keys.map((k) => [k, s] as const)));
/** Nomes de Pokémon têm no máximo 2 palavras ("Mr. Mime", "Tapu Koko", "Nidoran F"); 3 dá folga. */
const NAME_WORDS_MAX = 3;

/**
 * Pokémon citado no nome da carta ("Nidorina da Equipe Rocket", "Giovanni's Nidorina", "Mega Charizard X ex",
 * "Charizard-GX"), comparando pela speciesKey de uma a três palavras seguidas: sem depender de acento ("Flabebe"),
 * apóstrofo, ponto ou hífen ("Ho-Oh"), e com o F/M final como ♀/♂ ("Nidoran F", "NidoranM"). Fica com o nome mais longo,
 * para "Mewtwo" não virar "Mew" e "Porygon-Z" não virar "Porygon". Nome em japonês: o nome japonês mais longo contido
 * ("レアコイル" é Magneton, não Magnemite). O pedaço latino de uma palavra japonesa ("リザードンex") não conta.
 */
export function speciesInCardName(cardName: string): Species | undefined {
  const words = cardName.normalize('NFKC').split(/[\s\-‐‑–—&/,()+]+/).filter(Boolean);
  let best: Species | undefined;
  let bestLen = 0;
  for (let i = 0; i < words.length; i++) {
    let key = '';
    for (let j = i; j < Math.min(words.length, i + NAME_WORDS_MAX) && !ASIAN.test(words[j]); j++) {
      // Possessivo não é parte do nome: "Pikachu's" é Pikachu.
      key += speciesKey(words[j].replace(/['’‘`´ʼ]s$/i, ''));
      const s = BY_KEY.get(key);
      if (s && key.length > bestLen) {
        best = s;
        bestLen = key.length;
      }
    }
  }
  if (best || !ASIAN.test(cardName)) return best;
  const name = asianKey(cardName);
  for (const k of KEYS) {
    if (k.ja && k.ja.length > bestLen && name.includes(k.ja)) {
      best = k.s;
      bestLen = k.ja.length;
    }
  }
  return best;
}
