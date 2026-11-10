import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, Chip, ChipGroup, Input, Notice, Section } from '@/components/ui';
import { getSpecies } from '@/data/pokedex';
import { customPlaceText, customTotalSlots, extraSlots, indexOfDex, indexOfExtra, inDexRange, physicalLabel, physicalPosition, volumesNeeded } from '@/lib/binder';
import { POKEDEX_BINDER, type BinderSettings, type CustomBinder, type Entry } from '@/lib/types';
import { customEntryId, entryId, type MoveTarget } from '@/store/collection';
import { colors, space, typography } from '@/theme';

/** Um lugar do fichário Pokédex: o espaço do Pokémon ou um bolso livre (dex 0). */
type DexSpot = { key: string; dex: number; slot: number; label: string };

/** Lugares do fichário Pokédex para a carta (fora o atual): os espaços do Pokémon dela e os bolsos livres. */
function dexSpots(settings: BinderSettings, cardDex: number, here: (dex: number, slot: number) => boolean): DexSpot[] {
  const species = cardDex > 0 ? getSpecies(cardDex) : undefined;
  const spots: DexSpot[] = [];
  if (species && inDexRange(settings, cardDex)) {
    for (let s = 0; s < settings.slotsPerPokemon; s++) {
      if (here(cardDex, s)) continue;
      spots.push({ key: entryId(cardDex, s), dex: cardDex, slot: s, label: settings.slotsPerPokemon > 1 ? `${species.name} · espaço ${s + 1}` : species.name });
    }
  }
  for (let k = 0; k < extraSlots(settings); k++) {
    if (here(0, k)) continue;
    spots.push({ key: entryId(0, k), dex: 0, slot: k, label: `Bolso livre ${k + 1}` });
  }
  return spots;
}

/**
 * "Mover para…" (F4): escolhe o fichário e o bolso de destino de uma carta. No fichário Pokédex, a carta só vai para o
 * espaço do próprio Pokémon ou para um bolso livre; num fichário livre, para qualquer bolso (o primeiro vazio vem
 * sugerido). Bolso ocupado: as duas cartas trocam de lugar. Os erros do store (em português) aparecem aqui.
 */
