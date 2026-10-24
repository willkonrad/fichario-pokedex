import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { plainName } from '@/lib/catalog';
import type { CardLang, Entry, Variant } from '@/lib/types';
import { useEntries } from '@/store/collection';
import { radius, semantic } from '@/theme';

/**
 * Cartas que o usuário já colocou em algum fichário, como "<id da carta>|<idioma>".
 * @deprecated use useOwnership(), que confere a versão (selo, reverse, holo).
 */
export function useOwnedCards() {
  const entries = useEntries();
  return useMemo(() => new Set(Object.values(entries).map((e) => `${e.cardId}|${e.lang}`)), [entries]);
}

/** Nome curto da variação no selo "tenho · reverse". */
const VARIANT_SHORT: Record<Variant, string> = {
  normal: 'normal',
  holo: 'holo',
  reverse: 'reverse',
  firstEdition: '1ª ed.',
  shadowless: 'shadowless',
  pokeball: 'Poké Ball',
  masterball: 'Master Ball',
  wPromo: 'selo',
  staff: 'staff',
  other: 'outra',
};

/**
 * Selo comparável: sem acento, caixa nem pontuação ("Pokémon Day" digitado = "Pokemon Day" da lista). Selo sem letras
 * latinas (japonês): o texto como está, em minúsculas.
 */
const stampKey = (s?: string) => {
  const t = (s ?? '').trim();
  return t ? plainName(t) || t.toLocaleLowerCase('pt-BR') : '';
};

/**
 * Selo da cópia, para comparar com o da lista: o de promo/staff e o das versões do catálogo escolhidas em outras
 * variações ("Poke Ball Pattern", "Cosmos Holo"…; os chips de variação limpam o selo). Em "Outra", a descrição é texto
 * livre (ex.: "assinada") e não é selo.
 */
const stampOf = (e: Pick<Entry, 'variant' | 'variantNote'>) => (e.variant === 'other' ? '' : stampKey(e.variantNote));

/** Uma carta da lista (ou da tela da carta) que pode já estar na coleção. */
export type OwnableCard = { id: string; lang: CardLang; stamp?: { label: string } | null };

/** O que o usuário tem desta carta: `exact` = esta versão; senão, outra versão da mesma carta. */
export type Ownership = { exact: boolean; label: string; count: number };

/**
 * Posse por versão (F3), a partir das cópias da mesma carta e idioma: uma versão com selo só fica "tenho" se alguma
 * cópia tiver esse selo; a carta sem selo fica "tenho" (ou "tenho · reverse", quando todas as cópias sem selo são de
 * uma variação especial) com alguma cópia sem selo. Com só outras versões, "outra versão". Sem cópias, null.
 */
export function ownershipOf(copies: Pick<Entry, 'variant' | 'variantNote'>[] | undefined, card: Pick<OwnableCard, 'stamp'>): Ownership | null {
  if (!copies?.length) return null;
  const stamp = stampKey(card.stamp?.label);
  const same = copies.filter((e) => stampOf(e) === stamp);
  if (!same.length) return { exact: false, label: 'outra versão', count: copies.length };
  if (stamp) return { exact: true, label: 'tenho', count: same.length };
  const variants = [...new Set(same.map((e) => e.variant))];
  const label = variants.includes('normal') ? 'tenho' : variants.length === 1 ? `tenho · ${VARIANT_SHORT[variants[0]]}` : `tenho · ${variants.length} versões`;
  return { exact: true, label, count: same.length };
}

/** O `ownershipOf` de cada carta da lista, com as cartas da coleção (atualiza quando a coleção muda). */
export function useOwnership() {
  const entries = useEntries();
  const byCard = useMemo(() => {
    const map = new Map<string, Pick<Entry, 'variant' | 'variantNote'>[]>();
    for (const e of Object.values(entries)) {
      const key = `${e.cardId}|${e.lang}`;
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [entries]);

  return useMemo(() => (card: OwnableCard) => ownershipOf(byCard.get(`${card.id}|${card.lang}`), card), [byCard]);
}

/**
 * Selo "tenho" sobre a miniatura da carta. `partial`: o usuário tem outra versão da carta (selo neutro, "outra
 * versão"). O texto entra no rótulo de quem desenha a miniatura (a célula da grade), por isso fica escondido aqui.
 */
export function OwnedBadge({ label = 'tenho', partial = false }: { label?: string; partial?: boolean }) {
  return (
    <View style={[styles.badge, partial && styles.partial]} aria-hidden>
      <Ionicons name={partial ? 'git-branch-outline' : 'checkmark'} size={11} color={partial ? semantic.tag.fg : semantic.success.onSolid} />
      <Text style={[styles.text, partial && styles.partialText]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 4,
    left: 4,
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: semantic.success.solid,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  partial: { backgroundColor: semantic.tag.bg },
  text: { color: semantic.success.onSolid, fontSize: 11, lineHeight: 14, fontWeight: '700', flexShrink: 1 },
  partialText: { color: semantic.tag.fg },
});
