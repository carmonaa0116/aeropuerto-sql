import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Este archivo está en app/backend/src/: subiendo se llega a backend/ y a la raíz del repo.
const aqui = path.dirname(fileURLToPath(import.meta.url));

export const BACKEND_ROOT = path.resolve(aqui, '..');
export const REPO_ROOT = path.resolve(BACKEND_ROOT, '..', '..');
export const QUERIES_DIR = path.join(BACKEND_ROOT, 'src', 'queries');
export const SQL_CONSULTAS_ORIGINAL = path.join(REPO_ROOT, 'sql', '04_consultas_avanzadas.sql');
export const README_REPO = path.join(REPO_ROOT, 'README.md');
export const DOC_RENDIMIENTO = path.join(REPO_ROOT, 'docs', 'rendimiento.md');
export const SQL_VERIFICAR = path.join(REPO_ROOT, 'sql', 'verificar_aeropuerto.sql');
export const SQL_INDICES = path.join(REPO_ROOT, 'sql', '05_indices.sql');
export const SQL_DEMO_TRIGGERS = path.join(BACKEND_ROOT, 'sql', '01_demo_triggers.sql');
export const SQL_TRIGGERS = ['01_triggers_vuelo.sql', '02_triggers_ventas.sql', '03_triggers_tripulacion.sql'].map((f) =>
  path.join(REPO_ROOT, 'sql', f),
);
export const SQL_CREACION = path.join(REPO_ROOT, 'sql', 'creacion.sql');
