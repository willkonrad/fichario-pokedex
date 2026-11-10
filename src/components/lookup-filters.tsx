import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewInstance, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PressState } from '@/components/icon-button';
import { focusNode, heading, TAB_INSIDE } from '@/components/layer-a11y';
import { Button, Chip, ChipGroup, IconButton, SearchField, useKeyboardHeight, useLayout } from '@/components/ui';
import { NO_VALUE, rarityLabel } from '@/lib/lookup-query';
import type { LookupCard, LookupFilters, LookupHeader, LookupLang, VariantFilter } from '@/lib/lookup-types';
import { applyFilters, type facets as facetsOf } from '@/lib/lookup-view';
import { colors, elevation, radius, space, TOUCH, typography } from '@/theme';

type Facets = ReturnType<typeof facetsOf>;

/** Coleções mostradas de uma vez; o resto aparece digitando na busca do bloco. */
const SETS_SHOWN = 30;
const WEB = Platform.OS === 'web';
/** O foco vai para o título ao abrir, sem o contorno do navegador: não é um controle. */
const NO_OUTLINE = WEB ? ({ outlineWidth: 0 } as ViewStyle) : null;

export const VARIANT_LABEL: Record<VariantFilter, string> = {
  holo: 'Holo',
  reverse: 'Reverse',
  firstEdition: '1ª edição',
  stamp: 'Selo',
  staff: 'Staff',
  pokeball: 'Poké Ball',
  masterball: 'Master Ball',
  mirror: 'Mirror',
  noPrints: 'Impressão desconhecida',
};

const LANG_LABEL: Record<LookupLang, string> = { pt: 'PT', en: 'EN', ja: 'JP', ko: 'KO', zh: 'ZH' };

export type ActiveFilter = {
  /** Qual filtro: nome em LookupFilters, e `name:<termo>` nas partes do nome. */
  id: string;
  /** Texto do chip: "HP 120". */
  label: string;
  /** "Sem o HP 120". */
  without: string;
  /** Quantas cartas aparecem sem este filtro. */
  count: number;
};

const setLabel = (key: string, header: LookupHeader) => header.sets.get(key)?.abbr || header.sets.get(key)?.name || key;

/** Filtros ligados, com quantas cartas voltam ao tirar cada um (as que mais trazem de volta primeiro). */
export function activeFilterList(filters: LookupFilters, base: LookupCard[], header: LookupHeader): ActiveFilter[] {
  const count = (patch: Partial<LookupFilters>) => applyFilters(base, { ...filters, ...patch }).shown.length;
  const out: ActiveFilter[] = [];
  if (filters.hp != null) out.push({ id: 'hp', label: `HP ${filters.hp}`, without: `Sem o HP ${filters.hp}`, count: count({ hp: null }) });
  if (filters.year != null) {
    const name = filters.year === 'none' ? 'Sem ano' : String(filters.year);
    out.push({ id: 'year', label: name, without: filters.year === 'none' ? 'Com qualquer ano' : `Sem o ano ${filters.year}`, count: count({ year: null }) });
  }
  if (filters.number != null) {
    const none = filters.number === NO_VALUE;
    out.push({ id: 'number', label: none ? 'Sem número' : `Nº ${filters.number}`, without: none ? 'Com qualquer número' : `Sem o nº ${filters.number}`, count: count({ number: null }) });
  }
  if (filters.rarity != null) {
    const none = filters.rarity === NO_VALUE;
    out.push({ id: 'rarity', label: none ? 'Sem raridade' : filters.rarity, without: none ? 'Com qualquer raridade' : `Sem a raridade ${filters.rarity}`, count: count({ rarity: null }) });
  }
  if (filters.variant) out.push({ id: 'variant', label: VARIANT_LABEL[filters.variant], without: `Sem ${VARIANT_LABEL[filters.variant]}`, count: count({ variant: null }) });
  if (filters.setKey != null) {
    const name = setLabel(filters.setKey, header);
    out.push({ id: 'setKey', label: name, without: `Sem a coleção ${name}`, count: count({ setKey: null }) });
  }
  if (filters.cardType != null) {
    const none = filters.cardType === NO_VALUE;
    out.push({ id: 'cardType', label: none ? 'Sem tipo' : filters.cardType, without: none ? 'Com qualquer tipo' : `Sem o tipo ${filters.cardType}`, count: count({ cardType: null }) });
  }
  if (filters.stage != null) {
    const none = filters.stage === NO_VALUE;
    out.push({ id: 'stage', label: none ? 'Sem estágio' : filters.stage, without: none ? 'Com qualquer estágio' : `Sem o estágio ${filters.stage}`, count: count({ stage: null }) });
  }
  if (filters.lang) out.push({ id: 'lang', label: LANG_LABEL[filters.lang], without: `Sem o idioma ${LANG_LABEL[filters.lang]}`, count: count({ lang: null }) });
  for (const term of filters.nameTerms) {
    out.push({ id: `name:${term}`, label: `“${term}”`, without: `Sem “${term}”`, count: count({ nameTerms: filters.nameTerms.filter((t) => t !== term) }) });
  }
  return out.sort((a, b) => b.count - a.count);
}

