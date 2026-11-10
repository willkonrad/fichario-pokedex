import { Directory, File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';

import { TOTAL_SPECIES } from '@/data/pokedex';
import {
  BINDER_PURPOSES,
  CONDITIONS,
  DEFAULT_CUSTOM_BINDER,
  DEFAULT_SETTINGS,
  LANG_LABEL,
  ORIGINS,
  POKEDEX_BINDER,
  VARIANTS,
  type BinderSettings,
  type CardLang,
  type Condition,
  type CustomBinder,
  type Entry,
  type Variant,
} from '@/lib/types';

import { MAX_COLS, MAX_PAGES, MAX_ROWS, MAX_SLOTS_PER_POKEMON } from './binder';
import { MYP_URL, storeUrl, TCGPLAYER_URL } from './copy';
import { upgradeEntry } from './entry-upgrade';
import { cardNumber } from './lists';

/** Formato do arquivo da cópia (sobe quando mudar de um jeito que versões antigas do app não saibam ler). */
export const BACKUP_VERSION = 1;
const APP_TAG = 'fichario-pokedex';

/**
 * Campos gravados por versões antigas, de fontes que saíram (vendas do "Quanto vale minha carta?", Liga pela Apify,
 * pokemontcg.io). O `ligaQuery` fica: é a busca exata do link "Ver na Liga".
 */
export const LEGACY_ENTRY_FIELDS = [
  'myp',
  'sold',
  'intl',
  'price',
  'ligaImage',
  'ligaFinishes',
  'ligaUrl',
  'ligaCheckedAt',
  'ligaMismatch',
  'ligaNotFound',
  'ptcgId',
] as const;

/** Tira os campos antigos da carta; devolve o mesmo objeto quando não há nada para tirar. */
export function stripLegacyFields<T extends object>(e: T): T {
  if (!LEGACY_ENTRY_FIELDS.some((k) => k in e)) return e;
  const out = { ...e } as unknown as Record<string, unknown>;
  for (const k of LEGACY_ENTRY_FIELDS) delete out[k];
  return out as T;
}

/** Cópia da coleção em JSON. */
export type CollectionBackup = {
  app: typeof APP_TAG;
  version: number;
  exportedAt: string;
  /** Com os preços do MYP e da TCGplayer. Sem eles (o padrão), o app busca de novo depois de importar. */
  withPrices: boolean;
  settings: BinderSettings | null;
  entries: Entry[];
};

const byPosition = (a: Entry, b: Entry) =>
  (a.binderId ?? '').localeCompare(b.binderId ?? '') || a.dex - b.dex || a.slot - b.slot;

/**
 * Monta a cópia da coleção. Por padrão sai sem os preços do MYP e da TCGplayer (os dados das fontes não são
 * redistribuídos; o app busca de novo), mas com tudo o que é do colecionador: carta, versão, estado, "Meu valor",
 * origem, valor pago e observações.
 */
export function buildBackup(
  settings: BinderSettings | null,
  entries: Entry[],
  opts: { withPrices?: boolean } = {},
): CollectionBackup {
  const withPrices = !!opts.withPrices;
  const list = entries
    .map((e) => {
      const clean = stripLegacyFields(e);
      if (withPrices) return clean;
      const { mypApi: _m, tcgplayer: _t, myValueReplaced: _r, ...rest } = clean;
      return rest as Entry;
    })
    .sort(byPosition);
  return { app: APP_TAG, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), withPrices, settings, entries: list };
}

