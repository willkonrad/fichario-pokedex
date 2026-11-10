import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState, type RefObject } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputInstance,
  type TextInputKeyPressEvent,
  type ViewStyle,
} from 'react-native';

import { CardImage } from '@/components/card-image';
import { IconButton, type IconName } from '@/components/icon-button';
import { spriteUrl } from '@/data/pokedex';
import { entryImageUrl } from '@/lib/catalog';
import { formatInt } from '@/lib/format';
import { mypPtImage } from '@/lib/myp-api';
import type { Entry } from '@/lib/types';
import { CARD_RATIO, colors, elevation, radius, semantic, space, TOUCH, typography } from '@/theme';

const WEB = Platform.OS === 'web';
const LIST_ID = 'home-search-list';
export const optionId = (i: number) => `home-search-option-${i}`;

/** Uma sugestão da busca da home: um Pokémon, uma carta sua, um bolso ou "Adicionar carta…". */
export type Suggestion = {
  key: string;
  /** Grupo mostrado como título quando muda ("Pokémon", "Suas cartas"…). */
  section: string;
  title: string;
  detail?: string;
  /** Pokémon da sugestão (sprite à esquerda). */
  dex?: number;
  /** Carta da sugestão (miniatura à esquerda). */
  entry?: Entry;
  icon?: IconName;
  onSelect: () => void;
};

/** Sugestão que leva o texto para a Consulta, em todas as cartas que existem (não só nas do fichário). */
export function consultSuggestion(q: string): Suggestion {
  return {
    key: 'consulta',
    section: 'Consulta',
    title: `Consultar “${q}” em todas as cartas`,
    icon: 'pricetags-outline',
    onSelect: () => router.push({ pathname: '/consulta', params: { q } }),
  };
}

/**
 * Altura máxima da lista de sugestões: do topo dela até o que cobre o fim da janela. No iOS a altura do teclado já
 * conta a área segura; no Android vem sem a barra de navegação, que fica por baixo dele.
 */
export function suggestionRoom({
  windowHeight,
  top,
  keyboard,
  bottomInset,
  android = Platform.OS === 'android',
}: {
  windowHeight: number;
  top: number;
  keyboard: number;
  bottomInset: number;
  android?: boolean;
}) {
  const covered = android ? bottomInset + keyboard : Math.max(bottomInset, keyboard);
  return Math.max(TOUCH * 2, windowHeight - top - covered - space.lg);
}

/** Quantas sugestões abriram, para o leitor de tela no celular (com o texto: muda a cada busca, mesmo com a mesma contagem). */
export function suggestionsSpeech(count: number, query: string) {
  return `${formatInt(count)} ${count === 1 ? 'sugestão' : 'sugestões'} para ${query}`;
}

/**
 * Campo da busca da home (combobox): resultados enquanto digita, ↑/↓ e Enter no teclado do computador, Esc fecha a
 * lista (e, sem lista, limpa a busca).
 */
export function HomeSearchInput({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  onMove,
  onEscape,
  onFocus,
  onBlur,
  expanded,
  activeIndex,
  inputRef,
  autoFocus,
  style,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  onSubmit: () => void;
  /** ↑ (-1) e ↓ (+1) na lista. */
  onMove: (delta: number) => void;
  onEscape: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Lista de sugestões aberta (para o leitor de tela). */
  expanded: boolean;
  activeIndex: number;
  inputRef?: RefObject<TextInputInstance | null>;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  // Foco visível na borda do campo (o contorno do navegador sai).
  const [focused, setFocused] = useState(false);
  // O botão some junto com o texto: o foco fica no campo, senão o Tab recomeçaria no topo da página.
  function clear() {
    onChangeText('');
    inputRef?.current?.focus();
  }
  function onKeyPress(e: TextInputKeyPressEvent) {
    const key = e.nativeEvent.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      onMove(key === 'ArrowDown' ? 1 : -1);
    } else if (key === 'Escape') {
      e.preventDefault();
      onEscape();
    }
  }
  // Na web: papel de combobox ligado à lista e à opção ativa (o React Native não tem esses aria-* nos tipos). O
  // react-native-web ignora `submitBehavior` e tira o foco no Enter; com `blurOnSubmit` falso o campo continua
  // focado e o Enter seguinte vai ao próximo resultado (F6).
  const combobox = WEB
    ? ({
        blurOnSubmit: false,
        role: 'combobox',
        'aria-autocomplete': 'list',
        'aria-expanded': expanded,
        'aria-controls': LIST_ID,
        'aria-activedescendant': expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined,
      } as object)
    : null;
  return (
    <View style={[styles.field, focused && styles.fieldFocused, style]}>
      <View style={styles.icon} aria-hidden>
        <Ionicons name="search" size={18} color={colors.textMuted} />
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onKeyPress={onKeyPress}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, !value && styles.inputEnd, NO_OUTLINE]}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        submitBehavior="submit"
        accessibilityLabel="Buscar no fichário"
        {...combobox}
      />
      {value ? <IconButton icon="close-circle" label="Limpar a busca" onPress={clear} size={18} color={colors.iconFaint} /> : null}
    </View>
  );
}

