import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getJson } from '../api/cliente';
import type { DocMarkdown, RespuestaCifras } from '../api/tipos';
import { Cargando, MensajeError } from '../components/Estado';
import { Insignia } from '../components/Insignia';
import { Markdown } from '../components/Markdown';
import { SqlBloque } from '../components/SqlBloque';
import { fechaHora, horaLocal, ms, num } from '../lib/formato';

// Pasos de "Reproducir" del README, en forma de tubería (cada paso nombra el archivo que lo hace)
const PIPELINE = [
  { paso: 'Fuentes', det: 'raw_data/: OpenFlights, OurAirports, OpenSky, BTS' },
  { paso: 'Esquema', det: 'sql/creacion.sql' },
  { paso: 'CSV', det: 'limpieza.ipynb + scripts/*.py' },
  { paso: 'Carga', det: 'scripts/importacion.py' },
  { paso: 'Verificación', det: 'sql/verificar_aeropuerto.sql' },
  { paso: 'Triggers', det: 'sql/01–03 · tests en sql/99' },
];

function Coincide({ ok, titulo }: { ok: boolean; titulo: string }) {
  return (
    <span title={titulo}>
      <Insignia estado={ok ? 'COINCIDE' : 'DIFIERE'} texto={ok ? 'coincide' : 'difiere'} />
    </span>
  );
}

function Contadores({ c, recontar, recontando }: { c: RespuestaCifras; recontar: () => void; recontando: boolean }) {
  const [verSql, setVerSql] = useState(false);
  const vuelo = c.tablas.find((t) => t.tabla === 'vuelo')!;
  const e = c.estructura;
  const r = c.estructuraReferencia;
  const todasCoinciden = c.tablas.every((t) => t.coincide);

  return (
    <section aria-labelledby="t-vivo" style={{ margin: '20px 0 8px' }}>
      <h2 id="t-vivo" className="sr-only">
        Contadores en vivo
      </h2>
      <div className="tiles">
        <div className="tile heroe">
          <div className="etq">Vuelos (BTS, enero 2026)</div>
          <div className="val">{num(vuelo.filas, 0)}</div>
          <div className="det">
            <Coincide ok={vuelo.coincide} titulo={`Cifra del proyecto: ${num(vuelo.referencia, 0)}`} />
          </div>
        </div>
        <div className="tile">
          <div className="etq">Filas en total</div>
          <div className="val">{num(c.totalFilas, 0)}</div>
          <div className="det">
            <Coincide ok={c.totalFilas === c.totalReferencia} titulo={`Suma de las cifras del proyecto: ${num(c.totalReferencia, 0)}`} /> ·{' '}
            {todasCoinciden ? '21 de 21 tablas' : `${c.tablas.filter((t) => t.coincide).length} de 21 tablas`}
          </div>
        </div>
        <div className="tile">
          <div className="etq">Tablas · claves foráneas · CHECK</div>
          <div className="val">
            {e.tablas} · {e.claves_foraneas} · {e.checks}
          </div>
          <div className="det">
            <Coincide
              ok={e.tablas === r.tablas && e.claves_foraneas === r.claves_foraneas && e.checks === r.checks}
              titulo={`Esperado: ${r.tablas} tablas, ${r.claves_foraneas} FK, ${r.checks} CHECK`}
            />{' '}
            · INFORMATION_SCHEMA
          </div>
        </div>
        <div className="tile">
          <div className="etq">Salidas previstas (UTC)</div>
          <div className="val" style={{ fontSize: '1.05rem', lineHeight: 1.35, marginTop: 6 }}>
            {fechaHora(c.rango.primera_salida)}
            <br />→ {fechaHora(c.rango.ultima_salida)}
          </div>
          <div className="det">MIN y MAX de vuelo.salida_prevista</div>
        </div>
      </div>
      <div className="meta-ejec">
        <span>
          Recuento exacto con <code>COUNT(*)</code> de las 21 tablas: <strong>{ms(c.ms.recuento)}</strong>
        </span>
        <span className="muted">· medido a las {horaLocal(c.medido)}</span>
        {c.desdeCache && <span className="chip">desde caché (10 min)</span>}
        <button className="boton peque" onClick={recontar} disabled={recontando}>
          {recontando ? 'Contando…' : 'Recontar'}
        </button>
        <button className="boton peque" aria-expanded={verSql} onClick={() => setVerSql((v) => !v)}>
          {verSql ? 'Ocultar SQL' : 'Ver SQL'}
        </button>
      </div>
      {verSql && (
        <SqlBloque
          variantes={[
            { id: 'recuento', etiqueta: 'Recuento (21 tablas)', sql: c.sql.recuento },
            { id: 'estructura', etiqueta: 'Estructura', sql: c.sql.estructura },
            { id: 'rango', etiqueta: 'Rango de fechas', sql: c.sql.rango },
          ]}
          titulo="usuario app_ro"
        />
      )}
    </section>
  );
}

