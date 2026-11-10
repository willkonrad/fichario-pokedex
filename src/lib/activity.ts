import { fetchAllPages, isMissingInServer, supabase } from './supabase';
import { POKEDEX_BINDER, type CardLang, type Condition, type Entry, type Origin, type Variant } from './types';

/**
 * Registro de mudanças da coleção (tela Relatórios). O banco grava fatos crus por bolso na tabela entry_events
 * (gatilhos entries_log_event e, na remoção, entries_log_removed): carta que entrou (added), saiu (removed) ou mudou
 * de chave (replaced), com um resumo
 * da carta. Aqui os fatos viram o que a pessoa fez: adicionou, trocou, moveu, removeu ou importou de uma vez; o
 * "Desfazer", a digitação do selo e o mover (DELETE + INSERT, dois UPDATEs cruzados, ou um UPDATE de um lado quando
 * sobe sem internet) se resolvem na leitura.
 */

/** Resumo de uma carta guardado no evento (o mesmo da função SQL entry_summary). */
export type CardSummary = {
  cardId: string;
  cardName?: string;
  setName?: string;
  setId?: string;
  localId?: string;
  setTotal?: number;
  rarity?: string;
  lang?: CardLang;
  dataLang?: CardLang;
  variant?: Variant;
  variantNote?: string;
  image?: string;
  imageUrl?: string;
  stampPhoto?: string;
  stampKeys?: string[];
  imagePt?: string;
  condition?: Condition;
  origin?: Origin;
  purchasePrice?: number;
  binderId?: string;
  dex?: number;
  slot?: number;
};

/** Linha da tabela entry_events. */
export type EntryEventRow = {
  id: number;
  entry_id: string;
  op: 'insert' | 'update' | 'delete';
  kind: 'added' | 'removed' | 'replaced';
  changed: string[] | null;
  before: CardSummary | null;
  after: CardSummary | null;
  before_key: string | null;
  after_key: string | null;
  at: string;
  happened_at: string;
  tx: string | number | null;
  source: 'app' | 'restore' | 'backfill';
};

export type ActivityKind = 'added' | 'replaced' | 'moved' | 'removed' | 'bulk';

export type ActivityItem = {
  /** Estável (para key de lista). */
  id: string;
  kind: ActivityKind;
  /** ISO, quando a pessoa fez (happened_at). */
  at: string;
  /** Backfill: só o dia é confiável (mostrar "31/10", sem hora). */
  dayOnly: boolean;
  source: 'app' | 'restore' | 'backfill';
  /** Bolso da carta agora (moved: destino; removed: de onde saiu). */
  entryId: string;
  /** moved: bolso de origem. */
  fromEntryId?: string;
  /** Carta que entrou (added/replaced/moved) ou que saiu (removed); bulk: a primeira. */
  card: CardSummary;
  /** replaced: carta que saiu. */
  prev?: CardSummary;
  /** replaced: mesma carta (cardId), mudou só idioma/versão/selo. */
  versionOnly?: boolean;
  /** bulk: quantas cartas entraram de uma vez. */
  count?: number;
  /** bulk: até 3 exemplos. */
  cards?: CardSummary[];
};

/** Intervalo que separa dois momentos do mesmo bolso, e a folga para parear mover e troca de lugar. */
const GROUP_MS = 10 * 60_000;
/** Mais que isto no mesmo envio vira "N cartas de uma vez" (importação, primeiro login). */
const BULK_OVER = 20;
const BULK_EXAMPLES = 3;
const DAY_MS = 86_400_000;

// ===== Chave e resumo =====

/** Como o btrim do Postgres: só espaços nas pontas (tab e quebra de linha ficam). */
const trimSpaces = (s: string) => s.replace(/^ +| +$/g, '');

/** Chave da carta igual à SQL entry_key: cardId|lang(pt)|variant(normal)|variantNote(trim). */
export function entryKey(c: { cardId: string; lang?: string; variant?: string; variantNote?: string }): string {
  // Sempre 4 partes, como o coalesce(...) || '|' || ... da SQL (sem cardId: "|pt|normal|").
  return [c.cardId ?? '', c.lang ?? 'pt', c.variant ?? 'normal', trimSpaces(c.variantNote ?? '')].join('|');
}

