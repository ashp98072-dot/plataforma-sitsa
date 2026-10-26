# Retiro específico del duplicado 603 — PR #522

Estado: **preparado para revisión; no ejecutado ni autorizado para producción**.
No es una migración de esquema ni una herramienta general de limpieza.

## Evidencia y alcance

Datos confirmados por el solicitante, no consultados por el agente:

| Unidad | Empresa administradora | Situación |
|---|---|---|
| 1297, C-035BXR | KT, ID 1 | Camión real, propietario KT y usado por KT. Conservar íntegro. |
| 603, C-035BXR | FRESCOFRESH, ID 4 | Registro duplicado del mismo camión. Candidato a eliminación posterior. |

El 1297 tiene 13 referencias de `tms_solicitud_fondo_lineas` y una en
`tms_unidades`. El 603 tiene cero referencias en las 15 FK revisadas por el
solicitante. Falta recibir/revisar el inventario físico completo con nombres,
columnas y reglas: el número 15, por sí solo, no certifica el esquema.

Este cambio agrega solo documentación, SQL pendiente y pruebas estáticas.
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

## Archivos SQL separados y procedimiento manual

1. `sql/retiro-603-01-preflight.sql`: solo SELECT/SHOW. Exportar filas completas
   603/1297, las 13 líneas y la unidad TMS, con sus PK y todas sus columnas.
   Revisar cuenta/base/versión/motores, FK y reglas, columnas sin FK, triggers,
   eventos, vistas y rutinas. Definición oculta, metadata incompleta o error = STOP.
   El DBA debe acreditar visibilidad completa; un catálogo filtrado por permisos
   no certifica ausencia de tablas o relaciones.
2. El preflight **genera** consultas de conteo sin ejecutarlas. Revisar y ejecutar
   manualmente cada SELECT generado, globalmente para el ID 603. Inventariar
   también extensiones/integraciones fuera del repositorio y dependencias entre
   esquemas. Inspeccionar almacenamiento de uploads y prefijo `veh603-doc`, sin
   borrar nada. Revisar los 15 nombres de FK y conservar su huella SHA-256.
3. Cualquier referencia/candidato de texto, JSON, binario, archivo, acceso o
   filtro, incluso inesperado o ambiguo, **bloquea**. El barrido de token `603`
   es deliberadamente conservador: puede detectar otro ID o un importe 603.
   No es prueba de identidad; no se debe limpiar evidencia o añadir exclusiones
   ad hoc para hacerlo pasar. Si da positivo, detenerse y presentar otra revisión
   específica del plan con esa evidencia. No eliminar ni fusionar otros datos.
4. Aprobar por separado ventana sin escrituras/DDL, backup restaurable, resultados
   y herramienta de ejecución. Suspender aplicación/jobs/cron/integraciones; no
   cambiar permisos ni propietarios desde estos scripts. Los locks de las dos
   unidades no protegen inserciones sin FK: **la ventana es indispensable**.
5. Auditar `sql/retiro-603-02-eliminacion-pendiente.sql`. Está bloqueado con cuatro
   certificaciones FALSE y esquema/actor/huella NULL. Solo después de autorización,
   un operador completa una **copia revisada**, no arma la versión del repositorio.
   Usa sesión dedicada sin transacción previa y cliente MariaDB 11.8 que envíe el
   bloque completo, con delimitador `//` configurado externamente. No pegarlo en
   phpMyAdmin/Hostinger si el editor lo fragmenta por `;`. Si esa es la única
   herramienta disponible, STOP: falta acordar un ejecutor compatible, sin separar
   DELETE/INSERT/COMMIT en peticiones web distintas.
   El DELETE también exige variables locales del bloque y el ID de la auditoría
   recién insertada: extraerlo como sentencia independiente da error de resolución
   de variables. Esto es defensa adicional, no soporte para fragmentar el archivo.
6. El bloque revalida identidad exacta de ambos IDs/empresas/placa, conteos 13/1
   (todos KT), inventario mínimo, huella y 15 FK, motores, checks, triggers y
   eventos. Rechaza FK desde otro esquema o sin columna referenciada `id`. Repite
   el barrido de columnas/JSON/texto/binarios antes de escribir. No tiene bypass
   para referencias conocidas ni elimina relaciones auxiliares.
