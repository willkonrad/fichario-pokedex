import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { CardImage } from '@/components/card-image';
import { HEADING_3 } from '@/components/collection-chart';
import type { PressState } from '@/components/icon-button';
import { Badge, Button, Card, CardSkeleton, TextSkeleton, type IconName } from '@/components/ui';
import { formatDex, getSpecies } from '@/data/pokedex';
import { entryImageUrl } from '@/lib/catalog';
import {
  activityCounts,
  clearActivityCache,
  currentEntryOf,
  isPokedexSwap,
  loadActivity,
  type ActivityItem,
  type ActivityResult,
  type CardSummary,
} from '@/lib/activity';
import { formatAgo, formatDay, formatInt } from '@/lib/format';
import { cardNumber, entryPlace, placeText, versionText, type EntryPlace } from '@/lib/lists';
import { mypPtImage } from '@/lib/myp-api';
import { isNetworkError } from '@/lib/supabase';
import { LANG_SHORT, type BinderSettings, type CardLang, type CustomBinder, type Entry, type Variant } from '@/lib/types';
import { collectionState, subscribeCollection } from '@/store/collection';
import { CARD_RATIO, colors, radius, semantic, space, typography } from '@/theme';

// Atividade da tela Relatórios: o que mudou na coleção (registro entry_events do servidor, lido por lib/activity.ts).

const WEB = Platform.OS === 'web';
/** Linhas de cada cartão antes do "Ver mais" (e quantas cada toque acrescenta). */
export const PAGE = 8;
const THUMB = 44;
const SMALL = 34;
/** Deslocamento de cada miniatura no leque do "N cartas de uma vez". */
const FAN_STEP = 14;
const RESTORED = 'Restaurada da cópia';
/** O "há 5 min" das linhas avança a cada minuto com a tela aberta. */
const CLOCK_MS = 60_000;
/**
 * Começo do registro de mudanças: a cópia de 24/10, 00:20 de Brasília, a mais antiga que o backfill compara
 * (migração 20261105b_entry_events.sql). Do que mudou antes disso não há registro.
 */
const ACTIVITY_START_DAY = '2026-10-24';
const ACTIVITY_START_MS = Date.UTC(2026, 9, 24, 3, 20);

// ---------- Dados ----------

export type ActivityState =
  | { status: 'signedOut' | 'loading' | 'notMigrated'; retry: () => void }
  | { status: 'error'; error: string; retry: () => void }
  /** `since`: começo do período (ISO); `now`: hora de referência do "há 5 min" (da leitura, depois a cada minuto). */
  | { status: 'ok'; items: ActivityItem[]; since: string; now: number; retry: () => void };

/**
 * Chama `onDrain` cada vez que a fila de envio esvazia (pendentes de mais de 0 para 0: a nuvem confirmou as mudanças
 * deste aparelho). Ouve o store direto, não a renderização: vale também com a tela por baixo de outra (a da carta).
 * Devolve o cancelamento.
 */
function onQueueDrained(onDrain: () => void) {
  let last = collectionState().syncStatus.pending;
  return subscribeCollection(() => {
    const pending = collectionState().syncStatus.pending;
    if (last > 0 && pending === 0) onDrain();
    last = pending;
  });
}

// Também com Relatórios fechada (depois da primeira abertura): um envio confirmado esquece o cache de 2 min, para a
// próxima abertura não mostrar o registro de antes dele.
onQueueDrained(clearActivityCache);

/**
 * Registro de mudanças dos últimos `days` dias da conta `userId`. Sem conta, 'signedOut' (nada é lido). O que foi
 * carregado vale só para a conta e o período que o pediram; "Tentar de novo" lê de novo sem o cache. Quando a fila de
 * envio esvazia (ex.: carta removida ou trocada a partir desta tela), lê de novo sem o cache, com as linhas de antes
 * na tela até a leitura nova chegar.
 */
