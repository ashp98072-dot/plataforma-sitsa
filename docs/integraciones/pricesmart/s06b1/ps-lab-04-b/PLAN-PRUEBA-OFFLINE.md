# PS-LAB-04-B — Plan de prueba formal offline controlada (PROPUESTA)

**Nada de este documento fue ejecutado ni está autorizado.** Todos los comandos son plantillas para una fase futura que requiere autorización expresa, fase por fase. No aprueba `core`, `hybrid` ni `full`; `S06 NOT CERTIFIED`. Diagnóstico y fundamentos: [DIAGNOSTICO-APT.md](DIAGNOSTICO-APT.md).

## 1. Estrategia

0. **Inspección pasiva** de las cachés existentes (F2a), sin ejecutar APT, con un **directorio de evidencias exclusivo** y separado de los `<RUN>` de F2 y F4: es la única fuente posible de evidencia *indirecta* sobre lo que había en la caché histórica. Exige encender la VM, lo cual **no es una operación sin escrituras** (sección 4.7.4).
1. **Reproducir el mecanismo** sin cambiar nada (F2, caché nueva y vacía): confirma que ese estado produce el bloqueo (N=2) y captura las evidencias que hoy faltan. **Esto no demuestra la causa de la ejecución histórica** (ver sección 7).
2. **Solo si se autoriza por separado**, obtener y verificar los 10 `.deb` fuera del laboratorio (F3).
3. **Control positivo** con la caché verificada (F4): si el bloqueo desaparece, queda demostrado que la causa era la disponibilidad local de los archivos.
4. Cierre documental sin certificar S06 (F5).

No se asume que haya que descargar archivos: F2 puede mostrar otra causa (A2-A7 del diagnóstico) y entonces F3 no procede.

| Fase | Contenido | Requiere autorización de |
|---|---|---|
| F2a | Inspección pasiva de cachés existentes (sin APT), en cinco etapas: preparación con la VM apagada, autorización de encendido, inspección en el invitado, exportación y custodia, apagado y comprobaciones (sección 4.7) | **una autorización por etapa**; encender la VM requiere autorización expresa propia; cualquier copia de discos o instantánea, otra autorización expresa |
| F2 | 2 corridas formales con caché **nueva** y vacía + capturas | ejecutar APT en simulación en la VM del laboratorio |
| F3 | Obtención y verificación de los 10 `.deb` | adquisición de archivos (hoy `downloads_authorized: false`) |
| F4 | 2 corridas formales con caché verificada | ejecutar APT en simulación |
| F5 | Documento de resultados y recibo | edición documental |

## 2. Precondiciones y entradas

1. VM Ubuntu Server 24.04.3 aislada ya existente; no se crea ni modifica ninguna VM, y la VM histórica del baseline no se toca.
2. Un `<RUN>` nuevo por ejecución (`ps-apt-run3`, `run4`, …), nunca reutilizado. Los `<RUN>` previos (`run1`, `run2`) se conservan intactos. Su subdirectorio `log/` se crea vacío. Los `<RUN>` de F2 y F4 **nunca** son el directorio de evidencias de F2a (precondición 9).
3. Entradas copiadas desde originales de solo lectura **dentro de `<RUN>`**, siempre con ruta **relativa a `<RUN>`**:

   | Entrada (ruta relativa a `<RUN>`) | Valor de referencia (obtenido de las evidencias de PS-LAB-04-A) |
   |---|---|
   | `apt.conf` | Contiene rutas absolutas del `<RUN>`, así que su hash cambia por corrida. Referencia: hash **tras sustituir la ruta del `<RUN>` por `<RUN>`** = `4662b856…49bf` (idéntico en `run1` y `run2`; el archivo no termina en salto de línea). Desviaciones frente al procedimiento: aceptadas o rechazadas explícitamente por la auditoría. |
   | `preferences.core.candidate` | `939c1cca…a04da04e` |
   | `state/status` | `3cda4875…1000e` (690 paquetes) |
   | `core.args` | 10 líneas (un argumento `nombre:arch=versión` por línea, con `\n` final, mismo orden que `core-diagnostic.argv.json`): `e36d6c36…e138` |
   | `sources.list`, `lists/*` (Packages e InRelease), `keys/empty.gpg` | sin referencia local; se contrastan con `provenance.json` y `manifest.proposed.json` y el custodio registra sus hashes antes de la corrida |
   | F4 solamente: `expected-archives.tsv` y `cache/archives/*.deb` | nombres, tamaños y hashes de la tabla de DIAGNOSTICO sección 7 |

4. **`inputs.sha256`:** se genera **una sola vez**, durante la preparación y antes de cualquier corrida, con `cd "$RUN"` y rutas relativas (formato `<sha256>␣␣<ruta relativa>`, sin rutas absolutas, sin `..`). Su propio hash lo registra el custodio fuera del `<RUN>`. La verificación se hace **siempre desde `<RUN>`** (`cd "$RUN" && sha256sum -c --strict inputs.sha256`), porque `sha256sum -c` resuelve las rutas respecto del directorio actual y no del archivo de lista. Nunca se usa `--ignore-missing`. Además se comprueba que el manifiesto lista **exactamente** los archivos de entrada presentes (ninguno sin listar ni listado ausente).
5. Procedencia: los hashes de índices y manifiesto se contrastan con `provenance.json` y `manifest.proposed.json` de PS-LAB-04-A. Si falta cualquier hash o no coincide: detener.
6. Usuario **sin privilegios elevados**; nunca se ejecuta nada sin `-s`.
7. Se registra la versión real de APT (E1). Si no es `2.8.3`, o si el comportamiento observado difiere del código leído (idéntico en Ubuntu `2.7.14build2` y `2.8.4ubuntu0.1`; `2.8.3` no se leyó directamente), se documenta antes de continuar (hipótesis A7).
8. **Cachés existentes = solo evidencia, nunca espacio de trabajo.** `ps-apt-run1`, `ps-apt-run2` y `/var/cache/apt/archives` no se usan como `Dir::Cache::Archives` de ninguna corrida, no se copian ni se renombran sus archivos y no se escribe en ellos. Cada corrida usa un directorio de archivos **nuevo** dentro de su `<RUN>`, que contiene únicamente un subdirectorio `partial/` (modo `0555`, vacío) y, solo en F4, los 10 `.deb` verificados.
9. **Directorio de evidencias de F2a exclusivo.** F2a escribe únicamente en `~/ps-f2a-<UTC>/` (nuevo, modo `0700`, con la marca `.f2a-evidencia`), nunca en `ps-apt-run1`, `ps-apt-run2`, `/var/cache/apt` ni en un `<RUN>` de F2/F4. El script de F2/F4 rechaza como `<RUN>`, **sobre la ruta canónica y por límites de directorio**, cualquier ruta que sea, esté dentro de o contenga `ps-apt-run1`, `ps-apt-run2` o `/var/cache/apt`; cualquier ruta con un componente `ps-f2a-*`; y cualquier directorio con la marca `.f2a-evidencia` (sección 4.1). F2a tiene sus propias funciones (`fcap`, `fneed`, `fabort`) y no usa `cap`, `need`, `assert`, `abort` ni `finalize` de F2/F4.

## 3. Aislamiento, rutas privadas y escrituras

- **Red:** interfaz de red desconectada o inexistente a nivel de hipervisor, documentada por el operador. Evidencia pasiva dentro de la VM: `ip -brief link`, `ip route` y los contadores de `/proc/net/dev` antes y después (delta cero en toda interfaz distinta de `lo`). No se hacen sondeos activos de conectividad.
- **Rutas privadas:** `apt.conf` apunta todas las rutas (`Dir::Etc*`, `Dir::State*`, `Dir::Cache*`, `Dir::Log`) a `<RUN>`. Se exige `APT_CONFIG` explícito y entorno limpio (`env -i`).
- **Validación previa obligatoria de rutas efectivas (no visual):** antes de cualquier orden que construya la caché de paquetes o simule (`apt-cache policy`, `apt-get -s`), el script consulta con `apt-config shell` las rutas **efectivas** y las compara por programa (sección 4.4). Exige que `Dir::Cache::Archives` sea **exactamente** `<RUN>/cache/archives/` con `<RUN>` canónico (`realpath`), que todas las demás rutas queden bajo `<RUN>`, que `<RUN>/cache/archives` no sea un enlace simbólico y que su identificador `dispositivo:inodo` sea distinto del de cada caché histórica y del sistema. Cualquier discrepancia aborta. La comprobación está diseñada para **fallar cerrada**: si el formato de salida de `apt-config` no es el esperado, también aborta.
- **Caché nueva y protegida:** `<RUN>/cache/archives` y su `partial/` con modo `0555`, y ejecución **sin privilegios elevados**. APT puede borrar archivos de caché de tamaño incorrecto incluso en simulación (DIAGNOSTICO C3, C11, sección 3.4); con el directorio `0555` y usuario sin privilegios el `unlink` falla y solo produce un aviso. Los modos `0444` de los archivos no bastan por sí solos. La protección se valida en F2 y su efecto se registra.
- **Control de escrituras:** hash del árbol completo del `<RUN>` (archivos, modos y fechas de modificación, excluyendo `log/`) antes y después; cualquier diferencia no explicada detiene la fase. Solo se auditó el camino de caché de archivos de APT (DIAGNOSTICO 3.4), no todo el flujo.
- **Locale:** `LC_ALL=C` para fijar mensajes en inglés. Las corridas previas usaron locale español; la diferencia se registra y el analizador solo usa las palabras `Inst`, `Conf` y `Remv`, que no se traducen.