7. Captura snapshots JSON ordenados con **todas las columnas** del 1297, sus 13
   filas y TMS; conserva además el antes completo del 603. Registra un evento
   nuevo en la tabla de auditoría existente y ejecuta el único DELETE, acotado a
   `id=603 AND empresa_id=4 AND placa exacta`. Verifica `ROW_COUNT()=1` y compara
   hashes completos de los snapshots antes del único COMMIT. No crea rutinas,
   tablas, índices ni migraciones, y no deshabilita FK/CHECK.
8. Errores o advertencias hacen rollback de la transacción propia y propagan fallo;
   un rechazo previo a iniciarla no revierte una transacción ajena. No reintentar
   automáticamente. Una desconexión durante COMMIT deja resultado incierto: usar
   lectura independiente y auditoría para determinarlo, no ejecutar otra vez.
9. Ejecutar posteriormente `sql/retiro-603-03-postcheck.sql` (lectura) y comparar
   exportaciones completas/PK, no solo 13/1. Repetir inventario/conteos generados.
   El evento nuevo de retiro es la **única mención nueva esperada** del 603; debe
   conservarse. Verificar catálogo autorizado y selector: 603 ausente, 1297
   disponible para KT. Luego, y solo tras aprobación del postcheck, reabrir tráfico.
   Recargar catálogos/formularios y generar una nueva revisión de importación si
   había un preview CB2 abierto con el 603. El backend debe rechazar ese ID ya
   retirado; no modificar recibos, hashes o decisiones antiguas para reutilizarlo.

El barrido puede ser costoso en tablas grandes: la ventana y su duración deben
aprobarse después de evaluar tamaños. No se limita con LIMIT porque podría omitir
dependencias. Cero candidatos no demuestra ausencia de referencias cifradas,
comprimidas, codificadas o en servicios externos: requieren revisión humana aparte.

## Recuperación y condiciones pendientes para autorizar

Antes del COMMIT, cualquier condición fallida revierte el DELETE y su auditoría.
Después del COMMIT no hay recuperación automática: mantener tráfico detenido y
evaluar con DBA la restauración **exclusiva de la fila 603** desde el backup/antes
conservado, comprobando conflictos nuevos y dejando otro evento de auditoría. No
restaurar masivamente la base, no tocar el 1297, fondos, TMS ni borrar el evento.
No se entrega un INSERT de restauración automático porque el esquema y el estado
posterior requieren revisión; una restauración también necesita autorización.

Faltan para autorizar: resultados del preflight real; listado/huella de las 15 FK;
ausencia de dependencias no FK, JSON/auditoría y archivos; snapshots completos y
backup restaurable; confirmación de que las 13 líneas y TMS permanecen en KT;
inventario visible completo, ventana y ejecutor compatibles; auditoría técnica
del bloque SQL. Ninguna de estas verificaciones productivas fue ejecutada aquí.

## Validación y límites

Las pruebas de esta entrega son estáticas sobre los archivos SQL: aseguran límites
del DML, bloqueo por defecto, guards y presencia/orden de rollback, auditoría y
snapshot. No ejecutan SQL ni demuestran sintaxis/semántica de motor o del cliente
MariaDB. No se creó ni utilizó base de pruebas. El bloque permanece **pendiente
de revisión independiente**, sin permiso de ejecución, merge o deploy.

Resultados locales: ocho comprobaciones estáticas nuevas aprobadas; suite de
regresión del PR con `--maxWorkers=2`: **568 aprobadas, 20 omitidas**, 55 archivos
aprobados y uno omitido. TypeScript `tsc --noEmit --incremental false`, ESLint del
nuevo archivo de pruebas y `git diff --check` aprobados. No se modificó código de
aplicación: los ocho avisos preexistentes de ESLint del cliente general reportados
en la revisión anterior quedan fuera de estos cambios.

Referencias oficiales revisadas:
[bloques BEGIN/END y delimitadores](https://mariadb.com/docs/server/reference/sql-statements/programmatic-compound-statements/begin-end),
[handlers](https://mariadb.com/docs/server/reference/sql-statements/programmatic-compound-statements/declare-handler),
[transacciones](https://mariadb.com/docs/server/reference/sql-statements/transactions/start-transaction),
[PREPARE y variables de sesión](https://mariadb.com/docs/server/reference/sql-statements/prepared-statements/prepare-statement).
