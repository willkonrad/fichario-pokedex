import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CardGrid } from '@/components/card-grid';
import { Button, Chip, EmptyState, Loading, SearchField } from '@/components/ui';
import { formatDex, getSpecies, spriteUrl } from '@/data/pokedex';
import { cardsForDex, type CardBrief } from '@/lib/tcgdex';
import { LANG_SHORT, type CardLang } from '@/lib/types';
import { useCollection } from '@/store/collection';
import { colors, MAX_WIDTH, mono, shadow } from '@/theme';

export default function PokemonCardsScreen() {
  const { ready } = useCollection();
  // Espera a configuração: o idioma inicial vem dos idiomas escolhidos pelo usuário.
  if (!ready) return <Loading />;
  return <PokemonCards />;
}

function PokemonCards() {
  const params = useLocalSearchParams<{ dex: string; slot?: string }>();
  const dex = Number(params.dex);
  const slot = Number(params.slot ?? 0);
  const species = getSpecies(dex);
  const { settings } = useCollection();
  const languages: CardLang[] = settings?.languages?.length ? settings.languages : ['pt', 'en', 'ja'];
  const [lang, setLang] = useState<CardLang>(languages[0]);
  const [attempt, setAttempt] = useState(0);
  const key = `${dex}:${lang}:${attempt}`;
  const [result, setResult] = useState<{ key: string; cards?: CardBrief[]; error?: string } | null>(null);
  const current = result?.key === key ? result : null;
  const cards = current?.cards ?? null;
  const error = current?.error ?? null;
  const [filter, setFilter] = useState('');

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
  const visible = cards?.filter((c) => !f || c.setName.toLowerCase().includes(f) || c.name.toLowerCase().includes(f) || c.localId.toLowerCase().includes(f));

  function pick(card: CardBrief) {
    router.push({
      pathname: '/card',
      params: { dex, slot, cardId: card.id, lang: card.lang, dataLang: card.dataLang ?? card.lang, variant: card.stamp?.variant, stamp: card.stamp?.label },
    });
  }

  const header = (
    <View style={styles.top}>
      <View style={styles.speciesRow}>
        <View style={styles.sprite}>
          <Image source={spriteUrl(dex)} style={{ width: 64, height: 64 }} contentFit="contain" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.dex}>{formatDex(dex)}</Text>
          <Text style={styles.speciesName}>{species?.name}</Text>
          <Text style={styles.speciesJa}>
            {species?.ja}
            {settings && settings.slotsPerPokemon > 1 ? ` · espaço ${slot + 1} de ${settings.slotsPerPokemon}` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.tabs}>
        {languages.map((l) => (
          <Chip key={l} label={LANG_SHORT[l]} selected={lang === l} onPress={() => setLang(l)} />
        ))}
        {cards ? (
          <Text style={styles.count}>
            {visible?.length} {visible?.length === 1 ? 'carta' : 'cartas'}
          </Text>
        ) : null}
      </View>
      <SearchField value={filter} onChangeText={setFilter} placeholder="Filtrar por coleção, nome ou número" label="Filtrar cartas" icon="filter" />
    </View>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `Escolher ${species?.name ?? 'carta'}` }} />
      {header}
      {error ? (
        <EmptyState
          title="Não consegui carregar as cartas"
          text={`Confira a internet e tente de novo. (${error})`}
          action={<Button title="Tentar de novo" variant="secondary" icon="refresh" onPress={() => setAttempt((n) => n + 1)} />}
        />
      ) : !visible ? (
        <Loading label="Buscando as cartas…" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={f ? 'Nenhuma carta com esse filtro' : 'Nenhuma carta neste idioma'}
          text={f ? 'Tente outro nome de coleção ou número.' : 'Tente outro idioma acima.'}
        />
      ) : (
        <CardGrid cards={visible} dex={dex} onPick={pick} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { paddingTop: 16, paddingBottom: 14, paddingHorizontal: 16, gap: 12, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  speciesRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sprite: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow },
  dex: { color: colors.primary, fontFamily: mono, fontSize: 13, fontWeight: '800' },
  speciesName: { color: colors.text, fontSize: 24, fontWeight: '900' },
  speciesJa: { color: colors.textMuted, fontSize: 13 },
  tabs: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  count: { color: colors.textMuted, fontSize: 13, marginLeft: 'auto' },
});
