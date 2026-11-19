import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '../api/cliente';
import type { MetaConsulta, Salud } from '../api/tipos';
import { useTema, type Preferencia } from '../lib/tema';

export const SECCIONES_BD = [
  { ruta: '/modelo', titulo: 'Modelo ER' },
  { ruta: '/calidad', titulo: 'Calidad de datos' },
  { ruta: '/rendimiento', titulo: 'Rendimiento e índices' },
  { ruta: '/triggers', titulo: 'Triggers en vivo' },
  { ruta: '/explorador', titulo: 'Explorador de tablas' },
];

export const SECCIONES_FUTURAS = [
  { ruta: '/crud', titulo: 'CRUD', fase: 5 },
  { ruta: '/asistente', titulo: 'Asistente de vuelos', fase: 6 },
];

function EstadoConexion() {
  const salud = useQuery({
    queryKey: ['salud'],
    queryFn: ({ signal }) => getJson<Salud>('/api/salud', signal),
    refetchInterval: 30_000,
    retry: false,
  });
  if (salud.isPending) return <span className="chip">Conectando…</span>;
  if (salud.isError) return <span className="chip err" title={(salud.error as Error).message}>Sin conexión con la API o MySQL</span>;
  return (
    <span className="chip ok" title="Usuario de solo lectura app_ro">
      {salud.data.servidor} {salud.data.version.split('-')[0]}
    </span>
  );
}

function SelectorTema() {
  const { preferencia, cambiar } = useTema();
  return (
    <label className="muted" style={{ fontSize: '.8rem', display: 'flex', gap: 6, alignItems: 'center' }}>
      Tema
      <select className="boton peque" value={preferencia} onChange={(e) => cambiar(e.target.value as Preferencia)}>
        <option value="sistema">Sistema</option>
        <option value="claro">Claro</option>
        <option value="oscuro">Oscuro</option>
      </select>
    </label>
  );
}

export function Layout() {
  const lista = useQuery({
    queryKey: ['consultas'],
    queryFn: ({ signal }) => getJson<MetaConsulta[]>('/api/consultas', signal),
    staleTime: Infinity,
  });

  return (
    <div className="app">
      <nav className="lateral" aria-label="Secciones">
        <NavLink to="/" className="marca" end>
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <path d="M7 18l18-7-6 13-3-5z" fill="#fff" />
          </svg>
          <span>
            <strong>Aeropuerto · SQL</strong>
            <span>MySQL 8 · 21 tablas</span>
          </span>
        </NavLink>
        <div className="nav">
          <NavLink to="/" end>
            Proyecto
          </NavLink>
          <div className="nav-titulo">Consultas</div>
          <NavLink to="/consultas" end>
            Todas (Q01–Q10)
          </NavLink>
          <div className="sub">
            {lista.data?.map((m) => (
              <NavLink key={m.id} to={`/consultas/${m.id}`} title={m.titulo}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span className="num">{m.numero}</span>
                  {m.titulo}
                </span>
              </NavLink>
            ))}
          </div>
          <div className="nav-titulo">Base de datos</div>
          {SECCIONES_BD.map((s) => (
            <NavLink key={s.ruta} to={s.ruta}>
              {s.titulo}
            </NavLink>
          ))}
          <div className="nav-titulo">Próximas fases</div>
          {SECCIONES_FUTURAS.map((s) => (
            <NavLink key={s.ruta} to={s.ruta}>
              <span>{s.titulo}</span>
              <span className="fase">fase {s.fase}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="principal">
        <div className="barra">
          <span className="chip utc" title="Todas las fechas y horas de la base de datos están en UTC">
            Horas en UTC
          </span>
          <EstadoConexion />
          <SelectorTema />
        </div>
        <main className="contenido" id="contenido">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
