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

/** O que a busca precisa da carta: nomes para buscar (inglês primeiro), sigla da coleção e número. */
async function cardKeys(e: Entry): Promise<{ names: string[]; abbr?: string; localId: string } | undefined> {
  if (e.cardId.startsWith('tcgp-')) {
    const r = await catalogProduct(Number(e.cardId.slice(5)));
    if (!r) return undefined;
    return { names: [r.name], abbr: r.tcg_groups?.abbr ?? undefined, localId: (r.number ?? '').split('/')[0] };
  }
  const cut = e.cardId.lastIndexOf('-');
  const en = await cardDetail(e.cardId, 'en').catch(() => undefined);
  // Falha de rede propaga (a carta tenta de novo depois); coleção inexistente na TCGdex vira "sem sigla".
  const abbr = (await setAbbr(e.cardId.slice(0, cut))) ?? undefined;
  const names = [...new Set([en?.name, e.cardName].filter((n): n is string => !!n?.trim()))];
  return { names, abbr, localId: e.localId || e.cardId.slice(cut + 1) };
}

/**
 * Preços da carta no MYP. `consult` faz a consulta respeitando o limite (o chamador controla o ritmo).
 * Devolve sempre um resultado (com `notFound` quando não acha), para a carta não ficar presa na fila.
 */
export async function fetchMypPrice(e: Entry, consult: (name: string) => Promise<MypProduct[]>): Promise<MypApiPrice> {
  const note = mypApiNote(e);
  const base = { cardId: e.cardId, variant: e.variant, note: note || undefined, checkedAt: new Date().toISOString() };
  const keys = await cardKeys(e);
  if (!keys?.abbr) return { ...base, notFound: 'coleção sem sigla para buscar no MYP' };
  for (const name of keys.names) {
    const hit = pickMypProduct(await consult(name), keys.abbr, keys.localId, e.variant, note);
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
      ownVersion: hit.ownVersion || undefined,
    };
  }
  return { ...base, notFound: `${keys.names[0] ?? 'carta'} ${keys.localId} (${keys.abbr}) não encontrada no MYP` };
}

/** Selo da carta que importa para achar o produto do MYP (só nas versões promo/staff). */
export function mypApiNote(e: Entry) {
  return e.variant === 'wPromo' || e.variant === 'staff' ? (e.variantNote ?? '').trim() : '';
}

/** A busca guardada é desta carta, versão e selo? */
export function mypApiMatches(e: Entry, s: { cardId: string; variant: string; note?: string }) {
  return s.cardId === e.cardId && s.variant === e.variant && (s.note ?? '') === mypApiNote(e);
}

/** A carta precisa de uma busca no MYP (nova, mudou de carta/versão/selo ou passou de 7 dias)? */
export function mypApiDue(e: Entry, now: number) {
  if (e.lang !== 'pt' && e.lang !== 'en') return false;
  const s = e.mypApi;
  if (!s || !mypApiMatches(e, s)) return true;
  return now - new Date(s.checkedAt).getTime() > MYP_API_REFRESH_MS;
}
