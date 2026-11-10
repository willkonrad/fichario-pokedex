import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useEffectEvent, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Skeleton } from '@/components/skeleton';
import { ptcgImage, scrydexImage } from '@/lib/ptcg';
import { spriteUrl } from '@/data/pokedex';
import { catalogImage } from '@/lib/catalog';
import { useStampImage } from '@/lib/stamp-image';
import { cardImage, catalogPhoto, zukanCatalogImage, zukanImage } from '@/lib/tcgdex';
import { binderColors, colors } from '@/theme';

/** O texto do bolso cresce com a fonte do sistema até 1,3× (acima disso, o preço e o nome seriam cortados). */
export const POCKET_FONT_SCALE = 1.3;

type Quality = 'low' | 'high';

/**
 * Imagem reserva pelo id da carta (sem imagem da TCGdex), na ordem:
 *   1. foto da TCGplayer da versão comum, pelo catálogo do TCGCSV (oficial, já em tamanho pequeno para o fichário);
 *   2. Scrydex pelo id da carta (não depende da API da pokemontcg.io, que cai com frequência);
 *   3. pokemontcg.io por nome em inglês + coleção (para coleções com id diferente);
 *   4. Zukan (cartas novas que nenhuma das outras tem ainda, ex.: coleção me06), também para a carta só do catálogo
 *      ("tcgp-") de coleção nova, enquanto a TCGplayer não publica a foto dela.
 */
async function fallbackImages(cardId?: string, nameEn?: string, setNameEn?: string, localId?: string) {
  const catalogOnly = cardId?.startsWith('tcgp-') ? cardId : undefined;
  const id = catalogOnly ? undefined : cardId;
  const fromCatalog = id ? await catalogPhoto(id).catch(() => null) : null;
  if (fromCatalog) return { small: catalogImage(fromCatalog, 'low'), large: fromCatalog };
  const fromScrydex = id ? await scrydexImage(id, localId, nameEn).catch(() => null) : null;
  if (fromScrydex) return fromScrydex;
  const fromPtcg = nameEn && setNameEn ? await ptcgImage(nameEn, setNameEn, localId).catch(() => undefined) : undefined;
  if (fromPtcg) return fromPtcg;
  if (catalogOnly) return zukanCatalogImage(catalogOnly).catch(() => null);
  return id ? await zukanImage(id).catch(() => null) : null;
}

/** Versão pequena da mesma imagem (para aparecer na hora, enquanto a grande chega), se houver uma. */
function lowVersion(url: string) {
  const low = catalogImage(url, 'low').replace(/\/high\.webp$/, '/low.webp');
  return low !== url ? low : undefined;
}

/**
 * Endereço da imagem que o fichário mostra para a carta (o mesmo que a CardImage escolhe primeiro), para baixar antes,
 * ex.: as miniaturas das páginas vizinhas.
 */
export function cardImageUrl(c: { image?: string; imageUrl?: string; photo?: string; ptImage?: string }, quality: Quality = 'low') {
  if (c.photo) return catalogImage(c.photo, quality);
  if (c.ptImage) return c.ptImage;
  if (c.image) return cardImage(c.image, quality);
  if (c.imageUrl) return catalogImage(c.imageUrl, quality);
  return undefined;
}

/** Baixa as imagens antes de aparecerem (ficam no cache de memória e de disco), sem esperar nem avisar erro. */
export function prefetchCardImages(urls: (string | undefined)[]) {
  const list = [...new Set(urls.filter((u): u is string => !!u))];
  if (list.length) Image.prefetch(list, 'memory-disk').catch(() => {});
}

