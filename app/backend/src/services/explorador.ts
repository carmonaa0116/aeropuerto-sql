import mysql from 'mysql2/promise';
import { ejecutarLectura, infoServidor } from '../db.js';
import { sqlModelo } from '../routes/modelo.js';
import { conCache } from './cache.js';
import { BLOQUE_DE, TABLAS } from './tablas.js';

/**
 * Explorador de tablas (fase 4). Todo lo que acaba en un SQL sale de aquí:
 *  - tablas y columnas: solo las de la lista blanca (21 tablas ∩ INFORMATION_SCHEMA);
 *  - operadores: lista fija según el tipo de la columna;
 *  - valores: siempre como parámetros (?), validados antes contra el tipo;
 *  - ORDER BY: solo columnas de la lista blanca y ASC/DESC.
 * Del navegador nunca llega un trozo de SQL, solo nombres que se buscan en la lista.
 */

export type Categoria = 'entero' | 'decimal' | 'float' | 'texto' | 'fecha' | 'fechahora' | 'enum';
export const OPERADORES = ['igual', 'contiene', 'empieza', 'entre', 'es_nulo', 'no_es_nulo'] as const;
export type Operador = (typeof OPERADORES)[number];
export const TAMANOS = [25, 50, 100, 200] as const;

/** Tablas con al menos estas filas (estimación de InnoDB) se tratan como grandes */
export const UMBRAL_GRANDE = 100_000;
/** OFFSET máximo permitido en tablas grandes; más allá se navega por clave */
export const MAX_OFFSET = 10_000;
/** Tope del recuento con filtros en tablas grandes ("más de N") */
export const TOPE_CONTEO = 10_000;

export interface ColumnaMeta {
  nombre: string;
  tipo: string; // COLUMN_TYPE tal cual
  categoria: Categoria;
  nulo: boolean;
  pk: boolean;
  fk: { tabla: string; columna: string } | null;
  opciones: string[] | null; // valores de un ENUM o de un CHECK "col in (...)"
  origenOpciones: 'enum' | 'check' | null;
  indexada: boolean; // primera columna de algún índice
  operadores: Operador[];
  defecto: string | null; // COLUMN_DEFAULT normalizado (sin comillas)
  auto: boolean; // AUTO_INCREMENT
  longitud: number | null; // varchar(n) / char(n)
}

export interface TablaMeta {
  nombre: string;
  bloque: string;
  columnas: ColumnaMeta[];
  pk: string[];
  etiqueta: string[]; // columnas que identifican una fila para personas (buscador de FK)
  filasEstimadas: number | null;
  grande: boolean;
  indices: { nombre: string; columnas: string[]; unico: boolean }[];
  checks: { nombre: string; condicion: string }[];
  referenciadaPor: { tabla: string; columna: string }[];
}

/** Error de la petición (400) con detalle por campo; lo traduce middleware/errores.ts */
export class ErrorPeticion extends Error {
  constructor(
    mensaje: string,
    public detalle: { campo: string; mensaje: string }[] = [],
    public status = 400,
  ) {
    super(mensaje);
  }
}

const mal = (campo: string, mensaje: string) => new ErrorPeticion('Parámetros no válidos', [{ campo, mensaje }]);

// ------------------------------------------------------------------
// Metadatos desde INFORMATION_SCHEMA (mismas consultas que el modelo ER)
// ------------------------------------------------------------------

export function categoriaDe(columnType: string): Categoria {
  const base = /^(\w+)/.exec(columnType.toLowerCase())?.[1] ?? '';
  if (['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint'].includes(base)) return 'entero';
  if (['decimal', 'numeric'].includes(base)) return 'decimal';
  if (['float', 'double', 'real'].includes(base)) return 'float';
  if (base === 'date') return 'fecha';
  if (['datetime', 'timestamp'].includes(base)) return 'fechahora';
  if (base === 'enum') return 'enum';
  return 'texto';
}

