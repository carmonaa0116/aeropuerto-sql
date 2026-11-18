import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { BACKEND_ROOT } from './paths.js';

dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });

const esquema = z.object({
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default('aeropuerto'),
  DB_RO_USER: z.string().default('app_ro'),
  DB_RO_PASSWORD: z.string().min(1, 'Falta DB_RO_PASSWORD en app/backend/.env'),
  DB_RW_USER: z.string().default('app_rw'),
  DB_RW_PASSWORD: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
});

const resultado = esquema.safeParse(process.env);
if (!resultado.success) {
  // Solo se muestran los nombres de las variables, nunca sus valores
  const faltan = resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
  console.error(`[config] Configuración incompleta en app/backend/.env:\n  ${faltan}`);
  console.error('[config] Copia app/backend/.env.example como .env y rellénalo.');
  process.exit(1);
}

export const config = resultado.data;