## 4. Comandos propuestos (plantilla de script, NO ejecutada)

Todo se ejecuta como un script (`run-fase.sh <RUN> <F2|F4>`) por usuario sin privilegios. Es una **plantilla**. Estado de su validación (sin APT, sin laboratorio, sin VirtualBox):

- **Script de F2/F4** (4.1-4.6), ensamblado tal cual desde este documento: pasa `bash -n`. Su lógica de control se probó en un directorio temporal con `apt-config`, `apt-cache`, `apt-get` y `dpkg-query` **simulados** y rutas históricas ficticias, en 30 casos: 2 caminos felices (F2 y F4); 13 abortos, cada uno por el motivo previsto (ruta efectiva histórica, enlace simbólico, modo incorrecto, archivos o directorios extra en la caché o en `partial/`, entrada sin listar, entrada o árbol alterados, borrado simulado de un `.deb`, `.deb` con hash alterado, aviso `Problem unlinking`, tráfico de red, exit inesperado); 10 rechazos de `<RUN>` con exit 2 (ruta histórica exacta, **descendientes** de `ps-apt-run1`/`ps-apt-run2`/caché del sistema, directorio de F2a y descendiente, marca `.f2a-evidencia`, enlace simbólico a una ruta protegida y a un descendiente, y `..` que resuelve a una ruta protegida); 5 aceptaciones de rutas hermanas y de nombres parecidos (`ps-apt-run10`, `ps-apt-run1-copy`, `ps-apt-run1x`, `sysapt2`, `ps-f2aX`); y, aparte, el rechazo de un `RUN/log` no vacío y la negativa a ejecutarse como root. Las funciones de guarda de `<RUN>` (`path_within`, `run_is_forbidden`, `run_in_f2a_dir`) se probaron además sobre un sistema de archivos sintético en 38 casos (exactas, descendientes, ancestros, `..`, enlaces simbólicos como ruta y como padre, ruta protegida que es un enlace, hermanas y nombres parecidos). La regla anterior, por coincidencia de texto, **admitía** un descendiente de `ps-apt-run1`; la actual compara rutas canónicas por límite de directorio y lo rechaza. Las evidencias originales se conservaron y, cuando falló la validación de rutas, no se invocó `apt-cache` ni `apt-get`. **Limitación:** un montaje `bind` de un directorio protegido en otro lugar solo se detecta por coincidencia exacta de `dispositivo:inodo`, no para sus descendientes.
- **Script de F2a** (4.7.5): pasa `bash -n`. **No se ejecutó contra el laboratorio.** Con datos sintéticos y en directorios temporales se probaron: las funciones de guarda `f2a_evid_ok` y `f2a_allowed` (casos de rutas de evidencias y de órdenes permitidas y rechazadas); el **corte por `mtime` y por `ctime`** (`g47a-c`) con archivos construidos a propósito —uno con solo `ctime` posterior y otro con solo `mtime` posterior—, donde `-newermt` solo omite el primero y `-newerct` y la comparación por epoch lo detectan; el **cierre `g98`/`g99`** (camino normal, aborto, idempotencia, intento tardío de sobrescribir y cinco manipulaciones, todas detectadas por el verificador de 4.7.6); y la **comparación de contadores de red** (`g14a`/`g14b`) con muestras de `/proc/net/dev`. Estas pruebas se hicieron como `root`, por lo que **no** prueban la protección por modo de `EVID` frente a un usuario sin privilegios. Se comprobó además por búsqueda de texto que el script no usa `cap`, `need`, `assert`, `abort`, `finalize`, `FORBIDDEN` ni otra función o variable de F2/F4.
- **No pudo verificarse:** la sintaxis de los bloques PowerShell del checklist (no hay PowerShell en el entorno; solo una comprobación estructural de paréntesis, llaves y corchetes), `shellcheck` (no disponible) y todo comportamiento frente a VirtualBox, al invitado o a APT real.

Esto **no sustituye** la validación con APT real: el formato de salida de `apt-config shell`, el efecto del modo `0555` sobre APT, los nombres de clave de `VBoxManage` y los demás supuestos siguen sin confirmar hasta la fase autorizada.

### 4.1 Entorno y funciones de control

**Orden dentro del script:** primero las definiciones (4.1, las funciones `inv_*`/`tree_state` de 4.2, y `finalize` con los predicados de 4.6) y después el flujo (4.3, 4.4, 4.5 y las comprobaciones finales de 4.6). Los bloques se muestran por tema, no en orden de ejecución.

```bash
#!/usr/bin/env bash
set -u -o pipefail -o noclobber
umask 077
RUN="${1:?ruta del RUN nuevo}"
PHASE="${2:?F2 o F4}"
case "$PHASE" in F2) WANT_FORMAL=100;; F4) WANT_FORMAL=0;; *) echo "fase inválida" >&2; exit 2;; esac
[ "$(id -u)" -ne 0 ] || { echo "no ejecutar con privilegios elevados" >&2; exit 2; }
RUN=$(realpath -e -- "$RUN") || exit 2          # ruta canónica: resuelve enlaces simbólicos, "." y ".."
PROTECTED_RUN=(/home/labadmin/ps-apt-run1 /home/labadmin/ps-apt-run2 /var/cache/apt)   # árboles históricos y caché del sistema

path_within() {   # path_within <ruta> <base>: 0 si <ruta> es <base> o está dentro de <base>; por límite de directorio, no por texto
  local p="${1%/}" b="${2%/}"
  [ -n "$b" ] || return 0                       # la base "/" abarca todo
  [ "$p" = "$b" ] && return 0
  case "$p" in "$b"/*) return 0;; esac
  return 1
}
run_is_forbidden() {   # 0 (prohibido) si RUN es, está dentro de o CONTIENE una ruta protegida, o comparte su identidad dispositivo:inodo
  local r="$1" q cq
  for q in "${PROTECTED_RUN[@]}"; do
    cq=$(realpath -m -- "$q") || return 0       # si no se puede canonizar la ruta protegida, se rechaza (falla cerrada)
    path_within "$r" "$cq" && return 0          # igual a o dentro de la ruta protegida
    path_within "$cq" "$r" && return 0          # RUN que contiene la ruta protegida (p. ej. el directorio padre)
    if [ -e "$cq" ] && [ "$(stat -c '%d:%i' -- "$r")" = "$(stat -c '%d:%i' -- "$cq")" ]; then return 0; fi
  done
  return 1
}
run_in_f2a_dir() {   # 0 si algún componente de la ruta empieza por "ps-f2a-" (el propio directorio o un descendiente)
  case "/$1/" in */ps-f2a-*/*) return 0;; esac
  return 1
}
run_in_f2a_dir "$RUN" && { echo "RUN no puede ser ni estar dentro de un directorio de evidencias de F2a" >&2; exit 2; }
run_is_forbidden "$RUN" && { echo "RUN no puede ser, estar dentro de ni contener un árbol histórico o la caché del sistema" >&2; exit 2; }
[ ! -e "$RUN/.f2a-evidencia" ] || { echo "RUN marcado como directorio de evidencias de F2a" >&2; exit 2; }
[ -d "$RUN/log" ] && [ -z "$(ls -A "$RUN/log")" ] || { echo "RUN/log debe existir y estar vacío" >&2; exit 2; }
ARCH="$RUN/cache/archives"
FORBIDDEN=(/home/labadmin/ps-apt-run1/cache/archives /home/labadmin/ps-apt-run2/cache/archives /var/cache/apt/archives)
APT_ENV=(env -i PATH=/usr/bin:/bin LC_ALL=C LANG=C APT_CONFIG="$RUN/apt.conf")
FINALIZED=0

cap() {  # cap <nombre> <comando...>: guarda argv, stdout, stderr y exit ORIGINALES; no decide nada
  local n="$1"; shift; local b="$RUN/log/$n"
  [ ! -e "$b.exit" ] || abort "cap: $n ya existe; las evidencias no se sobrescriben"
  printf '%s\0' "$@" > "$b.argv0"
  "$@" > "$b.stdout" 2> "$b.stderr"
  echo "$?" > "$b.exit"
  chmod 0444 "$b.argv0" "$b.stdout" "$b.stderr" "$b.exit"
}
need() {  # need <nombre> <exit esperado>: verifica sin modificar la evidencia
  local f="$RUN/log/$1.exit" got
  [ -s "$f" ] || abort "$1: falta el archivo .exit"
  got=$(<"$f")
  case "$got" in ''|*[!0-9]*) abort "$1: exit no numérico";; esac
  [ "$got" -eq "$2" ] || abort "$1: exit $got, esperado $2"
}
assert() {  # assert <mensaje> <función o comando de prueba...>
  local m="$1"; shift
  "$@" || abort "aserción fallida: $m"
}
abort() {
  echo "ABORT: $*" >> "$RUN/log/ABORT.txt"
  [ "$FINALIZED" -eq 1 ] || finalize
  echo "ABORT: $*" >&2
  exit 1
}
```

