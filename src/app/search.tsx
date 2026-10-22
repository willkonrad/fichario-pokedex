import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CardGrid } from '@/components/card-grid';
import { Button, Chip, EmptyState, Loading, SearchField } from '@/components/ui';
import { searchCards, type CardBrief } from '@/lib/tcgdex';
import { LANG_SHORT, type CardLang } from '@/lib/types';
import { useCollection } from '@/store/collection';
import { colors, MAX_WIDTH } from '@/theme';

const LANGS: CardLang[] = ['pt', 'en', 'ja'];

/** Escolhe uma carta (qualquer Pokémon, treinador ou energia) para um bolso de fichário livre. */
export default function SearchScreen() {
  const { ready } = useCollection();
  if (!ready) return <Loading />;
  return <SearchForm />;
}

function SearchForm() {
  // `binder` + `slot`: bolso de fichário livre. `extra`: bolso livre do fichário Pokédex (última página).
  const params = useLocalSearchParams<{ binder?: string; slot?: string; extra?: string }>();
  const extra = params.extra != null ? Number(params.extra) : null;
  const slot = Number(params.slot ?? 0);
  const { binders, settings } = useCollection();
  const binder = binders.find((b) => b.id === params.binder);
  const [lang, setLang] = useState<CardLang>(binder?.searchLang ?? settings?.languages?.[0] ?? 'pt');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [result, setResult] = useState<{ key: string; cards?: CardBrief[]; error?: string } | null>(null);
  const [filter, setFilter] = useState('');

  // Busca 400 ms depois da última tecla, para não disparar uma requisição por letra.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const [attempt, setAttempt] = useState(0);
  const key = `${lang}:${debounced.toLowerCase()}:${attempt}`;
  useEffect(() => {
    if (debounced.length < 2) return;
    let alive = true;
    searchCards(debounced, lang)
      .then((cards) => alive && setResult({ key, cards }))
      .catch((e) => alive && setResult({ key, error: String(e?.message ?? e) }));
    return () => {
      alive = false;
    };
  }, [debounced, lang, key]);

  const current = result?.key === key ? result : null;
  const f = filter.trim().toLowerCase();
  const visible = current?.cards?.filter((c) => !f || c.setName.toLowerCase().includes(f) || c.localId.toLowerCase().includes(f));
  const loading = debounced.length >= 2 && !current;

  if (!binder && extra == null) return <EmptyState title="Fichário não encontrado" text="Ele pode ter sido apagado em outro aparelho." />;

  function pick(card: CardBrief) {
    const where = binder ? { binder: binder.id, slot } : { dex: 0, slot: extra! };
    router.push({
      pathname: '/card',
      params: {
        ...where,
        cardId: card.id,
        lang: card.lang,
        dataLang: card.dataLang ?? card.lang,
        variant: card.stamp?.variant,
        stamp: card.stamp?.label,
        photo: card.stamp ? card.imageUrl : undefined,
      },
    });
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: binder ? `Bolso ${slot + 1} · ${binder.name}` : 'Bolso livre · carta especial' }} />
      <View style={styles.top}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={lang === 'ja' ? 'Nome em japonês (ex.: ピカチュウ)' : 'Nome da carta (ex.: Pikachu, Professor)'}
          label="Nome da carta"
          autoFocus
        />
        <View style={styles.tabs}>
          {LANGS.map((l) => (
            <Chip key={l} label={LANG_SHORT[l]} selected={lang === l} onPress={() => setLang(l)} />
          ))}
          {current?.cards?.length ? (
            <SearchField value={filter} onChangeText={setFilter} placeholder="Filtrar coleção ou nº" label="Filtrar resultados" icon="filter" style={styles.filter} />
          ) : null}
        </View>
        {visible ? (
          <Text style={styles.count}>
            {visible.length} {visible.length === 1 ? 'carta' : 'cartas'}
            {current?.cards?.length === 300 ? ' (as 300 mais recentes — refine a busca)' : ''}
          </Text>
        ) : null}
      </View>

      {debounced.length < 2 ? (
        <EmptyState title="Qual carta vai neste bolso?" text="Digite pelo menos 2 letras do nome: Pokémon, treinador ou energia." />
      ) : loading ? (
        <Loading label="Buscando…" />
      ) : current?.error ? (
        <EmptyState
          title="Não consegui buscar"
          text={`Confira a internet e tente de novo. (${current.error})`}
          action={<Button title="Tentar de novo" variant="secondary" icon="refresh" onPress={() => setAttempt((n) => n + 1)} />}
        />
      ) : !visible?.length ? (
        <EmptyState title="Nenhuma carta encontrada" text="Tente outro idioma ou o nome em inglês." />
      ) : (
        <CardGrid cards={visible} onPick={pick} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { padding: 16, paddingBottom: 10, gap: 10, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  tabs: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  filter: { flex: 1, shadowOpacity: 0, elevation: 0, borderColor: colors.border },
  count: { color: colors.textMuted, fontSize: 12 },
});
