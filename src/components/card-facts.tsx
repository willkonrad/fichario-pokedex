import { StyleSheet, Text, View } from 'react-native';

import type { CardDetail } from '@/lib/tcgdex';
import { colors, radius } from '@/theme';

/** Cor de cada tipo de energia (nomes em inglês e em português, como vêm da TCGdex). */
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
const PT_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(ENERGY).map(([en, v]) => [v.pt.toLowerCase(), en]),
);
const energyKey = (t: string) => {
  const k = t.toLowerCase();
  return ENERGY[k] ? k : (PT_TO_EN[k] ?? (k === 'eletrico' ? 'lightning' : k === 'agua' ? 'water' : k));
};
const energyName = (t: string) => ENERGY[energyKey(t)]?.pt ?? t;

const STAGE_PT: Record<string, string> = { basic: 'Básico', stage1: 'Estágio 1', stage2: 'Estágio 2' };
const stageName = (s?: string) => (s ? (STAGE_PT[s.toLowerCase().replace(/\s/g, '')] ?? s) : undefined);

/** Bolinha de energia (custo de ataque, fraqueza, recuo). */
function Energy({ type, size = 16 }: { type: string; size?: number }) {
  const e = ENERGY[energyKey(type)];
  return (
    <View
      style={[
        styles.energy,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: e?.color ?? colors.textFaint },
      ]}
      accessibilityLabel={energyName(type)}
    />
  );
}

/** Grade de atributos, no estilo das fichas de catálogo: rótulo pequeno em cima, valor embaixo. */
export function CardAttributes({ items }: { items: [string, string | number | undefined][] }) {
  const shown = items.filter(([, v]) => v != null && v !== '' && v !== 'None');
  if (!shown.length) return null;
  return (
    <View style={styles.grid}>
      {shown.map(([label, value]) => (
        <View key={label} style={styles.attr}>
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

/** Habilidades, ataques, fraqueza, resistência e recuo. */
export function CardMoves({ detail }: { detail: CardDetail | null }) {
  if (!detail) return null;
  const { abilities, attacks, weaknesses, resistances, retreat } = detail;
  const hasStats = !!weaknesses?.length || !!resistances?.length || retreat != null;
  if (!abilities?.length && !attacks?.length && !hasStats) return null;

  return (
    <View style={{ gap: 12 }}>
      {abilities?.length ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.groupLabel}>Habilidades</Text>
          {abilities.map((a) => (
            <View key={a.name} style={styles.box}>
              <Text style={styles.boxTitle}>
                {a.type ? <Text style={styles.boxKind}>{a.type.toUpperCase()}  </Text> : null}
                {a.name}
              </Text>
              {a.effect ? <Text style={styles.boxText}>{a.effect}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {attacks?.length ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.groupLabel}>Ataques</Text>
          {attacks.map((a) => (
            <View key={a.name} style={styles.box}>
              <View style={styles.attackHead}>
                <View style={styles.cost}>
                  {(a.cost ?? []).map((c, i) => (
                    <Energy key={i} type={c} />
                  ))}
                </View>
                <Text style={[styles.boxTitle, { flex: 1 }]}>{a.name}</Text>
                {a.damage != null && a.damage !== '' ? <Text style={styles.damage}>{a.damage}</Text> : null}
              </View>
              {a.effect ? <Text style={styles.boxText}>{a.effect}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {hasStats ? (
        <View style={styles.stats}>
          <Stat label="Fraqueza">
            {weaknesses?.length
              ? weaknesses.map((w) => (
                  <View key={w.type} style={styles.statRow}>
                    <Energy type={w.type} size={14} />
                    <Text style={styles.statValue}>{w.value ?? ''}</Text>
                  </View>
                ))
              : <Text style={styles.statValue}>—</Text>}
          </Stat>
          <Stat label="Resistência">
            {resistances?.length
              ? resistances.map((r) => (
                  <View key={r.type} style={styles.statRow}>
                    <Energy type={r.type} size={14} />
                    <Text style={styles.statValue}>{r.value ?? ''}</Text>
                  </View>
                ))
              : <Text style={styles.statValue}>—</Text>}
          </Stat>
          <Stat label="Recuo">
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

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.attrLabel, styles.statLabel]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
      <View style={{ gap: 4, marginTop: 4 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  attr: { width: '50%', paddingRight: 8 },
  attrLabel: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  attrValue: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 3 },
  groupLabel: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  box: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 },
  boxKind: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  boxTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  boxText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  attackHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cost: { flexDirection: 'row', gap: 3 },
  damage: { color: colors.text, fontSize: 17, fontWeight: '800' },
  energy: { borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.18)' },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12 },
  statLabel: { letterSpacing: 0.4, fontSize: 10 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { color: colors.text, fontSize: 14, fontWeight: '700' },
});
