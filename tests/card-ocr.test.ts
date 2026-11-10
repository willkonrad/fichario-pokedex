// Leitor de OCR: os 15 casos do protótipo (texto impresso de cartas reais, com as quebras que o OCR faz), o print de tela
// e as leituras reais de tests/fixtures/ocr/.
import { POKEDEX } from '@/data/pokedex';
import { chainStep, digits, findYear, isStable, pageScript, printLang, readCard as rawRead, readingKey, readPrint, toRows, type CardReading, type Dictionaries, type OcrLine, type OcrPage } from '@/lib/card-ocr';

// O projeto não instala @types/node: só o que o teste usa.
declare const __dirname: string;
const { readdirSync, readFileSync } = jest.requireActual<{ readdirSync(path: string): string[]; readFileSync(path: string, encoding: 'utf8'): string }>('fs');
const { join } = jest.requireActual<{ join(...parts: string[]): string }>('path');

const dict: Dictionaries = {
  species: POKEDEX.map((s) => ({ id: s.id, names: [s.name, s.ja] })),
  setCodes: ['SVI', 'OBF', 'm6a', 'SV5K', 'SWSH12', 'MEW', 'PAL'],
  trainers: ["Professor's Research", 'Ultra Ball'],
};

const CARD_H = 1800;
const CARD_W = 1290;

/** Monta uma "página" com a geometria de uma carta: [texto, y em %, x em %, altura em px]. */
function page(rows: [string, number, number?, number?][], angle = 0): OcrPage {
  const lines: OcrLine[] = rows.map(([text, y, x = 8, h = 24]) => ({ text, box: { x: (x / 100) * CARD_W, y: (y / 100) * CARD_H, w: Math.min(900, text.length * h * 0.55), h }, angle }));
  return { width: CARD_W, height: CARD_H, lines };
}

const readCard = (p: OcrPage) => rawRead(p, dict);

function summary(r: CardReading) {
  return { ...r, num: r.number ? `${r.number.left}/${r.number.total ?? ''}` : null };
}

describe('linha "Evolves from" junto com o estágio', () => {
  // O nome da carta se perdeu (brilho): a linha que sobra fala da pré-evolução, e ela não é a carta.
  const lost = page([['STAGE 2 Evolves from Charmeleon', 5, 8, 30], ['120 HP', 9, 65, 42], ['4/102', 95.5, 86, 18]]);

  it('na carta, não vira a espécie', () => {
    expect(readCard(lost).speciesId).toBeNull();
  });

  it('no print, também não', () => {
    expect(readPrint(lost, dict).dex).toBeNull();
  });
});

