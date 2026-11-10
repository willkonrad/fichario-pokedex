// Conferência do lote: certas já marcadas, dúvidas para o dono e um toque final. Nada entra na coleção antes dele.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddCardSheet } from '@/components/add-sheet';
import { clearScanFiles, OCR_UNAVAILABLE } from '@/components/card-scanner';
import { Badge, BOTTOM_BAR_SPACE, BottomBar, Button, Chip, ChipGroup, EmptyState, GroupLabel, IconButton, InfoSheet, Loading, Notice, showToast } from '@/components/ui';
import type { Destination } from '@/lib/add-card';
import { LOOKUP_PRICE } from '@/lib/copy';
import { allowsLang } from '@/lib/lookup-format';
import type { LookupCard, PrintCode } from '@/lib/lookup-types';
import { cardPhoto, siblings } from '@/lib/lookup-view';
import {
  afterBatch,
  alreadyOwned,
  applyPick,
  batchEntries,
  briefOf,
  cardOf,
  clearLastBatch,
  clearLot,
  defaultPrint,
  isLookupOnly,
  itemLang,
  loadLot,
  lotBlock,
  onScanPick,
  planBatch,
  PRINT_LABEL,
  saveLastBatch,
  saveLot,
  type LotBlock,
  type LotItem,
} from '@/lib/scan-lot';
import { PT_OR_EN, readingQuery } from '@/lib/scan-match';
import type { CardBrief } from '@/lib/tcgdex';
import { CONDITIONS, POKEDEX_BINDER, type Condition } from '@/lib/types';
import { keyOf, saveEntriesNow, useActiveBinderId, useBinders, useCollectionActions, useCollectionReady, useEntries, useSettings } from '@/store/collection';
import { CARD_RATIO, colors, radius, semantic, space, TOUCH, typography } from '@/theme';

import { isOcrAvailable } from '../../modules/card-ocr';

const PHOTO_W = 48;
const PHOTO_H = PHOTO_W / CARD_RATIO;
const BLOCK_ORDER: LotBlock[] = ['attention', 'version', 'sure', 'lookup'];
const BLOCK_TITLE: Record<LotBlock, string> = { attention: 'Precisam de você', version: 'Confira a versão', sure: 'Certas', lookup: 'Só consulta' };

type ListRow = { type: 'head'; block: LotBlock; count: number } | { type: 'item'; item: LotItem };

export default function ScanReviewScreen() {
  const ready = useCollectionReady();
  if (!isOcrAvailable) return <EmptyState title="Câmera indisponível" text={OCR_UNAVAILABLE} action={<Button title="Voltar" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />} />;
  if (!ready) return <Loading />;
  return <Review />;
}

const isCondition = (v: string | undefined): v is Condition => CONDITIONS.some((c) => c.id === v);

