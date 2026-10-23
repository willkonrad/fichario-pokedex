// Reconhecimento do produto do MYP Cards a partir dos resultados da API (funções puras, sem rede, testáveis).

export type MypProduct = {
  internal_code: number;
  card_code: string;
  edition_code?: string | null;
  name_en?: string | null;
  name_pt?: string | null;
  min_price?: string | null;
  avg_price?: string | null;
  max_price?: string | null;
  available_quantity?: number | null;
  link?: string | null;
  /** Foto da carta em português e em inglês (sem foto, vem só o endereço base "https://img.mypcards.com/"). */
  img_pt?: string | null;
  img_en?: string | null;
};

/** "007", "SWSH001", "TG06" → "7", "swsh1", "tg6". */
export const num = (s: string) => s.trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1');

/**
 * Número e versão do código do produto: "pokemon_meg_001/132p1" → { number: "1", version: "p1" };
 * "pokemon_svp_218" → { number: "218" }. O código às vezes vem com erros de digitação no prefixo ("pokemomn_"),
 * por isso só o trecho depois do último "_" é usado.
 */
export function parseMypCode(code: string) {
  const rest = code.slice(code.lastIndexOf('_') + 1);
  const version = rest.match(/(?:\/\d+|\d)(p\d+)$/i)?.[1]?.toLowerCase();
  const number = num((version ? rest.slice(0, -version.length) : rest).split('/')[0]);
  return { number, version };
}

/** "R$ em texto" da API ("15.00") → número; vazio ou nulo → undefined. */
export const price = (s?: string | null) => (s == null || s === '' ? undefined : Number(s));

/** Palavras genéricas que não identificam um selo. */
const STAMP_STOP = new Set(['pokemon', 'promo', 'stamp', 'stamped', 'carimbada', 'selo', 'card', 'cards']);

/**
 * Palavras significativas (4+ letras, sem acento) de um nome ou selo, com os nomes de selo escritos de jeitos
 * diferentes juntados numa palavra só ("30th Pokeday" na TCGdex = "Pokemon Day 2026" no MYP).
 */
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/pokemon\s*day|pokeday/g, 'pokemonday')
    .replace(/pokemon\s*center/g, 'pokemoncenter')
    .replace(/pre[\s-]?release/g, 'prerelease')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STAMP_STOP.has(w));

/** Nome do produto sem o número no fim e sem acento: "Spearow - 102/132" → "spearow". */
const plainName = (s?: string | null) =>
  (s ?? '')
    .replace(/\s+-\s+[\w/]+$/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Produto da carta entre os resultados da busca: mesma edição (sigla oficial da coleção) e mesmo número.
 *   - Versão com selo (promo/staff): o produto próprio da versão (código terminado em p1, p2…) só quando o nome dele
 *     traz uma palavra do selo marcado na carta (`note`); senão, o produto comum, que não vale para a versão.
 *   - Versões comuns: só produtos comuns (nunca o de uma versão com selo).
 * Produtos comuns repetidos com o mesmo código são versões cadastradas à parte: a comum é a com mais unidades à venda.
 * Sem o número exato: o número com uma letra no fim ("079a", como o MYP cadastra algumas promos) e, nas coleções
 * que o MYP numera de outro jeito (`byName`, ex.: as coleções clássicas, com o número da carta original), o único
 * produto da edição com o nome da carta.
 */
export function pickMypProduct(
  products: MypProduct[],
  abbr: string,
  localId: string,
  variant: string,
  note = '',
  byName?: string[],
) {
  const want = num(localId);
  const ed = abbr.split(':')[0].trim().toLowerCase();
  const edition = products.filter((p) => (p.edition_code ?? '').trim().toLowerCase() === ed);
  let same = edition.filter((p) => parseMypCode(p.card_code).number === want);
  if (!same.length) same = edition.filter((p) => /^(.+\d)[a-z]$/.exec(parseMypCode(p.card_code).number)?.[1] === want);
  if (!same.length && byName?.length) {
    const names = byName.map(plainName);
    const hits = edition.filter((p) => !parseMypCode(p.card_code).version && names.includes(plainName(p.name_en)));
    if (new Set(hits.map((p) => p.card_code)).size === 1) same = hits;
  }
  const base = same.filter((p) => !parseMypCode(p.card_code).version);
  if (variant === 'wPromo' || variant === 'staff') {
    // Palavras do selo que não são do nome da carta (ex.: "Pokemon Day" em "Bulbasaur (Pokemon Day 2026)").
    const cardWords = new Set(words(`${base[0]?.name_en ?? same[0]?.name_en ?? ''} ${base[0]?.name_pt ?? ''}`));
    const stamp = words(note).filter((w) => !cardWords.has(w));
    const own = stamp.length
      ? same.filter(
          (p) =>
            parseMypCode(p.card_code).version &&
            words(`${p.name_en ?? ''} ${p.name_pt ?? ''}`).some((w) => !cardWords.has(w) && stamp.includes(w)),
        )
      : [];
    if (own.length === 1) return { product: own[0], ownVersion: true };
  }
  if (!base.length) return undefined;
  const product = [...base].sort((a, b) => (b.available_quantity ?? 0) - (a.available_quantity ?? 0))[0];
  return { product, ownVersion: false };
}
