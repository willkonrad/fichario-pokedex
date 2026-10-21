import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ptcgImage, scrydexImage } from '@/lib/ptcg';
import { spriteUrl } from '@/data/pokedex';
import { cardImage } from '@/lib/tcgdex';
import { binderColors, colors } from '@/theme';

/**
 * Imagem da carta, na ordem:
 *   1. TCGdex (`image`);
 *   2. `imageUrl` já resolvida antes (reserva salva na carta);
 *   3. Scrydex pelo id da carta (não depende da API da pokemontcg.io, que cai com frequência);
 *   4. pokemontcg.io por nome em inglês + coleção (para coleções com id diferente).
 * Se a imagem carregada falhar, passa para a próxima fonte.
 */
export function CardImage({
  image,
  imageUrl,
  cardId,
  nameEn,
  setNameEn,
  localId,
  quality = 'low',
  contentFit = 'cover',
  compact = false,
  label,
  dex,
  dark = false,
  onResolved,
}: {
  image?: string;
  imageUrl?: string;
  cardId?: string;
  nameEn?: string;
  setNameEn?: string;
  localId?: string;
  quality?: 'low' | 'high';
  contentFit?: 'cover' | 'contain';
  /** Espaço pequeno (fichário): ícone menor e só o `label`, sem "Sem imagem". */
  compact?: boolean;
  /** Texto mostrado quando não há imagem (ex.: nome da carta no fichário). */
  label?: string;
  /** Pokémon da carta: sem imagem, mostra a arte dele esmaecida no lugar. */
  dex?: number;
  /** Sobre fundo escuro (página do fichário). */
  dark?: boolean;
  /** Avisa a URL encontrada na reserva, para ser guardada na carta. */
  onResolved?: (url: string) => void;
}) {
  const primary = image ? cardImage(image, quality) : imageUrl;
  const [failed, setFailed] = useState<string | undefined>();
  const [found, setFound] = useState<{ key: string; url?: string } | undefined>();
  const needsFallback = !primary || failed === primary;
  const canSearch = !!cardId || !!(nameEn && setNameEn);
  // Busca da reserva em andamento = ainda não terminou a busca desta carta.
  const searchKey = `${cardId}|${nameEn}|${setNameEn}|${localId}`;
  // Só vale a reserva achada para ESTA carta (a tela da carta pode trocar de carta sem desmontar).
  const fallback = found?.key === searchKey ? found.url : undefined;
  const searching = needsFallback && canSearch && found?.key !== searchKey;

  useEffect(() => {
    if (!needsFallback || !canSearch) return;
    let alive = true;
    (async () => {
      const fromScrydex = cardId ? await scrydexImage(cardId, localId, nameEn).catch(() => null) : null;
      const imgs = fromScrydex ?? (nameEn && setNameEn ? await ptcgImage(nameEn, setNameEn, localId).catch(() => undefined) : undefined);
      if (!alive) return;
      setFound({ key: searchKey, url: imgs ? (quality === 'high' ? imgs.large : imgs.small) : undefined });
      if (imgs) onResolved?.(imgs.large);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onResolved pode mudar a cada render
  }, [needsFallback, canSearch, searchKey, cardId, nameEn, setNameEn, localId, quality]);

  const src = needsFallback ? fallback : primary;
  const faint = dark ? binderColors.textFaint : colors.textFaint;
  if (!src) {
    return (
      <View style={[styles.placeholder, dex ? styles.placeholderArt : null]}>
        {dex ? <Image source={spriteUrl(dex)} style={styles.sprite} contentFit="contain" /> : null}
        <Ionicons name={searching ? 'hourglass-outline' : 'image-outline'} size={compact ? 16 : 22} color={faint} />
        {label || !compact ? (
          <Text style={[styles.noImg, { color: faint }]} numberOfLines={3}>
            {label ?? (searching ? 'Buscando imagem…' : 'Sem imagem')}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <Image
      source={src}
      style={StyleSheet.absoluteFill}
      contentFit={contentFit}
      transition={150}
      onError={() => (src === primary ? setFailed(primary) : setFound({ key: searchKey }))}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 4 },
  placeholderArt: { justifyContent: 'flex-end', paddingBottom: 10 },
  sprite: { position: 'absolute', top: '12%', left: '10%', width: '80%', height: '60%', opacity: 0.22 },
  noImg: { color: colors.textFaint, textAlign: 'center', fontSize: 11, paddingHorizontal: 4 },
});
