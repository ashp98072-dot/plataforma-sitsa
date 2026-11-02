# API-02 — evidencia y limitaciones

Fecha: 2026-11-02 (America/Guatemala). Base `d6222b31` (origin/main, incluye #547). Implementación desconectada sobre rama nueva. Esta evidencia es de código y dobles; no inspección física de una base.

## Resultados disponibles

| Verificación | Resultado | Alcance |
|---|---|---|
| API-01 + adaptador + regresión S02–S05 | PASS: 17 archivos, 408 casos | Vitest; 32 casos nuevos del adaptador y 1 marca S02; 375 heredados |
| S06-A preflight documental | PASS: 12 casos | Runner Node independiente, no infraestructura |
| TypeScript | PASS, exit 0 | --noEmit --incremental false |
| ESLint del alcance | PASS, exit 0, cero warnings | Código API, S02 y pruebas modificadas |
| git diff --check | PASS | Sin errores de espacios |
| SQL propuesto | Revisión estática | Reutiliza staging.sql.in API-01, UNIQUE/FK/CHECK binarios; no ejecución/validación sintáctica del motor |

Cobertura nueva: INSERT y scope parametrizado; conteo placeholders/parámetros; espera de COMMIT; lectura FOR UPDATE; tenant ajeno; creación con cuatro escrituras; replay idéntico con snapshot inmutable después de cambio de estado; conflicto de huella; cancelación/versionado; CAS con cero filas; fallos de evento/auditoría/outbox; rollback incluso si callback captura error; rollback fallido; COMMIT incierto; deadlock y timeout seguidos de otra transacción; duplicates exactos de identidad frente a PRIMARY/scoped/otra tabla; duplicates en evento/auditoría/outbox nunca replay; pool no verificado; esquema/base/cuenta/root/S04 rechazados; conexión rechazada; Tx expirada; marca auténtica de fachada S02 frente a pool raw, objeto similar y herencia.

El doble de mysql2 comprueba consultas, argumentos, secuencia y errores. Su codec devuelve bytes opacos de prueba sin cifrado, su identidad SQL es falsa y su COMMIT sólo una promesa. La marca S02 se sustituye explícitamente por un spy en los tests del adaptador, sin agregar bypass al código productivo; la marca auténtica se prueba por separado con la regresión S02. No se crea una conexión mysql2. Los casos del adaptador que observan el literal DURABLE sólo comprueban el contrato después del COMMIT simulado, no durabilidad física. Los tests heredados API-01 siguen reportando SIMULATED en su ModelRepository.

## Comandos

Desde `.worktrees/pricesmart-api02` se reutilizaron dependencias ya disponibles en el workspace padre:

```powershell
node ../../node_modules/vitest/vitest.mjs run --config vitest.pricesmart-api01.config.mts
node --test scripts/sandbox-s06a/preflight.test.mjs
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
node ../../node_modules/eslint/bin/eslint.js src/lib/integrations/pricesmart src/lib/sandbox-db.ts src/lib/sandbox-isolation.test.ts --max-warnings 0
git diff --check
```

Vitest instalado utilizado: 4.1.11 (el package.json de base solicita 4.1.12). No se modificaron package/lock ni se descargaron dependencias. La reproducibilidad exacta con instalación limpia del lock queda pendiente; los PASS corresponden al entorno disponible declarado. No se ejecutó Next build ni la suite general de módulos ajenos al alcance.

Durante preparación se invocaron por error tests Vitest .mjs de S03–S05 con `node --test`: fallaron al no encontrar runner Vitest. Se corrigió usando la configuración Vitest heredada que los incluye; su corrida final es la indicada arriba. S06-A sí usa node:test y pasó por separado. Un intento inicial de leer guía Next desde el worktree sin dependencias no halló el archivo; se leyó la guía local data-security.md de Next desde las dependencias del workspace antes de escribir código. Ninguno de estos intentos ejecutó SQL.

## Validaciones reales pendientes

| Prueba | Estado | Requisito |
|---|---|---|
| Dos conexiones MariaDB reales, INSERT simultáneo igual/conflictivo | NO EJECUTADA | Instancia nueva autorizada, nunca S04 |
| Bloqueos FOR UPDATE, aislamiento, deadlocks y lock wait timeout reales | NO EJECUTADA | Dos conexiones/procesos y fault injection revisada |
| Índices UNIQUE binarios, FK, CHECK y engine efectivos | NO EJECUTADA | DDL aprobado aplicado manualmente por administrador |
| Atomicidad ante fallo evento/auditoría/outbox y rollback real | NO EJECUTADA | Inspección de tablas antes/después, distinta conexión |
| Caída antes/durante/después COMMIT, durabilidad y recuperación | NO EJECUTADA | Crash/restart, log/fsync/disco, conciliación y restore |
| Grants y denegaciones efectivos, cuenta/base y rechazo tenant en motor | NO EJECUTADA | Perfil API nuevo, auditoría de roles/grants, S04 intacto |
| Cifrado autenticado, claves, rotación y retención | NO EJECUTADA | Implementación/proveedor/política ratificados |
| M2M, HTTP, materialización TMS, outbox worker, Linux/despliegue | NO EJECUTADA | Alcance futuro con aprobaciones y pruebas propias |

No se usó Hostinger, SQL productivo, infraestructura o credenciales reales. No se desbloqueó ni alteró S04, ni se ejecutaron migraciones. No hay rutas HTTP nuevas, autenticación inventada, cambios TMS, merge o despliegue. D01–D16 siguen pendientes. El PR en borrador se entrega para auditoría independiente antes de continuar.

## Diff y SHA

El SHA final se entrega en el PR y respuesta (no se incrusta un SHA autorreferente en este commit). Diff completo reproducible:

```powershell
git rev-parse HEAD
git diff --name-status d6222b31...HEAD
git diff --binary d6222b31...HEAD
```

También disponible en la pestaña Files changed y en la URL `.diff` del PR en borrador.
