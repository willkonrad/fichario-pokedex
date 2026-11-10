// Gera as sementes de public.catalog_species (nome de cada espécie → número da Pokédex) a partir de src/data/pokedex.json.
// O lookup_build() acha o Pokémon de cada carta por essa tabela.
//
// Uso: node scripts/make-species-sql.js            imprime o insert
//      node scripts/make-species-sql.js --write    troca o trecho entre os marcadores na migração e no schema.sql

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BEGIN = '-- species:begin';
const END = '-- species:end';
const TARGETS = ['supabase/migrations/20261109a_consulta.sql', 'supabase/schema.sql'];

/** Igual a speciesKey() de src/data/pokedex.ts ("Mr. Mime" → "mrmime", "Nidoran♀" → "nidoranf", "Ho-Oh" → "hooh"). */
function speciesKey(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .replace(/[^a-z0-9]+/g, '');
}

/** Linhas da tabela: em inglês pela chave; em chinês e japonês, o próprio nome. Nome repetido em duas espécies é erro. */
function speciesRows(pokedex) {
  const rows = [];
  const owner = new Map();
  const add = (key, dex, kind) => {
    if (!key) return;
    const known = owner.get(key);
    if (known !== undefined && known !== dex) throw new Error(`"${key}" em #${known} e #${dex}`);
    if (known === dex) return;
    owner.set(key, dex);
    rows.push({ key, dex, kind });
  };
  for (const s of pokedex) {
    add(speciesKey(s.name), s.id, 'en');
    add(s.zhHant, s.id, 'zh');
    add(s.zhHans, s.id, 'zh');
    add(s.ja, s.id, 'ja');
  }
  return rows;
}

const literal = (s) => `'${s.replace(/'/g, "''")}'`;

/** O insert idempotente, com poucas linhas de valores por linha de texto. */
function speciesSql(rows) {
  const lines = [];
  let line = '';
  for (const r of rows) {
    const value = `(${literal(r.key)},${r.dex},'${r.kind}')`;
    if (line.length + value.length > 160) {
      lines.push(line);
      line = '';
    }
    line += (line ? ',' : '') + value;
  }
  if (line) lines.push(line);
  return [
    'insert into public.catalog_species (key, dex, kind) values',
    lines.join(',\n'),
    'on conflict (key) do update set dex = excluded.dex, kind = excluded.kind;',
  ].join('\n');
}

/** Troca o trecho entre os marcadores, mantendo o fim de linha do arquivo. */
function replaceBetweenMarkers(text, sql) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error('marcadores não encontrados');
  const head = text.slice(0, start + BEGIN.length);
  return head + eol + sql.replace(/\n/g, eol) + eol + text.slice(end);
}

function main() {
  const pokedex = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/pokedex.json'), 'utf8'));
  const sql = speciesSql(speciesRows(pokedex));
  if (process.argv[2] !== '--write') {
    process.stdout.write(`${sql}\n`);
    return;
  }
  for (const target of TARGETS) {
    const file = path.join(ROOT, target);
    fs.writeFileSync(file, replaceBetweenMarkers(fs.readFileSync(file, 'utf8'), sql));
    console.log(`${target}: sementes trocadas`);
  }
}

if (require.main === module) main();

module.exports = { speciesKey, speciesRows, speciesSql, replaceBetweenMarkers };
