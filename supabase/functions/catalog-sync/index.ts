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
// mesma carta (ex.: "(Pokemon Center Exclusive)") viram a versão com selo, com a foto própria. Versões com selo que a
// TCGplayer guarda em coleções "de tudo um pouco" (ex.: "Bulbasaur - 133/132 (Mega Evolution Stamped)", da Booster
// Box) são ligadas pelo número completo "N/T" à carta da coleção de origem.
//
// Também copia, 1×/dia por coleção em inglês, os preços da TCGplayer (arquivo /prices do TCGCSV: menor anúncio,
// mediana e valor de mercado por impressão, em US$) para a tabela tcg_prices, e a PTAX do dólar do Banco Central
// (fx_rates), com que o app mostra em reais o valor das cartas em inglês.
//
// Cada execução fica registrada em catalog_sync_runs (o app mostra a última em "Sobre"). Uma etapa que falha (TCGdex
// ou TCGCSV fora do ar, uma coleção com erro) é anotada e as outras continuam; a coleção que falhou fica para a próxima.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { candidatesFor, linkAndStamp, productName, type TcgdexCard, type TcgdexSet } from './link.ts';

const TCGCSV = 'https://tcgcsv.com';
const TCGDEX = 'https://api.tcgdex.net/v2/en';
const USER_AGENT = 'FicharioPokedex/1.0 (https://github.com/willkonrad/fichario-pokedex)';
/** 3 = Pokémon (inglês), 85 = Pokémon Japan. */
const CATEGORIES = [3, 85];
const GROUPS_PER_RUN = 20;
const TCGDEX_SETS_PER_RUN = 40;
const PAUSE_MS = 150;
/** Execuções guardadas em catalog_sync_runs. */
const RUNS_KEPT_DAYS = 14;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

type Group = { groupId: number; name: string; abbreviation?: string; modifiedOn?: string };
type Product = { productId: number; name: string; extendedData?: { name: string; value: string }[] };

/**
 * Versão da regra de ligação; coleções com versão menor são religadas a partir da cópia (sem baixar de novo).
 * 3: ligação pelo número completo "N/T" e selo das versões de outras coleções (ex.: "Mega Evolution Stamped").
 * 4: reimpressões renumeradas (coleções clássicas) ligadas pelo nome; nome da coleção no selo das versões de outras
 *    coleções ("Jumbo Cards · …", "Prize Pack Series Cards · …"); kits com duas coleções da TCGdex.
 * 5: símbolos no nome (Nidoran ♀/♂, ☆, ◇, δ), letra do Unown mantida no nome e apelidos das coleções de promos
 *    (SWSH, DP, energias…); " - " dentro dos parênteses não corta o nome ("Psychic Energy (#8 - Latias)"); nos kits de
 *    duas metades, a metade citada no produto; a religação recalcula o nome a partir do nome completo do produto.
 * 6: sem acerto pelo nome com o complemento antes do " - ", tenta sem ele, sempre com o mesmo número
 *    ("Professor's Research [Professor Sada] - 189/198" = "Professor's Research" sv01-189).
 */
const LINK_VERSION = 6;
const GROUPS_RELINKED_PER_RUN = 60;
/** Preços da TCGplayer: coleções relidas por chamada (1 arquivo cada, 1×/dia por coleção) e tempo máximo da etapa. */
const PRICE_GROUPS_PER_RUN = 40;
const PRICE_TIME_MS = 80_000;
/** PTAX do dólar (venda), série 1 do SGS do Banco Central: sai por volta de 13:10 de Brasília nos dias úteis. */
const BCB_USD = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/1?formato=json';

type PriceRow = { productId: number; subTypeName?: string | null; lowPrice?: number | null; midPrice?: number | null; marketPrice?: number | null };

type Report = {
  tcgdexSets: number;
  tcgdexSetsPending?: number;
  groupsListed: number;
  groupsSynced: number;
  cards: number;
  linked: number;
  pending: number;
  relinkedGroups: number;
  relinkedCards: number;
  priceGroups: number;
  fx: string;
  /** Etapas que falharam nesta execução ("tcgdex: …", "grupo 2545: …"). */
  errors: string[];
};

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const key = req.headers.get('x-sync-key') ?? '';
  const { data: allowed } = await admin.rpc('check_liga_sync_key', { k: key });
  if (allowed !== true) return json({ error: 'forbidden' }, 403);

  const startedAt = new Date();
  const report: Report = {
    tcgdexSets: 0,
    groupsListed: 0,
    groupsSynced: 0,
    cards: 0,
    linked: 0,
    pending: 0,
    relinkedGroups: 0,
    relinkedCards: 0,
    priceGroups: 0,
    fx: '',
    errors: [],
  };
  let fatal: string | null = null;
  try {
    await run(admin, report);
  } catch (e) {
    fatal = message(e);
  }
  await logRun(admin, startedAt, report, fatal);
  return json(fatal ? { ...report, error: fatal } : report, fatal ? 500 : 200);
});

