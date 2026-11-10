import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CardPickerList, type PickerState } from '@/components/add-card-list';
import { digitsInSystemFont } from '@/components/digits';
import { heading } from '@/components/layer-a11y';
import { Chip, ChipGroup, EmptyState, Loading } from '@/components/ui';
import { formatDex, getSpecies, spriteUrl } from '@/data/pokedex';
import { initialCardLang, pickParams, rememberCardLang } from '@/lib/add-card';
import { cardsForDexResult, type CardBrief } from '@/lib/tcgdex';
import { LANG_LABEL, LANG_SHORT, type CardLang } from '@/lib/types';
import { entryId, useCollectionReady, useEntry, useSettings } from '@/store/collection';
import { colors, space, typography } from '@/theme';

const SPRITE = 64;

export default function PokemonCardsScreen() {
  const ready = useCollectionReady();
  // Espera a configuração: o idioma inicial vem dos idiomas escolhidos pelo usuário.
  if (!ready) return <Loading />;
  return <PokemonCards />;
}

/** Escolher a carta de um espaço do fichário Pokédex: todas as cartas do Pokémon, por coleção. */
function PokemonCards() {
  const params = useLocalSearchParams<{ dex: string; slot?: string }>();
  const dex = Number(params.dex);
  const slot = Number(params.slot ?? 0);
  const species = getSpecies(dex);
  const settings = useSettings();
  // Carta do bolso aberto: a mesma carta japonesa salva com outro id abre como ela (ver pickParams).
  const pocket = useEntry(entryId(dex, slot));
  const languages: CardLang[] = settings?.languages?.length ? settings.languages : ['pt', 'en', 'ja'];
  // O último idioma escolhido nesta sessão (num lote de japonesas, não volta a PT a cada Pokémon).
  const [lang, setLang] = useState<CardLang>(() => initialCardLang(languages[0], languages));
  const [attempt, setAttempt] = useState(0);
  const key = `${dex}:${lang}:${attempt}`;
  const [result, setResult] = useState<({ key: string } & PickerState) | null>(null);

  useEffect(() => {
    // Endereço com um número que não é de Pokémon: a tela avisa, sem buscar nada.
    if (!getSpecies(dex)) return;
    let alive = true;
    cardsForDexResult(dex, lang, {
      // "Buscar de novo": sem a lista guardada.
      force: attempt > 0,
      // Primeira abertura: a lista base aparece antes das versões com selo (D4).
      onProgress: (cards, pending) => {
        if (alive) setResult({ key, status: 'loading', cards, pending });
      },
    })
      .then((r) => {
        if (alive) setResult({ key, status: 'done', cards: r.cards, partial: r.partial });
      })
      .catch((e) => {
        if (!alive) return;
        // Falhou depois da lista base: ela fica na tela, avisando que pode estar incompleta.
        setResult((prev) =>
          prev?.key === key && prev.status === 'loading' && prev.cards
            ? { key, status: 'done', cards: prev.cards, partial: true }
            : { key, status: 'error', message: String(e?.message ?? e) },
        );
      });
    return () => {
      alive = false;
    };
  }, [dex, lang, attempt, key]);

  if (!species) return <EmptyState title="Pokémon não encontrado" text="Volte ao fichário e escolha um espaço." />;

  const state: PickerState = result?.key === key ? result : { status: 'loading' };

  function pick(card: CardBrief) {
    router.push({ pathname: '/card', params: { dex, slot, ...pickParams(card, pocket) } });
  }

  const top = (
    <View style={styles.top}>
      <View style={styles.speciesRow}>
        {/* Arte decorativa: o nome vem logo ao lado (na web, sairia como imagem sem nome). */}
        <View style={styles.sprite} aria-hidden>
          <Image source={spriteUrl(dex)} style={styles.spriteImage} contentFit="contain" cachePolicy="memory-disk" />
        </View>
        <View style={styles.speciesText}>
          <Text style={styles.speciesName} {...heading(1)}>
            {digitsInSystemFont(species.name)}
          </Text>
          {/* O número vem embaixo do nome: em cima, seria um rótulo sobre o título. */}
          <Text style={styles.speciesJa}>
            {formatDex(dex)} · {species.ja}
            {settings && settings.slotsPerPokemon > 1 ? ` · espaço ${slot + 1} de ${settings.slotsPerPokemon}` : ''}
          </Text>
        </View>
      </View>
      {languages.length > 1 ? (
        <ChipGroup label="Idioma">
          {languages.map((l) => (
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
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `Escolher ${species.name}` }} />
      <CardPickerList
        state={state}
        top={top}
        dex={dex}
        speciesName={species.name}
        onPick={pick}
        onRetry={() => setAttempt((n) => n + 1)}
        empty={{ title: 'Nenhuma carta neste idioma', text: languages.length > 1 ? 'Tente outro idioma acima.' : undefined }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { gap: space.md },
  speciesRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  sprite: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  spriteImage: { width: SPRITE, height: SPRITE },
  speciesText: { flex: 1, minWidth: 0 },
  speciesName: { ...typography.title, color: colors.text },
  speciesJa: { ...typography.caption, ...typography.tabular, color: colors.textMuted },
});
