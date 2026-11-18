# Consolidación de vehículos duplicados por placa — informe de impacto y diseño de migración

**Estado: DISCOVERY + DISEÑO PARA REVISIÓN. No se ejecutó ningún cambio de datos, esquema ni IDs, ni se tocó Hostinger.**
Rama `docs/flota-vehiculos-duplicados-discovery`, desde `main` en `ab5cd45d` (incluye #640 Canecas y #641; Canecas no se toca).
Caso motivador: vehículos **ID 2** y **ID 3** con placa «558 BSJ»; se desea una identidad canónica (p. ej. «ID 6»).

## 1. Conclusión ejecutiva
1. **Ya existe en el repositorio un mecanismo de consolidación por alias** (`flota_vehiculos_fusiones`, `fusionarVehiculos`, `resolverUnidadCanonica`, `catalogoSinAlias`, guardas por trigger). Conserva **todos los IDs históricos**, desactiva el origen y redirige nuevas selecciones al destino. No reasigna referencias (`historicosReasignados: 0`). Su estado en producción **no está confirmado** (el flag `FLOTA_FUSIONES_APROBADAS` y la migración deben verificarse con la consulta 8 del discovery).
2. **No se debe cambiar ni renumerar IDs.** Hay referencias SIN clave foránea (`tms_planes_viaje.tc_vehiculo_id`, `tms_unidades.flota_vehiculo_id`, `tms_cliente_rutas.unidad_recurrente_id`, snapshots JSON de CB2) que ningún motor protege, y FK con `ON DELETE CASCADE` (`flota_viajes`, `flota_lecturas`, `flota_servicios`) que **borrarían historia** si se eliminara un vehículo. Regla: nunca `DELETE` de un vehículo; solo desactivar + alias.
3. **El «ID 6» no puede asumirse libre ni crearse como «destino» arbitrario**: el destino de una fusión es un vehículo existente (FK `destino_id → flota_vehiculos.id`). Si el ID 6 ya existe (posiblemente de otra empresa) no se sobrescribe. **Recomendación: canónico = uno de los IDs existentes (2 o 3) elegido por criterios objetivos (sección 6)**, no un ID nuevo. Crear un tercer registro «6» pierde auditoría y no aporta nada que el alias no dé.
4. Los duplicados por formato («558 BSJ» / «558BSJ» / «558-BSJ») existen porque el índice único real es **textual** (`UNIQUE (empresa_id, placa)`); la aplicación sí normaliza al crear/editar (`exigirPlacaLibreTx` + `placaComparable`), así que los duplicados actuales provienen de datos previos, importaciones o ediciones directas. La base **no** impide nuevos duplicados por formato si algo escribe sin pasar por la aplicación.
5. Antes de cualquier migración: ejecutar el **discovery de solo lectura** (`sql/discovery-2026-11-flota-vehiculos-duplicados.sql`, probado en MariaDB 11.8.9 desechable) y revisar sus resultados con el propietario.

## 2. Discovery realizado

### 2.1 Tabla principal
`flota_vehiculos`: PK real `id INT AUTO_INCREMENT`; `UNIQUE (empresa_id, placa)` (exacto, sin normalizar); `UNIQUE (empresa_id, id)` (destino de FK compuestas, p. ej. `tms_gastos_operativos`). Atributos relevantes que pueden diferir entre duplicados: `tipo_unidad`, `marca`, `modelo`, `chasis`, `capacidad`, `km_actual/km_ultimo_servicio`, `en_taller`, `estado`, `activo`, `tipo_propiedad`/`empresa_propietaria_id`/`propietario_externo`, seguros/NIT/crédito. Las columnas de propiedad se agregaron por migración; confirmar con la consulta 2.

### 2.2 Referencias a vehículos (inventario estático del repositorio — cota inferior)
Con FK declarada a `flota_vehiculos(id)`:

| Tabla | Columna | Regla FK | Observación |
|---|---|---|---|
| `flota_cb2_consumos` | `vehiculo_id` (NULL si unidad externa) | RESTRICT | historia de combustible; hay snapshot en `flota_cb2_filas.decision` y `flota_cb2_asignaciones.anterior/nuevo` (JSON) |
| `flota_viajes` | `vehiculo_id` | **CASCADE** | borrar el vehículo borraría viajes |
| `flota_lecturas`, `flota_servicios` | `vehiculo_id` | **CASCADE** | lecturas de km y servicios |
| `tms_gastos_operativos` | `vehiculo_id` | RESTRICT (FK compuesta con `empresa_id`) | |
| `tms_solicitud_fondo_lineas` | `vehiculo_id` | RESTRICT | solicitudes de fondos |
| `tms_viatico_requerimiento_lineas` | `vehiculo_id` | SET NULL | pierde la referencia si se borra |
| `compras_requerimiento_lineas` | `vehiculo_id` | RESTRICT | |
| `ops_multas_revisiones` (y `ops_multas`, sin FK) | `vehiculo_id` | RESTRICT | |
| `flota_identidad_miembros` | `vehiculo_id` | RESTRICT | identidad física global |
| `flota_vehiculos_fusiones` | `origen_id`, `destino_id` | RESTRICT | aliases |

**Sin FK (no protegidas por el motor):** `tms_planes_viaje.tc_vehiculo_id` y `.unidad_id` (→ `tms_unidades`), `tms_unidades.flota_vehiculo_id`, `tms_cliente_rutas.unidad_recurrente_id`, `tms_planes_viaje.vehiculo_solicitado_perfil_id`, además de `flota_vehiculo_acceso` (accesos compartidos entre empresas), `flota_combustible_cargas`, mantenimientos/multas/documentos que el código reconoce como fuentes históricas aunque no estén en las migraciones del repositorio (deriva de esquema). **El inventario definitivo es el dinámico** (consultas 4 y 5 del discovery, igual que `referencias()` en `vehiculos-duplicados.ts`).

### 2.3 Código de aplicación
85 archivos no-test de `src/` consultan columnas de vehículo (22 en `src/lib/tms`, 18 en `src/lib/flota`, 7 en `src/lib/flota/cb2`, 6 en `src/lib/compras`, rutas API de flota/TMS/portal, programación). Módulos que **ya** resuelven alias/canónico: `acceso.ts`, `cb2/repository.ts`, `combustible-staff.ts`, `unidad-canonica.ts`, `vehiculos-alias.ts`, `operaciones/disponibilidad.ts`, `tms/catalogos`, `tms/planes`, `tms/programacion-import/lote`, `tms/edicion-rapida-guardar`, `combustible-fondos`. **Brecha a verificar** antes de fusionar: selectores de otros módulos (compras, multas, servicios/lecturas, portal del piloto, reportes) que lean `flota_vehiculos` sin pasar por `catalogoSinAlias`.

### 2.4 Triggers, vistas, procedimientos
La migración de fusiones instala triggers: `flota_fusion_identidad` (misma empresa, sin cadenas), `flota_fusion_inmutable`, `flota_fusion_no_borrar`, `flota_fusion_no_reactivar` y, por cada columna de vehículo, `ffi_*` (BEFORE INSERT) y `ffu_*` (BEFORE UPDATE) que **impiden asociar NUEVAS filas a un vehículo fusionado (origen)**; un UPDATE que conserva el mismo ID sigue permitido, y **reasignar una fila al destino también** (el valor nuevo no es origen). Vistas/rutinas: la consulta 7 las lista en producción (el repositorio no versiona vistas de vehículos).

### 2.5 Reglas del mecanismo existente (`fusionarVehiculos`)
Exige: flag `FLOTA_FUSIONES_APROBADAS=1`; actor Admin activo; ambos vehículos de la **misma empresa**, activos y fuera de taller; `placaComparable` igual; mismo `tipo_unidad`; **chasis válido e igual**; revisión por hash del registro (detecta cambios concurrentes); **sin referencias operativas fuera de la lista histórica** (`flota_cb2_*`, `flota_combustible_cargas`, `flota_vehiculo_acceso`, `flota_viajes`, `tms_planes_viaje`); sin viajes abiertos ni reservas vigentes; sin cadenas/ciclos. Resultado: fila inmutable en `flota_vehiculos_fusiones` (con snapshots JSON de ambos), origen `activo=0, estado='Inactivo'`, auditoría `fusion_alias_vehiculo`.

## 3. Respuestas a las preguntas del discovery

| Pregunta | Hallazgo |
|---|---|
| Unicidad actual de placas por empresa | Solo textual (`uq_flota_placa`); la aplicación valida la placa **comparable** en alta/edición y contra unidades compartidas vigentes. Duplicados por formato posibles por datos previos. |
| Datos distintos entre duplicados | No se puede saber sin ejecutar la consulta 2/9 en producción. El mecanismo existente **bloquea** si difieren tipo o chasis; km/estado/taller/propiedad requieren decisión humana. |
| Operaciones históricas cuyo significado cambiaría | Viajes, consumos CB2 (snapshots con el ID original), solicitudes de fondos y planes TMS guardan el **ID vigente al momento**; reasignarlos reescribe esa historia y sus auditorías. Por eso la propuesta no lo hace por defecto. |
| Multiempresa | `flota_vehiculos` es por empresa; hay accesos compartidos (`flota_vehiculo_acceso`) e **identidad física global**. Una placa igual en otra empresa **no** es duplicado (probado: el discovery no la agrupa). La fusión exige `empresa_id` idéntico por trigger. |
| ¿ID 6 disponible? | Se verifica con la consulta 3 (ocupado/AUTO_INCREMENT/máximo). **No se asume.** |

## 4. Propuesta (por fases, cada una requiere aprobación independiente)

**Fase 0 — Discovery en producción (solo lectura).** Ejecutar `sql/discovery-2026-11-flota-vehiculos-duplicados.sql` con `@ids='2,3,6'` y guardar resultados. Entregables: grupos duplicados reales, diferencias de atributos, referencias por ID, claves únicas con vehículo, triggers/vistas, accesos compartidos y fusiones existentes.

**Fase 1 — Elegir el canónico (por criterio, no por número).** Orden recomendado: (1) el que tenga **más historia** (referencias) y esté activo; (2) chasis/datos de ficha más completos; (3) el de menor ID. Si un duplicado es de una **empresa distinta** o tiene `tipo_unidad`/chasis diferente, **no es el mismo vehículo**: no se consolida. El «ID 6» solo sería candidato si ya es un registro válido de la misma empresa que cumple lo anterior; si es de otra empresa, queda descartado explícitamente.

**Fase 2 — Alias (sin mover historia).** Reutilizar `fusionarVehiculos` tras: confirmar migración + guardas instaladas (postcheck), resolver viajes abiertos/reservas, y **ampliar la lista `historicas`** únicamente tras revisar cada tabla adicional que aparezca en el discovery. Resultado: origen inactivo con alias inmutable; nuevas selecciones, búsquedas, planes, viajes y solicitudes ven el canónico (`resolverUnidadCanonica`/`catalogoSinAlias`); lecturas históricas siguen mostrando el ID original con el canónico resuelto. **Trazabilidad:** snapshots + auditoría con ID anterior y nuevo.

**Fase 3 — (opcional, solo si el negocio lo exige) reasignar referencias operativas.** Candidatas: filas **abiertas o futuras** (planes programados, solicitudes pendientes, viajes abiertos) ya cerradas o decididas una a una; **nunca** consumos CB2, viajes cerrados, gastos pagados ni auditorías. Procedimiento: tabla-diario `flota_vehiculos_reasignaciones(tabla, pk, columna, id_anterior, id_nuevo, ejecutado_por, ejecutado_en)` creada **antes**; validar con las claves únicas de la consulta 6 (p. ej. un `UNIQUE (empresa_id, vehiculo_id, …)` chocaría al unir dos IDs); `UPDATE` por tabla y por lotes en transacción, con conteos antes/después; nunca `DELETE`. Las guardas permiten el UPDATE hacia el destino.

**Fase 4 — Evitar duplicados futuros.** (a) La validación de aplicación ya existe; (b) endurecer en base de datos tras limpiar datos: columna generada `placa_norm` (mayúsculas, sin espacios ni guiones) con `UNIQUE (empresa_id, placa_norm)` para impedir formatos distintos de la misma placa; requiere migración revisada y que la Fase 2 haya dejado un solo activo por placa (los alias inactivos necesitan excepción o estado que los excluya, p. ej. columna `placa_norm` NULL cuando `activo=0`); (c) alerta periódica con la consulta 1.

## 5. Conflictos y riesgos identificados
- **CASCADE**: `flota_viajes/lecturas/servicios` borrarían historia si se elimina el vehículo → prohibido borrar.
- **Referencias sin FK** (planes TMS, `tms_unidades`, rutas recurrentes, snapshots JSON): una reasignación incompleta deja huérfanos sin que la base lo detecte; por eso el inventario dinámico es obligatorio.
- **Claves únicas con vehículo** pueden colisionar al unir IDs (consulta 6; en el laboratorio sintético `(empresa_id, vehiculo_id, vale)` choca al mover 3→2).
- **Flag/guardas**: si `FLOTA_FUSIONES_APROBADAS` o la migración no están activas, no hay mecanismo operativo en producción.
- **Accesos compartidos e identidad física**: un duplicado con `flota_vehiculo_acceso` hacia otra empresa debe resolverse con la identidad física, no con una fusión local.
- **Datos que difieren** (km, taller, propiedad, seguros): hay que decidir qué ficha prevalece; el alias no copia datos al canónico.
- **Reversibilidad**: la fusión es inmutable por trigger. Estrategia de recuperación documentada (a ejecutar solo con autorización): respaldo previo; en la Fase 2 el «deshacer» es excepcional y manual (romper-vidrio: bajo mantenimiento, deshabilitar los 3 triggers de la tabla `flota_vehiculos_fusiones`, borrar la fila de alias y reactivar el origen con los datos del `origen_snapshot`, auditar y reinstalar los triggers). En la Fase 3 el **diario de reasignaciones** permite revertir exactamente (`UPDATE … SET columna = id_anterior WHERE pk = …`).

## 6. Pruebas
Entregadas en este PR (solo lectura): `src/lib/flota/vehiculos-duplicados-discovery.db.test.ts` — MariaDB 11.8.9 desechable, **6/6**: duplicados por empresa («558 BSJ» y «558BSJ» juntos; misma placa en otra empresa **no** se mezcla), ID 6 **ocupado** por otra empresa y no asumido libre, inventario de FK con reglas CASCADE/RESTRICT y referencias sin FK, conteos por tabla/ID, claves únicas con vehículo, accesos compartidos, fusión ausente/instalada, parámetro `@esquema` explícito, archivo sin sentencias de escritura.
Cobertura **ya existente** del mecanismo: `vehiculos-fusion-private.db.test.ts`, `vehiculos-duplicados*.test.ts`, `unidad-canonica` (conserva viajes, combustible y asignaciones; bloquea alias nuevos, eliminación y repetición).
**Pendiente para la implementación (tras aprobar este diseño):** referencias cruzadas plan/viaje/solicitud con el canónico, conflicto de datos entre duplicados, idempotencia y concurrencia de la Fase 3, diario de reasignaciones y reversión, y `placa_norm` única (Fase 4).

## 7. Decisiones que necesito del propietario
1. ¿El «ID 6» es un vehículo real de la misma empresa o un identificador deseado? (Recomendación: canónico entre los existentes, sin crear un ID nuevo.)
2. ¿Se activa/verifica `FLOTA_FUSIONES_APROBADAS` y la migración de fusiones en producción? (No se tocó.)
3. ¿Se necesita la Fase 3 (reasignar referencias abiertas) o basta el alias?
4. ¿Se aprueba la restricción por placa normalizada (Fase 4) tras la limpieza?
5. Resultados de la Fase 0 para fijar el canónico con datos reales.

*No hubo merge, despliegue, migración ni SQL productivo.*
