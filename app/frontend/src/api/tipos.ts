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
