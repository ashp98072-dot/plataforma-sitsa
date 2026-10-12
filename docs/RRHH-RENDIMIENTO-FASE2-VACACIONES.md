# RRHH rendimiento Fase 2: índice persistente de frescura

Base: 9598e796545bebc54f2caf0f7be419000ec510db; Fase 1 / PR #439 mergeado.
El agente no ejecutó SQL ni consultó/modificó producción. El operador confirmó después
la migración aplicada y validada en MariaDB 11.8.9: tabla inicialmente vacía,
104 activos, 0 frescos, 104 pendientes, sin duplicados; GET_LOCK=1 / RELEASE_LOCK=1.

## Fuente de verdad y consumidores

El motor `sincronizarPeriodosVacacionesEnConexion` mantiene sus reglas, FIFO, fechas,
vencimiento, tope y defensas históricas. Sus lectores individuales y la resincronización
administrada siguen ejecutándolo aun estando fresh. Solo el batch automático selecciona
candidatos con el índice. No se cachean saldos finales.

Consumidores batch actuales: `src/app/api/empresas/[slug]/rrhh/vacaciones/alertas/route.ts`
y `src/app/api/empresas/[slug]/notificaciones/route.ts`. Ambos siguen llamando
`sincronizarVacacionesEmpleadosActivos`. VacacionesAlertasPanel y NotificacionesBell
conservan sus intervalos/UX; no hay cron ni Redis.

## Matriz de invalidación

Todas las rutas están relativas a la raíz. Los hooks usan la conexión de la mutación,
sin commit propio: rollback también revierte dirty y generación.

| Evento | Archivo/función | Fuente afectada | Invalidación |
|---|---|---|---|
| Alta | src/lib/rrhh/empleados.ts / crearEmpleado | empleados | upsert dirty del nuevo empleado |
| Fecha alta, estado/baja/reactivación, importación | empleados.ts / actualizarEmpleado; API empleados/import reutiliza helpers | empleados | compara fecha/estado anterior, dirty solo del empleado cambiado |
| Rebase de fecha alta | vacaciones-rebase-db.ts / reemplazarSerieEnConexion | saldos_vacaciones, detalle_consumo_vacaciones | dirty del empleado en la misma transacción |
| Día Guatemala/aniversario/vencimiento | vacaciones.ts / motor original | saldos_vacaciones | ultima_sync_fecha < hoyLocal(), sin escritura global diaria |
| Registro ordinario y aprobación | vacaciones.ts / registrarVacacionesFifoEnConexion; solicitudes-vacaciones.ts / aprobarSolicitud | incidencias, vacaciones, saldos, detalle | dirty dentro del helper FIFO común |
| Registro histórico | vacaciones-registro.ts / registrarVacaciones | mismas fuentes | dirty transaccional |
| Eliminación/restauración | vacaciones-eliminar.ts / eliminarRegistroVacaciones | incidencias, vacaciones, saldos, detalle | dirty después del flujo actual, antes del commit |
| Reparación individual/lote | vacaciones-reparacion-db.ts / repararSerieVacacionesEnConexion → reemplazarSerieEnConexion | saldos, detalle | hook común del reemplazo, únicamente empleados reparados |
| Política NORMAL/CARGA HISTÓRICA | vacaciones-modo-db.ts / cambiarModoCargaHistorica | configuracion | fingerprint cambia en cada lookup, no UPDATE masivo |
| Resincronización pedida por Admin | vacaciones-modo-resync-db.ts / resincronizarSaldosEmpresa | motor original | NO se filtra por fresh; no escribe certificado de frescura |
| Pendiente/rechazada | solicitudes-vacaciones.ts / crearSolicitudVacaciones, rechazarSolicitud | solicitudes_vacaciones | no invalidar por sí mismas: no consumen saldos |
| Incidencias sin saldo de tipo reconstruible | vacaciones.ts / registrarIncidenciaSinSaldo | incidencias | dirty solo Vacaciones / A cuenta de Vacaciones |
| Incidencia genérica/anexo con tipo libre | src/app/api/empresas/[slug]/rrhh/incidencias/route.ts y anexo/route.ts | incidencias | INSERT e invalidación de tipos reconstruibles en una transacción |
| Limpieza administrativa RRHH/vacaciones/incidencias | src/lib/admin/limpiar-modulo.ts / limpiarModuloEmpresa | saldos, detalle, incidencias, empleados | UPDATE de estados sobrevivientes dirty+generación; empleados borrados eliminan estado por FK CASCADE |
| SQL manual relevante | fuera de aplicación | cualquier fuente anterior | procedimiento manual debe invalidar explícitamente, no se detecta mágicamente |