`cap` conserva tal cual la salida y el código de cada orden (no sobrescribe ni reinterpreta, y deja los archivos en solo lectura). `need` y `assert` solo leen. `abort` registra el motivo, ejecuta una vez las capturas posteriores (para no perder evidencia) y detiene el flujo con exit distinto de 0.

### 4.2 Inventario de la caché de archivos (archivos, directorios y `partial/` por separado)

`find -mindepth 1` sobre la caché también lista `partial/`, aunque esté vacío; por eso se capturan **cuatro inventarios distintos**:

```bash
inv_files()   { find "$ARCH" -mindepth 1 -maxdepth 1 -type f -printf '%f\t%s\t%m\n' | LC_ALL=C sort; }   # archivos del nivel superior
inv_dirs()    { find "$ARCH" -mindepth 1 -type d -printf '%P\t%m\n' | LC_ALL=C sort; }                  # directorios
inv_partial() { find "$ARCH/partial" -mindepth 1 -printf '%P\t%y\t%s\t%m\n' | LC_ALL=C sort; }          # contenido de partial/
inv_other()   { find "$ARCH" -mindepth 1 ! -type f ! -type d -printf '%P\t%y\n' | LC_ALL=C sort; }       # enlaces, sockets, etc.
tree_state()  { ( cd "$RUN" && find . -path ./log -prune -o -printf '%p\t%y\t%s\t%m\t%T@\n' | LC_ALL=C sort \
                 && find . -path ./log -prune -o -type f -exec sha256sum {} + | LC_ALL=C sort ); }
```

Estado esperado **al inicio**:

| Inventario | F2 | F4 |
|---|---|---|
| `inv_files` | vacío | exactamente los 10 `.deb` de `expected-archives.tsv` (nombre, tamaño, modo `444`) |
| `inv_dirs` | solo `partial<TAB>555` | solo `partial<TAB>555` |
| `inv_partial` | vacío | vacío |
| `inv_other` | vacío | vacío |

### 4.3 Preparación y capturas previas (no ejecutan APT)

```bash
INPUT_PATHS=(apt.conf preferences.core.candidate core.args sources.list state lists keys)
[ "$PHASE" = F4 ] && INPUT_PATHS+=(expected-archives.tsv cache/archives)

in_listing() { ( cd "$RUN" && find "${INPUT_PATHS[@]}" -type f | LC_ALL=C sort ); }

cap 00-inputs-before sh -c 'cd "$1" && sha256sum -c --strict inputs.sha256' _ "$RUN"; need 00-inputs-before 0
cap 00b-inputs-listing in_listing;                                                    need 00b-inputs-listing 0
assert "inputs.sha256 lista exactamente los archivos de entrada" \
  test "$(cut -c67- "$RUN/inputs.sha256" | LC_ALL=C sort)" = "$(cat "$RUN/log/00b-inputs-listing.stdout")"

ref() { [ "$(sha256sum < "$1" | cut -d' ' -f1)" = "$2" ]; }
assert "preferences.core.candidate = referencia" ref "$RUN/preferences.core.candidate" 939c1ccacd3b45816ee9b164a9f8a0d0f5d719b061432dcb3a4c9e01a04da04e
assert "state/status = referencia"               ref "$RUN/state/status"               3cda4875642cbd278ec769c322022839b947d5ea05f92402d95eb5aa31f1000e
assert "core.args = referencia"                  ref "$RUN/core.args"                  e36d6c36ce02420165bc73b7e11056f6c35c2c4c38909ae06e61b197697ee138
apt_conf_norm() { [ "$(sed "s#$RUN#<RUN>#g" "$RUN/apt.conf" | sha256sum | cut -d' ' -f1)" = 4662b85609276ea974363a77b7830fc3f1c607f991efa496f12bca9040d749bf ]; }
assert "apt.conf normalizado = referencia" apt_conf_norm

cap 01-pkg-versions    dpkg-query -W -f='${Package} ${Version} ${Architecture}\n' apt libapt-pkg6.0t64; need 01-pkg-versions 0
cap 02-apt-get-sha256  sha256sum /usr/bin/apt-get;                                                       need 02-apt-get-sha256 0
cap 03-net-before      cat /proc/net/dev;                                                                need 03-net-before 0
cap 04a-files-before   inv_files;   need 04a-files-before 0
cap 04b-dirs-before    inv_dirs;    need 04b-dirs-before 0
cap 04c-partial-before inv_partial; need 04c-partial-before 0
cap 04d-other-before   inv_other;   need 04d-other-before 0
cap 06-tree-before     tree_state;  need 06-tree-before 0
```

Y las comprobaciones de estado inicial, que abortan si fallan:

```bash
archives_layout_ok() {
  [ -d "$ARCH" ] && [ ! -L "$ARCH" ] && [ -d "$ARCH/partial" ] && [ ! -L "$ARCH/partial" ] \
    && [ "$(stat -c %a "$ARCH")" = 555 ] && [ "$(stat -c %a "$ARCH/partial")" = 555 ]
}
start_state_ok() {
  local l="$RUN/log"
  [ "$(cat "$l/04b-dirs-before.stdout")" = "$(printf 'partial\t555')" ] \
    && [ ! -s "$l/04c-partial-before.stdout" ] && [ ! -s "$l/04d-other-before.stdout" ] \
    && if [ "$PHASE" = F2 ]; then [ ! -s "$l/04a-files-before.stdout" ]
       else cmp -s "$l/04a-files-before.stdout" <(cut -f1,2,3 "$RUN/expected-archives.tsv" | LC_ALL=C sort); fi
}
assert "caché de archivos nueva, real y protegida (0555)" archives_layout_ok
assert "estado inicial de la caché según la fase"         start_state_ok
```

### 4.4 Validación previa obligatoria de las rutas efectivas de APT

Se ejecuta **antes** de `apt-cache policy` y de `apt-get -s`. `apt-config` solo lee configuración; no construye la caché de paquetes ni toca archivos.

```bash
cap 10-config-dump "${APT_ENV[@]}" apt-config dump; need 10-config-dump 0
cap 11-effective-paths "${APT_ENV[@]}" apt-config shell \
  A_ETC Dir::Etc/d A_SL Dir::Etc::sourcelist/f A_PREF Dir::Etc::preferences/f A_ST Dir::State::status/f \
  A_LISTS Dir::State::lists/d A_CACHE Dir::Cache/d A_ARCH Dir::Cache::Archives/d A_LOG Dir::Log/d
need 11-effective-paths 0

effective_paths_ok() {     # las 8 rutas efectivas bajo RUN y A_ARCH exactamente la caché nueva
  local out="$RUN/log/11-effective-paths.stdout" n=0 line val
  while IFS= read -r line; do
    n=$((n+1)); val=${line#*=\'}; val=${val%\'}
    case "$val" in "$RUN"/*) ;; *) return 1;; esac
  done < "$out"
  [ "$n" -eq 8 ] && grep -Fxq "A_ARCH='$ARCH/'" "$out"
}
archives_not_forbidden() { # distinta de toda caché histórica o del sistema (por ruta canónica e identidad dispositivo:inodo)
  local mine f; mine=$(stat -c '%d:%i' "$ARCH") || return 1
  [ "$(realpath -e -- "$ARCH")" = "$RUN/cache/archives" ] || return 1
  for f in "${FORBIDDEN[@]}"; do
    [ -e "$f" ] || continue
    [ "$(realpath -e -- "$f")" != "$(realpath -e -- "$ARCH")" ] || return 1
    [ "$(stat -c '%d:%i' "$f")" != "$mine" ] || return 1
  done
}
assert "rutas efectivas de APT todas bajo este RUN y Dir::Cache::Archives = caché nueva" effective_paths_ok
assert "la caché de este RUN no es ninguna caché histórica ni la del sistema"            archives_not_forbidden
```

Esta validación es una compuerta: **sin ella no se ejecuta ninguna orden de APT que pueda tocar la caché**. Si el formato de `apt-config shell` difiere del supuesto, `effective_paths_ok` falla y aborta (falla cerrada); el formato debe confirmarse en la fase autorizada.

### 4.5 Órdenes con APT, siempre en simulación

