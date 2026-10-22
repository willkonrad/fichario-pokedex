// Edge Function: cópia diária do catálogo de cartas do TCGCSV (tcgcsv.com, espelho gratuito do catálogo da
// TCGplayer) nas tabelas tcg_groups / tcg_catalog, que o app lê. Chamada pelo pg_cron a cada 10 min.
//
// Regras do TCGCSV (tcgcsv.com/docs#usage-guidelines), seguidas aqui:
//   - User-Agent próprio em toda requisição;
//   - o TCGCSV atualiza 1×/dia: a lista de coleções só é relida quando last-updated.txt muda, e cada coleção só é
//     baixada de novo quando a TCGplayer a alterou (modifiedOn);
//   - pausa entre requisições e poucas por chamada (bem abaixo de 10.000/dia);
//   - o app nunca chama o TCGCSV: lê só a cópia guardada aqui.
//
// Cada carta é ligada ao id da TCGdex (mesma sigla oficial de coleção, mesmo número e mesmo nome), que o app usa
// para a ficha em português, as variações e os preços. Produtos com um complemento a mais que a versão comum da
// mesma carta (ex.: "(Pokemon Center Exclusive)") viram a versão com selo, com a foto própria.

import { createClient } from 'npm:@supabase/supabase-js@2';

const TCGCSV = 'https://tcgcsv.com';
const TCGDEX = 'https://api.tcgdex.net/v2/en';
const USER_AGENT = 'FicharioPokedex/1.0 (https://github.com/willkonrad/fichario-pokedex)';
/** 3 = Pokémon (inglês), 85 = Pokémon Japan. */
const CATEGORIES = [3, 85];
const GROUPS_PER_RUN = 20;
const TCGDEX_SETS_PER_RUN = 40;
const PAUSE_MS = 150;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(' ');
/** "007/165", "SWSH001", "TG06" → "7", "swsh1", "tg6". */
const num = (s?: string) => (s ?? '').split('/')[0].trim().toLowerCase().replace(/^([a-z]*)0+(?=\d)/, '$1');
/** Complementos entre parênteses ou colchetes: "Pikachu - 225 (World Championship 2025) [Winner]". */
const qualifiers = (s: string) => [...s.matchAll(/[([]([^)\]]+)[)\]]/g)].map((m) => m[1].trim());

type Group = { groupId: number; name: string; abbreviation?: string; modifiedOn?: string };
type Product = { productId: number; name: string; extendedData?: { name: string; value: string }[] };
type TcgdexCard = { id: string; localId: string; name: string };
type TcgdexSet = { id: string; abbr: string | null; name: string | null; cards: TcgdexCard[] | null };

/** Versão da regra de ligação; coleções com versão menor são religadas a partir da cópia (sem baixar de novo). */
const LINK_VERSION = 2;
const GROUPS_RELINKED_PER_RUN = 60;

/** "SWSH08", "SM05", "sv03.5" → "swsh8", "sm5", "sv3.5": compara o código da TCGplayer com o id da TCGdex. */
const code = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, '').replace(/([a-z])0+(?=\d)/g, '$1');
const STOP = new Set(['the', 'and', 'of', 'pokemon', 'tcg', 'set', 'sets', 'cards', 'card', 'series', 'black', 'star', 'expansion']);
/** Palavras do nome da coleção, sem o prefixo de série ("SWSH08: ", "SM - ") e sem plural. */
const setWords = (s: string) =>
  new Set(
    words(s.replace(/^[A-Za-z]{1,5}\d{0,3}(\.\d)?\s*[:–-]\s+/, ''))
      .split(' ')
      .map((w) => w.replace(/s$/, ''))
      .filter((w) => w && !STOP.has(w)),
  );

/**
 * Coleções da TCGdex candidatas a uma coleção do TCGCSV: mesma sigla, código igual ao id (SWSH08 ↔ swsh8) ou nome
 * mais parecido. A carta só é ligada se número E nome baterem, então candidatas a mais não geram ligações erradas.
 */
