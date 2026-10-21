import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, radius, shadow } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Botão em pílula, no estilo Nintendo: vermelho cheio (principal), branco com borda (secundário) ou só texto. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  /** Mostra o carregando no lugar do ícone e bloqueia o toque. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const v = BUTTON[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border },
        variant === 'primary' && styles.buttonShadow,
        (disabled || busy) && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
        style,
      ]}>
      {busy ? <ActivityIndicator color={v.fg} size="small" /> : icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
      <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>
    </Pressable>
  );
}

const BUTTON = {
  primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
  secondary: { bg: colors.surface, fg: colors.text, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  danger: { bg: colors.surface, fg: colors.danger, border: 'rgba(217, 48, 37, 0.35)' },
};

/** Opção selecionável (estado, variação, idioma…): selecionada fica vermelha. */
export function Chip({
  label,
  selected,
  onPress,
  hint,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Destaque tracejado (ex.: variação que existe para a carta). */
  hint?: boolean;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, hint && !selected && styles.chipHint, pressed && { opacity: 0.8 }]}>
      {icon ? <Ionicons name={icon} size={15} color={selected ? colors.onPrimary : colors.textMuted} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
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
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="radio"
            accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
            accessibilityState={{ checked: selected }}
            style={({ pressed }) => [styles.segment, selected && styles.segmentOn, pressed && !selected && { opacity: 0.7 }]}>
            <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bloco com título e explicação curta. */
export function Section({ title, hint, children, right }: { title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

/** Cartão branco com sombra leve. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Rótulo pequeno em maiúsculas, para separar grupos de uma tela. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.groupLabel}>{children}</Text>;
}

/** Campo de texto; em foco, a borda fica vermelha (no lugar do contorno padrão do navegador). */
export function Input(props: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.textFaint}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      style={[styles.input, NO_OUTLINE, focused && { borderColor: colors.primary }, props.style]}
    />
  );
}

/** Sem o contorno de foco do navegador (o foco é mostrado pela borda). */
const NO_OUTLINE = Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none' } as unknown as ViewStyle) : null;

/** Campo de busca em cápsula, com lupa (toque = buscar) e botão de limpar. */
export function SearchField({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  label,
  icon = 'search',
  autoFocus,
  style,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSubmit?: () => void;
  placeholder: string;
  label: string;
  icon?: 'search' | 'filter';
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.searchField, focused && { borderColor: colors.primary }, style]}>
      <Pressable onPress={onSubmit} disabled={!onSubmit} hitSlop={10} accessibilityRole="button" accessibilityLabel="Buscar">
        <Ionicons name={icon} size={18} color={focused ? colors.primary : colors.textMuted} />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={[styles.searchInput, NO_OUTLINE]}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        accessibilityLabel={label}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Limpar">
          <Ionicons name="close-circle" size={18} color={colors.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

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
  /** Nome lido pelo leitor de tela (ex.: "Linhas"). */
  label?: string;
}) {
  return (
    <View style={styles.stepper} accessibilityLabel={label}>
      <Pressable
        style={[styles.stepBtn, value <= min && styles.stepBtnOff]}
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel={label ? `Diminuir ${label}` : 'Diminuir'}>
        <Ionicons name="remove" size={20} color={colors.text} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable
        style={[styles.stepBtn, value >= max && styles.stepBtnOff]}
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        accessibilityRole="button"
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

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label} hint={hint}>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.surfaceAlt }}
        thumbColor="#fff"
        accessibilityLabel={label}
      />
    </Row>
  );
}

/** Cores de capa, com nome para o leitor de tela. */
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

/** Cor do texto sobre uma capa: escuro nas cores claras (amarelo), branco nas outras. */
export function onCover(color: string) {
  const hex = color.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#16181D' : '#FFFFFF';
}

export function ColorPicker({ value, onChange }: { value?: string; onChange: (c: string) => void }) {
  return (
    <View style={styles.wrap}>
      {COVER_COLORS.map(({ color, name }) => {
        const active = value === color;
        return (
          <Pressable
            key={color}
            onPress={() => onChange(color)}
            style={[styles.swatch, { backgroundColor: color }, active && styles.swatchActive]}
            accessibilityRole="button"
            accessibilityLabel={name}
            accessibilityState={{ selected: active }}>
            {active ? <Ionicons name="checkmark" size={18} color={onCover(color)} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Barra fixa no rodapé com a ação principal da tela (respeita a área segura do aparelho). */
export function BottomBar({ children, bottomInset }: { children: ReactNode; bottomInset: number }) {
  return (
    <View style={[styles.bottomBar, { paddingBottom: 12 + bottomInset }]}>
      <View style={styles.bottomInner}>{children}</View>
    </View>
  );
}

/** Altura a reservar no fim da rolagem para a barra fixa não cobrir o conteúdo. */
export const BOTTOM_BAR_SPACE = 100;

/** Carregando: Poké Ball com o indicador do sistema embaixo. */
export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading} accessibilityLabel={label ?? 'Carregando'}>
      <MaterialCommunityIcons name="pokeball" size={30} color={colors.primary} />
      <ActivityIndicator color={colors.primary} />
      {label ? <Text style={styles.hint}>{label}</Text> : null}
    </View>
  );
}

/** Estado vazio ou de erro, com ícone de Poké Ball e ação opcional. */
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name="pokeball" size={40} color={colors.textFaint} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {action}
    </View>
  );
}

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
  buttonShadow: { ...shadow },
  buttonText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipHint: { borderStyle: 'dashed', borderColor: colors.textMuted },
  chipText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  chipTextSelected: { color: colors.onPrimary },
  segmented: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.primary, ...shadow },
  segmentText: { color: colors.textMuted, fontWeight: '800', fontSize: 14 },
  segmentTextOn: { color: colors.onPrimary },
  section: { gap: 10, marginBottom: 24 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, ...shadow },
  groupLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 8, marginBottom: 10 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.surface,
    paddingHorizontal: 16,
    ...shadow,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 13, minWidth: 0 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.35 },
  stepValue: { color: colors.text, fontSize: 18, fontWeight: '800', minWidth: 36, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowHint: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'transparent' },
  swatchActive: { borderColor: colors.surface, outlineColor: colors.text, outlineWidth: 2, outlineStyle: 'solid' },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(241, 242, 246, 0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  bottomInner: { width: '100%', maxWidth: 680, gap: 8 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 48 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 420 },
});
