import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, useWindowDimensions, View } from 'react-native';

import { CardPickerList, type PickerState } from '@/components/add-card-list';
import { AddCardSheet } from '@/components/add-sheet';
import { gridContentWidth } from '@/components/card-grid';
import { Button, Chip, ChipGroup, EmptyState, Loading, Notice, SearchField } from '@/components/ui';
import { cardsByCode, parseCardCode, pickParams, rememberCardLang, searchStartLang } from '@/lib/add-card';
import { canSearchName, searchCardsResult, type CardBrief, type CardListResult } from '@/lib/tcgdex';
import { LANG_LABEL, LANG_SHORT, type CardLang } from '@/lib/types';
import { customEntryId, entryId, useActiveBinderId, useBinders, useCollectionReady, useEntry, useSettings } from '@/store/collection';
import { colors, space } from '@/theme';

import { isOcrAvailable } from '../../modules/card-ocr';

const LANGS: CardLang[] = ['pt', 'en', 'ja'];
type SearchBy = 'name' | 'code';

/**
 * Escolher uma carta (qualquer Pokémon, treinador ou energia):
 * - para um bolso de fichário livre (`binder` + `slot`) ou o bolso livre do Pokédex (`extra`): abre a tela da carta;
 * - "+ Carta" (`mode=add`, ou sem bolso): escolhe e coloca direto, no bolso sugerido, e segue para a próxima (H2).
 */
export default function SearchScreen() {
  const ready = useCollectionReady();
  if (!ready) return <Loading />;
  return <SearchForm />;
}