/** Sem o contorno de foco do navegador (o foco aparece na borda do campo). */
const NO_OUTLINE = WEB ? ({ outlineWidth: 0, outlineStyle: 'none' } as unknown as ViewStyle) : null;

/** Papel de lista de opções: o react-native-web entende "listbox"; os tipos do React Native, não. */
const LISTBOX = (WEB ? { role: 'listbox' } : { role: 'list' }) as object;

/**
 * Lista de sugestões, por cima da página, agrupada por seção. `maxHeight`: o espaço até o teclado (celular) ou até o
 * fim da janela; acima disso a lista rola, para "Adicionar…" não ficar escondido.
 */
export function SuggestionList({
  items,
  active,
  onHover,
  maxHeight,
  style,
}: {
  items: Suggestion[];
  active: number;
  onHover: (i: number) => void;
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
}) {
  // ↑/↓ no computador: a opção ativa fica à vista quando a lista rola.
  useEffect(() => {
    if (WEB && typeof document !== 'undefined') document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <View style={[styles.list, style]} nativeID={LIST_ID} aria-label="Sugestões da busca" {...LISTBOX}>
      <ScrollView style={maxHeight ? { maxHeight } : null} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" bounces={false}>
        {items.map((s, i) => (
          <View key={s.key}>
            {i === 0 || items[i - 1].section !== s.section ? (
              <Text style={styles.section} aria-hidden>
                {s.section}
              </Text>
            ) : null}
            <Pressable
              onPress={s.onSelect}
              onHoverIn={() => onHover(i)}
              role="option"
              aria-selected={i === active}
              nativeID={optionId(i)}
              accessibilityLabel={[s.section, s.title, s.detail].filter(Boolean).join(', ')}
              style={({ pressed }) => [styles.row, i === active && styles.rowActive, pressed && { opacity: 0.7 }]}>
              <View style={styles.lead} aria-hidden>
                {s.entry ? (
                  <View style={styles.thumb}>
                    <CardImage
                      image={s.entry.image}
                      imageUrl={entryImageUrl(s.entry)}
                      cardId={s.entry.lang === 'ja' ? undefined : s.entry.cardId}
                      localId={s.entry.localId}
                      photo={s.entry.stampPhoto}
                      ptImage={mypPtImage(s.entry)}
                      compact
                      recyclingKey={s.entry.id}
                    />
                  </View>
                ) : s.dex ? (
                  <Image source={spriteUrl(s.dex)} style={styles.sprite} contentFit="contain" cachePolicy="memory-disk" />
                ) : (
                  <Ionicons name={s.icon ?? 'arrow-forward'} size={20} color={colors.textMuted} />
                )}
              </View>
              <View style={styles.body}>
                <Text style={styles.title} numberOfLines={1}>
                  {s.title}
                </Text>
                {s.detail ? (
                  <Text style={styles.detail} numberOfLines={1}>
                    {s.detail}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const THUMB_W = 28;

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    minHeight: TOUCH,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingHorizontal: space.xs,
  },
  fieldFocused: { borderColor: semantic.focus.ring },
  icon: { width: 36, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, paddingVertical: 10 },
  inputEnd: { paddingRight: space.md },
  list: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...elevation[2] },
  listContent: { paddingVertical: space.xs },
  section: { ...typography.label, color: colors.textMuted, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.lg, paddingVertical: space.xs },
  rowActive: { backgroundColor: semantic.selected.soft },
  lead: { width: 36, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: THUMB_W, height: Math.round(THUMB_W / CARD_RATIO), borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  sprite: { width: 40, height: 40 },
  body: { flex: 1, minWidth: 0 },
  title: { ...typography.bodyStrong, color: colors.text },
  detail: { ...typography.caption, color: colors.textMuted },
});
