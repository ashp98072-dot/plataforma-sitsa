# PriceSmart — correcciones de homologación tras la auditoría independiente

Base: `origin/main` (incluye API-25, API-26 y API-27). **Nada se activa**: runtime `DISABLED`, rutas `503 DISABLED`, `authorizesExternalExposure=false`, `REVIEWED_KMS_ADAPTERS` vacío. No hay SQL, ni despliegue, ni credenciales, ni aprobaciones de PriceSmart simuladas. KPI (D16) queda fuera.

> **La minuta original del 30/10/2026 no está en el repositorio.** Lo que se cita de ella es lo que `api24/MATRIZ-REQUISITOS.md` (D01) y `api25/README.md` ya transcriben. La matriz de trazabilidad debe contrastarse con el original antes de la homologación.

## Hallazgos y correcciones

| # | Punto | Resultado | Cambio |
|---|---|---|---|
| 1 | `NODE_ENV=production` + `NOVALVION_ENV=sandbox` | **Incompatibilidad real, corregida.** `evaluateSandboxExposure` bloqueaba (`PRODUCTION_UNTOUCHED`) todo perfil con `nodeEnv='production'`, aunque el proceso se declarase sandbox; el ensamblaje del runtime (API-26) y el diagnóstico de preparación sí lo admiten porque `next start` fija `NODE_ENV=production` también en el sandbox. Un sandbox real nunca podía quedar sin bloqueantes (el perfil tenía que «mentir» con `production-like-staging`). | `homologation-sandbox.ts`: `declaresProduction(nodeEnv, novalvionEnv)` = `NOVALVION_ENV=production` **o** (`NODE_ENV=production` y `NOVALVION_ENV≠sandbox`). Los procesos que se declaran de producción siguen bloqueados. |
| 2 | Flujo POST → persistencia → outbox → TMS → GET | **Fallo funcional corregido** (ver 2.1) y observaciones (2.2–2.5). | `lab-demo/tms-link.ts`, `lab-demo/link-retry.ts` |
| 3 | Cancelación | Sin defecto en el código; **ahora blindado con pruebas**: pedir una cancelación nunca se muestra como cancelación ejecutada. | `lab-demo/cancelacion-entrega.test.ts` |
| 4 | Confirmación de entrega | Sin defecto; **pruebas nuevas**: no existe estado DELIVERED, nada se publica mientras D13 esté pendiente. Sin cambios de código. | `lab-demo/cancelacion-entrega.test.ts` |
| 5 | OpenAPI y Postman ↔ código | **Defecto corregido:** el OpenAPI no describía las respuestas del runtime cerrado (`503 READ_ONLY`, cabecera `Retry-After: 60`) ni los modos del runtime. | `api25/openapi.homologation.json`; `lab-demo/homologation-openapi.test.ts` |
| 6 | Bloqueo de compilación por Next.js | **No se reproduce** en `main` (Next 16.4.6): `npm run build` termina con éxito. Ver «Compilación». Sin cambios de dependencias. | solo documentación |
| 7 | Matriz de trazabilidad | Entregada. Una prueba falla si cita un archivo que no existe. | `MATRIZ-TRAZABILIDAD.md`, `lab-demo/trazabilidad.test.ts` |

### 1. Prueba de la incompatibilidad
`homologation-sandbox.test.ts` (nuevo bloque «NODE_ENV / NOVALVION_ENV»):
- Con el código anterior la prueba «un sandbox real (`NODE_ENV=production`, `NOVALVION_ENV=sandbox`)» **falla** (`blockers = ['PRODUCTION_UNTOUCHED', 'KMS_ADAPTER_REVIEWED']`); con la corrección solo queda `KMS_ADAPTER_REVIEWED` y la exposición sigue sin autorizarse.
- Una prueba de **consistencia** recorre toda la matriz `NODE_ENV` × `NOVALVION_ENV` y exige que `evaluateSandboxExposure`, `evaluateReadiness` y `buildReadinessDiagnostic` coincidan con la misma regla.
- Siguen bloqueados: `NODE_ENV=production` sin sandbox, y `NOVALVION_ENV=production` con cualquier `NODE_ENV`.

