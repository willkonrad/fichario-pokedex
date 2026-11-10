// Regras puras da cópia do catálogo do TCGCSV (sem rede, testáveis), usadas pela Edge Function catalog-sync (index.ts):
// quais produtos de uma coleção são cartas avulsas, a data de lançamento da coleção, o endereço dos preços, quando uma
// coleção é copiada de novo (a versão da cópia da 85) e o que fazer num 404 do TCGCSV.

/** Categorias do TCGCSV: 3 = Pokémon (inglês), 85 = Pokémon Japan. */
export const ENGLISH = 3;
export const JAPANESE = 85;

export type ExtendedField = { name: string; displayName?: string; value: string };
export type Product = { productId: number; name: string; extendedData?: ExtendedField[]; presaleInfo?: { releasedOn?: string | null } };

/** Número impresso na carta (campo "Number"), ou null sem ele. */
export function productNumber(p: Product): string | null {
  return p.extendedData?.find((e) => e.name === 'Number')?.value || null;
}

/**
 * Campos que só carta tem, pelo nome sem caixa nem espaço ("Card Type" → "cardtype"). Produto lacrado (booster,
 * caixa, deck, display, coleção) não tem nenhum deles; a raridade sozinha basta ("None" também é raridade).
 */
const CARD_FIELDS = new Set(['rarity', 'cardtype', 'hp', 'stage', 'attack1', 'cardtext', 'weakness']);
const fieldKey = (s?: string) => (s ?? '').toLowerCase().replace(/\s+/g, '');

/** Valor de um campo de carta do produto, pelo nome sem caixa nem espaço em name ou displayName; null se vazio. */
export function productField(p: Product, name: 'HP' | 'Card Type' | 'Stage'): string | null {
  const key = fieldKey(name);
  const field = p.extendedData?.find((e) => fieldKey(e.name) === key || fieldKey(e.displayName) === key);
  return field?.value?.trim() || null;
}

/** HP da carta: o 1º inteiro do campo, só de 10 a 400 e múltiplo de 10; o resto é erro da fonte e fica null. */
export function parseHp(raw: string | null): number | null {
  const found = raw?.match(/\d+/);
  if (!found) return null;
  const hp = Number(found[0]);
  return hp >= 10 && hp <= 400 && hp % 10 === 0 ? hp : null;
}

/** Dia de lançamento do produto (presaleInfo.releasedOn), AAAA-MM-DD; null sem data ou com data vazia da fonte (0001-01-01). */
export function productReleasedOn(p: Product): string | null {
  const day = p.presaleInfo?.releasedOn ?? '';
  return /^(19|20)\d{2}-\d{2}-\d{2}/.test(day) ? day.slice(0, 10) : null;
}

/** Quantas cartas copiadas nesta execução trouxeram cada campo novo (report.fields), para conferir o canário. */
export type CopiedFields = { hp: number; cardType: number; stage: number; releasedOn: number; rejectedHp: string[]; numbered: number };
export const emptyFields = (): CopiedFields => ({ hp: 0, cardType: 0, stage: 0, releasedOn: 0, rejectedHp: [], numbered: 0 });
const REJECTED_HP_EXAMPLES = 5;
const NO_HP_TYPE = /trainer|energy/i;

/** Colunas hp, card_type, stage e released_on da carta, somando em `fields` o que veio. */
export function cardColumns(p: Product, number: string | null, fields: CopiedFields) {
  const rawHp = productField(p, 'HP');
  const row = {
    hp: parseHp(rawHp),
    card_type: productField(p, 'Card Type'),
    stage: productField(p, 'Stage'),
    released_on: productReleasedOn(p),
  };
  // Treinador e energia não têm HP: não contam para o alarme de "campo renomeado". Com o tipo vazio (o nome do campo pode
  // ter mudado), conta.
  if (number && !NO_HP_TYPE.test(row.card_type ?? '')) fields.numbered++;
  if (row.hp !== null) fields.hp++;
  else if (rawHp && /\d/.test(rawHp) && fields.rejectedHp.length < REJECTED_HP_EXAMPLES && !fields.rejectedHp.includes(rawHp)) fields.rejectedHp.push(rawHp);
  if (row.card_type) fields.cardType++;
  if (row.stage) fields.stage++;
  if (row.released_on) fields.releasedOn++;
  return row;
}

/** Copiou carta numerada que pode ter HP e nenhuma trouxe: o nome do campo mudou na fonte. Vira item em report.errors. */
export function missingHpError(fields: CopiedFields): string | null {
  return fields.numbered > 0 && fields.hp === 0 ? `campos: ${fields.numbered} cartas numeradas copiadas sem nenhum HP` : null;
}

/**
 * Produto que é carta avulsa: o que tem número. Na 85 (japonês), também o sem número que tem algum campo de carta
 * preenchido: as cartas antigas (1996–2002, "Pocket Monsters") não têm número impresso. Na 3 nada muda.
 */
export function isCardProduct(p: Product, category: number): boolean {
  if (productNumber(p)) return true;
  if (category !== JAPANESE) return false;
  return (p.extendedData ?? []).some(
    (e) => !!e.value?.trim() && (CARD_FIELDS.has(fieldKey(e.name)) || CARD_FIELDS.has(fieldKey(e.displayName))),
  );
}

/**
 * Produtos sem número de uma coleção da 85: guardados como carta e descartados (lacrados), com alguns nomes de cada.
 * droppedFields[i] são os nomes dos campos do extendedData de droppedNames[i] (sem os valores): mostram se o descartado
 * tinha algum campo de carta (vazio).
 */
export type Unnumbered = { kept: number; dropped: number; keptNames: string[]; droppedNames: string[]; droppedFields: string[][] };
const EXAMPLES = 3;
/** Na nova cópia da 85, mais exemplos de descartados: descartado não fica no banco, só no relatório. */
const NEW_COPY_DROPPED_EXAMPLES = 30;

