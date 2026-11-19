import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '../api/cliente';
import type { CatalogoCrud } from '../api/tipos';
import { Cargando, MensajeError } from '../components/Estado';
import { num } from '../lib/formato';
import { rutaExplorador } from './Explorador';

function Copiable({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="sql-caja">
      <div className="sql-barra">
        <span className="muted" style={{ fontSize: '.8rem' }}>
          PowerShell
        </span>
        <button
          className="boton peque"
          aria-live="polite"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(texto);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1500);
            } catch {
              /* portapapeles no disponible */
            }
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="sql" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        <code>{texto}</code>
      </pre>
    </div>
  );
}

export function Crud() {
  const q = useQuery({
    queryKey: ['crud'],
    queryFn: ({ signal }) => getJson<CatalogoCrud>('/api/crud', signal),
    staleTime: 5 * 60_000,
  });

  return (
    <article className="pagina-doc">
      <header className="cabecera-consulta">
        <h1>CRUD</h1>
        <p className="pregunta">
          Crear, editar y borrar filas de cuatro tablas desde el explorador. Cada escritura va en una transacción con el usuario <code>app_rw</code>, y los errores
          de triggers, claves foráneas, UNIQUE y CHECK se enseñan tal cual los devuelve MySQL, con una explicación.
        </p>
      </header>

      <div className="callout st-error" role="note">
        <strong>Confirmar modifica datos reales.</strong> Un COMMIT cambia las cifras que comprueban <code>sql/verificar_aeropuerto.sql</code> y la tabla de
        recuentos del README, y los AUTO_INCREMENT no vuelven atrás. El modo por defecto es <strong>simular</strong> (siempre ROLLBACK). Antes de confirmar nada,
        haz una copia:
      </div>

      {q.isPending && <Cargando />}
      {q.isError && <MensajeError error={q.error} reintentar={() => q.refetch()} />}
      {q.data && (
        <>
          <section className="seccion-doc">
            <h2>Copia de seguridad</h2>
            <p>
              En PowerShell (pide la clave de root; deja el archivo en el Escritorio). Incluye los procedimientos y triggers y la base{' '}
              <code>aeropuerto_verif</code>:
            </p>
            <Copiable texto={q.data.copia.comando} />
            <p className="muted" style={{ fontSize: '.85rem' }}>
              Para volver a ese estado: {q.data.copia.restaurar}.
            </p>
            {!q.data.rwConfigurado && (
              <p className="aviso">
                Falta <code>DB_RW_PASSWORD</code> en <code>app/backend/.env</code>: sin ella no se puede escribir.
              </p>
            )}
          </section>

          <section className="seccion-doc">
            <h2>Tablas</h2>
            <div className="rejilla-tarjetas">
              {q.data.tablas.map((t) => (
                <div key={t.nombre} className="tarjeta">
                  <h3 style={{ margin: '0 0 4px' }}>
                    <Link to={rutaExplorador(t.nombre)}>
                      <code>{t.nombre}</code>
                    </Link>
                  </h3>
                  <div className="muted" style={{ fontSize: '.82rem' }}>
                    ≈ {num(t.filasEstimadas, 0)} filas · PK <code>{t.pk}</code> (AUTO_INCREMENT)
                  </div>
                  <p style={{ fontSize: '.85rem', margin: '8px 0 4px' }}>
                    Obligatorias al crear: {t.obligatorias.map((c) => <code key={c}>{c} </code>)}
                  </p>
                  <p style={{ fontSize: '.85rem', margin: '4px 0' }}>
                    {t.triggers.length ? (
                      <>
                        Triggers:{' '}
                        {t.triggers.map((x) => (
                          <span key={x.nombre}>
                            <code>{x.nombre}</code> <span className="muted">({x.momento})</span>{' '}
                          </span>
                        ))}
                      </>
                    ) : (
                      <span className="muted">Sin triggers: solo FK, UNIQUE y CHECK.</span>
                    )}
                  </p>
                  <p style={{ fontSize: '.85rem', margin: '4px 0 0' }}>
                    {t.referenciadaPor.length ? (
                      <>
                        Borrar falla si hay filas en: {t.referenciadaPor.map((r) => <code key={`${r.tabla}.${r.columna}`}>{r.tabla} </code>)}
                      </>
                    ) : (
                      <span className="muted">Ninguna tabla apunta a esta.</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="seccion-doc">
            <h2>Cómo funciona</h2>
            <ol className="lista-reglas">
              <li>
                En el <Link to="/explorador">explorador</Link>, las cuatro tablas tienen <strong>+ Nueva fila</strong> y, en cada fila, <strong>Editar</strong> y{' '}
                <strong>Borrar</strong>.
              </li>
              <li>
                El formulario sale de <code>INFORMATION_SCHEMA</code>: tipo, NOT NULL, valor por defecto, ENUM como desplegable y las FK con buscador. Las horas son
                UTC.
              </li>
              <li>
                El servidor valida tipos y longitudes con zod, y genera <code>INSERT</code>, <code>UPDATE … WHERE pk = ?</code> o{' '}
                <code>DELETE … WHERE pk = ?</code> con columnas de la lista blanca y valores como <code>?</code>. Las FK, UNIQUE, CHECK y triggers se dejan a MySQL.
              </li>
              <li>
                Transacción: <code>START TRANSACTION</code> → <code>SELECT … FOR UPDATE</code> (al editar o borrar; si la fila cambió desde que la abriste, se para)
                → la sentencia → se relee la fila → <code>ROLLBACK</code> (simular) o <code>COMMIT</code> (confirmar).
              </li>
              <li>
                Borrar de verdad exige escribir <code>tabla:id</code>. Con <code>sql_safe_updates = 1</code>, MySQL rechazaría cualquier UPDATE o DELETE sin clave.
              </li>
            </ol>
          </section>
        </>
      )}
    </article>
  );
}
