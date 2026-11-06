# PS-LAB-04-A — expediente offline y bloqueo APT

Fecha: 2026-11-05, America/Guatemala. Base `origin/main`: `b7eb8d5e46febe050cc2fb4bf5393689b76ca86a`. Rama independiente `docs/pricesmart-lab04a`.

**PROPOSED_NOT_INSTALLABLE. S06 NO CERTIFICADA (S06 NOT CERTIFIED).** Actualización 2026-11-06: el laboratorio APT aislado ejecutó el perfil `core`; el diagnóstico es reproducible pero la prueba formal `--no-download` quedó **bloqueada (exit 100)**. Ver [RESULTADOS-LAB-APT-CORE.md](RESULTADOS-LAB-APT-CORE.md). `hybrid` y `full` no se simularon ni están autorizados. Lo descrito abajo como "APT no ejecutado" corresponde al ticket del 2026-11-05. No se selecciona perfil, autoriza adquisición ni habilita etapa B. La autorización del ticket original cubría expediente, pruebas, commit, push y PR Draft.

## Qué se comprobó de nuevo

- 41/41 checksums originales PS-LAB-04 y 4/4 del expediente privado PS-LAB-03 coinciden. Los originales se leyeron sin modificarlos. Sus manifiestos locales no tienen firma de custodio independiente.
- El status original coincide con `baseline_status_sha256`; sus 690 registros coinciden con la extracción copiada. Todos indican `install ok installed`, arquitectura amd64/all. Las 690 selecciones son `install`, sin holds; arquitectura primaria amd64, sin extranjeras. El archivo de auditoría registra exit 0: no se volvió al guest ni se comprobaron archivos instalados.
- Cinco firmas revalidadas con GPG existente y keyring temporal separado, siete índices comprimidos/descomprimidos cotejados con sus InRelease, y Contents MariaDB autenticado. Los controles exactos de cada candidato coinciden con Packages: versión, arquitectura, hash, tamaño, Filename y relaciones.
- SHASUMS Node firmado coincide con el texto separado y el checksum candidato. No existe prueba de bytes del tarball. Su tamaño procede de HEAD heredado y sigue sin autenticar.
- Los conjuntos seleccionados conservan las 690 versiones y arquitecturas, satisfacen las relaciones obligatorias admitidas por el comprobador estático y no presentan conflictos detectados. Esto **no prueba** una transacción APT, orden de configuración, scripts, backtracking ni semántica completa de Multi-Arch.

Las huellas oficiales y su contraste independiente son evidencia heredada de PS-LAB-04; se reutilizaron, sin repetir investigación. Revalidar firmas con claves públicas conservadas no descubre revocaciones publicadas después. [Procedencia y hashes](provenance.json), [resultado estático](analysis.json), [recibo de revalidación](verification.local.json).

## Perfiles propuestos

| Perfil | Nuevos .deb | Total con baseline | Bytes .deb | Propietario de mariadb-dump |
|---|---:|---:|---:|---|
| core | 10 | 700 | 11,008,492 | Ausente |
| hybrid | 13 | 703 | 12,926,548 | mariadb-client |
| full | 18 | 708 | 27,258,326 | mariadb-client |

Hybrid añade a core `mariadb-client`, `libconfig-inifiles-perl` y `libpcre2-posix3`. Full añade a hybrid `mariadb-server`, `galera-4`, `libdbi-perl`, `socat` y `libwrap0`. Las inclusiones y relaciones exactas están en [el manifiesto copiado](manifest.proposed.json). Contents declara `usr/bin/mariadb-dump` en mariadb-client; no demuestra ejecución correcta del backup.

MariaDB: `1:11.8.9+maria~ubu2404`; nginx/nginx-common: `1.24.0-2ubuntu7.19`; age: `1.1.1-1ubuntu0.24.04.3`; acl: `2.3.2-1build1.1`; Node: `24.18.0`. Se admiten paquetes `all` junto con amd64. No se intercambian versiones ni se eliminan paquetes para satisfacer relaciones.

Se conservan los Recommends del cliente/servidor, sin incorporarlos por defecto al conjunto candidato. `libdbi-perl` sigue obligatorio en full. `APT::Install-Recommends=false` es una propuesta pendiente, al igual que hybrid: ninguno queda seleccionado por esta revisión.

## Frescura pendiente

