// Acrescenta a src/data/pokedex.json os nomes das espécies em coreano e em chinês (tradicional e simplificado), da
// PokéAPI (licença BSD-3). Pode rodar de novo: troca os três campos e não mexe nos outros.
//
// Uso: node scripts/add-species-names.js [caminho do pokemon_species_names.csv]
// Sem caminho, baixa o CSV do repositório da PokéAPI.

const fs = require('fs');
const path = require('path');

const CSV_URL = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv';
const POKEDEX_FILE = path.join(__dirname, '..', 'src', 'data', 'pokedex.json');
/** local_language_id da PokéAPI: 3 = coreano, 4 = chinês tradicional, 12 = chinês simplificado. */
const FIELDS = { 3: 'ko', 4: 'zhHant', 12: 'zhHans' };

/** Linhas de um CSV simples, com aspas (o campo genus às vezes tem vírgula). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** { dex: { ko, zhHant, zhHans } } a partir do texto do CSV. */
function namesFromCsv(text) {
  const [head, ...rows] = parseCsv(text);
  const speciesAt = head.indexOf('pokemon_species_id');
  const langAt = head.indexOf('local_language_id');
  const nameAt = head.indexOf('name');
  if (speciesAt < 0 || langAt < 0 || nameAt < 0) throw new Error('CSV sem as colunas esperadas');
  const names = {};
  for (const row of rows) {
    const field = FIELDS[row[langAt]];
    if (field && row[nameAt]) (names[row[speciesAt]] ??= {})[field] = row[nameAt].trim();
  }
  return names;
}

/** Cada espécie com os campos novos; espécie sem nome em algum idioma é erro (não grava pela metade). */
function withNames(pokedex, names) {
  return pokedex.map((s) => {
    const found = names[s.id] ?? {};
    for (const field of Object.values(FIELDS)) if (!found[field]) throw new Error(`#${s.id} ${s.name} sem ${field}`);
    return { id: s.id, name: s.name, ja: s.ja, ko: found.ko, zhHant: found.zhHant, zhHans: found.zhHans };
  });
}

async function main() {
  const source = process.argv[2];
  let text;
  if (source) text = fs.readFileSync(source, 'utf8');
  else {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`${CSV_URL} ${res.status}`);
    text = await res.text();
  }
  const pokedex = JSON.parse(fs.readFileSync(POKEDEX_FILE, 'utf8'));
  fs.writeFileSync(POKEDEX_FILE, JSON.stringify(withNames(pokedex, namesFromCsv(text))));
  console.log(`${pokedex.length} espécies com ko, zhHant e zhHans`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { parseCsv, namesFromCsv, withNames };
