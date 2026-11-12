# PriceSmart API-14 — runtime con seguridad por defecto y despliegue controlado

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE (pruebas unitarias, tsc, ESLint). NO aprobado para producción.** Producción sigue en 503 `DISABLED`: el ensamblaje no tiene ningún punto de llamada en la aplicación (hay una prueba estática que lo vigila).

## Qué se añadió
- `runtime-config.ts` — configuración **pura** y validada (`parseRuntimeConfig(env)`): modo `DISABLED` (por defecto) / `READ_ONLY` / `ENABLED`, límites y política antiabuso acotados, confirmación explícita para `ENABLED`, decisiones ratificadas declaradas por el operador. Un error produce modo cerrado y nombra variables, nunca valores.
- `runtime-assembly.ts` — `evaluateReadiness` (informe de bloqueos sin secretos), `withRuntimeControls` (modo + interruptor de emergencia evaluado en cada solicitud; si no se puede leer, cierra) e `installControlledRuntime` (valida → sondas de salud con tiempo límite → solo entonces instala; si algo falla, deja el handler en `null`).

## Revisión: qué existe (API-01 a API-13)
1. **Implementado y probado** (unitario + MariaDB local desechable): contrato de órdenes y errores (API-01/04), repositorio MariaDB con idempotencia y aislamiento por tenant (API-05/06), outbox y adaptación al borrador TMS (API-07/09), puertos de seguridad M2M atómicos — catálogo, revocación, contador, replay (API-11), transporte HTTP aislado con límites y tiempos (API-04/11).
2. **Solo laboratorio**: `lab-demo/*` (HMAC de prueba, cifrado con clave por ejecución, contrato `lab-demo-1`, mapeo a usuario de servicio inactivo, vínculo TMS y reintentos de API-12/13), arnés E2E, Postman de laboratorio. La composición se niega fuera de `sandbox_api02_*` en loopback.
3. **Decisiones que debe confirmar PriceSmart**: D02 (mecanismo M2M/evidencia criptográfica), D06 (contrato de orden definitivo), D08, D09, D12 (según el registro del proyecto) y todo dato concreto: endpoints, certificados, identificadores de integración. Este PR no inventa ninguno.
4. **Implementable sin esas confirmaciones** (hecho aquí): configuración validada, modos de despliegue gradual, interruptor de emergencia, sondas de salud y bloqueos explícitos por decisión pendiente.

## Bloqueos que el código reporta hoy (deliberados)
- `DECISION_PENDING` mientras `PRICESMART_RATIFIED_DECISIONS` no incluya lo requerido (`READ_ONLY`: D02, D06; `ENABLED`: D02, D06, D08, D09, D12 — **supuesto conservador de este PR**, ajustable).
- `PRODUCTION_ENVIRONMENT_NOT_MODELED`: el contrato de seguridad (`targetSchema`) solo admite `environment: 'sandbox'`; `production` requiere una decisión y un cambio de contrato.
- Limitación detectada, **no modificada**: `mariaDbOrderRepository` exige hoy un usuario `sandbox_api02_*`; una composición real necesitará relajarlo bajo una decisión explícita.
- Faltan los puertos reales (verificador D02, cifrado con gestión de claves, cuenta de base de datos de ejecución, interruptor y sondas concretos).

## Variables (todas opcionales; sin `PRICESMART_RUNTIME_MODE` el runtime queda apagado)
`PRICESMART_RUNTIME_MODE`, `_ACK` (= frase de confirmación para `ENABLED`), `_RUNTIME_ENVIRONMENT` (`sandbox`), `PRICESMART_ORIGIN_CLUB`, `PRICESMART_DB_SCHEMA`, `PRICESMART_DB_RUNTIME_USER`, `PRICESMART_RATIFIED_DECISIONS` (p. ej. `D02,D06`), y límites numéricos (`_TIMEOUT_MS`, `_MAX_BODY_BYTES`, `_MAX_EVIDENCE_BYTES`, `_RATE_PER_WINDOW`, `_RATE_WINDOW_MS`, `_MAX_PROOF_AGE_MS`, `_FUTURE_SKEW_MS`, `_REPLAY_RETENTION_MS`). Este PR no define ni cambia ningún valor en ningún entorno.

## Pasos de despliegue controlado (futuros, requieren autorización)
`DISABLED` → `READ_ONLY` (solo GET) → `ENABLED`, con el interruptor de emergencia disponible en cada paso y las sondas de salud en verde.
