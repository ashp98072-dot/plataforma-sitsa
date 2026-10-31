# API-01 — staging e idempotencia propuestos

No existe repositorio MariaDB ni instalación. [staging.sql.in](staging.sql.in) es diseño revisable bajo documentación, **no migración de producción ni parte del esquema S04**. Su primera sentencia SIGNAL impide una ejecución normal accidental, pero no es una frontera de seguridad frente a clientes que continúan tras error; no ejecutarlo, quitar el guard ni usar force. No contiene conexión, USE, usuarios ni grants. MariaDB, índices, CHECK/FK, concurrencia multiproceso, cifrado y durabilidad real: NO EJECUTADOS.

## Identidad y datos separados

| Concepto | Diseño |
|---|---|
| Principal técnico | `IdentityPort` resuelve M2M fuera del transporte/body. Identificador estable de integración, empresa/cliente contractual, entorno sandbox, club autorizado y scopes. No es credentialId ni usuario humano. Rotación no cambia namespace |
| Namespace | `(environment, tenant_id, client_id, integration_id)` de identidad confiable; registro administrativo `ps_api01_scopes`. Sin secretos ni implementación de credenciales |
| Orden externa | `ps_api01_orders`, UUID interno distinto del ID externo; UNIQUE(namespace, external_order_id) binario case-sensitive. Club validado, payload/version/huella, snapshot inicial inmutable, estado/versión/correlación/recepción |
| Payload | Sobre mínimo validado de tres campos, no body arbitrario ni PII comercial. Puerto recibe DTO; adaptador futuro debe cifrarlo autenticadamente para `payload_ciphertext` y gestionar key reference sin guardar secretos en la tabla. Cifrado/retención pendientes D14; no implementación criptográfica ficticia |
| Seguimiento | `ps_api01_events`, secuencia única `(namespace,order_id,order_version)`, tipo/motivo enumerados, correlación y recorded_at UTC servidor. Append-only, sin actualizar historia |
| Trabajo pendiente | `ps_api01_outbox`, FK a evento único, estado/intentos/próxima ejecución/lease. No worker activo, no colas sólo en memoria después de responder |
| Solicitud/resultados | `ps_api01_audit`: operación y resultado enumerados, UUID de orden/correlación y scope, sin body, secretos o mensajes SQL. Creación/replay/consulta/cancelación exitosa obligatoriamente auditados en transacción |
| Cancelación | Hash/motivo/snapshot de solicitud, sólo una por orden en esta propuesta. Repetición idéntica devuelve snapshot original; otro motivo es conflicto. No cambia TMS ni cancela entrega/viaje |
| Vínculo TMS | `tms_linked=0` obligatorio por CHECK en esta propuesta. No FK a solicitudes ni IDs de plan en el wire. Historial/candidatas compuestas y actor máquina requieren PR posterior |

Scope/club/campos comerciales y unicidad son provisionales (D03–D07). El perfil mínimo no pretende representar todas las variantes de una orden real. No crear índice definitivo en producción antes de ratificación; si el ID es único sólo por club se debe rediseñar también GET/cancel, no añadir un filtro opcional que pueda devolver la primera coincidencia.

Separación física de staging pendiente de aprobación: una nueva DB exclusiva con su propio marcador/configuración/perfil revisados, o un nuevo perfil de laboratorio expresamente autorizado. **No** elegir otro esquema dinámicamente, acceder desde el usuario S04, alterar su manifiesto/marker ni conceder acceso cruzado. Los tenant/client IDs del diseño son referencias verificadas por catálogo; no FK improvisadas a un esquema productivo. Antes de persistencia real: decidir ubicación física y constraints compatibles con sus tablas autorizadas, preflight de instancia nueva y herramientas S02–S06-A.

## Protocolo que deberá cumplir un repositorio real

