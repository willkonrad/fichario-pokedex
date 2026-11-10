import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Card, InfoButton, InfoParagraph, InfoSheet, InfoTopic, Skeleton } from '@/components/ui';
import { COLLECTOR_INFO, COLLECTOR_TITLE, isWideFact, type CollectorFacts as Facts, type FactKey, type FactRow } from '@/lib/collector';
import { japaneseGroupFor } from '@/lib/ja-catalog';
import { setFacts, setNameIn, type SetFacts } from '@/lib/tcgdex';
import type { CardLang } from '@/lib/types';
import { colors, space, typography } from '@/theme';

const WEB = Platform.OS === 'web';
/** Título do bloco: <h2> na web (o <h1> é o nome da carta). */
const HEADING_2 = { role: 'heading' as const, ...((WEB ? { 'aria-level': 2 } : {}) as object) };

/** Espera máxima pelas fontes do bloco: depois disso, aparece o que já chegou (o resto entra no lugar quando vier). */
export const FACTS_WAIT_MS = 2500;

export type CollectorSources = { set?: SetFacts; ptSetName?: string; jaGroupName?: string; ready: boolean };

/** Resultado de uma busca, com a chave do pedido: o de outra coleção ou idioma não vale. */
type Loaded<T> = { key: string; value?: T };

/**
 * Fontes do bloco "Para colecionador" além das que a tela já carrega: dia e série da coleção, nome em português (carta
 * em português com dados em inglês) e o nome do grupo da TCGplayer (carta da TCGdex japonesa). `ready` quando todas
 * as necessárias responderam (ou falharam) ou depois de FACTS_WAIT_MS. `attempt` é o "Tentar de novo" da tela: cada
 * toque busca de novo (a resposta anterior vale até a nova chegar).
 */
export function useCollectorSources(o: {
  cardId?: string;
  setId: string;
  lang: CardLang;
  dataLang: CardLang;
  isTcgp: boolean;
  detailSettled: boolean;
  enSettled: boolean;
  needCatalog: boolean;
  catalogSettled: boolean;
  attempt?: number;
}): CollectorSources {
  const { cardId, setId, lang, dataLang, isTcgp, attempt = 0 } = o;
  const wantSet = !!cardId && !isTcgp && !!setId;
  const wantPt = wantSet && lang === 'pt' && dataLang === 'en';
  const wantJa = wantSet && lang === 'ja';
  const setKey = `${setId}|${lang}`;

  const [set, setSet] = useState<Loaded<SetFacts>>();
  useEffect(() => {
    if (!wantSet) return;
    let live = true;
    const key = `${setId}|${lang}`;
    setFacts(setId, lang).then(
      (value) => {
        if (live) setSet({ key, value });
      },
      () => {
        if (live) setSet({ key });
      },
    );
    return () => {
      live = false;
    };
  }, [wantSet, setId, lang, attempt]);

  const [ptName, setPtName] = useState<Loaded<string>>();
  useEffect(() => {
    if (!wantPt) return;
    let live = true;
    const key = `${setId}|${lang}`;
    setNameIn(setId, 'pt').then(
      (value) => {
        if (live) setPtName({ key, value });
      },
      () => {
        if (live) setPtName({ key });
      },
    );
    return () => {
      live = false;
    };
  }, [wantPt, setId, lang, attempt]);

  const [jaGroup, setJaGroup] = useState<Loaded<string>>();
  useEffect(() => {
    if (!wantJa) return;
    let live = true;
    const key = `${setId}|${lang}`;
    japaneseGroupFor(setId).then(
      (g) => {
        if (live) setJaGroup({ key, value: g?.name?.trim() || undefined });
      },
      () => {
        if (live) setJaGroup({ key });
      },
    );
    return () => {
      live = false;
    };
  }, [wantJa, setId, lang, attempt]);

  // Espera máxima, contada de novo para cada carta.
  const [cappedFor, setCappedFor] = useState<string>();
  useEffect(() => {
    if (!cardId) return;
    const t = setTimeout(() => setCappedFor(cardId), FACTS_WAIT_MS);
    return () => clearTimeout(t);
  }, [cardId]);

  const setDone = !wantSet || set?.key === setKey;
  const ptDone = !wantPt || ptName?.key === setKey;
  const jaDone = !wantJa || jaGroup?.key === setKey;
  const settled = o.detailSettled && o.enSettled && (!o.needCatalog || o.catalogSettled) && setDone && ptDone && jaDone;
  return {
    set: wantSet && set?.key === setKey ? set.value : undefined,
    ptSetName: wantPt && ptName?.key === setKey ? ptName.value : undefined,
    jaGroupName: wantJa && jaGroup?.key === setKey ? jaGroup.value : undefined,
    ready: (!!cardId && cappedFor === cardId) || settled,
  };
}

/**
 * Bloco "Para colecionador": coleção, lançamento, série, número, raridade, ilustrador e Pokémon da carta, rótulo em cima
 * do valor. Sem valor, a linha some (nunca um "—"). O ⓘ explica o que cada data quer dizer.
 */
