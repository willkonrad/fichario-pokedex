import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { plainName } from '@/lib/catalog';
import { numberKey, numberKeys, numberLeft, parseHeader, parseRow, sectionTable } from '@/lib/lookup-format';
import { clearStoredBody, readStoredBody, storedMd5, writeStoredBody } from '@/lib/lookup-store';
import { LOOKUP_FORMAT, type LookupCard, type LookupHeader } from '@/lib/lookup-types';
import { isNetworkError, supabase } from '@/lib/supabase';

/**
 * Índice da Consulta: um texto único baixado da tabela lookup_index, guardado no aparelho e lido por seção. Fica na
 * memória só depois que a Consulta (ou o leitor de cartas) pede.
 */

export type LookupStatus = 'idle' | 'downloading' | 'loading' | 'ready' | 'noIndex' | 'noNetwork';
/**
 * Por que ficou sem índice: 'format' é um arquivo que este app não sabe ler (só atualizando o app); 'server', o servidor
 * sem o índice ou com erro passageiro (500, 503…), que vale tentar de novo.
 */
export type LookupProblem = 'format' | 'server';

/** Espécies já lidas, além da seção 0, que não sai da memória. */
const SECTION_CACHE = 40;

type Loaded = {
  md5: string;
  body: string;
  header: LookupHeader;
  sections: Map<number, { start: number; end: number }>;
  counts?: Map<number, number>;
  numbers?: NumberMaps;
  /** Mapas de número pela metade: a montagem em fatias para aqui e continua daqui. */
  numberBuild?: NumberBuild;
  trainers?: Trainers;
  trainerBuild?: TrainerBuild;
};
/** Linhas por chave, em pares [posição, seção]. */
type NumberMaps = { byNumber: Map<string, number[]>; byCode: Map<string, number[]> };
/** Seção e posição da próxima linha; `memo` guarda as chaves de cada par de números já visto. */
type NumberBuild = NumberMaps & { ranges: [number, { start: number; end: number }][]; section: number; at: number; memo: Map<string, string[]> };
/** Treinadores e energias (seção 0), com o nome sem acento para a busca por palavras. */
type Trainers = { cards: LookupCard[]; plain: string[] };
type TrainerBuild = Trainers & { at: number; end: number };
type Snapshot = { status: LookupStatus; header: LookupHeader | null; problem: LookupProblem | null };

let snapshot: Snapshot = { status: 'idle', header: null, problem: null };
let loaded: Loaded | null = null;
let focused = false;
let newOnDisk = false;
let loading: Promise<void> | null = null;
let warming: Promise<void> | null = null;
/** Como cancelar a próxima fatia da montagem dos mapas (ver buildInSlices). */
let cancelSlice: (() => void) | null = null;
const parsed = new Map<number, LookupCard[]>();
/** Última busca de treinador: a leitura do campo e a grade pedem a mesma, a cada tecla. */
let lastTrainers: { text: string; cards: LookupCard[] } | null = null;

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const getSnapshot = () => snapshot;

function setStatus(status: LookupStatus, header: LookupHeader | null = snapshot.header, problem: LookupProblem | null = null) {
  if (snapshot.status === status && snapshot.header === header && snapshot.problem === problem) return;
  snapshot = { status, header, problem };
  listeners.forEach((fn) => fn());
}

const noIndex = (problem: LookupProblem) => setStatus('noIndex', snapshot.header, problem);

/** Situação do índice, para a tela. `problem` só vem com 'noIndex'. */
export function useLookupIndex(): { status: LookupStatus; header: LookupHeader | null; problem: LookupProblem | null } {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Cabeçalho do índice na memória (fora de componentes). */
export const lookupHeader = () => loaded?.header ?? null;

/** Põe o texto na memória; false se o arquivo não presta ou é de um formato que este app não conhece. */
function install(md5: string, body: string): boolean {
  const eol = body.indexOf('\n');
  let header: LookupHeader;
  try {
    header = parseHeader(eol < 0 ? body : body.slice(0, eol));
  } catch {
    return false;
  }
  if (header.v > LOOKUP_FORMAT) return false;
  const sections = sectionTable(body);
  if (!sections.size) return false;
  loaded = { md5, body, header, sections };
  parsed.clear();
  lastTrainers = null;
  newOnDisk = false;
  buildInSlices(loaded);
  setStatus('ready', header);
  return true;
}

type IndexRow = { md5: string; format: number; body?: string };

async function indexRow(columns: string): Promise<IndexRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('lookup_index').select(columns).eq('id', 1).maybeSingle();
  if (error) throw error;
  return (data as unknown as IndexRow | null) ?? null;
}

