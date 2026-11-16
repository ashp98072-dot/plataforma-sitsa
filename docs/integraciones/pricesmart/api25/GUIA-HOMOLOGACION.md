# PriceSmart API-25 — guía de homologación

> **Estado: NO HAY SANDBOX DISPONIBLE.** Los endpoints responden `503 DISABLED`; esta guía describe lo que existe en el laboratorio y lo que falta. No anuncia ningún servicio accesible. Todo dato es sintético.

Leyenda: **IMPLEMENTADO** (código + pruebas en laboratorio) · **PROVISIONAL** (implementado, sin ratificar por PriceSmart) · **PENDIENTE** (sin acuerdo o sin construir).

## 1. Servicios acordados en la dirección (reunión 30/10/2026)
| Servicio | Dirección acordada | Contrato técnico | Estado |
|---|---|---|---|
| Recepción de órdenes (POST, una por una) | PriceSmart → Mónaco | `lab-demo-1`: referencia, club, destinatario, dirección, fecha de entrega, notas; estricto | IMPLEMENTADO en laboratorio / PROVISIONAL (D05, D06, D07) |
| Consulta de estado (GET, ~cada hora) | PriceSmart → Mónaco | Estado de procesamiento + proyección del TMS; nunca afirma entrega | IMPLEMENTADO / PROVISIONAL (D08, D12) |
| Notificación de cancelación | PriceSmart → Mónaco | Solicitud durable e idempotente; no elimina ni cancela viajes automáticamente | IMPLEMENTADO (método **POST** en laboratorio) / **PENDIENTE** el método exacto (POST vs DELETE, D09) |

## 2. Autenticación (D02 — PENDIENTE)
- El motor M2M valida: caducidad de credencial e integración, revocación, scopes por operación, clubes permitidos, entorno (sandbox ≠ producción), repetición (prueba ligada a método, ruta y cuerpo, con identificador único y caducidad corta) y límites de tasa. Todo es independiente del formato de la evidencia.
- **Falta el verificador real:** formato de la evidencia, emisor, audiencia, ancla de confianza y rotación. Mónaco **no** inventa un mecanismo; el verificador se enchufa por el puerto `EvidenceVerifier` sin cambiar el motor (probado con verificadores alternos).
- Lo que Mónaco puede ofrecer y PriceSmart debe confirmar: OAuth 2.0 *client credentials* con JWT firmado, o mTLS, o firma de solicitud con clave por integración. **Ninguno está elegido.** Hasta entonces el verificador por omisión **deniega todo**.
- El verificador HMAC de laboratorio (`x-lab-evidence`) es solo del laboratorio local y **nunca** se entrega a PriceSmart.

## 3. Respuestas y errores (PROVISIONAL)
Todas las respuestas son JSON. Errores: `{ "code": "...", "correlationId": "<uuid>" }`, sin eco de datos enviados ni detalles internos.
| HTTP | `code` | Cuándo |
|---|---|---|
| 202 | — (recibo) | Orden recibida y persistida (duplicado idéntico: mismo recibo) |
| 200 | — | Consulta de estado |
| 400 | `INVALID_INPUT` | Campos faltantes, desconocidos, tipos o fecha inválidos; contenido que no cabe en la solicitud del TMS |
| 401 | `UNAUTHENTICATED` | Sin evidencia, inválida, caducada, revocada o de otro entorno |
| 403 | `FORBIDDEN` | Sin el permiso de la operación o club no permitido |
| 404 | `NOT_FOUND` | Orden inexistente **o de otra empresa** (no se distingue) |
| 409 | `CONFLICT` / `REPLAY_REJECTED` | Mismo identificador con contenido distinto / prueba repetida |
| 413 / 415 | `TOO_LARGE` / `UNSUPPORTED_FORMAT` | Cuerpo excesivo / tipo no admitido |
| 429 | `LIMITED` | Límite de tasa |
| 503 | `DISABLED` / `UNAVAILABLE` | Integración deshabilitada (estado actual) / dependencia no disponible |

