/**
 * Número da carta como vem impresso nela, para a tela da carta, as listas e a busca da Liga.
 *
 * - Total com zeros só até a largura do número: "025/165", mas "1/64" (Jungle) e "4/102".
 * - Galeria (Trainer Gallery, Galarian Gallery, Shiny Vault): a sigla vai também no total, "TG05/TG30".
 * - Promo: o total da coleção não é impresso (a TCGdex inventa um), "SWSH020".
 * - Número com letras fora de uma galeria ("RC5" em Gerações): só o número, porque o total da coleção não é o da
 *   sub-coleção impressa.
 */
export type PrintedNumberInput = { localId?: string; total?: number; setId?: string; setName?: string };

/** Coleção de promos: ids da TCGdex terminados em "p" (swshp, svp, mep, SV-P…) ou o nome com "Promo". */
export function isPromoSet(c: Pick<PrintedNumberInput, 'setId' | 'setName'>) {
  return /p$/i.test(c.setId?.trim() ?? '') || /\bpromos?\b/i.test(c.setName ?? '');
}

/** Galeria numa coleção só dela, com o total da galeria (swsh12tg, swsh12.5gg, sma). */
const isGallerySet = (setId?: string) => /(?:tg|gg)$/i.test(setId ?? '') || setId === 'sma';

export function printedNumber(c: PrintedNumberInput): string {
  const id = c.localId?.trim() ?? '';
  if (!id) return '';
  if (!c.total || c.total < 1 || isPromoSet(c)) return id;
  const m = /^([A-Za-z]*)(\d+)[a-z]?$/.exec(id);
  if (!m) return id;
  const [, prefix, digits] = m;
  const total = String(c.total).padStart(digits.length, '0');
  if (!prefix) return `${id}/${total}`;
  return isGallerySet(c.setId) ? `${id}/${prefix}${total}` : id;
}
