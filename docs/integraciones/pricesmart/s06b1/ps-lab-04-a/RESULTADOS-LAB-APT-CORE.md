# PS-LAB-04-A — Resultados del laboratorio APT aislado, perfil `core`

Fecha de los hechos: 2026-11-06 (UTC, corridas 16:43–17:28). Perfil: **core** únicamente.

**Estado: DIAGNÓSTICO REPRODUCIBLE · PRUEBA FORMAL `--no-download` BLOQUEADA (exit 100) · S06 NOT CERTIFIED.**
`hybrid` y `full` no fueron simulados ni están autorizados. No existe recibo `APT_SIMULATION_VERIFIED`. No hubo instalación ni descarga autorizada. Este documento no selecciona perfil, no ratifica frescura y no habilita etapa B. Estos resultados **no autorizan** instalar, descargar, desplegar, migrar ni modificar producción.

## 1. Niveles de estado (no equivalentes)

| Nivel | Qué cubre |
|---|---|
| IMPLEMENTADO | Laboratorio ejecutado y evidencias exportadas por el operador. |
| VERIFICADO TÉCNICAMENTE | Hashes y contenido del paquete revisados en esta auditoría (sección 3). |
| PROBADO | **Solo el diagnóstico** sin `--no-download`. La prueba formal **no** pasó. |
| APROBADO PARA PRODUCCIÓN | **No.** |

## 2. Paquete auditado

| Elemento | Valor |
|---|---|
| Archivo | `PS-LAB-APT-CORE-EVIDENCIAS.tar.gz` (380,695 bytes, exportado del laboratorio Ubuntu) |
| SHA-256 declarado = recalculado antes de extraer | `18cad66c8ba167fd9f0e197f41d51371ef5c0c09b6f99e0d37da68840cae7789` |
| Contenido | 18 archivos: 17 evidencias + `ps-apt-run2/log/PS-LAB-APT-CORE-CIERRE.json` |
| SHA-256 del informe de cierre (no se autolista) | `4f37f14cbafebb99015135148171dfe56ba32a4fdd4b1e03053eb4a7022165ef` |

Extracción en un directorio nuevo fuera del repositorio, sin sobrescritura. Las evidencias **no** se copiaron al repo.

## 3. Verificación independiente

1. **17/17 hashes individuales** coinciden con `evidence_sha256` del informe de cierre.
2. `core-diagnostic.stdout` y `.stderr` de `run1` y `run2` son **idénticos byte a byte** (hashes `e3043af4…1148` y `05ab4eb5…ed20`). `state/status` (`3cda4875…1000e`) y `preferences.core.candidate` (`939c1cca…a04da04e`) también son idénticos entre runs.
3. Conteo recalculado desde el stdout de cada run: **10 `Inst`, 10 `Conf`, 0 `Remv`**; resumen APT: 0 actualizados, 10 nuevos, 0 a eliminar, 0 no actualizados.
4. Las **20 acciones ordenadas** (`Inst` luego `Conf`, líneas unidas por `\n`) producen el hash del audit, `f05ad1bb3f90993a0f2791be5cd73fe7cbda05b5464808f405430c1d067a2567`, reproducido de forma independiente.
5. Los argumentos del diagnóstico son idénticos en ambos runs salvo la ruta `ps-apt-run1/run2`; las diferencias de `apt.conf` entre runs son únicamente esa ruta.
6. Contraste con `manifest.proposed.json` (escenario `core`): los 10 paquetes, versiones y arquitecturas de las acciones `Inst` coinciden exactamente con el manifiesto (10 = 10, diferencia vacía); suma de `size_bytes` = 11,008,492, igual al valor declarado.
7. El hash de `state/status` coincide con `baseline_status_sha256` del manifiesto: baseline histórico intacto respecto del expediente.

