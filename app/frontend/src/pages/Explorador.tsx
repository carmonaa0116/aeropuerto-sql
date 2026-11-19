import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { getJson, postJson } from '../api/cliente';
import type {
  CatalogoCrud,
  ColumnaExpl,
  ConteoExpl,
  FiltroExpl,
  ListaExpl,
  ModoExpl,
  OperadorFiltro,
  OrdenExpl,
  RespuestaFilas,
  RespuestaPlan,
  TablaCrudInfo,
  TablaExpl,
  ValorCursor,
} from '../api/tipos';
import { DialogoCrud, type AccionCrud } from '../components/DialogoCrud';
import { Cargando, MensajeError } from '../components/Estado';
import { FkBuscador } from '../components/FkBuscador';
import { SqlBloque } from '../components/SqlBloque';
import { TablaResultados } from '../components/TablaResultados';
import { ms, num } from '../lib/formato';

const TAMANOS = [25, 50, 100, 200];
const MAX_ORDEN = 4;

const NOMBRE_OP: Record<OperadorFiltro, string> = {
  igual: '=',
  contiene: 'contiene',
  empieza: 'empieza por',
  entre: 'entre',
  es_nulo: 'es NULL',
  no_es_nulo: 'no es NULL',
};

// ------------------------------------------------------------------
// Estado en la URL (filtros, orden y tamaño): los enlaces se pueden compartir
// ------------------------------------------------------------------

function leerOrden(t: string | null): OrdenExpl[] {
  return (t ?? '')
    .split(',')
    .map((p) => /^([a-z0-9_]+):(asc|desc)$/.exec(p))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ columna: m[1], dir: m[2] as 'asc' | 'desc' }));
}

function leerFiltros(t: string | null): FiltroExpl[] {
  try {
    const v = JSON.parse(t ?? '[]');
    if (!Array.isArray(v)) return [];
    return v
      .filter((f) => f && typeof f.columna === 'string' && typeof f.op === 'string')
      .map((f) => ({
        columna: f.columna,
        op: f.op,
        ...(typeof f.valor === 'string' ? { valor: f.valor } : {}),
        ...(typeof f.valor2 === 'string' ? { valor2: f.valor2 } : {}),
      }));
  } catch {
    return [];
  }
}

export function rutaExplorador(tabla: string, filtros: FiltroExpl[] = [], orden: OrdenExpl[] = []): string {
  const sp = new URLSearchParams();
  if (filtros.length) sp.set('f', JSON.stringify(filtros));
  if (orden.length) sp.set('orden', orden.map((o) => `${o.columna}:${o.dir}`).join(','));
  const q = sp.toString();
  return `/explorador/${tabla}${q ? `?${q}` : ''}`;
}

// ------------------------------------------------------------------
// Navegación entre páginas
// ------------------------------------------------------------------

interface Posicion {
  desde: 'inicio' | 'final';
  n: number; // página 1, 2, 3… contando desde ese extremo
}

interface Nav {
  clave: string;
  modo: ModoExpl;
  cursor?: ValorCursor[];
  pagina?: number;
  pos: Posicion;
}

const INICIO = (clave: string): Nav => ({ clave, modo: 'inicio', pos: { desde: 'inicio', n: 1 } });

function textoConteo(c: ConteoExpl | undefined): string {
  if (!c) return '';
  if (c.error) return c.error;
  if (c.masDe !== null) return `más de ${num(c.masDe, 0)} filas`;
  if (c.tipo === 'estimado') return `≈ ${num(c.valor, 0)} filas (estimación de InnoDB)`;
  return `${num(c.valor, 0)} ${c.valor === 1 ? 'fila' : 'filas'}`;
}

/** Total de filas solo si es exacto (o un tope que no se alcanzó) */
const totalExacto = (c: ConteoExpl | undefined) => (c && !c.error && c.tipo !== 'estimado' && c.masDe === null ? c.valor : null);

// ------------------------------------------------------------------
// Índice: las 21 tablas por bloques
// ------------------------------------------------------------------

