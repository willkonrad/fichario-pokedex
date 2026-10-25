import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
  type TextInputInstance,
  type ViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardAttributes, cardAttributeItems, CardMoves } from '@/components/card-facts';
import { CardImage } from '@/components/card-image';
import { CardMovePanel } from '@/components/card-move';
import type { PressState } from '@/components/icon-button';
import { ownershipOf } from '@/components/owned-badge';
import { PricePanel } from '@/components/price-panel';
import {
  Badge,
  BOTTOM_BAR_SPACE,
  BottomBar,
  Button,
  Card,
  CardSkeleton,
  Chip,
  ChipGroup,
  EmptyState,
  GroupLabel,
  IconButton,
  InfoButton,
  InfoParagraph,
  InfoSheet,
  Input,
  Loading,
  Notice,
  Section,
  Segmented,
  showToast,
  TextSkeleton,
  Toggle,
  useLayout,
  useToast,
} from '@/components/ui';
import { VersionPicker } from '@/components/version-picker';
import { getSpecies, speciesInCardName } from '@/data/pokedex';
import { indexOfDex, indexOfExtra, isPlaced, isPlacedCustom, physicalLabel, physicalPosition, volumesNeeded } from '@/lib/binder';
import { MY_VALUE_HINT, MY_VALUE_RULE, myValueReplacedText, purchaseText as paidVsNowText } from '@/lib/copy';
import { formatBRL, formatDay, formatInput, parseBRL, type ParsedBRL } from '@/lib/format';
import { ligaQuery, ligaSearchUrl } from '@/lib/liga';
import { entryPlace, placeText, versionText } from '@/lib/lists';
import { mypApiDue, mypPtImage, prioritizeMypPrice } from '@/lib/myp-api';
import { useStampImage } from '@/lib/stamp-image';
import { cardDetail, cardImage as tcgdexPhotoUrl, type CardDetail } from '@/lib/tcgdex';
import {
  CONDITIONS,
  LANG_LABEL,
  LANG_SHORT,
  ORIGINS,
  POKEDEX_BINDER,
  VARIANTS,
  type CardLang,
  type Condition,
  type Entry,
  type Origin,
  type ValueBasis,
  type Variant,
} from '@/lib/types';
import { valuation } from '@/lib/valuation';
import { availableVariants, cardVersions, versionOptions, type VersionOption } from '@/lib/variants';
import {
  keyOf,
  useBinders,
  useCollectionActions,
  useCollectionReady,
  useEntries,
  useEntry,
  useSettings,
  useSyncStatus,
  type MoveTarget,
} from '@/store/collection';
import { binderColors, breakpoints, CARD_RATIO, colors, radius, semantic, space, typography, widths } from '@/theme';

/** `binder` = fichário livre (sem ele, é o fichário Pokédex e `dex` diz o Pokémon). */
type Params = {
  dex?: string;
  binder?: string;
  slot: string;
  cardId?: string;
  lang?: CardLang;
  dataLang?: CardLang;
  /** Versão com selo escolhida na lista (já marca a variação e o selo). */
  variant?: Variant;
  stamp?: string;
  /** Foto oficial da versão com selo escolhida na lista. */
  photo?: string;
  /** Imagem da TCGdex que a lista já tinha: vale para a carta nova quando a ficha não carrega (T5). */
  image?: string;
  /** Foto do catálogo (TCGplayer) da carta escolhida, quando ela não tem imagem na TCGdex (C3). */
  imageUrl?: string;
  /** Ficha básica da lista: com ela, a carta pode ser colocada mesmo se a ficha completa não carregar (T5). */
  name?: string;
  setName?: string;
  localId?: string;
  /** Estado escolhido na folha de adicionar (C3). */
  condition?: Condition;
  /** 'add': veio do "+ Carta"; depois de colocar, o aviso oferece "Adicionar outra". */
  mode?: string;
  /** 'colecao': aberta pela "Minha coleção" (U8); remover, mover e trocar voltam para ela em vez de ir ao fichário. */
  origem?: string;
};

/** Foto oficial escolhida para uma versão (vale só enquanto a variação e o selo forem os dela). */
type PhotoChoice = { variant?: Variant; note: string; url?: string };

/** Campos que o usuário edita nesta tela (o resto vem do catálogo ou do servidor). */
type Edits = {
  condition: Condition;
  variant: Variant;
  variantNote: string;
  notes: string;
  myValueText: string;
  origin: Origin | undefined;
  purchaseText: string;
  /** Qual preço entra na soma (ausente = média). */
  valueBasis: ValueBasis | undefined;
  photo: PhotoChoice;
};

/** Variações com a descrição (selo) digitável na tela. */
const NOTE_VARIANTS: Variant[] = ['other', 'staff', 'wPromo'];

const WEB = Platform.OS === 'web';
/** Título da tela para o leitor de tela (na web, <h1>). */
const HEADING_1 = { role: 'heading' as const, ...((WEB ? { 'aria-level': 1 } : {}) as object) };
const HEADING_2 = { role: 'heading' as const, ...((WEB ? { 'aria-level': 2 } : {}) as object) };

const variantName = (v: Variant) => VARIANTS.find((x) => x.id === v)?.label ?? v;

/** A carta tem dados próprios além da ficha (estado, observações, origem, valor pago)? */
const hasOwnData = (e: Entry) => e.condition !== 'NM' || !!e.notes || !!e.origin || e.purchasePrice != null;

/** Desfazer pelo aviso: o erro (ex.: fichário apagado nesse meio-tempo) vira outro aviso. */
function undoWith(run: () => Promise<void>) {
  run().catch((e) => showToast({ message: e instanceof Error ? e.message : 'Não consegui desfazer.', tone: 'error' }));
}

/**
 * Espera a ação e devolve a mensagem do erro (null = deu certo). Sem try/catch na tela: o React Compiler não otimiza um
 * componente com condicionais dentro de um try.
 */
