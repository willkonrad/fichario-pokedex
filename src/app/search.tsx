import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { CardImage } from '@/components/card-image';
import { Button, Chip } from '@/components/ui';
import { searchCards, type CardBrief } from '@/lib/tcgdex';
import { LANG_SHORT, type CardLang } from '@/lib/types';
import { OwnedBadge, useOwnedCards } from '@/components/owned-badge';
import { useCollection } from '@/store/collection';
import { CARD_RATIO, colors, radius } from '@/theme';

const COLS = 3;
const GAP = 10;
const LANGS: CardLang[] = ['pt', 'en', 'ja'];

/** Escolhe uma carta (qualquer Pokémon, treinador ou energia) para um bolso de fichário livre. */
export default function SearchScreen() {
  const { ready } = useCollection();
  if (!ready) return <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />;
  return <SearchForm />;
}

function SearchForm() {
  const params = useLocalSearchParams<{ binder: string; slot: string }>();
  const slot = Number(params.slot ?? 0);
  const { binders } = useCollection();
  const binder = binders.find((b) => b.id === params.binder);
  const [lang, setLang] = useState<CardLang>(binder?.searchLang ?? 'pt');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [result, setResult] = useState<{ key: string; cards?: CardBrief[]; error?: string } | null>(null);
  const [filter, setFilter] = useState('');
  const { width } = useWindowDimensions();
  const owned = useOwnedCards();
  const itemWidth = (Math.min(width, 720) - 32 - GAP * (COLS - 1)) / COLS;

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

  if (!binder) return <Text style={styles.info}>Fichário não encontrado.</Text>;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `Bolso ${slot + 1} · ${binder.name}` }} />
      <View style={styles.top}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={lang === 'ja' ? 'Nome em japonês (ex.: ピカチュウ)' : 'Nome da carta (ex.: Pikachu, Professor)'}
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
        <View style={styles.tabs}>
          {LANGS.map((l) => (
            <Chip key={l} label={LANG_SHORT[l]} selected={lang === l} onPress={() => setLang(l)} />
          ))}
          {current?.cards?.length ? (
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Filtrar coleção ou nº"
              placeholderTextColor={colors.textFaint}
              style={styles.filter}
            />
          ) : null}
        </View>
        {visible ? (
          <Text style={styles.count}>
            {visible.length} cartas{current?.cards?.length === 300 ? ' (as 300 mais recentes — refine a busca)' : ''}
          </Text>
        ) : null}
      </View>

      {debounced.length < 2 ? (
        <Text style={styles.info}>Digite pelo menos 2 letras do nome da carta.</Text>
      ) : loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : current?.error ? (
        <View style={styles.retry}>
          <Text style={styles.info}>Não consegui buscar ({current.error}). Confira a internet.</Text>
          <Button title="Tentar de novo" variant="secondary" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : !visible?.length ? (
        <Text style={styles.info}>Nenhuma carta encontrada nesse idioma. Tente outro idioma ou o nome em inglês.</Text>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(c) => c.id}
          numColumns={COLS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              style={{ width: itemWidth }}
              onPress={() =>
                router.push({
                  pathname: '/card',
                  params: { binder: binder.id, slot, cardId: item.id, lang: item.lang, dataLang: item.dataLang ?? item.lang },
                })
              }>
              <View style={[styles.thumb, { height: itemWidth / CARD_RATIO }]}>
                <CardImage
                  image={item.image}
                  cardId={item.lang === 'ja' ? undefined : item.id}
                  nameEn={item.lang === 'en' || item.dataLang === 'en' ? item.name : undefined}
                  setNameEn={item.setNameEn}
                  localId={item.localId}
                />
                {owned.has(`${item.id}|${item.lang}`) ? <OwnedBadge /> : null}
              </View>
              <Text style={styles.cardName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.cardSet} numberOfLines={1}>
                {item.setName} · {item.localId}
                {item.dataLang ? ' · dados em inglês' : ''}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { padding: 16, paddingBottom: 8, gap: 10, maxWidth: 720, width: '100%', alignSelf: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 13, marginLeft: 10 },
  tabs: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  filter: {
    flex: 1,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  count: { color: colors.textMuted, fontSize: 12 },
  list: { padding: 16, paddingTop: 4, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  thumb: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface },
  cardName: { color: colors.text, fontSize: 12, fontWeight: '600', marginTop: 6 },
  cardSet: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  info: { color: colors.textMuted, padding: 24, textAlign: 'center', lineHeight: 20 },
  retry: { paddingHorizontal: 24, gap: 4, maxWidth: 480, width: '100%', alignSelf: 'center' },
});
