# Procedimiento condicionado de simulación APT

Estado: **formal `--no-download` BLOQUEADA (exit 100) para `core`; diagnóstico reproducible, ver [RESULTADOS-LAB-APT-CORE.md](RESULTADOS-LAB-APT-CORE.md)**. No se retiró `--no-download` del criterio. La prueba formal se ejecutó una sola vez (`run1`, exit 100); solo el diagnóstico sin esa opción fue reproducible. Estos resultados no autorizan instalar, descargar, desplegar, migrar ni modificar producción. Este documento no habilita adquisición ni instalación. El comprobador JavaScript sólo inspecciona conjuntos ya propuestos, nunca sustituye este procedimiento.

## Entradas inmutables

1. Runtime Noble 24.04 amd64 existente, autorizado, sin acceso a producción y con red externa bloqueada. Registrar procedencia, hash de imagen/base si existe, versiones y hashes de ejecutables APT/dpkg y librerías. No iniciar la VM original ni crear otra. Si requiere adquirir o habilitar herramientas, detener bajo el alcance actual.
2. Copias de los cuatro archivos PS-LAB-03 cuyo checksum se verificó, baseline y manifiesto de este ticket; siete Packages y cuatro InRelease originales, Node SHASUMS y claves públicas. Inventario privado de hashes antes y después; status/selecciones originales no entran a Git.
3. Ratificación fechada de perfil, Recommends y política de snapshots/prioridades. Node se excluye de APT: no es .deb y su compatibilidad queda pendiente.
4. Repetir `verify-local.cjs` en el host autorizado antes de transferir las copias. Fallar si falta algún índice, control, firma o hash. No usar listas del runtime como sustituto.

## Espacio de trabajo privado y configuración aislada

Un operador prepara un directorio nuevo vacío `<RUN>` únicamente para análisis: `state/status`, `state/extended_states` vacío, `lists/partial`, `cache/archives/partial`, `log`, `sources.list`, `preferences` y `keys`. Copiar status y selecciones verificados; conservar hashes y permisos. No importar el status en el dpkg del runtime ni modificar su base de paquetes. Conservar copias de sólo lectura de las entradas fuera de las rutas de trabajo.

`sources.list` contiene exclusivamente las tres suites Ubuntu y MariaDB del expediente:

```text
deb [arch=amd64 signed-by=<RUN>/keys/ubuntu.gpg] https://archive.ubuntu.com/ubuntu noble main universe
deb [arch=amd64 signed-by=<RUN>/keys/ubuntu.gpg] https://archive.ubuntu.com/ubuntu noble-updates main universe
deb [arch=amd64 signed-by=<RUN>/keys/ubuntu.gpg] https://security.ubuntu.com/ubuntu noble-security main universe
deb [arch=amd64 signed-by=<RUN>/keys/mariadb.gpg] https://archive.mariadb.org/mariadb-11.8.9/repo/ubuntu noble main
```

Las claves son copias públicas previamente verificadas. No hay excepciones de confianza, hooks ni desactivación de vigencia. Ratificar el tratamiento del snapshot histórico base antes de continuar. Mantener bloqueo de red aun con URLs en la configuración.

Copiar los índices autenticados descomprimidos a `lists`, usando los nombres que corresponden a esas URI:

```text
archive.ubuntu.com_ubuntu_dists_noble_InRelease
archive.ubuntu.com_ubuntu_dists_noble_main_binary-amd64_Packages
archive.ubuntu.com_ubuntu_dists_noble_universe_binary-amd64_Packages
archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease
archive.ubuntu.com_ubuntu_dists_noble-updates_main_binary-amd64_Packages
archive.ubuntu.com_ubuntu_dists_noble-updates_universe_binary-amd64_Packages
security.ubuntu.com_ubuntu_dists_noble-security_InRelease
security.ubuntu.com_ubuntu_dists_noble-security_main_binary-amd64_Packages
security.ubuntu.com_ubuntu_dists_noble-security_universe_binary-amd64_Packages
archive.mariadb.org_mariadb-11.8.9_repo_ubuntu_dists_noble_InRelease
archive.mariadb.org_mariadb-11.8.9_repo_ubuntu_dists_noble_main_binary-amd64_Packages
```

La carga de listas preexistentes no implica que APT vuelva a verificar sus firmas. La revalidación externa es obligatoria. Comparar `apt-cache policy` bajo la misma configuración con los orígenes/versiones esperados; error, lista ignorada, advertencia de caché o candidatos ausentes bloquean. No completar listas mediante red.

En `<RUN>/apt.conf`, sustituir **todas** las rutas absolutas y no incluir configuración del host:

