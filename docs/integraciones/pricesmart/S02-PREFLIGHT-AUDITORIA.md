# S02 — preflight de auditoría del PR #542

Fecha: 2026-10-30. Commit original auditado:
`9d2cfe73b9e4d8b017fbc3f84ecb9a561ca9d289`.
Las correcciones y este reporte se entregan juntos en un commit posterior del mismo PR.
El SHA posterior se identifica en la entrega y en el historial del PR; no se inserta
un SHA autorreferente en el documento.

**Decisión: NO MERGEAR automáticamente.** El código corregido supera los controles
locales indicados abajo; la revisión independiente sigue pendiente. Este reporte
no acredita aislamiento de una instalación ni autoriza habilitación externa.
D01–D16 permanecen pendientes.

## 1. Instalación exacta y separación de evidencias

Se usaron dos checkouts: uno detached e inmutable del SHA original y otro de la
rama del PR para las correcciones. Ambos instalaron sus propias dependencias con
`npm ci`; no se reutilizó el `node_modules` del workspace principal.

Instalación inicial del checkout del PR, con descargas del registro npm:

```powershell
npm.cmd ci --no-audit --no-fund --cache .npm-cache --fetch-retries=0
```

Resultado: exit 0, 532 paquetes. En el checkout detached se repitió sin red,
usando exclusivamente la caché poblada por la primera instalación:

```powershell
npm.cmd ci --offline --no-audit --no-fund --cache <ruta-absoluta-a-la-misma-cache>
```

Resultado: exit 0, 532 paquetes. `npm.cmd` evita el bloqueo de `npm.ps1` por la
política PowerShell existente; no se modificó esa política. La primera descarga
restringida falló con EACCES y fue interrumpida; la instalación autorizada posterior
sí terminó. No se aprobaron scripts de paquetes adicionales ni se cambió la política
existente `allow-scripts`. npm informó que `unrs-resolver@1.12.2` tiene un postinstall
pendiente de esa política; las validaciones siguientes funcionan con esta instalación.

SHA-256 de `package-lock.json` antes y después, igual en ambos checkouts:
`d41410a952adfd432b3f2ee7de20a9ef161c4d0554e532e2a28245082965c3e9`.
No hay diff del lockfile. Solo cambian scripts de `package.json`, no dependencias.

| Herramienta | Versión instalada |
|---|---|
| Node / npm | 24.18.0 / 11.16.0 |
| Next | 16.4.1 |
| Vitest / Vite | 4.1.12 / 8.2.4 |
| TypeScript / ESLint | 5.9.3 / 9.39.5 |
| mysql2 | 3.23.2 |

## 2. PASS/FAIL por control

PASS de código significa evidencia estática y pruebas locales, no comprobación de
firewall, grants o ACL en infraestructura inexistente. FAIL operativo significa
que no hay evidencia para afirmar ese control desplegado; no se lo sustituye por
un mock o una recomendación.

| Control | SHA original | Código corregido | Evidencia / límite |
|---|---|---|---|
| C01 instalación reproducible | PASS | PASS | Dos `npm ci`, hash del lockfile intacto, versiones exactas |
| C02 TypeScript y ESLint de archivos del PR | PASS | PASS | Exit 0 en ambos checkouts; comandos en sección 3 |
| C03 suite de configuración/aislamiento | PASS con cobertura incompleta | PASS | Original: 151 pass/2 omitidas. Corregido: 195 pass/0 omitidas, 8 archivos |
| C04 inventario de conectores del servidor | PASS estático | PASS estático | Un constructor y un import ejecutable del driver en `src/lib/db.ts`; inventario completo adjunto |
| C05 validación de cada operación en conexión adquirida | FAIL | PASS | Tres pruebas rojas: cambio de identidad tras checkout, escape del driver y uso tras release. Fachada cerrada y revalidación antes de cada operación |
| C06 script administrativo directo | FAIL | PASS | `crear-colaborador-prueba.mjs` no tenía guard. Ahora rechaza sandbox antes de dotenv/conectar y después de dotenv |
| C07 arranques npm sandbox antes de Next/env | FAIL | PASS para entradas autorizadas | `start/dev/build` invocaban Next directamente. Wrapper valida antes de spawn; sandbox solo permite start loopback sin argumentos extra |
| C08 regresión del arranque productivo | PASS en pruebas existentes | PASS en pruebas ampliadas | Precedencia/relectura env, argumentos start/dev/build, entorno heredado, auth, uploads, origen y propagación de SIGTERM. No es un despliegue de producción |
| C09 rutas y enlaces reales | FAIL de cobertura y lectura de foto | PASS local | Foto tenía resolución léxica sin verificación de enlace; se agregó guard sandbox. Las dos pruebas omitidas ahora ejecutan junctions reales |
| C10 ACL, usuario, red y grants efectivos | FAIL: no verificados | FAIL: no verificados | Se especifican requisitos obligatorios; no se desplegó ni inspeccionó una instalación real |
| C11 prueba sin servicios DB/HTTP externos | PASS | PASS | Driver y spawn de aplicación sustituidos; setup bloquea red. npm ci es la excepción explícita de descarga de dependencias |
| C12 validación con motor MySQL/MariaDB aislado real | NO EJECUTADA | NO EJECUTADA | No se abrió ninguna DB ni se ejecutó SQL real; queda para el aprovisionamiento aprobado |