function IndiceTablas({ lista }: { lista: ListaExpl }) {
  const bloques = [...new Set(lista.tablas.map((t) => t.bloque))];
  return (
    <>
      {bloques.map((b) => (
        <section key={b} className="seccion-doc">
          <h2>{b}</h2>
          <div className="rejilla-tarjetas">
            {lista.tablas
              .filter((t) => t.bloque === b)
              .map((t) => (
                <Link key={t.nombre} to={rutaExplorador(t.nombre)} className="tarjeta-consulta">
                  <code style={{ fontWeight: 650 }}>{t.nombre}</code>
                  <p>
                    ≈ {num(t.filasEstimadas, 0)} filas
                    {t.grande && <span className="etiqueta-grande"> · grande: paginación por clave</span>}
                  </p>
                </Link>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ------------------------------------------------------------------
// Filtros
// ------------------------------------------------------------------

function filtroNuevo(c: ColumnaExpl): FiltroExpl {
  return { columna: c.nombre, op: c.operadores[0] };
}

function CampoValor({
  tabla,
  col,
  valor,
  onCambio,
  etiqueta,
}: {
  tabla: string;
  col: ColumnaExpl;
  valor: string;
  onCambio: (v: string) => void;
  etiqueta: string;
}) {
  if (col.fk) return <FkBuscador tabla={tabla} columna={col.nombre} valor={valor} onCambio={onCambio} etiquetaCampo={etiqueta} />;
  if (col.opciones)
    return (
      <select className="boton" aria-label={etiqueta} value={valor} onChange={(e) => onCambio(e.target.value)}>
        <option value="">—</option>
        {col.opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  if (col.categoria === 'fecha') return <input type="date" aria-label={etiqueta} value={valor} onChange={(e) => onCambio(e.target.value)} />;
  const numerica = ['entero', 'decimal', 'float'].includes(col.categoria);
  return (
    <input
      type="text"
      aria-label={etiqueta}
      inputMode={numerica ? 'decimal' : undefined}
      placeholder={col.categoria === 'fechahora' ? 'AAAA-MM-DD [HH:MM]' : numerica ? 'número' : 'texto'}
      value={valor}
      maxLength={100}
      onChange={(e) => onCambio(e.target.value)}
    />
  );
}

function EditorFiltros({
  tabla,
  aplicados,
  aplicar,
}: {
  tabla: TablaExpl;
  aplicados: FiltroExpl[];
  aplicar: (f: FiltroExpl[]) => void;
}) {
  const [borrador, setBorrador] = useState<FiltroExpl[]>(aplicados);
  const clave = JSON.stringify(aplicados);
  useEffect(() => setBorrador(JSON.parse(clave)), [clave]);

  const cambiar = (i: number, f: Partial<FiltroExpl>) => setBorrador((b) => b.map((x, k) => (k === i ? { ...x, ...f } : x)));
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    // Se envían tal cual: el servidor valida y explica qué falta
    aplicar(borrador.map((f) => (f.op === 'es_nulo' || f.op === 'no_es_nulo' ? { columna: f.columna, op: f.op } : f)));
  };
  const sinCambios = JSON.stringify(borrador) === clave;

  return (
    <form className="editor-filtros" onSubmit={enviar} aria-label="Filtros">
      {borrador.map((f, i) => {
        const col = tabla.columnas.find((c) => c.nombre === f.columna) ?? tabla.columnas[0];
        return (
          <div className="filtro-fila" key={i}>
            <select
              className="boton"
              aria-label={`Columna del filtro ${i + 1}`}
              value={col.nombre}
              onChange={(e) => cambiar(i, filtroNuevo(tabla.columnas.find((c) => c.nombre === e.target.value)!))}
            >
              {tabla.columnas.map((c) => (
                <option key={c.nombre} value={c.nombre}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <select
              className="boton"
              aria-label={`Operador del filtro ${i + 1}`}
              value={f.op}
              onChange={(e) => cambiar(i, { op: e.target.value as OperadorFiltro, valor: undefined, valor2: undefined })}
            >
              {col.operadores.map((o) => (
                <option key={o} value={o}>
                  {NOMBRE_OP[o]}
                </option>
              ))}
            </select>
            {f.op === 'entre' ? (
              <>
                <CampoValor tabla={tabla.nombre} col={col} valor={f.valor ?? ''} onCambio={(v) => cambiar(i, { valor: v })} etiqueta={`Desde (filtro ${i + 1})`} />
                <span className="muted">y</span>
                <CampoValor tabla={tabla.nombre} col={col} valor={f.valor2 ?? ''} onCambio={(v) => cambiar(i, { valor2: v })} etiqueta={`Hasta (filtro ${i + 1})`} />
              </>
            ) : f.op !== 'es_nulo' && f.op !== 'no_es_nulo' ? (
              <CampoValor tabla={tabla.nombre} col={col} valor={f.valor ?? ''} onCambio={(v) => cambiar(i, { valor: v })} etiqueta={`Valor (filtro ${i + 1})`} />
            ) : null}
            {!col.opciones && <span className="muted tipo-col">{col.tipo}</span>}
            <button type="button" className="boton peque" onClick={() => setBorrador((b) => b.filter((_, k) => k !== i))} aria-label={`Quitar filtro ${i + 1}`}>
              Quitar
            </button>
          </div>
        );
      })}
      <div className="acciones">
        <button
          type="button"
          className="boton peque"
          disabled={borrador.length >= 10}
          onClick={() => setBorrador((b) => [...b, filtroNuevo(tabla.columnas.find((c) => !c.pk) ?? tabla.columnas[0])])}
        >
          + Añadir filtro
        </button>
        {(borrador.length > 0 || aplicados.length > 0) && (
          <>
            <button type="submit" className="boton primario peque" disabled={sinCambios}>
              Aplicar
            </button>
            <button type="button" className="boton peque" disabled={!aplicados.length && !borrador.length} onClick={() => aplicar([])}>
              Quitar todos
            </button>
          </>
        )}
        {tabla.columnas.some((c) => c.categoria === 'fechahora') && <span className="muted nota-utc">Fechas y horas en UTC; "hasta 2026-01-15" incluye todo ese día.</span>}
      </div>
    </form>
  );
}

// ------------------------------------------------------------------
// Tabla con cabeceras ordenables
// ------------------------------------------------------------------

function Cabecera({
  col,
  orden,
  grande,
  onClic,
}: {
  col: ColumnaExpl;
  orden: OrdenExpl[];
  grande: boolean;
  onClic: (e: MouseEvent, col: string) => void;
}) {
  const i = orden.findIndex((o) => o.columna === col.nombre);
  const o = orden[i];
  const numerica = ['entero', 'decimal', 'float'].includes(col.categoria);
  const ayuda = [
    col.tipo,
    col.nulo ? 'admite NULL' : 'NOT NULL',
    col.pk ? 'clave primaria' : null,
    col.fk ? `FK → ${col.fk.tabla}.${col.fk.columna}` : null,
    col.indexada ? 'primera columna de un índice' : 'sin índice propio',
    'Clic: ordenar · Mayús+clic: añadir al orden',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <th scope="col" className={numerica ? 'n' : undefined} aria-sort={o ? (o.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button className="th-orden" onClick={(e) => onClic(e, col.nombre)} title={ayuda}>
        {col.nombre}
        {col.pk && <span className="marca-col">PK</span>}
        {col.fk && <span className="marca-col">FK</span>}
        {grande && !col.indexada && !col.pk && <span className="marca-col sin-indice" aria-label="sin índice">·</span>}
        <span className="flecha" aria-hidden="true">
          {o ? (o.dir === 'asc' ? '▲' : '▼') : ''}
          {o && orden.length > 1 ? <sub>{i + 1}</sub> : null}
        </span>
      </button>
    </th>
  );
}

function Celda({ col, v }: { col: ColumnaExpl; v: unknown }) {
  const numerica = ['entero', 'decimal', 'float'].includes(col.categoria);
  if (v === null || v === undefined) return <td className="nulo">NULL</td>;
  const s = String(v);
  if (col.fk)
    return (
      <td className="n">
        <Link to={rutaExplorador(col.fk.tabla, [{ columna: col.fk.columna, op: 'igual', valor: s }])} title={`Abrir ${col.fk.tabla} con ${col.fk.columna} = ${s}`}>
          {s}
        </Link>
      </td>
    );
  if (s.length > 60)
    return (
      <td className="larga" title={s}>
        {s.slice(0, 60)}…
      </td>
    );
  return <td className={numerica ? 'n' : undefined}>{s}</td>;
}

// ------------------------------------------------------------------
// Página de una tabla
// ------------------------------------------------------------------

function VistaTabla({ tabla, lista, crud }: { tabla: TablaExpl; lista: ListaExpl; crud?: TablaCrudInfo }) {
  const [sp, setSp] = useSearchParams();
  const clienteQuery = useQueryClient();
  const [accion, setAccion] = useState<AccionCrud | null>(null);
  const filtros = useMemo(() => leerFiltros(sp.get('f')), [sp]);
  const orden = useMemo(() => leerOrden(sp.get('orden')), [sp]);
  const tamano = TAMANOS.includes(Number(sp.get('tam'))) ? Number(sp.get('tam')) : 25;

  const claveVista = JSON.stringify([tabla.nombre, filtros, orden, tamano]);
  const [navEstado, setNav] = useState<Nav>(INICIO(claveVista));
  const nav = navEstado.clave === claveVista ? navEstado : INICIO(claveVista);

  const claveConteo = JSON.stringify([tabla.nombre, filtros]);
  const [conteos, setConteos] = useState<Record<string, ConteoExpl>>({});
  const conteo = conteos[claveConteo];
  const conteosRef = useRef(conteos);
  conteosRef.current = conteos;
  const [contandoExacto, setContandoExacto] = useState(false);
  const [plan, setPlan] = useState<{ cargando: boolean; datos?: RespuestaPlan; error?: unknown } | null>(null);
  const [irA, setIrA] = useState('');

  const cuerpo = {
    filtros,
    orden,
    tamano,
    modo: nav.modo,
    ...(nav.cursor ? { cursor: nav.cursor } : {}),
    ...(nav.pagina ? { pagina: nav.pagina } : {}),
  };
  const q = useQuery({
    queryKey: ['explorador', tabla.nombre, cuerpo],
    // Se cuenta solo si aún no hay recuento para estos filtros (no forma parte de la clave de caché)
    queryFn: ({ signal }) =>
      postJson<RespuestaFilas>(`/api/explorador/${tabla.nombre}/filas`, signal, {
        ...cuerpo,
        contar: nav.modo === 'inicio' && !conteosRef.current[claveConteo] ? 'auto' : 'no',
      }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  useEffect(() => {
    // Solo datos de esta consulta, no los provisionales de la anterior (placeholderData)
    const c = q.data?.conteo;
    if (c && !q.isPlaceholderData && q.data?.tabla === tabla.nombre) setConteos((m) => (m[claveConteo] ? m : { ...m, [claveConteo]: c }));
  }, [q.data, q.isPlaceholderData, claveConteo, tabla.nombre]);
  useEffect(() => setPlan(null), [claveVista, nav.modo, nav.pagina]);

  /** Tras un COMMIT: las filas, los recuentos y los buscadores de FK ya no valen */
  const trasEscribir = () => {
    setConteos({});
    clienteQuery.invalidateQueries({ queryKey: ['explorador', tabla.nombre] });
    clienteQuery.invalidateQueries({ queryKey: ['explorador-lista'] });
    clienteQuery.invalidateQueries({ queryKey: ['fk'] });
    clienteQuery.invalidateQueries({ queryKey: ['fk-id'] });
  };

  const cambiarUrl = (f: FiltroExpl[], o: OrdenExpl[], t = tamano) => {
    const n = new URLSearchParams();
    if (f.length) n.set('f', JSON.stringify(f));
    if (o.length) n.set('orden', o.map((x) => `${x.columna}:${x.dir}`).join(','));
    if (t !== 25) n.set('tam', String(t));
    setSp(n);
  };

  const clicCabecera = (e: MouseEvent, columna: string) => {
    const i = orden.findIndex((o) => o.columna === columna);
    let nuevo: OrdenExpl[];
    if (e.shiftKey) {
      if (i < 0) nuevo = orden.length >= MAX_ORDEN ? orden : [...orden, { columna, dir: 'asc' }];
      else if (orden[i].dir === 'asc') nuevo = orden.map((o, k) => (k === i ? { ...o, dir: 'desc' } : o));
      else nuevo = orden.filter((_, k) => k !== i);
    } else if (orden.length === 1 && i === 0) {
      nuevo = orden[0].dir === 'asc' ? [{ columna, dir: 'desc' }] : [];
    } else {
      nuevo = [{ columna, dir: 'asc' }];
    }
    cambiarUrl(filtros, nuevo);
  };

  const contarExacto = async () => {
    setContandoExacto(true);
    try {
      const r = await postJson<RespuestaFilas>(`/api/explorador/${tabla.nombre}/filas`, undefined, { filtros, orden: [], tamano: 25, contar: 'exacto' });
      if (r.conteo) setConteos((m) => ({ ...m, [claveConteo]: r.conteo! }));
    } catch {
      /* el error se ve en la consulta principal si lo hay */
    } finally {
      setContandoExacto(false);
    }
  };

  const verPlan = async () => {
    setPlan({ cargando: true });
    try {
      setPlan({ cargando: false, datos: await postJson<RespuestaPlan>(`/api/explorador/${tabla.nombre}/plan`, undefined, cuerpo) });
    } catch (error) {
      setPlan({ cargando: false, error });
    }
  };

  const d = q.data?.tabla === tabla.nombre ? q.data : undefined;
  const total = totalExacto(conteo);
  const paginas = total !== null ? Math.max(1, Math.ceil(total / tamano)) : null;
  const keyset = d?.paginacion.keysetDisponible ?? true;
  const go = (n: Omit<Nav, 'clave'>) => setNav({ ...n, clave: claveVista });
  const cursorDe = (fila: Record<string, unknown>) => d!.columnasCursor.map((c) => fila[c] as ValorCursor);

  const anterior = () => {
    if (!d?.filas.length) return;
    if (!keyset) return go({ modo: 'pagina', pagina: nav.pos.n - 1, pos: { desde: 'inicio', n: nav.pos.n - 1 } });
    if (nav.pos.desde === 'inicio' && nav.pos.n === 2) return go({ modo: 'inicio', pos: { desde: 'inicio', n: 1 } });
    go({ modo: 'anterior', cursor: cursorDe(d.filas[0]), pos: nav.pos.desde === 'inicio' ? { desde: 'inicio', n: nav.pos.n - 1 } : { desde: 'final', n: nav.pos.n + 1 } });
  };
  const siguiente = () => {
    if (!d?.filas.length) return;
    if (!keyset) return go({ modo: 'pagina', pagina: nav.pos.n + 1, pos: { desde: 'inicio', n: nav.pos.n + 1 } });
    go({ modo: 'siguiente', cursor: cursorDe(d.filas.at(-1)!), pos: nav.pos.desde === 'inicio' ? { desde: 'inicio', n: nav.pos.n + 1 } : { desde: 'final', n: nav.pos.n - 1 } });
  };
  const ultima = () => {
    if (!keyset && paginas) return go({ modo: 'pagina', pagina: paginas, pos: { desde: 'inicio', n: paginas } });
    go({ modo: 'final', pos: { desde: 'final', n: 1 } });
  };
  const offsetMax = tabla.grande ? lista.maxOffset : Infinity;
  const paginaMax = Math.min(paginas ?? Infinity, Math.floor(offsetMax / tamano) + 1);
  const irAPagina = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(irA);
    if (Number.isInteger(n) && n >= 1) go({ modo: 'pagina', pagina: n, pos: { desde: 'inicio', n } });
  };

  const textoPosicion =
    nav.pos.desde === 'inicio'
      ? `Página ${num(nav.pos.n, 0)}${paginas ? ` de ${num(paginas, 0)}` : ''}`
      : nav.pos.n === 1
        ? 'Última página'
        : `${num(nav.pos.n - 1, 0)} ${nav.pos.n === 2 ? 'página' : 'páginas'} antes de la última`;

  return (
    <>
      <header className="cabecera-consulta">
        <h1>
          <code>{tabla.nombre}</code>
        </h1>
        <div className="tecnicas">
          {tabla.bloque} · ≈ {num(tabla.filasEstimadas, 0)} filas · {tabla.columnas.length} columnas · PK ({tabla.pk.join(', ')})
          {tabla.grande && ' · tabla grande: paginación por clave, recuento con tope'}
        </div>
        <div className="relaciones">
          {tabla.columnas.some((c) => c.fk) && (
            <span>
              Apunta a:{' '}
              {[...new Set(tabla.columnas.filter((c) => c.fk).map((c) => c.fk!.tabla))].map((t, i) => (
                <span key={t}>
                  {i > 0 && ', '}
                  <Link to={rutaExplorador(t)}>{t}</Link>
                </span>
              ))}
            </span>
          )}
          {tabla.referenciadaPor.length > 0 && (
            <span>
              La usan:{' '}
              {tabla.referenciadaPor.map((r, i) => (
                <span key={`${r.tabla}.${r.columna}`}>
                  {i > 0 && ', '}
                  <Link to={rutaExplorador(r.tabla)}>{r.tabla}</Link>
                  <span className="muted">.{r.columna}</span>
                </span>
              ))}
            </span>
          )}
        </div>
      </header>

      {crud && (
        <div className="crud-barra">
          <button className="boton primario" onClick={() => setAccion({ tipo: 'crear' })}>
            + Nueva fila
          </button>
          <span className="aviso">
            Esta tabla admite escritura (usuario <code>app_rw</code>). Por defecto se <strong>simula</strong> (ROLLBACK); confirmar modifica datos reales y desvía las
            cifras de verificación y del README. <Link to="/crud">Copia de seguridad antes de confirmar</Link>.
          </span>
        </div>
      )}

      <EditorFiltros tabla={tabla} aplicados={filtros} aplicar={(f) => cambiarUrl(f, orden)} />

      {d?.avisos.map((a) => (
        <p key={a.tipo} className="callout" style={{ margin: '8px 0' }}>
          {a.texto}
        </p>
      ))}

      <div className="paginador">
        <span className="conteo" aria-live="polite">
          <strong>{textoConteo(conteo)}</strong>
          {conteo && (conteo.tipo === 'estimado' || conteo.masDe !== null || conteo.error) && (
            <button className="boton peque" onClick={contarExacto} disabled={contandoExacto}>
              {contandoExacto ? 'Contando…' : 'Contar exacto'}
            </button>
          )}
        </span>
        <span className="grupo-nav">
          <button className="boton peque" onClick={() => go({ modo: 'inicio', pos: { desde: 'inicio', n: 1 } })} disabled={!d?.paginacion.hayAnterior}>
            « Primera
          </button>
          <button className="boton peque" onClick={anterior} disabled={!d?.paginacion.hayAnterior}>
            ‹ Anterior
          </button>
          <span className="posicion">{textoPosicion}</span>
          <button className="boton peque" onClick={siguiente} disabled={!d?.paginacion.haySiguiente}>
            Siguiente ›
          </button>
          <button className="boton peque" onClick={ultima} disabled={!d?.paginacion.haySiguiente || (!keyset && !paginas)}>
            Última »
          </button>
        </span>
        <form className="grupo-nav" onSubmit={irAPagina}>
          <label className="muted">
            Ir a la página{' '}
            <input
              type="number"
              min={1}
              max={Number.isFinite(paginaMax) ? paginaMax : undefined}
              value={irA}
              onChange={(e) => setIrA(e.target.value)}
              style={{ width: '6em' }}
              title={tabla.grande ? `OFFSET permitido hasta ${num(lista.maxOffset, 0)} filas; más allá, usa Siguiente/Última` : undefined}
            />
          </label>
          <button className="boton peque" type="submit" disabled={!irA}>
            Ir
          </button>
        </form>
        <label className="muted">
          Filas por página{' '}
          <select className="boton peque" value={tamano} onChange={(e) => cambiarUrl(filtros, orden, Number(e.target.value))}>
            {TAMANOS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      {q.isError && <MensajeError error={q.error} reintentar={() => q.refetch()} />}
      {!d && q.isPending && <Cargando texto="Leyendo filas…" />}
      {d && (
        <div className={`tabla-envoltura explorador${q.isFetching ? ' actualizando' : ''}`} aria-busy={q.isFetching}>
          {q.isFetching && <div className="cargando-barra" />}
          <table className="datos">
            <thead>
              <tr>
                {crud && (
                  <th scope="col" className="col-acciones">
                    <span className="sr-only">Acciones</span>
                  </th>
                )}
                {tabla.columnas.map((c) => (
                  <Cabecera key={c.nombre} col={c} orden={orden} grande={tabla.grande} onClic={clicCabecera} />
                ))}
              </tr>
            </thead>
            <tbody>
              {d.filas.map((f, i) => (
                <tr key={i}>
                  {crud && (
                    <td className="col-acciones">
                      <button
                        className="boton peque"
                        onClick={() => setAccion({ tipo: 'editar', id: Number(f[crud.pk]) })}
                        aria-label={`Editar ${tabla.nombre} ${String(f[crud.pk])}`}
                      >
                        Editar
                      </button>
                      <button
                        className="boton peque"
                        onClick={() => setAccion({ tipo: 'borrar', id: Number(f[crud.pk]) })}
                        aria-label={`Borrar ${tabla.nombre} ${String(f[crud.pk])}`}
                      >
                        Borrar
                      </button>
                    </td>
                  )}
                  {tabla.columnas.map((c) => (
                    <Celda key={c.nombre} col={c} v={f[c.nombre]} />
                  ))}
                </tr>
              ))}
              {!d.filas.length && (
                <tr>
                  <td colSpan={tabla.columnas.length + (crud ? 1 : 0)} className="nulo">
                    Ninguna fila cumple los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {crud && accion && (
        <DialogoCrud
          key={JSON.stringify(accion)}
          tabla={tabla}
          info={crud}
          accion={accion}
          onCerrar={() => setAccion(null)}
          onEscrito={trasEscribir}
        />
      )}
      <p className="muted" style={{ fontSize: '.8rem', margin: '6px 0 0' }}>
        Clic en una cabecera para ordenar (otra vez: descendente; otra: sin orden). Mayús+clic añade columnas al orden (hasta {MAX_ORDEN}). La clave primaria se añade siempre al
        final para desempatar.{tabla.grande && ' El punto · marca columnas sin índice propio: ordenar por ellas obliga a MySQL a ordenar la tabla.'} Los valores de FK enlazan a la fila
        relacionada.
      </p>

      {d && (
        <section className="seccion-doc">
          <h2>Ver SQL</h2>
          <div className="meta-ejec">
            Filas en <strong>{ms(d.sql.ms)}</strong> ·{' '}
            {d.paginacion.tipo === 'keyset'
              ? d.paginacion.invertido
                ? 'paginación por clave, orden invertido (se le da la vuelta en el servidor)'
                : nav.modo === 'inicio'
                  ? 'primera página'
                  : 'paginación por clave (sin OFFSET)'
              : `OFFSET ${num(d.paginacion.offset, 0)}`}
            {conteo?.ms != null && (
              <>
                {' '}
                · recuento en <strong>{ms(conteo.ms)}</strong>
              </>
            )}{' '}
            · usuario <code>app_ro</code>, límite {lista.msFilas / 1000} s
          </div>
          <SqlBloque
            variantes={[
              {
                id: 'param',
                etiqueta: 'Consulta (con ?)',
                sql: d.sql.texto,
                pie: (
                  <>
                    Parámetros:{' '}
                    {d.sql.valores.map((v, i) => (
                      <code key={i}>{v === null ? 'NULL' : typeof v === 'string' ? `'${v}'` : String(v)}</code>
                    ))}
                    {' · '}se pide una fila de más para saber si hay otra página
                  </>
                ),
              },
              { id: 'valores', etiqueta: 'Con valores (para Workbench)', sql: d.sql.conValores },
              ...(conteo ? [{ id: 'conteo', etiqueta: `Recuento (${conteo.tipo})`, sql: conteo.sqlConValores }] : []),
            ]}
          />
          <div className="acciones" style={{ marginTop: 10 }}>
            <button className="boton peque" onClick={verPlan} disabled={plan?.cargando}>
              {plan?.cargando ? 'Pidiendo el plan…' : 'Ver plan (EXPLAIN)'}
            </button>
            <span className="muted" style={{ fontSize: '.8rem', alignSelf: 'center' }}>
              EXPLAIN no ejecuta la consulta: enseña qué índice elegiría MySQL.
            </span>
          </div>
          {plan?.error !== undefined && <MensajeError error={plan.error} />}
          {plan?.datos && (
            <div style={{ marginTop: 10 }}>
              <TablaResultados campos={plan.datos.campos} filas={plan.datos.filas} />
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function Explorador() {
  const { tabla } = useParams();
  const navigate = useNavigate();
  const lista = useQuery({
    queryKey: ['explorador-lista'],
    queryFn: ({ signal }) => getJson<ListaExpl>('/api/explorador', signal),
    staleTime: 5 * 60_000,
  });
  const meta = useQuery({
    queryKey: ['explorador-meta', tabla],
    queryFn: ({ signal }) => getJson<TablaExpl>(`/api/explorador/${tabla}`, signal),
    enabled: !!tabla,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Tablas con CRUD (fase 5). Si falla, el explorador sigue siendo de solo lectura.
  const crud = useQuery({
    queryKey: ['crud'],
    queryFn: ({ signal }) => getJson<CatalogoCrud>('/api/crud', signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const infoCrud = crud.data?.tablas.find((t) => t.nombre === tabla);

  if (lista.isPending) return <Cargando />;
  if (lista.isError) return <MensajeError error={lista.error} reintentar={() => lista.refetch()} />;
  const bloques = [...new Set(lista.data.tablas.map((t) => t.bloque))];

  return (
    <article>
      <div className="selector-tabla">
        <label className="campo">
          Tabla
          <select className="boton" value={tabla ?? ''} onChange={(e) => navigate(e.target.value ? rutaExplorador(e.target.value) : '/explorador')}>
            <option value="">Elige una de las 21 tablas…</option>
            {bloques.map((b) => (
              <optgroup key={b} label={b}>
                {lista.data.tablas
                  .filter((t) => t.bloque === b)
                  .map((t) => (
                    <option key={t.nombre} value={t.nombre}>
                      {t.nombre} · ≈ {num(t.filasEstimadas, 0)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="muted" style={{ fontSize: '.8rem' }}>
          Lectura con <code>app_ro</code>{crud.data && <> · escritura (CRUD) solo en {crud.data.tablas.map((t) => t.nombre).join(', ')}, con <code>app_rw</code></>} · tablas, columnas y operadores de una lista blanca leída de INFORMATION_SCHEMA · valores siempre como parámetros
        </span>
      </div>

      {!tabla && (
        <>
          <header className="cabecera-consulta">
            <h1>Explorador de tablas</h1>
            <p className="pregunta">
              Las 21 tablas de <code>aeropuerto</code> con filtros por columna, orden por varias columnas y paginación en el servidor. Debajo de cada tabla está el SQL que se ha
              ejecutado y su tiempo.
            </p>
          </header>
          <IndiceTablas lista={lista.data} />
        </>
      )}
      {tabla && meta.isPending && <Cargando />}
      {tabla && meta.isError && <MensajeError error={meta.error} />}
      {tabla && meta.data && <VistaTabla key={tabla} tabla={meta.data} lista={lista.data} crud={infoCrud} />}
    </article>
  );
}