describe('os 15 casos do protótipo', () => {
  const cases: [string, OcrPage, Record<string, unknown>][] = [
    [
      'EN SV: Toedscool 025/198 SVI EN',
      page([['BASIC', 3, 3, 26], ['Toedscool', 4, 20, 60], ['HP', 5, 76, 20], ['60', 4.5, 82, 66], ['NO. 0948 Woodear Pokémon HT: 2\'11" WT: 72.8 lbs.', 48, 20, 22], ['Spore', 61, 30, 40], ["Your opponent's Active Pokémon is now Asleep.", 65, 8, 28], ['Ram', 73, 30, 40], ['10', 73, 85, 40], ['weakness x2', 87, 5, 20], ['resistance', 87, 30, 20], ['retreat', 87, 60, 20], ['Illus. Tika Matsuno', 91.5, 5, 18], ['Though it looks like Tentacool, Toedscool is a', 90.5, 45, 20], ['G SVIEN 025/198', 94.5, 3, 22], ['©2023 Pokémon / Nintendo / Creatures / GAME FREAK', 97.5, 30, 16]]),
      { name: 'Toedscool', speciesId: 948, hp: 60, num: '025/198', setCode: 'SVI', langTag: 'EN', regulation: 'G', year: 2023 },
    ],
    [
      'PT SV: PS 60, SVI PT',
      page([['BÁSICO', 3, 3, 26], ['Toedscool', 4, 20, 60], ['PS60', 4.5, 76, 66], ['Nº 0948 Pokémon Orelha-de-madeira Altura: 0,9 m Peso: 33,0 kg', 48, 15, 22], ['Esporos', 61, 30, 40], ['Ilust. Tika Matsuno', 91.5, 5, 18], ['G SVI PT 025/198', 94.5, 3, 22], ['©2023 Pokémon/Nintendo/Creatures/GAME FREAK', 97.5, 30, 16]]),
      { hp: 60, num: '025/198', setCode: 'SVI', langTag: 'PT', regulation: 'G', year: 2023, speciesId: 948 },
    ],
    [
      'Base Charizard: 120 HP, 4/102, ©1995, 96, 98',
      page([['STAGE 2', 7, 10, 18], ['Evolves from Charmeleon Put Charizard on the Stage 1 card', 5, 22, 18], ['Charizard', 9, 27, 50], ['120 HP', 9, 65, 42], ['Flame Pokémon. Length: 5\' 7", Weight: 200 lbs.', 55, 20, 20], ['Pokémon Power: Energy Burn As often as you', 59, 15, 26], ['Fire Spin Discard 2 Energy cards', 73, 22, 32], ['100', 75, 85, 60], ['weakness', 83, 10, 18], ['resistance', 83, 42, 18], ['retreat cost', 83, 75, 18], ['-30', 85, 52, 20], ['Spits fire that is hot enough to melt boulders. Known to', 89.5, 12, 20], ['unintentionally cause forest fires. LV. 76 #6', 92, 12, 20], ['Illus. Mitsuhiro Arita', 95.5, 6, 14], ['©1995, 96, 98 Nintendo, Creatures, GAMEFREAK.', 95.5, 36, 14], ['4/102', 95.5, 86, 18]]),
      { name: 'Charizard', speciesId: 6, hp: 120, num: '4/102', year: 1998, level: 76 },
    ],
    [
      'JP moderna: ピカチュウ HP40 M6a 136/103',
      page([['ピカチュウ', 8, 12, 60], ['LV.12', 9.5, 60, 18], ['HP40', 9, 70, 40], ['ねずみポケモン:身長0.4m、体重6Kg', 57, 26, 22], ['かじる', 64, 41, 40], ['10', 64, 83, 40], ['でんげき', 71, 41, 40], ['30', 73, 83, 40], ['にげる', 81, 41, 20], ['弱点', 86, 20, 20], ['M6a 136/103', 95.5, 9, 22], ['Illus.Mitsuhiro Arita', 96, 71, 14], ['©2026 Pokémon/Nintendo/Creatures/GAME FREAK', 98.5, 30, 12]]),
      { name: 'ピカチュウ', speciesId: 25, hp: 40, num: '136/103', setCode: 'm6a', year: 2026, level: 12, script: 'kana' },
    ],
    [
      'JP promo: G PROMO 001/SV-P',
      page([['たね', 4, 8, 24], ['ピカチュウ', 6.5, 20, 56], ['HP60', 6.5, 76, 56], ['みんなでぼうけん', 63, 33, 40], ['30+', 63, 85, 40], ['弱点', 87, 6, 18], ['G PROMO 001/SV-P', 95.5, 3, 22], ['©2022 Pokémon/Nintendo/Creatures/GAME FREAK.', 98.5, 30, 12]]),
      { speciesId: 25, hp: 60, num: '001/SV-P', regulation: 'G', year: 2022 },
    ],
    [
      'EN TG: D TG05/TG30',
      page([['BASIC', 5, 5, 26], ['Zekrom', 6, 20, 56], ['HP 130', 7, 74, 50], ['Slash', 60, 32, 36], ['30', 60, 88, 40], ['This Pokémon also does 60 damage to itself. Your', 73, 8, 28], ['weakness x2', 87, 6, 20], ['D TG05/TG30', 95, 15, 22], ['©2022 Pokémon / Nintendo / Creatures / GAME FREAK', 98.5, 30, 12]]),
      { name: 'Zekrom', speciesId: 644, hp: 130, num: 'TG05/TG30', regulation: 'D', year: 2022 },
    ],
    [
      'ZH-TW: 毒薔薇 HP60 sv5K F 001/071',
      page([['基礎', 4, 5, 24], ['毒薔薇', 6, 18, 56], ['HP60', 6, 74, 56], ['全國圖鑑No.0315 荊棘寶可夢 身高:0.3m 體重:2.0kg', 48.5, 20, 20], ['特性 毒刺', 55, 8, 36], ['綠葉舞步', 70, 32, 36], ['10', 70, 88, 40], ['H sv5K F 001/071 C', 94.5, 5, 22], ['©2024 Pokémon/Nintendo/Creatures/GAME FREAK.', 98.5, 30, 12]]),
      { speciesId: 315, hp: 60, num: '001/071', setCode: 'SV5K', regulation: 'H', year: 2024, script: 'hanzi' },
    ],
    [
      'Latino lendo carta asiática: nome vira lixo, sobra número e Pokédex',
      page([['Fia', 6, 18, 56], ['HP60', 6, 74, 56], ['No.0315', 48.5, 20, 20], ['10', 70, 88, 40], ['H sv5K F 001/071 C', 94.5, 5, 22]]),
      { speciesId: 315, speciesFrom: 'pokedex', hp: 60, num: '001/071', setCode: 'SV5K', regulation: 'H' },
    ],
    [
      'Promo EN: SWSH123',
      page([['BASIC', 5, 5, 26], ['Pikachu V', 6, 20, 56], ['HP 190', 7, 74, 50], ['Thunderbolt', 60, 32, 36], ['200', 60, 88, 40], ['SWSH123', 95, 8, 22], ['©2021 Pokémon / Nintendo / Creatures / GAME FREAK', 98.5, 30, 12]]),
      { name: 'Pikachu V', speciesId: 25, hp: 190, num: 'SWSH123/', year: 2021 },
    ],
    [
      'JP antiga sem número: nome e HP bastam',
      page([['リザードン', 7, 15, 56], ['HP120', 7, 70, 50], ['かえんポケモン', 55, 26, 22], ['ほのおのうず', 73, 30, 34], ['100', 74, 85, 50]]),
      { name: 'リザードン', speciesId: 6, hp: 120, num: null },
    ],
    [
      'Erros típicos: 070/108 lido como O7O|1O8, HP lido com O',
      page([['BASIC', 3, 3, 26], ['Umbreon', 4, 20, 60], ['HP 11O', 5, 76, 50], ['Dark Bite', 60, 30, 40], ['O7O|1O8', 95, 8, 22]]),
      { name: 'Umbreon', speciesId: 197, hp: 110, num: '070/108' },
    ],
    [
      'Nome com erro de leitura (distância 1) e prefixo',
      page([['STAGE 2', 3, 3, 26], ['Charizaro ex', 4, 20, 60], ['HP 330', 5, 74, 50], ['Burning Darkness', 62, 30, 40], ['G OBFEN 125/197', 95, 3, 22]]),
      { speciesId: 6, hp: 330, num: '125/197', setCode: 'OBF', langTag: 'EN' },
    ],
    ['Barra lida como 1', page([['Mew', 5, 20, 60], ['HP 60', 5, 76, 50], ['0701108', 95, 8, 22]]), { num: '070/108' }],
    ['Foto com carta inclinada 12 graus', page([['Pikachu', 5, 20, 60], ['HP 60', 5, 76, 50], ['Gnaw', 60, 30, 40], ['025/165', 95, 8, 22]], 12), { speciesId: 25, hp: 60, num: '025/165' }],
    [
      'Ataques e danos não viram número nem HP',
      page([['Raichu', 5, 20, 60], ['HP 90', 5, 76, 50], ['weakness ×2 -30 +20', 80, 8, 22], ['Flip 2 coins. 30x', 62, 8, 28], ['Altura: 0,9 m Peso: 33,0 kg', 48, 20, 22], ['G SVI EN 026/198', 95, 3, 22]]),
      { hp: 90, num: '026/198' },
    ],
  ];

  it('tem os 15 casos', () => {
    expect(cases).toHaveLength(15);
  });

  it.each(cases)('%s', (_name, p, want) => {
    expect(summary(readCard(p))).toMatchObject(want);
  });
});

