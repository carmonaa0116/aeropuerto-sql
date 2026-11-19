import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '../api/cliente';
import type { RespuestaFk } from '../api/tipos';

/**
 * Buscador del registro relacionado de una clave foránea: escribes un id o el
 * principio de un código/nombre y eliges. Guarda el id; muestra su etiqueta.
 */
export function FkBuscador({
  tabla,
  columna,
  valor,
  onCambio,
  etiquetaCampo,
}: {
  tabla: string;
  columna: string;
  valor: string;
  onCambio: (v: string) => void;
  etiquetaCampo: string;
}) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [buscar, setBuscar] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(0);

  // Espera 250 ms tras la última tecla antes de preguntar al servidor
  useEffect(() => {
    const t = setTimeout(() => setBuscar(texto.trim()), 250);
    return () => clearTimeout(t);
  }, [texto]);

  const base = `/api/explorador/${tabla}/fk/${columna}`;
  const lista = useQuery({
    queryKey: ['fk', tabla, columna, buscar],
    queryFn: ({ signal }) => getJson<RespuestaFk>(`${base}?buscar=${encodeURIComponent(buscar)}`, signal),
    enabled: abierto,
    staleTime: 60_000,
  });
  const actual = useQuery({
    queryKey: ['fk-id', tabla, columna, valor],
    queryFn: ({ signal }) => getJson<RespuestaFk>(`${base}?id=${encodeURIComponent(valor)}`, signal),
    enabled: /^\d+$/.test(valor),
    staleTime: Infinity,
  });
  const etiquetaActual = actual.data?.opciones[0]?.etiqueta;
  const opciones = lista.data?.opciones ?? [];

  const elegir = (v: string) => {
    onCambio(v);
    setTexto('');
    setAbierto(false);
  };

  const tecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAbierto(true);
      setActiva((a) => Math.min(a + 1, opciones.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiva((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && abierto && opciones[activa]) {
      e.preventDefault();
      elegir(String(opciones[activa].id));
    } else if (e.key === 'Escape') {
      setAbierto(false);
    }
  };

  return (
    <div className="fk-buscador">
      <input
        role="combobox"
        aria-label={etiquetaCampo}
        aria-expanded={abierto}
        aria-controls={`${id}-lista`}
        aria-autocomplete="list"
        aria-activedescendant={abierto && opciones[activa] ? `${id}-op-${activa}` : undefined}
        placeholder={valor ? `id ${valor}` : `id o ${actual.data?.etiqueta.join(' / ') || lista.data?.etiqueta.join(' / ') || 'id'}`}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
          setActiva(0);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={tecla}
      />
      {valor && (
        <span className="fk-elegido">
          <code>{valor}</code>
          {etiquetaActual && <span className="muted"> {etiquetaActual}</span>}
          {actual.data && !actual.data.opciones.length && <span className="muted"> (no existe en {actual.data.tabla})</span>}
        </span>
      )}
      {abierto && (
        <ul className="fk-lista" role="listbox" id={`${id}-lista`}>
          {lista.isPending && <li className="muted">Buscando…</li>}
          {lista.isError && <li className="muted">No se pudo buscar</li>}
          {lista.data && !opciones.length && <li className="muted">Sin coincidencias en {lista.data.tabla}</li>}
          {opciones.map((o, i) => (
            <li
              key={o.id}
              id={`${id}-op-${i}`}
              role="option"
              aria-selected={i === activa}
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(String(o.id));
              }}
            >
              <code>{o.id}</code> {o.etiqueta && <span>{o.etiqueta}</span>}
            </li>
          ))}
          {lista.data && opciones.length === 20 && <li className="muted">Primeros 20; escribe más para afinar</li>}
        </ul>
      )}
    </div>
  );
}
