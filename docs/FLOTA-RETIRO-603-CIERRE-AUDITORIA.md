# PR #522 — cierre documental de auditoría y preflight adicional

Base revisada: `fd8fb2df3967a58274a7d9bf6d067efcd512647a`.
**Decisión propuesta: APTO PARA PREFLIGHT ADICIONAL**, limitado a recopilar y
revisar evidencia de lectura bajo autorización independiente. **No autoriza el
retiro, la revocación del acceso ni la ejecución de un cambio productivo.** El
retiro sigue bloqueado; no se prepara ni recupera un ejecutor destructivo.

Se conserva 1297/KT/empresa 1/C-035BXR, sus 13 referencias de fondos, su unidad
TMS y todos los históricos. Se mantiene 603/FRESCOFRESH/empresa 4 y el acceso
compartido `(603,1)` sin alterarlos. También se conservan las correcciones de
vehículos externos y selector CB2 del PR, sus permisos y flags.

## 1. Evidencia aportada frente al preflight existente

Todos los resultados productivos siguientes fueron comunicados por el
solicitante. El agente no accedió a producción ni ejecutó SQL. No se recibieron
exportaciones completas, huella v2, consultas exactas con su alcance/permisos,
fecha de corte ni versión desplegada: no se convierten los resultados dirigidos
en una certificación exhaustiva o permanente.

| Comprobación | Evidencia del solicitante | Cobertura de `sql/retiro-603-01-preflight.sql` | Conclusión / faltante |
|---|---|---|---|
| Inventario FK | 15 columnas, 13 restricciones | Dos conteos separados y exportación ordenada de metadata | Aclaración de conteos cubierta. Faltan nombres, posiciones, reglas, destinos y huella v2 revisada del manifiesto completo. No inferir un inventario a partir de los números. |
| Referencias directas al 603 | Cero en las relaciones revisadas | Genera SELECT de conteo por columnas y FK, sin filtrar por empresa | Evidencia dirigida cubierta para lo revisado. Falta cruzar cada consulta/resultado con el inventario completo y repetir al corte del futuro cambio. |
| `tms_cliente_rutas.unidad_recurrente_id` | Cero | Columna incluida expresamente aunque no tuviese FK | Cubierto de forma dirigida; conservar evidencia fechada y revalidar. |
| `flota_cb2_asignaciones` | Cero filas totales | Barrido de texto/JSON contempla la tabla, pero no devuelve por separado su cardinalidad total | Cierra la revisión dirigida de antes/nuevo en ese corte. Falta preservar resultado y vigilar nuevas correcciones; no dice nada sobre otras tablas CB2. |
| CB2, TMS, Contabilidad, FEL y auditoría | Cero coincidencias en búsquedas dirigidas | Genera candidatos de todas las columnas de texto/JSON/binarios visibles del ámbito definido | Parcial: faltan columnas/rutas concretas revisadas, codificaciones, contenido no visible y contraste con el barrido completo. Ninguna excepción histórica aprobada. |
| Triggers/rutinas que mencionan vehículos/accesos | Cero coincidencias visibles | Lista triggers, rutinas, vistas y eventos visibles, sin limitarse a esos literales | Parcial: faltan definiciones/permisos completos, eventos, vistas, SQL dinámico y procesos externos. Cero coincidencias de texto no prueba ausencia de escritores. |
| `flota_vehiculo_acceso` | Una fila exacta `(603,1)` | Su `vehiculo_id` entra en el barrido numérico, incluso sin FK | **Positivo operativo bloqueante para el retiro actual.** No es ruido histórico ni puede excluirse por tabla. |
| 1297, fondos y TMS | 13 referencias y una unidad | Exporta filas completas y ordenadas de ambos vehículos, fondos y TMS | Conteos dirigidos cubiertos; faltan PK, todas las columnas, empresas de cada registro y hashes/exportaciones completas para preservar contenidos, no solo cantidades. |
| Documentos, filtros y evidencias indirectas | No aportados separadamente | Inventario de columnas/generadores; no inspecciona archivos físicos | Pendiente, sin asumir que el conteo FK cubre tablas sin FK o archivos huérfanos. |
| Sesión, motores, esquema, backup, ventana, rollback y cliente MariaDB | No aportados | Consulta base/versión/configuración y motores de tablas con columnas identificadas; no certifica todos los motores ni valida una transacción | Pendiente. El script solo prepara lecturas: no abre conexiones por sí mismo, no ejecuta los SELECT generados y no certifica el motor/cliente. |

