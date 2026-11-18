import { useEffect, useId, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson, type DetalleError } from '../api/cliente';
import type { AeropuertoOrigen, ParamUI } from '../api/tipos';
import { num } from '../lib/formato';

type Valores = Record<string, string>;

function iniciales(params: ParamUI[], actuales: Valores): Valores {
  return Object.fromEntries(params.map((p) => [p.nombre, actuales[p.nombre] ?? String(p.defecto)]));
}

/**
 * Formulario generado a partir de la definición de parámetros que da la API.
 * La validación de verdad la hace el backend (zod); aquí solo se ayuda con min/max.
 */
export function FormParametros({
  parametros,
  actuales,
  errores,
  ocupado,
  onEnviar,
  onCancelar,
}: {
  parametros: ParamUI[];
  actuales: Valores;
  errores: DetalleError[] | null;
  ocupado: boolean;
  onEnviar: (v: Valores) => void;
  onCancelar: () => void;
}) {
  const [valores, setValores] = useState<Valores>(() => iniciales(parametros, actuales));
  const idLista = useId();
  const claveActuales = JSON.stringify(actuales);
  useEffect(() => setValores(iniciales(parametros, actuales)), [claveActuales, parametros]); // eslint-disable-line react-hooks/exhaustive-deps

  const necesitaAeropuertos = parametros.some((p) => p.tipo === 'aeropuerto');
  const aeropuertos = useQuery({
    queryKey: ['aeropuertos-origen'],
    queryFn: ({ signal }) => getJson<AeropuertoOrigen[]>('/api/consultas/aux/aeropuertos-origen', signal),
    enabled: necesitaAeropuertos,
    staleTime: Infinity,
  });

  const errorDe = (n: string) => errores?.find((e) => e.campo === n)?.mensaje;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onEnviar(valores);
  };

  return (
    <form className="form-param tarjeta" onSubmit={enviar} aria-label="Parámetros de la consulta">
      {parametros.map((p) => {
        const id = `${idLista}-${p.nombre}`;
        const err = errorDe(p.nombre);
        return (
          <div className="campo" key={p.nombre}>
            <label htmlFor={id}>{p.etiqueta}</label>
            <input
              id={id}
              name={p.nombre}
              type={p.tipo === 'entero' ? 'number' : p.tipo === 'fecha' ? 'date' : 'text'}
              inputMode={p.tipo === 'entero' ? 'numeric' : undefined}
              min={p.min}
              max={p.max}
              step={p.tipo === 'entero' ? 1 : undefined}
              maxLength={p.tipo === 'aeropuerto' ? 3 : undefined}
              list={p.tipo === 'aeropuerto' ? `${idLista}-aero` : undefined}
              value={valores[p.nombre] ?? ''}
              onChange={(e) =>
                setValores((v) => ({ ...v, [p.nombre]: p.tipo === 'aeropuerto' ? e.target.value.toUpperCase() : e.target.value }))
              }
              aria-invalid={err ? true : undefined}
              aria-describedby={err || p.ayuda ? `${id}-ayuda` : undefined}
              required
            />
            {(err || p.ayuda) && (
              <span id={`${id}-ayuda`} className="ayuda" style={err ? { color: 'var(--error)' } : undefined}>
                {err ?? p.ayuda}
              </span>
            )}
          </div>
        );
      })}
      {necesitaAeropuertos && (
        <datalist id={`${idLista}-aero`}>
          {aeropuertos.data?.slice(0, 300).map((a) => (
            <option key={a.codigo_iata} value={a.codigo_iata}>
              {`${a.ciudad} — ${num(a.salidas, 0)} salidas`}
            </option>
          ))}
        </datalist>
      )}
      <div className="acciones">
        <button type="submit" className="boton primario" disabled={ocupado}>
          Ejecutar
        </button>
        <button
          type="button"
          className="boton"
          onClick={() => onEnviar(Object.fromEntries(parametros.map((p) => [p.nombre, String(p.defecto)])))}
          disabled={ocupado}
        >
          Valores del original
        </button>
        {ocupado && (
          <button type="button" className="boton" onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
