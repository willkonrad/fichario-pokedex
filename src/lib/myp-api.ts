import { catalogProduct } from './catalog';
import { cached, cardDetail } from './tcgdex';
import { pickMypProduct, price, type MypProduct } from './myp-match';
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
 * Versão da regra de reconhecimento do produto. Cartas "não encontradas" (e versões promo) por uma regra mais antiga
 * são buscadas de novo, sem esperar os 7 dias. 2: nomes "X-EX", promos "079a", coleções clássicas, promos sem selo.
 * 3: "Nidoran♀" buscada também como "Nidoran Fêmea" (o MYP escreve "Nidoran F").
 */
export const MYP_MATCHER = 3;

/**
 * Coleções da TCGdex que o MYP cadastra com outra sigla e com o número da carta original (ex.: Charizard da coleção
 * clássica de 30 anos = "30CC 004/102" no MYP): a carta é achada pelo nome dentro da edição.
 */
const MYP_EDITION: Record<string, string> = {
  '30th-c': '30CC',
  cel25cc: 'CCC',
};

/** Coleção de promos (MEP, SVP, SWSHP…): o produto do MYP é a própria promo. */
const isPromoSet = (setId: string) => /p$/i.test(setId);

/**
 * Outros jeitos de escrever o nome no MYP: "Alakazam-EX" onde a TCGdex escreve "Alakazam EX" (e o contrário em outras
 * coleções); "Nidoran F"/"Nidoran Female" onde a TCGdex escreve "Nidoran♀" (a busca pelo nome em português, "Nidoran
 * Fêmea", traz todos).
 */
function nameVariants(name: string) {
  const out = [name];
  if (/\s(EX|GX)$/i.test(name)) out.push(name.replace(/\s(EX|GX)$/i, '-$1'));
  else if (/-(EX|GX)$/i.test(name)) out.push(name.replace(/-(EX|GX)$/i, ' $1'));
  if (/♀|♂/.test(name)) out.push(name.replace(/\s*♀/, ' Fêmea').replace(/\s*♂/, ' Macho'));
  return out;
}

/** O MYP respondeu "muitas consultas": esperar antes de continuar. */
export class MypRateLimited extends Error {}

/** Produtos com este nome exato (em inglês ou português), de todas as edições. */
export async function searchMypByName(name: string): Promise<MypProduct[]> {
  const res = await fetch(`${API}/carta/${encodeURIComponent(name)}`, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new MypRateLimited('MYP 429');
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`MYP ${res.status}`);
  const body = (await res.json()) as { cards?: MypProduct[] };
  return body.cards ?? [];
}

/** Sigla oficial da coleção na TCGdex ("FCO", "MEG"…), guardada por 7 dias. */
function setAbbr(setId: string) {
  return cached(`tcgdex:abbr2:${setId}`, async () => {
    const res = await fetch(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(setId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TCGdex ${res.status}`);
    return ((await res.json()) as { abbreviation?: { official?: string } }).abbreviation?.official ?? null;
  });
}

/**
 * O que a busca precisa da carta: nomes para buscar (inglês primeiro), sigla da coleção no MYP, número, se a carta é
 * achada pelo nome dentro da edição e se é de uma coleção de promos.
 */
async function cardKeys(
  e: Entry,
): Promise<{ names: string[]; abbr?: string; localId: string; byName: boolean; promoSet: boolean } | undefined> {
  if (e.cardId.startsWith('tcgp-')) {
    const r = await catalogProduct(Number(e.cardId.slice(5)));
    if (!r) return undefined;
    const abbr = r.tcg_groups?.abbr ?? undefined;
    return { names: nameVariants(r.name), abbr, localId: (r.number ?? '').split('/')[0], byName: false, promoSet: /p$/i.test(abbr ?? '') };
  }
  const cut = e.cardId.lastIndexOf('-');
  const setId = e.cardId.slice(0, cut);
  const en = await cardDetail(e.cardId, 'en').catch(() => undefined);
  // Falha de rede propaga (a carta tenta de novo depois); coleção inexistente na TCGdex vira "sem sigla".
  const abbr = MYP_EDITION[setId] ?? (await setAbbr(setId)) ?? undefined;
  const names = [...new Set([en?.name, e.cardName].filter((n): n is string => !!n?.trim()).flatMap(nameVariants))];
  return { names, abbr, localId: e.localId || e.cardId.slice(cut + 1), byName: setId in MYP_EDITION, promoSet: isPromoSet(setId) };
}

/**
 * Preços da carta no MYP. `consult` faz a consulta respeitando o limite (o chamador controla o ritmo).
 * Devolve sempre um resultado (com `notFound` quando não acha), para a carta não ficar presa na fila.
 */
export async function fetchMypPrice(e: Entry, consult: (name: string) => Promise<MypProduct[]>): Promise<MypApiPrice> {
  const note = mypApiNote(e);
  const base = { cardId: e.cardId, variant: e.variant, note: note || undefined, checkedAt: new Date().toISOString(), v: MYP_MATCHER };
  const keys = await cardKeys(e);
  if (!keys?.abbr) return { ...base, notFound: 'coleção sem sigla para buscar no MYP' };
  for (const name of keys.names) {
    const hit = pickMypProduct(await consult(name), keys.abbr, keys.localId, e.variant, note, keys.byName ? keys.names : undefined);
    if (!hit) continue;
    const p = hit.product;
    return {
      ...base,
      productId: p.internal_code,
      code: p.card_code,
      url: p.link ?? undefined,
      min: price(p.min_price),
      avg: price(p.avg_price),
      max: price(p.max_price),
      qty: p.available_quantity ?? undefined,
      // Promo de uma coleção de promos, sem selo marcado: o produto do MYP é a própria carta.
      ownVersion: hit.ownVersion || (keys.promoSet && e.variant === 'wPromo' && !note) || undefined,
    };
  }
  return { ...base, notFound: `${keys.names[0] ?? 'carta'} ${keys.localId} (${keys.abbr}) não encontrada no MYP` };
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
 * promo — por uma regra de reconhecimento mais antiga)?
 */
export function mypApiDue(e: Entry, now: number) {
  if (e.lang !== 'pt' && e.lang !== 'en') return false;
  const s = e.mypApi;
  if (!s || !mypApiMatches(e, s)) return true;
  if ((s.v ?? 1) < MYP_MATCHER && (s.notFound || e.variant === 'wPromo' || e.variant === 'staff')) return true;
  return now - new Date(s.checkedAt).getTime() > MYP_API_REFRESH_MS;
}
