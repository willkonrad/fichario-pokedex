// Dinheiro, porcentagens e datas no padrão brasileiro, num lugar só (as instâncias de Intl são criadas uma vez).

const brl2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec4 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const int0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Sinal de menos tipográfico (o hífen fica pequeno ao lado dos números). */
const MINUS = '−';

const ok = (n?: number | null): n is number => n != null && Number.isFinite(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "R$ 1.234,56"; sem valor: "—". */
export function formatBRL(n?: number | null) {
  return ok(n) ? brl2.format(n) : '—';
}

/** Reais sem centavos (totais): "R$ 5.779". */
export function formatBRLWhole(n?: number | null) {
  return ok(n) ? brl0.format(n) : '—';
}

/** Centavos só abaixo de R$ 100 (cabe em colunas estreitas): "R$ 82,52", "R$ 1.537". */
export function formatBRLTight(n?: number | null) {
  if (!ok(n)) return '—';
  return Math.abs(round2(n)) >= 100 ? brl0.format(n) : brl2.format(n);
}

/**
 * Valor curto, sem "R$" (cápsula do bolso): "0,82", "82", "1,2 mil", "120 mil", "1,5 mi". O arredondamento vem antes
 * da escolha do formato (999,60 vira "1,0 mil", não "1000").
 */
export function formatCompact(n: number) {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? MINUS : '';
  const a = Math.abs(n);
  if (round2(a) < 10) return sign + dec2.format(a);
  const whole = Math.round(a);
  if (whole < 1000) return sign + String(whole);
  const k = Math.round(a / 100) / 10;
  if (k < 100) return `${sign}${dec1.format(k)} mil`;
  const k0 = Math.round(a / 1000);
  if (k0 < 1000) return `${sign}${k0} mil`;
  return `${sign}${dec1.format(Math.round(a / 100_000) / 10)} mi`;
}

/** Versão curta para espaços pequenos: "R$ 0,82", "R$ 82", "R$ 1,2 mil" (o "R$" não se separa do número). */
export function formatBRLShort(n?: number | null) {
  return ok(n) ? `R$ ${formatCompact(n)}` : '—';
}

/** Faixa curta, sem a média: "R$ 5,50 – R$ 31". */
export function formatRange(min: number, max: number) {
  return `${formatBRLTight(min)} – ${formatBRLTight(max)}`;
}

/** Diferença em reais com sinal: "+R$ 52", "−R$ 12,50" (centavos só abaixo de R$ 100). */
export function formatSignedBRL(n: number) {
  const r = round2(n);
  return `${r > 0 ? '+' : r < 0 ? MINUS : ''}${formatBRLTight(Math.abs(r))}`;
}

/**
 * Rótulo do eixo de um gráfico: mais casas quando a variação é pequena (senão os rótulos se repetem). `ref` é o maior
 * valor do eixo: com ele, todos os rótulos do mesmo eixo saem no mesmo formato (sem ele, cada um decide pelo seu valor).
 */
export function formatBRLAxis(v: number, span: number, ref = Math.abs(v)) {
  if (span >= ref * 0.1) return formatBRLShort(v);
  if (span >= 10) return formatBRLWhole(v);
  return formatBRL(v);
}

/** Dólar no padrão brasileiro: "US$ 1.234,56". */
export function formatUSD(n?: number | null) {
  return ok(n) ? `US$ ${dec2.format(n)}` : '—';
}

/** Câmbio com 4 casas: "5,0383". */
export function formatRate(n?: number | null) {
  return ok(n) ? dec4.format(n) : '—';
}

/** Porcentagem: "1,2%"; com `sign`, "+1,2%" ou "−1,2%". */
export function formatPct(n: number, opts: { sign?: boolean; digits?: 0 | 1 } = {}) {
  const digits = opts.digits ?? 1;
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  const body = (digits ? dec1 : int0).format(Math.abs(r));
  const sign = !opts.sign ? (r < 0 ? MINUS : '') : r > 0 ? '+' : r < 0 ? MINUS : '';
  return `${sign}${body}%`;
}

/** Número inteiro com ponto de milhar: "1.234". */
export function formatInt(n: number) {
  return int0.format(n);
}

/** Valor para um campo de texto: 1500 → "1.500,00" (o parseBRL lê de volta). */
export function formatInput(n: number) {
  return dec2.format(n);
}

/** Maior valor aceito num campo de reais (R$ 99 milhões). */
const MAX_BRL = 99_999_999.99;

export type ParsedBRL = { value: number | undefined; error?: undefined } | { value?: undefined; error: string };

/**
 * Lê um valor digitado em reais no padrão brasileiro: vírgula para os centavos e ponto de milhar em grupos de 3.
 *   "1.500" → 1500 · "1.234.567,89" → 1234567,89 · "37,9" → 37,90 · "R$ 12" → 12
 *   "37.90" (ponto com 1 ou 2 casas, de teclado em inglês) → 37,90
 * Arredonda para centavos antes de conferir se é maior que zero ("0,004" é inválido). Vazio → { value: undefined };
 * texto inválido → { error } com a explicação, para a tela mostrar e não salvar.
 */
export function parseBRL(text: string): ParsedBRL {
  const t = text.replace(/r\$/i, '').replace(/[\s ]/g, '');
  if (!t) return { value: undefined };
  if (!/^[\d.,]+$/.test(t)) return { error: 'Use só números, como 1.500,00.' };
  const parts = t.split(',');
  if (parts.length > 2) return { error: 'Use uma vírgula só, antes dos centavos.' };
  let int: string;
  let dec = '';
  if (parts.length === 2) {
    [int, dec] = parts;
    if (dec.includes('.')) return { error: 'Depois da vírgula vêm só os centavos.' };
    if (int.includes('.')) {
      if (!/^\d{1,3}(\.\d{3})+$/.test(int)) return { error: 'O ponto separa os milhares, em grupos de 3 (1.500,00).' };
      int = int.replace(/\./g, '');
    }
  } else if (t.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) int = t.replace(/\./g, '');
    else if (/^\d+\.\d{1,2}$/.test(t)) [int, dec] = t.split('.');
    // "37." no meio da digitação.
    else if (/^\d+\.$/.test(t)) int = t.slice(0, -1);
    else return { error: 'O ponto separa os milhares, em grupos de 3 (1.500,00).' };
  } else int = t;
  int = int.replace(/^0+(?=\d)/, '') || '0';
  if (!/^\d*$/.test(dec)) return { error: 'Use só números, como 1.500,00.' };
  if (int.length > 9) return { error: 'Valor alto demais.' };
  // Centavos pelo texto (sem erro de arredondamento do ponto flutuante): a 3ª casa arredonda.
  const d = `${dec}000`.slice(0, 3);
  const cents = Number(int) * 100 + Number(d.slice(0, 2)) + (Number(d[2]) >= 5 ? 1 : 0);
  if (cents <= 0) return { error: 'O valor precisa ser maior que zero.' };
  const value = cents / 100;
  if (value > MAX_BRL) return { error: 'Valor alto demais.' };
  return { value };
}