describe('pistas de idioma', () => {
  it('palavra do HP e palavras do corpo da carta', () => {
    expect(readCard(page([['Mew', 5, 20, 60], ['PS 60', 5, 76, 50], ['Fraqueza', 85, 8, 22], ['SVI 151/198', 95, 8, 22]]))).toMatchObject({ hpWord: 'PS', langWords: 'pt' });
    expect(readCard(page([['Mew', 5, 20, 60], ['HP 60', 5, 76, 50], ['Resistência', 85, 8, 22], ['SVI 151/198', 95, 8, 22]]))).toMatchObject({ hpWord: 'HP', langWords: 'pt' });
    expect(readCard(page([['Mew', 5, 20, 60], ['HP 60', 5, 76, 50], ['Retreat', 85, 8, 22], ['SVI 151/198', 95, 8, 22]]))).toMatchObject({ hpWord: 'HP', langWords: 'en' });
    expect(readCard(page([['Mew', 5, 20, 60], ['HP 60', 5, 76, 50], ['SVI 151/198', 95, 8, 22]]))).toMatchObject({ hpWord: 'HP', langWords: null });
  });

  it('escrita: kana é japonês; só kanji ou hangul não vira japonês', () => {
    expect(pageScript(page([['ピカチュウ', 8]]))).toBe('kana');
    expect(pageScript(page([['피카츄', 8]]))).toBe('hangul');
    expect(pageScript(page([['皮卡丘', 8]]))).toBe('hanzi');
    expect(pageScript(page([['Pikachu', 8]]))).toBe('latin');
    expect(pageScript(page([['123', 8]]))).toBeNull();
  });

  it('treinador sai pelo nome, sem espécie', () => {
    expect(readCard(page([['Trainer', 3, 3, 26], ['Ultra Ball', 4, 20, 60], ['Search your deck', 60, 8, 28], ['G SVI 186/198', 95, 3, 22]]))).toMatchObject({ name: 'Ultra Ball', speciesId: null });
  });
});