export function useActivity(userId: string | undefined, days: number): ActivityState {
  const [attempt, setAttempt] = useState(0);
  /** Releituras depois de um envio (sem "Carregando…": as linhas de antes ficam até chegar a nova). */
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; refresh: number; result?: ActivityResult; error?: string }>();
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!userId) return;
    // O registro só ganha a mudança quando o envio chega à nuvem: esquece o cache (todas as contas e períodos) e relê.
    return onQueueDrained(() => {
      clearActivityCache();
      setRefresh((n) => n + 1);
    });
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const key = `${userId}:${days}:${attempt}`;
    // Na releitura depois do envio o cache já foi esquecido: lê da nuvem sem o `force`.
    loadActivity({ days, force: attempt > 0 })
      .then((result) => {
        if (!alive) return;
        setLoaded({ key, refresh, result });
        setNow(Date.now());
      })
      .catch((e: unknown) => {
        if (alive) {
          setLoaded({ key, refresh, error: isNetworkError(e) ? 'Sem conexão: confira a internet e tente de novo.' : 'Não consegui carregar o histórico de mudanças.' });
        }
      });
    return () => {
      alive = false;
    };
  }, [userId, days, attempt, refresh]);

  // Mesma conta, período e tentativa: durante a releitura depois do envio, vale a leitura anterior (se deu certo).
  const same = userId && loaded?.key === `${userId}:${days}:${attempt}` ? loaded : undefined;
  const current = same && (same.refresh === refresh || same.result) ? same : undefined;
  const result = current?.result;
  // Relógio só enquanto há linhas com "há N min" na tela.
  const ticking = result?.state === 'ok' && result.items.length > 0;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [ticking]);

  const retry = () => setAttempt((n) => n + 1);
  if (!userId) return { status: 'signedOut', retry };
  if (!current) return { status: 'loading', retry };
  if (!result) return { status: 'error', error: current.error ?? 'Não consegui carregar o histórico de mudanças.', retry };
  if (result.state === 'ok') return { status: 'ok', items: result.items, since: result.since, now, retry };
  return { status: result.state, retry };
}

/** "24/10" quando o período começa antes do registro de mudanças (as contagens valem só dali em diante); senão null. */
export function activityStartWithin(since: string): string | null {
  return Date.parse(since) < ACTIVITY_START_MS ? formatDay(ACTIVITY_START_DAY) : null;
}

