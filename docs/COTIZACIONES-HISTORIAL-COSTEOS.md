# Cotizaciones — historial de costeos (versiones inmutables)

Base: `7c1b702a6e7ed296d634765b2a7b449759749bc1` (posterior al PR #407).
Pasa de **1 cotización → 1 costeo** a **1 cotización → N versiones de costeo**. Cada versión sigue siendo un snapshot inmutable.
SQL propuesto, **no ejecutado**. No cambia fórmulas, perfiles, parámetros, PDF, rutas ni permisos.

> **Orden de despliegue:** aplicar la migración (preflight → migrate) **antes** de desplegar. El código nuevo exige `version`, `es_seleccionado`,
> `seleccionado_por`, `seleccionado_en` y el índice `uq_cotizacion_costeo_version`. **Ventana:** entre aplicar la migración y desplegar, el código anterior
> no puede registrar costeos nuevos (`version` es `NOT NULL` sin default); aplicar y desplegar seguido.

## Discovery (estado antes del cambio)

- `tms_cotizacion_costeos` tenía `UNIQUE KEY uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id)`: eso forzaba el 1:1. Además
  `uq_cotizacion_costeo_empresa_id (empresa_id, id)` (lo usa la FK de componentes), `idx_cotizacion_costeo_fecha` y las FK a `empresas` y a
  `tms_cotizaciones (empresa_id, id)` (la FK compuesta usaba el índice 1:1 para su `(empresa_id, cotizacion_id)`).
- `guardarSnapshotCosteoTx` (`cotizacion-costeo-db.ts`) hacía `SELECT ... FOR UPDATE` y lanzaba `ErrorCosteoYaRegistrado` si existía una fila; el `ER_DUP_ENTRY`
  también se traducía a ese error. Se invoca **dentro de la transacción** de `crearCotizacion` (tras el INSERT de la cotización y su auditoría) y de
  `actualizarCotizacion` (cotización ya bloqueada `FOR UPDATE`, solo en Borrador). Ambas rutas (`POST /cotizaciones`, `PATCH /cotizaciones/[id]`) lo mapeaban a 409.
- `obtenerSnapshotCosteo` (una sola fila, `LIMIT 1`) lo consumía únicamente `GET /cotizaciones/[id]/costeo`, y ese endpoint lo usaban el panel de costeo
  (cotización existente → modo solo lectura) y el detalle expandido del listado (`CosteoRegistradoDetalle`).
- El costeo se guarda **solo** al crear o editar una cotización en Borrador (con `costeo` en el payload). No existe un endpoint propio de «guardar costeo».
  `Duplicar` no copia el costeo (sin cambios).

## Modelo de datos (aditivo, sin tabla nueva)

| Columna / índice | Definición |
| --- | --- |
| `version` | `INT NOT NULL` — 1, 2, 3… por cotización (la asigna la app) |
| `es_seleccionado` | `TINYINT(1) NOT NULL DEFAULT 0` — versión «utilizada»; a lo sumo una por cotización |
| `seleccionado_por` / `seleccionado_en` | `VARCHAR(100) NULL` / `DATETIME NULL` — quién y cuándo la eligió (útiles para auditar; NULL en históricos migrados) |
| `uq_cotizacion_costeo_version` | `UNIQUE (empresa_id, cotizacion_id, version)` — reemplaza al 1:1 |
| `idx_cotizacion_costeo_historial` | `(empresa_id, cotizacion_id, creado_en)` — consulta del historial |
| `uq_cotizacion_costeo_cotizacion` | **se elimina** (solo este índice) |

Las columnas `*_snapshot`, los importes y los componentes **no se tocan**. `es_seleccionado`/`seleccionado_*` no son contenido del costeo: es la marca de
cuál versión se usa, y es lo único que puede cambiar tras crear la versión.

**Unicidad del seleccionado:** MariaDB no tiene índice único parcial (`WHERE es_seleccionado = 1`), así que se resuelve **en la aplicación, dentro de una
transacción** con `SELECT ... FOR UPDATE` (cotización padre y todas sus versiones). No hay un índice frágil; la UI no es la garantía.

## SQL (no ejecutado)

- `sql/preflight-2026-10-cotizaciones-historial-costeos.sql` — solo lectura: versión de MariaDB, `SHOW CREATE TABLE`, `SHOW INDEX`, las 4 columnas nuevas,
  cantidad de costeos, cotizaciones con más de un costeo (debe ser 0) y verificación posterior (sin `version` NULL; una sola seleccionada por cotización). Criterios APLICAR / NOOP / DETENER.
- `sql/migrate-2026-10-cotizaciones-historial-costeos.sql` — 5 sentencias en orden seguro: (1) columnas (`version` nullable solo mientras se rellena) →
  (2) `UPDATE ... SET version = 1, es_seleccionado = 1 WHERE version IS NULL` → (3) `version NOT NULL` → (4) índices nuevos →
  (5) `DROP INDEX IF EXISTS uq_cotizacion_costeo_cotizacion`. El índice nuevo se crea antes de soltar el viejo porque la FK compuesta necesita un índice con
  `(empresa_id, cotizacion_id)` al frente. Idempotente (el `UPDATE` solo toca filas sin versión, así re-ejecutarla no marca como seleccionadas versiones posteriores).
- `sql/schema.sql` — `tms_cotizacion_costeos` con las columnas e índices nuevos. Las migraciones anteriores (2026-09, 2026-10 costeo Excel, paridad Cotizador 2026) no se modifican.

### Históricos
Hasta hoy cada cotización tenía como máximo un costeo (lo imponía el índice único), así que **cada fila existente es su versión 1 y era el único costeo de su cotización**:
`version = 1`, `es_seleccionado = 1`. Sin recalcular, sin tocar montos ni snapshots; `COSTEO_V1`, `COSTEO_EXCEL_2026` y `COSTEO_COTIZADOR_2026` quedan intactos.

## Versionado y concurrencia

`guardarSnapshotCosteoTx`, en la misma transacción del llamador:
1. `SELECT id FROM tms_cotizaciones WHERE empresa_id = ? AND id = ? FOR UPDATE` — bloquea la cotización **padre** (serializa la numeración; en `crear`/`actualizar` ya estaba bloqueada o recién creada, y re-bloquear es inocuo).
2. `SELECT COALESCE(MAX(version), 0), COALESCE(MAX(es_seleccionado), 0) FROM tms_cotizacion_costeos WHERE empresa_id = ? AND cotizacion_id = ? FOR UPDATE`.
3. `version = max + 1`; INSERT de la versión y de sus componentes (solo INSERT; nunca UPDATE/DELETE de una versión existente).
4. Auditoría `crear_costeo`: «Costeo interno versión N registrado para cotización COT-… con perfil …» (sin importes).

Si dos usuarios costean a la vez se serializan por el bloqueo del padre y obtienen N y N+1. Si, aun así, chocaran en el índice único, se responde 409
`ErrorCosteoVersionConflicto` («…otra operación modificó esta cotización al mismo tiempo. Intenta de nuevo.»). **Se eliminó** `ErrorCosteoYaRegistrado` y su 409 «Esta cotización ya tiene un costeo registrado».

## Costeo seleccionado / utilizado

- La **primera** versión de una cotización queda seleccionada (si, por datos antiguos, ninguna lo estuviera, la nueva también). Una versión **posterior no reemplaza**
  a la seleccionada: eso exige la acción explícita **«Usar este costeo»**. Hoy el flujo no aplica el precio sugerido automáticamente (solo con «Usar precio sugerido»), y eso no cambia: seleccionar una versión **no modifica la tarifa comercial**.
- `seleccionarCosteo(empresaId, cotizacionId, costeoId, usuario)` (`cotizacion-costeo-historial.ts`), en una transacción: bloquea la cotización (`empresa_id + id`, `FOR UPDATE`) y todas sus versiones
  (`empresa_id + cotizacion_id`, `FOR UPDATE`); valida que `costeoId` pertenezca a **esa** cotización y empresa (404 si no); limpia la marca de las demás (también repara un dato anómalo con más de una);
  marca la elegida con `seleccionado_por/seleccionado_en`; audita `seleccionar_costeo` («Costeo interno versión N seleccionado para cotización COT-…»). Idempotente: si ya era la única seleccionada, no escribe ni audita.
- **Solo en Borrador** (409 si no): una cotización enviada conserva su significado comercial, igual que hoy no puede editarse ni registrar costeos. El historial **sí se puede consultar** en cualquier estado.

## Funciones y endpoints

| Función (`cotizacion-costeo-db.ts` / `cotizacion-costeo-historial.ts`) | Uso |
| --- | --- |
| `guardarSnapshotCosteoTx` (cambia) | Inserta la versión N+1 (ya no hay bloqueo 1:1) |
| `listarHistorialCosteos(empresaId, cotizacionId)` (nueva) | Todas las versiones `ORDER BY version DESC`, con snapshots y componentes persistidos |
| `obtenerCosteoSeleccionado(empresaId, cotizacionId)` (reemplaza a `obtenerSnapshotCosteo`) | La versión `es_seleccionado = 1` |
| `seleccionarCosteo(...)` (nueva) | «Usar este costeo» |

No queda ninguna función ambigua de «el snapshot»: `obtenerSnapshotCosteo` se eliminó y su único consumidor (`GET .../costeo`) ahora devuelve el **seleccionado**.

| Endpoint | Permiso |
| --- | --- |
| `GET /tms/cotizaciones/[id]/costeo/historial` (nuevo) | `cotizaciones_costeo:ver` (el mismo del costeo interno) |
| `POST /tms/cotizaciones/[id]/costeo/seleccionar` `{ costeoId }` (nuevo) | editar cotización **y** `cotizaciones_costeo:editar` (los mismos de guardar un costeo) |
| `GET /tms/cotizaciones/[id]/costeo` | ahora devuelve el costeo seleccionado |
| `POST/PATCH /tms/cotizaciones` con `costeo` | cada guardado confirmado crea una versión nueva |

Sin permisos nuevos. `empresa_id` y el usuario salen de la sesión; la cotización de la ruta y el `costeoId` se revalidan contra la empresa dentro de la transacción. Un error inesperado no se expone (500 genérico).

## UI

- **Editar cotización → E. Costeo interno:** el formulario de un costeo nuevo ya no se bloquea; debajo, **«Historial de costeos»** con una tarjeta por versión (más reciente primero):
  `Costeo #N`, fecha/hora, usuario, perfil, motor, costo base, margen, IVA, total sugerido, precio/km, precio comercial y la insignia **Seleccionado**.
  Acciones: **Ver configuración** y **Usar este costeo** (solo si no está seleccionada y la cotización es editable). La casilla de registro anuncia «versión N+1».
- **Ver configuración** (solo lectura): datos del perfil usado (incluidas las banderas «por cada día de servicio» y Thermo), parámetros económicos usados, input de esa cotización
  (distancia, días, pilotos, auxiliares, GPS, seguro, refrigeración, seguro de mercadería manual/global, override de combustible/viáticos/margen, otros costos) y el resultado completo (componentes, costo base, margen, subtotal, IVA, total, precio/km).
  **Todo sale del snapshot de esa versión** (`seccionesConfiguracionCosteo`); nunca de la configuración vigente. Lo ausente en snapshots antiguos se muestra «—».
- Sin editar, borrar ni recalcular versiones. El detalle expandido del listado muestra el mismo historial **sin** acciones de selección.

## Varias rutas
Este ticket versiona el **costeo de la cotización completa**, no crea costeos por ruta comercial; las rutas adicionales no cambian.

## Auditoría
`crear_costeo` (versión N) y `seleccionar_costeo` (versión N), sin montos ni parámetros en el texto.

## Validación
Ver el reporte del PR (pruebas dirigidas, `tsc`, eslint, `git diff --check`, build y suite completa contra `origin/main`).
