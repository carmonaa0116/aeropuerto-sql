import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '../api/cliente';
import type { MetaConsulta } from '../api/tipos';
import { Cargando, MensajeError } from '../components/Estado';

export function ConsultasIndice() {
  const lista = useQuery({
    queryKey: ['consultas'],
    queryFn: ({ signal }) => getJson<MetaConsulta[]>('/api/consultas', signal),
    staleTime: Infinity,
  });
  if (lista.isPending) return <Cargando />;
  if (lista.isError) return <MensajeError error={lista.error} reintentar={() => lista.refetch()} />;

  return (
    <section>
      <h1>Consultas avanzadas Q01–Q10</h1>
      <p className="texto-2" style={{ maxWidth: '75ch' }}>
        Las diez consultas de <code>sql/04_consultas_avanzadas.sql</code>, ejecutadas en vivo contra la base de datos. Cada una
        tiene su gráfica, la tabla de resultados, el tiempo de ejecución y el SQL exacto.
      </p>
      <div className="rejilla-tarjetas">
        {lista.data.map((m) => (
          <Link key={m.id} to={`/consultas/${m.id}`} className="tarjeta tarjeta-consulta">
            <div className="num">{m.numero}</div>
            <h2 style={{ fontSize: '1rem' }}>{m.titulo}</h2>
            <p>{m.pregunta}</p>
            <div className="tecnicas">{m.tecnicas}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
