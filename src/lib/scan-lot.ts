// O lote do escaneamento: o que foi lido, a escolha de cada carta, onde cada uma vai e como guardar e desfazer.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { keyOf } from '@/store/collection';

import { buildNewEntry, destinationsFor, isCopyOf, type Destination } from './add-card';
import { isStable, type CardReading, type OcrPage } from './card-ocr';
import { allowsLang } from './lookup-format';
import type { LookupCard, PrintCode } from './lookup-types';
import { toBrief } from './lookup-view';
import type { ScanMatch } from './scan-match';
import type { CardBrief } from './tcgdex';
import { POKEDEX_BINDER, type BinderSettings, type Condition, type CustomBinder, type Entry, type Variant } from './types';

/** Só estes idiomas entram na coleção. */
export type LotCardLang = 'pt' | 'en' | 'ja';

export type LotItem = {
  id: string;
  reading: CardReading;
  match: ScanMatch;
  picked: string | null;
  /** O idioma pedido para o item; o da carta escolhida sai de `itemLang`. */
  lang: LotCardLang | null;
  printCode: PrintCode | null;
  stampKey: string | null;
  thumb?: string;
  checked: boolean;
  copies: number;
};

export type Placement = { item: LotItem; dest: Destination | null };
export type PlanContext = { settings: BinderSettings | null; binders: CustomBinder[]; entries: Record<string, Entry>; target: 'auto' | string; activeBinderId?: string };

const LOT_KEY = 'scan:lot';
const LAST_KEY = 'scan:last';
const LAST_TTL_MS = 24 * 3_600_000;
/** Vale qualquer coisa não nula: `destinationsFor` só pergunta se o bolso está ocupado. */
const RESERVED = {} as Entry;

const PRINT_ORDER: PrintCode[] = ['N', 'H', 'U', 'UH', '1', '1H', 'R'];
const PRINT_VARIANT: Record<PrintCode, Variant> = { N: 'normal', H: 'holo', R: 'reverse', '1': 'firstEdition', '1H': 'firstEdition', U: 'normal', UH: 'holo' };
export const PRINT_LABEL: Record<PrintCode, string> = { N: 'Normal', H: 'Holo', R: 'Reverse', '1': '1ª edição', '1H': '1ª edição holo', U: 'Unlimited', UH: 'Unlimited holo' };

/** Versão nunca é lida com segurança: só Holofoil dá holo, Normal + Reverse dá normal. */
export function defaultPrint(card: LookupCard): PrintCode | null {
  const has = new Set(card.prints.map((p) => p.code));
  return PRINT_ORDER.find((c) => has.has(c)) ?? null;
}

/** Id de um item do lote; a miniatura usa o mesmo nome, por isso ele existe antes do item. */
export const newItemId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const collectible = (lang: string | null): lang is LotCardLang => lang === 'pt' || lang === 'en' || lang === 'ja';
const COLLECTIBLE = ['pt', 'en', 'ja'] as const;

/** Coreana ou chinesa: só consulta, fora da coleção e da conta. */
export function isLookupOnly(item: Pick<LotItem, 'match'>) {
  return item.match.lang === 'ko' || item.match.lang === 'zh';
}

/** Item novo do lote: certas e "confira a versão" já marcadas; dúvidas e não lidas, desmarcadas. */
export function newLotItem(reading: CardReading, match: ScanMatch, thumb?: string, id: string = newItemId()): LotItem {
  const first = match.candidates[0] ?? null;
  const lang = collectible(match.lang) ? match.lang : null;
  return {
    id,
    reading,
    match,
    picked: first?.key ?? null,
    lang,
    printCode: first ? defaultPrint(first) : null,
    stampKey: null,
    thumb,
    checked: match.status === 'exact' && !!lang,
    copies: 1,
  };
}

/** A carta que vai para o fichário: a versão com selo, se escolhida, senão a escolhida. */
export function cardOf(item: Pick<LotItem, 'match' | 'picked' | 'stampKey'>): LookupCard | null {
  const key = item.stampKey ?? item.picked;
  return (key && item.match.candidates.find((c) => c.key === key)) || null;
}

/**
 * Idioma em que a carta escolhida entra: o pedido, se ela existe nele; senão, o que ela tem (carta sem PT nunca é salva
 * como PT). Sem idioma pedido (coreana, chinesa, não lida), continua sem idioma: coreana nunca vira japonesa.
 */
export function itemLang(item: Pick<LotItem, 'match' | 'picked' | 'stampKey' | 'lang'>): LotCardLang | null {
  if (!item.lang) return null;
  const card = cardOf(item);
  if (!card || allowsLang(card, item.lang)) return item.lang;
  return COLLECTIBLE.find((l) => allowsLang(card, l)) ?? null;
}

export type LotBlock = 'attention' | 'version' | 'sure' | 'lookup';

/** Em que bloco da conferência a carta aparece. */
export function lotBlock(item: LotItem): LotBlock {
  if (isLookupOnly(item)) return 'lookup';
  if (item.match.status !== 'exact') return 'attention';
  return item.match.needsVersion ? 'version' : 'sure';
}

