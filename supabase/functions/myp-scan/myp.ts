// Leitura das páginas públicas do MYP Cards (mypcards.com) usadas pela Edge Function myp-scan. Funções puras, sem
// rede: recebem o HTML e devolvem os dados, para poderem ser testadas com páginas salvas.

/** Estado da carta no app → estado no MYP (o MYP não tem "M": a melhor categoria é NM). */
export const CONDITION_TO_MYP: Record<string, string> = { M: 'NM', NM: 'NM', SP: 'SP', MP: 'MP', HP: 'HP', D: 'DM' };
/** Estados do MYP, do melhor para o pior. */
export const MYP_CONDITIONS = ['NM', 'SP', 'MP', 'HP', 'DM'] as const;

/** Idioma da carta no app → nomes do idioma nas ofertas do MYP. */
export const LANG_TO_MYP: Record<string, string[]> = {
  pt: ['Português', 'Português-Inglês'],
  en: ['Inglês'],
  ja: ['Japonês'],
};

/**
 * Acabamentos ("Versões") do MYP aceitos para cada variação do app. Vazio = o vendedor não marcou (versão comum).
 * Holo aceita também "Full-Art"/"Altered Art", como os vendedores marcam as cartas que já nascem holo.
 */
export const FINISHES_FOR_VARIANT: Record<string, string[]> = {
  normal: ['', 'Normal', 'Unlimited'],
  holo: ['', 'Foil', 'Full-Art', 'Altered Art', 'Unlimited Foil', 'Normal'],
  reverse: ['Reverse Foil'],
  pokeball: ['Pokeball Foil', 'Poke Ball'],
  masterball: ['Masterball Foil'],
  wPromo: ['Promo'],
  staff: ['Staff'],
};

export type MypOffer = {
  /** Acabamento como o vendedor marcou ("Foil", "Promo"…); vazio quando não marcou. */
  finish: string;
  /** NM, SP, MP, HP ou DM. */
  condition: string;
  /** "Português", "Inglês"… */
  lang?: string;
  qty: number;
  price: number;
};

export type MypListItem = { productId: number; code: string; title: string; url: string; edition: string };

const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** "R$ 1.234,50" → 1234.5. */
const brl = (s: string) => {
  const m = s.match(/R\$\s*([\d.]+,\d{2})/);
  return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : undefined;
};

/** Ofertas da página do produto (só as que a página mostra; a lista extra fica de fora, como pede o robots.txt). */
export function parseOffers(html: string): MypOffer[] {
  const out: MypOffer[] = [];
  for (const m of html.matchAll(/<tr data-key="\d+">([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const cell = (cls: string) => row.match(new RegExp(`<td class="${cls}"[^>]*>([\\s\\S]*?)<\\/td>`))?.[1] ?? '';
    const q = cell('estoque-lista-qualidadenome');
    const qualityTitle = q.match(/class="chip[^"]*"\s+title="([^"]+)"/)?.[1] ?? '';
    const condition = qualityTitle.split(' - ')[0].trim();
    // Cartas graduadas (PSA, GBA…) têm o nome da certificadora no lugar do estado: ficam de fora.
    if (!(MYP_CONDITIONS as readonly string[]).includes(condition)) continue;
    const price = brl(text(cell('estoque-lista-precoestoque')));
    if (price == null) continue;
    out.push({
      finish: text(cell('estoque-lista-nomeenfoil')),
      condition,
      lang: q.match(/class="flag-icon[^"]*"\s+title="([^"]+)"/)?.[1],
      qty: Number(text(cell('estoque-lista-quantidadeestoque')).match(/\d+/)?.[0] ?? 1),
      price,
    });
  }
  return out;
}

/** Produtos de uma página de busca ou de edição (só cartas avulsas: código "pokemon_…"). */
export function parseList(html: string): MypListItem[] {
  const out: MypListItem[] = [];
  for (const block of html.split('<li class="stream-item"').slice(1)) {
    const productId = Number(block.match(/^\s*data-key="(\d+)"/)?.[1]);
    const code = block.match(/data-ga-item-id="([^"]+)"/)?.[1] ?? '';
    const url = block.match(/href="(\/pokemon\/produto\/[^"]+)"/)?.[1];
    const title = block.match(/<h3 title="([^"]+)"/)?.[1] ?? '';
    const edition = block.match(/class="card-edicao"[^>]*>([^<]+)</)?.[1]?.trim() ?? '';
    if (productId && url && code.startsWith('pokemon_')) out.push({ productId, code, title: text(title), url, edition });
  }
  return out;
}

/** Edições da lista /pokemon/edicoes: número interno, sigla e nome. */
export function parseEditions(html: string): { id: number; sigla: string; name: string; slug: string }[] {
  const out: { id: number; sigla: string; name: string; slug: string }[] = [];
  for (const block of html.split('<div class="edicao-card"').slice(1)) {
    const id = Number(block.match(/data-key="(\d+)"/)?.[1]);
    const slug = block.match(/href="([^"]+)"\s+class="edicao-link"/)?.[1] ?? '';
    const name = block.match(/class="edicao-link"\s+title="([^"]+)"/)?.[1] ?? '';
    const sigla = block.match(/class="edicao-sigla">\s*<span>([^<]*)<\/span>/)?.[1]?.trim() ?? '';
    if (id && sigla) out.push({ id, sigla, name: text(name), slug });
  }
  return out;
}

/** Última página da paginação (1 quando não há). */
export function lastPage(html: string) {
  const pages = [...html.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1]));
  return pages.length ? Math.max(...pages) : 1;
}

/** "pokemon_meg_001/132p1" → { sigla: "meg", number: "1", total: "132", version: "p1" }. */
export function parseCode(code: string) {
  const m = code.match(/^pokemon_([^_]+)_([^/]+?)(?:\/(\d+))?(p\d+)?$/i);
  if (!m) return undefined;
  return { sigla: m[1].toLowerCase(), number: num(m[2]), total: m[3], version: m[4]?.toLowerCase() };
}

/** "007", "SWSH001", "TG06" → "7", "swsh1", "tg6". */
export const num = (s: string) => s.trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1');

/**
 * Menor preço por estado entre as ofertas no idioma e no acabamento da carta. A oferta mais barata no estado da carta
 * é o valor; os outros estados ficam como referência.
 */
export function summarize(offers: MypOffer[], lang: string, finishes: string[] | null) {
  // finishes null = produto próprio da versão (ex.: "Pokemon Day 2026"): vale qualquer acabamento.
  const langs = LANG_TO_MYP[lang] ?? [];
  const fit = offers.filter((o) => (!o.lang || langs.includes(o.lang)) && (!finishes || finishes.includes(o.finish)));
  const byCondition: Record<string, { min: number; count: number }> = {};
  for (const o of fit) {
    const c = (byCondition[o.condition] ??= { min: o.price, count: 0 });
    c.min = Math.min(c.min, o.price);
    c.count += o.qty;
  }
  return { byCondition, offers: fit.length, total: offers.length };
}
