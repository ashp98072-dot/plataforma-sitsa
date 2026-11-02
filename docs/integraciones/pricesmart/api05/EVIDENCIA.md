# API-05 — evidencia técnica sanitizada y riesgos

Fecha: 2026-11-02 (America/Guatemala). Base `c8b3cf57`, origin/main incluyendo el merge #550. Rama independiente. Se inspeccionó código versionado, no producción ni estado físico de tablas. D01–D16 siguen PENDIENTES.

## Resultados disponibles

| Verificación | Resultado | Alcance / límite |
|---|---|---|
| Adaptación, estados y concurrencia lógica | PASS: 56 pruebas nuevas | SourceOrderPort/resolver/AdaptationModel SIMULATED; Map/serialización/leases modelados, no DB |
| Circuito completo sintético | PASS: 6 pruebas nuevas | API-04 -> API-03 falsos -> API-01 ModelRepository original SIMULATED -> candidata/diario/proyección; recepción/consulta/cancelación HTTP válidas siguen 503 |
| Regresión API-01–API-04 y S02–S05 | PASS: 601 casos heredados | Sin modificaciones a sus fuentes/contratos/guards/tests |
| Total Vitest | PASS: 22 archivos, 663 casos, cero fallos/omitidos | Guard S02 de red reinstalado por caso en configuración heredada |
| S06-A | PASS: 12 casos | Runner Node, preflight documental sin VM/Linux real |
| TypeScript | PASS, exit 0 | --noEmit --incremental false |
| ESLint | PASS, exit 0, cero warnings | Cinco archivos nuevos de código/modelo/pruebas |
| Alcance/diff | PASS | Sólo archivos nuevos API-05; sin alterar API-04 para recibir SIMULATED ni tocar TMS, SQL, S04, src/app, package/lock o #541 |
| Ausencia de I/O operativo | PASS estático/offline limitado | Sin import de TMS/DB/red, fetch, env habilitante, timer/worker o rutas nuevas; no demuestra aislamiento Linux físico |

## Circuito y honestidad de las garantías

El circuito usa Request/Response NATIVOS como objetos en proceso, con URL example.invalid sin fetch/servidor/socket. El extractor/verificador M2M, catálogo, revocación, contador y replay son dobles privados de prueba. Las attestations de contador/nonce se declaran sólo para atravesar la cadena de seguridad de API-04; no certifican proveedor ni distribución. No se exportan credenciales, verificador ficticio o parser de x-fixture-id en runtime.

La persistencia de órdenes es EXACTAMENTE ModelRepository API-01, con durability=SIMULATED, sin wrapper que devuelva DURABLE y sin monkey patch del transporte. Los Requests válidos que llegan a guardar el modelo reciben 503/UNAVAILABLE, jamás 202. Eso demuestra rechazo del acuse, NO recepción HTTP operativa. Puede existir estado en el modelo tras ese 503; el test lo inspecciona como fixture, copia eventos pendientes y llama manualmente al adaptador. No hay un worker conectado ni consumo/ack de outbox. Los rechazos 403/404/409 son respuestas lógicas de error, no acuses de durabilidad.

El adaptador, la candidata, el vínculo y las consultas también exigen/retornan SIMULATED, con materializable=false, tmsRequestId=null y externalPriceSmartStatus=null. El único repositorio de adaptación es AdaptationModel bajo __tests__: Map, rollback por snapshot y mutex local para MODELAR el contrato. No es una implementación operativa de transacciones, CAS/leases distribuidos, persistencia o recuperación ante caída. Los casos de leases vencidos, callbacks tardíos y concurrencia son simulados explícitos.

No se importan crearSolicitudCliente/programarSolicitud, asignaciones, evidencias o endpoints TMS. No hay `usuario 0`, fecha solicitada por defecto, destinatario, artículo, dirección o viaje falso presentado como real. Se conserva tmsLinked=false en las órdenes; se dejan todos los eventos del outbox de origen pendientes en el modelo. DONE del diario sólo corresponde a una propuesta sintética registrada.

## Cobertura positiva y negativa

