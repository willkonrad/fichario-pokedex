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
// Na categoria 85 (japonês) entram também as cartas sem número impresso (as antigas, 1996–2002), reconhecidas pelos
// campos de carta do produto (products.ts); produto lacrado fica de fora. A 85 não é ligada à TCGdex: nela, link_version
// guarda a versão da cópia (JA_COPY_VERSION), e as coleções copiadas com uma versão menor são copiadas de novo.
//
// Também copia, 1×/dia por coleção em inglês ou japonês (com carta no catálogo), os preços da TCGplayer (arquivo
// /prices do TCGCSV: menor anúncio, mediana e valor de mercado por impressão, em US$) para a tabela tcg_prices, e a
// PTAX do dólar do Banco Central (fx_rates), com que o app mostra em reais o valor das cartas em inglês e japonês.
//
// Cada execução fica registrada em catalog_sync_runs (o app mostra a última em "Sobre"). Uma etapa que falha (TCGdex
// ou TCGCSV fora do ar, uma coleção com erro) é anotada e as outras continuam; a coleção que falhou fica para a próxima.
// Num 404 do TCGCSV, a coleção japonesa sem /products e a coleção sem /prices não voltam a cada execução: esperam a
// próxima mudança na TCGplayer e o próximo build, respectivamente (products.ts), e ficam anotadas no relatório.
//
// Egress: a execução sem nada para fazer (a maioria, a cada 10 min) lê do banco só alguns KB. As cartas da TCGdex
// guardadas (tcgdex_sets.cards, ~1,4 MB) só são lidas quando há coleção em inglês para copiar ou religar.
//
// Por último, se ainda houver tempo, copia a TCGdex por idioma para tcgdex_lang (languages.ts), que o lookup_build() do
// banco usa no índice da Consulta.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { syncTcgdexLanguages, type LangReport } from './languages.ts';
import { candidatesFor, linkAndStamp, productName, type TcgdexCard, type TcgdexSet } from './link.ts';
import {
  cardColumns,
  cardProducts,
  droppedExamples,
  emptyFields,
  ENGLISH,
  HttpError,
  httpStatus,
  JA_COPY_VERSION,
  JAPANESE,
  missingHpError,
  pricesNotFoundUpdate,
  pricesUrl,
  productsNotFoundUpdate,
  releaseDay,
  syncedGroupUpdate,
  type CopiedFields,
  type Product,
  type Unnumbered,
} from './products.ts';

const TCGCSV = 'https://tcgcsv.com';
const TCGDEX = 'https://api.tcgdex.net/v2/en';
const USER_AGENT = 'FicharioPokedex/1.0 (https://github.com/willkonrad/fichario-pokedex)';
/** 3 = Pokémon (inglês), 85 = Pokémon Japan: catálogo e preços das duas. */
const CATEGORIES = [ENGLISH, JAPANESE];
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

/** GET de um JSON; resposta de erro vira HttpError, com o status (httpStatus). */
async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new HttpError(url, res.status);
  return (await res.json()) as T;
}

type Group = { groupId: number; name: string; abbreviation?: string; modifiedOn?: string; publishedOn?: string };

