// Liga o que foi lido na carta às linhas do índice da Consulta. Puro e sem rede: só consulta o índice já em memória.
import { getSpecies, POKEDEX } from '@/data/pokedex';
import { plainName as catalogPlainName } from '@/lib/catalog';

import type { CardNumber, CardReading, Dictionaries, OcrSpecies } from './card-ocr';
import { allowsLang, numberKeys } from './lookup-format';
import { lookupByCode, lookupByNumber, lookupHeader, searchTrainers, sectionCards } from './lookup-index';
import type { LookupCard, LookupHeader, LookupLang } from './lookup-types';
import { siblings } from './lookup-view';

export type MatchStatus = 'exact' | 'doubt' | 'none';
export type ScanMatch = { status: MatchStatus; candidates: LookupCard[]; lang: LookupLang | null; reasons: string[]; needsVersion: boolean; signals: number };
export type LotLang = 'auto' | 'pt' | 'en' | 'ja';

/** Motivo que faz a conferência perguntar o idioma. */
export const PT_OR_EN = 'PT ou EN sem pista na carta';
/** Número/total sozinho é sempre dúvida. */
const NUMBER_ONLY = 'Só o número';

const MAX_CANDIDATES = 8;
/** Siglas que aparecem em várias coleções: nunca decidem sozinhas. */
const WEAK_CODES = new Set(['PR', 'POP']);

let lastHeader: LookupHeader | null = null;
let lastDict: Dictionaries | null = null;

/**
 * Dicionários do leitor: nomes nas 6 línguas, siglas das coleções e da TCGdex e nomes da seção 0 (treinador e energia).
 * Calculados uma vez por cabeçalho do índice.
 */
export function ocrDictionaries(): Dictionaries {
  const h = lookupHeader();
  if (lastDict && h === lastHeader) return lastDict;
  const species: OcrSpecies[] = POKEDEX.map((s) => ({ id: s.id, names: [s.name, s.ja, s.ko, s.zhHant, s.zhHans].filter((n): n is string => !!n) }));
  const codes = new Set<string>();
  if (h) {
    for (const s of h.sets.values()) if (s.abbr) codes.add(s.abbr);
    for (const a of h.tdAbbr.values()) if (a) codes.add(a);
  }
  const dict: Dictionaries = { species, setCodes: [...codes], trainers: trainerNames() };
  lastHeader = h;
  lastDict = dict;
  return dict;
}

function trainerNames(): string[] {
  const names = new Set<string>();
  try {
    for (const c of sectionCards(0)) {
      names.add(c.name);
      if (c.ptName) names.add(c.ptName);
    }
  } catch {
    // Índice ainda fora da memória: lê sem os treinadores.
  }
  return [...names];
}

const shownNumber = (n: CardNumber) => (n.total ? `${n.left}/${n.total}` : n.left);
const readKeys = (n: CardNumber) => numberKeys({ number: shownNumber(n) });
const plainName = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Número forte o bastante para buscar sem a sigla: tem total ou prefixo próprio ("SWSH123"). */
const hasOwnIdentity = (n: CardNumber) => n.total != null || n.kind === 'promo';

function sameNumber(c: LookupCard, n: CardNumber) {
  const mine = new Set(readKeys(n));
  return numberKeys(c).some((k) => mine.has(k));
}

/**
 * A linha é desta espécie? A seção onde foi lida ou o nome, em palavra inteira (linha de duas espécies entra nas duas
 * seções; "Mew" não vale para "Mewtwo").
 */
function sameSpecies(c: LookupCard, dex: number) {
  if (c.dex === dex) return true;
  const s = getSpecies(dex);
  return !!s && ` ${catalogPlainName(c.name)} `.includes(` ${catalogPlainName(s.name)} `);
}

const sameTrainer = (c: LookupCard, name: string) => {
  const key = plainName(name);
  return plainName(c.name) === key || (!!c.ptName && plainName(c.ptName) === key);
};

const totalFits = (c: LookupCard, n: CardNumber) => {
  if (n.total == null) return true;
  if (c.set.total != null && String(c.set.total) === n.total.replace(/^0+(?=\d)/, '')) return true;
  return sameNumber(c, n);
};

/** Idioma da carta pelas pistas impressas. Carta coreana ou chinesa nunca vira japonesa, nem em lote de japonesas. */
function readingLang(r: CardReading, lot: LotLang): LookupLang | null {
  if (r.script === 'hangul') return 'ko';
  if (r.script === 'hanzi') return 'zh';
  if (lot !== 'auto') return lot;
  if (r.langTag === 'PT') return 'pt';
  if (r.langTag === 'EN') return 'en';
  if (r.hpWord === 'PS' || r.langWords === 'pt') return 'pt';
  if (r.hpWord === 'HP' && r.langWords === 'en') return 'en';
  return r.script === 'kana' ? 'ja' : null;
}

const unique = (cards: LookupCard[]) => [...new Map(cards.map((c) => [c.key, c])).values()];