| Grupo | Comprobaciones |
|---|---|
| Candidata/identidad | ID determinista separado de UUID/referencia externa; sin datos comerciales/actor/fecha fabricados; club y scope completos, case preservado |
| Scope | Tenant/cliente/integración/club ajenos rechazados para get/process; snapshot y resolución de puerto con scope ajeno rechazados; vínculo/referencia de solicitud no elegidos por texto libre |
| Contratos/fallos | Fuente ausente/incompleta/de otro scope/no simulada; fuente caída; resolver malformado/ajeno/no simulado; job corrupto/otro orderId; excepciones sanitizadas sin SECRET/SQL |
| Reintentos/trazabilidad | STARTED/FAILED/STARTED/SUCCEEDED preservados; fallos de vínculo/audit/job/commit revierten finalización; fallo de claim no invoca resolver; fallo adicional del diario conserva lease y posterior LEASE_RECLAIMED |
| Idempotencia/CAS | Replay inmutable aun con nueva correlación; mismo eventId con contenido distinto y expectedLinkVersion viejo dan conflicto; ausencia inicial de candidata conserva observación para revisión/reintento manual |
| Concurrencia sólo modelada | Claim activo rechaza segunda llamada; lease reclamado cambia ticket; resolver viejo no pisa ganador; recepción concurrente mantiene una orden/evento/outbox pero ambos Requests siguen 503 |
| Estados | Todos los estados internos de solicitud/plan auditados, evidencia no confirmada, múltiples intentos observados, parcial/fallo/compartido/reprogramación/tardío -> revisión; unknown/DELIVERED no permitido |
| Cancelaciones | Antes de candidata, durante resolución, tras observación compartida, solicitud visible por get antes de procesar evento, repetición idéntica y motivo conflictivo; nunca cancelación final o cancelación de plan |
| Colisiones | Dos órdenes no comparten una referencia ficticia del mismo namespace mientras cardinalidad no esté ratificada; no habilitar agrupación de pedidos por accidente |
| Circuito realista en proceso | Recepción válida -> 503 + modelo; evento pendiente -> candidata; estados -> consulta separada; cancelación -> revisión; fallo -> reintento; tenant/club ajenos -> rechazo. Sin cambiar controles API-04 |
| No exposición | Regresiones estáticas de API-04/Next, guard de red S02, nuevos módulos sin dependencias operativas o activación automática |

## Comandos ejecutados

Desde `.worktrees/pricesmart-api05`, reutilizando dependencias ya disponibles del workspace padre:

```powershell
node ../../node_modules/vitest/vitest.mjs run --config vitest.pricesmart-api01.config.mts
node --test scripts/sandbox-s06a/preflight.test.mjs
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
node ../../node_modules/eslint/bin/eslint.js src/lib/integrations/pricesmart/tms-adaptation.ts src/lib/integrations/pricesmart/tms-adaptation-contracts.ts src/lib/integrations/pricesmart/tms-adaptation.test.ts src/lib/integrations/pricesmart/tms-synthetic-circuit.test.ts src/lib/integrations/pricesmart/__tests__/tms-adaptation-model.ts --max-warnings 0
git diff --check
```

Vitest instalado utilizado 4.1.11, frente a 4.1.12 solicitado por package.json de base. Sin instalación/descarga ni cambio de package/lock. Instalación limpia exacta del lock NO EJECUTADA. Se conserva configuración heredada API-01, cuyo glob incluye API-01–API-05/S02–S05; S06-A usa node:test separado. No se ejecutó Next build, servidor HTTP, suite general ajena o pruebas DB del TMS operativo.

## Riesgos y validaciones NO EJECUTADAS

| Área real | Estado / dependencia |
|---|---|
| SQL/MariaDB real: transacciones, dos conexiones, CAS/FK/UNIQUE/leases/jobs/outbox, durabilidad, crash recovery, permisos | NO EJECUTADA. Instancia nueva autorizada y diseño/repositorio durable pendientes; mocks no garantizan ausencia de trabajo perdido tras caída |
| TMS operativo: actor máquina, solicitud real, paradas, plan/viaje, asignaciones, recursos/disponibilidad y cancelaciones | NO EJECUTADA. Contrato, núcleo Tx, mapeos/catálogos y autorizaciones pendientes; ninguna regla operativa se modificó |
| HTTP real, Next, TLS/gateway, M2M/proveedor, contador y replay distribuidos | NO EJECUTADA. API-04 conserva bloqueo; pruebas de red/PKI/Redis y autorización separada pendientes |
| Linux/aislamiento/artefacto/instalación y gates S06-A | NO EJECUTADA. Sin infraestructura nueva contratada o creada |
| Comunicación con PriceSmart | NO EJECUTADA. Sin credenciales, endpoint, tráfico ni decisiones D01–D16 ratificadas |
| Cifrado, privacidad/retención de órdenes/vínculos/eventos/evidencia/backups | NO EJECUTADA. D14 y pendientes API-02/API-03 heredados; no datos reales |

Riesgos de diseño abiertos: fuente/diario/TMS no comparten transacción ni fencing operativo; cancelación puede competir con materialización futura; sin un consumidor/ACK durable no existe sincronización real; cardinalidad, parciales, intentos y POD carecen de contrato; estado de ruta/cierre no acredita entrega por orden; roles/usuario portal no sustituyen actor M2M. Este PR NO resuelve esos riesgos con locks de memoria, datos comerciales inventados o grants ampliados.

Sin SQL/migraciones, solicitudes/viajes/rutas reales, Hostinger/producción, desbloqueo/grants S04, infraestructura, #541, endpoints, merge ni despliegue. Entrega en borrador para auditoría de ChatGPT. SHA final y PR en la entrega; diff completo en Files changed / URL .diff y reproducible:

```powershell
git rev-parse HEAD
git diff --name-status c8b3cf57...HEAD
git diff --binary c8b3cf57...HEAD
```