Paquetes simulados (mismas versiones en ambos runs): `acl 2.3.2-1build1.1`, `age 1.1.1-1ubuntu0.24.04.3`, `mysql-common 5.8+1.1.0build1`, `mariadb-common`, `libmariadb3`, `mariadb-client-core`, `mariadb-server-core` (`1:11.8.9+maria~ubu2404`), `liburing2 2.5-1build1`, `nginx-common` y `nginx` (`1.24.0-2ubuntu7.19`).

## 4. Prueba formal vs. diagnóstico

Ambas usan los mismos 10 argumentos `nombre:arch=versión`, el mismo `preferences.core.candidate` y la misma configuración aislada. **La única diferencia de argv es `--no-download`.**

**Alcance de la reproducibilidad:** la prueba formal con `--no-download` se ejecutó **una sola vez, en `run1`**, y terminó con exit 100. No existe segunda ejecución formal ni reproducción del bloqueo. Las dos ejecuciones reproducibles (`run1` y `run2`) fueron **únicamente las diagnósticas, sin `--no-download`**.

| | Formal (`core-simulation`) | Diagnóstico (`core-diagnostic`, run1 y run2) |
|---|---|---|
| Comando | `apt-get -s --no-download -o Debug::NoLocking=1 -o Debug::pkgProblemResolver=1 -o Dir::Etc::preferences=… install <10 args>` | igual, **sin** `--no-download` |
| Exit | **100** (una sola ejecución, en `run1`; según informe de cierre y audit) | **0** en ambos runs |
| Resolución | Resolvedor termina sin rotos (`broken count: 0`) pero no emite plan | Plan completo |
| Acciones `Inst`/`Conf`/`Remv` | **ninguna** (stdout de 9 líneas no vacías) | 10 / 10 / 0 |
| stderr | `E: No se pudieron obtener algunos archivos, ¿quizás deba ejecutar «apt-get update» o deba intentarlo de nuevo con --fix-missing?` | `Starting pkgProblemResolver…` / `Done` (depuración, sin errores) |
| Valor probatorio | **Bloqueada.** Es el criterio de aceptación del procedimiento. | **Solo diagnóstico** (`diagnostic_only: true`). No sustituye la prueba formal. |

El diagnóstico demuestra que el resolvedor produce un plan consistente y reproducible con los índices y pins del laboratorio. No demuestra que el plan sea ejecutable offline, ni instalación, scripts, orden real de configuración, compatibilidad ELF, backup ni S06. Las líneas `Conf` de una simulación no ejecutan maintscripts.

## 5. Hipótesis sobre el bloqueo y requisitos pendientes

**Hipótesis no confirmada:** una posible explicación es que, con `--no-download`, APT necesite los `.deb` ya presentes en `Dir::Cache::archives` y que esa caché no los tenga. **Los logs no demuestran esta causa** y el exit 100 no debe atribuirse definitivamente a la ausencia de `.deb`. Lo observado es solo el mensaje genérico de APT (`E: No se pudieron obtener algunos archivos…`), que no lista las URI faltantes, y que el expediente marca `payload_acquired: false` en los paquetes. Podrían influir otras causas no descartadas (por ejemplo, configuración de caché o de fuentes del laboratorio); confirmarlo requiere la evidencia indicada en el punto 3.

Requisitos pendientes, ninguno ejecutado ni autorizado por este ticket:

1. **Decisión de alcance (negocio/auditoría, no técnica).** Resolver una de dos vías:
   - (a) Autorizar explícitamente disponer en el laboratorio los 10 `.deb` de `core` (11,008,492 bytes) desde una fuente autorizada. Hoy `downloads_authorized: false`.
   - (b) Que la auditoría ratifique por escrito un criterio distinto al de `PROCEDIMIENTO-APT.md` (que prohíbe retirar `--no-download`). Este ticket no modifica ese criterio.
