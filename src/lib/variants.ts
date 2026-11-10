import { catalogByTcgdexIds, isBoxStamp, isOversize, isPrereleaseStamp, plainName, sameStampVersion, stampVariant, type CatalogRow } from './catalog';
import type { CardDetail } from './tcgdex';
import { VARIANTS, type Variant } from './types';

/** Nomes legíveis dos selos de promo da TCGdex. */
const STAMP_LABEL: Record<string, string> = {
  // Junto de outro selo (Staff, Pré-release…); sozinho, o nome sai de logoOnlyLabel.
  'set-logo': 'Logo da coleção',
  gamestop: 'GameStop',
  'eb-games': 'EB Games',
  'pokemon-center': 'Pokémon Center',
  'player-rewards': 'Player Rewards',
  winner: 'Winner',
  staff: 'Staff',
  prerelease: 'Pré-release',
};

const stampLabel = (s: string) => STAMP_LABEL[s] ?? s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Selos da impressão em minúsculas: a TCGdex escreve "pre-release"; o app e a TCGplayer, "prerelease". */
const printingStamps = (stamp?: string[]) => (stamp ?? []).map((s) => s.toLowerCase().replace(/^pre[\s-]?release$/, 'prerelease'));

/**
 * A carta só existe com selo: todas as impressões detalhadas têm um selo de promo (fora o de 1ª edição), como as da
 * Coleção Clássica de 30 anos. Sem impressões detalhadas, não dá para saber (false).
 */
export function onlyStampedPrintings(detail?: CardDetail | null, enDetail?: CardDetail | null) {
  const printings = enDetail?.variants_detailed ?? detail?.variants_detailed ?? [];
  return printings.length > 0 && printings.every((p) => printingStamps(p.stamp).some((s) => s !== '1st-edition'));
}

const isLogoOnly = (keys?: string[]) => keys?.length === 1 && keys[0] === 'set-logo';

/** Nomes do selo só do logo da coleção: a promo da Booster Box ou a de Prerelease, conforme a coleção. */
export const SET_LOGO_LABEL = { box: 'Logo da coleção (Booster Box)', prerelease: 'Logo da coleção (Pré-release)', plain: 'Logo da coleção' };

/** Coleções recentes, onde a promo da Booster Box existe e a lista mostra as versões com selo (como em tcgdex.ts). */
const BOX_ERA = /^(sv|me|30th)/i;

/**
 * Nome do selo só do logo. Pelo catálogo da carta: "Booster Box" com o produto "<Coleção> Stamped"; sem ele, "Pré-release"
 * com um produto "Prerelease" (fora o de Staff). Sem essa prova (`rows` sem os dois), "Booster Box" só nas coleções
 * recentes (o nome com que essas cartas já foram salvas) e, nas outras, só o logo.
 */
export function logoOnlyLabel(setId: string, rows: CatalogRow[] = [], setNameEn = '') {
  return catalogLogoLabel(rows, setNameEn) ?? (BOX_ERA.test(setId) ? SET_LOGO_LABEL.box : SET_LOGO_LABEL.plain);
}

/** O nome que o catálogo prova (Booster Box ou Pré-release); sem prova, undefined. */
function catalogLogoLabel(rows: CatalogRow[], setNameEn: string) {
  const stamps = rows.filter((r) => r.stamp && !isOversize(r.stamp)).map((r) => r.stamp!);
  if (stamps.some((s) => isBoxStamp(s, setNameEn))) return SET_LOGO_LABEL.box;
  if (stamps.some(isPrereleaseStamp)) return SET_LOGO_LABEL.prerelease;
  return undefined;
}

// ---------- Mesma versão com outro nome (cartas salvas por versões anteriores do app) ----------

/** Selo só do logo com o nome da promo entre parênteses: o mesmo selo, com qualquer nome que o app já tenha dado. */
const LOGO_PROMO_NAME = /^Logo da coleção \((?:Booster Box|Pré-release)\)/i;

/**
 * Selo comparável: sem acento, caixa nem pontuação ("Pokémon Day" digitado = "Pokemon Day" da lista, "Pre Release" das
 * versões anteriores = "Pré-release"), e o selo do logo sem o nome da promo: "Logo da coleção (Booster Box)", "(Pré-release)"
 * e "Logo da coleção" são o mesmo selo (o nome muda com o que o catálogo da carta prova), e "Logo da coleção (Booster
 * Box) + Staff", das versões anteriores, é o "Logo da coleção + Staff" de hoje. Selo sem letras latinas (japonês): o
 * texto como está, em minúsculas.
 */
export function stampKey(label?: string | null) {
  const t = (label ?? '').trim().replace(LOGO_PROMO_NAME, 'Logo da coleção');
  return t ? plainName(t) || t.toLocaleLowerCase('pt-BR') : '';
}

