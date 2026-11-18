import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface Pestana {
  id: string;
  etiqueta: string;
}

/** Pestañas accesibles (role=tablist, flechas izquierda/derecha). */
export function Pestanas({
  pestanas,
  activa,
  onCambio,
  children,
}: {
  pestanas: Pestana[];
  activa: string;
  onCambio: (id: string) => void;
  children: ReactNode;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const tecla = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + pestanas.length) % pestanas.length;
    onCambio(pestanas[j].id);
    refs.current[j]?.focus();
  };

  return (
    <div>
      <div className="pestanas" role="tablist">
        {pestanas.map((p, i) => (
          <button
            key={p.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${base}-t-${p.id}`}
            aria-selected={p.id === activa}
            aria-controls={`${base}-p`}
            tabIndex={p.id === activa ? 0 : -1}
            onClick={() => onCambio(p.id)}
            onKeyDown={(e) => tecla(e, i)}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-p`} aria-labelledby={`${base}-t-${activa}`}>
        {children}
      </div>
    </div>
  );
}
