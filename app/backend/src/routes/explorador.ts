import { Router } from 'express';
import mysql from 'mysql2/promise';
import { z } from 'zod';
import { ejecutarLectura, infoServidor } from '../db.js';
import { senalCliente } from './consultas.js';
import {
  ErrorPeticion,
  MAX_OFFSET,
  OPERADORES,
  TOPE_CONTEO,
  UMBRAL_GRANDE,
  conValores,
  escaparLike,
  metadatos,
  planConteo,
  planFilas,
  sqlMetadatos,
  tablaMeta,
  type PeticionFilas,
} from '../services/explorador.js';

export const rutasExplorador = Router();

const MS_FILAS = 10_000;
const MS_CONTEO = 8_000;

// Nombres de tabla y columna: forma básica aquí; si existen se comprueba contra la lista blanca
const nombre = z.string().regex(/^[a-z0-9_]{1,64}$/, 'Nombre no válido');

const filtro = z
  .object({
    columna: nombre,
    op: z.enum(OPERADORES),
    valor: z.string().max(100).optional(),
    valor2: z.string().max(100).optional(),
  })
  .strict();

export const esquemaFilas = z
  .object({
    filtros: z.array(filtro).max(10).default([]),
    orden: z.array(z.object({ columna: nombre, dir: z.enum(['asc', 'desc']) }).strict()).max(4).default([]),
    tamano: z.union([z.literal(25), z.literal(50), z.literal(100), z.literal(200)]).default(25),
    modo: z.enum(['inicio', 'final', 'siguiente', 'anterior', 'pagina']).default('inicio'),
    cursor: z.array(z.union([z.string().max(200), z.number(), z.null()])).max(8).optional(),
    pagina: z.number().int().min(1).max(1_000_000).optional(),
    contar: z.enum(['no', 'auto', 'exacto']).default('auto'),
  })
  .strict();

const params = z.object({ tabla: nombre }).strict();

rutasExplorador.get('/', async (req, res) => {
  const meta = await metadatos(senalCliente(req, res));
  res.json({
    tablas: [...meta.values()].map((t) => ({ nombre: t.nombre, bloque: t.bloque, filasEstimadas: t.filasEstimadas, grande: t.grande })),
    umbralGrande: UMBRAL_GRANDE,
    maxOffset: MAX_OFFSET,
    topeConteo: TOPE_CONTEO,
    msFilas: MS_FILAS,
  });
});

rutasExplorador.get('/:tabla', async (req, res) => {
  const { tabla } = params.parse(req.params);
  const t = await tablaMeta(tabla, senalCliente(req, res));
  res.json({ ...t, sqlMetadatos: sqlMetadatos((await infoServidor()).esMariaDB) });
});

rutasExplorador.post('/:tabla/filas', async (req, res) => {
  const { tabla } = params.parse(req.params);
  const p = esquemaFilas.parse(req.body ?? {}) as PeticionFilas & { contar: 'no' | 'auto' | 'exacto' };
  const signal = senalCliente(req, res);
  const t = await tablaMeta(tabla, signal);
  const plan = planFilas(t, p);
  const pc = p.contar === 'no' ? null : planConteo(t, plan.where, p.contar === 'exacto');

  const [filasR, conteoR] = await Promise.allSettled([
    ejecutarLectura(plan.sql, plan.valores, { timeoutMs: MS_FILAS, signal }),
    pc ? ejecutarLectura(pc.sql, pc.valores, { timeoutMs: MS_CONTEO, signal }) : Promise.resolve(null),
  ]);
  if (filasR.status === 'rejected') throw filasR.reason;
  const r = filasR.value;

  const extra = r.filas.length > p.tamano;
  let filas = r.filas.slice(0, p.tamano);
  if (plan.invertido) filas = filas.reverse();
  const anteriorSiguiente: Record<PeticionFilas['modo'], [boolean, boolean]> = {
    inicio: [false, extra],
    siguiente: [true, extra],
    anterior: [extra, true],
    final: [extra, false],
    pagina: [(plan.offset ?? 0) > 0, extra],
  };
  const [hayAnterior, haySiguiente] = anteriorSiguiente[p.modo];

  let conteo = null;
  if (pc) {
    if (conteoR.status === 'fulfilled' && conteoR.value) {
      const n = Number(conteoR.value.filas[0]?.n ?? 0);
      conteo = {
        tipo: pc.tipo,
        valor: n,
        masDe: pc.tipo === 'tope' && n > TOPE_CONTEO ? TOPE_CONTEO : null,
        ms: Math.round(conteoR.value.ms),
        sql: pc.sql,
        sqlConValores: conValores(pc.sql, pc.valores),
        error: null,
      };
    } else {
      const e = (conteoR as PromiseRejectedResult).reason as { errno?: number; name?: string };
      if (e?.name === 'AbortError' || e?.errno === 1317) throw e;
      conteo = {
        tipo: pc.tipo,
        valor: null,
        masDe: null,
        ms: null,
        sql: pc.sql,
        sqlConValores: conValores(pc.sql, pc.valores),
        error: e?.errno === 3024 || e?.errno === 1969 ? `El recuento superó ${MS_CONTEO / 1000} s y MySQL lo cortó` : 'No se pudo contar',
      };
    }
  }

  res.json({
    tabla: t.nombre,
    filas,
    columnasCursor: plan.ordenEf.map((o) => o.col.nombre),
    orden: plan.ordenEf.map((o) => ({ columna: o.col.nombre, dir: o.dir, usuario: o.usuario })),
    paginacion: {
      tipo: plan.offset !== null ? 'offset' : 'keyset',
      keysetDisponible: plan.keyset,
      offset: plan.offset,
      invertido: plan.invertido,
      hayAnterior,
      haySiguiente,
    },
    conteo,
    avisos: plan.avisos,
    sql: { texto: plan.sql, valores: plan.valores, conValores: conValores(plan.sql, plan.valores), ms: Math.round(r.ms) },
  });
});

