# S04: matriz de evidencia y pendientes para S06

Fecha: 2026-10-31 (America/Guatemala). Base `99bc0799c18bc5cea1245b91a7c363173edc608e`, merge #543/S03 con #542/S02 incorporado. Esta entrega es un PR nuevo en borrador; SHA/numero se publican en el PR sin referencia circular en el commit.

**Resultado: PASS de preparacion estatica/modelo; NO declara aislamiento operativo.** La aceptacion de motor, permisos efectivos, UI y Linux se reserva a S06 autorizado y auditoria independiente. D01-D16 pendientes. No merge, despliegue ni cambios al PR #541.

Procedencia/protocolo/alcance: [README.md](README.md). Evidencia sanitizada por caso nuevo y resumen de regresion: [evidence.json](evidence.json). Inventario completo: [schema-inventory.json](schema-inventory.json).

| Control | Resultado S04 | Evidencia / limites |
|---|---|---|
| S02 y S03 fusionados presentes, sin duplicacion/modificacion | PASS | origin/main actualizado; 52 archivos previos comparados por blobs Git, identicos |
| Inventario de fuentes | PASS estatico | Baseline: 108 tablas, 337 indices inline/normalizados, 252 FKs inline, 6 ALTER; 280 SQL; otras 70 definiciones/64 nombres con procedencia, sin presumir aplicacion |
| ensureSchema y accesos cualificados | PASS auditoria | 42 candidatos en 12 archivos, 151 llamadas ensure/asegurar, 14 sitios information_schema; dinamicos y estado real pendientes |
| Esquema seleccionado y orden | PASS estatico | 26 tablas, 49 FKs, 34 DDL; padres transitivos y ALTER diferidos; nunca FK_CHECKS=0 |
| Reproducibilidad Windows/Linux del SQL generado | PASS local | Normalizacion LF y caso CRLF/LF equivalentes; NO ensayo del motor Linux |
| Fixtures e integridad | PASS local | 29 filas; required/columnas/longitudes/unique/FK simple-compuesta y referencias logicas; rechaza huerfanos y cruce de tenant |
| Semantica solicitud | PASS dominio existente | Validador Carga/Entrega/Descarga real; portal deshabilitado y plan_id NULL |
| Auth/selector/lectura rutas y solicitudes | PASS con DB doble | Funciones reales, hashes scrypt existentes y allowlist SELECT; no HTTP ni SQL de motor |
| Usuario runtime no cambia marcador ni otra DB | PASS matriz/modelo; NO EJECUTADA real | SELECT por tabla exacto; negativas UPDATE/DDL/esquema ajeno en doble; grants reales pendientes S06 |
| Rechazo de grants globales/schema.*, roles, PUBLIC, marcador escribible y GRANT OPTION | PASS negativas | Analisis de SHOW GRANTS simulado; sintaxis/formato MariaDB reales pendientes |
| Instancia/base/cuentas previas y credenciales cruzadas | PASS modelo | Rechazo previo a DDL; S02 reutilizado; no conexion real ni prueba de procedencia de VM |
| Lock, carrera de base creada durante lock y conexion estable | PASS modelo | Relectura bajo lock; CONNECTION_ID/port/datadir/bind/version/FK/CHECK/strict/local_infile |
| Fallos intermedios | PASS modelo | Indices/FKs/engine/objetos incorrectos y 7 puntos de mutacion fallidos; aborta sin DROP/reset/adopcion; cuenta nunca desbloqueada |
| Repetir Prepare / journal exclusivo | PASS local-modelo | Sin nuevos queries ni cambio de secretos al repetir; wx impide reclamar journal existente |
| S04 nuevas | PASS **58/58** | 52 de plan/provision/seguridad + 6 de funciones de navegacion |
| Regresion S02 + S03 | PASS **237/237** | Suite heredada y bloqueo de red existentes; 195 S02 + 42 S03 |
| Total | PASS **295/295**, 11 archivos, cero omisiones | Casos sanitizados en JSON; no son pruebas de MariaDB real |
| TypeScript | PASS | `--noEmit --incremental false`, exit 0 |
| ESLint alcance | PASS | scripts/sandbox-s04 + vitest.s04.config.mts, exit 0, cero warnings |
| Diferencias | PASS | git diff --check y cached --check; solo artefactos/herramientas/docs S04 |
| DDL/FK/indices/tipos y seeds MariaDB 11.8 reales | NO EJECUTADA | Requiere nueva instancia/infraestructura aprobada S06; ninguna SQL se ejecuto en S04 |
| Grants efectivos, cuenta bloqueada/desbloqueada y base canario | NO EJECUTADA | S06 debe probar con cuentas reales del laboratorio; no sustituido por doubles |
| Login/tenant/lecturas por HTTP y navegador, cold-start | NO EJECUTADA | Incluye detectar ensureSchema y queries adicionales de UI; no habilitar DDL runtime para ocultar fallos |
| VM/PID/datadir fisico, ACL Linux, fsync ante crash, firewall, backup/restore | NO EJECUTADA | Se mantienen gates operativos S03 y autorizacion/recursos adicionales |

