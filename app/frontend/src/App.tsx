import { Route, Routes } from 'react-router-dom';
import { Layout, SECCIONES_FUTURAS } from './components/Layout';
import { Inicio } from './pages/Inicio';
import { ConsultasIndice } from './pages/ConsultasIndice';
import { ConsultaPagina } from './pages/ConsultaPagina';
import { Proximamente } from './pages/Proximamente';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="consultas" element={<ConsultasIndice />} />
        <Route path="consultas/:id" element={<ConsultaPagina />} />
        {SECCIONES_FUTURAS.map((s) => (
          <Route key={s.ruta} path={s.ruta.slice(1)} element={<Proximamente titulo={s.titulo} fase={s.fase} />} />
        ))}
        <Route path="*" element={<Proximamente titulo="Página no encontrada" fase={0} />} />
      </Route>
    </Routes>
  );
}