/** Resumo de uma carta atual (mesmos campos do entry_summary do banco; imagePt = mypApi.imagePt). */
export function cardSummaryOf(e: Entry): CardSummary {
  const s: CardSummary = {
    cardId: e.cardId,
    cardName: e.cardName,
    setName: e.setName,
    setId: e.setId,
    localId: e.localId,
    setTotal: e.setTotal,
    rarity: e.rarity,
    lang: e.lang,
    dataLang: e.dataLang,
    variant: e.variant,
    variantNote: e.variantNote,
    image: e.image,
    imageUrl: e.imageUrl,
    stampPhoto: e.stampPhoto,
    stampKeys: e.stampKeys,
    imagePt: e.mypApi?.imagePt,
    condition: e.condition,
    origin: e.origin,
    purchasePrice: e.purchasePrice,
    binderId: e.binderId,
    dex: e.dex,
    slot: e.slot,
  };
  // Como o jsonb_strip_nulls: sem campos vazios.
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)) as CardSummary;
}

/** Resumo mínimo tirado da chave (evento sem resumo; não deveria acontecer). */
function summaryFromKey(key: string): CardSummary {
  const [cardId, lang, variant, variantNote] = key.split('|');
  return { cardId, lang: lang as CardLang, variant: variant as Variant, ...(variantNote ? { variantNote } : {}) };
}

const keyOf = (key: string | null, s: CardSummary | null) => key ?? (s ? entryKey(s) : null);
const summaryOf = (s: CardSummary | null, key: string) => (s && typeof s === 'object' ? s : summaryFromKey(key));

// ===== Classificação =====

/** Hora em ms; aceita o formato do Postgres ("2026-11-05 14:00:00.123456+00"). Inválida: 0. */
function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  if (!Number.isNaN(ms)) return ms;
  const fixed = Date.parse(iso.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(fixed) ? 0 : fixed;
}

/** Fato cru com as horas em ms (`done` = quando a pessoa fez) e as chaves de antes e depois. */
type Fact = EntryEventRow & { atMs: number; doneMs: number; bKey: string | null; aKey: string | null; txKey: string | null };

/** Um item pronto, com o que a ordem, o lote e a anulação das movidas precisam. */
type Piece = {
  item: ActivityItem;
  /** Quando a pessoa fez (ms). */
  ms: number;
  /** Id do último fato (desempate). */
  seq: number;
  /** added: envio (tx), hora e id do INSERT, para o lote; uma troca logo depois não tira a carta do lote nem muda a hora dele. */
  batch?: { tx: string; ms: number; seq: number };
  /** moved: chave da carta que mudou de bolso. */
  key?: string;
};

type Pair<T> = { a: T; b: T; cost: number };

/** Mesmo momento do bolso: fatos do app com menos de 10 min entre um e outro (restore e backfill ficam sozinhos). */
const sameMoment = (prev: Fact, next: Fact) => next.atMs - prev.atMs < GROUP_MS && prev.source === 'app' && next.source === 'app';

/** Regra 1: um momento do bolso vira o resultado de antes do primeiro fato × depois do último; X → X é desfeito. */
function pieceOf(g: Fact[]): Piece | null {
  const first = g[0];
  const last = g[g.length - 1];
  const beforeKey = first.bKey;
  const afterKey = last.aKey;
  if (beforeKey === afterKey) return null;
  const base = {
    id: `e${last.id}`,
    at: new Date(last.doneMs).toISOString(),
    dayOnly: last.source === 'backfill',
    source: last.source,
    entryId: last.entry_id,
  };
  const piece = { ms: last.doneMs, seq: last.id };
  if (beforeKey == null) {
    const item: ActivityItem = { ...base, kind: 'added', card: summaryOf(last.after, afterKey!) };
    // Lote: só o INSERT (a outra metade de uma movida sem internet, que chega como UPDATE, fica fora).
    const batch = first.kind === 'added' && first.txKey != null ? { tx: first.txKey, ms: first.doneMs, seq: first.id } : undefined;
    return { item, ...piece, ...(batch ? { batch } : {}) };
  }
  if (afterKey == null) return { item: { ...base, kind: 'removed', card: summaryOf(first.before, beforeKey) }, ...piece };
  const card = summaryOf(last.after, afterKey);
  const prev = summaryOf(first.before, beforeKey);
  return { item: { ...base, kind: 'replaced', card, prev, versionOnly: card.cardId === prev.cardId }, ...piece };
}

