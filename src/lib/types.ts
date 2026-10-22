export type CardLang = 'pt' | 'en' | 'ja';

export const LANG_LABEL: Record<CardLang, string> = { pt: 'Português', en: 'Inglês', ja: 'Japonês' };
export const LANG_SHORT: Record<CardLang, string> = { pt: 'PT', en: 'EN', ja: 'JP' };

/** Estados de conservação no padrão do mercado brasileiro (M, NM, SP, MP, HP, D). */
export const CONDITIONS = [
  { id: 'M', label: 'M', desc: 'Mint — perfeita, nunca jogada' },
  { id: 'NM', label: 'NM', desc: 'Near Mint — quase perfeita' },
  { id: 'SP', label: 'SP', desc: 'Slightly Played — marcas leves' },
  { id: 'MP', label: 'MP', desc: 'Moderately Played — desgaste visível' },
  { id: 'HP', label: 'HP', desc: 'Heavily Played — muito desgaste' },
  { id: 'D', label: 'D', desc: 'Damaged — danificada' },
] as const;
export type Condition = (typeof CONDITIONS)[number]['id'];

export const VARIANTS = [
  { id: 'normal', label: 'Normal' },
  { id: 'holo', label: 'Holo / Foil' },
  { id: 'reverse', label: 'Reverse Foil' },
  { id: 'firstEdition', label: '1ª Edição' },
  { id: 'shadowless', label: 'Shadowless' },
  { id: 'pokeball', label: 'Reverse Poké Ball' },
  { id: 'masterball', label: 'Reverse Master Ball' },
  { id: 'wPromo', label: 'Promo / Selo' },
  { id: 'staff', label: 'Staff / Pré-release' },
  { id: 'other', label: 'Outra' },
] as const;
export type Variant = (typeof VARIANTS)[number]['id'];

/** Qual preço do MYP conta como o valor da carta: mínimo, média ou máximo dos anúncios. */
export type ValueBasis = 'min' | 'avg' | 'max';
export const VALUE_BASIS_LABEL: Record<ValueBasis, string> = { min: 'mínimo', avg: 'média', max: 'máximo' };

/** Como a carta chegou à coleção. */
export const ORIGINS = [
  { id: 'trade', label: 'Troca' },
  { id: 'booster', label: 'Booster' },
  { id: 'purchase', label: 'Compra' },
] as const;
export type Origin = (typeof ORIGINS)[number]['id'];

/**
 * Preços do produto da carta na API pública do MYP Cards (mypcards.com/api/v1): menor, médio e maior anúncio, de
 * todos os estados e idiomas juntos (a API não separa). Buscados pelo app no celular (sem token, a API só atende
 * aparelhos: 10 consultas/min), no cadastro e 1×/semana.
 */
export type MypApiPrice = {
  /** Carta, versão e selo (promo/staff) para os quais a busca foi feita (se mudarem, o app busca de novo). */
  cardId: string;
  variant: string;
  note?: string;
  productId?: number;
  /** Código do produto no MYP ("pokemon_fco_025/124"). */
  code?: string;
  /** Página do produto no MYP. */
  url?: string;
  min?: number;
  avg?: number;
  max?: number;
  /** Unidades à venda. */
  qty?: number;
  /** Produto próprio da versão com selo (ex.: "Pokemon Day 2026"): os preços são só dessa versão. */
  ownVersion?: boolean;
  /** Motivo de não achar a carta no MYP. */
  notFound?: string;
  /** Versão da regra que reconheceu o produto (MYP_MATCHER); ausente = 1. */
  v?: number;
  checkedAt: string;
};

