# API-02 — adaptador MariaDB desconectado

Base auditada: `d6222b31` de origin/main, merge del PR #547. Rama independiente `feature/pricesmart-api02`; no cambia #541. D01–D16 siguen PENDIENTES. Sin HTTP, M2M implementado, worker, migración, infraestructura, Hostinger, merge ni despliegue.

El nuevo `mariaDbOrderRepository` implementa OrderRepository/Transaction de API-01. IdentityPort permanece sin implementación: el servicio existente vuelve a resolver la identidad por operación y deriva de ella el scope, nunca del body. No se importa el adaptador desde rutas ni arranque.

## Auditoría y composición

Se revisaron ports.ts, service.ts, contracts.ts, el modelo de pruebas API-01, staging.sql.in, PERSISTENCIA.md, sandbox-db.ts, sandbox-config.mjs y el perfil S04. Operaciones necesarias: INSERT de orden, SELECT FOR UPDATE, UPDATE CAS de cancelación, INSERT de evento, auditoría y outbox; marcador S02 y cuenta/base de sesión. No se necesitan escrituras TMS, consulta de credenciales, borrados, DDL ni despacho de outbox.

El administrador futuro entrega un Pool al control existente sandboxPool de S02, con manifiesto privado aprobado. API-02 sólo acepta la fachada registrada en un WeakSet privado del módulo S02; un objeto con las mismas propiedades o el pool original se rechaza. S02 sigue comprobando manifiesto y marcador en la misma conexión antes de cada operación. No se exporta registro ni bypass para tests. El cambio compartido sólo agrega la marca de procedencia, sin alterar permisos/SQL/cuentas de S04.

La fábrica exige esquema y usuario distintos con patrón `sandbox_api02_[a-z0-9_]+` y PayloadCipher inyectado, sin implementación por defecto. En cada checkout comprueba DATABASE() y CURRENT_USER() exactos, incluido host 127.0.0.1, antes de BEGIN; root y sandbox_pricesmart no son perfiles admitidos. No crea pools/conexiones globales. El patrón es una reserva de nombres del diseño, NO aprobación de ubicación o usuario ni prueba de grants efectivos. La conexión rechazada por identidad se destruye.

Ubicación física PENDIENTE de aprobación: instancia nueva aislada, base exclusiva y manifiesto/perfil nuevos. No usar la base, cuenta, grants, marcador o manifiesto S04. No se aprovisionó nada. El DDL de [API-01](../api01/staging.sql.in) permanece propuesta revisable con SIGNAL inicial; no se copió a migradores ni se ejecutó. El SIGNAL no sustituye autorización ni impide clientes que continúan tras errores.

## Atomicidad y recuperación

Una llamada obtiene una conexión, fija zona de sesión UTC, abre BEGIN, ejecuta callback y espera COMMIT antes de resolver. Orden/evento/auditoría/outbox comparten conexión y transacción. Cualquier fallo intenta ROLLBACK; un rollback fallido destruye la conexión. La fachada Tx expira al finalizar, rechaza llamadas paralelas/no esperadas y queda invalidada si el callback captura un error. No hay locks de memoria para idempotencia.

La identidad durable propuesta es UNIQUE `uq_ps_api01_identity` sobre environment+tenant+client+integration+externalOrderId, con VARBINARY para sensibilidad al case. Sólo ER_DUP_ENTRY del INSERT de orden cuyo token final de constraint coincide exactamente con esa clave (con o sin prefijo de tabla) se convierte en UniqueOrderCollision. PRIMARY, clave scoped, evento, auditoría y outbox nunca son replay. No se busca el nombre dentro del valor duplicado.

El servicio API-01 hace rollback del INSERT perdedor antes de un nuevo runAtomic para SELECT FOR UPDATE del ganador. Huella igual devuelve snapshot original inmutable y audita REPLAY; diferente devuelve CONFLICT. GET/cancelación usan scope completo y el club del principal. Cancelación comprueba estado/vínculo y actualiza sólo estado, versión y snapshot/hash/motivo de cancelación con WHERE version=previous y tms_linked=0. Cero filas o salto de versión es CONFLICT. Las FKs compuestas mantienen namespace en eventos/outbox/auditoría.

Deadlock y lock wait timeout -> PersistenceError RETRYABLE, después de rollback. No hay retry automático del callback ni transacción reutilizada: cada reintento explícito debe llamar de nuevo al servicio (identidad renovada) y abre un nuevo BEGIN/checkout. Un fallo durante COMMIT siempre produce COMMIT_UNKNOWN, intenta rollback y destruye la conexión; no se afirma que el rollback deshaga un commit ya aplicado. No devuelve éxito ni reintenta automáticamente. Recuperar con la misma orden/contenido a través del servicio: si existía commit, UNIQUE+replay; si no, INSERT. Para cancelación, snapshot/hash y CAS. Auditorías de lecturas/replays podrían repetirse tras resultado incierto; no se ofrece exactly-once de intentos.

