import raw from '@/data/pokedex.json';
import { searchSpeciesList, searchSpeciesRanked, speciesKey, type Species } from '@/data/pokedex';

// Busca de espécies: acrescenta coreano e chinês sem mudar nenhum resultado em português, inglês e japonês.

const REAL = raw as Species[];

/** A regra de antes, escrita à parte: é o que a busca precisa continuar devolvendo. */
function legacySearch(query: string, max = 8): Species[] {
  const q = query.trim().replace(/^#/, '');
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const s = REAL[Number(q) - 1];
    return s ? [s] : [];
  }
  // Mudança de propósito: com letra japonesa, coreana ou chinesa, o pedaço latino não é nome ("ニドラン♀" não acha os
  // Pokémon com F, "リザードンex" não é Exeggutor).
  const key = /[぀-ヿ㐀-鿿가-힯]/.test(q) ? '' : speciesKey(q);
  const ja = q.normalize('NFC');
  const ranked: Species[][] = [[], [], [], []];
  for (const s of REAL) {
    const k = speciesKey(s.name);
    const base = speciesKey(s.name.replace(/[♀♂]/g, ''));
    const extra = s.name.includes('♀') ? [`${base}femea`, `${base}female`] : s.name.includes('♂') ? [`${base}macho`, `${base}male`] : [];
    const keys = [k, ...extra];
    if (key && keys.includes(key)) ranked[0].push(s);
    else if (s.ja === ja) ranked[0].push(s);
    else if (key && keys.some((x) => x.startsWith(key))) ranked[1].push(s);
    else if (s.ja.startsWith(ja)) ranked[2].push(s);
    else if ((key.length >= 2 && keys.some((x) => x.includes(key))) || s.ja.includes(ja)) ranked[3].push(s);
  }
  return ranked.flat().slice(0, max);
}

const ids = (list: Species[]) => list.map((s) => s.id);

describe('a busca antiga não muda', () => {
  const samples = (name: string) => [name, name.slice(0, 1), name.slice(0, 2), name.slice(0, 3), name.slice(1, 4), name.slice(-2)];

  it('todos os nomes em inglês e pedaços deles', () => {
    for (const s of REAL) for (const q of samples(s.name)) expect([q, ids(searchSpeciesList(q))]).toEqual([q, ids(legacySearch(q))]);
  });

  it('todos os nomes em japonês e pedaços deles', () => {
    for (const s of REAL) for (const q of samples(s.ja)) expect([q, ids(searchSpeciesList(q))]).toEqual([q, ids(legacySearch(q))]);
  });

  it.each(['25', '#25', '#025', '0', '9999', 'farfetchd', "farfetch'd", 'flabebe', 'mr mime', 'ho oh', 'porygon z', 'type null', 'nidoran macho', 'nidoran femea', 'nidoran♀', 'nidoran ♂', ''])(
    'casos do app: "%s"',
    (q) => {
      expect(ids(searchSpeciesList(q))).toEqual(ids(legacySearch(q)));
    },
  );

  it('limite de resultados igual', () => {
    expect(ids(searchSpeciesList('a', 3))).toEqual(ids(legacySearch('a', 3)));
    expect(ids(searchSpeciesList('a', 30))).toEqual(ids(legacySearch('a', 30)));
  });

  it('a lista ranqueada traz a mesma ordem e o quanto cada um combina', () => {
    expect(searchSpeciesRanked('pikachu', 1)[0]).toMatchObject({ species: { id: 25 }, rank: 0 });
    expect(searchSpeciesRanked('pika', 1)[0]).toMatchObject({ species: { id: 25 }, rank: 1 });
    expect(searchSpeciesRanked('ピカチュウ', 1)[0]).toMatchObject({ species: { id: 25 }, rank: 0 });
    expect(searchSpeciesRanked('25', 1)[0]).toMatchObject({ species: { id: 25 }, rank: 0 });
  });
});

describe('busca nova: coreano e chinês', () => {
  const FAKE: Species[] = [
    { id: 1, name: 'Bulbasaur', ja: 'フシギダネ', ko: '이상해씨', zhHant: '妙蛙種子', zhHans: '妙蛙种子' },
    { id: 2, name: 'Ivysaur', ja: 'フシギソウ', ko: '이상해풀', zhHant: '妙蛙草', zhHans: '妙蛙草' },
    { id: 3, name: 'Venusaur', ja: 'フシギバナ' },
  ];

  function fake() {
    let mod!: typeof import('@/data/pokedex');
    jest.isolateModules(() => {
      jest.doMock('@/data/pokedex.json', () => FAKE);
      mod = jest.requireActual('@/data/pokedex');
    });
    jest.dontMock('@/data/pokedex.json');
    return mod;
  }

  it('nome igual em coreano e nas duas escritas do chinês', () => {
    const { searchSpeciesRanked: ranked } = fake();
    expect(ranked('이상해씨')[0]).toMatchObject({ species: { id: 1 }, rank: 0 });
    expect(ranked('妙蛙種子')[0]).toMatchObject({ species: { id: 1 }, rank: 0 });
    expect(ranked('妙蛙种子')[0]).toMatchObject({ species: { id: 1 }, rank: 0 });
  });

  it('começo do nome e parte dele', () => {
    const { searchSpeciesRanked: ranked } = fake();
    expect(ranked('이상해').map((h) => [h.species.id, h.rank])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(ranked('蛙').map((h) => h.rank)).toEqual([3, 3]);
  });

  it('espécie sem o nome nesses idiomas não atrapalha', () => {
    expect(fake().searchSpeciesList('妙蛙').map((s) => s.id)).toEqual([1, 2]);
  });

  it('nome latino não olha as colunas novas', () => {
    expect(fake().searchSpeciesList('bulba').map((s) => s.id)).toEqual([1]);
  });
});
