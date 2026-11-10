import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { Children, createContext, isValidElement, useContext, useEffect, useState, type ReactNode, type Ref } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { digitsInSystemFont } from '@/components/digits';
import { IconButton, type IconName, type PressState } from '@/components/icon-button';
import { PokeballIcon, withMarkIcons } from '@/components/icons';
import { heading } from '@/components/layer-a11y';
import { useLayout } from '@/components/layout';
import { useToastClearance } from '@/components/toast';
import { brandGradient, colors, contrastRatio, font, radius, semantic, space, TOUCH, typography, widths } from '@/theme';

// Componentes que moram em arquivos próprios, reexportados para as telas importarem tudo de um lugar só.
export { IconButton, type IconName } from '@/components/icon-button';
export { PokeballIcon, withMarkIcons } from '@/components/icons';
export { InfoButton, InfoParagraph, InfoSheet, InfoTopic } from '@/components/info-sheet';
export { gridColumns, layoutSize, useKeyboardHeight, useLayout, type LayoutSize } from '@/components/layout';
export { useReducedMotion } from '@/components/motion';
export { CardSkeleton, Skeleton, TextSkeleton } from '@/components/skeleton';
export { hideToast, showToast, ToastHost, useToast, useToastClearance, type ToastOptions } from '@/components/toast';

const WEB = Platform.OS === 'web';

/**
 * Na web, o react-native-web só aciona com a barra de espaço o que tem papel de botão: opção (radio) e caixa
 * de seleção (checkbox) também precisam responder a ela, como no navegador.
 */
export function spaceToPress(onPress: () => void, disabled?: boolean) {
  if (!WEB) return null;
  return {
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (disabled || (e.key !== ' ' && e.key !== 'Spacebar')) return;
      e.preventDefault();
      onPress();
    },
  } as object;
}

const ARROW_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

