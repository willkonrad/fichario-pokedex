import { catalogByTcgdexIds, catalogProduct, isOversize } from './catalog';
import { MYP_URL, storeUrl } from './copy';
import { timedFetch } from './fetch-timeout';
import { pickMypProduct, price, type MypProduct } from './myp-match';
import { supabase } from './supabase';
import { cached, cardDetail } from './tcgdex';
import type { Entry, MypApiPrice } from './types';

/**
 * API pública do MYP Cards (mypcards.com/acesso-api, documentação em mypcards.github.io/mypcards-api): menor, médio e
 * maior preço de cada produto, em reais. Sem token, aceita 10 consultas por minuto e só atende aparelhos (o servidor
 * recebe 403 e o navegador não tem CORS), então quem busca é o app no celular. A atribuição "MYP Cards" com link para
 * mypcards.com é obrigatória onde os preços aparecem.
 */
const API = 'https://mypcards.com/api/v1/pokemon';
/** Intervalo entre consultas: 10 por minuto, com folga. */
export const MYP_API_INTERVAL_MS = 6500;
/** Cada carta é consultada de novo depois de 7 dias. */
export const MYP_API_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Tempo máximo de cada chamada ao MYP e à TCGdex desta busca (até o fim da leitura da resposta). Sem ele, uma conexão
 * muda prenderia a fila do MYP (e a tela acesa) até fechar o app; passado o tempo, a carta espera como sem internet.
 */
export const MYP_FETCH_TIMEOUT_MS = 15_000;
/**
 * Versão da regra de reconhecimento do produto. Cartas "não encontradas" (e versões promo) por uma regra mais antiga
 * são buscadas de novo, sem esperar os 7 dias. 2: nomes "X-EX", promos "079a", coleções clássicas, promos sem selo.
 * 3: "Nidoran♀" buscada também como "Nidoran Fêmea" (o MYP escreve "Nidoran F").
 * 4: sem achar pelo nome, busca pelo código do produto ("pokemon_por_031/088"), para cartas que o MYP cadastra com o
 *    número no nome e sem nome em português (ex.: "Mega Clefable ex - 031/088", "Nidorina (30th Celebration)",
 *    "Gengar (Prime)" da coleção clássica, pelo número original que vem do catálogo do TCGCSV).
 * 5: promos SWSH, DP, HGSS e Nintendo (sem sigla na TCGdex) pelas siglas prováveis do MYP; cartas só do catálogo
 *    ("tcgp-") pela sigla da coleção da TCGdex ligada ao grupo do TCGCSV (a sigla do grupo, como "SWSD" ou "MCAP",
 *    não é a do MYP), que também decide se é coleção de promos.
 */
export const MYP_MATCHER = 5;

/**
 * Coleções da TCGdex que o MYP cadastra com outra sigla e com o número da carta original (ex.: Charizard da coleção
 * clássica de 30 anos = "30CC 004/102" no MYP): a carta é achada pelo nome dentro da edição.
 */
const MYP_EDITION: Record<string, string> = {
  '30th-c': '30CC',
  cel25cc: 'CCC',
};

/**
 * Coleções de promos sem sigla na TCGdex: siglas que o MYP pode usar (as do PTCGO/Limitless primeiro). A busca pelo
 * nome traz todas as edições, então conferir várias siglas não gasta consulta; a busca pelo código fica de fora.
 * A confirmar com o app no celular (GET /pokemon/edicoes): a primeira que achar a carta vale.
 */
const MYP_PROMO_EDITIONS: Record<string, string[]> = {
  swshp: ['PR-SW', 'SWSHP', 'PRSW'],
  dpp: ['PR-DPP', 'DPP', 'PRDPP'],
  hgssp: ['PR-HS', 'HGSSP', 'PRHS'],
  np: ['PR-NP', 'NP', 'PRNP'],
};

/** Coleção de promos (MEP, SVP, SWSHP…): o produto do MYP é a própria promo. */
const isPromoSet = (setId: string) => /p$/i.test(setId);