/** enum('a','b') -> ['a','b'] */
export function valoresEnum(columnType: string): string[] {
  const dentro = /^enum\((.*)\)$/i.exec(columnType)?.[1] ?? '';
  return [...dentro.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

/** CHECK "(`activa` in (0,1))" -> { columna: 'activa', valores: ['0','1'] } */
export function checkEnLista(condicion: string): { columna: string; valores: string[] } | null {
  const m = /^\(*\s*`(\w+)`\s+in\s*\(([^()]*)\)\s*\)*$/i.exec(condicion.trim());
  if (!m) return null;
  const valores = m[2].split(',').map((v) => v.trim().replace(/^_\w+\s*/, '').replace(/^'(.*)'$/, '$1'));
  return valores.every((v) => v.length > 0) ? { columna: m[1], valores } : null;
}

/** MySQL 8 da el defecto sin comillas (programado); MariaDB, entre comillas ('programado') o 'NULL' */
export function defectoNormalizado(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v);
  if (t === 'NULL') return null;
  const m = /^'(.*)'$/s.exec(t);
  return m ? m[1].replace(/''/g, "'") : t;
}

const CODIGOS = ['codigo_iata', 'codigo_iso', 'matricula', 'numero_vuelo', 'localizador', 'documento', 'licencia', 'codigo', 'designacion'];
const DESCRIPTIVAS = ['fabricante', 'nombre', 'apellidos', 'salida_prevista'];

function operadoresDe(c: Omit<ColumnaMeta, 'operadores'>): Operador[] {
  let ops: Operador[];
  if (c.fk || c.opciones) ops = ['igual'];
  else if (c.categoria === 'texto') ops = ['contiene', 'igual', 'empieza'];
  else if (c.categoria === 'entero' || c.categoria === 'decimal') ops = ['igual', 'entre'];
  else ops = ['entre']; // float (sin igualdad exacta), fecha, fechahora
  return c.nulo ? [...ops, 'es_nulo', 'no_es_nulo'] : ops;
}

export function sqlMetadatos(esMariaDB: boolean) {
  const m = sqlModelo(esMariaDB);
  return { tablas: m.tablas, columnas: m.columnas, claves_foraneas: m.claves_foraneas, checks: m.checks, indices: m.indices };
}

async function leerMetadatos(signal: AbortSignal): Promise<Map<string, TablaMeta>> {
  const sql = sqlMetadatos((await infoServidor()).esMariaDB);
  const r: Record<string, Record<string, unknown>[]> = {};
  for (const [k, q] of Object.entries(sql)) r[k] = (await ejecutarLectura(q, [], { timeoutMs: 15_000, signal })).filas;

  const s = (v: unknown) => String(v);
  const fkDe = new Map<string, { tabla: string; columna: string }>();
  for (const f of r.claves_foraneas) fkDe.set(`${f.tabla}.${f.columna}`, { tabla: s(f.tabla_ref), columna: s(f.columna_ref) });
  const checkDe = new Map<string, string[]>();
  const checksDe = new Map<string, { nombre: string; condicion: string }[]>();
  for (const c of r.checks) {
    if (c.tabla !== null) checksDe.set(s(c.tabla), [...(checksDe.get(s(c.tabla)) ?? []), { nombre: s(c.restriccion), condicion: s(c.condicion) }]);
    const l = c.tabla === null ? null : checkEnLista(s(c.condicion));
    if (l) checkDe.set(`${c.tabla}.${l.columna}`, l.valores);
  }

  const mapa = new Map<string, TablaMeta>();
  for (const t of r.tablas) {
    const nombre = s(t.tabla);
    if (!TABLAS.includes(nombre)) continue; // lista blanca: solo las 21 del proyecto
    const indices = r.indices
      .filter((i) => i.tabla === nombre)
      .map((i) => ({ nombre: s(i.indice), columnas: s(i.columnas).split(', '), unico: Number(i.no_unico) === 0 }));
    const pk = indices.find((i) => i.nombre === 'PRIMARY')?.columnas ?? [];
    const primeras = new Set(indices.map((i) => i.columnas[0]));
    const columnas: ColumnaMeta[] = r.columnas
      .filter((c) => c.tabla === nombre)
      .map((c) => {
        const col = s(c.columna);
        const tipo = s(c.tipo);
        const enumV = categoriaDe(tipo) === 'enum' ? valoresEnum(tipo) : null;
        const checkV = checkDe.get(`${nombre}.${col}`) ?? null;
        const base = {
          nombre: col,
          tipo,
          categoria: categoriaDe(tipo),
          nulo: c.nulo === 'YES',
          pk: pk.includes(col),
          fk: fkDe.get(`${nombre}.${col}`) ?? null,
          opciones: enumV ?? checkV,
          origenOpciones: enumV ? ('enum' as const) : checkV ? ('check' as const) : null,
          indexada: primeras.has(col),
          defecto: defectoNormalizado(c.defecto),
          auto: /auto_increment/i.test(s(c.extra ?? '')),
          longitud: Number(/^(?:var)?char\((\d+)\)/i.exec(tipo)?.[1] ?? (/^char$/i.test(tipo) ? 1 : NaN)) || null,
        };
        return { ...base, operadores: operadoresDe(base) };
      });
    const nombresCol = columnas.map((c) => c.nombre);
    const codigo = CODIGOS.find((c) => nombresCol.includes(c));
    const etiqueta = [...(codigo ? [codigo] : []), ...DESCRIPTIVAS.filter((c) => nombresCol.includes(c))].slice(0, 3);
    const filasEstimadas = t.filas_estimadas === null ? null : Number(t.filas_estimadas);
    mapa.set(nombre, {
      nombre,
      bloque: BLOQUE_DE[nombre] ?? 'Otras',
      columnas,
      pk,
      etiqueta,
      filasEstimadas,
      grande: (filasEstimadas ?? 0) >= UMBRAL_GRANDE,
      indices,
      checks: checksDe.get(nombre) ?? [],
      referenciadaPor: [],
    });
  }
  for (const [clave, ref] of fkDe) {
    const [tabla, columna] = clave.split('.');
    if (mapa.has(tabla)) mapa.get(ref.tabla)?.referenciadaPor.push({ tabla, columna });
  }
  return mapa;
}

export async function metadatos(signal?: AbortSignal): Promise<Map<string, TablaMeta>> {
  return (await conCache('explorador-meta', 60 * 60_000, leerMetadatos, signal)).valor;
}

/** Busca la tabla en la lista blanca. Un nombre que no está ahí nunca llega a un SQL. */
export async function tablaMeta(nombre: string, signal?: AbortSignal): Promise<TablaMeta> {
  const t = (await metadatos(signal)).get(nombre);
  if (!t) throw new ErrorPeticion(`La tabla "${nombre.slice(0, 64)}" no está en la lista del explorador`, [], 404);
  return t;
}

// ------------------------------------------------------------------
// Petición validada (zod ya comprobó la forma; aquí se comprueba contra la tabla)
// ------------------------------------------------------------------

export interface Filtro {
  columna: string;
  op: Operador;
  valor?: string;
  valor2?: string;
}
export interface Orden {
  columna: string;
  dir: 'asc' | 'desc';
}
export type Modo = 'inicio' | 'final' | 'siguiente' | 'anterior' | 'pagina';
export type ValorCursor = string | number | null;

export interface PeticionFilas {
  filtros: Filtro[];
  orden: Orden[];
  tamano: number;
  modo: Modo;
  cursor?: ValorCursor[];
  pagina?: number;
}

interface Fragmento {
  sql: string;
  valores: unknown[];
}

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_FECHAHORA = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

function fechaReal(a: string, m: string, d: string): boolean {
  const f = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  return f.getUTCFullYear() === Number(a) && f.getUTCMonth() === Number(m) - 1 && f.getUTCDate() === Number(d);
}

/** Convierte el texto del formulario al valor del parámetro, según el tipo de la columna */
function valorDe(col: ColumnaMeta, texto: string | undefined, campo: string): { valor: unknown; soloDia: boolean } {
  if (texto === undefined || texto === '') throw mal(campo, 'Falta el valor');
  const t = texto.trim();
  if (col.opciones) {
    if (!col.opciones.includes(t)) throw mal(campo, `Valor no permitido. Opciones: ${col.opciones.join(', ')}`);
    return { valor: col.categoria === 'entero' ? Number(t) : t, soloDia: false };
  }
  switch (col.categoria) {
    case 'entero':
      if (!/^-?\d{1,15}$/.test(t)) throw mal(campo, 'Debe ser un número entero');
      return { valor: Number(t), soloDia: false };
    case 'decimal':
    case 'float':
      if (!/^-?\d{1,15}(\.\d{1,8})?$/.test(t)) throw mal(campo, 'Debe ser un número (con punto decimal)');
      return { valor: Number(t), soloDia: false };
    case 'fecha': {
      const m = RE_FECHA.exec(t);
      if (!m || !fechaReal(m[1], m[2], m[3])) throw mal(campo, 'Fecha no válida (AAAA-MM-DD)');
      return { valor: t, soloDia: true };
    }
    case 'fechahora': {
      const d = RE_FECHA.exec(t);
      if (d && fechaReal(d[1], d[2], d[3])) return { valor: t, soloDia: true };
      const m = RE_FECHAHORA.exec(t);
      if (!m || !fechaReal(m[1], m[2], m[3]) || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)
        throw mal(campo, 'Fecha y hora no válidas (AAAA-MM-DD o AAAA-MM-DD HH:MM, UTC)');
      return { valor: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}`, soloDia: false };
    }
    default:
      return { valor: t, soloDia: false };
  }
}

/** Escapa los comodines de LIKE con '!' (no depende de NO_BACKSLASH_ESCAPES) */
export const escaparLike = (t: string) => t.replace(/[!%_]/g, '!$&');

export function condicionFiltro(tabla: TablaMeta, f: Filtro, i: number): Fragmento {
  const campo = `filtros.${i}`;
  const col = tabla.columnas.find((c) => c.nombre === f.columna);
  if (!col) throw mal(`${campo}.columna`, `La columna "${f.columna.slice(0, 64)}" no existe en ${tabla.nombre}`);
  if (!col.operadores.includes(f.op)) throw mal(`${campo}.op`, `El operador "${f.op}" no se admite en ${col.nombre} (${col.tipo})`);
  const c = mysql.escapeId(col.nombre);
  switch (f.op) {
    case 'es_nulo':
      return { sql: `${c} IS NULL`, valores: [] };
    case 'no_es_nulo':
      return { sql: `${c} IS NOT NULL`, valores: [] };
    case 'igual':
      return { sql: `${c} = ?`, valores: [valorDe(col, f.valor, `${campo}.valor`).valor] };
    case 'contiene':
    case 'empieza': {
      const t = (f.valor ?? '').trim();
      if (!t) throw mal(`${campo}.valor`, 'Falta el texto a buscar');
      return { sql: `${c} LIKE ? ESCAPE '!'`, valores: [`${f.op === 'contiene' ? '%' : ''}${escaparLike(t)}%`] };
    }
    case 'entre': {
      const partes: string[] = [];
      const valores: unknown[] = [];
      if (f.valor) {
        partes.push(`${c} >= ?`);
        valores.push(valorDe(col, f.valor, `${campo}.valor`).valor);
      }
      if (f.valor2) {
        const h = valorDe(col, f.valor2, `${campo}.valor2`);
        // "hasta el día X" en una columna DATETIME incluye todo ese día
        partes.push(col.categoria === 'fechahora' && h.soloDia ? `${c} < DATE_ADD(?, INTERVAL 1 DAY)` : `${c} <= ?`);
        valores.push(h.valor);
      }
      if (!partes.length) throw mal(`${campo}.valor`, 'Indica al menos "desde" o "hasta"');
      return { sql: partes.join(' AND '), valores };
    }
  }
}

export interface OrdenEfectivo {
  col: ColumnaMeta;
  dir: 'asc' | 'desc';
  usuario: boolean; // false = desempate por la clave primaria
}

/** Orden pedido + la clave primaria al final, para que el orden sea total (necesario para paginar por clave) */
export function ordenEfectivo(tabla: TablaMeta, orden: Orden[]): OrdenEfectivo[] {
  const vistos = new Set<string>();
  const res: OrdenEfectivo[] = orden.map((o, i) => {
    const col = tabla.columnas.find((c) => c.nombre === o.columna);
    if (!col) throw mal(`orden.${i}.columna`, `La columna "${o.columna.slice(0, 64)}" no existe en ${tabla.nombre}`);
    if (vistos.has(col.nombre)) throw mal(`orden.${i}.columna`, `La columna ${col.nombre} está dos veces en el orden`);
    vistos.add(col.nombre);
    return { col, dir: o.dir, usuario: true };
  });
  for (const k of tabla.pk) {
    if (!vistos.has(k)) res.push({ col: tabla.columnas.find((c) => c.nombre === k)!, dir: 'asc', usuario: false });
  }
  return res;
}

/** Con FLOAT en el orden no se pagina por clave: la igualdad exacta de un FLOAT no es fiable */
export const admiteKeyset = (orden: OrdenEfectivo[]) => orden.every((o) => o.col.categoria !== 'float');

function validarCursor(orden: OrdenEfectivo[], cursor: ValorCursor[] | undefined): ValorCursor[] {
  if (!cursor) throw mal('cursor', 'Falta el cursor (valores de la fila de referencia)');
  if (cursor.length !== orden.length) throw mal('cursor', `El cursor debe tener ${orden.length} valores (uno por columna del orden)`);
  orden.forEach(({ col }, i) => {
    const v = cursor[i];
    const campo = `cursor.${i}`;
    if (v === null) {
      if (!col.nulo) throw mal(campo, `${col.nombre} no admite NULL`);
      return;
    }
    const numerica = col.categoria === 'entero' || col.categoria === 'decimal';
    if (numerica && (typeof v !== 'number' || !Number.isFinite(v))) throw mal(campo, `${col.nombre} espera un número`);
    if (col.categoria === 'entero' && !Number.isInteger(v)) throw mal(campo, `${col.nombre} espera un entero`);
    if (!numerica && typeof v !== 'string') throw mal(campo, `${col.nombre} espera texto`);
    if (col.categoria === 'fecha' && !RE_FECHA.test(String(v))) throw mal(campo, 'Fecha no válida');
    if (col.categoria === 'fechahora' && !RE_FECHAHORA.test(String(v))) throw mal(campo, 'Fecha y hora no válidas');
    if (col.opciones && !col.opciones.includes(String(v))) throw mal(campo, 'Valor fuera de las opciones');
  });
  return cursor;
}

/**
 * Filas estrictamente DESPUÉS del cursor en el orden dado (NULL va primero en ASC y
 * último en DESC, como en MySQL):
 *   (a > ?) OR (a = ? AND ((b > ?) OR (b = ? AND (pk > ?))))
 * Con la primera columna no nula se añade una cota redundante (a >= ?) para que el
 * optimizador use un rango del índice en vez de recorrer la tabla.
 */
export function condicionKeyset(orden: OrdenEfectivo[], cursor: ValorCursor[]): Fragmento {
  const rec = (i: number): Fragmento => {
    const { col, dir } = orden[i];
    const c = mysql.escapeId(col.nombre);
    const v = cursor[i];
    let mayor: Fragmento | null;
    if (dir === 'asc') mayor = v === null ? { sql: `${c} IS NOT NULL`, valores: [] } : { sql: `${c} > ?`, valores: [v] };
    else if (v === null) mayor = null; // en DESC no hay nada después de NULL en esta columna
    else mayor = col.nulo ? { sql: `(${c} < ? OR ${c} IS NULL)`, valores: [v] } : { sql: `${c} < ?`, valores: [v] };
    if (i === orden.length - 1) return mayor ?? { sql: 'FALSE', valores: [] };
    const igual: Fragmento = v === null ? { sql: `${c} IS NULL`, valores: [] } : { sql: `${c} = ?`, valores: [v] };
    const resto = rec(i + 1);
    const empate = { sql: `(${igual.sql} AND ${resto.sql})`, valores: [...igual.valores, ...resto.valores] };
    if (!mayor) return empate;
    return { sql: `(${mayor.sql} OR ${empate.sql})`, valores: [...mayor.valores, ...empate.valores] };
  };
  const r = rec(0);
  const { col, dir } = orden[0];
  const v = cursor[0];
  if (v !== null && orden.length > 1 && (dir === 'asc' || !col.nulo)) {
    const cota = { sql: `${mysql.escapeId(col.nombre)} ${dir === 'asc' ? '>=' : '<='} ?`, valores: [v] };
    return { sql: `${cota.sql} AND ${r.sql}`, valores: [...cota.valores, ...r.valores] };
  }
  return r;
}

/** ¿Hay un índice cuyas primeras columnas son las del orden pedido (misma dirección)? */
export function ordenConIndice(tabla: TablaMeta, orden: OrdenEfectivo[]): boolean {
  const usuario = orden.filter((o) => o.usuario);
  if (!usuario.length) return true; // orden por clave primaria
  if (new Set(usuario.map((o) => o.dir)).size > 1) return false; // ASC y DESC mezclados -> filesort
  const nombres = usuario.map((o) => o.col.nombre);
  return tabla.indices.some((i) => nombres.every((n, k) => i.columnas[k] === n));
}

export interface PlanFilas {
  sql: string;
  valores: unknown[];
  invertido: boolean; // se piden al revés y se les da la vuelta (Anterior, Última)
  keyset: boolean;
  offset: number | null;
  ordenEf: OrdenEfectivo[];
  where: Fragmento;
  avisos: { tipo: string; texto: string }[];
}

export function planFilas(tabla: TablaMeta, p: PeticionFilas): PlanFilas {
  const conds = p.filtros.map((f, i) => condicionFiltro(tabla, f, i));
  const where: Fragmento = {
    sql: conds.map((c) => c.sql).join('\n  AND '),
    valores: conds.flatMap((c) => c.valores),
  };
  const ordenEf = ordenEfectivo(tabla, p.orden);
  const keyset = admiteKeyset(ordenEf);
  const avisos: PlanFilas['avisos'] = [];

  let invertido = false;
  let offset: number | null = null;
  let condCursor: Fragmento | null = null;

  if (p.modo === 'pagina') {
    const pagina = p.pagina ?? 1;
    offset = (pagina - 1) * p.tamano;
    if (tabla.grande && offset > MAX_OFFSET) {
      throw mal(
        'pagina',
        `En ${tabla.nombre} no se salta con OFFSET más allá de ${MAX_OFFSET.toLocaleString('es-ES')} filas: MySQL tendría que leer y tirar todas las anteriores. Usa Siguiente, Anterior o Última (paginación por clave).`,
      );
    }
  } else if (!keyset && p.modo !== 'inicio') {
    throw mal('modo', 'Con una columna FLOAT en el orden se navega por número de página (OFFSET), no por clave');
  } else if (p.modo === 'siguiente' || p.modo === 'anterior') {
    const cursor = validarCursor(ordenEf, p.cursor);
    invertido = p.modo === 'anterior';
    const ordenCursor = invertido ? ordenEf.map((o) => ({ ...o, dir: o.dir === 'asc' ? ('desc' as const) : ('asc' as const) })) : ordenEf;
    condCursor = condicionKeyset(ordenCursor, cursor);
  } else if (p.modo === 'final') {
    invertido = true;
  }

  const ordenSql = ordenEf
    .map((o) => `${mysql.escapeId(o.col.nombre)} ${(invertido ? (o.dir === 'asc' ? 'desc' : 'asc') : o.dir).toUpperCase()}`)
    .join(', ');
  const todas = [where.sql, condCursor?.sql].filter(Boolean) as string[];
  const columnas = tabla.columnas.map((c) => mysql.escapeId(c.nombre)).join(', ');
  const sql =
    `SELECT ${columnas}\nFROM ${mysql.escapeId(tabla.nombre)}` +
    (todas.length ? `\nWHERE ${todas.join('\n  AND ')}` : '') +
    `\nORDER BY ${ordenSql}\nLIMIT ?` +
    (offset !== null && offset > 0 ? ' OFFSET ?' : '');
  // Se pide una fila de más para saber si hay otra página en ese sentido
  const valores = [...where.valores, ...(condCursor?.valores ?? []), p.tamano + 1, ...(offset ? [offset] : [])];

  if (tabla.grande && !ordenConIndice(tabla, ordenEf)) {
    const cols = ordenEf.filter((o) => o.usuario).map((o) => o.col.nombre).join(', ');
    avisos.push({
      tipo: 'sin_indice',
      texto: `Ningún índice empieza por (${cols}) con esa dirección: MySQL tiene que leer y ordenar todas las filas que pasan los filtros (filesort) antes de devolver la página. En ${tabla.nombre} puede tardar y se corta a los 10 s.`,
    });
  }
  if (tabla.grande && p.filtros.some((f) => f.op === 'contiene')) {
    avisos.push({ tipo: 'like', texto: "LIKE '%texto%' no puede usar índices: recorre la tabla. Empieza por (LIKE 'texto%') sí puede." });
  }
  if (!keyset) {
    avisos.push({ tipo: 'offset', texto: 'Hay una columna FLOAT en el orden: se pagina con OFFSET (la tabla es pequeña, no penaliza).' });
  }
  return { sql, valores, invertido, keyset, offset, ordenEf, where, avisos };
}

export interface PlanConteo {
  tipo: 'exacto' | 'tope' | 'estimado';
  sql: string;
  valores: unknown[];
}

export function planConteo(tabla: TablaMeta, where: Fragmento, forzarExacto: boolean): PlanConteo {
  const t = mysql.escapeId(tabla.nombre);
  const w = where.sql ? `\nWHERE ${where.sql}` : '';
  if (forzarExacto || !tabla.grande) return { tipo: 'exacto', sql: `SELECT COUNT(*) AS n\nFROM ${t}${w}`, valores: where.valores };
  if (!where.sql)
    return {
      tipo: 'estimado',
      sql: 'SELECT TABLE_ROWS AS n\nFROM information_schema.TABLES\nWHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      valores: [tabla.nombre],
    };
  return {
    tipo: 'tope',
    sql: `SELECT COUNT(*) AS n\nFROM (\n  SELECT 1 FROM ${t}${w.replace(/\n/g, '\n  ')}\n  LIMIT ?\n) AS x`,
    valores: [...where.valores, TOPE_CONTEO + 1],
  };
}

/** Versión con los valores escritos, solo para mostrar y copiar a Workbench (nunca se ejecuta) */
export const conValores = (sql: string, valores: unknown[]) => mysql.format(sql, valores as never[]);
