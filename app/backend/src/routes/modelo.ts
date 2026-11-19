import { Router } from 'express';
import { z } from 'zod';
import { ejecutarLectura, infoServidor, type ResultadoLectura } from '../db.js';
import { conCache, invalidar } from '../services/cache.js';
import { BLOQUE_DE } from '../services/tablas.js';
import { senalCliente } from './consultas.js';

export const rutasModelo = Router();

/**
 * Modelo ER leído de INFORMATION_SCHEMA (nada escrito a mano): tablas, columnas,
 * claves foráneas, CHECK e índices de la base actual. Los nombres de columna
 * van con alias porque INFORMATION_SCHEMA devuelve mayúsculas.
 */
export function sqlModelo(esMariaDB: boolean) {
  return {
  tablas: `SELECT TABLE_NAME AS tabla, TABLE_ROWS AS filas_estimadas, ENGINE AS motor
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
ORDER BY TABLE_NAME`,

  columnas: `SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, COLUMN_TYPE AS tipo,
       IS_NULLABLE AS nulo, COLUMN_KEY AS clave, COLUMN_DEFAULT AS defecto, EXTRA AS extra
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, ORDINAL_POSITION`,

  // Las FK salen de KEY_COLUMN_USAGE (visible con SELECT); las reglas ON DELETE/UPDATE,
  // de REFERENTIAL_CONSTRAINTS con LEFT JOIN por si el servidor no la deja ver.
  claves_foraneas: `SELECT k.TABLE_NAME AS tabla, k.CONSTRAINT_NAME AS restriccion, k.COLUMN_NAME AS columna,
       k.REFERENCED_TABLE_NAME AS tabla_ref, k.REFERENCED_COLUMN_NAME AS columna_ref,
       rc.UPDATE_RULE AS al_actualizar, rc.DELETE_RULE AS al_borrar
FROM information_schema.KEY_COLUMN_USAGE k
LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
  ON  rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
  AND rc.CONSTRAINT_NAME   = k.CONSTRAINT_NAME
  AND rc.TABLE_NAME        = k.TABLE_NAME
WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,

  // MySQL 8: CHECK_CONSTRAINTS no tiene TABLE_NAME, se saca de TABLE_CONSTRAINTS.
  // MariaDB (solo pruebas): sí lo tiene.
  checks: esMariaDB
    ? `SELECT cc.TABLE_NAME AS tabla, cc.CONSTRAINT_NAME AS restriccion, cc.CHECK_CLAUSE AS condicion
FROM information_schema.CHECK_CONSTRAINTS cc
WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
ORDER BY cc.TABLE_NAME, cc.CONSTRAINT_NAME`
    : `SELECT tc.TABLE_NAME AS tabla, cc.CONSTRAINT_NAME AS restriccion, cc.CHECK_CLAUSE AS condicion
FROM information_schema.CHECK_CONSTRAINTS cc
LEFT JOIN information_schema.TABLE_CONSTRAINTS tc
  ON  tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
  AND tc.CONSTRAINT_NAME   = cc.CONSTRAINT_NAME
  AND tc.CONSTRAINT_TYPE   = 'CHECK'
WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME`,

  indices: `SELECT TABLE_NAME AS tabla, INDEX_NAME AS indice, NON_UNIQUE AS no_unico,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS columnas
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME`,
  };
}

type Clave = keyof ReturnType<typeof sqlModelo>;
const esquema = z.object({ fresco: z.literal('1').optional() }).strict();
const CLAVE = 'modelo';

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

rutasModelo.get('/', async (req, res) => {
  const { fresco } = esquema.parse(req.query);
  if (fresco) invalidar(CLAVE);

  const SQL_MODELO = sqlModelo((await infoServidor()).esMariaDB);
  const { valor, desdeCache } = await conCache(
    CLAVE,
    60 * 60_000,
    async (signal) => {
      const r = {} as Record<Clave, ResultadoLectura>;
      for (const k of Object.keys(SQL_MODELO) as Clave[]) {
        r[k] = await ejecutarLectura(SQL_MODELO[k], [], { timeoutMs: 15_000, signal });
      }
      return r;
    },
    senalCliente(req, res),
  );

  // Claves foráneas agrupadas por restricción (una FK puede tener varias columnas)
  const fks = new Map<string, { nombre: string; tabla: string; columnas: string[]; tablaRef: string; columnasRef: string[]; alActualizar: string; alBorrar: string }>();
  for (const f of valor.claves_foraneas.filas) {
    const clave = `${f.tabla}.${f.restriccion}`;
    let fk = fks.get(clave);
    if (!fk) {
      fk = { nombre: String(f.restriccion), tabla: String(f.tabla), columnas: [], tablaRef: String(f.tabla_ref), columnasRef: [], alActualizar: s(f.al_actualizar) ?? '—', alBorrar: s(f.al_borrar) ?? '—' };
      fks.set(clave, fk);
    }
    fk.columnas.push(String(f.columna));
    fk.columnasRef.push(String(f.columna_ref));
  }
  const listaFks = [...fks.values()];
  const colsFk = new Set(listaFks.flatMap((fk) => fk.columnas.map((c) => `${fk.tabla}.${c}`)));

  const tablas = valor.tablas.filas.map((t) => {
    const nombre = String(t.tabla);
    const indices = valor.indices.filas
      .filter((i) => i.tabla === nombre)
      .map((i) => ({ nombre: String(i.indice), columnas: String(i.columnas), unico: Number(i.no_unico) === 0 }))
      .sort((a, b) => Number(b.nombre === 'PRIMARY') - Number(a.nombre === 'PRIMARY'));
    const pk = indices.find((i) => i.nombre === 'PRIMARY')?.columnas.split(', ') ?? [];
    return {
      nombre,
      bloque: BLOQUE_DE[nombre] ?? 'Otras',
      filasEstimadas: t.filas_estimadas === null ? null : Number(t.filas_estimadas),
      motor: s(t.motor),
      columnas: valor.columnas.filas
        .filter((c) => c.tabla === nombre)
        .map((c) => ({
          nombre: String(c.columna),
          tipo: String(c.tipo),
          nulo: c.nulo === 'YES',
          pk: pk.includes(String(c.columna)),
          fk: colsFk.has(`${nombre}.${c.columna}`),
          clave: s(c.clave) || null, // PRI / UNI / MUL
          defecto: s(c.defecto),
          extra: s(c.extra) || null,
        })),
      pk,
      fks: listaFks.filter((fk) => fk.tabla === nombre),
      referenciadaPor: listaFks.filter((fk) => fk.tablaRef === nombre).map((fk) => ({ tabla: fk.tabla, nombre: fk.nombre, columnas: fk.columnas })),
      unicos: indices.filter((i) => i.unico && i.nombre !== 'PRIMARY'),
      checks: valor.checks.filas.filter((c) => c.tabla === nombre).map((c) => ({ nombre: String(c.restriccion), condicion: String(c.condicion) })),
      indices,
    };
  });

  res.json({
    tablas,
    fks: listaFks,
    resumen: {
      tablas: tablas.length,
      columnas: valor.columnas.filas.length,
      clavesForaneas: listaFks.length,
      checks: valor.checks.filas.length,
      checksSinTabla: valor.checks.filas.filter((c) => c.tabla === null).length,
      indices: valor.indices.filas.length,
    },
    ms: Math.round(Object.values(valor).reduce((acc, r) => acc + r.ms, 0)),
    desdeCache,
    sql: SQL_MODELO,
  });
});