La exclusión de la propia fila 603 se mantiene exclusivamente para los conteos
de referencias externas en la tabla y esquema objetivo. La exportación inicial
sí incluye todos sus campos. Las demás filas de Flota, otros esquemas con FK y
las tablas de acceso/documentos/auditoría no se excluyen. El preflight no busca
dependencias sin FK en todos los sistemas externos ni interpreta sus semánticas;
esa limitación sigue siendo un bloqueo para declarar ausencia exhaustiva.

## 2. Revisión de dependencias no FK y escritores

| Área y fuentes revisadas | Hallazgo en la base revisada | Comprobación adicional necesaria |
|---|---|---|
| `flota/acceso.ts`, `combustible-staff.ts`, `cb2/repository.ts` | La regla es empresa administradora propia o acceso explícito. CB2 bloquea/revalida vehículo y acceso al confirmar. | Capturar el conjunto completo de accesos del 603 y 1297, estados y configuración desplegada. Una selección vieja no es autoridad para escribir y no debe reasociarse automáticamente. |
| `flota/pilotos.ts:vehiculoPorPlaca`, portal/viajes y Flota/viajes | La coincidencia exacta usa `LIMIT 1` sin orden determinista de preferencia ni filtro general de actividad. Puede resolver un duplicado accesible; el resultado no identifica por sí solo el camión canónico. | Revisar requests/importaciones abiertas que solo llevan placa o el ID 603. No usar esa resolución para decidir el retiro ni una baja como sustituto. |
| `flota/km-vehiculo.ts:actualizarKmActualVehiculo` | Escribe en el ID recibido y puede propagar el máximo a otra fila de igual placa vinculada por acceso. Se invoca desde salidas/llegadas del portal, Flota/viajes y POST de lecturas. | Inventariar y detener esos escritores en una futura ventana; exportar valores originales de ambos IDs, sin conciliarlos ni copiar kilometraje. |
| `sincronizarKmVehiculosDesdeHistorial` en el mismo archivo | Contiene UPDATE por ID y por placa, sin exigir actividad. No se encontraron invocaciones de esta función en `src` ni `scripts` de la base revisada, aparte de su definición. | No afirmar que corre automáticamente. Verificar artefacto desplegado, jobs e invocaciones externas; su existencia no prueba actividad ni su falta de callsite prueba inactividad en producción. |
| `api/.../flota/import/route.ts`, `guardarAccesoVehiculo` | El importador resuelve por placa y contempla el grupo KT/Mónaco/Frescofresh; puede crear/reconstruir accesos. El helper sustituye el conjunto de accesos del vehículo. | Revisar importaciones pendientes y su origen. No reutilizar estos caminos para retirar una sola tupla: podrían recrearla, reemplazar otras o actualizar campos de los vehículos. |
| `tms/unidad-flota.ts`, planes, `programacion-import.ts`, edición rápida | Se prioriza vínculo TMS cuando es accesible; hay fallback por placa y materialización de unidades. El importador usa mapas por placa. `unidad_id` es un ID TMS, no Flota. | Preservar la unidad ya vinculada al 1297 y sus planes. Revisar unidades legacy sin vínculo y borradores por placa; no rellenar, reasignar o materializar nuevas unidades durante el preflight. |
| `cb2/service.ts`, `cb2/asignaciones.ts`, `repository.ts` | Decisiones JSON y recibos/idempotencia pueden sobrevivir a una referencia actual; una tabla de correcciones vacía no prueba que no haya previews, eventos o decisiones en otras tablas. | Inventario completo de filas/operaciones y decisiones, importaciones en curso, recibos y usuarios con formularios abiertos. Conservar hashes, evidencia original y métodos de asignación. |
| `flota/vehiculo-documentos.ts`, rutas de documentos, `uploads.ts` | Hay notas sin archivo y uploads con prefijo `veh603-doc_...` bajo `UPLOAD_DIR` o raíz resuelta. Los archivos no tienen por qué estar en el repositorio. | Inventariar metadatos y almacenamiento real, también huérfanos, réplicas y raíces de despliegues previos. Registrar rutas, tamaño/hash y pertenencia sin mover/borrar archivos ni seguir enlaces fuera del almacenamiento autorizado. |
| `schema.ts`, GET de vehículos/documentos | `asegurarSchemaFlotaLectura` puede llamar al bootstrap de esquema. Un nombre de función o método HTTP de lectura no demuestra ausencia de DDL/efectos laterales. | El preflight adicional debe usar un medio revisado de lectura, no abrir endpoints indiscriminadamente. No ejecutar el bootstrap para “comprobar” nada. |
| Limpieza administrativa (`admin/limpiar-modulo.ts`), importaciones, sesiones y cachés | Existen otras operaciones que pueden borrar conjuntos de accesos/vehículos; formularios y previews pueden mantener IDs en memoria. | Excluir esas operaciones de cualquier ventana futura. Registrar trabajos y solicitudes en vuelo; recargar clientes tras un cambio autorizado sin alterar recibos ni forzar un ID nuevo. |
| Cron, workers, integraciones, eventos/rutinas externos | La revisión de fuentes no da acceso al scheduler de Hostinger, PM2, colas, credenciales de integraciones, tareas externas ni al código efectivamente desplegado. | Inventario con responsables, estado, horario y evidencia de suspensión/reanudación. Revisar definiciones visibles completas y SQL dinámico; no deducir cero procesos del resultado de búsquedas de texto. |

