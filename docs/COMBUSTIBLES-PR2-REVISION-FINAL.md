# PR #507: revision final contra main

Revision: 2026-10-22. Cabeza auditada: cd13130838981c49e28d1ad2eab7bdd77f473322.
Base main: 03f9de4030407168adb80db71719c0c4ae626f9e.
Este informe y la aclaracion del README son los unicos cambios de esta revision.
No se modifica SQL, contrato ni codigo de laboratorio.

## Alcance y hallazgos

Se revisaron los 85 archivos del diff inicial: 2 ajustes de repositorio,
6 documentos, 56 evidencias (55 JSON y un ZIP), 16 archivos de laboratorio y
5 SQL. Todos corresponden al diseno, validacion o ejecucion de Combustibles PR2.
El inventario individual figura abajo. El informe agrega un archivo: diff final
86 archivos; no son 86 archivos de aplicacion.

No hay modificaciones de APIs, interfaces, servicios, dependencias, workflows
ni archivos SQL historicos. Los nueve objetos BASE se consultan y referencian;
la migracion publicada solo crea las cuatro tablas flota_cb2_* aprobadas.
Las tablas BASE sinteticas y DML/ALTER negativos pertenecen al laboratorio aislado.
El importador conserva el DDL exacto del canonico; el postcheck independiente
conserva metadata e incidencias y no escribe datos ni estructura.

No se identificaron temporales versionados que deban eliminarse. Se conserva
la evidencia de iteraciones anteriores, incluido el fallo de infraestructura,
para explicar limites y correcciones: no constituye certificacion del HEAD.
Los source.json fijan hashes de las fuentes de cada corrida; baseline es una
referencia historica y no debe interpretarse como SHA de todas las fuentes.
El ZIP mas reciente contiene 1487 entradas (692 SQL, 780 JSON, 15 logs),
7742156 bytes descomprimidos; no contiene binarios ni datadirs. Se revisaron
nombres/rutas y contenido textual, sin detectar claves privadas o tokens en
los patrones inspeccionados. Los 56 JSON versionados (55 evidencias y una referencia CHECK) se pudieron parsear.
No se incluyen respaldos ni datos productivos: los fixtures son sinteticos.
.lab-runtime esta ignorado; sus binarios y bases temporales no forman parte del PR.

Hallazgo documental corregido: el README y la descripcion del PR conservaban
estado pendiente y alcance inicial de cuatro archivos. El README ahora distingue
el laboratorio portable ejecutado de la propuesta Actions no publicada. Los
informes anteriores y la evidencia original permanecen como historia auditable.

## Verificaciones y resultados

En esta revision, sin ejecutar SQL: 6 pruebas Node PASS, self-test del arnes PASS,
generadores import/postcheck --check PASS y git diff --check PASS. Las pruebas
comparan DDL/metadata/15 incidencias con fuentes canonicas, BOM, contexto explicito,
nombre/estructura exactos del indice BASE y serializacion CHECK 11.8.9.
main es antecesor de HEAD (merge-base --is-ancestor=0); GitHub indica MERGEABLE/CLEAN.
Esto no equivale a aprobacion funcional ni garantiza ausencia de conflictos futuros.

Evidencia existente mas reciente: corrida 79da826d-0509-427e-a12e-3864540dd3f1,
MariaDB 11.8.9 Win64, 26 registros PASS, 692 llamadas del cliente y 15 instancias
con cierre correcto. Contrato: 4 tablas, 86 columnas, 34 indices, 18 FK, 26 CHECK;
15 incidencias verificadas. Casos positivos/negativos, parser en chunks y mysqli
sin next_result(), con resultados pendientes prohibidos. Cuatro comparaciones
de datos y tres de estructura, de 13 tablas cada una, confirman solo lectura.
No se repitio el laboratorio por estos cambios exclusivamente documentales.

El operador comunica Hostinger: migracion correcta, cuatro tablas presentes y
postcheck independiente CB2_POSTCHECK_FINAL, metadata FINAL, 15 validaciones y
cero incidencias. Se registra como resultado aportado por el operador; no se
accedio a Hostinger ni se inspecciono directamente su base en esta revision.

## Riesgos y pendientes

- Auditoria independiente de ChatGPT y decision de merge pendientes; PR sigue Draft.
- No reejecutar la migracion: las tablas ya existen segun el operador. El DDL de
  MariaDB no es una transaccion atomica de cuatro CREATE; un fallo puede dejar
  estado parcial que exige diagnostico, no reintento automatico.
- El laboratorio usa Win64 y un flujo equivalente parser/mysqli, no la UI/version
  exacta de Hostinger. La evidencia productiva reportada reduce esa incertidumbre
  para la ejecucion realizada, sin certificar futuras versiones o privilegios.
- Postcheck no bloquea escrituras concurrentes ni sustituye controles de acceso,
  recuperacion o futuras pruebas funcionales. Este PR no implementa funcionalidades.
