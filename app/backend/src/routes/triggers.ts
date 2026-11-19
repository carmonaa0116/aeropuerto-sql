import { readFileSync } from 'node:fs';
import { Router } from 'express';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { ejecutarLectura, rwPool } from '../db.js';
import { SQL_CREACION } from '../paths.js';
import { CASOS, IDS_CASOS, codigoTriggers, scriptDemo, type CasoDemo } from '../services/demoTriggers.js';

export const rutasTriggers = Router();

const ARCHIVO_DEMO = 'app/backend/sql/01_demo_triggers.sql';
const AYUDA_INSTALAR = `Ejecuta ${ARCHIVO_DEMO} en Workbench, conectado como root (Ctrl+Shift+Enter).`;

/** COUNT(*) de cada tabla (nombres de la lista blanca, escapados) en una sola sentencia */
export function sqlConteo(tablas: string[]): string {
  return tablas
    .map((t) => `SELECT ${mysql.escape(t)} AS tabla, COUNT(*) AS filas FROM ${mysql.escapeId(t)}`)
    .join('\nUNION ALL\n');
}

async function contar(tablas: string[]): Promise<{ filas: Map<string, number>; ms: number }> {
  const r = await ejecutarLectura(sqlConteo(tablas), [], { timeoutMs: 60_000 });
  return { filas: new Map(r.filas.map((f) => [String(f.tabla), Number(f.filas)])), ms: r.ms };
}

/** El código de cada validador: trigger o procedimiento de sql/01-03, o la línea del UNIQUE en creacion.sql */
function codigoValidador(nombre: string): { nombre: string; archivo: string; sql: string } {
  const trg = codigoTriggers().get(nombre);
  if (trg) return { nombre, ...trg };
  const linea = readFileSync(SQL_CREACION, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .find((l) => l.includes(nombre));
  return { nombre, archivo: 'sql/creacion.sql', sql: linea ? `CREATE TABLE billete (\n    ...\n    ${linea.trim()}\n    ...\n);` : '' };
}

// Una demo cada vez: así el COUNT de antes y el de después rodean a una sola llamada
let cola: Promise<unknown> = Promise.resolve();
function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const p = cola.then(fn, fn);
  cola = p.catch(() => undefined);
  return p;
}

// ------------------------------------------------------------------
// GET /api/triggers  -> catálogo de casos con su SQL (leído de los .sql)
// ------------------------------------------------------------------
rutasTriggers.get('/', async (_req, res) => {
  const script = scriptDemo();
  const casos = CASOS.map((c) => {
    const tablas = script.tablasPorCaso.get(c.id) ?? [];
    return {
      ...c,
      sqlIntento: script.casos.get(c.id) ?? '',
      llamada: `CALL sp_demo_trigger('${c.id}');`,
      tablas,
      validadores: c.validadores.map(codigoValidador),
    };
  });

  // ¿Está instalado el procedimiento y puede ejecutarlo app_rw? (app_rw solo ve rutinas sobre las que tiene permiso)
  let instalacion: { ok: boolean; motivo: string | null };
  try {
    const [filas] = await rwPool().query<RowDataPacket[]>(
      `SELECT ROUTINE_NAME FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'sp_demo_trigger'`,
    );
    instalacion = filas.length
      ? { ok: true, motivo: null }
      : { ok: false, motivo: `app_rw no ve el procedimiento sp_demo_trigger (no existe o no tiene EXECUTE). ${AYUDA_INSTALAR}` };
  } catch (e) {
    const err = e as { errno?: number; message?: string };
    instalacion = {
      ok: false,
      motivo:
        err.errno === 1045
          ? 'MySQL rechazó el usuario app_rw o su clave de app/backend/.env (DB_RW_PASSWORD).'
          : (err.message ?? 'No se pudo conectar con app_rw'),
    };
  }

  res.json({
    archivo: ARCHIVO_DEMO,
    preparacion: script.preparacion,
    casos,
    instalacion,
  });
});

// ------------------------------------------------------------------
// POST /api/triggers/:caso  -> COUNT(*) antes, CALL sp_demo_trigger, COUNT(*) después
// ------------------------------------------------------------------
const idCaso = z.enum(IDS_CASOS);

function coincide(c: CasoDemo, r: { resultado: string; errno: number | null; mensaje: string | null; paso: string }) {
  return (
    r.paso === 'intento' &&
    r.resultado === c.esperado.resultado &&
    r.errno === c.esperado.errno &&
    (c.esperado.mensaje === null || r.mensaje === c.esperado.mensaje)
  );
}

rutasTriggers.post('/:caso', async (req, res) => {
  const id = idCaso.safeParse(String(req.params.caso));
  if (!id.success) {
    res.status(404).json({ error: 'Caso de demo desconocido' });
    return;
  }
  const caso = CASOS.find((c) => c.id === id.data)!;
  const tablas = scriptDemo().tablasPorCaso.get(caso.id) ?? [];

  let pool;
  try {
    pool = rwPool();
  } catch {
    res.status(503).json({ error: 'Falta DB_RW_PASSWORD en app/backend/.env: la demo usa el usuario app_rw.' });
    return;
  }

  const salida = await enCola(async () => {
    const antes = await contar(tablas);
    const conn = await pool.getConnection();
    let fila: RowDataPacket;
    let ms: number;
    try {
      // Si algo tuviera bloqueadas las filas, mejor fallar en 5 s que esperar 50
      await conn.query('SET SESSION innodb_lock_wait_timeout = 5');
      const t0 = performance.now();
      const [resultados] = await conn.query<RowDataPacket[][]>('CALL sp_demo_trigger(?)', [caso.id]);
      ms = performance.now() - t0;
      fila = resultados[0][0];
    } finally {
      conn.release();
    }
    const despues = await contar(tablas);
    return { antes, despues, fila, ms };
  }).catch((e: { errno?: number; sqlMessage?: string }) => {
    if (e.errno === 1305) return { error: 404, mensaje: `No existe el procedimiento sp_demo_trigger. ${AYUDA_INSTALAR}` };
    if (e.errno === 1370) return { error: 403, mensaje: `app_rw no tiene EXECUTE sobre sp_demo_trigger. ${AYUDA_INSTALAR}` };
    throw e;
  });

  if ('error' in salida) {
    res.status(salida.error).json({ error: salida.mensaje });
    return;
  }

  const { antes, despues, fila, ms } = salida;
  const r = {
    resultado: String(fila.resultado),
    paso: String(fila.paso),
    errno: fila.errno === null ? null : Number(fila.errno),
    estadoSql: fila.estado_sql === null ? null : String(fila.estado_sql),
    mensaje: fila.mensaje === null ? null : String(fila.mensaje),
  };
  const filasRastro = tablas.map((t) => ({ tabla: t, antes: antes.filas.get(t) ?? 0, despues: despues.filas.get(t) ?? 0 }));

  res.json({
    caso: caso.id,
    ...r,
    esperado: caso.esperado,
    coincide: coincide(caso, r),
    ms: Math.round(ms),
    rastro: {
      tablas: filasRastro,
      intacto: filasRastro.every((f) => f.antes === f.despues),
      msConteo: Math.round(antes.ms + despues.ms),
    },
    sql: { llamada: `CALL sp_demo_trigger('${caso.id}');`, conteo: sqlConteo(tablas) },
  });
});