Los lectores históricos de otros módulos y las búsquedas por placa no se
reescriben en este ticket. Una placa igual no habilita modificar snapshots o
contabilidad. Si un lector depende de la existencia del padre para mantener
visible un histórico, el retiro físico queda bloqueado hasta un diseño aprobado.

## 3. Acceso `(603,1)`: significado, procedencia y tratamiento propuesto

Con la evidencia aportada y la regla de `acceso.ts`, KT puede acceder al 1297
por su `empresa_id=1` y al 603 de empresa 4 por la fila `(603,1)`. Si cumplen
los filtros de actividad del catálogo, ambos aparecen como opciones. Esto
explica la vía de exposición de los dos IDs en KT; no es un JOIN que multiplique
una sola fila. El selector corregido los distingue, pero no elimina la dependencia.
El permiso del usuario y el acceso al tenant siguen validándose por separado.

La tupla no cambia propietario, empresa administradora, histórico ni acceso de
usuarios a FRESCOFRESH. El código de importación y la edición del conjunto de
accesos son posibles vías de creación; **no se demostró que alguna originara esta
fila**. El bootstrap de la tabla solo declara los dos IDs, sin actor/fecha. Falta
su definición real, trazabilidad disponible e inventario completo de accesos.

La fila también satisface condiciones del propagador de kilometraje en ambas
direcciones: una escritura con origen 603 puede alcanzar 1297 y una del 1297
puede alcanzar 603. Esto es una posibilidad demostrada por el predicado, no una
afirmación de que haya ocurrido. No se corrigen valores pasados ni se calcula
un máximo “correcto” entre ambos camiones como parte de esta auditoría.

Tratamiento propuesto, **sin ejecutarlo ni habilitarlo**:

1. Conservar ahora la tupla y ambos vehículos. La regla anterior de cero referencias
   debe seguir informando este positivo, no añadirle una excepción de texto/JSON.
2. Solicitar una autorización futura que enumere expresamente dos objetos: la fila
   603/empresa 4 y la única tupla `(603,1)`. Su eventual retiro conjunto tendría que
   ser atómico, auditado, con snapshots/backup y exactamente las filas aprobadas.
   Esta propuesta no concede esa autorización ni prepara el ejecutor.
3. No borrar toda la tabla de accesos ni todos los accesos del vehículo; si aparece
   cualquier otra tupla o relación, detenerse y volver a revisión. No confiar en
   CASCADE: el esquema desplegado podría diferir del bootstrap sin FK.