| Release firmado | Date UTC | Valid-Until |
|---|---|---|
| Ubuntu noble | 2024-04-25 15:10:33 | ausente |
| noble-updates | 2026-11-03 18:28:16 | ausente |
| noble-security | 2026-11-03 17:27:31 | ausente |
| MariaDB 11.8.9 | 2026-08-25 08:03:38 | ausente |

La política heredada de 72 horas para suites Ubuntu mutables no sirve aplicada literalmente al Release base Noble de 2024. Debe distinguirse explícitamente el snapshot base histórico de updates/security y ratificar la excepción o reemplazo; no se cambia la política silenciosamente. MariaDB es archivo histórico y requiere aceptación del patch y revisión vigente de avisos. También falta revisar Node histórico y revocaciones actuales. No se hicieron consultas web ni adquisiciones: este ticket utiliza sólo evidencia existente. Las firmas válidas no aprueban frescura. La fecha de ejecución se registra sin convertirla en fecha de descarga ni de aprobación.

## Bloqueo real y continuidad

> **Nota 2026-11-06 (no elimina lo histórico):** el texto siguiente describe el bloqueo del **2026-11-05** (sin runtime APT disponible en el equipo Windows). El **2026-11-06** se realizó un diagnóstico APT aislado del perfil `core` en un laboratorio Ubuntu externo: dos diagnósticos sin `--no-download` fueron reproducibles, y la única prueba formal con `--no-download` (en `run1`) terminó con exit 100, es decir, sigue **bloqueada**. Detalle, hipótesis sobre el bloqueo y pendientes (incluida la diferencia entre la rama documentada arriba y la rama de trabajo actual) en [RESULTADOS-LAB-APT-CORE.md](RESULTADOS-LAB-APT-CORE.md). Esos resultados no autorizan instalar, descargar, desplegar, migrar ni modificar producción; `S06 NOT CERTIFIED`; `hybrid` y `full` siguen sin autorización.

No se encontraron `apt`, `apt-get`, `dpkg`, Docker o Podman en PATH, ni distribución registrada bajo HKCU Lxss. `wsl.exe` está presente; no se inició. Esta comprobación no asegura ausencia en todo el equipo. Git Bash/GPG y Node no ofrecen un resolver APT. No hay un runtime Noble confiable utilizable bajo los límites actuales; no se instaló, descargó ni improvisó uno.

Para continuar: aportar un runtime Noble **ya disponible y autorizado**, compatible con los índices y separado del guest original, con procedencia y versión verificables; ratificar snapshot/prioridades/Recommends; ejecutar [el procedimiento reproducible](PROCEDIMIENTO-APT.md) y revisar sus logs. Si no puede obtenerse sin cambiar restricciones, mantener bloqueo. Descargar una imagen o paquetes para habilitarlo requiere otro alcance.

La simulación posterior tampoco autoriza descarga ni instalación. Inspección de payloads/maintscripts/ELF, build Linux S05, autorización física, pruebas de aislamiento y recuperación siguen pendientes. D01–D16 no se ratifican; el perfil S04 permanece bloqueado y S06 no certificada. El expediente de [prerrequisitos de VM](PRERREQUISITOS-VM.md) no crea ni arranca infraestructura.

## Reproducción y límites de publicación

Desde la raíz de este worktree:

```powershell
node scripts/ps-lab-04-a/audit.cjs
node --test scripts/ps-lab-04-a/audit.test.cjs scripts/sandbox-s06a/preflight.test.mjs
```

Revalidación opcional de originales privados disponibles, sin red, indicando rutas externas por argumentos:

```powershell
node scripts/ps-lab-04-a/verify-local.cjs '<PS-LAB-04-original>' '<PS-LAB-03-privado>' '<gpg-existente>'
```

No se ejecutan acquire/catalogs/finalize/resolve heredados: algunos escriben evidencia o tienen fallback de red. El nuevo verificador sólo escribe en su keyring temporal y lo elimina al terminar. No muestra originales ni rutas personales en recibos.

Git incluye sólo relaciones públicas de paquetes, manifiestos candidatos y recibos sanitizados, más scripts/pruebas de auditoría. Excluye índices voluminosos, status original, claves/keyrings, logs privados, payloads, rutas personales y credenciales. Sin los originales externos, el lector puede repetir comprobaciones del bundle y tests; no puede revalidar por sí solo las firmas de índices ausentes. Los hashes documentan esa limitación, no sustituyen los bytes.

No se modifican módulos productivos, Milenium, BORR-1c ni expedientes previos. No hay SQL, despliegue, VM, merge ni certificación. Tras publicar Draft, esperar auditoría independiente.
