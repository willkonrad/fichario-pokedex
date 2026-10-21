// Edge Function: preço das cartas no MYP Cards (https://mypcards.com), a única fonte de valor do app.
// Chamada pelo pg_cron a cada 10 min; cada carta é relida uma vez por semana (REFRESH_DAYS).
//
// Hoje: menor anúncio no MYP Cards por idioma, pelo servidor MCP público do Zukan (zukan.com.br/mcp), feito
// para apps consultarem preços, com o histórico de 30 dias. Quando a API oficial do MYP for liberada
// (https://github.com/MYPCards/mypcards-api, chave MYP_API_TOKEN), ela entra aqui.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ZUKAN_MCP = 'https://www.zukan.com.br/mcp';
const USER_AGENT = 'FicharioPokedex/1.0 (app de colecionador; https://github.com/willkonrad/fichario-pokedex)';
/** Impressões lidas por chamada e pausa entre elas. 20 a cada 10 min cobre 1.000 cartas em menos de um dia. */
const CARDS_PER_RUN = 20;
const DELAY_MS = 1000;
const REFRESH_DAYS = 7;
const DAY = 86_400_000;

type MypInfo = {
  price?: number;
  label?: string;
  pt?: number;
  en?: number;
  history?: { t: string; p: number; k: 'pt' | 'en' }[];
  checkedAt: string;
};
type EntryData = { cardId?: string; lang?: string; myp?: MypInfo };
type Row = { user_id: string; id: string; data: EntryData };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Só o cron (que conhece a chave guardada no Vault) chama esta função.
  const key = req.headers.get('x-sync-key') ?? '';
  const { data: allowed } = await admin.rpc('check_liga_sync_key', { k: key });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);

  // Cartas agrupadas por impressão + idioma (o Zukan só tem PT e EN); vencidas = nunca lidas ou lidas há mais de REFRESH_DAYS.
  const { data: rows } = await admin.from('entries').select('user_id, id, data');
  const groups = new Map<string, Row[]>();
  for (const row of (rows ?? []) as Row[]) {
    const { cardId, lang } = row.data;
    if (!cardId || (lang !== 'pt' && lang !== 'en')) continue;
    const k = `${lang}:${cardId}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const age = (g: Row[]) => Math.min(...g.map((r) => (r.data.myp?.checkedAt ? new Date(r.data.myp.checkedAt).getTime() : 0)));
  // Carta sem preço volta a ser consultada todo dia (pode ter ganhado anúncio); com preço, uma vez por semana.
  const refreshDays = (g: Row[]) => (g.some((r) => r.data.myp?.price != null) ? REFRESH_DAYS : 1);
  const due = [...groups.values()].filter((g) => Date.now() - age(g) > refreshDays(g) * DAY).sort((a, b) => age(a) - age(b));
  if (!due.length) return json({ next: 'nada para atualizar', groups: groups.size });

  const report = { read: 0, priced: 0, failed: 0, entriesUpdated: 0 };
  for (const group of due.slice(0, CARDS_PER_RUN)) {
    const { cardId, lang } = group[0].data;
    const myp = await zukanPrice(cardId!, lang!).catch(() => undefined);
    if (!myp) {
      report.failed++; // falha momentânea: a carta continua na fila
      continue;
    }
    report.read++;
    if (myp.price != null) report.priced++;
    for (const row of group) {
      const { error } = await admin.rpc('set_entry_fields', { p_user: row.user_id, p_id: row.id, p_fields: { myp } });
      if (!error) report.entriesUpdated++;
    }
    await sleep(DELAY_MS);
  }
  return json({ ...report, pending: Math.max(0, due.length - CARDS_PER_RUN) });
});

type ZukanCard = { price?: number | null; priceHistory30d?: { recordedAt: string; price: number; priceType: string }[] };

/**
 * Menor anúncio no MYP Cards no idioma da carta. O Zukan usa os ids da TCGdex (os mesmos do app).
 * PT: campo `price` (BRL). EN: o registro mais recente "brl_nm_en" (NM em inglês).
 */
async function zukanPrice(cardId: string, lang: string): Promise<MypInfo> {
  let card: ZukanCard | undefined;
  for (const id of zukanIds(cardId)) {
    card = await zukanCard(id);
    if (card) break;
  }
  const checkedAt = new Date().toISOString();
  if (!card) return { checkedAt };
  const history = (card.priceHistory30d ?? [])
    .filter((h) => h.priceType === 'brl' || h.priceType === 'brl_nm_en')
    .map((h) => ({ t: h.recordedAt, p: h.price, k: (h.priceType === 'brl' ? 'pt' : 'en') as 'pt' | 'en' }))
    .sort((a, b) => a.t.localeCompare(b.t));
  const pt = card.price ?? undefined;
  const en = [...history].reverse().find((h) => h.k === 'en')?.p;
  // Coleções antigas só em inglês não têm o registro "NM em inglês": vale o menor anúncio geral (`price`).
  const mine = lang === 'pt' ? pt : (en ?? pt);
  return {
    price: mine,
    label:
      mine == null
        ? undefined
        : lang === 'pt'
          ? 'menor anúncio no MYP Cards (português)'
          : en != null
            ? 'menor anúncio NM no MYP Cards (inglês)'
            : 'menor anúncio no MYP Cards',
    pt,
    en,
    history: history.length ? history : undefined,
    checkedAt,
  };
}

/**
 * Ids da carta no Zukan. A TCGdex separa as Galerias de Treinador/Galar em coleções próprias ("swsh11tg-TG06",
 * "swsh12.5gg-GG01"); o Zukan as deixa na coleção principal ("swsh11-TG06", "swsh12.5-GG01").
 */
function zukanIds(cardId: string) {
  const m = cardId.match(/^(.+?)(tg|gg)-(.+)$/i);
  return m ? [cardId, `${m[1]}-${m[3]}`] : [cardId];
}

/** Carta no Zukan (undefined = não encontrada). Erro de rede ou do servidor propaga (a carta fica na fila). */
async function zukanCard(id: string): Promise<ZukanCard | undefined> {
  const res = await fetch(ZUKAN_MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_card', arguments: { id, lang: 'pt' } } }),
  });
  if (!res.ok) throw new Error(`Zukan ${res.status}`);
  const body = await res.json();
  if (body?.result?.isError) return undefined;
  return body?.result?.structuredContent ?? safeJson(body?.result?.content?.[0]?.text);
}

function safeJson(s?: string) {
  try {
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}