4. No dejar un acceso huérfano después de borrar el vehículo. No copiarlo al 1297:
   KT ya accede a su propia unidad. No crear `(1297,4)` ni otro acceso a FRESCOFRESH.
5. Si no se autoriza explícitamente el tratamiento de la tupla, no se propone
   eliminar el 603. Revocar solo el acceso tampoco es un aislamiento completo:
   permanecerían el registro y posibles resoluciones/sincronizaciones por placa.

## 4. Por qué no usar el endpoint HTTP de eliminación

`api/empresas/[slug]/flota/vehiculos/route.ts:DELETE` exige pertenencia a la empresa
administradora: la visibilidad compartida desde KT no autoriza borrar el 603 de
FRESCOFRESH. Intentarlo en otro tenant no debe usarse como mecanismo de retiro.

En la rama de borrado físico hay controles para historial de multas y viaje
abierto, pero luego borra evidencias, adjuntos, viajes, lecturas, servicios,
filtros y **todos los accesos del vehículo**, antes de borrar el padre. No es un
control específico de las dos filas propuestas ni del inventario sin FK completo.
No protege mediante snapshots las 13 filas y TMS del 1297 ni conserva un antes
específico del acceso para este procedimiento. No se invoca ni se modifica.

El modo de baja tampoco aplica: cambia actividad/estado y campos de taller,
contraviene las restricciones actuales y no garantiza desaparición de resoluciones
por placa. Tampoco se usan limpiadores administrativos o importación para este fin.

## 5. Procedimiento por etapas, sin ejecutor

| Etapa | Resultado verificable exigido | Condición de parada |
|---|---|---|
| A. Preflight adicional de lectura, por operador y medio autorizados | Evidencia fechada, esquema/versión/SHA desplegado, cuenta y alcance; manifiesto FK completo 15/13 y huella v2; todos los accesos; filas completas 603/1297, fondos/TMS y candidatos sin FK; inventario de archivos y escritores | Metadata incompleta, diferencias frente a evidencia, otra referencia o archivo, otra tupla de acceso, búsqueda ambigua o lector que perdería históricos. No forzar resultados para coincidir. |
| B. Revisión independiente | Cada resultado vinculado a la consulta/archivo que lo produjo; positivos explicados; tratamiento de `(603,1)` aprobado expresamente; ninguna excepción histórica implícita | Un número agregado, cero coincidencias dirigidas o huella coincidente no bastan. Toda nueva excepción exige motivo y aprobación por registro/contenido. |
| C. Solicitar nueva autorización de diseño/validación | Backup y restauración documentados; sesiones, locks, snapshots no nulos y lecturas actuales diseñados; cliente/motor 11.8 exactos y plan de pruebas de fallo/concurrencia | No hay autorización para crear una base de pruebas o ejecutar SQL en este ticket. La validación de motor sigue pendiente; no se presenta DML como ejecutable. |
| D. Solo después, una autorización distinta para un cambio futuro | Alcance acotado a los dos objetos y responsables; ventana sin escritores/DDL verificada; plan revisado de auditoría y rollback; repetición del preflight al mismo corte | No iniciar con procesos en vuelo, preflight caducado, diferencias de filas/hashes, pérdida de conexión o condición no verificable. No se implementa este paso aquí. |
| E. Futuro postcheck independiente, antes de reabrir tráfico | Conservación byte/contenido/PK de 1297, sus 13 fondos, TMS y demás históricos/accesos; solo los objetos expresamente autorizados retirados; auditoría nueva íntegra y catálogos consistentes | Toda diferencia inesperada mantiene la ventana cerrada y pasa a evaluación de recuperación, sin reasociaciones automáticas. |

El preflight adicional no es un corte transaccional ni autorización de escritura:
si la aplicación sigue operando, hay que registrar sus tiempos y cambios y
revalidar antes de cualquier decisión posterior. No se modifica el SQL de lectura
existente ni se usa su postcheck para inferir que el retiro ya ocurrió.

## 6. Backup, archivos, concurrencia y reversibilidad pendiente

- Exportar todas las columnas/PK del 603, 1297, sus accesos, 13 líneas y unidad
  TMS, con manifiestos, integridad y referencias de archivos. Comparar contenido,
  no solo conteos. No cambiar el 1297 aunque el 603 tenga mayor kilometraje.