/** Pares 1:1 pelo menor custo (empate: os mais antigos primeiro, pelo `rank`). */
function pairUp<T>(candidates: Pair<T>[], used: Set<T>, rank: (x: T) => number): Pair<T>[] {
  candidates.sort((x, y) => x.cost - y.cost || rank(x.a) - rank(y.a) || rank(x.b) - rank(y.b));
  const out: Pair<T>[] = [];
  for (const c of candidates) {
    if (used.has(c.a) || used.has(c.b)) continue;
    used.add(c.a);
    used.add(c.b);
    out.push(c);
  }
  return out;
}

/** Regra 2, fato a fato: saiu de um bolso (DELETE) e a mesma carta entrou em outro (INSERT), até `maxGap` entre os dois. */
function moveCandidates(facts: Fact[], free: (f: Fact) => boolean, maxGap: number): Pair<Fact>[] {
  const addedByKey = new Map<string, Fact[]>();
  for (const f of facts) {
    if (f.kind !== 'added' || f.aKey == null || !free(f)) continue;
    const same = addedByKey.get(f.aKey);
    if (same) same.push(f);
    else addedByKey.set(f.aKey, [f]);
  }
  const out: Pair<Fact>[] = [];
  for (const d of facts) {
    if (d.kind !== 'removed' || d.bKey == null || !free(d)) continue;
    for (const i of addedByKey.get(d.bKey) ?? []) {
      const gap = Math.abs(i.doneMs - d.doneMs);
      if (i.entry_id !== d.entry_id && i.source === d.source && gap <= maxGap) out.push({ a: d, b: i, cost: gap });
    }
  }
  return out;
}

/** Regra 3, fato a fato: dois UPDATEs com as chaves cruzadas (a: K1→K2, b: K2→K1). */
function swapCandidates(facts: Fact[], free: (f: Fact) => boolean, exact: boolean): Pair<Fact>[] {
  // Por "antes → depois", para achar o cruzado sem comparar todos com todos.
  const byKeys = new Map<string, Fact[]>();
  const keys = (b: string | null, a: string | null) => `${b}\u0000${a}`;
  const list = facts.filter((f) => f.kind === 'replaced' && f.bKey != null && f.aKey != null && free(f));
  for (const f of list) {
    const k = keys(f.bKey, f.aKey);
    const same = byKeys.get(k);
    if (same) same.push(f);
    else byKeys.set(k, [f]);
  }
  const out: Pair<Fact>[] = [];
  for (const a of list) {
    for (const b of byKeys.get(keys(a.aKey, a.bKey)) ?? []) {
      // Cada par uma vez só (o de id menor primeiro).
      if (b.id <= a.id || a.entry_id === b.entry_id || a.source !== b.source) continue;
      const sameTx = a.txKey != null && a.txKey === b.txKey;
      const gap = Math.abs(a.doneMs - b.doneMs);
      if (exact ? sameTx || gap === 0 : gap <= GROUP_MS) out.push({ a, b, cost: sameTx ? -1 : gap });
    }
  }
  return out;
}

/**
 * Mover que chega junto de outra ação no mesmo bolso (envio sem internet): um dos lados vem como UPDATE. Removeu X de
 * b e moveu K de a para b: removed(a, K) + replaced(b, X→K), com a mesma hora. Moveu K de a para b e depois pôs Y em
 * a: added(b, K) + replaced(a, K→Y), no mesmo envio. Par: `a` = de onde a carta saiu, `b` = onde ela entrou; só uma
 * metade do UPDATE entra no par (a outra continua: removida X ou adicionada Y), a não ser que ela entre noutra movida.
 */
