import { Link } from 'react-router-dom';

// Página de inicio provisional. En la fase 2 se convierte en el README interactivo
// (texto sacado del README.md y de docs/, con contadores en vivo).
export function Inicio() {
  return (
    <section>
      <h1>Aeropuerto · base de datos MySQL 8</h1>
      <p className="texto-2" style={{ maxWidth: '70ch' }}>
        App local para explorar la base de datos <code>aeropuerto</code>: 21 tablas, 355.006 vuelos reales del BTS (enero 2026) y
        datos sintéticos calibrados.
      </p>
      <div className="rejilla-tarjetas" style={{ marginTop: 18 }}>
        <Link to="/consultas" className="tarjeta tarjeta-consulta">
          <div className="num">Disponible</div>
          <h2 style={{ fontSize: '1rem' }}>Consultas Q01–Q10</h2>
          <p>Funciones ventana, CTE recursivas, ROLLUP y NOT EXISTS, con gráfica y SQL.</p>
        </Link>
        <div className="tarjeta">
          <div className="muted" style={{ fontSize: '.8rem' }}>Fase 2</div>
          <h2 style={{ fontSize: '1rem' }}>Esta página</h2>
          <p className="texto-2" style={{ fontSize: '.88rem' }}>
            Pasará a ser el README interactivo con contadores en vivo, fuentes, pipeline y limitaciones.
          </p>
        </div>
      </div>
    </section>
  );
}
