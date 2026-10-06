# Vehículos compartidos en todos los módulos operativos

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (tsc, eslint, pruebas unitarias, build). **No probado en navegador ni contra base real.** La **migración SQL de Compras ya fue aplicada manualmente en producción el 2026-10-06** (ver §5); el archivo `sql/migrate-…` queda como registro de lo ejecutado. **Pendiente de decisión:** doble reserva de una misma unidad física en Programación (ver §6).

## 1. Regla única

Un vehículo es **accesible desde la empresa X** si `v.empresa_id = X` **o** existe una fila `(vehiculo_id, empresa_id = X)` en `flota_vehiculo_acceso`. Vive en un solo lugar, `src/lib/flota/acceso.ts`:

| Pieza | Para qué |
|---|---|
| `predicadoVehiculoAccesible(alias, empresaExpr)` | fragmento SQL (nadie lo reescribe: una prueba lo verifica) |
| `obtenerVehiculoAccesible` / `obtenerVehiculoAccesibleTx(conn, empresa, id, cols, bloquear?)` | validar un id que manda el cliente (fuera / dentro de transacción) |
| `listarVehiculosAccesibles` / **`listarVehiculosActivosAccesibles`** (nuevo) | catálogo seleccionable: propios + compartidos, **solo activos, sin duplicados**, con empresa dueña y `compartido` |

Dos contextos, dos reglas:
- **Altas / ediciones** (catálogo y validación): propio o compartido **ahora** con la empresa activa.
- **Lectura histórica** (placa en listados, reportes, PDFs de un registro que ya guardó su `vehiculo_id`): se une por `v.id = x.vehiculo_id`, acotado por la `empresa_id` del propio registro, **sin exigir la compartición actual**; si luego se retira el acceso, la placa no desaparece. Otro tenant: nunca (el registro siempre se filtra por su empresa; en altas se valida el acceso).

`obtenerVehiculoAccesibleTx` ya no enmascara errores de bloqueo/timeout: solo tolera la tabla de accesos ausente (errno 1146).

## 2. Matriz de discovery

Leyenda: ✅ ya correcto · 🔧 corregido en este PR · ➖ clase A (solo propietaria; no cambia) · ⏸ pendiente de decisión.