/** EXPLAIN de la misma consulta que se ejecutaría (solo lectura, no la ejecuta) */
rutasExplorador.post('/:tabla/plan', async (req, res) => {
  const { tabla } = params.parse(req.params);
  const p = esquemaFilas.parse(req.body ?? {}) as PeticionFilas;
  const signal = senalCliente(req, res);
  const plan = planFilas(await tablaMeta(tabla, signal), p);
  const sql = `EXPLAIN\n${plan.sql}`;
  const r = await ejecutarLectura(sql, plan.valores, { timeoutMs: 5_000, signal });
  res.json({ filas: r.filas, campos: r.campos, ms: Math.round(r.ms), sql: conValores(sql, plan.valores) });
});

const consultaFk = z
  .object({
    buscar: z.string().max(50).optional(),
    id: z.string().regex(/^\d{1,15}$/).optional(),
  })
  .strict();

/** Buscador del registro relacionado de una FK: id + columnas que lo identifican */
rutasExplorador.get('/:tabla/fk/:columna', async (req, res) => {
  const { tabla, columna } = z.object({ tabla: nombre, columna: nombre }).strict().parse(req.params);
  const { buscar, id } = consultaFk.parse(req.query);
  const signal = senalCliente(req, res);
  const t = await tablaMeta(tabla, signal);
  const col = t.columnas.find((c) => c.nombre === columna);
  if (!col?.fk) throw new ErrorPeticion('Parámetros no válidos', [{ campo: 'columna', mensaje: `${columna} no es una clave foránea de ${tabla}` }]);
  const ref = await tablaMeta(col.fk.tabla, signal);
  const pk = mysql.escapeId(col.fk.columna);
  const textos = ref.etiqueta.filter((e) => ref.columnas.find((c) => c.nombre === e)?.categoria === 'texto');
  const etiqueta = ref.etiqueta.length ? `CONCAT_WS(' · ', ${ref.etiqueta.map((e) => mysql.escapeId(e)).join(', ')})` : 'NULL';

  const conds: string[] = [];
  const valores: unknown[] = [];
  const b = (buscar ?? '').trim();
  if (id) {
    conds.push(`${pk} = ?`);
    valores.push(Number(id));
  } else if (b) {
    if (/^\d{1,15}$/.test(b)) {
      conds.push(`${pk} = ?`);
      valores.push(Number(b));
    }
    for (const e of textos) {
      conds.push(`${mysql.escapeId(e)} LIKE ? ESCAPE '!'`);
      valores.push(`${escaparLike(b)}%`);
    }
    if (!conds.length) {
      res.json({ tabla: ref.nombre, columna: col.fk.columna, etiqueta: ref.etiqueta, opciones: [], sql: null, ms: 0 });
      return;
    }
  }
  const sql =
    `SELECT ${pk} AS id, ${etiqueta} AS etiqueta\nFROM ${mysql.escapeId(ref.nombre)}` +
    (conds.length ? `\nWHERE ${conds.join('\n   OR ')}` : '') +
    `\nORDER BY ${pk}\nLIMIT 20`;
  const r = await ejecutarLectura(sql, valores, { timeoutMs: 3_000, signal });
  res.json({
    tabla: ref.nombre,
    columna: col.fk.columna,
    etiqueta: ref.etiqueta,
    opciones: r.filas.map((f) => ({ id: f.id, etiqueta: f.etiqueta })),
    sql: conValores(sql, valores),
    ms: Math.round(r.ms),
  });
});
