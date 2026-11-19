import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout, SECCIONES_FUTURAS } from './components/Layout';
import { Inicio } from './pages/Inicio';
import { ConsultasIndice } from './pages/ConsultasIndice';
import { ConsultaPagina } from './pages/ConsultaPagina';
import { Proximamente } from './pages/Proximamente';
import { Calidad } from './pages/Calidad';
import { Rendimiento } from './pages/Rendimiento';
import { Cargando } from './components/Estado';

// El diagrama ER (React Flow + dagre) se carga solo al entrar en la página
const Modelo = lazy(() => import('./pages/Modelo'));

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="consultas" element={<ConsultasIndice />} />
        <Route path="consultas/:id" element={<ConsultaPagina />} />
        <Route path="calidad" element={<Calidad />} />
        <Route path="rendimiento" element={<Rendimiento />} />
        <Route
          path="modelo"
          element={
            <Suspense fallback={<Cargando />}>
              <Modelo />
            </Suspense>
          }
        />
        {SECCIONES_FUTURAS.map((s) => (
          <Route key={s.ruta} path={s.ruta.slice(1)} element={<Proximamente titulo={s.titulo} fase={s.fase} />} />
        ))}
        <Route path="*" element={<Proximamente titulo="Página no encontrada" fase={0} />} />
      </Route>
    </Routes>
  );
}
