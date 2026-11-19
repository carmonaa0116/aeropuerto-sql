import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { getJson, postJson } from '../api/cliente';
import type { DocRendimiento, Medicion, RespuestaExplain, RespuestaIndices } from '../api/tipos';
import { Cargando, MensajeError } from '../components/Estado';
import { CajaTooltip, MarcoGrafica } from '../components/Grafica';
import { Insignia } from '../components/Insignia';
import { Markdown } from '../components/Markdown';
import { SqlBloque } from '../components/SqlBloque';
import { useColores } from '../lib/colores';
import { ms } from '../lib/formato';

function GraficaAntesDespues({ mediciones }: { mediciones: Medicion[] }) {
  const c = useColores();
  const antes = c.neutro;
  const despues = c.serie[0];
  const datos = mediciones.map((m) => ({ ...m, etiqueta: `${m.consulta} · ${m.indice} · ${m.motor}` }));

  const Tip = ({ active, payload }: TooltipProps<ValueType, NameType>) => {
    if (!active || !payload?.length) return null;
    const m = payload[0].payload as Medicion & { etiqueta: string };
    const mejora = m.antesMs && m.despuesMs ? Math.round((1 - m.despuesMs / m.antesMs) * 100) : null;
    return (
      <CajaTooltip
        titulo={m.etiqueta}
        filas={[
          { etiqueta: 'Antes', valor: m.antesMs === null ? m.antesTexto : ms(m.antesMs), color: antes },
          { etiqueta: 'Después', valor: m.despuesMs === null ? m.despuesTexto : ms(m.despuesMs), color: despues },
          ...(mejora !== null ? [{ etiqueta: 'Mejora', valor: `−${mejora} %` }] : []),
        ]}
      />
    );
  };

  return (
    <MarcoGrafica
      titulo="Tiempo de la consulta antes y después del índice"
      sub="Cifras de docs/rendimiento.md. Compara antes frente a después dentro de cada motor, no entre motores."
      leyenda={[
        { etiqueta: 'Antes (sin el índice)', color: antes },
        { etiqueta: 'Después (con el índice)', color: despues },
      ]}
    >
      <ResponsiveContainer width="100%" height={datos.length * 62 + 50}>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barGap={2} barCategoryGap={14}>
          <CartesianGrid horizontal={false} stroke={c.rejilla} />
          <XAxis type="number" stroke={c.eje} tick={{ fill: c.tenue }} tickFormatter={(v: number) => ms(v)} />
          <YAxis type="category" dataKey="etiqueta" width={170} stroke={c.eje} tick={{ fill: c.texto, fontSize: 12 }} />
          <Tooltip content={<Tip />} cursor={{ fill: c.rejilla, opacity: 0.4 }} />
          <Bar dataKey="antesMs" name="Antes" fill={antes} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          <Bar dataKey="despuesMs" name="Después" fill={despues} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </MarcoGrafica>
  );
}

/** Plan con el nombre del índice resaltado. */
function Plan({ texto, marcar }: { texto: string; marcar?: string }) {
  const partes: ReactNode[] = marcar
    ? texto.split(marcar).flatMap((p, i, a) => (i < a.length - 1 ? [p, <mark key={i}>{marcar}</mark>] : [p]))
    : [texto];
  return (
    <pre className="sql plan" tabIndex={0} aria-label="Plan de ejecución">
      <code>{partes}</code>
    </pre>
  );
}