/** Resultado da leitura de uma cópia: cartas válidas e quantas foram ignoradas por estarem incompletas. */
export type ParsedBackup = {
  settings: BinderSettings | null;
  entries: Entry[];
  invalid: number;
  exportedAt?: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const LANGS: CardLang[] = ['pt', 'en', 'ja'];
const VARIANT_IDS = new Set<string>(VARIANTS.map((v) => v.id));
const CONDITION_IDS = new Set<string>(CONDITIONS.map((c) => c.id));
const ORIGIN_IDS = new Set<string>(ORIGINS.map((o) => o.id));
const VALUE_BASES = new Set(['min', 'avg', 'max']);
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** Data no formato do app (ISO com milissegundos), para as comparações da sincronização; '' se não for data. */
const isoDate = (v: unknown) => {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
};
const isPrice = (v: unknown) =>
  isObject(v) && typeof v.cardId === 'string' && typeof v.variant === 'string' && !!isoDate(v.checkedAt);

/**
 * Teto da posição da carta: Pokémon até o último da Pokédex (0 = não é Pokémon, no fichário livre) e bolso até o último
 * do maior fichário livre (500 páginas de 8 × 6). Acima disso é cópia forjada ou estragada: a carta ficaria fora de
 * qualquer bolso e, acima do int do banco (`dex`/`slot`), o envio dela falharia a cada tentativa e travaria a fila.
 */
const MAX_SLOT = MAX_PAGES * MAX_ROWS * MAX_COLS - 1;
const isDex = (v: unknown): v is number => isIndex(v) && v <= TOTAL_SPECIES;
const isSlot = (v: unknown): v is number => isIndex(v) && v <= MAX_SLOT;

/** Endereço do botão de cada loja (ver storeUrl): de outro site, sai (o botão volta para a busca da loja). */
const PRICE_SITES = { mypApi: MYP_URL, tcgplayer: TCGPLAYER_URL } as const;

/**
 * Campos opcionais com formato errado (ex.: arquivo editado à mão) saem, em vez de quebrar as contas do valor. Devolve
 * quais chaves tirar.
 */
function badFields(raw: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const check = (k: string, ok: (v: unknown) => boolean) => {
    if (raw[k] != null && !ok(raw[k])) bad.push(k);
  };
  check('myValue', (v) => isObject(v) && isNum(v.value));
  check('myValueReplaced', (v) => isObject(v) && isNum(v.value) && isNum(v.mypValue));
  check('mypApi', isPrice);
  check('tcgplayer', isPrice);
  check('purchasePrice', isNum);
  check('setTotal', isNum);
  check('valueBasis', (v) => VALUE_BASES.has(str(v)));
  check('origin', (v) => ORIGIN_IDS.has(str(v)));
  check('stampKeys', (v) => Array.isArray(v) && v.every((k) => typeof k === 'string'));
  return bad;
}

/** O objeto com `k` em `latest` quando a data dele vem depois; sem data (ou já no passado), o mesmo objeto. */
function notAfter(v: Record<string, unknown>, k: string, latest: string): Record<string, unknown> {
  const ms = typeof v[k] === 'string' ? Date.parse(v[k] as string) : NaN;
  return ms > Date.parse(latest) ? { ...v, [k]: latest } : v;
}

/**
 * Carta lida de uma cópia, com o mínimo para ser colocada no fichário; `null` se faltar o essencial. As datas que
 * decidem a junção ficam no máximo em `latest` (agora): a da edição, a dos preços (`checkedAt`; o banco guarda sempre o
 * preço de data maior, então um 9999 nunca mais seria trocado) e as do "Meu valor" (com `setAt` no futuro, o preço da
 * fonte nunca o substituiria). Como na configuração (cleanSettings).
 */
function toEntry(raw: unknown, latest: string): Entry | null {
  if (!isObject(raw)) return null;
  if (!isDex(raw.dex) || !isSlot(raw.slot)) return null;
  if (typeof raw.cardId !== 'string' || !raw.cardId) return null;
  if (!LANGS.includes(raw.lang as CardLang)) return null;
  if (raw.binderId != null && typeof raw.binderId !== 'string') return null;
  const variant = (VARIANT_IDS.has(str(raw.variant)) ? raw.variant : 'normal') as Variant;
  const condition = (CONDITION_IDS.has(str(raw.condition)) ? raw.condition : 'NM') as Condition;
  const out: Record<string, unknown> = {
    ...raw,
    id: str(raw.id),
    cardName: str(raw.cardName),
    setName: str(raw.setName),
    setId: str(raw.setId),
    localId: str(raw.localId),
    variant,
    condition,
    updatedAt: cleanDate(raw.updatedAt, latest),
  };
  for (const k of badFields(raw)) delete out[k];
  for (const [k, date] of [['mypApi', 'checkedAt'], ['tcgplayer', 'checkedAt'], ['myValue', 'setAt'], ['myValueReplaced', 'at']] as const) {
    const v = out[k];
    if (isObject(v)) out[k] = notAfter(v, date, latest);
  }
  for (const [k, site] of Object.entries(PRICE_SITES)) {
    const v = out[k];
    if (isObject(v) && 'url' in v && !storeUrl(v.url, site)) {
      const { url: _url, ...rest } = v;
      out[k] = rest;
    }
  }
  return upgradeEntry(stripLegacyFields(out as unknown as Entry));
}

/** A cópia tem um bloco de configuração (sem ele, a configuração daqui fica como está). */
function hasSettings(v: unknown): v is Record<string, unknown> {
  return (
    isObject(v) &&
    typeof v.rows === 'number' &&
    typeof v.cols === 'number' &&
    typeof v.slotsPerPokemon === 'number' &&
    Array.isArray(v.languages) &&
    (v.extras == null || Array.isArray(v.extras))
  );
}

const PURPOSE_IDS = new Set<string>(BINDER_PURPOSES.map((p) => p.id));
const isLang = (v: unknown): v is CardLang => LANGS.includes(v as CardLang);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
/** Inteiro de 1 até `max` (o limite da tela); qualquer outra coisa vira o padrão. */
const upTo = (v: unknown, max: number, fallback: number) => (isIndex(v) && v >= 1 && v <= max ? v : fallback);

export type CleanSettingsOptions = {
  /**
   * Teto das datas (ISO): na cópia, agora, para uma data no futuro não vencer a junção para sempre. Sem ele (aparelho e
   * nuvem), uma data mais de 1 ano no futuro sai (ver FAR_FUTURE_MS); um teto em "agora" a cada leitura faria a nuvem
   * vencer toda edição feita aqui.
   */
  latest?: string;
  /** `createdAt` de um fichário livre sem data válida. */
  createdAt?: string;
};

/**
 * Nenhum relógio de aparelho está tão adiantado (nem o de quem adianta a data para um jogo): é cópia forjada ou estragada.
 * Com 9999-12-31T23:59:59.999Z, a edição seguinte ganharia uma data do ano 10000 ("+010000-…"), que no texto vem antes
 * e perderia a junção.
 */
const FAR_FUTURE_MS = 365 * 24 * 3_600_000;

/** Data no formato do app, no máximo `latest` (ou, sem ele, '' se for longe demais no futuro); '' se não for data. */
function cleanDate(v: unknown, latest?: string) {
  const d = isoDate(v);
  if (!d) return '';
  const ms = Date.parse(d);
  if (latest) return ms > Date.parse(latest) ? latest : d;
  return ms > Date.now() + FAR_FUTURE_MS ? '' : d;
}

/** Tira a chave quando o valor não serve (os campos opcionais da configuração). */
function keepIf(out: Record<string, unknown>, k: string, ok: (v: unknown) => boolean) {
  if (k in out && !ok(out[k])) delete out[k];
}

/** Fichário livre de fora; null sem um id (não há como achar as cartas dele). Grade e páginas fora dos limites: o padrão. */
function cleanBinder(raw: unknown, opts: CleanSettingsOptions): CustomBinder | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const d = DEFAULT_CUSTOM_BINDER;
  // Campos que esta versão não conhece ficam (podem ser de uma versão mais nova do app, em outro aparelho).
  const out: Record<string, unknown> = {
    ...raw,
    name: typeof raw.name === 'string' ? raw.name : d.name,
    color: typeof raw.color === 'string' ? raw.color : d.color,
    purpose: PURPOSE_IDS.has(str(raw.purpose)) ? raw.purpose : d.purpose,
    rows: upTo(raw.rows, MAX_ROWS, d.rows),
    cols: upTo(raw.cols, MAX_COLS, d.cols),
    pages: upTo(raw.pages, MAX_PAGES, d.pages),
    doubleSided: bool(raw.doubleSided, d.doubleSided),
    showPrices: bool(raw.showPrices, d.showPrices),
    showPocketNumbers: bool(raw.showPocketNumbers, d.showPocketNumbers),
    searchLang: isLang(raw.searchLang) ? raw.searchLang : d.searchLang,
    createdAt: cleanDate(raw.createdAt, opts.latest) || opts.createdAt || '',
  };
  keepIf(out, 'description', (v) => typeof v === 'string');
  const updatedAt = cleanDate(raw.updatedAt, opts.latest);
  if (updatedAt) out.updatedAt = updatedAt;
  else delete out.updatedAt;
  return out as CustomBinder;
}

