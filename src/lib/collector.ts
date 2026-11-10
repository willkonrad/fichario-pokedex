import { formatDex, getSpecies, type Species } from '@/data/pokedex';

import { printedNumber } from './card-number';
import { ENGLISH, JAPANESE, type CatalogRow } from './catalog';
import { formatDate, formatDateSpoken, formatInt, formatMonth, formatMonthSpoken, formatYears, formatYearsSpoken } from './format';
import { catalogYearsFix, type CardDetail, type SetFacts } from './tcgdex';
import { LANG_SHORT, type CardLang, type Entry, type Variant } from './types';
import { sameStamp } from './variants';

/**
 * Bloco "Para colecionador" da tela da carta e o ano ao lado da raridade: regras puras (sem rede), a partir do que a tela
 * já carregou (ficha da TCGdex, carta salva, linhas do catálogo, dia e série da coleção). Fato sem fonte não aparece:
 * nada de data, número ou total estimado.
 */

// ---------- Espelhos ----------

// Espelho das sementes de lookup_overrides em supabase/schema.sql; mude os dois juntos (teste collector-years). Os ids
// dos grupos foram conferidos uma vez no banco (o schema liga por nome).

/** Séries de promos (year_range): grupo do catálogo → categoria, nome e anos. `to` null = série ainda aberta. */
export const PROMO_GROUP_YEARS: Record<number, { category: number; name: string; from: number; to: number | null }> = {
  1418: { category: 3, name: 'WoTC Promo', from: 1999, to: 2003 },
  1421: { category: 3, name: 'Diamond and Pearl Promos', from: 2007, to: 2010 },
  1453: { category: 3, name: 'HGSS Promos', from: 2010, to: 2011 },
  1407: { category: 3, name: 'Black and White Promos', from: 2011, to: 2013 },
  1451: { category: 3, name: 'XY Promos', from: 2013, to: 2016 },
  1861: { category: 3, name: 'SM Promos', from: 2016, to: 2019 },
  2545: { category: 3, name: 'SWSH: Sword & Shield Promo Cards', from: 2019, to: 2023 },
  22872: { category: 3, name: 'SV: Scarlet & Violet Promo Cards', from: 2023, to: 2025 },
  24451: { category: 3, name: 'ME: Mega Evolution Promo', from: 2025, to: null },
  24140: { category: 85, name: 'ADV-P Promotional cards', from: 2003, to: 2004 },
  24138: { category: 85, name: 'PCG-P Promotional cards', from: 2004, to: 2006 },
  24137: { category: 85, name: 'DP-P Promotional cards', from: 2006, to: 2008 },
  24136: { category: 85, name: 'DPt-P Promotional cards', from: 2008, to: 2009 },
  24023: { category: 85, name: 'L-P: Legends Promos', from: 2009, to: 2010 },
  24342: { category: 85, name: 'BW-P Promotional cards', from: 2010, to: 2013 },
  23908: { category: 85, name: 'XY-P: XY Promos', from: 2013, to: 2016 },
  23881: { category: 85, name: 'SM-P: Sun & Moon Promos', from: 2016, to: 2019 },
  23876: { category: 85, name: 'S-P: Sword & Shield Promos', from: 2019, to: 2022 },
  23779: { category: 85, name: 'SV-P Promotional Cards', from: 2022, to: 2025 },
  24423: { category: 85, name: 'M-P Promotional Cards', from: 2025, to: null },
};

/** Coleções "de tudo um pouco" (year_mixed, todas da categoria 3): a data da coleção não é a da carta. */
export const YEAR_MIXED_GROUPS: Record<number, string> = {
  2282: 'World Championship Decks',
  22880: 'Prize Pack Series Cards',
  2374: 'Miscellaneous Cards & Products',
  1840: 'Deck Exclusives',
  1539: 'League & Championship Cards',
  1528: 'Jumbo Cards',
  2289: 'Blister Exclusives',
  2332: 'Professor Program Promos',
  1938: 'Alternate Art Promos',
};

/** Coleções de promos da TCGdex com a série espelhada: id da coleção → grupo do catálogo em PROMO_GROUP_YEARS. */
export const PROMO_SETS: Record<string, number> = {
  basep: 1418,
  dpp: 1421,
  hgssp: 1453,
  bwp: 1407,
  xyp: 1451,
  smp: 1861,
  swshp: 2545,
  svp: 22872,
  mep: 24451,
  'SV-P': 23779,
  'M-P': 24423,
};
/** Coleções de promos da TCGdex sem anos espelhados: sem Lançamento e sem Série. */
export const UNRANGED_PROMO_SETS = new Set(['np', 'wp', 'miscp']);

/**
 * Coleções da TCGdex que não são uma coleção de verdade: "Yellow A Alternate" (xya) junta as versões alternativas de
 * cartas de várias coleções (54a é a da Fates Collide, de 2016) com a data do XY (2014) e o total 6. Sem Lançamento; o
 * número é o do catálogo ("054a/124"), nunca o da TCGdex com o total dela ("54a/06").
 */
export const PSEUDO_SETS = new Set(['xya']);

