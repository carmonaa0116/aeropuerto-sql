import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { enviarJson, ErrorApi, getJson } from '../api/cliente';
import type {
  ColumnaExpl,
  FilaCrud,
  ModoEscritura,
  ResultadoEscritura,
  TablaCrudInfo,
  TablaExpl,
} from '../api/tipos';
import { Cargando, MensajeError } from './Estado';
import { FkBuscador } from './FkBuscador';
import { Insignia } from './Insignia';
import { SqlBloque } from './SqlBloque';
import { ms, num } from '../lib/formato';

export type AccionCrud = { tipo: 'crear' } | { tipo: 'editar'; id: number } | { tipo: 'borrar'; id: number };

// ------------------------------------------------------------------
// Conversión entre lo que guarda MySQL y lo que enseña el formulario
// ------------------------------------------------------------------
function aFormulario(col: ColumnaExpl, v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (col.categoria === 'fechahora') {
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/.exec(s);
    if (m) return m[3] && m[3] !== '00' ? `${m[1]}T${m[2]}:${m[3]}` : `${m[1]}T${m[2]}`;
  }
  return s;
}

const texto = (v: unknown) => (v === null || v === undefined ? 'NULL' : String(v));

function detalleCampos(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ErrorApi && e.status === 400) for (const d of e.detalle ?? []) out[d.campo.replace(/^valores\./, '')] = d.mensaje;
  return out;
}

