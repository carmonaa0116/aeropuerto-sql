import type { ReactNode } from 'react';

/** Marco de una gráfica: título (nombra la medida), subtítulo y leyenda opcional. */
export function MarcoGrafica({
  titulo,
  sub,
  leyenda,
  children,
}: {
  titulo: string;
  sub?: ReactNode;
  leyenda?: ElementoLeyenda[];
  children: ReactNode;
}) {
  return (
    <figure className="grafica" style={{ margin: 0 }}>
      <figcaption>
        <h3>{titulo}</h3>
        {sub && <p className="sub">{sub}</p>}
      </figcaption>
      {leyenda && leyenda.length > 0 && <Leyenda elementos={leyenda} />}
      {children}
    </figure>
  );
}

export interface ElementoLeyenda {
  etiqueta: string;
  color: string;
  forma?: 'muestra' | 'linea';
}

export function Leyenda({ elementos }: { elementos: ElementoLeyenda[] }) {
  return (
    <ul className="leyenda" aria-label="Leyenda">
      {elementos.map((e) => (
        <li key={e.etiqueta}>
          <span className={e.forma ?? 'muestra'} style={{ background: e.color }} aria-hidden="true" />
          {e.etiqueta}
        </li>
      ))}
    </ul>
  );
}

export interface FilaTooltip {
  etiqueta: string;
  valor: ReactNode;
  color?: string;
}

/** Contenido del tooltip: título + filas etiqueta/valor (el texto nunca va en color de serie). */
export function CajaTooltip({ titulo, filas }: { titulo: ReactNode; filas: FilaTooltip[] }) {
  return (
    <div className="tt">
      <div className="tt-tit">{titulo}</div>
      {filas.map((f) => (
        <div className="tt-fila" key={f.etiqueta}>
          <span>
            {f.color && <span className="tt-marca" style={{ background: f.color }} />}
            {f.etiqueta}
          </span>
          <b>{f.valor}</b>
        </div>
      ))}
    </div>
  );
}