/**
 * Configuração vinda de fora do app: da cópia, do aparelho e da nuvem. Linhas, colunas, espaços por Pokémon e páginas
 * só dentro dos limites da tela (1–8, 1–6, 1–6 e 1–500); fora disso, o padrão. Uma grade de 2000 × 2000 travaria o
 * fichário ao abrir, em todos os aparelhos da conta. O que faltar vem do padrão; o resto fica como está (configuração
 * válida sai igual, para a junção não mandar à nuvem só por causa da leitura). null se não for um objeto.
 */
export function cleanSettings(raw: unknown, opts: CleanSettingsOptions = {}): BinderSettings | null {
  if (!isObject(raw)) return null;
  const d = DEFAULT_SETTINGS;
  const languages = Array.isArray(raw.languages) ? raw.languages.filter(isLang) : [];
  const out: Record<string, unknown> = {
    ...raw,
    rows: upTo(raw.rows, MAX_ROWS, d.rows),
    cols: upTo(raw.cols, MAX_COLS, d.cols),
    slotsPerPokemon: upTo(raw.slotsPerPokemon, MAX_SLOTS_PER_POKEMON, d.slotsPerPokemon),
    doubleSided: bool(raw.doubleSided, d.doubleSided),
    languages: languages.length ? languages : [...d.languages],
  };
  keepIf(out, 'sheets', (v) => Number.isSafeInteger(v) && (v as number) >= 0);
  keepIf(out, 'name', (v) => typeof v === 'string');
  keepIf(out, 'color', (v) => typeof v === 'string');
  // A faixa já é cortada na Pokédex por dexRange; aqui, só número inteiro.
  keepIf(out, 'dexFrom', Number.isInteger);
  keepIf(out, 'dexTo', Number.isInteger);
  if (Array.isArray(raw.extras)) {
    out.extras = raw.extras.map((b) => cleanBinder(b, opts)).filter((b): b is CustomBinder => !!b);
  } else delete out.extras;
  if (isObject(raw.removedBinders)) {
    const removed: Record<string, string> = {};
    for (const [id, at] of Object.entries(raw.removedBinders)) {
      const date = cleanDate(at, opts.latest);
      if (date) removed[id] = date;
    }
    out.removedBinders = removed;
  } else delete out.removedBinders;
  const updatedAt = cleanDate(raw.updatedAt, opts.latest);
  if (updatedAt) out.updatedAt = updatedAt;
  else delete out.updatedAt;
  return out as BinderSettings;
}

