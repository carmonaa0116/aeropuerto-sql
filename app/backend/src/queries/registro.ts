import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { QUERIES_DIR } from '../paths.js';

/**
 * Registro de Q01-Q10: qué parámetros admite cada una (validados con zod),
 * en qué orden van a los ? del SQL y cuánto tiempo/caché se le da.
 * El SQL está en qNN.sql (copia literal de sql/04_consultas_avanzadas.sql).
 */

// Rango de datos: BTS de enero de 2026 en UTC. El 31-12-2025 y el 01-02-2026 son
// días parciales (horas UTC que caen fuera de enero), por eso se limita a enero.
export const DIA_MIN = '2026-01-01';
export const DIA_MAX = '2026-01-31';

const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD')
  .refine((d) => d >= DIA_MIN && d <= DIA_MAX, `Debe estar entre ${DIA_MIN} y ${DIA_MAX} (UTC)`);

const entero = (min: number, max: number, defecto: number) =>
  z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int('Debe ser un número entero').min(min, `Mínimo ${min}`).max(max, `Máximo ${max}`).default(defecto);

function diaSiguiente(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Descripción de un parámetro para que el frontend pinte el formulario. */
export interface ParamUI {
  nombre: string;
  etiqueta: string;
  tipo: 'entero' | 'fecha' | 'aeropuerto';
  defecto: string | number;
  min?: number | string;
  max?: number | string;
  ayuda?: string;
}

export type Valor = string | number;

export interface DefConsulta {
  id: string; // "q01"
  numero: string; // "Q01"
  parametros: ParamUI[];
  esquema: z.ZodType<Record<string, unknown>>;
  /** Valores para los ? del SQL, en orden. */
  valores: (p: Record<string, unknown>) => Valor[];
  /** Por qué no tiene parámetros (si no los tiene). */
  sinParametros?: string;
  timeoutMs: number;
  cacheTtlMs: number;
  sql: string;
}

const MIN = 60_000;

function leerSql(id: string): string {
  return fs
    .readFileSync(path.join(QUERIES_DIR, `${id}.sql`), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .trim();
}

const rangoFechas = <T extends z.ZodRawShape>(extra: T) =>
  z
    .object({ desde: fecha.default(DIA_MIN), hasta: fecha.default(DIA_MAX), ...extra })
    .strict()
    .refine((p) => String(p.desde) <= String(p.hasta), { message: '"desde" no puede ser posterior a "hasta"', path: ['hasta'] });

const pDesde: ParamUI = { nombre: 'desde', etiqueta: 'Desde (UTC)', tipo: 'fecha', defecto: DIA_MIN, min: DIA_MIN, max: DIA_MAX };
const pHasta: ParamUI = { nombre: 'hasta', etiqueta: 'Hasta (UTC)', tipo: 'fecha', defecto: DIA_MAX, min: DIA_MIN, max: DIA_MAX };
const pTop = (defecto: number): ParamUI => ({ nombre: 'top', etiqueta: 'Top N', tipo: 'entero', defecto, min: 1, max: 100 });

const definiciones: Omit<DefConsulta, 'sql'>[] = [
  {
    id: 'q01',
    numero: 'Q01',
    parametros: [],
    esquema: z.object({}).strict(),
    valores: () => [],
    sinParametros: 'Es un ranking del conjunto: filtrar por aerolínea dejaría un ranking de una sola fila y cambiaría la media de referencia.',
    timeoutMs: 20_000,
    cacheTtlMs: 10 * MIN,
  },
  {
    id: 'q02',
    numero: 'Q02',
    parametros: [
      { nombre: 'minSalidas', etiqueta: 'Mínimo de salidas', tipo: 'entero', defecto: 3000, min: 100, max: 20000, ayuda: 'Solo entran los aeropuertos con al menos estas salidas en el mes' },
    ],
    esquema: z.object({ minSalidas: entero(100, 20000, 3000) }).strict(),
    valores: (p) => [p.minSalidas as Valor],
    timeoutMs: 20_000,
    cacheTtlMs: 10 * MIN,
  },
  {
    id: 'q03',
    numero: 'Q03',
    parametros: [],
    esquema: z.object({}).strict(),
    valores: () => [],
    sinParametros: 'Mide un porcentaje sobre todos los vuelos: un filtro cortaría las cadenas de vuelos del mismo avión y cambiaría el resultado.',
    timeoutMs: 30_000,
    cacheTtlMs: 10 * MIN,
  },
  {
    id: 'q04',
    numero: 'Q04',
    parametros: [{ ...pDesde }, { ...pHasta }],
    esquema: rangoFechas({}),
    valores: (p) => [p.desde as Valor, p.hasta as Valor],
    timeoutMs: 20_000,
    cacheTtlMs: 10 * MIN,
  },
  {
    id: 'q05',
    numero: 'Q05',
    parametros: [
      { ...pDesde },
      { ...pHasta },
      { nombre: 'minSalidas', etiqueta: 'Mín. salidas al día', tipo: 'entero', defecto: 20, min: 1, max: 500, ayuda: 'Un día cuenta si el aeropuerto tuvo al menos estas salidas' },
      { nombre: 'umbral', etiqueta: 'Retraso medio > (min)', tipo: 'entero', defecto: 20, min: 0, max: 180, ayuda: 'Un día es "malo" si su retraso medio de salida supera este valor' },
      { ...pTop(10), max: 50 },
    ],
    esquema: rangoFechas({ minSalidas: entero(1, 500, 20), umbral: entero(0, 180, 20), top: entero(1, 50, 10) }),
    valores: (p) => [p.desde as Valor, p.hasta as Valor, p.minSalidas as Valor, p.umbral as Valor, p.top as Valor],
    timeoutMs: 20_000,
    cacheTtlMs: 10 * MIN,
  },
  {
    id: 'q06',
    numero: 'Q06',
    parametros: [
      { nombre: 'aeropuerto', etiqueta: 'Aeropuerto de salida (IATA)', tipo: 'aeropuerto', defecto: 'ATL' },
      { nombre: 'dia', etiqueta: 'Día (UTC)', tipo: 'fecha', defecto: '2026-01-15', min: DIA_MIN, max: DIA_MAX },
    ],
    esquema: z
      .object({
        aeropuerto: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9]{3}$/, 'Código IATA de 3 caracteres')
          .default('ATL'),
        dia: fecha.default('2026-01-15'),
      })
      .strict(),
    valores: (p) => [p.aeropuerto as Valor, `${p.dia} 00:00:00`, `${diaSiguiente(String(p.dia))} 00:00:00`],
    sinParametros: undefined,
    timeoutMs: 60_000,
    cacheTtlMs: 30 * MIN,
  },
  {
    id: 'q07',
    numero: 'Q07',
    parametros: [pTop(15)],
    esquema: z.object({ top: entero(1, 100, 15) }).strict(),
    valores: (p) => [p.top as Valor],
    timeoutMs: 20_000,
    cacheTtlMs: 10 * MIN,
  },
  {
    id: 'q08',
    numero: 'Q08',
    parametros: [],
    esquema: z.object({}).strict(),
    valores: () => [],
    sinParametros: 'WITH ROLLUP calcula subtotales por aerolínea y el total global: filtrar dejaría esos totales a medias.',
    timeoutMs: 20_000,
    cacheTtlMs: 10 * MIN,
  },
  {
    id: 'q09',
    numero: 'Q09',
    parametros: [pTop(15)],
    esquema: z.object({ top: entero(1, 100, 15) }).strict(),
    valores: (p) => [p.top as Valor],
    timeoutMs: 20_000,
    cacheTtlMs: 10 * MIN,
  },
  {
    id: 'q10',
    numero: 'Q10',
    parametros: [
      { nombre: 'minVuelos', etiqueta: 'Mínimo de vuelos', tipo: 'entero', defecto: 3, min: 1, max: 20, ayuda: 'Vuelos distintos de la muestra con billete' },
      pTop(15),
    ],
    esquema: z.object({ minVuelos: entero(1, 20, 3), top: entero(1, 100, 15) }).strict(),
    valores: (p) => [p.minVuelos as Valor, p.top as Valor],
    timeoutMs: 20_000,
    cacheTtlMs: 10 * MIN,
  },
];

export const consultas: Map<string, DefConsulta> = new Map(
  definiciones.map((d) => [d.id, { ...d, sql: leerSql(d.id) }]),
);

/** Valores por defecto de una consulta (los del SQL original). */
export function parametrosPorDefecto(id: string): Record<string, unknown> {
  const def = consultas.get(id);
  if (!def) throw new Error(`Consulta desconocida: ${id}`);
  return def.esquema.parse({});
}