- La ruta remota Actions no esta publicada ni ejecutada; no hay CI SQL automatico
  que se pueda dar por aprobado. Pruebas portables y evidencia son manuales.

## Inventario de los 85 archivos auditados

| Archivo | Proposito |
| --- | --- |
| `.gitattributes` | LF para SQL phpMyAdmin |
| `.gitignore` | Excluir runtime de laboratorio |
| `docs/COMBUSTIBLES-PR2-AUDITORIA-COLLATIONS.md` | Diseno, procedimiento o auditoria CB2 |
| `docs/COMBUSTIBLES-PR2-CONSUMOS-FACTURAS-DISENO.md` | Diseno, procedimiento o auditoria CB2 |
| `docs/COMBUSTIBLES-PR2-CONTEXTO-SESION.md` | Diseno, procedimiento o auditoria CB2 |
| `docs/COMBUSTIBLES-PR2-IMPORT-PHPMYADMIN.md` | Diseno, procedimiento o auditoria CB2 |
| `docs/COMBUSTIBLES-PR2-LAB-RESULTADOS-MARIADB-11.8.9.md` | Diseno, procedimiento o auditoria CB2 |
| `docs/COMBUSTIBLES-PR2-POSTCHECK-PHPMYADMIN.md` | Diseno, procedimiento o auditoria CB2 |
| `docs/evidence/combustibles-pr2-mariadb-11.8.9/017-conteos-independientes.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-mariadb-11.8.9/018-ddl-flota_cb2_importaciones.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-mariadb-11.8.9/019-ddl-flota_cb2_facturas.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-mariadb-11.8.9/020-ddl-flota_cb2_consumos.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-mariadb-11.8.9/021-ddl-flota_cb2_filas.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-mariadb-11.8.9/026-postcheck-eventos.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-mariadb-11.8.9/positivo-isolation.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-mariadb-11.8.9/source.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-mariadb-11.8.9/summary.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/005-import-autocontenido.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/012-import-base-incompatible.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/013-import-handler-restaura.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/014-import-fallo-sin-tablas.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/import-fallo-cleanup.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/import-fallo-isolation.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/import-sesion-cleanup.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/import-sesion-isolation.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/parser.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/source.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-import/summary.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/011-import-autocontenido.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/018-import-base-incompatible.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/019-import-handler-restaura.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/020-import-fallo-sin-tablas.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/037-conteos-independientes.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/038-ddl-flota_cb2_importaciones.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/039-ddl-flota_cb2_facturas.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/040-ddl-flota_cb2_consumos.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/041-ddl-flota_cb2_filas.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/046-postcheck-eventos.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/client-sources.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/import-fallo-cleanup.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/import-fallo-isolation.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/import-sesion-cleanup.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/import-sesion-isolation.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/infrastructure-failure.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/metrics.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/mysqli-cleanup.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/mysqli-flow.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/mysqli-import.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/mysqli-isolation.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/parser.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/source.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/summary.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/client-sources.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/lab-evidence.zip` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/metrics.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/parser.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/postcheck-flow-datos-divergentes.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/postcheck-flow-final.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/postcheck-flow-metadata-divergente.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/postcheck-flow-sin-tablas.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/postcheck-lectura-cleanup.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/postcheck-lectura-isolation.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/source.json` | Evidencia sintetica y procedencia de laboratorio |
| `docs/evidence/combustibles-pr2-postcheck-phpmyadmin/summary.json` | Evidencia sintetica y procedencia de laboratorio |
| `scripts/ci/combustibles-pr2-lab/README.md` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/associate.sql` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/base.sql` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/build-phpmyadmin-import.mjs` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/build-phpmyadmin-import.test.mjs` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/build-phpmyadmin-postcheck.mjs` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/build-phpmyadmin-postcheck.test.mjs` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/build-session-preflight.mjs` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/build-session-preflight.test.mjs` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/check-serialization-11.8.9.json` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/run-portable-windows.mjs` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/run.mjs` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/seed.sql` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/test-phpmyadmin-buffer.php` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/test-phpmyadmin-mysqli.php` | Generador, fixture o prueba aislada CB2 |
| `scripts/ci/combustibles-pr2-lab/test-phpmyadmin-postcheck-mysqli.php` | Generador, fixture o prueba aislada CB2 |
| `sql/import-phpmyadmin-2026-10-combustibles-pr2.sql` | Contrato SQL o adaptador phpMyAdmin CB2 |
| `sql/migrate-2026-10-combustibles-pr2-consumos-facturas.sql` | Contrato SQL o adaptador phpMyAdmin CB2 |
| `sql/postcheck-2026-10-combustibles-pr2-consumos-facturas.sql` | Contrato SQL o adaptador phpMyAdmin CB2 |
| `sql/postcheck-phpmyadmin-2026-10-combustibles-pr2.sql` | Contrato SQL o adaptador phpMyAdmin CB2 |
| `sql/preflight-2026-10-combustibles-pr2-consumos-facturas.sql` | Contrato SQL o adaptador phpMyAdmin CB2 |
