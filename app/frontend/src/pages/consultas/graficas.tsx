import type { ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { Fila, RespuestaConsulta } from '../../api/tipos';
import type { Colores } from '../../lib/colores';
import { diaCorto, duracion, euros, num, pct } from '../../lib/formato';
import { CajaTooltip, MarcoGrafica } from '../../components/Grafica';

/*
 * Una vista por consulta. Reglas aplicadas:
 *  - una sola escala Y por gráfica (si hay dos medidas de distinta escala, dos gráficas o tabla)
 *  - color por identidad (serie) en orden fijo; ordinal azul solo para cuartiles
 *  - marcas finas, extremo redondeado de 4 px, rejilla de 1 px recesiva
 *  - tooltip en cada marca; la tabla completa está en la pestaña "Tabla"
 */

interface Props {
  r: RespuestaConsulta;
  c: Colores;
}

const n = (v: unknown) => Number(v);
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function ejeProps(c: Colores) {
  return {
    stroke: c.eje,
    tick: { fill: c.tenue, fontSize: 12 },
    tickLine: false,
  } as const;
}
const cursor = (c: Colores) => ({ fill: c.rejilla, fillOpacity: 0.45 });
const animacion = { animationDuration: 350 } as const;

// Recharts pasa al contenido del tooltip { active, payload: [{ payload: fila }] }
function tt(render: (f: Record<string, unknown>) => ReactElement) {
  return ({ active, payload }: TooltipProps<ValueType, NameType>) =>
    active && payload?.length && payload[0].payload ? render(payload[0].payload as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------- Q01
function Q01({ r, c }: Props) {
  const datos = r.filas.map((f) => ({ ...f, pct: n(f.pct_retraso) }));
  const m = media(datos.map((d) => d.pct));
  return (
    <MarcoGrafica
      titulo="% de vuelos con retraso de salida ≥ 15 min, por aerolínea"
      sub={`Ordenado por puesto (RANK). La línea marca la media de las aerolíneas: ${pct(m, 2)}. Excluye cancelados.`}
    >
      <ResponsiveContainer width="100%" height={datos.length * 38 + 50}>
        <BarChart data={datos} layout="vertical" margin={{ top: 18, right: 64, bottom: 4, left: 8 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={c.rejilla} />
          <XAxis type="number" {...ejeProps(c)} tickFormatter={(v) => `${v} %`} />
          <YAxis type="category" dataKey="nombre" width={200} {...ejeProps(c)} tick={{ fill: c.texto, fontSize: 12 }} />
          <Tooltip
            cursor={cursor(c)}
            content={tt((f) => (
              <CajaTooltip
                titulo={`${f.puesto}º · ${f.nombre}`}
                filas={[
                  { etiqueta: 'Vuelos (no cancelados)', valor: num(f.vuelos, 0) },
                  { etiqueta: '% con retraso', valor: pct(f.pct_retraso, 2) },
                  { etiqueta: 'Diferencia con la media', valor: `${n(f.dif_vs_media_aerolineas) > 0 ? '+' : ''}${num(f.dif_vs_media_aerolineas, 2)} pp` },
                ]}
              />
            ))}
          />
          <ReferenceLine x={m} stroke={c.tenue} label={{ value: 'media', position: 'top', fill: c.tenue, fontSize: 11 }} />
          <Bar dataKey="pct" fill={c.serie[0]} radius={[0, 4, 4, 0]} maxBarSize={22} {...animacion}>
            <LabelList dataKey="pct" position="right" formatter={(v: number) => pct(v)} fill={c.texto} fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </MarcoGrafica>
  );
}

// ---------------------------------------------------------------- Q02
function Q02({ r, c }: Props) {
  const datos = r.filas.map((f) => ({ ...f, retraso: n(f.retraso_medio_min) }));
  const leyenda = [1, 2, 3, 4].map((q) => ({
    etiqueta: q === 1 ? 'Cuartil 1 (peor)' : q === 4 ? 'Cuartil 4 (mejor)' : `Cuartil ${q}`,
    color: c.ordinal[q - 1],
  }));
  return (
    <MarcoGrafica
      titulo="Retraso medio de salida (min) por aeropuerto de origen"
      sub={`${datos.length} aeropuertos con al menos ${num(r.params.minSalidas, 0)} salidas, agrupados en cuartiles con NTILE(4).`}
      leyenda={leyenda}
    >
      <ResponsiveContainer width="100%" height={Math.max(160, datos.length * 22 + 40)}>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap={3}>
          <CartesianGrid horizontal={false} stroke={c.rejilla} />
          <XAxis type="number" {...ejeProps(c)} tickFormatter={(v) => `${v} min`} />
          <YAxis type="category" dataKey="codigo_iata" width={48} {...ejeProps(c)} tick={{ fill: c.texto, fontSize: 12 }} interval={0} />
          <Tooltip
            cursor={cursor(c)}
            content={tt((f) => (
              <CajaTooltip
                titulo={`${f.codigo_iata} · ${f.nombre}`}
                filas={[
                  { etiqueta: 'Cuartil', valor: String(f.cuartil), color: c.ordinal[n(f.cuartil) - 1] },
                  { etiqueta: 'Salidas', valor: num(f.salidas, 0) },
                  { etiqueta: 'Retraso medio', valor: `${num(f.retraso_medio_min, 1)} min` },
                ]}
              />
            ))}
          />
          <Bar dataKey="retraso" radius={[0, 4, 4, 0]} maxBarSize={16} {...animacion}>
            {datos.map((_d, i) => (
              <Cell key={i} fill={c.ordinal[n(r.filas[i].cuartil) - 1]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </MarcoGrafica>
  );
}

// ---------------------------------------------------------------- Q03 (una fila: tiles, no gráfica)
function Q03({ r }: Props) {
  const f = r.filas[0] ?? {};
  return (
    <div>
      <p className="texto-2" style={{ marginTop: 0, maxWidth: '75ch' }}>
        De los <b>{num(f.vuelos_con_retraso_salida, 0)}</b> vuelos que salieron con 15 min o más de retraso,{' '}
        <b>{num(f.tras_llegada_tardia_mismo_avion, 0)}</b> venían de una llegada tardía (≥ 15 min) del mismo avión al mismo
        aeropuerto. La consulta devuelve una sola fila, así que se muestra como cifras en lugar de gráfica.
      </p>
      <div className="tiles">
        <div className="tile heroe">
          <div className="etq">Retrasos en cascada</div>
          <div className="val">{pct(f.pct_cascada)}</div>
          <div className="det">de los vuelos con retraso de salida</div>
        </div>
        <div className="tile">
          <div className="etq">Vuelos con retraso de salida</div>
          <div className="val">{num(f.vuelos_con_retraso_salida, 0)}</div>
        </div>
        <div className="tile">
          <div className="etq">Tras llegada tardía del mismo avión</div>
          <div className="val">{num(f.tras_llegada_tardia_mismo_avion, 0)}</div>
        </div>
        <div className="tile">
          <div className="etq">Margen medio de rotación</div>
          <div className="val">{num(f.margen_medio_rotacion_min, 0)} min</div>
          <div className="det">entre la llegada real anterior y la salida prevista</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Q04
function Q04({ r, c }: Props) {
  const datos = r.filas.map((f) => ({ ...f, etq: diaCorto(f.dia) }));
  return (
    <>
      <MarcoGrafica
        titulo="% de vuelos con retraso por día y media móvil de 7 días"
        sub="Día en UTC. El calendario sale de una CTE recursiva, así que los días sin vuelos también aparecen."
        leyenda={[
          { etiqueta: '% diario', color: c.serie[0], forma: 'linea' },
          { etiqueta: 'Media móvil 7 días', color: c.serie[1], forma: 'linea' },
        ]}
      >
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={datos} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.rejilla} />
            <XAxis dataKey="etq" {...ejeProps(c)} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...ejeProps(c)} tickFormatter={(v) => `${v} %`} width={52} />
            <Tooltip
              cursor={{ stroke: c.eje }}
              content={tt((f) => (
                <CajaTooltip
                  titulo={String(f.dia)}
                  filas={[
                    { etiqueta: '% diario', valor: pct(f.pct_retraso), color: c.serie[0] },
                    { etiqueta: 'Media móvil 7 d', valor: pct(f.media_movil_7d), color: c.serie[1] },
                    { etiqueta: 'Vuelos', valor: num(f.vuelos, 0) },
                  ]}
                />
              ))}
            />
            <Line type="monotone" dataKey="pct_retraso" stroke={c.serie[0]} strokeWidth={1.5} dot={{ r: 3, strokeWidth: 0, fill: c.serie[0] }} activeDot={{ r: 5, stroke: c.superficie, strokeWidth: 2 }} connectNulls={false} {...animacion} />
            <Line type="monotone" dataKey="media_movil_7d" stroke={c.serie[1]} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: c.superficie, strokeWidth: 2 }} {...animacion} />
          </LineChart>
        </ResponsiveContainer>
      </MarcoGrafica>
      <MarcoGrafica titulo="Vuelos por día (no cancelados)" sub="Volumen detrás de cada porcentaje.">
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={datos} margin={{ top: 4, right: 24, bottom: 4, left: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke={c.rejilla} />
            <XAxis dataKey="etq" {...ejeProps(c)} interval="preserveStartEnd" minTickGap={18} />
            <YAxis {...ejeProps(c)} width={52} tickFormatter={(v) => num(v, 0)} />
            <Tooltip cursor={cursor(c)} content={tt((f) => <CajaTooltip titulo={String(f.dia)} filas={[{ etiqueta: 'Vuelos', valor: num(f.vuelos, 0) }]} />)} />
            <Bar dataKey="vuelos" fill={c.neutro} radius={[4, 4, 0, 0]} {...animacion} />
          </BarChart>
        </ResponsiveContainer>
      </MarcoGrafica>
    </>
  );
}

// ---------------------------------------------------------------- Q05 (rachas en el calendario)
function diaDelMes(iso: unknown) {
  return Number(String(iso).slice(8, 10));
}
function Q05({ r, c }: Props) {
  const d0 = diaDelMes(r.params.desde);
  const d1 = diaDelMes(r.params.hasta);
  const datos = r.filas.map((f) => ({
    ...f,
    etq: `${f.codigo_iata} · ${diaCorto(f.inicio)}`,
    rango: [diaDelMes(f.inicio), diaDelMes(f.fin) + 1],
  }));
  const ticks: number[] = [];
  for (let d = d0; d <= d1 + 1; d += d1 - d0 > 14 ? 2 : 1) ticks.push(d);
  return (
    <MarcoGrafica
      titulo="Rachas de días seguidos con retraso medio alto (enero 2026, UTC)"
      sub={`Cada barra es una racha (gaps and islands): días consecutivos con retraso medio de salida > ${r.params.umbral} min y al menos ${r.params.minSalidas} salidas ese día.`}
    >
      <ResponsiveContainer width="100%" height={Math.max(140, datos.length * 34 + 50)}>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={c.rejilla} />
          <XAxis type="number" domain={[d0, d1 + 1]} ticks={ticks} {...ejeProps(c)} tickFormatter={(v) => `${v}`} allowDataOverflow />
          <YAxis type="category" dataKey="etq" width={110} {...ejeProps(c)} tick={{ fill: c.texto, fontSize: 12 }} interval={0} />
          <Tooltip
            cursor={cursor(c)}
            content={tt((f) => (
              <CajaTooltip
                titulo={`${f.codigo_iata} · ${f.nombre}`}
                filas={[
                  { etiqueta: 'Desde', valor: String(f.inicio) },
                  { etiqueta: 'Hasta', valor: String(f.fin) },
                  { etiqueta: 'Días seguidos', valor: num(f.dias_seguidos, 0) },
                  { etiqueta: 'Retraso medio de la racha', valor: `${num(f.retraso_medio_racha, 1)} min` },
                ]}
              />
            ))}
          />
          <Bar dataKey="rango" fill={c.serie[0]} radius={4} maxBarSize={18} {...animacion} />
        </BarChart>
      </ResponsiveContainer>
      <p className="sub" style={{ marginTop: 4 }}>Eje horizontal: día de enero.</p>
    </MarcoGrafica>
  );
}

// ---------------------------------------------------------------- Q06
function Q06({ r, c }: Props) {
  const datos = r.filas.map((f) => ({ ...f, dur: n(f.duracion_min) }));
  const color = (t: unknown) => (n(t) === 1 ? c.serie[0] : c.serie[1]);
  const maxH = Math.ceil(Math.max(60, ...datos.map((d) => d.dur)) / 60);
  const ticksHoras = Array.from({ length: maxH + 1 }, (_, i) => i * 60);
  return (
    <MarcoGrafica
      titulo={`Duración del mejor itinerario desde ${r.params.aeropuerto} el ${diaCorto(r.params.dia)} (UTC)`}
      sub="Para cada destino, el itinerario que llega antes (ROW_NUMBER). Primero los destinos cuya mejor opción es con escala; conexión de 60 min a 4 h."
      leyenda={[
        { etiqueta: 'Directo (1 tramo)', color: c.serie[0] },
        { etiqueta: 'Con escala (2 tramos)', color: c.serie[1] },
      ]}
    >
      <ResponsiveContainer width="100%" height={Math.max(160, datos.length * 24 + 40)}>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap={4}>
          <CartesianGrid horizontal={false} stroke={c.rejilla} />
          <XAxis type="number" {...ejeProps(c)} ticks={ticksHoras} domain={[0, ticksHoras[ticksHoras.length - 1]]} tickFormatter={(v) => `${v / 60} h`} />
          <YAxis type="category" dataKey="destino" width={48} {...ejeProps(c)} tick={{ fill: c.texto, fontSize: 12 }} interval={0} />
          <Tooltip
            cursor={cursor(c)}
            content={tt((f) => (
              <CajaTooltip
                titulo={`${r.params.aeropuerto} → ${f.destino}`}
                filas={[
                  { etiqueta: 'Tramos', valor: String(f.tramos), color: color(f.tramos) },
                  { etiqueta: 'Vuelos', valor: String(f.vuelos) },
                  { etiqueta: 'Duración total', valor: duracion(f.duracion_min) },
                ]}
              />
            ))}
          />
          <Bar dataKey="dur" radius={[0, 4, 4, 0]} maxBarSize={16} {...animacion}>
            {datos.map((_d, i) => (
              <Cell key={i} fill={color(r.filas[i].tramos)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </MarcoGrafica>
  );
}

// ---------------------------------------------------------------- Q07
function Q07({ r, c }: Props) {
  const datos = r.filas.map((f) => ({ ...f, horas: n(f.horas_voladas) }));
  return (
    <MarcoGrafica
      titulo="Horas voladas por aeronave (enero 2026)"
      sub="Las aeronaves que más vuelan. El coste de mantenimiento y el coste por hora están en el tooltip y en la tabla (otra escala, no se mezclan en el mismo eje)."
    >
      <ResponsiveContainer width="100%" height={Math.max(160, datos.length * 28 + 40)}>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={c.rejilla} />
          <XAxis type="number" {...ejeProps(c)} tickFormatter={(v) => `${num(v, 0)} h`} />
          <YAxis type="category" dataKey="matricula" width={80} {...ejeProps(c)} tick={{ fill: c.texto, fontSize: 12 }} interval={0} />
          <Tooltip
            cursor={cursor(c)}
            content={tt((f) => (
              <CajaTooltip
                titulo={`${f.matricula} · ${f.modelo} (${f.aerolinea})`}
                filas={[
                  { etiqueta: 'Vuelos', valor: num(f.vuelos, 0) },
                  { etiqueta: 'Horas voladas', valor: num(f.horas_voladas, 1) },
                  { etiqueta: 'vs media de la flota', valor: `${n(f.horas_vs_media_flota) > 0 ? '+' : ''}${num(f.horas_vs_media_flota, 1)} h` },
                  { etiqueta: 'Intervenciones', valor: num(f.intervenciones, 0) },
                  { etiqueta: 'Coste mantenimiento', valor: euros(f.coste_mantenimiento) },
                  { etiqueta: 'Coste por hora', valor: f.coste_por_hora === null ? '—' : euros(f.coste_por_hora) },
                ]}
              />
            ))}
          />
          <Bar dataKey="horas" fill={c.serie[0]} radius={[0, 4, 4, 0]} maxBarSize={18} {...animacion} />
        </BarChart>
      </ResponsiveContainer>
    </MarcoGrafica>
  );
}

// ---------------------------------------------------------------- Q08 (ROLLUP)
export const esSubtotalQ08 = (f: Fila) => f.aerolinea === 'TOTAL' || f.clase === 'todas las clases';
function Q08({ r, c }: Props) {
  const detalle = r.filas.filter((f) => !esSubtotalQ08(f));
  const total = r.filas.find((f) => f.aerolinea === 'TOTAL');
  // Clases en orden fijo (alfabético, como las devuelve el GROUP BY): el color sigue a la clase
  const clases = [...new Set(detalle.map((f) => String(f.clase)))].sort();
  const porAerolinea = new Map<string, Record<string, unknown>>();
  for (const f of detalle) {
    const a = String(f.aerolinea);
    const fila = porAerolinea.get(a) ?? { aerolinea: a, total: 0 };
    fila[String(f.clase)] = n(f.ingresos);
    fila[`b_${f.clase}`] = n(f.billetes);
    fila.total = n(fila.total) + n(f.ingresos);
    porAerolinea.set(a, fila);
  }
  const datos = [...porAerolinea.values()].sort((a, b) => n(b.total) - n(a.total));
  return (
    <>
      <div className="tiles" style={{ marginBottom: 14 }}>
        <div className="tile">
          <div className="etq">Ingresos totales (fila TOTAL del ROLLUP)</div>
          <div className="val">{euros(total?.ingresos)}</div>
        </div>
        <div className="tile">
          <div className="etq">Billetes no cancelados</div>
          <div className="val">{num(total?.billetes, 0)}</div>
        </div>
        <div className="tile">
          <div className="etq">Precio medio</div>
          <div className="val">{euros(total?.precio_medio)}</div>
        </div>
      </div>
      <MarcoGrafica
        titulo="Ingresos por aerolínea, desglosados por clase (€)"
        sub="Solo hay billetes para una muestra de 5.000 vuelos. Los subtotales del ROLLUP aparecen resaltados en la tabla."
        leyenda={clases.map((k, i) => ({ etiqueta: k, color: c.serie[i] }))}
      >
        <ResponsiveContainer width="100%" height={Math.max(160, datos.length * 40 + 40)}>
          <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke={c.rejilla} />
            <XAxis type="number" {...ejeProps(c)} tickFormatter={(v) => `${num(n(v) / 1e6, 0)} M€`} />
            <YAxis type="category" dataKey="aerolinea" width={190} {...ejeProps(c)} tick={{ fill: c.texto, fontSize: 12 }} interval={0} />
            <Tooltip
              cursor={cursor(c)}
              content={tt((f) => (
                <CajaTooltip
                  titulo={String(f.aerolinea)}
                  filas={[
                    ...clases.map((k, i) => ({ etiqueta: `${k} (${num(f[`b_${k}`] ?? 0, 0)} billetes)`, valor: euros(f[k] ?? 0), color: c.serie[i] })),
                    { etiqueta: 'Total', valor: euros(f.total) },
                  ]}
                />
              ))}
            />
            {clases.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="ingresos"
                fill={c.serie[i]}
                stroke={c.superficie}
                strokeWidth={2}
                maxBarSize={24}
                {...animacion}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </MarcoGrafica>
    </>
  );
}

// ---------------------------------------------------------------- Q09
function Q09({ r, c }: Props) {
  const datos = r.filas.map((f) => ({ ...f, fo: n(f.factor_ocupacion), mr: n(f.media_de_su_ruta) }));
  return (
    <MarcoGrafica
      titulo="Factor de ocupación (%) del vuelo frente a la media de su ruta"
      sub="Los vuelos más llenos de la muestra con billetes. La media de la ruta sale de AVG() OVER (PARTITION BY id_ruta)."
      leyenda={[
        { etiqueta: 'Este vuelo', color: c.serie[0] },
        { etiqueta: 'Media de su ruta', color: c.serie[1] },
      ]}
    >
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={datos} margin={{ top: 8, right: 16, bottom: 28, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={c.rejilla} />
          <XAxis dataKey="numero_vuelo" {...ejeProps(c)} interval={0} angle={-35} textAnchor="end" height={40} />
          <YAxis {...ejeProps(c)} domain={[0, 100]} tickFormatter={(v) => `${v} %`} width={52} />
          <Tooltip
            cursor={cursor(c)}
            content={tt((f) => (
              <CajaTooltip
                titulo={`${f.numero_vuelo} (id ${f.id_vuelo})`}
                filas={[
                  { etiqueta: 'Pasajeros / capacidad', valor: `${num(f.pasajeros, 0)} / ${num(f.capacidad_total, 0)}` },
                  { etiqueta: 'Factor de ocupación', valor: pct(f.factor_ocupacion), color: c.serie[0] },
                  { etiqueta: 'Media de su ruta', valor: pct(f.media_de_su_ruta), color: c.serie[1] },
                ]}
              />
            ))}
          />
          <Bar dataKey="fo" fill={c.serie[0]} radius={[4, 4, 0, 0]} maxBarSize={18} {...animacion} />
          <Bar dataKey="mr" fill={c.serie[1]} radius={[4, 4, 0, 0]} maxBarSize={18} {...animacion} />
        </BarChart>
      </ResponsiveContainer>
    </MarcoGrafica>
  );
}

// ---------------------------------------------------------------- Q10
function Q10({ r, c }: Props) {
  const datos = r.filas.map((f) => ({ ...f, gasto: n(f.gasto_total) }));
  return (
    <MarcoGrafica
      titulo="Gasto total (€) de los pasajeros frecuentes sin cancelaciones"
      sub={`Pasajeros con al menos ${r.params.minVuelos} vuelos distintos y ningún billete cancelado (NOT EXISTS).`}
    >
      <ResponsiveContainer width="100%" height={Math.max(160, datos.length * 28 + 40)}>
        <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={c.rejilla} />
          <XAxis type="number" {...ejeProps(c)} tickFormatter={(v) => `${num(v, 0)} €`} />
          <YAxis type="category" dataKey="pasajero" width={210} {...ejeProps(c)} tick={{ fill: c.texto, fontSize: 12 }} interval={0} />
          <Tooltip
            cursor={cursor(c)}
            content={tt((f) => (
              <CajaTooltip
                titulo={`${f.pasajero} (id ${f.id_pasajero})`}
                filas={[
                  { etiqueta: 'Vuelos distintos', valor: num(f.vuelos, 0) },
                  { etiqueta: 'Gasto total', valor: euros(f.gasto_total) },
                ]}
              />
            ))}
          />
          <Bar dataKey="gasto" fill={c.serie[0]} radius={[0, 4, 4, 0]} maxBarSize={18} {...animacion} />
        </BarChart>
      </ResponsiveContainer>
    </MarcoGrafica>
  );
}

export const GRAFICAS: Record<string, (p: Props) => ReactElement> = {
  q01: Q01,
  q02: Q02,
  q03: Q03,
  q04: Q04,
  q05: Q05,
  q06: Q06,
  q07: Q07,
  q08: Q08,
  q09: Q09,
  q10: Q10,
};

/** Filas a resaltar en la tabla (subtotales del ROLLUP en Q08). */
export const RESALTAR: Record<string, (f: Fila) => boolean> = {
  q08: esSubtotalQ08,
};
