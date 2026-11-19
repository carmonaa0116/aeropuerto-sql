import { useState, type ReactNode } from 'react';

const KW = new Set(
  (
    'select from where join left right inner outer on and or not in exists is null as with recursive union all group by order having ' +
    'limit over partition window rows between preceding current row desc asc case when then else end distinct count sum avg min max ' +
    'round coalesce nullif cast concat date interval day minute hour like rank ntile lag row_number timestampdiff date_sub rollup char ' +
    'explain analyze true false insert into values update set delete call signal declare begin if elseif ' +
    'create procedure trigger before for each start transaction rollback commit'
  ).split(' '),
);

/** Resaltado mínimo de SQL (palabras clave, cadenas, números, comentarios y ?) sin librerías. */
function resaltar(sql: string): ReactNode[] {
  const re = /(--[^\n]*)|('(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(\?)|([A-Za-z_][A-Za-z0-9_]*)/g;
  const out: ReactNode[] = [];
  let ultimo = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(sql))) {
    if (m.index > ultimo) out.push(sql.slice(ultimo, m.index));
    const [t] = m;
    if (m[1]) out.push(<span key={k++} className="com">{t}</span>);
    else if (m[2]) out.push(<span key={k++} className="str">{t}</span>);
    else if (m[3]) out.push(<span key={k++} className="num">{t}</span>);
    else if (m[4]) out.push(<span key={k++} className="ph">{t}</span>);
    else if (KW.has(t.toLowerCase())) out.push(<span key={k++} className="kw">{t}</span>);
    else out.push(t);
    ultimo = m.index + t.length;
  }
  out.push(sql.slice(ultimo));
  return out;
}

export interface VarianteSql {
  id: string;
  etiqueta: string;
  sql: string;
  pie?: ReactNode;
}

export function SqlBloque({ variantes, titulo }: { variantes: VarianteSql[]; titulo?: ReactNode }) {
  const [activa, setActiva] = useState(variantes[0]?.id);
  const [copiado, setCopiado] = useState(false);
  const v = variantes.find((x) => x.id === activa) ?? variantes[0];

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(v.sql);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* portapapeles no disponible */
    }
  };

  return (
    <div className="sql-caja">
      <div className="sql-barra">
        <div className="grupo" role="group" aria-label="Versión del SQL">
          {variantes.map((x) => (
            <button key={x.id} className="boton peque" aria-pressed={x.id === v.id} onClick={() => setActiva(x.id)}>
              {x.etiqueta}
            </button>
          ))}
        </div>
        <div className="grupo">
          {titulo && <span className="muted" style={{ fontSize: '.8rem', alignSelf: 'center' }}>{titulo}</span>}
          <button className="boton peque" onClick={copiar} aria-live="polite">
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>
      <pre className="sql">
        <code>{resaltar(v.sql)}</code>
      </pre>
      {v.pie && <div className="valores">{v.pie}</div>}
    </div>
  );
}