type RadioKeyEvent = {
  key: string;
  target: unknown;
  currentTarget: unknown;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

/**
 * Setas num grupo de opções (como os radios do navegador): vão para a próxima ou a anterior, dando a volta nas pontas, e
 * a marcam. Com `selectOnMove` false, só movem o foco, para quando marcar já faz algo maior (ex.: fechar a janela).
 */
export function moveRadioFocus(e: RadioKeyEvent, selectOnMove = true) {
  const step = ARROW_STEP[e.key];
  if (!step || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const radios = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])'));
  const at = radios.indexOf(e.target as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  // As setas da tela (folhear, andar na grade) ficam de fora.
  e.stopPropagation();
  const next = radios[(at + step + radios.length) % radios.length];
  next.focus();
  if (selectOnMove) next.click();
}

/** Props do grupo de opções na web: as setas andam entre elas. */
export function radioGroupKeys(selectOnMove = true) {
  if (!WEB) return null;
  return { onKeyDown: (e: RadioKeyEvent) => moveRadioFocus(e, selectOnMove) } as object;
}

/** Na web, só a opção marcada entra no Tab (sem nenhuma marcada, todas); as outras se alcançam pelas setas. */
export function radioTabIndex(checked: boolean, anyChecked: boolean) {
  return WEB && anyChecked && !checked ? ({ tabIndex: -1 } as object) : null;
}

/**
 * Foco do teclado numa opção selecionada: o contorno do navegador some sobre o branco, e a folga põe o anel no fundo
 * escuro. Sem `outlineStyle` de propósito: assim o anel só aparece quando o navegador liga o contorno (:focus-visible).
 */
export const SELECTED_FOCUS = (WEB ? { outlineColor: semantic.focus.ring, outlineWidth: semantic.focus.width, outlineOffset: semantic.focus.offset } : {}) as ViewStyle;

/**
 * No celular, lê um erro assim que ele aparece ou muda. O papel 'alert' só vale na web: no Android é só a descrição do
 * papel, o TalkBack não lê a região que já entra preenchida, e o VoiceOver não lê regiões "ao vivo".
 */
export function useAlertAnnouncement(text: string | null | undefined) {
  useEffect(() => {
    if (!WEB && text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
}

/** O texto de um conteúdo (string, número, listas e elementos com filhos), para anunciar. */
export function plainText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(plainText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children);
  return '';
}

/** Botão em pílula: vermelho em gradiente (principal, um por tela), contorno (secundário), só texto ou perigo. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  busy,
  label,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  /** Mostra o carregando no lugar do ícone e bloqueia o toque. */
  busy?: boolean;
  /** Nome lido pelo leitor de tela, quando o título sozinho não basta. */
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const v = BUTTON[variant];
  const off = !!(disabled || busy);
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      role="button"
      accessibilityLabel={label}
      aria-disabled={off}
      aria-busy={!!busy}
      style={(state) => {
        const { pressed, hovered } = state as PressState;
        return [
          styles.button,
          { backgroundColor: v.bg, borderColor: v.border },
          hovered && !off && { backgroundColor: v.hover, borderColor: variant === 'primary' ? v.hover : v.border },
          off && { opacity: 0.45 },
          pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
          style,
        ];
      }}>
      {(state) => (
        <>
          {/* Com o mouse por cima, o gradiente sai e fica o vermelho mais escuro do fundo. */}
          {variant === 'primary' && !off && !(state as PressState).hovered ? (
            <LinearGradient colors={brandGradient} style={[StyleSheet.absoluteFill, styles.buttonFill]} pointerEvents="none" />
          ) : null}
          {busy ? <ActivityIndicator color={v.fg} size="small" /> : icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
          <Text style={[styles.buttonText, { color: v.fg }]}>{digitsInSystemFont(title)}</Text>
        </>
      )}
    </Pressable>
  );
}

const BUTTON = {
  primary: { bg: colors.primaryAction, fg: colors.onPrimary, border: colors.primaryAction, hover: colors.primaryDark },
  secondary: { bg: 'transparent', fg: colors.text, border: colors.borderStrong, hover: colors.surfaceAlt },
  // Só texto, em branco: o vermelho fica para a ação principal.
  ghost: { bg: 'transparent', fg: colors.text, border: 'transparent', hover: semantic.hover.onLight },
  danger: { bg: 'transparent', fg: semantic.danger.fg, border: semantic.danger.border, hover: semantic.danger.bg },
};

/**
 * Opção selecionável (estado, variação, idioma…): selecionada fica branca, com texto preto.
 * `mode`: 'radio' (padrão, escolha de uma entre várias), 'checkbox' (várias ao mesmo tempo) ou 'button' (ação).
 * No 'button', `selected` só para o que liga e desliga; ação de um toque ("Ver versões", "Concluir") não passa
 * `selected` e é anunciada como botão simples.
 * Para o leitor de tela agrupar as opções, ponha os chips dentro de um `ChipGroup`.
 */
export function Chip({
  label,
  selected,
  onPress,
  hint,
  icon,
  mode = 'radio',
  disabled,
  accessibilityLabel,
}: {
  label: string;
  /** Marcado (radio/checkbox). No 'button', só quando ele liga e desliga: sem `selected`, é uma ação de um toque. */
  selected?: boolean;
  onPress: () => void;
  /** Destaque tracejado (ex.: variação que existe para a carta). */
  hint?: boolean;
  icon?: IconName;
  mode?: 'radio' | 'checkbox' | 'button';
  disabled?: boolean;
  /** Nome lido pelo leitor de tela, quando o rótulo é curto demais (ex.: "PT"). */
  accessibilityLabel?: string;
}) {
  const on = !!selected;
  const groupChecked = useContext(ChipGroupChecked);
  // Botão que liga e desliga: na web, aria-pressed (aria-selected não vale em botão); no celular, "selecionado".
  // Ação de um toque (sem `selected`): botão simples, sem estado.
  const state =
    mode !== 'button'
      ? { 'aria-checked': on }
      : selected === undefined
        ? null
        : WEB
          ? ({ 'aria-pressed': selected } as object)
          : { 'aria-selected': selected };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role={mode}
      accessibilityLabel={accessibilityLabel}
      aria-disabled={!!disabled}
      {...state}
      {...(mode !== 'button' ? spaceToPress(onPress, disabled) : null)}
      {...(mode === 'radio' ? radioTabIndex(on, groupChecked) : null)}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [
          styles.chip,
          on && styles.chipSelected,
          on && SELECTED_FOCUS,
          hint && !on && styles.chipHint,
          hovered && !on && !disabled && styles.chipHover,
          disabled && { opacity: 0.45 },
          pressed && { opacity: 0.8 },
        ];
      }}>
      {icon ? <Ionicons name={icon} size={15} color={on ? semantic.selected.fg : colors.textMuted} /> : null}
      {mode === 'checkbox' && on && !icon ? <Ionicons name="checkmark" size={15} color={semantic.selected.fg} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const ChipGroupChecked = createContext(false);

/** Conta aos chips de um grupo de opções se há um marcado: só então os outros saem do Tab (ver radioTabIndex). */
export function ChipRadioScope({ children }: { children: ReactNode }) {
  const anyChecked = Children.toArray(children).some((c) => isValidElement<{ selected?: boolean; disabled?: boolean }>(c) && !!c.props.selected && !c.props.disabled);
  return <ChipGroupChecked value={anyChecked}>{children}</ChipGroupChecked>;
}

/** Grupo de chips em linhas que quebram, com nome para o leitor de tela ("Idioma", "Grade"). */
export function ChipGroup({
  label,
  mode = 'radio',
  children,
  style,
}: {
  label: string;
  /** Igual ao `mode` dos chips: 'radio' vira radiogroup; os outros, um grupo simples. */
  mode?: 'radio' | 'checkbox' | 'button';
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const radio = mode === 'radio';
  return (
    <View style={[styles.wrap, style]} role={radio ? 'radiogroup' : 'group'} aria-label={label} {...(radio ? radioGroupKeys() : null)}>
      {radio ? <ChipRadioScope>{children}</ChipRadioScope> : children}
    </View>
  );
}

/** Controle segmentado: opções curtas lado a lado, numa linha só (ex.: estado M, NM, SP…). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  /** `hint`: descrição lida pelo leitor de tela (ex.: "Near Mint — quase perfeita"). */
  options: readonly { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Nome do grupo para o leitor de tela. */
  label: string;
}) {
  const anyChecked = options.some((o) => o.id === value);
  return (
    // Seis opções num cartão de 360 dp: sem as folgas, cada uma fica com os 48 de alvo.
    <View style={[styles.segmented, options.length >= 6 && styles.segmentedTight]} role="radiogroup" aria-label={label} {...radioGroupKeys()}>
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            role="radio"
            accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
            aria-checked={selected}
            {...spaceToPress(() => onChange(o.id))}
            {...radioTabIndex(selected, anyChecked)}
            style={(s) => {
              const { pressed, hovered } = s as PressState;
              return [styles.segment, selected && styles.segmentOn, selected && SELECTED_FOCUS, hovered && !selected && styles.segmentHover, pressed && !selected && { opacity: 0.7 }];
            }}>
            <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bloco com título e explicação curta (no máximo uma linha; o resto vai para uma InfoSheet). */
export function Section({ title, hint, children, right }: { title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} {...heading(3)}>
          {/* Título dinâmico ("Mover Porygon2 para…"): número fora da Kanit. */}
          {digitsInSystemFont(title)}
        </Text>
        {right}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

/** Cartão grafite: um degrau sobre o preto, sem sombra. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Rótulo pequeno em maiúsculas, para separar grupos de uma tela (título de nível 2 para o leitor de tela). */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.groupLabel} {...heading(2)}>
      {children}
    </Text>
  );
}

/** Campo de texto; em foco, a borda fica na cor do foco (no lugar do contorno padrão do navegador). */
export function Input({
  invalid,
  ref,
  ...props
}: TextInputProps & {
  /** Valor inválido: borda vermelha (mostre o erro em texto ao lado). */
  invalid?: boolean;
  /** O campo de verdade, para focar ou medir (React 19: o ref chega como prop): `ref={meuRef}`. */
  ref?: Ref<TextInputInstance>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textFaint}
      {...props}
      {...(invalid ? invalidProps(props.accessibilityLabel ?? props.placeholder) : null)}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      style={[styles.input, NO_OUTLINE, focused && { borderColor: semantic.focus.ring }, invalid && { borderColor: semantic.danger.fg }, props.style]}
    />
  );
}

/**
 * Campo inválido para o leitor de tela: na web, aria-invalid; no celular (sem equivalente), "inválido" no nome do campo.
 */
export function invalidProps(label: string | undefined) {
  if (WEB) return { 'aria-invalid': true } as object;
  return { accessibilityLabel: label ? `${label}, inválido` : 'Inválido' };
}

/** Sem o contorno de foco do navegador (o foco é mostrado pela borda). */
const NO_OUTLINE = WEB ? ({ outlineWidth: 0, outlineStyle: 'none' } as unknown as ViewStyle) : null;

/** Campo de busca em cápsula, com lupa (toque = buscar) e botão de limpar, ambos com alvo de 48 px. */
export function SearchField({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  label,
  icon = 'search',
  autoFocus,
  style,
  inputRef,
  selectTextOnFocus,
  keyboardType,
  onClear,
  onFocusChange,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit?: () => void;
  placeholder: string;
  label: string;
  icon?: 'search' | 'filter';
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  /** O campo de verdade, para focar de fora. */
  inputRef?: Ref<TextInputInstance>;
  /** Ao focar, seleciona o texto: o que for digitado substitui o anterior. */
  selectTextOnFocus?: boolean;
  keyboardType?: KeyboardTypeOptions;
  /** Limpar: no lugar do `onChangeText('')` (ex.: limpar e manter o foco). */
  onClear?: () => void;
  onFocusChange?: (focused: boolean) => void;
}) {
  const [focused, setFocused] = useState(false);
  const iconColor = focused ? semantic.focus.ring : colors.textMuted;
  const changeFocus = (on: boolean) => {
    setFocused(on);
    onFocusChange?.(on);
  };
  return (
    <View style={[styles.searchField, focused && { borderColor: semantic.focus.ring }, style]}>
      {onSubmit ? (
        <IconButton icon={icon} label="Buscar" onPress={onSubmit} size={18} color={iconColor} />
      ) : (
        <View style={styles.searchIcon} aria-hidden>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
      )}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={() => changeFocus(true)}
        onBlur={() => changeFocus(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={[styles.searchInput, !value && styles.searchInputEnd, NO_OUTLINE]}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        selectTextOnFocus={selectTextOnFocus}
        keyboardType={keyboardType}
        accessibilityLabel={label}
      />
      {value ? <IconButton icon="close-circle" label="Limpar a busca" onPress={onClear ?? (() => onChangeText(''))} size={18} color={colors.textMuted} /> : null}
    </View>
  );
}

/**
 * Número com − e +. No celular, o leitor de tela trata o conjunto como um controle ajustável (deslize para
 * cima ou para baixo); na web, os botões têm nome e o número é anunciado quando muda.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  /** Nome lido pelo leitor de tela (ex.: "linhas"). */
  label?: string;
}) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  const group = WEB
    ? { role: 'group' as const, 'aria-label': label }
    : {
        accessible: true,
        accessibilityRole: 'adjustable' as const,
        accessibilityLabel: label,
        // Com `text`, o iOS lê o número; só com min/max/now, ele leria uma porcentagem ("2%").
        accessibilityValue: { min, max, now: value, text: String(value) },
        accessibilityActions: [{ name: 'increment' }, { name: 'decrement' }],
        onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
          if (e.nativeEvent.actionName === 'increment') inc();
          if (e.nativeEvent.actionName === 'decrement') dec();
        },
      };
  return (
    <View style={styles.stepper} {...group}>
      <Pressable
        style={({ pressed }) => [styles.stepBtn, value <= min && styles.stepBtnOff, pressed && { opacity: 0.6 }]}
        onPress={dec}
        disabled={value <= min}
        role="button"
        aria-disabled={value <= min}
        accessibilityLabel={label ? `Diminuir ${label}` : 'Diminuir'}>
        <Ionicons name="remove" size={20} color={colors.text} />
      </Pressable>
      <Text style={styles.stepValue} aria-live={WEB ? 'polite' : undefined} accessibilityLabel={label ? `${label}: ${value}` : String(value)}>
        {value}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.stepBtn, value >= max && styles.stepBtnOff, pressed && { opacity: 0.6 }]}
        onPress={inc}
        disabled={value >= max}
        role="button"
        aria-disabled={value >= max}
        accessibilityLabel={label ? `Aumentar ${label}` : 'Aumentar'}>
        <Ionicons name="add" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

