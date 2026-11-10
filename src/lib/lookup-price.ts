// Preços da Consulta (seção 8): único módulo que conhece a referência de outro idioma. A referência sai sempre rotulada
// (`ref`) e nunca entra no valor: AddCardSheet, buildNewEntry, valuation, snapshotValue e as funções SQL não leem daqui.

import { PRINT_LABEL } from '@/lib/copy';
import { stampKind } from '@/lib/lookup-format';
import type { CellPrice, LookupCard, LookupHeader, LookupLang, LookupPrint, PriceBlock, PriceKind, PrintCode, RefFrom, VariantFilter } from '@/lib/lookup-types';

/** Ordem da impressão padrão. */
const ORDER: PrintCode[] = ['N', 'H', 'U', 'UH', '1', '1H', 'R'];
const VARIANT_PRINTS: Partial<Record<VariantFilter, PrintCode[]>> = { holo: ['H', 'UH', '1H'], reverse: ['R'], firstEdition: ['1', '1H'] };

const sorted = (prints: LookupPrint[]) => [...prints].sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));
const priced = (p: LookupPrint) => p.market != null || p.low != null;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reais = centavos ÷ 100 × PTAX de venda. */
const toBrl = (cents: number | null, fx: number) => (cents == null || !(fx > 0) ? null : round2((cents / 100) * fx));

/** De que linha o preço vem e se é referência de outro idioma. Sem fonte confiável: null (só links). */
function priceSource(card: LookupCard, lang: LookupLang | null, twin?: LookupCard | null): { from: LookupCard; ref: RefFrom } | null {
  const setLang = card.set.lang;
  const shown: LookupLang = lang ?? (setLang === 'zh-tw' || setLang === 'zh-cn' ? 'zh' : setLang);
  switch (shown) {
    case 'en':
      return setLang === 'en' ? { from: card, ref: null } : null;
    case 'ja':
      return setLang === 'ja' ? { from: card, ref: null } : null;
    case 'pt':
      return setLang === 'en' && /[pu]/.test(card.marks) ? { from: card, ref: 'en' } : null;
    case 'ko':
      return setLang === 'ja' && /[ki]/.test(card.marks) ? { from: card, ref: 'ja' } : null;
    case 'zh':
      // Só a gêmea única que o índice aponta; simplificado não tem.
      if (setLang !== 'zh-tw' || card.twinProductId == null) return null;
      return twin && twin.productId === card.twinProductId && twin.set.lang === 'ja' ? { from: twin, ref: 'ja' } : null;
  }
}

/** A primeira com mercado; sem mercado em nenhuma, a primeira com menor anúncio. `wanted` limita às impressões pedidas. */
function pickPrint(prints: LookupPrint[], wanted?: PrintCode[]): { print: LookupPrint; kind: PriceKind } | null {
  const pool = sorted(wanted ? prints.filter((p) => wanted.includes(p.code)) : prints);
  const market = pool.find((p) => p.market != null);
  if (market) return { print: market, kind: 'market' };
  const low = pool.find((p) => p.low != null);
  return low ? { print: low, kind: 'listing' } : null;
}

/** A carta com selo já é a própria versão (Mirror, Reverse da 85): o filtro não muda a impressão. */
function wantedPrints(card: LookupCard, variant?: VariantFilter | null) {
  if (!variant) return undefined;
  if (card.stamp && stampKind(card.stamp) === variant) return undefined;
  return VARIANT_PRINTS[variant];
}

const NO_CELL: CellPrice = { kind: 'none', brl: null, ref: null, morePrints: 0 };

/** Preço da célula da grade. Em "Todos" (`lang` null), o idioma da própria linha, sem "ref.". */
export function cellPrice(card: LookupCard, lang: LookupLang | null, header: LookupHeader, twin?: LookupCard | null, variant?: VariantFilter | null): CellPrice {
  const src = priceSource(card, lang, twin);
  if (!src) return NO_CELL;
  const chosen = pickPrint(src.from.prints, wantedPrints(card, variant));
  if (!chosen) return NO_CELL;
  const brl = toBrl(chosen.kind === 'market' ? chosen.print.market : chosen.print.low, header.fxSell);
  if (brl == null) return NO_CELL;
  return { kind: chosen.kind, brl, ref: src.ref, morePrints: src.from.prints.filter((p) => p !== chosen.print && priced(p)).length };
}

/** Quadro de preço da folha. `print` é a impressão escolhida nos chips; sem ela (ou sem preço nela), nada de outra. */
export function priceBlock(card: LookupCard, lang: LookupLang, header: LookupHeader, twin?: LookupCard | null, print?: PrintCode | null): PriceBlock {
  const src = priceSource(card, lang, twin);
  const dates = { pricesDay: (src?.from.set ?? card.set).pricesDay ?? header.pricesDay, fxDay: header.fxDay, fxSell: header.fxSell };
  const empty: PriceBlock = { kind: 'none', ref: null, printsRef: null, printCode: null, brl: null, usd: null, lowBrl: null, midBrl: null, prints: [], ...dates };
  if (!src) return empty;
  const fx = header.fxSell;
  const prints = sorted(src.from.prints).map((p) => {
    const kind: PriceKind = p.market != null ? 'market' : p.low != null ? 'listing' : 'none';
    return { code: p.code, label: PRINT_LABEL[p.code], brl: toBrl(p.market ?? p.low, fx), kind };
  });
  const chosen = pickPrint(src.from.prints, print ? [print] : undefined);
  const cents = chosen ? (chosen.kind === 'market' ? chosen.print.market : chosen.print.low) : null;
  const brl = toBrl(cents, fx);
  // Sem preço na impressão escolhida não há referência a mostrar, mas os chips das outras continuam sendo referência.
  if (!chosen || brl == null) return { ...empty, prints, printsRef: src.ref };
  return {
    kind: chosen.kind,
    ref: src.ref,
    printsRef: src.ref,
    printCode: chosen.print.code,
    brl,
    usd: cents == null ? null : round2(cents / 100),
    lowBrl: toBrl(chosen.print.low, fx),
    midBrl: toBrl(chosen.print.mid, fx),
    prints,
    ...dates,
  };
}
