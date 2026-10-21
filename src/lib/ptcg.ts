import { cached } from './tcgdex';

/**
 * Imagem reserva da pokemontcg.io, para cartas que a TCGdex ainda não tem imagem
 * (ex.: Charizard da 30th Classic Collection). As duas bases numeram algumas coleções
 * de forma diferente, então o cruzamento é por nome da carta + nome da coleção.
 */

type PtcgCard = { id: string; name: string; number: string; set: { name: string }; images: { small: string; large: string } };

const API = 'https://api.pokemontcg.io/v2/cards';

// A API às vezes responde 500/502 sem motivo: tenta de novo algumas vezes.
async function getWithRetry(url: string, tries = 4): Promise<{ data: PtcgCard[] }> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      last = new Error(`pokemontcg.io ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  throw last;
}

function cardsNamed(name: string) {
  return cached(`ptcg:name:${name.toLowerCase()}`, async () => {
    const q = encodeURIComponent(`name:"${name.replace(/"/g, '')}"`);
    const body = await getWithRetry(`${API}?q=${q}&pageSize=250&select=id,name,number,set,images`);
    return body.data ?? [];
  });
}

// ---------- Scrydex (CDN de imagens da pokemontcg.io, acessível direto pelo id) ----------

const SCRYDEX = 'https://images.scrydex.com/pokemon';
/**
 * A Scrydex responde 200 com o verso da carta para ids que não existem; esse verso tem sempre esta ETag e
 * este tamanho em bytes. No navegador os dois cabeçalhos ficam escondidos (CORS): aí mede a imagem baixada.
 */
const SCRYDEX_PLACEHOLDER_ETAG = 'cfl2loWl84E8tUjrC-Q-I0D0Jh';
const SCRYDEX_PLACEHOLDER_BYTES = '45551';
/** Coleções com id diferente entre TCGdex e pokemontcg.io que não seguem a regra geral. */
const SET_ALIASES: Record<string, string[]> = {
  '30th-c': ['me55c'],
  '30th': ['me55'], // 30th Celebration
  hgssp: ['hsp'], // HGSS Black Star Promos
  cel25cc: ['cel25c'], // Celebrations: Classic Collection
  lc: ['base6'], // Legendary Collection
  fut2020: ['fut20'],
  'sv10.5w': ['rsv10pt5'], // White Flare
  'sv10.5b': ['zsv10pt5'], // Black Bolt
};

/** Ids possíveis da coleção na pokemontcg.io a partir do id da TCGdex: "sv03.5" → sv3pt5, sv35; "me01" → me1. */
function ptcgSetIds(tcgdexSetId: string) {
  const id = tcgdexSetId.toLowerCase();
  const plain = id.replace(/(\D)0+(\d)/g, '$1$2');
  return [...new Set([...(SET_ALIASES[id] ?? []), plain.replace('.', 'pt'), plain.replace('.', ''), id])];
}

/** Erro de rede propaga (não entra no cache); 404 ou verso padrão = não existe. */
async function scrydexExists(url: string) {
  const res = await fetch(url, { method: 'HEAD' });
  if (res.status >= 500) throw new Error(`Scrydex ${res.status}`);
  if (!res.ok) return false;
  const etag = res.headers.get('etag') ?? '';
  const bytes = res.headers.get('content-length') ?? '';
  if (etag || bytes) return !etag.includes(SCRYDEX_PLACEHOLDER_ETAG) && bytes !== SCRYDEX_PLACEHOLDER_BYTES;
  // Cabeçalhos escondidos (navegador): baixa a imagem uma vez e mede (o resultado vai para o cache).
  const body = await fetch(url).then((r) => r.arrayBuffer());
  return String(body.byteLength) !== SCRYDEX_PLACEHOLDER_BYTES;
}

/** Dados públicos da pokemontcg.io no GitHub: arquivo estático por coleção, com nome e imagens de cada carta. */
const GITHUB_SET = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en';
type SetCard = { id: string; name: string; number: string; images: { small: string; large: string } };

/** Cartas de uma coleção da pokemontcg.io (null = coleção não existe lá). Erro de rede propaga (não entra no cache). */
function setCards(ptcgSetId: string) {
  return cached(`ptcg:set:v1:${ptcgSetId}`, async () => {
    const res = await fetch(`${GITHUB_SET}/${ptcgSetId}.json`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const cards = (await res.json()) as SetCard[];
    return cards.map(({ id, name, number, images }) => ({ id, name, number, images }));
  });
}

const sameName = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9δ]+/g, '');
  return norm(a) === norm(b);
};

/** Nome em inglês da carta pela TCGdex (PT e EN usam o mesmo id). */
async function englishName(cardId: string) {
  const d = await cached(`tcgdex:en-name:${cardId}`, async () => {
    const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TCGdex ${res.status}`);
    return ((await res.json()) as { name?: string }).name ?? null;
  });
  return d ?? undefined;
}

/**
 * Imagem reserva pelo id da TCGdex, SEMPRE conferindo o nome da carta:
 *   1. arquivo da coleção da pokemontcg.io no GitHub: carta com o mesmo número E o mesmo nome; se o
 *      número for de outra carta (coleções numeradas de outro jeito, ex.: 30th-c-011 Crobat G = me55c-47),
 *      procura pelo nome na coleção;
 *   2. só se a coleção não existir lá (ex.: promos recentes), a Scrydex pelo número — e nunca para
 *      coleções de numeração diferente (SET_ALIASES).
 * Não usa a API da pokemontcg.io, que cai com frequência (502).
 */
export function scrydexImage(cardId: string, localId?: string, nameEn?: string) {
  return cached(`scrydex:v4:${cardId}`, async () => {
    const cut = cardId.lastIndexOf('-');
    if (cut <= 0) return null;
    const setId = cardId.slice(0, cut).toLowerCase();
    const num = (localId ?? cardId.slice(cut + 1)).replace(/^0+(?=\w)/, '');
    const name = nameEn ?? (await englishName(cardId));
    const candidates = ptcgSetIds(setId);
    let anySetFound = false;
    for (const set of candidates) {
      const cards = await setCards(set);
      if (!cards) continue;
      anySetFound = true;
      if (!name) continue;
      const hit =
        cards.find((c) => c.number.toLowerCase() === num.toLowerCase() && sameName(c.name, name)) ??
        cards.find((c) => sameName(c.name, name));
      if (hit) return hit.images;
    }
    if (anySetFound || SET_ALIASES[setId]) return null;
    for (const set of candidates) {
      const base = `${SCRYDEX}/${set}-${num}`;
      if (await scrydexExists(`${base}/small`)) return { small: `${base}/small`, large: `${base}/large` };
    }
    return null;
  });
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

/** URL da imagem (small/large) da carta com este nome em inglês, nesta coleção (nome em inglês). */
export async function ptcgImage(cardNameEn: string, setNameEn: string, localId?: string) {
  const list = await cardsNamed(cardNameEn);
  const want = tokens(setNameEn);
  const num = localId?.replace(/^0+(?=\d)/, '');
  let best: { card: PtcgCard; score: number } | undefined;
  for (const c of list) {
    if (c.name.toLowerCase() !== cardNameEn.toLowerCase()) continue;
    const have = tokens(c.set.name);
    const overlap = [...want].filter((t) => have.has(t)).length / Math.max(1, want.size);
    if (overlap < 0.67) continue;
    const score = overlap + (num && c.number === num ? 1 : 0);
    if (!best || score > best.score) best = { card: c, score };
  }
  return best?.card.images;
}
