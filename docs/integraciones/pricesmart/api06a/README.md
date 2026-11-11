# PRICESMART-API-06A — validación del adaptador MariaDB contra una instancia real, local y desechable

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE de forma estática (217 pruebas sin base de datos) y con TRES ejecuciones reales del laboratorio (historial y resultados en `MATRIZ-B0-B9.md`; los resultados históricos no se alteran).** Ejecución 3 (`f3ca4eef`): **FAIL** (35 PASS / 1 FAIL / 1 SKIP). B0–B6, B8 y B9 pasaron contra MariaDB 11.8.9 real, y la caída forzada de B7 con la recuperación de InnoDB se observó y se verificó; el único FAIL es B7.2, por un defecto del arnés (el cifrador de prueba usaba una clave aleatoria por proceso), ya corregido pero **sin re-ejecutar**. B7.5 es SKIP declarado, por lo que el mejor resultado global posible es PASS CON LIMITACIONES. La ejecución 4 está NO EJECUTADA y requiere autorización expresa. Base: `origin/main` `373bb487`; rama `feature/pricesmart-api06a-mariadb-real`. **Ningún resultado certifica el adaptador ni autoriza conexión real.** D01–D16 siguen PENDIENTES.

Alcance: solo archivos NUEVOS. No se modificó el adaptador, contratos, OpenAPI, `sandbox-db.ts`, `db.ts`, SQL de producción, `package.json`/lock ni `staging.sql.in`.

## Archivos
| Archivo | Función |
|---|---|
| `scripts/ci/pricesmart-api06a/constants.mjs` | Constantes fijas (rama, hashes del motor, rango de puertos, puertos prohibidos, alcances sintéticos) |
| `.../safety.mjs` | Guardas PURAS: compuerta anti-ejecución accidental, manifiesto/rutas, puerto, argumentos exactos del servidor, entorno hijo (lista blanca), conexiones permitidas, `SqlGate`, identidad, PID, limpieza segura |
| `.../ddl.mjs` | Deriva el DDL de laboratorio desde `staging.sql.in` y construye la lista CERRADA de SQL administrativo |
| `.../run-windows.mjs` | Ejecutor (`--preflight-only` / `--run-isolated`). No hace nada al importarse |
| `.../report.mjs` | Resumen PASS/FAIL/SKIP por bloque B0–B9; sin resultados ⇒ «NO EJECUTADA», nunca PASS |
| `.../mariadb-real.lab.ts` | Pruebas B0–B8 contra el motor real (solo cargables desde el ejecutor; no coinciden con `npm test`) |
| `.../lab-setup.ts`, `vitest.lab.config.mts` | Guardia de red del laboratorio: solo pipe del run y `127.0.0.1:<puerto del run>` |
| `.../procinfo.mjs` | Consultas de proceso/puerto/sockets/descendientes con estado explícito (`absent`/`present`/`unknown`) y terminación verificada |
| `.../lab-cipher.ts`, `lab-cipher.test.ts` | Cifrador de laboratorio con clave derivada de `AUTH_SECRET` del run (estable entre las fases/procesos de B7) y sus pruebas (incluye un proceso hijo real) |
| `.../netguard.mjs`, `netguard.test.ts` | Lógica pura de la guardia de red (desempaqueta el arreglo normalizado de Node) y pruebas con sockets reales de `net` |
| `.../safety.test.ts`, `ddl.test.ts`, `executor.test.ts`, `netguard.test.ts`, `vitest.static.config.mts` | 217 pruebas ESTÁTICAS (sin base de datos) |
| `.../engine-manifest.json` | SHA-256 de los 624 archivos del motor (derivado del ZIP oficial verificado) |
| `docs/.../staging-lab.sql`, `staging-DIFF.txt` | DDL de laboratorio y diff exacto contra `staging.sql.in` |
| `docs/.../MATRIZ-B0-B9.md`, `RIESGOS-Y-DECISIONES.md` | Matriz de pruebas con estado real; riesgos residuales y relación con D01–D16 |

## Diff DDL (exacto)
Una sola línea difiere de `docs/integraciones/pricesmart/api01/staging.sql.in` (ver `staging-DIFF.txt`): la sentencia `SIGNAL SQLSTATE '45000' … DO_NOT_EXECUTE` se sustituye por un comentario `-- [LAB API-06A] …`. Las 5 tablas, índices, FK y CHECK son byte a byte los del original. La derivación se prueba en `ddl.test.ts` (incluido el SHA-256 de `staging.sql.in`).
Además, el ejecutor crea en la base del run: `novalvion_environment` (tabla que exige `sandboxPool`, definición tomada de S04), los 4 alcances sintéticos de `LAB_SCOPES`, y la cuenta `sandbox_api02_<id>@127.0.0.1` con privilegios mínimos (ver `ddl.mjs`): `SELECT` en `novalvion_environment`; `SELECT, INSERT` en `orders`/`events`; `UPDATE` solo de las 5 columnas que el adaptador modifica; `INSERT` en `outbox`/`audit`. Sin `DELETE`, sin DDL, sin `GRANT OPTION`, sin privilegios globales.

