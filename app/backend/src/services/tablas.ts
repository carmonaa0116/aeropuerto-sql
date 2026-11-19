import { CIFRAS_REFERENCIA } from './cordura.js';

/**
 * Las 21 tablas agrupadas por bloques (contexto del proyecto, sección 2).
 * Es la lista fija de tablas que la app puede nombrar en un SQL: nunca llega
 * un nombre de tabla desde el navegador sin pasar por aquí.
 */
export const BLOQUES: { bloque: string; tablas: string[] }[] = [
  { bloque: 'Catálogos', tablas: ['pais', 'aeropuerto', 'aerolinea', 'modelo_aeronave', 'aeronave', 'clase_cabina'] },
  { bloque: 'Infraestructura', tablas: ['terminal', 'puerta_embarque', 'pista'] },
  { bloque: 'Operaciones', tablas: ['ruta', 'vuelo', 'evento_vuelo'] },
  { bloque: 'Personal', tablas: ['empleado', 'tripulacion_vuelo'] },
  { bloque: 'Ventas', tablas: ['pasajero', 'reserva', 'billete', 'tarjeta_embarque', 'equipaje'] },
  { bloque: 'Mantenimiento', tablas: ['mantenimiento'] },
  { bloque: 'Incidencias', tablas: ['incidencia'] },
];

export const TABLAS: string[] = BLOQUES.flatMap((b) => b.tablas);

export const BLOQUE_DE: Record<string, string> = Object.fromEntries(
  BLOQUES.flatMap((b) => b.tablas.map((t) => [t, b.bloque])),
);

// Las dos listas deben ser las mismas 21 tablas
if (TABLAS.length !== 21 || TABLAS.some((t) => !(t in CIFRAS_REFERENCIA))) {
  throw new Error('BLOQUES y CIFRAS_REFERENCIA no coinciden');
}
