import { getSpecies } from '@/data/pokedex';

import { isOversize, JAPANESE, plainName, stampVariant, type CatalogRow } from './catalog';
import { supabase } from './supabase';
import type { Variant } from './types';

/**
 * Produto japonês da TCGplayer (categoria 85 do catálogo do TCGCSV) de uma carta da TCGdex japonesa (cardId sem
 * "tcgp-"). A 85 não é ligada à TCGdex, então a carta é achada pela coleção (sigla do grupo = setId), pelo número
 * impresso ("088/081") e, nas cartas de Pokémon, pelo nome em inglês do Pokémon. Na dúvida (nenhum produto ou mais de
 * um), a carta fica sem produto: nunca o primeiro achado. Tudo em lote: uma consulta dos grupos (guardada na memória)
 * e uma consulta de produtos por grupo.
 */

export type JaCardRef = {
  cardId: string;
  setId?: string;
  localId?: string;
  setTotal?: number;
  /** Pokémon da carta (0 ou ausente: carta sem Pokémon, achada só pelo número). */
  dex?: number;
  variant?: Variant;
  variantNote?: string;
};

/** Grupo (coleção) da 85: id e sigla. */
export type JaGroup = { group_id: number; abbr: string | null; name?: string | null };

/** As mesmas colunas de catalog.ts (CatalogRow). */
const COLUMNS = 'product_id, category, group_id, name, full_name, number, rarity, image, stamp, tcgdex_id, tcg_groups(name, abbr, published_on)';

/** Os grupos mudam pouco (lista do TCGCSV): guardados na memória por 6 horas. */
const GROUPS_MS = 6 * 3_600_000;

/** Número como a TCGplayer imprime nas japonesas: "88" e 81 → "088/081". Sem número ou total, undefined. */
export function japaneseNumber(localId?: string, setTotal?: number): string | undefined {
  const id = (localId ?? '').trim();
  if (!/^\d+$/.test(id) || !setTotal || !Number.isInteger(setTotal) || setTotal <= 0) return undefined;
  return `${id.padStart(3, '0')}/${String(setTotal).padStart(3, '0')}`;
}

/** Grupos da 85 com a sigla da coleção da carta, sem diferenciar maiúsculas (a sigla pode se repetir). */
export function groupsForSet(groups: JaGroup[], setId?: string): JaGroup[] {
  const want = (setId ?? '').trim().toLowerCase();
  if (!want) return [];
  return groups.filter((g) => (g.abbr ?? '').trim().toLowerCase() === want);
}

/**
 * O nome do produto tem o nome do Pokémon, em palavras inteiras ("Mega Zeraora ex" tem "Zeraora"; "Mewtwo" não tem
 * "Mew"), também quando o catálogo junta as palavras ("NidoranF" = "Nidoran♀", "MrMime" = "Mr. Mime").
 */
export function nameHasSpecies(productName: string, speciesName: string): boolean {
  const words = plainName(productName).split(' ').filter(Boolean);
  const want = plainName(speciesName).replace(/ /g, '');
  if (!want) return false;
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let j = i; j < words.length && joined.length < want.length; j++) {
      joined += words[j];
      if (joined === want) return true;
    }
  }
  return false;
}

const slotKey = (groupId: number, number: string) => `${groupId}|${number}`;

