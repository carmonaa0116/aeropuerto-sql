import type { EstadoVerif } from '../api/tipos';

const ICONO: Record<EstadoVerif | 'COINCIDE' | 'DIFIERE', string> = {
  OK: '✓',
  COINCIDE: '✓',
  FALLO: '✕',
  DIFIERE: '✕',
  REVISAR: '!',
  INFO: 'i',
};

const CLASE: Record<EstadoVerif | 'COINCIDE' | 'DIFIERE', string> = {
  OK: 'st-ok',
  COINCIDE: 'st-ok',
  FALLO: 'st-error',
  DIFIERE: 'st-error',
  REVISAR: 'st-warn',
  INFO: 'st-info',
};

/** Estado con icono + texto (el color nunca va solo). */
export function Insignia({ estado, texto }: { estado: EstadoVerif | 'COINCIDE' | 'DIFIERE'; texto?: string }) {
  return (
    <span className={`insignia ${CLASE[estado]}`}>
      <span className="ico" aria-hidden="true">
        {ICONO[estado]}
      </span>
      {texto ?? estado}
    </span>
  );
}