/**
 * Outros jeitos de escrever o nome no MYP: "Alakazam-EX" onde a TCGdex escreve "Alakazam EX" (e o contrário em outras
 * coleções); "Nidoran F"/"Nidoran Female" onde a TCGdex escreve "Nidoran♀" (a busca pelo nome em português, "Nidoran
 * Fêmea", traz todos).
 */
export function nameVariants(name: string) {
  const out = [name];
  if (/\s(EX|GX)$/i.test(name)) out.push(name.replace(/\s(EX|GX)$/i, '-$1'));
  else if (/-(EX|GX)$/i.test(name)) out.push(name.replace(/-(EX|GX)$/i, ' $1'));
  if (/♀|♂/.test(name)) out.push(name.replace(/\s*♀/, ' Fêmea').replace(/\s*♂/, ' Macho'));
  return out;
}

/** O MYP respondeu "muitas consultas": esperar antes de continuar. */
export class MypRateLimited extends Error {}

/**
 * O MYP (ou a Cloudflare dele) recusou a consulta (403): é um "não". A fila para no app inteiro e avisa (ver
 * markMypBlocked em myp-queue.ts); nada de tentar de outro jeito.
 */
export class MypBlocked extends Error {}

/** Produtos com este nome exato (em inglês ou português), de todas as edições. */
export function searchMypByName(name: string): Promise<MypProduct[]> {
  return timedFetch(
    `${API}/carta/${encodeURIComponent(name)}`,
    async (res) => {
      if (res.status === 429) throw new MypRateLimited('MYP 429');
      if (res.status === 403) throw new MypBlocked('MYP 403');
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`MYP ${res.status}`);
      const body = (await res.json()) as { cards?: MypProduct[] };
      return body.cards ?? [];
    },
    { headers: { Accept: 'application/json' }, timeoutMs: MYP_FETCH_TIMEOUT_MS },
  );
}

/**
 * Produto pelo código do MYP ("pokemon_por_031/088"; a API pede o código em Base64). Lista vazia se não existe.
 * A busca pelo nome não acha produtos cadastrados com o número no nome e sem nome em português.
 */
export function searchMypByCode(code: string): Promise<MypProduct[]> {
  return timedFetch(
    `${API}/precos/${encodeURIComponent(btoa(code))}`,
    async (res) => {
      if (res.status === 429) throw new MypRateLimited('MYP 429');
      // 403 é recusa, não "produto inexistente": a carta não vira "não encontrada".
      if (res.status === 403) throw new MypBlocked('MYP 403');
      if (res.status >= 400 && res.status < 500) return [];
      if (!res.ok) throw new Error(`MYP ${res.status}`);
      const body = (await res.json()) as MypProduct | { error?: string };
      return 'card_code' in body && body.card_code ? [body] : [];
    },
    { headers: { Accept: 'application/json' }, timeoutMs: MYP_FETCH_TIMEOUT_MS },
  );
}

/**
 * Foto do MYP que existe de verdade: a API às vezes informa o endereço de uma foto que não está no servidor de imagens
 * (dá erro 404). Confere com uma consulta leve ao servidor de imagens (não é a API de preços, não entra no limite).
 */
async function existingImage(url?: string | null) {
  if (!url || !/\.(jpe?g|png|webp)$/i.test(url)) return undefined;
  const ok = await timedFetch(url, (res) => res.ok, { method: 'HEAD', timeoutMs: MYP_FETCH_TIMEOUT_MS }).catch(() => false);
  return ok ? url : undefined;
}

/**
 * Códigos que o produto da carta teria no MYP: "pokemon_<sigla>_<número com 3 dígitos>/<total>" (total com 3 dígitos
 * ou como impresso, ex.: "/64"); nas coleções de promos, sem o total ("pokemon_mep_101"). Só para números numéricos.
 */
