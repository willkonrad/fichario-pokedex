import { Image } from 'expo-image';
import { type ReactNode, type Ref } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type KeyboardTypeOptions, type TextInputInstance } from 'react-native';

import type { PressState } from '@/components/icon-button';
import { Chip, ChipRadioScope, IconButton, radioGroupKeys, SearchField } from '@/components/ui';
import { searchSpeciesRanked, splitNameAffixes, spriteUrl, type Species } from '@/data/pokedex';
import type { LookupFilters, LookupLang, ParsedQuery } from '@/lib/lookup-types';
import { colors, radius, semantic, space, TOUCH, typography } from '@/theme';

/** Sem sugestões nem autocorreção do teclado do Android: o nome do Pokémon entra como foi digitado. */
export const LOOKUP_KEYBOARD: KeyboardTypeOptions = Platform.OS === 'android' ? 'visible-password' : 'default';

/** Links de preço: voltar direto para a Consulta ao fechar o navegador. */
export const LINK_BROWSER = { createTask: false, enableBarCollapsing: true };

export const RECENT_KEY = 'consulta:recent';
const MAX_RECENT = 8;
export type RecentSearch = { text: string; lang: LookupLang | null };

/** Busca nova na frente, sem repetir, até 8. */
export function addRecent(list: RecentSearch[], item: RecentSearch): RecentSearch[] {
  const same = (r: RecentSearch) => r.lang === item.lang && r.text.trim().toLowerCase() === item.text.trim().toLowerCase();
  return [item, ...list.filter((r) => !same(r))].slice(0, MAX_RECENT);
}

const RECENT_LANGS: readonly (LookupLang | null)[] = ['pt', 'en', 'ja', 'ko', 'zh', null];

/** Recentes guardados no aparelho; o que não presta fica de fora. */
export function readRecents(raw: string | null): RecentSearch[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(list)) return [];
    return (list as Partial<RecentSearch>[])
      .filter((r) => typeof r?.text === 'string' && r.text.trim())
      .map((r) => ({ text: r.text as string, lang: RECENT_LANGS.includes(r.lang ?? null) ? (r.lang ?? null) : null }))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

// O idioma do chip fica na sessão, fora do texto: num lote de japonesas, não volta a "Todos".
let sessionLang: LookupLang | null = null;
export const getSessionLang = () => sessionLang;
export function setSessionLang(lang: LookupLang | null) {
  sessionLang = lang;
}

/** Troca o trecho do nome pela espécie escolhida; o resto continua ("char 120" → "Charizard 120"). */
export function withSpecies(text: string, species: Species): string {
  // As mesmas palavras que a Consulta lê (parseLookupQuery): "メガリザードンXex" → "mega リザードン X ex".
  const tokens = splitNameAffixes(text).split(/\s+/).filter(Boolean);
  for (let start = 0; start < tokens.length; start++) {
    for (let n = Math.min(3, tokens.length - start); n >= 1; n--) {
      if (searchSpeciesRanked(tokens.slice(start, start + n).join(' '), 24).some((h) => h.species.id === species.id)) {
        return [...tokens.slice(0, start), species.name, ...tokens.slice(start + n)].join(' ');
      }
    }
  }
  return species.name;
}

type FilterField = Exclude<keyof LookupFilters, 'nameTerms'>;

/**
 * Tira do texto o termo que liga um filtro, seja qual for a grafia ("rev" ou "reverse", "hp 120" ou "120"): retira um
 * termo por vez e lê de novo, sem deixar a busca virar outra.
 */
export function dropFilterTerm(text: string, field: FilterField, parse: (t: string) => ParsedQuery): string {
  const now = parse(text);
  if (now.filters[field] == null) return text;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  for (const size of [1, 2]) {
    for (let i = tokens.length - size; i >= 0; i--) {
      const rest = [...tokens.slice(0, i), ...tokens.slice(i + size)].join(' ');
      const next = parse(rest);
      if (next.filters[field] == null && next.mode === now.mode && next.dex === now.dex && next.filters.nameTerms.length === now.filters.nameTerms.length) return rest;
    }
  }
  return text;
}

const LANG_NAME: Record<LookupLang, string> = { pt: 'Português', en: 'Inglês', ja: 'Japonês', ko: 'Coreano', zh: 'Chinês' };
const LANG_LABEL: Record<LookupLang, string> = { pt: 'PT', en: 'EN', ja: 'JP', ko: 'KO', zh: 'ZH' };

export type LangChip = { id: LookupLang | null; count: number };

/** Faixa que rola de lado, sem tirar o foco do campo ao tocar num chip. */
function Strip({ label, role = 'group', children }: { label: string; role?: 'group' | 'radiogroup'; children: ReactNode }) {
  const radio = role === 'radiogroup';
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.strip}
      contentContainerStyle={styles.stripContent}
      role={role}
      aria-label={label}
      // Opções (idioma): na web, as setas andam entre elas e só a marcada entra no Tab.
      {...(radio ? radioGroupKeys() : null)}>
      {radio ? <ChipRadioScope>{children}</ChipRadioScope> : children}
    </ScrollView>
  );
}

