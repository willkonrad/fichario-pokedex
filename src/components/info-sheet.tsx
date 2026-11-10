import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { digitsInSystemFont } from '@/components/digits';
import { IconButton } from '@/components/icon-button';
import { NATIVE_DRIVER, useReducedMotion } from '@/components/motion';
import { useToastClearance } from '@/components/toast';
import { breakpoints, colors, elevation, radius, space, TOUCH, typography } from '@/theme';

const WEB = Platform.OS === 'web';

/**
 * Folha que sobe do rodapé com um título e um texto curto (U2): "Como calculamos o valor", explicações que
 * hoje são parágrafos na tela. No computador e no tablet abre como diálogo no centro. Fecha pelo X, tocando
 * fora, no voltar do Android e no Esc do navegador.
 */
export function InfoSheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Ações no fim (ex.: um link "Ver todas as fontes"). */
  footer?: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const centered = width >= breakpoints.tablet;
  return (
    // Na web, o próprio Modal é o diálogo (role="dialog", aria-modal): o nome vai nele.
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      aria-label={WEB ? title : undefined}>
      <SheetBody title={title} onClose={onClose} centered={centered} footer={footer}>
        {children}
      </SheetBody>
    </Modal>
  );
}

// Montado a cada abertura (o Modal só renderiza o conteúdo visível), então a entrada anima no mount.
function SheetBody({ title, onClose, centered, footer, children }: { title: string; onClose: () => void; centered: boolean; footer?: ReactNode; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: reduceMotion ? 0 : 220, useNativeDriver: NATIVE_DRIVER }).start();
  }, [enter, reduceMotion]);
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : centered ? 12 : 48, 0] });
  // Avisos (toast) acima das ações do rodapé da folha (ex.: "Colocar" ao adicionar várias cartas seguidas): a
  // distância da borda de baixo da tela até o topo do rodapé.
  const [sheetBox, setSheetBox] = useState<{ gap: number; left: number; right: number } | null>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  const padBottom = centered ? space.lg : insets.bottom + space.lg;
  useToastClearance(
    footer && sheetBox ? Math.ceil(sheetBox.gap + padBottom + footerHeight) : 0,
    sheetBox ? { left: sheetBox.left, right: sheetBox.right } : undefined,
  );

  return (
    <View style={[styles.root, centered ? styles.rootCentered : styles.rootBottom]}>
      {/* Tocar fora fecha; para o leitor de tela e o teclado, quem fecha é o X (e o gesto de escape do iOS, o Esc do
          navegador). Uma View, e não um Pressable: na web o Pressable sempre entra no Tab, e o foco da folha cairia
          neste fundo escondido (e o Enter a fecharia). */}
      <View style={styles.backdrop} aria-hidden onStartShouldSetResponder={() => true} onResponderRelease={onClose} />
      <Animated.View
        // Na web, o Modal já é o diálogo: a folha não repete o papel.
        role={WEB ? undefined : 'dialog'}
        aria-modal={WEB ? undefined : true}
        aria-label={WEB ? undefined : title}
        onAccessibilityEscape={onClose}
        onLayout={(e) => {
          const { x, y, width: w, height: h } = e.nativeEvent.layout;
          setSheetBox({ gap: Math.max(0, height - (y + h)), left: Math.floor(x), right: Math.ceil(x + w) });
        }}
        style={[
          styles.sheet,
          centered ? styles.sheetCentered : [styles.sheetBottom, { paddingBottom: insets.bottom + space.lg }],
          { maxHeight: height * (centered ? 0.8 : 0.88), transform: [{ translateY }] },
        ]}>
        {centered ? null : <View style={styles.grabber} aria-hidden />}
        <View style={styles.head}>
          <Text style={styles.title} role="heading" {...HEADING_LEVEL_2}>
            {digitsInSystemFont(title)}
          </Text>
          <IconButton icon="close" label="Fechar" onPress={onClose} color={colors.textMuted} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} bounces={false}>
          {children}
        </ScrollView>
        {footer ? (
          <View style={styles.footer} onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}>
            {footer}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/** Na web, o título vira <h2> (o React Native não tem aria-level nos tipos). */
const HEADING_LEVEL_2 = (WEB ? { 'aria-level': 2 } : {}) as object;

/** Parágrafo de texto da folha (curto: uma ou duas frases). */
export function InfoParagraph({ children }: { children: ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

/** Tópico da folha: um título curto em negrito e uma frase de explicação. */
export function InfoTopic({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.topic}>
      <Text style={styles.topicTitle}>{title}</Text>
      <Text style={styles.paragraph}>{children}</Text>
    </View>
  );
}

/** O ⓘ ao lado de um rótulo ("Valor ⓘ") que abre a folha; alvo de 48 px com ícone de 18. */
export function InfoButton({ label, onPress, color = colors.textMuted }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.infoButton, pressed && { opacity: 0.6 }]}>
      <Ionicons name="information-circle-outline" size={18} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootBottom: { justifyContent: 'flex-end' },
  rootCentered: { justifyContent: 'center', alignItems: 'center', padding: space.xl },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  // A sombra some no escuro: a borda é o que recorta a folha do fundo.
  sheet: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...elevation[2] },
  sheetBottom: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: space.sm,
  },
  sheetCentered: { width: '100%', maxWidth: 520, borderRadius: radius.lg, paddingTop: space.md, paddingBottom: space.lg },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: space.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.xl, paddingRight: space.sm },
  title: { ...typography.heading, color: colors.heading, flex: 1 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.xs, paddingBottom: space.sm, gap: space.md },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm },
  paragraph: { ...typography.body, color: colors.textMuted },
  topic: { gap: space.xxs },
  topicTitle: { ...typography.bodyStrong, color: colors.text },
  infoButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, marginVertical: -12 },
});