export function briefOf(item: LotItem): CardBrief | null {
  const card = cardOf(item);
  const lang = itemLang(item);
  return card && lang ? toBrief(card, lang) : null;
}

/** Já existe na coleção (a mesma regra da busca, inclusive a japonesa salva com o outro id). */
export function alreadyOwned(item: LotItem, entries: Record<string, Entry>) {
  const brief = briefOf(item);
  return !!brief && Object.values(entries).some((e) => isCopyOf(e, brief));
}

/** O dono escolheu a carta na Consulta: entra como candidata, marcada, no idioma mostrado na folha (`shown`). */
export function applyPick(item: LotItem, card: LookupCard, shown?: LotCardLang): LotItem {
  const wanted = shown ?? item.lang;
  const lang = wanted && allowsLang(card, wanted) ? wanted : (COLLECTIBLE.find((l) => allowsLang(card, l)) ?? null);
  const candidates = [card, ...item.match.candidates.filter((c) => c.key !== card.key)];
  return {
    ...item,
    match: { ...item.match, status: item.match.status === 'none' ? 'doubt' : item.match.status, candidates, needsVersion: card.prints.length > 1 },
    picked: card.key,
    stampKey: null,
    printCode: defaultPrint(card),
    lang,
    checked: !!lang,
  };
}

