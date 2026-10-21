import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardAttributes, cardAttributeItems, CardMoves } from '@/components/card-facts';
import { CardImage } from '@/components/card-image';
import { PricePanel } from '@/components/price-panel';
import { BOTTOM_BAR_SPACE, BottomBar, Button, Card, Chip, EmptyState, GroupLabel, Input, Loading, Section, Segmented } from '@/components/ui';
import { formatDex, getSpecies, speciesInCardName } from '@/data/pokedex';
import { customTotalSlots, indexOfDex, indexOfExtra, physicalPosition } from '@/lib/binder';
import { formatWhen } from '@/lib/quotes';
import { cardDetail, type CardDetail } from '@/lib/tcgdex';
import { CONDITIONS, LANG_LABEL, VARIANTS, type CardLang, type Condition, type Entry, type Variant } from '@/lib/types';
import { availableVariants } from '@/lib/variants';
import { keyOf, useCollection } from '@/store/collection';
import { CARD_RATIO, colors, MAX_WIDTH, radius, shadow } from '@/theme';

/** `binder` = fichário livre (sem ele, é o fichário Pokédex e `dex` diz o Pokémon). */
type Params = { dex?: string; binder?: string; slot: string; cardId?: string; lang?: CardLang; dataLang?: CardLang };

/** Campos que o usuário edita nesta tela (o resto vem do catálogo ou do servidor). */
type Edits = { condition: Condition; variant: Variant; variantNote: string; notes: string; myValueText: string };

export default function CardScreen() {
  const params = useLocalSearchParams<Params>();
  const { ready } = useCollection();
  // O formulário só monta depois de carregar a coleção, para o estado inicial vir da carta salva.
  if (!ready) return <Loading />;
  return <CardForm params={params} />;
}

