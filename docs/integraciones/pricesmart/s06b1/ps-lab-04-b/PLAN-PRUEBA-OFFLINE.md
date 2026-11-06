# PS-LAB-04-B — Plan de prueba formal offline controlada (PROPUESTA)

**Nada de este documento fue ejecutado ni está autorizado.** Todos los comandos son plantillas para una fase futura que requiere autorización expresa, fase por fase. No aprueba `core`, `hybrid` ni `full`; `S06 NOT CERTIFIED`. Diagnóstico y fundamentos: [DIAGNOSTICO-APT.md](DIAGNOSTICO-APT.md).

## 1. Estrategia

0. **Inventario de solo lectura** de las cachés existentes (F2a), sin ejecutar APT: es la única fuente posible de evidencia *indirecta* sobre lo que había en la caché histórica.
1. **Reproducir el mecanismo** sin cambiar nada (F2, caché nueva y vacía): confirma que ese estado produce el bloqueo (N=2) y captura las evidencias que hoy faltan. **Esto no demuestra la causa de la ejecución histórica** (ver sección 7).
2. **Solo si se autoriza por separado**, obtener y verificar los 10 `.deb` fuera del laboratorio (F3).
3. **Control positivo** con la caché verificada (F4): si el bloqueo desaparece, queda demostrado que la causa era la disponibilidad local de los archivos.
4. Cierre documental sin certificar S06 (F5).

No se asume que haya que descargar archivos: F2 puede mostrar otra causa (A2-A7 del diagnóstico) y entonces F3 no procede.

| Fase | Contenido | Requiere autorización de |
|---|---|---|
| F2a | Inventario de solo lectura de cachés existentes (sin APT) | lectura en la VM del laboratorio |
| F2 | 2 corridas formales con caché **nueva** y vacía + capturas | ejecutar APT en simulación en la VM del laboratorio |
| F3 | Obtención y verificación de los 10 `.deb` | adquisición de archivos (hoy `downloads_authorized: false`) |
| F4 | 2 corridas formales con caché verificada | ejecutar APT en simulación |
| F5 | Documento de resultados y recibo | edición documental |

## 2. Precondiciones y entradas

1. VM Ubuntu Server 24.04.3 aislada ya existente; no se crea ni modifica ninguna VM, y la VM histórica del baseline no se toca.
2. Un `<RUN>` nuevo por ejecución (`ps-apt-run3`, `run4`, …), nunca reutilizado. Los `<RUN>` previos (`run1`, `run2`) se conservan intactos. Su subdirectorio `log/` se crea vacío.
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

## 3. Aislamiento, rutas privadas y escrituras

- **Red:** interfaz de red desconectada o inexistente a nivel de hipervisor, documentada por el operador. Evidencia pasiva dentro de la VM: `ip -brief link`, `ip route` y los contadores de `/proc/net/dev` antes y después (delta cero en toda interfaz distinta de `lo`). No se hacen sondeos activos de conectividad.
- **Rutas privadas:** `apt.conf` apunta todas las rutas (`Dir::Etc*`, `Dir::State*`, `Dir::Cache*`, `Dir::Log`) a `<RUN>`. Se exige `APT_CONFIG` explícito y entorno limpio (`env -i`).
- **Validación previa obligatoria de rutas efectivas (no visual):** antes de cualquier orden que construya la caché de paquetes o simule (`apt-cache policy`, `apt-get -s`), el script consulta con `apt-config shell` las rutas **efectivas** y las compara por programa (sección 4.4). Exige que `Dir::Cache::Archives` sea **exactamente** `<RUN>/cache/archives/` con `<RUN>` canónico (`realpath`), que todas las demás rutas queden bajo `<RUN>`, que `<RUN>/cache/archives` no sea un enlace simbólico y que su identificador `dispositivo:inodo` sea distinto del de cada caché histórica y del sistema. Cualquier discrepancia aborta. La comprobación está diseñada para **fallar cerrada**: si el formato de salida de `apt-config` no es el esperado, también aborta.
- **Caché nueva y protegida:** `<RUN>/cache/archives` y su `partial/` con modo `0555`, y ejecución **sin privilegios elevados**. APT puede borrar archivos de caché de tamaño incorrecto incluso en simulación (DIAGNOSTICO C3, C11, sección 3.4); con el directorio `0555` y usuario sin privilegios el `unlink` falla y solo produce un aviso. Los modos `0444` de los archivos no bastan por sí solos. La protección se valida en F2 y su efecto se registra.
- **Control de escrituras:** hash del árbol completo del `<RUN>` (archivos, modos y fechas de modificación, excluyendo `log/`) antes y después; cualquier diferencia no explicada detiene la fase. Solo se auditó el camino de caché de archivos de APT (DIAGNOSTICO 3.4), no todo el flujo.
- **Locale:** `LC_ALL=C` para fijar mensajes en inglés. Las corridas previas usaron locale español; la diferencia se registra y el analizador solo usa las palabras `Inst`, `Conf` y `Remv`, que no se traducen.