/** Idioma: Todos, PT, EN, JP, KO, ZH, só o que tem resultado. Fica na sessão, fora do texto. */
export function LangRow({ chips, value, onChange }: { chips: LangChip[]; value: LookupLang | null; onChange: (l: LookupLang | null) => void }) {
  return (
    <Strip label="Idioma" role="radiogroup">
      {chips.map((c) => {
        const name = c.id ? LANG_LABEL[c.id] : 'Todos';
        return (
          <Chip
            key={c.id ?? 'all'}
            label={`${name} ${c.count}`}
            selected={value === c.id}
            accessibilityLabel={`${c.id ? LANG_NAME[c.id] : 'Todos os idiomas'}, ${c.count} ${c.count === 1 ? 'carta' : 'cartas'}`}
            onPress={() => onChange(c.id)}
          />
        );
      })}
    </Strip>
  );
}

/** HP em ordem crescente, com "+ Filtros" sempre à mão na ponta direita. */
export function HpRow({
  hps,
  value,
  filterCount,
  onHp,
  onFilters,
  children,
}: {
  hps: [number, number][];
  value: number | null;
  filterCount: number;
  onHp: (hp: number) => void;
  onFilters: () => void;
  /** Chip antes dos HPs (ex.: "HP 120 · trocar para nº"). */
  children?: ReactNode;
}) {
  return (
    <View style={styles.hpRow}>
      <Strip label="HP">
        {children}
        {hps.length ? <Text style={styles.stripLabel}>HP</Text> : null}
        {hps.map(([hp, count]) => (
          <Chip
            key={hp}
            label={`${hp} · ${count}`}
            mode="button"
            selected={value === hp}
            accessibilityLabel={`HP ${hp}, ${count} ${count === 1 ? 'carta' : 'cartas'}`}
            onPress={() => onHp(hp)}
          />
        ))}
      </Strip>
      <Chip
        label={filterCount ? `Filtros · ${filterCount}` : '+ Filtros'}
        mode="button"
        accessibilityLabel={filterCount ? `Filtros, ${filterCount} ${filterCount === 1 ? 'ativo' : 'ativos'}` : 'Mais filtros'}
        onPress={onFilters}
      />
    </View>
  );
}

/** Faixa do que falta decidir: as espécies que combinam com o texto, a primeira já alimentando a grade. */
export function SpeciesStrip({ items, active, onPick }: { items: { species: Species; count: number }[]; active: number | null; onPick: (s: Species) => void }) {
  return (
    <Strip label="Pokémon">
      {items.map(({ species, count }) => {
        const on = species.id === active;
        return (
          <Pressable
            key={species.id}
            onPress={() => onPick(species)}
            role="button"
            accessibilityLabel={count ? `${species.name}, ${count} ${count === 1 ? 'carta' : 'cartas'}` : species.name}
            {...(Platform.OS === 'web' ? ({ 'aria-pressed': on } as object) : { 'aria-selected': on })}
            style={(s) => {
              const { pressed, hovered } = s as PressState;
              return [styles.species, on && styles.speciesOn, hovered && !on && styles.speciesHover, pressed && { opacity: 0.8 }];
            }}>
            <Image source={spriteUrl(species.id)} style={styles.sprite} contentFit="contain" cachePolicy="memory-disk" transition={null} />
            <Text style={[styles.speciesText, on && styles.speciesTextOn]} numberOfLines={1}>
              {species.name}
              {count ? <Text style={styles.tabular}> {count}</Text> : null}
            </Text>
          </Pressable>
        );
      })}
    </Strip>
  );
}

/** O campo da Consulta: tudo se escreve nele. Lupa e Enter confirmam o 1º lugar; F e P só no aplicativo instalado. */
export function LookupField({
  value,
  onChangeText,
  onSubmit,
  onClear,
  inputRef,
  autoFocus,
  onFocusChange,
  canScan,
  onPhoto,
  onPrint,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  inputRef?: Ref<TextInputInstance>;
  autoFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  canScan: boolean;
  onPhoto: () => void;
  onPrint: () => void;
}) {
  return (
    <View style={styles.fieldRow}>
      <SearchField
        value={value}
        onChangeText={onChangeText}
        onSubmit={onSubmit}
        onClear={onClear}
        placeholder="Nome do Pokémon"
        label="Buscar carta: nome, depois HP, ano ou número"
        inputRef={inputRef}
        autoFocus={autoFocus}
        selectTextOnFocus
        keyboardType={LOOKUP_KEYBOARD}
        onFocusChange={onFocusChange}
        style={styles.field}
      />
      {canScan ? (
        <>
          <IconButton icon="camera-outline" label="Procurar pela foto da carta" tone="soft" onPress={onPhoto} />
          <IconButton icon="image-outline" label="Procurar por um print da tela" tone="soft" onPress={onPrint} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexGrow: 0, flexShrink: 1, minWidth: 0 },
  stripContent: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stripLabel: { ...typography.label, color: colors.textMuted },
  tabular: { ...typography.tabular },
  hpRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  field: { flex: 1, minWidth: 0 },
  species: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: TOUCH,
    paddingLeft: space.xs,
    paddingRight: space.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  speciesOn: { backgroundColor: semantic.selected.bg, borderColor: semantic.selected.border },
  speciesHover: { borderColor: colors.borderStrong },
  sprite: { width: 36, height: 36 },
  speciesText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  speciesTextOn: { color: semantic.selected.fg },
});
