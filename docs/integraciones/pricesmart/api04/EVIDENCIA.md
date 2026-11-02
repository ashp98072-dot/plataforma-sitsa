# API-04 — evidencia técnica sanitizada

Fecha: 2026-11-02, America/Guatemala. Base `e05afa76` de origin/main, merge #549/API-03. Rama independiente `feature/pricesmart-api04`. Evidencia de lógica en proceso, NO aceptación HTTP real ni certificación de gateway/M2M/durabilidad. D01–D16 pendientes.

## PASS/FAIL disponible

| Verificación | Resultado | Alcance / límite |
|---|---|---|
| Pruebas nuevas del manejador | PASS: 95 casos | Request/Response nativos sintéticos, sin servidor/listener; dominio API-01 concreto y puertos falsos |
| Documento OpenAPI y contrato | PASS: 5 casos | Referencias locales, flags de no ejecución, paths/métodos candidatos, igualdad de DTO con Zod y matriz de rechazo. No linter/certificación completa OpenAPI |
| Regresión API-01/API-02/API-03 y S02–S05 | PASS: 501 casos heredados | Controles offline previos sin debilitamiento; sus simuladores no se convierten en pruebas físicas |
| Total Vitest | PASS: 20 archivos, 601 casos, cero fallos/omitidos | Configuración heredada con guard de red S02 reinstalado por caso |
| Preflight S06-A | PASS: 12 casos | Runner Node, validación documental; no Linux autorizado |
| TypeScript | PASS, exit 0 | --noEmit --incremental false |
| ESLint | PASS, exit 0, cero warnings | Código/test nuevos y extensión M2M |
| Diff | PASS | diff --check; sin cambios a rutas/app, S02–S06-A, API-01/API-02, S04/grants, package/lock o #541 |

Se añade únicamente una derivación de target de catálogo al módulo API-03; mantiene procedencia de handle, sandbox, club, revocación y namespace. Sin cambiar authenticate/authorize/admit ni su política. El manejador crea el motor API-03 concreto y OrderApplication concreto mediante puertos; no acepta un Principal de Request o una función de aplicación que omita controles.

## Qué simulan los positivos

La suite usa ModelRepository API-01 (memoria, rollback/UNIQUE/CAS simulados) detrás de un wrapper definido SÓLO en el test que DECLARA durability=DURABLE para recorrer la rama 202 y la espera de la promesa. Contador y replay de prueba también DECLARAN garantías distribuidas/durables para recorrer esa rama. Esas declaraciones son deliberadamente ficticias, NO evidencia de persistencia, transacciones, revocación, criptografía o rate limiting distribuidos. Los casos SIMULATED/UNKNOWN/incompletos se rechazan explícitamente.

La extracción de evidencia y el verificador son dobles privados del test: identifican casos por un header x-fixture-id y bytes opacos; NO se exporta parser de ese header en runtime, no son credenciales utilizables por HTTP real, no se crea token/certificado válido. El Request usa example.invalid sólo como URL de datos; nunca se hace fetch a ese dominio. Las pruebas de concurrencia y replay usan Map/Set/modelo local y se denominan simulación. Los casos de commit tardío/incierto son promesas/modelo, NO pruebas de caída o fsync.

No se ejecuta una composición real de repositorio MariaDB, proveedor M2M, catálogo o contador. Esperar el resultado DURABLE y verificar proyección sólo prueba el filtro del contrato; una implementación inyectada que mienta no puede certificarse por ese literal. Antes de exponer, se exige el repositorio API-02 con conexión S02 verificada y validaciones físicas, proveedores reales aprobados y gates independientes.

## Cobertura comprobada

