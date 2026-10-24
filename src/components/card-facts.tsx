import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CardDetail } from '@/lib/tcgdex';
import { colors, radius, space, typography } from '@/theme';

/** Cor de cada tipo de energia (nomes em inglês e em português, como vêm da TCGdex). São cores do jogo, não da interface. */
const ENERGY: Record<string, { color: string; pt: string }> = {
  fire: { color: '#E5484D', pt: 'Fogo' },
  water: { color: '#0090FF', pt: 'Água' },
  grass: { color: '#46A758', pt: 'Planta' },
  lightning: { color: '#FFC53D', pt: 'Elétrico' },
  psychic: { color: '#8E4EC6', pt: 'Psíquico' },
  fighting: { color: '#C2652A', pt: 'Lutador' },
  darkness: { color: '#3A3A46', pt: 'Escuridão' },
  metal: { color: '#8D99A6', pt: 'Metal' },
  fairy: { color: '#D6409F', pt: 'Fada' },
  dragon: { color: '#B08D3A', pt: 'Dragão' },
  colorless: { color: '#C4C8D0', pt: 'Incolor' },
};
const PT_TO_EN: Record<string, string> = Object.fromEntries(Object.entries(ENERGY).map(([en, v]) => [v.pt.toLowerCase(), en]));
const energyKey = (t: string) => {
  const k = t.toLowerCase();
  return ENERGY[k] ? k : (PT_TO_EN[k] ?? (k === 'eletrico' ? 'lightning' : k === 'agua' ? 'water' : k));
};
const energyName = (t: string) => ENERGY[energyKey(t)]?.pt ?? t;

const STAGE_PT: Record<string, string> = { basic: 'Básico', stage1: 'Estágio 1', stage2: 'Estágio 2' };
const stageName = (s?: string) => (s ? (STAGE_PT[s.toLowerCase().replace(/\s/g, '')] ?? s) : undefined);

/** Bolinha de energia (custo de ataque, fraqueza, recuo). O nome vai no rótulo do grupo, para o leitor de tela. */
function Energy({ type, size = 16 }: { type: string; size?: number }) {
  const e = ENERGY[energyKey(type)];
  return <View style={[styles.energy, { width: size, height: size, borderRadius: size / 2, backgroundColor: e?.color ?? colors.iconFaint }]} />;
}

