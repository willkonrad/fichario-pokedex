// Edge Function: foto oficial de uma versão com selo (ex.: Pikachu SVP 027 "Pokémon Center Exclusive"), pela cópia
// do catálogo do TCGCSV (tabela tcg_catalog, atualizada 1×/dia pela função catalog-sync). Não chama o TCGCSV: as
// regras dele pedem que os apps leiam de uma cópia própria. A TCGplayer lista várias versões com selo como produto
// próprio (Pokémon Center, campeonatos, concursos, "Winner"…); as da Booster Box ("set-logo") aparecem como
// "<Coleção> Stamped" (ex.: "Bulbasaur - 133/132 (Mega Evolution Stamped)").
//
// Entrada: { cardId: "svp-027", stamps: ["pokemon-center"] }  →  { image?: string, product?: string }

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

/**
 * Chave de serviço: a secreta nova (sb_secret_…, a "default" de SUPABASE_SECRET_KEYS, um JSON com as chaves por nome;
 * SUPABASE_SECRET_KEY na CLI local) e, sem ela, a legada SUPABASE_SERVICE_ROLE_KEY, que a Supabase aposenta até o fim
 * de 2026. Assim um deploy nunca fica sem chave.
 */
function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, unknown>;
    if (typeof keys.default === 'string' && keys.default) return keys.default;
  } catch {
    // JSON inválido: segue para as outras.
  }
  return Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey());

/** Palavras sem acento, com "Pokémon Day" e "Pokeday" (TCGdex) escritos do mesmo jeito. */
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/pokemon\s*day/g, 'pokeday')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
/** Palavras que identificam o selo (sem números e ordinais como "30th", que a TCGplayer escreve de outro jeito). */
const significant = (ws: string[]) => ws.filter((w) => w.length > 3 && !/^\d+(st|nd|rd|th)?$/.test(w));
const SET_STOP = new Set(['the', 'and', 'pokemon', 'set', 'series']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    // Corpo que não é JSON, ou é null, vale como pedido vazio.
    const body: { cardId?: unknown; stamps?: unknown } = (await req.json().catch(() => null)) ?? {};
    const { cardId, stamps } = body;
    // Pedido fora do formato do app (a função só devolve dados públicos do catálogo): nada a procurar.
    const list = Array.isArray(stamps) ? stamps.filter((s): s is string => typeof s === 'string').slice(0, 20) : [];
    if (typeof cardId !== 'string' || cardId.length > 64) return json({});
    // 1ª edição não é produto à parte na TCGplayer.
    const keys = list.filter((s) => s !== 'set-logo' && s !== '1st-edition');
    const setLogo = list.includes('set-logo');
    if (!cardId || (!keys.length && !setLogo)) return json({});

    const { data, error } = await admin
      .from('tcg_catalog')
      .select('full_name, stamp, image')
      .eq('tcgdex_id', cardId)
      .not('stamp', 'is', null)
      .order('product_id');
    if (error) throw error;
    // Cartas gigantes (Jumbo) têm a mesma arte com outra moldura: nunca são a foto da carta.
    const rows = (data ?? []).filter((r) => !words(r.stamp ?? '').some((w) => w === 'jumbo' || w === 'oversize'));
    let hit: { full_name: string; image: string } | undefined;
    if (keys.length) {
      const want = significant(keys.flatMap(words));
      hit = rows.find((r) => {
        const have = new Set(words(r.stamp ?? ''));
        return want.length > 0 && want.every((w) => have.has(w));
      });
    } else {
      // Selo da Booster Box: "<nome da coleção> Stamped" (às vezes "Stamp").
      const { data: set } = await admin.from('tcgdex_sets').select('name').eq('id', cardId.slice(0, cardId.lastIndexOf('-'))).maybeSingle();
      const setWords = new Set(words(set?.name ?? '').filter((w) => w.length > 2 && !SET_STOP.has(w)));
      hit = rows.find((r) => {
        const have = words(r.stamp ?? '');
        return (have.includes('stamped') || have.includes('stamp')) && have.some((w) => setWords.has(w));
      });
    }
    return json(hit ? { image: hit.image, product: hit.full_name } : {});
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
