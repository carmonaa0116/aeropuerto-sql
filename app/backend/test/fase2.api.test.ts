// Pruebas de la fase 2 contra la base real (usuario app_ro de app/backend/.env).
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { cerrarPools } from '../src/db.js';
import { CIFRAS_REFERENCIA } from '../src/services/cordura.js';

const app = crearApp();
afterAll(async () => {
  await cerrarPools();
});
const get = (ruta: string) => request(app).get(ruta);

describe('P1 · proyecto', () => {
  it('README troceado en secciones', async () => {
    const r = await get('/api/proyecto/readme');
    expect(r.status).toBe(200);
    expect(r.body.archivo).toBe('README.md');
    expect(r.body.secciones.length).toBeGreaterThan(4);
  });

  it('los contadores en vivo coinciden con las cifras del proyecto', async () => {
    const r = await get('/api/proyecto/cifras?fresco=1');
    expect(r.status).toBe(200);
    expect(r.body.tablas).toHaveLength(21);
    for (const t of r.body.tablas) expect({ tabla: t.tabla, filas: t.filas }).toEqual({ tabla: t.tabla, filas: CIFRAS_REFERENCIA[t.tabla] });
    expect(r.body.totalFilas).toBe(r.body.totalReferencia);
    expect(r.body.estructura).toEqual({ tablas: 21, claves_foraneas: 27, checks: 10 });
    expect(r.body.rango.primera_salida).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });

  it('rechaza parámetros desconocidos', async () => {
    expect((await get('/api/proyecto/cifras?tabla=pais')).status).toBe(400);
  });
});

describe('P5 · calidad', () => {
  it('lee aeropuerto_verif.verificacion con el SQL de cada comprobación', async () => {
    const r = await get('/api/calidad');
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThan(0);
    const { OK, FALLO, REVISAR, INFO } = r.body.resumen;
    expect(OK + FALLO + REVISAR + INFO).toBe(r.body.total);
    for (const f of r.body.filas) {
      expect(['OK', 'FALLO', 'REVISAR', 'INFO']).toContain(f.estado);
      expect(f.sql, `sin SQL: ${f.comprobacion}`).toMatch(/^SELECT '/);
    }
    expect(r.body.reglas).toHaveLength(4);
    expect(r.body.limitaciones.length).toBeGreaterThan(0);
  });
});

describe('P4 · rendimiento', () => {
  it('documento con mediciones', async () => {
    const r = await get('/api/rendimiento/doc');
    expect(r.status).toBe(200);
    expect(r.body.mediciones.length).toBeGreaterThanOrEqual(4);
  });

  it('los dos índices de sql/05 existen en la base', async () => {
    const r = await get('/api/rendimiento/indices');
    expect(r.status).toBe(200);
    const nombres = r.body.filas.filter((f: { del_proyecto: boolean }) => f.del_proyecto).map((f: { indice: string }) => f.indice);
    expect(nombres.sort()).toEqual(['idx_billete_pasajero_estado', 'idx_billete_vuelo_estado']);
  });

  for (const id of ['q09', 'q10']) {
    it(`EXPLAIN ANALYZE en vivo de ${id} usa su índice`, async () => {
      const r = await request(app).post(`/api/rendimiento/explain/${id}`);
      expect(r.status).toBe(200);
      expect(r.body.plan.length).toBeGreaterThan(50);
      expect(r.body.msPlan).toBeGreaterThan(0);
      expect(r.body.usaIndice).toBe(true);
    });
  }

  it('EXPLAIN solo para q09 y q10', async () => {
    expect((await request(app).post('/api/rendimiento/explain/q01')).status).toBe(404);
    expect((await request(app).post('/api/rendimiento/explain/q09;DROP')).status).toBe(404);
  });
});

describe('P6 · modelo ER', () => {
  it('21 tablas, 27 FK y 10 CHECK desde INFORMATION_SCHEMA', async () => {
    const r = await get('/api/modelo?fresco=1');
    expect(r.status).toBe(200);
    expect(r.body.resumen).toMatchObject({ tablas: 21, clavesForaneas: 27, checks: 10, checksSinTabla: 0 });
    expect(r.body.fks).toHaveLength(27);
    const vuelo = r.body.tablas.find((t: { nombre: string }) => t.nombre === 'vuelo');
    expect(vuelo.pk).toEqual(['id_vuelo']);
    expect(vuelo.fks.map((f: { tablaRef: string }) => f.tablaRef).sort()).toEqual(['aeronave', 'pista', 'puerta_embarque', 'ruta']);
    expect(vuelo.checks.map((c: { nombre: string }) => c.nombre)).toContain('chk_vuelo_horas');
    // toda FK apunta a una tabla que existe
    const nombres = new Set(r.body.tablas.map((t: { nombre: string }) => t.nombre));
    for (const fk of r.body.fks) expect(nombres.has(fk.tablaRef)).toBe(true);
  });
});
