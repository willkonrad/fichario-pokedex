// Linhas e cabeçalho de exemplo da Consulta (só o que cada teste muda aparece nele).

import { parseHeader } from '@/lib/lookup-format';
import type { LookupCard, LookupHeader, LookupPrint, LookupSet, PrintCode } from '@/lib/lookup-types';

export const RAW_HEADER = {
  v: 1,
  prices: '2026-11-08',
  fx: ['2026-11-06', 5.5],
  sets: {
    '604': ['en', 'Base Set', 'BS', '1999-01-09', 102, 0, 0],
    '23353': ['ja', 'Crimson Haze', 'SV5a', '2024-03-22', 66, 0, 0, '2026-11-07'],
    '1938': ['en', 'SV: Scarlet & Violet Promo Cards', 'SVP', '2023-03-31', 0, 2023, 2025],
    '3000': ['en', 'ME: Mega Evolution Promo', 'MEP', '2025-09-26', 0, 2025, 0],
    'pt:sv03': ['pt', 'Obsidiana em Chamas', 'OBF', '2023-08-11', 197, 0, 0],
    'zh-tw:SV5K': ['zh-tw', '狂野之力', 'SV5K', '2024-01-26', 71, 0, 0],
    'zh-cn:CSM1': ['zh-cn', '星之伙伴', 'CSM1', '', 0, 0, 0],
  },
  td: { base1: 'BS', sv03: 'OBF', '30th-c': 'CCC' },
  only: [['ko', 'Coleção sem lista', '2024-07-01', 60]],
  limits: { ko: '2024-06', zh: '2025-05' },
};

export const header = (over: Record<string, unknown> = {}): LookupHeader => parseHeader(JSON.stringify({ ...RAW_HEADER, ...over }));

export function lookupSet(over: Partial<LookupSet> = {}): LookupSet {
  return { key: '604', lang: 'en', name: 'Base Set', abbr: 'BS', date: '1999-01-09', total: 102, yearFrom: null, yearTo: null, pricesDay: null, ...over };
}

export const jaSet = (over: Partial<LookupSet> = {}) => lookupSet({ key: '23353', lang: 'ja', name: 'Crimson Haze', abbr: 'SV5a', date: '2024-03-22', total: 66, ...over });
export const zhSet = (over: Partial<LookupSet> = {}) => lookupSet({ key: 'zh-tw:SV5K', lang: 'zh-tw', name: '狂野之力', abbr: 'SV5K', date: '2024-01-26', total: 71, ...over });

export function print(code: PrintCode, market: number | null, low: number | null = market, mid: number | null = market): LookupPrint {
  return { code, low, mid, market };
}

/** Charizard do Base Set, EN + PT, HP 120, Holo a US$ 100,00. */
export function lookupCard(over: Partial<LookupCard> = {}): LookupCard {
  return {
    key: '42382',
    productId: 42382,
    set: lookupSet(),
    name: 'Charizard',
    number: '4/102',
    rarity: 'Holo Rare',
    hp: 120,
    hpFromTwin: false,
    cardType: 'Fire',
    stage: 'Stage 2',
    tcgdexId: 'base1-4',
    prints: [print('H', 10000, 9000, 9500)],
    marks: 'ep',
    year: { kind: 'year', year: 1999, origin: 'set' },
    dex: 6,
    ...over,
  };
}

/** Linha japonesa: Umbreon do tipo que a Consulta mostra em JP e KO. */
export function jaCard(over: Partial<LookupCard> = {}): LookupCard {
  return lookupCard({
    key: '567024',
    productId: 567024,
    set: jaSet(),
    name: 'Umbreon',
    number: '070/108',
    rarity: 'Common',
    hp: 110,
    tcgdexId: undefined,
    prints: [print('N', 700, 500, 600)],
    marks: 'j',
    year: { kind: 'year', year: 2024, origin: 'set' },
    dex: 197,
    ...over,
  });
}

/** Linha zh-tw com gêmea japonesa única. */
export function zhCard(over: Partial<LookupCard> = {}): LookupCard {
  return lookupCard({
    key: 't:zh-tw:SV5K-001',
    productId: null,
    set: zhSet(),
    name: '毒薔薇',
    number: '001/071',
    rarity: undefined,
    hp: 60,
    hpFromTwin: true,
    tcgdexId: 'SV5K-001',
    prints: [],
    marks: 't',
    twinProductId: 568335,
    year: { kind: 'year', year: 2024, origin: 'japan' },
    dex: 315,
    ...over,
  });
}
