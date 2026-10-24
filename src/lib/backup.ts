import { Platform, Share } from 'react-native';

import {
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

/** Carta lida de uma cópia, com o mínimo para ser colocada no fichário; `null` se faltar o essencial. */
function toEntry(raw: unknown): Entry | null {
  if (!isObject(raw)) return null;
  if (!isIndex(raw.dex) || !isIndex(raw.slot)) return null;
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
    updatedAt: isoDate(raw.updatedAt),
  };
  for (const k of badFields(raw)) delete out[k];
  return stripLegacyFields(out as unknown as Entry);
}

function isSettings(v: unknown): v is BinderSettings {
  return (
    isObject(v) &&
    typeof v.rows === 'number' &&
    typeof v.cols === 'number' &&
    typeof v.slotsPerPokemon === 'number' &&
    Array.isArray(v.languages) &&
    (v.extras == null || Array.isArray(v.extras))
  );
}

/** Fichário livre com o mínimo para ser desenhado (o resto vem do padrão). */
function isBinder(v: unknown): v is Pick<CustomBinder, 'id' | 'name' | 'rows' | 'cols' | 'pages'> {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    !!v.id &&
    typeof v.name === 'string' &&
    typeof v.rows === 'number' &&
    typeof v.cols === 'number' &&
    typeof v.pages === 'number'
  );
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
    exportedAt = typeof data.exportedAt === 'string' ? data.exportedAt : undefined;
    if (isSettings(data.settings)) {
      // O que faltar (cópia antiga ou editada à mão) fica com o padrão do app.
      const createdAt = isoDate(exportedAt) || new Date().toISOString();
      const extras = (data.settings.extras as unknown[] | undefined)
        ?.filter(isBinder)
        .map((b): CustomBinder => ({ ...DEFAULT_CUSTOM_BINDER, createdAt, ...b }));
      settings = { ...DEFAULT_SETTINGS, ...data.settings, extras };
      if (!settings.extras) delete settings.extras;
    }
  } else {
    throw new Error('Este arquivo não é uma cópia da coleção.');
  }
  const entries: Entry[] = [];
  let invalid = 0;
  for (const raw of rawEntries) {
    const e = toEntry(raw);
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
      e.setTotal ? `${e.localId}/${e.setTotal}` : e.localId,
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

/**
 * Entrega o arquivo: na web, baixa; no celular, abre o menu de compartilhar do sistema (salvar no Drive, mandar no
 * WhatsApp…) com o conteúdo como texto.
 */
export async function shareBackupFile(content: string, fileName: string, mimeType = 'application/json'): Promise<void> {
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
    return;
  }
  await Share.share({ title: fileName, message: content });
}

/**
 * Na web, abre a escolha de arquivo e devolve o texto dele (null se cancelar). No celular devolve null: a tela pede
 * para colar o conteúdo da cópia.
 */
export function pickBackupFile(): Promise<string | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => reject(new Error('Não consegui ler o arquivo.')));
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