describe('cadeia de leitores', () => {
  const noHint = page([['Fia', 6, 18, 56], ['HP60', 6, 74, 56], ['H sv5K F 001/071 C', 94.5, 5, 22]]);

  it('latino com pista de idioma resolve e trava', () => {
    expect(chainStep('latin', page([['Mew', 5, 20, 60], ['PS 60', 5, 76, 50], ['SVI 151/198', 95, 8, 22]]))).toEqual({ resolved: 'latin', sure: true });
    expect(chainStep('latin', page([['Mew', 5, 20, 60], ['HP 60', 5, 76, 50], ['weakness', 85, 8, 22], ['SVI 151/198', 95, 8, 22]]))).toEqual({ resolved: 'latin', sure: true });
    expect(chainStep('latin', page([['Mew', 5, 20, 60], ['SVI EN 151/198', 95, 8, 22]]))).toEqual({ resolved: 'latin', sure: true });
  });

  it('latino sem número não segue a cadeia nem trava', () => {
    expect(chainStep('latin', page([['Mew', 5, 20, 60]]))).toEqual({ resolved: 'latin', sure: false });
  });

  it('sem pista e com número: japonês, coreano, chinês, e latino se nenhum resolver', () => {
    expect(chainStep('latin', noHint)).toEqual({ next: 'japanese' });
    expect(chainStep('japanese', page([['ピカチュウ', 8]]))).toEqual({ resolved: 'japanese', sure: true });
    expect(chainStep('japanese', noHint)).toEqual({ next: 'korean' });
    expect(chainStep('korean', page([['피카츄', 8]]))).toEqual({ resolved: 'korean', sure: true });
    expect(chainStep('korean', noHint)).toEqual({ next: 'chinese' });
    expect(chainStep('chinese', page([['皮卡丘', 8]]))).toEqual({ resolved: 'chinese', sure: true });
    expect(chainStep('chinese', noHint)).toEqual({ resolved: 'latin', sure: false });
  });
});