/**
 * Imagem da carta, na ordem:
 *   0. foto em português do MYP (`ptImage`), para carta em português que a TCGdex só tem em inglês;
 *   1. TCGdex (`image`);
 *   2. `imageUrl` já resolvida antes (reserva salva na carta);
 *   3. as reservas pelo id (catálogo do TCGCSV, Scrydex, pokemontcg.io, Zukan; ver fallbackImages).
 * Versão com selo: a foto oficial dela vem antes de todas — a já conhecida (`photo`) ou, sem ela, a procurada pelos
 * selos (`stampKeys`) —, sempre no tamanho pedido.
 * Se a imagem carregada falhar, passa para a próxima fonte. Enquanto carrega, fica por baixo o fundo da carta (arte do
 * Pokémon esmaecida e o nome; com `skeleton`, também um esqueleto pulsando); na qualidade alta, a versão pequena (já no
 * cache da lista/fichário) aparece na hora.
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
  labelMaxScale,
  dex,
  dark = false,
  stampKeys,
  photo,
  ptImage,
  recyclingKey,
  priority,
  skeleton = false,
  onResolved,
  onLoad,
}: {
  image?: string;
  imageUrl?: string;
  cardId?: string;
  nameEn?: string;
  setNameEn?: string;
  localId?: string;
  quality?: Quality;
  contentFit?: 'cover' | 'contain';
  /** Espaço pequeno (fichário): ícone menor e só o `label`, sem "Sem imagem". */
  compact?: boolean;
  /** Texto mostrado quando não há imagem ou enquanto ela carrega (ex.: nome da carta no fichário). */
  label?: string;
  /** Até quanto o `label` cresce com a fonte do sistema (ex.: o texto dentro do bolso). */
  labelMaxScale?: number;
  /** Pokémon da carta: sem imagem (ou enquanto carrega), mostra a arte dele esmaecida no lugar. */
  dex?: number;
  /** Sobre fundo escuro (página do fichário). */
  dark?: boolean;
  /** Avisa a URL encontrada na reserva, para ser guardada na carta. */
  onResolved?: (url: string) => void;
  /** Versão com selo: mostra a foto oficial dela (TCGplayer, via TCGCSV) quando existir. */
  stampKeys?: string[];
  /** Foto oficial já conhecida da versão com selo (vem antes de tudo; dispensa a busca pelos selos). */
  photo?: string;
  /** Foto da carta em português (MYP), antes da imagem da TCGdex em inglês. */
  ptImage?: string;
  /** Identidade do bolso/célula (listas que reaproveitam a vista): troca de carta não mostra a imagem anterior. */
  recyclingKey?: string;
  /** Prioridade do download (ex.: 'high' para a carta grande da tela da carta). */
  priority?: 'low' | 'normal' | 'high';
  /**
   * Esqueleto pulsando enquanto a imagem carrega ou a reserva é procurada (H1), no lugar do "Buscando imagem…": para
   * grades e listas. Sem imagem nenhuma, fica o "Sem imagem" de sempre.
   */
  skeleton?: boolean;
  /** Imagem na tela (ex.: o bolso só mostra a borda especial e o preço depois disso). */
  onLoad?: () => void;
}) {
  // Com a foto da versão já conhecida, a Edge Function stamp-image não é chamada.
  const stampFromSource = useStampImage(photo ? undefined : cardId, stampKeys);
  const stampSource = photo ?? stampFromSource;
  const stampPhoto = stampSource ? catalogImage(stampSource, quality) : undefined;
  const [stampFailed, setStampFailed] = useState<string | undefined>();
  // Foto em português do MYP: o MYP às vezes informa o endereço de uma foto que não existe; se falhar, volta para a
  // imagem normal (TCGdex), sem passar pelas reservas.
  const [ptFailed, setPtFailed] = useState<string | undefined>();
  const usePt = !!ptImage && ptFailed !== ptImage;
  const primary = usePt ? ptImage : image ? cardImage(image, quality) : imageUrl ? catalogImage(imageUrl, quality) : undefined;
  const [failed, setFailed] = useState<string | undefined>();
  const [found, setFound] = useState<{ key: string; url?: string } | undefined>();
  const [loaded, setLoaded] = useState<string | undefined>();
  const needsFallback = !primary || failed === primary;
  const canSearch = !!cardId || !!(nameEn && setNameEn);
  // Busca da reserva em andamento = ainda não terminou a busca desta carta.
  const searchKey = `${cardId}|${nameEn}|${setNameEn}|${localId}`;
  // Só vale a reserva achada para ESTA carta (a tela da carta pode trocar de carta sem desmontar).
  const fallback = found?.key === searchKey ? found.url : undefined;
  const searching = needsFallback && canSearch && found?.key !== searchKey;
  const resolved = useEffectEvent((url: string) => onResolved?.(url));

  useEffect(() => {
    if (!needsFallback || !canSearch) return;
    let alive = true;
    (async () => {
      const imgs = await fallbackImages(cardId, nameEn, setNameEn, localId);
      if (!alive) return;
      setFound({ key: searchKey, url: imgs ? (quality === 'high' ? imgs.large : imgs.small) : undefined });
      if (imgs) resolved(imgs.large);
    })();
    return () => {
      alive = false;
    };
  }, [needsFallback, canSearch, searchKey, cardId, nameEn, setNameEn, localId, quality]);

  const useStamp = !!stampPhoto && stampFailed !== stampPhoto;
  const src = useStamp ? stampPhoto : needsFallback ? fallback : primary;
  const faint = dark ? binderColors.textFaint : colors.textFaint;
  if (!src) {
    // Procurando a reserva, com esqueleto: só ele (e a arte do Pokémon), sem o ícone e o texto de espera.
    const waiting = skeleton && searching;
    return (
      <View style={[styles.placeholder, dex ? styles.placeholderArt : null]}>
        {waiting ? <Skeleton radius={0} tone={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : null}
        {dex ? <Image source={spriteUrl(dex)} style={styles.sprite} contentFit="contain" cachePolicy="memory-disk" /> : null}
        {waiting ? null : (
          <Ionicons name={searching ? 'hourglass-outline' : 'image-outline'} size={compact ? 16 : 22} color={dark ? faint : colors.iconFaint} />
        )}
        {!waiting && (label || !compact) ? (
          <Text style={[styles.noImg, { color: faint }]} numberOfLines={3} maxFontSizeMultiplier={labelMaxScale}>
            {label ?? (searching ? 'Buscando imagem…' : 'Sem imagem')}
          </Text>
        ) : null}
      </View>
    );
  }
  const low = quality === 'high' ? lowVersion(src) : undefined;
  return (
    <>
      {/* Fundo enquanto a imagem chega: a arte do Pokémon e o nome da carta, para o bolso não parecer vazio. */}
      {loaded !== src ? (
        <View style={[styles.placeholder, styles.backdrop, dex ? styles.placeholderArt : null]}>
          {skeleton ? <Skeleton radius={0} tone={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : null}
          {dex ? <Image source={spriteUrl(dex)} style={styles.sprite} contentFit="contain" cachePolicy="memory-disk" /> : null}
          {label ? (
            <Text style={[styles.noImg, { color: faint }]} numberOfLines={3} maxFontSizeMultiplier={labelMaxScale}>
              {label}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Image
        source={src}
        placeholder={low}
        placeholderContentFit={contentFit}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        transition={quality === 'high' ? 200 : 140}
        cachePolicy="memory-disk"
        recyclingKey={recyclingKey}
        priority={priority}
        onLoad={() => {
          setLoaded(src);
          onLoad?.();
        }}
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
    </>
  );
}

const styles = StyleSheet.create({
  placeholder: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 4 },
  placeholderArt: { justifyContent: 'flex-end', paddingBottom: 10 },
  // No estilo (e não como propriedade), que a web marca como obsoleta.
  backdrop: { pointerEvents: 'none' },
  sprite: { position: 'absolute', top: '12%', left: '10%', width: '80%', height: '60%', opacity: 0.22 },
  noImg: { color: colors.textFaint, textAlign: 'center', fontSize: 11, paddingHorizontal: 4 },
});