const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`;

/** "12 adicionadas · 3 trocas · 1 movida · 0 removidas". */
export function activityCountsText(items: ActivityItem[]) {
  const c = activityCounts(items);
  return [
    plural(c.added, 'adicionada', 'adicionadas'),
    plural(c.replaced, 'troca', 'trocas'),
    plural(c.moved, 'movida', 'movidas'),
    plural(c.removed, 'removida', 'removidas'),
  ].join(' · ');
}

/** O que as linhas precisam para dizer onde a carta está e abrir a tela dela. */
export type ActivityContext = {
  entries: Record<string, Entry>;
  settings: BinderSettings | null;
  binders: CustomBinder[];
  onOpen: (e: Entry) => void;
  /** Hora de referência do "há 5 min" (ActivityState.now). */
  now: number;
};

// ---------- Cartões ----------

/**
 * Os três cartões da atividade, na ordem: "Últimas adicionadas" (e as que entraram de uma vez), "Trocas no fichário
 * Pokédex" e "Movidas e removidas" (com as trocas dos fichários livres). Cartão sem nada no período não aparece.
 */
export function ActivitySections({ items, ctx }: { items: ActivityItem[]; ctx: ActivityContext }) {
  const added = items.filter((i) => i.kind === 'added' || i.kind === 'bulk');
  const swaps = items.filter(isPokedexSwap);
  const changes = items.filter((i) => i.kind === 'moved' || i.kind === 'removed' || (i.kind === 'replaced' && !isPokedexSwap(i)));
  return (
    <>
      <ActivityCard title="Últimas adicionadas" items={added} render={(i) => <AddedRow key={i.id} item={i} ctx={ctx} />} />
      <ActivityCard title="Trocas no fichário Pokédex" items={swaps} render={(i) => <SwapRow key={i.id} item={i} ctx={ctx} />} />
      <ActivityCard title="Movidas e removidas" items={changes} render={(i) => <ChangeRow key={i.id} item={i} ctx={ctx} />} />
    </>
  );
}

/** Carregando a atividade: um cartão com três linhas em esqueleto. */
export function ActivitySkeleton() {
  return (
    <Card style={styles.card}>
      <Text style={styles.title} {...HEADING_3}>
        Últimas adicionadas
      </Text>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.row}>
          <CardSkeleton width={THUMB} />
          <View style={styles.body}>
            <TextSkeleton lines={2} />
          </View>
        </View>
      ))}
    </Card>
  );
}

/** "Ver mais (12)": mostra mais `PAGE` linhas. */
export function MoreButton({ rest, onPress }: { rest: number; onPress: () => void }) {
  return (
    <Button
      title={`Ver mais (${formatInt(rest)})`}
      label={`Ver mais: ${plural(rest, 'restante', 'restantes')}`}
      variant="ghost"
      icon="chevron-down"
      onPress={onPress}
    />
  );
}

function ActivityCard({ title, items, render }: { title: string; items: ActivityItem[]; render: (item: ActivityItem) => ReactNode }) {
  const [shown, setShown] = useState(PAGE);
  if (!items.length) return null;
  const rest = items.length - shown;
  return (
    <Card style={styles.card}>
      <Text style={styles.title} {...HEADING_3}>
        {title}
      </Text>
      <View>{items.slice(0, shown).map(render)}</View>
      {rest > 0 ? <MoreButton rest={rest} onPress={() => setShown((n) => n + PAGE)} /> : null}
    </Card>
  );
}

// ---------- Textos de cada linha ----------

/** Bolso pelo id ("25-0" no Pokédex, "b1:5" no fichário livre). */
function parsePocket(id: string): { binderId?: string; dex: number; slot: number } | undefined {
  const custom = /^(.+):(\d+)$/.exec(id);
  if (custom) return { binderId: custom[1], dex: 0, slot: Number(custom[2]) };
  const dex = /^(\d+)-(\d+)$/.exec(id);
  return dex ? { dex: Number(dex[1]), slot: Number(dex[2]) } : undefined;
}

/** Lugar de um bolso pelo id, para a carta que já saiu dele; null se o fichário não existe mais. */
function pocketPlace(id: string, ctx: ActivityContext): EntryPlace | null {
  const p = parsePocket(id);
  // entryPlace só lê o fichário, o Pokémon e o bolso.
  return p ? entryPlace(p as Entry, ctx.settings, ctx.binders) : null;
}

/** Onde está agora a carta do item (ou o bolso dele, quando a carta já saiu). */
function placeNow(item: ActivityItem, entry: Entry | undefined, ctx: ActivityContext) {
  return entry ? entryPlace(entry, ctx.settings, ctx.binders) : pocketPlace(item.entryId, ctx);
}

/** "pág. 2, bolso 5" (sem o fichário), ou "fora das páginas". */
function spot(p: EntryPlace) {
  return p.hidden ? 'fora das páginas' : p.short;
}

/** "Movida de pág. 2, bolso 5 para pág. 3, bolso 1 · Trocas", ou com os dois fichários quando são diferentes. */
function moveText(from: EntryPlace | null, to: EntryPlace | null) {
  if (from && to && from.binder === to.binder) return `Movida de ${spot(from)} para ${spot(to)} · ${to.binder}`;
  if (from && to) return `Movida de ${from.binder} (${spot(from)}) para ${to.binder} (${spot(to)})`;
  if (to) return `Movida para ${placeText(to)}`;
  return from ? `Movida de ${placeText(from)}` : 'Movida';
}

type CardLike = { setId?: string; setName?: string; localId?: string; setTotal?: number; variant?: Variant; variantNote?: string; lang?: CardLang };

/**
 * "Megaevolução · 025/132 · Holo / Foil". O número como impresso, igual ao da tela da carta: a coleção diz se é galeria
 * ("TG05/TG30") ou promo (só "1", sem o total da TCGdex).
 */
export function detailsOf(c: CardLike) {
  const version = versionText({ variant: c.variant ?? 'normal', variantNote: c.variantNote });
  const number = cardNumber({ localId: c.localId ?? '', setTotal: c.setTotal, setId: c.setId, setName: c.setName, lang: c.lang });
  return [c.setName, number, version].filter(Boolean).join(' · ');
}

const nameOf = (c?: CardSummary) => c?.cardName?.trim() || 'Carta';
const versionLabel = (c: CardSummary) => versionText({ variant: c.variant ?? 'normal', variantNote: c.variantNote }) || 'Normal';

/** Mesma carta em outra versão ou idioma: "Trocou a versão: Holo / Foil → Reverse Foil" ou "Trocou o idioma: PT → EN". */
function versionChangeText(prev: CardSummary, next: CardSummary) {
  const a = versionLabel(prev);
  const b = versionLabel(next);
  const la: CardLang = prev.lang ?? 'pt';
  const lb: CardLang = next.lang ?? 'pt';
  if (la === lb) return `Trocou a versão: ${a} → ${b}`;
  if (a === b) return `Trocou o idioma: ${LANG_SHORT[la]} → ${LANG_SHORT[lb]}`;
  return `Trocou a versão: ${a} ${LANG_SHORT[la]} → ${b} ${LANG_SHORT[lb]}`;
}

/** Quando: "há 5 min", "ontem, 14:05"…; das mudanças anteriores ao registro (backfill), só o dia. */
function whenOf(item: ActivityItem, now: number) {
  if (item.dayOnly) {
    const day = formatDay(item.at);
    return { text: day, spoken: `em ${day}` };
  }
  const text = formatAgo(item.at, now);
  return { text, spoken: text };
}

// ---------- Linhas ----------

function AddedRow({ item, ctx }: { item: ActivityItem; ctx: ActivityContext }) {
  const when = whenOf(item, ctx.now);
  const restored = item.source === 'restore';
  if (item.kind === 'bulk') {
    const cards = item.cards?.length ? item.cards : [item.card];
    const count = item.count ?? cards.length;
    const names = cards
      .map((c) => c.cardName?.trim())
      .filter(Boolean)
      .join(', ');
    return (
      <ActivityRow
        left={<FanThumbs cards={cards} id={item.id} />}
        title={`${formatInt(count)} ${count === 1 ? 'carta' : 'cartas'} de uma vez`}
        details={names && count > cards.length ? `${names}…` : names}
        when={when}
        restored={restored}
      />
    );
  }
  const entry = currentEntryOf(item, ctx.entries);
  const place = placeNow(item, entry, ctx);
  // A carta saiu do bolso depois (removida, trocada ou movida): onde ela entrou.
  const event = entry ? placeText(place) : place ? `Estava em ${placeText(place)}` : 'Estava num fichário apagado';
  return (
    <ActivityRow
      left={<Thumb card={item.card} entry={entry} recyclingKey={item.id} />}
      title={nameOf(item.card)}
      details={detailsOf(entry ?? item.card)}
      event={event}
      when={when}
      restored={restored}
      onPress={entry ? () => ctx.onOpen(entry) : undefined}
    />
  );
}

/** Troca no fichário Pokédex: "#025 Pikachu", a carta que saiu → a que entrou. */
function SwapRow({ item, ctx }: { item: ActivityItem; ctx: ActivityContext }) {
  const entry = currentEntryOf(item, ctx.entries);
  const pocket = parsePocket(item.entryId);
  const dex = pocket?.dex ?? item.card.dex ?? 0;
  const title = dex > 0 ? `${formatDex(dex)} ${getSpecies(dex)?.name ?? ''}`.trim() : `Bolso livre ${(pocket?.slot ?? item.card.slot ?? 0) + 1}`;
  const prev = item.prev;
  const place = placeNow(item, entry, ctx);
  return (
    <ActivityRow
      left={<PairThumbs from={prev} to={item.card} entry={entry} id={item.id} />}
      title={title}
      details={item.versionOnly && prev ? versionChangeText(prev, item.card) : `Saiu ${nameOf(prev)} · entrou ${nameOf(item.card)}`}
      detailLines={2}
      event={place ? spot(place) : undefined}
      when={whenOf(item, ctx.now)}
      restored={item.source === 'restore'}
      onPress={entry ? () => ctx.onOpen(entry) : undefined}
    />
  );
}

/** Movida, removida ou trocada num fichário livre. */
function ChangeRow({ item, ctx }: { item: ActivityItem; ctx: ActivityContext }) {
  const entry = currentEntryOf(item, ctx.entries);
  const common = {
    title: nameOf(item.card),
    when: whenOf(item, ctx.now),
    restored: item.source === 'restore',
    onPress: entry ? () => ctx.onOpen(entry) : undefined,
  };
  if (item.kind === 'moved') {
    const from = item.fromEntryId ? pocketPlace(item.fromEntryId, ctx) : null;
    return (
      <ActivityRow
        {...common}
        left={<Thumb card={item.card} entry={entry} recyclingKey={item.id} />}
        details={detailsOf(entry ?? item.card)}
        event={moveText(from, placeNow(item, entry, ctx))}
        eventIcon="arrow-forward-circle-outline"
      />
    );
  }
  if (item.kind === 'removed') {
    return (
      <ActivityRow
        {...common}
        left={<Thumb card={item.card} recyclingKey={item.id} />}
        details={detailsOf(item.card)}
        event={`Removida de ${placeText(pocketPlace(item.entryId, ctx))}`}
        eventIcon="remove-circle-outline"
      />
    );
  }
  const place = placeText(placeNow(item, entry, ctx));
  const prev = item.prev;
  return (
    <ActivityRow
      {...common}
      left={<PairThumbs from={prev} to={item.card} entry={entry} id={item.id} />}
      details={item.versionOnly && prev ? versionChangeText(prev, item.card) : detailsOf(entry ?? item.card)}
      detailLines={item.versionOnly ? 2 : 1}
      event={item.versionOnly ? `Trocada · ${place}` : `Trocada no lugar de ${nameOf(prev)} · ${place}`}
      eventIcon="repeat-outline"
    />
  );
}

/**
 * Linha da atividade: miniatura(s), nome e quando, coleção/número/versão e o que aconteceu (onde está, de onde saiu).
 * Com `onPress` (a carta continua no bolso), a linha inteira abre a carta.
 */
function ActivityRow({
  left,
  title,
  details,
  detailLines = 1,
  event,
  eventIcon = 'location-outline',
  when,
  restored,
  onPress,
}: {
  left: ReactNode;
  title: string;
  details?: string;
  detailLines?: number;
  event?: string;
  eventIcon?: IconName;
  when: { text: string; spoken: string };
  restored?: boolean;
  onPress?: () => void;
}) {
  // O leitor de tela lê "para" no lugar da seta.
  const label = [title, restored ? RESTORED : null, details, event, when.spoken]
    .filter(Boolean)
    .join(', ')
    .replace(/ → /g, ' para ');
  const body = (
    <>
      {/* Miniaturas fora do leitor de tela: o texto já diz qual é a carta (na web, sairiam como imagens sem nome). */}
      <View aria-hidden>{left}</View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.when}>{when.text}</Text>
        </View>
        {details ? (
          <Text style={styles.sub} numberOfLines={detailLines}>
            {details}
          </Text>
        ) : null}
        {event ? (
          <View style={styles.eventRow}>
            <Ionicons name={eventIcon} size={13} color={colors.textMuted} style={styles.eventIcon} />
            <Text style={styles.event} numberOfLines={2}>
              {event}
            </Text>
          </View>
        ) : null}
        {restored ? (
          <View style={styles.badge}>
            <Badge label={RESTORED} icon="cloud-download-outline" />
          </View>
        ) : null}
      </View>
    </>
  );
  if (!onPress) {
    // Só leitura: no celular, lida de uma vez; na web, o texto corrido (sem papel, o rótulo não seria lido lá).
    return (
      <View style={styles.row} {...(WEB ? null : { accessible: true, accessibilityLabel: label })}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityLabel={label}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [styles.row, hovered && { backgroundColor: semantic.hover.onLight }, pressed && { opacity: 0.7 }];
      }}>
      {body}
    </Pressable>
  );
}

// ---------- Miniaturas ----------

/** Foto em português do MYP guardada no resumo (como mypPtImage, para a carta que já não está no bolso). */
function summaryPtImage(c: CardSummary) {
  if ((c.lang ?? 'pt') !== 'pt' || c.image?.includes('/pt/')) return undefined;
  return c.imagePt;
}

/** Miniatura da carta: a do bolso, quando ela ainda está lá (imagem já resolvida), senão a do resumo do registro. */
function Thumb({ card, entry, width = THUMB, recyclingKey }: { card: CardSummary; entry?: Entry; width?: number; recyclingKey: string }) {
  const c: CardSummary = entry ?? card;
  return (
    <View style={[styles.thumb, { width, height: width / CARD_RATIO }]}>
      <CardImage
        image={c.image}
        imageUrl={entry ? entryImageUrl(entry) : c.imageUrl}
        cardId={c.lang === 'ja' ? undefined : c.cardId}
        localId={c.localId}
        dex={c.dex || undefined}
        compact
        stampKeys={c.stampKeys}
        photo={c.stampPhoto}
        ptImage={entry ? mypPtImage(entry) : summaryPtImage(card)}
        recyclingKey={recyclingKey}
      />
    </View>
  );
}

/** A carta que saiu → a que entrou. */
function PairThumbs({ from, to, entry, id }: { from?: CardSummary; to: CardSummary; entry?: Entry; id: string }) {
  return (
    <View style={styles.pair}>
      {from ? (
        <>
          <Thumb card={from} width={SMALL} recyclingKey={`${id}:old`} />
          <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
        </>
      ) : null}
      <Thumb card={to} entry={entry} width={SMALL} recyclingKey={`${id}:new`} />
    </View>
  );
}

/** Até 3 miniaturas em leque (cartas que entraram de uma vez). */
function FanThumbs({ cards, id }: { cards: CardSummary[]; id: string }) {
  const list = cards.slice(0, 3);
  const border = StyleSheet.hairlineWidth * 2;
  return (
    <View style={{ width: SMALL + border * 2 + FAN_STEP * (list.length - 1), height: SMALL / CARD_RATIO + border * 2 }}>
      {list.map((c, i) => (
        <View key={i} style={[styles.fanItem, { left: i * FAN_STEP, borderWidth: border }]}>
          <Thumb card={c} width={SMALL} recyclingKey={`${id}:${i}`} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  title: { ...typography.heading, color: colors.heading },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs, borderRadius: radius.sm },
  thumb: { borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  pair: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  fanItem: { position: 'absolute', top: 0, borderColor: colors.surface, borderRadius: radius.card },
  body: { flex: 1, minWidth: 0, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  rowTitle: { ...typography.bodyStrong, color: colors.text, flex: 1, minWidth: 0 },
  when: { ...typography.caption, ...typography.tabular, color: colors.textMuted, flexShrink: 0 },
  sub: { ...typography.caption, color: colors.textMuted },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  eventIcon: { marginTop: 2 },
  event: { ...typography.caption, color: colors.text, flex: 1 },
  badge: { marginTop: space.xxs },
});
