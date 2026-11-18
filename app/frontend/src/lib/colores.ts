import { useMemo } from 'react';
import { useTema } from './tema';

/**
 * Colores de las gráficas por ROL (no por valor): se leen de las variables CSS de
 * styles.css, que tienen un juego para claro y otro para oscuro. Paleta categórica
 * validada (orden fijo, apto para daltonismo en pares adyacentes) y rampa ordinal azul.
 */
export interface Colores {
  serie: string[]; // categóricos 1..4, orden fijo
  ordinal: string[]; // cuartil 1 (más intenso) .. cuartil 4
  neutro: string;
  rejilla: string;
  eje: string;
  tenue: string;
  texto: string;
  superficie: string;
}

export function useColores(): Colores {
  const { resuelto } = useTema();
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
      serie: [1, 2, 3, 4].map((i) => v(`--series-${i}`)),
      ordinal: [1, 2, 3, 4].map((i) => v(`--ord-${i}`)),
      neutro: v('--bar-neutral'),
      rejilla: v('--grid'),
      eje: v('--axis'),
      tenue: v('--text-muted'),
      texto: v('--text-2'),
      superficie: v('--surface'),
    };
    // resuelto: recalcula al cambiar de tema
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuelto]);
}