## Comandos ejecutados y reproduccion

```text
node scripts/sandbox-s04/audit.mjs --write
node scripts/sandbox-s04/plan.mjs --write
node node_modules/vitest/vitest.mjs run --config vitest.s04.config.mts --reporter=json --outputFile=.lab-runtime/tests-final.json
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js scripts/sandbox-s04 vitest.s04.config.mts
git diff --check
git diff --cached --check
git diff 99bc0799c18bc5cea1245b91a7c363173edc608e HEAD
```

Crear `.lab-runtime` local para reportes crudos, que no se publican. Los generadores solo leen fuentes/escriben plantillas; no hay driver ni CLI --apply en S04. Tests heredan `sandbox-no-network.ts`; SQL se entrega a un doble y no llega a sockets. No se uso Postman, SQL en Hostinger/produccion, dumps reales, servicios existentes ni datos contables productivos.

Dependencias locales preinstaladas de S03/S02 reutilizadas mediante junction ignorada; sin npm ci/descargas en S04 ni cambio de package.json/lockfile. Node 24.18.0, Vitest 4.1.12, TypeScript 5.9.3. Lockfile SHA256 `d41410a952adfd432b3f2ee7de20a9ef161c4d0554e532e2a28245082965c3e9`. Instalacion nativa Linux/lockfile, soporte de ACCOUNT LOCK y forma exacta SHOW GRANTS quedan para S06.

El journal se prueba con archivos locales Windows: no se afirma validacion de ownership POSIX/durabilidad ante corte. La prueba tambien contempla que un ejecutor Linux no root debe recibir rechazo, no solicita elevacion para pasar. Ninguna conexion SQL se abre por importar los modulos.

## Riesgos y autorizaciones pendientes

- El analizador no consolida SQL dinamico, comentarios ejecutables ni procedimientos como lo hace MariaDB. Las fuentes versionadas no prueban el estado de produccion y no se consulto esa infraestructura.
- Esquema y grants son para el perfil readonly auditado. Full TMS/Flota/dashboards y funciones que aseguran esquema o escriben vinculos pueden fallar: requieren revision posterior, no permisos adicionales automaticos.
- DDL no es transaccional como las filas. Un fallo deja objetos parciales y journal no reutilizable. No se resetea ni se adopta una DB existente. S06 debe ensayar crash/errores de filesystem, cierre de conexion y estado de cuenta antes de emitir secretos runtime.
- El runtime DB no tiene seguridad por fila: acceso entre tenants debe probarse en aplicacion; la base canario debe ser exclusivamente sintetica y crearse solo dentro de una instancia nueva autorizada.
- Autorizacion S06/attestation declarativa no sustituye inspeccion firmada de VM/discos/PID/rutas, ausencia de escritores y procedencia de secretos. Eso corresponde al operador autorizado y auditoria.
- Solo un laboratorio nuevo aprobado puede validar SQL, cuenta/grants, integridad, cold-start, UI, TLS/red y recuperacion. No ejecutar las plantillas directamente quitando SIGNAL ni conectar el harness a una instancia anterior.

El criterio de entrega es preparacion para S06, no certificacion de aislamiento ni autorizacion de merge. No se crea un modelo contractual/API PriceSmart y D01-D16 permanecen sin ratificar.