function FilasPorTabla({ c }: { c: RespuestaCifras }) {
  return (
    <div className="tabla-envoltura" style={{ marginTop: 12 }}>
      <table className="datos">
        <caption className="sr-only">Filas por tabla en vivo frente a las cifras del proyecto</caption>
        <thead>
          <tr>
            <th scope="col">Tabla</th>
            <th scope="col" className="n">
              Filas (en vivo)
            </th>
            <th scope="col" className="n">
              Cifra del proyecto
            </th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {c.bloques.map((b) => (
            <Fragment key={b}>
              <tr className="grupo">
                <th scope="rowgroup" colSpan={4}>
                  {b}
                </th>
              </tr>
              {c.tablas
                .filter((t) => t.bloque === b)
                .map((t) => (
                  <tr key={t.tabla}>
                    <td>
                      <code>{t.tabla}</code>
                    </td>
                    <td className="n">{num(t.filas, 0)}</td>
                    <td className="n">{num(t.referencia, 0)}</td>
                    <td>
                      <Coincide ok={t.coincide} titulo={t.coincide ? 'Igual que en el README' : 'Distinta: ¿CRUD o recarga?'} />
                    </td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pipeline() {
  return (
    <ol className="pipeline" aria-label="Pipeline del proyecto">
      {PIPELINE.map((p, i) => (
        <li key={p.paso}>
          <span className="num">{i + 1}</span>
          <strong>{p.paso}</strong>
          <code>{p.det}</code>
        </li>
      ))}
    </ol>
  );
}

export function Inicio() {
  const qc = useQueryClient();
  const readme = useQuery({
    queryKey: ['readme'],
    queryFn: ({ signal }) => getJson<DocMarkdown>('/api/proyecto/readme', signal),
    staleTime: 60_000,
  });
  const cifras = useQuery({
    queryKey: ['cifras'],
    queryFn: ({ signal }) => getJson<RespuestaCifras>('/api/proyecto/cifras', signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [recontando, setRecontando] = useState(false);

  const recontar = async () => {
    setRecontando(true);
    try {
      const d = await getJson<RespuestaCifras>('/api/proyecto/cifras?fresco=1');
      qc.setQueryData(['cifras'], d);
    } catch {
      /* el error se verá al refrescar */
      cifras.refetch();
    } finally {
      setRecontando(false);
    }
  };

  if (readme.isError) return <MensajeError error={readme.error} reintentar={() => readme.refetch()} />;
  if (readme.isPending) return <Cargando />;
  const doc = readme.data;

  return (
    <article className="pagina-doc">
      <header>
        <div className="muted" style={{ fontSize: '.8rem' }}>
          Texto de <code>{doc.archivo}</code>
        </div>
        <h1>{doc.titulo}</h1>
        <Markdown md={doc.intro} />
      </header>

      {cifras.isPending && <Cargando texto="Contando las filas de las 21 tablas…" />}
      {cifras.isError && <MensajeError error={cifras.error} reintentar={() => cifras.refetch()} />}
      {cifras.data && <Contadores c={cifras.data} recontar={recontar} recontando={recontando} />}

      <nav className="indice-doc" aria-label="Secciones del README">
        {doc.secciones.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.titulo}
          </a>
        ))}
      </nav>

      {doc.secciones.map((s) => (
        <section key={s.id} aria-labelledby={s.id} className="seccion-doc">
          <h2 id={s.id}>{s.titulo}</h2>
          {/^reproducir/i.test(s.titulo) && <Pipeline />}
          <Markdown md={s.md} />
          {/^datos$/i.test(s.titulo) && cifras.data && (
            <>
              <h3 style={{ marginTop: 18 }}>Filas por tabla (en vivo)</h3>
              <p className="texto-2" style={{ fontSize: '.88rem', margin: 0 }}>
                <code>COUNT(*)</code> de cada tabla comparado con las cifras de la carga del 17-11-2026.
              </p>
              <FilasPorTabla c={cifras.data} />
            </>
          )}
        </section>
      ))}
    </article>
  );
}
