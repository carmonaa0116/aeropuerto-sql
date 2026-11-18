import type { Campo, Fila } from '../api/tipos';
import { num } from '../lib/formato';

/** Tabla con los resultados tal cual los devuelve MySQL (cabeceras = alias del SQL). */
export function TablaResultados({
  campos,
  filas,
  resaltar,
}: {
  campos: Campo[];
  filas: Fila[];
  resaltar?: (f: Fila) => boolean;
}) {
  const numericas = new Set(campos.filter((c) => filas.some((f) => typeof f[c.nombre] === 'number')).map((c) => c.nombre));
  return (
    <div className="tabla-envoltura">
      <table className="datos">
        <thead>
          <tr>
            {campos.map((c) => (
              <th key={c.nombre} scope="col" className={numericas.has(c.nombre) ? 'n' : undefined}>
                {c.nombre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className={resaltar?.(f) ? 'resaltada' : undefined}>
              {campos.map((c) => {
                const v = f[c.nombre];
                if (v === null || v === undefined) return <td key={c.nombre} className="nulo">NULL</td>;
                const esNum = typeof v === 'number';
                // Ids y años sin separador de miles
                const sinMiles = /^id_/.test(c.nombre);
                return (
                  <td key={c.nombre} className={esNum ? 'n' : undefined}>
                    {esNum && !sinMiles ? num(v, 2) : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
