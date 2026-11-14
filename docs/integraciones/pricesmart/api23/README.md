# PriceSmart API-23 — flujo funcional extremo a extremo (laboratorio sintético y aislado)

**Estado: IMPLEMENTADO, VERIFICADO TÉCNICAMENTE y PROBADO contra MariaDB 11.8.9 real desechable.** NO aprobado para producción. Endpoints `503 DISABLED`, `ready=false`, `authorizesInstallation=false`, `REVIEWED_KMS_ADAPTERS` vacío, guardas `sandbox_api02_*` intactos, sin datos ni credenciales reales, sin SQL productivo, sin Hostinger, sin viajes reales.

## 1. Brecha encontrada y corregida (causa exacta)
| # | Hallazgo | Causa | Cambio mínimo |
|---|---|---|---|
| 1 | Los eventos de la outbox (API-01/07) se escribían pero **nada los consumía** hacia el TMS de laboratorio; la vinculación solo ocurría por la vía rápida posterior al commit y por los reintentos de API-13. | El despachador (API-07) y la vinculación (API-12/13) nunca se conectaron. | `lab-demo/outbox-link-handler.ts`: manejador de outbox que reutiliza `attemptNow` y `noteCancellation`. Sin capas nuevas. |
| 2 | `noteCancellation` **no era idempotente**: una entrega repetida (la outbox es al-menos-una-vez, y además existe la vía rápida) duplicaba la auditoría. | `UPDATE … COALESCE` siempre «tenía éxito» y siempre auditaba. | `lab-demo/tms-link.ts`: solo la primera constancia (`cancellation_requested_at IS NULL`) actualiza y audita. |

## 1b. Corrección tras la auditoría independiente (PR #622)
- **Pérdida de auditoría:** la primera versión actualizaba el vínculo y *después* llamaba a `registrarAuditoria`, que **oculta sus errores**. Si la auditoría fallaba, la constancia quedaba sin auditoría y ninguna entrega posterior la reescribía. Ahora el vínculo y la auditoría (`registrarAuditoriaTx`, que sí propaga el error) se confirman **en una sola transacción**: si la auditoría falla se revierte todo, la excepción llega a la outbox (RETRY, nunca DONE) y el reintento recupera la constancia.
- **Concurrencia:** lectura con bloqueo (`FOR UPDATE`) de la fila del vínculo y UPDATE por clave; solo quien la encuentra sin constancia audita. Se descubrió con la prueba concurrente que un UPDATE con JOIN y la propia lectura bajo REPEATABLE READ fallan con `ER_CHECKREAD` en MariaDB 11.8; se reintenta (máx. 5) en una transacción nueva ante `ER_CHECKREAD`/deadlock/espera de bloqueo.
- **Pruebas:** F7b (vínculo actualizado → auditoría falla 2 veces → outbox reintenta sin DONE → recupera → exactamente 1 auditoría; reprocesar no duplica) y F7c (4 llamadas simultáneas + 2 despachadores → 1 constancia, 1 auditoría). Ver también el diagnóstico de salida `PS_DEMO_TAIL` de `demo.mjs`.

## 1c. Suite global: base vs HEAD (mismo entorno, sin tocar archivos)
Base `2dce738e` vs HEAD del PR: fallan en ambos 68 pruebas (históricas: flota, tms, compras, rrhh…); en HEAD aparece solo 1 (`factura-emitida.test.ts` «INERTE», un barrido de archivos que agota el tiempo bajo carga; **pasa 24/24 en aislado**) y solo en base 2 (`borradores/controlador` y `m2m-security`, igualmente dependientes de carga/tiempo). Sin regresiones atribuibles a #622.

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