function Review() {
  const params = useLocalSearchParams<{ target?: string; condition?: string }>();
  const settings = useSettings();
  const binders = useBinders();
  const entries = useEntries();
  const activeBinderId = useActiveBinderId();
  const { saveEntries, removeEntries } = useCollectionActions();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<LotItem[] | null>(null);
  const [target, setTarget] = useState<string>(params.target || 'auto');
  const [targetOpen, setTargetOpen] = useState(false);
  const [sheet, setSheet] = useState<{ item: LotItem; brief: CardBrief } | null>(null);
  const [saving, setSaving] = useState(false);
  const condition: Condition = isCondition(params.condition) ? params.condition : 'NM';

  useEffect(() => {
    loadLot().then((l) => setItems(l ?? []));
  }, []);

  useEffect(() => {
    return onScanPick((itemId, card, lang) => {
      setItems((cur) => {
        if (!cur) return cur;
        const next = cur.map((i) => (i.id === itemId ? applyPick(i, card, lang) : i));
        saveLot(next).catch(() => {});
        return next;
      });
    });
  }, []);

  if (!items) return <Loading />;

  function commit(next: LotItem[]) {
    setItems(next);
    saveLot(next).catch(() => {});
  }
  const patch = (id: string, change: Partial<LotItem>) => commit(items!.map((i) => (i.id === id ? { ...i, ...change } : i)));

  function dropItem(id: string) {
    const list = items!;
    const at = list.findIndex((i) => i.id === id);
    if (at < 0) return;
    const removed = list[at];
    commit(list.filter((i) => i.id !== id));
    showToast({
      message: 'Carta tirada do lote',
      actionLabel: 'Desfazer',
      onAction: () => {
        setItems((cur) => {
          const base = cur ?? [];
          const next = [...base.slice(0, at), removed, ...base.slice(at)];
          saveLot(next).catch(() => {});
          return next;
        });
      },
    });
  }

  const plan = planBatch(items, { settings, binders, entries, target, activeBinderId });
  const placeable = plan.filter((p) => p.dest);
  const blocked = plan.length - placeable.length;
  const destsOf = new Map<string, (Destination | null)[]>();
  for (const p of plan) destsOf.set(p.item.id, [...(destsOf.get(p.item.id) ?? []), p.dest]);

  const rows: ListRow[] = BLOCK_ORDER.flatMap((block) => {
    const list = items.filter((i) => lotBlock(i) === block);
    return list.length ? [{ type: 'head' as const, block, count: list.length }, ...list.map((item) => ({ type: 'item' as const, item }))] : [];
  });

  async function place() {
    if (saving || !placeable.length) return;
    setSaving(true);
    const list = batchEntries(placeable, condition);
    let ids: string[];
    try {
      ids = await saveEntries(list);
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Não consegui colocar as cartas.', tone: 'error' });
      setSaving(false);
      return;
    }
    if (!ids.length) {
      showToast({ message: 'Esses bolsos acabaram de ser ocupados. Nenhuma carta foi substituída.' });
      setSaving(false);
      return;
    }
    // As cartas ficam gravadas no aparelho antes de o lote sair dele (a gravação agrupada só sairia daqui a pouco: se o
    // app morresse nesse meio-tempo, o lote sumiria das duas partes). Sem conseguir gravá-las (armazenamento cheio,
    // coleção salva ilegível), elas saem de novo e o lote fica inteiro: nada colocado, nada perdido.
    try {
      await saveEntriesNow(ids);
    } catch {
      await removeEntries(ids).catch(() => {});
      showToast({ message: 'Não consegui gravar as cartas neste aparelho. Nada foi colocado: o lote continua aqui para tentar de novo.', tone: 'error' });
      setSaving(false);
      return;
    }
    const saved = new Set(ids);
    const cards = list.map((e) => ({ id: keyOf(e.binderId, e.dex, e.slot), cardId: e.cardId })).filter((c) => saved.has(c.id));
    await saveLastBatch(cards);
    const left = afterBatch(items!, placeable, saved).filter((i) => !isLookupOnly(i));
    showToast({
      message: `${ids.length} ${ids.length === 1 ? 'carta colocada' : 'cartas colocadas'}`,
      actionLabel: 'Desfazer',
      duration: 8000,
      onAction: () => {
        removeEntries(ids).then(
          () => clearLastBatch().catch(() => {}),
          () => showToast({ message: 'Não consegui desfazer.', tone: 'error' }),
        );
      },
    });
    setSaving(false);
    if (left.length) {
      commit(left);
      return;
    }
    clearScanFiles();
    await clearLot();
    router.dismissTo('/');
  }

  const n = placeable.length;
  const targetName = target === 'auto' ? 'Auto' : target === POKEDEX_BINDER ? 'Pokédex' : (binders.find((b) => b.id === target)?.name ?? 'Auto');
  const screenTitle = items.length ? `Conferir ${items.length}` : 'Conferir cartas';

  return (
    <View style={styles.screen}>
      {/* O título padrão do _layout (renderHeaderTitle) já põe o número da conta na fonte do sistema. */}
      <Stack.Screen options={{ title: screenTitle }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.type === 'head' ? r.block : r.item.id)}
        contentContainerStyle={[styles.list, { paddingBottom: BOTTOM_BAR_SPACE + insets.bottom }]}
        ListHeaderComponent={
          <View style={styles.top}>
            <Chip label={`Destino: ${targetName}`} icon="chevron-down" mode="button" onPress={() => setTargetOpen(true)} />
            {blocked ? (
              <View style={styles.noPocket}>
                <Notice tone="warning">
                  Sem bolso vazio para {blocked} {blocked === 1 ? 'carta' : 'cartas'}. Nenhuma carta do fichário é substituída.
                </Notice>
                <Button title="Novo fichário" variant="secondary" icon="add" onPress={() => router.push('/binder-edit')} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={<EmptyState title="Lote vazio" text="Volte para a câmera e leia algumas cartas." />}
        renderItem={({ item: row }) =>
          row.type === 'head' ? (
            <GroupLabel>
              {BLOCK_TITLE[row.block]} ({row.count})
            </GroupLabel>
          ) : (
            <LotRow
              item={row.item}
              dests={destsOf.get(row.item.id) ?? []}
              owned={alreadyOwned(row.item, entries)}
              onPatch={(c) => patch(row.item.id, c)}
              onDrop={() => dropItem(row.item.id)}
              onOpen={() => {
                const brief = briefOf(row.item);
                if (brief) setSheet({ item: row.item, brief });
              }}
              onRetry={() => {
                commit(items!.filter((i) => i.id !== row.item.id));
                router.back();
              }}
              onSearch={() => {
                const r = row.item.reading;
                router.push({ pathname: '/consulta', params: { pick: row.item.id, q: readingQuery({ dex: r.speciesId, name: r.name, hp: r.hp, number: r.number }) } });
              }}
            />
          )
        }
      />
      <BottomBar bottomInset={insets.bottom}>
        <Button title={n ? `Colocar ${n} ${n === 1 ? 'carta' : 'cartas'}` : 'Colocar'} disabled={!n} busy={saving} onPress={place} />
      </BottomBar>

      <InfoSheet visible={targetOpen} onClose={() => setTargetOpen(false)} title="Onde colocar">
        <ChipGroup label="Onde colocar">
          <Chip label="Auto" selected={target === 'auto'} onPress={() => { setTarget('auto'); setTargetOpen(false); }} />
          <Chip label="Fichário Pokédex" selected={target === POKEDEX_BINDER} onPress={() => { setTarget(POKEDEX_BINDER); setTargetOpen(false); }} />
          {binders.map((b) => (
            <Chip key={b.id} label={b.name || 'Fichário sem nome'} selected={target === b.id} onPress={() => { setTarget(b.id); setTargetOpen(false); }} />
          ))}
        </ChipGroup>
      </InfoSheet>

      <AddCardSheet
        card={sheet?.brief ?? null}
        preferredBinderId={target !== 'auto' && target !== POKEDEX_BINDER ? target : activeBinderId}
        onClose={() => setSheet(null)}
        onAdded={() => {
          const id = sheet?.item.id;
          setSheet(null);
          if (!id) return;
          commit(items!.flatMap((i) => (i.id !== id ? [i] : i.copies > 1 ? [{ ...i, copies: i.copies - 1 }] : [])));
        }}
      />
    </View>
  );
}

function LotRow({
  item,
  dests,
  owned,
  onPatch,
  onDrop,
  onOpen,
  onRetry,
  onSearch,
}: {
  item: LotItem;
  dests: (Destination | null)[];
  owned: boolean;
  onPatch: (c: Partial<LotItem>) => void;
  onDrop: () => void;
  onOpen: () => void;
  onRetry: () => void;
  onSearch: () => void;
}) {
  const block = lotBlock(item);
  const card = cardOf(item);
  const lookup = isLookupOnly(item);
  const plain = item.match.candidates.filter((c) => !c.stamp);
  const base = item.match.candidates.find((c) => c.key === item.picked) ?? null;
  const askLang = item.match.reasons.includes(PT_OR_EN) && !!card && allowsLang(card, 'pt') && allowsLang(card, 'en');

  function nextCandidate() {
    if (plain.length < 2) return;
    const at = plain.findIndex((c) => c.key === item.picked);
    const next = plain[(at + 1) % plain.length];
    onPatch({ picked: next.key, stampKey: null, printCode: defaultPrint(next) });
  }

  const lang = itemLang(item);
  const title = card ? (lang === 'pt' && card.ptName ? card.ptName : card.name) : 'Não reconheci';
  const hpText = card?.hp != null ? `HP ${card.hp}` : item.reading.hp != null ? `HP ${item.reading.hp}` : null;
  const sub = card ? [card.set.abbr, card.number, hpText].filter(Boolean).join(' · ') : (item.reading.name ?? '');
  const placeLine = block === 'sure' || block === 'version' || item.checked ? destText(dests) : null;
  // O rótulo troca o que está dentro da linha: o leitor de tela precisa ouvir tudo o que ela mostra.
  const rowLabel = [title, sub, placeLine, owned ? 'Você já tem' : null, item.copies > 1 ? `${item.copies} cópias` : null, card && !lookup ? 'abrir para colocar' : null].filter(Boolean).join(', ');

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.photos}>
          <YourPhoto uri={item.thumb} />
          <CatalogPhoto card={card} item={item} onPress={plain.length > 1 ? nextCandidate : undefined} />
        </View>
        <Pressable style={styles.rowBody} onPress={onOpen} disabled={!card || lookup} role="button" aria-disabled={!card || lookup} accessibilityLabel={rowLabel}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {sub ? (
            <Text style={styles.rowSub} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
          {placeLine ? <Text style={dests[0] ? styles.rowDest : styles.noDest} numberOfLines={1}>{placeLine}</Text> : null}
          {owned ? <Text style={styles.owned}>Você já tem</Text> : null}
          {item.copies > 1 ? <Badge label={`${item.copies} cópias`} /> : null}
        </Pressable>
        {block !== 'attention' || card ? <IconButton icon="close" label="Tirar do lote" onPress={onDrop} color={colors.textMuted} /> : null}
      </View>

      {lookup ? <Notice>{LOOKUP_PRICE.onlyLookup}</Notice> : null}

      {askLang ? (
        <ChipGroup label="Idioma da carta">
          <Chip label="PT" accessibilityLabel="Português" selected={lang === 'pt'} onPress={() => onPatch({ lang: 'pt', checked: true })} />
          <Chip label="EN" accessibilityLabel="Inglês" selected={lang === 'en'} onPress={() => onPatch({ lang: 'en', checked: true })} />
        </ChipGroup>
      ) : null}

      {block === 'version' || (block === 'attention' && base && (base.prints.length > 1 || siblings(base, item.match.candidates).some((c) => c.stamp))) ? (
        <VersionChips item={item} base={base} onPatch={onPatch} />
      ) : null}

      {block === 'attention' && card ? (
        <ChipGroup label="Incluir no lote" mode="checkbox">
          <Chip label="Incluir" mode="checkbox" selected={item.checked} onPress={() => onPatch({ checked: !item.checked })} />
        </ChipGroup>
      ) : null}

      {block === 'attention' && !card ? (
        <View style={styles.actions}>
          <Chip label="Tentar" icon="camera-outline" mode="button" onPress={onRetry} />
          <Chip label="Procurar" icon="search" mode="button" onPress={onSearch} />
          <Chip label="Pular" mode="button" onPress={onDrop} />
        </View>
      ) : null}
    </View>
  );
}

function VersionChips({ item, base, onPatch }: { item: LotItem; base: LookupCard | null; onPatch: (c: Partial<LotItem>) => void }) {
  if (!base) return null;
  const stamped = siblings(base, item.match.candidates).filter((c) => c.stamp);
  return (
    <ChipGroup label="Versão da carta">
      {base.prints.map((p) => (
        <PrintChip key={p.code} code={p.code} selected={!item.stampKey && item.printCode === p.code} onPress={() => onPatch({ stampKey: null, printCode: p.code })} />
      ))}
      {stamped.map((c) => (
        <Chip key={c.key} label={c.stamp ?? 'Selo'} selected={item.stampKey === c.key} onPress={() => onPatch({ stampKey: c.key, printCode: defaultPrint(c) })} />
      ))}
    </ChipGroup>
  );
}

function PrintChip({ code, selected, onPress }: { code: PrintCode; selected: boolean; onPress: () => void }) {
  return <Chip label={PRINT_LABEL[code]} selected={selected} onPress={onPress} />;
}

/** Para onde a carta vai: "→ #151 Mew · pág. 12 e mais 1". */
function destText(dests: (Destination | null)[]) {
  const first = dests[0];
  if (!dests.length) return null;
  if (!first) return 'Sem bolso vazio';
  const place = first.kind === 'extra' ? `Bolso livre · ${first.where}` : `${first.title} · ${first.where}`;
  return `→ ${place}${dests.length > 1 ? ` e mais ${dests.length - 1}` : ''}`;
}

function YourPhoto({ uri }: { uri?: string }) {
  return (
    <View style={styles.photo} accessible accessibilityLabel="Sua foto da carta">
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="camera-outline" size={18} color={colors.iconFaint} />}
    </View>
  );
}

function CatalogPhoto({ card, item, onPress }: { card: LookupCard | null; item: LotItem; onPress?: () => void }) {
  const url = card ? cardPhoto(card, itemLang(item) ?? 'en', 'grid').url : null;
  const body = url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={null} /> : <Ionicons name="help" size={18} color={colors.iconFaint} />;
  if (!onPress) {
    return (
      <View style={styles.photo} accessible accessibilityLabel="Foto do catálogo">
        {body}
      </View>
    );
  }
  return (
    <Pressable style={styles.photo} onPress={onPress} role="button" accessibilityLabel="Trocar para a próxima carta possível">
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm },
  top: { gap: space.sm, marginBottom: space.sm, alignItems: 'flex-start' },
  noPocket: { gap: space.sm, alignSelf: 'stretch' },
  row: { gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  photos: { flexDirection: 'row', gap: space.sm },
  photo: { width: PHOTO_W, height: PHOTO_H, minHeight: TOUCH, borderRadius: radius.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  rowBody: { flex: 1, minWidth: 0, gap: space.xxs, minHeight: TOUCH, justifyContent: 'center' },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowSub: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  rowDest: { ...typography.caption, ...typography.tabular, color: colors.heading },
  noDest: { ...typography.caption, color: semantic.warning.fg },
  owned: { ...typography.caption, color: colors.textMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
