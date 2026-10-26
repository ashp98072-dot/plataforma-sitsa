# Retiro específico del duplicado 603 — PR #522

Estado: **BLOQUEADO: retirado el SQL de eliminación; no ejecutado ni autorizado**.
No es una migración de esquema ni una herramienta general de limpieza.

## Evidencia y alcance

Datos confirmados por el solicitante, no consultados por el agente:

| Unidad | Empresa administradora | Situación |
|---|---|---|
| 1297, C-035BXR | KT, ID 1 | Camión real, propietario KT y usado por KT. Conservar íntegro. |
| 603, C-035BXR | FRESCOFRESH, ID 4 | Registro duplicado del mismo camión. Candidato a eliminación posterior. |

El 1297 tiene 13 referencias de `tms_solicitud_fondo_lineas` y una en
`tms_unidades`. El solicitante informó cero referencias del 603 y aclaró que el
inventario mostraba **15 filas de KEY_COLUMN_USAGE**, no necesariamente 15 FK.
Falta revisar el inventario físico completo: columnas, restricciones y reglas
deben contarse y verificarse por separado.

La revisión actual entrega documentación, lecturas preparadas y análisis offline.
Conserva el selector CB2 y el alta/edición de vehículos externos del PR.
No fusiona filas, reasocia referencias, transfiere propietario/empresa, concede
o revoca accesos ni elimina archivos o registros auxiliares.

## Dependencias auditadas en el repositorio

El esquema efectivo depende de las migraciones aplicadas. `sql/schema.sql` no es
un inventario exhaustivo de producción: hay tablas creadas en
`src/lib/flota/schema.ts` y relaciones agregadas por migraciones independientes.
Las siguientes categorías deben verificarse globalmente por ID, sin filtrar
solo por FRESCOFRESH; una referencia desde otra empresa también bloquea.

| Dependencia | Fuente principal | Riesgo / condición de retiro |
|---|---|---|
| Lecturas, servicios y viajes: `flota_lecturas`, `flota_servicios`, `flota_viajes` | `sql/schema.sql`, rutas Flota | FK con CASCADE según esquema; cero filas del 603, no borrar historial. |
| Evidencias de viajes/lecturas, adjuntos de servicios, paradas | `schema.ts`, rutas de viajes/servicios | Relaciones indirectas por viaje/lectura/servicio; si aparece padre del 603, detenerse, sin borrar sus hijos. |
| `tms_unidades.flota_vehiculo_id` → planes por `unidad_id` | `schema.sql`, `tms/edicion-rapida-guardar.ts`, `programacion-import.ts` | `unidad_id` es ID TMS, no ID Flota. El 603 no debe tener unidad vinculada; la unidad del 1297 y sus planes permanecen. |
| `tms_planes_viaje.tc_vehiculo_id`, `tms_cliente_rutas.unidad_recurrente_id` | `schema.sql`, `tms/tc-plan.ts`, `cliente-rutas.ts` | Posibles SET NULL al borrar: cualquier referencia del 603 bloquea. |
| Fondos, gastos, requerimientos de compra y viáticos | `schema.sql`, migraciones de vehículos compartidos | IDs y snapshots de placa; conservar las 13 filas del 1297 y cualquier histórico. No aplicar cascadas ni nulificar. |
| `ops_multas_revisiones`, `ops_multas` y documentos de multa | migración `operaciones-multas`, `multas/backend.ts` | Relación directa e indirecta, incluso anulados; todo historial del 603 bloquea. |
| `flota_vehiculo_acceso` | `flota/acceso.ts`, `schema.ts` | El bootstrap la declara sin FK. **Incluso un acceso que parezca sobrante bloquea**. No revocarlo automáticamente para poder borrar. |
| `flota_vehiculo_filtros` | `flota/filtros.ts`, `schema.ts` | Bootstrap sin FK; todo filtro del 603 bloquea. |
| `flota_vehiculo_documentos` | `flota/vehiculo-documentos.ts`, `schema.ts` | Bootstrap sin FK; incluyen notas sin archivo. Todo documento/nota del 603 bloquea. |
| Archivos de papelería | ruta `vehiculos/[id]/documentos`, `uploads.ts` | Prefijo `veh603-doc_...` bajo almacenamiento real de uploads, no necesariamente en el checkout. Revisar referencias y archivos huérfanos sin borrarlos. |
| `flota_combustible_cargas` | `schema.ts`, `combustible-staff.ts`, `combustible.ts` | Tabla legacy creada sin FK en bootstrap; revisar todos los estados, no solo aprobados o pendientes. |
| `flota_cb2_consumos` | migración PR2, `cb2/repository.ts`, `service.ts` | FK más índices lógicos; toda referencia al 603 bloquea, sin cambiar consumo/factura/importación. |
| `flota_cb2_filas.decision` | `cb2/service.ts` | JSON incluye `vehiculoId` y `asignacion.vehiculoId`; puede persistir aunque ya no haya consumo ligado al 603. |
| `flota_cb2_asignaciones.anterior/nuevo` | `cb2/asignaciones.ts`, migración PR514 | JSON con `vehiculo_id` anterior y `vehiculoId` nuevo: un consumo pudo corregirse posteriormente. No reescribir esta evidencia. |
| `auditoria.detalle` | `auditoria.ts`, `edicion-vehiculo.ts`, `propiedad.ts`, CB2 | Texto y JSON con vehículo, antes/después o decisiones. Sin FK. Un candidato previo al 603 exige detenerse y revisión explícita. No borrar auditoría. |
| Snapshots de liquidación/eventos y Contabilidad | `tms/liquidacion-viaje-snapshot.ts`, `schema.sql` | JSON/texto conservan unidades/placas; no reinterpretar IDs TMS como Flota, ni reescribir snapshots por compartir placa. |
| Propiedad y tipo de unidad | `propiedad.ts`, `tipo-unidad.ts` | No cambiar `empresa_id`, propietario, revisión documental ni tipo del 1297 o del 603 antes de retirarlo. |

