import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { PressState } from '@/components/icon-button';
import { LineChart } from '@/components/line-chart';
import { ExternalLink, InfoButton, InfoSheet, InfoTopic, Notice } from '@/components/ui';
import { ValueRangeRow } from '@/components/value-range';
import {
  changeText,
  HOW_WE_CALCULATE,
  MY_VALUE_BELOW_US,
  myValueBelowText,
  MYP_URL,
  offersText,
  SET_MY_VALUE,
  SOURCE_NAME,
  TCGCSV_URL,
  TCGPLAYER_URL,
  usdConversionText,
  USE_MY_VALUE,
  usPriceGapText,
  VALUE_SCOPE,
  valueMark,
} from '@/lib/copy';
import { formatBRL, formatBRLTight, formatDay, formatWhen } from '@/lib/format';
import { dayTime, entryHistory, entrySeries, type EntryHistoryPoint } from '@/lib/history';
import { tcgplayerColumns, tcgplayerFor, tcgplayerReason } from '@/lib/tcgplayer';
import { VARIANTS, type Entry, type MypApiPrice, type TcgplayerPrice, type ValueBasis } from '@/lib/types';
import { myValueBelowSource, mypApiFitsVariant, mypApiFor, mypCovers, pickLabel, rangeSource, usPriceGap, valuation } from '@/lib/valuation';
import { colors, radius, semantic, shadow, space, TOUCH, typography } from '@/theme';

const WEB = Platform.OS === 'web';
/** Título do quadro para o leitor de tela; na web, <h2> (sem o nível, o react-native-web faz <h1>, e o <h1> é o nome da carta). */
const HEADING_2 = { role: 'heading' as const, ...((WEB ? { 'aria-level': 2 } : {}) as object) };

/**
 * Quadro de preço da carta (V4), em três camadas: o valor (mínimo, média e máximo da fonte, com o que entra na soma em
 * destaque, ou o "Meu valor"); uma linha de origem; e, recolhidos, os detalhes da cotação e o histórico. Um link por
 * loja (MYP Cards, TCGplayer, Liga), com a atribuição ao MYP Cards sempre presente. O app não estima preço.
 */