function ExplainEnVivo({ doc }: { doc: DocRendimiento }) {
  const [res, setRes] = useState<RespuestaExplain | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const control = useRef<AbortController | null>(null);

  const lanzar = async (id: string) => {
    control.current?.abort();
    const ac = new AbortController();
    control.current = ac;
    setEnCurso(id);
    setError(null);
    try {
      setRes(await postJson<RespuestaExplain>(`/api/rendimiento/explain/${id}`, ac.signal));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e);
    } finally {
      if (control.current === ac) setEnCurso(null);
    }
  };
  const cancelar = () => {
    control.current?.abort();
    setEnCurso(null);
  };

  const documentado = res && doc.mediciones.find((m) => m.consulta === res.numero && m.motor === 'MySQL 8');

  return (
    <section className="tarjeta" aria-labelledby="t-explain" style={{ marginTop: 16 }}>
      <h2 id="t-explain">EXPLAIN ANALYZE en vivo</h2>
      <p className="texto-2" style={{ fontSize: '.88rem', marginTop: 0 }}>
        Ejecuta la consulta con los índices que hay ahora y devuelve el plan con tiempos reales. Solo lectura (usuario <code>app_ro</code>): la app
        nunca crea ni borra índices.
      </p>
      <div className="acciones">
        {doc.indicesProyecto.map((i) => (
          <button key={i.consulta} className="boton primario" disabled={!!enCurso} onClick={() => lanzar(i.consulta.toLowerCase())}>
            {enCurso === i.consulta.toLowerCase() ? `Ejecutando ${i.consulta}…` : `Analizar ${i.consulta}`}
          </button>
        ))}
        {enCurso && (
          <button className="boton" onClick={cancelar}>
            Cancelar
          </button>
        )}
      </div>
      {enCurso && <Cargando texto="EXPLAIN ANALYZE ejecuta la consulta entera…" />}
      {!!error && <MensajeError error={error} />}
      {res && !enCurso && (
        <div style={{ marginTop: 12 }}>
          <div className="meta-ejec">
            <strong>{res.numero}</strong>
            <span>
              Tiempo del plan: <strong>{res.msPlan === null ? '—' : ms(res.msPlan)}</strong>
            </span>
            <span>
              Con la ida y vuelta: <strong>{ms(res.msTotal)}</strong>
            </span>
            {documentado?.despuesMs != null && (
              <span className="muted">
                · documentado en MySQL 8: {ms(documentado.despuesMs)}
              </span>
            )}
            <span className="chip">
              {res.servidor} {res.version.split('-')[0]}
            </span>
            {res.indiceEsperado && (
              <Insignia
                estado={res.usaIndice ? 'OK' : 'REVISAR'}
                texto={res.usaIndice ? `usa ${res.indiceEsperado.nombre}` : `no aparece ${res.indiceEsperado.nombre}`}
              />
            )}
          </div>
          {res.formato === 'json' && (
            <p className="aviso">Servidor MariaDB (entorno de pruebas): el plan sale en JSON con ANALYZE FORMAT=JSON. En MySQL 8 sale el árbol de EXPLAIN ANALYZE.</p>
          )}
          <Plan texto={res.plan} marcar={res.indiceEsperado?.nombre} />
          <div style={{ marginTop: 10 }}>
            <SqlBloque
              variantes={[
                { id: 'valores', etiqueta: 'Ejecutada (con valores)', sql: res.sql.conValores },
                { id: 'param', etiqueta: 'Parametrizada (?)', sql: res.sql.ejecutado },
              ]}
              titulo={res.sql.archivo}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function IndicesActuales({ marcados }: { marcados: number }) {
  const q = useQuery({
    queryKey: ['indices'],
    queryFn: ({ signal }) => getJson<RespuestaIndices>('/api/rendimiento/indices', signal),
  });
  const [verSql, setVerSql] = useState(false);
  if (q.isPending) return <Cargando />;
  if (q.isError) return <MensajeError error={q.error} reintentar={() => q.refetch()} />;
  return (
    <section style={{ marginTop: 24 }} aria-labelledby="t-indices">
      <h2 id="t-indices">Índices actuales de billete y vuelo</h2>
      <p className="texto-2" style={{ fontSize: '.88rem', marginTop: 0 }}>
        Leídos de <code>information_schema.STATISTICS</code> en {ms(q.data.ms)}. Marcados los {marcados} que añade <code>sql/05_indices.sql</code>.{' '}
        <button className="boton peque" aria-expanded={verSql} onClick={() => setVerSql((v) => !v)}>
          {verSql ? 'Ocultar SQL' : 'Ver SQL'}
        </button>
      </p>
      {verSql && <SqlBloque variantes={[{ id: 's', etiqueta: 'INFORMATION_SCHEMA', sql: q.data.sql }]} />}
      <div className="tabla-envoltura" style={{ marginTop: 8 }}>
        <table className="datos">
          <thead>
            <tr>
              <th scope="col">tabla</th>
              <th scope="col">indice</th>
              <th scope="col">columnas</th>
              <th scope="col">tipo</th>
              <th scope="col">origen</th>
            </tr>
          </thead>
          <tbody>
            {q.data.filas.map((f) => (
              <tr key={`${f.tabla}.${f.indice}`} className={f.del_proyecto ? 'resaltada' : undefined}>
                <td>
                  <code>{f.tabla}</code>
                </td>
                <td>
                  <code>{f.indice}</code>
                </td>
                <td>{f.columnas}</td>
                <td>{f.indice === 'PRIMARY' ? 'PK' : f.no_unico ? 'normal' : 'UNIQUE'}</td>
                <td>{f.del_proyecto ? <Insignia estado="OK" texto="sql/05" /> : <span className="muted">DDL / FK</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Rendimiento() {
  const q = useQuery({
    queryKey: ['doc-rendimiento'],
    queryFn: ({ signal }) => getJson<DocRendimiento>('/api/rendimiento/doc', signal),
    staleTime: 60_000,
  });
  if (q.isPending) return <Cargando />;
  if (q.isError) return <MensajeError error={q.error} reintentar={() => q.refetch()} />;
  const doc = q.data;

  return (
    <article className="pagina-doc">
      <header>
        <div className="muted" style={{ fontSize: '.8rem' }}>
          Texto de <code>{doc.archivo}</code>
        </div>
        <h1>{doc.titulo}</h1>
        <Markdown md={doc.intro} base="docs/" />
      </header>

      {doc.mediciones.length > 0 && <GraficaAntesDespues mediciones={doc.mediciones} />}
      <ExplainEnVivo doc={doc} />
      <IndicesActuales marcados={doc.indicesProyecto.length} />

      <nav className="indice-doc" aria-label="Secciones del documento" style={{ marginTop: 24 }}>
        {doc.secciones.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.titulo}
          </a>
        ))}
      </nav>
      {doc.secciones.map((s) => (
        <section key={s.id} aria-labelledby={s.id} className="seccion-doc">
          <h2 id={s.id}>{s.titulo}</h2>
          <Markdown md={s.md} base="docs/" />
        </section>
      ))}
    </article>
  );
}
