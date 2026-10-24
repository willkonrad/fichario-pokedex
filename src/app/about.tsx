import Constants from 'expo-constants';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { HEADING_3 } from '@/components/collection-chart';
import { syncSummary } from '@/components/collection-notices';
import { HowWeCalculate } from '@/components/collection-value';
import { Card, ExternalLink, Notice, TextSkeleton } from '@/components/ui';
import { catalogSyncStatus, type CatalogSyncStatus } from '@/lib/catalog';
import { HOW_WE_CALCULATE, MYP_URL, TCGCSV_URL, TCGPLAYER_URL } from '@/lib/copy';
import { formatDay, formatWhen } from '@/lib/format';
import { useEntries, useSession, useSyncStatus } from '@/store/collection';
import { colors, space, typography, widths } from '@/theme';

const PLATFORM: Record<string, string> = { web: 'Web', ios: 'iPhone', android: 'Android' };
const RUN_STATUS: Record<'ok' | 'partial' | 'error', string> = { ok: 'ok', partial: 'em parte, algumas coleções falharam', error: 'com erro' };

/** Sobre e fontes (N6, U2): como o valor é calculado, de onde vêm os dados, o estado do servidor e a versão. */
export default function AboutScreen() {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Card style={styles.card}>
        <Text style={styles.title} {...HEADING_3}>
          {HOW_WE_CALCULATE.title}
        </Text>
        <HowWeCalculate />
      </Card>
      <Credits />
      <ServerStatus />
      <ThisDevice />
    </ScrollView>
  );
}

function Credits() {
  return (
    <Card style={styles.card}>
      <Text style={styles.title} {...HEADING_3}>
        Fontes e créditos
      </Text>
      <Line label="Preços em reais">
        Anúncios do{' '}
        <ExternalLink href={MYP_URL} variant="inline" arrow>
          MYP Cards
        </ExternalLink>
        , consultados pelo app no celular.
      </Line>
      <Line label="Cartas em inglês">
        <ExternalLink href={TCGPLAYER_URL} variant="inline" arrow>
          TCGplayer
        </ExternalLink>
        , pela cópia diária do{' '}
        <ExternalLink href={TCGCSV_URL} variant="inline" arrow>
          TCGCSV
        </ExternalLink>
        , em reais pela PTAX do{' '}
        <ExternalLink href="https://www.bcb.gov.br" variant="inline" arrow>
          Banco Central
        </ExternalLink>
        .
      </Line>
      <Line label="Catálogo e imagens">
        <ExternalLink href="https://tcgdex.dev" variant="inline" arrow>
          TCGdex
        </ExternalLink>
        , TCGCSV, Scrydex, pokemontcg.io e Zukan. Ilustrações dos Pokémon:{' '}
        <ExternalLink href="https://pokeapi.co" variant="inline" arrow>
          PokeAPI
        </ExternalLink>
        .
      </Line>
      <Text style={styles.note}>
        Pokémon e seus nomes são marcas da Nintendo, Creatures e GAME FREAK. App pessoal, sem ligação com elas nem com as lojas citadas.
      </Text>
    </Card>
  );
}

/** Estado do catálogo no servidor (G2): última execução do catalog-sync e a idade do catálogo, dos preços e da PTAX. */
function ServerStatus() {
  const session = useSession();
  const signedIn = !!session;
  const [status, setStatus] = useState<{ value: CatalogSyncStatus | undefined } | undefined>();
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    catalogSyncStatus().then((value) => alive && setStatus({ value }));
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const s = status?.value;
  const last = s?.last;
  return (
    <Card style={styles.card}>
      <Text style={styles.title} {...HEADING_3}>
        Servidor
      </Text>
      {!signedIn ? (
        <Text style={styles.note}>Entre na conta para ver o estado do catálogo no servidor.</Text>
      ) : !status ? (
        <TextSkeleton lines={3} />
      ) : !s ? (
        <Text style={styles.note}>Estado do servidor indisponível agora.</Text>
      ) : (
        <>
          {last ? (
            <Notice tone={last.status === 'ok' ? 'success' : last.status === 'partial' ? 'warning' : 'danger'}>
              Última atualização do catálogo em {formatWhen(last.finishedAt ?? last.startedAt)}: {RUN_STATUS[last.status] ?? last.status}
              {last.status !== 'ok' && last.error ? ` (${last.error})` : ''}.
            </Notice>
          ) : (
            <Text style={styles.note}>O catálogo ainda não registrou nenhuma atualização.</Text>
          )}
          {last && last.status !== 'ok' && s.lastOkAt ? <Line label="Última que deu certo">{formatWhen(s.lastOkAt)}</Line> : null}
          <Line label="Últimas 24 h">
            {s.runs24h} {s.runs24h === 1 ? 'execução' : 'execuções'}
            {s.failures24h ? `, ${s.failures24h} com falha` : ', sem falhas'}
          </Line>
          <Line label="Dados de">
            {[
              s.catalogAt ? `catálogo ${formatDay(s.catalogAt)}` : null,
              s.pricesAt ? `preços da TCGplayer ${formatDay(s.pricesAt)}` : null,
              s.fxDay ? `PTAX ${formatDay(s.fxDay)}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </Line>
        </>
      )}
    </Card>
  );
}

function ThisDevice() {
  const entries = useEntries();
  const session = useSession();
  const syncStatus = useSyncStatus();
  const version = Constants.expoConfig?.version;
  const count = Object.keys(entries).length;
  return (
    <Card style={styles.card}>
      <Text style={styles.title} {...HEADING_3}>
        Este aparelho
      </Text>
      <Line label="Versão">{[version ? `Fichário Pokédex ${version}` : 'Fichário Pokédex', PLATFORM[Platform.OS] ?? Platform.OS].join(' · ')}</Line>
      <Line label="Coleção">
        {count} {count === 1 ? 'carta' : 'cartas'} · {syncSummary(syncStatus, session?.user.email).text}
      </Line>
    </Card>
  );
}

/** Uma linha "Rótulo: texto" (o texto pode ter links). */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: space.lg, gap: space.md, maxWidth: widths.reading, width: '100%', alignSelf: 'center', paddingBottom: space.xxxl },
  card: { gap: space.md },
  title: { ...typography.heading, color: colors.text },
  note: { ...typography.caption, color: colors.textMuted },
  line: { gap: space.xxs },
  lineLabel: { ...typography.label, color: colors.textMuted },
  lineText: { ...typography.body, ...typography.tabular, color: colors.text },
});
