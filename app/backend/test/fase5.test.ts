// Fase 5: CRUD de vuelo, empleado, pasajero y aeronave (usuario app_rw, en transacción).
// Los datos de prueba van marcados (#T5..., TEST-C5, año 2031) y se borran al final.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { cerrarPools, ejecutarLectura } from '../src/db.js';
import { TABLAS_CRUD, completarErrorFk, planBorrar, planInsertar, tablaCrud, traducirError, triggersDe } from '../src/services/crud.js';

type Cuerpo = Record<string, any>;
const app = crearApp();

async function contar(): Promise<Record<string, number>> {
  const sql = TABLAS_CRUD.map((t) => `SELECT '${t}' AS tabla, COUNT(*) AS n FROM \`${t}\``).join(' UNION ALL ');
  const r = await ejecutarLectura(sql, [], { timeoutMs: 60_000 });
  return Object.fromEntries(r.filas.map((f) => [String(f.tabla), Number(f.n)]));
}
const uno = async (sql: string, v: unknown[] = []): Promise<Cuerpo> => (await ejecutarLectura(sql, v, { timeoutMs: 20_000 })).filas[0];

const crear = (tabla: string, cuerpo: Cuerpo) => request(app).post(`/api/crud/${tabla}`).send(cuerpo);
const editar = (tabla: string, id: number, cuerpo: Cuerpo) => request(app).patch(`/api/crud/${tabla}/${id}`).send(cuerpo);
const borrar = (tabla: string, id: number, cuerpo: Cuerpo) => request(app).delete(`/api/crud/${tabla}/${id}`).send(cuerpo);

// Datos reales de apoyo (se leen, no se inventan)
let vueloReal: Cuerpo; // vuelo no cancelado con puerta y pista
let aeronaveReal: Cuerpo;
let empleadoReal: Cuerpo;
let pasajeroReal: Cuerpo;
let aeronaveLibre: number; // sin órdenes de mantenimiento abiertas
const sufijo = String(Date.now()).slice(-6);

beforeAll(async () => {
  vueloReal = await uno(
    `SELECT * FROM vuelo WHERE id_puerta IS NOT NULL AND id_pista IS NOT NULL AND estado <> 'cancelado' ORDER BY id_vuelo LIMIT 1`,
  );
  aeronaveReal = await uno('SELECT * FROM aeronave ORDER BY id_aeronave LIMIT 1');
  empleadoReal = await uno('SELECT * FROM empleado ORDER BY id_empleado LIMIT 1');
  pasajeroReal = await uno('SELECT * FROM pasajero ORDER BY id_pasajero LIMIT 1');
  aeronaveLibre = Number(
    (
      await uno(
        `SELECT a.id_aeronave FROM aeronave a
          WHERE NOT EXISTS (SELECT 1 FROM mantenimiento m WHERE m.id_aeronave = a.id_aeronave AND m.fecha_fin IS NULL)
          ORDER BY a.id_aeronave LIMIT 1`,
      )
    ).id_aeronave,
  );
});

afterAll(async () => {
  await cerrarPools();
});

