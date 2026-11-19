import { Router } from 'express';
import mysql from 'mysql2';
import { z } from 'zod';
import { ejecutarLectura } from '../db.js';
import { README_REPO } from '../paths.js';
import { conCache, invalidar } from '../services/cache.js';
import { CIFRAS_REFERENCIA } from '../services/cordura.js';
import { leerDoc } from '../services/markdown.js';
import { BLOQUE_DE, BLOQUES, TABLAS } from '../services/tablas.js';
import { senalCliente } from './consultas.js';

export const rutasProyecto = Router();

// README.md del repo troceado por secciones: la página de inicio lo pinta tal cual
rutasProyecto.get('/readme', (_req, res) => {
  res.json(leerDoc(README_REPO));
});

// Recuento exacto de las 21 tablas en una sola sentencia. Los nombres salen de la
// lista fija TABLAS y van escapados con escapeId (nunca vienen del navegador).
export const SQL_RECUENTO = TABLAS.map(
  (t) => `SELECT ${mysql.escape(t)} AS tabla, COUNT(*) AS filas FROM ${mysql.escapeId(t)}`,
).join('\nUNION ALL\n');

// KEY_COLUMN_USAGE y CHECK_CONSTRAINTS se ven con solo SELECT sobre las tablas (en MariaDB,
// REFERENTIAL_CONSTRAINTS y TABLE_CONSTRAINTS piden más privilegios que los de app_ro)
export const SQL_ESTRUCTURA = `SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE')            AS tablas,
  (SELECT COUNT(DISTINCT TABLE_NAME, CONSTRAINT_NAME) FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL)    AS claves_foraneas,
  (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE())                                     AS checks`;

export const SQL_RANGO = `SELECT MIN(salida_prevista) AS primera_salida,
       MAX(salida_prevista) AS ultima_salida
FROM vuelo`;

// Cifras del README y de verificar_aeropuerto.sql (sección "1 estructura")
const ESTRUCTURA_REFERENCIA = { tablas: 21, claves_foraneas: 27, checks: 10 };

const esquemaCifras = z.object({ fresco: z.literal('1').optional() }).strict();
const CLAVE = 'proyecto:cifras';

rutasProyecto.get('/cifras', async (req, res) => {
  const { fresco } = esquemaCifras.parse(req.query);
  if (fresco) invalidar(CLAVE);

  const { valor, desdeCache } = await conCache(
    CLAVE,
    10 * 60_000,
    async (signal) => {
      const recuento = await ejecutarLectura(SQL_RECUENTO, [], { timeoutMs: 60_000, signal });
      const estructura = await ejecutarLectura(SQL_ESTRUCTURA, [], { timeoutMs: 10_000, signal });
      const rango = await ejecutarLectura(SQL_RANGO, [], { timeoutMs: 10_000, signal });
      return { recuento, estructura, rango, medido: new Date().toISOString() };
    },
    senalCliente(req, res),
  );

  const filasPorTabla = new Map(valor.recuento.filas.map((f) => [String(f.tabla), Number(f.filas)]));
  const tablas = TABLAS.map((t) => {
    const filas = filasPorTabla.get(t) ?? null;
    return { tabla: t, bloque: BLOQUE_DE[t], filas, referencia: CIFRAS_REFERENCIA[t], coincide: filas === CIFRAS_REFERENCIA[t] };
  });
  const e = valor.estructura.filas[0];
  const estructura = {
    tablas: Number(e.tablas),
    claves_foraneas: Number(e.claves_foraneas),
    checks: Number(e.checks),
  };

  res.json({
    tablas,
    bloques: BLOQUES.map((b) => b.bloque),
    totalFilas: tablas.reduce((s, t) => s + (t.filas ?? 0), 0),
    totalReferencia: Object.values(CIFRAS_REFERENCIA).reduce((s, n) => s + n, 0),
    estructura,
    estructuraReferencia: ESTRUCTURA_REFERENCIA,
    rango: valor.rango.filas[0],
    ms: {
      recuento: Math.round(valor.recuento.ms),
      estructura: Math.round(valor.estructura.ms),
      rango: Math.round(valor.rango.ms),
    },
    medido: valor.medido,
    desdeCache,
    sql: { recuento: SQL_RECUENTO, estructura: SQL_ESTRUCTURA, rango: SQL_RANGO },
  });
});
