import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardAttributes, cardAttributeItems, CardMoves } from '@/components/card-facts';
import { CardImage } from '@/components/card-image';
import { LigaPrices } from '@/components/liga-prices';
import { PricePanel } from '@/components/price-panel';
import { Button, Chip, Input, Section } from '@/components/ui';
import { formatDex, getSpecies, speciesInCardName } from '@/data/pokedex';
import { customTotalSlots, indexOfDex, physicalPosition } from '@/lib/binder';
import { ligaCardUrl, ligaNumberOverride, ligaQuery, priceFromFinishes } from '@/lib/liga-api';
import { formatWhen } from '@/lib/quotes';
import { ligaNumbering } from '@/lib/ptcg';
import { cardDetail, setAbbreviation, type CardDetail } from '@/lib/tcgdex';
import { CONDITIONS, LANG_LABEL, VARIANTS, type CardLang, type Condition, type Price, type Variant } from '@/lib/types';
import { availableVariants } from '@/lib/variants';
import { keyOf, useCollection } from '@/store/collection';
import { CARD_RATIO, colors, radius } from '@/theme';

/** `binder` = fichário livre (sem ele, é o fichário Pokédex e `dex` diz o Pokémon). */
type Params = { dex?: string; binder?: string; slot: string; cardId?: string; lang?: CardLang; dataLang?: CardLang };

export default function CardScreen() {
  const params = useLocalSearchParams<Params>();
  const { ready } = useCollection();
  // O formulário só monta depois de carregar a coleção, para o estado inicial vir da carta salva.
  if (!ready) return <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />;
  return <CardForm params={params} />;
}