describe('CRUD · catálogo', () => {
  it('lista las 4 tablas con sus columnas editables y los triggers de sql/01', async () => {
    const r = await request(app).get('/api/crud');
    expect(r.status).toBe(200);
    expect(r.body.tablas.map((t: Cuerpo) => t.nombre)).toEqual(['vuelo', 'empleado', 'pasajero', 'aeronave']);
    const vuelo = r.body.tablas[0];
    expect(vuelo.editables.insertar).not.toContain('id_vuelo');
    expect(vuelo.obligatorias).toEqual(expect.arrayContaining(['numero_vuelo', 'id_ruta', 'id_aeronave', 'salida_prevista', 'llegada_prevista']));
    expect(vuelo.obligatorias).not.toContain('estado'); // tiene DEFAULT
    expect(r.body.copia.comando).toContain('mysqldump');
  });

  it('los triggers de vuelo y lo que llaman salen de sql/01_triggers_vuelo.sql', () => {
    const t = triggersDe('vuelo');
    expect(t.map((x) => `${x.nombre} ${x.momento}`).sort()).toEqual(['trg_vuelo_bi BEFORE INSERT', 'trg_vuelo_bu BEFORE UPDATE']);
    expect(t[0].llama).toEqual(['sp_validar_puerta', 'sp_validar_pista', 'sp_validar_aeronave']);
    expect(triggersDe('pasajero')).toEqual([]);
  });

  it('una fila con sus dependencias (cuántas filas apuntan a ella)', async () => {
    const r = await request(app).get(`/api/crud/vuelo/${vueloReal.id_vuelo}`);
    expect(r.status).toBe(200);
    expect(r.body.fila.numero_vuelo).toBe(vueloReal.numero_vuelo);
    expect(r.body.dependencias.map((d: Cuerpo) => d.tabla)).toEqual(expect.arrayContaining(['tripulacion_vuelo', 'evento_vuelo', 'billete']));
    expect(r.body.confirmacion).toBe(`vuelo:${vueloReal.id_vuelo}`);
  });
});

describe('CRUD · validación (nada llega a MySQL)', () => {
  const pasajero = { nombre: 'Test', apellidos: 'Fase5', documento: `#T5V${sufijo}`, fecha_nacimiento: '1990-01-01', id_pais: pasajeroReal?.id_pais ?? 1 };

  it('solo las 4 tablas del CRUD', async () => {
    for (const t of ['billete', 'pais', 'tripulacion_vuelo', 'no_existe']) {
      expect((await crear(t, { modo: 'simular', valores: {} })).status).toBe(404);
    }
    expect((await crear('vuelo;DROP', { modo: 'simular', valores: {} })).status).toBe(400);
  });

  it('rechaza columnas raras, la PK AUTO_INCREMENT, claves de más y modos desconocidos', async () => {
    const casos: Cuerpo[] = [
      { modo: 'simular', valores: { ...pasajero, no_existe: 'x' } },
      { modo: 'simular', valores: { ...pasajero, id_pasajero: 5 } },
      { modo: 'simular', valores: { ...pasajero, 'nombre`=1;--': 'x' } },
      { modo: 'simular', valores: pasajero, extra: 1 },
      { modo: 'ejecutar', valores: pasajero },
      { valores: pasajero },
      { modo: 'simular', valores: { ...pasajero, nombre: { $gt: '' } } },
    ];
    for (const c of casos) expect((await crear('pasajero', c)).status, JSON.stringify(c)).toBe(400);
  });

  it('valida tipos: fecha real, ENUM, longitud, entero en rango y obligatorias', async () => {
    const malos: Cuerpo[] = [
      { fecha_nacimiento: '1990-02-30' },
      { fecha_nacimiento: '01/02/1990' },
      { nombre: 'x'.repeat(51) },
      { id_pais: '12abc' },
      { id_pais: 99999999999 },
      { nombre: '' },
    ];
    for (const m of malos) {
      const r = await crear('pasajero', { modo: 'simular', valores: { ...pasajero, ...m } });
      expect(r.status, JSON.stringify(m)).toBe(400);
      expect(r.body.detalle[0].campo).toBe(`valores.${Object.keys(m)[0]}`);
    }
    const r = await crear('aeronave', { modo: 'simular', valores: { matricula: 'TEST-X', id_modelo: 1, id_aerolinea: 1, estado: 'volando' } });
    expect(r.status).toBe(400);
    expect(r.body.detalle[0].mensaje).toContain('operativa');

    const falta = await crear('vuelo', { modo: 'simular', valores: { numero_vuelo: '#T5' } });
    expect(falta.status).toBe(400);
    expect(falta.body.detalle.map((d: Cuerpo) => d.campo)).toEqual(
      expect.arrayContaining(['valores.id_ruta', 'valores.id_aeronave', 'valores.salida_prevista', 'valores.llegada_prevista']),
    );
  });

  it('UPDATE: sin cambios, la PK o id raro -> 400; fila inexistente -> 404', async () => {
    expect((await editar('pasajero', pasajeroReal.id_pasajero, { modo: 'simular', valores: {} })).status).toBe(400);
    expect((await editar('pasajero', pasajeroReal.id_pasajero, { modo: 'simular', valores: { id_pasajero: 1 } })).status).toBe(400);
    expect((await request(app).patch('/api/crud/pasajero/1%20OR%201=1').send({ modo: 'simular', valores: { nombre: 'x' } })).status).toBe(400);
    expect((await editar('pasajero', 2_000_000_000, { modo: 'simular', valores: { nombre: 'x' } })).status).toBe(404);
  });

  it('DELETE de verdad exige escribir "tabla:id"', async () => {
    const id = pasajeroReal.id_pasajero;
    expect((await borrar('pasajero', id, { modo: 'confirmar' })).status).toBe(400);
    expect((await borrar('pasajero', id, { modo: 'confirmar', confirmacion: 'si' })).status).toBe(400);
    expect((await borrar('pasajero', id, { modo: 'confirmar', confirmacion: `vuelo:${id}` })).status).toBe(400);
    expect((await borrar('pasajero', 2_000_000_000, { modo: 'simular' })).status).toBe(404);
  });
});

