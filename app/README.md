# App web del proyecto aeropuerto

App local (React + Express + MySQL 8) para enseñar el SQL del proyecto: cada gráfica tiene su tabla, su tiempo de ejecución y el SQL exacto.

> Estado: **fase 5 de 7** (consultas Q01–Q10, proyecto, calidad, rendimiento, modelo ER, demo de triggers, explorador de tablas y CRUD). El asistente de vuelos llega en la fase siguiente.

## Requisitos

- Node 22.12 o superior
- MySQL 8 con la base `aeropuerto` cargada (ver el README de la raíz)

## Arranque (PowerShell)

1. **Usuarios de MySQL** (solo la primera vez). En Workbench, como root, abre `app/backend/sql/00_usuarios_app.sql`, cambia `CAMBIA_CLAVE_RO` y `CAMBIA_CLAVE_RW` por tus claves, ejecútalo entero (Ctrl+Shift+Enter) y **cierra la pestaña sin guardar**.
   Después, también como root, abre y ejecuta entero `app/backend/sql/01_demo_triggers.sql` (crea `sp_demo_trigger` y da a `app_rw` permiso para ejecutarlo; no lleva claves).
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
- **Demo de triggers**: el procedimiento `sp_demo_trigger(caso)` (`app/backend/sql/01_demo_triggers.sql`, `SQL SECURITY DEFINER`) abre una transacción, crea datos de prueba marcados (`#D…`, `TEST-D*`, año 2030), lanza la sentencia del caso, lee el error real con `GET DIAGNOSTICS` y hace `ROLLBACK` siempre. `app_rw` solo tiene `EXECUTE` sobre él. El backend hace `COUNT(*)` de las tablas afectadas antes y después con `app_ro`.
- **Explorador de tablas**: solo lectura con `app_ro`. Tablas, columnas y operadores salen de una lista blanca construida con `INFORMATION_SCHEMA` (las 21 tablas del proyecto); los valores van siempre como `?` y se validan antes contra el tipo de la columna; `LIKE` escapa `%` y `_`. La clave primaria se añade al final del `ORDER BY` para que el orden sea total. Navegación por clave (keyset: `WHERE (col, pk) > (última fila)` desarrollado en `OR`, con NULL bien tratado) en vez de `OFFSET`; «Ir a la página N» usa `OFFSET` solo hasta 10.000 filas en las tablas grandes (≥ 100.000 filas estimadas). Recuento exacto en tablas pequeñas, estimado (`information_schema.TABLES`) sin filtros en las grandes y con tope («más de 10.000») con filtros; botón para contarlo exacto. Límite de 10 s por consulta, aviso al ordenar por columnas sin índice y botón `EXPLAIN`.
- **CRUD** (vuelo, empleado, pasajero y aeronave): desde el explorador, con el usuario `app_rw`. El formulario sale de `INFORMATION_SCHEMA` (tipo, NOT NULL, defecto, ENUM, FK con buscador). El servidor valida con `zod` y genera `INSERT`, `UPDATE … WHERE pk = ?` o `DELETE … WHERE pk = ?` con columnas de la lista blanca y valores como `?`; las FK, UNIQUE, CHECK y triggers los comprueba MySQL, y su error se enseña tal cual con una explicación (el trigger o procedimiento que lo lanza sale de `sql/01-03`). Todo en una transacción: `SELECT … FOR UPDATE` (si la fila cambió desde que se abrió, se para), la sentencia, relectura de la fila y `ROLLBACK` (modo **simular**, el de por defecto) o `COMMIT` (modo **confirmar**). Borrar de verdad exige escribir `tabla:id`. `sql_safe_updates = 1` en la sesión.

  **Aviso**: confirmar modifica datos reales y desvía las cifras de `sql/verificar_aeropuerto.sql` y del README. Antes, haz una copia (PowerShell; pide la clave de root):
  ```powershell
  & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -u root -p --single-transaction --routines --triggers --databases aeropuerto aeropuerto_verif --result-file="$HOME\Desktop\aeropuerto_antes_crud.sql"
  ```
  Para volver a ese estado: Workbench > Server > Data Import > Import from Self-Contained File. Simular también gasta valores de AUTO_INCREMENT (los id saltan).
- **Consultas pesadas**: límite de tiempo en el servidor (`max_execution_time`), caché en memoria con TTL y cancelación (si cierras o cambias el filtro, el backend lanza `KILL QUERY`).
- **Comprobación de cordura**: al arrancar, el backend compara los recuentos de varias tablas con las cifras del proyecto y avisa por consola si difieren.
- **Frontend** (`app/frontend`): Vite + React 18 + TypeScript, React Router, TanStack Query y Recharts. Tema claro u oscuro. Las horas están en UTC.
