import { Fragment, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { getJson } from '../api/cliente';
import type { EstadoVerif, FilaVerif, RespuestaCalidad } from '../api/tipos';
import { Cargando, MensajeError, Vacio } from '../components/Estado';
import { CajaTooltip, MarcoGrafica } from '../components/Grafica';
import { Insignia } from '../components/Insignia';
import { Markdown } from '../components/Markdown';
import { SqlBloque } from '../components/SqlBloque';
import { useColores } from '../lib/colores';
import { fechaHora, num } from '../lib/formato';

const ESTADOS: EstadoVerif[] = ['FALLO', 'REVISAR', 'OK', 'INFO'];
const ETIQUETA_REGLA: Record<string, string> = { cero: 'debe dar 0', igual: '= esperado', max: '≤ esperado', info: 'informativo' };

function GraficaSecciones({ d }: { d: RespuestaCalidad }) {
  const c = useColores();
  const color: Record<EstadoVerif, string> = { OK: c.estado.ok, REVISAR: c.estado.warn, FALLO: c.estado.error, INFO: c.neutro };
  // Solo los estados que aparecen (orden fijo); el color va con el estado, nunca con la posición
  const presentes = ESTADOS.filter((e) => d.resumen[e] > 0);
  const datos = d.secciones.map((s) => {
    const fila: Record<string, string | number> = { seccion: s };
    for (const e of presentes) fila[e] = d.filas.filter((f) => f.seccion === s && f.estado === e).length;
    return fila;
  });

  const Tip = ({ active, payload, label }: TooltipProps<ValueType, NameType>) =>
    active && payload?.length ? (
      <CajaTooltip
        titulo={label}
        filas={payload
          .filter((p) => Number(p.value) > 0)
          .map((p) => ({ etiqueta: String(p.dataKey), valor: num(p.value, 0), color: color[p.dataKey as EstadoVerif] }))}
      />
    ) : null;

  return (
    <MarcoGrafica
      titulo="Comprobaciones por sección y estado"
      sub="Número de comprobaciones de cada sección del script"
      leyenda={presentes.map((e) => ({ etiqueta: e, color: color[e] }))}
    >
      <ResponsiveContainer width="100%" height={Math.max(220, datos.length * 30 + 40)}>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={c.rejilla} />
          <XAxis type="number" allowDecimals={false} stroke={c.eje} tick={{ fill: c.tenue }} />
          <YAxis type="category" dataKey="seccion" width={120} stroke={c.eje} tick={{ fill: c.texto, fontSize: 12 }} />
          <Tooltip content={<Tip />} cursor={{ fill: c.rejilla, opacity: 0.4 }} />
          {presentes.map((e) => (
            <Bar key={e} dataKey={e} stackId="s" fill={color[e]} stroke={c.superficie} strokeWidth={2} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </MarcoGrafica>
  );
}

function FilaComprobacion({ f }: { f: FilaVerif }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <tr className={f.estado === 'REVISAR' || f.estado === 'FALLO' ? 'resaltada' : undefined}>
        <td>{f.estado ? <Insignia estado={f.estado} /> : <span className="muted">—</span>}</td>
        <td style={{ whiteSpace: 'normal', minWidth: 280 }}>{f.comprobacion}</td>
        <td title={ETIQUETA_REGLA[f.regla]}>
          <code>{f.regla}</code>
        </td>
        <td className="n">{f.esperado === null ? <span className="muted">—</span> : num(f.esperado, 2)}</td>
        <td className="n">{f.valor === null ? <span className="muted">NULL</span> : num(f.valor, 2)}</td>
        <td>
          {f.sql && (
            <button className="boton peque" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
              {abierta ? 'Ocultar' : 'SQL'}
            </button>
          )}
        </td>
      </tr>
      {abierta && f.sql && (
        <tr className="detalle">
          <td colSpan={6}>
            <SqlBloque variantes={[{ id: 's', etiqueta: 'Rama del INSERT … SELECT', sql: f.sql }]} titulo="sql/verificar_aeropuerto.sql" />
          </td>
        </tr>
      )}
    </>
  );
}

export function Calidad() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['calidad'],
    queryFn: ({ signal }) => getJson<RespuestaCalidad>('/api/calidad', signal),
    retry: false,
  });
  const [estado, setEstado] = useState<EstadoVerif | ''>('');
  const [seccion, setSeccion] = useState('');
  const [texto, setTexto] = useState('');
  const [releyendo, setReleyendo] = useState(false);

  const d = q.data;
  const filtradas = useMemo(() => {
    if (!d) return [];
    const t = texto.trim().toLowerCase();
    return d.filas.filter(
      (f) => (!estado || f.estado === estado) && (!seccion || f.seccion === seccion) && (!t || f.comprobacion.toLowerCase().includes(t)),
    );
  }, [d, estado, seccion, texto]);

  const releer = async () => {
    setReleyendo(true);
    try {
      qc.setQueryData(['calidad'], await getJson<RespuestaCalidad>('/api/calidad?fresco=1'));
    } catch {
      q.refetch();
    } finally {
      setReleyendo(false);
    }
  };

  if (q.isPending) return <Cargando />;
  if (q.isError) return <MensajeError error={q.error} reintentar={() => q.refetch()} />;
  if (!d) return null;

  const revisar = d.filas.filter((f) => f.estado === 'REVISAR' || f.estado === 'FALLO');
  const limSolape = d.limitaciones.find((l) => /solapad/i.test(l));

  return (
    <article>
      <header className="cabecera-consulta">
        <h1>Calidad de datos</h1>
        <p className="pregunta">
          {d.total} comprobaciones de <code>{d.sql.archivo}</code>, leídas de <code>aeropuerto_verif.verificacion</code>. La app solo lee los
          resultados: el script tarda minutos y se ejecuta en Workbench.
        </p>
        <div className="tecnicas">
          Última ejecución del script: <strong>{d.creada ? fechaHora(d.creada) : '—'}</strong> (hora del servidor MySQL, fecha de creación de la
          tabla)
        </div>
      </header>

      <div className="tiles" role="group" aria-label="Filtrar por estado">
        {ESTADOS.map((e) => (
          <button
            key={e}
            className="tile tile-boton"
            aria-pressed={estado === e}
            onClick={() => setEstado((x) => (x === e ? '' : e))}
            title={estado === e ? 'Quitar el filtro' : `Ver solo ${e}`}
          >
            <div className="etq">
              <Insignia estado={e} />
            </div>
            <div className="val">{d.resumen[e]}</div>
          </button>
        ))}
      </div>

      {revisar.map((f) => (
        <div key={f.id} className={`callout ${f.estado === 'FALLO' ? 'st-error' : 'st-warn'}`} style={{ marginTop: 14 }}>
          <Insignia estado={f.estado!} />{' '}
          <strong>{f.comprobacion}</strong>: {num(f.valor, 0)} (máximo esperado {num(f.esperado, 0)}).
          {f.estado === 'REVISAR' && limSolape && /solap/i.test(f.comprobacion) && (
            <div style={{ marginTop: 6 }}>
              Explicación del README: <Markdown md={limSolape} />
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: 16 }}>
        <GraficaSecciones d={d} />
      </div>

      <h2 style={{ marginTop: 24 }}>Detalle</h2>
      <div className="filtros" role="search">
        <label className="campo">
          Estado
          <select className="boton" value={estado} onChange={(e) => setEstado(e.target.value as EstadoVerif | '')}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          Sección
          <select className="boton" value={seccion} onChange={(e) => setSeccion(e.target.value)}>
            <option value="">Todas</option>
            {d.secciones.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          Buscar
          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="p. ej. puerta" />
        </label>
        <span className="muted" style={{ fontSize: '.85rem', alignSelf: 'center' }}>
          {filtradas.length} de {d.total}
        </span>
        <button className="boton peque" style={{ alignSelf: 'center' }} onClick={releer} disabled={releyendo}>
          {releyendo ? 'Leyendo…' : 'Volver a leer'}
        </button>
      </div>

      {filtradas.length === 0 ? (
        <Vacio texto="Ninguna comprobación cumple los filtros." />
      ) : (
        <div className="tabla-envoltura">
          <table className="datos">
            <thead>
              <tr>
                <th scope="col">estado</th>
                <th scope="col">comprobacion</th>
                <th scope="col">regla</th>
                <th scope="col" className="n">
                  esperado
                </th>
                <th scope="col" className="n">
                  valor
                </th>
                <th scope="col">
                  <span className="sr-only">SQL</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.secciones
                .filter((s) => filtradas.some((f) => f.seccion === s))
                .map((s) => (
                  <Fragment key={s}>
                    <tr className="grupo">
                      <th scope="rowgroup" colSpan={6}>
                        {s}
                      </th>
                    </tr>
                    {filtradas
                      .filter((f) => f.seccion === s)
                      .map((f) => (
                        <FilaComprobacion key={f.id} f={f} />
                      ))}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="dos-columnas" style={{ marginTop: 24 }}>
        <section>
          <h2>Reglas</h2>
          <p className="texto-2" style={{ fontSize: '.88rem' }}>
            Cabecera de <code>{d.sql.archivo}</code>:
          </p>
          <ul className="lista-reglas">
            {d.reglas.map((r) => (
              <li key={r.regla}>
                <code>{r.regla}</code> {r.explicacion}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Limitaciones conocidas</h2>
          <p className="texto-2" style={{ fontSize: '.88rem' }}>
            De <code>{d.archivoLimitaciones}</code>:
          </p>
          <ul className="lista-reglas">
            {d.limitaciones.map((l) => (
              <li key={l}>
                <Markdown md={l} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <h2 style={{ marginTop: 24 }}>Ver SQL</h2>
      <SqlBloque
        variantes={[
          { id: 'lectura', etiqueta: 'Lectura (app)', sql: d.sql.lectura },
          { id: 'ejecucion', etiqueta: 'Última ejecución', sql: d.sql.ejecucion },
          ...(d.sql.estado ? [{ id: 'estado', etiqueta: 'Cálculo del estado (script)', sql: d.sql.estado }] : []),
        ]}
        titulo={`usuario app_ro${d.desdeCache ? ' · desde caché' : ''}`}
      />
    </article>
  );
}
