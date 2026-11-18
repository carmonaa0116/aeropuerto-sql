import { config } from './config.js';
import { crearApp } from './app.js';
import { cerrarPools, infoServidor } from './db.js';
import { comprobarCordura } from './services/cordura.js';

const app = crearApp();

// Solo 127.0.0.1: la API no es accesible desde otros equipos de la red
const servidor = app.listen(config.PORT, '127.0.0.1', () => {
  console.log(`[api] Escuchando en http://127.0.0.1:${config.PORT}`);
  void arranque();
});

async function arranque() {
  try {
    const info = await infoServidor();
    console.log(`[db] Conectado como ${config.DB_RO_USER} a ${info.version} (${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME})`);
    const dif = await comprobarCordura();
    if (dif.length === 0) {
      console.log('[cordura] Los recuentos coinciden con las cifras del proyecto');
    } else {
      for (const d of dif) console.warn(`[cordura] AVISO ${d.tabla}: ${d.real} filas (esperadas ${d.esperado})`);
    }
  } catch (e) {
    const err = e as { code?: string; errno?: number; message?: string };
    console.error(`[db] No se pudo conectar: ${err.code ?? ''} ${err.errno ?? ''} ${err.message ?? ''}`);
    console.error('[db] Revisa app/backend/.env y que el servicio MySQL80 esté arrancado.');
  }
}

async function cerrar() {
  servidor.close();
  await cerrarPools().catch(() => undefined);
  process.exit(0);
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
