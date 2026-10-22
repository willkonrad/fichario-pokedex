// Edge Function: foto oficial de uma versão com selo (ex.: Pikachu SVP 027 "Pokémon Center Exclusive"), pela cópia
// do catálogo do TCGCSV (tabela tcg_catalog, atualizada 1×/dia pela função catalog-sync). Não chama o TCGCSV: as
// regras dele pedem que os apps leiam de uma cópia própria. A TCGplayer só lista algumas versões com selo como
// produto próprio (Pokémon Center, campeonatos, concursos, "Winner"…); os selos da Booster Box ("set-logo") não
// existem lá e voltam sem imagem.
//
// Entrada: { cardId: "svp-027", stamps: ["pokemon-center"] }  →  { image?: string, product?: string }

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    const { cardId, stamps } = (await req.json()) as { cardId?: string; stamps?: string[] };
    // Selo da Booster Box (logo da coleção) e 1ª edição não são produtos à parte na TCGplayer.
    const keys = (stamps ?? []).filter((s) => s !== 'set-logo' && s !== '1st-edition');
    if (!cardId || !keys.length) return json({});

    const { data, error } = await admin.from('tcg_catalog').select('full_name, stamp, image').eq('tcgdex_id', cardId).not('stamp', 'is', null);
    if (error) throw error;
    const want = keys.flatMap(words);
    const hit = (data ?? []).find((r) => {
      const have = new Set(words(r.stamp ?? ''));
      return want.every((w) => have.has(w));
    });
    return json(hit ? { image: hit.image, product: hit.full_name } : {});
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
