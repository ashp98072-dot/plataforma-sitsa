# Guía de pruebas para PriceSmart (homologación)

> **PROVISIONAL.** El contrato `lab-demo-1`, los estados y el método de cancelación **no son definitivos**: se ratifican con PriceSmart (D01–D15). Hoy **no existe un sandbox accesible**: sin runtime instalado todo responde `503 DISABLED`. La URL y el mecanismo de autenticación los entrega Mónaco cuando el sandbox esté aprobado. Fuentes de verdad: [`openapi.homologation.json`](../api25/openapi.homologation.json) y [`postman_collection.homologation.json`](../api25/postman_collection.homologation.json).

## 1. Servicios (dirección acordada 30/10/2026)
| Servicio | Método y ruta | Estado |
|---|---|---|
| Recibir una orden (una por una) | `POST /api/integrations/pricesmart/v1/orders` | IMPLEMENTADO y probado en laboratorio · contrato PROVISIONAL (D06) |
| Consultar una orden y su estado (~cada hora) | `GET /api/integrations/pricesmart/v1/orders/{externalOrderId}` | IMPLEMENTADO y probado · estados PROVISIONALES (D08) |
| Solicitar cancelación | `POST /api/integrations/pricesmart/v1/orders/{externalOrderId}/cancellation-requests` | IMPLEMENTADO como **candidato aislado**; método **PENDIENTE (D09)** |

## 2. Autenticación (D02 — PENDIENTE)
Cada solicitud lleva la evidencia de autenticación de la integración (credencial emitida por Mónaco, ligada a método, ruta y cuerpo, con caducidad y protección contra repetición). **El formato de la evidencia aún no está acordado**; la colección Postman usa los marcadores `authHeaderName`/`authHeaderValue` (`PENDIENTE-D02`) y no se envía nada hasta definirlo. Sin evidencia válida: `401`. Sin el permiso de la operación o con un club no permitido: `403`. El verificador HMAC del laboratorio (`x-lab-evidence`) **no se entrega**.

## 3. POST — recibir una orden
Cuerpo JSON (`Content-Type: application/json`, máx. 64 KiB, campos desconocidos prohibidos):
| Campo | Regla (PROVISIONAL) |
|---|---|
| `schemaVersion` | constante `lab-demo-1` |
| `externalOrderId` | 1–120 caracteres `[A-Za-z0-9][A-Za-z0-9._:-]*` (D03 pendiente) |
| `originClubReference` | 1–64, mismo patrón; debe estar permitido para su integración |
| `recipient.name` | 1–200 |
| `address` | 1–300 |
| `deliveryDate` | fecha real `AAAA-MM-DD` (fechas pasadas: ver §7) |
| `notes` | opcional, ≤ 200 |

Respuesta `202`: `{ externalOrderId, provisionalStatus: "RECEIVED", processingStatus, version, correlationId }`. **202 significa «recibida y persistida de forma durable»**; la vinculación con el TMS es asíncrona.

## 4. GET — consultar
`200` con el recibo más la proyección del TMS: `proposedStatus` (ver §6), `confirmsDelivery` (**siempre `false`**, D13), `tms` y, si aplica, `cancellation`. Consulta de solo lectura; un identificador inexistente **o de otra empresa** responde `404 NOT_FOUND` (no se distingue).

## 5. Cancelación
Cuerpo `{ "reason": "ORIGIN_REQUEST" | "DUPLICATE" }` → `202`. **Es una solicitud, no una cancelación ejecutada** (D09): queda registrada de forma durable e idempotente, se evalúa según el estado del TMS y **nunca cancela viajes ni elimina la orden automáticamente**. El GET muestra `CANCELLATION_REQUESTED` y el veredicto; `CANCELLED` solo cuando Operaciones lo ejecuta. Método (`POST` vs `DELETE`), motivos, quién y cuándo siguen **pendientes**.

## 6. Estados (PROPUESTA, D08)
Recibo: `RECEIVED`, `REVIEW_REQUIRED`, `CANCELLATION_REQUESTED`, `CANCELLED`. Proyección del TMS (`proposedStatus`): `RECEIVED`, `IN_REVIEW`, `REJECTED`, `CANCELLED`, `SCHEDULED`, `LOADED`, `IN_TRANSIT`, `UNLOADED_UNCONFIRMED`, `CLOSED_ADMINISTRATIVE`, `REVIEW_REQUIRED`. **No existe estado «entregada»**: «descargado» y «cerrado» no son entrega aceptada hasta ratificar D13.