/** Linha com rótulo à esquerda e controle à direita. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** Interruptor com rótulo; tocar no rótulo também liga e desliga. */
export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      {/* O rótulo é lido como texto; o controle com nome e estado é o próprio interruptor. Na web, o Pressable sempre
          entra no Tab (o focusable não vale lá): o tabIndex -1 o tira da ordem, e o clique continua ligando. */}
      <Pressable style={styles.toggleLabel} onPress={() => onChange(!value)} accessible={false} focusable={false} tabIndex={-1}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </Pressable>
      <Switch
        value={value}
        onValueChange={onChange}
        // Ligado = selecionado: trilho branco e bolinha preta (na web, a bolinha ligada tem uma prop própria).
        trackColor={{ true: semantic.selected.bg, false: colors.borderStrong }}
        ios_backgroundColor={colors.borderStrong}
        thumbColor={value ? semantic.selected.fg : semantic.selected.bg}
        {...(WEB ? ({ activeThumbColor: semantic.selected.fg } as object) : null)}
        accessibilityLabel={label}
        accessibilityHint={hint}
      />
    </View>
  );
}

/** Cores de capa, com nome para o leitor de tela. (Os valores ficam gravados nos fichários: não mude.) */
export const COVER_COLORS: { color: string; name: string }[] = [
  { color: '#E3350D', name: 'Vermelho Pokémon' },
  { color: '#F76B15', name: 'Laranja' },
  { color: '#FFCB05', name: 'Amarelo Pikachu' },
  { color: '#46A758', name: 'Verde' },
  { color: '#12A594', name: 'Turquesa' },
  { color: '#2F5BD3', name: 'Azul' },
  { color: '#6E56CF', name: 'Roxo' },
  { color: '#D6409F', name: 'Rosa' },
  { color: '#8D8D8D', name: 'Cinza' },
  { color: '#1C1C1F', name: 'Preto' },
];