const readManifest = () => indexRow('md5, format');
const downloadBody = () => indexRow('md5, format, body');

/** Primeira vez neste aparelho (ou cópia velha na web): baixa com a tela esperando. `known`: manifesto já lido. */
async function firstDownload(known?: IndexRow | null) {
  setStatus('downloading');
  try {
    const manifest = known === undefined ? await readManifest() : known;
    if (!manifest) return noIndex('server');
    if (manifest.format > LOOKUP_FORMAT) return noIndex('format');
    const row = await downloadBody();
    if (!row?.body) return noIndex('server');
    if (row.format > LOOKUP_FORMAT) return noIndex('format');
    // Disco cheio não impede de usar o índice nesta sessão.
    await writeStoredBody(row.md5, row.body).catch(() => {});
    if (!install(row.md5, row.body)) noIndex('format');
  } catch (err) {
    if (isNetworkError(err)) setStatus('noNetwork');
    else noIndex('server');
  }
}

/** Lê o arquivo guardado; arquivo que não presta é apagado. */
async function installStored(): Promise<boolean> {
  const stored = await readStoredBody().catch(() => null);
  if (!stored) return false;
  if (install(stored.md5, stored.body)) return true;
  await clearStoredBody().catch(() => {});
  return false;
}

/**
 * Web: o navegador guarda o índice, mas nada o renova em segundo plano. A cópia só vale se for a do manifesto; sem
 * rede (ou sem índice legível no servidor), vale a que tiver.
 */
async function loadChecked() {
  let manifest: IndexRow | null;
  try {
    manifest = await readManifest();
  } catch (err) {
    if (await installStored()) return;
    if (isNetworkError(err)) return setStatus('noNetwork');
    return noIndex('server');
  }
  if (manifest && manifest.format <= LOOKUP_FORMAT) {
    if ((await storedMd5().catch(() => null)) === manifest.md5 && (await installStored())) return;
  } else if (await installStored()) {
    return;
  }
  await firstDownload(manifest);
}

async function loadFromStoreOrNetwork() {
  // Só o aquecimento que já rodava antes desta leitura: um que comece durante ela espera por ela, e os dois travariam.
  const earlier = warming;
  setStatus('loading');
  if (Platform.OS === 'web') return loadChecked();
  if (await installStored()) return;
  // Sem arquivo guardado, o aquecimento pode já estar baixando: espera e aproveita, em vez de baixar duas vezes.
  if (earlier) {
    setStatus('downloading');
    await earlier;
    if (await installStored()) return;
  }
  await firstDownload();
}

/** Lê para a memória; sem arquivo guardado, baixa. Na web, confere antes se a cópia guardada é a do servidor. */
export function ensureLookupLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  loading ??= loadFromStoreOrNetwork().finally(() => {
    loading = null;
  });
  return loading;
}

async function swapFromDisk() {
  const stored = await readStoredBody().catch(() => null);
  if (stored && stored.md5 !== loaded?.md5) install(stored.md5, stored.body);
  newOnDisk = false;
}

async function warm() {
  await loading;
  try {
    const manifest = await readManifest();
    if (!manifest || manifest.format > LOOKUP_FORMAT) return;
    if ((await storedMd5()) === manifest.md5) return;
    const row = await downloadBody();
    if (!row?.body || row.format > LOOKUP_FORMAT) return;
    await writeStoredBody(row.md5, row.body);
    if (!loaded) {
      // A tela está esperando depois de uma falha: já pode usar.
      if (snapshot.status === 'noNetwork' || snapshot.status === 'noIndex') install(row.md5, row.body);
      return;
    }
    if (loaded.md5 === row.md5) return;
    if (focused) newOnDisk = true;
    else await swapFromDisk();
  } catch {
    // Sem rede ou erro do servidor: continua com o que tem no aparelho.
  }
}

/** Só disco: confere o manifesto e baixa se mudou. Na web, quem baixa é a tela. */
export function warmLookup(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  warming ??= warm().finally(() => {
    warming = null;
  });
  return warming;
}

/** Com foco, índice novo fica no disco: a lista não muda na mão de quem está olhando; entra na saída da tela. */
export function setLookupFocused(value: boolean): void {
  focused = value;
  if (!value && newOnDisk) void swapFromDisk();
}

