import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { useIosAnnouncement } from '@/components/add-card-list';
import { EntryRow } from '@/components/add-entry-row';
import { Button, EmptyState, Loading, SearchField } from '@/components/ui';
import { formatDex, searchSpecies } from '@/data/pokedex';
import { inDexRange } from '@/lib/binder';
import { formatInt } from '@/lib/format';
import { entryParams, entryPlace, findInCollection, placeText } from '@/lib/lists';
import { POKEDEX_BINDER, type Entry } from '@/lib/types';
import { useBinders, useCollectionReady, useEntries, useSettings } from '@/store/collection';
import { colors, MAX_WIDTH, space, typography } from '@/theme';

/** Busca na coleção inteira (E2): "eu tenho essa carta? onde está?", sem internet, em todos os fichários. */
export default function FindScreen() {
  const ready = useCollectionReady();
  if (!ready) return <Loading />;
  return <FindForm />;
}

function FindForm() {
  const entries = useEntries();
  const settings = useSettings();
  const binders = useBinders();
  // Vindo da busca da home ("Procurar em toda a coleção"), já começa com o texto digitado lá.
  const { q: initial } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(() => (typeof initial === 'string' ? initial : ''));

  const all = Object.values(entries);
  const pokedexName = settings?.name || 'Fichário Pokédex';
  const binderName = (e: Entry) =>
    e.binderId && e.binderId !== POKEDEX_BINDER ? (binders.find((b) => b.id === e.binderId)?.name ?? '') : pokedexName;
  const results = findInCollection(all, query, binderName);
  const q = query.trim();
  // Sem nenhuma carta: se a busca é um Pokémon da faixa do Pokédex, o atalho para escolher a carta dele.
  const found = q && !results.length ? searchSpecies(q) : undefined;
  const species = found && settings && inDexRange(settings, found.id) ? found : undefined;
  const status = !q ? '' : results.length ? `${formatInt(results.length)} ${results.length === 1 ? 'carta' : 'cartas'}` : 'Nenhuma carta na coleção';
  // O contador abaixo é uma região ao vivo (Android e web); no iOS, anunciado à parte (A7).
  useIosAnnouncement(status);
  const binderCount = binders.length + (settings ? 1 : 0);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Buscar na coleção' }} />
      <View style={styles.top}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Nome, coleção ou número" label="Buscar na coleção" autoFocus />
        <Text style={styles.status} role="status" aria-live="polite" accessibilityLiveRegion="polite">
          {status}
        </Text>
      </View>
      {!q ? (
        <EmptyState
          title="Onde está minha carta?"
          text={`${formatInt(all.length)} ${all.length === 1 ? 'carta' : 'cartas'} em ${binderCount} ${binderCount === 1 ? 'fichário' : 'fichários'}. Funciona sem internet.`}
        />
      ) : !results.length ? (
        <EmptyState
          title={`Nenhuma carta com “${q}”`}
          text={species ? `Você ainda não tem carta de ${species.name} em nenhum fichário.` : 'Tente o nome em inglês, a coleção ou o número.'}
          action={
            species ? (
              <Button
                title={`Escolher ${formatDex(species.id)} ${species.name}`}
                variant="secondary"
                icon="add"
                onPress={() => router.push({ pathname: '/pokemon/[dex]', params: { dex: species.id, slot: 0 } })}
              />
            ) : undefined
          }
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(e) => e.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          initialNumToRender={14}
          renderItem={({ item }) => (
            <EntryRow
              entry={item}
              place={placeText(entryPlace(item, settings, binders), true)}
              onPress={() => router.push({ pathname: '/card', params: entryParams(item) })}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, gap: space.sm, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  status: { ...typography.caption, ...typography.tabular, color: colors.textMuted, minHeight: 18 },
  list: { paddingHorizontal: space.md, paddingBottom: space.xxl, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
});
