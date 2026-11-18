import { Router } from 'express';
import { infoServidor } from '../db.js';

export const rutasSalud = Router();

// Estado de la conexión: la usa la cabecera de la app para mostrar "conectado a MySQL 8.0.x"
rutasSalud.get('/', async (_req, res) => {
  const info = await infoServidor();
  res.json({ ok: true, servidor: info.esMariaDB ? 'MariaDB' : 'MySQL', version: info.version });
});