Los previews/exportaciones históricas son solo lectura. La creación de solicitudes
puede invocar el motor durante su validación individual; se conserva ese comportamiento.
Feriados no cambian los saldos del motor (se usan al contar días del registro);
el consumo ya calculado/inmutable no se reinterpreta por editar un feriado.

## Tabla propuesta

`rrhh_vacaciones_sync_estado`: PK (empresa_id,id_empleado), ultima_sync_fecha DATE NULL,
dirty TINYINT DEFAULT 1, generacion BIGINT UNSIGNED DEFAULT 0,
politica_fingerprint VARCHAR(100) NULL, fecha_alta_sync DATE NULL,
actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP.
Sin nombres, salarios, documentos ni mensajes de error. La fecha base es un dato técnico
para detectar cambios en el input, no una copia de la ficha ni autoridad de antigüedad.

FK empresa → empresas.id y FK compuesta (empresa_id,id_empleado) → empleados(empresa_id,id).
Ambas ON DELETE CASCADE / ON UPDATE RESTRICT. CHECK dirty IN (0,1).
InnoDB, utf8mb4_uca1400_ai_ci. Verificar físicamente los tipos signed INT,
engine e índice padre UNIQUE(empresa_id,id) antes de aplicar.
El nombre del índice padre no importa.

Solo PK: cubre lookup individual y prefijo empresa. Con ~105 activos no se justifica
otro índice dirty/fecha para el predicado OR, ni índices nuevos en saldos (~350 filas).

## Algoritmo de claim y limpieza race-safe

1. Dos SELECT batch: política efectiva + LEFT JOIN de activos contra estado persistente.
   Elegible si falta fila/fecha, dirty, día anterior, fingerprint distinto o fecha alta distinta.
2. Loop SERIAL. Por candidato se obtiene conexión y GET_LOCK('rrhh-vac-sync:empresa:empleado',0).
   No hay lock de empresa ni Promise.all sobre empleados.
3. Contención devuelve false y deja estado pendiente; error/NULL del lock se propaga.
   INSERT IGNORE crea fila dirty en autocommit, antes de la transacción del empleado.
4. BEGIN; leer política y estado/fecha alta en el snapshot de esa conexión;
   revalidar frescura porque otro worker pudo terminar entre el batch y el claim.
   Capturar generación como CAST AS CHAR (sin pérdida de precisión BIGINT).
5. Ejecutar motor ORIGINAL en esa conexión/transacción.
6. UPDATE limpio WHERE empresa_id=? AND id_empleado=? AND generacion=versión_capturada.
   La comparación de InnoDB del UPDATE usa el estado actual, no la lectura antigua.
   Una invalidación confirmada durante el motor cambia versión: affectedRows=0 y dirty sobrevive.
   Si la mutación espera el CAS, después incrementa versión y escribe dirty=1.
   Dos invalidaciones consecutivas incrementan dos veces; rollback de mutación no invalida.
7. COMMIT del motor y certificado juntos. Error → ROLLBACK, no certifica frescura.
   RELEASE_LOCK en finally; si falla liberar, destruir conexión, no devolverla con lock al pool.
   El servidor libera el lock al cerrar la conexión si el proceso muere; fila queda dirty/stale.
   No hay lease con timeout que expire mientras todavía trabaja el primer worker.

El Map guarda solo Promises EN CURSO y se elimina en finally tanto con éxito como error.
Cada petición posterior vuelve a consultar estado/política.
Un resultado protegido CONGELADO/CONSUMO_NO_VERIFICABLE no significa reparación:
se certifica únicamente que el motor evaluó el input actual; ningún saldo se inventa,
las advertencias siguen disponibles en los flujos individuales/administrados.

## Fingerprint

`v1:${modo}:${maxPeriodosVigentes ?? "sin-limite"}:${Number(aplicarTope)}`.
Valores vienen del helper vigente, no se duplican reglas de política.
Incrementar v1 si una futura modificación del motor altera resultados.
El batch lee la configuración por empresa en cada llamada. Un cambio concurrente queda
visible en la próxima consulta: el certificado conserva el fingerprint y fecha base que
se leyeron en la transacción del motor, no la política nueva leída después del cálculo.

## Rollout y SQL manual

- Preflight SOLO SELECT/SHOW, esquema explícito u611730801_Plataforma, sin DATABASE()
  ni permisos sobre information_schema. Bloque A antes; bloque B SOLO si la tabla existe.
- Migración aditiva IF NOT EXISTS crea tabla vacía. No valida silenciosamente una tabla
  existente distinta: comparar SHOW CREATE TABLE; DETENER ante diferencias.
