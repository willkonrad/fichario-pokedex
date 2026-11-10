// Extrai o que está impresso na carta a partir das linhas e caixas do OCR. Só funções puras: nada de câmera, rede ou banco.
import type { OcrScript } from '../../modules/card-ocr';

export type Box = { x: number; y: number; w: number; h: number };
export type OcrLine = { text: string; box: Box | null; angle?: number };
export type OcrPage = { width: number; height: number; lines: OcrLine[] };

export type OcrSpecies = { id: number; names: string[] };
export type Dictionaries = {
  species: OcrSpecies[];
  /** Siglas conhecidas (coleções do índice e TCGdex), como vêm do banco: "SVI", "SV2a", "m6a". */
  setCodes: string[];
  /** Nomes de treinador e energia (seção 0 do índice). */
  trainers?: string[];
};

export type CardNumber = {
  left: string;
  total: string | null;
  kind: 'slash' | 'gallery' | 'promo' | 'bare';
  score: number;
};

export type HpWord = 'HP' | 'PS' | 'PV' | 'KP';
/** Escrita que predomina no texto lido. */
export type TextScript = 'latin' | 'kana' | 'hangul' | 'hanzi';

export type CardReading = {
  name: string | null;
  speciesId: number | null;
  speciesFrom: 'nome' | 'pokedex' | null;
  hp: number | null;
  number: CardNumber | null;
  setCode: string | null;
  langTag: string | null;
  regulation: string | null;
  year: number | null;
  hpWord: HpWord | null;
  langWords: 'pt' | 'en' | null;
  level: number | null;
  script: TextScript | null;
};

export type PrintReading = { dex: number | null; name: string | null; hp: number | null; number: CardNumber | null; others: number[] };

type Row = { text: string; ny: number; nx: number; h: number };

/** Escrita vira uma só: NFKC (dígitos de largura total), barras e espaços. */
export function normalize(s: string): string {
  return s.normalize('NFKC').replace(/[\\⁄∕]/g, '/').replace(/\s+/g, ' ').trim();
}

const DIGIT_LOOKALIKE: Record<string, string> = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', '|': '1', '!': '1', S: '5', s: '5', Z: '2', z: '2', B: '8', G: '6', g: '9' };
const LOOK = 'OoQDIl|!SsZzBGg';

/** "O7O" → "070". null quando sobra algo que não é dígito ou não há nenhum dígito de verdade. */
export function digits(s: string): string | null {
  if (!/\d/.test(s)) return null;
  const out = [...s].map((c) => DIGIT_LOOKALIKE[c] ?? c).join('');
  return /^\d+$/.test(out) ? out : null;
}

function rotate(b: Box, deg: number, cx: number, cy: number) {
  const t = (-deg * Math.PI) / 180;
  const px = b.x + b.w / 2 - cx;
  const py = b.y + b.h / 2 - cy;
  return { cx: cx + px * Math.cos(t) - py * Math.sin(t), cy: cy + px * Math.sin(t) + py * Math.cos(t) };
}

/** Fração da altura da foto abaixo da qual o texto lido é uma faixa só. */
const MIN_TEXT_SPAN = 0.2;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Linhas em "linhas da carta": desfaz a inclinação pela mediana dos ângulos, normaliza 0–1 pela área com texto
 * (a carta nem sempre enche a foto) e junta o que está na mesma altura ("HP" pequeno + "60" grande).
 */
