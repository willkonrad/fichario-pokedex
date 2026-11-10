import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { warmLookup } from '@/lib/lookup-index';

/** Última vez que a Consulta esteve na frente (ms); apagada ao sair dela dentro do app. */
export const CONSULTA_LAST = 'consulta:last';

/** Com a Consulta usada há menos que isto, o app frio abre nela. */
export const COLD_OPEN_MS = 30 * 60 * 1000;
/** Na volta ao app, confere o manifesto de novo depois deste tempo. */
const RECHECK_MS = 6 * 60 * 60 * 1000;
/** Espera depois do primeiro desenho: a abertura do fichário vem antes. */
const FIRST_WARM_MS = 2000;

/** O app frio volta para a Consulta? (Só o número recente, de até 30 min; relógio voltando para trás não conta.) */
export function shouldReopenConsulta(lastRaw: string | null, now = Date.now()) {
  const last = Number(lastRaw);
  return !!lastRaw && Number.isFinite(last) && now >= last && now - last < COLD_OPEN_MS;
}

/**
 * Sem tela: deixa o índice da Consulta em dia no disco, 2 s depois da abertura e na volta ao app se a última olhada tem
 * mais de 6 h. Também devolve o app frio à Consulta, para quem estava num leilão. Na web, quem baixa é a própria tela.
 */
export function LookupWarmup() {
  return Platform.OS === 'web' ? null : <Warmup />;
}

function Warmup() {
  const pathname = usePathname();
  const lastCheck = useRef(0);
  // Só o caminho do primeiro desenho decide (um link direto, ou um toque durante a leitura, não é desviado).
  const firstPath = useRef(pathname);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(CONSULTA_LAST)
      .then((raw) => {
        if (alive && firstPath.current === '/' && shouldReopenConsulta(raw)) router.push('/consulta');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const check = () => {
      lastCheck.current = Date.now();
      warmLookup().catch(() => {});
    };
    const first = setTimeout(check, FIRST_WARM_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && lastCheck.current && Date.now() - lastCheck.current > RECHECK_MS) check();
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, []);

  return null;
}