/**
 * Cor com que a capa aparece na tela. A capa vermelha gravada (#E3350D) é desenhada no vermelho da marca, em que o
 * branco passa AA; o valor gravado no fichário não muda.
 */
export function coverFill(color: string) {
  return color.toUpperCase() === COVER_COLORS[0].color ? colors.primary : color;
}

/**
 * Cor do texto sobre uma capa: branco ou tinta escura, o que der mais contraste (WCAG); se nenhum dos dois chegar a
 * 4,5:1, preto. Laranja, amarelo, verde, turquesa e cinza ficam com tinta escura; vermelho, azul, roxo e preto, com
 * branco; rosa, com preto.
 */
export function onCover(cover: string) {
  const color = coverFill(cover);
  const white = contrastRatio(color, '#FFFFFF');
  const ink = contrastRatio(color, colors.ink);
  if (white == null || ink == null) return '#FFFFFF';
  if (Math.max(white, ink) < 4.5) return semantic.selected.fg;
  return ink > white ? colors.ink : '#FFFFFF';
}

export function ColorPicker({ value, onChange, label = 'Cor da capa' }: { value?: string; onChange: (c: string) => void; label?: string }) {
  return (
    <View style={styles.wrap} role="radiogroup" aria-label={label} {...radioGroupKeys()}>
      {COVER_COLORS.map(({ color, name }) => {
        const active = value === color;
        // A capa preta sumiria no fundo escuro: ganha um contorno.
        const blends = (contrastRatio(color, colors.surface) ?? 21) < 1.5;
        return (
          <Pressable
            key={color}
            onPress={() => onChange(color)}
            // Escolhida: borda branca e o visto; o contorno fica livre para o foco do teclado.
            style={[styles.swatch, { backgroundColor: coverFill(color) }, blends && styles.swatchBlends, active && styles.swatchActive, active && SELECTED_FOCUS]}
            role="radio"
            accessibilityLabel={name}
            aria-checked={active}
            {...spaceToPress(() => onChange(color))}
            {...radioTabIndex(active, COVER_COLORS.some((c) => c.color === value))}>
            {active ? <Ionicons name="checkmark" size={18} color={onCover(color)} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Barra fixa no rodapé com a ação principal da tela (respeita a área segura do aparelho). Margem lateral e largura
 * máxima iguais às da coluna da tela (`width`: o tipo de conteúdo, como em `widths`, com a margem dentro dele).
 */
export function BottomBar({ children, bottomInset, width = 'reading' }: { children: ReactNode; bottomInset: number; width?: keyof typeof widths }) {
  // Os avisos (toast) ficam acima da barra quando passariam por cima do botão principal ("Colocar"); no computador, o
  // aviso no canto direito fica embaixo se o botão estiver no meio.
  const [height, setHeight] = useState(0);
  const [span, setSpan] = useState<{ left: number; right: number } | undefined>();
  const { gutter } = useLayout();
  useToastClearance(height, span);
  return (
    <View
      style={[styles.bottomBar, { paddingHorizontal: gutter, paddingBottom: 12 + bottomInset }]}
      onLayout={(e) => setHeight(Math.ceil(e.nativeEvent.layout.height))}>
      <View
        style={[styles.bottomInner, { maxWidth: widths[width] - gutter * 2 }]}
        onLayout={(e) => {
          const { x, width } = e.nativeEvent.layout;
          setSpan({ left: Math.floor(x), right: Math.ceil(x + width) });
        }}>
        {children}
      </View>
    </View>
  );
}

/** Altura a reservar no fim da rolagem para a barra fixa não cobrir o conteúdo. */
export const BOTTOM_BAR_SPACE = 100;

/** Carregando: Poké Ball com o indicador do sistema embaixo. */
export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading} accessible role="progressbar" aria-busy aria-label={label ?? 'Carregando'}>
      <PokeballIcon size={30} color={colors.textMuted} />
      <ActivityIndicator color={colors.text} />
      {label ? <Text style={styles.hint}>{label}</Text> : null}
    </View>
  );
}

/** Estado vazio ou de erro, com ícone de Poké Ball e ação opcional. */
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <PokeballIcon size={40} color={colors.iconFaint} />
      <Text style={styles.emptyTitle} {...heading(2)}>
        {digitsInSystemFont(title)}
      </Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {action}
    </View>
  );
}

/** Na web, o sublinhado do link passa para os filhos em linha: em inline-block, o ícone fica sem ele. */
const LINK_ICON_BOX = WEB ? ({ display: 'inline-block' } as unknown as TextStyle) : null;

/**
 * Abre um endereço fora do app: no celular, no navegador do sistema por cima do app; na web, numa aba nova
 * (nunca em pop-up). Para links visíveis, prefira `ExternalLink`, que na web é um <a> de verdade.
 */
export function openExternal(url: string, browserOptions?: WebBrowser.WebBrowserOpenOptions) {
  if (WEB) {
    const tab = window.open(url, '_blank');
    if (tab) tab.opener = null;
    return;
  }
  WebBrowser.openBrowserAsync(url, browserOptions).catch(() => Linking.openURL(url).catch(() => {}));
}

/**
 * Link para fora do app (A1). Na web é um <a href target="_blank" rel="noopener noreferrer">: abre com o
 * teclado (Enter), aceita Ctrl+clique e "copiar link". No celular, abre no navegador do sistema.
 * - variant 'inline': dentro de um <Text> ("Preços do <ExternalLink>MYP Cards</ExternalLink> · 22/10").
 * - variant 'text' (padrão): link solto, com alvo de 48 px de altura.
 * - variant 'button': cápsula azul clara, como os botões "MYP Cards" do quadro de preço.
 * `tone="onBrand"`: branco sublinhado, sobre a barra preta do topo (A6).
 */
export function ExternalLink({
  href,
  children,
  variant = 'text',
  tone = 'default',
  arrow,
  accessibilityLabel,
  numberOfLines,
  style,
  containerStyle,
  browserOptions,
}: {
  href: string;
  children: ReactNode;
  variant?: 'inline' | 'text' | 'button';
  tone?: 'default' | 'onBrand' | 'muted';
  /** Acrescenta o ícone de "abre fora do app" (escondido do leitor de tela). */
  arrow?: boolean;
  accessibilityLabel?: string;
  numberOfLines?: number;
  /** Estilo do texto (cor, tamanho). */
  style?: StyleProp<TextStyle>;
  /** Posição e tamanho do link solto ou do botão (flex, margens); não vale no 'inline'. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Como o navegador do sistema abre no celular (ex.: voltar direto para a tela que abriu o link). */
  browserOptions?: WebBrowser.WebBrowserOpenOptions;
}) {
  const label = accessibilityLabel ?? (typeof children === 'string' ? children : undefined);
  const textStyle = [
    variant === 'button' ? styles.linkButtonText : styles.linkText,
    variant === 'text' && styles.linkBlockText,
    variant !== 'button' && tone === 'onBrand' && styles.linkOnBrand,
    variant !== 'button' && tone === 'muted' && styles.linkMuted,
  ];
  const content = (
    <>
      {children}
      {arrow ? (
        <Text aria-hidden style={[styles.linkArrow, LINK_ICON_BOX]}>
          {/* Sem `color`: o ícone herda a cor do link, em qualquer tom. */}
          {'\u00A0'}
          <Ionicons name="open-outline" size={typography.caption.fontSize} allowFontScaling />
        </Text>
      ) : null}
    </>
  );

  if (WEB) {
    const webLink = { href, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } } as unknown as TextProps;
    return (
      <Text
        {...webLink}
        role="link"
        accessibilityLabel={label}
        numberOfLines={numberOfLines}
        style={[textStyle, variant === 'text' && styles.linkBlock, variant === 'button' && styles.linkButton, variant !== 'inline' && containerStyle, style]}>
        {content}
      </Text>
    );
  }

  if (variant === 'inline') {
    return (
      <Text role="link" accessibilityLabel={label} onPress={() => openExternal(href, browserOptions)} style={[textStyle, style]}>
        {content}
      </Text>
    );
  }

  return (
    <Pressable
      onPress={() => openExternal(href, browserOptions)}
      role="link"
      accessibilityLabel={label}
      style={({ pressed }) => [variant === 'button' ? styles.linkButton : styles.linkBlock, containerStyle, pressed && { opacity: 0.6 }]}>
      <Text style={[textStyle, style]} numberOfLines={numberOfLines}>
        {content}
      </Text>
    </Pressable>
  );
}

/** Selo pequeno e neutro (idioma PT/EN/JP, "carta base", "Selo"); `tone` só quando a cor tem significado. */
export function Badge({
  label,
  tone = 'neutral',
  icon,
  accessibilityLabel,
}: {
  label: string;
  tone?: 'neutral' | 'special' | 'selected' | 'success' | 'warning' | 'danger';
  icon?: IconName;
  accessibilityLabel?: string;
}) {
  const t = BADGE[tone];
  return (
    <View
      style={[styles.badge, { backgroundColor: t.bg }]}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      // Na web, o nome numa div sem papel não é lido (lia-se "EN"): com o papel de imagem, lê-se "Inglês".
      role={WEB && accessibilityLabel ? 'img' : undefined}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const BADGE = {
  neutral: { bg: semantic.tag.bg, fg: semantic.tag.fg },
  special: { bg: semantic.special.fill, fg: semantic.special.onFill },
  selected: { bg: semantic.selected.bg, fg: semantic.selected.fg },
  success: { bg: semantic.success.bg, fg: semantic.success.fg },
  warning: { bg: semantic.warning.bg, fg: semantic.warning.fg },
  danger: { bg: semantic.danger.bg, fg: semantic.danger.fg },
};

/**
 * Linha de lista (AR4): miniatura à esquerda (ex.: CardImage de 40 × 56), título, linha de apoio e, à direita,
 * só o valor. Com `onPress`, a linha inteira é um botão com alvo de 56 px.
 */
export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      {left}
      <View style={styles.listBody}>
        <Text style={styles.listTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.listSubtitle} numberOfLines={1}>
            {withMarkIcons(subtitle, { size: typography.caption.fontSize, color: colors.textMuted })}
          </Text>
        ) : null}
      </View>
      {right}
    </>
  );
  if (!onPress) return <View style={styles.listRow}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityLabel={accessibilityLabel}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [styles.listRow, hovered && { backgroundColor: semantic.hover.onLight }, pressed && { opacity: 0.7 }];
      }}>
      {body}
    </Pressable>
  );
}

