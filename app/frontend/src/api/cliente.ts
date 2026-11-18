export interface DetalleError {
  campo: string;
  mensaje: string;
}

export class ErrorApi extends Error {
  constructor(
    mensaje: string,
    public status: number,
    public detalle: DetalleError[] | null = null,
    public codigo: string | number | null = null,
  ) {
    super(mensaje);
  }
}

/** GET JSON a la API. El AbortSignal (de TanStack Query) permite cancelar la petición. */
export async function getJson<T>(ruta: string, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(ruta, { signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ErrorApi('No se puede contactar con la API. ¿Está arrancado el backend (npm run dev)?', 0);
  }
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) {
    const detalle = Array.isArray(cuerpo?.detalle) ? (cuerpo.detalle as DetalleError[]) : null;
    throw new ErrorApi(cuerpo?.error ?? `Error HTTP ${r.status}`, r.status, detalle, cuerpo?.codigo ?? null);
  }
  return cuerpo as T;
}
