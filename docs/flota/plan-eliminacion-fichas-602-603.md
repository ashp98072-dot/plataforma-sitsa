# Fichas #602 y #603 (Fresco Fresh): diagnóstico, plan de eliminación controlada y arquitectura

Estado: **PROPUESTA para aprobación**. Nada de lo descrito se ha ejecutado. No hay migraciones, no se desactivan claves foráneas, no se reasigna ningún registro y no se toca `empresa_id`.
Script de lectura: [`sql/diagnostico-2026-11-flota-602-603-eliminacion.sql`](../../sql/diagnostico-2026-11-flota-602-603-eliminacion.sql) (13 sentencias de solo lectura).

## 1. Qué impide eliminar y qué se perdería (según esquema y código)
Reproducido en una base **desechable de laboratorio con datos sintéticos** (no es producción):

| Tipo | Tablas | Efecto de eliminar la ficha |
|---|---|---|
| **Bloquean (RESTRICT)** | `tms_solicitud_fondo_lineas` (`fk_fondolin_vehiculo`), `tms_gastos_operativos`, `compras_requerimiento_lineas`, `flota_cb2_consumos`, `ops_multas_revisiones`, `flota_identidad_miembros`, `flota_vehiculos_fusiones` | Error #1451 y no se borra nada. Es exactamente el error de #602. |
| **Se borran en cascada** | `flota_lecturas`, `flota_servicios`, `flota_viajes` (con sus evidencias y adjuntos) | Se pierde el historial de km, mantenimiento y viajes. |
| **Quedan huérfanos (sin clave foránea)** | `flota_vehiculo_documentos`, `flota_combustible_cargas`, `flota_vehiculo_acceso`, filtros, JSON de `flota_cb2_asignaciones`, auditoría | Filas con un ID inexistente y **archivos en disco** sin dueño. La eliminación desde la aplicación borra explícitamente viajes, lecturas, servicios, filtros y accesos, pero **no** los documentos ni las cargas. |
| **Pierden el vínculo (SET NULL)** | `tms_unidades.flota_vehiculo_id`, `tms_viatico_requerimiento_lineas`, `tms_cliente_rutas` | La unidad TMS queda sin ficha de Flota. |

Reproducción en laboratorio: `DELETE FROM flota_vehiculos WHERE id=602` con líneas de fondo → `#1451 … tms_solicitud_fondo_lineas, CONSTRAINT fk_fondolin_vehiculo`; un `DELETE` de una ficha solo con lecturas, documento y acceso borró sus lecturas y dejó el documento y el acceso huérfanos (revertido con `ROLLBACK`).

## 2. Lo que hay que descubrir antes de decidir (el script lo responde)
- **¿Fueron realmente «erróneas y sin uso»?** Una línea de fondo que referencia #602 tiene `empresa_id` = la empresa que hizo la solicitud (Mónaco), con su fecha, importe y estado. Eso indica que alguien **usó** la ficha en una solicitud. La sección **D** muestra cada línea, su solicitud y su estado (Pendiente / Autorizada / Liquidada / Rechazada).
- **¿Son la misma unidad que #1296 / #1297?** Sección **B**: placa comparable, tipo y chasis. Sin chasis en ambas fichas **no se acredita identidad**; la placa por sí sola no basta.
- **¿Las fichas de Mónaco son las correctas?** Secciones **A–C**: la correcta debe concentrar la actividad real (viajes, lecturas, consumos) y tener datos completos.
- **¿Qué archivos se perderían?** Sección **F** (documentos, adjuntos y evidencias con su ruta).
- **Veredicto por ficha**: sección **G** (`bloqueos` frente a `se_perderia_*` y `quedaria_huerfano_*`).

## 3. Regla de decisión
- **Historia financiera** (solicitud Autorizada o Liquidada, o importe > 0): **no se elimina ni se reasigna** sin aprobación expresa de contabilidad. Una línea no es un dato «erróneo» solo porque la ficha lo sea: es parte del importe de la solicitud (`total`).
- **Eliminable legítimamente** solo si: `bloqueos = 0` **o** todos los bloqueos son filas confirmadas por escrito como erróneas/sin ejecutar y sin efecto contable; y `se_perderia_*` / `quedaria_huerfano_*` solo contienen datos de prueba confirmados.
- En cualquier otro caso → **Opción A** (abajo).

