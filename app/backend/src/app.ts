import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { rutasConsultas } from './routes/consultas.js';
import { rutasSalud } from './routes/salud.js';
import { rutasProyecto } from './routes/proyecto.js';
import { rutasCalidad } from './routes/calidad.js';
import { rutasRendimiento } from './routes/rendimiento.js';
import { rutasModelo } from './routes/modelo.js';
import { manejadorErrores } from './middleware/errores.js';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  // En desarrollo Vite hace de proxy (mismo origen); CORS solo admite el frontend local
  app.use(cors({ origin: config.FRONTEND_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));

  // Log mínimo: método, ruta, estado y tiempo (sin parámetros ni datos)
  app.use((req, res, next) => {
    const t0 = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t0} ms`);
    });
    next();
  });

  app.use('/api/salud', rutasSalud);
  app.use('/api/consultas', rutasConsultas);
  app.use('/api/proyecto', rutasProyecto);
  app.use('/api/calidad', rutasCalidad);
  app.use('/api/rendimiento', rutasRendimiento);
  app.use('/api/modelo', rutasModelo);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Ruta de la API no encontrada' });
  });
  app.use(manejadorErrores);
  return app;
}