## 4. Comandos propuestos (plantilla de script, NO ejecutada)

Todo se ejecuta como un script (`run-fase.sh <RUN> <F2|F4>`) por usuario sin privilegios. Es una **plantilla**. Estado de su validación en esta fase (sin APT, sin laboratorio): ensamblada tal cual desde este documento, pasa `bash -n`; se probó su lógica de control en un directorio temporal con `apt-config`, `apt-cache`, `apt-get` y `dpkg-query` **simulados** y rutas históricas ficticias, en 17 escenarios: 2 caminos felices (F2 y F4) y 15 de aborto, cada uno detenido por el motivo previsto (ruta efectiva histórica, enlace simbólico, modo incorrecto, archivos o directorios extra en la caché o en `partial/`, entrada sin listar, entrada o árbol alterados, borrado simulado de un `.deb`, `.deb` con hash alterado, aviso `Problem unlinking`, tráfico de red, exit inesperado, `RUN/log` no vacío, ejecución como root), conservando las evidencias originales y sin ejecutar `apt-cache`/`apt-get` cuando falla la validación de rutas. `shellcheck` no estaba disponible y no se ejecutó. **Esto no sustituye** la validación con APT real: el formato de salida de `apt-config shell`, el efecto del modo `0555` sobre APT y los demás supuestos siguen sin confirmar hasta la fase autorizada.

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
RUN=$(realpath -e -- "$RUN") || exit 2
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

### 4.7 F2a — inventario de solo lectura de cachés existentes

Se ejecuta antes de F2, con el mismo `cap`/`need`, y **solo con órdenes de lectura de metadatos** (`stat`, `find -printf`). No hay `-exec`, `-delete`, hash de contenido ni escritura en esos directorios; la salida va al `log/` del `<RUN>` nuevo.

```bash
for d in "${FORBIDDEN[@]}"; do
  tag=$(printf '%s' "$d" | tr '/' '_')
  cap "05-stat-before$tag" stat -c $'%n\t%F\t%a\t%U\t%x\t%y\t%z' -- "$d"
  cap "05-list$tag"        find "$d" -printf '%p\t%y\t%s\t%m\t%u\t%g\t%T@\n'
  cap "05-stat-after$tag"  stat -c $'%n\t%F\t%a\t%U\t%x\t%y\t%z' -- "$d"
done
```

Aquí **no** se usa `need`: el resultado (incluso "directorio inexistente") se registra tal cual. Es evidencia **indirecta** de la caché de `run1`: solo tiene valor si hay prueba de que no cambió desde entonces. Limitación declarada: leer un directorio puede actualizar su `atime` según las opciones de montaje; el contenido, `mtime` y `ctime` no cambian, y por eso se registran `stat` antes y después. Evitarlo del todo exigiría una instantánea o un montaje de solo lectura, que son cambios de infraestructura no solicitados.

### 4.8 Revisión de escrituras y privilegios de las correcciones

| Orden | Escribe en | Privilegios |
|---|---|---|
| `cap`, `need`, `assert`, `abort` | solo `$RUN/log/` (archivos nuevos, luego `chmod 0444`) | no |
| `inv_*`, `tree_state`, `in_check`, `in_listing`, `stat`, `realpath`, `id` | nada (lectura) | no |
| `apt-config dump/shell` | nada | no |
| `apt-cache policy`, `apt-get -s --no-download` | nada previsto; riesgo de `unlink` en la caché mitigado con `0555` y usuario sin privilegios (3.4) | no |
| F2a | nada; lectura de metadatos de directorios históricos | no |

Ninguna de las correcciones añade escritura sobre `ps-apt-run1`, `ps-apt-run2` ni `/var/cache/apt/archives`, y ninguna requiere privilegios elevados; el script se niega a ejecutarse con ellos.

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

1. Autorización expresa de F2a y F2 (APT en simulación) y, si procede, de F3 (adquisición).
2. Decisión de la auditoría sobre las desviaciones del `apt.conf` de laboratorio y sobre el criterio de aceptación.
3. Registro de la versión real de APT del laboratorio.
4. Siguen abiertos todos los pendientes de PS-LAB-04-A: frescura (Release base Noble de 2024, MariaDB histórico, Node), D01–D16, inspección de payloads/maintscripts/ELF, build Linux S05, autorización física, aislamiento y recuperación, y la aprobación de perfil (`hybrid` y `full` sin autorización).
5. Aun con F4 aceptada, S06 permanece **NOT CERTIFIED**.