2. Si (a): verificar cada `.deb` contra `sha256` y `size_bytes` de `manifest.proposed.json` **antes** de colocarlo en `<RUN>/cache/archives`, con inventario de hashes de la caché antes y después.
3. Evidencia faltante en el paquete que la auditoría debería exigir: archivo de exit code por comando (hoy 100 y 0 solo constan en los JSON de cierre/audit, no como artefacto propio); listado de `cache/archives`; URI faltantes de la corrida formal; versión del APT/runtime con hashes de ejecutables; `apt-config dump`; `apt-cache policy` bajo la misma configuración; prueba de bloqueo de red; origen y hash de imagen del runtime.
4. Repetir la prueba formal en dos `<RUN>` nuevos con entradas idénticas y comparar acciones ordenadas (criterio 4 del procedimiento).
5. Verificar inventario proyectado de 700 paquetes y hashes de status/selecciones antes y después (criterio 3). El paquete confirma el hash del status, pero no incluye el inventario proyectado.
6. Siguen abiertos: frescura (Release base Noble de 2024, MariaDB histórico, Node), D01–D16, inspección de payloads/maintscripts/ELF, build Linux S05, autorización física, aislamiento y recuperación.

## 6. Observaciones y límites de la evidencia

- **Desviaciones registradas, equivalencia no demostrada:** el `apt.conf` de laboratorio usa `Dir::Etc::main "apt.conf.empty"`, `Dir::Etc::parts "apt.conf.d"` y similares, mientras `PROCEDIMIENTO-APT.md` prevé `"-"`; además `Dir::Etc::preferences` se sobrescribe mediante `-o` con `preferences.core.candidate` (el `apt.conf` apunta a `<run>/preferences`). No se atribuye aprobación a estas desviaciones: la auditoría debe aceptarlas o rechazarlas explícitamente.
- **No hubo descarga ni instalación:** lo afirma el operador y el informe (`installation_authorized: false`, `downloads_authorized: false`). El paquete **no contiene prueba técnica** de bloqueo de red; `apt-get -s` por diseño no instala.
- **Procedencia de la evidencia:** el paquete fue exportado por el operador y verificado en Windows; no existe firma de custodio independiente sobre él.
- Las rutas `/home/labadmin/…` y el usuario `labadmin` aparecen en las evidencias; no se reproducen más allá de lo necesario.
- **JSON históricos sin modificar.** `analysis.json`, `provenance.json` y `verification.local.json` conservan `apt_simulation: NOT_EXECUTED` porque representan el expediente del 2026-11-05, previo al laboratorio. No se modificaron ni se alteraron las pruebas (`audit.test.cjs`) que protegen ese estado. Este documento los contextualiza; no los reemplaza ni los reconcilia.
- **Manifiesto histórico.** `manifest.proposed.json` representa el estado original del 2026-11-05. `resolver.executed: false`, `remaining_blocks` y `recommended_next_profile_to_validate: "hybrid"` son históricos. La ejecución diagnóstica posterior de `core` no modifica aprobaciones (`core`, `hybrid` y `full` siguen con `approved: false`) ni selecciona un perfil (`selected_profile: null`). `hybrid` y `full` no fueron simulados y no están autorizados.
- **Alcance.** Estos resultados **no autorizan** instalar, descargar, desplegar, migrar ni modificar producción. La simulación `-s` no instala por diseño, pero esto no sustituye ninguna autorización.

## 7. Pendientes anotados para la auditoría

- **Nombre de rama:** el README documenta la rama `docs/pricesmart-lab04a`; la rama de trabajo actual de esta actualización es `claude/vibrant-curie-tjnthr`. No se modificó ninguna rama.
- **Firma de custodio:** el paquete de evidencias no tiene firma de custodio independiente; no se inventa ninguna. Fue exportado por el operador y verificado en Windows.
- **Conservación externa:** las evidencias (paquete `.tar.gz` y su extracción) están fuera del repositorio y no se incorporan a él. La verificación de esta auditoría depende de que el operador conserve el paquete con el SHA-256 indicado en la sección 2.