function mypCodes(abbr: string, localId: string, total: number | undefined, promoSet: boolean) {
  if (!/^\d+$/.test(localId)) return [];
  const base = `pokemon_${abbr.split(':')[0].trim().toLowerCase()}_${localId.padStart(3, '0')}`;
  const codes = promoSet ? [base] : [];
  if (total) codes.push(`${base}/${String(total).padStart(3, '0')}`, `${base}/${total}`);
  return [...new Set(codes)];
}

/** Sigla oficial da coleção na TCGdex ("FCO", "MEG"…), guardada por 7 dias. */
function setAbbr(setId: string) {
  return cached(`tcgdex:abbr2:${setId}`, () =>
    timedFetch(
      `https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(setId)}`,
      async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`TCGdex ${res.status}`);
        return ((await res.json()) as { abbreviation?: { official?: string } }).abbreviation?.official ?? null;
      },
      { timeoutMs: MYP_FETCH_TIMEOUT_MS },
    ),
  );
}

/**
 * Coleção da TCGdex ligada a um grupo do TCGCSV: a mais comum entre as cartas do grupo já ligadas à TCGdex (o grupo
 * pode trazer a galeria de treinadores, que na TCGdex é outra coleção). Guardada por 7 dias; sem nenhuma (coleção nova,
 * ainda fora da TCGdex), null por 1 dia, para pegar logo a ligação que o catalog-sync faz quando a TCGdex cadastra a
 * coleção. A chave mudou (groupset2) com a regra 7 de ligação do catalog-sync, que tirou ligações erradas (ex.: "ME06:
 * Delta Reign" apontava para Delta Species).
 */
function groupTcgdexSet(groupId: number) {
  return cached(
    `tcgdex:groupset2:${groupId}`,
    async () => {
      if (!supabase) return null;
      const { data, error } = await supabase.from('tcg_catalog').select('tcgdex_id').eq('group_id', groupId).not('tcgdex_id', 'is', null).limit(200);
      if (error) throw error;
      const count = new Map<string, number>();
      for (const r of (data ?? []) as { tcgdex_id: string | null }[]) {
        const id = r.tcgdex_id ?? '';
        const set = id.slice(0, id.lastIndexOf('-'));
        if (set) count.set(set, (count.get(set) ?? 0) + 1);
      }
      return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    },
    undefined,
    { ttlFor: (set) => (set ? MYP_API_REFRESH_MS : 24 * 60 * 60 * 1000) },
  );
}

/** Siglas da coleção no MYP: a da lista acima, a oficial da TCGdex ou as prováveis (`guessed`) das promos sem sigla. */
export function editionsFor(setId: string, officialAbbr: string | null | undefined): { abbrs: string[]; guessed: boolean } {
  if (MYP_EDITION[setId]) return { abbrs: [MYP_EDITION[setId]], guessed: false };
  if (officialAbbr) return { abbrs: [officialAbbr], guessed: false };
  return { abbrs: MYP_PROMO_EDITIONS[setId] ?? [], guessed: !!MYP_PROMO_EDITIONS[setId] };
}

async function setEditions(setId: string): Promise<{ abbrs: string[]; guessed: boolean }> {
  if (MYP_EDITION[setId]) return editionsFor(setId, null);
  // Falha de rede propaga (a carta tenta de novo depois); coleção inexistente na TCGdex vira "sem sigla".
  return editionsFor(setId, await setAbbr(setId));
}

/** Número da promo também sem as letras ("SWSH001" → "001"), para as siglas prováveis. */
function numberForms(localId: string, guessed: boolean) {
  const bare = localId.replace(/^[a-z]+(?=\d)/i, '');
  return guessed && bare !== localId ? [localId, bare] : [localId];
}

