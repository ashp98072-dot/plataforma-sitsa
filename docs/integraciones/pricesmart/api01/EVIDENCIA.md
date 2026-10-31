# API-01 — matriz de pruebas y evidencia sanitizada

Fecha: 2026-10-31 (America/Guatemala). Base `fcae97647e764dcf0219ee2870d77566ce0c8d66`, merge #546 confirmado por Git/GitHub. Windows / Node 24.18.0 / Next 16.4.1. Pruebas aisladas de aplicación con identidad y repositorio falsos; **no persistencia real, autenticación M2M ni aceptación HTTP**.

| Control | Estado | Método / evidencia / límite |
|---|---|---|
| DTO válido y proyección mínima | PASS | Servicio real + puerto simulado, devuelve explícitamente SIMULATED, nunca respuesta HTTP 202 |
| Obligatorios, unknown fields, IDs, club y cotas | PASS | Casos válidos/negativos; IDs 120/121, club 64/65 y cuerpo 65.536/65.537 bytes |
| JSON inválido, claves duplicadas/escapadas, UTF-8/BOM | PASS | Parser real local; errores sólo por código |
| Idempotencia y contenido conflictivo | PASS de modelo | Orden de propiedades equivalente; scope/ID inmutable y snapshot; no prueba UNIQUE/aislamiento MariaDB |
| Dos solicitudes concurrentes iguales/conflictivas | PASS de modelo | Promise.all/allSettled con doble serializado; una orden/evento/outbox. **No prueba dos conexiones/procesos SQL** |
| Dos tenants/clientes mismo ID y case | PASS de modelo | Namespaces separados; IDs case-sensitive, sin normalización. No acredita row-level security del motor |
| Identidad ausente/inválida/revocada, scope/club | PASS de modelo | IdentityPort falso, reconsulta por operación. Ninguna cabecera ficticia ni credencial real |
| GET/cancel ajenos e inexistentes | PASS de modelo | NOT_FOUND igual; no se revela payload ni IDs internos |
| Cancelación inexistente/repetida/conflictiva/concurrente | PASS de modelo | Solicitud de estado, motivo enumerado y snapshot; no aplica cancelación final ni modifica TMS |
| Estados inválidos/vínculo/terminal | PASS | Grafo puro y negativos del servicio; estados TMS/PriceSmart no equivalentes |
| Fallos insert/evento/auditoría/outbox/commit | PASS de modelo | Rollback del doble y error UNAVAILABLE sin texto SQL simulado; reintento conserva una orden |
| Commit incierto y espera de confirmación | PASS de modelo | Commit simulado seguido de error → sin éxito; retry encuentra una orden. Promesa de recepción no resuelve antes de promesa de repositorio. No prueba fsync/caída real |
| Contrato deshabilitado por defecto | PASS estático/unitario | Sin route.ts/imports desde aplicación; helper siempre 503/DISABLED incluso con variable de activación aparente. No request HTTP ni build Next real |
| OpenAPI y DTO | PASS de comprobación limitada | Parseo JSON, refs locales, igualdad con z.toJSONSchema de Zod instalado, operaciones POST/GET y cancel/auth pendientes. **No linter completo OpenAPI 3.1 ni aprobación del wire contract** |
| DDL separado/bloqueado | PASS estático | SIGNAL inicial, UNIQUE compuesto binario propuesto y ausencia de comandos de instalación/usuarios/grants. **No sintaxis/constraints probados en motor** |
| Ausencia de I/O productivo en módulos API-01 | PASS del alcance aislado | Nuevos módulos sólo importan Zod/crypto y puertos; no driver, filesystem, TMS, fetch, console o activación por env. Guard de red S02 reinstalado por test. No SQL ni almacenamiento externo |
| Nuevos tests API-01 | PASS | 45 casos en 2 archivos Vitest; fixtures en memoria, sin conexiones SQL ni escrituras reales de negocio |
| Regresión S02–S05 | PASS | 330 casos heredados, límites originales de fixtures/mocks mantenidos |
| Total Vitest | PASS | 16 archivos, 375 casos, cero omitidos |
| Regresión S06-A | PASS | Node test runner independiente, 12 casos, cero omitidos |
| Total local | PASS | 387 = 375 Vitest + 12 Node; no una suite de integración funcional |
| TypeScript | PASS | `--noEmit --incremental false`, exit 0 |
| ESLint del alcance | PASS | `--max-warnings 0`, exit 0 |
| Diff/alcance | PASS | Sólo archivos nuevos API-01; sin negocio/TMS/contabilidad, S02–S06-A, SQL baseline/migraciones, configuración, lock ni #541 modificados |
| MariaDB real, transacciones, constraints, dos conexiones/procesos | NO EJECUTADA | Requiere instancia completamente nueva y autorización posterior; S04 no se desbloquea |
| Persistencia durable, cifrado, disco/fsync y crash recovery | NO EJECUTADA | No hay adaptador real ni infraestructura autorizada |
| M2M, HTTP, replay/abuso distribuido, navegador y TLS | NO EJECUTADA | Sin contrato/auth/limitador/transporte activo; no sustituidos por dobles |
| Build Linux, systemd, firewall, recuperación S06 | NO EJECUTADA | Pendientes originales preservados; tampoco se ejecutó Next build Windows |
| Adaptador/materialización TMS, planes/rutas/entregas/KPI | NO EJECUTADA | Sólo especificación; sin invocaciones ni cambios de reglas |

## Comandos reproducibles ejecutados

Desde rama API-01 con dependencias del lock ya disponibles:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.pricesmart-api01.config.mts
node --test scripts/sandbox-s06a/preflight.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/lib/integrations/pricesmart vitest.pricesmart-api01.config.mts --max-warnings 0
git diff --check
```

Salida Vitest: `Test Files 16 passed (16)`, `Tests 375 passed (375)`. Salida Node: `tests 12`, `pass 12`, `fail 0`, `skipped 0`. Las dependencias ya disponibles de S06-A se reutilizaron mediante junction local ignorada; no se instaló/descargó nada. No se ejecutó la colección Postman ni se enviaron solicitudes de aceptación HTTP. Las regresiones originales pueden crear temporales sintéticos locales; eso no es escritura SQL ni de negocio. Los tests API-01 mutan exclusivamente el repositorio falso en memoria y leen fuentes/contrato para comprobaciones estáticas.

Tras commit, obtener diff completo y nombres:

```sh
git diff --name-status fcae97647e764dcf0219ee2870d77566ce0c8d66...HEAD
git diff --binary fcae97647e764dcf0219ee2870d77566ce0c8d66...HEAD
```

El PR entrega SHA y diff; no se guarda diff autorreferente. El trabajo principal con cambios ajenos permanece intacto en otro checkout. Ningún resultado PASS de dobles certifica integración PriceSmart, autenticación, almacenamiento o TMS reales. D01–D16 siguen pendientes y las preguntas no fueron enviadas a terceros. Sin merge, despliegue, Hostinger, SQL, conexiones productivas ni desbloqueo S04.