function halfCandidates(facts: Fact[], free: (f: Fact) => boolean, exact: boolean): Pair<Fact>[] {
  // UPDATEs pela carta que saiu (antes) e pela que entrou (depois).
  const byBefore = new Map<string, Fact[]>();
  const byAfter = new Map<string, Fact[]>();
  const push = (map: Map<string, Fact[]>, key: string, f: Fact) => {
    const same = map.get(key);
    if (same) same.push(f);
    else map.set(key, [f]);
  };
  for (const f of facts) {
    if (f.kind !== 'replaced' || f.bKey == null || f.aKey == null || !free(f)) continue;
    push(byBefore, f.bKey, f);
    push(byAfter, f.aKey, f);
  }
  const out: Pair<Fact>[] = [];
  const add = (from: Fact, to: Fact) => {
    if (from.entry_id === to.entry_id || from.source !== to.source) return;
    const sameTx = from.txKey != null && from.txKey === to.txKey;
    const gap = Math.abs(from.doneMs - to.doneMs);
    if (exact ? sameTx || gap === 0 : gap <= GROUP_MS) out.push({ a: from, b: to, cost: sameTx ? -1 : gap });
  };
  for (const f of facts) {
    if (!free(f)) continue;
    if (f.kind === 'removed' && f.bKey != null) for (const u of byAfter.get(f.bKey) ?? []) add(f, u);
    if (f.kind === 'added' && f.aKey != null) for (const u of byBefore.get(f.aKey) ?? []) add(u, f);
  }
  return out;
}

function movedPiece(id: string, to: Fact, from: Fact, ms: number): Piece {
  const key = to.aKey!;
  return {
    item: {
      id,
      kind: 'moved',
      at: new Date(ms).toISOString(),
      dayOnly: to.source === 'backfill',
      source: to.source,
      entryId: to.entry_id,
      fromEntryId: from.entry_id,
      card: summaryOf(to.after, key),
    },
    ms,
    seq: Math.max(to.id, from.id),
    key,
  };
}

/**
 * Classifica os fatos crus (qualquer ordem) em itens, do mais recente para o mais antigo. Movida e troca de lugar
 * são pareadas fato a fato, antes de juntar os momentos de cada bolso: assim um mover seguido de outra ação no mesmo
 * bolso (pôr outra carta na origem, trocar a versão no destino) continua sendo uma movida, também quando os dois
 * sobem juntos num UPDATE (sem internet).
 */