- Confirmar backup consistente, almacenamiento seguro, acceso del responsable,
  retención y un procedimiento de restauración ya verificable. No se prueba una
  restauración ni se crean bases aquí. Una copia no verificada no garantiza reversión.
- Ficheros adjuntos y archivos huérfanos bloquean hasta su revisión. No borrar ni
  trasladarlos; incluir copias, raíces anteriores, objetos externos y enlaces de
  integraciones en el inventario. Conservar auditoría y evidencia original.
- Locks sobre el padre o una revocación de acceso no congelan todos los escritores
  sin FK. La futura ventana debe cubrir API, importadores, portal, lecturas,
  sincronizadores y procesos externos. Comparar dos lecturas MVCC no prueba que
  no cambió otra sesión; proteger también las filas preservadas.
- Antes de un eventual commit, la reversión de los dos objetos y la auditoría
  nueva debe demostrarse en la misma transacción y con motores apropiados. No
  se afirma probado el rollback por inspeccionar handlers o tests estáticos.
- Después de un commit confirmado, restaurar sería otro cambio autorizado, no un
  rollback: detener escritores, comprobar que no surgieron conflictos/uso nuevo
  del ID y restaurar solo los snapshots aprobados, incluido el acceso si corresponde,
  con nueva auditoría. No sobrescribir filas, restaurar toda la base, tocar 1297
  ni borrar el evento de retiro. Puede no ser técnicamente seguro; entonces STOP.
- Una desconexión alrededor del commit es resultado incierto: primero determinar
  por lectura independiente qué quedó persistido. No reintentar automáticamente.

## 7. Pruebas necesarias y criterios de nueva autorización

La evidencia de código y las pruebas offline previas no son pruebas de ejecución
MariaDB ni prueba de que producción no cambió. Se requieren, bajo otra autorización:

1. Contraste del manifiesto real con 15 columnas/13 restricciones, reglas,
   posiciones, destinos y definición efectiva de accesos; exportación íntegra.
2. Revisión de todas las referencias/candidatos, de los adjuntos y lectores por
   placa; identificación explícita de `(603,1)` como dependencia, no falso positivo.
3. Casos de nuevos accesos/referencias, datos cambiados, snapshots nulos/truncados,
   bloqueos/timeouts y escritores simultáneos; todos deben abortar sin cambios.
4. Fallos en cada etapa de una futura transacción, incluida auditoría, para demostrar
   rollback completo y conservación de 1297/fondos/TMS e históricos.
5. Parser, cliente, delimitadores, PREPARE/variables, handlers, sesiones, límites de
   JSON, aislamiento y commit/desconexión en el parche MariaDB 11.8 efectivo.
6. Validación de recuperación acotada y comprobación independiente de resultados;
   no usar SQL destructivo antiguo ni las rutas HTTP generales como sustituto.

La próxima solicitud de autorización debe adjuntar consultas/resultados fechados,
manifiesto/huella, revisión de cada positivo, inventario de archivos y procesos,
backup/recuperación, tratamiento firmado de la tupla y plan de validación del motor.
**15/13 y ceros dirigidos son progreso; `(603,1)` impide el retiro bajo la condición
actual de ausencia de dependencias.** Por eso la decisión se limita a preflight
adicional, sin cambiar datos, permisos, funciones, entorno ni estado del PR.

## 8. Validación de esta actualización documental

Se ejecutaron siete archivos de pruebas existentes: `retiro-603-sql`,
`acceso-vehiculo-edicion`, `vehiculos-compartidos-global`, `vehiculo-delete`,
`vehiculos-catalogo`, `propiedad` y `cb2/repository`: **96 pruebas aprobadas**.
Son pruebas puras, estáticas o con simulaciones; no ejecutan SQL ni certifican
MariaDB, el cliente de Hostinger o la ausencia de dependencias productivas.
`git diff --check` sin errores. Esta actualización modifica solo documentación;
no añade código, SQL, migraciones, excepciones al barrido ni habilita funciones.
No se ejecutaron SQL, conexiones productivas, bases de prueba, merge o deploy.
