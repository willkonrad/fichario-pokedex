import type { CardDetail } from './tcgdex';
import { VARIANTS, type Variant } from './types';

/** Nomes legíveis dos selos de promo da TCGdex. */
const STAMP_LABEL: Record<string, string> = {
  // Nas coleções recentes, o selo com o logo da coleção é a promo que vem na caixa de booster (Booster Box).
  'set-logo': 'Logo da coleção (Booster Box)',
  gamestop: 'GameStop',
  'eb-games': 'EB Games',
  'pokemon-center': 'Pokémon Center',
  'player-rewards': 'Player Rewards',
  winner: 'Winner',
  staff: 'Staff',
  prerelease: 'Pré-release',
};

const stampLabel = (s: string) => STAMP_LABEL[s] ?? s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Variações que existem para a carta, na ordem do app (normal, holo, reverse, 1ª edição, Shadowless,
 * Poké Ball, Master Ball, promo/selo, staff), e os selos de promo encontrados.
 *
 * Usa as impressões detalhadas da TCGdex (`variants_detailed`, de preferência do catálogo em inglês,
 * cujos valores não são traduzidos) e completa com as marcações simples (`variants`).
 */
export function availableVariants(detail?: CardDetail | null, enDetail?: CardDetail | null) {
  const found = new Set<Variant>();
  const stamps = new Set<string>();
  const printings = enDetail?.variants_detailed ?? detail?.variants_detailed ?? [];

  for (const p of printings) {
    const type = p.type.toLowerCase();
    const foil = p.foil?.toLowerCase();
    const pStamps = (p.stamp ?? []).map((s) => s.toLowerCase());
    if (pStamps.includes('1st-edition') || p.subtype?.toLowerCase().includes('1st')) found.add('firstEdition');
    if (p.subtype?.toLowerCase() === 'shadowless') found.add('shadowless');
    if (foil === 'pokeball') found.add('pokeball');
    else if (foil === 'masterball') found.add('masterball');
    const promoStamps = pStamps.filter((s) => s !== '1st-edition');
    if (promoStamps.some((s) => s === 'staff' || s === 'prerelease')) found.add('staff');
    if (promoStamps.some((s) => s !== 'staff' && s !== 'prerelease')) found.add('wPromo');
    for (const s of promoStamps) stamps.add(stampLabel(s));
    // Impressão sem selo e sem acabamento especial: é a versão comum daquele tipo.
    if (!promoStamps.length && foil !== 'pokeball' && foil !== 'masterball') {
      if (type === 'normal') found.add('normal');
      else if (type === 'holo') found.add('holo');
      else if (type === 'reverse') found.add('reverse');
    }
  }

  // Completa com as marcações simples (quando não há impressões detalhadas, só elas existem).
  const flags = detail?.variants ?? enDetail?.variants ?? {};
  for (const id of ['normal', 'holo', 'reverse', 'firstEdition', 'wPromo'] as const) if (flags[id]) found.add(id);

  const ids = VARIANTS.map((v) => v.id).filter((id) => found.has(id));
  return { ids, stamps: [...stamps] };
}
