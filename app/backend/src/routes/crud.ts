import { Router } from 'express';
import mysql from 'mysql2/promise';
import { z } from 'zod';
import { config } from '../config.js';
import { ejecutarLectura } from '../db.js';
import { vaciarCache } from '../services/cache.js';
import {
  TABLAS_CRUD,
  contarDependencias,
  editables,
  ejecutarEscritura,
  obligatorias,
  planActualizar,
  planBorrar,
  planInsertar,
  sqlLeerFila,
  tablaCrud,
  triggersDe,
  type ResultadoEscritura,
} from '../services/crud.js';
import { ErrorPeticion } from '../services/explorador.js';
import { senalCliente } from './consultas.js';

export const rutasCrud = Router();

const nombre = z.string().regex(/^[a-z0-9_]{1,64}$/, 'Nombre no válido');
const idFila = z.string().regex(/^\d{1,10}$/, 'id no válido').transform(Number);
const paramsTabla = z.object({ tabla: nombre }).strict();
const paramsFila = z.object({ tabla: nombre, id: idFila }).strict();

const valor = z.union([z.string().max(200), z.number().finite(), z.null()]);
const valores = z
  .record(nombre, valor)
  .refine((o) => Object.keys(o).length <= 20, 'Demasiadas columnas');
const modo = z.enum(['simular', 'confirmar']);

const cuerpoCrear = z.object({ modo, valores }).strict();
const cuerpoEditar = z.object({ modo, valores, original: valores.optional() }).strict();
const cuerpoBorrar = z.object({ modo, confirmacion: z.string().max(80).optional(), original: valores.optional() }).strict();

/** Texto que hay que enviar para confirmar un borrado de verdad */
export const textoConfirmacion = (tabla: string, id: number) => `${tabla}:${id}`;

const MYSQLDUMP = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe';
export const COPIA = {
  comando: `& "${MYSQLDUMP}" -u root -p --single-transaction --routines --triggers --databases aeropuerto aeropuerto_verif --result-file="$HOME\\Desktop\\aeropuerto_antes_crud.sql"`,
  restaurar: 'Workbench > Server > Data Import > Import from Self-Contained File > aeropuerto_antes_crud.sql > Start Import',
};

/** Tras un COMMIT, nada de lo que esté en caché (consultas, contadores, metadatos) vale ya */
function trasEscribir(r: ResultadoEscritura) {
  if (r.final === 'COMMIT' && r.resultado === 'ok') vaciarCache();
}

// ------------------------------------------------------------------
// GET /api/crud -> tablas del CRUD, columnas editables, triggers y copia de seguridad
// ------------------------------------------------------------------
rutasCrud.get('/', async (req, res) => {
  const signal = senalCliente(req, res);
  const tablas = [];
  for (const n of TABLAS_CRUD) {
    const t = await tablaCrud(n, signal);
    tablas.push({
      nombre: t.nombre,
      pk: t.pk[0],
      editables: { insertar: editables(t, 'insertar').map((c) => c.nombre), actualizar: editables(t, 'actualizar').map((c) => c.nombre) },
      obligatorias: obligatorias(t).map((c) => c.nombre),
      triggers: triggersDe(t.nombre),
      referenciadaPor: t.referenciadaPor,
      filasEstimadas: t.filasEstimadas,
    });
  }
  res.json({ tablas, usuario: config.DB_RW_USER, rwConfigurado: !!config.DB_RW_PASSWORD, copia: COPIA });
});

// ------------------------------------------------------------------
// GET /api/crud/:tabla/:id -> la fila actual y cuántas filas dependen de ella (app_ro)
// ------------------------------------------------------------------
rutasCrud.get('/:tabla/:id', async (req, res) => {
  const { tabla, id } = paramsFila.parse(req.params);
  const signal = senalCliente(req, res);
  const t = await tablaCrud(tabla, signal);

  const sqlFila = sqlLeerFila(t, false);
  const fila = await ejecutarLectura(sqlFila, [id], { timeoutMs: 3_000, signal });
  if (!fila.filas.length) throw new ErrorPeticion(`No existe ${tabla} con ${t.pk[0]} = ${id}`, [], 404);

  const deps = await contarDependencias(t, id, signal);

  res.json({
    tabla,
    id,
    fila: fila.filas[0],
    dependencias: deps.dependencias,
    sql: { fila: mysql.format(sqlFila, [id]), dependencias: deps.sql },
    ms: Math.round(fila.ms + deps.ms),
    confirmacion: textoConfirmacion(tabla, id),
  });
});

// ------------------------------------------------------------------
// Escrituras (app_rw, en transacción)
// ------------------------------------------------------------------
rutasCrud.post('/:tabla', async (req, res) => {
  const { tabla } = paramsTabla.parse(req.params);
  const cuerpo = cuerpoCrear.parse(req.body);
  const t = await tablaCrud(tabla);
  const r = await ejecutarEscritura(t, planInsertar(t, cuerpo.valores), cuerpo.modo);
  trasEscribir(r);
  res.json(r);
});

rutasCrud.patch('/:tabla/:id', async (req, res) => {
  const { tabla, id } = paramsFila.parse(req.params);
  const cuerpo = cuerpoEditar.parse(req.body);
  const t = await tablaCrud(tabla);
  const r = await ejecutarEscritura(t, planActualizar(t, id, cuerpo.valores), cuerpo.modo, { id, original: cuerpo.original });
  trasEscribir(r);
  res.json(r);
});

rutasCrud.delete('/:tabla/:id', async (req, res) => {
  const { tabla, id } = paramsFila.parse(req.params);
  const cuerpo = cuerpoBorrar.parse(req.body ?? {});
  const t = await tablaCrud(tabla);
  // Borrar de verdad exige escribir "tabla:id": un clic por error no basta
  if (cuerpo.modo === 'confirmar' && cuerpo.confirmacion !== textoConfirmacion(tabla, id)) {
    throw new ErrorPeticion('Falta la confirmación del borrado', [
      { campo: 'confirmacion', mensaje: `Para borrar de verdad escribe exactamente ${textoConfirmacion(tabla, id)}` },
    ]);
  }
  const r = await ejecutarEscritura(t, planBorrar(t, id), cuerpo.modo, { id, original: cuerpo.original });
  trasEscribir(r);
  res.json(r);
});