```text
Dir::Etc::main "-";
Dir::Etc::parts "-";
Dir::Etc::sourcelist "<RUN>/sources.list";
Dir::Etc::sourceparts "-";
Dir::Etc::preferences "<RUN>/preferences";
Dir::Etc::preferencesparts "-";
Dir::Etc::trusted "<RUN>/keys/empty.gpg";
Dir::Etc::trustedparts "-";
Dir::State "<RUN>/state";
Dir::State::status "<RUN>/state/status";
Dir::State::extended_states "<RUN>/state/extended_states";
Dir::State::lists "<RUN>/lists";
Dir::Cache "<RUN>/cache";
Dir::Cache::archives "<RUN>/cache/archives";
Dir::Cache::pkgcache "";
Dir::Cache::srcpkgcache "";
Dir::Log "<RUN>/log";
APT::Architecture "amd64";
APT::Architectures { "amd64"; };
APT::Install-Recommends "false";
APT::Install-Suggests "false";
Acquire::Languages "none";
```

Usar `APT_CONFIG=<RUN>/apt.conf` desde un entorno limpio sin APT_CONFIG heredado. Verificar mediante `apt-config dump` que no se cargaron hooks, fuentes, estado ni caché del host y que la arquitectura única es amd64. La sintaxis y nombres de listas deberán confirmarse con la versión real del runtime; cualquier divergencia se documenta y bloquea antes de simular.

Generar `preferences` a partir de los 690 registros y los paquetes del perfil, sin inventar versiones: para cada paquete permitir únicamente su versión exacta con prioridad 1001 y rechazar otras versiones con prioridad -1. Registrar el archivo/hash y el resultado de policy para comprobar que las reglas exactas prevalecen. No agregar una regla genérica que elija otro origen MariaDB. Si policy no refleja los pins, detener. El 1001 no autoriza downgrades: el comparador de resultado debe rechazarlos.

## Simulación sin transacción ni adquisición

Ejecutar sin privilegios administrativos, dentro del directorio privado, con red bloqueada y archivos originales inaccesibles para escritura. Crear un archivo de argumentos por perfil a partir de `scenarios[].packages`: un argumento literal `name:architecture=version` por paquete (para `all`, usar nombre y versión sin calificador); registrar orden, contenido y hash. No mezclar escenarios. Invocar APT con argumentos separados, nunca interpolación libre ni evaluación de texto.

```text
apt-get -s --no-download -o Debug::NoLocking=1 -o Debug::pkgProblemResolver=1 install <ARGUMENTOS_EXACTOS_DEL_PERFIL>
```

Registrar comando/argumentos, versión de herramienta, configuración efectiva, entradas/hash, stdout/stderr y exit. No retirar `-s` ni `--no-download`, no ejecutar una transacción posterior. No reintentar con corrección automática de dependencias o cambios de versión. El comando es una plantilla condicionada, no fue ejecutado en este ticket.

## Criterios de aceptación y repetibilidad

1. Exit 0 y ausencia de dependencias rotas, índices ignorados, cambios en holds o avisos sin resolver. Los 690 holds siguen siendo cero según evidencia; si cambia el insumo, bloquear y revisar.
2. Analizar **todas** las acciones `Inst`, `Conf` y `Remv` con un parser ajustado a la versión registrada; formato desconocido = bloqueo. Proyectar cada acción sobre copia del baseline. Exigir exactamente los nuevos paquetes del perfil y sus versiones/arquitecturas; cero eliminaciones, downgrades, reinstalaciones/cambios del baseline o paquetes adicionales. Comprobar toda procedencia mediante policy; no inferir arquitectura de un nombre sin calificador.
3. Comparar el inventario proyectado: 700/703/708 paquetes para core/hybrid/full respectivamente. El dpkg real no cambia: verificar hashes del status, selecciones y estado antes/después. Registrar también archivos de trabajo alterados por la simulación.
4. Repetir en un segundo `<RUN>` nuevo con idénticas entradas/configuración y runtime; normalizar sólo rutas del run y tiempos en logs, conservando originales privados. Comparar acciones ordenadas, versiones, orígenes y hashes del resultado canónico. La prueba debe registrar explícitamente divergencias.
5. Las líneas `Conf` de simulación no ejecutan maintscripts ni prueban orden real de configuración o éxito de servicios. Incluso un PASS sólo acredita el plan simulado del runtime registrado, no instalación, compatibilidad ELF, backup ni S06.

El parser de transacciones y el adaptador al runtime no se implementan antes de conocer y autorizar su versión/salida real. No se fabrica un log para desarrollar o declarar un PASS. Guardar recibo `APT_SIMULATION_VERIFIED` sólo tras auditoría de evidencia real; el expediente general continúa `PROPOSED_NOT_INSTALLABLE` hasta cerrar además perfil, frescura, payloads y gates aplicables.
