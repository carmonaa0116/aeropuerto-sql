import type { RowDataPacket } from 'mysql2/promise';
import { roPool } from '../db.js';

/**
 * Cifras de referencia del proyecto (contexto, sección 2; coinciden con los CSV).
 * Al arrancar se comparan unas cuantas: si el CRUD o una recarga las cambian,
 * se avisa por log (sin parar la app).
 */
export const CIFRAS_REFERENCIA: Record<string, number> = {
  pais: 240,
  aeropuerto: 5906,
  aerolinea: 1245,
  modelo_aeronave: 33,
  clase_cabina: 4,
  aeronave: 24063,
  terminal: 582,
  pista: 7276,
  ruta: 37806,
  puerta_embarque: 3470,
  vuelo: 355006,
  evento_vuelo: 1789348,
  empleado: 92828,
  tripulacion_vuelo: 1927914,
  pasajero: 100000,
  reserva: 383318,
  billete: 678760,
  tarjeta_embarque: 583797,
  equipaje: 333205,
  mantenimiento: 4944,
  incidencia: 42008,
};

// Las que se cuentan al arrancar (rápidas; las de ~2 M de filas se dejan fuera)
const AL_ARRANCAR = ['pais', 'aeropuerto', 'aerolinea', 'modelo_aeronave', 'aeronave', 'ruta', 'vuelo', 'empleado', 'pasajero', 'billete', 'mantenimiento'];

export async function contar(tabla: string): Promise<number> {
  // ?? = identificador escapado por mysql2; la tabla viene de una lista fija, no del usuario
  const [filas] = await roPool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ??', [tabla]);
  return Number(filas[0].n);
}

export async function comprobarCordura(): Promise<{ tabla: string; esperado: number; real: number }[]> {
  const diferencias: { tabla: string; esperado: number; real: number }[] = [];
  for (const tabla of AL_ARRANCAR) {
    const real = await contar(tabla);
    const esperado = CIFRAS_REFERENCIA[tabla];
    if (real !== esperado) diferencias.push({ tabla, esperado, real });
  }
  return diferencias;
}
