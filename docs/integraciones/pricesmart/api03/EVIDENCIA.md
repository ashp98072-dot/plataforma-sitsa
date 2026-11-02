# API-03 — evidencia técnica y límites

Fecha: 2026-11-02, America/Guatemala. Base `187e84b5` (origin/main, incluye #548). Entrega en rama independiente, sólo archivos nuevos API-03. Estado: apto para auditoría de código y política aislada, NO certificación M2M real ni autorización operativa. D01–D16 permanecen pendientes.

## Resultados

| Comprobación | Resultado | Evidencia y límite |
|---|---|---|
| Nuevas pruebas M2M/autorización/antiabuso | PASS: 93 casos | Puertos SIMULATED; sin proveedor criptográfico ni almacén real |
| Regresión API-01, API-02 y S02–S05 | PASS: 408 casos heredados | Mismo alcance offline previo; SQL/identidad/contadores simulados según suite |
| Total Vitest | PASS: 18 archivos, 501 casos, cero fallos/omitidos | Guard de red S02 reinstalado por caso |
| Preflight S06-A | PASS: 12 casos | Node test runner, expediente documental, no Linux real |
| TypeScript | PASS, exit 0 | --noEmit --incremental false |
| ESLint | PASS, exit 0, cero warnings | Tres archivos nuevos de código/pruebas |
| Diff | PASS | Sólo archivos nuevos API-03, diff --check sin errores |
| HTTP deshabilitado | PASS de prueba estática/unitaria | helper DISABLED aun con aparente variable; no ruta ni petición HTTP real |
| Ausencia de conexiones nuevas | PASS estático/offline limitado | Módulos nuevos sin cliente SQL/red/proveedor, sin wiring src/app; guard S02 deniega sockets/TLS/HTTP/DNS/fetch en regresión. No acredita firewall real |

El modelo de pruebas inyecta explícitamente EvidenceVerifier, catálogo, revocación, reloj, contador y almacén de replay falsos. Los bytes [1,2,3] son evidencia opaca reconocida sólo por el verificador falso del test: no son un token, certificado o credencial válida en ningún HTTP. No se publica un verificador de prueba como módulo runtime ni se conecta IdentityPort.

Los tests de concurrencia y agotamiento/renovación de ventanas usan Map/Set/contador exclusivamente DENTRO de los tests; se identifican como simulación y producen assurance SIMULATED. No existe implementación runtime de limitador o nonce en memoria. La WeakMap interna sólo acredita procedencia de handles locales. Ningún PASS con dobles significa transacción distribuida, firma válida, revocación efectiva en proveedor o resistencia real al replay.

## Matriz de cobertura positiva y negativa

| Requisito | Cobertura aislada |
|---|---|
| Identidad válida | Verificador explícito, catálogo único y revocación=false; handle opaco; Principal mínimo del catálogo |
| Evidencia ausente/fabricada/incompleta | null/undefined/string JWT-like/objeto/bytes vacíos, verificador null, assertion incompleta y campos extra sin autoridad |
| Integración desconocida y colisiones | Cero/dos resultados de catálogo, issuer/subject/reference no coincidentes, REUSED/COLLISION de nonce |
| Expiración y revocación | Assertions/registro/credencial expirados o futuros, estado REVOKED, revocación fresca y durante almacenes, retrasos de puertos |
| Scopes | Positivo create/read/cancel; rechazo si falta grant en verificador o catálogo, sin wildcard ni Admin |
| Tenant/cliente/integración/club/entorno | Recursos ajenos, sandbox incorrecto, club con case distinto, remapeo administrativo y reducción de permisos |
| Identidad fabricada | Principal/record/assertion falsos, clones y handle de otra instancia rechazados |
| Replay/binding | Prueba requerida para admit, huella de operación+namespace+club+recurso+bytes, tiempos y duración, prueba vieja/futura/expirada, nonce reutilizado o con contenido diferente |
| Frecuencia/tamaño | Cotas antes de puertos costosos, rechazo de exceso, clave estable frente a rotación, simulación de ventana y solicitudes concurrentes |
| Fallos de dependencias | Verificador, catálogo, revocación, contador y claim fallan cerrado; respuestas incoherentes y reloj inválido rechazados |
| Sanitización/correlación | Excepciones SQL/URI/token falsas no se propagan, códigos fuera de catálogo rechazados, correlación UUID nueva sin reflejar input |
| No exposición | Static audit de imports/efectos/conexión con app, helper HTTP siempre deshabilitado, red denegada en regresión |

## Comandos ejecutados

Desde `.worktrees/pricesmart-api03`, reutilizando dependencias disponibles en el workspace padre:

```powershell
node ../../node_modules/vitest/vitest.mjs run --config vitest.pricesmart-api01.config.mts
node --test scripts/sandbox-s06a/preflight.test.mjs
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
node ../../node_modules/eslint/bin/eslint.js src/lib/integrations/pricesmart/m2m-security.ts src/lib/integrations/pricesmart/security-contracts.ts src/lib/integrations/pricesmart/m2m-security.test.ts --max-warnings 0
git diff --check
```

Se conserva el nombre de configuración heredado: su glob incorpora las nuevas pruebas API-03 y regresiones API-01/API-02/S02–S05. S06-A usa node:test por separado. Vitest instalado utilizado 4.1.11; package.json de base solicita 4.1.12. No se instalaron/descargaron dependencias ni se modificó package/lock. Instalación limpia exacta del lock NO EJECUTADA. No se ejecutó build Next ni suite general de módulos ajenos.

## Pruebas reales NO EJECUTADAS

| Área | Estado | Dependencia pendiente |
|---|---|---|
| OAuth Client Credentials, firma/introspección/audience/emisor/rotación | NO EJECUTADA | Mecanismo D02, proveedor aislado autorizado y verificador aprobado |
| PKI/mTLS, cadena/revocación/canal/proxy y prueba por solicitud | NO EJECUTADA | PKI y perfil D02/D15 aprobados |
| Catálogo/revocación MariaDB y constraints/permisos efectivos | NO EJECUTADA | Instancia nueva, perfil administrativo/runtime separados, DDL manual aprobado |
| Contador Redis u otro almacén distribuido | NO EJECUTADA | Algoritmo/cuotas/TTL/capacidad D11, proveedor aislado, multiproceso/failover/particiones |
| Replay durable, concurrencia real, recuperación y retención de claims | NO EJECUTADA | Política D10 y almacén atómico aprobado, pruebas de caída/restore/eviction |
| HTTP, streaming, códigos/retry/enum/latencia y abuso anónimo | NO EJECUTADA | Transporte/limitador/gateway futuro, D10–D12 |
| Linux/firewall/TLS, despliegue y gates S06-A | NO EJECUTADA | Infraestructura nueva y autorizaciones separadas; no contratada |
| API-02 transacciones reales/durabilidad/cifrado/retención | NO EJECUTADA | Pendientes heredados sin convertirlos en PASS |

No SQL ejecutado, Hostinger, cuentas/credenciales reales, infraestructura, desbloqueo o permisos S04, modificación de #541, HTTP activado, outbox consumidor o TMS. Sin merge ni despliegue. Entregar el PR en borrador para auditoría independiente antes de continuar.

SHA final en la descripción del PR y respuesta; diff completo en Files changed/URL `.diff`. Reproducción de alcance:

```powershell
git rev-parse HEAD
git diff --name-status 187e84b5...HEAD
git diff --binary 187e84b5...HEAD
```
