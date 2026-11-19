import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorApi, getJson, postJson } from '../api/cliente';
import type { CasoDemo, RespuestaDemo, ResultadoDemo } from '../api/tipos';
import { Cargando, MensajeError } from '../components/Estado';
import { Insignia } from '../components/Insignia';
import { SqlBloque, type VarianteSql } from '../components/SqlBloque';
import { ms, num } from '../lib/formato';

type Estado = { cargando: true } | { cargando: false; datos?: ResultadoDemo; error?: unknown };

const BLOQUES = ['Vuelo', 'Ventas', 'Tripulación', 'Contraste'];
const DESC_BLOQUE: Record<string, string> = {
  Vuelo: 'trg_vuelo_bi / trg_vuelo_bu · sql/01_triggers_vuelo.sql',
  Ventas: 'trg_billete_bi / trg_billete_bu · sql/02_triggers_ventas.sql',
  Tripulación: 'trg_tripulacion_bi / trg_tripulacion_bu · sql/03_triggers_tripulacion.sql',
  Contraste: 'lo que no es un trigger y lo que sí pasa',
};

function textoEsperado(e: CasoDemo['esperado']): string {
  if (e.resultado === 'ok') return 'Esperado: pasa';
  return `Esperado: error ${e.errno}`;
}

/** Línea de error al estilo del cliente de MySQL: ERROR 1644 (45000): mensaje */
function SalidaMysql({ r }: { r: ResultadoDemo }) {
  if (r.resultado === 'ok') return <pre className="salida-mysql ok">Query OK · {r.mensaje}</pre>;
  return (
    <pre className="salida-mysql">
      ERROR {r.errno} ({r.estadoSql}): {r.mensaje}
    </pre>
  );
}