Antes de cambiar el código, cuatro negativas nuevas dieron exactamente cuatro
fallos y las 151 pruebas anteriores siguieron aprobadas. Las correcciones eliminan
esos fallos. El hallazgo de lectura de foto y el de comandos genéricos se obtuvieron
por revisión de código y tienen nuevas negativas/regresiones en la suite corregida.

## 3. Reproducción de las verificaciones

Desde cada checkout, sin `.env` ni credenciales operativas:

```powershell
New-Item -ItemType Directory -Force .lab-runtime/s02-preflight | Out-Null
npm.cmd run test:sandbox -- --reporter=json --outputFile=.lab-runtime/s02-preflight/tests.json
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
git diff --cached --check
```

ESLint original: los 16 archivos TS/MJS modificados/nuevos del PR original:

```powershell
$s02OriginalFiles = @(git diff --name-only 3737a5891e33b1349ce867cce816f1cc0e1925e3 9d2cfe73b9e4d8b017fbc3f84ecb9a561ca9d289 | Where-Object { $_ -match '\.(ts|mts|mjs)$' })
node node_modules/eslint/bin/eslint.js @s02OriginalFiles
```

ESLint corregido: los siguientes 21 archivos; exit 0, sin errores ni warnings:

```powershell
node node_modules/eslint/bin/eslint.js src/lib/runtime-environment.ts src/lib/sandbox-db.ts src/lib/sandbox-isolation.test.ts src/lib/sandbox-startup.test.ts src/lib/load-env.ts src/lib/db.ts src/lib/uploads.ts src/lib/uploads.test.ts src/lib/dominios.ts src/lib/auth-secret.ts src/lib/flota/cb2/origin.ts src/lib/rrhh/foto-empleado.ts scripts/sandbox-config.mjs scripts/start-sandbox.mjs scripts/start-hostinger.mjs scripts/init-db.mjs scripts/crear-colaborador-prueba.mjs scripts/next-command.mjs scripts/ci/sandbox-no-network.ts scripts/ci/sandbox-inventory.mjs vitest.sandbox.config.mts
```

La lista contiene 21 rutas: 16 originales más uploads.test, foto-empleado,
crear-colaborador, next-command e inventory. El lint global con 40 errores
preexistentes documentado en la entrega inicial no se convierte aquí en PASS;
este preflight exige y ejecuta el lint de los archivos del cambio.

El inventario se reproduce sin importar la aplicación ni abrir conexiones:

```powershell
node scripts/ci/sandbox-inventory.mjs --output .lab-runtime/s02-preflight/inventory.json
# También puede inspeccionar una referencia inmutable:
node scripts/ci/sandbox-inventory.mjs 9d2cfe73b9e4d8b017fbc3f84ecb9a561ca9d289 --output .lab-runtime/s02-preflight/inventory-original.json
```

El analizador usa AST de TypeScript y lecturas Git; omite imports exclusivamente
de tipos y distingue llamadas child_process de expresiones regulares `.exec`.
Devuelve exit 1 si aparece otro constructor/import de driver o un subprocess en src.
No demuestra ausencia de código malicioso en dependencias ni resuelve importaciones
calculadas arbitrarias: se complementó con búsqueda textual y revisión manual.

Ver [evidencia resumida](S02-PREFLIGHT-EVIDENCIA.json) e
[inventario exhaustivo por archivo/línea](S02-DB-INVENTARIO.json).

## 4. Inventario de accesos y procesos

Se analizaron 1296 archivos JS/TS no `.test.*` en src/scripts. El inventario registra
250 imports ejecutables del módulo DB y 332 llamadas getPool/getConnection en src
(incluye las internas del propio guard, no son 332 clientes distintos).