/** Uma versão salva (carta) ou oferecida (lista, "Qual é a sua versão?"): variação, selo e chaves de selo da TCGdex. */
export type VersionLike = { variant?: Variant; stamp?: string | null; keys?: string[] | null };

const isPrereleaseKey = (k: string) => /^pre[\s-]?release$/i.test(k);

/**
 * `logo` é a versão do logo que o catálogo prova ser a promo de Prerelease ("Logo da coleção (Pré-release)") e `other`, o
 * produto "Prerelease" do catálogo, que as versões anteriores do app mostravam à parte (variação staff, sem a chave de
 * Prerelease da TCGdex): a mesma carta.
 */
const prereleaseLogoTwin = (logo: VersionLike, other: VersionLike) =>
  (logo.stamp ?? '').trim() === SET_LOGO_LABEL.prerelease &&
  !!other.stamp &&
  !/logo/i.test(other.stamp) &&
  isPrereleaseStamp(other.stamp) &&
  !(other.keys ?? []).some(isPrereleaseKey);

/** Mesmo selo (stampKey), ou a versão do logo de Prerelease e o produto "Prerelease" que ela juntou. Sem selo = sem selo. */
export function sameStamp(a: VersionLike, b: VersionLike) {
  const ka = stampKey(a.stamp);
  const kb = stampKey(b.stamp);
  if (ka === kb) return true;
  return !!ka && !!kb && (prereleaseLogoTwin(a, b) || prereleaseLogoTwin(b, a));
}

const PROMO_VARIANTS: Variant[] = ['wPromo', 'staff'];

/**
 * Mesma versão: mesmo selo (sameStamp) e mesma variação. Com selo, promo e staff contam como uma só: a variação sai do
 * selo, e as versões anteriores do app salvaram como promo o selo de Pré-release da TCGdex ("pre-release") e como staff
 * o produto "Prerelease" que hoje é a versão do logo.
 */
export function sameVersion(a: VersionLike, b: VersionLike) {
  if (!sameStamp(a, b)) return false;
  if (a.variant === b.variant) return true;
  return !!stampKey(a.stamp) && !!a.variant && !!b.variant && PROMO_VARIANTS.includes(a.variant) && PROMO_VARIANTS.includes(b.variant);
}

/** A versão da lista que é a salva: a de mesmo nome e variação; senão, a mesma versão com outro nome (sameVersion). */
export function savedVersionOf<T extends { variant: Variant; stamp?: string; stampKeys?: string[] }>(options: T[], saved: VersionLike): T | undefined {
  const label = (saved.stamp ?? '').trim();
  return (
    options.find((o) => o.variant === saved.variant && (o.stamp ?? '') === label) ??
    options.find((o) => sameVersion(saved, { variant: o.variant, stamp: o.stamp, keys: o.stampKeys }))
  );
}

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
    const pStamps = printingStamps(p.stamp);
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

  // Completa com as marcações simples (quando não há impressões detalhadas, só elas existem). Na carta que só existe com
  // selo, não: a TCGdex marca holo pela própria impressão com selo (ex.: 30th-c-014), e esse holo comum não existe.
  if (!onlyStampedPrintings(detail, enDetail)) {
    const flags = detail?.variants ?? enDetail?.variants ?? {};
    for (const id of ['normal', 'holo', 'reverse', 'firstEdition', 'wPromo'] as const) if (flags[id]) found.add(id);
  }

  const ids = VARIANTS.map((v) => v.id).filter((id) => found.has(id));
  return { ids, stamps: [...stamps] };
}

/** Uma versão visual da carta: a variação do app e, para promos, o selo (ex.: "Logo da coleção (Booster Box)"). */
export type VersionOption = {
  variant: Variant;
  stamp?: string;
  /** Selos da TCGdex ("set-logo", "prerelease"…). */
  stampKeys?: string[];
  /** Foto oficial desta versão (TCGplayer, via catálogo do TCGCSV), quando o catálogo a tem. */
  photo?: string;
  /** Versão que só o catálogo do TCGCSV conhece (selo no nome da TCGplayer, ex.: "Pokemon Center Exclusive"). */
  fromCatalog?: boolean;
};

const variantOrder = (v: Variant) => VARIANTS.findIndex((x) => x.id === v);

/**
 * Versões visuais que existem para a carta, uma por impressão da TCGdex (ex.: holo comum e holo com o selo da
 * coleção), na ordem do app. Sem impressões detalhadas, usa as marcações simples.
 */