```bash
cap 12-policy "${APT_ENV[@]}" apt-cache policy nginx nginx-common age acl mariadb-server-core mariadb-client-core mariadb-common liburing2 libmariadb3 mysql-common
need 12-policy 0
mapfile -t PKGARGS < "$RUN/core.args"; assert "10 argumentos" test "${#PKGARGS[@]}" -eq 10
cap 20-formal "${APT_ENV[@]}" apt-get -s --no-download -o Debug::NoLocking=1 -o Debug::pkgProblemResolver=1 \
  -o Dir::Etc::preferences="$RUN/preferences.core.candidate" install "${PKGARGS[@]}"
finalize                           # siempre captura el estado posterior, aunque el exit sea inesperado
need 20-formal "$WANT_FORMAL"      # F2: 100, F4: 0; cualquier otro valor aborta
```

`20-formal` conserva exactamente la forma de la prueba original para que sea comparable. No se añaden `--fix-missing`, `Debug::pkgAcqArchive::NoQueue`, `--print-uris` (no tiene efecto con `-s`, DIAGNOSTICO C8) ni retiro de `-s` o de `--no-download`.

### 4.6 Capturas posteriores y comprobaciones finales

```bash
finalize() {  # solo lectura; guarda el estado posterior una única vez
  FINALIZED=1
  cap 90-net-after       cat /proc/net/dev
  cap 91a-files-after    inv_files
  cap 91b-dirs-after     inv_dirs
  cap 91c-partial-after  inv_partial
  cap 91d-other-after    inv_other
  cap 92-inputs-after    sh -c 'cd "$1" && sha256sum -c --strict inputs.sha256' _ "$RUN"
  cap 93-tree-after      tree_state
  cap 99-log-hashes      sh -c 'cd "$1/log" && find . -maxdepth 1 -type f ! -name "99-*" -exec sha256sum {} + | LC_ALL=C sort' _ "$RUN"
}

same() { cmp -s "$RUN/log/$1.stdout" "$RUN/log/$2.stdout"; }
net_idle() { diff <(grep -v '^ *lo:' "$RUN/log/03-net-before.stdout") <(grep -v '^ *lo:' "$RUN/log/90-net-after.stdout") >/dev/null; }
no_unlink_warning() { ! grep -q 'Problem unlinking' "$RUN/log/20-formal.stderr"; }
actions_hash() { printf '%s' "$(grep -E '^(Inst|Conf) ' "$RUN/log/20-formal.stdout")" | sha256sum | cut -d' ' -f1; }
formal_ok_f2() { ! grep -qE '^(Inst|Conf|Remv) ' "$RUN/log/20-formal.stdout"; }
formal_ok_f4() { [ "$(grep -c '^Inst ' "$RUN/log/20-formal.stdout")" -eq 10 ] && [ "$(grep -c '^Conf ' "$RUN/log/20-formal.stdout")" -eq 10 ] \
  && [ "$(grep -c '^Remv ' "$RUN/log/20-formal.stdout")" -eq 0 ] && ! grep -q '^E: ' "$RUN/log/20-formal.stderr" \
  && [ "$(actions_hash)" = f05ad1bb3f90993a0f2791be5cd73fe7cbda05b5464808f405430c1d067a2567 ]; }

for p in 91a-files-after:04a-files-before 91b-dirs-after:04b-dirs-before 91c-partial-after:04c-partial-before 91d-other-after:04d-other-before 93-tree-after:06-tree-before; do
  assert "${p%%:*} idéntico a ${p##*:}" same "${p%%:*}" "${p##*:}"
done
need 92-inputs-after 0
assert "sin tráfico en interfaces distintas de lo"      net_idle
assert "APT no intentó borrar archivos de caché"        no_unlink_warning
if [ "$PHASE" = F2 ]; then assert "F2: sin acciones Inst/Conf/Remv" formal_ok_f2; else assert "F4: 10 Inst, 10 Conf, 0 Remv y hash de acciones" formal_ok_f4; fi
echo "FASE $PHASE: criterios cumplidos (no es aprobación; ver sección 7)" > "$RUN/log/RESULT.txt"
```

### 4.7 F2a — procedimiento independiente en cinco etapas

F2a **no reutiliza** el script de F2/F4: tiene su propio directorio de evidencias y sus propias funciones. Los comandos de **Windows (PowerShell, host)** viven en [F2A-CHECKLIST-PREVIO.md](F2A-CHECKLIST-PREVIO.md) (etapas 1, 2 y 5) y los de **Ubuntu (Bash, invitado)** en este documento (etapa 3); nunca se mezclan en un mismo bloque. Nada de esto se ha ejecutado.

#### 4.7.1 Directorios y garantías contra sobrescritura

| Directorio | Quién escribe | Observación |
|---|---|---|
| `/home/labadmin/ps-apt-run1`, `…/ps-apt-run2` | **nadie** | históricos; solo `stat`/`find -printf` |
| `/var/cache/apt` y el resto del sistema | **nadie en F2a** | solo lectura; el arranque sí puede escribir (4.7.4) |
| `~/ps-f2a-<UTC>/` (en adelante `EVID`) | solo F2a | nuevo, modo `0700`, marca `.f2a-evidencia`, no reutilizable |
| `<RUN>` de F2/F4 (`ps-apt-run3`, …) | solo F2/F4 | aún no existen; el script de F2/F4 rechaza (ruta canónica, por límites de directorio) las rutas iguales a, dentro de o que contengan `ps-apt-run1`, `ps-apt-run2` o `/var/cache/apt`, las que tengan un componente `ps-f2a-*`, y la marca `.f2a-evidencia` |

Garantías que aplica el script de F2a (todas fallan cerradas): el nombre de `EVID` no puede coincidir con ni estar dentro de una ruta protegida ni parecerse a un `ps-apt-run*`; `EVID` se crea con `mkdir` **sin `-p`** (falla si existe); `noclobber` y comprobación de existencia antes de cada captura; archivos en modo `0444`; **lista cerrada** de órdenes de solo lectura (`f2a_allowed`) y rechazo de verbos y opciones que modifican; comparación de metadatos (`mtime`/`ctime`) de las rutas protegidas antes y después.

#### 4.7.2 Etapa 1 — Preparación con la VM apagada (host Windows, PowerShell)

Detalle y comandos en el checklist, fase P. En resumen: consultas de solo lectura de VirtualBox; comprobación de que la VM está apagada, sin red, sin carpetas compartidas ni portapapeles; recursos del host; identificación **exacta** de los medios (UUID, ruta, formato, capacidad, tamaño del archivo y cadena de padres); copia de lectura de las bitácoras de VirtualBox del host **antes** de cualquier arranque; hash de medios y configuración. **No se copia ni se modifica ningún disco en esta etapa.** Una copia de archivos o una instantánea solo se hace con autorización expresa, espacio verificado y medios identificados (checklist P5).

#### 4.7.3 Etapa 2 — Autorización posterior para encender la VM

Es una autorización **separada** de las anteriores. Debe nombrar: la VM (nombre y UUID), la ventana UTC, el operador, la protección del disco elegida y verificada, el canal de exportación de evidencias (D2), las escrituras del arranque que se aceptan (4.7.4), los criterios de parada y el apagado. Sin ella la VM no se enciende, y encenderla no autoriza por sí mismo la etapa 3.

#### 4.7.4 Un arranque normal de Ubuntu no es una operación sin escrituras

Aunque F2a solo lea, encender el invitado y la VM **puede** escribir en los siguientes lugares. Qué ocurre realmente depende de la configuración del invitado y no se asume:

- **Sistema de archivos:** recuperación del journal de ext4 o `fsck` si el apagado anterior no fue limpio; actualización de metadatos y de `atime` según las opciones de montaje.
- **Registros:** `journald`, `syslog`, `auth.log`, `kern.log`, `wtmp`, `btmp`, `lastlog`, registros de `cloud-init`, rotación de `logrotate`.
- **Servicios y temporizadores automáticos** que corren al arrancar o recuperan un disparo pendiente (`Persistent=`): `apt-daily`, `apt-daily-upgrade` y `unattended-upgrades`, `man-db`, `fstrim`, `e2scrub`, `motd-news`, `systemd-tmpfiles-clean`. Pueden tocar `/var/lib/apt`, `/var/cache/apt` o `/var/lib/dpkg` aunque no haya red (por ejemplo, intentar una actualización que falla y deja archivos parciales, bloqueos o registros).
- **`cloud-init`**, si está instalado y activo, puede reescribir configuración de red o de equipo.
- **`systemd`:** sellos de temporizadores, semilla aleatoria, reloj y sincronización de hora.
- **Sesión del operador:** historial de la shell y cachés en `/home/labadmin`, en el mismo árbol que `ps-apt-run1` y `ps-apt-run2` (aunque no dentro de ellos).
- **VirtualBox (host):** reescribe el `.vbox` y el estado de la VM; **rota `VBox.log`**, con riesgo de perder los registros del laboratorio anterior; si no hay instantánea, las escrituras van al **disco original**; si la hay, a un disco diferencial.