function CardForm({ params }: { params: Params }) {
  const slot = Number(params.slot ?? 0);
  const { entries, settings, binders, saveEntry, removeEntry, moveEntry } = useCollection();
  const customBinder = params.binder ? binders.find((b) => b.id === params.binder) : undefined;
  const binderId = customBinder?.id;
  // Bolso livre do fichário Pokédex (sobra da última página): a carta fica com dex 0 e slot = nº do bolso livre.
  const isExtra = !customBinder && Number(params.dex ?? -1) === 0;
  const existing = entries[keyOf(binderId, Number(params.dex ?? 0), slot)];
  const isNewCard = !!params.cardId && params.cardId !== existing?.cardId;
  // Carta já no fichário: as alterações são salvas sozinhas.
  const autoSave = !!existing && !isNewCard;
  // Dados salvos da MESMA carta (reserva enquanto a ficha carrega). Ao trocar de carta, a antiga não serve.
  const saved = autoSave ? existing : undefined;
  const cardId = params.cardId ?? existing?.cardId;
  const lang = (params.lang ?? existing?.lang ?? 'pt') as CardLang;
  // Idioma do catálogo de onde vêm os dados (pode ser inglês para coleções que não existem em PT).
  const dataLang = (params.dataLang ?? (isNewCard ? undefined : existing?.dataLang) ?? lang) as CardLang;
  const insets = useSafeAreaInsets();

  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [enDetail, setEnDetail] = useState<CardDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Fichário livre ou bolso livre: o Pokémon vem da própria carta (0 para treinadores e energias).
  const dex =
    customBinder || isExtra
      ? (detail?.dexId?.[0] ?? (detail ? speciesInCardName(detail.name)?.id : undefined) ?? (customBinder ? saved?.dex : undefined) ?? 0)
      : Number(params.dex);

  // Variação escolhida (null = ainda não escolheu: usa a primeira que existe para a carta).
  const [pickedVariant, setPickedVariant] = useState<Variant | null>(isNewCard ? null : (existing?.variant ?? null));
  const [variantNote, setVariantNote] = useState(isNewCard ? '' : (existing?.variantNote ?? ''));
  const [condition, setCondition] = useState<Condition>(isNewCard ? 'NM' : (existing?.condition ?? 'NM'));
  const [notes, setNotes] = useState(isNewCard ? '' : (existing?.notes ?? ''));
  const [myValueText, setMyValueText] = useState(isNewCard || existing?.myValue == null ? '' : formatInput(existing.myValue.value));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [zoom, setZoom] = useState(false);
  const [showAllVariants, setShowAllVariants] = useState(false);
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string | undefined>();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // Carta ampliada: o maior tamanho que cabe na tela, mantendo a proporção.
  const zoomWidth = Math.min(screenWidth - 40, (screenHeight - 140) * CARD_RATIO, 520);
  // Tela larga (computador, tablet deitado): carta à esquerda e informações à direita.
  const wide = screenWidth >= 960;
  const heroWidth = wide ? 360 : Math.min(screenWidth - 120, 260);

  useEffect(() => {
    if (!cardId) return;
    cardDetail(cardId, dataLang)
      .then(setDetail)
      .catch((e) => {
        const msg = String(e?.message ?? e);
        setLoadError(
          /404/.test(msg)
            ? 'A ficha desta carta não está no catálogo (TCGdex) neste idioma. A carta continua salva normalmente.'
            : `Não consegui carregar a ficha da carta (${msg}). Confira a internet.`,
        );
      });
  }, [cardId, dataLang]);

  // O catálogo em inglês descreve as impressões que existem (holo, reverse, Poké Ball, selos…) e dá o nome
  // em inglês, usado pela imagem reserva. PT e EN usam o mesmo id na TCGdex.
  useEffect(() => {
    if (!cardId || lang === 'ja') return;
    cardDetail(cardId, 'en')
      .then(setEnDetail)
      .catch(() => {});
  }, [cardId, lang]);

  // Carta já salva sem imagem: grava a imagem reserva assim que for encontrada, para aparecer no fichário.
  useEffect(() => {
    if (!resolvedImageUrl || !autoSave || !existing || existing.image || existing.imageUrl) return;
    const { id: _id, updatedAt: _u, ...rest } = existing;
    saveEntry({ ...rest, imageUrl: resolvedImageUrl }).catch(() => {});
  }, [resolvedImageUrl, autoSave, existing, saveEntry]);

  const avail = availableVariants(detail, enDetail);
  const variant: Variant = pickedVariant ?? avail.ids[0] ?? 'normal';
  const myValueNum = parseBRL(myValueText);

  /** A carta completa, com as edições atuais (e `patch` por cima, para mudanças feitas agora). */
  function buildEntry(patch: Partial<Edits> = {}): Omit<Entry, 'id' | 'updatedAt'> {
    const e: Edits = { condition, variant, variantNote, notes, myValueText, ...patch };
    const value = parseBRL(e.myValueText);
    const image = detail?.image ?? saved?.image;
    return {
      // Carta já salva: mantém o que só o servidor grava (preços do MYP, imagem reserva antiga).
      ...(autoSave && existing ? { myp: existing.myp, mypOffers: existing.mypOffers, ligaImage: existing.ligaImage } : {}),
      binderId,
      dex: isExtra ? 0 : dex,
      slot,
      cardId: cardId!,
      lang,
      dataLang: dataLang !== lang ? dataLang : undefined,
      cardName: detail?.name ?? saved?.cardName ?? getSpecies(dex)?.name ?? '',
      setName: detail?.set.name ?? saved?.setName ?? '',
      setId: detail?.set.id ?? saved?.setId ?? '',
      localId: detail?.localId ?? saved?.localId ?? '',
      setTotal: (detail?.set.cardCount?.official || detail?.set.cardCount?.total) ?? saved?.setTotal,
      rarity: detail?.rarity ?? saved?.rarity,
      image,
      imageUrl: image ? undefined : (resolvedImageUrl ?? (isNewCard ? undefined : saved?.imageUrl)),
      variant: e.variant,
      variantNote: e.variantNote.trim() || undefined,
      condition: e.condition,
      notes: e.notes.trim() || undefined,
      // Mantém a data de quando o valor foi digitado, se ele não mudou.
      myValue:
        value == null
          ? undefined
          : { value, setAt: existing?.myValue?.value === value ? existing.myValue.setAt : new Date().toISOString() },
    };
  }

  /** Salvamento automático (carta já no fichário). */
  async function autoPersist(patch: Partial<Edits> = {}) {
    if (!autoSave || !cardId) return;
    await saveEntry(buildEntry(patch));
    setSavedAt(new Date().toISOString());
  }

  // Textos: salva 700 ms depois da última tecla e, se sair da tela antes disso, ao sair.
  const textKey = `${variantNote}|${notes}|${myValueText}`;
  const savedTextKey = useRef(textKey);
  const flush = useRef<() => void>(() => {});
  useEffect(() => {
    // Guarda o salvamento com os valores atuais, para o atraso e a saída da tela usarem os mais recentes.
    flush.current = () => {
      if (!autoSave || savedTextKey.current === textKey) return;
      savedTextKey.current = textKey;
      autoPersist().catch(() => {});
    };
  });
  useEffect(() => {
    const t = setTimeout(() => flush.current(), 700);
    return () => clearTimeout(t);
  }, [textKey]);
  useEffect(() => () => flush.current(), []);

  if (!settings || (params.binder && !customBinder)) {
    return <EmptyState title="Fichário não encontrado" text="Ele pode ter sido apagado em outro aparelho." />;
  }
  if (!cardId) {
    return <EmptyState title="Carta não encontrada" text="Ela pode ter sido removida em outro aparelho." />;
  }

  const pos = customBinder
    ? physicalPosition(customBinder, slot)
    : physicalPosition(settings, isExtra ? indexOfExtra(settings, slot) : indexOfDex(settings, dex, slot));
  const mainVariants: Variant[] = [...new Set<Variant>([...avail.ids, variant])];
  const setName = detail?.set.name ?? saved?.setName ?? '';
  const total = detail?.set.cardCount?.official || saved?.setTotal;
  const number = `${detail?.localId ?? saved?.localId ?? ''}${total ? `/${String(total).padStart(3, '0')}` : ''}`;
  const name = detail?.name ?? saved?.cardName ?? '';
  // Mesma carta (id + idioma) em outros bolsos ou fichários.
  const copies = Object.values(entries).filter((e) => e.cardId === cardId && e.lang === lang && e.id !== existing?.id);

  async function addToBinder() {
    setSaving(true);
    try {
      await saveEntry(buildEntry());
      router.dismissTo('/');
    } catch (e) {
      setLoadError(`Não consegui salvar: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  }

  const moveTarget = Number(moveTo) - 1;
  const canMove = !!customBinder && !!moveTo && moveTarget >= 0 && moveTarget < customTotalSlots(customBinder) && moveTarget !== slot;
  async function move() {
    if (!existing || !canMove) return;
    flush.current();
    await moveEntry(existing.id, moveTarget);
    router.dismissTo('/');
  }

  function confirmRemove() {
    const run = async () => {
      if (existing) await removeEntry(existing.id);
      // Não salva textos pendentes de uma carta que acabou de ser removida.
      savedTextKey.current = textKey;
      router.dismissTo('/');
    };
    if (Platform.OS === 'web') {
      if (window.confirm(`Tirar ${name || 'esta carta'} do fichário?`)) run();
      return;
    }
    Alert.alert('Remover carta', `Tirar ${name || 'esta carta'} do fichário?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: run },
    ]);
  }

  const cardImageEl = (fit: 'contain' | 'cover') => (
    <CardImage
      image={detail?.image ?? saved?.image}
      imageUrl={isNewCard ? undefined : (saved?.imageUrl ?? existing?.ligaImage)}
      cardId={lang === 'ja' ? undefined : cardId}
      nameEn={enDetail?.name}
      setNameEn={enDetail?.set.name}
      localId={detail?.localId ?? saved?.localId}
      quality="high"
      contentFit={fit}
      dex={dex || undefined}
      onResolved={setResolvedImageUrl}
    />
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: name || 'Carta' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: (isNewCard ? BOTTOM_BAR_SPACE : 40) + insets.bottom }} keyboardShouldPersistTaps="handled">
        {/* Carta grande sobre a faixa vermelha (no celular) ou à esquerda (tela larga); toque para ampliar */}
        <View style={[styles.band, wide && { height: 120 }]} />
        <View style={wide ? styles.wideRow : undefined}>
        <Pressable
          style={[styles.hero, { width: heroWidth, height: heroWidth / CARD_RATIO }, wide && styles.heroWide]}
          onPress={() => setZoom(true)}
          accessibilityRole="imagebutton"
          accessibilityLabel="Ampliar imagem da carta">
          {!detail && !existing && !loadError ? <Loading /> : cardImageEl('contain')}
          <View style={styles.zoomHint}>
            <Ionicons name="expand-outline" size={14} color="#fff" />
          </View>
        </Pressable>
        <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
          <Pressable style={styles.zoomBackdrop} onPress={() => setZoom(false)} accessibilityLabel="Fechar imagem ampliada">
            <View style={[styles.zoomBox, { width: zoomWidth, height: zoomWidth / CARD_RATIO }]}>{cardImageEl('contain')}</View>
            <Text style={styles.zoomClose}>Toque para fechar</Text>
          </Pressable>
        </Modal>

        <View style={[styles.content, wide && styles.contentWide]}>
          {/* Coleção · número, nome e etiquetas */}
          <Text style={styles.setLine} numberOfLines={2}>
            {setName.toUpperCase()}
            {number ? ` · ${number}` : ''}
          </Text>
          <Text style={styles.title}>{name}</Text>
          <View style={styles.badges}>
            <Badge text={LANG_LABEL[lang]} tone="red" />
            {detail?.rarity && detail.rarity !== 'None' ? <Badge text={detail.rarity} /> : null}
            <Badge icon="location-outline" text={`Pág. ${pos.page}${pos.side ? ` · folha ${pos.sheet} (${pos.side})` : ''} · bolso ${pos.pocket}${isExtra ? ' (livre)' : ''}`} />
          </View>
          {copies.length ? (
            <View style={styles.copies}>
              <Ionicons name="copy-outline" size={14} color={colors.blue} />
              <Text style={styles.copiesText}>
                Você já tem esta carta {copies.length > 1 ? `em ${copies.length} lugares` : 'em outro lugar'}:{' '}
                {copies
                  .slice(0, 3)
                  .map((c) =>
                    c.binderId
                      ? `${binders.find((b) => b.id === c.binderId)?.name ?? 'fichário'} (bolso ${c.slot + 1})`
                      : c.dex === 0
                        ? 'Pokédex (bolso livre)'
                        : `Pokédex ${formatDex(c.dex)}`,
                  )
                  .join(', ')}
              </Text>
            </View>
          ) : null}
          {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

          {/* Valor (MYP Cards ou "Meu valor") e histórico */}
          <View style={{ marginTop: 18 }}>
            <PricePanel entry={isNewCard ? undefined : existing} condition={condition} myValue={myValueNum} />
          </View>

          {/* Minha carta: estado, variação, meu valor, observações */}
          <GroupLabel>Minha carta</GroupLabel>
          <Card style={{ gap: 4 }}>
            <Section title="Estado" hint={CONDITIONS.find((c) => c.id === condition)?.desc}>
              <Segmented
                label="Estado da carta"
                options={CONDITIONS.map((c) => ({ id: c.id, label: c.label, hint: c.desc }))}
                value={condition}
                onChange={(c) => {
                  setCondition(c);
                  autoPersist({ condition: c }).catch(() => {});
                }}
              />
            </Section>
            <Section
              title="Variação"
              hint={
                !detail && !enDetail && !loadError
                  ? 'Carregando as variações desta carta…'
                  : avail.ids.length
                    ? `Existem ${avail.ids.length} ${avail.ids.length === 1 ? 'versão' : 'versões'} desta carta${avail.stamps.length ? ` · selos: ${avail.stamps.join(', ')}` : ''}.`
                    : 'Não sei quais variações existem para esta carta: escolha a sua.'
              }>
              <View style={styles.wrap}>
                {(showAllVariants || !avail.ids.length ? VARIANTS : VARIANTS.filter((v) => mainVariants.includes(v.id))).map((v) => (
                  <Chip
                    key={v.id}
                    label={v.label}
                    selected={variant === v.id}
                    hint={showAllVariants && avail.ids.includes(v.id)}
                    onPress={() => {
                      setPickedVariant(v.id);
                      autoPersist({ variant: v.id }).catch(() => {});
                    }}
                  />
                ))}
                {!showAllVariants && avail.ids.length ? (
                  <Pressable style={styles.moreChip} onPress={() => setShowAllVariants(true)} accessibilityRole="button">
                    <Text style={styles.moreChipText}>Outra</Text>
                    <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
              {variant === 'other' || variant === 'staff' || variant === 'wPromo' ? (
                <Input
                  value={variantNote}
                  onChangeText={setVariantNote}
                  placeholder={avail.stamps.length ? `Qual selo? (${avail.stamps.join(', ')})` : 'Descreva (ex.: selo Pokémon Center, Staff)'}
                  accessibilityLabel="Descrição da variação"
                />
              ) : null}
            </Section>
            <Section
              title="Meu valor"
              hint={
                existing?.myValue && existing.myValue.value === myValueNum
                  ? `Digitado em ${formatWhen(existing.myValue.setAt)}. Ele vale no lugar do preço do MYP; apague para voltar ao MYP.`
                  : 'Opcional: o valor que você conferiu (ex.: menor anúncio no seu estado no MYP Cards). Vale no lugar do preço do MYP.'
              }>
              <Input
                value={myValueText}
                onChangeText={(t) => setMyValueText(t.replace(/[^\d.,]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="R$ 0,00"
                accessibilityLabel="Meu valor em reais"
              />
            </Section>
            <Section title="Observações">
              <Input value={notes} onChangeText={setNotes} placeholder="Ex.: comprada no evento, assinada…" multiline accessibilityLabel="Observações" />
            </Section>
            {autoSave ? (
              <View style={styles.saved}>
                <Ionicons name="cloud-done-outline" size={14} color={colors.success} />
                <Text style={styles.savedText}>
                  {savedAt ? `Alterações salvas às ${formatWhen(savedAt).split(', ')[1]}` : 'As alterações são salvas automaticamente.'}
                </Text>
              </View>
            ) : null}
          </Card>

          {customBinder && autoSave ? (
            <>
              <GroupLabel>Bolso</GroupLabel>
              <Card>
                <Section
                  title="Mudar de bolso"
                  hint={`Está no bolso ${slot + 1} de ${customTotalSlots(customBinder)}. Se o bolso de destino tiver carta, as duas trocam de lugar.`}>
                  <View style={styles.moveRow}>
                    <Input
                      value={moveTo}
                      onChangeText={(t) => setMoveTo(t.replace(/\D/g, ''))}
                      keyboardType="number-pad"
                      placeholder="Nº do bolso"
                      style={{ flex: 1 }}
                      accessibilityLabel="Mover para o bolso número"
                    />
                    <Button title="Mover" variant="secondary" icon="swap-horizontal" onPress={move} disabled={!canMove} />
                  </View>
                </Section>
              </Card>
            </>
          ) : null}

          {/* Ficha da carta */}
          {detail ? (
            <>
              <GroupLabel>Sobre a carta</GroupLabel>
              <Card style={{ gap: 16 }}>
                <CardAttributes items={cardAttributeItems(detail)} />
                <CardMoves detail={detail} />
              </Card>
            </>
          ) : null}

          {autoSave ? (
            <View style={styles.actions}>
              <Button
                title="Trocar por outra carta"
                variant="secondary"
                icon="repeat"
                onPress={() =>
                  customBinder
                    ? router.push({ pathname: '/search', params: { binder: customBinder.id, slot } })
                    : isExtra
                      ? router.push({ pathname: '/search', params: { extra: slot } })
                      : router.push({ pathname: '/pokemon/[dex]', params: { dex, slot } })
                }
              />
              <Button title="Remover do fichário" variant="danger" icon="trash-outline" onPress={confirmRemove} />
            </View>
          ) : null}
        </View>
        </View>
      </ScrollView>

      {/* Carta nova: a ação principal fica sempre à mão */}
      {isNewCard || !existing ? (
        <BottomBar bottomInset={insets.bottom}>
          <Button
            title={saving ? 'Colocando…' : 'Colocar no fichário'}
            icon="add-circle-outline"
            onPress={addToBinder}
            busy={saving}
            disabled={!detail}
          />
        </BottomBar>
      ) : null}
    </View>
  );
}

function Badge({ text, icon, tone }: { text: string; icon?: 'location-outline'; tone?: 'red' }) {
  return (
    <View style={[styles.badge, tone === 'red' && styles.badgeRed]}>
      {icon ? <Ionicons name={icon} size={12} color={colors.textMuted} /> : null}
      <Text style={[styles.badgeText, tone === 'red' && { color: colors.primary }]}>{text}</Text>
    </View>
  );
}

/** "37,90", "1.234,56" ou "37.90" → número (undefined se vazio ou inválido). */
function parseBRL(text: string) {
  const t = text.trim();
  if (!t) return undefined;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

/** 37.9 → "37,90" (para o campo "Meu valor"). */
function formatInput(n: number) {
  return n.toFixed(2).replace('.', ',');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  band: { position: 'absolute', top: 0, left: 0, right: 0, height: 150, backgroundColor: colors.primary },
  hero: {
    alignSelf: 'center',
    marginTop: 16,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  zoomHint: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: 6 },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(10,12,18,0.94)', alignItems: 'center', justifyContent: 'center', gap: 14 },
  zoomBox: { borderRadius: radius.md, overflow: 'hidden' },
  zoomClose: { color: '#C9CDD6', fontSize: 13 },
  content: { padding: 20, paddingTop: 18, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  wideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 32, maxWidth: 1180, width: '100%', alignSelf: 'center', paddingHorizontal: 24 },
  heroWide: { alignSelf: 'flex-start', marginTop: 28 },
  contentWide: { flex: 1, maxWidth: undefined, paddingHorizontal: 0, paddingTop: 140 },
  setLine: { color: colors.blue, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '900', marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  badgeRed: { backgroundColor: colors.primarySoft, borderColor: 'transparent' },
  badgeText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  copies: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 12 },
  copiesText: { color: colors.blue, fontSize: 13, flex: 1, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 13, marginTop: 10, lineHeight: 18 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  moreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  moreChipText: { color: colors.textMuted, fontWeight: '700' },
  moveRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -8 },
  savedText: { color: colors.success, fontSize: 12, fontWeight: '600' },
  actions: { gap: 10, marginTop: 24 },
});