/** Linhas do catálogo pela coleção e número ("<grupo>|<número>"). */
function indexRows(rows: CatalogRow[]) {
  const out = new Map<string, CatalogRow[]>();
  for (const r of rows) {
    if (r.category !== JAPANESE || !r.number) continue;
    const k = slotKey(r.group_id, r.number.trim());
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

function candidatesIn(card: JaCardRef, groups: JaGroup[], index: Map<string, CatalogRow[]>): CatalogRow[] {
  if (card.cardId.startsWith('tcgp-')) return [];
  const number = japaneseNumber(card.localId, card.setTotal);
  if (!number) return [];
  const dex = card.dex ?? 0;
  const species = dex > 0 ? getSpecies(dex)?.name : undefined;
  // Carta de Pokémon com um número fora da Pokédex: sem o nome para conferir, fica de fora.
  if (dex > 0 && !species) return [];
  return groupsForSet(groups, card.setId)
    .flatMap((g) => index.get(slotKey(g.group_id, number)) ?? [])
    .filter((r) => !isOversize(r.stamp) && (!species || nameHasSpecies(r.name, species)));
}

/**
 * Produtos da 85 que podem ser a carta, de todas as versões (comum, Mirror, Poké Ball…): grupo com a sigla = setId
 * (com sigla repetida, vale o grupo cujo total impresso nos números = setTotal), número "<localId>/<setTotal>" com 3
 * dígitos e, quando `dex > 0`, o nome do Pokémon no nome do produto. Função pura (as linhas já lidas do banco).
 */
export function japaneseCandidatesFrom(card: JaCardRef, groups: JaGroup[], rows: CatalogRow[]): CatalogRow[] {
  return candidatesIn(card, groups, indexRows(rows));
}

/** Versões que a 85 vende como produto à parte, com selo próprio. */
const STAMPED: Variant[] = ['reverse', 'pokeball', 'masterball'];

/**
 * O produto da versão da carta, entre os candidatos: o do selo salvo (`variantNote` igual ao selo do produto, da mesma
 * variação); senão, 'reverse' ⇒ o produto "Mirror …"/"Reverse …", 'pokeball'/'masterball' ⇒ o "… Ball Pattern"
 * correspondente e as outras ('normal', 'holo'…) ⇒ o produto sem selo. Exatamente um; zero ou mais de um, nenhum.
 */
export function pickJapaneseProduct(card: Pick<JaCardRef, 'variant' | 'variantNote'>, rows: CatalogRow[]): CatalogRow | undefined {
  const note = (card.variantNote ?? '').trim();
  const exact = note
    ? rows.filter((r) => r.stamp != null && r.stamp.trim() === note && (!card.variant || stampVariant(r.stamp, JAPANESE) === card.variant))
    : [];
  const want = card.variant && STAMPED.includes(card.variant) ? card.variant : undefined;
  const list = exact.length ? exact : want ? rows.filter((r) => r.stamp && stampVariant(r.stamp, JAPANESE) === want) : rows.filter((r) => !r.stamp);
  return list.length === 1 ? list[0] : undefined;
}

let groupsCache: { at: number; groups: Promise<JaGroup[]> } | undefined;

/** Grupos da 85 (uma consulta, guardada na memória; um erro não fica guardado). */
async function japaneseGroups(): Promise<JaGroup[]> {
  const client = supabase;
  if (!client) return [];
  if (groupsCache && Date.now() - groupsCache.at < GROUPS_MS) return groupsCache.groups;
  const groups = (async () => {
    const { data, error } = await client.from('tcg_groups').select('group_id, abbr, name').eq('category', JAPANESE);
    if (error) throw error;
    return (data ?? []) as JaGroup[];
  })();
  const entry = { at: Date.now(), groups };
  groupsCache = entry;
  groups.catch(() => {
    if (groupsCache === entry) groupsCache = undefined;
  });
  return groups;
}

/**
 * Grupo da 85 de uma coleção da TCGdex japonesa (sigla = setId), para mostrar o nome dela na TCGplayer ("M5: Abyss
 * Eye"). Só com exatamente um grupo: sigla repetida ou ausente, undefined.
 */
export async function japaneseGroupFor(setId: string): Promise<JaGroup | undefined> {
  const list = groupsForSet(await japaneseGroups(), setId);
  return list.length === 1 ? list[0] : undefined;
}

/** Esquece os grupos guardados (testes, ou depois de o catálogo mudar). */
export function clearJapaneseCatalogCache() {
  groupsCache = undefined;
}

/**
 * Produtos da 85 de cada coleção e número pedidos (grupo → números impressos, como no catálogo), em lote: uma consulta
 * por grupo (números em blocos de 200). Todas as versões do número (comum, Mirror, Poké Ball…).
 */
export async function japaneseSlotRows(wanted: Map<number, Set<string>>, opts: { signal?: AbortSignal } = {}): Promise<CatalogRow[]> {
  const client = supabase;
  if (!client || !wanted.size) return [];
  const reads: Promise<CatalogRow[]>[] = [];
  for (const [groupId, set] of wanted) {
    const numbers = [...set];
    for (let i = 0; i < numbers.length; i += 200) {
      const chunk = numbers.slice(i, i + 200);
      reads.push(
        (async () => {
          let query = client.from('tcg_catalog').select(COLUMNS).eq('category', JAPANESE).eq('group_id', groupId).in('number', chunk);
          if (opts.signal) query = query.abortSignal(opts.signal);
          const { data, error } = await query;
          if (error) throw error;
          return (data ?? []) as unknown as CatalogRow[];
        })(),
      );
    }
  }
  return (await Promise.all(reads)).flat();
}

/**
 * Candidatos de cada carta da TCGdex japonesa (cardId → produtos da 85 de todas as versões; ver
 * japaneseCandidatesFrom), lidos em lote: os grupos uma vez e os produtos com uma consulta por grupo (números em
 * blocos de 200). Cartas `tcgp-`, sem número ou sem total ficam de fora.
 */
export async function japaneseCandidates(cards: JaCardRef[], opts: { signal?: AbortSignal } = {}): Promise<Map<string, CatalogRow[]>> {
  const out = new Map<string, CatalogRow[]>();
  const client = supabase;
  const refs = new Map<string, JaCardRef>();
  for (const c of cards) {
    if (!c.cardId.startsWith('tcgp-') && japaneseNumber(c.localId, c.setTotal) && c.setId && !refs.has(c.cardId)) refs.set(c.cardId, c);
  }
  if (!client || !refs.size) return out;
  const groups = await japaneseGroups();

  // Números a ler em cada grupo.
  const wanted = new Map<number, Set<string>>();
  for (const c of refs.values()) {
    const number = japaneseNumber(c.localId, c.setTotal)!;
    for (const g of groupsForSet(groups, c.setId)) wanted.set(g.group_id, (wanted.get(g.group_id) ?? new Set()).add(number));
  }
  const index = indexRows(await japaneseSlotRows(wanted, opts));
  for (const c of refs.values()) {
    const list = candidatesIn(c, groups, index);
    if (list.length) out.set(c.cardId, list);
  }
  return out;
}

/**
 * Produto da 85 de cada carta da TCGdex japonesa (cardId → produto), pela coleção, número e Pokémon
 * (japaneseCandidates) e pela versão (pickJapaneseProduct). Exatamente um candidato ⇒ entra no mapa; zero ou mais de
 * um ⇒ fica fora. Com o mesmo cardId mais de uma vez, vale a versão da primeira.
 */
export async function japaneseProducts(cards: JaCardRef[], opts: { signal?: AbortSignal } = {}): Promise<Map<string, CatalogRow>> {
  const candidates = await japaneseCandidates(cards, opts);
  const out = new Map<string, CatalogRow>();
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.cardId)) continue;
    seen.add(c.cardId);
    const row = pickJapaneseProduct(c, candidates.get(c.cardId) ?? []);
    if (row) out.set(c.cardId, row);
  }
  return out;
}