/**
 * Versão da regra de ligação; coleções com versão menor são religadas a partir da cópia (sem baixar de novo). Só na 3:
 * na 85 a coluna link_version guarda a versão da cópia (JA_COPY_VERSION, products.ts).
 * 3: ligação pelo número completo "N/T" e selo das versões de outras coleções (ex.: "Mega Evolution Stamped").
 * 4: reimpressões renumeradas (coleções clássicas) ligadas pelo nome; nome da coleção no selo das versões de outras
 *    coleções ("Jumbo Cards · …", "Prize Pack Series Cards · …"); kits com duas coleções da TCGdex.
 * 5: símbolos no nome (Nidoran ♀/♂, ☆, ◇, δ), letra do Unown mantida no nome e apelidos das coleções de promos
 *    (SWSH, DP, energias…); " - " dentro dos parênteses não corta o nome ("Psychic Energy (#8 - Latias)"); nos kits de
 *    duas metades, a metade citada no produto; a religação recalcula o nome a partir do nome completo do produto.
 * 6: sem acerto pelo nome com o complemento antes do " - ", tenta sem ele, sempre com o mesmo número
 *    ("Professor's Research [Professor Sada] - 189/198" = "Professor's Research" sv01-189).
 * 7: carta numerada "N/T" só liga numa candidata que cobre ao menos 30% da coleção (o Groudon 111/103 de "ME06: Delta
 *    Reign" ia para "Delta Species"); a mesma carta em duas candidatas vai para a que cobre mais (não para a primeira);
 *    carta com o total da própria coleção não liga pelo número completo noutra coleção; reimpressão renumerada conta
 *    cartas diferentes da TCGdex.
 * 8: número colado no fim do nome sai dele ("Finizen 60/197"); complemento entre colchetes ou parênteses que a TCGdex
 *    guarda no nome liga a carta ("Professor's Research [Professor Oak]"); sem nenhuma ligação, a carta de mesmo número e
 *    mesma primeira palavra numa candidata que cobre a coleção ("Dusknoir LV.X" = "Dusknoir" dp7-96).
 * 9: complemento com colchete dentro do parêntese ("Vivillon (Meadow [Pink])"); marcador de versão antes do número vira
 *    selo ("Ampharos (Mirror Holofoil) - 033/070").
 */
const LINK_VERSION = 9;
const GROUPS_RELINKED_PER_RUN = 60;
/** Coleção da TCGdex nova: as coleções do TCGCSV lançadas neste período são religadas (podem ser ela, ainda sem ligação). */
const RECENT_GROUP_DAYS = 365;
/** Preços da TCGplayer: coleções relidas por chamada (1 arquivo cada, 1×/dia por coleção) e tempo máximo da etapa. */
const PRICE_GROUPS_PER_RUN = 40;
const PRICE_TIME_MS = 80_000;
/**
 * A etapa dos preços também para 110 s depois do início da execução (o limite da função e do cron é 150 s): com a cópia
 * de 20 coleções japonesas antes dela, os 80 s da etapa sozinhos podiam passar disso.
 */
const RUN_PRICE_DEADLINE_MS = 110_000;
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
  /**
   * Produtos sem número das coleções japonesas copiadas nesta execução: guardados como carta e descartados como
   * lacrados, com até 3 nomes de guardados e 3 de descartados (30 na nova cópia da 85), e os nomes dos campos de cada
   * descartado (para conferir que nenhum produto lacrado entrou e nenhuma carta ficou de fora).
   */
  unnumbered?: ({ group: number; name: string } & Unnumbered)[];
  /** Coleções da 85 cujo /products deu 404: marcadas como copiadas nesta versão (ficam com as cartas que tinham). */
  productsNotFound?: number[];
  /** Coleções sem arquivo de preços (404): tentadas de novo só no próximo build do TCGCSV. */
  pricesNotFound?: number[];
  /** Quantas cartas copiadas nesta execução trouxeram HP, tipo, estágio e data, e HPs recusados (até 5 exemplos). */
  fields: CopiedFields;
  /** O que a etapa 7 leu nesta execução (TCGdex por idioma). */
  languages?: LangReport;
  fx: string;
  /** Chave de serviço usada: a secreta nova ou a legada (para conferir a troca antes de desativar a legada). */
  apiKey?: 'secret' | 'legacy';
  /** Etapas que falharam nesta execução ("tcgdex: …", "grupo 2545: …"). */
  errors: string[];
};

/**
 * Chave de serviço: a secreta nova (sb_secret_…, a "default" de SUPABASE_SECRET_KEYS, um JSON com as chaves por nome;
 * SUPABASE_SECRET_KEY na CLI local) e, sem ela, a legada SUPABASE_SERVICE_ROLE_KEY, que a Supabase aposenta até o fim
 * de 2026. Assim um deploy nunca fica sem chave. O valor nunca vai para o registro nem para o log.
 */
function serviceKey(): { key: string; kind: 'secret' | 'legacy' } {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, unknown>;
    if (typeof keys.default === 'string' && keys.default) return { key: keys.default, kind: 'secret' };
  } catch {
    // JSON inválido: segue para as outras.
  }
  const single = Deno.env.get('SUPABASE_SECRET_KEY');
  if (single) return { key: single, kind: 'secret' };
  return { key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, kind: 'legacy' };
}