- No existe prueba suficiente de coherencia/frescura de los saldos para certificarlos
  únicamente contando filas. NO marcar fresh con backfill optimista.
- SQL backfill histórico separado lee empleados e inicializa solo filas dirty del índice.
  No evita la primera pasada. NO fue ejecutado y NO se debe ejecutar en este rollout.
- Preparar BD antes de desplegar. No ocultar ausencia de tabla con fallback silencioso.
- Primera pasada inevitable: ejecutar el POST administrativo indicado abajo, con tráfico
  y polling suspendidos operativamente. Usa el loop serial existente.
  Si se omite la ventana, un GET podría ganar la carrera; el endpoint por sí solo
  NO bloquea ni cambia alertas/notificaciones.
- Reinicios/redeploys ese mismo día conservan frescura. Al cambiar el día vuelven elegibles
  los activos según el requisito diario; no se promete cero motores cada nuevo día.
- SQL manual sobre fuentes debe ejecutar también, con autorización y misma transacción:
  `UPDATE rrhh_vacaciones_sync_estado SET dirty=1,generacion=generacion+1,
  actualizado_en=CURRENT_TIMESTAMP WHERE empresa_id=<empresa> AND id_empleado=<empleado>`.
  Si no existe fila ya es elegible. Nunca DELETE+reinsertar filas de estado en mantenimiento:
  podría reiniciar generaciones. El backfill no sobrescribe filas existentes.

## Conteos (no tiempos medidos)

Cada check batch terminado: exactamente 2 SELECT, 0 transacciones de empleado cuando
todos están fresh, incluso desde otro proceso. 105 fresh → 2 SELECT / 0 motores.
Cada candidato efectivamente reclamado: 4 SELECT extra (GET_LOCK, política transaccional,
estado/empleado, RELEASE_LOCK), 1 INSERT IGNORE de índice y 1 UPDATE CAS,
1 BEGIN/COMMIT, más las consultas/escrituras VARIABLES del motor sin cambiar.
Con 2 dirty → 2 motores; camino NORMAL típico de 5 SELECT/motor → 20 SELECT totales
(2 + 2×(4+5)), 4 escrituras de índice, más escrituras reales del motor.
Con rival que terminó: recheck omite motor; con lock ocupado solo 1 SELECT extra.
Primera pasada 105 → 105 motores; típica NORMAL 947 SELECT (2+105×9), no se oculta
ese costo inicial. Antes: estimación contextual ~528 SELECT / 105 transacciones desde
proceso frío; Map caliente casi cero pero process-local y ocultaba dirty.
El ahorro es persistencia entre procesos EN EL MISMO DÍA, no paralelismo masivo.

## Riesgos/validación

La validación física de tabla/GET_LOCK fue informada como exitosa por el operador.
La inicialización todavía NO fue ejecutada. Los tests locales usan mocks,
no prueban un servidor MariaDB real.
Una conexión perdida recupera el lock cuando MariaDB detecta su cierre; no se configura
un timeout/lease arbitrario que permita doble worker activo.
Los errores por empleado siguen aislados/registrados; errores batch se propagan.
No hay UX/polling/TMS/Facturación/Contabilidad/FEL modificados.
### Validación anterior al ajuste de rollout (HEAD d4ad17e)

- Dirigidas Vacaciones + wiring empleados + limpieza: **504/504**, sin fallos.
- Suite relevante (`vitest run src/lib/rrhh src/lib/admin src/app/api/empresas`):
  BASE exacta: **3045 pass / 14 fail / 13 skip**.
  HEAD de trabajo: **3086 pass / 14 fail / 13 skip**.
  Mismo equipo, Node/npm/dependencias y comando. Baseline separado, sin alterar checkout.
  Los 14 fallos coinciden por archivo, nombre completo de test y mensaje principal:
  **cero regresiones nuevas en esta suite comparada**. No es la suite completa del repositorio.
- Fallos idénticos: `programacion-tc.test.ts` (7),
  `programacion-viajes-tercerizados.test.ts` (1), `regreso-opcional.test.ts` (6),
  todos en `src/app/api/empresas/[slug]/tms/planes/`. No se modificaron esos archivos.
- TypeScript `npx tsc --noEmit`: PASS.
- ESLint dirigido, cero warnings en archivos tocados: PASS.
- `git diff --check`: PASS.
- `npm run build`: PASS. Advierte middleware deprecado, headers Cache-Control
  y tracing de archivos dinámicos en fuentes no modificadas; no se corrigieron aquí.