Consecuencias: el estado del invitado tras el arranque **no** es el estado previo; el contenido de `ps-apt-run1|2` no debería cambiar por el arranque pero **no está garantizado** (se comprueba, no se supone); y por eso el estado previo se preserva **antes** de encender (etapa 1) y la caché del sistema se interpreta con salvedad (checklist, S16).

#### 4.7.5 Etapa 3 — Inspección pasiva en el invitado (Ubuntu, Bash)

Solo con la autorización de la etapa 2. Usuario sin privilegios. **No se ejecuta ningún binario de APT.** Plantilla, no ejecutada.

```bash
#!/usr/bin/env bash
# F2a — inspección pasiva. INDEPENDIENTE de run-fase.sh: define fcap/fneed/fabort y no usa cap/need/assert/abort/finalize.
set -u -o pipefail -o noclobber
umask 077
[ "$(id -u)" -ne 0 ] || { echo "no ejecutar con privilegios elevados" >&2; exit 2; }

H1=/home/labadmin/ps-apt-run1; H2=/home/labadmin/ps-apt-run2; SYS=/var/cache/apt
PROTECTED=("$H1" "$H2" "$SYS")
ARCHDIRS=("$H1/cache/archives" "$H2/cache/archives" "$SYS/archives")
CUT_ISO='2026-11-06T17:29:00Z'   # cierre histórico (informe generado a las 17:28:01,47Z) + 59 s de margen declarado
CUT_EPOCH=$(date -u -d "$CUT_ISO" +%s) || { echo "no se pudo interpretar el instante de corte" >&2; exit 2; }

f2a_evid_ok() {   # EVID no puede coincidir con, ni estar dentro de, una ruta protegida; ni parecerse a un RUN
  local p="${1%/}" q                      # sin barra final; "/" queda como cadena vacía y coincide con todo
  case "$p" in */ps-apt-run*) return 1;; esac
  for q in "${PROTECTED[@]}"; do
    case "$p/" in "$q"/*) return 1;; esac
    case "$q/" in "$p"/*) return 1;; esac
  done
  return 0
}
f2a_allowed() {   # lista cerrada de órdenes de solo lectura; cualquier otra cosa devuelve 1
  local c="${1:-}" a; shift || true
  case "$c" in
    id|uname|uptime|last|findmnt|zcat|grep|sha256sum|stat|dpkg-query|cat|f2a_*) return 0 ;;
    date)       [ "$*" = '-u +%FT%TZ' ]; return $? ;;
    systemctl)  case "${1:-}" in list-timers|is-enabled) return 0;; esac; return 1 ;;
    dpkg)       case "${1:-}" in -S|--verify) return 0;; esac; return 1 ;;
    ss)         for a in "$@"; do case "$a" in -K|--kill) return 1;; esac; done; return 0 ;;
    ip)         for a in "$@"; do case "$a" in add|del|delete|set|flush|replace|change|append|up|down|netns) return 1;; esac; done; return 0 ;;
    journalctl) for a in "$@"; do case "$a" in --rotate|--vacuum-*|--flush|--sync|--relinquish-var|--smart-relinquish-var|--setup-keys|--update-catalog) return 1;; esac; done; return 0 ;;
    find)       for a in "$@"; do case "$a" in -delete|-exec|-execdir|-ok|-okdir|-fprint|-fprint0|-fprintf|-fls) return 1;; esac; done; return 0 ;;
    *)          return 1 ;;
  esac
}

EVID="$HOME/ps-f2a-$(date -u +%Y%m%dT%H%M%SZ)"
f2a_evid_ok "$EVID" || { echo "ruta de evidencias no permitida" >&2; exit 2; }
mkdir -m 0700 -- "$EVID"     || { echo "no se pudo crear $EVID (¿ya existe?)" >&2; exit 2; }   # sin -p: falla si existe
mkdir -m 0700 -- "$EVID/log" || exit 2
: > "$EVID/.f2a-evidencia"

fabort() {   # si la evidencia ya está sellada no se escribe nada en ella; si no, se registra el motivo y se cierra y sella
  [ "${CLOSED:-0}" -eq 1 ] || echo "ABORT: $*" >> "$EVID/log/ABORT.txt"
  echo "ABORT: $*" >&2; f2a_finish; exit 1
}
fcap() {   # fcap <nombre> <orden...>: guarda argv, stdout, stderr y exit originales; no decide nada
  local n="$1"; shift
  case "$n" in ''|*[!A-Za-z0-9._-]*) fabort "nombre de captura no válido: $n";; esac
  f2a_allowed "$@" || fabort "orden no permitida en F2a: $*"
  local b="$EVID/log/$n"
  [ ! -e "$b.exit" ] || fabort "$n ya existe; no se sobrescribe"
  printf '%s\0' "$@" > "$b.argv0"
  "$@" > "$b.stdout" 2> "$b.stderr"
  echo "$?" > "$b.exit"
  chmod 0444 "$b.argv0" "$b.stdout" "$b.stderr" "$b.exit"
}
fneed() {  # fneed <nombre> <exit esperado>: solo lee
  local f="$EVID/log/$1.exit" got
  [ -s "$f" ] || fabort "$1: falta el archivo .exit"
  got=$(<"$f")
  case "$got" in ''|*[!0-9]*) fabort "$1: exit no numérico";; esac
  [ "$got" -eq "$2" ] || fabort "$1: exit $got, esperado $2"
}

f2a_pkgs()      { dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' | LC_ALL=C sort; }
f2a_pkgs_hash() { f2a_pkgs | sha256sum; }
f2a_sources()   { cat /etc/apt/sources.list 2>/dev/null; ls -l /etc/apt/sources.list.d/ 2>/dev/null; cat /etc/apt/sources.list.d/* 2>/dev/null; }
f2a_history()   { grep -nE 'apt|dpkg|archives|cache|\.deb|rm |cp |mv |wget|curl' "$HOME/.bash_history" 2>/dev/null; }
f2a_cutoff()    { printf '%s\t%s\n' "$CUT_ISO" "$CUT_EPOCH"; }
f2a_after_close() {   # entradas con mtime O ctime > corte, a partir de árboles ya capturados (columnas 7 y 8 = epoch); no relee el sistema de archivos
  awk -F'\t' -v c="$CUT_EPOCH" '($7+0)>c || ($8+0)>c {print $1 "\t" $7 "\t" $8}' "$@"
}
f2a_net_rx_zero() {   # recepción desde el arranque: los contadores rx (campos 1-8) de toda interfaz distinta de lo deben ser 0
  awk -F'[: ]+' 'NR>2 && $2!="lo" { for (i=3;i<=10;i++) if ($i+0!=0) bad=1 } END { exit bad }' "$1"
}
f2a_net_unchanged() { # los contadores (rx y tx) de las interfaces distintas de lo no cambian entre dos capturas
  [ "$(grep -v '^ *lo:' "$1" | sed '1,2d')" = "$(grep -v '^ *lo:' "$2" | sed '1,2d')" ]
}
f2a_hash_all()  { ( cd "$EVID" && find . -type f ! -name 'g98-*' ! -name 'g99-*' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum ); }   # manifiesto: todo salvo g98/g99
f2a_hash_seal() { ( cd "$EVID/log" && sha256sum -- g98-evid-hashes.argv0 g98-evid-hashes.stdout g98-evid-hashes.stderr g98-evid-hashes.exit ); }   # sello: cubre el manifiesto
f2a_finish() {        # cierre verificable de dos niveles; una sola vez, también al abortar; no sobrescribe nada
  [ "${CLOSING:-0}" -eq 0 ] || return 0; CLOSING=1
  fcap g98-evid-hashes f2a_hash_all
  fcap g99-seal        f2a_hash_seal
  chmod -R a-w "$EVID"; CLOSED=1
  ( cd "$EVID/log" && sha256sum -- g99-seal.argv0 g99-seal.stdout g99-seal.stderr g99-seal.exit )   # RAÍZ: se muestra por consola y se transcribe aparte
}

# --- Identidad, hora y arranque
fcap g01-id         id;                                  fneed g01-id 0
fcap g02-os-release cat /etc/os-release;                 fneed g02-os-release 0
fcap g03-uname      uname -a
fcap g04-date-utc   date -u +%FT%TZ;                     fneed g04-date-utc 0
fcap g04b-timezone  cat /etc/timezone
fcap g05-uptime     uptime -s
fcap g05b-boot-id   cat /proc/sys/kernel/random/boot_id
fcap g06-last       last -x -F -n 30
# --- Red (pasivo)
fcap g10-links      ip -brief link
fcap g11-addr       ip -brief address
fcap g12-route4     ip route
fcap g13-route6     ip -6 route
fcap g14a-netdev-before cat /proc/net/dev;           fneed g14a-netdev-before 0
f2a_net_rx_zero "$EVID/log/g14a-netdev-before.stdout" || fabort "S13: recepción en una interfaz distinta de lo desde el arranque"
fcap g15-listen     ss -tulnH
# --- Tareas automáticas y configuración periódica de apt (lectura de archivos; no se ejecuta APT)
fcap g20-timers     systemctl list-timers --all --no-pager
fcap g21-enabled    systemctl is-enabled apt-daily.timer apt-daily-upgrade.timer unattended-upgrades.service
fcap g22-periodic   cat /etc/apt/apt.conf.d/10periodic /etc/apt/apt.conf.d/20auto-upgrades
fcap g23-sources    f2a_sources
# --- Versión real de APT y comparación con el baseline (sin ejecutar APT)
fcap g30-apt-pkgs   dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\t${db:Status-Abbrev}\n' apt apt-utils libapt-pkg6.0t64 dpkg; fneed g30-apt-pkgs 0
fcap g31-apt-owner  dpkg -S /usr/bin/apt-get /usr/bin/apt-cache /usr/bin/apt-config
fcap g32-apt-sha256 sha256sum /usr/bin/apt-get /usr/bin/apt-cache /usr/bin/apt-config /usr/lib/x86_64-linux-gnu/libapt-pkg.so.6.0*
fcap g33-apt-verify dpkg --verify apt libapt-pkg6.0t64      # exit distinto de 0 = diferencias: se registra como hallazgo
fcap g34-all-pkgs   f2a_pkgs
fcap g35-all-hash   f2a_pkgs_hash
# --- Rutas protegidas: estado inicial (solo metadatos; sin hashes ni lectura del contenido)
for d in "${PROTECTED[@]}"; do t=$(printf '%s' "$d" | tr '/' '_')
  fcap "g40a-stat$t" stat -c $'%n\t%F\t%a\t%U\t%x\t%y\t%z' -- "$d";                        fneed "g40a-stat$t" 0
  fcap "g41a-tree$t" find "$d" -printf '%p\t%y\t%s\t%m\t%u\t%g\t%T@\t%C@\n';             fneed "g41a-tree$t" 0
done
# --- Cachés: cuatro inventarios separados por caché (archivos, directorios, partial/, otros tipos)
for d in "${ARCHDIRS[@]}"; do t=$(printf '%s' "$d" | tr '/' '_')
  fcap "g43-files$t"   find "$d" -mindepth 1 -maxdepth 1 -type f -printf '%f\t%s\t%m\t%T@\n'
  fcap "g44-dirs$t"    find "$d" -mindepth 1 -type d -printf '%P\t%m\n'
  fcap "g45-partial$t" find "$d/partial" -mindepth 1 -printf '%P\t%y\t%s\t%m\t%T@\n'
  fcap "g46-other$t"   find "$d" -mindepth 1 ! -type f ! -type d -printf '%P\t%y\n'
done
# --- Entradas de ps-apt-run1/2 modificadas después del cierre histórico: mtime Y ctime, con tres comprobaciones independientes
T1=$(printf '%s' "$H1" | tr '/' '_'); T2=$(printf '%s' "$H2" | tr '/' '_')
fcap g47-cutoff        f2a_cutoff;                                                                      fneed g47-cutoff 0
TZ=UTC fcap g47a-mtime-after-close find "$H1" "$H2" -newermt "$CUT_ISO" -printf '%p\t%y\t%T@\t%C@\n'    # solo mtime
TZ=UTC fcap g47b-ctime-after-close find "$H1" "$H2" -newerct "$CUT_ISO" -printf '%p\t%y\t%T@\t%C@\n'    # solo ctime
fcap g47c-epoch-check  f2a_after_close "$EVID/log/g41a-tree$T1.stdout" "$EVID/log/g41a-tree$T2.stdout"   # mtime o ctime, por epoch numérico
for n in g47a-mtime-after-close g47b-ctime-after-close g47c-epoch-check; do
  fneed "$n" 0
  [ ! -s "$EVID/log/$n.stdout" ] || fabort "S14: entradas con mtime o ctime posteriores al corte (ver $n)"
done
fcap g48-system-cache-top find "$SYS" -maxdepth 1 -printf '%p\t%y\t%s\t%m\t%T@\n'
fcap g49-debs-anywhere    find / -xdev -type f -name '*.deb' -printf '%p\t%s\t%T@\n'
fcap g50-mounts           findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS
# --- Bitácoras (lectura; solo con los grupos que ya tiene el usuario)
fcap g60-apt-history zcat -f /var/log/apt/history.log*
fcap g61-dpkg-log    zcat -f /var/log/dpkg.log*
fcap g62-boots       journalctl --list-boots --no-pager
fcap g63-journal-apt journalctl --no-pager --since '2026-11-06 16:00:00' --until '2026-11-06 18:00:00' -u apt-daily.service -u apt-daily-upgrade.service
fcap g64-history     f2a_history
# --- Rutas protegidas: estado final y comparación (detecta cambios de contenido o de metadatos distintos de atime)
for d in "${PROTECTED[@]}"; do t=$(printf '%s' "$d" | tr '/' '_')
  fcap "g40b-stat$t" stat -c $'%n\t%F\t%a\t%U\t%x\t%y\t%z' -- "$d";                        fneed "g40b-stat$t" 0
  fcap "g41b-tree$t" find "$d" -printf '%p\t%y\t%s\t%m\t%u\t%g\t%T@\t%C@\n';             fneed "g41b-tree$t" 0
  cmp -s "$EVID/log/g41a-tree$t.stdout" "$EVID/log/g41b-tree$t.stdout" || fabort "$d cambió durante F2a (S14/S16)"
done
# --- Red: segunda captura y comparación (sin transmitir tráfico)
fcap g14b-netdev-after cat /proc/net/dev;                fneed g14b-netdev-after 0
f2a_net_rx_zero "$EVID/log/g14b-netdev-after.stdout" || fabort "S13: recepción en una interfaz distinta de lo durante F2a"
f2a_net_unchanged "$EVID/log/g14a-netdev-before.stdout" "$EVID/log/g14b-netdev-after.stdout" || fabort "S13: los contadores de red cambiaron durante F2a"
# --- Cierre verificable: RESULT.txt se escribe ANTES del manifiesto para que quede cubierto
echo "F2a pasiva completada; no es aprobación ni establece la causa histórica" > "$EVID/log/RESULT.txt"
f2a_finish
```