/** `unsure`: o que impede de afirmar que é esta carta, mesmo com uma candidata só. */
type Found = { cards: LookupCard[]; usedCode: boolean; step: string; unsure?: string };

/** Os 6 passos, parando no primeiro que tiver resultado. */
function findCandidates(r: CardReading, fits: (c: LookupCard) => boolean): Found | null {
  const num = r.number;
  const dex = r.speciesId;
  if (r.setCode && num) {
    const weak = WEAK_CODES.has(r.setCode.toUpperCase());
    if (!weak || dex != null) {
      let cards = unique(readKeys(num).flatMap((k) => lookupByCode(r.setCode!, k))).filter(fits);
      if (weak) cards = cards.filter((c) => sameSpecies(c, dex!));
      // Sigla repetida em mais de uma coleção: confere o total e o nome.
      if (new Set(cards.map((c) => c.set.key)).size > 1) {
        const narrowed = cards.filter((c) => totalFits(c, num) && (dex == null || sameSpecies(c, dex)));
        if (narrowed.length) cards = narrowed;
      }
      if (cards.length) return { cards, usedCode: !weak, step: 'Sigla e número' };
    }
  }
  if (num && hasOwnIdentity(num)) {
    const cards = unique(readKeys(num).flatMap((k) => lookupByNumber(k))).filter(fits);
    const same = dex != null ? cards.filter((c) => sameSpecies(c, dex)) : r.name ? cards.filter((c) => sameTrainer(c, r.name!)) : [];
    if (same.length) return { cards: same, usedCode: false, step: dex != null ? 'Número e espécie' : 'Número e nome' };
    if (cards.length) return { cards, usedCode: false, step: NUMBER_ONLY, unsure: NUMBER_ONLY };
  }
  if (dex != null) {
    const section = sectionCards(dex).filter(fits);
    if (r.hp != null) {
      const cards = section.filter((c) => c.hp === r.hp);
      // Carta sem HP conhecido pode ser esta: a conta de "uma só" não fecha.
      const blind = section.some((c) => c.hp == null && !c.stamp);
      if (cards.length) return { cards, usedCode: false, step: 'Espécie e HP', unsure: blind ? 'Há cartas sem HP conhecido' : undefined };
    }
    if (section.length) return { cards: section, usedCode: false, step: 'Só a espécie' };
  }
  if (r.name) {
    const all = searchTrainers(r.name).filter(fits);
    const same = all.filter((c) => sameTrainer(c, r.name!));
    const cards = same.length ? same : all;
    if (cards.length) return { cards, usedCode: false, step: 'Nome do treinador' };
  }
  return null;
}