/** Dia de uma data "AAAA-MM-DD" ou ISO, no fuso do aparelho ("AAAA-MM-DD" é lido como dia, sem fuso). */
function toDate(day: string | number | Date) {
  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }
  return new Date(day);
}

/** Data e hora curtas: "20/10, 06:05". */
export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Há quanto tempo, no fuso do aparelho: "agora mesmo" (< 1 min), "há 5 min", "há 2 h" (< 6 h), "hoje, 14:05",
 * "ontem, 14:05", senão "20/10, 06:05". Data inválida: "".
 */
export function formatAgo(iso: string, now = Date.now()) {
  const d = new Date(iso);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return '';
  const diff = now - ms;
  // Relógio do aparelho um pouco atrás do servidor: ainda é "agora".
  if (diff < MIN_MS && diff > -5 * MIN_MS) return 'agora mesmo';
  if (diff >= 0 && diff < HOUR_MS) return `há ${Math.floor(diff / MIN_MS)} min`;
  if (diff >= 0 && diff < 6 * HOUR_MS) return `há ${Math.floor(diff / HOUR_MS)} h`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diff >= 0 && ms >= today.getTime()) return `hoje, ${time}`;
  if (ms >= yesterday.getTime() && ms < today.getTime()) return `ontem, ${time}`;
  return formatWhen(iso);
}

/** Dia e mês: "20/10" (aceita "2026-10-20", ISO ou milissegundos). */
export function formatDay(day: string | number | Date) {
  return toDate(day).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Data completa: "20/10/2026". */
export function formatDate(day: string | number | Date) {
  return toDate(day).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/**
 * Data por extenso, para o leitor de tela: "22 de setembro de 2023" ("AAAA-MM-DD" é lido como dia, sem fuso). O dia 1
 * é "1º", como se escreve e se lê no Brasil ("primeiro de abril").
 */
export function formatDateSpoken(day: string | number | Date) {
  const d = toDate(day);
  const date = d.getDate();
  return `${date === 1 ? '1º' : date} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Mês e ano de um "AAAA-MM" (ou "AAAA-MM-DD"): "05/2007". */
export function formatMonth(month: string) {
  return `${month.slice(5, 7)}/${month.slice(0, 4)}`;
}

/** O mesmo mês para o leitor de tela: "maio de 2007". */
export function formatMonthSpoken(month: string) {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;
}

/** Anos: "1999", "1999–2003"; `to` null = série ainda aberta, "desde 2025". Anos iguais viram um só. */
export function formatYears(from: number, to?: number | null) {
  if (to === null) return `desde ${from}`;
  return to == null || to === from ? String(from) : `${from}–${to}`;
}

/** Os mesmos anos para o leitor de tela: "1999", "de 1999 a 2003", "desde 2025". */
export function formatYearsSpoken(from: number, to?: number | null) {
  if (to === null) return `desde ${from}`;
  return to == null || to === from ? String(from) : `de ${from} a ${to}`;
}
