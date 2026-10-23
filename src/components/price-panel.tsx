import * as WebBrowser from 'expo-web-browser';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ValueRangeRow } from '@/components/value-range';
import { formatBRL, formatBRLShort, formatWhen } from '@/lib/quotes';
import { VALUE_BASIS_LABEL, VARIANTS, type Entry, type ValueBasis } from '@/lib/types';
import { tcgplayerFor, tcgplayerReason } from '@/lib/tcgplayer';
import { CONFIDENCE_LABEL, mypApiFitsVariant, mypApiFor, mypCovers, valuation, type Confidence } from '@/lib/valuation';
import { colors, confidenceColors, radius, shadow } from '@/theme';

const CONFIDENCE_COLOR: Record<Confidence, string> = confidenceColors.light;
const MYP_URL = 'https://mypcards.com';

/**
 * Cartão de preço da carta: o valor é o mínimo, a média e o máximo do produto no MYP Cards (API pública) — ou, nas
 * cartas em inglês, da TCGplayer (EUA) em reais —, ou o "Meu valor" fixo; os do MYP aparecem como referência quando
 * não são o valor. Com o crédito e o link exigidos pelo MYP.
 */
export function PricePanel({
  entry,
  myValue,
  basis,
  onBasis,
  ligaUrl,
}: {
  /** Carta salva (os preços chegam depois de salvar). */
  entry?: Entry;
  /** "Meu valor" digitado agora na tela (ainda não salvo). */
  myValue?: number;
  /** Valor que entra na soma, escolhido agora na tela (mínimo, média ou máximo). */
  basis?: ValueBasis;
  onBasis?: (basis: ValueBasis) => void;
  /** Página da carta na LigaPokemon (só o link; o valor vem do MYP). */
  ligaUrl?: string;
}) {
  // Valor com o "Meu valor" e o valor escolhido agora na tela.
  const here = entry
    ? {
        ...entry,
        myValue: myValue != null ? { value: myValue, setAt: entry.myValue?.setAt ?? new Date().toISOString() } : undefined,
        valueBasis: basis ?? entry.valueBasis,
      }
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
  // Carta em inglês: TCGplayer (EUA), em reais pela PTAX.
  const english = entry.lang === 'en';
  const tcg = english ? tcgplayerFor(entry) : undefined;
  const versionLabel = VARIANTS.find((v) => v.id === entry.variant)?.label ?? entry.variant;
  const tone = ref?.confidence ? CONFIDENCE_COLOR[ref.confidence] : colors.textMuted;
  const qty = api?.qty != null ? ` · ${api.qty} un. à venda` : '';
  const usd = (n?: number) => (n != null ? `US$ ${n.toFixed(2).replace('.', ',')}` : '—');
  const subtitle =
    ref?.basis === 'manual'
      ? `meu valor · digitado por você (fixo até ${english ? 'o valor de mercado da TCGplayer' : 'a média do MYP'} passar dele)`
      : ref?.basis === 'tcgplayer' && tcg
        ? `${CONFIDENCE_LABEL[ref.confidence ?? 'media']} · TCGplayer (EUA), carta em inglês, todos os estados · mercado ${usd(tcg.usdMarket)} × PTAX ${tcg.fx?.toFixed(4).replace('.', ',') ?? '—'}${tcg.base ? ` · preço da carta base (a TCGplayer não vende a versão ${versionLabel} à parte)` : ''}`
        : apiFits && !english
          ? `${CONFIDENCE_LABEL.media} · anúncios no MYP Cards, todos os estados e idiomas${qty}`
          : english
            ? // Carta em inglês sem preço na TCGplayer (ou ainda buscando): o MYP, que mistura idiomas.
              `${CONFIDENCE_LABEL.baixa} · ${tcg ? `sem preço na TCGplayer (${tcgplayerReason(tcg.notFound)})` : 'buscando o preço na TCGplayer'}; ${apiFits ? 'anúncios no MYP Cards' : `preço da carta base no MYP Cards (o MYP não vende a versão ${versionLabel} à parte)`}, todos os idiomas${qty}`
            : // Versão especial que o MYP não vende à parte: preço da carta base (valor parecido).
              `${CONFIDENCE_LABEL.baixa} · preço da carta base no MYP Cards (o MYP não vende a versão ${versionLabel} à parte), todos os estados e idiomas${qty}`;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Valor da carta</Text>
      {ref?.range && (ref.basis === 'myp' || ref.basis === 'tcgplayer') ? (
        // Mínimo, média e máximo como a fonte informa; o escolhido (a média, por padrão) é o valor que entra na soma.
        <>
          <ValueRangeRow range={ref.range} emphasis={ref.pick} emphasisColor={tone} onSelect={onBasis} />
          {onBasis ? (
            <Text style={styles.detail}>
              Entra na soma: {ref.pick === 'avg' || !ref.pick ? 'a' : 'o'} {VALUE_BASIS_LABEL[ref.pick ?? 'avg']}. Toque em outro para
              trocar (o mínimo costuma ser o valor real de cartas novas; a média, o das antigas).
              {ref.basis === 'tcgplayer' ? ' Na TCGplayer: mínimo = menor anúncio, média = valor de mercado (vendas recentes), máximo = mediana dos anúncios.' : ''}
            </Text>
          ) : null}
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
          {english && !tcg
            ? 'Buscando o preço na TCGplayer (EUA)… chega em instantes.'
            : english && tcg?.notFound && !api?.avg
              ? api
                ? `Sem preço na TCGplayer (${tcgplayerReason(tcg.notFound)}) nem no MYP Cards${api.notFound ? ` (${api.notFound})` : ''}. Você pode preencher "Meu valor".`
                : Platform.OS === 'web'
                  ? `Sem preço na TCGplayer (${tcgplayerReason(tcg.notFound)}). O MYP Cards é consultado pelo app no celular; você pode preencher "Meu valor".`
                  : `Sem preço na TCGplayer (${tcgplayerReason(tcg.notFound)}); buscando no MYP Cards… chega em alguns minutos.`
              : !mypCovers(entry.lang)
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

      {/* Carta em inglês com "Meu valor": a TCGplayer, cujo valor de mercado apaga o "Meu valor", como referência. */}
      {tcg?.avg != null && ref?.basis !== 'tcgplayer' ? (
        <>
          <Pressable onPress={() => tcg.url && WebBrowser.openBrowserAsync(tcg.url)} accessibilityRole="link" disabled={!tcg.url}>
            <Text style={[styles.label, { marginTop: 6 }]}>
              TCGplayer (EUA) · referência{tcg.base ? ' · carta base' : ''}
              {tcg.url ? <Text style={styles.link}> ↗</Text> : null}
            </Text>
          </Pressable>
          <RefCells min={tcg.min} avg={tcg.avg} max={tcg.max} />
          <Text style={styles.detail}>
            mercado {usd(tcg.usdMarket)} × PTAX {tcg.fx?.toFixed(4).replace('.', ',') ?? '—'} · todos os estados juntos
          </Text>
        </>
      ) : null}

      {/* Com "Meu valor" ou numa carta em inglês (TCGplayer): mínimo, média e máximo do MYP só como referência. */}
      {api?.avg != null && ref?.basis !== 'myp' ? (
        <>
          <Pressable onPress={() => api.url && WebBrowser.openBrowserAsync(api.url)} accessibilityRole="link" disabled={!api.url}>
            <Text style={[styles.label, { marginTop: 6 }]}>
              MYP Cards{english ? ' · referência, todos os idiomas' : ''}
              {api.ownVersion ? ` · ${versionLabel.toLowerCase()}` : apiFits ? '' : ' · carta base'}
              {api.url ? <Text style={styles.link}> ↗</Text> : null}
            </Text>
          </Pressable>
          <RefCells min={api.min} avg={api.avg} max={api.max} />
          <Text style={styles.detail}>
            {api.qty != null ? `${api.qty} un. à venda · ` : ''}todos os estados e idiomas juntos
          </Text>
        </>
      ) : null}

      {tcg?.url ? (
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync(tcg.url!)}
          style={({ pressed }) => [styles.storeButton, styles.tcgButton, pressed && { opacity: 0.8 }]}
          accessibilityRole="link"
          accessibilityLabel="Ver a carta na TCGplayer">
          <Text style={styles.storeButtonText}>TCGplayer ↗</Text>
        </Pressable>
      ) : null}
      <StoreLinks mypUrl={api?.url ?? MYP_URL} ligaUrl={ligaUrl} />

      {tcg && !tcg.notFound ? (
        <Text style={styles.source}>
          Preços da TCGplayer (EUA), via{' '}
          <Text style={styles.sourceLink} accessibilityRole="link" onPress={() => WebBrowser.openBrowserAsync('https://tcgcsv.com')}>
            TCGCSV
          </Text>
          {tcg.builtAt ? ` de ${formatWhen(tcg.builtAt)}` : ''} · câmbio PTAX do Banco Central{tcg.fxDay ? ` de ${tcg.fxDay.split('-').reverse().slice(0, 2).join('/')}` : ''}
        </Text>
      ) : null}
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

/** Mínimo, média e máximo de uma fonte que não é o valor da carta (só referência). */
function RefCells({ min, avg, max }: { min?: number; avg?: number; max?: number }) {
  return (
    <View style={styles.cells}>
      {(
        [
          ['Mín', min],
          ['Média', avg],
          ['Máx', max],
        ] as const
      ).map(([label, v]) => (
        <View key={label} style={styles.cell} accessibilityLabel={`${label}: ${v != null ? formatBRL(v) : 'sem valor'}`}>
          <Text style={styles.cellId}>{label}</Text>
          <Text style={styles.cellValue} numberOfLines={1}>
            {v != null ? formatBRLShort(v) : '—'}
          </Text>
        </View>
      ))}
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
  tcgButton: { flex: 0, marginTop: 4 },
  source: { color: colors.textFaint, fontSize: 11, lineHeight: 15 },
  sourceLink: { color: colors.blue, fontWeight: '700', textDecorationLine: 'underline' },
});
