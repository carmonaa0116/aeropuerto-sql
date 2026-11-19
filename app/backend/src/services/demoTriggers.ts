import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { SQL_DEMO_TRIGGERS, SQL_TRIGGERS } from '../paths.js';
import { TABLAS } from './tablas.js';

/**
 * Catálogo de la demo de triggers. El SQL NO se escribe aquí: se lee de
 *  - app/backend/sql/01_demo_triggers.sql (bloques [preparacion] y [caso:...])
 *  - sql/01-03_triggers_*.sql (cuerpo de cada trigger y de cada sp_validar_*)
 * Los mensajes esperados son los de los SIGNAL de sql/01-03 con los datos de
 * prueba de la demo (vuelo #D001); un test comprueba que salen de esos archivos.
 */
export interface CasoDemo {
  id: string;
  titulo: string;
  bloque: 'Vuelo' | 'Ventas' | 'Tripulación' | 'Contraste';
  regla: string;
  escenario: string;
  /** Qué objeto de la base rechaza (o valida) la sentencia */
  validadores: string[];
  esperado: { resultado: 'error' | 'ok'; errno: number | null; mensaje: string | null };
}

export const CASOS: CasoDemo[] = [
  {
    id: 'puerta_ocupada',
    titulo: 'Puerta ocupada',
    bloque: 'Vuelo',
    regla:
      'Una puerta está ocupada desde 45 min antes de la salida prevista hasta 10 min después de la salida (la real, si es más tarde), y debe ser del aeropuerto de origen. Dos vuelos no cancelados no pueden compartir esa ventana.',
    escenario:
      '#D001 sale a las 10:00 por la puerta #A1, que queda ocupada de 09:15 a 10:10. Se intenta otro vuelo por la misma puerta a las 10:30 (ocuparía de 09:45 a 10:40).',
    validadores: ['trg_vuelo_bi', 'sp_validar_puerta'],
    esperado: { resultado: 'error', errno: 1644, mensaje: 'Solape de puerta con el vuelo #D001' },
  },
  {
    id: 'pista_2min',
    titulo: 'Pista: salidas a menos de 2 min',
    bloque: 'Vuelo',
    regla: 'Dos salidas por la misma pista deben separarse al menos 2 minutos. La pista debe ser del aeropuerto de origen.',
    escenario: '#D001 sale a las 10:00 por la pista #09/27. Se intenta otra salida por la misma pista a las 10:01.',
    validadores: ['trg_vuelo_bi', 'sp_validar_pista'],
    esperado: { resultado: 'error', errno: 1644, mensaje: 'Pista ocupada: salida a menos de 2 min del vuelo #D001' },
  },
  {
    id: 'aeronave_solapada',
    titulo: 'Aeronave en dos vuelos a la vez',
    bloque: 'Vuelo',
    regla:
      'Una aeronave no puede estar en dos vuelos no cancelados cuyas horas previstas se solapen (tocarse, llegar a las 12:00 y salir a las 12:00, no es solapar).',
    escenario: 'TEST-D1 vuela #D001 de 10:00 a 12:00. Se intenta otro vuelo con TEST-D1 de 11:00 a 12:30.',
    validadores: ['trg_vuelo_bi', 'sp_validar_aeronave'],
    esperado: { resultado: 'error', errno: 1644, mensaje: 'La aeronave ya esta en el vuelo #D001 a esa hora' },
  },
  {
    id: 'aeronave_mantenimiento',
    titulo: 'Aeronave en mantenimiento',
    bloque: 'Vuelo',
    regla:
      'Una aeronave no puede volar durante una orden de mantenimiento. Si la orden está abierta (fecha_fin NULL), bloquea sin fecha de fin.',
    escenario: 'TEST-D1 tiene una revisión del 2 de enero 00:00 al 3 de enero 00:00. Se intenta un vuelo el 2 de enero de 10:00 a 11:00.',
    validadores: ['trg_vuelo_bi', 'sp_validar_aeronave'],
    esperado: { resultado: 'error', errno: 1644, mensaje: 'La aeronave esta en mantenimiento (revision demo) en ese horario' },
  },
  {
    id: 'overbooking',
    titulo: 'Overbooking',
    bloque: 'Ventas',
    regla:
      'Los billetes no cancelados de un vuelo no pueden superar la capacidad del modelo de aeronave. La fila del vuelo se bloquea con SELECT ... FOR UPDATE para que dos ventas simultáneas del último asiento no pasen las dos.',
    escenario: 'El modelo de la demo tiene 2 plazas y #D001 ya tiene 2 billetes (1A y 1B). Se intenta vender un tercero (1C).',
    validadores: ['trg_billete_bi', 'sp_validar_billete'],
    esperado: { resultado: 'error', errno: 1644, mensaje: 'Overbooking: el vuelo no tiene plazas libres' },
  },
  {
    id: 'billete_vuelo_cancelado',
    titulo: 'Billete en vuelo cancelado',
    bloque: 'Ventas',
    regla: 'No se venden billetes de un vuelo cancelado.',
    escenario: '#D003 está cancelado. Se intenta venderle un billete.',
    validadores: ['trg_billete_bi', 'sp_validar_billete'],
    esperado: { resultado: 'error', errno: 1644, mensaje: 'No se pueden vender billetes de un vuelo cancelado' },
  },
  {
    id: 'tripulacion_descanso',
    titulo: 'Tripulación sin descanso',
    bloque: 'Tripulación',
    regla:
      'Un tripulante ocupa un vuelo desde 60 min antes de la salida prevista hasta 45 min después de la llegada (real si existe). Dos asignaciones del mismo empleado no pueden solaparse; tocarse justo en el límite sí está permitido.',
    escenario:
      'El comandante de #D001 (10:00-12:00) está ocupado de 09:00 a 12:45. Se le asigna #D004, que sale a las 13:44: tendría que presentarse a las 12:44, un minuto antes de quedar libre.',
    validadores: ['trg_tripulacion_bi', 'sp_validar_descanso'],
    esperado: { resultado: 'error', errno: 1644, mensaje: 'Descanso insuficiente: choca con el vuelo #D001' },
  },
  {
    id: 'asiento_duplicado',
    titulo: 'Asiento duplicado (UNIQUE, no trigger)',
    bloque: 'Contraste',
    regla:
      'El asiento repetido no necesita trigger: lo impide la restricción UNIQUE (id_vuelo, asiento) de billete. Por eso el error es el 1062 de MySQL y no el 1644 de un SIGNAL.',
    escenario: 'El asiento 1A de #D002 ya está vendido. Se intenta vender otra vez a otro pasajero.',
    validadores: ['uq_billete_asiento'],
    esperado: { resultado: 'error', errno: 1062, mensaje: null },
  },
  {
    id: 'valido',
    titulo: 'Caso válido que pasa',
    bloque: 'Contraste',
    regla:
      'Un vuelo que respeta las tres reglas de vuelo (puerta, pista y aeronave) pasa el trigger. También se deshace con ROLLBACK.',
    escenario:
      'Vuelo con TEST-D2 por la puerta #A1 y la pista #09/27 a las 11:00. La puerta queda libre a las 10:10 y este vuelo la ocupa desde las 10:15; la pista y la aeronave están libres.',
    validadores: ['trg_vuelo_bi', 'sp_validar_puerta', 'sp_validar_pista', 'sp_validar_aeronave'],
    esperado: { resultado: 'ok', errno: null, mensaje: null },
  },
];