export function toRows(page: OcrPage): Row[] {
  const items = page.lines.filter((l) => l.box && l.text.trim());
  if (!items.length) return [];
  const angle = median(items.map((l) => l.angle ?? 0));
  const cx = page.width / 2;
  const cy = page.height / 2;
  const placed = items.map((l) => {
    const c = Math.abs(angle) > 5 ? rotate(l.box!, angle, cx, cy) : { cx: l.box!.x + l.box!.w / 2, cy: l.box!.y + l.box!.h / 2 };
    const sideways = Math.abs(Math.abs(angle) - 90) < 45;
    return { text: normalize(l.text), cx: c.cx, cy: c.cy, h: sideways ? l.box!.w : l.box!.h };
  });
  const minY = Math.min(...placed.map((p) => p.cy));
  const maxY = Math.max(...placed.map((p) => p.cy));
  const minX = Math.min(...placed.map((p) => p.cx));
  const maxX = Math.max(...placed.map((p) => p.cx));
  // Texto numa faixa só (só o topo lido): não há extensão para normalizar, vale a posição na foto.
  const narrow = maxY - minY < page.height * MIN_TEXT_SPAN;
  const originY = narrow ? 0 : minY;
  const spanY = narrow ? Math.max(1, page.height) : Math.max(1, maxY - minY);
  const spanX = Math.max(1, maxX - minX);
  placed.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const groups: (typeof placed)[] = [];
  for (const p of placed) {
    const g = groups[groups.length - 1];
    const tall = g ? g.reduce((a, b) => (b.h > a.h ? b : a)) : null;
    const sameRow = !!tall && Math.abs(tall.cy - p.cy) <= Math.max(tall.h, p.h) * 0.5 && Math.min(tall.h, p.h) / Math.max(tall.h, p.h) > 0.25;
    if (g && sameRow) g.push(p);
    else groups.push([p]);
  }
  return groups.map((g) => {
    g.sort((a, b) => a.cx - b.cx);
    return {
      text: g.map((x) => x.text).join(' '),
      ny: (median(g.map((x) => x.cy)) - originY) / spanY,
      nx: (g[0].cx - minX) / spanX,
      h: Math.max(...g.map((x) => x.h)),
    };
  });
}

const PROMO_PREFIX = 'SWSH|SM|XY|BW|HGSS|DP|NP|SVP|MEP|SV-P|S-P|SM-P|XY-P|BW-P|DP-P|L-P|ADV-P|PCG-P|M-P|PW';
const NUMBER_PATTERNS: { re: RegExp; kind: CardNumber['kind']; make: (m: RegExpExecArray) => { left: string; total: string | null } | null }[] = [
  // Galerias: TG05/TG30, GG12/GG70, RC5/RC25, SV05/SV94, H12/H32.
  {
    re: /(?<![A-Za-z0-9])([A-Z]{1,3})([0-9OIl]{1,3}[a-z]?)\s?\/\s?([A-Z]{1,3})([0-9OIl]{1,3})(?![0-9A-Za-z])/g,
    kind: 'gallery',
    make: (m) => {
      const a = digits(m[2].replace(/[a-z]$/, ''));
      const b = digits(m[4]);
      if (!a || !b || m[1] !== m[3]) return null;
      return { left: `${m[1]}${a}${/[a-z]$/.test(m[2]) ? m[2].slice(-1) : ''}`, total: `${m[3]}${b}` };
    },
  },
  // Promo japonesa: 001/SV-P, 054/ADV-P, 047/P, 001/J.
  {
    re: /(?<![A-Za-z0-9.,])([0-9OIl]{1,3})\s?\/\s?((?:[A-Za-z]{1,4}-P)|P{1,3}|J|PLAY)(?![A-Za-z0-9])/g,
    kind: 'promo',
    make: (m) => {
      const a = digits(m[1]);
      return a ? { left: a, total: m[2] } : null;
    },
  },
  // O caso comum: 070/108, 4/102, 206a/236, com barra lida como | ou I.
  {
    re: new RegExp(`(?<![A-Za-z0-9.,#-])([0-9${LOOK}]{1,3})([a-z]?)\\s?[/|]\\s?([0-9${LOOK}]{2,3})(?![0-9A-Za-z%.])`, 'g'),
    kind: 'slash',
    make: (m) => {
      const a = digits(m[1]);
      const b = digits(m[3]);
      return a && b ? { left: a + m[2], total: b } : null;
    },
  },
  // Barra lida como 1 ou I: 0701108 (só nos casos sem ambiguidade: 3 + 1 + 3 dígitos).
  {
    re: /(?<![0-9A-Za-z])(\d{3})[1Il](\d{3})(?![0-9A-Za-z])/g,
    kind: 'slash',
    make: (m) => ({ left: m[1], total: m[2] }),
  },
  // Promo sem total: SWSH123, SM103a, XY67a, SV-P 001, PW 1.
  {
    re: new RegExp(`(?<![A-Za-z0-9])(${PROMO_PREFIX})[\\s-]?([0-9OIl]{1,3})([a-z]?)(?![0-9A-Za-z])`, 'g'),
    kind: 'promo',
    make: (m) => {
      const a = digits(m[2]);
      return a ? { left: `${m[1]}${a}${m[3]}`, total: null } : null;
    },
  },
  // Código sem total: AR1, SL3 (precisa de dígito).
  {
    re: /(?<![A-Za-z0-9])([A-Z]{2,4})([0-9]{1,3})(?![0-9A-Za-z])/g,
    kind: 'bare',
    make: (m) => ({ left: `${m[1]}${m[2]}`, total: null }),
  },
  // Número sozinho na base (promos antigas): 001, 45.
  {
    re: /^(?:[A-Z]\s)?(\d{1,3})$/g,
    kind: 'bare',
    make: (m) => ({ left: m[1], total: null }),
  },
];

