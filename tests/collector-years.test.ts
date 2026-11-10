// O app espelha as sementes year_range e year_mixed de lookup_overrides (supabase/schema.sql) em src/lib/collector.ts:
// este teste falha quando um lado muda sem o outro. O schema liga os grupos pelo nome; os ids do espelho foram conferidos
// no banco uma vez.
import { PROMO_GROUP_YEARS, PROMO_SETS, YEAR_MIXED_GROUPS } from '@/lib/collector';
import { catalogYearsFix } from '@/lib/tcgdex';

declare const __dirname: string;
const { readFileSync } = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');
const schema = readFileSync(`${__dirname}/../supabase/schema.sql`, 'utf8').replace(/\r\n/g, '\n');

/** Textos SQL entre aspas simples ('' = aspa). */
const sqlStrings = (s: string) => [...s.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));

describe('year_range: séries de promos', () => {
  const block = /select 'year_range', g\.group_id::text, v\.years[\s\S]*?from \(values\n([\s\S]*?)\n\) as v\(category, name, years\)/.exec(schema)?.[1] ?? '';
  const seeds = [...block.matchAll(/\((\d+), '((?:[^']|'')*)', '([^']*)'\)/g)].map((m) => ({
    category: Number(m[1]),
    name: m[2].replace(/''/g, "'"),
    years: m[3],
  }));

  it('as tuplas do schema = PROMO_GROUP_YEARS (categoria, nome, anos e quantidade)', () => {
    expect(seeds).toHaveLength(20);
    const mirror = Object.values(PROMO_GROUP_YEARS).map((g) => ({ category: g.category, name: g.name, years: `${g.from}-${g.to ?? ''}` }));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    expect([...mirror].sort(byName)).toEqual([...seeds].sort(byName));
  });

  it('o Japanese CD Promo (24568) do schema é o GROUP_YEARS do app (1998–1999)', () => {
    expect(schema).toMatch(/select 'year_range', g\.group_id::text, '1998-1999'[\s\S]*?g\.category = 85 and g\.group_id = 24568/);
    expect(catalogYearsFix(24568)).toEqual({ from: 1998, to: 1999 });
    expect(PROMO_GROUP_YEARS[24568]).toBeUndefined();
  });
});

describe('year_mixed: coleções de tudo um pouco', () => {
  it('os nomes do schema = YEAR_MIXED_GROUPS (categoria 3)', () => {
    const seed = /select 'year_mixed', g\.group_id::text[\s\S]*?where g\.category = (\d+) and g\.name in \(([\s\S]*?)\)\s*on conflict/.exec(schema);
    expect(seed?.[1]).toBe('3');
    const names = sqlStrings(seed?.[2] ?? '');
    expect(names).toHaveLength(9);
    expect([...Object.values(YEAR_MIXED_GROUPS)].sort()).toEqual([...names].sort());
  });
});

describe('PROMO_SETS', () => {
  it('cada coleção de promos aponta para uma série do espelho, inclusive SV-P e M-P', () => {
    for (const [set, group] of Object.entries(PROMO_SETS)) expect([set, PROMO_GROUP_YEARS[group]?.name]).toEqual([set, expect.any(String)]);
    expect(PROMO_GROUP_YEARS[PROMO_SETS['SV-P']]).toMatchObject({ category: 85, name: 'SV-P Promotional Cards' });
    expect(PROMO_GROUP_YEARS[PROMO_SETS['M-P']]).toMatchObject({ category: 85, name: 'M-P Promotional Cards' });
    expect(PROMO_GROUP_YEARS[PROMO_SETS.basep]).toMatchObject({ category: 3, name: 'WoTC Promo', from: 1999, to: 2003 });
  });

  it('nenhum grupo é ao mesmo tempo série de promos e de tudo um pouco', () => {
    for (const id of Object.keys(YEAR_MIXED_GROUPS)) expect(PROMO_GROUP_YEARS[Number(id)]).toBeUndefined();
  });
});
