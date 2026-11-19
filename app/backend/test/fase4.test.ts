// Fase 4: explorador de tablas. Funciones puras y API contra la base real (usuario app_ro).
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { cerrarPools, ejecutarLectura } from '../src/db.js';
import { TABLAS } from '../src/services/tablas.js';
import { categoriaDe, checkEnLista, escaparLike, valoresEnum } from '../src/services/explorador.js';

describe('explorador · funciones puras', () => {
  it('clasifica los tipos de columna', () => {
    expect(categoriaDe('int(11)')).toBe('entero');
    expect(categoriaDe('tinyint(1)')).toBe('entero');
    expect(categoriaDe('bigint(20)')).toBe('entero');
    expect(categoriaDe('decimal(8,2)')).toBe('decimal');
    expect(categoriaDe('float')).toBe('float');
    expect(categoriaDe('date')).toBe('fecha');
    expect(categoriaDe('datetime')).toBe('fechahora');
    expect(categoriaDe("enum('a','b')")).toBe('enum');
    expect(categoriaDe('varchar(50)')).toBe('texto');
    expect(categoriaDe('text')).toBe('texto');
  });

  it('lee los valores de un ENUM y de un CHECK "in (...)"', () => {
    expect(valoresEnum("enum('baja','media','alta','critica')")).toEqual(['baja', 'media', 'alta', 'critica']);
    expect(checkEnLista('(`activa` in (0,1))')).toEqual({ columna: 'activa', valores: ['0', '1'] });
    expect(checkEnLista('`activa` in (0,1)')).toEqual({ columna: 'activa', valores: ['0', '1'] });
    expect(checkEnLista('(`precio` >= 0)')).toBeNull();
  });

  it('escapa los comodines de LIKE', () => {
    expect(escaparLike('100%_a!b')).toBe('100!%!_a!!b');
  });
});

type Cuerpo = Record<string, unknown>;