/**
 * Grupos do catálogo "de tudo um pouco" fora do espelho (só no app): a data do grupo é a da primeira carta ou a do começo
 * da época, não a de cada carta. Valem como os de YEAR_MIXED_GROUPS: só a data do próprio produto. Ids conferidos no banco.
 */
export const CATCH_ALL_GROUPS: Record<number, string> = {
  24864: 'Southeast Asia Exclusives',
  24862: 'LEGEND Era Unnumbered Energies',
  24153: 'XY Era Unnumbered Energies',
  24785: 'Sun & Moon Era Unnumbered Energies',
  24817: 'Sword & Shield Era Unnumbered Energies',
  24420: 'Scarlet & Violet Era Unnumbered Energies',
  24781: 'Mega Evolution Era Unnumbered Energies',
};

/** Data do grupo que não é a da carta: os de tudo um pouco, do espelho e do app. */
const mixedGroup = (groupId: number) => groupId in YEAR_MIXED_GROUPS || groupId in CATCH_ALL_GROUPS;

/**
 * Coleções japonesas sem número impresso (Expansion Pack, neo, Intro Packs): as publicadas antes deste dia, o mesmo corte
 * da reserva japonesa em tcgdex.ts. Nelas, a TCGplayer põe no número o da Pokédex ("229") ou a posição no deck.
 */
const JA_NUMBERLESS_UNTIL = '2001-12-01';

/** Série de promos: lista fechada; "SV2P", "S10P", "SM1p", "tk-ex-p", "sp" são coleções comuns. */
export function isPromoSeries(setId: string, lang: CardLang): boolean {
  return setId in PROMO_SETS || UNRANGED_PROMO_SETS.has(setId) || (lang === 'ja' && /-P$/.test(setId));
}

// ---------- Ajudantes ----------