function CardForm({ params }: { params: Params }) {
  const slot = Number(params.slot ?? 0);
  const { entries, settings, binders, saveEntry, removeEntry, moveEntry } = useCollection();
  const customBinder = params.binder ? binders.find((b) => b.id === params.binder) : undefined;
  const binderId = customBinder?.id;
  const existing = entries[keyOf(binderId, Number(params.dex ?? 0), slot)];
  const isNewCard = !!params.cardId && params.cardId !== existing?.cardId;
  const cardId = params.cardId ?? existing?.cardId;
  const lang = (params.lang ?? existing?.lang ?? 'pt') as CardLang;
  // Idioma do catálogo de onde vêm os dados (pode ser inglês para coleções que não existem em PT).
  const dataLang = (params.dataLang ?? (isNewCard ? undefined : existing?.dataLang) ?? lang) as CardLang;
  const insets = useSafeAreaInsets();

  const [detail, setDetail] = useState<CardDetail | null>(null);
  // Fichário livre: o Pokémon vem da própria carta (0 para treinadores e energias).
  const dex = customBinder
    ? (detail?.dexId?.[0] ?? (detail ? speciesInCardName(detail.name)?.id : undefined) ?? existing?.dex ?? 0)
    : Number(params.dex);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Variação escolhida pelo usuário (null = ainda não escolheu: usa a primeira que existe para a carta).
  const [pickedVariant, setPickedVariant] = useState<Variant | null>(isNewCard ? null : (existing?.variant ?? null));
  const [variantNote, setVariantNote] = useState(isNewCard ? '' : (existing?.variantNote ?? ''));
  const [condition, setCondition] = useState<Condition>(isNewCard ? 'NM' : (existing?.condition ?? 'NM'));
  const [notes, setNotes] = useState(isNewCard ? '' : (existing?.notes ?? ''));
  // "Meu valor": valor que o usuário conferiu (ex.: menor anúncio NM na Liga); tem prioridade sobre as fontes.
  const [myValueText, setMyValueText] = useState(
    isNewCard || existing?.myValue == null ? '' : existing.myValue.value.toFixed(2).replace('.', ','),
  );
  const myValueNum = parseBRL(myValueText);
  const [saving, setSaving] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const [zoom, setZoom] = useState(false);
  const [showAllVariants, setShowAllVariants] = useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // Carta ampliada: o maior tamanho que cabe na tela, mantendo a proporção.
  const zoomWidth = Math.min(screenWidth - 40, (screenHeight - 120) * CARD_RATIO, 520);
  // Imagem grande no topo, como nas fichas de catálogo.
  const heroWidth = Math.min(screenWidth - 40, 320);

  useEffect(() => {
    if (!cardId) return;
    cardDetail(cardId, dataLang)
      .then(setDetail)
      .catch((e) => setLoadError(`Erro ao carregar detalhes: ${String(e?.message ?? e)}`));
  }, [cardId, dataLang]);

  // A Liga cadastra as cartas pelo nome em inglês; PT e EN compartilham o mesmo id na TCGdex.
  // O catálogo em inglês também descreve as impressões que existem (holo, reverse, Poké Ball, selos…).
  const [enDetail, setEnDetail] = useState<CardDetail | null>(null);
  useEffect(() => {
    if (!cardId || lang === 'ja') return;
    cardDetail(cardId, 'en')
      .then(setEnDetail)
      .catch(() => {});
  }, [cardId, lang]);
  const enName = enDetail?.name ?? null;
  const enSetName = enDetail?.set.name ?? null;

  // Coleções que a Liga numera diferente da TCGdex (ex.: Coleção Clássica de 30 Anos).
  const [ligaNum, setLigaNum] = useState<{ number: string; total: string } | null>(null);
  useEffect(() => {
    if (!cardId || lang === 'ja') return;
    ligaNumbering(cardId).then(setLigaNum).catch(() => {});
  }, [cardId, lang]);
  // Sigla da coleção (ex.: FCO), para o link direto da carta na Liga.
  const setIdForLink = detail?.set.id ?? existing?.setId;
  const [abbr, setAbbr] = useState<{ setId: string; code: string | null } | null>(null);
  useEffect(() => {
    if (!setIdForLink) return;
    setAbbreviation(setIdForLink)
      .then((code) => setAbbr({ setId: setIdForLink, code }))
      .catch(() => {});
  }, [setIdForLink]);
  // Imagem reserva (pokemontcg.io) quando a TCGdex não tem imagem desta carta.
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string | undefined>();
  // Carta já salva sem imagem: grava a imagem reserva assim que for encontrada, para aparecer no fichário.
  useEffect(() => {
    if (!resolvedImageUrl || isNewCard || !existing || existing.image || existing.imageUrl) return;
    const { id: _id, updatedAt: _u, ...rest } = existing;
    saveEntry({ ...rest, imageUrl: resolvedImageUrl }).catch(() => {});
  }, [resolvedImageUrl, isNewCard, existing, saveEntry]);

  const cardImageEl = (fit: 'contain' | 'cover') => (
    <CardImage
      image={detail?.image ?? existing?.image}
      imageUrl={isNewCard ? undefined : (existing?.imageUrl ?? existing?.ligaImage)}
      cardId={lang === 'ja' ? undefined : cardId}
      nameEn={enName ?? undefined}
      setNameEn={enSetName ?? undefined}
      localId={detail?.localId ?? existing?.localId}
      quality="high"
      contentFit={fit}
      dex={dex || undefined}
      onResolved={setResolvedImageUrl}
    />
  );

  if (!cardId || !settings || (params.binder && !customBinder)) {
    return <Text style={styles.muted}>Carta não encontrada.</Text>;
  }

  const species = getSpecies(dex);
  const image = detail?.image ?? existing?.image;
  const pos = customBinder ? physicalPosition(customBinder, slot) : physicalPosition(settings, indexOfDex(settings, dex, slot));

  // Variações que existem para a carta; a primeira já vem escolhida ao adicionar.
  const avail = availableVariants(detail, enDetail);
  const variant: Variant = pickedVariant ?? avail.ids[0] ?? 'normal';
  const mainVariants: Variant[] = [...new Set<Variant>([...avail.ids, variant])];

  const queryName = (lang === 'ja' ? species?.name : enName) ?? detail?.name ?? existing?.cardName ?? '';
  // Número como a Liga mostra (coleções especiais têm numeração própria).
  const setTotalNow = (detail?.set.cardCount?.official || detail?.set.cardCount?.total) ?? existing?.setTotal;
  const override = ligaNumberOverride(detail?.set.id ?? existing?.setId ?? '', detail?.localId ?? existing?.localId ?? '', setTotalNow);
  const autoQuery = ligaNum
    ? `${queryName} (${ligaNum.number.padStart(3, '0')}/${ligaNum.total})`
    : override
      ? `${queryName} (${override.number}/${override.total})`
      : ligaQuery(queryName, detail?.localId ?? existing?.localId, setTotalNow);
  const variantChanged = !isNewCard && !!existing && existing.variant !== variant;
  // Lido direto da carta salva: quando a cotação automática chega, a tela atualiza sozinha.
  const ligaFinishes = isNewCard ? undefined : existing?.ligaFinishes;
  const ligaPrice = isNewCard
    ? undefined
    : variantChanged
      ? priceFromFinishes(ligaFinishes, variant, existing?.price)
      : existing?.price;
  // Link da Liga: o salvo pela cotação; senão a página direta da carta (sigla + número); senão a busca.
  const localIdForLink = ligaNum
    ? ligaNum.number.padStart(3, '0')
    : (override?.number ?? detail?.localId ?? existing?.localId);
  const directLigaUrl =
    abbr && abbr.setId === setIdForLink && localIdForLink
      ? ligaCardUrl(autoQuery, abbr.setId, abbr.code ?? undefined, localIdForLink)
      : undefined;
  const ligaUrl =
    (!isNewCard && existing?.ligaUrl) ||
    directLigaUrl ||
    `https://www.ligapokemon.com.br/?view=cards/search&card=${encodeURIComponent(autoQuery || species?.name || '')}`;

  // Mesma carta (id + idioma) em outros bolsos ou fichários.
  const copies = Object.values(entries).filter((e) => e.cardId === cardId && e.lang === lang && e.id !== existing?.id);

  const setName = detail?.set.name ?? existing?.setName ?? '';
  const total = detail?.set.cardCount?.official || existing?.setTotal;
  const number = `${detail?.localId ?? existing?.localId ?? ''}${total ? `/${String(total).padStart(3, '0')}` : ''}`;

  async function save() {
    if (!cardId) return;
    setSaving(true);
    // Editando a mesma carta: mantém o que só o servidor grava (preços, imagem da Liga, verificação, recusa).
    const serverFields =
      existing && !isNewCard
        ? {
            ligaImage: existing.ligaImage,
            ligaCheckedAt: existing.ligaCheckedAt,
            ligaNotFound: existing.ligaNotFound,
            ligaMismatch: existing.ligaMismatch,
            sold: existing.sold,
            myp: existing.myp,
            intl: existing.intl,
            mypOffers: existing.mypOffers,
            ptcgId: existing.ptcgId,
          }
        : {};
    try {
      await saveEntry({
        ...serverFields,
        binderId,
        dex,
        slot,
        cardId,
        lang,
        dataLang: dataLang !== lang ? dataLang : undefined,
        cardName: detail?.name ?? existing?.cardName ?? species?.name ?? '',
        setName,
        setId: detail?.set.id ?? existing?.setId ?? '',
        localId: detail?.localId ?? existing?.localId ?? '',
        setTotal: (detail?.set.cardCount?.official || detail?.set.cardCount?.total) ?? existing?.setTotal,
        rarity: detail?.rarity ?? existing?.rarity,
        image,
        imageUrl: image ? undefined : (resolvedImageUrl ?? (isNewCard ? undefined : existing?.imageUrl)),
        variant,
        variantNote: variantNote.trim() || undefined,
        condition,
        notes: notes.trim() || undefined,
        // Mantém a data de quando o valor foi digitado, se ele não mudou.
        myValue:
          myValueNum == null
            ? undefined
            : {
                value: myValueNum,
                setAt: existing?.myValue?.value === myValueNum ? existing.myValue.setAt : new Date().toISOString(),
              },
        // Cotação da Liga é automática; se a variação mudou, ela é refeita para o acabamento novo.
        price: ligaPrice,
        ligaUrl: isNewCard ? undefined : existing?.ligaUrl,
        ligaFinishes,
        ligaQuery: autoQuery || undefined,
      });
      router.dismissTo('/');
    } catch (e) {
      setLoadError(`Não consegui salvar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const moveTarget = Number(moveTo) - 1;
  const canMove = !!customBinder && !!moveTo && moveTarget >= 0 && moveTarget < customTotalSlots(customBinder) && moveTarget !== slot;
  async function move() {
    if (!existing || !canMove) return;
    await moveEntry(existing.id, moveTarget);
    router.dismissTo('/');
  }

  function confirmRemove() {
    const run = async () => {
      if (existing) await removeEntry(existing.id);
      router.dismissTo('/');
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Tirar esta carta do fichário?')) run();
      return;
    }
    Alert.alert('Remover carta', 'Tirar esta carta do fichário?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: run },
    ]);
  }

  const saveLabel = saving ? 'Salvando…' : existing && !isNewCard ? 'Salvar alterações' : 'Colocar no fichário';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: detail?.name ?? existing?.cardName ?? 'Carta' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}>
        {/* Imagem grande, toque para ampliar */}
        <Pressable
          style={[styles.hero, { width: heroWidth, height: heroWidth / CARD_RATIO }]}
          onPress={() => setZoom(true)}
          accessibilityLabel="Ampliar imagem da carta">
          {!detail && !existing && !loadError ? <ActivityIndicator color={colors.accent} /> : cardImageEl('contain')}
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

        {/* Coleção · número, nome e etiquetas */}
        <Text style={styles.setLine} numberOfLines={2}>
          {setName.toUpperCase()}
          {number ? ` · ${number}` : ''}
        </Text>
        <Text style={styles.title}>{detail?.name ?? existing?.cardName}</Text>
        <View style={styles.badges}>
          <View style={[styles.badge, styles.badgeLang]}>
            <Text style={[styles.badgeText, { color: colors.accent }]}>{LANG_LABEL[lang]}</Text>
          </View>
          {detail?.rarity && detail.rarity !== 'None' ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{detail.rarity}</Text>
            </View>
          ) : null}
          <View style={styles.badge}>
            <Ionicons name="location-outline" size={12} color={colors.textMuted} />
            <Text style={styles.badgeText}>
              Pág. {pos.page}
              {pos.side ? ` · folha ${pos.sheet} (${pos.side})` : ''} · bolso {pos.pocket}
            </Text>
          </View>
        </View>
        {copies.length ? (
          <View style={styles.copies}>
            <Ionicons name="copy-outline" size={13} color={colors.textMuted} />
            <Text style={styles.copiesText}>
              Você já tem esta carta {copies.length > 1 ? `em ${copies.length} lugares` : 'em outro lugar'}:{' '}
              {copies
                .slice(0, 3)
                .map((c) => (c.binderId ? `${binders.find((b) => b.id === c.binderId)?.name ?? 'fichário'} (bolso ${c.slot + 1})` : `Pokédex ${formatDex(c.dex)}`))
                .join(', ')}
            </Text>
          </View>
        ) : null}
        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

        {/* Minha carta: estado e variação (só as variações que existem para a carta) */}
        <Text style={styles.groupTitle}>Minha carta</Text>
        <Section title="Estado" hint={CONDITIONS.find((c) => c.id === condition)?.desc}>
          <View style={styles.wrap}>
            {CONDITIONS.map((c) => (
              <Chip key={c.id} label={c.label} selected={condition === c.id} onPress={() => setCondition(c.id)} />
            ))}
          </View>
        </Section>
        <Section
          title="Variação"
          hint={
            !detail && !enDetail
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
                onPress={() => setPickedVariant(v.id)}
              />
            ))}
            {!showAllVariants && avail.ids.length ? (
              <Pressable style={styles.moreChip} onPress={() => setShowAllVariants(true)}>
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
            />
          ) : null}
        </Section>

        {/* Preço (como nas fichas de catálogo), histórico e últimas vendas */}
        <PricePanel
          entry={isNewCard ? undefined : existing}
          condition={condition}
          lang={lang}
          ligaPrice={ligaPrice}
          ligaUrl={ligaUrl}
          myValue={myValueNum}
        />
        <Section
          title="Meu valor"
          hint={
            existing?.myValue && existing.myValue.value === myValueNum
              ? `Digitado em ${formatWhen(existing.myValue.setAt)}. É o valor da carta no fichário, no total e nos gráficos; apague para voltar às fontes.`
              : 'Opcional: o valor que você conferiu (ex.: menor anúncio no seu estado na Liga). Tem prioridade sobre as fontes.'
          }>
          <Input
            value={myValueText}
            onChangeText={(t) => setMyValueText(t.replace(/[^\d.,]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="R$ 0,00"
            accessibilityLabel="Meu valor em reais"
          />
        </Section>

        {/* Ficha da carta */}
        {detail ? (
          <>
            <Text style={[styles.groupTitle, { marginTop: 24 }]}>Sobre a carta</Text>
            <CardAttributes items={cardAttributeItems(detail)} />
            <View style={{ height: 16 }} />
            <CardMoves detail={detail} />
          </>
        ) : null}

        {/* Faixa de anúncios da Liga por acabamento */}
        <View style={{ height: 24 }} />
        <Section
          title="Anúncios na LigaPokemon (R$)"
          hint={ligaHint(ligaPrice, !!existing, variantChanged && !ligaPrice, !!existing?.ligaNotFound, existing?.ligaMismatch, existing?.ligaCheckedAt)}>
          <LigaPrices finishes={ligaFinishes} price={ligaPrice} variant={variant} />
        </Section>

        {customBinder && existing && !isNewCard ? (
          <Section
            title="Bolso"
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
              <Button title="Mover" variant="secondary" onPress={move} disabled={!canMove} style={{ minWidth: 110 }} />
            </View>
          </Section>
        ) : null}

        <Section title="Observações">
          <Input value={notes} onChangeText={setNotes} placeholder="Ex.: comprada no evento, assinada…" multiline />
        </Section>

        {existing ? (
          <View style={{ gap: 10 }}>
            <Button
              title="Trocar por outra carta"
              variant="secondary"
              onPress={() =>
                customBinder
                  ? router.push({ pathname: '/search', params: { binder: customBinder.id, slot } })
                  : router.push({ pathname: '/pokemon/[dex]', params: { dex, slot } })
              }
            />
            <Button title="Remover do fichário" variant="danger" onPress={confirmRemove} />
          </View>
        ) : null}
      </ScrollView>

      {/* Ação principal sempre à mão */}
      <View style={[styles.bottomBar, { paddingBottom: 12 + insets.bottom }]}>
        <Button title={saveLabel} onPress={save} disabled={saving || (!detail && !existing)} style={styles.bottomButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, maxWidth: 720, width: '100%', alignSelf: 'center' },
  hero: {
    alignSelf: 'center',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  zoomHint: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: 6 },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', gap: 14 },
  zoomBox: { borderRadius: radius.md, overflow: 'hidden' },
  zoomClose: { color: colors.textMuted, fontSize: 13 },
  setLine: { color: '#6BB8FF', fontSize: 12, fontWeight: '700', letterSpacing: 1.6 },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', marginTop: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  badgeLang: { backgroundColor: colors.accentSoft },
  badgeText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  copies: { flexDirection: 'row', gap: 5, alignItems: 'flex-start', marginTop: 10 },
  copiesText: { color: colors.textMuted, fontSize: 12, flex: 1, lineHeight: 16 },
  error: { color: colors.danger, fontSize: 13, marginTop: 8 },
  groupTitle: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 24, marginBottom: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  moreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  moreChipText: { color: colors.textMuted, fontWeight: '600' },
  muted: { color: colors.textMuted, padding: 20 },
  moveRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(11,11,13,0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  bottomButton: { width: '100%', maxWidth: 680 },
});

function ligaHint(
  price: Price | undefined,
  saved: boolean,
  variantChanged: boolean,
  notFound = false,
  mismatch?: string,
  checkedAt?: string,
) {
  if (variantChanged) return 'A variação mudou: a cotação é refeita para o novo acabamento depois de salvar.';
  const checked = checkedAt ? ` Última verificação: ${formatWhen(checkedAt)}.` : '';
  if (!price?.updatedAt) {
    if (!saved) return 'Automática: a cotação começa assim que você colocar a carta no fichário.';
    if (mismatch) {
      return `A Liga devolveu outra carta (${mismatch}). Por segurança o preço não foi usado; ela é procurada de novo nas próximas cotações.${checked}`;
    }
    return notFound
      ? `A Liga não encontrou esta carta na última cotação. Ela é procurada de novo nas próximas cotações.${checked}`
      : 'Na fila da Liga: cartas sem valor têm prioridade e são cotadas na próxima janela (6h, 13h ou 20h).';
  }
  if (price.source === 'manual') return `Digitada em ${formatWhen(price.updatedAt)}.`;
  return `Atualizada em ${formatWhen(price.updatedAt)} · valores anunciados, todos os estados e idiomas.`;
}

/** "37,90", "1.234,56" ou "37.90" → número (undefined se vazio ou inválido). */
function parseBRL(text: string) {
  const t = text.trim();
  if (!t) return undefined;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}