export type CardKeys = {
  names: string[];
  /** Siglas possíveis da edição no MYP (uma, quando conhecida). */
  abbrs: string[];
  /** As siglas são as prováveis de uma coleção de promos sem sigla (sem busca pelo código). */
  guessed: boolean;
  localId: string;
  total?: number;
  byName: boolean;
  promoSet: boolean;
  /** O número já é o do catálogo do TCGCSV: a busca pelo código não precisa ler o banco. */
  numberKnown?: boolean;
};

/**
 * As mesmas chaves de `cardKeys`, montadas só com dados já conhecidos (o índice da Consulta): sem rede. A sigla do grupo
 * da TCGplayer entra depois da oficial; sem coleção da TCGdex, vale só ela.
 */
export function mypKeysFromParts(p: {
  nameEn: string;
  namePt?: string;
  tcgdexSetId?: string;
  officialAbbr?: string | null;
  groupAbbr?: string;
  groupName?: string;
  localId: string;
  /** Número no catálogo: é o que o MYP usa nas coleções clássicas (MYP_EDITION), numeradas pela carta original. */
  originalNumber?: string;
  total?: number;
}): CardKeys {
  const names = [...new Set([p.nameEn, p.namePt].filter((n): n is string => !!n?.trim()).flatMap(nameVariants))];
  const byName = !!p.tcgdexSetId && p.tcgdexSetId in MYP_EDITION;
  const base = { names, localId: (byName && p.originalNumber) || p.localId, total: p.total || undefined, numberKnown: true };
  const group = p.groupAbbr?.trim() || undefined;
  if (p.tcgdexSetId) {
    const ed = editionsFor(p.tcgdexSetId, p.officialAbbr);
    if (ed.abbrs.length) {
      const abbrs = group && !ed.abbrs.some((a) => a.toLowerCase() === group.toLowerCase()) ? [...ed.abbrs, group] : ed.abbrs;
      return { ...base, ...ed, abbrs, byName, promoSet: isPromoSet(p.tcgdexSetId) };
    }
  }
  return { ...base, abbrs: group ? [group] : [], guessed: false, byName: false, promoSet: /black star|promo cards?\b/i.test(p.groupName ?? '') };
}

/**
 * O que a busca precisa da carta: nomes para buscar (inglês primeiro), siglas da coleção no MYP, número e total
 * oficial, se a carta é achada pelo nome dentro da edição e se é de uma coleção de promos.
 */
async function cardKeys(e: Entry): Promise<CardKeys | undefined> {
  if (e.cardId.startsWith('tcgp-')) {
    const r = await catalogProduct(Number(e.cardId.slice(5)));
    if (!r) return undefined;
    const [localId, total] = (r.number ?? '').split('/');
    const base = { names: nameVariants(r.name), localId: localId.trim(), total: Number(total) || undefined };
    const abbr = r.tcg_groups?.abbr?.trim() || undefined;
    // A sigla e as promos pela coleção da TCGdex ligada ao grupo; sem ela, pela sigla e pelo nome do grupo. A sigla do
    // grupo continua valendo na busca pelo nome (era a única até a regra 5; conferir mais uma não gasta consulta).
    const setId = await groupTcgdexSet(r.group_id);
    if (setId) {
      const ed = await setEditions(setId);
      if (ed.abbrs.length) {
        const abbrs = abbr && !ed.abbrs.some((a) => a.toLowerCase() === abbr.toLowerCase()) ? [...ed.abbrs, abbr] : ed.abbrs;
        return { ...base, ...ed, abbrs, byName: setId in MYP_EDITION, promoSet: isPromoSet(setId) };
      }
    }
    return {
      ...base,
      abbrs: abbr ? [abbr] : [],
      guessed: false,
      byName: false,
      promoSet: /black star|promo cards?\b/i.test(r.tcg_groups?.name ?? ''),
    };
  }
  const cut = e.cardId.lastIndexOf('-');
  const setId = e.cardId.slice(0, cut);
  const en = await cardDetail(e.cardId, 'en').catch(() => undefined);
  const ed = await setEditions(setId);
  const names = [...new Set([en?.name, e.cardName].filter((n): n is string => !!n?.trim()).flatMap(nameVariants))];
  return {
    names,
    ...ed,
    localId: e.localId || e.cardId.slice(cut + 1),
    total: e.setTotal || en?.set.cardCount?.official || undefined,
    byName: setId in MYP_EDITION,
    promoSet: isPromoSet(setId),
  };
}