export function CardMovePanel({
  entry,
  cardDex,
  settings,
  binders,
  entries,
  onMove,
  onCancel,
  quiet = false,
}: {
  entry: Entry;
  /** Pokémon da carta (0 = não sei ou não é Pokémon: no Pokédex, só os bolsos livres). */
  cardDex: number;
  settings: BinderSettings;
  binders: CustomBinder[];
  entries: Record<string, Entry>;
  /** Move de verdade; `where` é o destino em texto ("Trocas · bolso 12"), para o aviso. Lança erro em português. */
  onMove: (target: MoveTarget, where: string) => Promise<void>;
  onCancel: () => void;
  /** A tela já tem outra ação principal (o "Substituir" do rodapé): "Mover" fica em contorno. */
  quiet?: boolean;
}) {
  const from = entry.binderId && entry.binderId !== POKEDEX_BINDER ? entry.binderId : POKEDEX_BINDER;
  const isHere = (b: string, dex: number, slot: number) => b === from && slot === entry.slot && (b !== POKEDEX_BINDER || dex === entry.dex);
  // Começa no fichário da carta; no Pokédex sem outro lugar para ela, no primeiro fichário livre.
  const [binderId, setBinderId] = useState(() =>
    binders.some((b) => b.id === from)
      ? from
      : dexSpots(settings, cardDex, (d, s) => isHere(POKEDEX_BINDER, d, s)).length || !binders.length
        ? POKEDEX_BINDER
        : binders[0].id,
  );
  // Bolso digitado no fichário livre (null = o sugerido) e lugar escolhido no Pokédex (null = o sugerido).
  const [slotText, setSlotText] = useState<string | null>(null);
  const [spotKey, setSpotKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pokedexName = settings.name || 'Fichário Pokédex';
  const binder = binderId === POKEDEX_BINDER ? undefined : binders.find((b) => b.id === binderId);
  // Fichário escolhido apagado em outro aparelho: o destino volta a ser o Pokédex (e o chip marcado também).
  const shownBinderId = binder?.id ?? POKEDEX_BINDER;
  // Trocar de lugar traz a outra carta para o espaço desta no Pokédex, que é de um Pokémon só: o store recusa quando a
  // outra é de outro Pokémon (ou de um bolso livre, sem Pokémon). A carta vinda de um fichário livre ou de um bolso livre
  // pode trocar com qualquer uma.
  const swapRefused = (other?: Entry) => !!other && from === POKEDEX_BINDER && entry.dex !== 0 && other.dex !== entry.dex;
  const occupiedText = (other: Entry) =>
    swapRefused(other)
      ? `Ocupado por ${other.cardName || 'outra carta'}, que não pode vir para o espaço desta carta no Pokédex. Escolha um bolso vazio.`
      : `Ocupado por ${other.cardName || 'outra carta'}: as duas trocam de lugar.`;

  let target: MoveTarget | undefined;
  let where = '';
  let status = '';
  let position = '';
  // Campo ou opções do destino (ou o motivo de não haver lugar).
  let place: { title: string; hint: string; controls: ReactNode } | undefined;
  let blocked: string | undefined;

  if (binder) {
    const total = customTotalSlots(binder);
    let suggested = -1;
    for (let i = 0; i < total && suggested < 0; i++) {
      if (!entries[customEntryId(binder.id, i)] && !isHere(binder.id, 0, i)) suggested = i;
    }
    const text = slotText ?? (suggested >= 0 ? String(suggested + 1) : '');
    const idx = Number(text) - 1;
    const here = isHere(binder.id, 0, idx);
    const valid = /^\d+$/.test(text) && idx >= 0 && idx < total && !here;
    const other = valid ? entries[customEntryId(binder.id, idx)] : undefined;
    if (valid) {
      if (!swapRefused(other)) target = { binderId: binder.id, slot: idx };
      where = `${binder.name} · ${customPlaceText(binder, idx)}`;
      position = physicalLabel(physicalPosition(binder, idx));
      status = other ? occupiedText(other) : 'Bolso vazio.';
    } else {
      status = !text ? `Fichário cheio: escolha um bolso de 1 a ${total} para trocar de lugar.` : here ? 'A carta já está neste bolso.' : `Escolha um bolso de 1 a ${total}.`;
    }
    place = {
      title: 'Bolso',
      hint: `De 1 a ${total}${suggested >= 0 ? ` · primeiro vazio: ${suggested + 1}` : ''}`,
      controls: (
        <Input
          value={text}
          onChangeText={(t) => {
            setSlotText(t.replace(/\D/g, ''));
            setError(null);
          }}
          keyboardType="number-pad"
          placeholder="Nº do bolso"
          invalid={!!text && !valid}
          accessibilityLabel={`Número do bolso em ${binder.name}`}
        />
      ),
    };
  } else {
    const species = cardDex > 0 ? getSpecies(cardDex) : undefined;
    const spots = dexSpots(settings, cardDex, (d, s) => isHere(POKEDEX_BINDER, d, s));
    const spot = spots.find((s) => s.key === spotKey) ?? spots.find((s) => !entries[s.key]) ?? spots[0];
    if (spot) {
      const other = entries[spot.key];
      if (!swapRefused(other)) target = { dex: spot.dex, slot: spot.slot };
      where = `${pokedexName} · ${spot.dex ? spot.label : spot.label.toLowerCase()}`;
      // F8: com a Pokédex em mais de um fichário físico, "Fichário 2 · folha 5 (frente) · bolso 8".
      position = physicalLabel(
        physicalPosition(settings, spot.dex ? indexOfDex(settings, spot.dex, spot.slot) : indexOfExtra(settings, spot.slot)),
        volumesNeeded(settings),
      );
      status = other ? occupiedText(other) : 'Bolso vazio.';
      place = {
        title: 'Lugar',
        // Uma linha só (a legenda da seção não quebra).
        hint: 'O espaço do Pokémon ou um bolso livre',
        controls: (
          <ChipGroup label="Lugar no fichário Pokédex">
            {spots.map((s) => (
              <Chip
                key={s.key}
                label={`${s.label}${entries[s.key] ? ' · ocupado' : ''}`}
                selected={s.key === spot.key}
                onPress={() => {
                  setSpotKey(s.key);
                  setError(null);
                }}
              />
            ))}
          </ChipGroup>
        ),
      };
    } else {
      blocked = !species
        ? 'Não sei de qual Pokémon é esta carta, e o fichário Pokédex não tem outro bolso livre.'
        : inDexRange(settings, cardDex)
          ? 'No fichário Pokédex, esta carta já está no único lugar dela. Escolha outro fichário.'
          : `${species.name} está fora da faixa do fichário Pokédex, e não há outro bolso livre.`;
    }
  }

  async function submit() {
    if (!target) return;
    setBusy(true);
    setError(null);
    // Sem try/finally: o React Compiler não otimiza um componente com eles.
    const failed = await onMove(target, where).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    setBusy(false);
    if (failed !== null) setError(failed);
  }

  return (
    <Card>
      <Section title={`Mover ${entry.cardName || 'a carta'} para…`}>
        <ChipGroup label="Fichário de destino">
          {[{ id: POKEDEX_BINDER, name: pokedexName }, ...binders].map((b) => (
            <Chip
              key={b.id}
              label={b.name}
              selected={b.id === shownBinderId}
              onPress={() => {
                setBinderId(b.id);
                setSlotText(null);
                setSpotKey(null);
                setError(null);
              }}
            />
          ))}
        </ChipGroup>
      </Section>
      {place ? (
        <Section title={place.title} hint={place.hint}>
          {place.controls}
          {/* `collapsable`: a região ao vivo não impede o achatamento da View no Android; sem isto, ela não existe. */}
          <View style={styles.summary} collapsable={false} aria-live="polite">
            {position ? <Text style={styles.position}>{position}</Text> : null}
            {status ? <Text style={styles.status}>{status}</Text> : null}
          </View>
        </Section>
      ) : null}
      {blocked ? <Notice tone="warning">{blocked}</Notice> : null}
      {error ? (
        <View style={styles.error}>
          <Notice tone="danger">{error}</Notice>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button title="Mover" variant={quiet ? 'secondary' : 'primary'} icon="swap-horizontal" onPress={submit} busy={busy} disabled={!target} style={styles.flex} />
        <Button title="Cancelar" variant="secondary" onPress={onCancel} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  summary: { gap: space.xxs },
  position: { ...typography.bodyStrong, color: colors.text },
  status: { ...typography.caption, color: colors.textMuted },
  error: { marginTop: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  flex: { flex: 1 },
});
