# Arranque real del runtime de homologación

Estado: **VERIFICADO TÉCNICAMENTE** en el laboratorio (MariaDB 11.8.9 real, `next dev`, rutas HTTP reales). No está desplegado, no se expuso nada y el modo por defecto sigue siendo `DISABLED`. Es independiente del proveedor de alojamiento; no adapta MariaDB 10.5 ni Cron Jobs.

## Qué se cableó
`src/instrumentation.ts` → `homologation/boot.ts` → `installHomologationRuntime`. Antes de este cambio **nada instalaba el runtime en el proceso de Next.js** (solo lo hacían las pruebas): un sandbox desplegado habría respondido siempre 503. Ahora, al arrancar el servidor:

1. **Solo si** el proceso declara `NOVALVION_ENV=sandbox` **y** `PRICESMART_RUNTIME_MODE` es distinto de `DISABLED`; en cualquier otro caso no se importa nada de PriceSmart (producción, laboratorio y arranque sin modo quedan intactos).
2. `boot.ts` evalúa, en orden y **fallando cerrado** (handler desinstalado, rutas en 503 `DISABLED`, sin abrir conexiones hasta el paso 5): compuerta del proceso (`homologationGate`: id `homolog-*`, base y cuenta `sandbox_api02_homolog_*`, base en loopback, sin variables `PRICESMART_LAB_*`) → cuenta del worker (`PS_HOMOLOG_WORKER_USER/PASSWORD`) y ruta absoluta del interruptor (`PS_HOMOLOG_KILLSWITCH_FILE`) → **proveedores** → pools (aplicación y worker, ambos verificados como sandbox) → `installHomologationRuntime` (modo, **decisiones ratificadas**, **ACK del operador** para `ENABLED`, sondas de base/aprovisionamiento/outbox, interruptor).
3. Se ejecuta **una sola vez por proceso** (recarga en caliente no duplica el consumidor) y registra el **apagado**: en `SIGTERM/SIGINT` ejecuta el apagado ordenado descrito más abajo (desinstala el handler, cierra el consumidor, espera el ciclo activo con límite y cierra el pool del worker).
4. Deja una línea de informe en el registro (`[pricesmart] runtime de homologación: INSTALLED|CLOSED (códigos)`), sin valores ni mensajes de terceros.

## Qué impide activarlo sin las decisiones requeridas
| Requisito | Dónde se exige | Prueba |
|---|---|---|
| Autenticación M2M **definitiva** (verificador D02), KMS revisado y contrato D06 | `providers.ts`: `REVIEWED_ADAPTERS` está **vacío** a propósito. Un adaptador revisado se añade ahí en un cambio propio y auditado. Sin él: `PROVIDERS_NOT_AVAILABLE`, sin abrir conexiones | `boot.test.ts`, E2E HB.2 |
| Decisiones ratificadas por PriceSmart (`READ_ONLY`: D02, D06; `ENABLED`: D02, D06, D08, D09, D12) | `runtime-assembly.ts` (`DECISION_PENDING`) | `boot.test.ts`, E2E HB.3 |
| Aprobación humana | `PRICESMART_RUNTIME_ACK` (frase explícita del operador) para `ENABLED`; además la aprobación de `evaluateSandboxExposure` y `verify-exposure` (que **no** autoriza exponer) | `boot.test.ts`, E2E HB.3 |
| Interruptor de emergencia en `ON` | `fileKillSwitch`: ausente, ilegible o distinto de `ON` ⇒ apagado | E2E HB.6 |
| Aprovisionamiento completo | sonda `provisioning` (`bootstrap`, `finalize` y todos los `account:*` en `COMPLETE`) | R14, HB.4 |

## Verificadores y credenciales de laboratorio: nunca en un entorno externo
Los proveedores sintéticos (HMAC de laboratorio, clave de prueba) viven en `synthetic-providers.ts`, se importan de forma **diferida** y solo si `syntheticProvidersDecision` lo permite: frase explícita, proceso **que no sea `NODE_ENV=production`** (es decir, nunca un `next start`), `SANDBOX_ID=homolog-test*`, sandbox local en loopback y clave de prueba de 64 hex. `verify-exposure` marca `PS_HOMOLOG_SYNTHETIC_*` como bandera prohibida; las plantillas del sandbox real no la mencionan; pruebas estáticas impiden importar el laboratorio desde `boot.ts` o `providers.ts`.

## Apagado seguro
El consumidor de la outbox ahora **respeta el interruptor**: con `OFF` el temporizador y la vía rápida no procesan nada hacia el TMS (lo recibido queda durable y se retoma al reactivar). Las rutas responden 503 al instante sin reiniciar.

## Apagado ordenado del consumidor
Orden en `boot.ts` (una sola promesa compartida, idempotente): **1)** `installPriceSmartHandler(null)`: las rutas dejan de aceptar trabajo; **2)** `shutdownConsumer(espera)`; **3)** cierre del pool del worker.