/** Uma carta guardada num slot do fichário. */
export type Entry = {
  id: string;
  /** Fichário livre onde está a carta; ausente = fichário Pokédex. */
  binderId?: string;
  /** Pokédex: número do Pokémon. Fichário livre: Pokémon da carta (0 se não for Pokémon). */
  dex: number;
  /** Pokédex: espaço dentro do Pokémon. Fichário livre: índice do bolso (0 = primeiro). */
  slot: number;
  cardId: string;
  lang: CardLang;
  /** Catálogo de onde vêm os dados, quando difere do idioma da carta (ex.: coleção que só existe em inglês). */
  dataLang?: CardLang;
  cardName: string;
  setName: string;
  setId: string;
  localId: string;
  setTotal?: number;
  rarity?: string;
  image?: string;
  /** URL completa da imagem quando veio da reserva (pokemontcg.io), sem imagem na TCGdex. */
  imageUrl?: string;
  variant: Variant;
  variantNote?: string;
  /** Selos da versão com selo (TCGdex: "set-logo", "prerelease"…), para desenhar o selo sobre a arte. */
  stampKeys?: string[];
  /** Foto oficial da versão com selo (TCGplayer, via catálogo do TCGCSV), escolhida na lista. */
  stampPhoto?: string;
  condition: Condition;
  notes?: string;
  /** Menor, médio e maior preço do produto no MYP Cards (API pública; ver MypApiPrice). */
  mypApi?: MypApiPrice;
  /**
   * Qual dos três preços do MYP é o valor da carta na soma (ex.: mínimo para cartas novas, média para as antigas).
   * Ausente = média.
   */
  valueBasis?: ValueBasis;
  /**
   * Valor digitado pelo usuário: o único valor fixo, com prioridade sobre a média do MYP. É apagado (null) quando a
   * média do MYP passa dele.
   */
  myValue?: { value: number; setAt: string } | null;
  /** Como a carta chegou: troca, booster ou compra. */
  origin?: Origin;
  /** Quanto foi pago (só para origem "compra"). */
  purchasePrice?: number;
  /** "Meu valor" apagado pelo servidor porque o MYP passou dele (gravado pelo servidor). */
  myValueReplaced?: { value: number; mypValue: number; at: string };
  /** Imagem reserva salva por versões antigas do app (de quando os preços vinham da Liga). */
  ligaImage?: string;
  /** Busca exata da carta na Liga ("Nome (número/total)"), gravada por versões antigas; usada no link "Ver na Liga". */
  ligaQuery?: string;
  updatedAt: string;
};

/** Configuração do fichário Pokédex (o principal) e, em `extras`, os outros fichários do usuário. */
export type BinderSettings = {
  rows: number;
  cols: number;
  /** Folhas do fichário (opcional) — usado só para avisar se cabe tudo. */
  sheets?: number;
  doubleSided: boolean;
  slotsPerPokemon: number;
  languages: CardLang[];
  /** Nome e cor da capa do fichário Pokédex. */
  name?: string;
  color?: string;
  /** Faixa da Pokédex coberta (ex.: só Kanto = 1–151). Padrão: todos. */
  dexFrom?: number;
  dexTo?: number;
  /** Fichários livres (não Pokédex). */
  extras?: CustomBinder[];
  /** Última alteração (para a sincronização saber qual versão é a mais nova). */
  updatedAt?: string;
};

export const DEFAULT_SETTINGS: BinderSettings = {
  rows: 3,
  cols: 3,
  sheets: undefined,
  doubleSided: true,
  slotsPerPokemon: 1,
  languages: ['pt', 'en', 'ja'],
};

/** Id do fichário Pokédex; cartas sem `binderId` são dele. */
export const POKEDEX_BINDER = 'pokedex';

export const BINDER_PURPOSES = [
  { id: 'collection', label: 'Coleção', icon: 'albums-outline' },
  { id: 'set', label: 'Coleção completa', icon: 'layers-outline' },
  { id: 'favorites', label: 'Favoritas', icon: 'heart-outline' },
  { id: 'trade', label: 'Trocas / venda', icon: 'swap-horizontal-outline' },
  { id: 'deck', label: 'Deck', icon: 'game-controller-outline' },
  { id: 'graded', label: 'Graduadas', icon: 'ribbon-outline' },
  { id: 'other', label: 'Outro', icon: 'folder-outline' },
] as const;
export type BinderPurpose = (typeof BINDER_PURPOSES)[number]['id'];

/** Fichário livre: o usuário escolhe quais cartas colocar em cada bolso. */
export type CustomBinder = {
  id: string;
  name: string;
  color: string;
  purpose: BinderPurpose;
  description?: string;
  rows: number;
  cols: number;
  /** Páginas do fichário (cada lado de folha conta como página quando é frente e verso). */
  pages: number;
  doubleSided: boolean;
  /** Mostrar a cápsula de preços embaixo das cartas. */
  showPrices: boolean;
  /** Mostrar o número do bolso nos espaços vazios. */
  showPocketNumbers: boolean;
  /** Idioma inicial da busca de cartas. */
  searchLang: CardLang;
  createdAt: string;
};

export const DEFAULT_CUSTOM_BINDER: Omit<CustomBinder, 'id' | 'createdAt'> = {
  name: '',
  color: '#2F5BD3', // azul (ver COVER_COLORS em components/ui.tsx)
  purpose: 'collection',
  rows: 3,
  cols: 3,
  pages: 20,
  doubleSided: true,
  showPrices: true,
  showPocketNumbers: true,
  searchLang: 'pt',
};
