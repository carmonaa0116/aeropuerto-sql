// Fase 3: demo de triggers. Parte sin base (lectura de los .sql) y parte contra la base real
// (usuario app_rw para la demo; app_ro para los COUNT(*) de control).
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { cerrarPools, ejecutarLectura } from '../src/db.js';
import { SQL_DEMO_TRIGGERS, SQL_TRIGGERS } from '../src/paths.js';
import { CASOS, analizarScriptDemo, codigoTriggers } from '../src/services/demoTriggers.js';
import { TABLAS } from '../src/services/tablas.js';
import { sqlConteo } from '../src/routes/triggers.js';

const script = analizarScriptDemo(readFileSync(SQL_DEMO_TRIGGERS, 'utf8'));
const textoTriggers = SQL_TRIGGERS.map((f) => readFileSync(f, 'utf8')).join('\n');

describe('demo de triggers · lectura de los .sql', () => {
  it('cada caso del catálogo tiene su bloque en 01_demo_triggers.sql, y al revés', () => {
    expect([...script.casos.keys()].sort()).toEqual(CASOS.map((c) => c.id).sort());
    expect(script.preparacion).toContain("INSERT INTO vuelo");
    for (const c of CASOS) expect(script.casos.get(c.id)).toMatch(/INSERT INTO/);
  });

  it('las tablas a contar salen de la lista blanca e incluyen las que escribe cada caso', () => {
    for (const [id, tablas] of script.tablasPorCaso) {
      expect(tablas.every((t) => TABLAS.includes(t))).toBe(true);
      expect(tablas).toContain('vuelo');
      if (id === 'tripulacion_descanso') expect(tablas).toContain('tripulacion_vuelo');
    }
  });

  it('los mensajes esperados son los de los SIGNAL de sql/01-03 (no inventados)', () => {
    const valoresDemo = /#D001|revision demo/;
    for (const c of CASOS.filter((x) => x.esperado.mensaje)) {
      for (const trozo of c.esperado.mensaje!.split(valoresDemo).filter(Boolean)) {
        expect(textoTriggers, `${c.id}: "${trozo}"`).toContain(trozo);
      }
    }
  });

  it('cada trigger y procedimiento citado existe en sql/01-03', () => {
    const codigo = codigoTriggers();
    for (const c of CASOS)
      for (const v of c.validadores.filter((x) => /^(trg|sp)_/.test(x))) {
        expect(codigo.get(v)?.sql, v).toMatch(new RegExp(`CREATE (PROCEDURE|TRIGGER) ${v}\\b`));
      }
  });

  it('el COUNT(*) escapa los nombres de tabla', () => {
    expect(sqlConteo(['vuelo', 'billete'])).toBe(
      "SELECT 'vuelo' AS tabla, COUNT(*) AS filas FROM `vuelo`\nUNION ALL\nSELECT 'billete' AS tabla, COUNT(*) AS filas FROM `billete`",
    );
  });
});

describe('demo de triggers · contra la base', () => {
  const app = crearApp();
  afterAll(async () => {
    await cerrarPools();
  });

  // Control independiente de la ruta: COUNT(*) de todas las tablas que toca la demo y filas marcadas
  const todas = [...new Set([...script.tablasPorCaso.values()].flat())];
  const control = async () => {
    const r = await ejecutarLectura(sqlConteo(todas), [], { timeoutMs: 60_000 });
    return Object.fromEntries(r.filas.map((f) => [f.tabla, Number(f.filas)]));
  };
  const marcadas = async () => {
    const r = await ejecutarLectura(
      `SELECT (SELECT COUNT(*) FROM pais WHERE codigo_iso = '#D')
            + (SELECT COUNT(*) FROM aeronave WHERE matricula LIKE 'TEST-D%')
            + (SELECT COUNT(*) FROM vuelo WHERE numero_vuelo LIKE '#D%')
            + (SELECT COUNT(*) FROM pasajero WHERE documento LIKE 'DEMO-%') AS n`,
      [],
      { timeoutMs: 30_000 },
    );
    return Number(r.filas[0].n);
  };

  it('el catálogo lista los 9 casos y el procedimiento está instalado para app_rw', async () => {
    const r = await request(app).get('/api/triggers');
    expect(r.status).toBe(200);
    expect(r.body.casos).toHaveLength(9);
    expect(r.body.instalacion).toEqual({ ok: true, motivo: null });
    expect(r.body.casos[0].validadores[1].sql).toMatch(/CREATE PROCEDURE sp_validar_puerta/);
  });

  it('cada caso devuelve el error real esperado (o pasa) y no deja rastro', async () => {
    const antes = await control();
    for (const c of CASOS) {
      const r = await request(app).post(`/api/triggers/${c.id}`);
      expect(r.status, c.id).toBe(200);
      expect({ caso: c.id, paso: r.body.paso, resultado: r.body.resultado, errno: r.body.errno }).toEqual({
        caso: c.id,
        paso: 'intento',
        resultado: c.esperado.resultado,
        errno: c.esperado.errno,
      });
      if (c.esperado.mensaje) expect(r.body.mensaje).toBe(c.esperado.mensaje);
      if (c.esperado.errno === 1644) expect(r.body.estadoSql).toBe('45000');
      if (c.id === 'asiento_duplicado') expect(r.body.mensaje).toMatch(/uq_billete_asiento/);
      expect(r.body.coincide, c.id).toBe(true);
      expect(r.body.rastro.intacto, c.id).toBe(true);
    }
    expect(await control()).toEqual(antes);
    expect(await marcadas()).toBe(0);
  });

  it('un caso que no está en la lista no llega a MySQL', async () => {
    for (const malo of ['nada', "valido');DROP TABLE vuelo;--", 'VALIDO']) {
      const r = await request(app).post(`/api/triggers/${encodeURIComponent(malo)}`);
      expect(r.status).toBe(404);
    }
  });
});
