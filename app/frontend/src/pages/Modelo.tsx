import { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getJson } from '../api/cliente';
import type { FkER, RespuestaModelo, TablaER } from '../api/tipos';
import { Cargando, MensajeError } from '../components/Estado';
import { Pestanas } from '../components/Pestanas';
import { SqlBloque } from '../components/SqlBloque';
import { useTema } from '../lib/tema';
import { ms, num } from '../lib/formato';

// ------------------------------------------------------------------
// Nodo: una tabla con sus columnas clave (PK y FK). La ficha completa va debajo.
// ------------------------------------------------------------------
const ANCHO = 216;
const ALTO_CAB = 40;
const ALTO_FILA = 19;

type DatosNodo = { tabla: TablaER; estado: 'normal' | 'activa' | 'vecina' | 'atenuada' };
type NodoTabla = Node<DatosNodo, 'tabla'>;

function columnasClave(t: TablaER) {
  return t.columnas.filter((c) => c.pk || c.fk);
}

const TablaNodo = memo(function TablaNodo({ data }: NodeProps<NodoTabla>) {
  const t = data.tabla;
  return (
    <div className={`er-nodo er-${data.estado}`} style={{ width: ANCHO }}>
      <Handle type="target" position={Position.Left} className="er-handle" />
      <div className="er-cab">
        <strong>{t.nombre}</strong>
        <span>≈ {num(t.filasEstimadas, 0)}</span>
      </div>
      <ul>
        {columnasClave(t).map((c) => (
          <li key={c.nombre}>
            <span className={c.pk ? 'er-pk' : 'er-fk'}>{c.pk && c.fk ? 'PK FK' : c.pk ? 'PK' : 'FK'}</span>
            {c.nombre}
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Right} className="er-handle" />
    </div>
  );
});

const tiposNodo = { tabla: TablaNodo };

/** Disposición automática con dagre: tablas padre a la izquierda, hijas a la derecha. */
function disponer(m: RespuestaModelo) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 90, marginx: 10, marginy: 10 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of m.tablas) g.setNode(t.nombre, { width: ANCHO, height: ALTO_CAB + columnasClave(t).length * ALTO_FILA + 8 });
  for (const fk of m.fks) g.setEdge(fk.tablaRef, fk.tabla, {}, fk.nombre);
  dagre.layout(g);
  const pos = new Map<string, { x: number; y: number }>();
  for (const t of m.tablas) {
    const n = g.node(t.nombre);
    pos.set(t.nombre, { x: n.x - n.width / 2, y: n.y - n.height / 2 });
  }
  return pos;
}