export function classifyEntryEvents(rows: EntryEventRow[]): ActivityItem[] {
  const facts: Fact[] = rows
    .map((r) => {
      const atMs = timeOf(r.at);
      return {
        ...r,
        atMs,
        doneMs: timeOf(r.happened_at) || atMs,
        bKey: keyOf(r.before_key, r.before),
        aKey: keyOf(r.after_key, r.after),
        txKey: r.tx == null ? null : String(r.tx),
      };
    })
    .sort((a, b) => a.atMs - b.atMs || a.id - b.id);
  const byEntry = new Map<string, Fact[]>();
  for (const f of facts) {
    const list = byEntry.get(f.entry_id);
    if (list) list.push(f);
    else byEntry.set(f.entry_id, [f]);
  }

  const paired = new Set<Fact>();
  const movePairs: Pair<Fact>[] = [];
  const swapPairs: Pair<Fact>[] = [];
  /** Movida com um lado em UPDATE (halfCandidates): `a` só pela carta que saiu, `b` só pela que entrou. */
  const halfPairs: Pair<Fact>[] = [];
  /**
   * Lados já usados de cada UPDATE numa metade. O UPDATE não entra em `paired`: o mesmo bolso pode ser o destino de
   * uma movida e a origem de outra (sem internet: X de b para c, depois K de a para b).
   */
  const halfUsed = new Map<Fact, Set<'out' | 'in'>>();
  const rank = (f: Fact) => f.id;
  const pass = (free: (f: Fact) => boolean, exact: boolean) => {
    const ok = (f: Fact) => !paired.has(f) && !halfUsed.has(f) && free(f);
    movePairs.push(...pairUp(moveCandidates(facts, ok, exact ? 0 : GROUP_MS), paired, rank));
    swapPairs.push(...pairUp(swapCandidates(facts, ok, exact), paired, rank));
    const halfOk = (f: Fact) => !paired.has(f) && free(f) && (f.kind !== 'replaced' || (halfUsed.get(f)?.size ?? 0) < 2);
    const halfList = halfCandidates(facts, halfOk, exact);
    halfList.sort((x, y) => x.cost - y.cost || rank(x.a) - rank(y.a) || rank(x.b) - rank(y.b));
    for (const c of halfList) {
      const update = c.a.kind === 'replaced' ? c.a : c.b;
      const other = update === c.a ? c.b : c.a;
      const side = update === c.a ? 'out' : 'in';
      const used = halfUsed.get(update) ?? new Set<'out' | 'in'>();
      if (paired.has(other) || paired.has(update) || used.has(side)) continue;
      paired.add(other);
      used.add(side);
      halfUsed.set(update, used);
      halfPairs.push(c);
    }
  };

  // 2 e 3, primeiro a assinatura exata do mover do app: a mesma hora nos dois bolsos (troca de lugar: o mesmo envio).
  // Vale também dentro de um lote: sem internet, mais de 20 movidas sobem num envio só.
  pass(() => true, true);

  // Lote (regra 4): as cartas que sobraram num envio com mais de 20 não pareiam com folga de hora.
  const addedPerTx = new Map<string, number>();
  for (const f of facts) {
    if (f.kind === 'added' && f.txKey != null && !paired.has(f)) addedPerTx.set(f.txKey, (addedPerTx.get(f.txKey) ?? 0) + 1);
  }
  const inBatch = (f: Fact) => f.kind === 'added' && f.txKey != null && (addedPerTx.get(f.txKey) ?? 0) > BULK_OVER;

  // "Desfazer" logo em seguida no mesmo bolso (A→B e depois B→A) fica para a regra 1, que anula os dois; senão
  // "adicionou e desfez" num bolso viraria a outra metade de uma movida.
  const undone = new Set<Fact>();
  for (const list of byEntry.values()) {
    for (let k = 0; k + 1 < list.length; k++) {
      const f = list[k];
      const g = list[k + 1];
      if (paired.has(f) || paired.has(g) || halfUsed.has(f) || halfUsed.has(g)) continue;
      if (!sameMoment(f, g) || g.bKey !== f.aKey || g.aKey !== f.bKey) continue;
      undone.add(f);
      undone.add(g);
      k++;
    }
  }

  // Depois, até 10 min entre os dois fatos.
  pass((f) => !undone.has(f) && !inBatch(f), false);

  const moves: Piece[] = [];
  for (const { a: from, b: to } of movePairs) moves.push(movedPiece(`m${from.id}-${to.id}`, to, from, Math.max(from.doneMs, to.doneMs)));
  for (const { a, b } of swapPairs) {
    moves.push(movedPiece(`s${a.id}-${b.id}`, a, b, a.doneMs));
    moves.push(movedPiece(`s${b.id}-${a.id}`, b, a, b.doneMs));
  }
  // Metade de um UPDATE: a hora do mover é a do outro lado (a do UPDATE pode ser a da outra ação, como pôr Y em a).
  // 'both': o UPDATE é o destino de uma movida e a origem de outra; não sobra carta nele.
  const halves = new Map<Fact, 'out' | 'in' | 'both'>();
  for (const { a: from, b: to } of halfPairs) {
    const update = from.kind === 'replaced' ? from : to;
    const side = update === from ? 'out' : 'in';
    halves.set(update, halves.has(update) && halves.get(update) !== side ? 'both' : side);
    moves.push(movedPiece(`h${from.id}-${to.id}`, to, from, (update === from ? to : from).doneMs));
  }

  // Desfazer do mover: a mesma carta foi de a para b e voltou de b para a, até 10 min depois; as duas somem.
  const back: Pair<Piece>[] = [];
  for (let i = 0; i < moves.length; i++) {
    for (let j = i + 1; j < moves.length; j++) {
      const x = moves[i];
      const y = moves[j];
      const gap = Math.abs(x.ms - y.ms);
      if (x.key !== y.key || x.item.source !== y.item.source || gap > GROUP_MS) continue;
      if (x.item.entryId === y.item.fromEntryId && x.item.fromEntryId === y.item.entryId) back.push({ a: x, b: y, cost: gap });
    }
  }
  const cancelled = new Set<Piece>();
  pairUp(back, cancelled, (p) => p.seq);

  // 1. Momentos de cada bolso com os fatos que sobraram; um fato pareado fecha o momento aberto daquele bolso.
  const groups: Fact[][] = [];
  const open = new Map<string, Fact[]>();
  const join = (f: Fact) => {
    const g = open.get(f.entry_id);
    const prev = g?.[g.length - 1];
    if (g && prev && sameMoment(prev, f)) g.push(f);
    else {
      const fresh = [f];
      groups.push(fresh);
      open.set(f.entry_id, fresh);
    }
  };
  for (const f of facts) {
    const half = halves.get(f);
    if (half === 'both') open.delete(f.entry_id);
    else if (half === 'in') {
      // A carta que entrou foi movida: a que saiu (X) fica no momento aberto, como removida; depois o momento fecha.
      join({ ...f, after: null, aKey: null });
      open.delete(f.entry_id);
    } else if (half === 'out') {
      // A carta que saiu foi movida: fecha o momento, e a que entrou (Y) começa outro, como adicionada.
      open.delete(f.entry_id);
      join({ ...f, before: null, bKey: null });
    } else if (paired.has(f)) open.delete(f.entry_id);
    else join(f);
  }
  const pieces = groups.map(pieceOf).filter((p): p is Piece => !!p);

  // 4. Lote: mais de 20 cartas adicionadas no mesmo envio (o do INSERT) viram um item só.
  const inBulk = new Set<Piece>();
  const bulks: Piece[] = [];
  const byTx = new Map<string, Piece[]>();
  for (const p of pieces) {
    if (!p.batch) continue;
    const same = byTx.get(p.batch.tx);
    if (same) same.push(p);
    else byTx.set(p.batch.tx, [p]);
  }
  for (const [tx, list] of byTx) {
    if (list.length <= BULK_OVER) continue;
    list.sort((x, y) => x.batch!.seq - y.batch!.seq);
    for (const p of list) inBulk.add(p);
    const first = list[0];
    // Hora do lote: o último INSERT (a troca de versão de uma carta logo depois não traz o lote para agora).
    const ms = Math.max(...list.map((p) => p.batch!.ms));
    bulks.push({
      item: {
        id: `b${tx}`,
        kind: 'bulk',
        at: new Date(ms).toISOString(),
        dayOnly: first.item.dayOnly,
        source: first.item.source,
        entryId: first.item.entryId,
        card: first.item.card,
        count: list.length,
        cards: list.slice(0, BULK_EXAMPLES).map((p) => p.item.card),
      },
      ms,
      seq: Math.max(...list.map((p) => p.seq)),
    });
  }

  // 5. Do mais recente para o mais antigo (empate: o fato mais novo primeiro).
  return [...pieces.filter((p) => !inBulk.has(p)), ...moves.filter((p) => !cancelled.has(p)), ...bulks]
    .sort((x, y) => y.ms - x.ms || y.seq - x.seq || (x.item.id < y.item.id ? -1 : x.item.id > y.item.id ? 1 : 0))
    .map((p) => p.item);
}

