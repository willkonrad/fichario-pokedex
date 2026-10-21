// Edge Function: foto oficial de uma versão com selo (ex.: Nidorina MEP 101 "Pokémon Center Exclusive"), pelo
// TCGCSV (tcgcsv.com), espelho gratuito e diário do catálogo da TCGplayer. O TCGCSV não pede permissão nem
// atribuição (o app agradece com um link) e não libera CORS, por isso a busca é feita aqui. A TCGplayer só lista
// algumas versões com selo como produto próprio (Pokémon Center, campeonatos, concursos, "Winner"…); os selos da
// Booster Box ("set-logo") não existem lá e voltam sem imagem.
//
// Entrada: { cardId: "mep-101", stamps: ["pokemon-center"] }  →  { image?: string, product?: string }

import { createClient } from 'npm:@supabase/supabase-js@2';

const TCGCSV = 'https://tcgcsv.com/tcgplayer/3'; // 3 = Pokémon
const USER_AGENT = 'FicharioPokedex/1.0 (https://github.com/willkonrad/fichario-pokedex)';
const DAY = 86_400_000;

type Group = { groupId: number; name: string; abbreviation?: string };
type Product = { productId: number; name: string; number?: string };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

/** Arquivo do TCGCSV com cache de 1 dia (tabela qvmc_cache, chave "tcgcsv:…"): o TCGCSV atualiza 1×/dia. */
async function tcgcsv<T>(path: string, trim: (raw: unknown) => T): Promise<T> {
  const key = `tcgcsv:${path}`;
  const { data: hit } = await admin.from('qvmc_cache').select('data, fetched_at').eq('key', key).maybeSingle();
  if (hit && Date.now() - new Date(hit.fetched_at).getTime() < DAY) return hit.data as T;
  const res = await fetch(`${TCGCSV}/${path}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`TCGCSV ${res.status}`);
  const data = trim(await res.json());
  await admin.from('qvmc_cache').upsert({ key, data, fetched_at: new Date().toISOString() });
  return data;
}

const groups = () =>
  tcgcsv<Group[]>('groups', (raw) =>
    ((raw as { results: Group[] }).results ?? []).map(({ groupId, name, abbreviation }) => ({ groupId, name, abbreviation })),
  );
const products = (groupId: number) =>
  tcgcsv<Product[]>(`${groupId}/products`, (raw) =>
    ((raw as { results: { productId: number; name: string; extendedData?: { name: string; value: string }[] }[] }).results ?? []).map((p) => ({
      productId: p.productId,
      name: p.name,
      number: p.extendedData?.find((e) => e.name === 'Number')?.value,
    })),
  );

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
/** "007/165" ou "SWSH001" → "7" / "swsh1": número sem zeros à esquerda, sem o total. */
const num = (s?: string) => (s ?? '').split('/')[0].toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const { cardId, stamps } = (await req.json()) as { cardId?: string; stamps?: string[] };
    // Selo da Booster Box (logo da coleção) e 1ª edição não são produtos à parte na TCGplayer.
    const keys = (stamps ?? []).filter((s) => s !== 'set-logo' && s !== '1st-edition');
    if (!cardId || !keys.length) return json({});

    // Nome em inglês, número e sigla oficial da coleção (MEG, MEP, MEW…), que é a mesma no TCGCSV.
    const card = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(cardId)}`).then((r) => (r.ok ? r.json() : null));
    if (!card) return json({});
    const set = await fetch(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(card.set.id)}`).then((r) => (r.ok ? r.json() : null));
    const abbr = set?.abbreviation?.official as string | undefined;
    if (!abbr) return json({});

    const candidates = (await groups()).filter((g) => g.abbreviation === abbr);
    const name = words(card.name).join(' ');
    const stampWords = keys.flatMap((k) => words(k));
    for (const g of candidates) {
      for (const p of await products(g.groupId)) {
        // "Nidorina - 101 (30th Celebration) (Pokemon Center Exclusive)": nome antes do " - ", número e selo.
        if (words(p.name.split(' - ')[0]).join(' ') !== name || num(p.number) !== num(card.localId)) continue;
        const pw = new Set(words(p.name));
        if (stampWords.every((w) => pw.has(w))) {
          return json({ image: `https://tcgplayer-cdn.tcgplayer.com/product/${p.productId}_in_1000x1000.jpg`, product: p.name });
        }
      }
    }
    return json({});
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