`durability: DURABLE` es el resultado contractual del adaptador tras confirmación del driver; NO certifica fsync, engine, disco o recuperación. Esa garantía operativa requiere validaciones reales pendientes antes de activar cualquier composición. Las pruebas de este PR usan dobles del protocolo mysql2 y no son evidencia de MariaDB real.

No se registran errores originales, SQL, parámetros, payloads ni secretos. Los errores de driver salen sanitizados; OrderApplication los reduce a UNAVAILABLE. Constraint de identidad y CONFLICT son las únicas excepciones de negocio específicas del adaptador.

## Matriz de consultas y permisos (propuesta, no GRANT)

Todas las tablas se cualifican con el esquema fijo validado; todos los valores se parametrizan. INSERT incluye las cuatro columnas de namespace; SELECT/UPDATE filtran las cuatro. La verificación de infraestructura no selecciona datos de tenants. No hay SQL suministrado por callers.

| Consulta / tabla | Operación del perfil API nuevo | Restricción |
|---|---|---|
| novalvion_environment | SELECT id, environment, sandbox_id | Sólo marcador S02 de la base nueva; sin escritura |
| DATABASE(), CURRENT_USER() | SELECT de funciones de sesión | Base y cuenta exactas antes de BEGIN |
| SET SESSION time_zone; BEGIN/COMMIT/ROLLBACK | Control de sesión/transacción | UTC, misma conexión, sin DDL |
| ps_api01_scopes | Ninguna consulta runtime | Registro administrativo previo; FK de orders lo exige; no INSERT/UPDATE/DELETE API |
| ps_api01_orders | SELECT, INSERT | UNIQUE identidad; SELECT FOR UPDATE completo por scope+ID |
| ps_api01_orders | UPDATE(state, version, cancellation_hash, cancellation_reason, cancellation_receipt_json) | CAS scope+UUID+externalId+previousVersion+tms_linked=0; no modificar identidad/payload/receipt inicial |
| ps_api01_events | INSERT | Append-only, FK scoped a orden, UNIQUE por orden/versión |
| ps_api01_audit | INSERT | Append-only, FK scoped, sin payload o mensajes SQL |
| ps_api01_outbox | INSERT | FK scoped a evento; PENDING por default, sin consumidor |
| Otros esquemas/tablas, TMS, mysql.*, S04 | NINGUNO | Sin privilegios globales, schema.*, root, GRANT OPTION, DDL, DELETE ni delegación |

GET también inserta auditoría y necesita este perfil API; no funciona como S04 de sólo lectura. Instalador y registro de scopes son administrativos y separados. No se generan ni amplían grants S04. MariaDB no impone aislamiento por filas mediante estos grants de tabla: el scope confiable y las consultas/FKs son la barrera de aplicación; revisar perfiles/bases separados si se exige aislamiento adicional entre tenants. Efectividad, roles heredados, engines, FK/CHECK/UNIQUE y ausencia de privilegios amplios requieren auditoría real NO EJECUTADA.

## Cifrado e integración posterior

PayloadCipher es un puerto obligatorio, sin codec de texto plano ni claves del entorno por defecto. El adaptador persiste únicamente ciphertext y referencia de clave retornados por ese puerto; open debe autenticar antes de devolver el DTO, validado contra esquema y columnas de identidad. Las pruebas usan bytes opacos y un codec falso; NO son cifrado.

Diseño a ratificar: AEAD AES-256-GCM mediante proveedor/KMS aprobado; nonce aleatorio único por clave, tag obligatorio, sobre versionado que incluya algoritmo/nonce/tag/ciphertext; AAD canónica [environment,tenantId,clientId,integrationId,externalOrderId] (en ese orden), idéntica al contexto entregado al puerto. Autenticar también versión de sobre/algoritmo/key reference, aplicar límites y rechazar sobres desconocidos, tags inválidos y traslado entre namespaces. Claves fuera de la DB/repositorio, acceso mínimo separado, rotación con keyReference y lectura de versiones previas aprobadas, revocación/backup/recuperación verificados. No confundir hash SHA256 con cifrado; proteger metadatos, snapshots e IDs con control de acceso y cifrado de disco/backup según clasificación.

Pendientes: implementación y revisión criptográfica, custodia/KMS, política ratificada de retención de payloads/huellas/identidad/snapshots/eventos/auditoría/outbox/backups, legal hold, borrado y deduplicación tras expiración. No borrar identidad para solucionar conflictos. No presentar este almacenamiento como seguro para datos reales sin cifrado y retención ratificados (D14 y decisiones relacionadas).

Integración posterior requiere auditoría independiente del PR, aprobación D01–D16, instancia nueva autorizada, DDL revisado instalado por administrador, permisos efectivos, cipher real, recuperación/durabilidad y pruebas de dos conexiones, M2M real, gates/limitador/transporte aprobados. No activa rutas ni sustituye identidad por credenciales ficticias. Materialización TMS y consumidor outbox requieren otro diseño/PR y protocolo compartido de locks/versiones.