/** Contagem por tipo; o lote conta como adicionadas (quantas cartas entraram). */
export function activityCounts(items: ActivityItem[]): Record<Exclude<ActivityKind, 'bulk'>, number> {
  const out = { added: 0, replaced: 0, moved: 0, removed: 0 };
  for (const i of items) {
    if (i.kind === 'bulk') out.added += i.count ?? 0;
    else out[i.kind]++;
  }
  return out;
}

const inPokedex = (s: CardSummary | undefined) => !!s && (!s.binderId || s.binderId === POKEDEX_BINDER);

/** Troca no fichário Pokédex: replaced com before e after sem binderId. */
export function isPokedexSwap(item: ActivityItem): boolean {
  return item.kind === 'replaced' && inPokedex(item.prev) && inPokedex(item.card);
}

/** A carta do item ainda está no bolso (mesma chave)? Devolve a Entry atual para abrir a tela da carta. */
export function currentEntryOf(item: ActivityItem, entries: Record<string, Entry>): Entry | undefined {
  const e = entries[item.entryId];
  return e && entryKey(e) === entryKey(item.card) ? e : undefined;
}

// ===== Leitura =====

export type ActivityResult =
  | { state: 'ok'; items: ActivityItem[]; since: string }
  /** Sem nuvem configurada ou sem sessão. */
  | { state: 'signedOut' }
  /** Tabela ainda não existe (isMissingInServer). */
  | { state: 'notMigrated' };