/**
 * Lê uma cópia da coleção (texto do arquivo ou objeto já lido). Aceita também o formato antigo do armazenamento do
 * aparelho (objeto id → carta) e uma lista solta de cartas. Erros saem em português, prontos para a tela.
 */
export function parseBackup(input: unknown): ParsedBackup {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('Este arquivo não é uma cópia da coleção (o conteúdo não é JSON).');
    }
  }
  let rawEntries: unknown[];
  let settings: BinderSettings | null = null;
  let exportedAt: string | undefined;
  /** Teto das datas da cópia (ver toEntry e cleanSettings). */
  const now = new Date().toISOString();
  if (Array.isArray(data)) {
    rawEntries = data;
  } else if (isObject(data)) {
    if (typeof data.version === 'number' && data.version > BACKUP_VERSION) {
      throw new Error('Esta cópia foi feita por uma versão mais nova do app. Atualize o app para importar.');
    }
    if (Array.isArray(data.entries)) rawEntries = data.entries;
    else if (isObject(data.entries)) rawEntries = Object.values(data.entries);
    else if (data.app == null && data.version == null && Object.values(data).every(isObject)) rawEntries = Object.values(data);
    else throw new Error('Este arquivo não tem a lista de cartas da coleção.');
    // A data da cópia vale para as cartas sem data (importCollection): no futuro, fica em agora, como as outras.
    exportedAt = typeof data.exportedAt === 'string' ? (notAfter(data, 'exportedAt', now).exportedAt as string) : undefined;
    if (hasSettings(data.settings)) {
      // O que faltar ou vier fora dos limites (cópia antiga, editada à mão ou feita por outra pessoa) fica com o padrão
      // do app, e as datas no futuro ficam em agora.
      settings = cleanSettings(data.settings, { latest: now, createdAt: cleanDate(exportedAt, now) || now });
    }
  } else {
    throw new Error('Este arquivo não é uma cópia da coleção.');
  }
  const entries: Entry[] = [];
  let invalid = 0;
  for (const raw of rawEntries) {
    const e = toEntry(raw, now);
    if (e) entries.push(e);
    else invalid++;
  }
  if (!entries.length && !settings) throw new Error('Nenhuma carta encontrada nesta cópia.');
  return { settings, entries, invalid, exportedAt };
}

