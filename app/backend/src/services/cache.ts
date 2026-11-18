/**
 * Caché en memoria con TTL para las consultas. Además agrupa peticiones
 * idénticas simultáneas: si dos pestañas piden Q06 a la vez, MySQL la ejecuta
 * una sola vez. La ejecución compartida solo se cancela (KILL QUERY) cuando
 * TODOS los clientes que la esperaban han abandonado.
 */
interface Entrada<T> {
  caduca: number;
  valor: T;
}

interface EnVuelo<T> {
  promesa: Promise<T>;
  esperando: number;
  control: AbortController;
}

const MAX_ENTRADAS = 200;
const almacen = new Map<string, Entrada<unknown>>();
const enVuelo = new Map<string, EnVuelo<unknown>>();

export async function conCache<T>(
  clave: string,
  ttlMs: number,
  producir: (signal: AbortSignal) => Promise<T>,
  signalCliente?: AbortSignal,
): Promise<{ valor: T; desdeCache: boolean }> {
  const e = almacen.get(clave);
  if (e && e.caduca > Date.now()) return { valor: e.valor as T, desdeCache: true };

  let vuelo = enVuelo.get(clave) as EnVuelo<T> | undefined;
  if (vuelo?.control.signal.aborted) vuelo = undefined; // abandonada por todos: no reutilizar
  if (!vuelo) {
    const control = new AbortController();
    const nuevo: EnVuelo<T> = { promesa: undefined as unknown as Promise<T>, esperando: 0, control };
    nuevo.promesa = producir(control.signal)
      .then((valor) => {
        if (almacen.size >= MAX_ENTRADAS) {
          const primera = almacen.keys().next().value;
          if (primera !== undefined) almacen.delete(primera);
        }
        almacen.set(clave, { caduca: Date.now() + ttlMs, valor });
        return valor;
      })
      .finally(() => {
        if (enVuelo.get(clave) === (nuevo as EnVuelo<unknown>)) enVuelo.delete(clave);
      });
    enVuelo.set(clave, nuevo as EnVuelo<unknown>);
    vuelo = nuevo;
  }

  const v = vuelo;
  v.esperando += 1;
  const alAbandonar = () => {
    v.esperando -= 1;
    if (v.esperando <= 0) {
      v.control.abort();
      if (enVuelo.get(clave) === (v as EnVuelo<unknown>)) enVuelo.delete(clave);
    }
  };
  signalCliente?.addEventListener('abort', alAbandonar, { once: true });
  try {
    const valor = await v.promesa;
    // Compartir una ejecución en curso no es "caché": el tiempo es el real de esa ejecución
    return { valor, desdeCache: false };
  } finally {
    signalCliente?.removeEventListener('abort', alAbandonar);
  }
}

export function vaciarCache(): void {
  almacen.clear();
}
