# Laboratorio B13 — SQL de resoluciones de incidencias (TMS)

Valida, contra MariaDB 11.8.9 real y desechable (loopback, datos ficticios, sin Hostinger), el SQL de PR #599
(`sql/migrate-2026-11-tms-incidencias-resoluciones.sql`, SHA-256 `89ff95b2…eae0e`, **sin modificar**).
No implementa API ni pantallas. Reutiliza sin cambios las guardas del lab PriceSmart (`../pricesmart-api06a`).

Ejecutar (consola limpia, rama `lab/tms-incidencias-b13`):

    node scripts/ci/tms-incidencias-b13/run-windows.mjs --preflight-only
    TMS_B13_LAB_ACK=SINTETICO-LOCAL-SIN-PRODUCCION-NI-HOSTINGER node scripts/ci/tms-incidencias-b13/run-windows.mjs --run-isolated

Pruebas estáticas: `npx vitest run --config scripts/ci/tms-incidencias-b13/vitest.static.config.mts`

Resultado de la corrida de referencia (run 77d9318e…): 13 PASS / 0 FAIL / 0 SKIP (B13.1–B13.13). La primera corrida
(596409dd…) falló en 9 casos por defectos de las propias pruebas (base no seleccionada, regex de índices, conteo de columnas FK, premisa
de collation); el SQL no se modificó.
Hallazgo: `DEFAULT CHARSET=utf8mb4` sin `COLLATE` usa la collation por defecto del charset, no la de la base; las FK son sobre
columnas numéricas, así que una collation histórica distinta no afecta las claves (B13.7).
