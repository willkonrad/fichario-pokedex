import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { CardImage } from '@/components/card-image';
import type { PressState } from '@/components/icon-button';
import { Badge, Button, Chip, ChipGroup, InfoSheet, Notice, Segmented, showToast, Skeleton } from '@/components/ui';
import {
  buildNewEntry,
  cardParams,
  defaultVersion,
  destinationParams,
  destinationsFor,
  loadCardFacts,
  placedText,
  speciesOfCard,
  versionKey,
  versionLabel,
  type CardFacts,
  type Destination,
} from '@/lib/add-card';
import { entryPlace, placeText } from '@/lib/lists';
import type { CardBrief } from '@/lib/tcgdex';
import { CONDITIONS, LANG_LABEL, LANG_SHORT, type Condition } from '@/lib/types';
import { keyOf, useBinders, useCollectionActions, useEntries, useSettings } from '@/store/collection';
import { CARD_RATIO, colors, radius, semantic, space, TOUCH, typography } from '@/theme';

const THUMB = 72;

/**
 * "Adicionar" do fluxo "+ Carta" (H2): a carta escolhida, a versão, o estado e o bolso sugerido, e "Colocar" salva
 * direto, sem o formulário inteiro (que continua em "Mais detalhes"). Depois de colocar, um aviso com "Desfazer".
 */
export function AddCardSheet({
  card,
  preferredBinderId,
  onClose,
  onAdded,
  onUndone,
}: {
  card: CardBrief | null;
  /** Fichário livre sugerido primeiro (o aberto na tela inicial), se tiver espaço. */
  preferredBinderId?: string;
  onClose: () => void;
  onAdded: () => void;
  /** O "Desfazer" do aviso tirou a carta colocada (para o contador de cartas adicionadas). */
  onUndone?: () => void;
}) {
  if (!card) return null;
  return (
    <AddCardForm
      key={`${card.id}|${card.lang}|${card.stamp?.label ?? ''}`}
      card={card}
      preferredBinderId={preferredBinderId}
      onClose={onClose}
      onAdded={onAdded}
      onUndone={onUndone}
    />
  );
}