export function PricePanel({
  entry,
  myValue,
  basis,
  onBasis,
  ligaUrl,
  onSetMyValue,
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
  /** "✎ Definir meu valor": leva ao campo "Meu valor" (V8). */
  onSetMyValue?: () => void;
}) {
  const [howOpen, setHowOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useEntryHistory(entry);

  const head = (showSetMyValue: boolean) => (
    <View style={styles.head}>
      <Text style={styles.label} {...HEADING_2}>
        {VALUE_SCOPE.card}
      </Text>
      <InfoButton label="Como calculamos o valor" onPress={() => setHowOpen(true)} />
      <View style={styles.flex} />
      {showSetMyValue && onSetMyValue ? <TextAction label={SET_MY_VALUE} accessibilityLabel="Definir meu valor" onPress={onSetMyValue} /> : null}
    </View>
  );
  const howSheet = <HowWeCalculate visible={howOpen} onClose={() => setHowOpen(false)} />;

  if (!entry) {
    return (
      <View style={styles.card}>
        {head(false)}
        <Text style={styles.muted}>O preço chega alguns minutos depois de colocar a carta.</Text>
        <StoreLinks mypUrl={MYP_URL} ligaUrl={ligaUrl} />
        {howSheet}
      </View>
    );
  }

  // Valor com o "Meu valor" e o valor escolhido agora na tela.
  const here: Entry = {
    ...entry,
    myValue: myValue != null ? { value: myValue, setAt: entry.myValue?.value === myValue ? entry.myValue.setAt : '' } : undefined,
    valueBasis: basis ?? entry.valueBasis,
  };
  const ref = valuation(here);
  const source = rangeSource(ref);
  const mark = valueMark(ref);
  // Mínimo/média/máximo do produto no MYP (API pública), desta carta, versão e selo.
  const api = mypApiFor(entry);
  const apiFits = !!api && mypApiFitsVariant(entry, api);
  // Carta em inglês: TCGplayer (EUA), em reais pela PTAX.
  const english = entry.lang === 'en';
  const tcg = english ? tcgplayerFor(entry) : undefined;
  const versionLabel = (VARIANTS.find((v) => v.id === entry.variant)?.label ?? entry.variant).toLowerCase();
  // Preço dos EUA longe dos anúncios daqui (V7): explica a diferença, sem mudar a fonte. O atalho "Usar meu valor" só
  // quando o preço daqui é maior (um "Meu valor" abaixo do mercado seria trocado na próxima cópia da TCGplayer).
  const gap = usPriceGap(here, ref);
  const gapMyValue = !!gap && gap.ratio < 1;

  let main: ReactNode;
  if (ref.range && source) {
    const when = source === 'tcgplayer' ? (tcg?.builtAt ?? tcg?.checkedAt) : api?.checkedAt;
    const origin = [pickLabel(ref), source === 'myp' && api?.qty != null ? offersText(api.qty) : null, when ? formatDay(when) : null].filter(Boolean).join(' · ');
    // Na TCGplayer, sem as colunas que seriam o próprio mercado com outro nome (mediana abaixo do mercado…).
    const columns = source === 'tcgplayer' && tcg ? tcgplayerColumns(tcg) : undefined;
    main = (
      <>
        <ValueRangeRow range={ref.range} emphasis={ref.pick} source={source} onSelect={onBasis} columns={columns} />
        <Text style={styles.origin}>{origin}</Text>
        {mark.mark === '≈' ? (
          <Text style={styles.origin}>
            {mark.mark} {mark.label} · {mark.reason}
          </Text>
        ) : null}
      </>
    );
  } else if (ref.value != null) {
    const setAt = here.myValue?.setAt;
    // Abaixo da média da fonte, o "Meu valor" é apagado na próxima atualização do preço: avisa antes.
    const below = myValueBelowSource(here);
    main = (
      <>
        <Text style={styles.main} accessibilityLabel={`${SOURCE_NAME.manual}: ${formatBRL(ref.value)}`}>
          {mark.mark ? `${mark.mark} ` : ''}
          {formatBRL(ref.value)}
        </Text>
        <Text style={styles.origin}>
          {SOURCE_NAME.manual}
          {setAt ? ` · digitado em ${formatDay(setAt)}` : ''} · vale até o mercado passar dele
        </Text>
        {below ? <Notice tone="warning">{myValueBelowText(below)}</Notice> : null}
      </>
    );
  } else {
    main = <Text style={styles.muted}>{noPriceText(entry, api, tcg)}</Text>;
  }

  // Referências (fontes que não são o valor), numa linha cada, sem link próprio (os links ficam nos botões das lojas).
  const refs: string[] = [];
  if (tcg?.avg != null && ref.basis !== 'tcgplayer') {
    refs.push(`TCGplayer (EUA): ${rangeText(tcg)} · mercado ${formatBRLTight(tcg.avg)}${tcg.base ? ' · carta base' : ''}`);
  }
  if (api?.avg != null && ref.basis !== 'myp' && !gap) {
    const scope = [api.qty != null ? offersText(api.qty) : null, english ? 'todos os idiomas' : null, apiFits ? null : 'carta base'].filter(Boolean).join(', ');
    refs.push(`${english ? 'No Brasil, no MYP Cards' : 'MYP Cards'}: ${rangeText(api)}${scope ? ` (${scope})` : ''}`);
  }

  // Detalhes da cotação (recolhidos): a conta da TCGplayer, a hora do MYP e o aviso de carta base.
  const details: { key: string; text: ReactNode }[] = [];
  if (tcg && !tcg.notFound && tcg.avg != null) {
    details.push({ key: 'usd', text: `TCGplayer: mercado ${usdConversionText(tcg)} · todos os estados.` });
    details.push({
      key: 'tcgcsv',
      text: (
        <>
          Preços da TCGplayer via{' '}
          <ExternalLink variant="inline" href={TCGCSV_URL}>
            TCGCSV
          </ExternalLink>
          {tcg.builtAt ? ` de ${formatWhen(tcg.builtAt)}` : ''} · câmbio PTAX do Banco Central.
        </>
      ),
    });
    if (tcg.base) details.push({ key: 'tcgbase', text: `A TCGplayer não vende a versão ${versionLabel} à parte: é o preço da carta base.` });
  }
  if (api?.checkedAt && api.avg != null) {
    details.push({ key: 'myp', text: `MYP Cards: consultado em ${formatWhen(api.checkedAt)} · todos os estados e idiomas juntos.` });
    if (!apiFits) details.push({ key: 'mypbase', text: `O MYP não vende a versão ${versionLabel} à parte: é o preço da carta base.` });
  }

  // Histórico só com a fonte do último dia e a escolha atual (trocar o "Meu valor" ou "Usar na soma" não é mercado).
  const series = entrySeries(history, here.valueBasis ?? 'avg');
  const points = series.length >= 2 ? series : null;
  const first = points?.[0];
  const last = points?.[points.length - 1];
  const diff = first && last ? last.value - first.value : 0;
  // A variação do "Meu valor" é só o que foi digitado: sem alta nem queda.
  const showChange = !!last && last.source !== 'manual';

  return (
    <View style={styles.card}>
      {head(ref.basis !== 'manual' && !gapMyValue)}
      {main}
      {refs.map((r) => (
        <Text key={r} style={styles.reference}>
          {r}
        </Text>
      ))}
      {gap ? (
        <View style={styles.gap}>
          <Notice tone="info">{gapMyValue ? usPriceGapText(gap) : `${usPriceGapText(gap)} ${MY_VALUE_BELOW_US}`}</Notice>
          {gapMyValue && onSetMyValue ? <TextAction label={USE_MY_VALUE} accessibilityLabel="Usar meu valor" onPress={onSetMyValue} /> : null}
        </View>
      ) : null}

      <StoreLinks mypUrl={api?.url ?? MYP_URL} tcgUrl={tcg?.url} ligaUrl={ligaUrl} />

      {details.length ? (
        <Disclosure title="Detalhes da cotação" open={detailsOpen} onToggle={() => setDetailsOpen((o) => !o)}>
          <View style={styles.details}>
            {details.map((d) => (
              <Text key={d.key} style={styles.detail}>
                {d.text}
              </Text>
            ))}
          </View>
        </Disclosure>
      ) : null}

      {points && first && last ? (
        <Disclosure
          title="Histórico do preço"
          aside={showChange ? changeText({ diff, pct: first.value ? (diff / first.value) * 100 : null, since: first.day }) : undefined}
          asideColor={diff > 0.005 ? semantic.gain.fg : diff < -0.005 ? semantic.loss.fg : colors.textMuted}
          open={historyOpen}
          onToggle={() => setHistoryOpen((o) => !o)}>
          <LineChart points={points.map((p) => ({ t: dayTime(p.day), v: p.value }))} height={130} />
        </Disclosure>
      ) : null}
      {howSheet}
    </View>
  );
}

/** Histórico do preço desta carta (com conta); vazio enquanto carrega ou sem conta. */
function useEntryHistory(entry?: Entry) {
  const id = entry?.id;
  const cardId = entry?.cardId;
  const variant = entry?.variant;
  const lang = entry?.lang;
  const key = `${id}|${cardId}|${variant}|${lang}`;
  const [loaded, setLoaded] = useState<{ key: string; points: EntryHistoryPoint[] } | null>(null);
  useEffect(() => {
    if (!id || !cardId || !variant || !lang) return;
    let live = true;
    entryHistory({ id, cardId, variant, lang })
      .then((points) => {
        if (live && points) setLoaded({ key: `${id}|${cardId}|${variant}|${lang}`, points });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, cardId, variant, lang]);
  return loaded?.key === key ? loaded.points : [];
}

/** Faixa curta: "R$ 98 – R$ 190" (ou um valor só, quando mínimo e máximo são iguais). */
function rangeText(p: { min?: number; avg?: number; max?: number }) {
  const min = p.min ?? p.avg;
  const max = p.max ?? p.avg;
  if (min == null || max == null) return '—';
  return max - min >= 0.005 ? `${formatBRLTight(min)} – ${formatBRLTight(max)}` : formatBRLTight(min);
}

/** Carta sem valor ainda: por quê, em uma frase. */
function noPriceText(entry: Entry, api?: MypApiPrice, tcg?: TcgplayerPrice) {
  if (entry.lang === 'en') {
    if (!tcg) return 'Buscando o preço na TCGplayer…';
    if (tcg.notFound && api?.avg == null) {
      const why = `Sem preço na TCGplayer (${tcgplayerReason(tcg.notFound)})`;
      if (api) return `${why} nem no MYP Cards.`;
      return WEB ? `${why}. O MYP Cards é consultado pelo app no celular.` : `${why}. Buscando no MYP Cards…`;
    }
  }
  if (!mypCovers(entry.lang)) return 'O MYP Cards não tem cartas japonesas.';
  if (!api) return WEB ? 'O MYP Cards é consultado pelo app no celular.' : 'Buscando o preço no MYP Cards…';
  if (api.notFound) return `Não achei esta carta no MYP Cards (${api.notFound}).`;
  return 'Sem anúncios desta carta no MYP Cards agora.';
}

/** Ação em texto (44 px de altura), ex.: "✎ Definir meu valor". */
function TextAction({ label, accessibilityLabel, onPress }: { label: string; accessibilityLabel: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      role="button"
      accessibilityLabel={accessibilityLabel}
      style={(s) => {
        const { pressed, hovered } = s as PressState;
        return [styles.textAction, hovered && { backgroundColor: semantic.hover.onLight }, pressed && { opacity: 0.6 }];
      }}>
      <Text style={styles.textActionText}>{label}</Text>
    </Pressable>
  );
}

/** Bloco recolhido com título tocável ("▸ Detalhes da cotação"). */
function Disclosure({
  title,
  aside,
  asideColor,
  open,
  onToggle,
  children,
}: {
  title: string;
  aside?: string;
  asideColor?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View>
      <Pressable
        onPress={onToggle}
        role="button"
        aria-expanded={open}
        accessibilityLabel={aside ? `${title}, ${aside}` : title}
        style={(s) => {
          const { pressed, hovered } = s as PressState;
          return [styles.disclosure, hovered && { backgroundColor: semantic.hover.onLight }, pressed && { opacity: 0.7 }];
        }}>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
        <Text style={styles.disclosureTitle}>{title}</Text>
        {aside ? (
          <Text style={[styles.disclosureAside, { color: asideColor ?? colors.textMuted }]} numberOfLines={1}>
            {aside}
          </Text>
        ) : null}
      </Pressable>
      {open ? children : null}
    </View>
  );
}

/** Um link por loja: anúncios no MYP Cards (fonte do valor e atribuição), TCGplayer (cartas em inglês) e LigaPokemon. */
function StoreLinks({ mypUrl, tcgUrl, ligaUrl }: { mypUrl: string; tcgUrl?: string; ligaUrl?: string }) {
  return (
    <View style={styles.storeRow}>
      <ExternalLink variant="button" href={mypUrl} arrow accessibilityLabel="Ver anúncios da carta no MYP Cards" containerStyle={styles.storeButton} numberOfLines={1}>
        MYP Cards
      </ExternalLink>
      {tcgUrl ? (
        <ExternalLink variant="button" href={tcgUrl} arrow accessibilityLabel="Ver a carta na TCGplayer" containerStyle={styles.storeButton} numberOfLines={1}>
          TCGplayer
        </ExternalLink>
      ) : null}
      {ligaUrl ? (
        <ExternalLink variant="button" href={ligaUrl} arrow accessibilityLabel="Ver a carta na Liga Pokémon" containerStyle={styles.storeButton} numberOfLines={1}>
          Liga Pokémon
        </ExternalLink>
      ) : null}
    </View>
  );
}

/** "Como calculamos o valor" (U2): a explicação fica aqui, e não em parágrafos na tela. */
function HowWeCalculate({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <InfoSheet
      visible={visible}
      onClose={onClose}
      title={HOW_WE_CALCULATE.title}
      footer={
        <Text style={styles.credits}>
          Fontes:{' '}
          <ExternalLink variant="inline" href={MYP_URL}>
            MYP Cards
          </ExternalLink>{' '}
          e{' '}
          <ExternalLink variant="inline" href={TCGPLAYER_URL}>
            TCGplayer
          </ExternalLink>
          , via{' '}
          <ExternalLink variant="inline" href={TCGCSV_URL}>
            TCGCSV
          </ExternalLink>
          . Câmbio: PTAX do Banco Central.
        </Text>
      }>
      {HOW_WE_CALCULATE.topics.map((t) => (
        <InfoTopic key={t.title} title={t.title}>
          {t.body}
        </InfoTopic>
      ))}
    </InfoSheet>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, ...shadow },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH },
  flex: { flex: 1 },
  label: { ...typography.label, color: colors.textMuted },
  main: { ...typography.display, color: semantic.money.fg },
  origin: { ...typography.caption, color: colors.textMuted },
  muted: { ...typography.caption, color: colors.textMuted },
  reference: { ...typography.caption, ...typography.tabular, color: colors.text },
  gap: { gap: space.xxs },
  textAction: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: space.sm, borderRadius: radius.pill, alignSelf: 'flex-start' },
  textActionText: { ...typography.caption, fontWeight: '700', color: semantic.link.fg },
  storeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  storeButton: { flexGrow: 1, minWidth: 96 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: TOUCH, borderRadius: radius.sm },
  disclosureTitle: { ...typography.caption, fontWeight: '700', color: colors.textMuted },
  disclosureAside: { ...typography.caption, ...typography.tabular, flex: 1, textAlign: 'right' },
  details: { gap: space.xs, paddingLeft: space.lg + space.xxs, paddingBottom: space.xs },
  detail: { ...typography.caption, color: colors.textMuted },
  credits: { ...typography.caption, color: colors.textMuted },
});