// ------------------------------------------------------------------
// Un campo del formulario, según el tipo de la columna (leído de INFORMATION_SCHEMA)
// ------------------------------------------------------------------
function CampoCrud({
  tabla,
  col,
  valor,
  onCambio,
  error,
  creando,
  unico,
}: {
  tabla: string;
  col: ColumnaExpl;
  valor: string;
  onCambio: (v: string) => void;
  error?: string;
  creando: boolean;
  unico: string | null;
}) {
  const id = `crud-${col.nombre}`;
  const obligatoria = !col.nulo && !(creando && col.defecto !== null);
  const ayuda = [
    col.tipo,
    col.nulo ? 'admite NULL (vacío = NULL)' : 'NOT NULL',
    col.defecto !== null ? `defecto ${col.defecto}` : null,
    unico,
    col.categoria === 'fechahora' ? 'UTC' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const comun = {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': `${id}-ayuda${error ? ` ${id}-error` : ''}`,
  } as const;

  let control;
  if (col.fk) {
    control = (
      <div className="crud-fk">
        <FkBuscador tabla={tabla} columna={col.nombre} valor={valor} onCambio={onCambio} etiquetaCampo={col.nombre} />
        {valor && col.nulo && (
          <button type="button" className="boton peque" onClick={() => onCambio('')}>
            Quitar (NULL)
          </button>
        )}
      </div>
    );
  } else if (col.opciones) {
    control = (
      <select {...comun} className="boton" value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">{creando && col.defecto !== null ? `— defecto (${col.defecto}) —` : col.nulo ? 'NULL' : '— elige —'}</option>
        {col.opciones.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  } else if (col.categoria === 'fecha') {
    control = <input {...comun} type="date" value={valor} onChange={(e) => onCambio(e.target.value)} />;
  } else if (col.categoria === 'fechahora') {
    control = (
      <input
        {...comun}
        type="datetime-local"
        step={/T\d{2}:\d{2}:\d{2}$/.test(valor) ? 1 : 60}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
      />
    );
  } else {
    const numerica = ['entero', 'decimal', 'float'].includes(col.categoria);
    control = (
      <input
        {...comun}
        type="text"
        inputMode={col.categoria === 'entero' ? 'numeric' : numerica ? 'decimal' : undefined}
        maxLength={col.longitud ?? undefined}
        value={valor}
        placeholder={creando && col.defecto !== null ? `defecto: ${col.defecto}` : col.nulo ? 'NULL' : undefined}
        onChange={(e) => onCambio(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
    );
  }

  return (
    <div className="campo crud-campo">
      {col.fk ? (
        <span className="crud-etiqueta">
          <code>{col.nombre}</code>
          {obligatoria && <span aria-hidden="true"> *</span>} <span className="muted">→ {col.fk.tabla}</span>
        </span>
      ) : (
        <label htmlFor={id} className="crud-etiqueta">
          <code>{col.nombre}</code>
          {obligatoria && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {control}
      <span id={`${id}-ayuda`} className="muted crud-ayuda">
        {ayuda}
      </span>
      {error && (
        <span id={`${id}-error`} className="crud-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Resultado de una escritura: error real de MySQL + explicación, o la fila resultante
// ------------------------------------------------------------------
function TablaFila({ fila, resaltar }: { fila: Record<string, unknown>; resaltar?: Set<string> }) {
  return (
    <div className="tabla-envoltura">
      <table className="datos crud-fila">
        <tbody>
          {Object.entries(fila).map(([k, v]) => (
            <tr key={k} className={resaltar?.has(k) ? 'resaltada' : undefined}>
              <th scope="row">
                <code>{k}</code>
              </th>
              <td className={v === null ? 'nulo' : undefined}>{texto(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultadoCrud({ r }: { r: ResultadoEscritura }) {
  const simulado = r.final === 'ROLLBACK';
  const verbo = { insertar: 'INSERT', actualizar: 'UPDATE', borrar: 'DELETE' }[r.operacion];
  const sqlTransaccion = r.pasos
    .map((p) => `${p.sql};  -- ${p.ms} ms${p.errno ? `, error ${p.errno}` : p.filas !== undefined ? `, ${p.filas} ${p.filas === 1 ? 'fila' : 'filas'}` : ''}`)
    .join('\n');

  return (
    <section className="crud-resultado" aria-live="polite" aria-label="Resultado">
      <div className="rastro">
        <Insignia estado={r.resultado === 'ok' ? 'OK' : 'FALLO'} texto={r.resultado === 'ok' ? `MySQL acepta el ${verbo}` : `MySQL rechaza el ${verbo}`} />
        <span className={`chip ${simulado ? '' : 'err'}`}>
          {simulado ? (r.modo === 'confirmar' ? 'ROLLBACK por el error: no se ha guardado nada' : 'Simulado: ROLLBACK, no se ha guardado nada') : 'COMMIT: guardado en la base'}
        </span>
        <span className="muted">{ms(r.ms)} en total</span>
      </div>

      {r.error && (
        <div className="callout st-error">
          <div>
            <strong>Error {r.error.errno}</strong>
            {r.error.estadoSql && <span className="muted"> · SQLSTATE {r.error.estadoSql}</span>}
          </div>
          <code className="crud-mensaje">{r.error.mensaje}</code>
          <p style={{ margin: '6px 0 0' }}>{r.error.explicacion}</p>
          {r.error.origen?.sql && (
            <details style={{ marginTop: 6 }}>
              <summary>
                Ver <code>{r.error.origen.nombre}</code>
                {r.error.origen.archivo && <span className="muted"> ({r.error.origen.archivo})</span>}
              </summary>
              <SqlBloque variantes={[{ id: 'origen', etiqueta: r.error.origen.nombre, sql: r.error.origen.sql }]} />
            </details>
          )}
        </div>
      )}

      {r.resultado === 'ok' && r.operacion === 'insertar' && r.despues && (
        <>
          <p className="nota">
            {simulado
              ? `Así quedaría la fila dentro de la transacción (id ${r.id}). El ROLLBACK la descarta, pero el AUTO_INCREMENT ya ha gastado ese id: el siguiente será mayor.`
              : `Fila creada con id ${r.id}.`}
          </p>
          <TablaFila fila={r.despues} />
        </>
      )}
      {r.resultado === 'ok' && r.operacion === 'actualizar' && (
        <>
          {r.cambios.length ? (
            <div className="tabla-envoltura">
              <table className="datos">
                <thead>
                  <tr>
                    <th>Columna</th>
                    <th>Antes</th>
                    <th>Después</th>
                  </tr>
                </thead>
                <tbody>
                  {r.cambios.map((c) => (
                    <tr key={c.columna}>
                      <td>
                        <code>{c.columna}</code>
                      </td>
                      <td className={c.antes === null ? 'nulo' : undefined}>{texto(c.antes)}</td>
                      <td className={c.despues === null ? 'nulo' : undefined}>{texto(c.despues)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="nota">MySQL no ha cambiado nada: los valores ya eran esos ({r.filasAfectadas} filas afectadas).</p>
          )}
        </>
      )}
      {r.resultado === 'ok' && r.operacion === 'borrar' && (
        <p className="nota">{simulado ? `El DELETE borraría ${r.filasAfectadas} fila; el ROLLBACK la deja como estaba.` : `Borrada ${r.filasAfectadas} fila.`}</p>
      )}

      <SqlBloque
        variantes={[
          {
            id: 'param',
            etiqueta: 'Sentencia (con ?)',
            sql: r.sql.texto,
            pie: (
              <>
                Parámetros:{' '}
                {r.sql.valores.map((v, i) => (
                  <code key={i}>{v === null ? 'NULL' : typeof v === 'string' ? `'${v}'` : String(v)}</code>
                ))}
              </>
            ),
          },
          { id: 'valores', etiqueta: 'Con valores', sql: r.sql.conValores },
          { id: 'transaccion', etiqueta: 'Transacción completa', sql: sqlTransaccion },
        ]}
        titulo={<>usuario app_rw</>}
      />
    </section>
  );
}

// ------------------------------------------------------------------
// Selector simular / confirmar
// ------------------------------------------------------------------
function SelectorModo({ modo, setModo, operacion }: { modo: ModoEscritura; setModo: (m: ModoEscritura) => void; operacion: string }) {
  return (
    <fieldset className="crud-modo">
      <legend>Modo</legend>
      <label>
        <input type="radio" name="modo" value="simular" checked={modo === 'simular'} onChange={() => setModo('simular')} />{' '}
        <strong>Simular</strong> <span className="muted">— ejecuta el {operacion} y hace ROLLBACK: ves el error o la fila, sin guardar</span>
      </label>
      <label>
        <input type="radio" name="modo" value="confirmar" checked={modo === 'confirmar'} onChange={() => setModo('confirmar')} />{' '}
        <strong>Confirmar</strong> <span className="muted">— COMMIT: modifica los datos reales</span>
      </label>
    </fieldset>
  );
}

// ------------------------------------------------------------------
// Diálogo: crear, editar o borrar una fila
// ------------------------------------------------------------------
export function DialogoCrud({
  tabla,
  info,
  accion: accionInicial,
  onCerrar,
  onEscrito,
}: {
  tabla: TablaExpl;
  info: TablaCrudInfo;
  accion: AccionCrud;
  onCerrar: () => void;
  onEscrito: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [accion, setAccion] = useState<AccionCrud>(accionInicial);
  const [modo, setModo] = useState<ModoEscritura>('simular');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [confirmacion, setConfirmacion] = useState('');
  const [faltan, setFaltan] = useState<Record<string, string>>({});

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const id = accion.tipo === 'crear' ? null : accion.id;
  const fila = useQuery({
    queryKey: ['crud-fila', tabla.nombre, id],
    queryFn: ({ signal }) => getJson<FilaCrud>(`/api/crud/${tabla.nombre}/${id}`, signal),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const columnas = useMemo(
    () => tabla.columnas.filter((c) => (accion.tipo === 'crear' ? info.editables.insertar : info.editables.actualizar).includes(c.nombre)),
    [tabla, info, accion.tipo],
  );
  // "UNIQUE" si la columna es única sola; "UNIQUE (a, b)" si va en un índice único compuesto
  const unicas = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of tabla.indices.filter((x) => x.unico && x.nombre !== 'PRIMARY'))
      for (const c of i.columnas) m.set(c, i.columnas.length === 1 ? 'UNIQUE' : `UNIQUE (${i.columnas.join(', ')})`);
    return m;
  }, [tabla]);

  // Valores iniciales: vacíos al crear; los de la fila (recién leída) al editar
  const iniciales = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of columnas) out[c.nombre] = accion.tipo === 'editar' && fila.data ? aFormulario(c, fila.data.fila[c.nombre]) : '';
    return out;
  }, [columnas, accion.tipo, fila.data]);
  useEffect(() => setValores(iniciales), [iniciales]);

  const cambiadas = accion.tipo === 'editar' ? columnas.filter((c) => (valores[c.nombre] ?? '') !== iniciales[c.nombre]) : [];

  const escribir = useMutation({
    mutationFn: async (): Promise<ResultadoEscritura> => {
      const base = `/api/crud/${tabla.nombre}`;
      if (accion.tipo === 'crear') {
        return enviarJson('POST', base, { modo, valores: Object.fromEntries(columnas.map((c) => [c.nombre, valores[c.nombre] ?? ''])) });
      }
      const original = Object.fromEntries(
        (accion.tipo === 'editar' ? cambiadas : columnas).map((c) => [c.nombre, (fila.data?.fila[c.nombre] ?? null) as string | number | null]),
      );
      if (accion.tipo === 'editar') {
        return enviarJson('PATCH', `${base}/${accion.id}`, {
          modo,
          valores: Object.fromEntries(cambiadas.map((c) => [c.nombre, valores[c.nombre]])),
          original,
        });
      }
      return enviarJson('DELETE', `${base}/${accion.id}`, { modo, original, ...(modo === 'confirmar' ? { confirmacion } : {}) });
    },
    onSuccess: (r) => {
      if (r.final === 'COMMIT' && r.resultado === 'ok') {
        onEscrito();
        if (r.operacion === 'actualizar') fila.refetch(); // refetch() no mira 'enabled': solo cuando hay fila
      }
    },
  });

  const r = escribir.data;
  const erroresCampo = { ...detalleCampos(escribir.error), ...faltan };
  const borrada = r?.operacion === 'borrar' && r.final === 'COMMIT' && r.resultado === 'ok';

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (accion.tipo !== 'borrar') {
      // Comprobación rápida en el navegador; la de verdad la hace el servidor (zod) y luego MySQL
      const f: Record<string, string> = {};
      for (const c of columnas) {
        const vacio = !(valores[c.nombre] ?? '').trim();
        const obligatoria = accion.tipo === 'crear' ? info.obligatorias.includes(c.nombre) : !c.nulo && cambiadas.includes(c);
        if (vacio && obligatoria) f[c.nombre] = 'Obligatorio';
      }
      setFaltan(f);
      if (Object.keys(f).length) return;
    }
    escribir.mutate();
  };

  const titulo =
    accion.tipo === 'crear' ? `Nueva fila en ${tabla.nombre}` : `${accion.tipo === 'editar' ? 'Editar' : 'Borrar'} ${tabla.nombre} #${accion.id}`;
  const operacion = accion.tipo === 'crear' ? 'INSERT' : accion.tipo === 'editar' ? 'UPDATE' : 'DELETE';
  const triggers = info.triggers.filter((t) => t.momento.endsWith(operacion));
  const dependientes = fila.data?.dependencias.filter((d) => d.filas > 0) ?? [];

  const cambiarAccion = (a: AccionCrud) => {
    escribir.reset();
    setFaltan({});
    setConfirmacion('');
    setModo('simular');
    setAccion(a);
  };

  return (
    <dialog ref={ref} className="crud-dialogo" aria-labelledby="crud-titulo" onClose={onCerrar}>
      <header className="crud-cabecera">
        <h2 id="crud-titulo">{titulo}</h2>
        <button type="button" className="boton peque" onClick={() => ref.current?.close()} aria-label="Cerrar">
          Cerrar ✕
        </button>
      </header>

      {id !== null && fila.isPending && <Cargando texto="Leyendo la fila…" />}
      {id !== null && fila.isError && <MensajeError error={fila.error} reintentar={() => fila.refetch()} />}

      {(accion.tipo === 'crear' || fila.data) && !borrada && (
        <form onSubmit={enviar} noValidate>
          {accion.tipo === 'borrar' && fila.data ? (
            <>
              <TablaFila fila={fila.data.fila} />
              {fila.data.dependencias.length > 0 && (
                <div className={dependientes.length ? 'callout' : 'nota'} style={{ marginTop: 10 }}>
                  {dependientes.length ? (
                    <>
                      <strong>Hay filas que apuntan a esta:</strong>{' '}
                      {dependientes.map((d, i) => (
                        <span key={`${d.tabla}.${d.columna}`}>
                          {i > 0 && ', '}
                          {d.masDe ? 'más de ' : ''}
                          {num(d.filas, 0)} en <code>{d.tabla}</code>
                        </span>
                      ))}
                      . Las FK no tienen ON DELETE CASCADE, así que MySQL rechazará el DELETE (error 1451). Simúlalo para verlo.
                    </>
                  ) : (
                    <>Ninguna fila de {fila.data.dependencias.map((d) => d.tabla).join(', ')} apunta a esta: MySQL debería dejar borrarla.</>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="crud-campos">
              {columnas.map((c) => (
                <CampoCrud
                  key={c.nombre}
                  tabla={tabla.nombre}
                  col={c}
                  valor={valores[c.nombre] ?? ''}
                  onCambio={(v) => {
                    setValores((x) => ({ ...x, [c.nombre]: v }));
                    setFaltan(({ [c.nombre]: _, ...resto }) => resto);
                  }}
                  error={erroresCampo[c.nombre]}
                  creando={accion.tipo === 'crear'}
                  unico={unicas.get(c.nombre) ?? null}
                />
              ))}
            </div>
          )}

          {triggers.length > 0 && (
            <p className="nota">
              Al ejecutar el {operacion}, MySQL dispara{' '}
              {triggers.map((t, i) => (
                <span key={t.nombre}>
                  {i > 0 && ', '}
                  <code>{t.nombre}</code> ({t.momento}) → {t.llama.map((x) => <code key={x}>{x} </code>)}
                </span>
              ))}
              (<Link to="/triggers">reglas</Link>). Un vuelo cancelado no se valida.
            </p>
          )}

          <SelectorModo modo={modo} setModo={setModo} operacion={operacion} />

          {accion.tipo === 'borrar' && modo === 'confirmar' && fila.data && (
            <label className="campo" style={{ marginTop: 8 }}>
              Para borrar de verdad, escribe <code>{fila.data.confirmacion}</code>
              <input
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                aria-invalid={erroresCampo.confirmacion ? true : undefined}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}

          {escribir.isError && !Object.keys(detalleCampos(escribir.error)).length && <MensajeError error={escribir.error} />}
          {escribir.isError && (escribir.error as ErrorApi).status === 409 && (
            <button type="button" className="boton peque" onClick={() => { escribir.reset(); fila.refetch(); }}>
              Volver a leer la fila
            </button>
          )}

          <div className="acciones crud-botones">
            <button
              type="submit"
              className={`boton ${modo === 'confirmar' ? 'peligro' : 'primario'}`}
              disabled={
                escribir.isPending ||
                (accion.tipo === 'editar' && !cambiadas.length) ||
                (accion.tipo === 'borrar' && modo === 'confirmar' && confirmacion !== fila.data?.confirmacion)
              }
            >
              {escribir.isPending
                ? 'Ejecutando…'
                : modo === 'simular'
                  ? `Simular ${operacion}`
                  : accion.tipo === 'borrar'
                    ? 'Borrar de verdad (COMMIT)'
                    : `Guardar de verdad (COMMIT)`}
            </button>
            {accion.tipo === 'editar' && (
              <span className="muted" style={{ fontSize: '.8rem' }}>
                {cambiadas.length ? `Cambian: ${cambiadas.map((c) => c.nombre).join(', ')}` : 'Cambia algún campo para guardar'}
              </span>
            )}
          </div>
        </form>
      )}

      {r && <ResultadoCrud r={r} />}

      {r?.final === 'COMMIT' && r.resultado === 'ok' && r.operacion === 'insertar' && r.id !== null && (
        <div className="acciones" style={{ marginTop: 10 }}>
          <button type="button" className="boton peque" onClick={() => cambiarAccion({ tipo: 'editar', id: r.id! })}>
            Editar la fila creada (#{r.id})
          </button>
          <button type="button" className="boton peque" onClick={() => cambiarAccion({ tipo: 'borrar', id: r.id! })}>
            Borrarla
          </button>
        </div>
      )}
    </dialog>
  );
}