## 4. Opciones
**Opción A (recomendada, sin pérdida, reversible).** No se elimina: se da de **baja** (`activo = 0`, «Reactivar» lo revierte) la ficha equivocada, se conserva todo su historial y se vincula con la correcta mediante **identidad física** (requiere chasis real con documento y la aprobación de ambas empresas; M3). El catálogo y Combustibles muestran una sola unidad; las referencias históricas siguen apuntando a su ficha.

**Opción B (eliminación), solo con aprobación y si la regla 3 lo permite.** Procedimiento:
1. **Respaldo** (a cargo del propietario, antes de cualquier cambio): exportación completa de la base con suma SHA-256 y copia de los archivos de la sección F; además, exportación dirigida por tabla (`mysqldump --no-create-info --where="vehiculo_id IN (602,603)"`, y las filas de `flota_vehiculos` y `flota_vehiculo_acceso`), guardada con su hash.
2. **Preflight (solo lectura):** ejecutar el script; guardar la salida como **manifiesto** (IDs exactos y conteos por tabla) y firmarlo quien lo aprueba. Confirmar `viajes abiertos = 0`, sin planes TMS vigentes ni solicitudes pendientes.
3. **Vista previa exacta:** lista de filas que se borrarían, tabla por tabla, generada del manifiesto (nada «por placa»).
4. **Cambio controlado:** un script generado **del manifiesto aprobado**, en una sola transacción, con comprobaciones: cada `DELETE` se acota por ID del manifiesto, se compara el número de filas afectadas con el esperado y se aborta si difiere; orden: hijos explícitos → ficha; **sin** desactivar claves foráneas ni cambiar `empresa_id`; las solicitudes de fondo con líneas se resuelven por el flujo de la aplicación (rechazo/anulación con auditoría), no con `DELETE` manual. Confirmación manual (`COMMIT`/`ROLLBACK`) tras revisar los conteos. Un archivo SQL por ejecución, versionado en GitHub.
5. **Postcheck (solo lectura):** las fichas ya no existen; ningún hijo huérfano; #1296/#1297 con exactamente las mismas cantidades que antes; mismo número de claves foráneas en `information_schema`; el catálogo y Combustibles muestran una sola unidad por placa; pruebas de humo de Fondos y Combustibles.
6. **Recuperación:** restaurar la exportación dirigida (padres primero, con los IDs originales; sin desactivar claves foráneas), devolver los archivos y repetir el postcheck; si hay duda, restauración completa del respaldo.

## 5. Arquitectura propuesta (multiempresa, una unidad física, varias relaciones)
Tres conceptos separados, sin eliminar `empresa_id` ni el aislamiento:
- **Empresa propietaria:** titular de la unidad (ya existen `tipo_propiedad` y `empresa_propietaria_id`) y empresa que administra la ficha (`empresa_id`).
- **Empresa operadora autorizada:** hoy solo `flota_vehiculo_acceso` (uso sí/no). Propuesta: una tabla de **autorizaciones** con alcance (rutas, fondos, combustible, mantenimiento), vigencia y quién autorizó, con auditoría. Así Mónaco opera vehículos de Fresco Fresh **sin crear una ficha propia**.
- **Identidad física (M3, ya instalada):** vincula fichas existentes de varias empresas con aprobación de cada una; los catálogos muestran una sola unidad y los históricos conservan su ficha.
Camino incremental (cada paso con autorización): (1) diagnóstico y decisión por pareja; (2) identidad física para las fichas que deben coexistir; (3) guarda al compartir (#659) y vista previa (#654/#659) para no crear duplicados; (4) tabla de autorizaciones solo si hace falta distinguir alcances (migración con preflight, respaldo y rollback propios).

## 6. Lo que se necesita para continuar
Ejecutar el script en phpMyAdmin (solo lectura) y compartir **B, C, D1, D2, F y G**. Con eso se decide pareja por pareja entre la Opción A y la B.
