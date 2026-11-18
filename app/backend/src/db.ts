import mysql, { type Pool, type FieldPacket, type RowDataPacket } from 'mysql2/promise';
import { config } from './config.js';

// Opciones comunes de los pools.
//  - multipleStatements: false -> una sola sentencia por llamada (sin inyección apilada)
//  - dateStrings: true         -> DATETIME llega como texto tal cual (UTC), sin conversión de zona
//  - decimalNumbers: true      -> DECIMAL llega como número (para las gráficas)
const base = {
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  charset: 'utf8mb4',
  multipleStatements: false,
  dateStrings: true,
  decimalNumbers: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  waitForConnections: true,
  queueLimit: 50,
} as const;

/** Pool de solo lectura (usuario app_ro). */
export const roPool: Pool = mysql.createPool({
  ...base,
  user: config.DB_RO_USER,
  password: config.DB_RO_PASSWORD,
  connectionLimit: 6,
});

let rwPoolInterno: Pool | null = null;
/** Pool de escritura (usuario app_rw). Se crea al primer uso (fase 3+). */
export function rwPool(): Pool {
  if (!config.DB_RW_PASSWORD) throw new Error('Falta DB_RW_PASSWORD en app/backend/.env');
  rwPoolInterno ??= mysql.createPool({
    ...base,
    user: config.DB_RW_USER,
    password: config.DB_RW_PASSWORD,
    connectionLimit: 3,
  });
  return rwPoolInterno;
}

// ------------------------------------------------------------------
// Servidor: MySQL 8 (el de verdad) o MariaDB (solo en el entorno de pruebas).
// Cambia el nombre de la variable que corta consultas largas.
// ------------------------------------------------------------------
export interface InfoServidor {
  version: string;
  esMariaDB: boolean;
}
let info: InfoServidor | null = null;

export async function infoServidor(): Promise<InfoServidor> {
  if (!info) {
    const [filas] = await roPool.query<RowDataPacket[]>('SELECT VERSION() AS version');
    const version = String(filas[0].version);
    info = { version, esMariaDB: /mariadb/i.test(version) };
  }
  return info;
}

async function sqlLimiteTiempo(ms: number): Promise<string> {
  const { esMariaDB } = await infoServidor();
  const n = Math.max(1, Math.round(ms));
  // MySQL: max_execution_time en ms (solo afecta a SELECT). MariaDB: max_statement_time en s.
  return esMariaDB
    ? `SET SESSION max_statement_time = ${(n / 1000).toFixed(3)}`
    : `SET SESSION max_execution_time = ${n}`;
}

export interface Campo {
  nombre: string;
  tipo: number | undefined;
}

export interface ResultadoLectura {
  filas: Record<string, unknown>[];
  campos: Campo[];
  ms: number;
}

/**
 * Ejecuta un SELECT con app_ro, con límite de tiempo en el servidor y
 * cancelación: si el cliente aborta (cierra la pestaña, cambia de filtro),
 * se lanza KILL QUERY sobre el hilo de MySQL para no dejar trabajo colgado.
 * Los valores van siempre como parámetros (?), nunca concatenados.
 */
export async function ejecutarLectura(
  sql: string,
  valores: unknown[],
  opciones: { timeoutMs: number; signal?: AbortSignal },
): Promise<ResultadoLectura> {
  const conn = await roPool.getConnection();
  let enCurso = false;
  const alAbortar = () => {
    if (enCurso) {
      // Un usuario puede matar sus propios hilos sin privilegios extra
      roPool.query('KILL QUERY ?', [conn.threadId]).catch(() => undefined);
    }
  };
  try {
    await conn.query(await sqlLimiteTiempo(opciones.timeoutMs));
    opciones.signal?.addEventListener('abort', alAbortar, { once: true });
    if (opciones.signal?.aborted) throw new DOMException('Cancelada', 'AbortError');
    enCurso = true;
    const t0 = performance.now();
    const [filas, campos] = (await conn.query({ sql, values: valores })) as [RowDataPacket[], FieldPacket[]];
    const ms = performance.now() - t0;
    enCurso = false;
    return {
      filas: filas.map((f) => ({ ...f })),
      campos: campos.map((c) => ({ nombre: c.name, tipo: c.columnType })),
      ms,
    };
  } finally {
    enCurso = false;
    opciones.signal?.removeEventListener('abort', alAbortar);
    conn.release();
  }
}

export async function cerrarPools(): Promise<void> {
  await roPool.end();
  if (rwPoolInterno) await rwPoolInterno.end();
}