/** Grade de atributos, no estilo das fichas de catálogo: rótulo pequeno em cima, valor embaixo. */
export function CardAttributes({ items }: { items: [string, string | number | undefined][] }) {
  const shown = items.filter(([, v]) => v != null && v !== '' && v !== 'None');
  if (!shown.length) return null;
  return (
    <View style={styles.grid}>
      {shown.map(([label, value]) => (
        <View key={label} style={styles.attr} accessible accessibilityLabel={`${label}: ${value}`}>
          <Text style={styles.attrLabel}>{label}</Text>
          <Text style={styles.attrValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

export function cardAttributeItems(detail: CardDetail | null): [string, string | number | undefined][] {
  if (!detail) return [];
  return [
    ['Categoria', detail.category === 'Pokemon' ? 'Pokémon' : detail.category],
    ['HP', detail.hp],
    ['Tipo', detail.types?.map(energyName).join(', ')],
    ['Estágio', stageName(detail.stage)],
    ['Evolui de', detail.evolveFrom],
    ['Ilustrador', detail.illustrator],
    ['Raridade', detail.rarity],
    ['Marca de regulamento', detail.regulationMark],
  ];
}

/** "Fogo, Fogo e Incolor". */
function energyList(types: string[]) {
  const names = types.map(energyName);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : (names[0] ?? '');
}

/** Habilidades, ataques, fraqueza, resistência e recuo. */
export function CardMoves({ detail }: { detail: CardDetail | null }) {
  if (!detail) return null;
  const { abilities, attacks, weaknesses, resistances, retreat } = detail;
  const hasStats = !!weaknesses?.length || !!resistances?.length || retreat != null;
  if (!abilities?.length && !attacks?.length && !hasStats) return null;

  return (
    <View style={styles.moves}>
      {abilities?.length ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Habilidades</Text>
          {abilities.map((a) => (
            <View key={a.name} style={styles.box}>
              <Text style={styles.boxTitle}>
                {a.type ? <Text style={styles.boxKind}>{a.type.toUpperCase()} </Text> : null}
                {a.name}
              </Text>
              {a.effect ? <Text style={styles.boxText}>{a.effect}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {attacks?.length ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>Ataques</Text>
          {attacks.map((a) => (
            <View key={a.name} style={styles.box}>
              <View style={styles.attackHead}>
                {a.cost?.length ? (
                  <View style={styles.cost} accessible accessibilityLabel={`Custo: ${energyList(a.cost)}`}>
                    {a.cost.map((c, i) => (
                      <Energy key={i} type={c} />
                    ))}
                  </View>
                ) : null}
                <Text style={[styles.boxTitle, styles.flex]}>{a.name}</Text>
                {a.damage != null && a.damage !== '' ? (
                  <Text style={styles.damage} accessibilityLabel={`Dano: ${a.damage}`}>
                    {a.damage}
                  </Text>
                ) : null}
              </View>
              {a.effect ? <Text style={styles.boxText}>{a.effect}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {hasStats ? (
        <View style={styles.stats}>
          <Stat label="Fraqueza" spoken={weaknesses?.length ? weaknesses.map((w) => `${energyName(w.type)} ${w.value ?? ''}`.trim()).join(', ') : 'nenhuma'}>
            {weaknesses?.length ? (
              weaknesses.map((w) => (
                <View key={w.type} style={styles.statRow}>
                  <Energy type={w.type} size={14} />
                  <Text style={styles.statValue}>{w.value ?? ''}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.statValue}>—</Text>
            )}
          </Stat>
          <Stat label="Resistência" spoken={resistances?.length ? resistances.map((r) => `${energyName(r.type)} ${r.value ?? ''}`.trim()).join(', ') : 'nenhuma'}>
            {resistances?.length ? (
              resistances.map((r) => (
                <View key={r.type} style={styles.statRow}>
                  <Energy type={r.type} size={14} />
                  <Text style={styles.statValue}>{r.value ?? ''}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.statValue}>—</Text>
            )}
          </Stat>
          <Stat label="Recuo" spoken={retreat ? `${retreat} ${retreat === 1 ? 'energia' : 'energias'}` : retreat === 0 ? '0' : 'sem informação'}>
            {retreat ? (
              <View style={styles.statRow}>
                {Array.from({ length: retreat }, (_, i) => (
                  <Energy key={i} type="colorless" size={14} />
                ))}
              </View>
            ) : (
              <Text style={styles.statValue}>{retreat === 0 ? '0' : '—'}</Text>
            )}
          </Stat>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, spoken, children }: { label: string; spoken: string; children: ReactNode }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${spoken}`}>
      {/* "Resistência" não cabe inteira na coluna de um celular de 375 px: no celular, a letra diminui um pouco. */}
      <Text style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
      <View style={styles.statBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  attr: { width: '50%', paddingRight: space.sm },
  attrLabel: { ...typography.label, color: colors.textFaint },
  attrValue: { ...typography.bodyStrong, color: colors.text, marginTop: space.xxs },
  moves: { gap: space.md },
  group: { gap: space.sm },
  groupLabel: { ...typography.label, color: colors.textFaint },
  box: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.xs },
  boxKind: { ...typography.label, color: colors.textFaint },
  boxTitle: { ...typography.bodyStrong, fontWeight: '700', color: colors.text },
  boxText: { ...typography.body, fontSize: 14, lineHeight: 20, color: colors.textMuted },
  attackHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cost: { flexDirection: 'row', gap: 3 },
  damage: { ...typography.heading, ...typography.tabular, color: colors.text },
  energy: { borderWidth: 1.5, borderColor: colors.border },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md },
  statLabel: { ...typography.label, fontSize: 11, letterSpacing: 0.4, color: colors.textFaint },
  statBody: { gap: space.xs, marginTop: space.xs },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  statValue: { ...typography.bodyStrong, fontSize: 14, color: colors.text },
});
