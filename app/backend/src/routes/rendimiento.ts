import { readFileSync } from 'node:fs';
import { Router } from 'express';
import mysql from 'mysql2';
import { z } from 'zod';
import { ejecutarLectura, infoServidor } from '../db.js';
import { DOC_RENDIMIENTO, SQL_INDICES } from '../paths.js';
import { consultas, parametrosPorDefecto } from '../queries/registro.js';
import { conCache } from '../services/cache.js';
import { leerDoc, type DocMarkdown } from '../services/markdown.js';
import { senalCliente } from './consultas.js';

export const rutasRendimiento = Router();

// ------------------------------------------------------------------
// Mediciones antes/después sacadas de docs/rendimiento.md (no se inventan):
// cada bloque ### con "I<n>", "Q<nn>" y una fila "| Tiempo | antes | después |".
// ------------------------------------------------------------------
export interface Medicion {
  indice: string;
  consulta: string;
  motor: string;
  antesMs: number | null;
  despuesMs: number | null;
  antesTexto: string;
  despuesTexto: string;
  seccion: string;
}

/** "1,14 s" -> 1140; "**988 ms** (−49 %)" -> 988; "1.932 ms" -> 1932; "no medido" -> null */
export function aMs(celda: string): number | null {
  const m = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(ms|s)\b/.exec(celda.replace(/\*/g, ''));
  if (!m) return null;
  const n = Number(`${m[1].replace(/\./g, '')}.${m[2] ?? '0'}`);
  return m[3] === 's' ? Math.round(n * 1000) : n;
}

export function extraerMediciones(doc: DocMarkdown): Medicion[] {
  const out: Medicion[] = [];
  for (const s of doc.secciones) {
    const motor = /mysql/i.test(s.titulo) ? 'MySQL 8' : 'MariaDB 10.11';
    for (const bloque of s.md.split(/\n(?=### )/)) {
      const tit = /^### (.+)$/m.exec(bloque)?.[1];
      const fila = /^\|\s*Tiempo\s*\|([^|]*)\|([^|]*)\|/m.exec(bloque);
      const indice = tit && /\b(I\d+)\b/.exec(tit)?.[1];
      const consulta = tit && /\b(Q\d{2})\b/.exec(tit)?.[1];
      if (!fila || !indice || !consulta) continue;
      out.push({
        indice,
        consulta,
        motor,
        antesMs: aMs(fila[1]),
        despuesMs: aMs(fila[2]),
        antesTexto: fila[1].replace(/\*/g, '').trim(),
        despuesTexto: fila[2].replace(/\*/g, '').trim(),
        seccion: s.titulo,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------
// Índices añadidos por sql/05_indices.sql (comentario "-- I1. Q09: ..." + CREATE INDEX)
// ------------------------------------------------------------------
export interface IndiceProyecto {
  id: string;
  consulta: string;
  nombre: string;
  tabla: string;
  columnas: string;
}

export function indicesDelScript(texto: string): IndiceProyecto[] {
  const re = /--\s*(I\d+)\.\s*(Q\d{2}):[\s\S]*?CREATE INDEX\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/g;
  const out: IndiceProyecto[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) out.push({ id: m[1], consulta: m[2], nombre: m[3], tabla: m[4], columnas: m[5].trim() });
  return out;
}
const indicesProyecto = () => indicesDelScript(readFileSync(SQL_INDICES, 'utf8'));

rutasRendimiento.get('/doc', (_req, res) => {
  const doc = leerDoc(DOC_RENDIMIENTO);
  res.json({ ...doc, mediciones: extraerMediciones(doc), indicesProyecto: indicesProyecto() });
});

// Índices actuales de billete y vuelo (solo lectura de INFORMATION_SCHEMA; la app nunca crea ni borra índices)
export const SQL_INDICES_ACTUALES = `SELECT TABLE_NAME AS tabla,
       INDEX_NAME AS indice,
       NON_UNIQUE AS no_unico,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS columnas
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('billete', 'vuelo')
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME`;

rutasRendimiento.get('/indices', async (req, res) => {
  const r = await ejecutarLectura(SQL_INDICES_ACTUALES, [], { timeoutMs: 10_000, signal: senalCliente(req, res) });
  const delProyecto = new Set(indicesProyecto().map((i) => i.nombre));
  res.json({
    filas: r.filas.map((f) => ({ ...f, del_proyecto: delProyecto.has(String(f.indice)) })),
    ms: Math.round(r.ms),
    sql: SQL_INDICES_ACTUALES,
  });
});

// ------------------------------------------------------------------
// EXPLAIN ANALYZE en vivo de Q09 o Q10 con sus valores por defecto.
// EXPLAIN ANALYZE ejecuta la consulta de verdad (solo lectura) y devuelve el plan con tiempos reales.
// ------------------------------------------------------------------
const idExplain = z.enum(['q09', 'q10']);

/** Tiempo total del plan: MySQL (árbol) "actual time=a..b" de la raíz; MariaDB (JSON) r_total_time_ms. */
export function tiempoDelPlan(plan: string, esMariaDB: boolean): number | null {
  if (esMariaDB) {
    try {
      const j = JSON.parse(plan) as { query_block?: { r_total_time_ms?: number } };
      return j.query_block?.r_total_time_ms ?? null;
    } catch {
      return null;
    }
  }
  const m = /actual time=[\d.]+\.\.([\d.]+)/.exec(plan);
  return m ? Number(m[1]) : null;
}

rutasRendimiento.post('/explain/:id', async (req, res) => {
  const id = idExplain.safeParse(String(req.params.id).toLowerCase());
  if (!id.success) {
    res.status(404).json({ error: 'EXPLAIN ANALYZE en vivo solo está disponible para q09 y q10' });
    return;
  }
  const def = consultas.get(id.data)!;
  const params = def.esquema.parse(parametrosPorDefecto(def.id));
  const valores = def.valores(params);
  const { esMariaDB, version } = await infoServidor();
  // MySQL 8: EXPLAIN ANALYZE (árbol de texto). MariaDB (solo entorno de pruebas): ANALYZE FORMAT=JSON.
  const prefijo = esMariaDB ? 'ANALYZE FORMAT=JSON\n' : 'EXPLAIN ANALYZE\n';
  const sql = prefijo + def.sql;

  // TTL 0: no se guarda (es "en vivo"), pero dos clics seguidos comparten la misma ejecución
  const { valor } = await conCache(
    `explain:${def.id}`,
    0,
    (signal) => ejecutarLectura(sql, valores, { timeoutMs: def.timeoutMs, signal }),
    senalCliente(req, res),
  );
  const fila = valor.filas[0] ?? {};
  const plan = String(Object.values(fila)[0] ?? '');
  const esperado = indicesProyecto().find((i) => i.consulta === def.numero) ?? null;

  res.json({
    id: def.id,
    numero: def.numero,
    servidor: esMariaDB ? 'MariaDB' : 'MySQL',
    version,
    formato: esMariaDB ? 'json' : 'arbol',
    plan,
    msPlan: tiempoDelPlan(plan, esMariaDB),
    msTotal: Math.round(valor.ms),
    indiceEsperado: esperado,
    usaIndice: esperado ? plan.includes(esperado.nombre) : null,
    valores,
    sql: { ejecutado: sql, conValores: mysql.format(sql, valores), archivo: `sql/04_consultas_avanzadas.sql · ${def.numero}` },
  });
});