1. **Sin ejecuciones nuevas.** `consumer.shutdown()` es terminal: marca el consumidor como cerrado y, desde ese momento, `kick()`, `start()`, el temporizador, los callbacks ya programados (se vuelve a comprobar `closed` dentro del callback) y las re-ejecuciones encadenadas no hacen nada. Un `run()` nuevo se rechaza con `CONSUMER_CLOSED`; si ya había un ciclo activo, `run()` se une a ese ciclo en lugar de iniciar otro.
2. **Espera del `runOnce()` activo.** Si hay un ciclo en curso, `shutdown()` espera a que termine **antes** de cerrar el pool del worker, para no cortar a mitad una solicitud TMS ni una escritura de la outbox. Devuelve `{drained, waitedMs}`.
3. **Configuración.** `PS_HOMOLOG_SHUTDOWN_TIMEOUT_MS`: milisegundos de espera máxima, rango 0–60000; **por defecto 10000 (10 s)**. Un valor ausente, no numérico o fuera de rango usa el valor por defecto. (`shutdown()` por sí solo acepta 0–120000, también con 10000 por defecto.)
4. **Si se supera el límite.** No se queda colgado: el apagado informa `drained=false`, **cierra el pool de todos modos** y termina. Lo que estuviera en vuelo no se pierde ni se duplica: la fila sigue arrendada (lease) con fencing y la solicitud TMS es idempotente (token de reclamo `[PS:<hex>]`), así que al reiniciar, cuando el lease vence, el consumidor la retoma. El registro lo deja como `[pricesmart] apagado ordenado: ...`.

## Resultados (CI, MariaDB 11.8.9, esquema aprovisionado por el paquete real)
Unitarias: `boot.test.ts` (12) más los guardianes estáticos. E2E por HTTP real, cada escenario con su propia configuración de la app: **HB.1** por defecto apagado (503, nada guardado, sin conexiones del worker); **HB.2** `ENABLED` sin proveedores revisados → cerrado; **HB.3** sin decisiones/ACK → cerrado y sin consumidor; **HB.4–HB.6** abierto con proveedores sintéticos: POST → outbox → solicitud TMS (una) → GET, duplicados y conflicto, cancelación idempotente y auditada, 401 sin/alterada evidencia, otra empresa 404, reintentos tras restaurar el mapeo sin reenviar, apagado seguro; **HB.7** tras **reiniciar** la app: lo recibido sigue, la orden pendiente se vincula sin duplicar y el servicio continúa; el apagado por `SIGTERM` terminó limpio.

**Cierre de auditoría (SHA `6b324c009af6aa82034b120804aa2d04774137ed`, CI 45899106949):** pruebas unitarias del apagado en `consumer.test.ts` y `boot.test.ts` (orden, idempotencia, sin ejecuciones tras cerrar, espera con límite, variable de entorno) y E2E HB.8–HB.11:
- **HB.8 – interrupción:** `SIGTERM` a la app en plena ráfaga de órdenes; la app termina (comprobado por el estado real del proceso, sin confundir un zombi) y registra el apagado ordenado.
- **HB.9 – recuperación:** tras la interrupción, sin duplicar solicitudes TMS ni perder órdenes confirmadas; al reiniciar, los trabajos pendientes se retoman. El vencimiento del lease se simula en el laboratorio (`expireLeases()`) para no esperar el tiempo real.
- **HB.10 – `next build` + `next start`, modo cerrado:** build real (sin entorno sandbox) y `next start` con el runtime deshabilitado y sin proveedores: las rutas PriceSmart responden 503 y no se abre ninguna conexión del worker.
- **HB.11 – credenciales sintéticas rechazadas:** `next start` (`NODE_ENV=production`) con `ENABLED`, decisiones, ACK y las variables de proveedores sintéticos presentes: el runtime las rechaza, permanece cerrado (503) y no abre conexiones del worker.

## Defecto real encontrado y corregido
La sonda `provisioning` exigía exactamente 2 filas de marcador, pero el aprovisionamiento real también escribe los pasos `account:*`: **un sandbox correctamente aprovisionado nunca habría abierto**. Las pruebas en proceso no lo veían porque sembraban solo 2 filas. Ahora se exige `bootstrap` y `finalize` en `COMPLETE` y ningún paso en otro estado.

## Límites
- Los escenarios abiertos (HB.4–HB.9) usan `next dev` (`NODE_ENV=development`) porque los proveedores sintéticos están prohibidos en `next start`; el rechazo en producción se verifica además con un `next build` y `next start` reales (HB.10 y HB.11).
- **Nada de esto equivale a validar un alojamiento real ni autoriza exponer el sandbox a PriceSmart.** Todo se ejecutó en un laboratorio efímero (MariaDB 11.8.9 desechable, loopback). Sigue sin haber despliegue, exposición, SQL productivo ni aprobación para producción.
- **Siguen pendientes y bloqueantes:** D02 (verificador M2M definitivo), KMS revisado, D06 (contrato) y las demás decisiones externas de PriceSmart (D08, D09, D12 para `ENABLED`). El apagado ordenado no sustituye ninguna de ellas.
- Si se supera el límite de espera del apagado, la recuperación depende del vencimiento del lease y de la idempotencia del TMS (ver arriba); no se probó contra un TMS real.
- No existe aún un adaptador revisado: **el runtime real queda cerrado** hasta que D02 (verificador), KMS y D06 estén resueltos y se revise ese adaptador.
- No hay worker externo ni Cron: el consumidor corre dentro del proceso (`PS_HOMOLOG_CONSUMER_EVERY_MS`, 2 s por defecto). Adaptar a Cron Jobs y a MariaDB 10.5 (`SKIP LOCKED`, collation `uca1400`) queda fuera de este alcance.
