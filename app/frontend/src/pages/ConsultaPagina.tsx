import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorApi, getJson } from '../api/cliente';
import type { MetaConsulta, RespuestaConsulta } from '../api/tipos';
import { Cargando, MensajeError, Vacio } from '../components/Estado';
import { FormParametros } from '../components/FormParametros';
import { Pestanas } from '../components/Pestanas';
import { SqlBloque } from '../components/SqlBloque';
import { TablaResultados } from '../components/TablaResultados';
import { useColores } from '../lib/colores';
import { ms, num } from '../lib/formato';
import { GRAFICAS, RESALTAR } from './consultas/graficas';

function useSegundos(activo: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!activo) {
      setS(0);
      return;
    }
    const t0 = Date.now();
    const h = setInterval(() => setS(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(h);
  }, [activo]);
  return s;
}

export function ConsultaPagina() {
  const { id = '' } = useParams();
  const [busqueda, setBusqueda] = useSearchParams();
  const [pestana, setPestana] = useState('grafica');
  const qc = useQueryClient();
  const c = useColores();

  const lista = useQuery({
    queryKey: ['consultas'],
    queryFn: ({ signal }) => getJson<MetaConsulta[]>('/api/consultas', signal),
    staleTime: Infinity,
  });
  const meta = lista.data?.find((m) => m.id === id);

  // Parámetros = los de la URL (así una vista se puede guardar o compartir)
  const params = useMemo(() => Object.fromEntries([...busqueda.entries()]), [busqueda]);
  const qs = new URLSearchParams(params).toString();
  const clave = ['consulta', id, qs];

  const consulta = useQuery({
    queryKey: clave,
    queryFn: ({ signal }) => getJson<RespuestaConsulta>(`/api/consultas/${id}${qs ? `?${qs}` : ''}`, signal),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
  });
  const ocupado = consulta.isFetching;
  const segundos = useSegundos(ocupado);
  const r = consulta.data && consulta.data.id === id ? consulta.data : undefined;
  const erroresParam = consulta.error instanceof ErrorApi && consulta.error.status === 400 ? consulta.error.detalle : null;
  const cancelada = consulta.isPending && consulta.fetchStatus === 'idle';

  useEffect(() => setPestana('grafica'), [id]);

  if (lista.isError) return <MensajeError error={lista.error} reintentar={() => lista.refetch()} />;
  if (lista.isPending) return <Cargando />;
  if (!meta) return <MensajeError error={new ErrorApi(`La consulta "${id}" no existe`, 404)} />;

  const Grafica = GRAFICAS[id];

  return (
    <article>
      <header className="cabecera-consulta">
        <div className="num">{meta.numero}</div>
        <h1>{meta.titulo}</h1>
        <p className="pregunta">{meta.pregunta}</p>
        <div className="tecnicas">
          <strong>Técnicas:</strong> {meta.tecnicas}
        </div>
        {meta.nota && <p className="nota">{meta.nota}</p>}
      </header>

      {meta.parametros.length > 0 ? (
        <FormParametros
          parametros={meta.parametros}
          actuales={params}
          errores={erroresParam}
          ocupado={ocupado}
          onEnviar={(v) => setBusqueda(v)}
          onCancelar={() => qc.cancelQueries({ queryKey: clave })}
        />
      ) : (
        <p className="nota">Sin filtros: {meta.sinParametros}</p>
      )}

      <div className="meta-ejec" aria-live="polite">
        {r && (
          <>
            <span>
              Tiempo en el servidor: <strong>{ms(r.ms)}</strong>
            </span>
            {r.desdeCache && <span className="chip" title="Resultado reutilizado de la caché del backend (TTL corto)">desde caché</span>}
            <span>
              Filas: <strong>{num(r.filas.length, 0)}</strong>
            </span>
            <span className="chip utc">Horas en UTC</span>
          </>
        )}
        {ocupado && meta.parametros.length === 0 && (
          <button className="boton peque" onClick={() => qc.cancelQueries({ queryKey: clave })}>
            Cancelar
          </button>
        )}
      </div>
      {ocupado && r && <div className="cargando-barra" style={{ marginBottom: 10 }} aria-hidden="true" />}

      {consulta.isError && !erroresParam ? (
        <MensajeError error={consulta.error} reintentar={() => consulta.refetch()} />
      ) : erroresParam ? (
        <div className="estado error" role="alert">
          Revisa los parámetros marcados en el formulario: la API no ha ejecutado la consulta.
        </div>
      ) : cancelada ? (
        <div className="estado">
          Consulta cancelada.{' '}
          <button className="boton peque" onClick={() => consulta.refetch()}>
            Volver a ejecutar
          </button>
        </div>
      ) : !r ? (
        <Cargando texto={`Ejecutando ${meta.numero} en MySQL…`} segundos={segundos} />
      ) : (
        <Pestanas
          pestanas={[
            { id: 'grafica', etiqueta: id === 'q03' ? 'Resumen' : 'Gráfica' },
            { id: 'tabla', etiqueta: 'Tabla' },
            { id: 'sql', etiqueta: 'Ver SQL' },
          ]}
          activa={pestana}
          onCambio={setPestana}
        >
          {pestana === 'grafica' && (r.filas.length ? <Grafica r={r} c={c} /> : <Vacio />)}
          {pestana === 'tabla' && (r.filas.length ? <TablaResultados campos={r.campos} filas={r.filas} resaltar={RESALTAR[id]} /> : <Vacio />)}
          {pestana === 'sql' && (
            <SqlBloque
              titulo={r.sql.archivo}
              variantes={[
                {
                  id: 'valores',
                  etiqueta: 'Ejecutada (con valores)',
                  sql: r.sql.conValores,
                  pie: 'Así queda la consulta con los valores escapados por mysql2. Lo que viaja a MySQL es la versión con ? y los valores aparte.',
                },
                {
                  id: 'param',
                  etiqueta: 'Parametrizada (?)',
                  sql: r.sql.ejecutado,
                  pie: r.valores.length ? (
                    <>
                      Valores, en orden:{' '}
                      {r.valores.map((v, i) => (
                        <code key={i}>{typeof v === 'string' ? `'${v}'` : String(v)}</code>
                      ))}
                    </>
                  ) : (
                    'Sin parámetros.'
                  ),
                },
                ...(r.sql.original
                  ? [{ id: 'original', etiqueta: 'Original (sql/04)', sql: r.sql.original, pie: 'Bloque tal cual en sql/04_consultas_avanzadas.sql.' }]
                  : []),
              ]}
            />
          )}
        </Pestanas>
      )}
    </article>
  );
}
