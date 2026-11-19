import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../paths.js';

/**
 * Lectura de los .md del repo (README.md, docs/rendimiento.md) para que la app
 * muestre el texto real, nunca uno inventado. Se relee si el archivo cambia.
 */
export interface Seccion {
  id: string;
  titulo: string;
  md: string;
}

export interface DocMarkdown {
  archivo: string; // ruta relativa al repo, para mostrarla
  titulo: string;
  intro: string;
  secciones: Seccion[];
  modificado: string; // ISO
}

const cache = new Map<string, { mtime: number; doc: DocMarkdown }>();

export function slug(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Divide un markdown por los encabezados `## ` (los `###` quedan dentro de su sección). */
export function trocear(texto: string): Omit<DocMarkdown, 'archivo' | 'modificado'> {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n');
  let titulo = '';
  const intro: string[] = [];
  const secciones: Seccion[] = [];
  let actual: { titulo: string; lineas: string[] } | null = null;
  let enCodigo = false;

  for (const l of lineas) {
    if (/^```/.test(l)) enCodigo = !enCodigo;
    if (!enCodigo && /^# /.test(l) && !titulo) {
      titulo = l.slice(2).trim();
      continue;
    }
    if (!enCodigo && /^## /.test(l)) {
      if (actual) secciones.push({ id: slug(actual.titulo), titulo: actual.titulo, md: actual.lineas.join('\n').trim() });
      actual = { titulo: l.slice(3).trim(), lineas: [] };
      continue;
    }
    (actual ? actual.lineas : intro).push(l);
  }
  if (actual) secciones.push({ id: slug(actual.titulo), titulo: actual.titulo, md: actual.lineas.join('\n').trim() });
  return { titulo, intro: intro.join('\n').trim(), secciones };
}

export function leerDoc(ruta: string): DocMarkdown {
  const st = statSync(ruta);
  const c = cache.get(ruta);
  if (c && c.mtime === st.mtimeMs) return c.doc;
  const doc: DocMarkdown = {
    archivo: path.relative(REPO_ROOT, ruta).split(path.sep).join('/'),
    ...trocear(readFileSync(ruta, 'utf8')),
    modificado: st.mtime.toISOString(),
  };
  cache.set(ruta, { mtime: st.mtimeMs, doc });
  return doc;
}

/** Elementos de primer nivel de una lista markdown (las líneas que siguen se unen al elemento). */
export function elementosLista(md: string): string[] {
  const out: string[] = [];
  for (const l of md.split('\n')) {
    if (/^[-*] /.test(l)) out.push(l.slice(2).trim());
    else if (/^\s+\S/.test(l) && out.length) out[out.length - 1] += ' ' + l.trim();
  }
  return out;
}
