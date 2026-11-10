// Pokémon pelo nome da carta (speciesInCardName) e busca de Pokémon com o nome em japonês, coreano ou chinês colado ao
// final ou ao começo (searchSpeciesRanked, splitNameAffixes). Dados reais da Pokédex.
import { searchSpeciesRanked, speciesInCardName, splitNameAffixes } from '@/data/pokedex';
import { buildNewEntry, type Destination } from '@/lib/add-card';
import type { CardBrief } from '@/lib/tcgdex';

jest.mock('@/store/collection', () => ({
  entryId: (dex: number, slot: number) => `${dex}-${slot}`,
  customEntryId: (binderId: string, slot: number) => `${binderId}:${slot}`,
}));

const dexOf = (name: string) => speciesInCardName(name)?.id;
const top = (q: string) => searchSpeciesRanked(q, 3).map((h) => [h.species.id, h.rank]);

describe('speciesInCardName', () => {
  it.each([
    // Grafias do catálogo (TCGplayer e TCGdex) para os Nidoran e o Flabébé.
    ['Nidoran F', 29],
    ['Nidoran M', 32],
    ['NidoranF', 29],
    ['NidoranM', 32],
    ['Nidoran♀', 29],
    ['Nidoran ♂', 32],
    ["Team Rocket's Nidoran F", 29],
    ['Flabebe', 669],
    ['Flabébé', 669],
    // O que já funcionava continua.
    ['Nidorina da Equipe Rocket', 30],
    ["Giovanni's Nidorina", 30],
    ['Mega Charizard X ex', 6],
    ['Charizard-GX', 6],
    ['Mewtwo', 150],
    ['Mew ex', 151],
    ['Porygon-Z', 474],
    ['Porygon2', 233],
    ['Ho-Oh ex', 250],
    ['Mr. Mime', 122],
    ['Galarian Mr. Mime', 122],
    ['Mime Jr.', 439],
    ['Type: Null', 772],
    ['Tapu Koko-GX', 785],
    ["Farfetch’d", 83],
    ["Sirfetch'd V", 865],
    ['Chi-Yu ex', 1004],
    ['Pikachu & Zekrom-GX', 25],
    // Nome em japonês: o mais longo contido.
    ['リザードンex', 6],
    ['レアコイル', 82],
    ['ロケット団のコイル', 81],
    ['ミュウツーGX', 150],
  ])('%s → #%i', (name, dex) => {
    expect(dexOf(name)).toBe(dex);
  });

  it('treinador, energia e nome sem Pokémon: nenhum', () => {
    expect(dexOf('Professor’s Research')).toBeUndefined();
    expect(dexOf('Basic Fire Energy')).toBeUndefined();
    expect(dexOf('Nidoran')).toBeUndefined();
  });

  it('no fichário livre, a carta do catálogo com "Nidoran F" fica com o Pokémon dela (não dex 0)', () => {
    const card: CardBrief = { id: 'tcgp-500200', localId: '', name: 'NidoranF', lang: 'ja', setId: 'tcgp604', setName: 'Expansion Pack', setNameEn: 'Expansion Pack', setOrder: 19961020 };
    const dest: Destination = { key: 'binder:b1', kind: 'binder', binderId: 'b1', dex: 0, slot: 0, title: 'Trocas', detail: '', where: '' };
    expect(buildNewEntry({ card, facts: null, version: null, condition: 'NM', dest }).dex).toBe(29);
  });
});

describe('busca de Pokémon com o nome asiático colado ao final ou ao começo', () => {
  it.each([
    ['リザードンex', 6],
    ['ミュウex', 151],
    ['리자몽ex', 6],
    ['噴火龍ex', 6],
    ['リザードンV', 6],
    ['ピカチュウV', 25],
    ['리자몽V', 6],
    ['リザードンGX', 6],
    ['リザードンVMAX', 6],
    ['メガリザードンXex', 6],
    ['かがやくリザードン', 6],
    // Meia-largura e hiragana.
    ['ﾘｻﾞｰﾄﾞﾝ', 6],
    ['りざーどん', 6],
  ])('%s → #%i, nome igual', (q, dex) => {
    expect(top(q)[0]).toEqual([dex, 0]);
  });

  it('o pedaço latino de um nome asiático não acha outro Pokémon (Exeggutor, Vulpix)', () => {
    for (const q of ['リザードンex', '리자몽ex', '噴火龍ex', 'リザードンV', 'ピカチュウV']) {
      expect(searchSpeciesRanked(q, 24).map((h) => h.species.id)).not.toEqual(expect.arrayContaining([103]));
      expect(searchSpeciesRanked(q, 24).map((h) => h.species.id)).not.toEqual(expect.arrayContaining([37]));
    }
  });

  it('nome que começa com メガ continua sendo ele (Meganium, Yanmega)', () => {
    expect(top('メガニウム')[0]).toEqual([154, 0]);
    expect(top('メガヤンマ')[0]).toEqual([469, 0]);
  });

  it('texto latino não muda: "ex" acha Exeggcute e Exeggutor; "Charizard ex" não é nome', () => {
    expect(searchSpeciesRanked('ex', 3).map((h) => h.species.id)).toEqual(expect.arrayContaining([102, 103]));
    expect(searchSpeciesRanked('charizard', 1)[0]).toMatchObject({ species: { id: 6 }, rank: 0 });
  });

  it('splitNameAffixes: o final e o começo colados viram palavras à parte', () => {
    expect(splitNameAffixes('リザードンex')).toBe('リザードン ex');
    expect(splitNameAffixes('メガリザードンXex')).toBe('mega リザードン X ex');
    expect(splitNameAffixes('かがやくリザードン')).toBe('radiant リザードン');
    expect(splitNameAffixes('리자몽VMAX 070/108')).toBe('리자몽 VMAX 070/108');
    expect(splitNameAffixes('ﾘｻﾞｰﾄﾞﾝ')).toBe('リザードン');
    // Sem letra asiática, nada muda; o "Z" do nome japonês do Porygon-Z fica.
    expect(splitNameAffixes('Charizard ex')).toBe('Charizard ex');
    expect(splitNameAffixes('ポリゴンZ')).toBe('ポリゴンZ');
    // Nome que já começa com メガ: é o próprio Pokémon (Meganium).
    expect(splitNameAffixes('メガニウム')).toBe('メガニウム');
    expect(splitNameAffixes('メガヤンマex')).toBe('メガヤンマ ex');
  });
});