const cartas = (n: number) => `${n} ${n === 1 ? 'carta' : 'cartas'}`;

/** Sem resultado com filtros: cada filtro ativo com ✕ e quantas cartas voltam sem ele. */
export function NoResultFilters({ items, onClear }: { items: ActiveFilter[]; onClear: (item: ActiveFilter) => void }) {
  return (
    <View style={styles.noResult}>
      <Text style={styles.noResultTitle} {...heading(2)}>
        Nenhuma carta com esses filtros
      </Text>
      <ChipGroup label="Filtros ativos" mode="button">
        {items.map((i) => (
          <Chip key={i.id} label={i.label} icon="close" mode="button" accessibilityLabel={`Tirar o filtro ${i.label}`} onPress={() => onClear(i)} />
        ))}
      </ChipGroup>
      {items
        .filter((i) => i.count > 0)
        .map((i) => (
          <Pressable
            key={i.id}
            onPress={() => onClear(i)}
            role="button"
            accessibilityLabel={`${i.without}: ${cartas(i.count)}`}
            style={(s) => {
              const { pressed, hovered } = s as PressState;
              return [styles.noResultRow, hovered && styles.rowHover, pressed && { opacity: 0.7 }];
            }}>
            <Text style={styles.noResultText}>
              {i.without}: {cartas(i.count)}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle} {...heading(3)}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export type PanelActions = {
  onYear: (year: number | 'none') => void;
  onRarity: (code: string) => void;
  onVariant: (variant: VariantFilter) => void;
  onSet: (key: string) => void;
  onType: (type: string) => void;
  onStage: (stage: string) => void;
  onClear: () => void;
  onClose: () => void;
};

/** "+ Filtros": painel curto na própria tela. Só mostra valor com resultado, com a contagem dos outros filtros ativos. */
export function LookupFiltersPanel({
  facets,
  filters,
  cards,
  header,
  hasActive,
  actions,
}: {
  facets: Facets;
  filters: LookupFilters;
  cards: LookupCard[];
  header: LookupHeader;
  hasActive: boolean;
  actions: PanelActions;
}) {
  const L = useLayout();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  // O campo "Procurar coleção" abre o teclado: o painel sobe junto (no Android o teclado não conta a barra de navegação).
  const bottom = Platform.OS === 'android' ? insets.bottom + keyboard : Math.max(insets.bottom, keyboard);
  const maxHeight = L.isDesktop ? L.height * 0.8 : Math.min(L.height * 0.72 + bottom, L.height - insets.top - space.xxl);
  const [setQuery, setSetQuery] = useState('');
  const { onClose } = actions;
  const titleRef = useRef<ViewInstance>(null);

  // Ao abrir, o foco entra no painel (o leitor de tela diz "Filtros"); a tela devolve o foco ao botão ao fechar.
  useEffect(() => {
    focusNode(titleRef.current);
  }, []);

  useEffect(() => {
    if (WEB) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  // A contagem por ano sai da mesma regra da lista (faixa de promos conta em cada ano dela).
  const yearCounts = useMemo(() => new Map(facets.years.map((y) => [y, applyFilters(cards, { ...filters, year: y }).shown.length])), [facets.years, cards, filters]);
  const sets = useMemo(() => {
    const q = setQuery.trim().toLowerCase();
    const named = facets.sets.map(([key, count]) => ({ key, count, set: header.sets.get(key) }));
    return q ? named.filter((s) => `${s.set?.name ?? ''} ${s.set?.abbr ?? ''}`.toLowerCase().includes(q)) : named;
  }, [facets.sets, header, setQuery]);
  const isSet = (key: string) => {
    const wanted = filters.setKey;
    if (wanted == null) return false;
    const abbr = header.sets.get(key)?.abbr;
    return wanted === key || (!!abbr && abbr.toLowerCase() === wanted.toLowerCase());
  };

  return (
    <View style={[styles.layer, L.isDesktop ? styles.layerDesktop : styles.layerPhone]}>
      <View style={styles.backdrop} aria-hidden onStartShouldSetResponder={() => true} onResponderRelease={onClose} />
      <View
        role="dialog"
        aria-modal
        aria-label="Filtros"
        onAccessibilityEscape={onClose}
        // Na web, o Tab dá a volta dentro do painel; o Esc fica com a tela, em qualquer largura.
        {...TAB_INSIDE}
        style={[styles.panel, L.isDesktop ? styles.panelDesktop : { paddingBottom: bottom }, { maxHeight }]}>
        <View style={styles.head}>
          <View ref={titleRef} accessible accessibilityLabel="Filtros" tabIndex={-1} style={NO_OUTLINE} {...heading(2)}>
            <Text style={styles.title}>Filtros</Text>
          </View>
          <IconButton icon="close" label="Fechar os filtros" onPress={onClose} color={colors.textMuted} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {facets.years.length ? (
            <Group title="Ano">
              <ChipGroup label="Ano" mode="button">
                {facets.years.map((y) => (
                  <Chip key={y} mode="button" label={`${y === 'none' ? 'Sem ano' : y} · ${yearCounts.get(y) ?? 0}`} selected={filters.year === y} onPress={() => actions.onYear(y)} />
                ))}
              </ChipGroup>
            </Group>
          ) : null}
          {facets.rarities.length ? (
            <Group title="Raridade">
              <ChipGroup label="Raridade" mode="button">
                {facets.rarities.map(([code, count]) => (
                  <Chip
                    key={code}
                    mode="button"
                    label={`${code === NO_VALUE ? 'Sem raridade' : rarityLabel(code)} · ${count}`}
                    selected={filters.rarity === code}
                    onPress={() => actions.onRarity(code)}
                  />
                ))}
              </ChipGroup>
            </Group>
          ) : null}
          {facets.variants.length ? (
            <Group title="Variação">
              <ChipGroup label="Variação" mode="button">
                {facets.variants.map(([v, count]) => (
                  <Chip key={v} mode="button" label={`${VARIANT_LABEL[v]} · ${count}`} selected={filters.variant === v} onPress={() => actions.onVariant(v)} />
                ))}
              </ChipGroup>
            </Group>
          ) : null}
          {facets.sets.length ? (
            <Group title="Coleção">
              {facets.sets.length > 8 ? <SearchField value={setQuery} onChangeText={setSetQuery} placeholder="Procurar coleção" label="Procurar coleção" /> : null}
              <ChipGroup label="Coleção" mode="button">
                {sets.slice(0, SETS_SHOWN).map(({ key, count, set }) => (
                  <Chip key={key} mode="button" label={`${set?.abbr ? `${set.abbr} · ` : ''}${set?.name ?? key} · ${count}`} selected={isSet(key)} onPress={() => actions.onSet(key)} />
                ))}
              </ChipGroup>
              {sets.length > SETS_SHOWN ? <Text style={styles.hint}>Mais {sets.length - SETS_SHOWN} coleções: digite o nome para achar.</Text> : null}
              {!sets.length ? <Text style={styles.hint}>Nenhuma coleção com esse nome.</Text> : null}
            </Group>
          ) : null}
          {facets.types.length ? (
            <Group title="Tipo">
              <ChipGroup label="Tipo" mode="button">
                {facets.types.map(([t, count]) => (
                  <Chip key={t} mode="button" label={`${t === NO_VALUE ? 'Sem tipo' : t} · ${count}`} selected={filters.cardType === t} onPress={() => actions.onType(t)} />
                ))}
              </ChipGroup>
            </Group>
          ) : null}
          {facets.stages.length ? (
            <Group title="Estágio">
              <ChipGroup label="Estágio" mode="button">
                {facets.stages.map(([t, count]) => (
                  <Chip key={t} mode="button" label={`${t === NO_VALUE ? 'Sem estágio' : t} · ${count}`} selected={filters.stage === t} onPress={() => actions.onStage(t)} />
                ))}
              </ChipGroup>
            </Group>
          ) : null}
          {hasActive ? <Button title="Limpar filtros" variant="secondary" onPress={actions.onClear} /> : null}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, zIndex: 20 },
  layerPhone: { justifyContent: 'flex-end' },
  layerDesktop: { alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  panel: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, ...elevation[2] },
  panelDesktop: { borderRadius: radius.lg, width: '100%', maxWidth: 640 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.lg, paddingRight: space.xs, minHeight: TOUCH },
  title: { ...typography.heading, color: colors.heading },
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.lg },
  group: { gap: space.sm },
  groupTitle: { ...typography.label, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  noResult: { gap: space.md, paddingVertical: space.lg },
  noResultTitle: { ...typography.heading, color: colors.heading },
  noResultRow: { minHeight: TOUCH, justifyContent: 'center', borderRadius: radius.sm },
  rowHover: { backgroundColor: colors.surfaceAlt },
  noResultText: { ...typography.bodyStrong, ...typography.tabular, color: colors.text },
});
