// Da Consulta para o "Adicionar": a carta no formato do app, com a versão que estava na tela (impressão escolhida nos
// chips, 1ª edição, coleção "(Shadowless)"). Só o código da impressão viaja: nenhum preço do índice vai junto.

import { stampKind } from '@/lib/lookup-format';
import { cardByKey } from '@/lib/lookup-index';
import { priceBlock } from '@/lib/lookup-price';
import type { LookupCard, LookupHeader, PrintCode, VariantFilter } from '@/lib/lookup-types';
import { toBrief } from '@/lib/lookup-view';
import type { CardBrief } from '@/lib/tcgdex';
import type { Variant } from '@/lib/types';

/** Carta da Consulta com a versão vista (`version`), para o "Adicionar" já marcar essa versão em vez da comum. */
export type LookupBrief = CardBrief;

const PRINT_VERSION: Record<PrintCode, Variant> = { N: 'normal', H: 'holo', R: 'reverse', '1': 'firstEdition', '1H': 'firstEdition', U: 'normal', UH: 'holo' };

/** Coleção "(Shadowless)" da TCGplayer: tem o mesmo id da TCGdex da carta comum, só o grupo diz que é Shadowless. */
export const isShadowlessSet = (card: LookupCard) => card.set.lang === 'en' && /shadowless/i.test(card.set.name);

/** Impressão que corresponde ao filtro de variação (a carta com selo já é a própria versão: fica a impressão padrão). */
export function printOfVariant(card: LookupCard, variant: VariantFilter | null): PrintCode | null {
  if (!variant || (card.stamp && stampKind(card.stamp) === variant)) return null;
  const wanted: PrintCode[] = variant === 'holo' ? ['H', 'UH', '1H'] : variant === 'reverse' ? ['R'] : variant === 'firstEdition' ? ['1', '1H'] : [];
  return wanted.find((c) => card.prints.some((p) => p.code === c)) ?? null;
}

/** Impressão que a folha mostra ao abrir (a da grade): a do filtro de variação ou, sem ela, a do preço padrão. */
export function shownPrint(card: LookupCard, lang: 'pt' | 'en' | 'ja', header: LookupHeader, variant: VariantFilter | null): PrintCode | null {
  const wanted = printOfVariant(card, variant);
  const twin = card.twinProductId ? cardByKey(String(card.twinProductId), card.dex) : null;
  return priceBlock(card, lang, header, twin, wanted).printCode ?? wanted;
}

/** Versão do app para a impressão vista. Carta com selo: o selo já é a versão. Na "(Shadowless)", 1ª edição ou Shadowless. */
export function printVersion(card: LookupCard, lang: 'pt' | 'en' | 'ja', print: PrintCode | null): Variant | undefined {
  if (card.stamp) return undefined;
  const first = print === '1' || print === '1H';
  if (lang === 'en' && isShadowlessSet(card)) return first ? 'firstEdition' : 'shadowless';
  return print ? PRINT_VERSION[print] : undefined;
}

/** `toBrief` com a versão vista na Consulta. */
export function lookupBrief(card: LookupCard, lang: 'pt' | 'en' | 'ja', print: PrintCode | null): LookupBrief {
  const brief = toBrief(card, lang);
  const version = printVersion(card, lang, print);
  return version ? { ...brief, version } : brief;
}