## Controles de aislamiento (todos verificables en `safety.test.ts`)
1. **Compuerta**: solo `--preflight-only` o `--run-isolated` + `PS_API06A_LAB_ACK=<frase>`; plataforma Windows; rama exacta `feature/pricesmart-api06a-mariadb-real`; sin archivos `.env*` en el directorio de trabajo; **se niega si el entorno padre define `DB_*`, `DATABASE_URL`, `MYSQL*`, `MARIADB*`, `HOSTINGER*`, `SANDBOX_*`, `NOVALVION_*`, secretos, `FEL_*` o proxies**.
2. **Motor**: ZIP = SHA-256 oficial registrado; `engine-manifest.json` fijado por SHA-256; **cada** uno de los 624 archivos extraídos se compara (sin extras ni ausentes ni enlaces).
3. **Directorio exclusivo** `%TEMP%\novalvion-ps-api06a-<id32>` (raíz real, creado SIN `recursive`: si existe, se detiene). Datadir, pid, tmp, files, sandbox y evidencia dentro.
4. **Red**: `--bind-address=127.0.0.1`, puerto aleatorio 49152–65535 (3306/33060/5432 y demás servicios quedan fuera del rango por construcción, y se prueba), `--skip-name-resolve`, `--local-infile=0`, `--secure-file-priv` propio, sin `skip-grant-tables`/`init-file`/`log-bin`/replicación. Argumentos comparados por igualdad exacta (`assertServerArgs`). Tras arrancar: el PID debe escuchar **solo** `127.0.0.1:<puerto>`.
5. **Administración** únicamente por el pipe único del run (`root`, sin TCP); opciones validadas por igualdad exacta (`assertAdminOptions`).
6. **Identidad antes de actuar**: `datadir`, `pid_file`, `port`, `bind_address`, `version` 11.8.9-MariaDB, `socket`, `basedir`, `skip_name_resolve`, `local_infile`, FK/CHECK, `secure_file_priv`, `innodb_lock_wait_timeout`, `read_only`, `log_bin`; PID/ejecutable/línea de comandos coinciden con el manifiesto; base y usuario del run no existen.
7. **`SqlGate`**: antes de confirmar la identidad solo pasan las consultas de identidad; después, solo sentencias **idénticas** a la lista cerrada de `adminStatements` (+`SHUTDOWN`). No existe ruta para SQL libre. Sin `DROP`/`TRUNCATE`/`DELETE`/`ALTER` en la lista.
8. **Proceso de pruebas**: entorno construido desde cero (lista blanca); producido y validado contra el `validateSandboxConfig` REAL (la prueba lo ejecuta); guardia de red que solo admite el pipe y `127.0.0.1:<puerto>` y lanza ANTES de abrir cualquier socket (incluye una prueba que intenta 3306, 5432, hosts externos y `fetch`).
9. **Limpieza fail-closed (AUD-01)**: `SHUTDOWN` por pipe; un proceso solo se termina tras verificar su identidad y su pertenencia al laboratorio (`terminateVerified`/`terminateStray`; nunca por nombre). El directorio se borra únicamente si `cleanupDecision` demuestra TODO: servidor terminado, proceso `absent`, puerto `free`, sin descendientes y evidencia copiada; cualquier consulta fallida/incompleta (`unknown`), proceso presente o puerto ocupado lo CONSERVA y lo informa. El borrado va por `safeRemoveRunDir` (hijo directo de la raíz temporal, ruta real idéntica, sin enlaces/uniones). La evidencia se copia antes a `.lab-runtime/ps-api06a-evidence-<id>` (ignorada por git).
10. **Control de errores (AUD-02)**: cada ejecución de Vitest se evalúa con `evaluateVitestRun` (código, señal, error, JSON, bloques requeridos); B7 solo comienza si la fase principal es PASS completa; la preparación B7 se vigila (salida a archivo, timeout, señal); tras cada fase se buscan procesos huérfanos; ante cualquier fallo se detienen las fases siguientes, se conserva la evidencia y se informa FAIL/INCOMPLETO.
11. **Resumen (AUD-03)**: PASS / PASS CON LIMITACIONES / FAIL / INCOMPLETO; B7.5 siempre visible como SKIP declarado.
12. **Casos obligatorios (AUD-04)**: `REQUIRED_CASES` fija por fase los ids que deben estar presentes y en PASS; un skip inesperado de un caso obligatorio (p. ej. en B1, B4 o B8) deja la fase INCOMPLETA; las omisiones de otra fase y la declarada `B7.5` son las únicas aceptadas.
13. **Caída forzada vs. apagado (AUD-05)**: en Windows `child.kill()` NUNCA es un cierre ordenado (Node usa TerminateProcess; se midió `signalCode` = la señal pedida); el único cierre ordenado es el SQL `SHUTDOWN`. La caída de B7 usa `forceCrashVerified` (`SIGKILL` explícito, solo en la fase `crash-prepare`, solo tras revalidar identidad, ejecutable, datadir, puerto, pipe, sockets y archivo PID, y con ausencia verificada después); la limpieza usa `terminateVerified`. Ambas funciones son distintas y no se intercambian.

## Cómo se ejecutaría (NO ejecutado; requiere autorización)
```
node scripts/ci/pricesmart-api06a/run-windows.mjs --preflight-only          # sin efectos (ya ejecutado una vez: motor verificado)
set PS_API06A_LAB_ACK=SINTETICO-LOCAL-SIN-PRODUCCION-NI-HOSTINGER
node scripts/ci/pricesmart-api06a/run-windows.mjs --run-isolated             # inicia MariaDB efímero
```
