export type CardLang = 'pt' | 'en' | 'ja';

export const LANG_LABEL: Record<CardLang, string> = { pt: 'Português', en: 'Inglês', ja: 'Japonês' };
export const LANG_SHORT: Record<CardLang, string> = { pt: 'PT', en: 'EN', ja: 'JP' };

/** Estados de conservação no padrão usado pela LigaPokemon. */
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

export type Price = {
  min?: number;
  avg?: number;
  max?: number;
  /** Preço médio da última venda concluída. */
  last?: number;
  currency: 'BRL';
  /** 'site' = lido da página; 'manual' = digitado. */
  source: 'site' | 'manual';
  updatedAt: string;
};

/**
 * Valor de vendas reais finalizadas no Brasil, em reais, do "Quanto vale minha carta?"
 * (quantovaleminhacarta.com.br): mediana por estado, no idioma da carta.
 */
export type SoldInfo = {
  /** Página da carta no site (fonte citada no app). */
  url?: string;
  byCondition?: Partial<Record<Condition, { value?: number; count: number }>>;
  /** Variante a que os valores se referem (ex.: "Normal") e as variantes com vendas. */
  variant?: string;
  variants?: { name: string; count: number }[];
  lastSale?: { price: number; daysAgo: number };
  /** Vendas recentes (mais recente primeiro): há quantos dias, estado, idioma ("PT-BR"…) e preço. */
  sales?: { daysAgo: number; condition?: string; lang?: string; price: number }[];
  summary?: string;
  /** Poucas vendas (1 ou 2): referência inicial, não valor firme. */
  lowConfidence?: boolean;
  notFound?: string;
  checkedAt: string;
};

/** Menor anúncio no MYP Cards no idioma da carta, via servidor MCP público do Zukan (zukan.com.br). */
export type MypInfo = {
  /** Menor anúncio no idioma da carta. */
  price?: number;
  label?: string;
  /** Menor anúncio em português e NM em inglês, para comparar idiomas. */
  pt?: number;
  en?: number;
  /** Histórico de 30 dias (BRL): t = data ISO, p = preço, k = idioma. */
  history?: { t: string; p: number; k: 'pt' | 'en' }[];
  checkedAt: string;
};

/** Menor oferta no MYP Cards no ESTADO e IDIOMA da carta (gravado pelo servidor, quando a API do MYP fornecer). */
export type MypOffers = {
  min?: number;
  count: number;
  condition: string;
  lang: string;
  url?: string;
  notFound?: string;
  checkedAt: string;
};

/** Preços internacionais da variante da carta, com o câmbio do dia (gravado pelo servidor, qvmc-sync). */
export type IntlInfo = {
  tcgplayer?: { market?: number; low?: number; mid?: number; finish?: string; productId?: number };
  cardmarket?: { trend?: number; avg?: number; low?: number; avg30?: number; idProduct?: number };
  cardtrader?: { min?: number; currency?: string; count: number; blueprintId: number; condition?: string; language?: string };
  /** Reais por 1 US$ e por 1 €. */
  fx?: { usd: number; eur: number; date: string };
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
  condition: Condition;
  notes?: string;
  /** Cotação LigaPokemon (da variação da carta). */
  price?: Price;
  /** Faixa de preço da Liga por acabamento, ex.: { Normal: {...}, Foil: {...} }. */
  ligaFinishes?: Record<string, { min?: number; avg?: number; max?: number }>;
  ligaUrl?: string;
  /** Busca de edição exata na Liga, usada pela cotação automática (cron). */
  ligaQuery?: string;
  /** A Liga não encontrou esta carta na última cotação (o app mostra "sem cotação"). */
  ligaNotFound?: string;
  /** Por que o resultado da Liga foi recusado (ex.: edição diferente) — o app não usa preço de outra carta. */
  ligaMismatch?: string;
  /** Última vez que a cotação automática consultou a Liga para esta carta (com ou sem resultado). */
  ligaCheckedAt?: string;
  /** Vendas reais por idioma e estado, do "Quanto vale minha carta?" (gravado pelo servidor, qvmc-sync). */
  sold?: SoldInfo;
  /** Menor anúncio no MYP Cards no idioma da carta (via Zukan; gravado pelo servidor). */
  myp?: MypInfo;
  /** Menor oferta no MYP no estado e idioma da carta (gravado pelo servidor, semanal). */
  mypOffers?: MypOffers;
  /** Preços internacionais (TCGplayer, Cardmarket, CardTrader) e câmbio; gravado pelo servidor. */
  intl?: IntlInfo;
  /** Valor digitado pelo usuário (ex.: menor anúncio no estado conferido na Liga); tem prioridade sobre as fontes. */
  myValue?: { value: number; setAt: string };
  /** Id da carta na pokemontcg.io (usado pelo site de vendas reais). */
  ptcgId?: string;
  /** Imagem da carta na Liga (reserva quando as outras bases não têm foto). */
  ligaImage?: string;
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

/** Cores de capa disponíveis. */
export const BINDER_COLORS = ['#F5A524', '#E5484D', '#F76B15', '#46A758', '#12A594', '#0090FF', '#6E56CF', '#D6409F', '#8D8D8D', '#1C1C1F'];

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
  color: BINDER_COLORS[5],
  purpose: 'collection',
  rows: 3,
  cols: 3,
  pages: 20,
  doubleSided: true,
  showPrices: true,
  showPocketNumbers: true,
  searchLang: 'pt',
};