Deno.serve(async (req) => {
  const service = serviceKey();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, service.key);
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
    fields: emptyFields(),
    fx: '',
    apiKey: service.kind,
    errors: [],
  };
  let fatal: string | null = null;
  try {
    await run(admin, report, startedAt.getTime());
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

async function run(admin: SupabaseClient, report: Report, runStarted: number) {
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
    // Só os ids das coleções em dia (com nome e lidas há menos de 7 dias): ~3 KB em vez de ~18 KB.
    const { data: known, error: knownError } = await admin
      .from('tcgdex_sets')
      .select('id')
      .not('name', 'is', null)
      .neq('name', '')
      .gt('synced_at', new Date(Date.now() - 7 * 86_400_000).toISOString());
    if (knownError) throw knownError;
    const fresh = new Set((known ?? []).map((s) => s.id));
    const stale = tcgdexList.filter((x) => !fresh.has(x.id));
    // Coleções que a TCGdex acabou de cadastrar (ainda não guardadas): as coleções novas do TCGCSV ficaram sem ligação
    // enquanto a TCGdex não tinha a delas, e só eram copiadas de novo se a TCGplayer mudasse algo.
    let saved: Set<string> | null = null;
    if (stale.length) {
      const { data: all, error: allError } = await admin.from('tcgdex_sets').select('id');
      if (allError) throw allError;
      saved = new Set((all ?? []).map((s) => s.id));
    }
    let added = 0;
    let setErrors = 0;
    for (const s of stale.slice(0, TCGDEX_SETS_PER_RUN)) {
      const set = await get<{ abbreviation?: { official?: string }; cards?: TcgdexCard[]; releaseDate?: string }>(`${TCGDEX}/sets/${encodeURIComponent(s.id)}`).catch(
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
        release_date: set.releaseDate ?? null,
        synced_at: new Date().toISOString(),
      });
      if (error) fail(`tcgdex ${s.id}`, error);
      else {
        report.tcgdexSets++;
        if (saved && !saved.has(s.id)) added++;
      }
    }
    if (setErrors) fail('tcgdex', `${setErrors} coleções não responderam`);
    if (added) {
      // Religadas a partir da cópia na etapa 4 (sem baixar de novo do TCGCSV). Sem data também: a coleção lançada no
      // dia do build fica sem data até a leitura seguinte (releaseDay).
      const since = new Date(Date.now() - RECENT_GROUP_DAYS * 86_400_000).toISOString().slice(0, 10);
      const { error } = await admin
        .from('tcg_groups')
        .update({ link_version: 0 })
        .eq('category', ENGLISH)
        .or(`published_on.gte.${since},published_on.is.null`);
      if (error) fail('religação das coleções novas', error);
    }
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
          results.map((g) => ({
            group_id: g.groupId,
            category,
            name: g.name,
            abbr: g.abbreviation ?? null,
            modified_on: g.modifiedOn ?? null,
            // Data de lançamento ("2023-01-20T00:00:00" → 2023-01-20), para o ano ao lado da coleção no app; a data
            // do dia do build (coleção sem data no TCGCSV) fica nula.
            published_on: releaseDay(g.publishedOn, lastUpdated),
          })),
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
    // Siglas e cartas da TCGdex guardadas (para ligar as cartas nas etapas 3 e 4): lidas só quando uma das duas etapas
    // tem coleção em inglês para ligar, e uma vez por execução. Uma falha nessa leitura para a execução, como antes.
    let tcgdexSets: Promise<TcgdexSet[]> | null = null;
    const loadTcgdexSets = () => (tcgdexSets ??= readTcgdexSets(admin));

    // 3) Coleções novas ou alteradas desde a última cópia (inglês primeiro; em cada categoria, as mais antigas primeiro).
    const due = await dueGroups(admin);
    report.pending = Math.max(0, due.length - GROUPS_PER_RUN);
    const batch = due.slice(0, GROUPS_PER_RUN);
    // As cartas da TCGdex só servem às coleções em inglês (os ids japoneses da TCGdex são outros).
    const sets = batch.some((g) => g.category === ENGLISH) ? await loadTcgdexSets() : [];
    for (const g of batch) {
      try {
        await syncGroup(admin, g, sets, official, report);
      } catch (e) {
        // A coleção continua pendente e é tentada de novo na próxima execução.
        fail(`grupo ${g.group_id}`, e);
      }
    }
    // Copiou carta numerada e nenhuma trouxe HP: o nome do campo mudou na fonte.
    const noHp = missingHpError(report.fields);
    if (noHp) report.errors.push(noHp);

    // 4) Religação das coleções copiadas com uma regra de ligação antiga, a partir da cópia (sem baixar de novo).
    let oldLinks: { group_id: number; name: string; abbr: string | null }[] = [];
    try {
      const { data, error } = await admin
        .from('tcg_groups')
        .select('group_id, name, abbr')
        .eq('category', ENGLISH)
        .not('synced_at', 'is', null)
        .lt('link_version', LINK_VERSION)
        .limit(GROUPS_RELINKED_PER_RUN);
      if (error) throw error;
      oldLinks = data ?? [];
    } catch (e) {
      fail('religação', e);
    }
    if (oldLinks.length) {
      const relinkSets = await loadTcgdexSets();
      for (const g of oldLinks) {
        try {
          await relinkGroup(admin, g, relinkSets, official, report);
        } catch (e) {
          fail(`religação ${g.group_id}`, e);
        }
      }
    }
  }

  // 5) Câmbio do dia (PTAX do Banco Central), para mostrar em reais os preços da TCGplayer: depois das 16h UTC, se
  //    ainda não há a cotação de hoje e a última consulta tem mais de 1 hora (fim de semana e feriado não têm PTAX).
  try {
    await syncFx(admin, report);
  } catch (e) {
    fail('ptax', e);
  }

  // 6) Preços da TCGplayer (via TCGCSV) das coleções em inglês e japonês, 1×/dia por coleção: só as que têm carta no
  //    catálogo e ainda não têm os preços da versão atual do TCGCSV (last-updated.txt), poucas por chamada e com tempo
  //    máximo.
  try {
    await syncPrices(admin, lastUpdated, report, fail, runStarted + RUN_PRICE_DEADLINE_MS);
  } catch (e) {
    fail('preços', e);
  }

  // 7) TCGdex por idioma, para o índice da Consulta: um idioma por execução, se ainda houver tempo.
  try {
    await syncTcgdexLanguages(admin as never, report, fail, runStarted + RUN_PRICE_DEADLINE_MS);
  } catch (e) {
    fail('tcgdex por idioma', e);
  }
}