| Módulo | Ruta / UI | Endpoint / función | Consulta actual (antes) | Validación backend | FK | ¿Compartidos? | Resultado |
|---|---|---|---|---|---|---|---|
| Flota · Vehículos | `/flota` | `GET/PATCH /flota/vehiculos`, `listarVehiculosAccesibles` | propio OR compartido | `obtenerVehiculoAccesible` + #412 | — | sí | ✅ |
| Flota · Servicios, Lecturas | `/flota` | `/flota/servicios`, `/flota/lecturas` | `obtenerVehiculoAccesible` | idem | `flota_*.vehiculo_id` simple | sí | ✅ |
| Flota · Registrar viaje | portal/flota | `POST /flota/viajes`, `vehiculoPorPlaca` | predicado inline duplicado | acceso | simple | sí | ✅ → 🔧 refactor a la fuente única (sin cambio de comportamiento) |
| Flota · Reportes | `/flota` reportes | `GET /flota/reportes` | `flota_vehiculos WHERE empresa_id = ?` (solo propias) | — | — | sí (misma lista que Flota) | 🔧 |
| Flota · Combustible (conciliación de vales) | `/flota` | `listarCargasCombustibleParaConciliacion` | `INNER JOIN … AND v.empresa_id = c.empresa_id` (**perdía** cargas de unidades compartidas) | — | — | sí (histórico) | 🔧 JOIN por id |
| Flota · Export/Import Excel | `/flota` | `/flota/export`, `/flota/import` | `WHERE empresa_id = ?` | import solo propias | — | no: es el inventario propio (espejo del import) | ➖ |
| Disponibilidad de flota | Programación | `listarDisponibilidadVehiculos` | predicado inline duplicado | — | — | sí | ✅ → 🔧 refactor a la fuente única |
| Programación · Unidad / TC | `/e/[slug]/programacion` | `POST/PATCH /tms/planes`, `tc-plan.ts`, `resolverVehiculoDeUnidadTms` | disponibilidad accesible / `obtenerVehiculoAccesible` | acceso | `tms_unidades.flota_vehiculo_id`, `tms_planes_viaje.tc_vehiculo_id` simples | sí | ✅ |
| Programación · conflictos de calendario | idem | `disponibilidad-programacion-intervalos.ts` | por **empresa** (`p.empresa_id`) | — | — | ver §6 | ⏸ |
| Planes / Viajes (listado, reporte) | `/planes`, reportes | `tms/planes`, `reportes-viajes` | JOIN por id | — | — | sí (histórico) | ✅ |
| Rutas · unidad recurrente | `/rutas` | `GET /tms/catalogos` (`flotaVehiculos`), `validarUnidadRecurrenteTx`, `SELECT_RUTA` | `empresa_id = ?` (catálogo, validación y JOIN) | `WHERE id = ? AND empresa_id = ?` | `unidad_recurrente_id` simple | sí | 🔧 |
| Viáticos · requerimientos | `/viaticos` | `catalogosRequerimientoViatico`, `snapshotLinea` | `empresa_id=? AND activo=1` / `empresa_id=? AND id=?` | idem | `fk_vreql_vehiculo` simple | sí | 🔧 |
| Viáticos · reporte | reportes | `reportes-gastos` (unidad del plan) | `fv.empresa_id = p.empresa_id` | — | — | sí (histórico) | 🔧 JOIN por id |
| Gastos operativos / Solicitudes de fondo | `/gastos`, `/fondos` | #413 | accesibles | `obtenerVehiculoAccesibleTx` | simples (migradas en #413) | sí | ✅ (+ 🔧 JOIN histórico: #413 exigía acceso actual) |
| **Compras · Requerimientos** | `/compras/requerimientos/nuevo` | `catalogosCompra`, `guardarRequerimiento` | `empresa_id = ? AND activo = 1`; con comentario «no usar listarVehiculosAccesibles» | `empresa_id = ? AND id = ?` | **`fk_cb_requerimiento_lineas_vehiculo` COMPUESTA** | sí | 🔧 + **SQL** |
| Compras · detalle / PDF / Excel | idem | `obtenerRequerimiento`, exportaciones | `unidad_descripcion` (snapshot de la línea, sin JOIN) | — | — | sí (histórico) | ✅ conserva placa |
| Multas y sanciones | `/operaciones/multas` | `lib/multas/backend.ts` | `empresa_id = ?` + FK compuestas | `vehiculoPropio` | `fk_omr_vehiculo` y cadena compuesta | **no** | ➖ (ver §5) |
| Recordatorios RRHH (documentos de vehículo) | RRHH | `lib/rrhh/recordatorios.ts` | `v.empresa_id = d.empresa_id` | — | — | no: documentos de la propietaria | ➖ |
| Cotizaciones / Proveedores comerciales / Accesos proveedores / Facturación clientes / TMS | — | — | no seleccionan unidad de `flota_vehiculos` (cotizaciones usan *perfil* de vehículo, facturación opera sobre viajes) | — | — | n/a | ✅ sin cambios |
| Portal piloto, `edicion-rapida`, `vincular-viaje-plan`, `reportes-viajes` | — | — | JOIN por id | — | — | sí | ✅ |

## 3. Consultas y guards corregidos