Notas: `fneed` solo exige exit 0 donde la ausencia del dato impediría interpretar (identidad, paquetes de APT, existencia de las rutas protegidas, fecha de corte). Los demás exits —`find` sobre una caché inexistente, `dpkg --verify` con diferencias, `systemctl is-enabled` de una unidad deshabilitada, permisos insuficientes en `journalctl`— se **registran tal cual** y se interpretan en el informe. Un orden fuera de la lista cerrada, un nombre de captura inválido o un cambio en las rutas protegidas entre la lectura inicial y la final **abortan**.

**Corte histórico (`g47*`).** `find -newermt` solo evalúa `mtime`; por eso el corte se comprueba tres veces: `g47a` (solo `mtime`, `-newermt`), `g47b` (solo `ctime`, `-newerct`) y `g47c`, que compara por epoch numérico las columnas `mtime` y `ctime` de los árboles ya capturados (`g41a`) sin releer el sistema de archivos. Cualquiera de las tres con contenido aborta (S14). El corte es `2026-11-06T17:29:00Z`: el informe de cierre se generó a las `17:28:01,47Z`, así que el archivo del propio informe (`ps-apt-run2/log/PS-LAB-APT-CORE-CIERRE.json`) tiene un `mtime` posterior a las `17:28:01` y un corte sin margen lo marcaría. **Limitaciones:** (i) el margen de 59 s es una suposición declarada; una modificación ocurrida dentro de ese margen no es detectable; (ii) `ctime` también cambia con `chmod`, `rename` o enlaces, no solo con escrituras; (iii) `g47c` desalinea columnas con rutas que contengan tabuladores o saltos de línea (`g47a`/`g47b` no dependen de columnas); (iv) se asume que el reloj del invitado estaba en UTC en el laboratorio (el listado del paquete de evidencias coincide con `generated_utc`), lo que se contrasta con `g04`/`g04b`; (v) `-newerct` debe confirmarse en el `find` del invitado: si no existe, `g47b` falla y aborta.

**Cierre verificable (`g98`, `g99`).** `RESULT.txt` se escribe **antes** del manifiesto. `g98-evid-hashes` hashea todos los archivos de `EVID` (capturas, `RESULT.txt`, `ABORT.txt` si existe y la marca `.f2a-evidencia`) **excepto** los propios `g98-*`/`g99-*`, por lo que no se autocita. `g99-seal` hashea los cuatro archivos de `g98-evid-hashes` (nivel 2). Los `sha256` de los cuatro archivos de `g99-seal` son la **raíz**: se muestran por consola y se transcriben por un canal aparte (D2); nada posterior los modifica. Ningún archivo se sobrescribe (cada captura se crea una vez con `fcap`), el cierre se ejecuta una sola vez (también al abortar, por `fabort`) y después `EVID` queda sin permisos de escritura (`chmod -R a-w`; los modos no están cubiertos por los hashes, solo el contenido). Una vez sellada la evidencia, `fabort` ya no escribe en ella. La verificación de completitud detecta cualquier archivo añadido después del cierre (por ejemplo, un `ABORT.txt` tardío). *Limitación:* las pruebas sintéticas se hicieron como `root`, para el que los bits de modo no restringen la escritura; la protección por modo de `EVID` frente a un usuario sin privilegios **no se probó** aquí.

