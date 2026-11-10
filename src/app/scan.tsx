// Adicionar pela câmera: a câmera em laço e a bandeja do lote. Nada entra na coleção aqui: quem coloca é a conferência.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardScanner, clearScanFiles, OCR_UNAVAILABLE, saveThumb } from '@/components/card-scanner';
import { Button, Chip, ChipGroup, EmptyState, InfoSheet, Loading, Segmented, showToast, type IconName } from '@/components/ui';
import { readCard, readingKey, type CardReading } from '@/lib/card-ocr';
import { ensureLookupLoaded, useLookupIndex } from '@/lib/lookup-index';
import {
  clearLastBatch,
  clearLot,
  isLookupOnly,
  loadLastBatch,
  loadLot,
  newItemId,
  newLotItem,
  saveLot,
  shouldAccept,
  undoTargets,
  type LastBatch,
  type LotItem,
} from '@/lib/scan-lot';
import { matchReading, ocrDictionaries, type LotLang } from '@/lib/scan-match';
import { CONDITIONS, POKEDEX_BINDER, type Condition } from '@/lib/types';
import { useBinders, useCollectionActions, useCollectionReady, useEntries } from '@/store/collection';
import { colors, radius, semantic, space, typography } from '@/theme';

import { isOcrAvailable, type OcrResult, type OcrScript } from '../../modules/card-ocr';

const LANG_OPTIONS: { id: LotLang; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'pt', label: 'PT' },
  { id: 'en', label: 'EN' },
  { id: 'ja', label: 'JP' },
];
const READER_OF: Record<LotLang, 'auto' | OcrScript> = { auto: 'auto', pt: 'latin', en: 'latin', ja: 'japanese' };
const HISTORY = 3;
const MISSES_FOR_TIP = 3;
const DOUBLE_BUZZ_MS = 120;

/** Link direto (web) não tem para onde voltar. */
const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function ScanScreen() {
  if (!isOcrAvailable) return <EmptyState title="Câmera indisponível" text={OCR_UNAVAILABLE} action={<Button title="Voltar" variant="secondary" onPress={leave} />} />;
  return <Gate />;
}

/** Espera a coleção e o índice e pergunta sobre o lote que ficou pela metade. */
function Gate() {
  const ready = useCollectionReady();
  const { status, header } = useLookupIndex();
  const [saved, setSaved] = useState<LotItem[] | 'none' | null>(null);
  const [started, setStarted] = useState<LotItem[] | null>(null);

  useEffect(() => {
    ensureLookupLoaded().catch(() => {});
    loadLot().then((l) => setSaved(l?.length ? l : 'none'));
  }, []);

  if (!ready || saved === null || status === 'idle' || status === 'loading' || status === 'downloading') return <Loading label="Preparando as cartas" />;
  if (status !== 'ready' || !header) {
    return <EmptyState title="Conecte uma vez para baixar as cartas" text="A leitura compara com a lista de cartas, que fica guardada no aparelho." action={<Button title="Voltar" variant="secondary" onPress={leave} />} />;
  }
  if (started) return <Scan initial={started} />;
  if (saved === 'none') return <Scan initial={[]} />;
  const n = saved.length;
  return (
    <EmptyState
      title={`Lote com ${n} ${n === 1 ? 'carta' : 'cartas'}`}
      text="Você deixou este lote pela metade. Nada foi colocado na coleção ainda."
      action={
        <View style={styles.resume}>
          <Button title={`Continuar lote de ${n} ${n === 1 ? 'carta' : 'cartas'}`} onPress={() => setStarted(saved)} />
          <Button
            title="Descartar"
            variant="secondary"
            onPress={() => {
              clearScanFiles();
              void clearLot().then(() => setStarted([]));
            }}
          />
        </View>
      }
    />
  );
}

function buzz(kind: 'ok' | 'doubt') {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  if (kind === 'doubt') setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), DOUBLE_BUZZ_MS);
}

function itemTitle(item: LotItem) {
  const r = item.reading;
  const num = r.number ? (r.number.total ? `${r.number.left}/${r.number.total}` : r.number.left) : null;
  return [item.match.candidates[0]?.name ?? r.name ?? 'Não reconheci', num].filter(Boolean).join(' · ');
}