/**
 * O melhor número da carta: padrão forte, na base da carta, com três dígitos de cada lado.
 * `anywhere` (print de tela): a posição não conta e número solto não vale.
 */
export function findNumber(rows: Row[], anywhere = false): (CardNumber & { rowIndex?: number }) | null {
  let best: (CardNumber & { rowIndex?: number }) | null = null;
  const biggest = Math.max(0, ...rows.map((x) => x.h));
  let index = -1;
  for (const r of rows) {
    index++;
    for (const p of NUMBER_PATTERNS) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(r.text))) {
        const got = p.make(m);
        if (!got) continue;
        const raw = m[0];
        let score = { gallery: 8, promo: 7, slash: 6, bare: 0 }[p.kind];
        if (!anywhere) {
          if (r.ny > 0.82) score += 4;
          else if (r.ny > 0.6) score += 1;
          else score -= 4;
        }
        if (/\d{3}\s?[/|]\s?\d{3}/.test(raw)) score += 2;
        if (/[OoQIl|SZBG]/.test(raw) && p.kind === 'slash') score -= 2;
        if (p.kind === 'slash' && got.total && Number(got.total) < 10) score -= 3;
        if (p.kind === 'bare' && (anywhere || r.ny < 0.9 || r.h > biggest * 0.6)) continue;
        if (!best || score > best.score) best = { ...got, kind: p.kind, score, rowIndex: index };
      }
    }
  }
  return best && best.score >= 3 ? best : null;
}

const validHp = (n: number) => n >= 10 && n <= 400 && n % 10 === 0;
const HP_WORD = '(?:H\\s?P|P\\s?S|P\\s?V|K\\s?P)';
const HP_NUM = `[0-9${LOOK}]{2,3}`;
const HP_AFTER = new RegExp(`(?:^|[^A-Za-z])(${HP_WORD})\\s?[:.]?\\s?(${HP_NUM})(?![0-9])`);
const HP_BEFORE = new RegExp(`(?:^|[^0-9A-Za-z])(${HP_NUM})\\s?(${HP_WORD})(?![A-Za-z])`);

/** HP escrito no texto, com a palavra que veio junto ("PS 60", "120 HP"). */
function hpInText(text: string): { hp: number; word: HpWord } | null {
  for (const [re, num, word] of [
    [HP_AFTER, 2, 1],
    [HP_BEFORE, 1, 2],
  ] as const) {
    const m = re.exec(text);
    const v = m ? digits(m[num]) : null;
    if (v && validHp(Number(v))) return { hp: Number(v), word: m![word].replace(/\s/g, '') as HpWord };
  }
  return null;
}

