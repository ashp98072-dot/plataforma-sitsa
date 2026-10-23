# PR #512 — actualización de seguridad de dependencias

Base: `ad219de7` (main con PR #511). Rama: `security/pr512-dependency-updates`.
Diagnóstico y validación locales del 23 de octubre de 2026. No se consultó ni operó producción.

## Selección de versiones

| Paquete | Antes | Después | Alcance |
| --- | --- | --- | --- |
| next | 16.3.6 | 16.4.1 | Producción; release estable de seguridad |
| eslint-config-next | 16.2.12 | 16.4.1 | Desarrollo; alineado con Next |
| vitest | 4.1.11 | 4.1.12 | Desarrollo; parche de la misma línea |
| @vitest/mocker | 4.1.11 | 4.1.12 | Transitiva de Vitest |
| vite | 8.2.2 | 8.2.4 | Transitiva de Vitest, override acotado |
| source-map-js | 1.2.1 | 1.2.2 | Transitiva de PostCSS/Next y Tailwind |

React/React DOM 19.2.4 y sharp 0.35.5 se conservan. El registro oficial confirma que Next 16.4.1 acepta React 19 y Node >=20.9. Vite requiere Node ^20.19.0 o >=22.12.0. `engines.node` ahora expresa la intersección compatible con Vitest: `^20.19.0 || ^22.12.0 || >=24.0.0`.

Se elige el release estable corregido mínimo de Next y el parche de Vite 8.2 para evitar una actualización innecesaria a Vite 8.3 o Vitest 5. El override `vitest.vite=8.2.4` es compatible con el rango admitido por Vitest y no excluye avisos del audit. source-map-js se actualiza mediante `npm update source-map-js --package-lock-only`; no se edita el lockfile a mano. npm resuelve también las dependencias y binarios opcionales de las versiones nuevas. Se conserva el override existente de uuid para ExcelJS. No se usa `npm audit fix --force`.

## Avisos oficiales y exposición observada

- [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr): RCE de `use cache` con typed arrays, corregida en 16.4.1. El repositorio usa App Router; no se encontraron directivas `use cache` ni `cacheComponents`. Se actualiza siguiendo la indicación del proveedor aunque esa condición no esté presente.
- [GHSA-2464-fhr4-w9xw / CVE-2026-96889](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw): RCE relacionada con Image Optimization/SVG en Linux glibc, corregida en 16.4.1. Hay uso de `next/image`; no se habilita `dangerouslyAllowSVG` ni imágenes remotas en la configuración. sharp 0.35.5 ya estaba instalado y coincide con la mitigación indicada por el proveedor. Esto no sustituye la actualización ni prueba el estado del servidor Hostinger.
- [GHSA-p3m5-59mp-jv5r / CVE-2026-94482](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r): DoS con Server Actions, corregido en 16.4.1. No se encontraron directivas `use server`; la aplicación usa Route Handlers. No se afirma explotabilidad productiva solo por tener instalado Next.
- [GHSA-h694-7cp9-m8p3 / CVE-2026-103004](https://github.com/vercel/next.js/security/advisories/GHSA-h694-7cp9-m8p3): fuga de caché anidada y root params, corregida desde 16.3.8 y cubierta por 16.4.1.
- El audit previo incluye además GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-39w2-rjm5-chcv, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p y GHSA-cjq9-62q9-8jv4 (Draft Mode/caché, SSG/ISR, endpoint MCP de desarrollo, metadata y SSRF de imágenes). Sus rangos afectados terminan antes de 16.3.8. Todos dejan de reportarse tras actualizar. Los enlaces y rangos oficiales individuales se conservan en `audit-before.json`.
- [GHSA-qxg6-89mg-rqv8 / CVE-2026-112949](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8) y [GHSA-xp26-3454-mjgp / CVE-2026-112950](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp): inyección en mocks y bypass de allowlist Windows; corregidos en mocker 4.1.12. Son herramientas de desarrollo, sin importaciones en rutas productivas ni uso explícito de `mockerPlugin`/`interceptorPlugin`.
- [Vite 8.2.4](https://github.com/vitejs/vite/releases/tag/v8.2.4) corrige las alertas de su servidor de desarrollo reportadas en el audit: GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm, GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22 y GHSA-vfpm-58rq-9qcg. Se conservan sus referencias individuales en el audit previo.
- [GHSA-68fv-2mgg-jv7q / CVE-2026-93749](https://github.com/advisories/GHSA-68fv-2mgg-jv7q): DoS al procesar sourcemaps indexados, corregido en source-map-js 1.2.2. npm lo clasifica como producción por PostCSS transitivo de Next, aunque el repositorio no implementa un endpoint público para recibir sourcemaps arbitrarios.

## Audit antes y después

| Comando | Antes | Después |
| --- | --- | --- |
| npm audit | 10 paquetes: 1 crítico, 7 altos, 2 moderados; exit 1 | 5 altos de desarrollo; exit 1 |
| npm audit --omit=dev | 2 paquetes: 1 crítico, 1 alto; exit 1 | 0 vulnerabilidades; exit 0 |

Los conteos son paquetes afectados, no CVE únicos. Los JSON completos están en [evidencia](evidence/pr512-dependencies/).

Las cinco alertas restantes son `braces → micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next`, una sola causa raíz de desarrollo. [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 fue retirado por GitHub el 23/10/2026](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) por no ser prácticamente explotable. El registro npm seguía reportándolo durante estas ejecuciones; braces 3.0.3 es el último publicado y no hay versión parcheada. No se oculta la alerta, no se modifica la política de severidad y no se aplica el downgrade a ESLint/Next 14 sugerido por npm. El audit completo **no pasa**; el de producción sí.

## Dependencias usadas y operación

Se revisaron importaciones en `src`, scripts y configuraciones. Todas las dependencias directas de producción tienen consumidores: incluso sharp (miniaturas de empleados), pdf-lib (expediente PDF), react-dom (portal de movimientos) y dotenv (scripts de mantenimiento). No se eliminan paquetes por una detección superficial de imports. La revisión no identifica una dependencia directa abandonada que pueda quitarse con seguridad dentro de este alcance.

Las dependencias directas de desarrollo también tienen uso comprobable: TypeScript y paquetes @types en compilación, ESLint y su configuración, Tailwind/PostCSS en estilos, Vitest en las suites y happy-dom en sus entornos DOM. Se conservan para build/pruebas y se retiran del runtime mediante la poda posterior al build.

`npm run dev` queda limitado a `127.0.0.1`; no es el comando productivo. `test` ejecuta `vitest run`, sin un servidor público; el proyecto no configura navegador ni API de Vitest ni middleware Vite productivo. No se inspeccionaron puertos/firewall de Hostinger. En producción deben usarse `npm run start:hostinger` o `npm start` con NODE_ENV=production, nunca dev/test:watch ni puertos auxiliares publicados.

No cambian guards, rutas, autenticación, secretos, CSRF, permisos, aislamiento multiempresa, cookies, headers ni reglas de negocio. Se conservan las opciones declaradas `experimental.cpus=1` y `turbopackPluginRuntimeStrategy=workerThreads`, compresión y externalización de ExcelJS/PDFKit. La prueba existente del selector **real instalado** de workers ahora verifica Next 16.4.1 en lugar de la versión anterior.

## Compatibilidad relevante para Hostinger

La configuración declarada y la resuelta no son siempre iguales. El [cargador oficial de Next 16.4.1](https://github.com/vercel/next.js/blob/v16.4.1/packages/next/src/server/config.ts) sustituye workerThreads por childProcesses en Node >=24.13.1 ante [un fallo conocido de Node](https://github.com/nodejs/node/issues/65100). Aunque el build local con Node 24.18.0 pasó, esa sustitución podría reactivar el problema de loaders/procesos en Hostinger compartido. No se usa `forceWorkerThreads` ni se desactiva la protección.

Se verificó un segundo build limpio con **Node 22.23.4/npm 10.9.9**: la configuración resuelta conserva **workerThreads y cpus=1** y completa las 54 páginas. Se recomienda la línea Node 22 admitida por engines para ese entorno. Node 20.19+ cumple los requisitos declarados de paquetes, pero no se ejecutó en esta sesión. Node 24.18.0 sí se probó con su fallback; no se presenta como una verificación del mismo mecanismo de loaders.

Node 22 fue descargado como ZIP portable oficial dentro de `.lab-runtime` ignorado por Git, sin cambiar Node global. Archivo: `node-v22.23.4-win-x64.zip`, SHA256 `cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20`, contrastado con [SHASUMS oficiales](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt). `config-node22.json` y `config-node24.json` registran las opciones efectivamente resueltas.

## Validación

| Verificación | Resultado |
| --- | --- |
| npm ci inicial y actualizado | Correctos con Node 24.18.0/npm 11.16.0. El primer intento actualizado tuvo ECONNRESET; el reintento limpio desde el mismo lock pasó. |
| npm ci final con Node 22 | Exit 0 con Node 22.23.4/npm 10.9.9; herramientas de desarrollo restauradas desde el mismo lockfile. |
| TypeScript | `tsc --noEmit --incremental false`, exit 0. También pasa la comprobación de tipos integrada en ambos builds. |
| ESLint completo | Exit 1 antes y después: **40 errores previos**, 34 set-state-in-effect y 6 refs, en 23 archivos. Diagnósticos completos comparados: idénticos; cero nuevos. |
| ESLint de archivos modificados y scripts de auditoría | Exit 0, cero advertencias. |
| Suite completa antes/después, Node 24.18.0 | **12,143 casos**: 11,363 aprobados, 31 fallidos, 749 omitidos, en 731 archivos. Mismos 31 nombres de fallo; cero nuevos. No se reporta la suite como aprobada. |
| Áreas prioritarias dentro de la suite completa | 110 archivos seleccionados por rutas de sesión/auth, permisos, tenant, dashboard, Flota/Predios y combustible/CB2: **1,199 casos ejecutados aprobados, cero fallidos**. |
| Regresión adicional con Node 22 | **375 pruebas aprobadas en 37 archivos**, incluidas sesiones, tenant, CSRF, HALEL/SHELL, CB2, idempotencia y configuración real de Next. |
| npm run build, Node 24.18.0 | Exit 0; 54/54 páginas, un worker de prerender; fallback de loaders a childProcesses documentado. |
| npm run build limpio, Node 22.23.4 | Exit 0; 54/54 páginas, un worker de prerender; loaders workerThreads resueltos. |
| Runtime tras npm prune --omit=dev | **11 comprobaciones aprobadas** tanto con Node 24 como con Node 22, servidor limitado a localhost, BD sin configurar. |
| SQL/migraciones | Sin cambios; ninguna ejecución en producción. |

Los 31 fallos previos están individualizados en `regression-comparison.json`. Incluyen pruebas antiguas de estructura/SQL y programación, comprobaciones de historial Git y una exportación que requiere `unzip`, no instalado en este Windows. Los 749 casos omitidos incluyen suites de integración de laboratorio y comparaciones con bases históricas no habilitadas. No se alteran esas pruebas ni reglas funcionales para conseguir un resultado verde.

El smoke arranca el build con un secreto efímero generado localmente (no registrado), DB_USER/DB_NAME vacíos y sin archivos de entorno persistentes; se cancela si los encuentra. Comprueba páginas públicas de login, rechazo de cookies inválidas, redirecciones de selección de empresa/dashboard/Flota/Predios, validación de formulario vacío y rechazo de endpoints CB2 sin sesión. Verifica ausencia física local de Vitest/Vite/mocker/ESLint/TypeScript/happy-dom y bloquea fallback CommonJS a node_modules de worktrees padres. No prueba un login válido ni operaciones autenticadas contra BD; sesión, permisos, CSRF, HALEL/SHELL, confirmación parcial e idempotencia se cubren mediante pruebas con dobles y fixtures sintéticas. No se hizo una revisión visual de navegador ni se inspeccionó Hostinger real.

Los builds generan cinco advertencias de tracing por accesos dinámicos al filesystem, además de avisos de convención middleware y headers. No se migra middleware a proxy ni se altera la arquitectura dentro de este PR. Los logs conservan estos avisos; PowerShell puede envolver stderr de warnings como NativeCommandError aun con exit de build 0. Se normaliza su presentación a UTF-8/LF sin ANSI, espacios finales ni líneas vacías finales adicionales.

### Reproducción en un worktree aislado

Usar Node 22 compatible para reproducir los loaders de Hostinger. No ejecutar el smoke en producción ni en un directorio con .env/config persistente. La suite completa y ESLint global conservan los fallos documentados, por lo que devuelven exit 1.

```powershell
npm.cmd ci --no-audit --no-fund
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
npm.cmd run lint
npm.cmd test -- --maxWorkers=2
.\node_modules\.bin\eslint.cmd next.config.ts src/next-config-build-workers.test.ts docs/evidence/pr512-dependencies/*.mjs --max-warnings=0
# Solo para el build aislado sin BD ni archivos de entorno persistentes:
$env:AUTH_SECRET = [guid]::NewGuid().ToString('N')
$env:DB_USER = ''
$env:DB_NAME = ''
$env:DB_PASSWORD = ''
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '1'
$env:NEXT_TELEMETRY_DISABLED = '1'
npm.cmd run build
npm.cmd audit
npm.cmd audit --omit=dev
node docs/evidence/pr512-dependencies/config-runtime-check.mjs
npm.cmd prune --omit=dev --ignore-scripts --no-audit --no-fund
node docs/evidence/pr512-dependencies/runtime-smoke.mjs
npm.cmd ci --no-audit --no-fund
git diff --check
```

Los JSON de tests/lint son reportes compactos derivados de las salidas JSON nativas; no incluyen el código fuente completo que ESLint añade ni stacks repetidos. Conservan conteos globales y suites fallidas/diagnósticos; las suites prioritarias aprobadas se enumeran en `critical-suites.json`. `versions.json` registra cambios transitivos y los cuatro audits mantienen la respuesta original normalizada a UTF-8/LF. La restauración final de herramientas y la validación adicional con Node 22 se registran en `validation.json`.

No se crean GitHub Actions, no se cambian dependencias ajenas deliberadamente, no se modifica SQL y no se hace merge ni deploy. El PR permanece Draft para auditoría independiente.
