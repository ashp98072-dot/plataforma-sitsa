# S05 — matriz de evidencia sanitizada

Fecha: 2026-10-31, America/Guatemala. Entorno: Windows, Node 24.18.0; Next instalado 16.4.1. Dependencias locales reutilizadas desde el laboratorio S04 mediante junction **sólo para las pruebas**. El empaquetador rechaza ese origen para un artefacto real. Ninguna instalación de dependencias ni conexión SQL fue necesaria.

Base auditada: `388dd33cc61abcc3dd830b4f3acae93e3ca5b3bc` (merge #544). S02–S04 están presentes en su historia. Sólo se agregan archivos de scripts, pruebas, plantillas y documentación S05. No cambian negocio, migraciones, lock, configuración Next, controles S02–S04, grants ni cuentas.

| Prueba | Estado | Método / evidencia / límites |
|---|---|---|
| Regresión S02–S04 | PASS | Vitest: 295 casos heredados; driver/HTTP según límites originales, no MariaDB real |
| S05 empaquetado y seguridad | PASS | 35 casos nuevos; filesystem real con contenido sintético, procesos Node reales para denegación y arranque inválido |
| Total automatizado | PASS | 14 archivos, 330 pruebas, 0 omitidas; salida `Test Files 14 passed (14)`, `Tests 330 passed (330)` |
| Repetibilidad de empaquetado | PASS | Dos destinos nuevos del mismo árbol sintético producen manifiesto y hash idénticos; no prueba dos builds Next |
| Alteración, faltantes, extras, ancla incorrecta | PASS | Rechazados por hashes y lista exacta |
| Traversal, junctions de origen/interiores/ancestros/destino | PASS | Pruebas filesystem reales; no se tocaron ACL de carpetas existentes |
| Caché técnica separada de integridad | PASS | Instalación rechaza extras; verificador runtime acepta sólo caché declarada, rechaza junction y código cambiado |
| Archivos administrativos, secretos reconocibles, uploads, sourcemaps | PASS | Casos negativos sintéticos; expresiones no prueban ausencia universal de secretos |
| Red/SQL durante proceso Node | PASS | Preload real deniega TCP, TLS, fetch y createPool mysql2 antes de I/O; journal registra sólo DENIED |
| Arranque sin modo/configuración confiable | PASS | Proceso real del supervisor finaliza 1 sin ejecutar server.js canario; no es inicio Next válido |
| Builder en plataforma no autorizada | PASS | Proceso con env vacío finaliza 1, stdout vacío, stderr `S05_BUILD_REJECTED`; no se ejecutó Next build |
| TypeScript | PASS | `tsc --noEmit`, exit 0 |
| ESLint del alcance | PASS | `--max-warnings 0`, exit 0 |
| Diff/alcance | PASS | `git diff --check` y revisión de nombres agregados; sin cambios a módulos de negocio ni controles anteriores |
| Stage de fuente versionada limpia | Pendiente de registro posterior al commit | Se ejecutará sin dependencias, servicios ni secretos; ver actualización inferior |
| Build Next Linux aislado y dos builds comparados | NO EJECUTADA | Falta laboratorio Linux aprobado y caché npm para arquitectura/libc. No hay artefacto Novalvion ni hash final de release |
| Trazas reales / contenido mínimo definitivo / bundles sin secretos | NO EJECUTADA | Requieren salida del build real; auditoría de fuentes y pruebas sintéticas no equivalen |
| Carga real de sharp/SWC, PDF/XLSX/imágenes | NO EJECUTADA | Requiere paquete Linux; incluidos como dependencias a auditar, no declarados funcionales |
| Arranque válido loopback / identidad antes de operaciones | NO EJECUTADA | Requiere Linux y MariaDB nueva autorizada, manifiesto/secretos sintéticos; cuenta S04 permanece bloqueada |
| MariaDB ausente / cuenta bloqueada / marcador ajeno reales | NO EJECUTADA | No se ejecutó SQL ni se abrió instancia. Pruebas heredadas de guards son unitarias |
| SIGTERM, descendientes, cgroup vacío, reinicio tras error | NO EJECUTADA | Falta systemd Linux real. Reenvío de señales en código no certifica control de descendientes |
| Firewall, TLS, restauración/rollback operativo | NO EJECUTADA | Reservados S06, sin cambios reales |

## Comandos ejecutados y reproducibles

Desde la rama S05 con dependencias del lock ya disponibles:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.s05.config.mts
node node_modules/eslint/bin/eslint.js scripts/sandbox-s05/*.mjs scripts/sandbox-s05/*.cjs vitest.s05.config.mts --max-warnings 0
node node_modules/typescript/bin/tsc --noEmit
git diff --check
git diff origin/main...HEAD --name-status
git diff --binary origin/main...HEAD
```

El diff completo es el del PR y puede obtenerse con el último comando o la URL `.diff` del PR. No se incluye un diff autorreferente dentro del propio commit.

El perfil Linux, comandos de instalación/rollback y pendientes están en [README.md](README.md). No se ejecutaron comandos systemctl, nft, SQL, DNS, desbloqueo de cuentas ni despliegue. D01–D16 pendientes. No se modifica PR #541. El resultado es preparación parcial auditada estáticamente; no satisface todavía la validación real de artefacto Linux.