### 2. Flujo POST → persistencia → outbox → TMS → GET
Camino revisado: `orders/route.ts` → `http-transport.ts` (autenticación M2M, autorización, antiabuso, `OrderApplication.receive`) → `mariadb-repository.ts` (insert + evento + outbox + auditoría en UNA transacción) → `homologation/runtime.ts` (`afterCommit` solo despierta al consumidor; el procesamiento es SIEMPRE por la outbox) → `lab-demo/outbox-link-handler.ts` → `lab-demo/tms-link.ts` (`crearSolicitudCliente`) → GET (`readExtra` → `status`).

- **2.1 (corregido) El vínculo con el TMS solo entiende `lab-demo-1`.** `tms-link.ts` convertía `stored.input` a `LabOrderInput` con un `as` sin comprobar. Con otro contrato inyectado (p. ej. el diccionario D06 definitivo, que aún no tiene capa de mapeo) el acceso a `input.recipient.name` lanzaba una excepción que `link-retry` trataba como transitoria (6 intentos con retroceso de hasta 10 min) mientras el GET decía `RECEIVED`. Ahora la comprobación (`labOrderSchema`) se hace **solo donde la traducción hace falta**, es decir, al crear la solicitud: si no coincide, el resultado es `CONTRACT_NOT_MAPPED`, se **bloquea de inmediato** (sin reintentos) y el GET informa `REVIEW_REQUIRED` con `linkIssue.code = CONTRACT_NOT_MAPPED` (cabe en `last_outcome VARCHAR(32)` y en el patrón del OpenAPI). **No afecta** a lo ya existente (corregido tras la revisión de #694, donde la comprobación estaba antes de «ya vinculada»): una orden **ya vinculada** sigue siendo `ALREADY_LINKED`; un **reclamo pendiente** cuya solicitud ya existe en el TMS (recuperación por token) se completa como `LINKED`; el reintento de un reclamo pendiente con una orden `lab-demo-1` crea la solicitud sin duplicar el reclamo; el GET de órdenes vinculadas no usa el contrato; un evento de cancelación de una orden bloqueada termina `DONE` y su evento `RECEIVED` va a `REVIEW` con el código. Si el contrato no es compatible y no hay reclamo, no se escribe **nada**. Las órdenes `lab-demo-1` se vinculan exactamente igual. Pruebas: `lab-demo/contrato-no-mapeado.test.ts` (9).
- 2.2 (informativo) `ps_api01_orders.tms_linked` tiene `CHECK (tms_linked = 0)`: es siempre 0; el vínculo real vive en `ps_api12_tms_links`. Por eso la guarda `order.tmsLinked` de `requestCancellation` nunca se activa y las cancelaciones de órdenes ya vinculadas **sí** se aceptan y se registran (diseño de API-23). No se toca.
- 2.3 (limitación de esta auditoría) Las pruebas con MariaDB real (`scripts/ci/pricesmart-demo/*.e2e.ts`) **no se ejecutaron aquí** (no hay MariaDB en este entorno y ningún workflow de GitHub las corre). Los cambios se probaron con pruebas unitarias y puertos simulados; deben repetirse en el laboratorio antes de homologar.
- 2.4 (informativo, D14) cada GET escribe una fila de auditoría (`ps_api01_audit`): con consulta horaria crece N órdenes × consultas/día; su retención depende de D14.
- 2.5 (informativo, D05) una orden = una entrega = una solicitud = un plan; varias entregas, parciales y reintentos se retienen para revisión.

### 3. Cancelación ≠ cancelación ejecutada (D09)
Pruebas (`lab-demo/cancelacion-entrega.test.ts`): para **todas** las combinaciones solicitud × plan, pedir la cancelación no cambia el estado externo (`proposedStatus` es el mismo con y sin la petición); `CANCELLED` solo aparece si la solicitud del TMS está `CANCELADA` o el plan `Cancelado`; la petición se marca `{requested:true, automatic:false, assessment}`; sin vínculo queda `REQUESTED_NOT_LINKED` y el pedido sigue `RECEIVED`; `noteCancellation` solo escribe el vínculo y la auditoría (jamás toca `tms_solicitudes_cliente`, `tms_planes_viaje` ni paradas) y es idempotente; ningún código asigna `state = 'CANCELLED'`.

### 4. Confirmación de entrega (D13)
Pruebas: no existe estado externo de entrega; toda proyección da `confirmsDelivery:false`, `publishable:false`; con todas las entregas confirmadas por el piloto y plan `Cerrado` el GET sigue `CLOSED_ADMINISTRATIVE` con `deliveryEvidence` informativa (`officialAcceptance: NOT_ACCEPTED_BY_PRICESMART`, `blockedBy: [D13_PENDING]`); parciales, rechazos, incidencias, sin evidencia o confirmaciones incoherentes → `REVIEW_REQUIRED`/`PARTIAL`/`NONE`; tabla ausente → `UNAVAILABLE` (nunca «sin entregas»); D13 no es una decisión que habilite el runtime ni existe un parámetro que la «ratifique»; ninguna fuente ni el OpenAPI/Postman contienen `DELIVERED`.

### 5. OpenAPI / Postman
Ya estaban atados al código (rutas, estados, veredictos, evidencia). Defecto hallado y corregido: el runtime cerrado (`withRuntimeControls`) responde `503 {code: DISABLED|READ_ONLY}` con `Retry-After: 60`, pero el OpenAPI no listaba `READ_ONLY` ni la cabecera. Se añadieron `READ_ONLY` al enum de errores, la cabecera `Retry-After` en `Error503` y `x-runtime-modes`. **`Retry-After` es CONDICIONAL** (corregido tras la revisión de #694): solo lo añade el envoltorio del runtime al cerrar (interruptor de emergencia, modo DISABLED o POST en READ_ONLY); NO lo envían los 503 propios del transporte (`UNAVAILABLE`, `DISABLED` de la aplicación) ni el estado cerrado por omisión (sin runtime instalado, que es el de hoy). El OpenAPI lo marca `required: false` + `x-conditional`, y una prueba de comportamiento real lo verifica en cada camino de cierre y su ausencia en los demás. La colección Postman no declara cabeceras de respuesta, así que no cambia (DISABLED / READ_ONLY / ENABLED, `PROVISIONAL_LAB`). Pruebas nuevas: la lista de códigos de `Error` es **exactamente** el conjunto que el código puede emitir (transporte + runtime cerrado), el valor de `Retry-After` es el del código y los modos son `RUNTIME_MODES`. La documentación sigue distinguiendo lo provisional (`x-contract-status`) y no anuncia un servicio accesible.

### Compilación (Next.js)
`api27/README.md` documentó que el build fallaba con `SecurityFatalError` (aviso del registro sobre Next 16.4.1). Desde entonces `main` pasó a **Next 16.4.6** (`e833334d` package.json, `85f574d8` package-lock). Verificado en esta auditoría con un árbol limpio: `npm run build` → compilación correcta, TypeScript correcto, 54 páginas, **exit 0**. No se modificó ninguna dependencia.
**Prueba obsoleta relacionada (no corregida aquí):** `src/next-config-build-workers.test.ts` sigue exigiendo `next@16.4.1` y el script de build `next build`, pero `main` usa `16.4.6` y `node scripts/next-command.mjs build`; por eso falla en `main` limpio (2 de sus 5 pruebas). Corrección propuesta, para decidir con el propietario en un PR aparte (no toca dependencias): que la prueba lea la versión fijada de `package.json` (y el comando de build real) en lugar de la constante `16.4.1`, manteniendo todas las demás comprobaciones del límite de build (`cpus=1`, esquema oficial, headers).

Corrección segura si el bloqueo reaparece (con otra versión o aviso): (1) `npm ci` con el lockfile versionado, nunca `npm install` ni editar `node_modules`; (2) **no** desactivar la comprobación ni saltarse el aviso; (3) subir solo a la versión parcheada indicada en el aviso mediante un PR de dependencias aparte, autorizado por el propietario, con `npm run build` y la suite completa; (4) hasta entonces, no desplegar ese commit. Observación no bloqueante: el build emite avisos de Turbopack «Dynamic filesystem access» (`src/lib/uploads.ts` e importadores, incluida la página de Canecas desde #692); ya existían para otras rutas.

## Pruebas ejecutadas
- `npx vitest run src/lib/integrations/pricesmart` → 1018 pruebas (47 archivos) en verde (antes 994; +24 nuevas).
- `npx tsc --noEmit` y `npx eslint src/lib/integrations/pricesmart` limpios; `npm run build` exit 0.
- **Suite completa del repositorio** (`npx vitest run`): 17 091 pruebas, **71 fallan en 18 archivos** (`flota/*`, `tms/planes/*`, `compras/*`, `next-config-build-workers`, …), **ninguno de PriceSmart**. Las **mismas 71** fallan en un `origin/main` limpio (comprobado en un árbol aparte), así que este PR no introduce regresiones; no se corrigieron (fuera de alcance).
- **E2E con MariaDB 11.8.9 real en GitHub Actions** (`pricesmart-lab.yml`): 102 pruebas en verde en 4 fases (65 + 19 + 17 + 1). Ver la sección siguiente. **No se afirma homologación completa.**

## Bloqueantes pendientes (ninguno lo resuelve este PR)
D02 (verificador/autenticación) · D06 (diccionario definitivo **y capa de mapeo hacia la solicitud TMS**, ver 2.1) · D09 (método de cancelación) · D13 (entrega confirmada) · D05, D07, D08, D10, D11, D12, D14, D15 · adaptador KMS/HSM revisado · infraestructura del sandbox (host MariaDB dedicado, dominio, TLS, allowlist, monitoreo, gestor de secretos) · aprobación humana de `evaluateSandboxExposure` sin bloqueantes y autorización de despliegue · contraste de la matriz con la minuta original.

## Ciclo completo con MariaDB 11.8.9 — E2E en GitHub Actions (CI)
**Estado: VERIFICADO TÉCNICAMENTE en CI contra MariaDB 11.8.9 real (laboratorio sintético desechable), con alcance acotado.** No es aprobación de PriceSmart ni de producción. Las E2E ejercitan la composición del laboratorio (verificador M2M y TMS sustituidos por dobles de prueba), no el verificador real de PriceSmart.

**Cómo se ejecuta.** `.github/workflows/pricesmart-lab.yml` (se dispara con cambios en PriceSmart, en `scripts/ci/pricesmart-demo`, `sql/`, el workflow o `package-lock.json`, y a mano con `workflow_dispatch`). Instala MariaDB **11.8.9 exacta** desde el repositorio apt oficial firmado (huella de la llave verificada; versión del binario comprobada por el runner y hash SHA-256 opcional), levanta una instancia **desechable** solo en socket Unix y `127.0.0.1`, ejecuta las pruebas unitarias y luego `node scripts/ci/pricesmart-demo/run-linux.mjs`. Sin secretos del repositorio, sin base de producción, sin Hostinger, `permissions: contents: read`. Todo (instancia, datos, directorio de ejecución) se destruye al final.
- `run-linux.mjs` es el equivalente **Linux** de `demo.mjs`; **`demo.mjs` y el arnés de Windows no se tocaron**. Reutiliza `pricesmart-api06a/*` (manifiesto, aislamiento, DDL del laboratorio), `api12/api13DdlStatements` importados de `demo.mjs`, y copia sin cambios el esquema/semilla de `portal-e2e/harness.mjs` y `prepareHomologation`. Solo es propio de Linux: arranque del motor (`install-db`, socket, `lower_case_table_names=1` como en Windows), entorno de lista blanca y control de procesos. Mantiene las guardas: `PS_API06A_LAB_ACK`, entorno padre limpio, `.env*` que `validateSandboxConfig` rechaza, nombres `sandbox_*`.
- Reproducible a mano en Linux (con `mariadbd` 11.8.9 instalado): `PS_API06A_LAB_ACK=SINTETICO-LOCAL-SIN-PRODUCCION-NI-HOSTINGER node scripts/ci/pricesmart-demo/run-linux.mjs`.

**Resultado por fase (CI, MariaDB 11.8.9):**
| Fase | Archivos E2E | Pruebas | Estado |
|---|---|---|---|
| App de laboratorio | demo, api13, pricesmart-flow, homologation, sandbox-readiness, **contract-not-mapped** | 65 | OK |
| Composición de homologación (cuentas de mínimo privilegio) | homologation-runtime, contract-dictionary | 19 | OK |
| Trabajador de reintentos dentro de la app (tras reiniciar) | api13-worker | 1 | OK |
| Ensayo del aprovisionamiento (`homologation-provision.e2e.ts`, P1–P15) | homologation-provision | 17 | OK (resuelto; ver abajo) |

**Casos pedidos en la auditoría (`contract-not-mapped.e2e.ts`, NM.1–NM.5, contra base real):** contrato no mapeable → job `BLOCKED/CONTRACT_NOT_MAPPED`, sin reclamo ni solicitud TMS, GET `REVIEW_REQUIRED` con `linkIssue.code`, sin reintento; orden **ya vinculada** → `ALREADY_LINKED` (no se bloquea); **recuperación por token** tras caída después de crear la solicitud → `LINKED` sin crear otra; reclamo pendiente sin solicitud conservado y completado con el mismo token; `lab-demo-1` sigue vinculando.

**Limitaciones reales (no ocultas):**
- **Ensayo del aprovisionamiento (P1–P15): RESUELTO.** El fallo `TMS_SCHEMA_INCOMPLETE` no era de Linux: `sql/migrate-2026-11-cb2-vinculo-unidad.sql` (combustibles CB2) llegó a `main` después de fijar la lista de módulos fuera de alcance y alteraba `flota_cb2_consumos`, de un módulo no instalado. Se declaró fuera de alcance en `bundle.mjs` y una prueba (`alcance-esquema.test.ts`) evita la deriva. Ahora corre en el CI (17 pruebas, MariaDB 11.8.9). Ver `../homologacion-final/README.md`.
- 40 migraciones del proyecto quedan con sentencias pendientes en el esquema del laboratorio (el cargador simple del laboratorio no entiende `DELIMITER`, `USE` de producción ni dependencias entre módulos). No se comparó con el laboratorio de Windows; las E2E de PriceSmart pasan con ese esquema.
- No se prueba el verificador real de PriceSmart (D02), el diccionario definitivo (D06), cancelación ejecutada (D09), ni «entrega confirmada» (D13): siguen pendientes.

Cobertura existente por etapa del ciclo:

| Etapa | E2E existentes |
|---|---|
| Recepción POST y persistencia (orden cifrada, evento, outbox, auditoría) | `demo.e2e.ts` DEMO.1; `pricesmart-flow.e2e.ts` F2; `contract-dictionary.e2e.ts` C1 |
| Outbox: entrega al-menos-una-vez, caída del procesador, concurrencia, REVIEW durable | `pricesmart-flow.e2e.ts` F3–F6; `homologation-runtime.e2e.ts` R1, R10–R12 |
| Vínculo TMS y recuperación | `api13.e2e.ts` API13.1–API13.16; `api13-worker.e2e.ts` API13.17; `demo.e2e.ts` DEMO.2, DEMO.11–13 |
| Consulta GET y estados | `demo.e2e.ts` DEMO.3, DEMO.6; `sandbox-readiness.e2e.ts` S1–S6; `homologation-runtime.e2e.ts` R2 |
| Cancelaciones | `demo.e2e.ts` DEMO.7; `pricesmart-flow.e2e.ts` F7–F8; `homologation.e2e.ts` H4; `homologation-runtime.e2e.ts` R4; `sandbox-readiness.e2e.ts` S5 |
| Idempotencia y concurrencia | `demo.e2e.ts` DEMO.4, DEMO.8; `homologation-runtime.e2e.ts` R3; `contract-dictionary.e2e.ts` C2 |
| Estados de revisión (TMS rechaza, plan incoherente, sin mapeo) | `homologation.e2e.ts` H2, H5; `demo.e2e.ts` DEMO.10; `homologation-runtime.e2e.ts` R5, R12 |
| **`CONTRACT_NOT_MAPPED`, orden ya vinculada y recuperación por token (este PR)** | `contract-not-mapped.e2e.ts` NM.1–NM.5 (MariaDB real, CI); además `contrato-no-mapeado.test.ts` (unitarias) |
