# Cierre del flujo operativo y cancelaciones (parte interna)

Estado: **VERIFICADO TÉCNICAMENTE** en el laboratorio (MariaDB 11.8.9 real, CI Linux). No está probado con PriceSmart ni aprobado para producción. Método HTTP de cancelación (D09) y entrega confirmada (D13) siguen sin ratificar; la API externa sigue provisional.

## 1. Cadena verificada sobre el código real
`POST` → recepción durable → adaptación → solicitud del TMS → programación → viaje → estados → `GET`.
| Requisito | Dónde está y cómo se prueba |
|---|---|
| Sin solicitudes duplicadas (órdenes repetidas, concurrencia) | `tms-link.ts` (`linkLocked`: bloqueo `GET_LOCK` por orden + `claim_token` UNIQUE + `uq_ps_api12_solicitud`); E2E `DEMO.4`, `DEMO.8` (6 POST simultáneos → 1 solicitud), `F3`, `F5` |
| Reintentos sin duplicar | `link-retry.ts` + recuperación por token; E2E `API13.*`, `NM.3`, `NM.4`, `F4` |
| Respeta empresa, cliente y club | mapeo administrativo `ps_api12_tms_mapping` (empresa/cliente/usuario del TMS); catálogo M2M con clubes cerrados (`ps_api11_*`); E2E `DEMO.5`, `DEMO.11`, `F9`, `F11`, `C4` |
| Errores de adaptación recuperables | trabajo `BLOCKED`/`EXHAUSTED` con `last_outcome` y reclamo conservado; bandeja de Operaciones (`ops-view.ts`); E2E `NM.1–NM.5`, `H2`, `DEMO.10` |
| Cambios operativos reflejados en el GET | `tms-link.ts::status` + `projectExternalStatus`; E2E `DEMO.6`, `H3` (cada estado del plan) |
| Ningún estado se confunde con entrega | `confirmsDelivery:false` siempre; sin estado «entregada»; `H3`, `cancelacion-entrega.test.ts` (D13) |
| Auditoría y trazabilidad por orden | `ps_api01_events/audit`, `auditoria` (`pricesmart_cancelacion_solicitada`, `pricesmart_cancelacion_resuelta`); `F2`, `DEMO.7` |

**Enlace faltante encontrado (único):** la cancelación se recibía, evaluaba y mostraba, pero no existía el **resultado de la revisión de Operaciones** (quién resolvió, cuándo, qué se decidió) ni forma de consultarlo. Se corrige a continuación; el resto de la cadena ya estaba completo y probado.

## 2. Cancelaciones
Ya existente: recepción durable e idempotente (`noteCancellation`: `FOR UPDATE`, una sola constancia y una sola auditoría aunque haya consumidores concurrentes), evaluación del estado operativo (`assessCancellation`: protege viajes `En ruta`, `Descargado`, `Cerrado`), nunca cancela automáticamente (`automatic:false`).

Nuevo (`lab-demo/cancellation-resolution.ts`, `resolveCancellation`):
- La fija **una persona de Operaciones** (ruta `POST /api/empresas/[slug]/tms/solicitudes-clientes/pricesmart/cancelacion`, permiso Programación/editar; la empresa sale de la sesión). Quedan quién, cuándo y nota.
- `EXECUTED` solo si el **TMS ya refleja** la cancelación/rechazo (verificado contra el estado real); `NOT_EXECUTED` exige nota y se rechaza si el TMS ya está cancelado. Este módulo **no cancela nada**: la cancelación real sigue siendo una acción humana existente de Programación.
- Idempotente y concurrente: la primera resolución gana; resolución y auditoría en **una transacción**; no se sobrescribe.
- `GET` expone `cancellation.resolution` ∈ `PENDING | EXECUTED | NOT_EXECUTED` (provisional, OpenAPI actualizada); nunca expone quién ni la nota.
- Bandeja de Operaciones: botones «Ya cancelada en el TMS» / «No procede» y etiqueta de resultado (`solicitudes-clientes-bandeja.tsx`).

Pruebas: `cancellation-resolution.test.ts` (unitarias, 6), `scripts/ci/pricesmart-demo/cancellation-resolution.e2e.ts` CR.1–CR.6 (MariaDB real: PENDING, nota obligatoria, TMS sin cambios, rechazo previo = EXECUTED, viaje en ruta/descargado protegido, 8 resoluciones concurrentes → una gana, aislamiento por empresa, CHECK de la tabla).

## 3. Cambio de esquema (SIN migración en producción)
`docs/integraciones/pricesmart/api12/staging-tms-link.sql.in` añade a `ps_api12_tms_links` las columnas `cancellation_resolution`, `cancellation_resolved_by`, `cancellation_resolved_at`, `cancellation_resolution_note` y cuatro `CHECK`. Las tablas `ps_api12_*` **no existen en producción** (solo en laboratorio y en el sandbox que crea `provision.mjs`, que las crea ya con las columnas), por eso no hay `ALTER` ni migración. Privilegio de la cuenta de aplicación: `UPDATE(...)` solo de esas columnas (`bundle.mjs`, `ROLE_POLICY.app`). **Si algún día se instalaran antes de este cambio**, habría que ejecutar manualmente (con autorización) un `ALTER TABLE` equivalente; no se incluye porque no aplica.
- Preflight (solo lectura): `SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '<sandbox>' AND TABLE_NAME = 'ps_api12_tms_links';` → 0 antes de aprovisionar.
- Postcheck (solo lectura): `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '<sandbox>' AND TABLE_NAME = 'ps_api12_tms_links' AND COLUMN_NAME LIKE 'cancellation_%' ORDER BY COLUMN_NAME;` → 5 columnas (`…_requested_at` + las 4 nuevas).

## 4. Límites
Método HTTP, motivos y reglas definitivas de cancelación (D09), entrega confirmada (D13) y contrato JSON (D06) siguen pendientes de PriceSmart. Las pruebas usan el verificador M2M de laboratorio y dobles del TMS.
