import * as WebBrowser from 'expo-web-browser';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ValueRangeRow } from '@/components/value-range';
import { formatBRL, formatBRLShort, formatWhen } from '@/lib/quotes';
import { VARIANTS, type Entry } from '@/lib/types';
import { CONFIDENCE_LABEL, mypApiFitsVariant, mypApiFor, mypCovers, valuation, type Confidence } from '@/lib/valuation';
import { colors, confidenceColors, radius, shadow } from '@/theme';

const CONFIDENCE_COLOR: Record<Confidence, string> = confidenceColors.light;
const MYP_URL = 'https://mypcards.com';

/**
 * Cartão de preço da carta: o valor é o mínimo, a média e o máximo do produto no MYP Cards (API pública), ou o "Meu
 * valor" fixo (aí os do MYP aparecem como referência), com o crédito e o link exigidos pelo MYP.
 */
export function PricePanel({
  entry,
  myValue,
  ligaUrl,
}: {
  /** Carta salva (os preços chegam depois de salvar). */
  entry?: Entry;
  /** "Meu valor" digitado agora na tela (ainda não salvo). */
  myValue?: number;
  /** Página da carta na LigaPokemon (só o link; o valor vem do MYP). */
  ligaUrl?: string;
}) {
  // Valor com o "Meu valor" digitado agora na tela.
  const here = entry
    ? { ...entry, myValue: myValue != null ? { value: myValue, setAt: entry.myValue?.setAt ?? new Date().toISOString() } : undefined }
    : undefined;
  const ref = here ? valuation(here) : undefined;

  if (!entry) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Valor da carta</Text>
        <Text style={styles.muted}>Depois de colocar a carta no fichário, o preço chega em alguns minutos.</Text>
        <StoreLinks mypUrl={MYP_URL} ligaUrl={ligaUrl} />
      </View>
    );
  }

  // Mínimo/média/máximo do produto no MYP (API pública), desta carta, versão e selo.
  const api = mypApiFor(entry);
  const apiFits = !!api && mypApiFitsVariant(entry, api);
  const versionLabel = VARIANTS.find((v) => v.id === entry.variant)?.label ?? entry.variant;
  const tone = ref?.confidence ? CONFIDENCE_COLOR[ref.confidence] : colors.textMuted;
  const qty = api?.qty != null ? ` · ${api.qty} un. à venda` : '';
  const subtitle =
    ref?.basis === 'manual'
      ? 'meu valor · digitado por você (fixo até a média do MYP passar dele)'
      : apiFits
        ? `${CONFIDENCE_LABEL.media} · anúncios no MYP Cards, todos os estados e idiomas${qty}`
        : // Versão especial que o MYP não vende à parte: preço da carta base (valor parecido).
          `${CONFIDENCE_LABEL.baixa} · preço da carta base no MYP Cards (o MYP não vende a versão ${versionLabel} à parte), todos os estados e idiomas${qty}`;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Valor da carta</Text>
      {ref?.range && ref.basis === 'myp' ? (
        // O valor é a faixa do MYP: mínimo, média e máximo, como a API informa.
        <>
          <View style={styles.rangeBox}>
            <ValueRangeRow range={ref.range} avgColor={tone} />
          </View>
          <View style={styles.confRow}>
            <View style={[styles.confDot, { backgroundColor: tone }]} />
            <Text style={styles.mainSource}>{subtitle}</Text>
          </View>
        </>
      ) : ref?.value != null ? (
        <>
          <Text style={[styles.main, { color: tone }]}>{formatBRL(ref.value)}</Text>
          <View style={styles.confRow}>
            <View style={[styles.confDot, { backgroundColor: tone }]} />
            <Text style={styles.mainSource}>{subtitle}</Text>
          </View>
        </>
      ) : (
        <Text style={styles.muted}>
          {!mypCovers(entry.lang)
            ? 'O MYP Cards não tem preço de cartas japonesas. Preencha "Meu valor" com o valor que você conferiu.'
            : !api
              ? Platform.OS === 'web'
                ? 'Os preços do MYP Cards são buscados pelo app no celular (sem token, a API do MYP não atende navegadores). Abra o app no celular para atualizar.'
                : 'Buscando o preço no MYP Cards… chega em alguns minutos.'
              : api.notFound
                ? `Não achei esta carta no MYP Cards (${api.notFound}). Você pode preencher "Meu valor".`
                : 'Sem anúncios desta carta no MYP Cards agora. Você pode preencher "Meu valor".'}
        </Text>
      )}

      {/* Com "Meu valor": mínimo, média e máximo do MYP só como referência. */}
      {api?.avg != null && ref?.basis !== 'myp' ? (
        <>
          <Pressable onPress={() => api.url && WebBrowser.openBrowserAsync(api.url)} accessibilityRole="link" disabled={!api.url}>
            <Text style={[styles.label, { marginTop: 6 }]}>
              MYP Cards{api.ownVersion ? ` · ${versionLabel.toLowerCase()}` : apiFits ? '' : ' · carta base'}
              {api.url ? <Text style={styles.link}> ↗</Text> : null}
            </Text>
          </Pressable>
          <View style={styles.cells}>
            {(
              [
                ['Mín', api.min],
                ['Média', api.avg],
                ['Máx', api.max],
              ] as const
            ).map(([label, v]) => (
              <View key={label} style={styles.cell} accessibilityLabel={`${label}: ${formatBRL(v)}`}>
                <Text style={styles.cellId}>{label}</Text>
                <Text style={styles.cellValue} numberOfLines={1}>
                  {v != null ? formatBRLShort(v) : '—'}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.detail}>
            {api.qty != null ? `${api.qty} un. à venda · ` : ''}todos os estados e idiomas juntos
          </Text>
        </>
      ) : null}

      <StoreLinks mypUrl={api?.url ?? MYP_URL} ligaUrl={ligaUrl} />

      <Text style={styles.source}>
        Preços do{' '}
        <Text style={styles.sourceLink} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync(MYP_URL)}>
          MYP Cards
        </Text>
        {api?.checkedAt ? ` · atualizado em ${formatWhen(api.checkedAt)}` : ''}
      </Text>
    </View>
  );
}

