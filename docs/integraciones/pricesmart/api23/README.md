# PriceSmart API-23 — flujo funcional extremo a extremo (laboratorio sintético y aislado)

**Estado: IMPLEMENTADO, VERIFICADO TÉCNICAMENTE y PROBADO contra MariaDB 11.8.9 real desechable.** NO aprobado para producción. Endpoints `503 DISABLED`, `ready=false`, `authorizesInstallation=false`, `REVIEWED_KMS_ADAPTERS` vacío, guardas `sandbox_api02_*` intactos, sin datos ni credenciales reales, sin SQL productivo, sin Hostinger, sin viajes reales.

## 1. Brecha encontrada y corregida (causa exacta)
| # | Hallazgo | Causa | Cambio mínimo |
|---|---|---|---|
| 1 | Los eventos de la outbox (API-01/07) se escribían pero **nada los consumía** hacia el TMS de laboratorio; la vinculación solo ocurría por la vía rápida posterior al commit y por los reintentos de API-13. | El despachador (API-07) y la vinculación (API-12/13) nunca se conectaron. | `lab-demo/outbox-link-handler.ts`: manejador de outbox que reutiliza `attemptNow` y `noteCancellation`. Sin capas nuevas. |
| 2 | `noteCancellation` **no era idempotente**: una entrega repetida (la outbox es al-menos-una-vez, y además existe la vía rápida) duplicaba la auditoría. | `UPDATE … COALESCE` siempre «tenía éxito» y siempre auditaba. | `lab-demo/tms-link.ts`: solo la primera constancia (`cancellation_requested_at IS NULL`) actualiza y audita. |

## 2. Qué demuestra la prueba (`scripts/ci/pricesmart-demo/pricesmart-flow.e2e.ts`, 12 casos, MariaDB real)
Recepción HTTP con evidencia M2M → contrato provisional → persistencia cifrada + evento + outbox → despachador real de API-07 con **cuenta de worker de mínimo privilegio** → vinculación al TMS de laboratorio → consulta de estado (`confirmsDelivery:false`) → solicitud de cancelación (solo constancia; no cancela solicitud/plan/viaje).
F1 mínimo privilegio · F2 fallo transitorio → RETRY → recuperación → DONE · F3 reprocesado sin duplicar · F4 caída del procesador (lease vencida, fencing) · F5 concurrencia (3 despachadores, 6 órdenes) · F6 reintentos agotados → REVIEW durable · F7 cancelación idempotente · F8 cancelar antes de vincular · F9 aislamiento entre empresas y alcance · F10 evidencia caducada/futura/otro entorno/manipulada/revocada/desconocida/replay/cuerpo cambiado · F11 permisos por scope · F12 extremos cerrados.
Unitarias (`outbox-link-handler.test.ts`): el verificador sintético **no puede autorizar PRODUCTION** (despliegue `production` deniega con cualquier combinación de registro/destino), solo emite aserciones `sandbox`, la compuerta de laboratorio se niega con `NODE_ENV=production`/entorno no sandbox/base no loopback/sin bandera, y el registro KMS sigue vacío.

## 3. Clasificación de lo pendiente
- **Defectos de código corregibles por nosotros:** los dos de §1 (corregidos).
- **Funciones implementables sin PriceSmart:** arranque del consumidor de la outbox como proceso del laboratorio (hoy lo orquesta la prueba/despachador; no se instaló en la app para no ampliar alcance); persistencia/outbox de producción (requiere esquema y cuentas reales).
- **Requieren confirmación de PriceSmart:** D02 (mecanismo y formato de evidencia M2M, ancla de confianza, audiencia), D06 (contrato de orden definitivo), D08/D09/D12 según el registro del proyecto, identificadores reales de integración, política de cancelación sobre viajes ya programados.
- **Requieren infraestructura de producción:** proveedor KMS/HSM, esquema y cuentas productivas con su política de grants, rotación de claves, autorización de adaptar órdenes de producción al TMS.

## 4. Reproducir
```
node scripts/ci/pricesmart-demo/demo.mjs up
node scripts/ci/pricesmart-demo/demo.mjs e2e scripts/ci/pricesmart-demo/pricesmart-flow.e2e.ts
node scripts/ci/pricesmart-demo/demo.mjs down
```
(`demo.mjs up` ahora también crea la cuenta de worker de laboratorio con los mismos grants mínimos de API-07.)