function Diagrama({ m, activa, onActiva }: { m: RespuestaModelo; activa: string; onActiva: (t: string) => void }) {
  const { resuelto } = useTema();
  const pos = useMemo(() => disponer(m), [m]);

  const vecinas = useMemo(() => {
    const s = new Set<string>();
    for (const fk of m.fks) {
      if (fk.tabla === activa) s.add(fk.tablaRef);
      if (fk.tablaRef === activa) s.add(fk.tabla);
    }
    return s;
  }, [m, activa]);

  const nodos: NodoTabla[] = m.tablas.map((t) => ({
    id: t.nombre,
    type: 'tabla',
    position: pos.get(t.nombre)!,
    data: {
      tabla: t,
      estado: !activa ? 'normal' : t.nombre === activa ? 'activa' : vecinas.has(t.nombre) ? 'vecina' : 'atenuada',
    },
    ariaLabel: `Tabla ${t.nombre}`,
  }));

  const aristas: Edge[] = m.fks.map((fk) => {
    const toca = !!activa && (fk.tabla === activa || fk.tablaRef === activa);
    return {
      id: `${fk.tabla}.${fk.nombre}`,
      source: fk.tablaRef,
      target: fk.tabla,
      markerEnd: toca ? 'er-muchos-activa' : 'er-muchos',
      label: toca ? fk.columnas.join(', ') : undefined,
      className: toca ? 'er-arista activa' : activa ? 'er-arista atenuada' : 'er-arista',
      zIndex: toca ? 1 : 0,
    };
  });

  return (
    <div className="er-lienzo">
      {/* Marcador "muchos" (pata de gallo) en el extremo de la tabla hija */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <marker id="er-muchos" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
            <path d="M0 6 L12 0 M0 6 L12 6 M0 6 L12 12" className="er-marca" fill="none" />
          </marker>
          <marker id="er-muchos-activa" viewBox="0 0 12 12" refX="12" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
            <path d="M0 6 L12 0 M0 6 L12 6 M0 6 L12 12" className="er-marca activa" fill="none" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodos}
        edges={aristas}
        nodeTypes={tiposNodo}
        colorMode={resuelto}
        fitView
        fitViewOptions={{ padding: 0.05 }}
        minZoom={0.2}
        maxZoom={1.6}
        nodesConnectable={false}
        edgesFocusable={false}
        onNodeClick={(_e, n) => onActiva(n.id === activa ? '' : n.id)}
        onPaneClick={() => onActiva('')}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function Ficha({ t }: { t: TablaER }) {
  return (
    <section className="tarjeta ficha" aria-labelledby="t-ficha">
      <h2 id="t-ficha">
        <code>{t.nombre}</code>{' '}
        <span className="muted" style={{ fontSize: '.85rem', fontWeight: 400 }}>
          · {t.bloque} · ≈ {num(t.filasEstimadas, 0)} filas (estimación de InnoDB) · {t.motor}
        </span>
      </h2>
      <div className="tabla-envoltura">
        <table className="datos">
          <thead>
            <tr>
              <th scope="col">columna</th>
              <th scope="col">tipo</th>
              <th scope="col">nulo</th>
              <th scope="col">clave</th>
              <th scope="col">defecto</th>
              <th scope="col">extra</th>
            </tr>
          </thead>
          <tbody>
            {t.columnas.map((c) => {
              const fk = t.fks.find((f) => f.columnas.includes(c.nombre));
              return (
                <tr key={c.nombre}>
                  <td>
                    <code>{c.nombre}</code>
                  </td>
                  <td>
                    <code>{c.tipo}</code>
                  </td>
                  <td>{c.nulo ? 'sí' : 'no'}</td>
                  <td>
                    {[c.pk && 'PK', fk && `FK → ${fk.tablaRef}.${fk.columnasRef[fk.columnas.indexOf(c.nombre)]}`, c.clave === 'UNI' && 'UNIQUE']
                      .filter(Boolean)
                      .join(' · ') || <span className="muted">—</span>}
                  </td>
                  <td className={c.defecto === null ? 'nulo' : undefined}>{c.defecto ?? '—'}</td>
                  <td>{c.extra ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="dos-columnas" style={{ marginTop: 14 }}>
        <div>
          <h3>Claves foráneas ({t.fks.length})</h3>
          {t.fks.length === 0 ? (
            <p className="muted">Ninguna.</p>
          ) : (
            <ul className="lista-reglas">
              {t.fks.map((f) => (
                <li key={f.nombre}>
                  <code>{f.nombre}</code>: ({f.columnas.join(', ')}) → <code>{f.tablaRef}</code>({f.columnasRef.join(', ')}){' '}
                  {f.alBorrar !== '—' && (
                    <span className="muted">
                      ON DELETE {f.alBorrar} · ON UPDATE {f.alActualizar}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <h3>Referenciada por ({t.referenciadaPor.length})</h3>
          {t.referenciadaPor.length === 0 ? (
            <p className="muted">Ninguna tabla.</p>
          ) : (
            <ul className="lista-reglas">
              {t.referenciadaPor.map((r) => (
                <li key={`${r.tabla}.${r.nombre}`}>
                  <code>{r.tabla}</code>({r.columnas.join(', ')})
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>CHECK ({t.checks.length})</h3>
          {t.checks.length === 0 ? (
            <p className="muted">Ninguno.</p>
          ) : (
            <ul className="lista-reglas">
              {t.checks.map((c) => (
                <li key={c.nombre}>
                  <code>{c.nombre}</code>: <code>{c.condicion}</code>
                </li>
              ))}
            </ul>
          )}
          <h3>Índices ({t.indices.length})</h3>
          <ul className="lista-reglas">
            {t.indices.map((i) => (
              <li key={i.nombre}>
                <code>{i.nombre}</code> ({i.columnas}) <span className="muted">{i.nombre === 'PRIMARY' ? 'PK' : i.unico ? 'UNIQUE' : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ListaRelaciones({ fks, onActiva }: { fks: FkER[]; onActiva: (t: string) => void }) {
  return (
    <div className="tabla-envoltura">
      <table className="datos">
        <caption className="sr-only">Las claves foráneas de la base de datos</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">tabla</th>
            <th scope="col">columnas</th>
            <th scope="col">referencia</th>
            <th scope="col">restriccion</th>
            <th scope="col">ON DELETE / UPDATE</th>
          </tr>
        </thead>
        <tbody>
          {fks.map((f, i) => (
            <tr key={`${f.tabla}.${f.nombre}`}>
              <td className="n">{i + 1}</td>
              <td>
                <button className="enlace" onClick={() => onActiva(f.tabla)}>
                  {f.tabla}
                </button>
              </td>
              <td>
                <code>{f.columnas.join(', ')}</code>
              </td>
              <td>
                <button className="enlace" onClick={() => onActiva(f.tablaRef)}>
                  {f.tablaRef}
                </button>
                ({f.columnasRef.join(', ')})
              </td>
              <td>
                <code>{f.nombre}</code>
              </td>
              <td>
                {f.alBorrar} / {f.alActualizar}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Modelo() {
  const q = useQuery({
    queryKey: ['modelo'],
    queryFn: ({ signal }) => getJson<RespuestaModelo>('/api/modelo', signal),
    staleTime: 10 * 60_000,
  });
  const [activa, setActiva] = useState('vuelo');
  const [pestana, setPestana] = useState('diagrama');

  if (q.isPending) return <Cargando texto="Leyendo INFORMATION_SCHEMA…" />;
  if (q.isError) return <MensajeError error={q.error} reintentar={() => q.refetch()} />;
  const m = q.data;
  const t = m.tablas.find((x) => x.nombre === activa);
  const elegir = (n: string) => {
    setActiva(n);
    if (n && pestana === 'relaciones') setPestana('diagrama');
  };

  return (
    <article>
      <header className="cabecera-consulta">
        <h1>Modelo ER</h1>
        <p className="pregunta">
          Generado en vivo desde <code>INFORMATION_SCHEMA</code>: cada flecha es una clave foránea real, de la tabla referenciada (izquierda) a la que
          la contiene (pata de gallo, lado "muchos").
        </p>
      </header>
      <div className="tiles">
        {[
          ['Tablas', m.resumen.tablas],
          ['Claves foráneas', m.resumen.clavesForaneas],
          ['CHECK', m.resumen.checks],
          ['Columnas', m.resumen.columnas],
          ['Índices', m.resumen.indices],
        ].map(([etq, v]) => (
          <div className="tile" key={etq}>
            <div className="etq">{etq}</div>
            <div className="val">{num(v, 0)}</div>
          </div>
        ))}
      </div>
      <div className="meta-ejec">
        <span>
          5 consultas a INFORMATION_SCHEMA: <strong>{ms(m.ms)}</strong>
        </span>
        {m.desdeCache && <span className="chip">desde caché (1 h)</span>}
        <label className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          Tabla
          <select className="boton" value={activa} onChange={(e) => setActiva(e.target.value)}>
            <option value="">(ninguna)</option>
            {m.tablas.map((x) => (
              <option key={x.nombre} value={x.nombre}>
                {x.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      {m.resumen.checksSinTabla > 0 && (
        <p className="aviso">
          {m.resumen.checksSinTabla} CHECK sin tabla: el usuario app_ro no ve information_schema.TABLE_CONSTRAINTS en este servidor, así que no
          aparecen en la ficha de su tabla (sí en "Ver SQL").
        </p>
      )}
      <Pestanas
        pestanas={[
          { id: 'diagrama', etiqueta: 'Diagrama' },
          { id: 'relaciones', etiqueta: `Relaciones (${m.resumen.clavesForaneas} FK)` },
          { id: 'sql', etiqueta: 'Ver SQL' },
        ]}
        activa={pestana}
        onCambio={setPestana}
      >
        {pestana === 'diagrama' && (
          <>
            <Diagrama m={m} activa={activa} onActiva={elegir} />
            <p className="muted" style={{ fontSize: '.8rem', margin: '6px 0 0' }}>
              Clic en una tabla para resaltar sus relaciones y ver su ficha. Rueda para zoom, arrastrar para mover. En cada tabla solo se listan PK y
              FK; el resto de columnas está en la ficha.
            </p>
          </>
        )}
        {pestana === 'relaciones' && <ListaRelaciones fks={m.fks} onActiva={elegir} />}
        {pestana === 'sql' && (
          <SqlBloque
            variantes={Object.entries(m.sql).map(([id, sql]) => ({ id, etiqueta: id.replace('_', ' '), sql }))}
            titulo="usuario app_ro · INFORMATION_SCHEMA"
          />
        )}
      </Pestanas>

      {t && pestana !== 'sql' && (
        <div style={{ marginTop: 16 }}>
          <Ficha t={t} />
        </div>
      )}
    </article>
  );
}