/**
 * Aviso em linha (A7): erro com papel 'alert' (anunciado na hora); informação e aviso como região "ao vivo"
 * educada, lida quando muda. Uma frase curta; para explicar mais, use uma InfoSheet.
 */
export function Notice({ tone = 'info', children, icon }: { tone?: 'info' | 'success' | 'warning' | 'danger'; children: ReactNode; icon?: IconName }) {
  const t = NOTICE[tone];
  const danger = tone === 'danger';
  // No celular, o erro é lido pelo anúncio (a região já entra preenchida e o TalkBack não a lê); sem a região "ao vivo"
  // junto, ele não é lido duas vezes quando muda.
  useAlertAnnouncement(danger ? plainText(children) : null);
  const live = danger ? (WEB ? 'assertive' : 'none') : 'polite';
  return (
    <View
      style={[styles.notice, { backgroundColor: t.bg }]}
      role={danger ? 'alert' : 'status'}
      aria-live={live === 'none' ? 'off' : live}
      accessibilityLiveRegion={live}>
      <Ionicons name={icon ?? t.icon} size={16} color={t.fg} style={styles.noticeIcon} />
      <Text style={[styles.noticeText, { color: tone === 'info' ? colors.textMuted : t.fg }]}>{children}</Text>
    </View>
  );
}