- Casos explícitos: generación concurrente simple/doble, BIGINT sin pérdida,
  limpieza con rollback, Map éxito/error y llamada posterior dirty, política,
  admin resync aun fresh, dos workers, desconexión/recuperación simulada,
  destrucción de conexión si RELEASE_LOCK falla, aislamiento por empresa,
  105 fresh y 2 dirty, FIFO/histórico y rollback de mutaciones.
- No hubo SQL ni conexión de pruebas a producción por el agente. La validación física
  posterior fue realizada e informada por el operador, no por las pruebas locales.

### Inventario del PR (25 archivos)

Documentación y SQL propuesto:

- `docs/RRHH-RENDIMIENTO-FASE2-VACACIONES.md`
- `sql/schema.sql`
- `sql/migrate-2026-10-rrhh-vacaciones-sync-estado.sql`
- `sql/preflight-2026-10-rrhh-vacaciones-sync-estado.sql`
- `sql/backfill-2026-10-rrhh-vacaciones-sync-estado.sql`

Implementación e invalidación:

- `src/lib/rrhh/vacaciones-sync-estado.ts`
- `src/lib/rrhh/vacaciones.ts`
- `src/lib/rrhh/empleados.ts`
- `src/lib/rrhh/vacaciones-registro.ts`
- `src/lib/rrhh/vacaciones-eliminar.ts`
- `src/lib/rrhh/vacaciones-rebase-db.ts`
- `src/lib/admin/limpiar-modulo.ts`
- `src/app/api/empresas/[slug]/rrhh/incidencias/route.ts`
- `src/app/api/empresas/[slug]/rrhh/incidencias/anexo/route.ts`
- `src/app/api/admin/vacaciones/inicializar-sync/route.ts`

Pruebas y fixture transaccional:

- `src/lib/rrhh/vacaciones-sync-estado.test.ts`
- `src/lib/rrhh/vacaciones-sync-invalida.test.ts`
- `src/lib/rrhh/vacaciones-sync-incidencias.test.ts`
- `src/lib/admin/limpiar-vacaciones-sync.test.ts`
- `src/lib/rrhh/empleados-rebase-wiring.test.ts`
- `src/lib/rrhh/vacaciones-eliminar.test.ts`
- `src/lib/rrhh/vacaciones-reparacion.test.ts`
- `src/lib/rrhh/vacaciones.test.ts`
- `src/lib/rrhh/vacaciones-registro-bd.testutil.ts`
- `src/app/api/admin/vacaciones/inicializar-sync/route.test.ts`

Sin UI/permisos/dependencias/lockfile/TMS/catálogos de nómina.
El checkout original, sus modificaciones y untracked quedaron preservados.

## Inicialización administrativa controlada (corrección de rollout)

Se eligió un endpoint porque el repositorio ya tiene operaciones manuales de Admin
en `src/app/api/admin/limpiar-modulo/route.ts`. No requiere instalar tsx,
resolver aliases de TS fuera de Next ni cargar otro motor/otra conexión de scripts.

`POST /api/admin/vacaciones/inicializar-sync`:

- Sesión autenticada y rol global **Admin**; no basta un permiso de vacaciones.
  Es el mismo alcance administrativo global del patrón existente.
- JSON estricto con `empresaId` numérico positivo y confirmación exacta
  `INICIALIZAR VACACIONES EMPRESA <id>`. Empresa debe existir y estar activa.
  No toma la empresa elegida en la sesión ni usa un fallback.
- Llama únicamente `sincronizarVacacionesEmpleadosActivos(empresa.id)`.
  Motor, generación, CAS, named locks, Map y loop serial son los de la PR.
- Sin GET, UI, tarea programada, build hook ni invocación al importar.
  No cambia permisos existentes ni flags de frescura por su cuenta.
- Respuesta privada/no-store:
  `{empresaId,candidatos,sincronizados,errores,omitidos}`.
  `candidatos` es el campo legado `empleados` del batch.
  El único cambio funcional del batch es sumar el contador `sincronizados`
  cuando el helper central devuelve true; mantiene `empleados` y `errores`.
- `sincronizados` cuenta motores terminados y confirmados, NO certifica ausencia
  de invalidaciones concurrentes ni equivale a reparar históricos protegidos.
  `omitidos` cuenta locks ocupados/rechecks ya fresh. Revisar pendientes al terminar.
- Un error individual no detiene siguientes empleados; errores parciales devuelven
  HTTP 200 con `errores > 0`. Un fallo del batch devuelve 500 seguro, sin stack.
  Nunca interpretar HTTP 200 por sí solo como inicialización completa.
