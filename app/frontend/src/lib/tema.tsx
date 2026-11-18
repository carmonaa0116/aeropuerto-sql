import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Preferencia = 'sistema' | 'claro' | 'oscuro';
export type TemaResuelto = 'light' | 'dark';

interface Ctx {
  preferencia: Preferencia;
  resuelto: TemaResuelto;
  cambiar: (p: Preferencia) => void;
}

const TemaCtx = createContext<Ctx | null>(null);
const CLAVE = 'aeropuerto.tema';

function leerPreferencia(): Preferencia {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === 'claro' || v === 'oscuro' ? v : 'sistema';
  } catch {
    return 'sistema';
  }
}

export function ProveedorTema({ children }: { children: ReactNode }) {
  const [preferencia, setPreferencia] = useState<Preferencia>(leerPreferencia);
  const [sistemaOscuro, setSistemaOscuro] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const f = (e: MediaQueryListEvent) => setSistemaOscuro(e.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);

  const resuelto: TemaResuelto = preferencia === 'sistema' ? (sistemaOscuro ? 'dark' : 'light') : preferencia === 'oscuro' ? 'dark' : 'light';

  // Se aplica durante el render (idempotente) para que los hijos que leen las
  // variables CSS (useColores) ya vean el tema nuevo en este mismo render.
  if (document.documentElement.dataset.theme !== resuelto) {
    document.documentElement.dataset.theme = resuelto;
  }

  const valor = useMemo<Ctx>(
    () => ({
      preferencia,
      resuelto,
      cambiar: (p) => {
        setPreferencia(p);
        try {
          localStorage.setItem(CLAVE, p);
        } catch {
          /* almacenamiento no disponible: el tema dura lo que la pestaña */
        }
      },
    }),
    [preferencia, resuelto],
  );

  return <TemaCtx.Provider value={valor}>{children}</TemaCtx.Provider>;
}

export function useTema(): Ctx {
  const c = useContext(TemaCtx);
  if (!c) throw new Error('useTema fuera de ProveedorTema');
  return c;
}