const MARK: Record<'exact' | 'doubt' | 'none' | 'lookup', { icon: IconName; color: string; label: string }> = {
  exact: { icon: 'checkmark', color: semantic.success.fg, label: 'certa' },
  doubt: { icon: 'help', color: semantic.warning.fg, label: 'em dúvida' },
  none: { icon: 'close', color: semantic.danger.fg, label: 'não reconhecida' },
  lookup: { icon: 'search', color: colors.textMuted, label: 'só consulta' },
};
const markOf = (item: LotItem) => MARK[isLookupOnly(item) ? 'lookup' : item.match.status];

function Scan({ initial }: { initial: LotItem[] }) {
  const insets = useSafeAreaInsets();
  const binders = useBinders();
  const entries = useEntries();
  const { removeEntries } = useCollectionActions();
  const dict = ocrDictionaries();
  const [items, setItems] = useState(initial);
  const [lotLang, setLotLang] = useState<LotLang>('auto');
  const [target, setTarget] = useState<'auto' | string>('auto');
  const [condition, setCondition] = useState<Condition>('NM');
  const [panel, setPanel] = useState<'lang' | 'target' | 'condition' | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [lastBatch, setLastBatch] = useState<LastBatch | null>(null);
  const [lot] = useState(() => Date.now().toString(36));
  const itemsRef = useRef(initial);
  const history = useRef<CardReading[]>([]);
  const accepted = useRef<string | null>(null);
  const misses = useRef(0);

  function commit(next: LotItem[]) {
    itemsRef.current = next;
    setItems(next);
    saveLot(next).catch(() => {});
  }

  // A conferência mexe no mesmo lote: ao voltar, vale o que ficou lá.
  useFocusEffect(
    useCallback(() => {
      void activateKeepAwakeAsync('scan').catch(() => {});
      loadLot().then((l) => {
        const current = l ?? [];
        itemsRef.current = current;
        setItems(current);
      });
      loadLastBatch().then(setLastBatch);
      return () => {
        void deactivateKeepAwake('scan').catch(() => {});
      };
    }, []),
  );

  async function onPage(page: OcrResult, uri: string, manual: boolean) {
    if (!page.lines.length) {
      accepted.current = null;
      history.current = [];
      misses.current = 0;
      setTip(null);
      return 'keep' as const;
    }
    const reading = readCard(page, dict);
    const key = readingKey(reading);
    // A mesma carta ainda na moldura: ignora até o texto mudar ou sumir ("+1" soma outra cópia).
    if (key && key === accepted.current) return 'keep' as const;
    history.current = [...history.current, reading].slice(-HISTORY);
    const match = matchReading(reading, { lotLang });
    if (!manual && !shouldAccept(history.current, match)) {
      misses.current += 1;
      if (misses.current >= MISSES_FOR_TIP) setTip('Incline um pouco');
      return 'keep' as const;
    }
    misses.current = 0;
    history.current = [];
    accepted.current = key;
    setTip(null);
    const id = newItemId();
    const thumb = await saveThumb(uri, page, lot, id);
    const item = newLotItem(reading, match, thumb, id);
    commit([...itemsRef.current, item]);
    buzz(item.checked ? 'ok' : 'doubt');
    return 'next' as const;
  }

  function addCopy() {
    const cur = itemsRef.current;
    const last = cur[cur.length - 1];
    if (!last || isLookupOnly(last)) return;
    commit([...cur.slice(0, -1), { ...last, copies: last.copies + 1 }]);
    buzz('ok');
  }

  function undoLast() {
    const last = lastBatch;
    if (!last) return;
    const ids = undoTargets(last, entries);
    removeEntries(ids).then(
      () => {
        clearLastBatch().catch(() => {});
        setLastBatch(null);
        showToast({ message: `${ids.length} ${ids.length === 1 ? 'carta tirada' : 'cartas tiradas'} do fichário` });
      },
      () => showToast({ message: 'Não consegui desfazer.', tone: 'error' }),
    );
  }

  const count = items.filter((i) => !isLookupOnly(i)).length;
  const last = items[items.length - 1];
  const targetName = target === 'auto' ? 'Auto' : target === POKEDEX_BINDER ? 'Pokédex' : (binders.find((b) => b.id === target)?.name ?? 'Auto');
  const langLabel = LANG_OPTIONS.find((o) => o.id === lotLang)?.label ?? 'Auto';

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topRow} style={styles.topScroll}>
        <Chip label={`Idioma: ${langLabel}`} mode="button" onPress={() => setPanel('lang')} />
        <Chip label={`Destino: ${targetName}`} mode="button" onPress={() => setPanel('target')} />
        <Chip label={`Estado: ${condition}`} mode="button" onPress={() => setPanel('condition')} />
        {!items.length && lastBatch ? <Chip label="Desfazer último lote" icon="arrow-undo-outline" mode="button" onPress={undoLast} /> : null}
      </ScrollView>
      <View style={styles.scanner}>
        <CardScanner
          mode="batch"
          script={READER_OF[lotLang]}
          onPage={onPage}
          overlay={
            tip || last ? (
              <View style={styles.lastRead} accessibilityLiveRegion="polite">
                {tip ? <Text style={styles.lastText}>{tip}</Text> : null}
                {!tip && last ? (
                  <>
                    <Ionicons name={markOf(last).icon} size={16} color={markOf(last).color} />
                    <Text style={styles.lastText} numberOfLines={1}>
                      {isLookupOnly(last) ? `${itemTitle(last)} · Só consulta` : itemTitle(last)}
                    </Text>
                  </>
                ) : null}
              </View>
            ) : null
          }
          tray={
            items.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tray} style={styles.trayScroll} accessibilityLabel={`${items.length} cartas lidas`}>
                {items.map((item) => {
                  const mark = markOf(item);
                  return (
                    <View key={item.id} style={styles.trayMark} accessible accessibilityLabel={`${itemTitle(item)}, ${mark.label}`}>
                      <Ionicons name={mark.icon} size={18} color={mark.color} />
                    </View>
                  );
                })}
              </ScrollView>
            ) : null
          }
          actions={
            <>
              <Chip label="+1" accessibilityLabel="Mais uma cópia da última carta" mode="button" disabled={!last || isLookupOnly(last)} onPress={addCopy} />
              <View style={styles.reviewBox}>
                <Button
                  title={count ? `Revisar ${count}` : 'Revisar'}
                  disabled={!items.length}
                  onPress={() => router.push({ pathname: '/scan-review' as string, params: { target, condition } } as Href)}
                />
              </View>
            </>
          }
        />
      </View>
      <InfoSheet visible={panel === 'lang'} onClose={() => setPanel(null)} title="Idioma do lote">
        <Segmented label="Idioma do lote" options={LANG_OPTIONS} value={lotLang} onChange={(v) => { history.current = []; setLotLang(v); setPanel(null); }} />
      </InfoSheet>
      <InfoSheet visible={panel === 'target'} onClose={() => setPanel(null)} title="Onde colocar">
        <ChipGroup label="Onde colocar">
          <Chip label="Auto" selected={target === 'auto'} onPress={() => { setTarget('auto'); setPanel(null); }} />
          <Chip label="Fichário Pokédex" selected={target === POKEDEX_BINDER} onPress={() => { setTarget(POKEDEX_BINDER); setPanel(null); }} />
          {binders.map((b) => (
            <Chip key={b.id} label={b.name || 'Fichário sem nome'} selected={target === b.id} onPress={() => { setTarget(b.id); setPanel(null); }} />
          ))}
        </ChipGroup>
      </InfoSheet>
      <InfoSheet visible={panel === 'condition'} onClose={() => setPanel(null)} title="Estado das cartas">
        <Segmented label="Estado das cartas" options={CONDITIONS.map((c) => ({ id: c.id, label: c.label, hint: c.desc }))} value={condition} onChange={(v) => { setCondition(v); setPanel(null); }} />
      </InfoSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  resume: { alignSelf: 'stretch', gap: space.sm },
  topScroll: { flexGrow: 0 },
  topRow: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  scanner: { flex: 1 },
  lastRead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm, backgroundColor: colors.backdrop, maxWidth: '100%' },
  lastText: { ...typography.caption, ...typography.tabular, color: colors.text, flexShrink: 1 },
  reviewBox: { flex: 1, minWidth: 0 },
  trayScroll: { flexGrow: 0 },
  tray: { gap: space.xs, paddingHorizontal: space.lg, paddingTop: space.sm },
  trayMark: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
});