function AddCardForm({
  card,
  preferredBinderId,
  onClose,
  onAdded,
  onUndone,
}: {
  card: CardBrief;
  preferredBinderId?: string;
  onClose: () => void;
  onAdded: () => void;
  onUndone?: () => void;
}) {
  const settings = useSettings();
  const binders = useBinders();
  const entries = useEntries();
  const { saveEntry, removeEntry, restoreEntry } = useCollectionActions();
  const [facts, setFacts] = useState<CardFacts | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [condition, setCondition] = useState<Condition>('NM');
  const [destKey, setDestKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCardFacts(card)
      .then((f) => alive && setFacts(f))
      // Falha inesperada: segue com os dados da lista (a carta salva assim mesmo), em vez de ficar "Carregando…".
      .catch(() => alive && setFacts({ detail: null, enDetail: null, versions: [] }));
    return () => {
      alive = false;
    };
  }, [card]);

  const versions = facts?.versions ?? [];
  const version = versions.find((o) => versionKey(o) === picked) ?? (facts ? defaultVersion(versions, card) : null);
  const dex = speciesOfCard(card, facts?.detail);
  const dests = destinationsFor({ dex, settings, binders, entries, activeBinderId: preferredBinderId });
  // "Substituir" tira uma carta do fichário: nunca vem marcado sozinho, nem quando é a única opção.
  const dest = dests.find((d) => d.key === destKey) ?? dests.find((d) => d.kind !== 'replace');
  const name = facts?.detail?.name ?? card.name;
  const copies = Object.values(entries).filter((e) => e.cardId === card.id && e.lang === card.lang);
  const copyPlaces = copies.slice(0, 2).map((e) => placeText(entryPlace(e, settings, binders)));
  const copiesText =
    copies.length === 1
      ? `Você já tem esta carta: ${copyPlaces[0]}`
      : `Você já tem ${copies.length} cópias: ${copyPlaces.join('; ')}${copies.length > 2 ? '; …' : ''}`;
  const number = facts?.detail?.localId ?? card.localId;

  async function place() {
    if (!dest || saving) return;
    setSaving(true);
    setError(null);
    const entry = buildNewEntry({ card, facts, version, condition, dest });
    try {
      await saveEntry(entry);
    } catch (e) {
      setError(`Não consegui salvar: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
      return;
    }
    const id = keyOf(entry.binderId, entry.dex, entry.slot);
    const previous = dest.replaces;
    showToast({
      message: placedText(entry.cardName, dest),
      actionLabel: 'Desfazer',
      onAction: () => {
        (previous ? restoreEntry(previous) : removeEntry(id)).then(onUndone, (e) =>
          showToast({ message: e instanceof Error ? e.message : 'Não consegui desfazer.', tone: 'error' }),
        );
      },
      // Substituir tirou outra carta do fichário: mais tempo para desfazer (como na tela da carta).
      duration: previous ? 8000 : undefined,
    });
    onAdded();
  }

  function moreDetails() {
    if (!dest) return;
    // `mode: 'add'`: depois de colocar, o aviso da tela da carta oferece "Adicionar outra". O estado já escolhido aqui
    // segue para a tela da carta.
    const params = { ...destinationParams(dest), ...cardParams(card, version), condition, mode: 'add' };
    onClose();
    router.push({ pathname: '/card', params });
  }

  function newBinder() {
    onClose();
    router.push('/binder-edit');
  }

  const footer = (
    <>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        title={
          !facts ? 'Carregando…' : dest ? `${dest.kind === 'replace' ? 'Substituir' : 'Colocar'} · ${dest.where}` : dests.length ? 'Escolha onde colocar' : 'Colocar'
        }
        icon="add-circle-outline"
        onPress={place}
        busy={saving || !facts}
        disabled={!dest}
      />
      <Button title="Mais detalhes" variant="ghost" onPress={moreDetails} disabled={!dest} label="Mais detalhes: abrir a carta com todos os campos" />
    </>
  );

  return (
    <InfoSheet visible onClose={onClose} title={name} footer={footer}>
      <View style={styles.head}>
        <View style={styles.thumb}>
          <CardImage
            image={card.image}
            imageUrl={card.imageUrl}
            cardId={card.lang === 'ja' ? undefined : card.id}
            nameEn={card.lang === 'en' || card.dataLang === 'en' ? card.name : undefined}
            setNameEn={card.setNameEn}
            localId={card.localId}
            dex={dex}
            compact
            photo={version?.stamp ? version.photo : card.stamp ? card.imageUrl : undefined}
            stampKeys={version?.stampKeys}
          />
        </View>
        <View style={styles.headText}>
          <Text style={styles.set} numberOfLines={2}>
            {facts?.detail?.set.name ?? card.setName}
            {number ? ` · nº ${number}` : ''}
          </Text>
          <Badge label={LANG_SHORT[card.lang]} accessibilityLabel={LANG_LABEL[card.lang]} />
          {copies.length ? (
            <Text style={styles.copies} numberOfLines={2}>
              {copiesText}
            </Text>
          ) : null}
        </View>
      </View>

      <Text style={styles.label}>Versão</Text>
      {!facts ? (
        <View style={styles.wrap} aria-hidden>
          <Skeleton width={84} height={TOUCH} radius={radius.pill} />
          <Skeleton width={84} height={TOUCH} radius={radius.pill} />
        </View>
      ) : versions.length ? (
        <ChipGroup label="Versão">
          {versions.map((o) => (
            <Chip key={versionKey(o)} label={versionLabel(o)} selected={!!version && versionKey(version) === versionKey(o)} onPress={() => setPicked(versionKey(o))} />
          ))}
        </ChipGroup>
      ) : (
        <Text style={styles.muted}>Versões desconhecidas: use Mais detalhes se não for a normal.</Text>
      )}

      <Text style={styles.label}>Estado</Text>
      <Segmented label="Estado da carta" options={CONDITIONS.map((c) => ({ id: c.id, label: c.label, hint: c.desc }))} value={condition} onChange={setCondition} />

      <Text style={styles.label}>Onde colocar</Text>
      {dests.length ? (
        <View role="radiogroup" aria-label="Onde colocar" style={styles.dests}>
          {dests.map((d) => (
            <DestinationOption key={d.key} dest={d} selected={d.key === dest?.key} onPress={() => setDestKey(d.key)} />
          ))}
        </View>
      ) : (
        <>
          <Notice tone="warning">Nenhum bolso livre. Crie um fichário ou aumente as páginas de um.</Notice>
          <Button title="Novo fichário" variant="secondary" icon="add" onPress={newBinder} />
        </>
      )}
    </InfoSheet>
  );
}

const DEST_ICON: Record<Destination['kind'], 'albums-outline' | 'folder-outline' | 'star-outline' | 'repeat'> = {
  dex: 'albums-outline',
  binder: 'folder-outline',
  extra: 'star-outline',
  replace: 'repeat',
};

/** Uma opção de bolso (radio): título e onde fica. */
function DestinationOption({ dest, selected, onPress }: { dest: Destination; selected: boolean; onPress: () => void }) {
  // Na web, a opção também responde à barra de espaço (como um radio do navegador).
  const keys =
    Platform.OS === 'web'
      ? ({
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            if (e.key !== ' ' && e.key !== 'Spacebar') return;
            e.preventDefault();
            onPress();
          },
        } as object)
      : null;
  return (
    <Pressable
      onPress={onPress}
      role="radio"
      aria-checked={selected}
      accessibilityLabel={`${dest.title}, ${dest.detail}`}
      {...keys}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [styles.dest, selected && styles.destOn, hovered && !selected && styles.destHover, pressed && { opacity: 0.8 }];
      }}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? semantic.selected.bg : colors.borderStrong} />
      <View style={styles.destBody}>
        <Text style={styles.destTitle} numberOfLines={1}>
          {dest.title}
        </Text>
        <Text style={styles.destDetail} numberOfLines={1}>
          {dest.detail}
        </Text>
      </View>
      <Ionicons name={DEST_ICON[dest.kind]} size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  thumb: { width: THUMB, height: THUMB / CARD_RATIO, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  headText: { flex: 1, minWidth: 0, gap: space.sm },
  set: { ...typography.body, color: colors.text },
  copies: { ...typography.caption, color: colors.textMuted },
  label: { ...typography.label, color: colors.textMuted, marginTop: space.xs },
  muted: { ...typography.caption, color: colors.textMuted },
  wrap: { flexDirection: 'row', gap: space.sm },
  dests: { gap: space.sm },
  dest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  destOn: { borderColor: semantic.selected.border, backgroundColor: semantic.selected.soft },
  destHover: { borderColor: colors.borderStrong },
  destBody: { flex: 1, minWidth: 0 },
  destTitle: { ...typography.bodyStrong, color: colors.text },
  destDetail: { ...typography.caption, color: colors.textMuted },
});