/** HP impresso no topo. Em português é "PS". Pokémon só tem HP múltiplo de 10. */
export function findHp(rows: Row[]): { hp: number | null; word: HpWord | null } {
  const top = rows.filter((r) => r.ny < 0.3);
  for (const list of [top, rows]) {
    for (const r of list) {
      const got = hpInText(r.text);
      if (got) return got;
    }
    if (top.length === 0) break;
  }
  // Sem a palavra HP: número solto à direita do topo, na mesma linha do nome.
  for (const r of top.slice(0, 3)) {
    const m = /(?:^|\s)(\d{2,3})(?:\s\S{1,2})?$/.exec(r.text);
    if (m && validHp(Number(m[1]))) return { hp: Number(m[1]), word: null };
  }
  return { hp: null, word: null };
}

const codeKey = (s: string) => {
  const map: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', Z: '2', B: '8', G: '6' };
  return [...s.toUpperCase()].map((c) => map[c] ?? c).join('');
};

const LANG_TAGS = new Set(['EN', 'PT', 'ES', 'FR', 'DE', 'IT']);
/** Fração da altura lida: até onde outra linha ainda conta como a mesma do número. */
const NEAR_ROW = 0.05;
const NOT_CODE = new Set(['PROMO', 'ILLUS', 'BASIC', 'STAGE', 'HP', 'PS', 'GAME', 'FREAK', 'NINTENDO', 'CREATURES', 'POKEMON']);

/** Sigla, língua impressa ("SVI EN", "SVI PT") e marca de regulamento, à esquerda do número, na base da carta. */
export function findSetInfo(rows: Row[], knownCodes: string[], numberRow?: number): { setCode: string | null; langTag: string | null; regulation: string | null } {
  const exact = new Set(knownCodes);
  const upper = new Map(knownCodes.map((c) => [c.toUpperCase(), c] as const));
  const folded = new Map<string, string>();
  for (const c of knownCodes) if (c && !folded.has(codeKey(c))) folded.set(codeKey(c), c);
  const dict = {
    has: (t: string) => exact.has(t) || upper.has(t.toUpperCase()) || folded.has(codeKey(t)),
    get: (t: string) => (exact.has(t) ? t : (upper.get(t.toUpperCase()) ?? folded.get(codeKey(t)))),
  };
  const out = { setCode: null as string | null, langTag: null as string | null, regulation: null as string | null };
  // A linha do número manda; a vizinha só vale colada nela, senão o nome ("Mew") ou o texto ("sit") vira sigla.
  const main = numberRow == null ? undefined : rows[numberRow];
  const band = main ? [main, ...rows.filter((r) => r !== main && Math.abs(r.ny - main.ny) <= NEAR_ROW)] : [];
  for (const r of band) {
    const tokens = r.text.split(/[\s[\]()]+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].replace(/[^A-Za-z0-9-]/g, '');
      if (!t || /\//.test(tokens[i])) continue;
      if (r !== main && !/\d/.test(t) && t !== t.toUpperCase()) continue;
      if (r === main && /^[A-J]$/.test(t) && i < tokens.length - 1) {
        out.regulation ??= t;
        continue;
      }
      if (NOT_CODE.has(t.toUpperCase())) continue;
      // Marca grudada na sigla: "GSVI" → G + SVI. Língua grudada: "SVIEN" → SVI + EN.
      const tag = t.slice(-2).toUpperCase();
      if (t.length > 3 && LANG_TAGS.has(tag) && dict.has(t.slice(0, -2))) {
        out.setCode ??= dict.get(t.slice(0, -2))!;
        out.langTag ??= tag;
        continue;
      }
      if (t.length >= 2 && dict.has(t)) {
        out.setCode ??= dict.get(t)!;
        const next = (tokens[i + 1] ?? '').toUpperCase();
        if (LANG_TAGS.has(next)) out.langTag ??= next;
        continue;
      }
      if (t.length >= 3 && /^[A-J]/.test(t) && dict.has(t.slice(1))) {
        out.regulation ??= t[0];
        out.setCode ??= dict.get(t.slice(1))!;
      }
    }
  }
  return out;
}