function failureOf(run: Promise<void>): Promise<string | null> {
  return run.then(
    () => null,
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
}

export default function CardScreen() {
  const params = useLocalSearchParams<Params>();
  const ready = useCollectionReady();
  const existing = useEntry(keyOf(params.binder, Number(params.dex ?? 0), Number(params.slot ?? 0)));
  // A carta que está no bolso agora. Atualizada antes da limpeza do formulário que sai (efeito de layout), para o
  // salvamento ao desmontar não gravar o formulário antigo por cima da carta que entrou nem trazer de volta uma removida.
  const inPocket = useRef(existing);
  useLayoutEffect(() => {
    inPocket.current = existing;
  });
  // O formulário só monta depois de carregar a coleção, para o estado inicial vir da carta salva.
  if (!ready) return <Loading />;
  // T1: o formulário recomeça do zero quando a carta do bolso muda (troca feita por outra tela ou em outro aparelho):
  // o que estava na tela da carta que saiu nunca é gravado na que entrou.
  const formKey = params.cardId
    ? `escolha:${params.cardId}|${params.lang ?? ''}|${params.variant ?? ''}|${params.stamp ?? ''}`
    : `salva:${existing ? `${existing.cardId}|${existing.lang}` : ''}`;
  return <CardForm key={formKey} params={params} existing={existing} inPocket={inPocket} />;
}

function CardForm({ params, existing, inPocket }: { params: Params; existing?: Entry; inPocket: RefObject<Entry | undefined> }) {
  const slot = Number(params.slot ?? 0);
  const entries = useEntries();
  const settings = useSettings();
  const binders = useBinders();
  const sync = useSyncStatus();
  const { saveEntry, removeEntry, restoreEntry, moveEntryTo, setActiveBinder } = useCollectionActions();
  const toast = useToast();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  /**
   * U8: a carta veio da "Minha coleção": o menu manda `origem=colecao`, ou ela está embaixo na pilha (a troca feita a
   * partir dela passa pela escolha de carta, que não repassa o parâmetro). Ao sair, volta para ela em vez de fechá-la.
   */
  const fromCollection = () => params.origem === 'colecao' || !!navigation.getState()?.routes.some((r) => r.name === 'menu');

  const customBinder = params.binder ? binders.find((b) => b.id === params.binder) : undefined;
  const binderId = customBinder?.id;
  // Bolso extra do fichário Pokédex (sobra da última página): a carta fica com dex 0 e slot = nº do bolso extra.
  const isExtra = !customBinder && Number(params.dex ?? -1) === 0;
  const lang = (params.lang ?? existing?.lang ?? 'pt') as CardLang;
  const pickStamp = (params.stamp ?? '').trim();
  // Carta escolhida na lista (F1): é nova quando o bolso está vazio ou quando muda a carta, o idioma, a variação ou o
  // selo (a mesma carta em inglês, ou a versão com selo, substitui a salva). A mesma carta de novo só abre a ficha.
  const isPick = !!params.cardId;
  // Decidido ao abrir: mudar aqui a variação ou o selo da carta que já estava no bolso não a transforma em troca.
  const [pickIsSaved] = useState(
    () =>
      isPick &&
      !!existing &&
      existing.cardId === params.cardId &&
      existing.lang === lang &&
      (params.variant == null || params.variant === existing.variant) &&
      pickStamp === (existing.variantNote ?? '').trim(),
  );
  const isNewCard = isPick && !(pickIsSaved && !!existing && existing.cardId === params.cardId && existing.lang === lang);
  // A carta do bolso sai quando a escolhida for colocada.
  const replacing = isNewCard && !!existing;
  // Proteção do T1: esta tela só grava sozinha a carta com que abriu.
  const [openedWith] = useState(() => (existing ? `${existing.cardId}|${existing.lang}` : undefined));
  const sameCard = !existing || !openedWith || openedWith === `${existing.cardId}|${existing.lang}`;
  // Carta já no fichário: as alterações são salvas sozinhas.
  const autoSave = !!existing && !isNewCard && sameCard;
  // Dados salvos da MESMA carta (reserva enquanto a ficha carrega). Ao trocar de carta, a antiga não serve.
  const saved = autoSave ? existing : undefined;
  // Carta aberta sem o preço em dia: a busca do MYP (no celular) passa ela na frente da fila.
  useEffect(() => {
    if (saved && mypApiDue(saved, Date.now())) prioritizeMypPrice(saved.id);
  }, [saved]);
  const cardId = params.cardId ?? existing?.cardId;
  // Idioma do catálogo de onde vêm os dados (pode ser inglês para coleções que não existem em PT).
  const dataLang = (params.dataLang ?? (isNewCard ? undefined : existing?.dataLang) ?? lang) as CardLang;

  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [enDetail, setEnDetail] = useState<CardDetail | null>(null);
  const [loadError, setLoadError] = useState<'notFound' | 'offline' | null>(null);
  // "Tentar de novo" (T5): cada toque carrega a ficha outra vez.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!cardId) return;
    let live = true;
    cardDetail(cardId, dataLang)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setLoadError(null);
      })
      .catch((e) => {
        if (live) setLoadError(/404/.test(String(e?.message ?? e)) ? 'notFound' : 'offline');
      });
    return () => {
      live = false;
    };
  }, [cardId, dataLang, attempt]);

  // O catálogo em inglês descreve as impressões que existem (holo, reverse, Poké Ball, selos…) e dá o nome
  // em inglês, usado pela imagem reserva. PT e EN usam o mesmo id na TCGdex.
  useEffect(() => {
    if (!cardId || lang === 'ja') return;
    let live = true;
    cardDetail(cardId, 'en')
      .then((d) => {
        if (live) setEnDetail(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cardId, lang, attempt]);

  // Fichário livre ou bolso extra: o Pokémon vem da própria carta (0 para treinadores e energias).
  const dex =
    customBinder || isExtra
      ? (detail?.dexId?.[0] ??
        (detail ? speciesInCardName(detail.name)?.id : params.name ? speciesInCardName(params.name)?.id : undefined) ??
        (customBinder ? saved?.dex : undefined) ??
        0)
      : Number(params.dex);

  // Troca de carta (F1): estado, origem e observações da antiga podem continuar (já vêm marcados quando é a mesma carta
  // em outro idioma ou versão).
  const keepAtOpen = replacing && !!existing && existing.cardId === params.cardId && hasOwnData(existing);
  const [keepOld, setKeepOld] = useState(keepAtOpen);
  const kept = isNewCard ? (keepAtOpen ? existing : undefined) : existing;
  // Variação escolhida (null = ainda não escolheu: usa a primeira que existe para a carta).
  const [pickedVariant, setPickedVariant] = useState<Variant | null>(isNewCard ? (params.variant ?? null) : (existing?.variant ?? null));
  const [variantNote, setVariantNote] = useState(isNewCard ? (params.stamp ?? '') : (existing?.variantNote ?? ''));
  // Estado escolhido na folha de adicionar (C3); valor desconhecido no parâmetro vale NM.
  const pickCondition = isNewCard && CONDITIONS.some((c) => c.id === params.condition) ? params.condition : undefined;
  const [condition, setCondition] = useState<Condition>(kept?.condition ?? pickCondition ?? 'NM');
  const [notes, setNotes] = useState(kept?.notes ?? '');
  const [origin, setOrigin] = useState<Origin | undefined>(kept?.origin);
  const [purchaseText, setPurchaseText] = useState(kept?.purchasePrice != null ? formatInput(kept.purchasePrice) : '');
  // Valor pago digitado nesta tela: só então aparece "= R$ …" (como foi lido).
  const [purchaseTyped, setPurchaseTyped] = useState(false);
  // "Meu valor" digitado nesta tela (null = não mexeu); `seen` = a troca do "Meu valor" que a tela conhecia ao digitar.
  // Sem edição, o campo acompanha a carta salva. T4: a edição deixa de valer quando o valor salvo foi apagado em segundo
  // plano por uma troca que a tela não tinha visto (a média da fonte passou dele), para não trazê-lo de volta no próximo
  // salvamento automático.
  const [myValueEdit, setMyValueEdit] = useState<{ text: string; seen?: string } | null>(null);
  const replacedAt = existing?.myValueReplaced?.at;
  const editStale = !isNewCard && !!myValueEdit && existing?.myValue == null && !!replacedAt && replacedAt !== myValueEdit.seen;
  const myValueText =
    myValueEdit && !editStale ? myValueEdit.text : isNewCard || existing?.myValue == null ? '' : formatInput(existing.myValue.value);
  // Valor que entra na soma escolhido nesta tela (null = não mexeu): sem escolha aqui, acompanha a carta salva, que pode
  // mudar por outro aparelho ou pela busca de preço; assim o painel mostra o mesmo que o salvamento automático grava.
  const [basisEdit, setBasisEdit] = useState<{ v: ValueBasis | undefined } | null>(null);
  const valueBasis = basisEdit ? basisEdit.v : isNewCard ? undefined : existing?.valueBasis;
  const [photoChoice, setPhotoChoice] = useState<PhotoChoice>(() =>
    isNewCard
      ? { variant: params.variant, note: pickStamp, url: params.photo }
      : { variant: existing?.variant, note: (existing?.variantNote ?? '').trim(), url: existing?.stampPhoto },
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [showAllVariants, setShowAllVariants] = useState(false);
  // Carta nova: só estado e variação à vista; o resto em "Mais detalhes". Carta salva: origem e observações recolhidas
  // quando vazias (U7). Depois de abertas, ficam abertas: apagar as observações não esconde o campo no meio da digitação.
  const [moreOpen, setMoreOpen] = useState(() => !!kept?.origin || !!kept?.notes);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [myValueInfo, setMyValueInfo] = useState(false);
  // Seletor de versões: aberto pelo botão "Ver versões"; para carta nova, abre sozinho até a pessoa escolher ou fechar.
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsDismissed, setVersionsDismissed] = useState(false);
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string | undefined>();
  // Versões da TCGdex mais as do catálogo (C9), as mesmas que a lista de escolha mostra.
  const [catalogVersions, setCatalogVersions] = useState<VersionOption[] | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const contentRef = useRef<ViewInstance>(null);
  const myValueBox = useRef<ViewInstance>(null);
  const myValueInput = useRef<TextInputInstance>(null);

  useEffect(() => {
    // As versões saem do catálogo em inglês (impressões da TCGdex sem tradução) e do catálogo do TCGCSV.
    if (!cardId || lang === 'ja' || !enDetail) return;
    let live = true;
    cardVersions(cardId, null, enDetail)
      .then((list) => {
        if (live) setCatalogVersions(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cardId, lang, enDetail]);

  // Carta já salva sem imagem: grava a imagem reserva assim que for encontrada, para aparecer no fichário.
  useEffect(() => {
    if (!resolvedImageUrl || !autoSave || !existing || existing.image || existing.imageUrl) return;
    const { id: _id, updatedAt: _u, ...rest } = existing;
    saveEntry({ ...rest, imageUrl: resolvedImageUrl }).catch(() => {});
  }, [resolvedImageUrl, autoSave, existing, saveEntry]);

  const avail = availableVariants(detail, enDetail);
  const variant: Variant = pickedVariant ?? avail.ids[0] ?? 'normal';
  const versions = catalogVersions ?? versionOptions(detail, enDetail);
  // As versões vêm do catálogo em inglês (carta japonesa: só do próprio).
  const versionsReady = lang === 'ja' ? !!detail : !!catalogVersions;
  const showVersions = versionsOpen || (isNewCard && versionsReady && versions.length > 1 && pickedVariant == null && !versionsDismissed);

  /** Selos da versão escolhida (para desenhar o selo oficial sobre a arte). */
  function stampKeysOf(v: Variant, note: string): string[] | undefined {
    if (v !== 'wPromo' && v !== 'staff') return undefined;
    // Ficha ainda carregando: mantém os selos já salvos.
    if (!versions.length) return saved?.variant === v ? saved.stampKeys : undefined;
    const stamped = versions.filter((o) => o.variant === v && o.stampKeys?.length);
    return (stamped.find((o) => o.stamp === note.trim()) ?? (stamped.length === 1 ? stamped[0] : undefined))?.stampKeys;
  }
  // A foto é da versão E do selo escolhidos: trocar um dos dois descarta a foto.
  const photoFits = (v: Variant, note: string, c: PhotoChoice = photoChoice) => !!c.url && v === c.variant && note.trim() === c.note;
  const photo = photoFits(variant, variantNote) ? photoChoice.url : undefined;
  // Foto oficial da versão com selo procurada pelos selos (vem da TCGplayer, em inglês): usada pela etiqueta do idioma da
  // foto. Com a foto já conhecida, a busca não é feita.
  const stampPhoto = useStampImage(photo || lang === 'ja' ? undefined : cardId, stampKeysOf(variant, variantNote));

  // T2: texto inválido mostra o erro e não apaga o que está salvo (vale o valor salvo até o texto ser corrigido).
  const myValueParsed = parseBRL(myValueText);
  const purchaseParsed = parseBRL(purchaseText);
  const myValueNum = myValueParsed.error ? saved?.myValue?.value : myValueParsed.value;
  const purchaseNum = purchaseParsed.error ? saved?.purchasePrice : purchaseParsed.value;
  const invalid = !!myValueParsed.error || (origin === 'purchase' && !!purchaseParsed.error);
  // Valor atual da carta (com o "Meu valor" e o valor escolhido na tela), para comparar com o valor de compra.
  const current = saved ? valuation({ ...saved, valueBasis, myValue: myValueNum != null ? { value: myValueNum, setAt: '' } : undefined }) : undefined;
  const currentValue = current?.value;
  // Imagem da TCGdex: ficha em português sem imagem usa a do catálogo em inglês (mesmo id, mesma arte); carta nova sem a
  // ficha (sem internet, T5), a que a lista já tinha.
  const tcgdexImage = detail?.image ?? enDetail?.image ?? saved?.image ?? (isNewCard ? params.image : undefined);

  /** A carta completa, com as edições atuais (e `patch` por cima, para mudanças feitas agora). */
  function buildEntry(patch: Partial<Edits> = {}): Omit<Entry, 'id' | 'updatedAt'> {
    const e: Edits = { condition, variant, variantNote, notes, myValueText, origin, purchaseText, valueBasis, photo: photoChoice, ...patch };
    const mv = parseBRL(e.myValueText);
    const pp = parseBRL(e.purchaseText);
    const value = mv.error ? saved?.myValue?.value : mv.value;
    const paid = pp.error ? saved?.purchasePrice : pp.value;
    const image = tcgdexImage;
    return {
      // Carta já salva: mantém o que não se edita nesta tela (preços das fontes, troca do "Meu valor", busca da Liga).
      ...(saved
        ? {
            mypApi: saved.mypApi,
            tcgplayer: saved.tcgplayer,
            myValueReplaced: value == null ? saved.myValueReplaced : undefined,
            ligaQuery: saved.ligaQuery,
          }
        : {}),
      binderId,
      dex: isExtra ? 0 : dex,
      slot,
      cardId: cardId!,
      lang,
      dataLang: dataLang !== lang ? dataLang : undefined,
      cardName: detail?.name ?? saved?.cardName ?? params.name ?? getSpecies(dex)?.name ?? '',
      setName: detail?.set.name ?? saved?.setName ?? params.setName ?? '',
      setId: detail?.set.id ?? saved?.setId ?? '',
      localId: detail?.localId ?? saved?.localId ?? params.localId ?? '',
      setTotal: (detail?.set.cardCount?.official || detail?.set.cardCount?.total) ?? saved?.setTotal,
      rarity: detail?.rarity ?? saved?.rarity,
      image,
      // Sem imagem da TCGdex: a foto do catálogo da lista (C3), a reserva achada agora ou a já salva.
      imageUrl: image ? undefined : (detail?.imageUrl ?? (isNewCard ? params.imageUrl : undefined) ?? resolvedImageUrl ?? saved?.imageUrl),
      stampPhoto: photoFits(e.variant, e.variantNote, e.photo) ? e.photo.url : undefined,
      variant: e.variant,
      variantNote: e.variantNote.trim() || undefined,
      stampKeys: stampKeysOf(e.variant, e.variantNote),
      condition: e.condition,
      notes: e.notes.trim() || undefined,
      origin: e.origin,
      purchasePrice: e.origin === 'purchase' ? paid : undefined,
      valueBasis: e.valueBasis === 'avg' ? undefined : e.valueBasis,
      // Mantém a data de quando o valor foi digitado, se ele não mudou.
      myValue: value == null ? undefined : { value, setAt: saved?.myValue?.value === value ? saved.myValue.setAt : new Date().toISOString() },
    };
  }

  /** Salvamento automático (carta já no fichário). */
  async function autoPersist(patch: Partial<Edits> = {}) {
    if (!autoSave || !cardId) return;
    // O bolso já tem outra carta (troca por outra tela ou outro aparelho) ou ficou vazio: nada é gravado (T1).
    const now = inPocket.current;
    if (!now || now.cardId !== cardId || now.lang !== lang) return;
    await saveEntry(buildEntry(patch));
    setSavedAt(new Date().toISOString());
  }

  // Textos: salva 700 ms depois da última tecla e, se sair da tela antes disso, ao sair. Só o que foi digitado aqui entra
  // na chave: uma mudança que chega de fora (outra tela trocou a versão da carta, outro aparelho, a busca de preço) não
  // dispara uma gravação com o formulário antigo (T1).
  const textKey = `${variantNote}|${notes}|${myValueEdit?.text ?? ''}|${purchaseText}`;
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
    return (
      <EmptyState
        title="Bolso vazio"
        text="A carta não está mais neste bolso."
        action={<Button title="Voltar ao fichário" variant="secondary" onPress={() => router.dismissTo('/')} />}
      />
    );
  }

  // Posição física; fora da configuração atual (F2), a carta continua salva, mas não aparece no fichário.
  const placed = customBinder ? isPlacedCustom(customBinder, { slot }) : isPlaced(settings, { dex: isExtra ? 0 : dex, slot });
  const pos = customBinder
    ? physicalPosition(customBinder, slot)
    : physicalPosition(settings, isExtra ? indexOfExtra(settings, slot) : indexOfDex(settings, dex, slot));
  // F8: com a Pokédex em mais de um fichário físico, "Fichário 2 · folha 5 (frente) · bolso 8"; senão, "Pág. 3 · folha 2
  // (frente) · bolso 4".
  const volumes = customBinder ? 1 : volumesNeeded(settings);
  const posLabel = physicalLabel(pos, volumes);
  const binderLabel = customBinder?.name ?? (settings.name || 'Fichário Pokédex');
  const setName = detail?.set.name ?? saved?.setName ?? params.setName ?? '';
  const total = detail?.set.cardCount?.official || saved?.setTotal;
  const localId = detail?.localId ?? saved?.localId ?? params.localId ?? '';
  const number = `${localId}${total ? `/${String(total).padStart(3, '0')}` : ''}`;
  const name = detail?.name ?? saved?.cardName ?? params.name ?? '';
  const rarity = detail?.rarity ?? saved?.rarity;
  // Link da carta na Liga: a busca salva (versões antigas, com os casos especiais de numeração) ou
  // "Nome em inglês (número/total)"; carta japonesa usa o nome do Pokémon.
  const ligaName = lang === 'ja' ? (getSpecies(dex)?.name ?? name) : (enDetail?.name ?? name);
  const ligaUrl = name
    ? ligaSearchUrl(saved?.ligaQuery ?? ligaQuery(ligaName, localId || undefined, (detail?.set.cardCount?.official || detail?.set.cardCount?.total) ?? saved?.setTotal))
    : undefined;
  // Mesma carta (id + idioma) em outros bolsos ou fichários. "Já tem" só com a mesma versão (F3): outro selo, reverse ou
  // holo é outra versão. Com a variação ainda desconhecida (ficha carregando), só o selo conta.
  const copies = Object.values(entries).filter((e) => e.cardId === cardId && e.lang === lang && e.id !== existing?.id);
  const variantKnown = pickedVariant != null || !!detail || !!enDetail || !!loadError;
  // Selo da versão: o de promo/staff e o das versões do catálogo (Poke Ball Pattern, Cosmos Holo…); "Outra" é texto livre.
  const versionStamp = variant === 'other' ? '' : variantNote.trim();
  const sameVersion = (c: Entry) =>
    (!variantKnown || c.variant === variant) && !!ownershipOf([c], { stamp: versionStamp ? { label: versionStamp } : null })?.exact;
  const sameCopies = copies.filter(sameVersion);
  const otherCopies = copies.filter((c) => !sameVersion(c));
  // Onde está cada cópia ("Fichário Pokédex · pág. 2, bolso 5", ou "fora das páginas"); a de outra versão diz qual.
  const copyPlace = (c: Entry) => {
    const where = placeText(entryPlace(c, settings, binders));
    return sameVersion(c) ? where : `${where} (${versionText(c) || variantName(c.variant)})`;
  };
  const placesOf = (list: Entry[]) => `${list.slice(0, 3).map(copyPlace).join('; ')}${list.length > 3 ? ` e mais ${list.length - 3}` : ''}`;
  const copiesText = [
    sameCopies.length ? `${isNewCard ? 'Você já tem esta carta' : 'Você também tem esta carta'}: ${placesOf(sameCopies)}.` : '',
    otherCopies.length
      ? `${sameCopies.length ? 'Outras versões' : otherCopies.length === 1 ? 'Você tem outra versão desta carta' : 'Você tem outras versões desta carta'}: ${placesOf(otherCopies)}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const canPlace = !!detail || (!!loadError && !!params.name);
  const pendingUpload = (sync.state === 'offline' || sync.state === 'error') && sync.pending > 0;

  async function addToBinder() {
    if (invalid || !canPlace) return;
    setSaving(true);
    setSaveError(null);
    const old = replacing ? existing : undefined;
    const entry = buildEntry();
    const failed = await failureOf(saveEntry(entry));
    if (failed !== null) {
      setSaveError(`Não consegui salvar: ${failed}`);
      setSaving(false);
      return;
    }
    const newId = keyOf(binderId, entry.dex, entry.slot);
    const cardName = entry.cardName || 'Carta';
    // Fora da configuração atual (F2), o aviso não promete um bolso que o fichário não mostra.
    const placedMessage = placed ? `${cardName} no fichário · pág. ${pos.page}, bolso ${pos.pocket}` : `${cardName} entrou na coleção, fora do fichário`;
    if (old) {
      toast.show({
        message: `${cardName} entrou no lugar de ${old.cardName || 'outra carta'}`,
        actionLabel: 'Desfazer',
        onAction: () => undoWith(() => restoreEntry(old)),
        duration: 8000,
      });
    } else if (params.mode === 'add') {
      toast.show({
        message: placedMessage,
        actionLabel: 'Adicionar outra',
        onAction: () => router.push({ pathname: '/search', params: { mode: 'add' } }),
      });
    } else {
      toast.show({ message: placedMessage, actionLabel: 'Desfazer', onAction: () => undoWith(() => removeEntry(newId)) });
    }
    // Troca feita a partir da Minha coleção (U8): volta para ela, que continua aberta.
    router.dismissTo(fromCollection() ? '/menu' : '/');
  }

  /**
   * Sai depois de remover ou mover a carta: volta para a tela que a abriu (fichário, Minha coleção, busca), que continua
   * aberta (U8); vinda da escolha de carta, ou sem tela anterior (link direto na web), vai para a Minha coleção, se veio
   * dela, ou para o fichário.
   */
  function leave() {
    if (!isPick && router.canGoBack()) router.back();
    else router.dismissTo(fromCollection() ? '/menu' : '/');
  }

  /** Tira a carta do bolso (com "Desfazer" no aviso, que a recoloca com as edições desta tela). */
  async function removeCard() {
    if (!existing) return;
    setMenuOpen(false);
    const back: Entry = { ...buildEntry(), id: existing.id, updatedAt: existing.updatedAt };
    // Não salva textos pendentes de uma carta que acabou de ser removida.
    const pendingKey = savedTextKey.current;
    savedTextKey.current = textKey;
    const failed = await failureOf(removeEntry(existing.id));
    if (failed !== null) {
      savedTextKey.current = pendingKey;
      showToast({ message: failed || 'Não consegui remover a carta.', tone: 'error' });
      return;
    }
    toast.show({
      message: `${back.cardName || 'Carta'} saiu do fichário`,
      actionLabel: 'Desfazer',
      onAction: () => undoWith(() => restoreEntry(back)),
      duration: 8000,
    });
    leave();
  }

  /**
   * Move a carta do bolso (F4): a desta tela ou, na troca, a que vai sair. Lança o erro do store (em português), que o
   * painel mostra.
   */
  async function moveCard(target: MoveTarget, where: string) {
    if (!existing) return;
    const moving = existing;
    const isThisCard = !isNewCard;
    // Como as duas cartas estavam antes (a desta tela e a do bolso de destino, se houver): o "Desfazer" recoloca cada uma
    // com os dados dela. Mover de volta não serve: o bolso extra zera o dex da carta que passa por ele, e a regra do
    // Pokédex recusaria a troca de volta.
    let before: Entry = moving;
    // Edição de texto ainda não salva: grava antes, no lugar de agora, para ir junto.
    if (isThisCard && autoSave && savedTextKey.current !== textKey) {
      savedTextKey.current = textKey;
      const edited = buildEntry();
      await saveEntry(edited);
      before = { ...edited, id: moving.id, updatedAt: moving.updatedAt };
    }
    const movedId = keyOf(target.binderId, target.dex ?? moving.dex, target.slot);
    const occupant = entries[movedId];
    await moveEntryTo(moving.id, target);
    toast.show({
      message: `${moving.cardName || 'Carta'} foi para ${where}`,
      actionLabel: 'Desfazer',
      onAction: () =>
        undoWith(async () => {
          await restoreEntry(before);
          await (occupant ? restoreEntry(occupant) : removeEntry(movedId));
        }),
      duration: 8000,
    });
    setMoveOpen(false);
    if (isThisCard) leave();
    // Na troca, a antiga foi para outro bolso com os dados dela: a nova não fica com uma cópia (o valor pago contaria
    // duas vezes). Se veio outra carta para cá (bolso ocupado), a pessoa decide de novo se mantém os dados dela.
    else if (keepOld) applyKeepOld(false);
  }

  /** "Trocar por outra carta": abre a escolha para este mesmo bolso. */
  function replaceCard() {
    setMenuOpen(false);
    flush.current();
    if (customBinder) router.push({ pathname: '/search', params: { binder: customBinder.id, slot } });
    else if (isExtra) router.push({ pathname: '/search', params: { extra: slot } });
    else router.push({ pathname: '/pokemon/[dex]', params: { dex, slot } });
  }

  function openMove() {
    setMenuOpen(false);
    setMoveOpen(true);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  /** "Ver no fichário" (U7): abre o fichário desta carta, na página dela (os mesmos parâmetros da URL da home). */
  async function showInBinder() {
    const fichario = binderId ?? POKEDEX_BINDER;
    await setActiveBinder(fichario);
    router.dismissTo({ pathname: '/', params: { fichario, pagina: String(pos.page), bolso: String(pos.pocket) } });
  }

  /** "✎ Definir meu valor" (V8): leva ao campo e põe o cursor nele. */
  function focusMyValue() {
    setMoreOpen(true);
    requestAnimationFrame(() => {
      const box = myValueBox.current;
      const content = contentRef.current;
      if (box && content) {
        box.measureLayout(
          content,
          (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - space.lg), animated: true }),
          () => {},
        );
      }
      myValueInput.current?.focus();
    });
  }

  function applyKeepOld(on: boolean) {
    setKeepOld(on);
    const src = on ? existing : undefined;
    setCondition(src?.condition ?? pickCondition ?? 'NM');
    setNotes(src?.notes ?? '');
    setOrigin(src?.origin);
    setPurchaseText(src?.purchasePrice != null ? formatInput(src.purchasePrice) : '');
  }

  function pickVersion(o: VersionOption) {
    // Selo de promo (ou versão do catálogo): já preenche a descrição da variação com o nome do selo.
    const note = o.stamp ?? (NOTE_VARIANTS.includes(o.variant) ? variantNote : '');
    // Foto oficial da versão (catálogo); a mesma versão escolhida de novo mantém a foto que já tinha.
    const pc: PhotoChoice = { variant: o.variant, note: note.trim(), url: o.photo ?? (photoFits(o.variant, note) ? photoChoice.url : undefined) };
    setPhotoChoice(pc);
    setPickedVariant(o.variant);
    setVariantNote(note);
    setVersionsOpen(false);
    setVersionsDismissed(true);
    autoPersist({ variant: o.variant, variantNote: note, photo: pc }).catch(() => {});
  }

  function pickVariantChip(v: Variant) {
    // Trocar de variação pelo chip é a versão comum: o selo de uma versão do catálogo (Cosmos Holo, Non-Holo…) sai, para
    // não ficar escondido escolhendo o produto; a descrição digitada fica nas variações que a mostram.
    const note = v === variant || NOTE_VARIANTS.includes(v) ? variantNote : '';
    setPickedVariant(v);
    setVariantNote(note);
    autoPersist({ variant: v, variantNote: note }).catch(() => {});
  }

  // Idioma da imagem mostrada: a da TCGdex diz no endereço (/pt/, /en/); as reservas (pokemontcg.io, Scrydex) são
  // da carta em inglês; o Zukan também diz no endereço.
  const shownImage = tcgdexImage ?? resolvedImageUrl ?? (isNewCard ? params.imageUrl : saved?.imageUrl);
  // Carta em português sem foto em português na TCGdex: a foto em português do MYP, quando ele tem.
  const ptImage = saved && !detail?.image?.includes('/pt/') ? mypPtImage(saved) : undefined;
  const imageLang: CardLang | undefined =
    photo || stampPhoto || detail?.imageUrl
      ? 'en'
      : ptImage
        ? 'pt'
        : !shownImage
          ? undefined
          : lang === 'ja'
            ? 'ja'
            : // Pelo endereço que a imagem usa de fato (a foto em português com selo vira a em inglês, ver cardImage).
              (((shownImage.includes('assets.tcgdex.net') ? tcgdexPhotoUrl(shownImage) : shownImage)?.match(/tcgdex\.net\/(pt|en|ja)\//)?.[1] ??
                shownImage.match(/zukan\.com\.br\/cards\/[^/]+\/(pt|en)\//)?.[1] ??
                'en') as CardLang);

  // `quality`: 'high' na carta grande; 'low' nas miniaturas do seletor de versões (sem baixar a foto de 1000 px de cada).
  const cardImage = (o: {
    fit: 'contain' | 'cover';
    stampKeys?: string[];
    photo?: string;
    ptImage?: string;
    dark?: boolean;
    priority?: 'high';
    quality?: 'low' | 'high';
  }) => (
    <CardImage
      image={tcgdexImage}
      imageUrl={detail?.imageUrl ?? (isNewCard ? params.imageUrl : saved?.imageUrl)}
      cardId={lang === 'ja' ? undefined : cardId}
      nameEn={enDetail?.name}
      setNameEn={enDetail?.set.name}
      localId={detail?.localId ?? saved?.localId}
      quality={o.quality ?? 'high'}
      contentFit={o.fit}
      dex={dex || undefined}
      stampKeys={o.stampKeys}
      photo={o.photo}
      ptImage={o.ptImage}
      dark={o.dark}
      priority={o.priority}
      onResolved={setResolvedImageUrl}
    />
  );

  // ---------- Layout: no celular, a carta ao lado do nome; no computador (≥ 960), a carta fixa à esquerda (W4) ----------
  const wide = layout.width >= breakpoints.desktop;
  const split = layout.width >= breakpoints.wide;
  const barSpace = isNewCard ? BOTTOM_BAR_SPACE + insets.bottom : 0;
  const heroWidth = wide
    ? Math.round(Math.max(240, Math.min(420, Math.max(320, layout.width * 0.3), (layout.height - 112 - barSpace) * CARD_RATIO)))
    : Math.round(Math.min(220, Math.max(120, (Math.min(layout.width, widths.reading) - layout.gutter * 2) * 0.38)));
  const side = Math.max(layout.gutter, (layout.width - widths.wide) / 2);
  // Carta ampliada: o maior tamanho que cabe na tela, mantendo a proporção.
  const zoomWidth = Math.min(layout.width - 40, (layout.height - 140) * CARD_RATIO, 520);
  const waitingImage = !detail && !saved && !loadError && !params.photo && !params.image && !params.imageUrl;

  const hero = (
    <Pressable
      style={[styles.hero, { width: heroWidth, height: heroWidth / CARD_RATIO }]}
      onPress={() => setZoom(true)}
      role="button"
      accessibilityLabel="Ampliar a imagem da carta">
      {waitingImage ? (
        <CardSkeleton width={heroWidth} tone="dark" />
      ) : (
        cardImage({ fit: 'contain', stampKeys: stampKeysOf(variant, variantNote), photo, ptImage, dark: true, priority: 'high' })
      )}
      {imageLang && imageLang !== lang ? (
        <View
          style={styles.photoLang}
          accessible
          accessibilityLabel={`Foto da versão em ${LANG_LABEL[imageLang].toLowerCase()}: não há foto desta carta em ${LANG_LABEL[lang].toLowerCase()}`}>
          <Text style={styles.photoLangText}>Foto {LANG_SHORT[imageLang]}</Text>
        </View>
      ) : null}
      <View style={styles.zoomHint} aria-hidden>
        <Ionicons name="expand-outline" size={14} color={semantic.inverse.fg} />
      </View>
    </Pressable>
  );

  const titleBlock = (
    <View style={styles.titleBlock}>
      {setName || number ? (
        <Text style={styles.setLine} numberOfLines={3}>
          {setName}
          {setName && number ? ' · ' : ''}
          {number}
        </Text>
      ) : null}
      {name ? (
        <Text style={styles.title} {...HEADING_1}>
          {name}
        </Text>
      ) : !loadError ? (
        <TextSkeleton lines={2} lineHeight={18} />
      ) : null}
      <View style={styles.badges}>
        <Badge label={LANG_SHORT[lang]} accessibilityLabel={`Idioma: ${LANG_LABEL[lang]}`} />
        {rarity && rarity !== 'None' ? <Badge label={rarity} /> : null}
        {!placed ? <Badge tone="warning" icon="alert-circle-outline" label="Fora do fichário" /> : null}
      </View>
      {!placed ? (
        <Text style={styles.goesTo}>
          {isNewCard
            ? 'Este bolso não existe na configuração atual do fichário: a carta fica salva e no valor, mas não aparece nele.'
            : 'Fora do fichário na configuração atual: a carta continua salva e entra no valor, mas não aparece nele.'}
        </Text>
      ) : null}
      {placed && autoSave ? (
        <Pressable
          onPress={showInBinder}
          role="button"
          accessibilityLabel={`Ver no fichário: ${binderLabel}, ${posLabel}${volumes > 1 ? `, página ${pos.page} no app` : ''}${isExtra ? ', bolso extra' : ''}`}
          style={(s) => {
            const { pressed, hovered } = s as PressState;
            return [styles.position, hovered && styles.positionHover, pressed && styles.pressed];
          }}>
          <Ionicons name="location-outline" size={16} color={colors.textMuted} />
          <View style={styles.flexShrink}>
            <Text style={styles.positionMain}>
              {posLabel}
              {isExtra ? ' (extra)' : ''}
            </Text>
            {/* Em mais de um fichário físico, a página do app ajuda a achar a carta na tela. */}
            <Text style={styles.positionSub}>{volumes > 1 ? `Pág. ${pos.page} no app · ver no fichário` : 'Ver no fichário'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      ) : placed && isNewCard ? (
        <Text style={styles.goesTo}>
          Vai para {binderLabel} · {posLabel}
          {isExtra ? ' (bolso extra)' : ''}
        </Text>
      ) : null}
    </View>
  );

  // Ações da carta salva à vista (também no ⋯ do topo): escondidas só no menu, ninguém as achava.
  const cardActions = autoSave ? (
    <View style={styles.actions}>
      <Chip mode="button" icon="repeat" label="Trocar" accessibilityLabel="Trocar por outra carta" onPress={replaceCard} />
      <Chip mode="button" icon="swap-horizontal" label="Mover" accessibilityLabel="Mover para outro bolso ou fichário" onPress={openMove} />
      <Chip mode="button" icon="trash-outline" label="Remover" accessibilityLabel="Remover do fichário" onPress={removeCard} />
    </View>
  ) : null;

  const loadErrorText =
    loadError === 'offline'
      ? `Sem conexão: não consegui carregar a ficha da carta. ${isNewCard ? 'Ela ainda não foi colocada.' : 'A carta continua salva.'}`
      : `A ficha desta carta não está no catálogo neste idioma. ${isNewCard ? (canPlace ? 'Dá para colocá-la com os dados da lista.' : 'Ela ainda não foi colocada.') : 'A carta continua salva.'}`;

  const notices = (
    <>
      {isPick && !isNewCard && !saving ? <Notice>Esta carta já está neste bolso.</Notice> : null}
      {replacing && existing && !saving ? (
        <View style={styles.stack}>
          <Notice tone="warning" icon="swap-horizontal">
            Vai substituir {existing.cardName || 'a carta deste bolso'}
            {existing.setName ? ` (${existing.setName}${existing.localId ? ` · ${existing.localId}` : ''})` : ''}.
          </Notice>
          {!moveOpen ? <Button title="Mover a antiga para…" variant="ghost" icon="arrow-redo-outline" onPress={() => setMoveOpen(true)} /> : null}
        </View>
      ) : null}
      {loadError ? (
        <View style={styles.stack}>
          <Notice tone={loadError === 'offline' ? 'warning' : 'info'}>{loadErrorText}</Notice>
          {loadError === 'offline' ? (
            <Button
              title="Tentar de novo"
              variant="secondary"
              icon="refresh"
              onPress={() => {
                setLoadError(null);
                setAttempt((a) => a + 1);
              }}
            />
          ) : null}
        </View>
      ) : null}
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
      {copiesText ? (
        <View style={styles.copies}>
          <Ionicons name={sameCopies.length ? 'copy-outline' : 'git-branch-outline'} size={14} color={colors.textMuted} />
          <Text style={styles.copiesText}>{copiesText}</Text>
        </View>
      ) : null}
    </>
  );

  const movePanel =
    moveOpen && existing ? (
      <CardMovePanel
        entry={existing}
        cardDex={isNewCard ? existing.dex : dex}
        settings={settings}
        binders={binders}
        entries={entries}
        onMove={moveCard}
        onCancel={() => setMoveOpen(false)}
      />
    ) : null;

  const pricePanel = (
    <PricePanel
      entry={isNewCard ? undefined : existing}
      myValue={myValueNum}
      basis={valueBasis ?? 'avg'}
      onBasis={
        autoSave
          ? (b) => {
              const next = b === 'avg' ? undefined : b;
              setBasisEdit({ v: next });
              autoPersist({ valueBasis: next }).catch(() => {});
            }
          : undefined
      }
      ligaUrl={ligaUrl}
      onSetMyValue={autoSave ? focusMyValue : undefined}
    />
  );

  // Variação (U4): quantas versões o catálogo tem e se a salva está entre elas.
  const known = [...new Set<Variant>([...versions.map((o) => o.variant), ...avail.ids])];
  const count = Math.max(versions.length, avail.ids.length);
  const countText = count === 1 ? 'Existe 1 versão no catálogo' : `Existem ${count} versões no catálogo`;
  const variantHint =
    !detail && !enDetail && !loadError
      ? 'Carregando as versões desta carta…'
      : !count
        ? 'Não sei quais versões existem: escolha a sua.'
        : known.includes(variant) || pickedVariant == null
          ? `${countText}.`
          : known.length === 1
            ? `No catálogo só há a versão ${variantName(known[0])}; a sua está marcada como ${variantName(variant)}.`
            : `${countText}; a sua (${variantName(variant)}) não está entre elas.`;
  const shownVariants = showAllVariants || !count ? VARIANTS : VARIANTS.filter((v) => known.includes(v.id) || v.id === variant);
  const showMore = moreOpen || !!origin || !!notes.trim() || (isNewCard && !!myValueText);
  const savedTime = savedAt ? new Date(savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
  const savedText = pendingUpload
    ? 'Salvo neste aparelho · envio pendente'
    : sync.state === 'local'
      ? `Salvo neste aparelho${savedTime ? ` às ${savedTime}` : ''}`
      : savedTime
        ? `Salvo às ${savedTime}`
        : 'Salvo automaticamente';
  const paidPct = purchaseNum && currentValue != null ? ((currentValue - purchaseNum) / purchaseNum) * 100 : null;

  const myValueSection = (
    <View ref={myValueBox} collapsable={false}>
      <Section
        title="Meu valor"
        right={<InfoButton label="Como funciona o Meu valor" onPress={() => setMyValueInfo(true)} />}
        hint={
          saved?.myValue && saved.myValue.value === myValueNum && saved.myValue.setAt
            ? `Digitado em ${formatDay(saved.myValue.setAt)} · vale até o mercado passar dele`
            : MY_VALUE_HINT
        }>
        {!myValueText && saved?.myValueReplaced ? <Notice tone="warning">{myValueReplacedText(saved.myValueReplaced, current)}</Notice> : null}
        <Input
          ref={myValueInput}
          value={myValueText}
          onChangeText={(t) => setMyValueEdit({ text: t.replace(/[^\d.,]/g, ''), seen: existing?.myValueReplaced?.at })}
          keyboardType="decimal-pad"
          placeholder="R$ 0,00"
          invalid={!!myValueParsed.error}
          accessibilityLabel="Meu valor em reais"
        />
        <FieldStatus parsed={myValueParsed} echo={!!myValueEdit} />
      </Section>
    </View>
  );

  const myCard = (
    <View>
      <GroupLabel>Minha carta</GroupLabel>
      <Card>
        {replacing && existing && hasOwnData(existing) ? (
          <View style={styles.keepOld}>
            <Toggle label="Manter estado, origem e observações" hint={`Da carta que sai (${existing.cardName || 'a antiga'})`} value={keepOld} onChange={applyKeepOld} />
          </View>
        ) : null}
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
          right={
            versions.length > 1 ? (
              <Chip mode="button" icon="images-outline" label="Ver versões" accessibilityLabel="Ver as versões desta carta" onPress={() => setVersionsOpen(true)} />
            ) : undefined
          }
          hint={variantHint}>
          <ChipGroup label="Variação">
            {shownVariants.map((v) => (
              <Chip key={v.id} label={v.label} selected={variant === v.id} hint={showAllVariants && known.includes(v.id)} onPress={() => pickVariantChip(v.id)} />
            ))}
            {!showAllVariants && count ? <Chip mode="button" icon="chevron-down" label="Mais variações" onPress={() => setShowAllVariants(true)} /> : null}
          </ChipGroup>
          {NOTE_VARIANTS.includes(variant) ? (
            <Input
              value={variantNote}
              onChangeText={setVariantNote}
              placeholder={avail.stamps.length ? `Qual selo? (${avail.stamps.join(', ')})` : 'Descreva (ex.: selo Pokémon Center, Staff)'}
              accessibilityLabel="Descrição da variação"
            />
          ) : null}
        </Section>
        {!isNewCard || showMore ? myValueSection : null}
        {showMore ? (
          <>
            <Section title="Origem" hint="Como a carta chegou (toque de novo para desmarcar).">
              <ChipGroup label="Origem">
                {ORIGINS.map((o) => (
                  <Chip
                    key={o.id}
                    label={o.label}
                    selected={origin === o.id}
                    onPress={() => {
                      const next = origin === o.id ? undefined : o.id;
                      setOrigin(next);
                      setMoreOpen(true);
                      autoPersist({ origin: next }).catch(() => {});
                    }}
                  />
                ))}
              </ChipGroup>
              {origin === 'purchase' ? (
                <>
                  <Input
                    value={purchaseText}
                    onChangeText={(t) => {
                      setPurchaseText(t.replace(/[^\d.,]/g, ''));
                      setPurchaseTyped(true);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="Valor pago (R$ 0,00)"
                    invalid={!!purchaseParsed.error}
                    accessibilityLabel="Valor pago em reais"
                  />
                  <FieldStatus parsed={purchaseParsed} echo={purchaseTyped} />
                  {purchaseNum != null && currentValue != null ? (
                    <Text style={[styles.paid, { color: currentValue >= purchaseNum ? semantic.gain.fg : semantic.loss.fg }]}>
                      {paidVsNowText({ paid: purchaseNum, current: currentValue, pct: paidPct })}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </Section>
            <Section title="Observações">
              <Input
                value={notes}
                onChangeText={(t) => {
                  setNotes(t);
                  setMoreOpen(true);
                }}
                placeholder="Ex.: comprada no evento, assinada…"
                multiline
                accessibilityLabel="Observações"
              />
            </Section>
          </>
        ) : (
          <View style={styles.moreRow}>
            <Chip mode="button" icon="add" label={isNewCard ? 'Mais detalhes (opcional)' : 'Origem e observações'} onPress={() => setMoreOpen(true)} />
          </View>
        )}
        {autoSave ? (
          <View style={styles.saved} aria-live="polite">
            <Ionicons
              name={pendingUpload ? 'cloud-offline-outline' : 'cloud-done-outline'}
              size={14}
              color={pendingUpload ? semantic.warning.fg : semantic.success.fg}
            />
            <Text style={[styles.savedText, { color: pendingUpload ? semantic.warning.fg : semantic.success.fg }]}>{savedText}</Text>
          </View>
        ) : null}
      </Card>
    </View>
  );

  const about = detail ? (
    <View>
      <Pressable
        onPress={() => setAboutOpen((o) => !o)}
        role="button"
        aria-expanded={aboutOpen}
        style={(s) => {
          const { pressed, hovered } = s as PressState;
          return [styles.aboutHead, hovered && styles.positionHover, pressed && styles.pressed];
        }}>
        <Text style={styles.aboutTitle} {...HEADING_2}>
          Sobre a carta
        </Text>
        <Ionicons name={aboutOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {aboutOpen ? (
        <Card style={styles.aboutCard}>
          <CardAttributes items={cardAttributeItems(detail)} />
          <CardMoves detail={detail} />
        </Card>
      ) : null}
    </View>
  ) : null;

  // Carta salva: o valor primeiro, depois o que se edita. Carta nova: o que se escolhe primeiro (o preço só chega depois).
  const first = isNewCard ? myCard : pricePanel;
  const second = isNewCard ? pricePanel : myCard;
  const bottomPad = (isNewCard ? barSpace : insets.bottom) + space.xxl;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: name || 'Carta',
          headerTitle: isNewCard ? (replacing ? 'Substituir carta' : 'Colocar carta') : binderLabel,
          headerRight: autoSave
            ? () => <IconButton icon="ellipsis-horizontal" label="Ações da carta" tone="onBrand" color={semantic.brand.fg} onPress={() => setMenuOpen(true)} />
            : undefined,
        }}
      />
      {wide ? (
        <View style={[styles.wideRow, { paddingLeft: side }]}>
          <View style={[styles.wideHero, { width: heroWidth }]}>{hero}</View>
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={[styles.wideContent, { paddingRight: side, paddingBottom: bottomPad }]}
            keyboardShouldPersistTaps="handled">
            <View ref={contentRef} collapsable={false} style={styles.column}>
              {titleBlock}
              {cardActions}
              {notices}
              {movePanel}
              {split ? (
                <View style={styles.cols}>
                  <View style={styles.col}>
                    {first}
                    {about}
                  </View>
                  <View style={styles.col}>{second}</View>
                </View>
              ) : (
                <>
                  {first}
                  {second}
                  {about}
                </>
              )}
            </View>
          </ScrollView>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.phoneContent, { paddingHorizontal: layout.gutter, paddingBottom: bottomPad }]}
          keyboardShouldPersistTaps="handled">
          <View ref={contentRef} collapsable={false} style={styles.column}>
            <View style={styles.heroRow}>
              {hero}
              <View style={styles.flex}>{titleBlock}</View>
            </View>
            {cardActions}
            {notices}
            {movePanel}
            {first}
            {second}
            {about}
          </View>
        </ScrollView>
      )}

      <VersionPicker
        visible={showVersions}
        options={versions}
        selected={pickedVariant ? { variant, stamp: variantNote.trim() || undefined } : undefined}
        image={(o) => cardImage({ fit: 'cover', stampKeys: o.stampKeys, photo: o.photo, quality: 'low' })}
        onPick={pickVersion}
        onClose={() => {
          setVersionsOpen(false);
          setVersionsDismissed(true);
        }}
      />
      <Modal visible={zoom} transparent animationType="fade" onRequestClose={() => setZoom(false)}>
        <Pressable style={styles.zoomBackdrop} onPress={() => setZoom(false)} role="button" accessibilityLabel="Fechar a imagem ampliada">
          <View style={[styles.zoomBox, { width: zoomWidth, height: zoomWidth / CARD_RATIO }]}>
            {cardImage({ fit: 'contain', stampKeys: stampKeysOf(variant, variantNote), photo, ptImage, dark: true })}
          </View>
          <Text style={styles.zoomClose}>Toque para fechar</Text>
        </Pressable>
      </Modal>
      <InfoSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={name || 'Carta'}>
        <View style={styles.menu}>
          <Button title="Trocar por outra carta" variant="secondary" icon="repeat" onPress={replaceCard} />
          <Button title="Mover para…" variant="secondary" icon="swap-horizontal" onPress={openMove} />
          <Button title="Remover do fichário" variant="danger" icon="trash-outline" onPress={removeCard} />
        </View>
      </InfoSheet>
      <InfoSheet visible={myValueInfo} onClose={() => setMyValueInfo(false)} title="Meu valor">
        <InfoParagraph>{MY_VALUE_RULE}</InfoParagraph>
        <InfoParagraph>Use o valor que você conferiu (por exemplo, o menor anúncio no seu estado). Apague o campo para voltar ao preço do mercado.</InfoParagraph>
      </InfoSheet>

      {/* Carta nova: a ação principal fica sempre à mão. */}
      {isNewCard ? (
        <BottomBar bottomInset={insets.bottom}>
          {invalid ? <Text style={styles.barError}>Corrija o valor digitado para continuar.</Text> : null}
          <Button
            title={
              saving
                ? 'Colocando…'
                : replacing
                  ? 'Substituir carta'
                  : placed
                    ? `Colocar na pág. ${pos.page} · bolso ${pos.pocket}`
                    : 'Colocar no fichário'
            }
            icon={replacing ? 'swap-horizontal' : 'add-circle-outline'}
            onPress={addToBinder}
            busy={saving}
            disabled={!canPlace || invalid}
          />
        </BottomBar>
      ) : null}
    </View>
  );
}

/** Erro do valor digitado (T2) ou, com `echo`, o valor como foi lido ("= R$ 1.500,00"). */
function FieldStatus({ parsed, echo }: { parsed: ParsedBRL; echo: boolean }): ReactNode {
  if (parsed.error) {
    return (
      <Text style={styles.fieldError} role="alert">
        {parsed.error}
      </Text>
    );
  }
  if (echo && parsed.value != null) return <Text style={styles.fieldEcho}>= {formatBRL(parsed.value)}</Text>;
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  column: { gap: space.lg },
  stack: { gap: space.xs },
  phoneContent: { paddingTop: space.lg, width: '100%', maxWidth: widths.reading, alignSelf: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  // A coluna da direita (ScrollView) estica até a altura da tela para rolar sozinha; só a imagem fica no topo (W4).
  wideRow: { flex: 1, flexDirection: 'row' },
  wideHero: { paddingTop: space.xl, alignSelf: 'flex-start' },
  wideContent: { paddingTop: space.xl, paddingLeft: space.xxl },
  cols: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xl },
  col: { flex: 1, minWidth: 0, gap: space.lg },
  hero: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: binderColors.pocket,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoLang: {
    position: 'absolute',
    left: space.sm,
    bottom: space.sm,
    backgroundColor: semantic.inverse.bg,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  photoLangText: { ...typography.caption, fontSize: 11, lineHeight: 14, fontWeight: '700', color: semantic.inverse.fg },
  zoomHint: { position: 'absolute', right: space.sm, bottom: space.sm, backgroundColor: semantic.inverse.bg, borderRadius: radius.pill, padding: 6 },
  zoomBackdrop: { flex: 1, backgroundColor: semantic.inverse.bg, alignItems: 'center', justifyContent: 'center', gap: space.md },
  zoomBox: { borderRadius: radius.md, overflow: 'hidden' },
  zoomClose: { ...typography.caption, color: semantic.inverse.fgMuted },
  titleBlock: { gap: space.sm },
  setLine: { ...typography.label, color: colors.textMuted },
  title: { ...typography.title, color: colors.text },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  position: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
  },
  positionHover: { backgroundColor: semantic.hover.onLight },
  pressed: { opacity: 0.7 },
  positionMain: { ...typography.caption, fontWeight: '700', color: colors.text },
  positionSub: { ...typography.caption, fontSize: 12, lineHeight: 16, color: colors.textMuted },
  goesTo: { ...typography.caption, color: colors.textMuted },
  copies: { flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' },
  copiesText: { ...typography.caption, color: colors.textMuted, flex: 1 },
  keepOld: { marginBottom: space.lg },
  moreRow: { flexDirection: 'row', marginBottom: space.lg },
  fieldError: { ...typography.caption, fontWeight: '600', color: semantic.danger.fg },
  fieldEcho: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
  paid: { ...typography.caption, ...typography.tabular, fontWeight: '700' },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  savedText: { ...typography.caption, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  aboutHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, borderRadius: radius.sm },
  aboutTitle: { ...typography.label, color: colors.textMuted },
  aboutCard: { gap: space.lg },
  menu: { gap: space.sm, paddingBottom: space.sm },
  barError: { ...typography.caption, fontWeight: '600', color: semantic.danger.fg, textAlign: 'center' },
});
