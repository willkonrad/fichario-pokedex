// Edge Function desativada para gravação de preços.
// A cotação da Liga é feita só pela função liga-sync (cron), que confere número, coleção e coerência
// dos preços antes de gravar na carta. Esta função apenas devolve o cache, sem chamar nenhum scraper.
//
// POST { queries: string[] }  →  { results: { query, items, fetchedAt, cached }[] }

import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_QUERIES = 20;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const cacheKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth.user) return json({ error: 'Entre na sua conta para ver as cotações.' }, 401);

  let body: { queries?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const queries = Array.isArray(body.queries)
    ? [...new Set(body.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0 && q.length <= 120))]
    : [];
  if (!queries.length) return json({ error: 'Envie queries: ["Nome (número/total)"]' }, 400);
  if (queries.length > MAX_QUERIES) return json({ error: `Máximo de ${MAX_QUERIES} cartas por vez.` }, 400);

  const { data } = await admin.from('liga_price_cache').select('query, items, fetched_at').in('query', queries.map(cacheKey));
  const cached = new Map((data ?? []).filter((r) => Array.isArray(r.items) && r.items.length).map((r) => [r.query, r]));

  return json({
    results: queries.map((q) => {
      const hit = cached.get(cacheKey(q));
      return hit
        ? { query: q, items: hit.items, fetchedAt: hit.fetched_at, cached: true }
        : { query: q, items: [], fetchedAt: new Date().toISOString(), cached: false };
    }),
  });
});