/** Dia "AAAA-MM-DD" (os 10 primeiros caracteres), de 1991 em diante; senão, undefined. */
export function isoDay(s?: string | null): string | undefined {
  const day = String(s ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number(day.slice(0, 4)) > 1990 ? day : undefined;
}

const yearOf = (day: string) => Number(day.slice(0, 4));

/** O ano do dia está nos anos da série (`to` null = ainda aberta). */
export function inRange(day: string, r: { from: number; to: number | null }) {
  const y = yearOf(day);
  return y >= r.from && (r.to == null || y <= r.to);
}

/** Id da coleção pelo id da carta ("svp-027" → "svp", "30th-c-011" → "30th-c"). */
export function setOfCard(cardId: string) {
  const i = cardId.lastIndexOf('-');
  return i > 0 ? cardId.slice(0, i) : '';
}

/** Coleções japonesas antigas sem número impresso (Expansion Pack e neo), pelo id: o título não pisca enquanto a coleção carrega. */
export const jaNumberless = (setId: string) => /^(PMCG|neo)\d/i.test(setId);

/** Número como a TCGplayer escreve, sem complementos: "133/132 (Mega Evolution Stamped)" → "133/132"; sem número, "". */
export function cleanNumber(n?: string | null): string {
  return /^[A-Za-z]*\d+[a-z]?(?:\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)?/.exec((n ?? '').trim())?.[0] ?? '';
}

/** O nome da coleção tem o ano do dia ("McDonald's Promos 2011" e 2011-06-17). */
const nameHasYear = (name: string, day: string) => new RegExp(`(?:^|\\D)${day.slice(0, 4)}(?:\\D|$)`).test(name);

const sameText = (a: string, b: string) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

/** O único valor distinto da lista; com nenhum ou com dois ou mais, undefined. */
function single<T>(values: T[]): T | undefined {
  const set = new Set(values);
  return set.size === 1 ? [...set][0] : undefined;
}

// ---------- Entrada e saída ----------

export type CollectorInput = {
  cardId: string;
  lang: CardLang;
  dataLang: CardLang;
  detail: CardDetail | null;
  enDetail: CardDetail | null;
  saved?: Pick<Entry, 'setId' | 'setName' | 'localId' | 'setTotal' | 'rarity'>;
  /** Dia e série da coleção (setFacts). */
  set?: SetFacts;
  /** Nome em português da coleção de uma carta em português com dados em inglês. */
  ptSetName?: string;
  /** Nome na TCGplayer da coleção de uma carta da TCGdex japonesa ("M5: Abyss Eye"). */
  jaGroupName?: string;
  /** Linhas do catálogo da carta; [] para japonesa, "tcgp-" ou sem resposta. */
  rows: CatalogRow[];
  /** Versão mostrada em "Variação". */
  version?: { variant: Variant; stamp?: string };
  dex: number[];
};

export type ReleaseFact =
  | { kind: 'day'; day: string; source: 'set' | 'catalog-group' | 'catalog-product' }
  // Só o mês ("AAAA-MM"): a TCGdex deu o dia 01, que muitas vezes só marca o mês, e o catálogo não confirmou o dia.
  | { kind: 'month'; month: string }
  // to null = série ainda aberta (só no espelho)
  | { kind: 'range'; from: number; to: number | null };

export type FactKey = 'set' | 'release' | 'version' | 'serie' | 'number' | 'size' | 'rarity' | 'illustrator' | 'nameEn' | 'pokemon';
export type FactRow = { key: FactKey; label: string; value: string; note?: string; spoken: string; wide: boolean; numeric?: boolean };
export type CollectorFacts = {
  release?: ReleaseFact;
  badge?: { text: string; spoken: string };
  /** Número como impresso (também no título da tela); "" quando não há. */
  number: string;
  /** Raridade (também no selo do título); nunca "None". */
  rarity?: string;
  rows: FactRow[];
  footer: string;
};

// ---------- Textos ----------

export const COLLECTOR_TITLE = 'Para colecionador';

export const COLLECTOR_LABELS = {
  set: 'Coleção',
  release: {
    range: 'Série de promos',
    reprint: 'Lançamento desta reimpressão',
    set: 'Lançamento da coleção',
    english: 'Lançamento em inglês',
    card: 'Lançamento da carta',
  },
  version: 'Esta versão',
  serie: 'Série',
  number: 'Número',
  size: 'Cartas na coleção',
  rarity: 'Raridade',
  illustrator: 'Ilustrador',
  nameEn: 'Nome em inglês',
  pokemon: 'Pokémon',
} as const;

export const COLLECTOR_NOTES = {
  range: 'A fonte não data cada carta.',
  monthOnly: 'A fonte não dá o dia.',
  reprintPt: 'Data da coleção em inglês.',
  tcgplayer: 'Data da TCGplayer.',
  groupPt: 'Data da coleção na TCGplayer.',
  cardPt: 'Data da carta na TCGplayer.',
  unstamped: 'Data da carta sem selo, na TCGplayer.',
  versionDay: (date: string) => `Data na TCGplayer: ${date}.`,
  versionNoDay: 'A fonte não dá a data desta versão.',
  aboveTotal: 'Número acima do total da coleção.',
  // "Fora dele", não "acima dele": as cartas a mais podem ter número acima do total ou letras (RC1 na Generations, 98a).
  size: (official: string, extra: string) => `${official} no total impresso e ${extra} fora dele.`,
  groupName: 'Nome da coleção na TCGplayer, em inglês.',
  inEnglish: (name: string) => `Em inglês: ${name}`,
  englishData: 'Dados da carta em inglês: a fonte não a tem em português.',
  jaGroup: (name: string) => `Na TCGplayer: ${name}`,
  japanese: (name: string) => `Em japonês: ${name}`,
};

/** Rótulo do ano ao lado da raridade, para o leitor de tela ("Ano da coleção: 2023"). */
const BADGE_SPOKEN = {
  reprint: 'Ano desta reimpressão',
  reprintEnglish: 'Ano desta reimpressão em inglês',
  set: 'Ano da coleção',
  setEnglish: 'Ano da coleção em inglês',
  card: 'Ano da carta',
  cardEnglish: 'Ano da carta em inglês',
  version: 'Ano desta versão',
  versionEnglish: 'Ano desta versão em inglês',
};

/**
 * Selo do ano. Na carta em português, toda data é a do lançamento em inglês (nenhuma fonte tem a do Brasil): o selo diz
 * isso também na tela ("2023 · EN"), não só para o leitor de tela.
 */
function yearBadge(day: string, spokenLabel: string, english: boolean): { text: string; spoken: string } {
  const year = yearOf(day);
  return { text: english ? `${formatYears(year)} · ${LANG_SHORT.en}` : formatYears(year), spoken: `${spokenLabel}: ${formatYearsSpoken(year)}` };
}

/** "Sobre estes dados": o que cada data quer dizer e o que as fontes não têm. */
export const COLLECTOR_INFO: { title: string; topics: { title?: string; body: string }[] } = {
  title: 'Sobre estes dados',
  topics: [
    {
      title: 'Lançamento da coleção',
      body: 'Quando a coleção saiu. Nas coleções da Wizards (1999–2003), é o primeiro lançamento; as cópias sem 1ª edição podem ter saído depois. Quando a fonte não dá o dia, aparecem só o mês e o ano.',
    },
    { title: 'Cartas em português', body: 'As fontes só têm a data do lançamento em inglês. Nenhuma fonte tem a data no Brasil.' },
    { title: 'Promos', body: 'Quando a fonte não data cada carta, aparece o período da série de promos.' },
    { body: 'Versões de outro produto (kits, Prize Pack, blisters) mostram o produto; a data só aparece quando a fonte a dá.' },
    { body: 'O que as fontes não informam, como tiragem e população, não aparece aqui.' },
  ],
};

/** Fontes no rodapé, nesta ordem. */
const SOURCES = ['TCGdex', 'Zukan', 'TCGplayer', 'lista do app', 'PokéAPI'] as const;
type Source = (typeof SOURCES)[number];

// ---------- Regras ----------

const isTcgpCard = (cardId: string) => cardId.startsWith('tcgp-');

/** Id da coleção: o da ficha, o da carta salva ou o do id da carta. */
const setIdOf = (i: CollectorInput) => i.detail?.set.id || i.saved?.setId || setOfCard(i.cardId);

/** Linhas do catálogo em inglês desta carta (a tela só lê essas). */
const ownRows = (i: CollectorInput) => (isTcgpCard(i.cardId) ? [] : i.rows.filter((r) => r.category === ENGLISH && r.tcgdex_id === i.cardId));
const unstamped = (rows: CatalogRow[]) => rows.filter((r) => !r.stamp);

/** A raridade do catálogo: a única distinta das linhas sem selo. */
const catalogRarity = (i: CollectorInput) =>
  single(
    unstamped(ownRows(i))
      .map((r) => r.rarity?.trim())
      .filter((r): r is string => !!r),
  );

/** De onde vem uma ficha: catálogo ("tcgp-"), Zukan (a TCGdex não tem a carta) ou TCGdex. */
function sourceOf(d: CardDetail, lang: CardLang): Source {
  if (isTcgpCard(d.id)) return 'TCGplayer';
  // A ficha do Zukan não traz as impressões; as fichas guardadas antes da marca `source` só se reconhecem assim.
  if (d.source === 'zukan' || (lang !== 'ja' && !d.variants)) return 'Zukan';
  return 'TCGdex';
}

/** Coleção Clássica (reimpressões com outro número na TCGdex): pelo id, que vale sem internet, ou pelos nomes. */
export function isClassicCollection(i: CollectorInput): boolean {
  if (/^(cel25cc|30th-c)$/.test(setOfCard(i.cardId))) return true;
  const tcgp = isTcgpCard(i.cardId);
  const names = [
    i.enDetail?.set.name,
    i.dataLang === 'en' ? i.detail?.set.name : undefined,
    tcgp ? (i.detail?.set.name ?? i.saved?.setName) : undefined,
    i.detail?.rarity ?? i.saved?.rarity,
    catalogRarity(i),
  ];
  return names.some((n) => !!n && /classic collection/i.test(n));
}

const UPGRADABLE = new Set(['Common', 'Uncommon', 'Rare', 'None']);

/**
 * Raridade: a da TCGdex, com uma troca estreita pela do catálogo: "Classic Collection" quando a TCGdex não dá nenhuma
 * (qualquer idioma) e, nos dados em inglês, "Promo" ou "Holo Rare" no lugar de Common/Uncommon/Rare/None. Nunca o
 * contrário (mep-021 continua "Promo").
 */
function rarityOf(i: CollectorInput): { value?: string; fromCatalog: boolean } {
  const td = (i.detail?.rarity ?? i.saved?.rarity)?.trim() || undefined;
  const cr = catalogRarity(i);
  if (cr === 'Classic Collection' && (!td || td === 'None')) return { value: cr, fromCatalog: true };
  if (i.dataLang === 'en' && (!td || UPGRADABLE.has(td)) && (cr === 'Promo' || cr === 'Holo Rare')) return { value: cr, fromCatalog: true };
  return { value: td && td !== 'None' ? td : undefined, fromCatalog: false };
}

/** Raridade mostrada (bloco e selo do título). */
export const collectorRarity = (i: CollectorInput) => rarityOf(i).value;

/**
 * Número como impresso: "tcgp-" pelo catálogo, com sufixo ("001/BW-P"); japonesa antiga (PMCG, neo), nenhum; Coleção
 * Clássica, o do catálogo ("4/102", nunca "CC002" nem "001/030"); as outras pelo número da TCGdex e o total.
 */
function numberOf(i: CollectorInput, classic: boolean): { value: string; fromCatalog: boolean } {
  const setId = setIdOf(i);
  if (isTcgpCard(i.cardId)) {
    const c = i.detail?.catalog;
    // Sem a ficha (sem internet, ou antes de a ficha nova chegar): o número que a carta salva (ou a lista) já tinha.
    if (!c) return { value: cleanNumber(i.saved?.localId), fromCatalog: true };
    const n = cleanNumber(c.number);
    // Japonesa sem número impresso: só o "NNN/TTT" é da carta (VS, web, "009/P"); um número solto, não.
    const published = isoDay(c.publishedOn);
    if (c.category === JAPANESE && !n.includes('/') && (!published || published < JA_NUMBERLESS_UNTIL)) return { value: '', fromCatalog: true };
    return { value: n, fromCatalog: true };
  }
  if (i.lang === 'ja' && jaNumberless(setId)) return { value: '', fromCatalog: false };
  if (classic || PSEUDO_SETS.has(setId)) {
    const numbers = unstamped(ownRows(i))
      .map((r) => cleanNumber(r.number))
      .filter(Boolean);
    const n = single(numbers) ?? '';
    // Reimpressão de uma promo da Wizards (cel25cc-CC008, "_____'s Pikachu"): a carta traz só "24"; o "/53" é o total
    // que a TCGplayer dá às promos da Wizards (basep-33 é "33/53" lá), e não é impresso.
    return { value: classic ? n.replace(/^(\d+)\/53$/, '$1') : n, fromCatalog: true };
  }
  const value = printedNumber({
    localId: i.detail?.localId ?? i.saved?.localId,
    total: i.detail?.set.cardCount?.official || i.saved?.setTotal,
    setId,
    setName: i.detail?.set.name ?? i.saved?.setName,
    promo: isPromoSeries(setId, i.lang),
  });
  return { value, fromCatalog: false };
}

export const printedCardNumber = (i: CollectorInput) => numberOf(i, isClassicCollection(i)).value;

/**
 * A busca da Liga vai só pelo nome: na Coleção Clássica e na "Yellow A Alternate" o número da TCGdex ("001/030",
 * "54a/06") não é o impresso, e a Liga cadastra as reimpressões com o dela ("Charizard (004/30)"); a japonesa antiga
 * (PMCG, neo) não tem número impresso.
 */
export function ligaByNameOnly(i: CollectorInput): boolean {
  const setId = setIdOf(i);
  return isClassicCollection(i) || PSEUDO_SETS.has(setId) || (i.lang === 'ja' && jaNumberless(setId));
}

const dayFact = (day: string, source: 'set' | 'catalog-group' | 'catalog-product'): ReleaseFact => ({ kind: 'day', day, source });
const rangeFact = (r: { from: number; to: number | null }): ReleaseFact => ({ kind: 'range', from: r.from, to: r.to });

/** Data da carta só do catálogo ("tcgp-"), pela coleção dela. */
function catalogRelease(c: CardDetail['catalog'], groupName: string): ReleaseFact | undefined {
  if (!c) return undefined;
  const fix = catalogYearsFix(c.groupId);
  if (fix) return rangeFact(fix);
  const released = isoDay(c.releasedOn);
  const published = isoDay(c.publishedOn);
  const promo = PROMO_GROUP_YEARS[c.groupId];
  if (promo) return released && inRange(released, promo) ? dayFact(released, 'catalog-product') : rangeFact(promo);
  if (mixedGroup(c.groupId)) return released ? dayFact(released, 'catalog-product') : undefined;
  // Promos sem série espelhada: a data do grupo só quando o nome tem o mesmo ano ("McDonald's Promos 2011").
  if (/promo/i.test(groupName)) {
    if (released) return dayFact(released, 'catalog-product');
    return published && nameHasYear(groupName, published) ? dayFact(published, 'catalog-group') : undefined;
  }
  if (released) return dayFact(released, 'catalog-product');
  return published ? dayFact(published, 'catalog-group') : undefined;
}

/**
 * Lançamento: o dia da coleção (TCGdex; na japonesa, o da coleção japonesa), o do produto ou da coleção no catálogo, ou
 * o período da série de promos quando a fonte não data a carta. Sem fonte, undefined.
 */
export function releaseFact(i: CollectorInput): ReleaseFact | undefined {
  if (isTcgpCard(i.cardId)) return catalogRelease(i.detail?.catalog, i.detail?.set.name ?? i.saved?.setName ?? '');
  if (i.set?.serieId === 'misc') return undefined;
  const setId = setIdOf(i);
  if (PSEUDO_SETS.has(setId)) return undefined;
  if (isPromoSeries(setId, i.lang)) {
    const group = PROMO_SETS[setId];
    const range = group ? PROMO_GROUP_YEARS[group] : undefined;
    if (!range) return undefined;
    // O dia do produto só quando é um só (linhas sem selo, na coleção da série), cabe nos anos e não é antes da coleção.
    const days = [
      ...new Set(
        unstamped(ownRows(i))
          .filter((r) => r.group_id === group)
          .map((r) => isoDay(r.released_on) ?? ''),
      ),
    ];
    const day = days.length === 1 ? days[0] : '';
    const setDay = isoDay(i.set?.day);
    if (day && inRange(day, range) && (!setDay || day >= setDay)) return dayFact(day, 'catalog-product');
    return rangeFact(range);
  }
  const day = isoDay(i.set?.day);
  if (!day) return undefined;
  // Na japonesa, o dia vem da coleção japonesa da TCGdex, que dá o dia de verdade (SV4a 2023-12-01, M1S 2025-08-01: o
  // catálogo japonês tem o mesmo), e o catálogo em inglês, que confirmaria o dia, não tem a carta.
  if (!day.endsWith('-01') || i.lang === 'ja') return dayFact(day, 'set');
  // Dia 01 na TCGdex: em muitas coleções é só o mês (dp1 diz 2007-05-01; saiu em 2007-05-23). Vale o dia da coleção da
  // carta no catálogo, se estiver perto; o mesmo dia confirma o da TCGdex (sm12, 2019-11-01). Sem isso, só o mês.
  const group = catalogGroupDay(i);
  if (group === day) return dayFact(day, 'set');
  if (group && Math.abs(Date.parse(group) - Date.parse(day)) <= MONTH_TOLERANCE_MS) return dayFact(group, 'catalog-group');
  return { kind: 'month', month: day.slice(0, 7) };
}

/**
 * Até onde o dia do catálogo vale por um "dia 01" da TCGdex: o lançamento pode cair no fim do mês (dp1, 22 dias depois)
 * ou no mês anterior (ex1: 2003-07-01 na TCGdex, 2003-06-18 na TCGplayer).
 */
const MONTH_TOLERANCE_MS = 31 * 24 * 3_600_000;

/**
 * Dia da coleção da carta no catálogo: o único de tcg_groups.published_on nas linhas sem selo, fora dos grupos de promos
 * e dos de tudo um pouco (a data deles não é a da coleção).
 */
function catalogGroupDay(i: CollectorInput): string | undefined {
  const rows = unstamped(ownRows(i)).filter((r) => !mixedGroup(r.group_id) && !(r.group_id in PROMO_GROUP_YEARS));
  return single(rows.map((r) => isoDay(r.tcg_groups?.published_on)).filter((d): d is string => !!d));
}

/**
 * Versão escolhida que vem de outro produto (kit, Prize Pack, blister): o grupo da linha com o selo dela não é nenhum
 * dos grupos da carta sem selo. A data só quando a fonte a dá: a do produto ou a do grupo com o mesmo ano no nome (e
 * nunca a de um grupo "de tudo um pouco").
 */
function otherProduct(i: CollectorInput): { name: string; day?: string } | undefined {
  const stamp = i.version?.stamp?.trim();
  if (!stamp) return undefined;
  const own = ownRows(i);
  const vr = own.find((r) => !!r.stamp && sameStamp({ stamp: r.stamp }, { stamp }));
  const base = new Set(unstamped(own).map((r) => r.group_id));
  if (!vr || !base.size || base.has(vr.group_id)) return undefined;
  const name = vr.tcg_groups?.name?.trim() ?? '';
  const published = isoDay(vr.tcg_groups?.published_on);
  const trustedGroup = !!published && !mixedGroup(vr.group_id) && nameHasYear(name, published);
  return { name, day: isoDay(vr.released_on) ?? (trustedGroup ? published : undefined) };
}

/** Rótulo, nota e ano do selo de cada tipo de data. */
function releaseView(fact: ReleaseFact, i: CollectorInput, classic: boolean, unstampedDay: boolean): { label: string; note?: string; badge?: string } {
  const L = COLLECTOR_LABELS.release;
  const pt = i.lang === 'pt';
  if (fact.kind === 'range') return { label: L.range, note: COLLECTOR_NOTES.range };
  if (classic) return pt ? { label: L.reprint, note: COLLECTOR_NOTES.reprintPt, badge: BADGE_SPOKEN.reprintEnglish } : { label: L.reprint, badge: BADGE_SPOKEN.reprint };
  if (fact.kind === 'month') {
    return pt
      ? { label: L.english, note: COLLECTOR_NOTES.monthOnly, badge: BADGE_SPOKEN.setEnglish }
      : { label: L.set, note: COLLECTOR_NOTES.monthOnly, badge: BADGE_SPOKEN.set };
  }
  if (fact.source === 'set') return pt ? { label: L.english, badge: BADGE_SPOKEN.setEnglish } : { label: L.set, badge: BADGE_SPOKEN.set };
  if (fact.source === 'catalog-group') {
    return pt
      ? { label: L.english, note: COLLECTOR_NOTES.groupPt, badge: BADGE_SPOKEN.setEnglish }
      : { label: L.set, note: COLLECTOR_NOTES.tcgplayer, badge: BADGE_SPOKEN.set };
  }
  // Versão com selo no mesmo grupo (ex.: Staff da svp-183): o dia é o da carta sem selo.
  const note = unstampedDay ? COLLECTOR_NOTES.unstamped : pt ? COLLECTOR_NOTES.cardPt : COLLECTOR_NOTES.tcgplayer;
  return pt ? { label: L.english, note, badge: BADGE_SPOKEN.cardEnglish } : { label: L.card, note, badge: BADGE_SPOKEN.card };
}

// A data também: o rótulo dela ("Lançamento desta reimpressão") não cabe em meia célula (~140 px a 360 dp) e, quebrado
// em duas linhas, deixaria o valor abaixo do da célula ao lado.
const WIDE: FactKey[] = ['set', 'release', 'version', 'pokemon'];

/** A linha ocupa a largura toda mesmo sem nota (o esboço do bloco usa para reservar o lugar da data). */
export const isWideFact = (key: FactKey) => WIDE.includes(key);

/** Linha pronta: larga quando é de nome comprido ou tem nota; o leitor de tela ouve rótulo, valor e nota. */
function factRow(key: FactKey, label: string, value: string, o: { note?: string; spokenValue?: string; spokenNote?: string; numeric?: boolean } = {}): FactRow {
  const note = o.note || undefined;
  const spokenNote = o.spokenNote ?? note;
  return {
    key,
    label,
    value,
    ...(note ? { note } : {}),
    spoken: `${label}: ${o.spokenValue ?? value}${note ? `. ${spokenNote}` : ''}`,
    wide: WIDE.includes(key) || !!note,
    ...(o.numeric ? { numeric: true } : {}),
  };
}

/** "025/165" → "025 de 165", para o leitor de tela. */
const spokenNumber = (n: string) => n.replace(/\//g, ' de ');

/** Treinador ou energia: pela categoria da TCGdex ("Trainer", "Treinador", "Energy", "Energia")… */
const NOT_POKEMON = /trainer|treinador|energ/i;
/** …ou pelo tipo do produto no catálogo ("Trainer - Item", "Supporter", "Stadium", "Tool", "Basic Energy"). */
const NOT_POKEMON_TYPE = /trainer|supporter|item|stadium|tool|energy/i;

/**
 * Pokémon da linha "Pokémon": os da ficha; sem eles, o da tela (bolso do Pokédex, ou o achado no nome da carta num
 * fichário livre), menos num treinador ou numa energia ("Manectric Spirit Link" não é o Manectric).
 */
export function collectorDex(detail: CardDetail | null, screenDex: number): number[] {
  if (detail?.dexId?.length) return detail.dexId;
  if (NOT_POKEMON.test(detail?.category ?? '') || NOT_POKEMON_TYPE.test(detail?.catalog?.cardType ?? '')) return [];
  return screenDex > 0 ? [screenDex] : [];
}

export function collectorFacts(i: CollectorInput): CollectorFacts {
  const tcgp = isTcgpCard(i.cardId);
  const setId = setIdOf(i);
  const classic = isClassicCollection(i);
  const promo = tcgp ? !!i.detail?.catalog && (i.detail.catalog.groupId in PROMO_GROUP_YEARS || /promo/i.test(i.detail.set.name)) : isPromoSeries(setId, i.lang);
  const detailSource: Source | undefined = i.detail ? sourceOf(i.detail, i.dataLang) : undefined;
  // A carta salva veio da mesma fonte da ficha (sem ficha: o catálogo nas "tcgp-", senão a TCGdex).
  const savedSource: Source = detailSource ?? (tcgp ? 'TCGplayer' : 'TCGdex');
  const enSource: Source | undefined = i.enDetail ? sourceOf(i.enDetail, 'en') : undefined;
  const used = new Set<Source>();
  const rows: FactRow[] = [];
  const add = (row: FactRow, ...from: (Source | undefined)[]) => {
    if (!row.value.trim()) return;
    rows.push(row);
    for (const s of from) if (s) used.add(s);
  };
  const usable = (name?: string | null): name is string => !!name?.trim() && name.trim() !== setId;

  // Coleção
  let setValue = '';
  if (tcgp) {
    const name = [i.detail?.set.name, i.saved?.setName].find(usable);
    if (name) {
      setValue = name.trim();
      add(factRow('set', COLLECTOR_LABELS.set, setValue, { note: i.lang !== 'en' ? COLLECTOR_NOTES.groupName : undefined }), 'TCGplayer');
    }
  } else if (i.lang === 'pt') {
    const ptName = i.dataLang === 'pt' ? i.detail?.set.name : i.ptSetName;
    const enName = i.enDetail?.set.name ?? (i.dataLang === 'en' ? i.detail?.set.name : undefined);
    const enFrom = i.enDetail ? enSource : detailSource;
    const candidates: { name?: string; from?: Source }[] = [
      // O nome em português da lista de coleções da TCGdex, quando a ficha é a em inglês.
      { name: ptName, from: i.dataLang === 'pt' ? detailSource : 'TCGdex' },
      { name: enName, from: enFrom },
      { name: i.saved?.setName, from: savedSource },
    ];
    const hit = candidates.find((c) => usable(c.name));
    if (hit?.name) {
      setValue = hit.name.trim();
      const notes: string[] = [];
      let noteFrom: Source | undefined;
      if (usable(ptName) && usable(enName) && !sameText(ptName, enName)) {
        notes.push(COLLECTOR_NOTES.inEnglish(enName.trim()));
        noteFrom = enFrom;
      }
      if (i.dataLang === 'en') notes.push(COLLECTOR_NOTES.englishData);
      add(factRow('set', COLLECTOR_LABELS.set, setValue, { note: notes.join('. ') }), hit.from, noteFrom);
    }
  } else {
    const fromDetail = usable(i.detail?.set.name);
    const name = fromDetail ? i.detail!.set.name : usable(i.saved?.setName) ? i.saved!.setName : undefined;
    if (name) {
      setValue = name.trim();
      const jaNote = i.lang === 'ja' && i.jaGroupName ? COLLECTOR_NOTES.jaGroup(i.jaGroupName) : undefined;
      add(factRow('set', COLLECTOR_LABELS.set, setValue, { note: jaNote }), fromDetail ? detailSource : savedSource, jaNote ? 'TCGplayer' : undefined);
    }
  }

  // Lançamento e versão de outro produto
  const release = releaseFact(i);
  const other = otherProduct(i);
  const stampedSameGroup = !!i.version?.stamp?.trim() && !other;
  let badge: CollectorFacts['badge'];
  if (release) {
    const view = releaseView(release, i, classic, stampedSameGroup && release.kind === 'day' && release.source === 'catalog-product');
    const value =
      release.kind === 'day' ? formatDate(release.day) : release.kind === 'month' ? formatMonth(release.month) : formatYears(release.from, release.to);
    const spokenValue =
      release.kind === 'day'
        ? formatDateSpoken(release.day)
        : release.kind === 'month'
          ? formatMonthSpoken(release.month)
          : formatYearsSpoken(release.from, release.to);
    add(
      factRow('release', view.label, value, { note: view.note, spokenValue, numeric: true }),
      release.kind === 'range' ? 'lista do app' : release.kind === 'month' || release.source === 'set' ? 'TCGdex' : 'TCGplayer',
    );
    // O selo só com o ano (no mês sem dia também: o ano é certo).
    if (release.kind !== 'range' && view.badge) badge = yearBadge(release.kind === 'day' ? release.day : release.month, view.badge, i.lang === 'pt');
  }
  if (other) {
    // O selo do título segue a versão: o ano dela, ou nenhum.
    badge = undefined;
    if (other.name) {
      const day = other.day;
      add(
        factRow('version', COLLECTOR_LABELS.version, other.name, {
          note: day ? COLLECTOR_NOTES.versionDay(formatDate(day)) : COLLECTOR_NOTES.versionNoDay,
          spokenNote: day ? COLLECTOR_NOTES.versionDay(formatDateSpoken(day)) : COLLECTOR_NOTES.versionNoDay,
        }),
        'TCGplayer',
      );
      if (day) badge = yearBadge(day, i.lang === 'pt' ? BADGE_SPOKEN.versionEnglish : BADGE_SPOKEN.version, i.lang === 'pt');
    }
  }

  // Série: o nome da TCGdex (na japonesa, o nome em japonês, como vem); nunca a época que o app calcula.
  const serie = i.set?.serie?.trim();
  if (serie && !tcgp && !sameText(serie, setValue)) {
    const promoWithoutRange = isPromoSeries(setId, i.lang) && !PROMO_GROUP_YEARS[PROMO_SETS[setId]];
    const hidden = i.lang !== 'ja' && (i.set?.serieId === 'misc' || promoWithoutRange);
    if (!hidden) add(factRow('serie', COLLECTOR_LABELS.serie, serie), 'TCGdex');
  }

  // Número
  const number = numberOf(i, classic);
  if (number.value) {
    const m = /^(\d+)\/(\d+)$/.exec(number.value);
    const above = !promo && !classic && !!m && Number(m[1]) > Number(m[2]);
    add(
      factRow('number', COLLECTOR_LABELS.number, number.value, {
        note: above ? COLLECTOR_NOTES.aboveTotal : undefined,
        spokenValue: spokenNumber(number.value),
        numeric: true,
      }),
      number.fromCatalog ? 'TCGplayer' : i.detail?.localId ? detailSource : savedSource,
    );
  }

  // Cartas na coleção (com as acima do total impresso)
  const counts = i.lang === 'pt' ? i.enDetail?.set.cardCount : i.detail?.set.cardCount;
  const official = counts?.official;
  const total = counts?.total;
  const noSize = tcgp || promo || classic || PSEUDO_SETS.has(setId) || (i.lang === 'ja' && jaNumberless(setId));
  if (!noSize && official && total && total > official) {
    add(
      factRow('size', COLLECTOR_LABELS.size, formatInt(total), { note: COLLECTOR_NOTES.size(formatInt(official), formatInt(total - official)), numeric: true }),
      i.lang === 'pt' ? enSource : detailSource,
    );
  }

  // Raridade
  const rarity = rarityOf(i);
  if (rarity.value) {
    add(factRow('rarity', COLLECTOR_LABELS.rarity, rarity.value), rarity.fromCatalog ? 'TCGplayer' : i.detail?.rarity ? detailSource : savedSource);
  }

  // Ilustrador (a TCGplayer não tem)
  const illustrator = i.detail?.illustrator?.trim();
  if (illustrator && !tcgp) add(factRow('illustrator', COLLECTOR_LABELS.illustrator, illustrator), detailSource);

  // Nome em inglês: só na carta em português com dados em português, quando é outro nome.
  const nameEn = i.enDetail?.name?.trim();
  if (i.lang === 'pt' && i.dataLang === 'pt' && i.detail && nameEn && !sameText(nameEn, i.detail.name ?? '')) {
    add(factRow('nameEn', COLLECTOR_LABELS.nameEn, nameEn), enSource);
  }

  // Pokémon (pokedex.json, da PokéAPI)
  const species = [...new Set(i.dex)]
    .filter((d) => d > 0)
    .map(getSpecies)
    .filter((s): s is Species => !!s);
  if (species.length) {
    const ja = species.length === 1 ? species[0].ja?.trim() : undefined;
    add(
      factRow('pokemon', COLLECTOR_LABELS.pokemon, species.map((s) => `${formatDex(s.id)} ${s.name}`).join(' · '), {
        note: ja ? COLLECTOR_NOTES.japanese(ja) : undefined,
        spokenValue: species.map((s) => `número ${formatInt(s.id)} da Pokédex, ${s.name}`).join('; '),
      }),
      'PokéAPI',
    );
  }

  const list = SOURCES.filter((s) => used.has(s));
  const footer = !list.length ? '' : list.length === 1 ? `Fonte: ${list[0]}.` : `Fontes: ${list.join(' · ')}.`;
  return { release, badge, number: number.value, rarity: rarity.value, rows, footer };
}
