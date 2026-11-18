import fs from 'node:fs';
import { SQL_CONSULTAS_ORIGINAL } from '../paths.js';

/**
 * Lee sql/04_consultas_avanzadas.sql (el archivo original del repo) y extrae,
 * para cada consulta, su título, pregunta, técnicas y el bloque completo.
 * Así el texto de la app sale del propio proyecto y no está duplicado a mano.
 */
export interface ConsultaOriginal {
  numero: string; // "Q01"
  titulo: string;
  pregunta: string;
  tecnicas: string;
  nota: string | null;
  bloque: string; // comentario de cabecera + SQL, tal cual en el archivo
  sql: string; // solo el SQL (sin comentarios)
}

let cache: Map<string, ConsultaOriginal> | null = null;

function unir(lineas: string[]): string {
  return lineas.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function parsearConsultas(texto: string): Map<string, ConsultaOriginal> {
  const res = new Map<string, ConsultaOriginal>();
  const normal = texto.replace(/\r\n/g, '\n');
  const partes = normal.split(/\n(?=-- -{10,}\n-- Q\d\d\.)/);
  for (const parte of partes.slice(1)) {
    const m = /-- Q(\d\d)\./.exec(parte);
    if (!m) continue;
    const numero = `Q${m[1]}`;
    const lineas = parte.split('\n');
    const comentario = lineas
      .filter((l) => l.trim().startsWith('--') && !/^-- -{10,}$/.test(l.trim()))
      .map((l) => l.replace(/^\s*--\s?/, ''));
    const sql = lineas.filter((l) => !l.trim().startsWith('--')).join('\n').trim();

    const iPregunta = comentario.findIndex((l) => l.startsWith('Pregunta:'));
    const iTecnicas = comentario.findIndex((l) => /^T[ée]cnicas:/.test(l));
    const titulo = unir(comentario.slice(0, iPregunta)).replace(/^Q\d\d\.\s*/, '');
    const pregunta = unir(comentario.slice(iPregunta, iTecnicas)).replace(/^Pregunta:\s*/, '');
    // Técnicas: hasta la primera línea que termina en punto; el resto es una nota
    const resto = comentario.slice(iTecnicas);
    let fin = resto.findIndex((l) => l.trim().endsWith('.'));
    if (fin < 0) fin = resto.length - 1;
    const tecnicas = unir(resto.slice(0, fin + 1)).replace(/^T[ée]cnicas:\s*/, '');
    const nota = unir(resto.slice(fin + 1)) || null;

    res.set(numero, { numero, titulo, pregunta, tecnicas, nota, bloque: parte.trim(), sql });
  }
  return res;
}

export function consultasOriginales(): Map<string, ConsultaOriginal> {
  if (!cache) {
    const texto = fs.readFileSync(SQL_CONSULTAS_ORIGINAL, 'utf8');
    cache = parsearConsultas(texto);
  }
  return cache;
}
