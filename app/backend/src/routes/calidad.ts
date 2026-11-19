import { Router } from 'express';
import { z } from 'zod';
import { ejecutarLectura } from '../db.js';
import { README_REPO } from '../paths.js';
import { conCache, invalidar } from '../services/cache.js';
import { elementosLista, leerDoc } from '../services/markdown.js';
import { claveRama, scriptVerificacion } from '../services/verificacionSql.js';
import { senalCliente } from './consultas.js';

export const rutasCalidad = Router();

// La app solo LEE los resultados que dejó sql/verificar_aeropuerto.sql; no lo reejecuta (tarda minutos).
export const SQL_CALIDAD = `SELECT id, seccion, comprobacion, regla, esperado, valor, estado
FROM aeropuerto_verif.verificacion
ORDER BY id`;

// La tabla se borra y se crea en cada ejecución del script: su fecha de creación es la de la última ejecución
export const SQL_EJECUCION = `SELECT CREATE_TIME AS creada
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'aeropuerto_verif' AND TABLE_NAME = 'verificacion'`;

const ESTADOS = ['FALLO', 'REVISAR', 'OK', 'INFO'] as const;
const esquema = z.object({ fresco: z.literal('1').optional() }).strict();
const CLAVE = 'calidad';

rutasCalidad.get('/', async (req, res) => {
  const { fresco } = esquema.parse(req.query);
  if (fresco) invalidar(CLAVE);

  let datos;
  try {
    datos = await conCache(
      CLAVE,
      5 * 60_000,
      async (signal) => ({
        filas: await ejecutarLectura(SQL_CALIDAD, [], { timeoutMs: 10_000, signal }),
        ejecucion: await ejecutarLectura(SQL_EJECUCION, [], { timeoutMs: 10_000, signal }),
      }),
      senalCliente(req, res),
    );
  } catch (e) {
    const errno = (e as { errno?: number }).errno;
    if (errno === 1146 || errno === 1049) {
      res.status(404).json({
        error:
          'No hay resultados de verificación: falta aeropuerto_verif.verificacion. Ejecuta sql/verificar_aeropuerto.sql entero en Workbench (Ctrl+Shift+Enter).',
        codigo: errno,
      });
      return;
    }
    throw e;
  }

  const { valor, desdeCache } = datos;
  const script = scriptVerificacion();
  const filas = valor.filas.filas.map((f) => ({
    ...(f as { id: number; seccion: string; comprobacion: string; regla: string; esperado: number | null; valor: number | null; estado: string | null }),
    sql: script.ramas.get(claveRama(String(f.seccion), String(f.comprobacion))) ?? null,
  }));

  const resumen = Object.fromEntries(ESTADOS.map((e) => [e, filas.filter((f) => f.estado === e).length]));
  const secciones = [...new Set(filas.map((f) => String(f.seccion)))];

  const readme = leerDoc(README_REPO);
  const lim = readme.secciones.find((s) => /limitaciones/i.test(s.titulo));

  res.json({
    filas,
    total: filas.length,
    resumen,
    secciones,
    reglas: script.reglas,
    creada: valor.ejecucion.filas[0]?.creada ?? null,
    limitaciones: lim ? elementosLista(lim.md) : [],
    archivoLimitaciones: `${readme.archivo} · ${lim?.titulo ?? ''}`,
    ms: Math.round(valor.filas.ms),
    desdeCache,
    sql: { lectura: SQL_CALIDAD, ejecucion: SQL_EJECUCION, estado: script.sqlEstado, archivo: 'sql/verificar_aeropuerto.sql' },
  });
});