const COLUMNS = 'id, entry_id, op, kind, changed, before, after, before_key, after_key, at, happened_at, tx, source';
const CACHE_MS = 2 * 60_000;
const memo = new Map<string, { at: number; data: ActivityResult }>();
const running = new Map<string, Promise<ActivityResult>>();
/** Muda a cada clearActivityCache: resposta de uma leitura anterior não entra no cache. */
let generation = 0;

async function readActivity(sb: NonNullable<typeof supabase>, user: string, days: number): Promise<ActivityResult> {
  const sinceMs = Date.now() - days * DAY_MS;
  // 10 min antes do início, para os momentos que começam um pouco antes ficarem inteiros.
  const from = new Date(sinceMs - GROUP_MS).toISOString();
  let rows: EntryEventRow[];
  try {
    rows = await fetchAllPages<EntryEventRow>((a, b) =>
      sb.from('entry_events').select(COLUMNS).eq('user_id', user).gte('at', from).order('id', { ascending: true }).range(a, b),
    );
  } catch (err) {
    if (isMissingInServer(err)) return { state: 'notMigrated' };
    throw err;
  }
  // Importação ou carta ressuscitada chega com a data antiga (happened_at) e fica fora do período.
  const items = classifyEntryEvents(rows).filter((i) => timeOf(i.at) >= sinceMs);
  return { state: 'ok', items, since: new Date(sinceMs).toISOString() };
}

/**
 * Lê entry_events dos últimos `days` dias (happened_at >= agora - days, com 10 min de folga em `at` para agrupar),
 * em páginas, sem cache persistente; cache em memória de 2 min por usuário e período (`force` ignora). Erro de rede
 * ou outro: lança (a tela mostra describeSyncError / errorText).
 */
export async function loadActivity(opts: { days: number; force?: boolean }): Promise<ActivityResult> {
  if (!supabase) return { state: 'signedOut' };
  const sb = supabase;
  const { data } = await sb.auth.getSession();
  const user = data.session?.user.id;
  if (!user) return { state: 'signedOut' };
  const key = `${user}:${opts.days}`;
  const hit = memo.get(key);
  if (!opts.force && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const pending = running.get(key);
  if (pending) return pending;
  const gen = generation;
  const p = readActivity(sb, user, opts.days)
    .then((res) => {
      if (gen === generation) memo.set(key, { at: Date.now(), data: res });
      return res;
    })
    .finally(() => {
      if (running.get(key) === p) running.delete(key);
    });
  running.set(key, p);
  return p;
}

/** Esquece o registro guardado na memória (ao sair da conta, junto do clearHistoryCache). */
export function clearActivityCache(): void {
  memo.clear();
  running.clear();
  generation++;
}