/** Ano do ©: o último da lista ("©1995, 96, 98" → 1998). Dica de filtro: reimpressão repete o © antigo ou traz o novo. */
export function findYear(rows: Row[]): number | null {
  for (const r of [...rows].reverse()) {
    const m = /(?:[©@®]|\(c\)|\bC)\s?((?:19|20)\d{2})((?:,\s?\d{2,4})*)/i.exec(r.text) ?? /((?:19|20)\d{2})((?:,\s?\d{2,4})*)\s?(?:Pok|Nintendo)/i.exec(r.text);
    if (!m) continue;
    const more = (m[2] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    let year = Number(m[1]);
    for (const y of more) {
      const full = y.length === 4 ? Number(y) : Number(`${Math.floor(year / 100)}${y}`);
      year = full < year ? full + 100 : full;
    }
    return year;
  }
  return null;
}

/** "NO. 0948", "Nº 0948", "全國圖鑑No.0315", "#6": número da Pokédex impresso na carta. */
export function findDex(rows: Row[], total = 1025): number | null {
  for (const r of rows) {
    if (r.ny < 0.2) continue;
    const m = /(?:N[oO0º°ª]\s?\.?\s?|#\s?)([0-9OIlS]{1,4})(?![0-9])/.exec(r.text);
    const v = m ? digits(m[1]) : null;
    if (v && Number(v) >= 1 && Number(v) <= total) return Number(v);
  }
  return null;
}

const PT_WORDS = /\b(?:fraqueza|resist[eê]ncia|recuo|evolui\s+de)\b/i;
const EN_WORDS = /\b(?:weakness|resistance|retreat|evolves\s+from)\b/i;

/** Palavras do corpo da carta que entregam o idioma latino. */
export function findLangWords(rows: Row[]): 'pt' | 'en' | null {
  const pt = rows.some((r) => PT_WORDS.test(r.text));
  const en = rows.some((r) => EN_WORDS.test(r.text));
  return pt === en ? null : pt ? 'pt' : 'en';
}

/** "LV.12", "Lv 76": nível impresso (ajuda a separar japonesas antigas). */
export function findLevel(rows: Row[]): number | null {
  for (const r of rows) {
    const m = /(?:^|[^A-Za-z])L[Vv][.,:]?\s?(\d{1,3})(?![0-9])/.exec(r.text);
    if (m) return Number(m[1]);
  }
  return null;
}

const countOf = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

/** Quantas letras de cada escrita a leitura trouxe. */
export function scriptCounts(page: Pick<OcrPage, 'lines'>) {
  const text = normalize(page.lines.map((l) => l.text).join(' '));
  return {
    latin: countOf(text, /[A-Za-z]/g),
    kana: countOf(text, /[ぁ-ヺー]/g),
    hangul: countOf(text, /[ᄀ-ᇿ㄰-㆏가-힣]/g),
    hanzi: countOf(text, /[㐀-䶿一-鿿]/g),
  };
}

const KANA_MIN = 3;
const HANGUL_MIN = 2;
const HANZI_MIN = 2;

/** 3 kana ou mais é japonês; carta coreana ou chinesa não vira japonesa só por ter kanji parecido. */
export function pageScript(page: Pick<OcrPage, 'lines'>): TextScript | null {
  const c = scriptCounts(page);
  if (c.kana >= KANA_MIN) return 'kana';
  if (c.hangul >= HANGUL_MIN) return 'hangul';
  if (c.hanzi >= HANZI_MIN) return 'hanzi';
  return c.latin > 0 ? 'latin' : null;
}

/** Idioma latino pelas pistas impressas, sem dicionário: etiqueta depois da sigla, "PS", ou "HP" com as palavras em inglês. */
function latinSignal(rows: Row[], numberRow: number | undefined): 'pt' | 'en' | null {
  const around = numberRow == null ? [] : rows.filter((_, i) => Math.abs(i - numberRow) <= 1);
  for (const r of around) {
    const m = /(?<![A-Za-z0-9])[A-Za-z0-9]{2,6}\s?(PT|EN)(?![A-Za-z0-9])/.exec(r.text);
    if (m) return m[1] === 'PT' ? 'pt' : 'en';
  }
  const words = findLangWords(rows);
  const { word } = findHp(rows);
  if (word === 'PS' || words === 'pt') return 'pt';
  return word === 'HP' && words === 'en' ? 'en' : null;
}

/**
 * Passo da cadeia de leitores (só em "Auto"): o latino sempre primeiro; sem pista de idioma e com número, tenta o
 * japonês, depois o coreano, depois o chinês. Devolve quem resolveu ou quem tentar agora; ninguém resolveu = latino,
 * sem `sure`, para a próxima foto repetir a cadeia.
 */
export function chainStep(script: OcrScript, page: OcrPage): { resolved: OcrScript; sure: boolean } | { next: OcrScript } {
  const c = scriptCounts(page);
  if (script === 'latin') {
    const rows = toRows(page);
    const number = findNumber(rows);
    if (latinSignal(rows, number?.rowIndex)) return { resolved: 'latin', sure: true };
    return number ? { next: 'japanese' } : { resolved: 'latin', sure: false };
  }
  if (script === 'japanese') return c.kana >= KANA_MIN ? { resolved: 'japanese', sure: true } : { next: 'korean' };
  if (script === 'korean') return c.hangul >= HANGUL_MIN ? { resolved: 'korean', sure: true } : { next: 'chinese' };
  return c.hanzi >= HANZI_MIN ? { resolved: 'chinese', sure: true } : { resolved: 'latin', sure: false };
}

/** Idioma pela escrita do print: `PS` = PT, kana = JP, hangul = KO, hanzi sem kana = ZH; latino sem `PS` não restringe. */
export function printLang(page: OcrPage): 'pt' | 'ja' | 'ko' | 'zh' | null {
  const script = pageScript(page);
  if (script === 'kana') return 'ja';
  if (script === 'hangul') return 'ko';
  if (script === 'hanzi') return 'zh';
  return page.lines.some((l) => hpInText(normalize(l.text))?.word === 'PS') ? 'pt' : null;
}

const STAGE = /^(basic|básico|basico|stage\s?[12]|estágio\s?[12]|estagio\s?[12]|たね|[12]\s?進化|기본|[12]\s?진화|基礎|基础|[12]\s?階進化|[12]\s?阶进化)\s*/i;
const EVOLVES_LINE = /^(evolves from|evolui de|put |coloque |.*(?:から進化|에서 진화|進化自|进化自))/i;
const TRAINER_LABEL = /^(trainer|treinador|item|supporter|apoiador|stadium|est[aá]dio|pok[eé]mon tool|ferramenta pok[eé]mon|energy|energia)\s*/i;

const latinKey = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/♀/g, 'f').replace(/♂/g, 'm').replace(/[^a-z0-9]+/g, '');

/** Letras que o leitor troca entre katakana e kanji parecido. */
const cjkKey = (s: string) =>
  s.normalize('NFKC').replace(/[一－—]/g, 'ー').replace(/力/g, 'カ').replace(/口/g, 'ロ').replace(/二/g, 'ニ').replace(/夕/g, 'タ').replace(/卜/g, 'ト').replace(/八/g, 'ハ').replace(/工/g, 'エ').replace(/\s/g, '');

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]);
    }
    if (low > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

type Prepared = {
  latin: { id: number; key: string; max: number }[];
  cjk: { id: number; key: string; len: number }[];
  trainers: Map<string, string>;
  maxDex: number;
};

const PREPARED = new WeakMap<Dictionaries, Prepared>();

/** Chaves dos nomes, calculadas uma vez por dicionário (o laço da câmera lê várias vezes por segundo). */
function prepared(dict: Dictionaries): Prepared {
  const hit = PREPARED.get(dict);
  if (hit) return hit;
  const latin: Prepared['latin'] = [];
  const cjk: Prepared['cjk'] = [];
  let maxDex = 0;
  for (const s of dict.species) {
    maxDex = Math.max(maxDex, s.id);
    for (const name of s.names) {
      if (!name) continue;
      if (/^[\x00-ɏ♀♂'’. -]+$/.test(name)) {
        const key = latinKey(name);
        if (key.length >= 3) latin.push({ id: s.id, key, max: key.length <= 4 ? 0 : key.length <= 7 ? 1 : 2 });
      } else if (name.length >= 2) cjk.push({ id: s.id, key: cjkKey(name), len: name.length * 2 });
    }
  }
  const trainers = new Map<string, string>();
  for (const name of dict.trainers ?? []) {
    const key = latinKey(name);
    if (key.length >= 3 && !trainers.has(key)) trainers.set(key, name);
  }
  const out = { latin, cjk, trainers, maxDex: maxDex || 1025 };
  PREPARED.set(dict, out);
  return out;
}

type Hit = { id: number; len: number; dist: number };

/** Procura uma espécie dentro de uma linha: igual, contida ou com pouco erro de leitura. O nome mais longo vence. */
function speciesInLine(text: string, dict: Prepared): Hit | null {
  const words = text.split(/[\s/]+/).filter(Boolean);
  const grams: string[] = [];
  for (let i = 0; i < words.length; i++) for (let n = 1; n <= 3 && i + n <= words.length; n++) grams.push(latinKey(words.slice(i, i + n).join(' ')));
  const cjk = cjkKey(text);
  let best: Hit | null = null;
  const better = (h: Hit) => !best || h.dist < best.dist || (h.dist === best.dist && h.len > best.len);
  for (const s of dict.latin) {
    let hit: Hit | null = null;
    for (const g of grams) {
      const dist = g === s.key ? 0 : editDistance(g, s.key, s.max);
      if (dist <= s.max && (!hit || dist < hit.dist)) hit = { id: s.id, len: s.key.length, dist };
    }
    if (hit && better(hit)) best = hit;
  }
  for (const s of dict.cjk) {
    if (!cjk.includes(s.key)) continue;
    const hit = { id: s.id, len: s.len, dist: 0 };
    if (better(hit)) best = hit;
  }
  return best;
}

const stripTail = (text: string) => text.replace(new RegExp(`\\s*(?:${HP_WORD}\\s?\\d{2,3}|\\d{2,3}\\s?${HP_WORD}|L[Vv][.]?[ ]?[0-9]*).*$`), '').trim();

/** Nome: a linha mais alta (maior letra) do topo que contém uma espécie. Ignora "Evolves from …" e o estágio. */
function findName(rows: Row[], dict: Prepared): { name: string | null; speciesId: number | null } {
  // Sem o estágio antes: "STAGE 2" e "Evolves from Charmeleon" podem vir numa linha só.
  const top = rows.filter((r) => r.ny < 0.32 && !EVOLVES_LINE.test(r.text.replace(STAGE, ''))).sort((a, b) => b.h - a.h);
  for (const r of top) {
    const clean = r.text.replace(STAGE, '');
    const hit = speciesInLine(clean, dict);
    if (hit) return { name: stripTail(clean), speciesId: hit.id };
  }
  // Sem espécie: treinador ou energia, pelo nome inteiro (a linha toda, ou um trecho de até 5 palavras).
  if (dict.trainers.size) {
    for (const r of top) {
      const words = r.text.replace(TRAINER_LABEL, '').split(/\s+/).filter(Boolean);
      for (let n = Math.min(5, words.length); n >= 1; n--) {
        for (let i = 0; i + n <= words.length; i++) {
          const name = dict.trainers.get(latinKey(words.slice(i, i + n).join(' ')));
          if (name) return { name, speciesId: null };
        }
      }
    }
  }
  return { name: null, speciesId: null };
}

export function readCard(page: OcrPage, dict: Dictionaries): CardReading {
  const prep = prepared(dict);
  const rows = toRows(page);
  const found = findNumber(rows);
  const { name, speciesId } = findName(rows, prep);
  const dex = findDex(rows, prep.maxDex);
  const hp = findHp(rows);
  let number: CardNumber | null = null;
  if (found) {
    const { rowIndex: _rowIndex, ...rest } = found;
    number = rest;
  }
  return {
    name,
    speciesId: speciesId ?? dex,
    speciesFrom: speciesId ? 'nome' : dex ? 'pokedex' : null,
    hp: hp.hp,
    hpWord: hp.word,
    number,
    ...findSetInfo(rows, dict.setCodes, found?.rowIndex),
    year: findYear(rows),
    langWords: findLangWords(rows),
    level: findLevel(rows),
    script: pageScript(page),
  };
}

type PrintLine = { text: string; cx: number; cy: number; h: number };

/** HP da mesma faixa de altura do nome: na própria linha ou na vizinha mais próxima. */
function hpNear(line: PrintLine, lines: PrintLine[]): number | null {
  const own = hpInText(line.text);
  if (own) return own.hp;
  const bare = /(?:^|\s)(\d{2,3})$/.exec(line.text);
  if (bare && validHp(Number(bare[1]))) return Number(bare[1]);
  const band = lines
    .filter((o) => o !== line && Math.abs(o.cy - line.cy) <= Math.max(o.h, line.h) * 0.75)
    .sort((a, b) => Math.abs(a.cx - line.cx) - Math.abs(b.cx - line.cx));
  for (const o of band) {
    const got = hpInText(o.text);
    if (got) return got.hp;
    if (/^\d{2,3}$/.test(o.text) && validHp(Number(o.text))) return Number(o.text);
  }
  return null;
}

/**
 * Imagem inteira (print de live, foto de tela): sem supor onde a carta está. Procura espécies em todas as linhas, HP
 * na mesma faixa de altura, e vence o par com a maior letra. As outras espécies vêm em `others`.
 */
export function readPrint(page: OcrPage, dict: Dictionaries): PrintReading {
  const prep = prepared(dict);
  const lines: PrintLine[] = page.lines
    .filter((l) => l.box && l.text.trim())
    .map((l) => ({ text: normalize(l.text), cx: l.box!.x + l.box!.w / 2, cy: l.box!.y + l.box!.h / 2, h: l.box!.h }));
  const found = findNumber(
    lines.map((l) => ({ text: l.text, ny: 0.5, nx: 0, h: l.h })),
    true,
  );
  let number: CardNumber | null = null;
  if (found) {
    const { rowIndex: _rowIndex, ...rest } = found;
    number = rest;
  }
  const hits: { dex: number; name: string; hp: number | null; h: number }[] = [];
  for (const l of lines) {
    const clean = l.text.replace(STAGE, '');
    if (EVOLVES_LINE.test(clean)) continue;
    const hit = speciesInLine(clean, prep);
    if (hit) hits.push({ dex: hit.id, name: stripTail(clean), hp: hpNear(l, lines), h: l.h });
  }
  hits.sort((a, b) => Number(b.hp != null) - Number(a.hp != null) || b.h - a.h);
  const best = hits[0];
  const others = [...new Set(hits.map((x) => x.dex))].filter((d) => d !== best?.dex);
  return { dex: best?.dex ?? null, name: best?.name ?? null, hp: best?.hp ?? null, number, others };
}

/** Assinatura para fotos em sequência: duas leituras seguidas iguais = estabilizou. */
export function readingKey(r: CardReading): string | null {
  if (r.number) return `n:${r.setCode ?? ''}:${r.number.left}/${r.number.total ?? ''}`;
  if (r.speciesId && r.hp) return `h:${r.speciesId}:${r.hp}`;
  return null;
}

export function isStable(history: CardReading[], need = 2): boolean {
  if (history.length < need) return false;
  const keys = history.slice(-need).map(readingKey);
  return keys[0] != null && keys.every((k) => k === keys[0]);
}