| Camino | Destino de la conexión / guard | Estado |
|---|---|---|
| Rutas API, páginas SSR y servicios → query/execute | `db.ts` → fachada sandbox → conexión verificada → operación | Guardado |
| Servicios transaccionales → getPool().getConnection() | Checkout verificado; query/execute/beginTransaction/commit/rollback vuelven a verificar la MISMA conexión | Guardado tras corrección |
| Servicios Tx que reciben PoolConnection | Las conexiones nacidas del pool sandbox conservan la fachada al pasarse como parámetro | Guardado dentro del grafo auditado; no importar conexiones de terceros |
| ensureSchema y migradores runtime de src | Usan helpers/checkout del módulo DB, igual que DML | Guardado; no se ejecutaron. El aprovisionamiento debe preparar esquema y limitar grants |
| instrumentation.ts | Carga/valida configuración y auth; no construye cliente DB | Sin SQL propio |
| start:sandbox y start:hostinger | Lanzan Next; no construyen cliente DB | Preflight antes del hijo cuando modo sandbox |
| npm start/dev/build | Nuevo next-command antes del hijo | Producción conserva argumentos; sandbox start solo loopback; dev/build denegados en sandbox |
| init-db.mjs | Cliente directo mysql2, fuera del guard de identidad | Denegado en sandbox; conserva camino productivo existente |
| crear-colaborador-prueba.mjs | Cliente directo mysql2, fuera del guard de identidad | Denegado en sandbox tras corrección |
| scripts/ci/c3c1 y c3c2 connection.mjs | Clientes directos y guards propios de laboratorio por pipe/PID/marcador | Fuera del runtime sandbox; no ejecutados |
| scripts/ci/c3c1…c3c14/run-windows.mjs | 14 bootstraps directos, instancias/pipe de laboratorio propios | Fuera del runtime sandbox; no ejecutados |
| Dos scripts PHP mysqli de combustibles-pr2-lab | `real_connect` por pipe cb2 local; no usan el guard S02 | Fuera del runtime Node; no ejecutados. Inventario PHP manual complementa AST JS/TS |
| pack-hostinger.mjs | Ejecuta ZIP/PowerShell; no conecta DB | Herramienta de empaquetado, no proceso del servicio |
| Generadores Python SQL, milenium y validadores offline | Leen/generan archivos, sin constructor DB en los archivos inspeccionados | No habilitan conexión del runtime |

El único import ejecutable mysql2 y constructor en src es `src/lib/db.ts:31`.
No hay spawn/fork/exec de procesos en src, worker ni scheduler de servidor propio.
Los temporizadores encontrados son refrescos del navegador. Los procesos internos
de Next heredan el entorno sandbox; cualquier uso del módulo DB repite sus controles.
No se inició Next ni se observaron procesos reales de un despliegue.

Los 21 sitios de construcción JS/TS están enumerados en el JSON: 1 de aplicación,
2 administrativos y 18 de laboratorio. Los scripts PHP adicionales son
`test-phpmyadmin-mysqli.php:16` y `test-phpmyadmin-postcheck-mysqli.php:12`.
No son parte de las entradas de package.json ni son importados por src.
**No afirmar que todo el repositorio usa el guard S02:** las herramientas excluidas
deben quedar fuera del artefacto/permisos de ejecución del servicio sandbox.

### Invariante DB y sus límites

Antes de operaciones de aplicación se valida configuración, se adquiere una conexión
y se lee `DATABASE(), environment, sandbox_id`. La misma lectura precede cada método
DB de la fachada; no se entregan el driver, su prototipo, changeUser ni prepare.
Después de release/destroy no se ejecuta trabajo. Si se libera con trabajo pendiente
se destruye la conexión. Error de identidad destruye la conexión y no imprime el
error del driver. Producción recibe su pool sin esta fachada.

La conexión TCP/handshake, selección inicial de DB por el driver y SELECT de identidad
son necesariamente previos a validar: no son DML/DDL de negocio. El guard no es un
firewall SQL y no bloquea nombres de esquema cualificados dentro de una consulta.
La imposibilidad de escribir otra DB depende además de grants por tabla y de una
instancia dedicada sin credenciales productivas. Eso no está certificado con mocks.

## 5. Rutas, usuario y ACL obligatorias

Usuario propuesto: `novalvion-ps-sandbox`, dedicado, sin login, sin sudo, no root,
sin pertenecer a grupos de producción. Un futuro worker requiere una identidad
igualmente restringida y una revisión propia; no existe en S02.

