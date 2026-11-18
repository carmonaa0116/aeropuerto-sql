// Pruebas de la API de consultas contra la base real (usuario app_ro de app/backend/.env).
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { cerrarPools } from '../src/db.js';
import { vaciarCache } from '../src/services/cache.js';

const app = crearApp();
afterAll(async () => {
  await cerrarPools();
});

type Fila = Record<string, unknown>;
const get = (ruta: string) => request(app).get(ruta);

describe('las 10 consultas devuelven filas con sus valores por defecto', () => {
  const ids = ['q01', 'q02', 'q03', 'q04', 'q05', 'q06', 'q07', 'q08', 'q09', 'q10'];
  for (const id of ids) {
    it(id, async () => {
      const r = await get(`/api/consultas/${id}`);
      expect(r.status).toBe(200);
      expect(r.body.filas.length).toBeGreaterThan(0);
      expect(r.body.campos.length).toBeGreaterThan(0);
      expect(typeof r.body.ms).toBe('number');
      expect(r.body.sql.original).toContain(r.body.numero);
    });
  }

  it('la segunda petición idéntica sale de la caché', async () => {
    const r = await get('/api/consultas/q01');
    expect(r.body.desdeCache).toBe(true);
  });
});

describe('los parámetros se respetan', () => {
  it('Q02: todos los aeropuertos superan el mínimo de salidas', async () => {
    const r = await get('/api/consultas/q02?minSalidas=8000');
    expect(r.status).toBe(200);
    expect(r.body.filas.length).toBeGreaterThan(0);
    for (const f of r.body.filas as Fila[]) expect(Number(f.salidas)).toBeGreaterThanOrEqual(8000);
  });

  it('Q04: devuelve un día por fecha del rango, sin huecos', async () => {
    const r = await get('/api/consultas/q04?desde=2026-01-10&hasta=2026-01-16');
    expect(r.status).toBe(200);
    expect((r.body.filas as Fila[]).map((f) => f.dia)).toEqual([
      '2026-01-10', '2026-01-11', '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16',
    ]);
  });

  it('Q05: rachas dentro del rango, por encima del umbral y con el top pedido', async () => {
    const r = await get('/api/consultas/q05?desde=2026-01-05&hasta=2026-01-20&umbral=10&top=5');
    expect(r.status).toBe(200);
    const filas = r.body.filas as Fila[];
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.length).toBeLessThanOrEqual(5);
    for (const f of filas) {
      expect(String(f.inicio) >= '2026-01-05').toBe(true);
      expect(String(f.fin) <= '2026-01-20').toBe(true);
      expect(Number(f.retraso_medio_racha)).toBeGreaterThan(10);
    }
  });

  it('Q06: otro aeropuerto y otro día', async () => {
    const r = await get('/api/consultas/q06?aeropuerto=den&dia=2026-01-20');
    expect(r.status).toBe(200);
    expect(r.body.params.aeropuerto).toBe('DEN');
    expect(r.body.filas.length).toBeGreaterThan(0);
    for (const f of r.body.filas as Fila[]) expect([1, 2]).toContain(Number(f.tramos));
  });

  it('Q07 y Q09: respetan el top N', async () => {
    for (const id of ['q07', 'q09']) {
      const r = await get(`/api/consultas/${id}?top=4`);
      expect(r.status).toBe(200);
      expect(r.body.filas.length).toBe(4);
    }
  });

  it('Q10: mínimo de vuelos y top N', async () => {
    const r = await get('/api/consultas/q10?minVuelos=4&top=7');
    expect(r.status).toBe(200);
    const filas = r.body.filas as Fila[];
    expect(filas.length).toBeLessThanOrEqual(7);
    for (const f of filas) expect(Number(f.vuelos)).toBeGreaterThanOrEqual(4);
  });
});

describe('validación y entradas maliciosas', () => {
  it('consulta inexistente -> 404', async () => {
    expect((await get('/api/consultas/q11')).status).toBe(404);
    expect((await get('/api/consultas/drop%20table')).status).toBe(404);
  });

  it('parámetro no admitido -> 400', async () => {
    const r = await get('/api/consultas/q01?orden=nombre');
    expect(r.status).toBe(400);
    expect(r.body.detalle[0].mensaje).toContain('orden');
  });

  it('fechas fuera de rango o invertidas -> 400', async () => {
    expect((await get('/api/consultas/q04?desde=2025-12-01')).status).toBe(400);
    expect((await get('/api/consultas/q04?desde=2026-01-20&hasta=2026-01-10')).status).toBe(400);
  });

  it('números no válidos -> 400', async () => {
    expect((await get('/api/consultas/q10?top=abc')).status).toBe(400);
    expect((await get('/api/consultas/q10?top=1e9')).status).toBe(400);
    expect((await get('/api/consultas/q10?top=2.5')).status).toBe(400);
  });

  it('intentos de inyección en el aeropuerto -> 400 (nunca llegan a MySQL)', async () => {
    vaciarCache();
    for (const malo of ["ATL' OR '1'='1", 'ATL;DROP', "A'B", 'ATL%27--']) {
      const r = await get(`/api/consultas/q06?aeropuerto=${encodeURIComponent(malo)}`);
      expect(r.status).toBe(400);
    }
  });

  it('ruta de API desconocida -> 404 JSON', async () => {
    const r = await get('/api/nada');
    expect(r.status).toBe(404);
    expect(r.body.error).toBeTruthy();
  });
});