/**
 * Preços da carta no MYP. `consult` (busca pelo nome) e `consultCode` (pelo código do produto) fazem a consulta
 * respeitando o limite (o chamador controla o ritmo). Pelo código só quando o nome não acha.
 * Devolve sempre um resultado (com `notFound` quando não acha), para a carta não ficar presa na fila.
 */
export async function fetchMypPrice(
  e: Entry,
  consult: (name: string) => Promise<MypProduct[]>,
  consultCode?: (code: string) => Promise<MypProduct[]>,
): Promise<MypApiPrice> {
  const note = mypApiNote(e);
  const base = { cardId: e.cardId, variant: e.variant, note: note || undefined, checkedAt: new Date().toISOString(), v: MYP_MATCHER };
  // Carta gigante (Jumbo) fora das versões com selo: o MYP só acharia a carta comum, que nunca vale por ela.
  if (!note && isOversize(e.variantNote)) return { ...base, notFound: NO_OVERSIZE };
  const keys = await cardKeys(e);
  if (!keys) return { ...base, notFound: NO_EDITION };
  return fetchMypByKeys(keys, { ...base, ptImage: e.lang === 'pt' }, consult, consultCode);
}

const NO_EDITION = 'coleção sem sigla para buscar no MYP';
/** Carta gigante (Jumbo) sem o produto próprio: sem preço (como na TCGplayer, nunca o da carta comum). */
const NO_OVERSIZE = 'sem o produto Jumbo no MYP';

/** Campos fixos do resultado; `ptImage` pede também a foto em português do MYP (uma consulta leve a mais). */
export type MypPriceBase = Pick<MypApiPrice, 'cardId' | 'variant' | 'note' | 'checkedAt' | 'v'> & { ptImage?: boolean };

/** A busca em si, a partir das chaves prontas: pelo nome e, sem achar, pelo código. Ver fetchMypPrice. */
export async function fetchMypByKeys(
  keys: CardKeys,
  { ptImage, ...base }: MypPriceBase,
  consult: (name: string) => Promise<MypProduct[]>,
  consultCode?: (code: string) => Promise<MypProduct[]>,
): Promise<MypApiPrice> {
  if (!keys.abbrs.length) return { ...base, notFound: NO_EDITION };
  const note = base.note ?? '';
  const variant = base.variant;
  const abbrs = keys.abbrs;
  // Carta gigante (Jumbo): só o produto próprio dela (com o selo no nome); o produto comum não vale por ela.
  const oversize = isOversize(note);
  const accept = (hit: ReturnType<typeof pickMypProduct>) => (hit && (!oversize || hit.ownVersion) ? hit : undefined);
  const toPrice = async (hit: NonNullable<ReturnType<typeof pickMypProduct>>): Promise<MypApiPrice> => {
    const p = hit.product;
    return {
      ...base,
      productId: p.internal_code,
      code: p.card_code,
      // Só um endereço do próprio MYP vai para o botão "MYP Cards".
      url: storeUrl(p.link, MYP_URL),
      min: price(p.min_price),
      avg: price(p.avg_price),
      max: price(p.max_price),
      qty: p.available_quantity ?? undefined,
      imagePt: ptImage ? await existingImage(p.img_pt) : undefined,
      // Promo de uma coleção de promos, sem selo marcado: o produto do MYP é a própria carta.
      ownVersion: hit.ownVersion || (keys.promoSet && variant === 'wPromo' && !note) || undefined,
    };
  };
  const localIds = numberForms(keys.localId, keys.guessed);
  for (const name of keys.names) {
    const hit = accept(pickMypProduct(await consult(name), abbrs, localIds, variant, note, keys.byName ? keys.names : undefined));
    if (hit) return await toPrice(hit);
  }
  // Pelo código só com a sigla conhecida (com as prováveis, cada código seria uma consulta a mais).
  const abbr = abbrs[0];
  if (consultCode && !keys.guessed) {
    // Coleções que o MYP numera pela carta original (byName): o número original vem do catálogo do TCGCSV, que liga a
    // carta da coleção clássica à TCGdex (ex.: 30th-c-018 = "Gengar (Prime)" 94/102 = "pokemon_30cc_094/102"). Carta
    // só do catálogo ("tcgp-") já tem esse número.
    const numbers = keys.byName && !keys.numberKnown && !base.cardId.startsWith('tcgp-')
      ?(await catalogByTcgdexIds([base.cardId]).catch(() => [])).filter((r) => !r.stamp && r.number).map((r) => r.number!.split('/'))
      : [[keys.localId, String(keys.total ?? '')]];
    for (const [localId, total] of numbers) {
      for (const code of mypCodes(abbr, localId, Number(total) || undefined, keys.promoSet)) {
        const hit = accept(pickMypProduct(await consultCode(code), abbr, localId, variant, note));
        if (hit) return await toPrice(hit);
      }
    }
  }
  if (oversize) return { ...base, notFound: NO_OVERSIZE };
  return { ...base, notFound: `${keys.names[0] ?? 'carta'} ${keys.localId} (${abbrs.join('/')}) não encontrada no MYP` };
}