type GroupRow = {
  group_id: number;
  category: number;
  name: string;
  abbr: string | null;
  modified_on: string | null;
  synced_at: string | null;
  link_version: number | null;
};

/** Siglas e cartas de todas as coleções da TCGdex guardadas (~220 coleções, ~1,4 MB). */
async function readTcgdexSets(admin: SupabaseClient) {
  const { data, error } = await admin.from('tcgdex_sets').select('id, abbr, name, cards');
  if (error) throw error;
  return (data ?? []) as TcgdexSet[];
}

/**
 * Coleções para copiar, em inglês primeiro: nunca copiadas, alteradas na TCGplayer (modified_on) depois da cópia
 * (synced_at) ou, na 85, copiadas com uma versão da cópia menor (JA_COPY_VERSION). A comparação fica no banco
 * (catalog_due_groups), porque a API não compara duas colunas: a execução sem nada para copiar recebe uma lista vazia.
 * Em cada categoria, as sem data e as mais antigas primeiro (na nova cópia da 85, as "Pocket Monsters" de 1996–2002
 * entram antes). A nova cópia não zera synced_at: os preços das coleções que já têm cartas seguem sendo copiados
 * enquanto ela anda.
 */
async function dueGroups(admin: SupabaseClient): Promise<GroupRow[]> {
  const { data, error } = await admin.rpc('catalog_due_groups', { p_ja_copy_version: JA_COPY_VERSION });
  if (error) throw error;
  return (data ?? []) as GroupRow[];
}