/** Botões para ver a carta nas lojas: anúncios no MYP Cards (fonte do valor) e na LigaPokemon. */
function StoreLinks({ mypUrl, ligaUrl }: { mypUrl: string; ligaUrl?: string }) {
  return (
    <View style={styles.storeRow}>
      <Pressable
        onPress={() => WebBrowser.openBrowserAsync(mypUrl)}
        style={({ pressed }) => [styles.storeButton, pressed && { opacity: 0.8 }]}
        accessibilityRole="link"
        accessibilityLabel="Ver anúncios da carta no MYP Cards">
        <Text style={styles.storeButtonText} numberOfLines={1}>
          MYP Cards ↗
        </Text>
      </Pressable>
      {ligaUrl ? (
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync(ligaUrl)}
          style={({ pressed }) => [styles.storeButton, pressed && { opacity: 0.8 }]}
          accessibilityRole="link"
          accessibilityLabel="Ver a carta na Liga Pokémon">
          <Text style={styles.storeButtonText} numberOfLines={1}>
            Liga Pokémon ↗
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, gap: 8, ...shadow },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  main: { color: colors.success, fontSize: 34, fontWeight: '900' },
  mainSource: { color: colors.textMuted, fontSize: 12, marginTop: -4 },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -2 },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  link: { color: colors.blue, fontSize: 13 },
  detail: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  cells: { flexDirection: 'row', gap: 4, marginTop: 2 },
  cell: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 5,
    alignItems: 'center',
  },
  rangeBox: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 4, marginTop: 2 },
  cellId: { color: colors.textMuted, fontSize: 11, fontWeight: '900' },
  cellValue: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 1 },
  storeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  storeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 42,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(47, 91, 211, 0.08)',
    flex: 1,
    paddingHorizontal: 8,
  },
  storeButtonText: { color: colors.blue, fontSize: 13, fontWeight: '800', flexShrink: 1 },
  source: { color: colors.textFaint, fontSize: 11, lineHeight: 15 },
  sourceLink: { color: colors.blue, fontWeight: '700', textDecorationLine: 'underline' },
});
