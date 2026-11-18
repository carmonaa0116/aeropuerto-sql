import { Router, type Request, type Response } from 'express';
import mysql from 'mysql2';
import { z } from 'zod';
import { ejecutarLectura } from '../db.js';
import { consultas } from '../queries/registro.js';
import { consultasOriginales } from '../services/consultasOriginales.js';
import { conCache } from '../services/cache.js';

export const rutasConsultas = Router();

/** AbortSignal que salta si el cliente cierra la conexión antes de recibir la respuesta. */
export function senalCliente(req: Request, res: Response): AbortSignal {
  const control = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) control.abort();
  });
  return control.signal;
}

function metadatos(id: string) {
  const def = consultas.get(id)!;
  const orig = consultasOriginales().get(def.numero);
  return {
    id: def.id,
    numero: def.numero,
    titulo: orig?.titulo ?? def.numero,
    pregunta: orig?.pregunta ?? '',
    tecnicas: orig?.tecnicas ?? '',
    nota: orig?.nota ?? null,
    parametros: def.parametros,
    sinParametros: def.sinParametros ?? null,
    timeoutMs: def.timeoutMs,
  };
}

// Lista de las 10 consultas con su título, pregunta y técnicas (sacados de sql/04)
rutasConsultas.get('/', (_req, res) => {
  res.json([...consultas.keys()].map(metadatos));
});

// Aeropuertos de origen con vuelos (para el selector de Q06). No es una consulta del proyecto:
// solo alimenta el desplegable, y se cachea una hora.
rutasConsultas.get('/aux/aeropuertos-origen', async (req, res) => {
  const sql = `SELECT ap.codigo_iata, ap.nombre, ap.ciudad, COUNT(*) AS salidas
FROM vuelo v
JOIN ruta r        ON r.id_ruta = v.id_ruta
JOIN aeropuerto ap ON ap.id_aeropuerto = r.id_aeropuerto_origen
GROUP BY ap.id_aeropuerto, ap.codigo_iata, ap.nombre, ap.ciudad
ORDER BY salidas DESC`;
  const { valor } = await conCache('aux:aeropuertos-origen', 60 * 60_000, (signal) =>
    ejecutarLectura(sql, [], { timeoutMs: 30_000, signal }),
    senalCliente(req, res),
  );
  res.json(valor.filas);
});

const idValido = z.enum(['q01', 'q02', 'q03', 'q04', 'q05', 'q06', 'q07', 'q08', 'q09', 'q10']);

rutasConsultas.get('/:id', async (req, res) => {
  const id = idValido.safeParse(String(req.params.id).toLowerCase());
  if (!id.success) {
    res.status(404).json({ error: 'Consulta desconocida', detalle: 'Las consultas válidas son q01 a q10' });
    return;
  }
  const def = consultas.get(id.data)!;
  const orig = consultasOriginales().get(def.numero);
  const params = def.esquema.parse(req.query); // ZodError -> 400 en el middleware de errores
  const valores = def.valores(params);
  const clave = `${def.id}:${JSON.stringify(valores)}`;

  const { valor, desdeCache } = await conCache(
    clave,
    def.cacheTtlMs,
    (signal) => ejecutarLectura(def.sql, valores, { timeoutMs: def.timeoutMs, signal }),
    senalCliente(req, res),
  );

  res.json({
    ...metadatos(def.id),
    params,
    valores,
    filas: valor.filas,
    campos: valor.campos,
    ms: Math.round(valor.ms),
    desdeCache,
    sql: {
      ejecutado: def.sql, // con ? (lo que recibe mysql2)
      conValores: mysql.format(def.sql, valores), // solo para mostrar; mysql2 escapa cada valor
      original: orig?.bloque ?? null, // bloque tal cual en sql/04_consultas_avanzadas.sql
      archivo: `sql/04_consultas_avanzadas.sql · ${def.numero}`,
    },
  });
});