- Cada repetición vuelve a leer estado. Si todos fresh: batch **2 SELECT / 0 motores**.
  El endpoint además verifica sesión y empresa; el lookup de empresa puede añadir
  un SELECT en frío según la caché existente. No confundirlo con queries del batch.

### Procedimiento exacto (para operador; NO ejecutado aquí)

Precondición indispensable: ventana de mantenimiento que impida tráfico normal
y polling a alertas/notificaciones, incluyendo pestañas abiertas. Mantener acceso
exclusivo del operador al POST administrativo (por proxy/infraestructura existente).
Obtener una sesión Admin válida antes de la ventana. No abrir la aplicación normal
para disparar el POST: puede iniciar la campana. No se añadió una barrera automática.

1. **Migración BD ya aplicada y verificada** por el operador. No ejecutar migrate
   otra vez, ni backfill. 104 pendientes iniciales no se convierten en fresh con SQL.
2. **Desplegar el código** en esa ventana, sin usuarios/polling. Build/deploy no
   dispara el motor ni inicializa nada automáticamente.
3. **Ejecutar inmediatamente la inicialización**, con sesión Admin y empresa explícita.
   Ejemplo empresa 1; reemplazar solo el host por el del despliegue:

   ```sh
   curl --fail-with-body --request POST \
     'https://<HOST>/api/admin/vacaciones/inicializar-sync' \
     --cookie /ruta/segura/sesion-admin.cookies \
     --header 'Content-Type: application/json' \
     --data '{"empresaId":1,"confirmacion":"INICIALIZAR VACACIONES EMPRESA 1"}'
   ```

   El archivo de cookies pertenece al operador, no se guarda en repo ni se imprime.
   Esperar el fin de la respuesta. El timeout del proxy/hosting debe permitir la
   pasada serial; no existe garantía de duración ni se simula un background job.
   Si se corta la conexión/timeout, verificar pendientes y reintentar: commits
   individuales completados conservan frescura; la tarea puede seguir en curso.
4. **Verificar frescos/pendientes** con SOLO el bloque B del preflight existente
   (la tabla ya existe). Los conteos allí son globales; para empresa específica,
   en la subconsulta `clasificacion` agregar `AND e.empresa_id = 1` al WHERE de activos.
   No basta contar filas ni solo dirty: comprobar fecha, fingerprint y fecha_alta.
   Sin errores/concurrencia se esperan 104 frescos y 0 pendientes para esta empresa.
   Repetir el mismo POST: se esperan candidatos=0, sincronizados=0, errores=0,
   omitidos=0; el batch solo realiza 2 SELECT. Si hubo un fallo, diagnosticarlo y
   repetir; seleccionará únicamente los pendientes, sin reprocesar los frescos.
5. **Habilitar/continuar tráfico normal** solo después de confirmar pendientes=0.
   Si cambia el día Guatemala durante la ventana, repetir antes de habilitar.

Este mecanismo NO es la resync administrada forzada: esa sigue ejecutando el motor
aun fresh en su flujo original. Inicializar es idempotente por el índice.

Pruebas de rollout añadidas: batch/estado/motor reales con BD simulada para 104
candidatos, máximo una transacción de empleado a la vez, segunda pasada 2 SELECT
y cero motores, fallo intermedio con continuación hasta empleado 104, fallido
dirty/pendiente y reejecución únicamente de ese ID. Tests del endpoint cubren
401/403, empresa y confirmación, JSON, empresa inactiva, conteos/errores seguros,
sin GET y sin ejecución al cargar el módulo.

### Validación del ajuste de rollout

- Puntuales iniciales de endpoint/batch: 39/39.
- Dirigidas finales Vacaciones + wiring + limpieza + endpoint: **522/522**.
- Suite relevante final (`vitest run src/lib/rrhh src/lib/admin src/app/api/empresas
  src/app/api/admin/vacaciones`): **3104 pass / 14 fail / 13 skip**.
  Los 14 fallos coinciden por archivo/test/mensaje con el baseline registrado:
  programacion-tc (7), programacion-viajes-tercerizados (1), regreso-opcional (6).
  No se repitió la suite completa ni se modificó TMS.
- TypeScript, ESLint dirigido sin warnings, diff-check y build: PASS.
  Build mantiene advertencias previas fuera del alcance.
- Corrección limitada a seis archivos: este documento, `vacaciones.ts`,
  `vacaciones.test.ts`, `vacaciones-sync-estado.test.ts`, nuevo POST y su test.
  Sin cambios en schema/migración/preflight/backfill, CAS, FIFO ni motor individual.
- Ningún POST ejecutado contra producción, ningún backfill ni SQL ejecutado por el agente.
