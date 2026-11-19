import mysql, { type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { ejecutarLectura, rwPool } from '../db.js';
import { codigoTriggers } from './demoTriggers.js';
import { ErrorPeticion, tablaMeta, type ColumnaMeta, type TablaMeta } from './explorador.js';

/**
 * CRUD de la fase 5 (solo vuelo, empleado, pasajero y aeronave), con el usuario app_rw.
 *  - Tablas y columnas: solo las de la lista blanca (metadatos del explorador, leídos de INFORMATION_SCHEMA).
 *  - Valores: siempre como parámetros (?), validados antes contra el tipo de la columna.
 *  - Todo va en una transacción. "simular" termina SIEMPRE en ROLLBACK; "confirmar", en COMMIT.
 *  - UPDATE y DELETE solo por clave primaria (WHERE pk = ?), con sql_safe_updates activo.
 * Las FK, UNIQUE, CHECK y triggers NO se comprueban aquí: se deja que MySQL los rechace
 * y se enseña su error tal cual, con una explicación.
 */

export const TABLAS_CRUD = ['vuelo', 'empleado', 'pasajero', 'aeronave'] as const;
export type TablaCrud = (typeof TABLAS_CRUD)[number];
export type ModoEscritura = 'simular' | 'confirmar';
export type Operacion = 'insertar' | 'actualizar' | 'borrar';
export type ValorEntrada = string | number | null;
export type Fila = Record<string, unknown>;

const mal = (campo: string, mensaje: string) => new ErrorPeticion('Datos no válidos', [{ campo, mensaje }]);

export async function tablaCrud(nombre: string, signal?: AbortSignal): Promise<TablaMeta> {
  if (!(TABLAS_CRUD as readonly string[]).includes(nombre)) {
    throw new ErrorPeticion(`La tabla "${nombre.slice(0, 64)}" no admite escritura: el CRUD es solo para ${TABLAS_CRUD.join(', ')}`, [], 404);
  }
  const t = await tablaMeta(nombre, signal);
  if (t.pk.length !== 1) throw new ErrorPeticion(`${nombre} no tiene una clave primaria de una sola columna`, [], 500);
  return t;
}

/** Columnas que se pueden escribir: todas menos las AUTO_INCREMENT (y la PK nunca en un UPDATE) */
export const editables = (t: TablaMeta, op: 'insertar' | 'actualizar') =>
  t.columnas.filter((c) => !c.auto && !(op === 'actualizar' && c.pk));

/** Obligatorias al crear: NOT NULL, sin valor por defecto y sin AUTO_INCREMENT */
export const obligatorias = (t: TablaMeta) => t.columnas.filter((c) => !c.auto && !c.nulo && c.defecto === null);

// ------------------------------------------------------------------
// Validación de cada valor según el tipo de la columna
// ------------------------------------------------------------------
const RANGOS: Record<string, [bigint, bigint, bigint]> = {
  // con signo: [mín, máx], sin signo: máx
  tinyint: [-128n, 127n, 255n],
  smallint: [-32768n, 32767n, 65535n],
  mediumint: [-8388608n, 8388607n, 16777215n],
  int: [-2147483648n, 2147483647n, 4294967295n],
  integer: [-2147483648n, 2147483647n, 4294967295n],
  bigint: [-9223372036854775808n, 9223372036854775807n, 18446744073709551615n],
};

function fechaReal(a: string, m: string, d: string): boolean {
  const f = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  return f.getUTCFullYear() === Number(a) && f.getUTCMonth() === Number(m) - 1 && f.getUTCDate() === Number(d);
}

/** Convierte lo que llega del formulario al valor del parámetro. Vacío = NULL si la columna lo admite. */
export function valorEscritura(col: ColumnaMeta, entrada: ValorEntrada, campo: string): string | number | null {
  const t = entrada === null ? '' : String(entrada).trim();
  if (t === '') {
    if (col.nulo) return null;
    throw mal(campo, 'Obligatorio (la columna es NOT NULL)');
  }
  if (col.opciones) {
    if (!col.opciones.includes(t)) throw mal(campo, `Valor no permitido. Opciones: ${col.opciones.join(', ')}`);
    return col.categoria === 'entero' ? Number(t) : t;
  }
  switch (col.categoria) {
    case 'entero': {
      if (!/^-?\d{1,20}$/.test(t)) throw mal(campo, 'Debe ser un número entero');
      const base = /^(\w+)/.exec(col.tipo.toLowerCase())?.[1] ?? 'int';
      const [min, max, maxSinSigno] = RANGOS[base] ?? RANGOS.int;
      const sinSigno = /unsigned/i.test(col.tipo);
      const n = BigInt(t);
      if (n < (sinSigno ? 0n : min) || n > (sinSigno ? maxSinSigno : max)) throw mal(campo, `Fuera del rango de ${col.tipo}`);
      return Number(t);
    }
    case 'decimal': {
      const [, p = '10', s = '0'] = /\((\d+),\s*(\d+)\)/.exec(col.tipo) ?? [];
      const enteros = Number(p) - Number(s);
      const re = new RegExp(`^-?\\d{1,${enteros}}(\\.\\d{1,${s}})?$`);
      if (Number(s) === 0 ? !/^-?\d+$/.test(t) || t.replace('-', '').length > enteros : !re.test(t))
        throw mal(campo, `Debe ser un número con hasta ${enteros} cifras enteras y ${s} decimales (punto decimal)`);
      return t; // como texto: DECIMAL exacto, sin pasar por coma flotante
    }
    case 'float':
      if (!/^-?\d{1,15}(\.\d{1,10})?$/.test(t)) throw mal(campo, 'Debe ser un número (punto decimal)');
      return Number(t);
    case 'fecha': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
      if (!m || !fechaReal(m[1], m[2], m[3])) throw mal(campo, 'Fecha no válida (AAAA-MM-DD)');
      return t;
    }
    case 'fechahora': {
      const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
      if (!m || !fechaReal(m[1], m[2], m[3]) || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)
        throw mal(campo, 'Fecha y hora no válidas (AAAA-MM-DD HH:MM, UTC)');
      return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}`;
    }
    default:
      if (col.longitud !== null && [...t].length > col.longitud) throw mal(campo, `Máximo ${col.longitud} caracteres (${col.tipo})`);
      return t;
  }
}

function columnaEditable(t: TablaMeta, op: 'insertar' | 'actualizar', nombre: string, campo: string): ColumnaMeta {
  const col = t.columnas.find((c) => c.nombre === nombre);
  if (!col) throw mal(campo, `La columna "${nombre.slice(0, 64)}" no existe en ${t.nombre}`);
  if (col.auto) throw mal(campo, `${col.nombre} es AUTO_INCREMENT: la pone MySQL`);
  if (op === 'actualizar' && col.pk) throw mal(campo, `${col.nombre} es la clave primaria: no se edita`);
  return col;
}

// ------------------------------------------------------------------
// SQL generado (nombres de la lista blanca con escapeId, valores como ?)
// ------------------------------------------------------------------
export interface PlanEscritura {
  operacion: Operacion;
  sql: string;
  valores: unknown[];
  /** Columna -> valor que se escribe (para explicar un error de FK sin detalle) */
  escritos: Record<string, unknown>;
}

export function planInsertar(t: TablaMeta, entrada: Record<string, ValorEntrada>): PlanEscritura {
  const cols: string[] = [];
  const valores: unknown[] = [];
  for (const [nombre, v] of Object.entries(entrada)) {
    const col = columnaEditable(t, 'insertar', nombre, `valores.${nombre}`);
    // Vacío en una columna con DEFAULT: se omite y MySQL pone el defecto
    if ((v === null || String(v).trim() === '') && col.defecto !== null) continue;
    const valor = valorEscritura(col, v, `valores.${nombre}`);
    cols.push(col.nombre);
    valores.push(valor);
  }
  const faltan = obligatorias(t).filter((c) => !cols.includes(c.nombre));
  if (faltan.length) {
    throw new ErrorPeticion(
      'Datos no válidos',
      faltan.map((c) => ({ campo: `valores.${c.nombre}`, mensaje: 'Obligatorio (NOT NULL y sin valor por defecto)' })),
    );
  }
  const sql = cols.length
    ? `INSERT INTO ${mysql.escapeId(t.nombre)} (${cols.map((c) => mysql.escapeId(c)).join(', ')})\nVALUES (${cols.map(() => '?').join(', ')})`
    : `INSERT INTO ${mysql.escapeId(t.nombre)} () VALUES ()`;
  return { operacion: 'insertar', sql, valores, escritos: Object.fromEntries(cols.map((c, i) => [c, valores[i]])) };
}

export function planActualizar(t: TablaMeta, id: number, entrada: Record<string, ValorEntrada>): PlanEscritura {
  const partes: string[] = [];
  const valores: unknown[] = [];
  const escritos: Record<string, unknown> = {};
  for (const [nombre, v] of Object.entries(entrada)) {
    const col = columnaEditable(t, 'actualizar', nombre, `valores.${nombre}`);
    partes.push(`${mysql.escapeId(col.nombre)} = ?`);
    escritos[col.nombre] = valorEscritura(col, v, `valores.${nombre}`);
    valores.push(escritos[col.nombre]);
  }
  if (!partes.length) throw mal('valores', 'No hay ningún cambio que guardar');
  return {
    operacion: 'actualizar',
    sql: `UPDATE ${mysql.escapeId(t.nombre)}\nSET ${partes.join(',\n    ')}\nWHERE ${mysql.escapeId(t.pk[0])} = ?`,
    valores: [...valores, id],
    escritos,
  };
}

export function planBorrar(t: TablaMeta, id: number): PlanEscritura {
  return { operacion: 'borrar', sql: `DELETE FROM ${mysql.escapeId(t.nombre)}\nWHERE ${mysql.escapeId(t.pk[0])} = ?`, valores: [id], escritos: {} };
}

export const sqlLeerFila = (t: TablaMeta, bloquear: boolean) =>
  `SELECT * FROM ${mysql.escapeId(t.nombre)} WHERE ${mysql.escapeId(t.pk[0])} = ?${bloquear ? ' FOR UPDATE' : ''}`;

// ------------------------------------------------------------------
// Filas de otras tablas que apuntan a una fila (app_ro, una subconsulta con LIMIT por FK)
// ------------------------------------------------------------------
export const TOPE_DEPENDENCIAS = 1000;
export interface Dependencia {
  tabla: string;
  columna: string;
  filas: number;
  masDe: boolean;
}

export async function contarDependencias(
  t: TablaMeta,
  id: number,
  signal?: AbortSignal,
): Promise<{ dependencias: Dependencia[]; sql: string | null; ms: number }> {
  const deps = t.referenciadaPor;
  if (!deps.length) return { dependencias: [], sql: null, ms: 0 };
  // Nombres de la lista blanca (metadatos), valor como ?. Las columnas de FK tienen índice.
  const sql = deps
    .map(
      (d) =>
        `SELECT ${mysql.escape(d.tabla)} AS tabla, ${mysql.escape(d.columna)} AS columna, COUNT(*) AS filas\n` +
        `FROM (SELECT 1 FROM ${mysql.escapeId(d.tabla)} WHERE ${mysql.escapeId(d.columna)} = ? LIMIT ${TOPE_DEPENDENCIAS + 1}) x`,
    )
    .join('\nUNION ALL\n');
  const valores = deps.map(() => id);
  const r = await ejecutarLectura(sql, valores, { timeoutMs: 5_000, signal });
  return {
    dependencias: r.filas.map((f) => ({
      tabla: String(f.tabla),
      columna: String(f.columna),
      filas: Math.min(Number(f.filas), TOPE_DEPENDENCIAS),
      masDe: Number(f.filas) > TOPE_DEPENDENCIAS,
    })),
    sql: mysql.format(sql, valores),
    ms: r.ms,
  };
}

/**
 * MySQL 8 devuelve 1216/1217 (la versión corta, sin decir qué tabla ni qué FK) cuando el
 * usuario no tiene permisos amplios sobre la otra tabla, que es el caso de app_rw (permisos
 * mínimos). Para explicarlo igual, se averigua con app_ro, después del ROLLBACK:
 *  - 1217 (borrar): qué tablas tienen filas que apuntan a la fila;
 *  - 1216 (insertar/editar): qué valor de FK escrito no existe en su tabla.
 */
export async function completarErrorFk(err: ErrorTraducido, t: TablaMeta, plan: PlanEscritura, id: number | null): Promise<void> {
  if (err.errno === 1217 && id !== null) {
    const hijas = (await contarDependencias(t, id)).dependencias.filter((d) => d.filas > 0);
    if (!hijas.length) return;
    const lista = hijas.map((d) => `${d.tabla} (${d.masDe ? 'más de ' : ''}${d.filas} por ${d.columna})`).join(', ');
    err.explicacion = `No se puede borrar esta fila: hay filas en ${lista} que apuntan a ella. Las FK del proyecto no tienen ON DELETE CASCADE, así que MySQL lo impide en vez de borrar en cadena. (MySQL da el error corto 1217, sin nombrar la tabla, porque app_rw tiene permisos mínimos; la tabla se ha averiguado con una consulta aparte.)`;
    err.origen = { nombre: hijas.map((d) => `${d.tabla}.${d.columna} → ${t.nombre}.${t.pk[0]}`).join(', '), archivo: 'sql/creacion.sql', sql: null };
  }
  if (err.errno === 1216) {
    for (const col of t.columnas) {
      const v = plan.escritos[col.nombre];
      if (!col.fk || v === null || v === undefined) continue;
      const sql = `SELECT 1 AS hay FROM ${mysql.escapeId(col.fk.tabla)} WHERE ${mysql.escapeId(col.fk.columna)} = ? LIMIT 1`;
      if ((await ejecutarLectura(sql, [v], { timeoutMs: 3_000 })).filas.length) continue;
      err.explicacion = `El valor de ${col.nombre} no existe en ${col.fk.tabla}.${col.fk.columna}. Elige uno del buscador.`;
      err.origen = {
        nombre: `${t.nombre}.${col.nombre} → ${col.fk.tabla}.${col.fk.columna}`,
        archivo: 'sql/creacion.sql',
        sql: `FOREIGN KEY (${col.nombre}) REFERENCES ${col.fk.tabla}(${col.fk.columna})`,
      };
      return;
    }
  }
}

// ------------------------------------------------------------------
// Triggers de cada tabla (leídos de sql/01-03, no escritos a mano)
// ------------------------------------------------------------------
export interface TriggerTabla {
  nombre: string;
  momento: string; // BEFORE INSERT, BEFORE UPDATE...
  llama: string[]; // procedimientos sp_validar_*
  archivo: string;
}

export function triggersDe(tabla: string): TriggerTabla[] {
  const out: TriggerTabla[] = [];
  for (const [nombre, { archivo, sql }] of codigoTriggers()) {
    const m = /CREATE TRIGGER \w+ (BEFORE|AFTER) (INSERT|UPDATE|DELETE) ON `?(\w+)`?/i.exec(sql);
    if (!m || m[3] !== tabla) continue;
    out.push({ nombre, momento: `${m[1]} ${m[2]}`.toUpperCase(), llama: [...new Set([...sql.matchAll(/CALL (\w+)\(/g)].map((c) => c[1]))], archivo });
  }
  return out;
}

/** Prefijos de los mensajes de los SIGNAL de cada procedimiento: MESSAGE_TEXT = '...' o CONCAT('...', ...) */
function mensajesSignal(): { prefijo: string; rutina: string; archivo: string }[] {
  const out: { prefijo: string; rutina: string; archivo: string }[] = [];
  for (const [rutina, { archivo, sql }] of codigoTriggers()) {
    if (!/SIGNAL/i.test(sql)) continue;
    for (const m of sql.matchAll(/MESSAGE_TEXT\s*=\s*'([^']+)'/g)) out.push({ prefijo: m[1], rutina, archivo });
    for (const m of sql.matchAll(/SET v_msg\s*=\s*CONCAT\(\s*'([^']+)'/g)) out.push({ prefijo: m[1], rutina, archivo });
  }
  return out.sort((a, b) => b.prefijo.length - a.prefijo.length);
}

/** Explicación de cada regla, resumida de la cabecera de sql/01-03 */
const REGLA: Record<string, string> = {
  sp_validar_puerta:
    'La puerta queda ocupada desde 45 min antes de la salida prevista hasta 10 min después de la salida (la real si es más tarde), y tiene que ser del aeropuerto de origen de la ruta. Elige otra puerta, cambia la hora o deja la puerta en NULL.',
  sp_validar_pista:
    'Dos salidas por la misma pista deben separarse al menos 2 minutos, y la pista tiene que ser del aeropuerto de origen. Elige otra pista, mueve la salida o deja la pista en NULL.',
  sp_validar_aeronave:
    'Una aeronave no puede estar en dos vuelos no cancelados con horas previstas solapadas, ni volar durante una orden de mantenimiento (si no tiene fecha_fin, bloquea sin fin). Elige otra aeronave o cambia las horas.',
  sp_validar_billete: 'No se venden billetes de un vuelo cancelado ni por encima de la capacidad del modelo de aeronave.',
  sp_validar_descanso: 'Un tripulante no puede tener dos vuelos cuyas ventanas (salida - 60 min, llegada + 45 min) se solapen.',
};

// ------------------------------------------------------------------
// Traducción de errores de MySQL (el mensaje original se devuelve siempre tal cual)
// ------------------------------------------------------------------
export interface ErrorTraducido {
  errno: number;
  estadoSql: string | null;
  mensaje: string;
  tipo: 'trigger' | 'unique' | 'fk_hijo' | 'fk_padre' | 'check' | 'columna' | 'bloqueo' | 'permiso' | 'otro';
  explicacion: string;
  origen: { nombre: string; archivo: string | null; sql: string | null } | null;
}

interface ErrorMySQL {
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
  message?: string;
}

export const esErrorMySQL = (e: unknown): e is ErrorMySQL & { errno: number } =>
  typeof e === 'object' && e !== null && typeof (e as ErrorMySQL).errno === 'number' && typeof (e as ErrorMySQL).sqlState === 'string';

/** `aeropuerto`.`billete` -> billete; 'vuelo.uq_vuelo' -> uq_vuelo */
const sinEsquema = (n: string) => n.replace(/`/g, '').split('.').pop() ?? n;

export function traducirError(e: ErrorMySQL & { errno: number }, t: TablaMeta, op: Operacion): ErrorTraducido {
  const mensaje = e.sqlMessage ?? e.message ?? '';
  const base = { errno: e.errno, estadoSql: e.sqlState ?? null, mensaje };
  const columna = /(?:column|for column|field)\s+'([^']+)'/i.exec(mensaje)?.[1];

  switch (e.errno) {
    case 1644: {
      // SIGNAL SQLSTATE '45000' de un trigger o de un sp_validar_*
      const m = mensajesSignal().find((x) => mensaje.startsWith(x.prefijo));
      const trg = m ? triggersDe(t.nombre).find((x) => x.llama.includes(m.rutina) && x.momento.endsWith(op === 'insertar' ? 'INSERT' : 'UPDATE')) : undefined;
      return {
        ...base,
        tipo: 'trigger',
        explicacion: m
          ? `Lo rechaza ${trg ? `el trigger ${trg.nombre}, que llama a ` : ''}${m.rutina}. ${REGLA[m.rutina] ?? ''}`.trim()
          : 'Lo rechaza un trigger con SIGNAL SQLSTATE 45000.',
        origen: m ? { nombre: m.rutina, archivo: m.archivo, sql: codigoTriggers().get(m.rutina)?.sql ?? null } : null,
      };
    }
    case 1062: {
      const clave = sinEsquema(/for key '([^']+)'/i.exec(mensaje)?.[1] ?? '');
      const idx = t.indices.find((i) => i.nombre === clave);
      const cols = idx?.columnas.join(', ') ?? clave;
      return {
        ...base,
        tipo: 'unique',
        explicacion:
          clave === 'PRIMARY'
            ? 'Ya existe una fila con esa clave primaria.'
            : `Ya hay otra fila de ${t.nombre} con el mismo valor en (${cols}): el índice UNIQUE ${clave} no admite duplicados.`,
        origen: { nombre: clave, archivo: 'sql/creacion.sql', sql: idx ? `UNIQUE KEY ${clave} (${cols})` : null },
      };
    }
    case 1451:
    case 1217: {
      const hijo = /fails \(([^,]+),/i.exec(mensaje)?.[1];
      const fkCol = /FOREIGN KEY \(`([^`]+)`\)/i.exec(mensaje)?.[1];
      const nombreHijo = hijo ? sinEsquema(hijo) : null;
      return {
        ...base,
        tipo: 'fk_hijo',
        explicacion: nombreHijo
          ? `No se puede ${op === 'borrar' ? 'borrar' : 'cambiar la clave de'} esta fila: hay filas en ${nombreHijo}${fkCol ? ` (columna ${fkCol})` : ''} que apuntan a ella. Las FK del proyecto no tienen ON DELETE CASCADE, así que MySQL lo impide en vez de borrar en cadena.`
          : 'Otra tabla tiene filas que apuntan a esta. Las FK del proyecto no tienen ON DELETE CASCADE.',
        origen: nombreHijo ? { nombre: `${nombreHijo}.${fkCol ?? '?'} → ${t.nombre}.${t.pk[0]}`, archivo: 'sql/creacion.sql', sql: null } : null,
      };
    }
    case 1452:
    case 1216: {
      const fkCol = /FOREIGN KEY \(`([^`]+)`\)/i.exec(mensaje)?.[1];
      const ref = /REFERENCES `([^`]+)` \(`([^`]+)`\)/i.exec(mensaje);
      return {
        ...base,
        tipo: 'fk_padre',
        explicacion:
          fkCol && ref
            ? `El valor de ${fkCol} no existe en ${ref[1]}.${ref[2]}. Elige uno del buscador.`
            : 'Una clave foránea apunta a una fila que no existe.',
        origen: fkCol && ref ? { nombre: `${t.nombre}.${fkCol} → ${ref[1]}.${ref[2]}`, archivo: 'sql/creacion.sql', sql: `FOREIGN KEY (${fkCol}) REFERENCES ${ref[1]}(${ref[2]})` } : null,
      };
    }
    case 3819: // MySQL: Check constraint 'chk' is violated.
    case 4025: {
      // MariaDB: CONSTRAINT `chk` failed for `db`.`tabla`
      const nombre = /(?:constraint\s+['`])([^'`]+)['`]/i.exec(mensaje)?.[1] ?? '';
      const chk = t.checks.find((c) => c.nombre === nombre);
      return {
        ...base,
        tipo: 'check',
        explicacion: chk ? `No cumple la restricción CHECK ${nombre}: ${chk.condicion}.` : `No cumple la restricción CHECK ${nombre}.`,
        origen: { nombre, archivo: 'sql/creacion.sql', sql: chk ? `CONSTRAINT ${nombre} CHECK ${chk.condicion}` : null },
      };
    }
    case 1048:
    case 1364:
      return { ...base, tipo: 'columna', explicacion: `${columna ?? 'Una columna'} es NOT NULL y no tiene valor por defecto.`, origen: null };
    case 1406:
      return { ...base, tipo: 'columna', explicacion: `El texto es demasiado largo para ${columna ?? 'la columna'}.`, origen: null };
    case 1265:
    case 1366:
    case 1292:
      return { ...base, tipo: 'columna', explicacion: `El valor no es válido para el tipo de ${columna ?? 'la columna'} (modo estricto de MySQL).`, origen: null };
    case 1205:
    case 1213:
      return {
        ...base,
        tipo: 'bloqueo',
        explicacion: 'Otra transacción tenía la fila bloqueada (p. ej. una pestaña de Workbench sin COMMIT). Se esperó 5 s y se canceló. Vuelve a intentarlo.',
        origen: null,
      };
    case 1142:
    case 1143:
      return {
        ...base,
        tipo: 'permiso',
        explicacion: 'El usuario app_rw no tiene permiso para esta operación. Revisa los GRANT de app/backend/sql/00_usuarios_app.sql.',
        origen: null,
      };
    default:
      return { ...base, tipo: 'otro', explicacion: 'MySQL rechazó la sentencia.', origen: null };
  }
}