function parseSection(idx: Loaded, dex: number): LookupCard[] {
  const range = idx.sections.get(dex);
  if (!range || range.end <= range.start) return [];
  const out: LookupCard[] = [];
  for (const line of idx.body.slice(range.start, range.end).split('\n')) if (line) out.push(parseRow(line, dex, idx.header));
  return out;
}

/** Cartas de uma seção, na ordem do arquivo. A lista é compartilhada: não altere. */
export function sectionCards(dex: number): LookupCard[] {
  if (!loaded) return [];
  if (dex === 0) return trainerIndex(loaded).cards;
  const hit = parsed.get(dex);
  if (hit) {
    parsed.delete(dex);
    parsed.set(dex, hit);
    return hit;
  }
  const cards = parseSection(loaded, dex);
  parsed.set(dex, cards);
  if (parsed.size > SECTION_CACHE) parsed.delete(parsed.keys().next().value as number);
  return cards;
}

function startTrainers(idx: Loaded): TrainerBuild {
  const range = idx.sections.get(0);
  const [at, end] = range && range.end > range.start ? [range.start, range.end] : [0, 0];
  return { cards: [], plain: [], at, end };
}

/** Lê as linhas de treinador que faltam enquanto `more()` deixar; true quando chegou ao fim da seção. */
function addTrainerRows(idx: Loaded, b: TrainerBuild, more: () => boolean): boolean {
  while (b.at < b.end) {
    if (!more()) return false;
    let eol = idx.body.indexOf('\n', b.at);
    if (eol < 0 || eol > b.end) eol = b.end;
    if (eol > b.at) {
      const card = parseRow(idx.body.slice(b.at, eol), 0, idx.header);
      b.cards.push(card);
      b.plain.push(plainName(`${card.name} ${card.ptName ?? ''}`));
    }
    b.at = eol + 1;
  }
  return true;
}

function finishTrainers(idx: Loaded, b: TrainerBuild): Trainers {
  idx.trainerBuild = undefined;
  idx.trainers = { cards: b.cards, plain: b.plain };
  return idx.trainers;
}

/** Seção 0 lida. Montada em fatias depois de abrir; quem precisa antes do fim completa o resto na hora. */
function trainerIndex(idx: Loaded): Trainers {
  if (idx.trainers) return idx.trainers;
  const b = (idx.trainerBuild ??= startTrainers(idx));
  addTrainerRows(idx, b, unlimited);
  return finishTrainers(idx, b);
}

/**
 * Treinadores e energias com todas as palavras no nome (em inglês ou português; chinês, o texto inteiro). A lista é
 * compartilhada: não altere.
 */
export function searchTrainers(text: string): LookupCard[] {
  if (!loaded) return [];
  if (lastTrainers?.text === text) return lastTrainers.cards;
  const { cards, plain } = trainerIndex(loaded);
  const words = plainName(text).split(' ').filter(Boolean);
  const raw = text.trim();
  let found: LookupCard[] = [];
  if (words.length) found = cards.filter((_, i) => words.every((w) => plain[i].includes(w)));
  else if (raw) found = cards.filter((c) => c.name.includes(raw));
  lastTrainers = { text, cards: found };
  return found;
}

/** Quantas cartas a seção tem, sem ler as linhas (faixa de sugestões). */
export function sectionCount(dex: number): number {
  if (!loaded) return 0;
  if (!loaded.counts) {
    const counts = new Map<number, number>();
    for (const [d, { start, end }] of loaded.sections) {
      let total = 0;
      for (let at = start; at < end; ) {
        const eol = loaded.body.indexOf('\n', at);
        if (eol < 0 || eol >= end) {
          total += 1;
          break;
        }
        if (eol > at) total += 1;
        at = eol + 1;
      }
      counts.set(d, total);
    }
    loaded.counts = counts;
  }
  return loaded.counts.get(dex) ?? 0;
}

const pushLine = (map: Map<string, number[]>, key: string, at: number, dex: number) => {
  const list = map.get(key);
  if (list) list.push(at, dex);
  else map.set(key, [at, dex]);
};