describe('print de tela', () => {
  it('vence o par espécie + HP com a maior letra, as outras viram sugestão', () => {
    const r = readPrint(
      page([['charizard!! quanto?', 20, 5, 14], ['Espeon', 40, 60, 20], ['HP 110', 40, 80, 20], ['Umbreon', 60, 10, 60], ['HP 110', 60, 40, 44], ['070/108', 70, 10, 18]]),
      dict,
    );
    expect(r).toMatchObject({ dex: 197, name: 'Umbreon', hp: 110, number: { left: '070', total: '108' } });
    expect(r.others).toEqual(expect.arrayContaining([196, 6]));
  });

  it('com espécie sem HP, fica a maior letra', () => {
    expect(readPrint(page([['Mew', 20, 5, 14], ['Pikachu', 60, 10, 60]]), dict)).toMatchObject({ dex: 25, hp: null, others: [151] });
  });

  it('número solto de interface não vira número da carta', () => {
    expect(readPrint(page([['Pikachu', 60, 10, 60], ['45', 95, 10, 10]]), dict).number).toBeNull();
  });

  it('sem nada conhecido', () => {
    expect(readPrint(page([['Compre agora', 60, 10, 60]]), dict)).toEqual({ dex: null, name: null, hp: null, number: null, others: [] });
  });

  it('idioma pela escrita: PS = PT; latino sem PS não restringe', () => {
    expect(printLang(page([['Umbreon PS 110', 8]]))).toBe('pt');
    expect(printLang(page([['Umbreon HP 110', 8]]))).toBeNull();
    expect(printLang(page([['ブラッキー', 8]]))).toBe('ja');
    expect(printLang(page([['블래키', 8]]))).toBe('ko');
    expect(printLang(page([['月亮伊布', 8]]))).toBe('zh');
  });
});

describe('estabilização e utilidades', () => {
  const a = readCard(page([['Mew', 5, 20, 60], ['HP 60', 5, 76, 50], ['SVI 151/198', 95, 8, 22]]));

  it('sigla vem da linha do número: o nome "Mew" ou o texto da carta não viram coleção', () => {
    expect(a).toMatchObject({ speciesId: 151, setCode: 'SVI' });
    const flavor = readCard(page([['Pikachu', 5, 20, 60], ['HP 60', 5, 76, 50], ['It will sit and pal around with friends', 92.5, 8, 20], ['025/165', 95, 8, 22]]));
    expect(flavor.setCode).toBeNull();
    expect(readCard(page([['Pikachu', 5, 20, 60], ['HP 60', 5, 76, 50], ['SVI', 94, 3, 20], ['025/198', 95.5, 8, 60]])).setCode).toBe('SVI');
  });

  it('duas leituras iguais estabilizam', () => {
    expect(isStable([a, a])).toBe(true);
    expect(isStable([a])).toBe(false);
  });

  it('leitura sem chave nunca estabiliza', () => {
    const empty = readCard(page([['qualquer coisa', 50]]));
    expect(readingKey(empty)).toBeNull();
    expect(isStable([empty, empty])).toBe(false);
  });

  it('chave por número, ou por espécie + HP', () => {
    expect(readingKey(a)).toBe('n:SVI:151/198');
    expect(readingKey(readCard(page([['Mew', 5, 20, 60], ['HP 60', 5, 76, 50]])))).toBe('h:151:60');
  });

  it('dígitos parecidos', () => {
    expect(digits('O7O')).toBe('070');
  });

  it('ano do ©', () => {
    expect(findYear(toRows(page([['©2020 Pokémon', 98]])))).toBe(2020);
  });
});

describe('leituras reais (tests/fixtures/ocr)', () => {
  const folder = join(__dirname, 'fixtures', 'ocr');
  const files = readdirSync(folder).filter((f) => f.endsWith('.json'));

  it('a pasta existe e o exemplo está lá', () => {
    expect(files).toContain('exemplo-sintetico.json');
  });

  // Exportado da tela de medida e ainda sem `expect`: confere ao menos que a leitura não quebra.
  it.each(files)('%s', (file) => {
    const fixture = JSON.parse(readFileSync(join(folder, file), 'utf8')) as { result: OcrPage; expect?: Record<string, unknown> };
    expect(summary(readCard(fixture.result))).toMatchObject(fixture.expect ?? {});
  });
});