## 7. Errores (cuerpo siempre `{ "code", "correlationId" }`, sin eco de datos)
| HTTP | `code` | Causa | ¿Reintentar? |
|---|---|---|---|
| 400 | `INVALID_INPUT` | campos faltantes/desconocidos, tipos, patrones, fecha inválida, motivo no admitido | No: corregir |
| 401 | `UNAUTHENTICATED` | sin evidencia, inválida, caducada, revocada o de otro entorno | No: corregir credencial |
| 403 | `FORBIDDEN` | sin permiso de la operación o club no permitido | No |
| 404 | `NOT_FOUND` | orden inexistente o de otra empresa | No |
| 405 | `METHOD_NOT_ALLOWED` | método no admitido en la ruta | No |
| 408 | — | tiempo de lectura agotado | Sí, con espera |
| 409 | `CONFLICT` | mismo `externalOrderId` con contenido distinto | No: es otra orden o un error |
| 409 | `REPLAY_REJECTED` | evidencia ya usada | Sí, con evidencia **nueva** |
| 413 / 414 / 431 | `TOO_LARGE` … | cuerpo, URL o cabeceras excesivos | No |
| 415 | `UNSUPPORTED_FORMAT` | tipo de contenido o codificación no admitidos | No |
| 429 | `LIMITED` | límite de tasa | Sí, con espera creciente |
| 503 | `DISABLED` / `READ_ONLY` / `UNAVAILABLE` | integración apagada o en solo lectura / dependencia caída | Sí, con espera; `Retry-After: 60` solo en algunos casos (OpenAPI `x-runtime-modes`) |

**Fecha de entrega pasada (D07 pendiente):** la orden se **acepta** (`202`); el TMS la rechaza al vincular y el GET indica revisión (`REVIEW_REQUIRED`); no se simula entrega.

## 8. Idempotencia y reintentos
- **Idempotencia por contenido:** reenviar la **misma** orden (mismo `externalOrderId` y mismo contenido) devuelve el **mismo recibo `202`** y no crea otra orden ni otra solicitud (`DEMO.4`, `DEMO.8`: 6 envíos simultáneos → una sola orden). Mismo id con contenido distinto → `409 CONFLICT`.
- **No existe aún cabecera `Idempotency-Key`** (D10 pendiente; la OpenAPI lo declara `UNRATIFIED_D10_NOT_IMPLEMENTED`). La clave es `externalOrderId` + contenido.
- **Recomendación provisional de reintento (pendiente de ratificar):** reintentar con el **mismo cuerpo** ante timeout de red, `408`, `429`, `5xx`/`503` con espera exponencial (p. ej. 1 s, 2 s, 4 s … máx. 60 s) y sin reintentar `4xx`. Un reintento tras un `202` perdido es seguro.
- **Reintentos de Mónaco hacia el TMS:** si la vinculación falla, el evento se reintenta de forma acotada (al-menos-una-vez) y, agotados los intentos, queda en **revisión durable** (`REVIEW_REQUIRED`); no se descarta. Una recuperación tras caída no duplica solicitudes (token de reclamo).

## 9. Cómo probar con Postman
1. Importar la colección y definir `baseUrl`, `authHeaderName`, `authHeaderValue` (cuando Mónaco los entregue).
2. Ejecutar en orden: **1** flujo (POST → GET → reenvío idempotente → conflicto), **2** cancelación, **3** errores (401, 400, 404 GET, 404 cancelación, 400 motivo, 415). Cada petición trae aserciones. Las etiquetas `[PROVISIONAL_LAB]` / `[PENDING_PRICESMART]` en la descripción indican la madurez del contrato.
3. Usar siempre datos sintéticos. No hay datos reales en el sandbox.

## 10. Lo que esta guía NO afirma
No afirma disponibilidad de un servicio, ni un esquema de autenticación elegido, ni el contrato definitivo, ni entrega confirmada, ni cancelación ejecutada.
