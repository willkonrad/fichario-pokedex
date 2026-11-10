import type { Entry, Variant } from './types';

// Cartas salvas por versões anteriores do app que hoje são outra versão do catálogo: ajustadas ao ler a carta (do
// aparelho, da nuvem ou de uma cópia importada), para o preço, o "tenho" da lista e a versão marcada na tela valerem.
// Função pura, sem mudar a data da carta: todo lugar que lê chega à mesma carta (a migração 20261110a_ja_mirror_selo
// faz o mesmo nas cópias da nuvem).

/** Marcador Mirror que a TCGplayer japonesa escreve antes do número ("Ampharos (Mirror Holofoil) - 033/070"). */
const JA_MIRROR_IN_NAME = /\s*\((Mirror (?:Holofoil|Foil))\)$/;
/** Variações que o "Adicionar" dava a esses produtos (pelas impressões, ou a escolhida sem selo). */
const PLAIN_VARIANTS: Variant[] = ['normal', 'holo', 'reverse'];

/**
 * Carta japonesa só do catálogo ("tcgp-<produto>") salva quando o catalog-sync deixava no nome o marcador Mirror escrito
 * antes do número: o produto não tinha selo e o nome era "Larry's Efficiency (Mirror Foil)", então a carta ficou normal
 * ou holo, sem selo. O produto é o Mirror: a carta vira reverse com o selo dele ("Mirror Foil", como o catálogo grava
 * hoje) e o nome perde o marcador. Sem isso, o preço sairia da carta comum de mesmo número como se fosse exato (ou de
 * nenhuma, na carta que só existe Mirror) e a lista não marcaria "tenho" no Mirror. O preço guardado era da versão
 * antiga: a busca de sempre traz o novo. Carta com selo ou descrição, ou de outra variação, fica como está.
 */
function mirrorFromName<T extends Entry>(e: T): T {
  if (e.lang !== 'ja' || !e.cardId.startsWith('tcgp-') || (e.variantNote ?? '').trim() || !PLAIN_VARIANTS.includes(e.variant)) return e;
  const mark = JA_MIRROR_IN_NAME.exec(e.cardName ?? '')?.[1];
  if (!mark) return e;
  return { ...e, variant: 'reverse', variantNote: mark, cardName: e.cardName.replace(JA_MIRROR_IN_NAME, '').trim() };
}

/** A carta como o app de hoje a entende (devolve o mesmo objeto quando nada muda). */
export function upgradeEntry<T extends Entry>(e: T): T {
  return mirrorFromName(e);
}