/** Sinais independentes (número com total, sigla, nome, HP) e contradições desta carta contra a leitura. */
function weigh(c: LookupCard, r: CardReading, usedCode: boolean) {
  let signals = 0;
  const against: string[] = [];
  // Linha sem número no índice não contradiz nada; a que tem outro número, sim (total lido errado, carta nova).
  if (r.number && hasOwnIdentity(r.number) && numberKeys(c).length) {
    if (sameNumber(c, r.number)) signals++;
    else against.push(`Número diferente: li ${shownNumber(r.number)}, a carta é ${c.number}`);
  }
  if (usedCode) signals++;
  if (r.speciesId != null) {
    if (sameSpecies(c, r.speciesId)) signals++;
    else against.push(`Outra espécie: li ${getSpecies(r.speciesId)?.name ?? `#${r.speciesId}`}`);
  } else if (r.name && sameTrainer(c, r.name)) signals++;
  if (r.hp != null && c.hp != null) {
    if (c.hp === r.hp) signals++;
    else against.push(`HP diferente: li ${r.hp}, a carta tem ${c.hp}`);
  }
  return { signals, against };
}

/** "LV.13" no complemento: separa as japonesas antigas com o mesmo nome. */
function byLevel(cards: LookupCard[], level: number | null) {
  if (level == null) return cards;
  const re = new RegExp(`\\bLV\\.?\\s?${level}\\b`, 'i');
  const same = cards.filter((c) => !!c.qualifier && re.test(c.qualifier));
  return same.length ? same : cards;
}

const yearOf = (c: LookupCard) => (c.year.kind === 'year' ? c.year.year : null);

/** O © é só dica: põe na frente quem bate o ano, sem tirar ninguém. */
function byYearHint(cards: LookupCard[], year: number | null) {
  if (year == null) return cards;
  return [...cards.filter((c) => yearOf(c) === year), ...cards.filter((c) => yearOf(c) !== year)];
}

const isJumbo = (c: LookupCard) => /jumbo/i.test(c.stamp ?? '');
const none = (lang: LookupLang | null, reasons: string[]): ScanMatch => ({ status: 'none', candidates: [], lang, reasons, needsVersion: false, signals: 0 });

/** Casa a leitura com o índice: `exact` = um produto sem selo, 2 sinais ou mais e nenhuma contradição. */
export function matchReading(r: CardReading, opts: { lotLang: LotLang }): ScanMatch {
  const lang = readingLang(r, opts.lotLang);
  const fits = (c: LookupCard) => (lang ? allowsLang(c, lang) : allowsLang(c, 'en') || allowsLang(c, 'pt'));
  const found = findCandidates(r, fits);
  if (!found) return none(lang, ['Nada no índice com o que foi lido']);

  // Selo não empata: vira opção de versão, com Jumbo por último.
  const plain = byYearHint(byLevel(found.cards.filter((c) => !c.stamp), r.level), r.year);
  const stamped = found.cards.filter((c) => c.stamp).sort((a, b) => Number(isJumbo(a)) - Number(isJumbo(b)));
  const contenders = plain.length ? plain : stamped;
  if (contenders.length > MAX_CANDIDATES) return none(lang, [`${found.step}: ${contenders.length} cartas, mais de ${MAX_CANDIDATES}`]);

  const first = contenders[0];
  const { signals, against } = weigh(first, r, found.usedCode);
  const reasons = [found.step, ...against];

  if (found.unsure && found.unsure !== found.step) reasons.push(found.unsure);

  // Latino sem pista: PT × EN fica para o dono, com PT pré-escolhido se a carta tem PT confirmada.
  const pickable = lang == null && contenders.some((c) => allowsLang(c, 'pt') && allowsLang(c, 'en'));
  const chosenLang: LookupLang | null = lang ?? (contenders.some((c) => c.marks.includes('p')) ? 'pt' : 'en');
  if (pickable) reasons.push(PT_OR_EN);
  const strangeTag = !!r.langTag && r.langTag !== 'PT' && r.langTag !== 'EN';
  if (strangeTag) reasons.push(`Etiqueta ${r.langTag}: idioma fora do app`);

  // Lote de japonesas pula a detecção; sem kana na leitura pode ser coreana ou chinesa, que nunca viram japonesa.
  const unconfirmedJa = lang === 'ja' && r.script !== 'kana';
  if (unconfirmedJa) reasons.push('Sem kana na leitura: confira se é japonesa');

  const exact = plain.length === 1 && signals >= 2 && !against.length && !pickable && !strangeTag && !found.unsure && !unconfirmedJa;
  const versions = plain.length ? siblings(first, stamped) : [];
  return {
    status: exact ? 'exact' : 'doubt',
    candidates: [...plain, ...stamped],
    lang: chosenLang,
    reasons,
    needsVersion: first.prints.length > 1 || versions.length > 0,
    signals,
  };
}

/** Texto para o campo da Consulta, com o que foi lido: `umbreon 110 070/108`. */
export function readingQuery(p: { dex: number | null; name: string | null; hp: number | null; number: CardNumber | null }): string {
  const name = (p.dex != null ? getSpecies(p.dex)?.name : null) ?? p.name;
  return [name?.toLowerCase(), p.hp != null ? String(p.hp) : null, p.number ? shownNumber(p.number) : null].filter(Boolean).join(' ');
}

/**
 * O que vai para o campo da Consulta: sem resultado com tudo, tira o número e depois o HP, e avisa o que saiu.
 * O chip de idioma ligado restringe a conta; sem ele, olha todas as cartas da espécie.
 */
export function relaxedQuery(p: { dex: number | null; name: string | null; hp: number | null; number: CardNumber | null }, lang: LookupLang | null): { text: string; dropped: string | null } {
  if (p.dex == null || (p.hp == null && !p.number)) return { text: readingQuery(p), dropped: null };
  const cards = sectionCards(p.dex).filter((c) => !lang || allowsLang(c, lang));
  const has = (hp: number | null, number: CardNumber | null) => cards.some((c) => (hp == null || c.hp === hp) && (!number || sameNumber(c, number)));
  if (!cards.length || has(p.hp, p.number)) return { text: readingQuery(p), dropped: null };
  const noNumber = p.number ? `Sem o nº lido (${shownNumber(p.number)})` : null;
  if (p.hp != null && has(p.hp, null)) return { text: readingQuery({ ...p, number: null }), dropped: noNumber };
  const noHp = p.hp != null ? `Sem o HP lido (${p.hp})` : null;
  return { text: readingQuery({ ...p, number: null, hp: null }), dropped: [noNumber, noHp].filter(Boolean).join(' · ') || null };
}

/** Aviso curto do que foi lido: "Lido: Umbreon · HP 110". */
export function readingNote(p: { dex: number | null; name: string | null; hp: number | null; number: CardNumber | null }): string {
  const name = (p.dex != null ? getSpecies(p.dex)?.name : null) ?? p.name;
  const parts = [name, p.hp != null ? `HP ${p.hp}` : null, p.number ? shownNumber(p.number) : null].filter(Boolean);
  return parts.length ? `Lido: ${parts.join(' · ')}` : 'Não consegui ler o nome da carta';
}