function SearchForm() {
  // `binder` + `slot`: bolso de fichário livre. `extra`: bolso livre do fichário Pokédex (última página).
  // `q`: busca já digitada (ex.: "Adicionar “pikachu”" da busca da tela inicial).
  const params = useLocalSearchParams<{ binder?: string; slot?: string; extra?: string; mode?: string; q?: string }>();
  const extra = params.extra != null ? Number(params.extra) : null;
  const slot = Number(params.slot ?? 0);
  const binders = useBinders();
  const settings = useSettings();
  const activeBinderId = useActiveBinderId();
  // O topo (busca e filtros) com a mesma largura da grade de cartas, alinhado com ela.
  const { width } = useWindowDimensions();
  const binder = params.binder ? binders.find((b) => b.id === params.binder) : undefined;
  // "+ Carta": sem bolso escolhido. Com `mode=add`, o `binder` (se houver) é só o fichário preferido para colocar.
  const adding = params.mode === 'add' || (!params.binder && extra == null);
  const preferred = adding ? (binder?.id ?? activeBinderId) : undefined;
  const preferredCustom = binders.find((b) => b.id === preferred);
  // Bolso de um fichário livre: o idioma dele vale primeiro. No "+ Carta" (e sem idioma no fichário), o último escolhido
  // nesta sessão (lote de cartas no mesmo idioma).
  const [lang, setLang] = useState<CardLang>(() =>
    searchStartLang({
      pocketLang: adding ? undefined : binder?.searchLang,
      preferredLang: adding ? preferredCustom?.searchLang : undefined,
      fallback: settings?.languages?.[0] ?? 'pt',
    }),
  );
  // Carta do bolso aberto (fora do "+ Carta"): a mesma carta japonesa salva com outro id abre como ela (ver pickParams).
  const pocket = useEntry(adding ? undefined : binder ? customEntryId(binder.id, slot) : extra != null ? entryId(0, extra) : undefined);
  const [by, setBy] = useState<SearchBy>('name');
  const [query, setQuery] = useState(params.q ?? '');
  const [debounced, setDebounced] = useState((params.q ?? '').trim());
  const [result, setResult] = useState<({ key: string } & (CardListResult | { error: string })) | null>(null);
  const [retry, setRetry] = useState({ base: '', n: 0 });
  const [picked, setPicked] = useState<CardBrief | null>(null);
  const [added, setAdded] = useState(0);
  // Campo montado de novo (com o foco) depois de colocar uma carta pelo código, para digitar a próxima.
  const [fieldKey, setFieldKey] = useState(0);
  // Enter antes de a busca responder: abre o "Adicionar" assim que ela trouxer uma carta só (busca por código).
  const openWhenReady = useRef<string | null>(null);

  // Busca 400 ms depois da última tecla, para não disparar uma requisição por letra.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const searchable = canSearch(by, lang, debounced);
  const code = by === 'code' ? parseCardCode(debounced) : null;
  const base = `${by}:${lang}:${debounced.toLowerCase()}`;
  const attempt = retry.base === base ? retry.n : 0;
  const key = `${base}:${attempt}`;

  useEffect(() => {
    if (!canSearch(by, lang, debounced)) return;
    const ctrl = new AbortController();
    const c = by === 'code' ? parseCardCode(debounced) : null;
    const searched = `${by}:${lang}:${debounced.toLowerCase()}`;
    const run = c ? cardsByCode(c, lang) : searchCardsResult(debounced, lang, { signal: ctrl.signal, force: attempt > 0 });
    run
      .then((r) => {
        if (ctrl.signal.aborted) return;
        setResult({ key, ...r });
        if (openWhenReady.current === searched) {
          openWhenReady.current = null;
          if (r.cards.length === 1) {
            Keyboard.dismiss();
            setPicked(r.cards[0]);
          }
        }
      })
      .catch((e) => {
        // Cancelada porque a pessoa continuou digitando: a busca nova responde.
        if (ctrl.signal.aborted || e?.name === 'AbortError') return;
        if (openWhenReady.current === searched) openWhenReady.current = null;
        setResult({ key, error: String(e?.message ?? e) });
      });
    return () => ctrl.abort();
  }, [by, lang, debounced, attempt, key]);

  if (!adding && params.binder && !binder) return <EmptyState title="Fichário não encontrado" text="Ele pode ter sido apagado em outro aparelho." />;

  const current = result?.key === key ? result : null;
  const state: PickerState | null = !searchable
    ? null
    : !current
      ? { status: 'loading' }
      : 'error' in current
        ? { status: 'error', message: current.error }
        : { status: 'done', ...current };
  // Código sem nenhuma fonte respondendo: é erro de rede, não "nenhuma carta".
  const offline = state?.status === 'done' && !!code && state.partial && !state.cards.length;

  function pick(card: CardBrief) {
    if (adding) return openSheet(card);
    const where = binder ? { binder: binder.id, slot } : { dex: 0, slot: extra! };
    router.push({ pathname: '/card', params: { ...where, ...pickParams(card, pocket) } });
  }

  /** Abre o "Adicionar". O teclado sai antes: no celular, ele cobriria o "Colocar" no rodapé da folha. */
  function openSheet(card: CardBrief) {
    Keyboard.dismiss();
    setPicked(card);
  }

  /** Nome não serve como código, nem o contrário: trocar de modo limpa o campo e o Enter que esperava a busca. */
  function changeBy(next: SearchBy) {
    if (next === by) return;
    setBy(next);
    setQuery('');
    setDebounced('');
    openWhenReady.current = null;
  }

  function placed() {
    setPicked(null);
    setAdded((n) => n + 1);
    // Por código, cada carta é uma busca: o campo fica vazio e com o foco, pronto para a próxima.
    if (by === 'code') {
      setQuery('');
      setDebounced('');
      setFieldKey((k) => k + 1);
    }
  }

  function submit() {
    const text = query.trim();
    const searched = `${by}:${lang}:${text.toLowerCase()}`;
    if (text !== debounced) {
      setDebounced(text);
      if (adding) openWhenReady.current = searched;
      return;
    }
    if (!adding) return;
    // Enter com uma carta só (ex.: busca por código): já abre o "Adicionar"; ainda buscando, abre quando chegar.
    if (state?.status === 'done') {
      if (state.cards.length === 1) openSheet(state.cards[0]);
    } else if (state?.status === 'loading') openWhenReady.current = searched;
  }

  const title = adding ? 'Adicionar carta' : binder ? `Bolso ${slot + 1} · ${binder.name}` : 'Bolso livre · carta especial';
  const placeholder =
    by === 'code'
      ? lang === 'ja'
        ? 'Ex.: M5 088 ou SV2a 025'
        : 'Ex.: MEG 133 ou swsh12-186'
      : lang === 'ja'
        ? 'Inglês ou japonês: ピカチュウ'
        : 'Nome da carta (ex.: Pikachu, Professor)';
  /** Dica do código: na japonesa, a sigla da coleção (como na TCGplayer) e o número. */
  const codeHint = lang === 'ja' ? 'Use a sigla e o número (ex.: M5 088).' : 'Confira a sigla e o número no canto da carta.';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />
      <View style={[styles.top, { width: gridContentWidth(width) }]}>
        <SearchField
          key={`${by}:${fieldKey}`}
          value={query}
          onChangeText={setQuery}
          onSubmit={submit}
          placeholder={placeholder}
          label={by === 'code' ? 'Código da carta' : 'Nome da carta'}
          autoFocus
        />
        <View style={styles.chips}>
          <ChipGroup label="Idioma" style={styles.group}>
            {LANGS.map((l) => (
              <Chip
                key={l}
                label={LANG_SHORT[l]}
                accessibilityLabel={LANG_LABEL[l]}
                selected={lang === l}
                onPress={() => {
                  rememberCardLang(l);
                  setLang(l);
                }}
              />
            ))}
          </ChipGroup>
          {/* Sem divisória: no celular os dois grupos quebram em duas linhas (ela ficaria sobrando no fim da primeira). */}
          <ChipGroup label="Buscar por" style={styles.group}>
            <Chip label="Nome" selected={by === 'name'} onPress={() => changeBy('name')} />
            <Chip label="Código" icon="barcode-outline" selected={by === 'code'} onPress={() => changeBy('code')} />
            {adding && isOcrAvailable ? <Chip label="Câmera" icon="camera-outline" mode="button" onPress={() => router.push('/scan' as Href)} /> : null}
          </ChipGroup>
        </View>
        {adding && added > 0 ? (
          <View style={styles.addedRow}>
            <View style={styles.addedNotice}>
              <Notice tone="success">
                {added} {added === 1 ? 'carta adicionada' : 'cartas adicionadas'}
              </Notice>
            </View>
            <Chip label="Concluir" icon="checkmark" mode="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          </View>
        ) : null}
      </View>

      {!state ? (
        by === 'code' && debounced ? (
          <EmptyState
            title="Não entendi o código"
            text={lang === 'ja' ? 'Sigla da coleção e número da carta: M5 088.' : 'Sigla da coleção e número, como no canto da carta: MEG 133.'}
          />
        ) : by === 'code' ? (
          <EmptyState
            title="Adicionar por código"
            text={
              lang === 'ja'
                ? 'Sigla da coleção e número do canto da carta (M5 088). As antigas, sem número, pelo nome.'
                : 'Sigla e número do canto da carta (MEG 133) ou o código da TCGdex (swsh12-186).'
            }
          />
        ) : (
          <EmptyState
            title={adding ? 'Qual carta você quer adicionar?' : 'Qual carta vai neste bolso?'}
            text={
              lang === 'ja'
                ? 'Pelo menos 3 letras do nome em inglês, ou o nome em japonês.'
                : 'Pelo menos 2 letras do nome: Pokémon, treinador ou energia.'
            }
          />
        )
      ) : offline ? (
        <EmptyState
          title="Não consegui buscar"
          text="Confira a internet e tente de novo."
          action={<Button title="Tentar de novo" variant="secondary" icon="refresh" onPress={() => setRetry({ base, n: attempt + 1 })} />}
        />
      ) : (
        <CardPickerList
          key={base}
          state={state}
          onPick={pick}
          onRetry={() => setRetry({ base, n: attempt + 1 })}
          empty={
            by === 'code'
              ? { title: 'Nenhuma carta com esse código', text: codeHint }
              : { title: 'Nenhuma carta encontrada', text: 'Tente outro idioma ou o nome em inglês.' }
          }
        />
      )}

      <AddCardSheet card={picked} preferredBinderId={preferred} onClose={() => setPicked(null)} onAdded={placed} onUndone={() => setAdded((n) => Math.max(0, n - 1))} />
    </View>
  );
}

/** Dá para buscar: um código reconhecido, ou o bastante do nome (ver canSearchName). */
function canSearch(by: SearchBy, lang: CardLang, text: string) {
  if (by === 'code') return !!parseCardCode(text);
  return canSearchName(text, lang);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { paddingTop: space.lg, gap: space.md, alignSelf: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.xl, rowGap: space.sm },
  group: { flexWrap: 'nowrap' },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  addedNotice: { flex: 1 },
});