describe('CRUD · simular = ROLLBACK siempre', () => {
  it('INSERT simulado: devuelve la fila como la dejó MySQL (id, DEFAULT, vacío = NULL) y no queda nada', async () => {
    const antes = await contar();
    const r = await crear('pasajero', {
      modo: 'simular',
      valores: { nombre: 'Test', apellidos: 'Fase5', documento: `#T5S${sufijo}`, fecha_nacimiento: '1990-01-01', id_pais: pasajeroReal.id_pais, email: '' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ resultado: 'ok', final: 'ROLLBACK', filasAfectadas: 1 });
    expect(r.body.id).toBeGreaterThan(0);
    expect(r.body.despues).toMatchObject({ documento: `#T5S${sufijo}`, email: null });
    expect(r.body.pasos.map((p: Cuerpo) => p.sql.split(/\s/)[0])).toEqual(['START', 'INSERT', 'SELECT', 'ROLLBACK']);
    expect(r.body.sql.texto).toContain('VALUES (?, ?, ?, ?, ?, ?)');

    const a = await crear('aeronave', {
      modo: 'simular',
      valores: { matricula: `TEST-S${sufijo.slice(-3)}`, id_modelo: aeronaveReal.id_modelo, id_aerolinea: aeronaveReal.id_aerolinea, estado: '' },
    });
    expect(a.body.resultado).toBe('ok');
    expect(a.body.despues.estado).toBe('operativa'); // vacío en una columna con DEFAULT -> el defecto
    expect(await contar()).toEqual(antes);
  });

  it('UPDATE simulado de un vuelo real: pasa el trigger, enseña los cambios y la fila sigue igual', async () => {
    const nuevo = vueloReal.estado === 'retrasado' ? 'aterrizado' : 'retrasado';
    const r = await editar('vuelo', vueloReal.id_vuelo, { modo: 'simular', valores: { estado: nuevo }, original: { estado: vueloReal.estado } });
    expect(r.body).toMatchObject({ resultado: 'ok', final: 'ROLLBACK', filasAfectadas: 1 });
    expect(r.body.cambios).toEqual([{ columna: 'estado', antes: vueloReal.estado, despues: nuevo }]);
    expect(r.body.pasos[1].sql).toMatch(/FOR UPDATE$/);
    expect((await uno('SELECT estado FROM vuelo WHERE id_vuelo = ?', [vueloReal.id_vuelo])).estado).toBe(vueloReal.estado);
  });

  it('UPDATE con datos viejos (otra persona cambió la fila) -> 409', async () => {
    const r = await editar('pasajero', pasajeroReal.id_pasajero, {
      modo: 'simular',
      valores: { nombre: 'X' },
      original: { nombre: `${pasajeroReal.nombre}-otro` },
    });
    expect(r.status).toBe(409);
    expect(r.body.detalle[0].campo).toBe('nombre');
  });
});

describe('CRUD · errores reales de MySQL, traducidos', () => {
  const vueloBase = () => ({
    numero_vuelo: `#T5E${sufijo.slice(-4)}`,
    id_ruta: vueloReal.id_ruta,
    id_aeronave: vueloReal.id_aeronave,
    id_puerta: null as number | null,
    id_pista: null as number | null,
    salida_prevista: vueloReal.salida_prevista,
    llegada_prevista: vueloReal.llegada_prevista,
  });

  it('trigger de puerta (sp_validar_puerta, 1644)', async () => {
    const r = await crear('vuelo', { modo: 'simular', valores: { ...vueloBase(), id_puerta: vueloReal.id_puerta } });
    expect(r.body.resultado).toBe('error');
    expect(r.body.error).toMatchObject({ errno: 1644, estadoSql: '45000', tipo: 'trigger' });
    expect(r.body.error.mensaje).toMatch(/^Solape de puerta con el vuelo /);
    expect(r.body.error.origen.nombre).toBe('sp_validar_puerta');
    expect(r.body.error.origen.archivo).toBe('sql/01_triggers_vuelo.sql');
    expect(r.body.error.explicacion).toContain('trg_vuelo_bi');
    expect(r.body.pasos.at(-1).sql).toBe('ROLLBACK');
  });

  it('trigger de pista (sp_validar_pista) y de aeronave (sp_validar_aeronave)', async () => {
    const p = await crear('vuelo', { modo: 'simular', valores: { ...vueloBase(), id_pista: vueloReal.id_pista } });
    expect(p.body.error.mensaje).toMatch(/^Pista ocupada: salida a menos de 2 min del vuelo /);
    expect(p.body.error.origen.nombre).toBe('sp_validar_pista');

    const a = await crear('vuelo', { modo: 'simular', valores: vueloBase() });
    expect(a.body.error.mensaje).toMatch(/^La aeronave ya esta en el vuelo .+ a esa hora$/);
    expect(a.body.error.origen.nombre).toBe('sp_validar_aeronave');
  });

  it('trigger en UPDATE (trg_vuelo_bu): mover un vuelo encima de otro de su aeronave', async () => {
    const otro = await uno(
      `SELECT v.* FROM vuelo v WHERE v.id_aeronave = ? AND v.id_vuelo <> ? AND v.estado <> 'cancelado' ORDER BY v.id_vuelo LIMIT 1`,
      [vueloReal.id_aeronave, vueloReal.id_vuelo],
    );
    if (!otro) return; // aeronave con un solo vuelo: no aplica
    const r = await editar('vuelo', otro.id_vuelo, {
      modo: 'simular',
      valores: { salida_prevista: vueloReal.salida_prevista, llegada_prevista: vueloReal.llegada_prevista, id_puerta: null, id_pista: null },
    });
    expect(r.body.error.errno).toBe(1644);
    expect(r.body.error.explicacion).toContain('trg_vuelo_bu');
  });

  it('CHECK chk_vuelo_horas (llegada antes que salida)', async () => {
    const r = await crear('vuelo', {
      modo: 'simular',
      valores: { ...vueloBase(), id_aeronave: aeronaveLibre, salida_prevista: '2031-06-01 12:00', llegada_prevista: '2031-06-01 10:00' },
    });
    expect([3819, 4025]).toContain(r.body.error.errno); // MySQL 8 / MariaDB
    expect(r.body.error).toMatchObject({ tipo: 'check', origen: { nombre: 'chk_vuelo_horas' } });
    expect(r.body.error.explicacion).toContain('llegada_prevista');
  });

  it('UNIQUE (documento repetido, 1062) y FK a un padre que no existe (1452)', async () => {
    const base = { nombre: 'Test', apellidos: 'Fase5', fecha_nacimiento: '1990-01-01', id_pais: pasajeroReal.id_pais };
    const u = await crear('pasajero', { modo: 'simular', valores: { ...base, documento: pasajeroReal.documento } });
    expect(u.body.error).toMatchObject({ errno: 1062, tipo: 'unique' });
    expect(u.body.error.explicacion).toContain('documento');

    const f = await crear('pasajero', { modo: 'simular', valores: { ...base, documento: `#T5F${sufijo}`, id_pais: 99_999_999 } });
    // MySQL 8 con permisos mínimos da la versión corta (1216); MariaDB, la larga (1452)
    expect([1452, 1216]).toContain(f.body.error.errno);
    expect(f.body.error.tipo).toBe('fk_padre');
    expect(f.body.error.explicacion).toBe('El valor de id_pais no existe en pais.id_pais. Elige uno del buscador.');
  });

  it('borrar un vuelo con tripulación: FK hija (1451), sin borrar nada', async () => {
    const antes = await contar();
    const r = await borrar('vuelo', vueloReal.id_vuelo, { modo: 'simular' });
    expect([1451, 1217]).toContain(r.body.error.errno); // larga (MariaDB) o corta (MySQL 8 con app_rw)
    expect(r.body.error.tipo).toBe('fk_hijo');
    expect(r.body.error.explicacion).toContain('ON DELETE CASCADE');
    expect(r.body.error.explicacion).toMatch(/tripulacion_vuelo|evento_vuelo/);
    expect(await contar()).toEqual(antes);
  });
});

describe('CRUD · errores de FK en versión corta (1216/1217, los que da MySQL 8 a app_rw)', () => {
  const corto = (errno: number, sqlMessage: string) => ({ errno, sqlState: '23000', sqlMessage });

  it('1217 al borrar: se averigua qué tablas apuntan a la fila', async () => {
    const t = await tablaCrud('vuelo');
    const err = traducirError(
      corto(1217, 'Cannot delete or update a parent row: a foreign key constraint fails'),
      t,
      'borrar',
    );
    expect(err.tipo).toBe('fk_hijo');
    await completarErrorFk(err, t, planBorrar(t, vueloReal.id_vuelo), vueloReal.id_vuelo);
    expect(err.explicacion).toContain('tripulacion_vuelo');
    expect(err.explicacion).toContain('ON DELETE CASCADE');
    expect(err.origen?.nombre).toContain('tripulacion_vuelo.id_vuelo → vuelo.id_vuelo');
  });

  it('1216 al crear: se averigua qué FK apunta a una fila que no existe', async () => {
    const t = await tablaCrud('pasajero');
    const plan = planInsertar(t, {
      nombre: 'Test',
      apellidos: 'Fase5',
      documento: '#T5X',
      fecha_nacimiento: '1990-01-01',
      id_pais: 99_999_999,
    });
    const err = traducirError(corto(1216, 'Cannot add or update a child row: a foreign key constraint fails'), t, 'insertar');
    expect(err.tipo).toBe('fk_padre');
    await completarErrorFk(err, t, plan, null);
    expect(err.explicacion).toBe('El valor de id_pais no existe en pais.id_pais. Elige uno del buscador.');
    expect(err.origen?.sql).toBe('FOREIGN KEY (id_pais) REFERENCES pais(id_pais)');
  });
});

describe('CRUD · confirmar = COMMIT (crear, editar y borrar en las 4 tablas)', () => {
  const creados: { tabla: string; id: number }[] = [];
  afterAll(async () => {
    // Por si un test falla a medias: se borra lo creado, en orden inverso (vuelo antes que aeronave)
    for (const c of creados.reverse()) await borrar(c.tabla, c.id, { modo: 'confirmar', confirmacion: `${c.tabla}:${c.id}` });
  });

  it('ciclo completo con COUNT(*) antes y después', async () => {
    const antes = await contar();
    const ok = (r: request.Response) => {
      expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
      expect(r.body.resultado, JSON.stringify(r.body.error)).toBe('ok');
      expect(r.body.final).toBe('COMMIT');
      return r.body;
    };

    // Crear
    const aeronave = ok(
      await crear('aeronave', {
        modo: 'confirmar',
        valores: { matricula: `TEST-C5${sufijo.slice(-2)}`, id_modelo: aeronaveReal.id_modelo, id_aerolinea: aeronaveReal.id_aerolinea },
      }),
    );
    creados.push({ tabla: 'aeronave', id: aeronave.id });
    const vuelo = ok(
      await crear('vuelo', {
        modo: 'confirmar',
        valores: {
          numero_vuelo: `#T5C${sufijo.slice(-4)}`,
          id_ruta: vueloReal.id_ruta,
          id_aeronave: aeronave.id,
          salida_prevista: '2031-06-01T10:00',
          llegada_prevista: '2031-06-01T12:00',
        },
      }),
    );
    creados.push({ tabla: 'vuelo', id: vuelo.id });
    expect(vuelo.despues).toMatchObject({ estado: 'programado', salida_prevista: '2031-06-01 10:00:00' });
    const empleado = ok(
      await crear('empleado', {
        modo: 'confirmar',
        valores: { nombre: 'Test', apellidos: 'Fase5', rol: 'tcp', licencia: `#T5${sufijo}`, id_aerolinea: empleadoReal.id_aerolinea },
      }),
    );
    creados.push({ tabla: 'empleado', id: empleado.id });
    const pasajero = ok(
      await crear('pasajero', {
        modo: 'confirmar',
        valores: { nombre: 'Test', apellidos: 'Fase5', documento: `#T5C${sufijo}`, fecha_nacimiento: '1990-01-01', id_pais: pasajeroReal.id_pais },
      }),
    );
    creados.push({ tabla: 'pasajero', id: pasajero.id });

    const despuesCrear = await contar();
    for (const t of TABLAS_CRUD) expect(despuesCrear[t]).toBe(antes[t] + 1);

    // Editar (el UPDATE de vuelo pasa por trg_vuelo_bu)
    ok(await editar('vuelo', vuelo.id, { modo: 'confirmar', valores: { estado: 'retrasado', salida_real: '2031-06-01 10:40' }, original: { estado: 'programado' } }));
    ok(await editar('aeronave', aeronave.id, { modo: 'confirmar', valores: { estado: 'mantenimiento' } }));
    ok(await editar('empleado', empleado.id, { modo: 'confirmar', valores: { rol: 'piloto' } }));
    const pe = ok(await editar('pasajero', pasajero.id, { modo: 'confirmar', valores: { email: 'test@fase5.invalid' }, original: { email: null } }));
    expect(pe.cambios).toEqual([{ columna: 'email', antes: null, despues: 'test@fase5.invalid' }]);
    expect((await uno('SELECT estado, salida_real FROM vuelo WHERE id_vuelo = ?', [vuelo.id])).estado).toBe('retrasado');

    // Borrar: el vuelo antes que su aeronave (la FK lo exige)
    const fkAntes = await borrar('aeronave', aeronave.id, { modo: 'simular' });
    expect([1451, 1217]).toContain(fkAntes.body.error.errno);
    expect(fkAntes.body.error.explicacion).toContain('vuelo');
    for (const { tabla, id } of [
      { tabla: 'vuelo', id: vuelo.id },
      { tabla: 'aeronave', id: aeronave.id },
      { tabla: 'empleado', id: empleado.id },
      { tabla: 'pasajero', id: pasajero.id },
    ]) {
      const b = ok(await borrar(tabla, id, { modo: 'confirmar', confirmacion: `${tabla}:${id}` }));
      expect(b.filasAfectadas).toBe(1);
      expect(b.antes).not.toBeNull();
      creados.splice(creados.findIndex((c) => c.tabla === tabla && c.id === id), 1);
    }
    expect(await contar()).toEqual(antes);
  });
});