export const IDS_CASOS = CASOS.map((c) => c.id) as [string, ...string[]];

// ------------------------------------------------------------------
// Lectura de los .sql (con caché por fecha de modificación)
// ------------------------------------------------------------------
export interface ScriptDemo {
  preparacion: string;
  casos: Map<string, string>;
  /** Tablas en las que escribe la preparación o el caso (para el COUNT antes/después) */
  tablasPorCaso: Map<string, string[]>;
}

const quitarIndentacion = (bloque: string): string => {
  const lineas = bloque.replace(/\s+$/, '').split('\n');
  while (lineas.length && !lineas[0].trim()) lineas.shift();
  const sangria = Math.min(...lineas.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lineas.map((l) => l.slice(sangria)).join('\n');
};

const tablasEscritas = (sql: string): string[] => {
  const out = new Set<string>();
  for (const m of sql.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?(\w+)`?/gi)) out.add(m[1].toLowerCase());
  return [...out];
};

export function analizarScriptDemo(texto: string): ScriptDemo {
  const t = texto.replace(/\r\n/g, '\n');
  const prep = /-- \[preparacion\]\n([\s\S]*?)\n[ \t]*-- \[\/preparacion\]/.exec(t);
  if (!prep) throw new Error('01_demo_triggers.sql: falta el bloque [preparacion]');
  const preparacion = quitarIndentacion(prep[1]);

  const casos = new Map<string, string>();
  for (const m of t.matchAll(/-- \[caso:(\w+)\]\n([\s\S]*?)\n[ \t]*-- \[\/caso\]/g)) {
    casos.set(m[1], quitarIndentacion(m[2]));
  }

  const tablasPorCaso = new Map<string, string[]>();
  const base = tablasEscritas(preparacion);
  for (const [id, sql] of casos) {
    const todas = [...new Set([...base, ...tablasEscritas(sql)])];
    // Solo tablas de la lista blanca: el nombre acaba en un COUNT(*) por escapeId
    const raras = todas.filter((x) => !TABLAS.includes(x));
    if (raras.length) throw new Error(`01_demo_triggers.sql escribe en tablas fuera de la lista: ${raras.join(', ')}`);
    tablasPorCaso.set(id, TABLAS.filter((x) => todas.includes(x)));
  }
  return { preparacion, casos, tablasPorCaso };
}

/** Cuerpos de CREATE TRIGGER / CREATE PROCEDURE de sql/01-03, por nombre */
export function analizarTriggers(textos: { archivo: string; texto: string }[]): Map<string, { archivo: string; sql: string }> {
  const out = new Map<string, { archivo: string; sql: string }>();
  for (const { archivo, texto } of textos) {
    const t = texto.replace(/\r\n/g, '\n');
    for (const m of t.matchAll(/^((?:--[^\n]*\n)*)CREATE (?:PROCEDURE|TRIGGER) (\w+)[\s\S]*?\nEND\$\$/gm)) {
      const sql = m[0].replace(/END\$\$$/, 'END;');
      out.set(m[2], { archivo, sql });
    }
  }
  return out;
}

let cacheDemo: { mtime: number; datos: ScriptDemo } | null = null;
export function scriptDemo(): ScriptDemo {
  const mtime = statSync(SQL_DEMO_TRIGGERS).mtimeMs;
  if (!cacheDemo || cacheDemo.mtime !== mtime) {
    cacheDemo = { mtime, datos: analizarScriptDemo(readFileSync(SQL_DEMO_TRIGGERS, 'utf8')) };
  }
  return cacheDemo.datos;
}

let cacheTrg: { clave: string; datos: Map<string, { archivo: string; sql: string }> } | null = null;
export function codigoTriggers(): Map<string, { archivo: string; sql: string }> {
  const clave = SQL_TRIGGERS.map((f) => statSync(f).mtimeMs).join('|');
  if (!cacheTrg || cacheTrg.clave !== clave) {
    cacheTrg = {
      clave,
      datos: analizarTriggers(SQL_TRIGGERS.map((f) => ({ archivo: `sql/${path.basename(f)}`, texto: readFileSync(f, 'utf8') }))),
    };
  }
  return cacheTrg.datos;
}