/** Nome do arquivo: "fichario-pokedex-2026-10-24.json". */
export function backupFileName(ext: 'json' | 'csv' = 'json', date = new Date()) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${APP_TAG}-${day}.${ext}`;
}

/** O texto do arquivo JSON. */
export function backupToJson(backup: CollectionBackup) {
  return JSON.stringify(backup, null, 1);
}

const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  // Planilhas executam células que começam com = + - @ (ou tab/retorno antes deles): vira texto.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvMoney = (v?: number | null) => (v == null ? '' : v.toFixed(2).replace('.', ','));

/**
 * A coleção em CSV para abrir numa planilha (separador ";" e vírgula decimal, como o Excel em português espera). Só
 * leitura: para restaurar, use o JSON.
 */
export function backupToCsv(backup: CollectionBackup): string {
  const binders = new Map((backup.settings?.extras ?? []).map((b) => [b.id, b.name]));
  const pokedexName = backup.settings?.name?.trim() || 'Pokédex';
  const variantLabel = new Map<string, string>(VARIANTS.map((v) => [v.id, v.label]));
  const originLabel = new Map<string, string>(ORIGINS.map((o) => [o.id, o.label]));
  const header = [
    'Fichário',
    'Nº Pokédex',
    'Bolso',
    'Carta',
    'Coleção',
    'Número',
    'Idioma',
    'Versão',
    'Descrição da versão',
    'Estado',
    'Meu valor (R$)',
    'Origem',
    'Valor pago (R$)',
    'Observações',
    'Alterada em',
  ];
  const rows = backup.entries.map((e) => {
    const custom = e.binderId && e.binderId !== POKEDEX_BINDER;
    return [
      custom ? (binders.get(e.binderId!) ?? 'Fichário apagado') : pokedexName,
      e.dex || '',
      e.slot + 1,
      e.cardName,
      e.setName,
      // O número impresso, como na tela e nas listas (promo sem o total inventado; japonesa antiga, nenhum).
      cardNumber(e),
      LANG_LABEL[e.lang] ?? e.lang,
      variantLabel.get(e.variant) ?? e.variant,
      e.variantNote,
      e.condition,
      csvMoney(e.myValue?.value),
      e.origin ? (originLabel.get(e.origin) ?? e.origin) : '',
      csvMoney(e.purchasePrice),
      e.notes,
      e.updatedAt,
    ];
  });
  // BOM no início: o Excel abre o arquivo como UTF-8 (acentos certos).
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

const SAVE_FAILED = 'Não consegui salvar o arquivo. Tente de novo ou escolha outra pasta.';
const READ_FAILED = 'Não consegui ler o arquivo.';
/** Código do seletor de pasta do Android quando o usuário volta sem escolher. */
const PICKER_CANCELLED = 'ERR_PICKER_CANCELLED';
/** Bem acima de qualquer cópia real: o seletor aceita todo tipo de arquivo, e ler um vídeo inteiro derruba o app. */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

/**
 * Android: grava na pasta que o usuário escolher e devolve false se ele voltar sem escolher. O conteúdo não passa por
 * Intent: o texto no menu de compartilhar estoura o limite de cerca de 1 MB a partir de umas 650 cartas.
 */
async function saveToPickedFolder(content: string, fileName: string, mimeType: string): Promise<boolean> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch (e) {
    if ((e as { code?: string }).code === PICKER_CANCELLED) return false;
    throw e;
  }
  const file = folder.createFile(fileName, mimeType);
  try {
    await file.write(content);
  } catch (e) {
    // Arquivo pela metade parece uma cópia boa: não fica.
    try {
      file.delete();
    } catch {}
    throw e;
  }
  return true;
}

/**
 * Entrega o arquivo: na web, baixa; no Android, grava numa pasta escolhida; no iPhone, abre o menu de compartilhar com
 * o arquivo. Devolve o aviso para a tela, ou null quando não há o que avisar (cancelou, ou o menu do sistema já mostrou).
 * Erros saem em português.
 */
export async function saveBackupFile(content: string, fileName: string, mimeType = 'application/json'): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') throw new Error('Não dá para baixar o arquivo aqui.');
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return `${fileName} baixado`;
  }
  try {
    if (Platform.OS === 'ios') {
      const file = new File(Paths.cache, fileName);
      file.create({ overwrite: true });
      await file.write(content);
      await Share.share({ url: file.uri });
      return null;
    }
    return (await saveToPickedFolder(content, fileName, mimeType)) ? `${fileName} salvo` : null;
  } catch {
    throw new Error(SAVE_FAILED);
  }
}

/** Celular: seletor de arquivos do sistema, sem filtro de tipo (há aparelhos que não marcam o .json como JSON). */
async function pickNativeFile(): Promise<string | null> {
  const picked = await File.pickFileAsync();
  if (picked.canceled) return null;
  if (picked.result.size > MAX_BACKUP_BYTES) throw new Error('Este arquivo é grande demais para ser uma cópia da coleção.');
  try {
    return await picked.result.text();
  } catch {
    throw new Error(READ_FAILED);
  }
}

/** Abre a escolha de arquivo e devolve o texto dele (null se cancelar). */
export function pickBackupFile(): Promise<string | null> {
  if (Platform.OS !== 'web') return pickNativeFile();
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => reject(new Error(READ_FAILED)));
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