describe('explorador · contra la base', () => {
  const app = crearApp();
  afterAll(async () => {
    await cerrarPools();
  });
  const filas = (tabla: string, cuerpo: Cuerpo = {}) => request(app).post(`/api/explorador/${tabla}/filas`).send(cuerpo);

  it('lista las 21 tablas de la lista blanca', async () => {
    const r = await request(app).get('/api/explorador');
    expect(r.status).toBe(200);
    expect(r.body.tablas.map((t: { nombre: string }) => t.nombre).sort()).toEqual([...TABLAS].sort());
  });

  it('las 21 tablas se pueden leer, ordenar y filtrar por una columna que no es la clave', async () => {
    for (const tabla of TABLAS) {
      const meta = (await request(app).get(`/api/explorador/${tabla}`)).body;
      const r0 = await filas(tabla, { contar: 'no' });
      expect(r0.status, tabla).toBe(200);
      expect(r0.body.filas.length, tabla).toBeGreaterThan(0);
      expect(r0.body.filas.length).toBeLessThanOrEqual(25);

      // Columna a probar: la primera que no es PK y se puede igualar o acotar
      const col = meta.columnas.find((c: { pk: boolean; categoria: string }) => !c.pk && c.categoria !== 'float') ?? meta.columnas[1];
      const ordenada = await filas(tabla, { orden: [{ columna: col.nombre, dir: 'desc' }], contar: 'no' });
      expect(ordenada.status, `${tabla}.${col.nombre} orden`).toBe(200);
      const v = ordenada.body.filas.find((f: Record<string, unknown>) => f[col.nombre] !== null)?.[col.nombre];
      expect(v, `${tabla}.${col.nombre} sin valores`).not.toBeUndefined();

      const op = col.operadores.includes('igual') ? 'igual' : 'entre';
      const f = op === 'igual' ? { columna: col.nombre, op, valor: String(v) } : { columna: col.nombre, op, valor: String(v), valor2: String(v) };
      const filtrada = await filas(tabla, { filtros: [f], contar: 'auto' });
      expect(filtrada.status, `${tabla}.${col.nombre} filtro`).toBe(200);
      expect(filtrada.body.filas.length).toBeGreaterThan(0);
      for (const fila of filtrada.body.filas) expect(String(fila[col.nombre])).toBe(String(v));
      expect(filtrada.body.conteo.valor).toBeGreaterThan(0);
    }
  });

  /** Recorre toda la tabla página a página por clave y devuelve las PK en el orden recorrido */
  async function recorrer(tabla: string, orden: Cuerpo[], hacia: 'adelante' | 'atras', pk: string) {
    const ids: unknown[] = [];
    let r = await filas(tabla, { orden, tamano: 200, modo: hacia === 'adelante' ? 'inicio' : 'final', contar: 'no' });
    for (let vueltas = 0; vueltas < 100; vueltas++) {
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const pagina = r.body.filas.map((f: Record<string, unknown>) => f[pk]);
      if (hacia === 'adelante') ids.push(...pagina);
      else ids.unshift(...pagina);
      const seguir = hacia === 'adelante' ? r.body.paginacion.haySiguiente : r.body.paginacion.hayAnterior;
      if (!seguir) return ids;
      const ref = hacia === 'adelante' ? r.body.filas.at(-1) : r.body.filas[0];
      const cursor = r.body.columnasCursor.map((c: string) => ref[c]);
      r = await filas(tabla, { orden, tamano: 200, modo: hacia === 'adelante' ? 'siguiente' : 'anterior', cursor, contar: 'no' });
    }
    throw new Error('demasiadas páginas');
  }

  it('la paginación por clave recorre la tabla entera sin saltos ni repeticiones, con NULL y DESC, en los dos sentidos', async () => {
    const casos: { orden: Cuerpo[]; sql: string }[] = [
      { orden: [{ columna: 'codigo_icao', dir: 'desc' }], sql: 'ORDER BY codigo_icao DESC, id_aerolinea' },
      { orden: [{ columna: 'codigo_icao', dir: 'asc' }], sql: 'ORDER BY codigo_icao ASC, id_aerolinea' },
      {
        orden: [
          { columna: 'activa', dir: 'desc' },
          { columna: 'indicativo', dir: 'asc' },
        ],
        sql: 'ORDER BY activa DESC, indicativo ASC, id_aerolinea',
      },
    ];
    for (const c of casos) {
      const esperado = (await ejecutarLectura(`SELECT id_aerolinea FROM aerolinea ${c.sql}`, [], { timeoutMs: 10_000 })).filas.map(
        (f) => f.id_aerolinea,
      );
      expect(await recorrer('aerolinea', c.orden, 'adelante', 'id_aerolinea'), c.sql).toEqual(esperado);
      expect(await recorrer('aerolinea', c.orden, 'atras', 'id_aerolinea'), `${c.sql} (hacia atrás)`).toEqual(esperado);
    }
  });

  it('ir a página N usa OFFSET y coincide con la consulta directa', async () => {
    const r = await filas('pais', { orden: [{ columna: 'nombre', dir: 'asc' }], modo: 'pagina', pagina: 3, tamano: 25, contar: 'exacto' });
    expect(r.status).toBe(200);
    expect(r.body.paginacion.tipo).toBe('offset');
    expect(r.body.sql.texto).toMatch(/LIMIT \? OFFSET \?$/);
    const directa = await ejecutarLectura('SELECT id_pais FROM pais ORDER BY nombre, id_pais LIMIT 25 OFFSET 50', [], { timeoutMs: 5_000 });
    expect(r.body.filas.map((f: { id_pais: number }) => f.id_pais)).toEqual(directa.filas.map((f) => f.id_pais));
    expect(r.body.conteo).toMatchObject({ tipo: 'exacto', valor: 240 });
  });

  it('con FLOAT en el orden pagina con OFFSET y lo avisa', async () => {
    const r = await filas('aeropuerto', { orden: [{ columna: 'latitud', dir: 'asc' }], contar: 'no' });
    expect(r.status).toBe(200);
    expect(r.body.paginacion.keysetDisponible).toBe(false);
    expect(r.body.avisos.map((a: { tipo: string }) => a.tipo)).toContain('offset');
    const sig = await filas('aeropuerto', { orden: [{ columna: 'latitud', dir: 'asc' }], modo: 'siguiente', cursor: [0, 1] });
    expect(sig.status).toBe(400);
  });

  it('tablas de más de 1 M de filas: última página, página profunda y filtros en tiempo razonable', async () => {
    const t0 = performance.now();
    const ult = await filas('tripulacion_vuelo', { modo: 'final' });
    expect(ult.status).toBe(200);
    expect(ult.body.conteo.tipo).toBe('estimado');
    expect(ult.body.paginacion).toMatchObject({ haySiguiente: false, hayAnterior: true });

    const cursor = ult.body.columnasCursor.map((c: string) => ult.body.filas[0][c]);
    const prev = await filas('tripulacion_vuelo', { modo: 'anterior', cursor, contar: 'no' });
    expect(prev.status).toBe(200);
    expect(prev.body.filas.at(-1).id_vuelo).toBeLessThanOrEqual(ult.body.filas[0].id_vuelo);

    const ev = await filas('evento_vuelo', {
      filtros: [{ columna: 'fecha_hora', op: 'entre', valor: '2026-01-20', valor2: '2026-01-20' }],
      orden: [{ columna: 'id_vuelo', dir: 'desc' }],
    });
    expect(ev.status).toBe(200);
    for (const f of ev.body.filas) expect(f.fecha_hora.slice(0, 10)).toBe('2026-01-20');
    expect(ev.body.conteo.tipo).toBe('tope');
    expect(performance.now() - t0).toBeLessThan(20_000);

    const hondo = await filas('billete', { modo: 'pagina', pagina: 5000 });
    expect(hondo.status).toBe(400);
    expect(hondo.body.detalle[0].mensaje).toMatch(/OFFSET/);
  });

  it('ordenar una tabla grande por una columna sin índice lo avisa', async () => {
    const sin = await filas('vuelo', { orden: [{ columna: 'estado', dir: 'asc' }], contar: 'no' });
    expect(sin.body.avisos.map((a: { tipo: string }) => a.tipo)).toContain('sin_indice');
    const con = await filas('vuelo', { orden: [{ columna: 'salida_prevista', dir: 'desc' }], contar: 'no' });
    expect(con.body.avisos.map((a: { tipo: string }) => a.tipo)).not.toContain('sin_indice');
  });

  it('el recuento exacto coincide con COUNT(*)', async () => {
    const r = await filas('vuelo', { filtros: [{ columna: 'estado', op: 'igual', valor: 'cancelado' }], contar: 'exacto', tamano: 25 });
    const directo = await ejecutarLectura("SELECT COUNT(*) AS n FROM vuelo WHERE estado = 'cancelado'", [], { timeoutMs: 10_000 });
    expect(r.body.conteo).toMatchObject({ tipo: 'exacto', valor: Number(directo.filas[0].n) });
  });

  describe('lista blanca: los intentos de inyección fallan', () => {
    it('tablas fuera de la lista o con caracteres raros', async () => {
      expect((await filas('vuelo;DROP TABLE vuelo')).status).toBe(400);
      expect((await filas('vuelo%60')).status).toBe(400);
      for (const t of ['user', 'verificacion', 'tables', 'innodb_metrics']) expect((await filas(t)).status, t).toBe(404);
      expect((await request(app).get('/api/explorador/..%2F..%2Fmysql')).status).toBe(400);
    });

    it('columnas inexistentes o con SQL en el nombre', async () => {
      const malas = ['password', 'id_vuelo`; DROP TABLE vuelo; --', 'id_vuelo OR 1=1', 'ID_VUELO', 'id_vuelo,(select 1)'];
      for (const columna of malas) {
        expect((await filas('vuelo', { orden: [{ columna, dir: 'asc' }] })).status, columna).toBe(400);
        expect((await filas('vuelo', { filtros: [{ columna, op: 'igual', valor: '1' }] })).status, columna).toBe(400);
      }
    });

    it('operadores, direcciones, tamaños y claves no admitidos', async () => {
      const casos: Cuerpo[] = [
        { orden: [{ columna: 'id_vuelo', dir: 'asc; DROP TABLE vuelo' }] },
        { orden: [{ columna: 'id_vuelo', dir: 'DESC' }] },
        { filtros: [{ columna: 'id_vuelo', op: 'OR 1=1', valor: '1' }] },
        { filtros: [{ columna: 'id_vuelo', op: 'contiene', valor: '1' }] }, // contiene no es para números
        { filtros: [{ columna: 'salida_prevista', op: 'igual', valor: '2026-01-01' }] }, // fechas: solo rango
        { filtros: [{ columna: 'numero_vuelo', op: 'es_nulo' }] }, // NOT NULL
        { tamano: 1000 },
        { sql: 'SELECT 1' },
        { orden: [{ columna: 'id_vuelo', dir: 'asc', sql: 'x' }] },
        { filtros: Array.from({ length: 11 }, () => ({ columna: 'id_vuelo', op: 'igual', valor: '1' })) },
        { orden: [{ columna: 'estado', dir: 'asc' }, { columna: 'estado', dir: 'desc' }] },
      ];
      for (const c of casos) expect((await filas('vuelo', c)).status, JSON.stringify(c)).toBe(400);
    });

    it('valores con tipo incorrecto se rechazan antes de llegar a MySQL', async () => {
      const casos: Cuerpo[] = [
        { filtros: [{ columna: 'id_vuelo', op: 'igual', valor: '1 OR 1=1' }] },
        { filtros: [{ columna: 'estado', op: 'igual', valor: "cancelado' OR '1'='1" }] },
        { filtros: [{ columna: 'salida_prevista', op: 'entre', valor: "2026-01-01' OR 1=1 --" }] },
        { filtros: [{ columna: 'salida_prevista', op: 'entre', valor: '2026-02-30' }] },
        { filtros: [{ columna: 'id_vuelo', op: 'entre' }] },
        { modo: 'siguiente', cursor: ['1 OR 1=1'] },
        { modo: 'siguiente', cursor: [1, 2] },
        { modo: 'siguiente' },
      ];
      for (const c of casos) expect((await filas('vuelo', c)).status, JSON.stringify(c)).toBe(400);
    });

    it('un texto con comillas viaja como parámetro: no rompe nada y no devuelve filas', async () => {
      const r = await filas('pais', { filtros: [{ columna: 'nombre', op: 'igual', valor: "x' OR '1'='1" }] });
      expect(r.status).toBe(200);
      expect(r.body.filas).toHaveLength(0);
      expect(r.body.sql.texto).toContain('`nombre` = ?');
      expect(r.body.sql.valores[0]).toBe("x' OR '1'='1");
    });

    it('los comodines % y _ se buscan como texto, no como comodín', async () => {
      const todo = await filas('pais', { filtros: [{ columna: 'nombre', op: 'contiene', valor: '%' }], contar: 'exacto' });
      const subr = await filas('pais', { filtros: [{ columna: 'nombre', op: 'contiene', valor: '_' }], contar: 'exacto' });
      const directo = await ejecutarLectura("SELECT COUNT(*) AS n FROM pais WHERE LOCATE('%', nombre) > 0", [], { timeoutMs: 5_000 });
      expect(todo.body.conteo.valor).toBe(Number(directo.filas[0].n));
      expect(todo.body.conteo.valor).toBeLessThan(240);
      expect(subr.body.conteo.valor).toBeLessThan(240);
    });

    it('el SQL generado solo nombra columnas de la tabla, entre comillas invertidas', async () => {
      const r = await filas('billete', {
        filtros: [{ columna: 'estado', op: 'igual', valor: 'cancelado' }],
        orden: [{ columna: 'precio', dir: 'desc' }],
        contar: 'no',
      });
      const meta = (await request(app).get('/api/explorador/billete')).body;
      const nombres = new Set(meta.columnas.map((c: { nombre: string }) => c.nombre));
      for (const [, n] of r.body.sql.texto.matchAll(/`([^`]+)`/g)) expect(nombres.has(n) || n === 'billete', n).toBe(true);
      expect(r.body.sql.texto).not.toMatch(/'/); // ningún valor escrito en el SQL que se ejecuta
    });

    it('el buscador de FK solo acepta claves foráneas y busca con parámetros', async () => {
      expect((await request(app).get('/api/explorador/vuelo/fk/estado')).status).toBe(400);
      expect((await request(app).get('/api/explorador/vuelo/fk/id_ruta%3B')).status).toBe(400);
      expect((await request(app).get('/api/explorador/vuelo/fk/id_aeronave?buscar=x&sql=1')).status).toBe(400);
      const r = await request(app).get(`/api/explorador/aeronave/fk/id_aerolinea?buscar=${encodeURIComponent("A' OR 1=1 -- ")}`);
      expect(r.status).toBe(200);
      expect(r.body.opciones).toHaveLength(0);
      const ok = await request(app).get('/api/explorador/aeropuerto/fk/id_pais?buscar=ES');
      expect(ok.body.opciones.length).toBeGreaterThan(0);
      expect(ok.body.etiqueta).toEqual(['codigo_iso', 'nombre']);
    });
  });

  it('EXPLAIN de la consulta generada (sin ejecutarla)', async () => {
    const r = await request(app)
      .post('/api/explorador/vuelo/plan')
      .send({ filtros: [{ columna: 'estado', op: 'igual', valor: 'cancelado' }], orden: [{ columna: 'salida_prevista', dir: 'desc' }] });
    expect(r.status).toBe(200);
    expect(r.body.sql).toMatch(/^EXPLAIN\nSELECT/);
    expect(r.body.filas.some((f: { table: string }) => f.table === 'vuelo')).toBe(true);
  });
});