/** Registra a execução (ok, parcial ou erro) e apaga as de mais de RUNS_KEPT_DAYS dias. Nunca derruba a função. */
async function logRun(admin: SupabaseClient, startedAt: Date, report: Report, fatal: string | null) {
  try {
    const status = fatal ? 'error' : report.errors.length ? 'partial' : 'ok';
    await admin.from('catalog_sync_runs').insert({
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      status,
      report,
      error: fatal ?? (report.errors.length ? report.errors.slice(0, 5).join(' | ') : null),
    });
    await admin
      .from('catalog_sync_runs')
      .delete()
      .lt('started_at', new Date(Date.now() - RUNS_KEPT_DAYS * 86_400_000).toISOString());
  } catch {
    // Sem a tabela (migração ainda não aplicada) ou banco fora do ar: segue sem o registro.
  }
}

async function run(admin: SupabaseClient, report: Report) {
  /** Anota a falha de uma etapa e deixa as outras seguirem. */
  const fail = (where: string, e: unknown) => report.errors.push(`${where}: ${message(e)}`.slice(0, 300));

  // 1) Siglas oficiais das coleções da TCGdex (e as cartas de cada uma), aos poucos; renovadas a cada 7 dias. Com a
  //    TCGdex fora do ar, as etapas que ligam cartas (3 e 4) ficam para a próxima execução; as outras seguem.
  let tcgdexList: { id: string; name: string; cardCount?: { official?: number } }[] | null = null;
  try {
    tcgdexList = await get<{ id: string; name: string; cardCount?: { official?: number } }[]>(`${TCGDEX}/sets`);
  } catch (e) {
    fail('tcgdex', e);
  }
  // Número oficial de cartas de cada coleção (o "132" de "133/132"), para a ligação pelo número completo.
  const official = new Map((tcgdexList ?? []).filter((s) => s.cardCount?.official).map((s) => [s.id, s.cardCount!.official!]));
  if (tcgdexList) {
    const { data: known, error: knownError } = await admin.from('tcgdex_sets').select('id, name, synced_at');
    if (knownError) throw knownError;
    const fresh = new Set(
      (known ?? []).filter((s) => s.name && Date.now() - new Date(s.synced_at).getTime() < 7 * 86_400_000).map((s) => s.id),
    );
    const stale = tcgdexList.filter((x) => !fresh.has(x.id));
    let setErrors = 0;
    for (const s of stale.slice(0, TCGDEX_SETS_PER_RUN)) {
      const set = await get<{ abbreviation?: { official?: string }; cards?: TcgdexCard[] }>(`${TCGDEX}/sets/${encodeURIComponent(s.id)}`).catch(
        () => null,
      );
      if (!set) {
        setErrors++;
        continue;
      }
      const { error } = await admin.from('tcgdex_sets').upsert({
        id: s.id,
        name: s.name,
        abbr: set.abbreviation?.official ?? null,
        cards: (set.cards ?? []).map(({ id, localId, name }) => ({ id, localId, name })),
        synced_at: new Date().toISOString(),
      });
      if (error) fail(`tcgdex ${s.id}`, error);
      else report.tcgdexSets++;
    }
    if (setErrors) fail('tcgdex', `${setErrors} coleções não responderam`);
    // Sem todas as siglas da TCGdex, as cartas ficariam sem ligação: termina essa parte primeiro (poucas rodadas).
    if (stale.length > TCGDEX_SETS_PER_RUN) {
      report.tcgdexSetsPending = stale.length - TCGDEX_SETS_PER_RUN;
      return;
    }
  }

  // 2) Lista de coleções do TCGCSV: só quando o TCGCSV foi atualizado depois da última leitura.
  let lastUpdated = new Date(NaN);
  try {
    const res = await fetch(`${TCGCSV}/last-updated.txt`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`last-updated.txt ${res.status}`);
    lastUpdated = new Date((await res.text()).trim());
    const { data: stamp } = await admin.from('qvmc_cache').select('fetched_at').eq('key', 'tcgcsv:groups-listed').maybeSingle();
    if (!Number.isNaN(lastUpdated.getTime()) && (!stamp || new Date(stamp.fetched_at) < lastUpdated)) {
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
  } catch (e) {
    fail('tcgcsv (lista de coleções)', e);
  }

  if (tcgdexList) {
    // Siglas e cartas da TCGdex guardadas (para ligar as cartas nas etapas 3 e 4).
    const { data: setRows, error: setsError } = await admin.from('tcgdex_sets').select('id, abbr, name, cards');
    if (setsError) throw setsError;
    const tcgdexSets = (setRows ?? []) as TcgdexSet[];

    // 3) Coleções novas ou alteradas desde a última cópia (inglês primeiro).
    const { data: groups, error: groupsError } = await admin
      .from('tcg_groups')
      .select('group_id, category, name, abbr, modified_on, synced_at')
      .order('category');
    if (groupsError) throw groupsError;
    const due = (groups ?? []).filter((g) => !g.synced_at || (g.modified_on && new Date(g.modified_on) > new Date(g.synced_at)));
    report.pending = Math.max(0, due.length - GROUPS_PER_RUN);
    for (const g of due.slice(0, GROUPS_PER_RUN)) {
      try {
        await syncGroup(admin, g, tcgdexSets, official, report);
      } catch (e) {
        // A coleção continua pendente e é tentada de novo na próxima execução.
        fail(`grupo ${g.group_id}`, e);
      }
    }

    // 4) Religação das coleções copiadas com uma regra de ligação antiga, a partir da cópia (sem baixar de novo).
    try {
      const { data: oldLinks, error } = await admin
        .from('tcg_groups')
        .select('group_id, name, abbr')
        .eq('category', 3)
        .not('synced_at', 'is', null)
        .lt('link_version', LINK_VERSION)
        .limit(GROUPS_RELINKED_PER_RUN);
      if (error) throw error;
      for (const g of oldLinks ?? []) {
        try {
          await relinkGroup(admin, g, tcgdexSets, official, report);
        } catch (e) {
          fail(`religação ${g.group_id}`, e);
        }
      }
    } catch (e) {
      fail('religação', e);
    }
  }

  // 5) Câmbio do dia (PTAX do Banco Central), para mostrar em reais os preços da TCGplayer: depois das 16h UTC, se
  //    ainda não há a cotação de hoje e a última consulta tem mais de 1 hora (fim de semana e feriado não têm PTAX).
  try {
    await syncFx(admin, report);
  } catch (e) {
    fail('ptax', e);
  }

  // 6) Preços da TCGplayer (via TCGCSV) das coleções em inglês, 1×/dia por coleção: só as que ainda não têm os preços
  //    da versão atual do TCGCSV (last-updated.txt), poucas por chamada e com tempo máximo.
  try {
    await syncPrices(admin, lastUpdated, report, fail);
  } catch (e) {
    fail('preços', e);
  }
}

type GroupRow = { group_id: number; category: number; name: string; abbr: string | null };

/** Baixa as cartas de uma coleção do TCGCSV, liga à TCGdex e grava (apaga as que saíram da coleção). */
async function syncGroup(admin: SupabaseClient, g: GroupRow, tcgdexSets: TcgdexSet[], official: Map<string, number>, report: Report) {
  const { results } = await get<{ results: Product[] }>(`${TCGCSV}/tcgplayer/${g.category}/${g.group_id}/products`);
  await sleep(PAUSE_MS);
  // Cartas avulsas: têm número (produtos selados não têm).
  const cards = results
    .map((p) => {
      const number = p.extendedData?.find((e) => e.name === 'Number')?.value;
      return number ? { p, number, name: productName(p.name) } : null;
    })
    .filter((c): c is NonNullable<typeof c> => !!c);

  // Ligação à TCGdex e selo (só inglês: os ids japoneses da TCGdex são outros).
  const english = g.category === 3;
  const links = linkAndStamp(
    g.name,
    cards.map((c) => ({ product_id: c.p.productId, name: c.name, number: c.number, full_name: c.p.name })),
    english ? candidatesFor(g, tcgdexSets) : [],
    english ? tcgdexSets : [],
    official,
  );

  const rows = cards.map((c, i) => ({
    product_id: c.p.productId,
    category: g.category,
    group_id: g.group_id,
    name: c.name,
    full_name: c.p.name,
    number: c.number,
    rarity: c.p.extendedData?.find((e) => e.name === 'Rarity')?.value ?? null,
    image: `https://tcgplayer-cdn.tcgplayer.com/product/${c.p.productId}_in_1000x1000.jpg`,
    stamp: links[i].stamp,
    tcgdex_id: links[i].tcgdex_id,
    updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('tcg_catalog').upsert(rows.slice(i, i + 500), { onConflict: 'product_id' });
    if (error) throw error;
  }
  // Produtos que saíram do catálogo da coleção.
  const ids = rows.map((r) => r.product_id);
  if (ids.length) {
    const { error } = await admin.from('tcg_catalog').delete().eq('group_id', g.group_id).not('product_id', 'in', `(${ids.join(',')})`);
    if (error) throw error;
  }
  const { error } = await admin.from('tcg_groups').update({ synced_at: new Date().toISOString(), link_version: LINK_VERSION }).eq('group_id', g.group_id);
  if (error) throw error;
  report.groupsSynced++;
  report.cards += rows.length;
  report.linked += rows.filter((r) => r.tcgdex_id).length;
}

/** Religa uma coleção já copiada com a regra atual (nome recalculado do nome completo, ligação e selo). */
async function relinkGroup(
  admin: SupabaseClient,
  g: { group_id: number; name: string; abbr: string | null },
  tcgdexSets: TcgdexSet[],
  official: Map<string, number>,
  report: Report,
) {
  // Todas as cartas da coleção, em páginas de 1.000 (limite da API; ex.: World Championship Decks tem 1.700).
  const cards: { product_id: number; name: string; number: string | null; full_name: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('tcg_catalog')
      .select('product_id, name, number, full_name')
      .eq('group_id', g.group_id)
      .order('product_id')
      .range(from, from + 999);
    if (error) throw error;
    cards.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const names = cards.map((c) => productName(c.full_name));
  const links = linkAndStamp(
    g.name,
    cards.map((c, i) => ({ product_id: c.product_id, name: names[i], number: c.number ?? '', full_name: c.full_name })),
    candidatesFor(g, tcgdexSets),
    tcgdexSets,
    official,
  );
  if (links.length) {
    const { data: changed, error } = await admin.rpc('relink_catalog', { p: links.map((l, i) => ({ ...l, name: names[i] })) });
    if (error) throw error;
    report.relinkedCards += (changed as number) ?? 0;
  }
  const { error } = await admin.from('tcg_groups').update({ link_version: LINK_VERSION }).eq('group_id', g.group_id);
  if (error) throw error;
  report.relinkedGroups++;
}

async function syncFx(admin: SupabaseClient, report: Report) {
  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  const { data: lastFx } = await admin.from('fx_rates').select('day, fetched_at').eq('currency', 'USD').order('day', { ascending: false }).limit(1).maybeSingle();
  if (
    new Date().getUTCHours() < 16 ||
    (lastFx && lastFx.day >= today) ||
    (lastFx && Date.now() - new Date(lastFx.fetched_at).getTime() <= 3_600_000)
  ) {
    return;
  }
  const rows = await get<{ data: string; valor: string }[]>(BCB_USD).catch(() => null);
  const row = Array.isArray(rows) ? rows[rows.length - 1] : null;
  const [d, m, y] = row?.data?.split('/') ?? [];
  const sell = Number(row?.valor);
  if (y && sell > 0) {
    const { error } = await admin.from('fx_rates').upsert({ day: `${y}-${m}-${d}`, currency: 'USD', sell, source: 'bcb_ptax', fetched_at: new Date().toISOString() });
    if (error) throw error;
    report.fx = `${y}-${m}-${d} ${sell}`;
  } else if (lastFx) {
    // Sem cotação nova (antes da divulgação, fim de semana): marca a consulta para esperar 1 hora.
    await admin.from('fx_rates').update({ fetched_at: new Date().toISOString() }).eq('day', lastFx.day).eq('currency', 'USD');
  }
}

async function syncPrices(admin: SupabaseClient, lastUpdated: Date, report: Report, fail: (where: string, e: unknown) => void) {
  const started = Date.now();
  const built = Number.isNaN(lastUpdated.getTime()) ? null : lastUpdated.toISOString();
  if (!built) return;
  const { data: priceDue, error } = await admin
    .from('tcg_groups')
    .select('group_id')
    .eq('category', 3)
    .not('synced_at', 'is', null)
    .or(`prices_at.is.null,prices_at.lt."${built}"`)
    .order('group_id', { ascending: false })
    .limit(PRICE_GROUPS_PER_RUN);
  if (error) throw error;
  let missing = 0;
  for (const g of priceDue ?? []) {
    if (Date.now() - started > PRICE_TIME_MS) break;
    const res = await get<{ results?: PriceRow[] }>(`${TCGCSV}/tcgplayer/3/${g.group_id}/prices`).catch(() => null);
    await sleep(PAUSE_MS);
    if (!res) {
      missing++;
      continue;
    }
    const rows = (res.results ?? []).map((r) => ({
      product_id: r.productId,
      sub_type: r.subTypeName ?? null,
      low: r.lowPrice ?? null,
      mid: r.midPrice ?? null,
      market: r.marketPrice ?? null,
    }));
    const { error: upsertError } = await admin.rpc('upsert_tcg_prices', { p_group: g.group_id, p_built: built, p: rows });
    if (upsertError) {
      fail(`preços ${g.group_id}`, upsertError);
      continue;
    }
    report.priceGroups++;
  }
  // Coleção sem arquivo de preços (ex.: recém-lançada) é normal; muitas de uma vez indicam o TCGCSV fora do ar.
  if (missing > 5) fail('preços', `${missing} coleções sem arquivo de preços`);
}
