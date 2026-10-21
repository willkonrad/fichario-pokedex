import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { LANG_LABEL, LANG_SHORT, type CardLang } from '@/lib/types';

/** Bandeira do idioma (desenhada: o Windows não mostra bandeiras em emoji). */
export function Flag({ lang, size = 18 }: { lang: CardLang; size?: number }) {
  const w = size * 1.5;
  return (
    <Svg width={w} height={size} viewBox="0 0 30 20">
      {lang === 'pt' ? (
        <>
          <Rect width="30" height="20" fill="#009C3B" />
          <Path d="M15 2.2 27.6 10 15 17.8 2.4 10Z" fill="#FFDF00" />
          <Circle cx="15" cy="10" r="4.6" fill="#002776" />
        </>
      ) : lang === 'en' ? (
        <>
          <Rect width="30" height="20" fill="#fff" />
          {[0, 2, 4, 6, 8, 10, 12].map((i) => (
            <Rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#B22234" />
          ))}
          <Rect width="13" height={(7 * 20) / 13} fill="#3C3B6E" />
        </>
      ) : (
        <>
          <Rect width="30" height="20" fill="#fff" />
          <Circle cx="15" cy="10" r="6" fill="#BC002D" />
        </>
      )}
    </Svg>
  );
}

/** Selo sobre a imagem da carta: em que idioma está a imagem mostrada (ex.: carta em português com imagem em inglês). */
export function ImageLangBadge({ lang }: { lang: CardLang }) {
  return (
    <View style={styles.badge} accessibilityLabel={`Imagem da carta em ${LANG_LABEL[lang].toLowerCase()}`}>
      <View style={styles.flag}>
        <Flag lang={lang} size={12} />
      </View>
      <Text style={styles.text}>{LANG_SHORT[lang]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  flag: { borderRadius: 2, overflow: 'hidden' },
  text: { color: '#fff', fontSize: 11, fontWeight: '900' },
});
