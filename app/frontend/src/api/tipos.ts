export type Valor = string | number | null;
export type Fila = Record<string, Valor>;

export interface ParamUI {
  nombre: string;
  etiqueta: string;
  tipo: 'entero' | 'fecha' | 'aeropuerto';
  defecto: string | number;
  min?: number | string;
  max?: number | string;
  ayuda?: string;
}

export interface MetaConsulta {
  id: string;
  numero: string;
  titulo: string;
  pregunta: string;
  tecnicas: string;
  nota: string | null;
  parametros: ParamUI[];
  sinParametros: string | null;
  timeoutMs: number;
}

export interface Campo {
  nombre: string;
  tipo?: number;
}

export interface RespuestaConsulta extends MetaConsulta {
  params: Record<string, string | number>;
  valores: (string | number)[];
  filas: Fila[];
  campos: Campo[];
  ms: number;
  desdeCache: boolean;
  sql: {
    ejecutado: string;
    conValores: string;
    original: string | null;
    archivo: string;
  };
}

export interface Salud {
  ok: boolean;
  servidor: string;
  version: string;
}

export interface AeropuertoOrigen {
  codigo_iata: string;
  nombre: string;
  ciudad: string;
  salidas: number;
}

// ---------- Fase 2 ----------
export interface Seccion {
  id: string;
  titulo: string;
  md: string;
}

export interface DocMarkdown {
  archivo: string;
  titulo: string;
  intro: string;
  secciones: Seccion[];
  modificado: string;
}

export interface CifraTabla {
  tabla: string;
  bloque: string;
  filas: number | null;
  referencia: number;
  coincide: boolean;
}

export interface Estructura {
  tablas: number;
  claves_foraneas: number;
  checks: number;
}

export interface RespuestaCifras {
  tablas: CifraTabla[];
  bloques: string[];
  totalFilas: number;
  totalReferencia: number;
  estructura: Estructura;
  estructuraReferencia: Estructura;
  rango: { primera_salida: string; ultima_salida: string };
  ms: { recuento: number; estructura: number; rango: number };
  medido: string;
  desdeCache: boolean;
  sql: { recuento: string; estructura: string; rango: string };
}

export type EstadoVerif = 'OK' | 'FALLO' | 'REVISAR' | 'INFO';

export interface FilaVerif {
  id: number;
  seccion: string;
  comprobacion: string;
  regla: string;
  esperado: number | null;
  valor: number | null;
  estado: EstadoVerif | null;
  sql: string | null;
}

export interface RespuestaCalidad {
  filas: FilaVerif[];
  total: number;
  resumen: Record<EstadoVerif, number>;
  secciones: string[];
  reglas: { regla: string; explicacion: string }[];
  creada: string | null;
  limitaciones: string[];
  archivoLimitaciones: string;
  ms: number;
  desdeCache: boolean;
  sql: { lectura: string; ejecucion: string; estado: string | null; archivo: string };
}

export interface Medicion {
  indice: string;
  consulta: string;
  motor: string;
  antesMs: number | null;
  despuesMs: number | null;
  antesTexto: string;
  despuesTexto: string;
  seccion: string;
}

export interface IndiceProyecto {
  id: string;
  consulta: string;
  nombre: string;
  tabla: string;
  columnas: string;
}

export interface DocRendimiento extends DocMarkdown {
  mediciones: Medicion[];
  indicesProyecto: IndiceProyecto[];
}

export interface RespuestaIndices {
  filas: { tabla: string; indice: string; no_unico: number; columnas: string; del_proyecto: boolean }[];
  ms: number;
  sql: string;
}

export interface RespuestaExplain {
  id: string;
  numero: string;
  servidor: string;
  version: string;
  formato: 'arbol' | 'json';
  plan: string;
  msPlan: number | null;
  msTotal: number;
  indiceEsperado: IndiceProyecto | null;
  usaIndice: boolean | null;
  valores: (string | number)[];
  sql: { ejecutado: string; conValores: string; archivo: string };
}

export interface ColumnaER {
  nombre: string;
  tipo: string;
  nulo: boolean;
  pk: boolean;
  fk: boolean;
  clave: string | null;
  defecto: string | null;
  extra: string | null;
}

export interface FkER {
  nombre: string;
  tabla: string;
  columnas: string[];
  tablaRef: string;
  columnasRef: string[];
  alActualizar: string;
  alBorrar: string;
}

