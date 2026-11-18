export function Proximamente({ titulo, fase }: { titulo: string; fase: number }) {
  return (
    <section>
      <h1>{titulo}</h1>
      <p className="texto-2">Esta página llega en la fase {fase}.</p>
    </section>
  );
}