/** Bolso de uma carta no plano: automático ou o fichário escolhido, nunca "Substituir". */
function pocketFor(card: LookupCard, ctx: PlanContext, entries: Record<string, Entry>): Destination | null {
  const dests = destinationsFor({ dex: card.dex || undefined, settings: ctx.settings, binders: ctx.binders, entries, activeBinderId: ctx.activeBinderId }).filter((d) => d.kind !== 'replace');
  if (ctx.target === POKEDEX_BINDER) return dests.find((d) => d.kind === 'dex') ?? dests.find((d) => d.kind === 'extra') ?? null;
  if (ctx.target !== 'auto') return dests.find((d) => d.binderId === ctx.target) ?? null;
  const rank = (d: Destination) => (d.kind === 'dex' ? 0 : d.binderId && d.binderId === ctx.activeBinderId ? 1 : d.kind === 'binder' ? 2 : 3);
  return [...dests].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * Onde cada carta marcada vai, sobre uma cópia local da coleção, reservando bolso a bolso (duas do mesmo Pokémon não
 * disputam o mesmo espaço). Sem bolso, `dest` é null e a carta fica de fora.
 */
export function planBatch(items: LotItem[], ctx: PlanContext): Placement[] {
  const entries: Record<string, Entry> = { ...ctx.entries };
  const out: Placement[] = [];
  for (const item of items) {
    const card = cardOf(item);
    if (!item.checked || !card || !itemLang(item)) continue;
    for (let n = 0; n < Math.max(1, item.copies); n++) {
      const dest = pocketFor(card, ctx, entries);
      if (dest) entries[keyOf(dest.binderId, dest.dex, dest.slot)] = RESERVED;
      out.push({ item, dest });
    }
  }
  return out;
}

/** As cartas prontas para salvar, sem rede: dados do índice e o bolso reservado. Preços chegam pelos buscadores de sempre. */
export function batchEntries(plan: Placement[], condition: Condition): Omit<Entry, 'id' | 'updatedAt'>[] {
  const out: Omit<Entry, 'id' | 'updatedAt'>[] = [];
  for (const { item, dest } of plan) {
    const card = cardOf(item);
    const lang = itemLang(item);
    if (!dest || !card || !lang) continue;
    const known = { rarity: card.rarity, setTotal: card.set.total ?? undefined, variant: item.printCode ? PRINT_VARIANT[item.printCode] : undefined };
    out.push(buildNewEntry({ card: toBrief(card, lang), facts: null, version: null, condition, dest, known }));
  }
  return out;
}

/** O que sobra no lote depois de colocar: tira as cópias que entraram. */
export function afterBatch(items: LotItem[], plan: Placement[], savedIds: Set<string>): LotItem[] {
  const placed = new Map<string, number>();
  for (const { item, dest } of plan) {
    if (dest && savedIds.has(keyOf(dest.binderId, dest.dex, dest.slot))) placed.set(item.id, (placed.get(item.id) ?? 0) + 1);
  }
  return items.flatMap((item) => {
    const n = placed.get(item.id) ?? 0;
    if (!n) return [item];
    return n >= item.copies ? [] : [{ ...item, copies: item.copies - n }];
  });
}

// ---------- Guardar e retomar ----------

let memory: LotItem[] | null = null;

/** Lote em andamento: em memória com as miniaturas; no aparelho, sem fotos. */
export async function saveLot(items: LotItem[]): Promise<void> {
  memory = items;
  if (!items.length) {
    await AsyncStorage.removeItem(LOT_KEY).catch(() => {});
    return;
  }
  await AsyncStorage.setItem(LOT_KEY, JSON.stringify(items.map(({ thumb: _thumb, ...rest }) => rest))).catch(() => {});
}

const isLotItem = (v: unknown): v is LotItem => {
  const x = v as LotItem | null;
  return !!x && typeof x.id === 'string' && !!x.reading && !!x.match && Array.isArray(x.match.candidates);
};

export async function loadLot(): Promise<LotItem[] | null> {
  if (memory?.length) return memory;
  const raw = await AsyncStorage.getItem(LOT_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && list.length && list.every(isLotItem) ? list : null;
  } catch {
    return null;
  }
}

export async function clearLot(): Promise<void> {
  memory = null;
  await AsyncStorage.removeItem(LOT_KEY).catch(() => {});
}

// ---------- Escolha feita na Consulta ----------

type PickListener = (itemId: string, card: LookupCard, lang?: LotCardLang) => void;
const pickListeners = new Set<PickListener>();
let pendingPick: { itemId: string; card: LookupCard; lang?: LotCardLang } | null = null;

/** Chamado pela Consulta aberta com `pick`: leva a carta escolhida, no idioma mostrado, de volta à conferência. */
export function deliverScanPick(itemId: string, card: LookupCard, lang?: LotCardLang): void {
  if (!pickListeners.size) {
    pendingPick = { itemId, card, lang };
    return;
  }
  pickListeners.forEach((fn) => fn(itemId, card, lang));
}

export function onScanPick(fn: PickListener): () => void {
  pickListeners.add(fn);
  if (pendingPick) {
    const { itemId, card, lang } = pendingPick;
    pendingPick = null;
    fn(itemId, card, lang);
  }
  return () => {
    pickListeners.delete(fn);
  };
}

// ---------- Desfazer o último lote ----------

export type LastBatch = { at: string; cards: { id: string; cardId: string }[] };

export async function saveLastBatch(cards: LastBatch['cards'], now = Date.now()): Promise<void> {
  const data: LastBatch = { at: new Date(now).toISOString(), cards };
  await AsyncStorage.setItem(LAST_KEY, JSON.stringify(data)).catch(() => {});
}

/** Último lote colocado, por até 24 h. */
export async function loadLastBatch(now = Date.now()): Promise<LastBatch | null> {
  const raw = await AsyncStorage.getItem(LAST_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as LastBatch;
    if (!Array.isArray(data.cards) || !data.cards.length || now - Date.parse(data.at) > LAST_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

export async function clearLastBatch(): Promise<void> {
  await AsyncStorage.removeItem(LAST_KEY).catch(() => {});
}

/** Só sai o que continua sendo a carta colocada: bolso que mudou depois do lote fica como está. */
export function undoTargets(last: LastBatch, entries: Record<string, Entry>): string[] {
  return last.cards.filter((c) => entries[c.id]?.cardId === c.cardId).map((c) => c.id);
}

// ---------- Aceitar e recortar ----------

/** Sigla + número + nome numa carta única aceita com uma leitura; nos outros casos, duas leituras iguais. */
export function shouldAccept(history: CardReading[], match: ScanMatch): boolean {
  const last = history[history.length - 1];
  if (!last) return false;
  if (match.status === 'exact' && !!last.setCode && !!last.number && !!(last.speciesId || last.name)) return true;
  return isStable(history);
}

const MIN_PICTURE_SIDE = 2400;

/** O menor tamanho de foto com lado maior de pelo menos 2.400 (texto legível sem pesar o laço). */
export function pickPictureSize(sizes: string[], min = MIN_PICTURE_SIDE): string | undefined {
  const parsed = sizes.flatMap((s) => {
    const m = /^(\d+)x(\d+)$/.exec(s);
    return m ? [{ s, big: Math.max(Number(m[1]), Number(m[2])), area: Number(m[1]) * Number(m[2]) }] : [];
  });
  return parsed.filter((x) => x.big >= min).sort((a, b) => a.area - b.area)[0]?.s;
}

/** Retângulo da miniatura: a área com texto da leitura, com folga, nas medidas reais da imagem. */
export function thumbCrop(page: Pick<OcrPage, 'width' | 'height' | 'lines'>, imageW: number, imageH: number): { originX: number; originY: number; width: number; height: number } | null {
  const boxes = page.lines.flatMap((l) => (l.box ? [l.box] : []));
  if (!boxes.length || !page.width || !page.height) return null;
  // Foto gravada deitada (EXIF não aplicado): sem recorte, para não cortar a carta errado.
  if (page.width > page.height !== imageW > imageH) return null;
  const sx = imageW / page.width;
  const sy = imageH / page.height;
  const left = Math.min(...boxes.map((b) => b.x)) * sx;
  const top = Math.min(...boxes.map((b) => b.y)) * sy;
  const right = Math.max(...boxes.map((b) => b.x + b.w)) * sx;
  const bottom = Math.max(...boxes.map((b) => b.y + b.h)) * sy;
  const pad = Math.max(right - left, bottom - top) * 0.06;
  const originX = Math.max(0, Math.floor(left - pad));
  const originY = Math.max(0, Math.floor(top - pad));
  const width = Math.min(imageW - originX, Math.ceil(right - left + pad * 2));
  const height = Math.min(imageH - originY, Math.ceil(bottom - top + pad * 2));
  return width > 0 && height > 0 ? { originX, originY, width, height } : null;
}