**Red (`g14a`/`g14b`).** Se capturan los contadores de `/proc/net/dev` al empezar y al terminar, sin transmitir tráfico. Aborta (S13) si hay **recepción** (campos rx) distinta de cero en una interfaz distinta de `lo` en cualquiera de las dos capturas, o si **cualquier** contador de esas interfaces cambia entre ambas. *Qué puede comprobarse:* que, mientras duró la sesión, el invitado no recibió ni transmitió por una interfaz visible, y que no recibió nada desde el arranque. *Qué no:* tráfico desde el hipervisor o por interfaces que el invitado no ve, tráfico por `lo`, ni lo ocurrido antes del arranque; y un adaptador `null` (conectado a ninguna red) puede mostrar intentos de **transmisión** desde el arranque (por ejemplo, de DHCP) con `tx` distinto de cero que no prueban salida real: eso se registra como hallazgo en el informe, y la evidencia de aislamiento sigue siendo la configuración de VirtualBox (fases P y Z). Con adaptadores en `none` no hay interfaz distinta de `lo` y la comprobación es trivialmente satisfecha.

#### 4.7.6 Etapa 4 — Exportación y custodia de evidencias

- El canal de salida del invitado (sin red, sin carpetas compartidas ni portapapeles) es una **decisión abierta (D2)**: no se asume ninguno. Opciones a decidir por la auditoría: transcribir los hashes y salidas cortas desde la consola con capturas de pantalla, un medio de evidencia agregado con la VM apagada (cambio de infraestructura, requiere autorización), o lectura offline de una copia (si D1 la contempla).
- Lo que se exporta: todo `EVID` (capturas, `RESULT.txt`/`ABORT.txt`, marca, `g98-evid-hashes.*` y `g99-seal.*`) y, aparte, la **raíz** (cuatro `sha256` de `g99-seal.*`) que el script muestra por consola.
- Verificación del cierre en el destino (solo lectura; script de Bash cuyo código de salida es distinto de 0 si falla el sello, el manifiesto o la completitud; la comparación con la raíz transcrita aparte es manual; sin validar para Windows):

```bash
cd "$EVID" || exit 2
rc=0
( cd log && sha256sum -c --strict g99-seal.stdout )   || rc=1      # el sello cubre el manifiesto
sha256sum -c --strict log/g98-evid-hashes.stdout      || rc=1      # el manifiesto cubre todo lo demás
[ "$(find . -type f ! -name 'g98-*' ! -name 'g99-*' | LC_ALL=C sort)" = "$(cut -c67- log/g98-evid-hashes.stdout | LC_ALL=C sort)" ] \
  && echo "completitud OK" || { echo "completitud FALLA"; rc=1; }
( cd log && sha256sum -- g99-seal.argv0 g99-seal.stdout g99-seal.stderr g99-seal.exit )   # RAÍZ: comparar a mano con la transcrita aparte
exit "$rc"
```
- Custodia: se registran operador, hora UTC, canal usado y hash de cada archivo exportado; el custodio firma solo si existe; no se inventa firma. `EVID` se deja en solo lectura y no se reutiliza.
- Nada de esto se sube al repositorio ni se copia a ninguna ruta histórica.

#### 4.7.7 Etapa 5 — Apagado y comprobaciones posteriores (host Windows, PowerShell)

Detalle y comandos en el checklist, fase Z. En resumen: apagado ordenado **autorizado**, comprobación de `poweroff`, nueva lectura de la configuración de red y de los medios, hash de los medios y del `.vbox` **registrado aparte** del anterior (cambiará tras el arranque), copia de las bitácoras de VirtualBox generadas, y verificación de que la copia o la instantánea de la etapa 1 siguen intactas. No se restaura nada ni se borra la instantánea sin una autorización nueva.

### 4.8 Revisión de escrituras y privilegios de las correcciones

| Orden | Escribe en | Privilegios |
|---|---|---|
| `cap`, `need`, `assert`, `abort` | solo `$RUN/log/` (archivos nuevos, luego `chmod 0444`) | no |
| `inv_*`, `tree_state`, `in_check`, `in_listing`, `stat`, `realpath`, `id` | nada (lectura) | no |
| `apt-config dump/shell` | nada | no |
| `apt-cache policy`, `apt-get -s --no-download` | nada previsto; riesgo de `unlink` en la caché mitigado con `0555` y usuario sin privilegios (3.4) | no |
| F2a, etapa 3 (`fcap`, `fneed`, `fabort`, `f2a_*`) | solo `EVID/log/` (archivos nuevos, `0444`) y `EVID/.f2a-evidencia`; lee metadatos de las rutas protegidas | no |
| F2a, etapas 1 y 5 (PowerShell, host) | solo la carpeta nueva de evidencias del host; consultas de solo lectura de VirtualBox | no |
| Arranque del invitado (etapa 2) | **sí escribe** (4.7.4): disco del invitado, registros, `.vbox`, rotación de `VBox.log` | no; requiere autorización de encendido |

Ninguna orden de F2a o F2/F4 escribe sobre `ps-apt-run1`, `ps-apt-run2` ni `/var/cache/apt`, y ninguna requiere privilegios elevados; los scripts se niegan a ejecutarse con ellos. Lo que **sí** puede escribir en esas áreas es el arranque normal del invitado y de VirtualBox, no los comandos del plan (4.7.4).

## 5. Dos ejecuciones independientes y comparación

1. F2: `run3` y `run4` con caché nueva y vacía; F4: `run5` y `run6` con la caché verificada. Cada par parte de entradas copiadas de nuevo y de directorios distintos, y cada corrida es una invocación nueva del script.
2. Normalización permitida: solo la ruta `<RUN>`. Se comparan: `.exit` de cada orden, `stdout`/`stderr` normalizados, la lista ordenada de acciones `Inst`/`Conf`/`Remv` y su hash (líneas unidas por `\n`, sin salto final, como el audit de PS-LAB-04-A), los cuatro inventarios de caché antes/después y los hashes de entradas.
3. Contraste cruzado: en F4 el hash de las 20 acciones debe coincidir con el del diagnóstico previo (`f05ad1bb…2567`, ya exigido en `formal_ok_f4`); si no coincide, se documenta la causa (p. ej. locale) y se detiene.

## 6. Criterios de detención (cualquiera detiene la fase)

El script los aplica con `need`/`assert`; al detenerse conserva las evidencias y deja `ABORT.txt`.

- Hash de entrada ausente o distinto, antes o después; manifiesto que no coincide con los archivos presentes.
- `RUN/log` no vacío al inicio, o intento de sobrescribir una evidencia.
- Cualquier `.exit` ausente, no numérico o distinto del esperado en una orden crítica.
- Versión de APT no registrada o distinta de la esperada sin explicación.
- Rutas efectivas de APT fuera de `<RUN>`; `Dir::Cache::Archives` distinto de `<RUN>/cache/archives/`; caché que sea enlace simbólico o que coincida (ruta o `dispositivo:inodo`) con una histórica o la del sistema.
- Ejecución con privilegios elevados, caché de archivos que no sea nueva o sin modo `0555`.
- Estado inicial de la caché distinto del esperado (sección 4.2): archivos, directorios, contenido de `partial/` u otros tipos.
- Aviso `Problem unlinking the file` en stderr (APT intentó borrar un archivo de tamaño incorrecto): se registra como hallazgo y se detiene.
- Interfaz de red activa o delta de `/proc/net/dev` distinto de cero fuera de `lo`.
- En F2: exit distinto de 100 o cualquier línea `Inst`/`Conf`/`Remv` (el mecanismo esperado no se reproduce: se investiga A2-A7 y **no** se pasa a F3).
- En F4: exit distinto de 0, archivo de caché que cambia de nombre, tamaño o hash, cualquier `Remv`, o paquetes distintos de los 10.
- Necesidad de privilegios elevados, de escribir fuera de `<RUN>` o de ejecutar sin `-s`.
- **F2a:** `EVID` ya existente, dentro de una ruta protegida o con nombre de RUN; orden fuera de la lista cerrada; captura que intenta sobrescribir; `mtime`/`ctime` de `ps-apt-run1`, `ps-apt-run2` o `/var/cache/apt` distintos entre la lectura inicial y la final; y todos los criterios S01-S19 del checklist.
- Un `<RUN>` de F2/F4 que (en ruta canónica) sea, esté dentro de o contenga `ps-apt-run1`, `ps-apt-run2` o `/var/cache/apt`; que tenga un componente `ps-f2a-*`; o que lleve la marca `.f2a-evidencia`. Los enlaces simbólicos se resuelven antes de comparar.

