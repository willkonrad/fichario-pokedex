import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { IconButton, type PressState } from '@/components/icon-button';
import { brandGradient, colors, font, radius, semantic, space, TOUCH, typography } from '@/theme';

const WEB = Platform.OS === 'web';
/** "Pág. 113 de 114" só quebra entre o número da página e o total. */
const NBSP = ' ';
/** A fonte do sistema cresce só até aqui: a altura da base entra na conta da folha. */
const MAX_FONT_SCALE = 1.2;
const ADD_ICON = 20;
/** Largura que não muda com a fonte: margens, três botões redondos, quatro vãos e a pílula sem a palavra. */
const DOCK_FIXED = space.sm * 2 + TOUCH * 3 + space.sm * 4 + space.md + ADD_ICON + space.xs + space.lg;
/** Largura de "Pág. 113" e "Carta" na fonte normal: sem esse espaço, a pílula fica só com o "+". */
const DOCK_TEXT = 110;

/** Altura da base fixa do celular, sem a área segura: alvo de toque, respiro e a borda de cima. */
export const DOCK_HEIGHT = TOUCH + space.sm * 2 + 1;

/** "+ Carta": a pílula vermelha da ação principal (barra do computador e base do celular). */
export function AddCardPill({ onPress, iconOnly = false }: { onPress: () => void; iconOnly?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityLabel="Adicionar carta"
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [styles.add, iconOnly && styles.addIconOnly, hovered && { backgroundColor: colors.primaryDark }, pressed && { opacity: 0.8 }];
      }}>
      {(s) => (
        <>
          {/* Com o mouse por cima, o gradiente sai e fica o vermelho mais escuro do fundo. */}
          {(s as PressState).hovered ? null : <LinearGradient colors={brandGradient} style={[StyleSheet.absoluteFill, styles.addFill]} pointerEvents="none" />}
          <Ionicons name="add" size={ADD_ICON} color={colors.onPrimary} />
          {iconOnly ? null : (
            <Text style={styles.addText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Carta
            </Text>
          )}
        </>
      )}
    </Pressable>
  );
}

/**
 * Base fixa do celular e do tablet: página anterior, "Pág. 1 de 114" (tocar abre "Ir para a página"), próxima página,
 * "Próxima falta" (só ícone) e a pílula "+ Carta". A página nova é anunciada pelo leitor de tela (A7).
 */
export function HomeDock({
  label,
  pages,
  detail,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onGoTo,
  onNextEmpty,
  nextEmptyLabel,
  onAdd,
  bottomInset,
}: {
  /** "Pág. 13". */
  label: string;
  pages: number;
  /** Faixa e preenchimento, lidos pelo leitor de tela. */
  detail?: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: () => void;
  onNextEmpty: () => void;
  /** "Próxima falta" (Pokédex) ou "Próximo vazio" (fichário livre). */
  nextEmptyLabel: string;
  onAdd: () => void;
  bottomInset: number;
}) {
  const { width, fontScale } = useWindowDimensions();
  const iconOnly = width < DOCK_FIXED + DOCK_TEXT * Math.min(Math.max(fontScale, 1), MAX_FONT_SCALE);
  return (
    <View style={[styles.dock, { paddingBottom: space.sm + bottomInset }]}>
      <IconButton icon="chevron-back" label="Página anterior" onPress={onPrev} disabled={!canPrev} size={22} tone="soft" style={styles.round} />
      <Pressable
        onPress={onGoTo}
        role="button"
        accessibilityLabel={`${label} de ${pages}${detail ? `, ${detail}` : ''}. Ir para outra página`}
        style={(s) => {
          const { pressed, hovered } = s as PressState;
          return [styles.mid, hovered && styles.midHover, pressed && { opacity: 0.7 }];
        }}>
        {/* Região "ao vivo": a página nova é lida ao folhear (Android e web; o iOS anuncia à parte). */}
        <Text
          style={styles.title}
          numberOfLines={2}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          aria-live={WEB ? 'polite' : undefined}
          accessibilityLiveRegion="polite">
          {label.replace(' ', NBSP)}{' '}
          <Text style={styles.of}>
            de{NBSP}
            {pages}
          </Text>
        </Text>
      </Pressable>
      <IconButton icon="chevron-forward" label="Próxima página" onPress={onNext} disabled={!canNext} size={22} tone="soft" style={styles.round} />
      <IconButton
        icon="play-skip-forward-outline"
        label={`Ir para: ${nextEmptyLabel.toLowerCase()}`}
        onPress={onNextEmpty}
        size={20}
        tone="soft"
        style={styles.round}
      />
      <AddCardPill onPress={onAdd} iconOnly={iconOnly} />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
    paddingHorizontal: space.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  round: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  mid: { flex: 1, minWidth: 0, height: TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  midHover: { backgroundColor: semantic.hover.onLight },
  title: { color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '800', textAlign: 'center', ...typography.tabular },
  of: { color: colors.textMuted, fontWeight: '600' },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: TOUCH,
    paddingLeft: space.md,
    paddingRight: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryAction,
  },
  addIconOnly: { width: TOUCH, paddingLeft: 0, paddingRight: 0, justifyContent: 'center' },
  addFill: { borderRadius: radius.pill },
  addText: { color: colors.onPrimary, fontFamily: font.display, fontSize: 15, fontWeight: 'normal', textTransform: 'uppercase' },
});