| Recurso | Propietario / acceso obligatorio |
|---|---|
| Código, node_modules, arranque y raíz sandbox | Deploy/admin controlado; runtime solo lectura/recorrido, sin renombrar raíz ni ancestros |
| isolation.json y configuración del supervisor | Admin; runtime solo lectura; sin escritura por grupo/otros; no dentro de uploads |
| Raíz uploads y estructura de empresas/subdirectorios | Exclusivos; preaprovisionar directorios estructurales con dueño deploy/admin; no permitir a otros usuarios reemplazarlos |
| Hojas de archivos/cache necesarias | Escritura mínima para runtime; umask 0077, sin ACL heredadas de hosting compartido ni acceso de terceros |
| Scripts administrativos/CI/PHP y herramientas de laboratorio | Excluir del artefacto runtime o denegar su lectura/ejecución al usuario del servicio |
| Producción, otros sandboxes y backups | Sin montajes, sin ACL de acceso, sin credenciales; identidad DB sin grants cruzados |

En Linux, una base orientativa es código/estructura 0750, secretos 0640, hojas
0700 y archivos 0600, ajustando propietario/grupo para que runtime NO sea dueño ni
tenga escritura sobre ancestros protegidos. No aplicar chmod recursivo al hosting.
Los modos por sí solos no bastan si se concede escritura sobre el directorio padre.
En Windows, usar ACL explícitas equivalentes; no ejecutar producción con la cuenta
Admin usada por este laboratorio. No se aplicaron ACL ni se crearon usuarios.

Las rutas se validan léxica y canónicamente y rechazan enlaces existentes. La lectura
de foto ahora también pasa por ese control en sandbox. **No hay una operación
atómica openat que proteja toda la cadena:** una identidad hostil capaz de cambiar
directorios entre check y acceso conserva una carrera TOCTOU. Deben estar prohibidos
otros procesos/usuarios con escritura en esos directorios, herramientas de gestión
de enlaces y reutilización de UID. Un proceso comprometido con la misma identidad
runtime queda fuera de esta garantía; la contención requiere aislamiento del servicio
y, cuando sea compatible, bloqueo de creación de enlaces por política del supervisor.
No marcar este control operativo PASS hasta revisar ACL efectivas y proceso real.

## 6. Enlaces y arranque: alcance de la confirmación

WSL no está instalado y no se instaló. Un probe de symlink de archivo con el token
elevado disponible devolvió EPERM. No se habilitó Developer Mode ni privilegios.
Las dos omisiones originales eran pruebas de DIRECTORIO, pero el probe creaba un
enlace de archivo y ambas llamadas omitían tipo. Se corrigió la portabilidad:
junction en Windows y symlink `dir` en POSIX. Las dos comprobaciones originales
(escape fuera / alias dentro de empresa) se ejecutaron con enlaces reales y pasaron.
No se afirma ejecución Linux ni cobertura de symlinks NTFS de archivo privilegiados.

Entradas autorizadas: comandos npm versionados y start:hostinger/start:sandbox.
Los wrappers validan antes de lanzar Next; load-env no busca archivos superiores
en sandbox y descarta su cache productiva. Se rechazan los .env locales que Next
autocargaría. Build/dev sandbox no están habilitados: construir desde checkout limpio
sin credenciales y después arrancar el artefacto con entorno explícito aprobado.

Invocar manualmente `node node_modules/next/...`, otro binario Node o scripts CI
elude el wrapper. Instrumentation y el módulo DB siguen fallando antes de SQL de
aplicación, pero Next puede haber leído .env antes de instrumentation. La prohibición
de esos comandos, ausencia de .env y configuración inmutable del supervisor/ACL son
parte obligatoria del perímetro. No se puede afirmar seguridad frente a comandos
arbitrarios del administrador ni que un host no inspeccionado cumpla ese perímetro.

## 7. Riesgos y trabajo que permanece pendiente

- Revisar independientemente el commit corregido y su diff contra el SHA original.
- Aprovisionar solo tras autorización: marcador, grants, usuario, ACL, firewall y TLS.
- Probar motor aislado real: identidad equivocada, cambio de DB, grants cruzados,
  error durante Tx, efectos del SELECT adicional por operación y límites de conexión.
- Validar lifecycle real del supervisor y árbol de procesos; la propagación de señal
  del wrapper tiene prueba local con dobles, no un ensayo de despliegue.
- Verificar que el artefacto runtime excluye laboratorios y configuración de producción.
- Mantener gates de PriceSmart apagados; no hay endpoints, M2M, worker ni acuerdos nuevos.

No se ejecutó SQL productivo ni sintético real, no se abrió una DB, no se agregó
ninguna credencial real, no se cambió DNS, no se desplegó ni se fusionó el PR.