function Rastro({ r }: { r: ResultadoDemo }) {
  const [abierto, setAbierto] = useState(false);
  const cambian = r.rastro.tablas.filter((t) => t.antes !== t.despues);
  return (
    <div className="rastro">
      <Insignia
        estado={r.rastro.intacto ? 'OK' : 'FALLO'}
        texto={r.rastro.intacto ? 'Sin rastro' : `Quedan cambios en ${cambian.length} tablas`}
      />
      <span className="muted">
        COUNT(*) antes y después en {r.rastro.tablas.length} tablas ({ms(r.rastro.msConteo)})
      </span>
      <button className="boton peque" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        {abierto ? 'Ocultar' : 'Ver recuentos'}
      </button>
      {abierto && (
        <div className="tabla-envoltura" style={{ marginTop: 4, flexBasis: "100%" }}>
          <table className="datos">
            <thead>
              <tr>
                <th>Tabla</th>
                <th className="n">Antes</th>
                <th className="n">Después</th>
                <th className="n">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {r.rastro.tablas.map((t) => (
                <tr key={t.tabla} className={t.antes !== t.despues ? 'resaltada' : undefined}>
                  <td>
                    <code>{t.tabla}</code>
                  </td>
                  <td className="n">{num(t.antes, 0)}</td>
                  <td className="n">{num(t.despues, 0)}</td>
                  <td className="n">{num(t.despues - t.antes, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TarjetaCaso({
  caso,
  preparacion,
  archivo,
  estado,
  probar,
  bloqueado,
}: {
  caso: CasoDemo;
  preparacion: string;
  archivo: string;
  estado?: Estado;
  probar: () => void;
  bloqueado: boolean;
}) {
  const r = estado && !estado.cargando ? estado.datos : undefined;
  const err = estado && !estado.cargando ? estado.error : undefined;

  const variantes: VarianteSql[] = [
    { id: 'intento', etiqueta: 'Sentencia que se intenta', sql: caso.sqlIntento },
    ...caso.validadores
      .filter((v) => v.sql)
      .map((v) => ({ id: v.nombre, etiqueta: v.nombre, sql: v.sql, pie: <>Archivo: <code>{v.archivo}</code></> })),
    {
      id: 'preparacion',
      etiqueta: 'Datos de prueba',
      sql: preparacion,
      pie: <>Común a todos los casos. Se crea dentro de la transacción y se deshace con ROLLBACK.</>,
    },
    { id: 'llamada', etiqueta: 'Llamada y COUNT(*)', sql: `${caso.llamada}\n\n-- Antes y después (usuario app_ro):\n${r?.sql.conteo ?? '-- se muestra al probar el caso'}` },
  ];

  return (
    <section className="tarjeta caso-demo" aria-labelledby={`caso-${caso.id}`}>
      <div className="caso-cabecera">
        <h3 id={`caso-${caso.id}`}>{caso.titulo}</h3>
        <span className="chip">{textoEsperado(caso.esperado)}</span>
      </div>
      <p className="regla">{caso.regla}</p>
      <p className="muted escenario">{caso.escenario}</p>
      <div className="validadores">
        {caso.validadores.map((v) => (
          <code key={v.nombre}>{v.nombre}</code>
        ))}
      </div>

      <div className="caso-accion">
        <button className="boton primario" onClick={probar} disabled={bloqueado}>
          {estado?.cargando ? 'Probando…' : r ? 'Probar otra vez' : 'Probar'}
        </button>
        {r && (
          <>
            <Insignia estado={r.coincide ? 'OK' : 'FALLO'} texto={r.coincide ? 'Comportamiento esperado' : 'No es lo esperado'} />
            <span className="muted">
              {ms(r.ms)} · ROLLBACK hecho
            </span>
          </>
        )}
      </div>

      {r && (
        <div className="caso-resultado" aria-live="polite">
          <SalidaMysql r={r} />
          {!r.coincide && (
            <p className="callout st-error">
              {r.paso !== 'intento'
                ? `La demo falló en el paso "${r.paso}", antes de llegar a la sentencia del caso.`
                : `Se esperaba ${r.esperado.resultado === 'ok' ? 'que pasara' : `el error ${r.esperado.errno}${r.esperado.mensaje ? `: ${r.esperado.mensaje}` : ''}`}.`}
            </p>
          )}
          <Rastro r={r} />
        </div>
      )}
      {err !== undefined && <MensajeError error={err} />}

      <SqlBloque variantes={variantes} titulo={archivo} />
    </section>
  );
}

export function Triggers() {
  const q = useQuery({
    queryKey: ['triggers'],
    queryFn: ({ signal }) => getJson<RespuestaDemo>('/api/triggers', signal),
    retry: false,
  });
  const [estados, setEstados] = useState<Record<string, Estado>>({});
  const [ocupado, setOcupado] = useState(false);

  const ejecutar = async (id: string) => {
    setEstados((s) => ({ ...s, [id]: { cargando: true } }));
    try {
      const datos = await postJson<ResultadoDemo>(`/api/triggers/${id}`);
      setEstados((s) => ({ ...s, [id]: { cargando: false, datos } }));
    } catch (error) {
      setEstados((s) => ({ ...s, [id]: { cargando: false, error } }));
      if (error instanceof ErrorApi && (error.status === 403 || error.status === 404 || error.status === 503)) throw error;
    }
  };

  const probarUno = async (id: string) => {
    setOcupado(true);
    try {
      await ejecutar(id);
    } catch {
      /* el error ya se muestra en la tarjeta */
    } finally {
      setOcupado(false);
    }
  };

  const probarTodos = async () => {
    if (!q.data) return;
    setOcupado(true);
    try {
      // Uno detrás de otro: el backend también los pone en cola
      for (const c of q.data.casos) await ejecutar(c.id);
    } catch {
      /* falta el procedimiento o app_rw: se ve en la tarjeta, no tiene sentido seguir */
    } finally {
      setOcupado(false);
    }
  };

  if (q.isPending) return <Cargando />;
  if (q.isError) return <MensajeError error={q.error} reintentar={() => q.refetch()} />;
  const d = q.data;

  const hechos = d.casos.map((c) => estados[c.id]).filter((e): e is Estado & { cargando: false; datos: ResultadoDemo } => !!e && !e.cargando && !!e.datos);
  const esperados = hechos.filter((e) => e.datos.coincide).length;
  const diferencia = hechos.reduce(
    (s, e) => s + e.datos.rastro.tablas.reduce((a, t) => a + Math.abs(t.despues - t.antes), 0),
    0,
  );

  return (
    <article>
      <header className="cabecera-consulta">
        <h1>Triggers en vivo</h1>
        <p className="pregunta">
          Cada caso intenta, contra tu base, una sentencia que un trigger debe rechazar y muestra el error real que devuelve MySQL. Todo ocurre
          dentro de <code>sp_demo_trigger</code>: abre una transacción, crea sus propios datos de prueba, lanza la sentencia y hace{' '}
          <strong>ROLLBACK siempre</strong>.
        </p>
        <div className="tecnicas">
          Usuario <code>app_rw</code>, que solo tiene EXECUTE sobre el procedimiento · datos marcados (códigos con <code>#</code>, matrículas{' '}
          <code>TEST-D*</code>, año 2030, horas en UTC) · procedimiento en <code>{d.archivo}</code>
        </div>
      </header>

      {!d.instalacion.ok && (
        <p className="callout st-error" role="alert">
          {d.instalacion.motivo}
        </p>
      )}

      <div className="tiles" style={{ margin: '16px 0' }}>
        <div className="tile">
          <div className="etq">Casos probados</div>
          <div className="val">
            {hechos.length} <span className="muted" style={{ fontSize: '1rem' }}>de {d.casos.length}</span>
          </div>
          <div className="det">7 reglas de trigger, el UNIQUE y un caso válido</div>
        </div>
        <div className="tile">
          <div className="etq">Comportamiento esperado</div>
          <div className="val">{hechos.length ? `${esperados} de ${hechos.length}` : '—'}</div>
          <div className="det">error y mensaje exactos, o pasa si es el válido</div>
        </div>
        <div className="tile">
          <div className="etq">Filas que quedan tras las pruebas</div>
          <div className="val">{hechos.length ? num(diferencia, 0) : '—'}</div>
          <div className="det">suma de diferencias de COUNT(*) antes y después</div>
        </div>
        <div className="tile" style={{ display: 'grid', alignContent: 'center', gap: 8 }}>
          <button className="boton primario" onClick={probarTodos} disabled={ocupado || !d.instalacion.ok}>
            {ocupado ? 'Probando…' : 'Probar todos'}
          </button>
          <div className="det">Se ejecutan uno detrás de otro</div>
        </div>
      </div>

      <p className="callout">
        Un INSERT deshecho no deja filas, pero InnoDB no devuelve los valores de AUTO_INCREMENT que gastó: tras cada prueba los próximos id
        saltan unos números. Los COUNT(*) no cambian.
      </p>

      {BLOQUES.map((b) => {
        const casos = d.casos.filter((c) => c.bloque === b);
        if (!casos.length) return null;
        return (
          <section key={b} className="seccion-doc">
            <h2>
              {b} <span className="muted" style={{ fontSize: '.8rem', fontWeight: 400 }}>· {DESC_BLOQUE[b]}</span>
            </h2>
            <div className="lista-casos">
              {casos.map((c) => (
                <TarjetaCaso
                  key={c.id}
                  caso={c}
                  preparacion={d.preparacion}
                  archivo={d.archivo}
                  estado={estados[c.id]}
                  probar={() => probarUno(c.id)}
                  bloqueado={ocupado || !d.instalacion.ok}
                />
              ))}
            </div>
          </section>
        );
      })}
    </article>
  );
}
