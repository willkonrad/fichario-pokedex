import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ptcgImage, scrydexImage } from '@/lib/ptcg';
import { spriteUrl } from '@/data/pokedex';
import { catalogImage } from '@/lib/catalog';
import { useStampImage } from '@/lib/stamp-image';
import { cardImage, zukanImage } from '@/lib/tcgdex';
import { binderColors, colors } from '@/theme';

/**
 * Imagem da carta, na ordem:
 *   0. foto em português do MYP (`ptImage`), para carta em português que a TCGdex só tem em inglês;
 *   1. TCGdex (`image`);
 *   2. `imageUrl` já resolvida antes (reserva salva na carta);
 *   3. Scrydex pelo id da carta (não depende da API da pokemontcg.io, que cai com frequência);
 *   4. pokemontcg.io por nome em inglês + coleção (para coleções com id diferente);
 *   5. Zukan (cartas novas que nenhuma das outras tem ainda, ex.: coleção me06).
 * Versão com selo (`stampKeys`): a foto oficial dela vem antes de todas, quando existir.
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
  stampKeys,
  photo,
  ptImage,
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
  /** Versão com selo: mostra a foto oficial dela (TCGplayer, via TCGCSV) quando existir. */
  stampKeys?: string[];
  /** Foto oficial já conhecida da versão com selo (vem antes de tudo). */
  photo?: string;
  /** Foto da carta em português (MYP), antes da imagem da TCGdex em inglês. */
  ptImage?: string;
}) {
  const stampFromSource = useStampImage(cardId, stampKeys);
  const stampPhoto = photo ? catalogImage(photo, quality) : stampFromSource;
  const [stampFailed, setStampFailed] = useState<string | undefined>();
  // Foto em português do MYP: o MYP às vezes informa o endereço de uma foto que não existe; se falhar, volta para a
  // imagem normal (TCGdex), sem passar pelas reservas.
  const [ptFailed, setPtFailed] = useState<string | undefined>();
  const usePt = !!ptImage && ptFailed !== ptImage;
  const primary = usePt ? ptImage : image ? cardImage(image, quality) : imageUrl ? catalogImage(imageUrl, quality) : undefined;
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
      const imgs =
        fromScrydex ??
        (nameEn && setNameEn ? await ptcgImage(nameEn, setNameEn, localId).catch(() => undefined) : undefined) ??
        (cardId ? await zukanImage(cardId).catch(() => null) : null);
      if (!alive) return;
      setFound({ key: searchKey, url: imgs ? (quality === 'high' ? imgs.large : imgs.small) : undefined });
      if (imgs) onResolved?.(imgs.large);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onResolved pode mudar a cada render
  }, [needsFallback, canSearch, searchKey, cardId, nameEn, setNameEn, localId, quality]);

  const useStamp = !!stampPhoto && stampFailed !== stampPhoto;
  const src = useStamp ? stampPhoto : needsFallback ? fallback : primary;
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
      onError={() =>
        useStamp
          ? setStampFailed(stampPhoto)
          : usePt && src === ptImage
            ? setPtFailed(ptImage)
            : src === primary
              ? setFailed(primary)
              : setFound({ key: searchKey })
      }
    />
  );
}

const styles = StyleSheet.create({
  placeholder: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 4 },
  placeholderArt: { justifyContent: 'flex-end', paddingBottom: 10 },
  sprite: { position: 'absolute', top: '12%', left: '10%', width: '80%', height: '60%', opacity: 0.22 },
  noImg: { color: colors.textFaint, textAlign: 'center', fontSize: 11, paddingHorizontal: 4 },
});
