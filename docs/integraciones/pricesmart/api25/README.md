# PriceSmart API-25 — preparación del sandbox de homologación

**Estado: IMPLEMENTADO y PROBADO en el laboratorio local (MariaDB 11.8.9 desechable). NO hay sandbox desplegado, ni URL, ni credenciales para PriceSmart. NO aprobado para producción ni para pruebas externas.** Endpoints `503 DISABLED`, `ready=false`, `authorizesInstallation=false`, `REVIEWED_KMS_ADAPTERS` vacío, guardas `sandbox_api02_*` intactos, sin cambios en Hostinger, banderas ni credenciales.

Contenido: `ARQUITECTURA-SANDBOX.md` · `GUIA-HOMOLOGACION.md` · `openapi.homologation.json` · `postman_collection.homologation.json`.

## Código funcional añadido
| Cambio | Archivo | Por qué |
|---|---|---|
| Evidencia de entrega **interna** (NONE / PARTIAL / PILOT_CONFIRMED_ALL / REVIEW_REQUIRED / UNAVAILABLE) a partir de las confirmaciones del piloto por parada; expuesta en el GET como `tms.deliveryEvidence`, siempre `confirmsDelivery:false`, `publishable:false`, bloqueada por D13 | `delivery-evidence.ts`, `lab-demo/tms-link.ts` | «Descargado» y «Cerrado» no prueban entrega aceptada; define la evidencia mínima sin suponer política externa |
| Requisitos **ejecutables** del sandbox de homologación (`evaluateSandboxExposure`), que nunca autoriza y rechaza el laboratorio actual | `homologation-sandbox.ts` | Convierte la lista de bloqueantes en una verificación probada |
| **Defecto corregido:** el contador de cuota de una credencial serializaba las consultas simultáneas (transacción de ~5 sentencias reteniendo el bloqueo); 14 consultas simultáneas de la misma credencial agotaban la espera de bloqueo y respondían 503. Ahora es **una sola sentencia atómica** (`used = LAST_INSERT_ID(used + 1)`) | `security-mariadb.ts` | La consulta periódica de PriceSmart genera ráfagas con la misma credencial |
| OpenAPI y colección Postman de homologación (atadas al código por pruebas) | `docs/.../api25/*.json` | Separan lo provisional de lo pendiente y no anuncian un servicio accesible |

## Pruebas
- E2E MariaDB real: `sandbox-readiness.e2e.ts` (consulta periódica en ráfaga, evidencia de entrega, diagnóstico sin exponer valores), más las suites de homologación (API-24), flujo (API-23) y regresión (API-12/13) sin cambios de resultado.
- Laboratorio real de API-11: 22/22 (incluye el contador atómico con 12 conexiones).
- Unitarias: requisitos del sandbox, evidencia de entrega, contador de una sentencia, OpenAPI y Postman.
- Observación (no se cambia): cada GET escribe **una fila de auditoría de acceso** (`ps_api01_audit`, diseño de API-01); con consulta horaria crece N órdenes × consultas/día. Su retención depende de D14.

## Bloqueantes para pruebas externas (ninguno depende solo de Mónaco)
1. **D02** — mecanismo/formato de autenticación y verificador real (PriceSmart); hoy el verificador por omisión deniega todo.
2. **KMS/HSM** — proveedor no seleccionado (`REVIEWED_KMS_ADAPTERS` vacío).
3. **Infraestructura** — servidor MariaDB dedicado, instancia separada, dominio, TLS, allowlist de red, monitoreo y gestor de secretos.
4. **D06** (contrato definitivo), **D09** (método y reglas de cancelación), **D13** (entrega confirmada), D07/D08/D12.
5. Aprobación humana de `evaluateSandboxExposure` sin bloqueantes y autorización expresa de despliegue.