// ------------------------------------------------------------------
// Ejecución en transacción
// ------------------------------------------------------------------
export interface PasoTransaccion {
  sql: string;
  ms: number;
  filas?: number;
  errno?: number; // la sentencia que falló
}

export interface ResultadoEscritura {
  tabla: string;
  operacion: Operacion;
  modo: ModoEscritura;
  resultado: 'ok' | 'error';
  final: 'COMMIT' | 'ROLLBACK';
  id: number | null;
  filasAfectadas: number | null;
  antes: Fila | null;
  despues: Fila | null;
  cambios: { columna: string; antes: unknown; despues: unknown }[];
  error: ErrorTraducido | null;
  sql: { texto: string; valores: unknown[]; conValores: string };
  pasos: PasoTransaccion[];
  ms: number;
}

const normal = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** El valor que guardó MySQL coincide con el que tenía el formulario (fechas: se ignoran los segundos :00) */
const igual = (a: unknown, b: unknown) => {
  const x = normal(a);
  const y = normal(b);
  if (x === y) return true;
  if (x === null || y === null) return false;
  return x.replace(/[ T](\d{2}:\d{2})(:00)?$/, ' $1') === y.replace(/[ T](\d{2}:\d{2})(:00)?$/, ' $1');
};

export async function ejecutarEscritura(
  t: TablaMeta,
  plan: PlanEscritura,
  modo: ModoEscritura,
  opciones: { id?: number; original?: Record<string, ValorEntrada> } = {},
): Promise<ResultadoEscritura> {
  let pool;
  try {
    pool = rwPool();
  } catch {
    throw new ErrorPeticion('Falta DB_RW_PASSWORD en app/backend/.env: el CRUD escribe con el usuario app_rw.', [], 503);
  }
  const conn: PoolConnection = await pool.getConnection();
  const pasos: PasoTransaccion[] = [];
  const paso = async <T>(sql: string, valores: unknown[] = []): Promise<T> => {
    const texto = valores.length ? mysql.format(sql, valores as never[]) : sql;
    const t0 = performance.now();
    const ms = () => Math.round((performance.now() - t0) * 10) / 10;
    try {
      const [r] = await conn.query({ sql, values: valores });
      const res = r as ResultSetHeader | RowDataPacket[];
      pasos.push({ sql: texto, ms: ms(), filas: Array.isArray(res) ? res.length : res.affectedRows });
      return r as T;
    } catch (e) {
      pasos.push({ sql: texto, ms: ms(), errno: esErrorMySQL(e) ? e.errno : undefined });
      throw e;
    }
  };

  const salida: ResultadoEscritura = {
    tabla: t.nombre,
    operacion: plan.operacion,
    modo,
    resultado: 'ok',
    final: 'ROLLBACK',
    id: opciones.id ?? null,
    filasAfectadas: null,
    antes: null,
    despues: null,
    cambios: [],
    error: null,
    sql: { texto: plan.sql, valores: plan.valores, conValores: mysql.format(plan.sql, plan.valores as never[]) },
    pasos,
    ms: 0,
  };

  const t0 = performance.now();
  let abierta = false;
  try {
    // Si otra sesión tiene la fila bloqueada, mejor fallar en 5 s que esperar 50
    await conn.query('SET SESSION innodb_lock_wait_timeout = 5');
    // Igual que Workbench: sin WHERE por clave, MySQL rechaza UPDATE/DELETE
    await conn.query('SET SESSION sql_safe_updates = 1');
    await paso('START TRANSACTION');
    abierta = true;

    if (plan.operacion !== 'insertar') {
      // La fila que se va a tocar, bloqueada hasta el final de la transacción
      const [fila] = await paso<RowDataPacket[]>(sqlLeerFila(t, true), [opciones.id]);
      if (!fila) throw new ErrorPeticion(`No existe ${t.nombre} con ${t.pk[0]} = ${opciones.id}`, [], 404);
      salida.antes = { ...fila };
      // Concurrencia optimista: si la fila cambió desde que se abrió el formulario, no se pisa
      const distintas = Object.entries(opciones.original ?? {}).filter(([k, v]) => k in fila && !igual(fila[k], v));
      if (distintas.length) {
        throw new ErrorPeticion(
          'La fila ha cambiado desde que la abriste. Vuelve a abrirla para ver los datos actuales.',
          distintas.map(([k, v]) => ({ campo: k, mensaje: `tenías ${normal(v) ?? 'NULL'}, ahora es ${normal(fila[k]) ?? 'NULL'}` })),
          409,
        );
      }
    }

    const r = await paso<ResultSetHeader>(plan.sql, plan.valores);
    salida.filasAfectadas = r.affectedRows;
    if (plan.operacion === 'insertar') salida.id = r.insertId;

    if (plan.operacion !== 'borrar') {
      // Cómo ha quedado la fila dentro de la transacción (defectos, AUTO_INCREMENT...)
      const [fila] = await paso<RowDataPacket[]>(sqlLeerFila(t, false), [salida.id]);
      salida.despues = fila ? { ...fila } : null;
    }
    if (salida.antes && salida.despues) {
      salida.cambios = t.columnas
        .filter((c) => !igual(salida.antes![c.nombre], salida.despues![c.nombre]))
        .map((c) => ({ columna: c.nombre, antes: salida.antes![c.nombre], despues: salida.despues![c.nombre] }));
    }

    salida.final = modo === 'confirmar' ? 'COMMIT' : 'ROLLBACK';
    await paso(salida.final);
    abierta = false;
  } catch (e) {
    if (abierta) {
      await paso('ROLLBACK').catch(() => undefined);
      abierta = false;
    }
    if (!esErrorMySQL(e)) throw e;
    salida.resultado = 'error';
    salida.final = 'ROLLBACK';
    salida.error = traducirError(e, t, plan.operacion);
  } finally {
    salida.ms = Math.round(performance.now() - t0);
    if (abierta) conn.destroy(); // no devolver al pool una conexión con transacción a medias
    else conn.release();
  }
  // Fuera de la transacción (ya hay ROLLBACK): solo lectura con app_ro
  if (salida.error && (salida.error.errno === 1216 || salida.error.errno === 1217)) {
    await completarErrorFk(salida.error, t, plan, salida.id).catch(() => undefined);
  }
  return salida;
}
