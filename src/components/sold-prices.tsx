import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatBRL } from '@/lib/quotes';
import { CONDITIONS, LANG_LABEL, type CardLang, type Condition, type MypInfo, type SoldInfo } from '@/lib/types';
import { colors, radius } from '@/theme';

/**
 * Valor de VENDAS REAIS da carta no idioma dela, por estado, do "Quanto vale minha carta?"
 * (mediana de vendas finalizadas no Brasil). Sem vendas no estado da carta, mostra o menor anúncio
 * no MYP Cards (via Zukan) como referência. Sempre cita a fonte.
 */
export function SoldPrices({
  sold,
  myp,
  condition,
  lang,
  saved,
}: {
  sold?: SoldInfo;
  myp?: MypInfo;
  condition: Condition;
  lang: CardLang;
  /** A carta já está no fichário (o servidor só busca cartas salvas). */
  saved: boolean;
}) {
  if (!sold && !myp) {
    return (
      <View style={styles.box}>
        <Text style={styles.muted}>
          {saved
            ? 'Buscando vendas reais desta carta… chega em até algumas horas.'
            : 'Depois de colocar a carta no fichário, o app busca as vendas reais dela no seu idioma e estado.'}
        </Text>
      </View>
    );
  }

  const mine = sold?.byCondition?.[condition];
  const lowConfidence = !!sold?.lowConfidence && (mine?.count ?? 0) < 3;
  const langName = LANG_LABEL[lang].toLowerCase();

  return (
    <View style={styles.box}>
      {mine?.value != null ? (
        <>
          <Text style={styles.value}>{formatBRL(mine.value)}</Text>
          <Text style={styles.caption}>
            Mediana de {mine.count} {mine.count === 1 ? 'venda real' : 'vendas reais'} em {condition}, em {langName}
            {sold?.variant && sold.variants && sold.variants.length > 1 ? ` · variante ${sold.variant}` : ''}
          </Text>
          {lowConfidence ? (
            <View style={styles.warn}>
              <Ionicons name="alert-circle-outline" size={14} color={colors.gold} />
              <Text style={styles.warnText}>Poucas vendas: trate como referência inicial.</Text>
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.caption}>
          {sold?.notFound
            ? 'Esta carta ainda não aparece no site de vendas reais.'
            : `Sem vendas registradas em ${condition} em ${langName}.`}
        </Text>
      )}

      {/* Valor por estado, para comparar (o estado da carta fica destacado). */}
      {sold?.byCondition && Object.values(sold.byCondition).some((c) => c?.value != null) ? (
        <View style={styles.conds}>
          {CONDITIONS.map(({ id }) => {
            const c = sold.byCondition?.[id];
            if (!c) return null;
            const active = id === condition;
            return (
              <View key={id} style={[styles.cond, active && styles.condActive]}>
                <Text style={[styles.condId, active && { color: colors.accent }]}>{id}</Text>
                <Text style={styles.condValue}>{c.value != null ? formatBRL(c.value) : '—'}</Text>
                <Text style={styles.condCount}>{c.value != null ? `${c.count} ${c.count === 1 ? 'venda' : 'vendas'}` : 'sem vendas'}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {sold?.lastSale ? (
        <Text style={styles.line}>
          Última venda: {formatBRL(sold.lastSale.price)}, há {sold.lastSale.daysAgo} {sold.lastSale.daysAgo === 1 ? 'dia' : 'dias'}
        </Text>
      ) : null}

      {mine?.value == null && myp?.price != null ? (
        <Text style={styles.line}>
          Referência: {myp.label ?? 'menor anúncio no MYP Cards'}: <Text style={styles.strong}>{formatBRL(myp.price)}</Text>
        </Text>
      ) : null}

      <Text style={styles.source}>
        Fonte: Quanto vale minha carta? (vendas reais finalizadas, não anúncios)
        {myp?.price != null ? ' · MYP Cards via Zukan' : ''}
      </Text>
      {sold?.url ? (
        <Pressable style={styles.link} onPress={() => WebBrowser.openBrowserAsync(sold.url!)} accessibilityRole="link">
          <Text style={styles.linkText}>Ver vendas no Quanto vale minha carta?</Text>
          <Ionicons name="open-outline" size={14} color={colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  value: { color: colors.success, fontSize: 26, fontWeight: '800' },
  caption: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warnText: { color: colors.gold, fontSize: 12, flex: 1 },
  conds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  cond: {
    minWidth: 72,
    flexGrow: 1,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  condActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  condId: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
  condValue: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 1 },
  condCount: { color: colors.textFaint, fontSize: 10, marginTop: 1 },
  line: { color: colors.textMuted, fontSize: 13 },
  strong: { color: colors.text, fontWeight: '700' },
  source: { color: colors.textFaint, fontSize: 11, lineHeight: 15 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  linkText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
});
