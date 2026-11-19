// Pruebas sin base de datos: lectura de README.md, docs/rendimiento.md, sql/05 y sql/verificar_aeropuerto.sql.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOC_RENDIMIENTO, README_REPO, SQL_INDICES, SQL_VERIFICAR } from '../src/paths.js';
import { leerDoc, trocear, elementosLista } from '../src/services/markdown.js';
import { analizarScript } from '../src/services/verificacionSql.js';
import { aMs, extraerMediciones, indicesDelScript, tiempoDelPlan } from '../src/routes/rendimiento.js';

describe('markdown del repo', () => {
  it('trocea por ## y respeta los bloques de código', () => {
    const d = trocear('# T\nintro\n## A\nuno\n```\n## no es sección\n```\n## B\ndos');
    expect(d.titulo).toBe('T');
    expect(d.intro).toBe('intro');
    expect(d.secciones.map((s) => s.titulo)).toEqual(['A', 'B']);
    expect(d.secciones[0].md).toContain('## no es sección');
  });

  it('el README tiene las secciones que pinta la página de inicio', () => {
    const d = leerDoc(README_REPO);
    const titulos = d.secciones.map((s) => s.titulo);
    for (const t of ['Qué demuestra', 'Datos', 'Estructura', 'Reproducir', 'Limitaciones conocidas']) expect(titulos).toContain(t);
    const lim = d.secciones.find((s) => s.titulo === 'Limitaciones conocidas')!;
    const items = elementosLista(lim.md);
    expect(items.length).toBeGreaterThan(2);
    expect(items.some((i) => /solapad/i.test(i))).toBe(true); // explica el único REVISAR
  });
});

describe('docs/rendimiento.md', () => {
  it('convierte tiempos escritos en español a ms', () => {
    expect(aMs('2,33 s')).toBe(2330);
    expect(aMs('**1,14 s** (−51 %)')).toBe(1140);
    expect(aMs('1.932 ms')).toBe(1932);
    expect(aMs('**988 ms** (−49 %)')).toBe(988);
    expect(aMs('no medido')).toBeNull();
  });

  it('saca las mediciones antes/después de MariaDB y de MySQL 8', () => {
    const m = extraerMediciones(leerDoc(DOC_RENDIMIENTO));
    const busca = (q: string, motor: string) => m.find((x) => x.consulta === q && x.motor === motor);
    expect(busca('Q09', 'MariaDB 10.11')).toMatchObject({ indice: 'I1', antesMs: 2330, despuesMs: 1140 });
    expect(busca('Q10', 'MariaDB 10.11')).toMatchObject({ indice: 'I2', antesMs: 780, despuesMs: 450 });
    expect(busca('Q10', 'MySQL 8')).toMatchObject({ antesMs: 1932, despuesMs: 988 });
    expect(busca('Q09', 'MySQL 8')).toMatchObject({ antesMs: null, despuesMs: 1541 });
  });

  it('lee los dos índices de sql/05_indices.sql', () => {
    const i = indicesDelScript(readFileSync(SQL_INDICES, 'utf8'));
    expect(i.map((x) => [x.id, x.consulta, x.nombre])).toEqual([
      ['I1', 'Q09', 'idx_billete_vuelo_estado'],
      ['I2', 'Q10', 'idx_billete_pasajero_estado'],
    ]);
  });

  it('lee el tiempo total de un plan de MySQL y de MariaDB', () => {
    expect(tiempoDelPlan('-> Limit: 15 row(s)  (actual time=987.5..988.1 rows=15 loops=1)\n    -> Sort ...', false)).toBe(988.1);
    expect(tiempoDelPlan('{"query_block": {"r_total_time_ms": 12.5}}', true)).toBe(12.5);
  });
});

describe('sql/verificar_aeropuerto.sql', () => {
  const s = analizarScript(readFileSync(SQL_VERIFICAR, 'utf8'));

  it('encuentra el SELECT de cada una de las 113 comprobaciones', () => {
    expect(s.ramas.size).toBe(113);
    expect(s.ramas.get('1 estructura|tablas')).toMatch(/^SELECT '1 estructura', 'tablas'/);
    for (const sql of s.ramas.values()) expect(sql).not.toMatch(/UNION ALL\s*$/);
  });

  it('lee las 4 reglas y el UPDATE que calcula el estado', () => {
    expect(s.reglas.map((r) => r.regla)).toEqual(['cero', 'igual', 'max', 'info']);
    expect(s.sqlEstado).toMatch(/^UPDATE aeropuerto_verif\.verificacion SET estado/);
  });
});
