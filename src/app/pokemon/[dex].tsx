import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { CardImage } from '@/components/card-image';
import { Button, Chip } from '@/components/ui';
import { formatDex, getSpecies } from '@/data/pokedex';
import { cardsForDex, type CardBrief } from '@/lib/tcgdex';
import { LANG_SHORT, type CardLang } from '@/lib/types';
import { OwnedBadge, useOwnedCards } from '@/components/owned-badge';
import { useCollection } from '@/store/collection';
import { CARD_RATIO, colors, mono, radius } from '@/theme';

const COLS = 3;
const GAP = 10;

export default function PokemonCardsScreen() {
  const { ready } = useCollection();
  // Espera a configuração: o idioma inicial vem dos idiomas escolhidos pelo usuário.
  if (!ready) return <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />;
  return <PokemonCards />;
}

function PokemonCards() {
  const params = useLocalSearchParams<{ dex: string; slot?: string }>();
  const dex = Number(params.dex);
  const slot = Number(params.slot ?? 0);
  const species = getSpecies(dex);
  const { settings } = useCollection();
  const languages = settings?.languages ?? ['pt', 'en', 'ja'];
  const [lang, setLang] = useState<CardLang>(languages[0]);
  const [attempt, setAttempt] = useState(0);
  const key = `${dex}:${lang}:${attempt}`;
  const [result, setResult] = useState<{ key: string; cards?: CardBrief[]; error?: string } | null>(null);
  const current = result?.key === key ? result : null;
  const cards = current?.cards ?? null;
  const error = current?.error ?? null;
  const [filter, setFilter] = useState('');
  const { width } = useWindowDimensions();
  const owned = useOwnedCards();
  const itemWidth = (Math.min(width, 720) - 32 - GAP * (COLS - 1)) / COLS;

  useEffect(() => {
    let alive = true;
    cardsForDex(dex, lang)
      .then((c) => alive && setResult({ key, cards: c }))
      .catch((e) => alive && setResult({ key, error: String(e?.message ?? e) }));
    return () => {
      alive = false;
    };
  }, [dex, lang, key]);

  const f = filter.trim().toLowerCase();
  const visible = cards?.filter((c) => !f || c.setName.toLowerCase().includes(f) || c.name.toLowerCase().includes(f) || c.localId.includes(f));

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${formatDex(dex)} ${species?.name ?? ''}` }} />
      <View style={styles.top}>
        <View style={styles.tabs}>
          {languages.map((l) => (
            <Chip key={l} label={LANG_SHORT[l]} selected={lang === l} onPress={() => setLang(l)} />
          ))}
          {settings && settings.slotsPerPokemon > 1 ? (
            <Text style={styles.slotInfo}>
              Espaço {slot + 1} de {settings.slotsPerPokemon}
            </Text>
          ) : null}
        </View>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filtrar por coleção, nome ou número"
          placeholderTextColor={colors.textFaint}
          style={styles.filter}
        />
        {cards ? <Text style={styles.count}>{visible?.length} cartas</Text> : null}
      </View>

      {error ? (
        <View style={styles.retry}>
          <Text style={styles.error}>Não consegui carregar as cartas ({error}). Confira a internet.</Text>
          <Button title="Tentar de novo" variant="secondary" onPress={() => setAttempt((n) => n + 1)} />
        </View>
      ) : !visible ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : visible.length === 0 ? (
        <Text style={styles.error}>Nenhuma carta encontrada nesse idioma.</Text>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(c) => c.id}
          numColumns={COLS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={{ width: itemWidth }}
              onPress={() =>
                router.push({ pathname: '/card', params: { dex, slot, cardId: item.id, lang: item.lang, dataLang: item.dataLang ?? item.lang } })
              }>
              <View style={[styles.thumb, { height: itemWidth / CARD_RATIO }]}>
                <CardImage
                  image={item.image}
                  cardId={item.lang === 'ja' ? undefined : item.id}
                  nameEn={item.lang === 'en' || item.dataLang === 'en' ? item.name : undefined}
                  setNameEn={item.setNameEn}
                  localId={item.localId}
                  dex={dex}
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
  top: { padding: 16, gap: 10, maxWidth: 720, width: '100%', alignSelf: 'center' },
  tabs: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  slotInfo: { color: colors.textMuted, marginLeft: 'auto', fontSize: 13 },
  filter: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  count: { color: colors.textMuted, fontFamily: mono, fontSize: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 14, maxWidth: 720, width: '100%', alignSelf: 'center' },
  thumb: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface, justifyContent: 'center' },
  cardName: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 6 },
  cardSet: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  error: { color: colors.textMuted, textAlign: 'center', padding: 24 },
  retry: { paddingHorizontal: 24, gap: 4, maxWidth: 480, width: '100%', alignSelf: 'center' },
});