## 7. Criterios de aceptación y rechazo

Para distinguir correctamente contenidos, los criterios usan los **cuatro inventarios** de la sección 4.2 (archivos del nivel superior, directorios, contenido de `partial/` y otros tipos) en vez de un único listado recursivo.

**F2 (reproducción del mecanismo) — ACEPTADO** si, en las dos corridas:
- `20-formal.exit = 100` y ninguna línea `Inst`/`Conf`/`Remv`;
- archivos del nivel superior: **ninguno**, antes y después; directorios: **solo `partial`** (modo `555`); contenido de `partial/`: **vacío**; otros tipos: **ninguno**; los cuatro inventarios idénticos antes y después;
- rutas efectivas validadas por programa (sección 4.4), distintas de toda caché histórica;
- hashes de entradas y árbol del `<RUN>` sin cambios; red sin tráfico; sin aviso `Problem unlinking`.

Resultado: el estado "caché nueva y vacía" **produce** el bloqueo (N=2) con las condiciones controladas.

**Lo que F2 no demuestra:** reproducir el fallo con caché vacía **no establece la causa de la ejecución histórica**. Qué había en `ps-apt-run1/cache/archives` el día de la corrida solo se demuestra con evidencia de aquel momento o, de forma indirecta y etiquetada como tal, con el inventario F2a más prueba de que no cambió. Sin eso, la causa histórica sigue siendo **hipótesis no confirmada** y el expediente lo debe decir así.

**F4 (control positivo) — ACEPTADO** si, en las dos corridas independientes:
- `20-formal.exit = 0`; stderr sin `E:`; exactamente 10 `Inst`, 10 `Conf`, 0 `Remv` coincidentes con el escenario `core`; mismo hash de acciones entre corridas y con el diagnóstico previo;
- archivos del nivel superior: **exactamente los 10 `.deb`** de `expected-archives.tsv` (nombre, tamaño, modo `444`) con el `sha256` de cada uno comprobado en `inputs.sha256`; directorios: **solo `partial`**; `partial/` vacío; otros tipos: ninguno; los cuatro inventarios idénticos antes y después (sin borrados ni archivos nuevos);
- rutas efectivas validadas, red sin tráfico, entradas y baseline (690) intactos.

Esto demuestra, junto con F2, que la disponibilidad local de los archivos era una causa suficiente del mecanismo observado; no sustituye la evidencia de la ejecución histórica.

**RECHAZO:** cualquier criterio incumplido. El resultado se informa tal cual, sin reintentos silenciosos ni cambio de opciones.

**Alcance de un ACEPTADO:** plan simulado con archivos disponibles por nombre y tamaño. **No** acredita instalación, scripts, ELF, servicios, backup ni S06, y no autoriza instalar ni modificar producción.

## 8. F3 — Obtención y verificación de los `.deb` (fase separada, no autorizada)

Solo se diseña; no se descarga ni incorpora nada en este ticket.

1. **Decisión previa de la auditoría:** autorizar la adquisición de los 10 `.deb` (11,008,492 bytes) o ratificar por escrito un criterio distinto. Un criterio basado solo en el diagnóstico debilita la prueba porque ese camino no comprueba archivos (DIAGNOSTICO C7); no se recomienda.
2. **Fuente (a decidir):** espejo interno ya autorizado, medio de custodia, o estación de staging **separada del laboratorio** con lista cerrada de las 10 URL del manifiesto. El laboratorio nunca se conecta a la red.
3. **Verificación en la estación de staging:** `sha256` y tamaño de cada archivo contra el manifiesto (cuyo origen es `Packages` autenticado por `InRelease` en PS-LAB-04). Lectura de metadatos de control sin instalar ni extraer (Package, Version, Architecture). Ningún `.deb` se instala, extrae ni ejecuta.
4. **Transferencia:** medio de solo lectura con la lista de hashes. La firma del custodio sobre esa lista la aporta la persona responsable; no se genera ni se simula.
5. **Colocación:** renombrar a los nombres de caché de DIAGNOSTICO sección 7 (cuatro llevan `%3a`), modo `0444`, directorio `0555`, dentro de un `<RUN>` nuevo; se genera `expected-archives.tsv` (nombre, tamaño, modo) e `inputs.sha256` con rutas relativas a `<RUN>`, que incluyen los `.deb`.
6. **Cuarentena y registro:** quién, cuándo, de dónde y con qué hashes. Los archivos no se suben al repositorio.
7. **Detención:** cualquier discrepancia de hash o tamaño.

## 9. Riesgos y controles

| Riesgo | Control |
|---|---|
| APT borra un archivo de caché con tamaño distinto, incluso en simulación (C3, C11) | Caché nueva `0555`, usuario sin privilegios, copias verificadas, hash del árbol antes y después, aviso `Problem unlinking` como señal |
| Se usa una caché histórica o la del sistema como espacio de trabajo y se altera la evidencia | Precondición 8, validación programática de rutas efectivas con identidad `dispositivo:inodo` (4.4), F2a de solo lectura |
| `partial/` vacío confundido con "caché vacía", o un enlace/archivo extraño pasa desapercibido | Cuatro inventarios separados y criterios por tipo (4.2, 7) |
| `sha256sum -c` verifica rutas contra el directorio equivocado, o hay archivos de entrada sin listar | Verificación siempre desde `<RUN>` con `--strict`, rutas relativas y comprobación de completitud (precondición 4, 4.3) |
| El flujo continúa tras un fallo | `need`/`assert` tras cada paso crítico; `abort` detiene, conserva evidencias y captura el estado posterior |
| Las evidencias se sobrescriben o se reinterpretan | `noclobber`, comprobación de existencia en `cap`, archivos en solo lectura y hash de `log/` |
| F2a y F2 comparten directorio y se invalidan o sobrescriben mutuamente | `EVID` exclusivo para F2a, con marca; F2/F4 rechazan `ps-f2a-*`, los árboles históricos (incluidos sus descendientes), la caché del sistema y la marca; funciones propias en cada procedimiento (4.1, 4.7) |
| Se presenta el arranque del invitado como lectura pura | 4.7.4 describe las escrituras posibles; la protección previa se hace con la VM apagada; la autorización de encendido las acepta de forma explícita |
| El arranque rota `VBox.log` y se pierde la evidencia histórica de red del host | Copia de lectura y hash de las bitácoras **antes** de encender (checklist P4) |
| Una copia de discos o instantánea se hace sin autorización, sin espacio o con medios mal identificados | Solo con autorización expresa, medios identificados por UUID y ruta, espacio verificado y sin registrar la copia (checklist P5); nada se copia en esta fase |
| Se atribuye la causa histórica a un resultado de reproducción | Sección 7: reproducir ≠ demostrar la causa histórica |
| Nombre de caché incorrecto por epoch (`%3a`) | Tabla de nombres esperados; `expected-archives.tsv`; comparación contra `inv_files` |
| `APT_CONFIG` no aplicado y uso de rutas del sistema | `env -i`, `APT_CONFIG` explícito, validación de rutas efectivas que falla cerrada |
| Se ejecuta sin `-s` o con privilegios elevados | Plantillas fijas, el script rechaza `id -u` = 0, revisión del `argv` capturado |
| Salida de red no detectada | Aislamiento a nivel de hipervisor + evidencia pasiva `/proc/net/dev` + `partial/` vacío |
| Falsa seguridad: plan ≠ instalación | Alcance del ACEPTADO redactado explícitamente (sección 7) |
| Versión de APT distinta del código leído | Registro de versión y hash del binario antes de interpretar |
| Cadena de custodia sin firma independiente | Hashes externos conservados por el custodio; no se inventan firmas |
| Datos sensibles en logs (rutas, usuario) | Revisión antes de incorporar evidencias; no subir logs privados al repositorio |
| Descargas no autorizadas | F3 aislada y con autorización expresa; el laboratorio sin red |
| Plantilla con errores de sintaxis o de formato de `apt-config` | `bash -n`, `shellcheck`, prueba con órdenes simuladas y confirmación del formato en la fase autorizada; las comprobaciones fallan cerradas |

## 10. Dependencias y bloqueantes para continuar con S06

1. Autorización expresa **por etapa** de F2a (preparación, encendido, inspección, exportación, apagado), de F2 (APT en simulación) y, si procede, de F3 (adquisición); además, autorización expresa para cualquier copia de discos o instantánea.
2. Decisión de la auditoría sobre las desviaciones del `apt.conf` de laboratorio y sobre el criterio de aceptación.
3. Registro de la versión real de APT del laboratorio.
4. Siguen abiertos todos los pendientes de PS-LAB-04-A: frescura (Release base Noble de 2024, MariaDB histórico, Node), D01–D16, inspección de payloads/maintscripts/ELF, build Linux S05, autorización física, aislamiento y recuperación, y la aprobación de perfil (`hybrid` y `full` sin autorización).
5. Aun con F4 aceptada, S06 permanece **NOT CERTIFIED**.