No se considera `flota_permisos_externos` un acceso a vehículos: representa
autorizaciones de pilotos y se enlaza al viaje. Si hay viaje del 603, bloquear.
`vehiculo_solicitado_perfil_id` pertenece al catálogo de perfiles de costeo, no a
Flota. El barrido conservador puede señalarlo si vale 603: requiere análisis,
nunca reasignación automática de perfiles ni de otros módulos.

### Consultas por placa y kilometraje

- `flota/pilotos.ts:vehiculoPorPlaca` usa coincidencia exacta con `LIMIT 1` y
  alternativas parciales, sin filtrar siempre por activo. Una baja lógica no
  garantiza que el 603 desaparezca de todas las resoluciones por placa.
- `flota/km-vehiculo.ts:actualizarKmActualVehiculo` propaga el máximo a duplicados
  del grupo de acceso por placa. `sincronizarKmVehiculosDesdeHistorial` también
  hace un JOIN por placa y no exige actividad de la fila destino. Una lectura
  funcional puede provocar escrituras de kilometraje: durante la operación deben
  estar detenidos la aplicación, jobs, workers y cualquier otro escritor, no solo
  el formulario de vehículos.
- CB2 y su catálogo usan la regla central de accesibilidad. Los cambios previos
  distinguen IDs de placa repetida; no eligen el 1297 por similitud ni reasocian el
  603. Fondos/TMS materializan unidades y snapshots de placa, que deben permanecer.
- C2C y reportes muestran placas por JOIN histórico y/o snapshots; una matrícula
  compartida por sí sola no autoriza modificar ninguna evidencia de otra empresa.

### Por qué no usar el DELETE HTTP actual

`src/app/api/empresas/[slug]/flota/vehiculos/route.ts:DELETE` elimina evidencias,
viajes, lecturas, servicios, filtros y accesos antes de borrar la unidad. Tiene
protecciones específicas de viajes/multas, pero no certifica este inventario
completo. No se invoca ni se cambia como parte de este retiro. La baja lógica
también altera taller/motivo y no sustituye esta operación específica.

## Estado actual y revisión técnica

El bloque DML anterior fue retirado. No usar sus copias de commits anteriores.

Ver [FLOTA-RETIRO-603-REVISION-TECNICA.md](./FLOTA-RETIRO-603-REVISION-TECNICA.md)
para las cuatro correcciones, tratamiento de históricos, manifiesto FK v2,
bloqueos MariaDB y condiciones de una futura implementación.

No se entrega SQL de eliminación ejecutable. Solo quedan el preflight y el
postcheck de lectura preparados, sin ejecutar; el paso 02 es un diseño no ejecutable.
