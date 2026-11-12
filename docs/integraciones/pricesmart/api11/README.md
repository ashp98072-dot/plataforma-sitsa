# PRICESMART-API-11 — endpoints de recepción, consulta y cancelación (candidatos, cerrados por defecto)

**Estado: IMPLEMENTADO y PROBADO contra MariaDB 11.8.9 real, local y desechable (12 PASS / 0 FAIL / 0 SKIP, datos sintéticos). NO aprobado para producción, NO desplegado, sin Hostinger.**
D01–D16 siguen PENDIENTES; nada de lo que sigue ratifica un contrato con PriceSmart.

## Qué hay
| Pieza | Archivo |
|---|---|
| 3 rutas Next (solo delegan) | `src/app/api/integrations/pricesmart/v1/orders/{route.ts,[externalOrderId]/route.ts,[externalOrderId]/cancellation-requests/route.ts}` |
| Punto de entrada **cerrado por defecto** (503 `DISABLED` sin composición instalada; no lee entorno ni abre conexiones) | `src/lib/integrations/pricesmart/runtime.ts` |
| Puertos de seguridad M2M en MariaDB: catálogo, revocación, cuota atómica, anti-repetición (independientes del mecanismo criptográfico) | `src/lib/integrations/pricesmart/security-mariadb.ts` |
| DDL propuesto (4 tablas, con SIGNAL de bloqueo; no ejecutado) | `staging-security.sql.in` |
| OpenAPI candidato y colección Postman (placeholders; sin secretos) | `openapi.draft.json`, `postman_collection.json` |
| Laboratorio (reutiliza sin modificar las guardas de API-06A) | `scripts/ci/pricesmart-api11/` |

Cadena probada: ruta → transporte aislado (API-04) → M2M (API-03: catálogo, revocación, intersección de scopes, prueba ligada a la solicitud) → cuota → reclamo anti-repetición → `OrderApplication` → repositorio MariaDB (API-02: orden cifrada, evento, outbox, auditoría, transacción única). La orden **no** se vincula al TMS (`tms_linked = 0`) ni crea viajes: la adaptación a TMS sigue siendo el flujo existente de la outbox (API-07..10), sin cambios.

## Endpoints (candidatos)
| Método y ruta | Resultado probado |
|---|---|
| `POST /api/integrations/pricesmart/v1/orders` | 202 `RECEIVED/PENDING v1`; reenvío idempotente = mismo recibo; 8 POST simultáneos = 1 sola orden |
| `GET  …/orders/{externalOrderId}` | 200 vista mínima; 404 si no existe o es de otra empresa |
| `POST …/orders/{externalOrderId}/cancellation-requests` | 202 `CANCELLATION_REQUESTED v2`; idempotente por razón; 409 con otra razón |

## Resultados del laboratorio (API11.1–12)
Cerrado por defecto · alta con orden cifrada/evento/outbox/auditoría · idempotencia · anti-repetición (409) y rechazo de prueba de otro cuerpo, vencida o alterada · consulta · cancelación · autenticación (sin evidencia, firma inválida, desconocida, **revocada**, **vencida** → 401) · autorización por scope (solo lectura no crea/cancela) · aislamiento entre empresas · concurrencia (8 POST; contador con 12 conexiones; nonce con 10) · límite 429 · privilegios mínimos de la cuenta de ejecución.

Defectos propios hallados por el laboratorio y corregidos antes del PASS: (1) el contador se interbloqueaba con conexiones simultáneas (`INSERT IGNORE`+`UPDATE` y `ON DUPLICATE KEY UPDATE`); ahora fila creada fuera de transacción + `UPDATE used = used + 1`; (2) `SET TRANSACTION` de una vez era consumido por la verificación previa del pool sandbox (error 1020 de MariaDB 11): se usa nivel de sesión y se restaura; (3) `ON DUPLICATE KEY UPDATE` exige `UPDATE` sobre columnas insertadas (privilegio mínimo roto): descartado.

## Bloqueos contractuales (NO improvisados)
- **D02 mecanismo M2M**: no existe verificador criptográfico de producción. El del laboratorio (HMAC con un secreto del run) es SOLO de pruebas. Sin él, la composición real no puede instalarse y las rutas responden 503.
- **D09** método/ruta de cancelación; **D08/D12** códigos de estado y de error definitivos; **D06** campos obligatorios de la orden (hoy solo `schemaVersion`, `externalOrderId`, `originClubReference`; `strict()` rechaza campos extra hasta que se definan); **D11** cuotas/SLA.
- **Consulta masiva de estados** (PriceSmart consultará ~cada hora): solo existe GET por orden. No se inventó un listado.
- Una confirmación del piloto **no** es aceptación oficial de PriceSmart: no se expone en estos endpoints.

## Riesgos / pendientes de producción
Reloj local del proceso (falta autoridad de tiempo distribuida); retención/limpieza de `proof_claims` y `rate_counters` sin tarea definida; TLS/mTLS, gateway, límites de conexión y pruebas de smuggling no cubiertos; instancia y cuenta de ejecución reales sin crear; catálogo/revocación necesitan procedimiento administrativo de alta; el test `contract.test.ts` de API-01 se amplió para permitir exactamente estas 3 rutas delegadoras.

## Ejecutar
```
node scripts/ci/pricesmart-api11/run-windows.mjs --preflight-only
PS_API11_LAB_ACK=SINTETICO-LOCAL-SIN-PRODUCCION-NI-HOSTINGER node scripts/ci/pricesmart-api11/run-windows.mjs --run-isolated
npx vitest run --config scripts/ci/pricesmart-api11/vitest.static.config.mts
```