function candidatesFor(g: { name: string; abbr: string | null }, sets: TcgdexSet[]) {
  const out = new Set<TcgdexSet>();
  for (const s of sets) {
    if (g.abbr && (s.abbr === g.abbr || code(s.id) === code(g.abbr))) out.add(s);
  }
  const gw = setWords(g.name);
  let best = 0;
  const scored = sets.map((s) => {
    const sw = setWords(s.name ?? '');
    const shared = [...gw].filter((w) => sw.has(w)).length;
    best = Math.max(best, shared);
    return { s, shared };
  });
  if (best > 0) for (const x of scored) if (x.shared === best) out.add(x.s);
  return [...out];
}

/** Id da TCGdex da carta (mesmo número e mesmo nome numa das coleções candidatas). */
function linkCard(name: string, number: string, candidates: TcgdexSet[]) {
  for (const s of candidates) {
    const hit = (s.cards ?? []).find((t) => num(t.localId) === num(number) && words(t.name) === words(name));
    if (hit) return hit.id;
  }
  return null;
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const key = req.headers.get('x-sync-key') ?? '';
  const { data: allowed } = await admin.rpc('check_liga_sync_key', { k: key });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);
  const report = { tcgdexSets: 0, groupsListed: 0, groupsSynced: 0, cards: 0, linked: 0, pending: 0, relinkedGroups: 0, relinkedCards: 0 };

  // 1) Siglas oficiais das coleções da TCGdex (e as cartas de cada uma), aos poucos; renovadas a cada 7 dias.
  const tcgdexList = await get<{ id: string; name: string }[]>(`${TCGDEX}/sets`);
  const { data: known } = await admin.from('tcgdex_sets').select('id, name, synced_at');
  const fresh = new Set(
    (known ?? []).filter((s) => s.name && Date.now() - new Date(s.synced_at).getTime() < 7 * 86_400_000).map((s) => s.id),
  );
  const stale = tcgdexList.filter((x) => !fresh.has(x.id));
  for (const s of stale.slice(0, TCGDEX_SETS_PER_RUN)) {
    const set = await get<{ abbreviation?: { official?: string }; cards?: TcgdexCard[] }>(`${TCGDEX}/sets/${encodeURIComponent(s.id)}`).catch(() => null);
    if (!set) continue;
    await admin.from('tcgdex_sets').upsert({
      id: s.id,
      name: s.name,
      abbr: set.abbreviation?.official ?? null,
      cards: (set.cards ?? []).map(({ id, localId, name }) => ({ id, localId, name })),
      synced_at: new Date().toISOString(),
    });
    report.tcgdexSets++;
  }

  // Sem todas as siglas da TCGdex, as cartas ficariam sem ligação: termina essa parte primeiro (poucas rodadas).
  if (stale.length > TCGDEX_SETS_PER_RUN) return json({ ...report, tcgdexSetsPending: stale.length - TCGDEX_SETS_PER_RUN });

  // 2) Lista de coleções do TCGCSV: só quando o TCGCSV foi atualizado depois da última leitura.
  const lastUpdated = new Date((await fetch(`${TCGCSV}/last-updated.txt`, { headers: { 'User-Agent': USER_AGENT } }).then((r) => r.text())).trim());
  const { data: stamp } = await admin.from('qvmc_cache').select('fetched_at').eq('key', 'tcgcsv:groups-listed').maybeSingle();
  if (!stamp || new Date(stamp.fetched_at) < lastUpdated) {
    for (const category of CATEGORIES) {
      const { results } = await get<{ results: Group[] }>(`${TCGCSV}/tcgplayer/${category}/groups`);
      const { error } = await admin.from('tcg_groups').upsert(
        results.map((g) => ({ group_id: g.groupId, category, name: g.name, abbr: g.abbreviation ?? null, modified_on: g.modifiedOn ?? null })),
        { onConflict: 'group_id' },
      );
      if (error) throw error;
      report.groupsListed += results.length;
      await sleep(PAUSE_MS);
    }
    // Marca de "lista lida" (a coluna data não aceita nulo).
    const { error: markError } = await admin.from('qvmc_cache').upsert({ key: 'tcgcsv:groups-listed', data: {}, fetched_at: new Date().toISOString() });
    if (markError) throw markError;
  }

  // 3) Coleções novas ou alteradas desde a última cópia (inglês primeiro).
  const { data: groups } = await admin.from('tcg_groups').select('group_id, category, name, abbr, modified_on, synced_at').order('category');
  const due = (groups ?? []).filter((g) => !g.synced_at || (g.modified_on && new Date(g.modified_on) > new Date(g.synced_at)));
  report.pending = Math.max(0, due.length - GROUPS_PER_RUN);
  const { data: setRows } = await admin.from('tcgdex_sets').select('id, abbr, name, cards');
  const tcgdexSets = (setRows ?? []) as TcgdexSet[];

  for (const g of due.slice(0, GROUPS_PER_RUN)) {
    const { results } = await get<{ results: Product[] }>(`${TCGCSV}/tcgplayer/${g.category}/${g.group_id}/products`);
    await sleep(PAUSE_MS);
    // Cartas avulsas: têm número (produtos selados não têm).
    const cards = results
      .map((p) => {
        const number = p.extendedData?.find((e) => e.name === 'Number')?.value;
        const cut = p.name.indexOf(' - ');
        const name = (cut > 0 ? p.name.slice(0, cut) : p.name.replace(/[([][^)\]]*[)\]]/g, '')).trim();
        return number ? { p, number, name, quals: qualifiers(cut > 0 ? p.name.slice(cut) : p.name) } : null;
      })
      .filter((c): c is NonNullable<typeof c> => !!c);

    // Versão comum de cada carta (nome + número): a com menos complementos; os complementos a mais são o selo.
    const base = new Map<string, string[]>();
    for (const c of cards) {
      const k = `${words(c.name)}|${num(c.number)}`;
      const cur = base.get(k);
      if (!cur || c.quals.length < cur.length) base.set(k, c.quals);
    }
    // Coleções da TCGdex candidatas (só inglês: os ids japoneses da TCGdex são outros).
    const candidates = g.category === 3 ? candidatesFor(g, tcgdexSets) : [];

    const rows = cards.map((c) => {
      const k = `${words(c.name)}|${num(c.number)}`;
      const extra = c.quals.filter((q) => !(base.get(k) ?? []).includes(q));
      return {
        product_id: c.p.productId,
        category: g.category,
        group_id: g.group_id,
        name: c.name,
        full_name: c.p.name,
        number: c.number,
        rarity: c.p.extendedData?.find((e) => e.name === 'Rarity')?.value ?? null,
        image: `https://tcgplayer-cdn.tcgplayer.com/product/${c.p.productId}_in_1000x1000.jpg`,
        stamp: extra.length ? extra.join(' · ') : null,
        tcgdex_id: linkCard(c.name, c.number, candidates),
        updated_at: new Date().toISOString(),
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('tcg_catalog').upsert(rows.slice(i, i + 500), { onConflict: 'product_id' });
      if (error) throw error;
    }
    // Produtos que saíram do catálogo da coleção.
    const ids = rows.map((r) => r.product_id);
    if (ids.length) await admin.from('tcg_catalog').delete().eq('group_id', g.group_id).not('product_id', 'in', `(${ids.join(',')})`);
    await admin.from('tcg_groups').update({ synced_at: new Date().toISOString(), link_version: LINK_VERSION }).eq('group_id', g.group_id);
    report.groupsSynced++;
    report.cards += rows.length;
    report.linked += rows.filter((r) => r.tcgdex_id).length;
  }

  // 4) Religação das coleções copiadas com uma regra de ligação antiga, a partir da cópia (sem baixar de novo).
  const { data: oldLinks } = await admin
    .from('tcg_groups')
    .select('group_id, name, abbr')
    .eq('category', 3)
    .not('synced_at', 'is', null)
    .lt('link_version', LINK_VERSION)
    .limit(GROUPS_RELINKED_PER_RUN);
  for (const g of oldLinks ?? []) {
    const candidates = candidatesFor(g, tcgdexSets);
    const { data: cards } = await admin.from('tcg_catalog').select('product_id, name, number').eq('group_id', g.group_id);
    const links = (cards ?? []).map((c) => ({ product_id: c.product_id, tcgdex_id: linkCard(c.name, c.number ?? '', candidates) }));
    if (links.length) {
      const { data: changed, error } = await admin.rpc('relink_catalog', { p: links });
      if (error) throw error;
      report.relinkedCards += (changed as number) ?? 0;
    }
    await admin.from('tcg_groups').update({ link_version: LINK_VERSION }).eq('group_id', g.group_id);
    report.relinkedGroups++;
  }
  return json(report);
});
