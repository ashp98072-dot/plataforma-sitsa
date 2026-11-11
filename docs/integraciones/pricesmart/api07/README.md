# PRICESMART API-07 — despachador de la outbox

Base: `main` `26b5df5b` (con API-06A fusionado). Sin endpoints, sin worker en ejecución, sin SQL aplicado, sin migraciones, sin integración externa real. D01–D16 siguen PENDIENTES.

## Qué quedó funcional (lógica, con pruebas)
- `outbox.ts` — `OutboxDispatcher.runOnce()`: reclama un lote con **lease**, invoca al `OutboxHandler` y cierra cada evento con **fencing** (`attempts` como ficha: solo el titular del intento vigente puede cerrar). Reglas de PERSISTENCIA §10: nunca `DONE` sin confirmación explícita del handler; salida inválida → `REVIEW`; **agotar intentos → `REVIEW` durable, nunca se descarta**; backoff exponencial acotado; la excepción del handler no se registra (solo códigos). Sin temporizadores periódicos.
- `outbox-mariadb.ts` — `mariaDbOutboxStore`: implementación sobre `ps_api01_outbox` (`FOR UPDATE SKIP LOCKED`, reloj de la base, `attempts+1` al reclamar, cierres con `status='LEASED' AND attempts=?`). Un evento ilegible/huérfano pasa a `REVIEW` en la misma transacción para no bloquear el lote. Mismos guardas que el adaptador API-02 (pool verificado, `sandbox_api02_*`, identidad SQL antes de `BEGIN`). **Sin cambios de esquema:** usa las columnas existentes del DDL de API-06A.
- `outbox-adaptation-handler.ts` — puente **sintético** a la adaptación TMS de API-05 (`RECEIVE`/`CANCEL`); solo acepta garantía `SIMULATED` y no crea ninguna solicitud operativa.

## Verificación
- 87 pruebas nuevas: despachador sobre un modelo en memoria de la outbox (lease vencida, fencing, REVIEW, backoff, aislamiento por alcance, lotes, fallos de almacén), protocolo SQL con dobles del driver y circuito completo orden → outbox → despachador → adaptación sintética. Suite PriceSmart completa: 419/419; `tsc` sin errores en los archivos nuevos; ESLint limpio.
- **NO validado contra un motor real.** `SKIP LOCKED`, bloqueos y concurrencia entre procesos solo se prueban con dobles (SIMULATED). La validación real requiere extender el laboratorio de API-06A (cuenta de worker con `SELECT` en outbox/events/orders —columnas necesarias— y `UPDATE (status, attempts, next_attempt_at, lease_until)`; casos nuevos B10) y la autorización expresa del propietario para ejecutarlo.

## Qué depende de decisiones externas
- **Materializar en el TMS** (crear la solicitud/viaje): D05 (entregas), D06 (diccionario de campos: el DTO actual no trae destinatario, dirección ni fechas), D08 (estados), D09 (cancelación). El puente sintético se sustituirá por un handler real; el despachador no cambia.
- **Autenticación M2M y exposición HTTP** (D02, D10–D12): fuera de este cambio.
- Los parámetros de `DEFAULT_OUTBOX_POLICY` (lote 10, lease 30 s, 8 intentos, backoff 1 s–5 min) son **provisionales**, no vienen de ninguna decisión.

## Extensión del laboratorio (B10) — PREPARADA, NO EJECUTADA
Rama apilada sobre API-07. Añade al arnés de API-06A el bloque **B10.1–B10.8** (almacén y despachador de la outbox contra MariaDB real) y una **cuenta de worker separada** (`sandbox_api02_w<id>`, contraseña propia, solo 127.0.0.1) con privilegios mínimos: `SELECT` en `novalvion_environment`; `SELECT` + `UPDATE (status, attempts, next_attempt_at, lease_until)` en `ps_api01_outbox`; `SELECT` solo de las columnas necesarias en `ps_api01_events` y `ps_api01_orders`. Sin INSERT/DELETE, sin DDL, sin payload cifrado. La cuenta de ejecución y B1–B8 no cambian.
- B10.1 claim con lease · B10.2 dos despachadores concurrentes → lotes disjuntos sin esperarse (`SKIP LOCKED`) · B10.3 fencing tras vencer la lease · B10.4 retry/backoff · B10.5 REVIEW durable · B10.6 despachador de punta a punta (DONE x2 eventos y REVIEW por `MAX_ATTEMPTS`) · B10.7 privilegios efectivos del worker (denegaciones y `SHOW GRANTS`) · B10.8 aislamiento multiempresa/club.
- Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE de forma estática** (217 pruebas del arnés, `tsc`, ESLint). **B10 NO se ha ejecutado contra ningún motor**; los resultados de API-06A (ejecución 4) no incluyen B10. Ejecutarlo exige preflight y autorización expresa del propietario.