## 4. Estados que PriceSmart vería (PROPUESTA, D08)
`RECEIVED`, `IN_REVIEW`, `REJECTED`, `CANCELLED`, `SCHEDULED`, `LOADED`, `IN_TRANSIT`, `UNLOADED_UNCONFIRMED`, `CLOSED_ADMINISTRATIVE`, `REVIEW_REQUIRED`. **Ninguno confirma entrega** (`confirmsDelivery:false` siempre).
- «Descargado» = el piloto terminó de descargar; «Cerrado» = cierre administrativo. **No** son entrega aceptada.
- **Entregada y confirmada:** hoy el TMS solo registra la **confirmación del piloto por parada** (con una evidencia vinculada). La evidencia mínima interna que Mónaco exigiría es: *cada* parada «Entrega» del plan con confirmación `ENTREGADA_POR_PILOTO` + evidencia vinculada y *ninguna* confirmación parcial/rechazada/incidencia pendiente de revisión. Aun así `officialAcceptance = NOT_ACCEPTED_BY_PRICESMART`, y el GET solo lo informa como `tms.deliveryEvidence` (informativo). Informar a PriceSmart «entregada» queda **bloqueado por D13** (evidencia mínima, actor autorizado, parciales).
- Cancelación: se evalúa según el estado del TMS (`OPERATIONS_MAY_CANCEL_PLAN`, `BLOCKED_IN_EXECUTION`, `BLOCKED_COMPLETED`, `ALREADY_*`…); **nunca** es automática, no elimina la orden y no cancela viajes en ejecución.

## 5. Aprovisionamiento seguro del sandbox (procedimiento; NO se ejecuta en producción ni en esta fase)
Pre-requisitos que **hoy no se cumplen**: verificador D02 acordado, proveedor KMS/HSM revisado, infraestructura dedicada, dominio y TLS.
1. **Aprobación humana** de `evaluateSandboxExposure(perfil)` sin bloqueantes (perfil declarativo sin secretos).
2. **Infraestructura dedicada**: servidor MariaDB propio (≠ producción), instancia de aplicación separada, dominio y certificado propios, allowlist de red.
3. **Base de datos**: esquema `sandbox_api02_homolog_<n>`; DDL de los `*.sql.in` revisados (nunca ejecutar los de laboratorio con SIGNAL retirado); cuentas de ejecución y de worker de mínimo privilegio (ver `scripts/ci/pricesmart-api06a/ddl.mjs`).
4. **Secretos**: generados en el gestor de secretos del sandbox (no en el repositorio, no compartidos con producción); rotación documentada.
5. **Datos sintéticos**: empresas, clubes, usuarios y mapeo TMS ficticios (como `demo.mjs prepare`).
6. **Credenciales de PriceSmart**: emitidas por Mónaco según D02 y entregadas por canal seguro; revocables desde el catálogo.
7. **Verificación**: `/api/admin/pricesmart/readiness` + suite de homologación (`homologation.e2e.ts`, `pricesmart-flow.e2e.ts`, `sandbox-readiness.e2e.ts`) contra el sandbox.
8. **Destrucción**: baja de credenciales → eliminar base y cuentas → eliminar instancia, DNS y secretos; verificar que producción no cambió.

## 6. Seguimiento de recepción (diseño del mecanismo)
Para que ambas partes verifiquen que las órdenes llegaron, sin un portal nuevo: (a) PriceSmart usa el **GET por orden** (recibo + estado); (b) Mónaco usa la **bandeja de Operaciones** existente («Solicitudes de clientes» del TMS, con origen PriceSmart) y la vista de vinculaciones pendientes (`lab-demo/ops-view.ts`); (c) el acta de la corrida se obtiene de la **auditoría** durable (recepción, cancelación). Un portal de seguimiento propio solo se justificaría si PriceSmart lo pide (no está acordado).

## 7. Qué debe proveer PriceSmart / qué falta para probar externamente
Ver `MATRIZ-REQUISITOS.md` (api24) y `PREGUNTAS-PRICESMART.md` (api24). Bloqueantes técnicos para exponer el sandbox: **D02** (mecanismo y verificador), **KMS/HSM revisado**, **infraestructura dedicada con TLS/allowlist**, **D06** (contrato definitivo), **D09** (método y reglas de cancelación), **D13** (entrega confirmada).