export interface TablaER {
  nombre: string;
  bloque: string;
  filasEstimadas: number | null;
  motor: string | null;
  columnas: ColumnaER[];
  pk: string[];
  fks: FkER[];
  referenciadaPor: { tabla: string; nombre: string; columnas: string[] }[];
  unicos: { nombre: string; columnas: string; unico: boolean }[];
  checks: { nombre: string; condicion: string }[];
  indices: { nombre: string; columnas: string; unico: boolean }[];
}

export interface RespuestaModelo {
  tablas: TablaER[];
  fks: FkER[];
  resumen: { tablas: number; columnas: number; clavesForaneas: number; checks: number; checksSinTabla: number; indices: number };
  ms: number;
  desdeCache: boolean;
  sql: Record<string, string>;
}

// ---------------- Fase 3: demo de triggers ----------------
export interface ValidadorDemo {
  nombre: string;
  archivo: string;
  sql: string;
}

export interface CasoDemo {
  id: string;
  titulo: string;
  bloque: string;
  regla: string;
  escenario: string;
  esperado: { resultado: 'error' | 'ok'; errno: number | null; mensaje: string | null };
  sqlIntento: string;
  llamada: string;
  tablas: string[];
  validadores: ValidadorDemo[];
}

export interface RespuestaDemo {
  archivo: string;
  preparacion: string;
  casos: CasoDemo[];
  instalacion: { ok: boolean; motivo: string | null };
}

export interface ResultadoDemo {
  caso: string;
  resultado: 'error' | 'ok';
  paso: 'validacion' | 'preparacion' | 'intento';
  errno: number | null;
  estadoSql: string | null;
  mensaje: string | null;
  esperado: CasoDemo['esperado'];
  coincide: boolean;
  ms: number;
  rastro: { tablas: { tabla: string; antes: number; despues: number }[]; intacto: boolean; msConteo: number };
  sql: { llamada: string; conteo: string };
}

// ---------------- Fase 4: explorador de tablas ----------------
export type CategoriaCol = 'entero' | 'decimal' | 'float' | 'texto' | 'fecha' | 'fechahora' | 'enum';
export type OperadorFiltro = 'igual' | 'contiene' | 'empieza' | 'entre' | 'es_nulo' | 'no_es_nulo';

export interface ColumnaExpl {
  nombre: string;
  tipo: string;
  categoria: CategoriaCol;
  nulo: boolean;
  pk: boolean;
  fk: { tabla: string; columna: string } | null;
  opciones: string[] | null;
  origenOpciones: 'enum' | 'check' | null;
  indexada: boolean;
  operadores: OperadorFiltro[];
}

export interface TablaExpl {
  nombre: string;
  bloque: string;
  columnas: ColumnaExpl[];
  pk: string[];
  etiqueta: string[];
  filasEstimadas: number | null;
  grande: boolean;
  indices: { nombre: string; columnas: string[] }[];
  referenciadaPor: { tabla: string; columna: string }[];
}

export interface ListaExpl {
  tablas: { nombre: string; bloque: string; filasEstimadas: number | null; grande: boolean }[];
  umbralGrande: number;
  maxOffset: number;
  topeConteo: number;
  msFilas: number;
}

export interface FiltroExpl {
  columna: string;
  op: OperadorFiltro;
  valor?: string;
  valor2?: string;
}

export interface OrdenExpl {
  columna: string;
  dir: 'asc' | 'desc';
}

export type ModoExpl = 'inicio' | 'final' | 'siguiente' | 'anterior' | 'pagina';
export type ValorCursor = string | number | null;

export interface ConteoExpl {
  tipo: 'exacto' | 'tope' | 'estimado';
  valor: number | null;
  masDe: number | null;
  ms: number | null;
  sql: string;
  sqlConValores: string;
  error: string | null;
}

export interface RespuestaFilas {
  tabla: string;
  filas: Fila[];
  columnasCursor: string[];
  orden: (OrdenExpl & { usuario: boolean })[];
  paginacion: {
    tipo: 'keyset' | 'offset';
    keysetDisponible: boolean;
    offset: number | null;
    invertido: boolean;
    hayAnterior: boolean;
    haySiguiente: boolean;
  };
  conteo: ConteoExpl | null;
  avisos: { tipo: string; texto: string }[];
  sql: { texto: string; valores: unknown[]; conValores: string; ms: number };
}

export interface RespuestaPlan {
  filas: Fila[];
  campos: Campo[];
  ms: number;
  sql: string;
}

export interface RespuestaFk {
  tabla: string;
  columna: string;
  etiqueta: string[];
  opciones: { id: number; etiqueta: string | null }[];
  sql: string | null;
  ms: number;
}