/**
 * Cartas que a pessoa está vendo (tela da carta): a busca em segundo plano (myp-refresher) passa elas na frente da fila
 * e acorda na hora, em vez de esperar a vez delas.
 */
const priority = new Set<string>();
let wakeRefresher: () => void = () => {};
export function prioritizeMypPrice(entryId: string) {
  priority.add(entryId);
  wakeRefresher();
}
export function mypPriority() {
  return priority;
}
export function onMypPriority(wake: () => void) {
  wakeRefresher = wake;
}

/**
 * Foto em português do MYP para uma carta em português que só tem a foto da versão em inglês (a TCGdex não tem a
 * foto em português de muitas coleções). Só a da mesma carta; senão, undefined.
 */
export function mypPtImage(e: Entry) {
  if (e.lang !== 'pt' || e.image?.includes('/pt/') || e.mypApi?.cardId !== e.cardId) return undefined;
  return e.mypApi?.imagePt;
}

/** Selo da carta que importa para achar o produto do MYP (só nas versões promo/staff). */
export function mypApiNote(e: Entry) {
  return e.variant === 'wPromo' || e.variant === 'staff' ? (e.variantNote ?? '').trim() : '';
}

/** A busca guardada é desta carta, versão e selo? */
export function mypApiMatches(e: Entry, s: { cardId: string; variant: string; note?: string }) {
  return s.cardId === e.cardId && s.variant === e.variant && (s.note ?? '') === mypApiNote(e);
}

/**
 * A carta precisa de uma busca no MYP (nova, mudou de carta/versão/selo, passou de 7 dias, ou não foi achada — ou é
 * promo — por uma regra de reconhecimento mais antiga)? Carta gigante (Jumbo) com o preço de um produto que não é o dela
 * (a regra antiga aceitava a carta comum) também: a busca de agora a deixa sem preço.
 */
export function mypApiDue(e: Entry, now: number) {
  if (e.lang !== 'pt' && e.lang !== 'en') return false;
  const s = e.mypApi;
  if (!s || !mypApiMatches(e, s)) return true;
  if (!s.notFound && !s.ownVersion && isOversize(e.variantNote)) return true;
  if ((s.v ?? 1) < MYP_MATCHER && (s.notFound || e.variant === 'wPromo' || e.variant === 'staff')) return true;
  return now - new Date(s.checkedAt).getTime() > MYP_API_REFRESH_MS;
}
