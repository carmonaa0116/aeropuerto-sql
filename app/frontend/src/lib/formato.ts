const opciones = (dec: number): Intl.NumberFormatOptions =>
  ({ minimumFractionDigits: 0, maximumFractionDigits: dec, useGrouping: 'always' }) as unknown as Intl.NumberFormatOptions;

const cache = new Map<number, Intl.NumberFormat>();
function nf(dec: number) {
  let f = cache.get(dec);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', opciones(dec));
    cache.set(dec, f);
  }
  return f;
}

/** 1234567.891 -> "1.234.567,89" */
export function num(v: unknown, dec = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? nf(dec).format(n) : String(v);
}

export const pct = (v: unknown, dec = 1) => (v === null || v === undefined ? '—' : `${num(v, dec)} %`);
export const euros = (v: unknown) => (v === null || v === undefined ? '—' : `${num(v, 2)} €`);

export function ms(v: number): string {
  return v >= 1000 ? `${num(v / 1000, 2)} s` : `${num(v, 0)} ms`;
}

/** 205 -> "3 h 25 min" */
export function duracion(min: unknown): string {
  const m = Number(min);
  if (!Number.isFinite(m)) return '—';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? `${h} h ${r} min` : `${r} min`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "2026-01-15" -> "15 ene" */
export function diaCorto(iso: unknown): string {
  const s = String(iso ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]}` : s;
}

export function esNumero(v: unknown): boolean {
  return typeof v === 'number';
}

/** "2025-12-31 21:40:00" -> "31 dic 2025, 21:40" (sin conversión: el valor ya está en UTC) */
export function fechaHora(v: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v ?? ''));
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}` : String(v ?? '—');
}

/** Hora local del navegador (para "medido a las ...", que no es un dato de la BD). */
export function horaLocal(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
