# App web del proyecto aeropuerto

App local (React + Express + MySQL 8) para enseñar el SQL del proyecto: cada gráfica tiene su tabla, su tiempo de ejecución y el SQL exacto.

> Estado: **fase 1** (esqueleto, usuarios MySQL y consultas Q01–Q10). El resto de páginas llega en las fases siguientes.

## Requisitos

- Node 20 o superior
- MySQL 8 con la base `aeropuerto` cargada (ver el README de la raíz)

## Arranque (PowerShell)

1. **Usuarios de MySQL** (solo la primera vez). En Workbench, como root, abre `app/backend/sql/00_usuarios_app.sql`, cambia `CAMBIA_CLAVE_RO` y `CAMBIA_CLAVE_RW` por tus claves, ejecútalo entero (Ctrl+Shift+Enter) y **cierra la pestaña sin guardar**.
2. **Configuración** (solo la primera vez), desde la raíz del repo:
   ```powershell
   Copy-Item app\backend\.env.example app\backend\.env
   notepad app\backend\.env
   ```
   Pon en `DB_RO_PASSWORD` y `DB_RW_PASSWORD` las mismas claves del paso 1.
3. **Instalar dependencias** (solo la primera vez):
   ```powershell
   cd app
   npm install
   ```
4. **Arrancar** (desde `app/`):
   ```powershell
   npm run dev
   ```
   Abre http://localhost:5173. La API escucha en http://127.0.0.1:3001 (solo en local).
5. **Pruebas** (desde `app/`, con MySQL arrancado):
   ```powershell
   npm test
   ```

## Cómo está hecho

- **Backend** (`app/backend`): Express, `mysql2` con pool, `zod` para validar cada parámetro y `helmet`. Usa el usuario `app_ro` (solo `SELECT`). Nunca acepta SQL del navegador: las consultas son fijas y los valores van como parámetros (`?`). `multipleStatements` está desactivado.
- **Consultas Q01–Q10**: `app/backend/src/queries/qNN.sql` son copias literales de `sql/04_consultas_avanzadas.sql` en las que los valores fijos pasan a ser `?`. Una prueba comprueba que, con los valores por defecto, el SQL es idéntico al original. El título, la pregunta y las técnicas de cada consulta se leen del propio `sql/04`.
- **Consultas pesadas**: límite de tiempo en el servidor (`max_execution_time`), caché en memoria con TTL y cancelación (si cierras o cambias el filtro, el backend lanza `KILL QUERY`).
- **Comprobación de cordura**: al arrancar, el backend compara los recuentos de varias tablas con las cifras del proyecto y avisa por consola si difieren.
- **Frontend** (`app/frontend`): Vite + React 18 + TypeScript, React Router, TanStack Query y Recharts. Tema claro u oscuro. Las horas están en UTC.