/**
 * Quantos descartados guardar no relatório: 30 na coleção da 85 copiada pela primeira vez com a versão atual da cópia
 * (nova cópia ou coleção nova), 3 nas outras.
 */
export function droppedExamples(g: { category: number; link_version?: number | null }) {
  return g.category === JAPANESE && (g.link_version ?? 0) < JA_COPY_VERSION ? NEW_COPY_DROPPED_EXAMPLES : EXAMPLES;
}

/**
 * Cartas avulsas de uma coleção (com o número, ou null na carta japonesa sem número) e, na 85, a conta dos produtos sem
 * número (para conferir no relatório da execução que nenhum produto lacrado entrou). Sem nenhum, `unnumbered` é null.
 */
export function cardProducts(results: Product[], category: number, droppedLimit = EXAMPLES) {
  const cards: { p: Product; number: string | null }[] = [];
  const u: Unnumbered = { kept: 0, dropped: 0, keptNames: [], droppedNames: [], droppedFields: [] };
  for (const p of results) {
    const number = productNumber(p);
    if (number) {
      cards.push({ p, number });
    } else if (isCardProduct(p, category)) {
      cards.push({ p, number: null });
      u.kept++;
      if (u.keptNames.length < EXAMPLES) u.keptNames.push(p.name);
    } else if (category === JAPANESE) {
      u.dropped++;
      if (u.droppedNames.length < droppedLimit) {
        u.droppedNames.push(p.name);
        u.droppedFields.push((p.extendedData ?? []).map((e) => e.name));
      }
    }
  }
  return { cards, unnumbered: u.kept || u.dropped ? u : null };
}

/**
 * Data de lançamento da coleção ("2023-01-20T00:00:00" → "2023-01-20"). O TCGCSV manda a data do dia quando a coleção
 * não tem data: data igual ou posterior ao dia do build (last-updated.txt, em UTC) vira null. Uma coleção lançada de
 * fato no dia do build fica sem data só até a leitura do dia seguinte.
 */
export function releaseDay(publishedOn: string | null | undefined, built: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(publishedOn ?? '')) return null;
  const day = publishedOn!.slice(0, 10);
  const builtDay = Number.isNaN(built.getTime()) ? null : built.toISOString().slice(0, 10);
  return builtDay && day >= builtDay ? null : day;
}

/** Arquivo de preços de uma coleção no TCGCSV (inglês ou japonês). */
export const pricesUrl = (base: string, category: number, groupId: number) => `${base}/tcgplayer/${category}/${groupId}/prices`;

/** Resposta HTTP de erro, com o status (o 404 é tratado à parte na cópia e nos preços). */
export class HttpError extends Error {
  status: number;
  constructor(url: string, status: number) {
    super(`${url} ${status}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Status HTTP de um erro (HttpError), ou null num erro de rede ou outro. */
export function httpStatus(e: unknown): number | null {
  const status = typeof e === 'object' && e && 'status' in e ? (e as { status: unknown }).status : null;
  return typeof status === 'number' ? status : null;
}

/**
 * Coleção sem arquivo de preços (404) nesta versão do TCGCSV: grava prices_at = build, para tentar de novo só no build
 * seguinte (sem isso ela entra em toda execução e, com 40 assim, as outras ficam sem preço). Os preços já guardados
 * ficam. Outro erro: null, e a coleção é tentada de novo na próxima execução.
 */
export function pricesNotFoundUpdate(status: number | null, built: string): { prices_at: string } | null {
  return status === 404 ? { prices_at: built } : null;
}

/**
 * Versão da cópia das coleções japonesas, guardada em link_version (a 85 não é ligada à TCGdex, a coluna fica livre
 * nela). Coleção da 85 com versão menor é copiada de novo pela própria função, sem passo no banco: a versão vai como
 * parâmetro para catalog_due_groups, que monta a fila.
 * 8: cartas sem número (as antigas, 1996–2002), que a função até a 3.1.0 descartava.
 */
export const JA_COPY_VERSION = 8;

type GroupState = { category: number; synced_at: string | null; modified_on?: string | null; link_version?: number | null };

/**
 * Campos gravados na coleção depois da cópia: a hora e a versão (da cópia na 85, da ligação na 3). A nova cópia da 85
 * pela versão que guardou cartas sem número (antes descartadas) zera prices_at para os preços serem lidos de novo: os
 * lidos antes dela não têm essas cartas (upsert_tcg_prices só grava produto do catálogo) e só voltariam no dia seguinte.
 * Acontece uma vez por coleção.
 */
export function syncedGroupUpdate(g: GroupState, keptUnnumbered: number, linkVersion: number, now: string) {
  const japanese = g.category === JAPANESE;
  const update: { synced_at: string; link_version: number; prices_at?: null } = {
    synced_at: now,
    link_version: japanese ? JA_COPY_VERSION : linkVersion,
  };
  if (japanese && g.synced_at && (g.link_version ?? 0) < JA_COPY_VERSION && keptUnnumbered > 0) update.prices_at = null;
  return update;
}

/**
 * Coleção da 85 cujo /products deu 404 (ex.: tirada da lista do TCGCSV): marcada como copiada nesta versão, para não
 * ocupar uma vaga da fila em toda execução (as cartas que ela já tinha ficam). Volta se a TCGplayer a alterar
 * (modified_on). Na 3, e em outro erro, null: a coleção continua pendente, como antes.
 */
export function productsNotFoundUpdate(g: { category: number }, status: number | null, now: string) {
  return g.category === JAPANESE && status === 404 ? { synced_at: now, link_version: JA_COPY_VERSION } : null;
}
