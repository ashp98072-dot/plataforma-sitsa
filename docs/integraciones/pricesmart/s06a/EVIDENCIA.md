# S06-A — resultados y límites

Fecha: 2026-10-31, America/Guatemala. Entorno real de estas verificaciones: Windows, Node 24.18.0. Base `1f3857c2696b820e3081a468929854d9b02f53f8`. Se confirmó por Git y API GitHub que #545 está fusionado con ese SHA. No se creó infraestructura ni se ejecutó compilación Next, SQL, systemd, firewall, TLS, HTTP de aceptación o navegador.

| Verificación efectivamente ejecutada | Resultado | Método / evidencia |
|---|---|---|
| Validador offline S06-A | PASS | Node test runner: 12 tests, 12 PASS, 0 FAIL, 0 skipped. Casos positivos documentales artificiales, negativos de estados, 16 controles críticos, 25 pruebas reales ausentes, gates, método estático falso, hashes/fechas/aliases, paths/enlaces/tamaño, errores sin contenido sensible |
| Plantilla sanitizada | PASS de formato | CLI `validate`: exit 0, `schemaValid:true`, `authorizedToExecute:false`. No es preflight operativo PASS |
| Bloqueo del preflight | PASS del bloqueo | CLI `assess`: exit 2, `BLOCKED`, 48 entradas pendientes, `firstUnapprovedGate:GATE1`, autorización/certificación false |
| Regresión S02–S05 sin modificaciones | PASS | Vitest: 14 archivos, 330 tests PASS, 0 skipped. Se conservan límites originales de mocks/fixtures; no prueba MariaDB real |
| Total de tests locales | PASS | 342 = 330 Vitest + 12 Node; runners independientes, no una suite operativa Linux |
| ESLint alcance S06-A | PASS | exit 0, `--max-warnings 0` |
| TypeScript del repositorio | PASS | `--noEmit --incremental false`, exit 0 |
| Alcance/diff | PASS | Sólo archivos nuevos S06-A, sin cambiar S02–S05, negocio, lock, migraciones, configuraciones productivas o #541; diff check sin errores |
| PF01–PF16 y Gates 1–7 reales | NO EJECUTADA | Plantilla explícitamente sin aprobación/evidencias; faltan decisiones y VM nueva |
| Matriz real A–L (25 casos) | NO EJECUTADA | Sin infraestructura/autorización; cada fila documenta método futuro, PASS esperado, negativos y evidencia requerida |
| Recuperación/restauración/reversión | NO EJECUTADA | Runbook revisable, no ejecutado; no hay instancia destino, backup ni protocolo de restore validado |

Las dependencias Vitest/TypeScript/ESLint ya existentes del laboratorio S05 se reutilizaron mediante junction local ignorada; no hubo descarga ni instalación. El script S06-A sólo requiere Node/módulos estándar y el helper de paths S05 existente. El sistema de pruebas Node crea archivos sintéticos temporales y procesos Node locales para comprobar el CLI; no modifica infraestructura, cuentas ni ACL existentes. La automatización no inspecciona variables de entorno/secretos del operador ni ejecuta SQL o comandos Linux.

## Comandos reproducibles ejecutados

```sh
node --test scripts/sandbox-s06a/preflight.test.mjs
node scripts/sandbox-s06a/preflight.mjs validate infra/pricesmart-sandbox/s06a/dossier.example.json
node scripts/sandbox-s06a/preflight.mjs assess infra/pricesmart-sandbox/s06a/dossier.example.json
# El comando anterior DEBE terminar con exit 2; no convertirlo en éxito operativo.
node node_modules/vitest/vitest.mjs run --config vitest.s05.config.mts
node node_modules/eslint/bin/eslint.js scripts/sandbox-s06a/*.mjs --max-warnings 0
node node_modules/typescript/bin/tsc --noEmit --incremental false
git diff --check
```

Después del commit, revisar archivos y diff completo:

```sh
git diff --name-status 1f3857c2696b820e3081a468929854d9b02f53f8...HEAD
git diff --binary 1f3857c2696b820e3081a468929854d9b02f53f8...HEAD
```

No se almacena un diff autorreferente en el propio commit: el PR suministra diff completo y SHA auditable. El expediente JSON ejemplo es un modelo sin ninguna evidencia real de Linux, no una aprobación. Los hashes artificiales de los tests sólo prueban formato y jamás se escriben como resultados operativos.

## Riesgos y decisiones que bloquean ejecución

Sin proveedor/precio/capacidad elegidos; consola/BPF/cgroup/offline sin verificar; build Linux S05 y repetibilidad pendientes; acceso privado/navegador sin diseño aprobado; runtime bloqueado S04 incompatible con aceptación positiva de login y prueba efectiva SELECT; ensureSchema frío potencialmente incompatible con sólo lectura; backup/restore en otra instancia nueva y RPO/RTO sin validar. El hash documental no autentica por sí solo autoría ni contenido: auditor debe inspeccionar los originales sanitizados y las autorizaciones custodiadas.

No se obtuvieron contraseñas ni se controló escritorio. No se accedió a Hostinger/producción/PriceSmart, no se instaló software, no se creó VM ni se modificaron DNS/firewall/cuentas, no se ejecutó SQL, merge o despliegue. D01–D16 siguen pendientes. La aprobación de ejecución futura es posterior y expresa; no se infiere de un PASS estático ni del PR.