1. Resolver y verificar M2M por petición (revocación/expiración/scope/club/entorno) y aplicar límites antes de cuerpo. Usar scope confiable en **cada** SELECT/INSERT/UPDATE y constraint/FK; no recibirlo de un tenant header. Reutilizar guardas S02 de manifiesto/identidad por operación en conexión fijada, no usar driver sin guard.
2. Abrir una sola conexión y transacción. Fijar UTC y parámetros de sesión revisados; comprobar MariaDB/engine, FK/CHECK y durabilidad del log/fsync/almacenamiento con recuperación real. COMMIT sólo permite acuse cuando el motor y el almacenamiento cumplen garantías aprobadas; devolver un campo `DURABLE` no lo demuestra.
3. Crear orden por INSERT primero; el UNIQUE exacto `uq_ps_api01_identity` decide carreras, no una búsqueda previa ni un Map local. Cifrar payload normalizado con esquema/huella coherentes. Usar parámetros, nunca interpolar IDs externos.
4. En la misma transacción: evento RECEIVED, outbox con FK/UNIQUE del evento y auditoría RECEIVE/CREATED. Un error en cualquiera revierte todo. No usar auditoría no-Tx que silencia errores.
5. Confirmar commit antes de resolver `runAtomic`. El servicio espera esa promesa; el transporte futuro debe además exigir repo real validado, M2M y gates antes de 202. No devolver 202 ni tarea en memoria con promesa de guardar después. Aquí el transporte siempre está deshabilitado.
6. Si falla únicamente el constraint de identidad, rollback de la transacción perdedora y nueva transacción, lectura scope+ID con FOR UPDATE del ganador confirmado. Igual huella original → snapshot original y auditoría REPLAY/REPLAYED; huella distinta → conflicto. No mapear cualquier duplicate key a replay (errores de evento/outbox son fallos, no duplicados de orden).
7. Cancelación: FOR UPDATE de la orden dentro de su scope, club autorizado y versión; comparar snapshot/motivo si repetida. Sin vínculo, transición permitida → version+1 y snapshot CANCELLATION_REQUESTED, CAS en save, evento+outbox+auditoría atómicos. Con vínculo/estado terminal inválido → conflicto, no tocar plan. Una revisión/materialización futura deberá compartir protocolo de locks y versiones; no existe ahora.
8. GET: scope completo y club antes de proyectar, mismo 404 para ajeno/desconocido. El prototipo audita READ/FOUND en transacción, por lo que incluso esta consulta **requiere INSERT de auditoría** y no es compatible operativamente con S04 SELECT/ACCOUNT LOCK. No ampliar esos grants.
9. Error temporal, deadlock, timeout o resultado de commit desconocido → UNAVAILABLE/503 futuro, sin mensaje SQL/stack/secretos. API-01 no hace reintento ciego interno. Cliente reintenta mismo ID/contenido; si commit ya ocurrió, UNIQUE+replay lo recupera. Pruebas de caída antes/durante/después de commit y reconexión deben realizarse con MariaDB nueva antes de activar.
10. Outbox futura: consumidor idempotente, leases atómicos con vencimiento y fencing/versiones, recuperación de worker caído, backoff y revisión durables. No perder órdenes aceptadas por agotar intentos ni marcar DONE antes de materialización confirmada. No existe scheduler automático API-01.

Huella: SHA256 sobre lista ordenada `[schemaVersion, externalOrderId, originClubReference]` validada; no raw JSON ni claves arbitrarias. Propiedades reordenadas equivalen, IDs/case/club distintos no. Cualquier ampliación de campos requiere nueva canonicalización versionada y contrato. La huella es dato interno restringido, no se publica como identificador anónimo ni se usa como sustituto de cifrado/retención. Snapshots iniciales jamás se sobrescriben por cambio de estado.

No se implementa una tabla de `Idempotency-Key` HTTP porque D10 sigue pendiente; identidad de orden evita duplicar su recepción, no resuelve por sí sola todos los futuros comandos/keys/replay autenticado. Si se ratifica una key, namespace+tipo+key, huella/snapshot/retención y atomicidad con la misma orden requieren diseño y pruebas propios antes de usarla.

## Permisos futuros por tabla (propuesta, no GRANT)

| Tabla | Receptor propuesto | Consulta propuesta | Worker futuro | Observación |
|---|---|---|---|---|
| ps_api01_scopes | SELECT sólo | SELECT sólo | SELECT sólo | Alta/baja sólo instalador autorizado; sin DDL/runtime |
| ps_api01_orders | SELECT, INSERT; UPDATE sólo columnas de cancelación/estado/versión | SELECT | SELECT y UPDATE específico por función aprobada | Nunca cambiar scope, ID, payload, huella o receipt inicial. FKs/where compuesto, no borrado |
| ps_api01_events | SELECT, INSERT | Sin escritura de eventos | INSERT permitido sólo para tipos aprobados | Sin UPDATE/DELETE, historia preservada |
| ps_api01_outbox | INSERT | Sin escritura | SELECT, UPDATE restringido a lease/estado/intentos | Sin DROP/DELETE ni tareas posteriores sólo en memoria |
| ps_api01_audit | INSERT | INSERT de lectura | INSERT | Sin UPDATE/DELETE; payload/secretos ausentes |
| novalvion_environment | SELECT | SELECT | SELECT | Protegido contra modificaciones; nombre/perfil físico por aprobar |
| TMS y otros esquemas | Ningún permiso | Ningún permiso API-01 | Ningún permiso de materialización aún | Cero privilegios globales/schema.*, GRANT OPTION o SQL productivo |

Runtime API nuevo no existe ni está aprobado. Instalar futuro DDL exige usuario administrativo separado y autorizaciones; no reutilizar usuario S04 para escritura. Rechazos previos a orden existente (auth/validación/404) necesitarán auditoría de seguridad del gateway aprobado, sin FK ficticia a orden inexistente ni logging de secretos; no se implementa ese gateway aquí. Auditoría fallida dentro de transacción existente invalida éxito, nunca se silencia.

## Recuperación y validaciones pendientes

El único repositorio entregado es un doble serializado en memoria: modela rollback/UNIQUE/CAS y reporta SIMULATED. No prueba locks InnoDB, aislamiento, multiproceso, CHECK/FK, cifrado, recuperación, disco ni commits durables. DDL se revisa estáticamente y no se ha compilado/ejecutado en MariaDB. Antes de un repositorio real: preflight de instancia nueva, constraints efectivas, dos conexiones independientes y procesos, errores de auditoría/outbox, deadlocks, commit incierto, restart y conciliación sin pérdidas; todo NO EJECUTADO en API-01.

No existe migración ni rollback aplicado. Si falla un aprovisionamiento futuro, preservar parciales/journal y detener; no DROP/reset/adoptar. Desactivar transporte/worker, preservar órdenes/outbox/historia y recuperar desde backup sintético verificado sólo en destino completamente nuevo conforme S06-A. No borrar deduplicación para resolver un conflicto y no declarar restauración de datos aceptados sin conciliación.
