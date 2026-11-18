import { ErrorApi } from '../api/cliente';

export function Cargando({ texto = 'Cargando…', segundos }: { texto?: string; segundos?: number }) {
  return (
    <div className="estado" role="status" aria-live="polite">
      <div className="cargando-barra" style={{ marginBottom: 12 }} />
      {texto}
      {segundos !== undefined && segundos >= 1 && <span className="muted"> · {segundos} s</span>}
    </div>
  );
}

export function MensajeError({ error, reintentar }: { error: unknown; reintentar?: () => void }) {
  const e = error as ErrorApi;
  return (
    <div className="estado error" role="alert">
      <strong>{e?.message ?? 'Error desconocido'}</strong>
      {e?.codigo ? <span> (código {String(e.codigo)})</span> : null}
      {e?.detalle?.length ? (
        <ul>
          {e.detalle.map((d, i) => (
            <li key={i}>
              <code>{d.campo}</code>: {d.mensaje}
            </li>
          ))}
        </ul>
      ) : null}
      {reintentar && (
        <div style={{ marginTop: 10 }}>
          <button className="boton peque" onClick={reintentar}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

export function Vacio({ texto = 'La consulta no devuelve filas con estos parámetros.' }: { texto?: string }) {
  return <div className="estado">{texto}</div>;
}