/** Baixa as cartas de uma coleção do TCGCSV, liga à TCGdex e grava (apaga as que saíram da coleção). */
async function syncGroup(admin: SupabaseClient, g: GroupRow, tcgdexSets: TcgdexSet[], official: Map<string, number>, report: Report) {
  let results: Product[];
  try {
    ({ results } = await get<{ results: Product[] }>(`${TCGCSV}/tcgplayer/${g.category}/${g.group_id}/products`));
  } catch (e) {
    // 404 na 85: marcada como copiada nesta versão, para não voltar à fila em toda execução. Na 3 (e em outro erro) a
    // coleção continua pendente.
    const notFound = productsNotFoundUpdate(g, httpStatus(e), new Date().toISOString());
    if (!notFound) throw e;
    const { error } = await admin.from('tcg_groups').update(notFound).eq('group_id', g.group_id);
    if (error) throw error;
    (report.productsNotFound ??= []).push(g.group_id);
    return;
  } finally {
    await sleep(PAUSE_MS);
  }
  // Cartas avulsas: têm número (produtos selados não têm); na 85, também as sem número com campos de carta.
  const split = cardProducts(results, g.category, droppedExamples(g));
  const cards = split.cards.map((c) => ({ ...c, name: productName(c.p.name) }));

  // Ligação à TCGdex e selo (só inglês: os ids japoneses da TCGdex são outros).
  const english = g.category === ENGLISH;
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
    ...cardColumns(c.p, c.number, report.fields),
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
  // Hora e versão da cópia (e, na nova cópia da 85 com cartas sem número, os preços lidos de novo: syncedGroupUpdate).
  const { error } = await admin
    .from('tcg_groups')
    .update(syncedGroupUpdate(g, split.unnumbered?.kept ?? 0, LINK_VERSION, new Date().toISOString()))
    .eq('group_id', g.group_id);
  if (error) throw error;
  report.groupsSynced++;
  report.cards += rows.length;
  report.linked += rows.filter((r) => r.tcgdex_id).length;
  if (split.unnumbered) (report.unnumbered ??= []).push({ group: g.group_id, name: g.name, ...split.unnumbered });
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
    cards.map((c, i) => ({ product_id: c.product_id, name: names[i], number: c.number, full_name: c.full_name })),
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

async function syncPrices(
  admin: SupabaseClient,
  lastUpdated: Date,
  report: Report,
  fail: (where: string, e: unknown) => void,
  deadline: number,
) {
  const started = Date.now();
  const built = Number.isNaN(lastUpdated.getTime()) ? null : lastUpdated.toISOString();
  if (!built) return;
  // Só coleções com carta no catálogo (o "!inner" com 1 linha embutida: as coleções japonesas sem cartas seriam
  // requisições à toa, e upsert_tcg_prices só grava preço de produto do catálogo).
  const { data: priceDue, error } = await admin
    .from('tcg_groups')
    .select('group_id, category, tcg_catalog!inner(product_id)')
    .in('category', CATEGORIES)
    .not('synced_at', 'is', null)
    .or(`prices_at.is.null,prices_at.lt."${built}"`)
    .order('group_id', { ascending: false })
    .limit(1, { referencedTable: 'tcg_catalog' })
    .limit(PRICE_GROUPS_PER_RUN);
  if (error) throw error;
  let missing = 0;
  for (const g of priceDue ?? []) {
    if (Date.now() - started > PRICE_TIME_MS || Date.now() > deadline) break;
    let res: { results?: PriceRow[] } | null = null;
    let status: number | null = null;
    try {
      res = await get<{ results?: PriceRow[] }>(pricesUrl(TCGCSV, g.category, g.group_id));
    } catch (e) {
      status = httpStatus(e);
    }
    await sleep(PAUSE_MS);
    if (!res) {
      missing++;
      // 404: sem arquivo nesta versão do TCGCSV, tenta só no próximo build; outro erro: na próxima execução.
      const notFound = pricesNotFoundUpdate(status, built);
      if (notFound) {
        const { error: markError } = await admin.from('tcg_groups').update(notFound).eq('group_id', g.group_id);
        if (markError) fail(`preços ${g.group_id}`, markError);
        else (report.pricesNotFound ??= []).push(g.group_id);
      }
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
