// Comprueba (sin base de datos) que las copias parametrizadas de src/queries/qNN.sql
// son exactamente las consultas de sql/04_consultas_avanzadas.sql: con los valores
// por defecto, el SQL resultante es idéntico al original salvo espacios.
import { describe, expect, it } from 'vitest';
import mysql from 'mysql2';
import { consultas, parametrosPorDefecto } from '../src/queries/registro.js';
import { consultasOriginales } from '../src/services/consultasOriginales.js';

const normalizar = (s: string) => s.replace(/;\s*$/, '').replace(/\s+/g, ' ').trim();

describe('SQL de Q01-Q10 igual al de sql/04_consultas_avanzadas.sql', () => {
  const originales = consultasOriginales();

  it('el archivo original tiene las 10 consultas con título, pregunta y técnicas', () => {
    expect([...originales.keys()]).toEqual(['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09', 'Q10']);
    for (const o of originales.values()) {
      expect(o.titulo.length).toBeGreaterThan(5);
      expect(o.pregunta.length).toBeGreaterThan(10);
      expect(o.tecnicas.length).toBeGreaterThan(3);
    }
  });

  for (const def of consultas.values()) {
    it(`${def.numero}: con los valores por defecto coincide con el original`, () => {
      const valores = def.valores(parametrosPorDefecto(def.id));
      expect((def.sql.match(/\?/g) ?? []).length).toBe(valores.length);
      const reconstruida = mysql.format(def.sql, valores);
      expect(normalizar(reconstruida)).toBe(normalizar(originales.get(def.numero)!.sql));
    });
  }
});
