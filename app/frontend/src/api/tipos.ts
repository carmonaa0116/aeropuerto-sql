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
