import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

interface ErrorMySQL {
  code?: string;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
}

/**
 * Traduce errores a respuestas claras sin filtrar trazas, SQL con valores ni
 * credenciales. En el log solo van código y mensaje.
 */
export const manejadorErrores: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Parámetros no válidos',
      detalle: err.issues.map((i) => ({
        campo: i.path.join('.') || '(general)',
        mensaje: i.code === 'unrecognized_keys' ? `Parámetro no admitido: ${i.keys.join(', ')}` : i.message,
      })),
    });
    return;
  }

  if (err?.name === 'AbortError') {
    res.status(499).end();
    return;
  }

  const e = err as ErrorMySQL;
  switch (e.errno) {
    case 3024: // MySQL: ER_QUERY_TIMEOUT
    case 1969: // MariaDB: max_statement_time
      res.status(504).json({ error: 'La consulta superó el tiempo máximo y MySQL la cortó', codigo: e.errno });
      return;
    case 1317: // ER_QUERY_INTERRUPTED (KILL QUERY tras cancelar)
      res.status(499).json({ error: 'Consulta cancelada', codigo: e.errno });
      return;
    case 1045: // acceso denegado
      res.status(503).json({ error: 'MySQL rechazó el usuario o la clave de app/backend/.env', codigo: e.errno });
      return;
    case 1142:
    case 1143: // sin permiso sobre tabla/columna
      res.status(403).json({ error: 'El usuario de la app no tiene permiso para esta operación', codigo: e.errno, mensaje: e.sqlMessage });
      return;
  }
  if (e.code === 'ECONNREFUSED' || e.code === 'PROTOCOL_CONNECTION_LOST' || e.code === 'ETIMEDOUT') {
    res.status(503).json({ error: 'No hay conexión con MySQL. ¿Está arrancado el servicio MySQL80?', codigo: e.code });
    return;
  }

  console.error(`[error] ${req.method} ${req.path} -> ${e.code ?? err?.name ?? 'Error'} ${e.errno ?? ''} ${e.sqlMessage ?? err?.message ?? ''}`);
  res.status(500).json({ error: 'Error interno del servidor', codigo: e.code ?? null });
};