export function versionOptions(detail?: CardDetail | null, enDetail?: CardDetail | null): VersionOption[] {
  const printings = enDetail?.variants_detailed ?? detail?.variants_detailed ?? [];
  const setId = enDetail?.set.id ?? detail?.set.id ?? '';
  const out = new Map<string, VersionOption>();
  const add = (o: VersionOption) => out.set(`${o.variant}|${o.stamp ?? ''}`, o);

  for (const p of printings) {
    const type = p.type.toLowerCase();
    const foil = p.foil?.toLowerCase();
    const pStamps = printingStamps(p.stamp);
    const promo = pStamps.filter((s) => s !== '1st-edition');
    if (pStamps.includes('1st-edition') || p.subtype?.toLowerCase().includes('1st')) add({ variant: 'firstEdition' });
    else if (p.subtype?.toLowerCase() === 'shadowless') add({ variant: 'shadowless' });
    else if (promo.length) {
      const staff = promo.some((s) => s === 'staff' || s === 'prerelease');
      add({ variant: staff ? 'staff' : 'wPromo', stamp: isLogoOnly(promo) ? logoOnlyLabel(setId) : promo.map(stampLabel).join(' + '), stampKeys: promo });
    } else if (foil === 'pokeball') add({ variant: 'pokeball' });
    else if (foil === 'masterball') add({ variant: 'masterball' });
    else if (type === 'normal' || type === 'holo' || type === 'reverse') add({ variant: type });
  }
  if (!out.size) for (const id of availableVariants(detail, enDetail).ids) add({ variant: id });

  return [...out.values()].sort((a, b) => variantOrder(a.variant) - variantOrder(b.variant));
}

/**
 * Junta às versões da TCGdex as versões com selo que o catálogo do TCGCSV tem da carta (as mesmas que a lista de
 * escolha mostra): a mesma versão nas duas fontes fica uma só, com a foto do catálogo (inclusive o "Poke Ball Pattern"
 * do catálogo com a impressão Poké Ball da TCGdex, que não tem selo); a que só o catálogo tem entra
 * com o selo dele ("Pokemon Center Exclusive", "Cosmos Holo"…) e a foto. Cartas gigantes (Jumbo) ficam de fora.
 * `setNameEn` = nome da coleção em inglês (para reconhecer o selo da Booster Box, "<Coleção> Stamped"). Sem esse
 * produto, o selo só do logo é a promo de Prerelease da coleção: fica com o produto "Prerelease" que sobrar.
 */
export function withCatalogVersions(options: VersionOption[], rows: CatalogRow[], setNameEn: string): VersionOption[] {
  const out = options.map((o) => ({ ...o }));
  const matched = new Set<VersionOption>();
  const stamped = rows.filter((r) => r.stamp && !isOversize(r.stamp)).sort((a, b) => a.product_id - b.product_id);
  const hasBox = stamped.some((r) => isBoxStamp(r.stamp!, setNameEn));
  const free = (o: VersionOption) => !matched.has(o) && !o.fromCatalog;
  for (const r of stamped) {
    const stamp = r.stamp!;
    const variant = stampVariant(stamp, r.category);
    // Poké Ball/Master Ball: a TCGdex descreve o padrão como acabamento, sem selo ("Poke Ball Pattern" do catálogo =
    // impressão pokeball da TCGdex); o par é a opção dessa variação sem selo.
    const ball = variant === 'pokeball' || variant === 'masterball';
    const twin =
      out.find((o) => free(o) && (ball ? o.variant === variant && !o.stamp : !!o.stamp && sameStampVersion(o.stampKeys ?? [], o.stamp, setNameEn, stamp))) ??
      (!hasBox && isPrereleaseStamp(stamp) ? out.find((o) => free(o) && isLogoOnly(o.stampKeys)) : undefined);
    if (twin) {
      matched.add(twin);
      twin.photo ??= r.image;
      continue;
    }
    if (!out.some((o) => o.variant === variant && o.stamp === stamp)) out.push({ variant, stamp, photo: r.image, fromCatalog: true });
  }
  // Selo só do logo: o nome que o catálogo prova (o mesmo de logoOnlyLabel); sem prova, fica o da TCGdex.
  const logo = catalogLogoLabel(stamped, setNameEn);
  if (logo) for (const o of out) if (!o.fromCatalog && isLogoOnly(o.stampKeys)) o.stamp = logo;
  return out.sort((a, b) => variantOrder(a.variant) - variantOrder(b.variant));
}

/**
 * Todas as versões da carta para o "Qual é a sua versão?": as da TCGdex mais as do catálogo (ver withCatalogVersions).
 * Sem internet, ou para carta que só existe no catálogo ("tcgp-"), ficam só as da TCGdex.
 */
export async function cardVersions(cardId: string | undefined, detail?: CardDetail | null, enDetail?: CardDetail | null): Promise<VersionOption[]> {
  const base = versionOptions(detail, enDetail);
  if (!cardId || cardId.startsWith('tcgp-')) return base;
  const rows = await catalogByTcgdexIds([cardId]).catch(() => [] as CatalogRow[]);
  return withCatalogVersions(base, rows, enDetail?.set.name ?? detail?.set.name ?? '');
}