const NOTICE: Record<'info' | 'success' | 'warning' | 'danger', { bg: string; fg: string; icon: IconName }> = {
  info: { bg: colors.surfaceAlt, fg: colors.textMuted, icon: 'information-circle-outline' },
  success: { bg: semantic.success.bg, fg: semantic.success.fg, icon: 'checkmark-circle-outline' },
  warning: { bg: semantic.warning.bg, fg: semantic.warning.fg, icon: 'warning-outline' },
  danger: { bg: semantic.danger.bg, fg: semantic.danger.fg, icon: 'alert-circle-outline' },
};

export const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  // O Pressable não recorta os filhos: sem o raio próprio, o gradiente sairia pelas pontas da pílula.
  buttonFill: { borderRadius: radius.pill },
  buttonText: { fontFamily: font.display, fontSize: 16, lineHeight: 20, fontWeight: 'normal', letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    // Alvo de 48 também na largura: o chip "10" das páginas ficava com 44.
    minHeight: TOUCH,
    minWidth: TOUCH,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    // Um degrau acima do cartão e do preto: o chip aparece nos dois.
    backgroundColor: colors.surfaceAlt,
  },
  chipSelected: { borderColor: semantic.selected.border, backgroundColor: semantic.selected.bg },
  chipHint: { borderStyle: 'dashed', borderColor: colors.textMuted },
  chipHover: { borderColor: colors.borderStrong },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  chipTextSelected: { color: semantic.selected.fg },
  segmented: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, padding: 2, gap: 2 },
  // Seis opções em 296 de largura: 6 × 48 + 4 de trilho = 292.
  segmentedTight: { gap: 0 },
  segment: { flex: 1, minHeight: TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: semantic.selected.bg },
  segmentHover: { backgroundColor: semantic.hover.onLight },
  segmentText: { color: colors.textMuted, fontWeight: '700', fontSize: 14 },
  segmentTextOn: { color: semantic.selected.fg },
  section: { gap: 10, marginBottom: space.xl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  sectionTitle: { ...typography.heading, color: colors.heading },
  hint: { ...typography.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg },
  groupLabel: { ...typography.label, color: colors.textMuted, marginTop: space.sm, marginBottom: 10 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    color: colors.text,
    minHeight: TOUCH,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    paddingHorizontal: 4,
  },
  searchIcon: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 13, minWidth: 0 },
  // Sem o botão de limpar, o texto não encosta na curva da cápsula.
  searchInputEnd: { paddingRight: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.35 },
  stepValue: { color: colors.text, fontSize: 18, fontWeight: '700', minWidth: 36, textAlign: 'center', ...typography.tabular },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH },
  rowLabel: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  rowHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  toggleLabel: { flex: 1, minHeight: TOUCH, justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'transparent' },
  swatchBlends: { borderColor: colors.borderStrong },
  swatchActive: { borderColor: semantic.selected.border },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    backgroundColor: colors.backgroundTranslucent,
    // A barra é preta como o fundo: o fio é o que a separa da rolagem.
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  bottomInner: { width: '100%', gap: space.sm },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: space.xxxl },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: 40, paddingHorizontal: space.xl },
  emptyTitle: { ...typography.heading, color: colors.heading, textAlign: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 420 },
  linkText: { color: semantic.link.fg, fontWeight: '700', textDecorationLine: 'underline' },
  linkOnBrand: { color: semantic.link.onBrand },
  linkMuted: { color: colors.textMuted },
  linkArrow: { textDecorationLine: 'none' },
  // Link solto: 20 px de linha + 14 em cima e embaixo = 48 px de alvo, também na web (onde o hitSlop não vale).
  linkBlock: { paddingVertical: 14, alignSelf: 'flex-start' },
  linkBlockText: { fontSize: 14, lineHeight: 20 },
  linkButton: {
    minHeight: TOUCH,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: semantic.link.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButtonText: { color: semantic.link.fg, fontSize: 14, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm, borderRadius: radius.sm },
  listBody: { flex: 1, minWidth: 0 },
  listTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  listSubtitle: { ...typography.caption, color: colors.textMuted },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10 },
  noticeIcon: { marginTop: 1 },
  noticeText: { ...typography.caption, flex: 1 },
});
