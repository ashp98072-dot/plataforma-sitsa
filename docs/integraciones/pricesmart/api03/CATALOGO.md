# Catálogo administrativo de integraciones — propuesta API-03

Diseño lógico, no tablas/migración/SQL ejecutable. Ubicación física, proveedor, credenciales operativas y administración pendientes. No modifica usuarios, sesiones, roles, tablas productivas o grants S04. Runtime sólo consulta mediante puertos; no se implementa administración ni se crean cuentas.

| Entidad propuesta | Campos e invariantes |
|---|---|
| Integración | environment=sandbox, integrationId estable, tenantId/clientId positivos, estado ACTIVE/REVOKED, validFrom/validUntil UTC, revision positiva monotónica. Namespace completo inmutable; cambio de empresa/cliente requiere alta separada y revocación, no reasignación silenciosa |
| Club autorizado | Namespace+clubReference binarios sensibles al case; conjunto no vacío sin duplicados, catálogo/propietario/versiones aprobados D04. No wildcard |
| Scope concedido | Namespace+scope exacto en orders:create/orders:read/orders:cancel, sin duplicados, sin Admin/accesoTodas/superadmin. Concesiones separadas del token y sujetas a intersección |
| Referencia de credencial | issuer+subject+credentialReference autenticados y binding único global en el catálogo de sandbox; FK a namespace estable, vigencia propia, revokedAt/estado, fecha de rotación, referencia al secreto/certificado en custodia externa. Nunca token, private key, client secret o password en texto plano |
| Historial de rotación | Nueva referencia para cada credencial, fechas y motivo mínimos, predecesora, plazo de solapamiento aprobado. No reaprovechar referencia para impedir que prueba/token antiguos se conviertan en otra credencial |
| Auditoría administrativa | Alta, cambio de clubes/scopes/vigencia, rotación, revocación, actor administrativo real autorizado, namespace, versión anterior/nueva, hora confiable, correlación y razón enum. Append-only y sin material secreto; cambios y auditoría atómicos |

CredentialBinding devuelto por el verificador sólo selecciona el catálogo, no decide tenant. El puerto `findByCredential` debe devolver la vista unida de integración, referencia y concesiones para el binding completo, con lectura coherente de una misma revisión. Cero filas = desconocida; más de una = colisión/ambigüedad y denegación, nunca escoger la primera. Invariantes futuros UNIQUE de binding completo y FKs scoped, incluyendo tablas de clubes/scopes, requerirán validación en motor. Un mismo integrationId en diferentes namespaces no permite compartir una credencial ambigua; la correspondencia criptográfica debe identificar una sola integración.

La vista validada por integrationSchema incluye estado, vigencias, revision, lista de clubes/scopes y rotatedAtMs. En este modelo rotatedAtMs identifica la creación/rotación de la referencia concreta y no puede ser posterior a su activación; no representa la fecha de rotación de cualquier otra credencial de la integración. Los tiempos usan milisegundos enteros UTC, no zona local ni texto ambiguo. Emisor/subject/referencia se comparan exactamente y con cotas; no normalizar mayúsculas, truncar o buscar por nombre libre.

RevocationPort consulta vigencia administrativa efectiva, tanto de integración como de credencial, por binding+namespace+revision. Sólo false explícito permite continuar; errores o respuestas desconocidas fallan cerrado. Una implementación real deberá impedir lecturas obsoletas y definir semántica de revocación durante operaciones en curso; API-03 no certifica linealizabilidad. Revocar una referencia no debe restaurarse accidentalmente desde backups; diario/epochs y conciliación de seguridad pendientes.

## Separación de permisos y custodia (no GRANT)

| Perfil futuro | Permitido | Denegado |
|---|---|---|
| Verificador | Leer trust anchors/metadatos/referencias autorizados; usar mecanismo criptográfico aprobado | Crear integraciones, modificar scopes/tenants, acceso a usuarios de Novalvion o seleccionar emisor de un header |
| Runtime M2M | Consultar vista de catálogo/revocación; consumir cuota y reclamar nonce por operaciones cerradas | Altas/cambios/revocación, borrar historial, leer secretos en claro, DDL, permisos globales/otros esquemas |
| Administrador de integraciones | Flujo autenticado propio, aprobación/auditoría de altas/concesiones/rotaciones/revocaciones | Bypass runtime por rol humano; cambiar namespace de una credencial ya emitida sin revocar |
| Custodio de claves | Proveedor/KMS/PKI/secret store aprobado, permisos mínimos por clave y operación | Material secreto en tablas, logs, fixtures, PR, variables habilitantes o backups sin custodia |
| S04 | Permanece bloqueado y SELECT conforme perfil heredado | Cualquier uso como runtime M2M o ampliación de grants |

Administración requiere revisión independiente/segregación de funciones, validación del cliente/club contractual y auditoría durable. El actor administrativo no se inventa como usuario 0 ni es el principal técnico de la API. Los lectores no pueden concederse scopes ni modificar el catálogo. Ningún grant se comparte con S04 o usuarios humanos productivos.

Pendientes D02/D04/D14/D15: aprobación de altas, catálogo/versiones, multi-credencial y solapamiento de rotación, caducidad máxima, proveedor, residencia/cifrado/retención, acceso de auditores, reversión de concesiones y recuperación de revocaciones. No presentar este modelo lógico como un catálogo instalado, seguro para datos reales o probado con MariaDB.
