import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

import { JAPANESE, ENGLISH, catalogNumber, stampVariant } from '@/lib/catalog';
import { useLookupIndex } from '@/lib/lookup-index';
import type { LookupCard, LookupHeader, LookupLang, MypKeys, MypNow } from '@/lib/lookup-types';
import { mypKeysFromParts } from '@/lib/myp-api';
import { consultMypNow, type MypLimitBy } from '@/lib/myp-queue';
import { mypFitsVariant } from '@/lib/valuation';

/** Chaves da busca no MYP tiradas só do índice: nenhuma chamada à TCGdex. */
export function mypKeysFor(card: LookupCard, header: LookupHeader): MypKeys {
  const td = card.tcgdexId;
  const cut = td ? td.lastIndexOf('-') : -1;
  const tcgdexSetId = cut > 0 ? td!.slice(0, cut) : undefined;
  const total = Number(card.number.split('/')[1]) || card.set.total || undefined;
  const variant = card.stamp ? stampVariant(card.stamp, card.set.lang === 'ja' ? JAPANESE : ENGLISH) : 'normal';
  const keys = mypKeysFromParts({
    nameEn: card.name,
    namePt: card.ptName,
    tcgdexSetId,
    officialAbbr: tcgdexSetId ? header.tdAbbr.get(tcgdexSetId) : null,
    groupAbbr: card.set.abbr,
    groupName: card.set.name,
    localId: cut > 0 ? td!.slice(cut + 1) : catalogNumber(card.number),
    originalNumber: catalogNumber(card.number) || undefined,
    total,
  });
  return {
    ...keys,
    cardId: td ?? (card.productId != null ? `tcgp-${card.productId}` : card.key),
    variant,
    note: (variant === 'wPromo' || variant === 'staff') && card.stamp ? card.stamp : '',
  };
}

/** Espera depois de abrir a folha: passar por várias cartas seguidas não gasta consulta. */
const OPEN_DELAY_MS = 300;
/**
 * Com o teclado aberto, a carta na tela pode ser só um passo da digitação ("OBF 1" e "OBF 12" a caminho de "OBF 125"):
 * espera o campo parar por 1 s. Fechar o teclado libera a consulta na hora.
 */
const TYPING_DELAY_MS = 1000;

const IDLE: MypNow = { status: 'idle' };
const LOADING: MypNow = { status: 'loading' };
const ON_WEB: MypNow = { status: 'unavailable', reason: 'web' };
const OTHER_LANGUAGE: MypNow = { status: 'unavailable', reason: 'language' };

const canConsult = (lang: LookupLang) => Platform.OS !== 'web' && (lang === 'pt' || lang === 'en');

/** Teclado aberto? Começa pelo estado atual: a carta pode aparecer com ele já aberto. */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(() => Platform.OS !== 'web' && Keyboard.isVisible());
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

/** Preço do MYP na hora, em PT e EN, só no celular. JP, KO e ZH ficam só com o link; na web, a API não atende. */
export function useMypNow(card: LookupCard | null, lang: LookupLang): MypNow {
  const { header } = useLookupIndex();
  const [result, setResult] = useState<{ request: string; now: MypNow } | null>(null);
  // A carta é identificada pela chave: outra instância da mesma linha não dispara nova consulta.
  const request = card && header && canConsult(lang) ? `${card.key}|${lang}` : null;
  const wait = useKeyboardOpen() ? TYPING_DELAY_MS : OPEN_DELAY_MS;
  // A espera em curso relê o tempo quando o teclado abre ou fecha (a consulta já feita não se repete).
  const waitRef = useRef(wait);
  const rewait = useRef<(() => void) | null>(null);
  useEffect(() => {
    waitRef.current = wait;
    rewait.current?.();
  }, [wait]);

  useEffect(() => {
    if (!request || !card || !header) return;
    let alive = true;
    let ticker: ReturnType<typeof setInterval> | undefined;
    const show = (now: MypNow) => setResult({ request, now });

    const keys = mypKeysFor(card, header);
    const consult = async () => {
      const answer = await consultMypNow(keys);
      if (!alive) return;
      if ('offline' in answer) return show({ status: 'unavailable', reason: 'offline' });
      if ('failed' in answer) return show({ status: 'unavailable', reason: 'error' });
      if ('blocked' in answer) return show({ status: 'unavailable', reason: 'blocked' });
      if ('limitedForMs' in answer) return countDown(answer.limitedForMs, answer.by);
      const p = answer.price;
      // Selo ou Poké Ball sem produto próprio: o preço seria o da carta base, e nunca o de outra versão sem aviso.
      if (p.notFound || (!p.ownVersion && !mypFitsVariant(keys.variant))) return show({ status: 'notFound' });
      show({ status: 'ok', min: p.min ?? null, avg: p.avg ?? null, max: p.max ?? null, qty: p.qty, url: p.url, at: p.checkedAt });
    };

    // Conta a pausa na tela e tenta de novo quando ela acaba, se a folha continuar aberta.
    const countDown = (ms: number, by: MypLimitBy) => {
      const until = Date.now() + ms;
      const left = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
      show({ status: 'limited', retryInS: left(), by });
      ticker = setInterval(() => {
        const s = left();
        if (s > 0) return show({ status: 'limited', retryInS: s, by });
        clearInterval(ticker);
        show(LOADING);
        void consult();
      }, 1000);
    };

    const startedAt = Date.now();
    const start = () => {
      rewait.current = null;
      void consult();
    };
    let timer = setTimeout(start, waitRef.current);
    rewait.current = () => {
      clearTimeout(timer);
      timer = setTimeout(start, Math.max(0, startedAt + waitRef.current - Date.now()));
    };
    return () => {
      alive = false;
      rewait.current = null;
      clearTimeout(timer);
      clearInterval(ticker);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, header]);

  // O que não depende de consulta sai no próprio desenho; outra carta nunca mostra o preço da anterior.
  if (!card || !header) return IDLE;
  if (Platform.OS === 'web') return ON_WEB;
  if (lang !== 'pt' && lang !== 'en') return OTHER_LANGUAGE;
  return result?.request === request ? result.now : LOADING;
}
