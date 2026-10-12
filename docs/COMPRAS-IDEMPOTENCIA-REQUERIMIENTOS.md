# Compras — idempotencia de creación de Requerimientos (PR B)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** en la rama (incluida una prueba contra MariaDB local desechable con peticiones
concurrentes reales). **No** probado en navegador ni en producción, **no** desplegado y **no** aprobado. La migración es una
**propuesta**: este PR no ejecuta SQL. Aplica el mismo contrato aprobado en PR #441 (Fondos y Gastos).

## 1. Discovery

| Tema | Hallazgo |
|---|---|
| Flujo | `RequerimientoFormClient` → `POST /api/empresas/[slug]/compras/requerimientos` → `requerimientoGuardar` (`requerimiento-api.ts`) → `guardarRequerimiento` (`requerimientos.ts`) |
| Persistencia | Una transacción: cabecera (`compras_requerimientos`, código provisional `TMP-<uuid>` → `RC-AAAA-######`), líneas (`compras_requerimiento_lineas`), firmas históricas de requirente/encargado (archivos compensados si falla), auditoría. `GET_LOCK` por proveedor cuando hay facturas |
| Documentos de línea | Se suben **después** de crear, con el id devuelto (`subirPendientesCompra`), y esa función **nunca lanza**: un fallo de documentos no convierte la creación en fallida y el formulario navega al detalle. No existe el problema «comprobante falla → reintento crea otro» de Gastos |
| Guard frontend previo | Solo el atributo `disabled` (estado `guardando`). **El manejador no consultaba el estado**: dos envíos invocados sin pasar por el DOM (mismo tick, reintentos) lanzaban dos `POST`. Probado: sin el guard nuevo, el test de doble envío falla. Tampoco había clave: un reintento tras respuesta perdida duplicaba |
| Backend previo | Sin idempotencia. Nota propia de Compras: un reintento de un requerimiento **con facturas** ya no duplicaba, pero fallaba con 409 «factura duplicada» (regla de facturas por proveedor), no devolvía la creación original |
| Exportaciones | **PDF** ya dibuja observaciones por línea y generales con sus saltos de línea (PDFKit). **Excel** las volcaba en filas combinadas con altura `ceil(longitud/140)·14`: ignoraba los `\n` y no acotaba textos largos (Excel limita la fila a 409 pt) → **recorte real**. Corregido |

## 2. Diseño (diferencias respecto de PR A)

El contrato es el mismo (clave opcional en la primera ventana, misma clave + mismo contenido → creación original, misma clave +
contenido distinto → 409, clave distinta → creación legítima, `UNIQUE (empresa_id, clave_idempotencia)` decide la carrera,
huella SHA-256 del contenido funcional). Adaptaciones propias de Compras:

| Aspecto | PR A (Fondos/Gastos) | PR B (Compras) |
|---|---|---|
| Nombre en el payload | `claveIdempotencia` | `clave_idempotencia` (snake_case; esquema `.strict()`; solo en **crear**, el PATCH la rechaza) |
| Error 409 | `ConflictoIdempotencia` | `ErrorCompra(…, 409)` (mismo mensaje) |
| Búsqueda por clave | antes de la transacción + `ER_DUP_ENTRY` | antes de los locks de facturas, **de nuevo dentro de la transacción ya con el lock** (la petición que esperó al ganador ve su commit) y `ER_DUP_ENTRY` del índice |
| Respuesta de reintento | 200 | 201 y mismo cuerpo `{ id, codigo, version }` (código y versión vigentes) |
| Frontend | `useRef` + estado | `crearEnvioUnico()` (guard síncrono + clave perezosa en un `useState`, compatible con el arnés de hooks de las pruebas existentes). La clave **no se reinicia** tras el éxito: el formulario queda bloqueado (`completado`) mientras navega, y un envío tardío recuperaría el mismo requerimiento |

Huella (`src/lib/compras/requerimiento-idempotencia.ts`): `fecha_requerimiento`, `entidad_requirente_id`,
`requirente_usuario_id`, `encargado_compras_usuario_id`, `observaciones`, total derivado y **líneas en orden** (unidad, fecha,
serie/número de factura, proveedor, repuesto, método y condición de pago, total, observaciones de línea). Excluye id, código,
timestamps, snapshots del servidor (proveedor, banco, cuenta, nombres) y la propia clave. Solo se guarda el hash.

## 3. Exportaciones

Sin cambios en el PDF (ya cumple). Excel: `texto()` calcula la altura con `lineasEstimadas` (respeta `\n`) y, si el texto no cabe
en una fila (> 25 líneas estimadas), lo continúa en filas siguientes con `dividirTextoEnBloques` (nada se recorta). Los textos
cortos conservan los 18 pt de siempre. Totales, columnas y estilos no cambian.

## 4. SQL (propuestas, **NO ejecutadas**)

- `sql/migrate-2026-10-compras-idempotencia-requerimientos.sql` — `ADD COLUMN IF NOT EXISTS` ×2 y `ADD UNIQUE INDEX IF NOT EXISTS
  uq_compras_req_empresa_clave (empresa_id, clave_idempotencia)`; aditiva, idempotente, sin UPDATE/DELETE/DROP; esquema explícito
  `u611730801_Plataforma`.
- `sql/preflight-2026-10-compras-idempotencia-requerimientos.sql` — solo lectura; compuerta `LISTO PARA MIGRAR`.
- `sql/verificar-2026-10-compras-idempotencia-requerimientos.sql` — solo lectura; estructura, índice, 0 históricos con clave,
  ninguna clave sin huella, ninguna pareja repetida.
- `sql/diagnostico-2026-10-posibles-duplicados-compras.sql` — solo lectura; candidatos a doble envío por empresa y ventana de
  tiempo (nunca por total o proveedor solos).

## 5. Pruebas

Unitarias en la suite: esquema/clave, huella, búsqueda, creación idempotente (misma clave → una creación; contenido distinto →
409; clave distinta → dos; concurrencia; aislamiento por empresa; modo legado; reintento con facturas; re-lectura tras el lock con
`ROLLBACK`; otros duplicados no se confunden), API, exportaciones (observaciones por línea y generales, saltos de línea, textos
de 10 000 caracteres), cableado y **comportamiento** del formulario (doble envío en el mismo tick, respuesta perdida, 5xx,
bloqueo tras éxito, formulario nuevo = otra clave, 409). Verificación contra MariaDB 10.4 local desechable, omitida por defecto
(`IDEMPOTENCIA_DB_PORT`): `requerimiento-idempotencia-creacion.db.test.ts`.

## 6. Orden de despliegue sugerido

1. Revisar y aprobar el PR.
2. Preflight (solo lectura) → migración (con autorización) → verificación posterior (solo lectura). El orden respecto del código
   no es crítico (el código tolera la ausencia de las columnas), pero la protección solo existe cuando ambas cosas están aplicadas.
3. Desplegar el código.
4. En una PR posterior (cuando Fondos, Gastos y Compras tengan el frontend nuevo desplegado), volver obligatoria la clave.

## 7. Qué NO resuelve

- Duplicados **históricos**: solo hay una consulta de revisión de solo lectura.
- La edición (`PATCH`) no usa clave: actúa sobre un id existente (control de versión propio de Compras).
- Subidas de documentos de línea repetidas por el usuario: son acciones distintas, fuera de esta idempotencia.