| Grupo | Positivos / negativos |
|---|---|
| Operaciones | Recepción 202, GET 200, solicitud de cancelación 202; estados/versión/proyección acotados, sin TMS |
| Secuencia | Transporte antes de evidencia; verificador antes de catálogo; autorización/revocación antes de contador/nonce; claim antes del dominio; nueva comprobación IdentityPort antes de repositorio |
| Identidad/autorización | Ausente/inválida/expirada/revocada, catálogo desconocido/ambiguo/incompleto, scopes create/read/cancel insuficientes, club ajeno, remapeo de namespace y Principal fabricado |
| Multiempresa | x-tenant/client/club no confieren autoridad; DTO con tenant extra rechazado; consultas de orden ajena/inexistente dan NOT_FOUND indistinguible; club real de fila comprobado por API-01 |
| Formato malicioso | JSON malformado/nulo/array/incompleto, claves duplicadas literales/escapadas, campos extra, UTF-8 inválido/BOM, charset/media/encoding no admitidos, Content-Length ambiguo o falso |
| Transporte | URL/headers/cuerpo/chunks acotados, body lento/roto/consumido, abort, GET sin cuerpo, métodos incorrectos, path manipulado/percent-encoded, query/fragment, Accept no admitido, cancelación de body incluso tras rechazo temprano |
| Replay/idempotencia | ProofId reutilizado se rechaza antes del dominio; nueva prueba y misma orden conserva snapshot; cancelación repetida conserva snapshot; contenido conflictivo se rechaza; concurrencia de dos llamadas sólo simulada |
| Fallos | Extractor/verificador/catálogo/revocación/contador/claim/repositorio fallan cerrado; revocación tras claim y tras admisión; errores de evento/auditoría/outbox/commit y commit posterior simulado |
| Durabilidad/proyección | No confirmar SIMULATED en POST/GET/cancel; no invocar dominio si antiabuso SIMULATED; esperar promesa de commit; rechazar envelope vacío/UNKNOWN/extra, ID distinto, UUID/versión/estado incoherentes y versión inicial imposible de cancelación |
| Timeouts | Body -> 408 y cancel reader; dependencia/commit -> 503 sin recibo; proveedor tardío no inicia catálogo/repositorio; commit tardío no cambia respuesta ni reintenta |
| Errores/respuestas | Códigos cerrados sin SQL/stack/secretos, correlación generada y no reflejada, receipt inmutable, Allow cerrado, Cache-Control no-store/private y sin cookies |
| No exposición/red | Helper Next heredado DISABLED aun con PRICESMART_ENABLED aparente; sin imports desde src/app, sockets/clientes/red/SQL nuevos. Guard S02 deniega conexiones durante regresión |

## Comandos ejecutados

Desde `.worktrees/pricesmart-api04`, con dependencias ya disponibles en el workspace padre:

```powershell
node ../../node_modules/vitest/vitest.mjs run --config vitest.pricesmart-api01.config.mts
node --test scripts/sandbox-s06a/preflight.test.mjs
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
node ../../node_modules/eslint/bin/eslint.js src/lib/integrations/pricesmart/http-transport.ts src/lib/integrations/pricesmart/http-transport.test.ts src/lib/integrations/pricesmart/http-contract.test.ts src/lib/integrations/pricesmart/m2m-security.ts --max-warnings 0
git diff --check
```

Se conserva el nombre de configuración API-01: su glob incluye API-01–API-04 y S02–S05. S06-A corre por separado. Vitest instalado 4.1.11; package.json de base solicita 4.1.12. No se instalaron/descargaron dependencias ni se modificó package/lock. Instalación limpia exacta del lock NO EJECUTADA. No se ejecutó build Next, servidor de desarrollo ni suite general de módulos ajenos al alcance.

## NO EJECUTADAS

| Validación real | Estado / dependencia |
|---|---|
| HTTP de red/Next, raw headers/framing, sockets, proxy/gateway, TLS/mTLS y CORS | NO EJECUTADA; transporte aún no registrado/expuesto, requiere PR y autorización separados |
| OAuth/PKI/firma/audience/expiración/revocación/rotación de credenciales reales | NO EJECUTADA; D02 y proveedor aislado aprobado pendientes |
| Rate limiting distribuido, replay durable, particiones/failover/recuperación/eviction y carga | NO EJECUTADA; almacén y políticas D10–D12 pendientes |
| MariaDB real, dos conexiones, aislamiento/CAS/UNIQUE/FK/permisos, COMMIT y crash recovery | NO EJECUTADA; instancia NUEVA y perfil API autorizado, S04 intacto |
| Cifrado/retención/custodia de payloads/catálogo/nonces/backups | NO EJECUTADA; políticas D14 y pendientes API-02/API-03 |
| Linux/firewall/artefacto/instalación/sandbox y gates S06-A | NO EJECUTADA; infraestructura y autorizaciones independientes pendientes |

No SQL/migraciones, credenciales PriceSmart, Hostinger/DNS, infraestructura, grants S04, rutas Next/middleware, trabajadores/cron/outbox activos, TMS externo, #541, merge ni despliegue. Los ensayos nativos Request/Response no equivalen a HTTP real, TLS o seguridad de gateway. Entregar para auditoría de ChatGPT antes de continuar.

SHA final y número de PR en la entrega y descripción, sin SHA autorreferente. Diff completo en Files changed y URL `.diff` del PR; reproducción:

```powershell
git rev-parse HEAD
git diff --name-status e05afa76...HEAD
git diff --binary e05afa76...HEAD
```