- **Catálogos** (propios + compartidos activos, sin duplicados, con `compartido` y empresa dueña): Compras (`catalogosCompra`), Viáticos (`catalogosRequerimientoViatico`), Rutas (`GET /tms/catalogos` → `flotaVehiculos`), Gastos/Fondos (ahora vía el helper único), Flota/Reportes.
- **Guards** de escritura con `obtenerVehiculoAccesibleTx`: Compras (con `LOCK IN SHARE MODE`), Viáticos, Rutas. Mensajes de error sin cambios.
- **Edición de Compras:** una línea que **ya** referenciaba una unidad conserva su `vehiculo_id` y su snapshot aunque luego se retire la compartición; cambiar a una unidad no accesible sigue rechazándose.
- **JOIN históricos** (por id, antes exigían la misma empresa o la compartición actual): listado de Gastos, 2 reportes de Gastos, reporte de viáticos (unidad del plan), SELECT de Rutas, conciliación de combustible.
- **Refactor a la fuente única** (sin cambio de comportamiento): disponibilidad de flota, `vehiculoPorPlaca`, `POST /flota/viajes`. Una prueba verifica que ningún módulo reimplementa la condición inline.
- **UI:** «C-091BXF · Frescofresh · Compartido» en los selectores de Compras (`Unidad / placa`), Viáticos y Rutas (la placa sigue siendo lo principal; ya no hace falta «Unidad manual / sin unidad»). Fondos y Gastos ya lo tenían (#413).

## 4. Propiedad

En ningún módulo se escribe `flota_vehiculos` ni `flota_vehiculo_acceso` por seleccionar una unidad (pruebas lo verifican en Compras y Viáticos): no cambia `empresa_id`, no se amplía la compartición, no se elimina.

## 5. FK encontradas y SQL (aplicado manualmente en producción el 2026-10-06)

| Tabla · FK | Tipo | Clase | Acción |
|---|---|---|---|
| `compras_requerimiento_lineas` · `fk_cb_requerimiento_lineas_vehiculo (empresa_id, vehiculo_id) → flota_vehiculos(empresa_id, id)` | compuesta | **B** | **se reemplaza** por FK simple `fk_cb_requerimiento_lineas_veh (vehiculo_id) → flota_vehiculos(id)` + índice `idx_compras_req_linea_vehiculo_id` — **aplicado** |
| `ops_multas_revisiones` · `fk_omr_vehiculo` (y la cadena `ops_multas` → revisiones) | compuesta | **A** | **no se toca**: MULTAS-2 decidió explícitamente que la multa pertenece a la empresa propietaria («Compartir una unidad mediante `flota_vehiculo_acceso` NO comparte este historial»). Si negocio cambia esa decisión, requiere un ticket propio |
| `tms_gastos_operativos`, `tms_solicitud_fondo_lineas` | simple | B | ya migradas (#413) |
| `tms_unidades.flota_vehiculo_id`, `tms_planes_viaje.tc_vehiculo_id`, `tms_cliente_rutas.unidad_recurrente_id`, `tms_viatico_requerimiento_lineas.vehiculo_id`, `flota_*.vehiculo_id` | simple | B | ya aceptan compartidas |
| `sql/propuesta-2026-09-gastos-multiples-lineas.sql` (sin aplicar) | compuesta | B | si se implementa «múltiples líneas», debe usar FK simple |

Archivos: `sql/preflight-2026-10-vehiculos-compartidos-global.sql` (solo lectura: lista **todas** las FK hacia `flota_vehiculos`, huérfanos, líneas con unidad de otra empresa), `sql/migrate-2026-10-vehiculos-compartidos-global.sql` (registro de lo ejecutado: índice → FK nueva → se elimina la compuesta; DDL plano compatible con MariaDB, con verificación previa/posterior y rollback de referencia; **no volver a ejecutar sin verificar el estado**), `sql/schema.sql` actualizado.

**Trade-off:** la garantía «propio o compartido» deja de estar en la FK (que solo garantiza que el vehículo exista) y queda en la aplicación (`obtenerVehiculoAccesibleTx`); `RESTRICT` se conserva. Orden seguido: preflight → migración → deploy.

**Constancia de la ejecución en producción (2026-10-06, manual):**
- Preflight: **0 huérfanos** y **0 referencias cruzadas** entre empresas antes de migrar; FK compuesta antigua `fk_cb_requerimiento_lineas_vehiculo` confirmada.
- Migración aplicada manualmente (índice → FK simple → se elimina la compuesta). Las sentencias `ADD CONSTRAINT IF NOT EXISTS` / `DROP FOREIGN KEY IF EXISTS` del borrador inicial dieron problemas en MariaDB/Hostinger, por eso el archivo quedó con DDL plano.
- **Estado final verificado:** FK `fk_cb_requerimiento_lineas_veh`, columna `vehiculo_id` → `flota_vehiculos.id`; `fk_cb_requerimiento_lineas_vehiculo` ya **no** existe como foreign key; índice `idx_compras_req_linea_vehiculo_id` con `vehiculo_id` en `SEQ_IN_INDEX = 1`.
- `sql/schema.sql` refleja ese mismo estado (índice y FK con esos nombres; sin la FK compuesta antigua para esa relación).

## 6. Programación: una unidad compartida es la MISMA unidad física — hallazgo pendiente

Lo que **sí** es global por identidad física (`flota_vehiculos.id`): `listarDisponibilidadVehiculos` marca la unidad como ocupada si tiene un viaje **abierto** real (`flota_viajes`, por `vehiculo_id`), sin importar la empresa.

Lo que **no** es global: la reserva de calendario de Programación. Los conflictos de unidad/TC (`disponibilidad-programacion-intervalos.ts`, `disponibilidad-programacion-dia.ts`) buscan por **`tms_unidades.id` y `p.empresa_id`**; cada empresa tiene su propia fila en `tms_unidades` para la misma placa (con el mismo `flota_vehiculo_id`). Por tanto, si Frescofresh y Mónaco programan C-091BXF en el mismo horario, **ninguna ve la reserva de la otra**. Además la serialización usa un candado por empresa (`tms_traslape_<empresa>`).

**No se cambió en este PR** a propósito (CLAUDE.md §12: cambio de arquitectura/decisión de negocio), porque:
1. exige cambiar el motor de conflictos y su concurrencia (candado global por `flota_vehiculo_id`), una zona crítica con muchas pruebas;
2. un conflicto contra un plan de **otra** empresa revelaría su código de plan (fuga entre tenants) salvo que se enmascare («ocupada por otra empresa»);
3. «NO romper la lógica del PR de bloqueo por fecha ya existente».

**Propuesta (a autorizar):** en `unidad` y `tc`, considerar ocupadas las reservas de **cualquier** empresa con el mismo `flota_vehiculo_id` (solo si la unidad es accesible desde la empresa que programa), mensaje genérico para planes ajenos, y candado de traslape por `flota_vehiculo_id`. Se puede entregar como PR separado.

## 7. Pruebas

- `src/lib/flota/vehiculos-compartidos-global.test.ts` (31+): fixture estándar (A = Frescofresh, B = Mónaco; C-091BXF compartido; propio, no compartido, otro tenant, inactivo): catálogo (propio/compartido/no compartido/otro tenant/inactivo/sin duplicados), validación de id manipulado, parámetros `[empresa, id, empresa, empresa]`, `LOCK IN SHARE MODE`, errores de bloqueo no enmascarados, propiedad intacta, fuente única (sin condición duplicada), disponibilidad, `vehiculoPorPlaca`, JOIN históricos, Multas sin cambios, FK/SQL (idempotente, orden, preflight solo lectura).
- `src/lib/compras/requerimientos.test.ts` (+9): catálogo, guarda con la unidad compartida, rechazos (no compartida / otro tenant / manipulada / inactiva), propiedad intacta, edición histórica conserva la referencia, cambiar a no accesible se rechaza, detalle sin JOIN.
- `src/lib/tms/viaticos-requerimientos-vehiculos.test.ts` (6) y fixture `vehiculos-compartidos.fixture.ts`.
- Ajustadas aserciones de SQL en `gastos.test.ts`, `reportes-gastos.test.ts`, `viaticos-requerimientos-contract.test.ts`, `requerimientos.test.ts`.