/** Uma linha nos mapas de número e de sigla + número. */
function addNumberRow(b: NumberBuild, header: LookupHeader, line: string, at: number, dex: number) {
  const c = line.split('\t');
  const number = c[3] ?? '';
  const altNumber = c[4] ?? '';
  if (!number && !altNumber) return;
  const raw = `${number}\t${altNumber}`;
  let keys = b.memo.get(raw);
  if (!keys) {
    keys = numberKeys({ number, altNumber });
    b.memo.set(raw, keys);
  }
  for (const key of keys) {
    pushLine(b.byNumber, key, at, dex);
    // "TG05" sem o total acha "TG05/TG30". Só com letras: um número puro sozinho seriam milhares de cartas.
    const left = numberLeft(key);
    if (left !== key && /[a-z]/.test(left)) pushLine(b.byNumber, left, at, dex);
  }
  const set = header.sets.get(c[1]);
  const abbrs = set?.abbr ? [set.abbr.toLowerCase()] : [];
  // A sigla oficial (TCGdex) só vale para as coleções internacionais: os ids da TCGdex japonesa repetem os ingleses.
  const td = c[11];
  if (td && (set?.lang === 'en' || set?.lang === 'pt')) {
    const official = header.tdAbbr.get(td.slice(0, td.lastIndexOf('-')))?.toLowerCase();
    if (official && !abbrs.includes(official)) abbrs.push(official);
  }
  for (const left of new Set(keys.map(numberLeft))) for (const abbr of abbrs) pushLine(b.byCode, `${abbr}|${left}`, at, dex);
}

function startNumbers(idx: Loaded): NumberBuild {
  const ranges = [...idx.sections];
  return { byNumber: new Map(), byCode: new Map(), memo: new Map(), ranges, section: 0, at: ranges[0]?.[1].start ?? 0 };
}

/** Lê as linhas que faltam, na ordem do arquivo, enquanto `more()` deixar; true quando passou por todas as seções. */
function addNumberRows(idx: Loaded, b: NumberBuild, more: () => boolean): boolean {
  while (b.section < b.ranges.length) {
    const [dex, { end }] = b.ranges[b.section];
    if (b.at >= end) {
      b.section += 1;
      if (b.section < b.ranges.length) b.at = b.ranges[b.section][1].start;
      continue;
    }
    if (!more()) return false;
    let eol = idx.body.indexOf('\n', b.at);
    if (eol < 0 || eol > end) eol = end;
    addNumberRow(b, idx.header, idx.body.slice(b.at, eol), b.at, dex);
    b.at = eol + 1;
  }
  return true;
}

function finishNumbers(idx: Loaded, b: NumberBuild): NumberMaps {
  idx.numberBuild = undefined;
  idx.numbers = { byNumber: b.byNumber, byCode: b.byCode };
  return idx.numbers;
}

/** Mapas de número e de sigla + número. Montados em fatias depois de abrir; quem precisa antes do fim completa o resto na hora. */
function numberMaps(idx: Loaded): NumberMaps {
  if (idx.numbers) return idx.numbers;
  const b = (idx.numberBuild ??= startNumbers(idx));
  addNumberRows(idx, b, unlimited);
  return finishNumbers(idx, b);
}

/** Prazo que o agendador dá à fatia (requestIdleCallback). No app, timeRemaining() vai a 0 quando chega uma tecla ou um evento. */
type IdleDeadline = { didTimeout?: boolean; timeRemaining: () => number };
type IdleScheduler = (run: (deadline: IdleDeadline) => void, options?: { timeout: number }) => unknown;

/** Quanto uma fatia segura o JS no máximo, quantas linhas lê no máximo e de quantas em quantas olha o relógio. */
const SLICE_MS = 8;
const SLICE_ROWS = 2000;
const CLOCK_EVERY = 32;
/** Sem folga (a pessoa digitando sem parar), a fatia roda assim mesmo depois disso. */
const IDLE_TIMEOUT_MS = 500;

const unlimited = () => true;

/** Uma fatia: true enquanto dá para ler mais uma linha sem segurar a tela. Lê pelo menos CLOCK_EVERY linhas. */
function sliceBudget(deadline?: IdleDeadline): () => boolean {
  const until = Date.now() + SLICE_MS;
  // Na web, uma fatia que estourou o timeout tem timeRemaining() 0: aí vale só o relógio daqui.
  const device = deadline && !deadline.didTimeout ? deadline : null;
  let rows = 0;
  return () => {
    rows += 1;
    if (rows > SLICE_ROWS) return false;
    if (rows % CLOCK_EVERY) return true;
    return Date.now() < until && (!device || device.timeRemaining() > 0);
  };
}

type IdleGlobal = { requestIdleCallback?: IdleScheduler; cancelIdleCallback?: (handle: unknown) => void };

