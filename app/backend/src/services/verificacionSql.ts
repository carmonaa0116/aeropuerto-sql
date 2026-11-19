import { readFileSync, statSync } from 'node:fs';
import { SQL_VERIFICAR } from '../paths.js';

/**
 * Lee sql/verificar_aeropuerto.sql para enseñar, junto a cada fila de
 * aeropuerto_verif.verificacion, el SELECT exacto que la calculó.
 * Cada comprobación es una rama `SELECT 'seccion', 'comprobacion', ...` de un
 * INSERT ... SELECT (varias ramas unidas con UNION ALL).
 */
export interface ScriptVerificacion {
  ramas: Map<string, string>; // clave = seccion|comprobacion
  reglas: { regla: string; explicacion: string }[];
  sqlEstado: string | null; // UPDATE que pone OK / FALLO / REVISAR / INFO
}

let cache: { mtime: number; datos: ScriptVerificacion } | null = null;

export const claveRama = (seccion: string, comprobacion: string) => `${seccion}|${comprobacion}`;

export function analizarScript(texto: string): ScriptVerificacion {
  const t = texto.replace(/\r\n/g, '\n');
  const ramas = new Map<string, string>();

  const reInsert = /INSERT INTO aeropuerto_verif\.verificacion[^\n]*\n([\s\S]*?);[ \t]*(?:--[^\n]*)?(?=\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = reInsert.exec(t))) {
    const cuerpo = m[1]
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n');
    for (const rama of cuerpo.split(/[ \t]+UNION ALL[ \t]*\n/)) {
      const r = /^\s*SELECT\s+'([^']*)'\s*,\s*'([^']*)'/.exec(rama);
      if (r) ramas.set(claveRama(r[1], r[2]), rama.trim());
    }
  }

  const reglas: ScriptVerificacion['reglas'] = [];
  for (const l of t.split('\n').slice(0, 40)) {
    const r = /^--\s*(?:Reglas:)?\s+(cero|igual|max|info)\s+=\s+(.+)$/.exec(l);
    if (r) reglas.push({ regla: r[1], explicacion: r[2].trim() });
  }

  const u = /UPDATE aeropuerto_verif\.verificacion SET estado[\s\S]*?;/.exec(t);
  return { ramas, reglas, sqlEstado: u ? u[0] : null };
}

export function scriptVerificacion(): ScriptVerificacion {
  const st = statSync(SQL_VERIFICAR);
  if (!cache || cache.mtime !== st.mtimeMs) {
    cache = { mtime: st.mtimeMs, datos: analizarScript(readFileSync(SQL_VERIFICAR, 'utf8')) };
  }
  return cache.datos;
}