export function CollectorFacts({ facts, ready }: { facts: Facts; ready: boolean }) {
  const [infoOpen, setInfoOpen] = useState(false);
  if (ready && !facts.rows.length) return null;
  return (
    <View style={styles.block}>
      <View style={styles.headingRow}>
        <Text style={styles.heading} {...HEADING_2}>
          {COLLECTOR_TITLE}
        </Text>
        <InfoButton label={COLLECTOR_INFO.title} onPress={() => setInfoOpen(true)} />
      </View>
      <Card style={styles.card}>
        {ready ? (
          <>
            <View role={WEB ? 'list' : undefined} style={styles.grid}>
              {facts.rows.map((row) => (
                <Fact key={row.key} row={row} />
              ))}
            </View>
            {facts.footer ? <Text style={styles.footer}>{facts.footer}</Text> : null}
          </>
        ) : (
          <>
            <View style={styles.grid}>
              {skeletonCells(facts).map((c) => (
                <FactSkeleton key={c.key} wide={c.wide} note={c.note} />
              ))}
            </View>
            <Bar width="60%" lineHeight={typography.caption.lineHeight} />
          </>
        )}
      </Card>
      <InfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} title={COLLECTOR_INFO.title}>
        {COLLECTOR_INFO.topics.map((t) =>
          t.title ? (
            <InfoTopic key={t.title} title={t.title}>
              {t.body}
            </InfoTopic>
          ) : (
            <InfoParagraph key={t.body}>{t.body}</InfoParagraph>
          ),
        )}
      </InfoSheet>
    </View>
  );
}

/**
 * Células do esboço, enquanto as fontes não chegam: uma por linha que já existe (com a mesma largura e a nota) e a da
 * data, que ainda falta. Assim o bloco já ocupa quase a altura final, e "Minha carta" não desce quando as linhas chegam.
 */
export function skeletonCells(facts: Facts): { key: FactKey; wide: boolean; note: boolean }[] {
  const cells = facts.rows.map((r) => ({ key: r.key, wide: r.wide, note: !!r.note }));
  if (!cells.some((c) => c.key === 'release')) {
    // A data vem logo depois da coleção (a ordem das linhas).
    cells.splice(cells[0]?.key === 'set' ? 1 : 0, 0, { key: 'release', wide: isWideFact('release'), note: false });
  }
  return cells;
}

/** Linha de texto em esboço, na altura da linha do estilo (o bloco cinza um pouco menor, centrado nela). */
function Bar({ width, lineHeight }: { width: `${number}%`; lineHeight: number }) {
  const height = lineHeight - space.xs;
  return <Skeleton width={width} height={height} radius={height / 2} style={styles.bar} />;
}

/** Uma informação em esboço: rótulo, valor e, se a linha tem, a nota. */
function FactSkeleton({ wide, note }: { wide: boolean; note: boolean }) {
  return (
    <View style={wide ? styles.full : styles.half}>
      <Bar width="40%" lineHeight={typography.label.lineHeight} />
      <View style={styles.below}>
        <Bar width="70%" lineHeight={typography.bodyStrong.lineHeight} />
      </View>
      {note ? (
        <View style={styles.below}>
          <Bar width="85%" lineHeight={typography.caption.lineHeight} />
        </View>
      ) : null}
    </View>
  );
}

/** Uma informação: no Android, uma parada só do leitor de tela (rótulo, valor e nota); na web, um item da lista. */
function Fact({ row }: { row: FactRow }) {
  return (
    <View
      role={WEB ? 'listitem' : undefined}
      accessible={WEB ? undefined : true}
      accessibilityLabel={WEB ? undefined : row.spoken}
      style={row.wide ? styles.full : styles.half}>
      <Text style={styles.label}>{row.label}</Text>
      {/* Texto selecionável vira um elemento com ação no Android, e o TalkBack pararia nele de novo (só o valor, sem o
          rótulo): fora da árvore de acessibilidade, a célula continua uma parada só. A seleção pelo toque continua. */}
      <Text selectable importantForAccessibility={WEB ? undefined : 'no'} style={[styles.value, row.numeric && styles.tabular]}>
        {row.value}
      </Text>
      {row.note ? <Text style={styles.note}>{row.note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { ...typography.heading, color: colors.heading, flexShrink: 1 },
  card: { gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  // Meia largura com folga à direita; nota ou nome comprido na largura toda (a meia célula tem ~140 px a 360 dp).
  half: { width: '50%', paddingRight: space.sm },
  full: { width: '100%' },
  label: { ...typography.label, color: colors.textFaint },
  value: { ...typography.bodyStrong, color: colors.text, marginTop: space.xxs },
  tabular: { ...typography.tabular },
  note: { ...typography.caption, color: colors.textMuted, marginTop: space.xxs },
  footer: { ...typography.caption, color: colors.textFaint },
  // Esboço: o bloco cinza tem a linha menos space.xs, e a margem completa a altura da linha.
  bar: { marginVertical: space.xxs },
  below: { marginTop: space.xxs },
});