/** Na próxima folga do aparelho; sem requestIdleCallback (Safari, testes), no próximo setTimeout. Devolve como cancelar. */
function later(run: (deadline?: IdleDeadline) => void): () => void {
  const g = globalThis as IdleGlobal;
  try {
    if (typeof g.requestIdleCallback === 'function') {
      const handle = g.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      return () => g.cancelIdleCallback?.(handle);
    }
  } catch {
    // Agendador sem tarefas de folga: cai no setTimeout.
  }
  const timer = setTimeout(run, 0);
  return () => clearTimeout(timer);
}

/** Cancela a fatia agendada: ela seguraria na memória o índice que saiu até rodar. */
function stopSlices() {
  cancelSlice?.();
  cancelSlice = null;
}

/**
 * Logo depois de abrir: monta os mapas de número e depois os treinadores em fatias pequenas, para a primeira busca por
 * número, sigla ou treinador (e a primeira leitura da câmera) não parar a tela na tecla. Para se o índice trocar.
 */
function buildInSlices(idx: Loaded) {
  const slice = (deadline?: IdleDeadline) => {
    cancelSlice = null;
    if (loaded !== idx) return;
    const more = sliceBudget(deadline);
    if (!idx.numbers) {
      const b = (idx.numberBuild ??= startNumbers(idx));
      if (addNumberRows(idx, b, more)) finishNumbers(idx, b);
    } else if (!idx.trainers) {
      const b = (idx.trainerBuild ??= startTrainers(idx));
      if (addTrainerRows(idx, b, more)) finishTrainers(idx, b);
    }
    if (!idx.numbers || !idx.trainers) cancelSlice = later(slice);
  };
  stopSlices();
  cancelSlice = later(slice);
}

function cardsAt(idx: Loaded, pairs: number[] | undefined): LookupCard[] {
  if (!pairs) return [];
  const out = new Map<string, LookupCard>();
  for (let i = 0; i < pairs.length; i += 2) {
    const at = pairs[i];
    const eol = idx.body.indexOf('\n', at);
    const card = parseRow(idx.body.slice(at, eol < 0 ? undefined : eol), pairs[i + 1], idx.header);
    if (!out.has(card.key)) out.set(card.key, card);
  }
  return [...out.values()];
}

/** Em todas as cartas, pela chave normalizada ("70/108"). */
export function lookupByNumber(key: string): LookupCard[] {
  if (!loaded) return [];
  const normal = numberKey(key);
  return normal ? cardsAt(loaded, numberMaps(loaded).byNumber.get(normal)) : [];
}

/** Sigla da coleção (da TCGplayer ou a oficial) + número, com ou sem o total. Aceita também o id da coleção na TCGdex. */
export function lookupByCode(abbr: string, key: string): LookupCard[] {
  if (!loaded) return [];
  const normal = numberKey(key);
  if (!normal) return [];
  const left = numberLeft(normal);
  const code = abbr.split(':')[0].trim().toLowerCase();
  const { byCode, byNumber } = numberMaps(loaded);
  let hits = byCode.get(`${code}|${left}`);
  if (!hits) {
    for (const [id, official] of loaded.header.tdAbbr) {
      if (id.toLowerCase() === code) {
        hits = byCode.get(`${official.toLowerCase()}|${left}`);
        break;
      }
    }
  }
  // "TG05", "SWSH248": as letras não são a sigla, fazem parte do número.
  hits ??= byNumber.get(`${code}${left}`);
  return cardsAt(loaded, hits);
}

function sectionOfOffset(idx: Loaded, at: number): number | null {
  for (const [dex, { start, end }] of idx.sections) if (at >= start && at <= end) return dex;
  return null;
}

/** Uma carta pela coluna id. Com `hintDex`, procura primeiro nessa seção. */
export function cardByKey(key: string, hintDex?: number): LookupCard | null {
  if (!loaded) return null;
  if (hintDex != null) {
    const hit = sectionCards(hintDex).find((c) => c.key === key);
    if (hit) return hit;
  }
  const at = loaded.body.indexOf(`\n${key}\t`);
  if (at < 0) return null;
  const dex = sectionOfOffset(loaded, at + 1);
  return dex == null ? null : (sectionCards(dex).find((c) => c.key === key) ?? null);
}

/** "Recarregar catálogo e imagens": apaga o disco e a memória. */
export async function clearLookup(): Promise<void> {
  stopSlices();
  loaded = null;
  newOnDisk = false;
  parsed.clear();
  lastTrainers = null;
  setStatus('idle', null);
  await clearStoredBody().catch(() => {});
}
