# PS-LAB-04-B — F2a: checklist previo (PROPUESTA, sin ejecución)

**Nada de este documento fue ejecutado ni está autorizado.** Es análisis y checklist para auditoría independiente. No enciende la VM, no ejecuta VirtualBox ni APT, F2a, F2, F3 ni F4, no modifica infraestructura, no copia ni toca discos, no instala ni descarga paquetes. `S06 NOT CERTIFIED`; `core` sin aprobación formal; `hybrid` y `full` sin autorización. La causa histórica del exit 100 sigue sin confirmarse y los comandos de este documento **no están validados en el laboratorio ni contra VirtualBox**.

Procedimiento de referencia: [PLAN-PRUEBA-OFFLINE.md](PLAN-PRUEBA-OFFLINE.md), §4.7 (F2a). Diagnóstico: [DIAGNOSTICO-APT.md](DIAGNOSTICO-APT.md).

## 1. Revisión de la documentación integrada y estado de los hallazgos

| Comprobación | Resultado |
|---|---|
| `main` contiene PS-LAB-04-B | Sí (merge `#576`); los tres documentos de `main` eran idénticos a los locales |
| Datos de VirtualBox y de la VM en el repositorio | **Ninguno.** No hay UUID, versión, rutas de discos, configuración de red ni sistema operativo del host (`PRERREQUISITOS-VM.md` lo declara). Nada de eso se inventa aquí: todo son parámetros que aporta el operador |
| Sistema operativo del host | Inferido como Windows por rutas y PowerShell de fases previas; **no verificado** |

| Hallazgo | Estado en esta revisión |
|---|---|
| F2a escribía en `$RUN/log`, que F2 exige vacío | **Corregido en el plan**: F2a usa un directorio exclusivo `~/ps-f2a-<UTC>/` y F2/F4 rechazan ese directorio, los RUN históricos y la marca `.f2a-evidencia` (PLAN §2.9, §4.1, §4.7.1). Pendiente de auditoría |
| F2a invocaba `cap`/`abort`/`finalize` de F2 | **Corregido**: F2a define `fcap`/`fneed`/`fabort` y no usa ninguna función de F2/F4 (PLAN §4.7.5) |
| El arranque se describía como "lectura" | **Corregido**: PLAN §4.7.4 enumera las escrituras posibles de un arranque normal |
| `apt-get --version` ejecuta APT | La versión de APT en F2a se obtiene solo con `dpkg-query`, `dpkg -S`, `dpkg --verify` y `sha256sum` |

## 2. Decisiones abiertas para la auditoría

| ID | Decisión | Opciones y consecuencias |
|---|---|---|
| D1 | **Protección del disco histórico antes del primer arranque** | **A.** Instantánea: el disco base queda sin escrituras y las nuevas van a un disco diferencial; modifica la VM, requiere autorización expresa. **B.** Copia de archivos de los medios y del `.vbox` con la VM apagada a otro volumen, con hash origen/copia; no modifica VirtualBox, requiere autorización expresa y espacio verificado. **C.** Inspección offline de una copia sin arrancar el invitado; hoy no hay herramienta identificada. Mínimo propuesto: B; A si se autoriza. **Nada se copia ni se modifica en esta fase** |
| D2 | **Canal para sacar evidencias** de una VM sin red, carpetas compartidas ni portapapeles | transcripción desde consola con capturas; medio de evidencia agregado con la VM apagada (cambio de infraestructura); lectura offline. El operador debe documentar **cómo** se exportó el `.tar.gz` de la fase anterior |
| D3 | Umbrales de recursos (propuestos, a ratificar): RAM libre del host ≥ memoria de la VM + 2 GiB; espacio libre en el destino de una copia ≥ 1,2 × la suma de los archivos de la cadena de medios y del `.vbox` | sin precedente en el repositorio |
| D4 | Acceso a `journalctl` y `/var/log` | solo con los grupos que ya tiene el usuario; si hiciera falta privilegio elevado, detenerse |
| D5 | Escrituras del arranque sobre el invitado (PLAN §4.7.4) | se aceptan o no en la autorización de encendido |
| D6 | Esta corrección documental (separación F2a/F2) | incluida en el mismo patch; requiere dictamen |

## 3. Datos que debe aportar el operador (nada de esto está en el repositorio ni se inventa)

Nombre exacto y **UUID** de la VM; versión de VirtualBox y del Extension Pack; ruta del ejecutable `VBoxManage`; ruta del `.vbox` y de cada medio; sistema operativo del host y usuario operador; carpeta de evidencias del host; destino de una copia, si se autoriza; hora UTC de la ventana; usuario del invitado y forma de iniciar sesión (solo consola); estado esperado de instantáneas; cómo se exportó el paquete de la fase anterior.

## 4. Fases

Cada fase pasa solo si **todas** sus comprobaciones pasan. Cualquier fallo activa la sección 8. Los comandos de **Windows (PowerShell)** y de **Ubuntu (Bash)** están en bloques separados y nunca se mezclan.

### Fase P — Preparación con la VM apagada (host Windows, PowerShell)

Todo es lectura de VirtualBox y del sistema de archivos del host, salvo la carpeta nueva de evidencias. Subcomandos de `VBoxManage` **prohibidos** en esta fase: `startvm`, `controlvm`, `modifyvm`, `snapshot take|delete|restore`, `clonevm`, `clonemedium`, `createvm`, `registervm`, `unregistervm`, `closemedium`, `storageattach`, `sharedfolder`, `guestcontrol`, `setproperty`, `hostonlyif`, `natnetwork add|modify`. **No ejecutado.**

```powershell
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
# --- Parámetros que aporta el operador. Si siguen sin completar, se detiene.
$VBM          = '<RUTA-A-VBoxManage.exe-A-CONFIRMAR>'
$VM           = 'Novalvion-PriceSmart-APT-LAB'
$UUID_ESPERADO= '<UUID-DE-LA-VM-A-COMPLETAR-POR-EL-OPERADOR>'
$OUT_BASE     = '<CARPETA-DE-EVIDENCIAS-DEL-HOST-A-DEFINIR-POR-EL-OPERADOR>'
foreach ($p in @($VBM,$UUID_ESPERADO,$OUT_BASE)) { if ($p -like '<*>') { throw "STOP: parámetro sin completar: $p" } }
if (-not (Test-Path -LiteralPath $VBM -PathType Leaf)) { throw 'STOP: VBoxManage no existe en la ruta indicada' }

$OUT = Join-Path $OUT_BASE ((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $OUT | Out-Null      # única escritura: carpeta nueva de evidencias; falla si existe

function Cap([string]$n, [string[]]$a) {                 # guarda argv, stdout, stderr y exit sin reinterpretar
  $b = Join-Path $OUT $n
  if (Test-Path -LiteralPath "$b.exit") { throw "STOP: la evidencia $n ya existe" }
  Set-Content -LiteralPath "$b.argv" -Value ($a -join ' ')
  $p = Start-Process -FilePath $VBM -ArgumentList $a -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput "$b.stdout" -RedirectStandardError "$b.stderr"
  Set-Content -LiteralPath "$b.exit" -Value $p.ExitCode -NoNewline
}
function Need([string]$n, [int]$want) {
  $got = [int](Get-Content -LiteralPath (Join-Path $OUT "$n.exit"))
  if ($got -ne $want) { throw "STOP: $n exit $got, esperado $want" }
}
function Stop-If([bool]$cond, [string]$msg) { if ($cond) { throw "STOP: $msg" } }

Cap '00-vbox-version' @('--version')                              ; Need '00-vbox-version' 0
Cap '01-list-vms'     @('list','vms')                             ; Need '01-list-vms' 0
Cap '02-list-running' @('list','runningvms')                      ; Need '02-list-running' 0
Cap '03-showvminfo'   @('showvminfo',$VM,'--machinereadable')     ; Need '03-showvminfo' 0
Cap '04-snapshots'    @('snapshot',$VM,'list','--machinereadable') # exit distinto de 0 puede significar "sin instantáneas": se registra e interpreta
Cap '05-hostinfo'     @('list','hostinfo')                        ; Need '05-hostinfo' 0
Cap '06-systemprops'  @('list','systemproperties')                ; Need '06-systemprops' 0
Cap '07-hdds'         @('list','hdds')                            ; Need '07-hdds' 0
Cap '08-extpacks'     @('list','extpacks')                        ; Need '08-extpacks' 0
Cap '09-hostonlyifs'  @('list','hostonlyifs')
Cap '10-bridgedifs'   @('list','bridgedifs')
Cap '11-natnets'      @('list','natnets')
Cap '12-intnets'      @('list','intnets')
```

Interpretación **por programa** de `03-showvminfo` (falla cerrada: una clave esperada ausente también es STOP). Los nombres de clave de `--machinereadable` **deben confirmarse en la versión instalada**; no se asumen.

```powershell
$info = @{}
Get-Content -LiteralPath (Join-Path $OUT '03-showvminfo.stdout') | ForEach-Object {
  if ($_ -match '^"?([^"=]+)"?=(.*)$') { $info[$Matches[1]] = $Matches[2].Trim('"') } }
Stop-If ($info['name']   -ne $VM)               'nombre de VM distinto'
Stop-If ($info['UUID']   -ne $UUID_ESPERADO)    'UUID distinto del registrado'
Stop-If ($info['VMState']-ne 'poweroff')        "estado de la VM: $($info['VMState'])"
1..8 | ForEach-Object { $k = "nic$_"
  Stop-If (-not $info.ContainsKey($k)) "falta la clave $k"
  Stop-If ($info[$k] -notin 'none','null') "$k = $($info[$k]) (red conectada)" }
Stop-If ($info['clipboard']   -ne 'disabled')   'portapapeles habilitado'
Stop-If ($info['draganddrop'] -ne 'disabled')   'arrastrar y soltar habilitado'
Stop-If (@($info.Keys | Where-Object { $_ -like 'SharedFolder*' }).Count -gt 0) 'carpetas compartidas definidas'
```

Recursos del host (consultas de solo lectura):

```powershell
$os = Get-CimInstance Win32_OperatingSystem
('{0} MiB libres de RAM física' -f [math]::Floor($os.FreePhysicalMemory/1024)) | Set-Content -LiteralPath (Join-Path $OUT '20-host-ram.txt')
Get-Volume | Select-Object DriveLetter,FileSystemLabel,FileSystem,SizeRemaining,Size | Format-Table -AutoSize | Out-String |
  Set-Content -LiteralPath (Join-Path $OUT '21-host-volumes.txt')
(Get-CimInstance Win32_ComputerSystem).HypervisorPresent | Set-Content -LiteralPath (Join-Path $OUT '22-host-hypervisor.txt')
```

Identificación **exacta** de los medios (para P5; solo lectura; los nombres de clave se confirman en la salida real):

```powershell
$mediaKeys = @($info.Keys | Where-Object { $_ -match '-\d+-\d+$' -and $_ -notmatch 'ImageUUID' -and $info[$_] -notin 'none','emptydrive','' })
$mediaKeys | ForEach-Object { "{0} => {1}" -f $_, $info[$_] } | Set-Content -LiteralPath (Join-Path $OUT '23-vm-media.txt')
# La cadena de padres (instantáneas) y el formato/capacidad se leen de 07-hdds.stdout (UUID, Parent UUID, Location, Storage format, Capacity)
Stop-If ($mediaKeys.Count -eq 0) 'no se identificó ningún medio de la VM'
```

- [ ] **P1** `VBoxManage --version` y Extension Pack coinciden con lo esperado.
- [ ] **P2** La VM figura en `list vms` y **no** en `list runningvms`; `VMState = poweroff` (no `saved`, `aborted`, `paused` ni `running`).
- [ ] **P3** Nombre y UUID coinciden con los registrados; no es la VM histórica del baseline.
- [ ] **P4 Aislamiento (configuración).** Los 8 adaptadores en `none` o `null`; sin carpetas compartidas, portapapeles ni arrastrar/soltar; USB, escritorio remoto y dispositivos serie sin redirección (claves a confirmar). Cualquier adaptador conectado es STOP y **no se corrige** aquí (hacerlo es una modificación de infraestructura que pide autorización). **Además, bitácoras del host:** copiar en modo lectura `VBox.log` y `VBox.log.1..3` del directorio de registros de la VM y registrar su hash **antes de cualquier arranque**, porque encender la VM rota esos archivos y puede desplazar los del laboratorio anterior. Esas bitácoras muestran la configuración de red de los arranques pasados; si ya rotaron, se anota la pérdida. El operador documenta también cómo se exportó el paquete de la fase anterior y si hubo red en algún momento (D2).
- [ ] **P5 Protección del disco: identificación, autorización y espacio. No se copia ni modifica nada ahora.** Una copia de archivos (D1-B) o una instantánea (D1-A) solo procede si se cumplen **todas** estas condiciones:
  1. **Autorización expresa y específica** de la acción concreta (copia o instantánea), con nombre de VM y UUID.
  2. **Medios identificados de forma exacta**: UUID, ruta completa, formato, capacidad, tamaño real del archivo y **cadena completa de padres** (si hay instantáneas, copiar solo el medio base no basta); controlador y puerto; sin medios compartidos con otra VM. Ningún UUID ni ruta se supone: salen de `23-vm-media.txt` y `07-hdds.stdout`.
  3. **Espacio suficiente** comprobado en el destino (volumen distinto del de la VM): libre ≥ 1,2 × (suma de los archivos de la cadena de medios + `.vbox`), umbral propuesto en D3 a ratificar; cifras tomadas de las salidas reales, nunca estimadas. Si no hay espacio, STOP.
  4. **Verificación**: hash del origen = hash de la copia; la copia no se registra en VirtualBox ni se arranca. Una instantánea, por su parte, crea un disco diferencial y cambia la configuración de la VM: se documenta su efecto y no se elimina ni se restaura sin otra autorización.
- [ ] **P6 Hashes previos.** Con la VM apagada y antes de cualquier arranque se registra SHA-256, tamaño y fecha de cada medio de la cadena y del `.vbox` (`Get-FileHash -Algorithm SHA256 -LiteralPath <ruta>`; lectura). Solo prueban el estado previo: cambiarán después de arrancar.
- [ ] **P7** Recursos: memoria de la VM ≥ 4 GiB (plan); RAM libre del host y espacio de disco cumplen D3; VirtualBox no comparte hipervisor con otro (salida de `22-host-hypervisor.txt` interpretada, sin suponer capacidades del host).
- [ ] **P8** Instantáneas: las existentes coinciden con lo esperado; cualquier instantánea inesperada detiene.

### Fase A — Autorización posterior para encender la VM

Gate **separado**: sin él no se enciende, y las fases P y A juntas no autorizan inspeccionar.

- [ ] **A1** Existe una autorización escrita que nombra: la VM (nombre y UUID), la ventana UTC, el operador, la protección elegida en D1 **ya aplicada y verificada** (P5/P6), el canal de exportación (D2), las escrituras del arranque que se aceptan (PLAN §4.7.4, D5), los criterios de parada (sección 8) y el apagado.
- [ ] **A2** Se acepta por escrito que **el arranque modifica el invitado y VirtualBox** (PLAN §4.7.4): registros, `journald`, `wtmp`, posibles tareas automáticas de APT, rotación de `VBox.log` y escrituras en el disco original si no hay instantánea.
- [ ] **A3** Solo consola local del hipervisor; sin SSH ni acceso remoto; inicio de sesión con el usuario sin privilegios.

### Fase I — Inspección pasiva dentro del invitado (Ubuntu, Bash)

Solo tras A1-A3. El script es el de [PLAN-PRUEBA-OFFLINE.md](PLAN-PRUEBA-OFFLINE.md) §4.7.5 (única copia, para evitar divergencias): usa un directorio de evidencias exclusivo `~/ps-f2a-<UTC>/`, funciones propias (`fcap`, `fneed`, `fabort`), lista cerrada de órdenes de solo lectura, **ningún binario de APT** y comparación de metadatos de las rutas protegidas antes y después. Aquí solo se verifica su resultado:

- [ ] **I1** Identidad (Ubuntu 24.04.3, usuario sin privilegios, hora UTC) coincide con lo esperado; el reloj del invitado se contrasta con la hora UTC del host.
- [ ] **I2** Red: sin direcciones ni ruta por defecto y sin sockets en escucha inesperados (`g10`-`g13`, `g15`); contadores de `/proc/net/dev` comparados **antes y después** (`g14a`/`g14b`), sin transmitir tráfico: ninguna recepción en interfaces distintas de `lo` y ningún contador de esas interfaces cambia. **Alcance:** esto no detecta tráfico a nivel del hipervisor ni por `lo`, y un adaptador `null` puede mostrar intentos de transmisión desde el arranque (`tx` distinto de cero) que se registran como hallazgo sin probar salida real; la evidencia de aislamiento sigue siendo la configuración de VirtualBox (fases P y Z).
- [ ] **I3** Temporizadores y `unattended-upgrades` registrados (`g20`-`g22`, `g60`-`g63`); cualquier ejecución tras el arranque se declara como **efecto del arranque**, no como estado previo.
- [ ] **I4** Versión de APT (`g30`) frente al baseline: el status histórico y las preferencias fijan `apt`, `apt-utils` y `libapt-pkg6.0t64` en `2.8.3`. Una diferencia es hallazgo (hipótesis A7). `g33` (`dpkg --verify`) informa si los archivos del paquete difieren de su suma registrada. `g35` es el hash de los paquetes del propio laboratorio y **no se espera** igual al del baseline de 690 paquetes (`3cda4875…1000e`, de otro sistema): se compara solo para documentar la diferencia.
- [ ] **I5** `ps-apt-run1` y `ps-apt-run2` existen; `g47a` (`mtime`), `g47b` (`ctime`) y `g47c` (ambos, por epoch numérico) vacíos respecto del corte `2026-11-06T17:29:00Z` (informe de cierre `17:28:01,47Z` + 59 s de margen declarado); cualquier contenido aborta (S14) y solo se continúa con una autorización nueva. `g41a` y `g41b` idénticos para las tres rutas protegidas.
- [ ] **I6** Inventario de las cachés de la sección 5, con archivos, directorios, `partial/` y otros tipos por separado.
- [ ] **I7** `EVID/log/RESULT.txt` existe, no hay `ABORT.txt`, y el cierre verifica con el script de PLAN §4.7.6: sello `g99-seal` sobre el manifiesto `g98-evid-hashes` (que cubre todo lo demás, incluido `RESULT.txt`) y comprobación de completitud.

### Fase X — Exportación y custodia de evidencias

- [ ] **X1** Canal de exportación según D2, sin habilitar red ni carpetas compartidas.
- [ ] **X2** Se exporta todo `EVID` y se transcribe por un canal aparte la **raíz** (los cuatro `sha256` de `g99-seal.*` que muestra el script); en el destino se ejecuta el verificador de PLAN §4.7.6 (rc = 0) y se compara la raíz a mano. Los hashes del host se calculan con `Get-FileHash` al capturar.
- [ ] **X3** Registro de custodia: operador, hora UTC, canal, hash de cada archivo exportado. La firma del custodio solo si existe; no se inventa.
- [ ] **X4** `EVID` queda en solo lectura y no se reutiliza. Nada se sube al repositorio.

### Fase Z — Apagado y comprobaciones posteriores (host Windows, PowerShell)

Plantilla; **no ejecutada**; requiere la autorización de apagado de la fase A. Se parte de las mismas funciones `Cap`, `Need` y `Stop-If` de la fase P, con una carpeta de evidencias **nueva** (`$OUT` distinto).

```powershell
# El apagado ordenado se hace desde el invitado o desde la consola autorizada; aquí solo se comprueba el resultado.
Cap '30-showvminfo-after' @('showvminfo',$VM,'--machinereadable') ; Need '30-showvminfo-after' 0
Cap '31-list-running'     @('list','runningvms')                  ; Need '31-list-running' 0
$after = @{}
Get-Content -LiteralPath (Join-Path $OUT '30-showvminfo-after.stdout') | ForEach-Object {
  if ($_ -match '^"?([^"=]+)"?=(.*)$') { $after[$Matches[1]] = $Matches[2].Trim('"') } }
Stop-If ($after['VMState'] -ne 'poweroff') "la VM no quedó apagada: $($after['VMState'])"
1..8 | ForEach-Object { Stop-If ($after["nic$_"] -notin 'none','null') "nic$_ cambió a $($after["nic$_"])" }
```

- [ ] **Z1** La VM quedó en `poweroff`; red, carpetas compartidas y portapapeles siguen como en P4.
- [ ] **Z2** Hash de los medios y del `.vbox` **después**, registrado **aparte** del hash previo (se espera que difieran si no hay instantánea; la diferencia se documenta, no se "corrige").
- [ ] **Z3** Las bitácoras de VirtualBox generadas se copian en modo lectura y se hashean; se compara la lista de archivos con la de P4 para documentar qué se rotó.
- [ ] **Z4** La copia de archivos o la instantánea de P5 siguen intactas (hash de la copia igual al registrado).
- [ ] **Z5** Informe de F2a: qué se observó, qué no, qué escribió el arranque, y que **no** establece la causa histórica por sí solo.

## 5. Inventario de cachés y fuentes a inspeccionar

| Ubicación (invitado) | Para qué sirve | Qué se captura |
|---|---|---|
| `/home/labadmin/ps-apt-run1/cache/archives` y `partial/` | Caché de la ejecución formal histórica; **única** evidencia indirecta de A1 | archivos del nivel superior, directorios, contenido de `partial/`, otros tipos |
| `/home/labadmin/ps-apt-run2/cache/archives` y `partial/` | Caché de la segunda ejecución (solo diagnóstica) | igual |
| `/home/labadmin/ps-apt-run1`, `…run2` (árbol completo) | Detectar modificaciones posteriores al cierre (corte 2026-11-06T17:29:00Z: informe 17:28:01,47Z + 59 s de margen) | metadatos `mtime` y `ctime` comprobados por separado y por epoch, sin hashes de contenido |
| `/var/cache/apt/archives` y `partial/` | Caché del sistema; posible origen si `APT_CONFIG` no se aplicó (A4); puede haber sido tocada por tareas automáticas del arranque | igual, con la salvedad de PLAN §4.7.4 |
| `/var/cache/apt` (nivel superior) | Fechas de `pkgcache.bin`/`srcpkgcache.bin` | metadatos |
| Cualquier `*.deb` en el sistema de archivos del invitado | Archivos preparados fuera de las cachés | ruta, tamaño, fecha |
| `/etc/apt/sources.list*`, `10periodic`, `20auto-upgrades` | Contrastar origen MariaDB/Ubuntu (A4) y tareas periódicas | lectura |
| `/var/log/apt/history.log*`, `/var/log/dpkg.log*`, `journalctl` | Actividad de APT/dpkg en la ventana 16:43–17:28 UTC y tras el arranque | texto |
| `~/.bash_history` | Qué comandos se ejecutaron en `run1` | solo líneas con patrones relevantes, con revisión de datos sensibles |
| `VBox.log*` del host | Configuración de red de arranques anteriores | copia de lectura y hash (P4) |

## 6. Comandos permitidos y prohibidos

- **Permitidos:** consultas de `VBoxManage` listadas en la fase P; `Get-FileHash`, `Get-Item`, `Get-CimInstance`, `Get-Volume`; en el invitado, solo la lista cerrada de PLAN §4.7.5.
- **Prohibidos en F2a:** cualquier orden de APT (`apt`, `apt-get`, `apt-cache`, `apt-config`), `dpkg -i/-r/--configure`, `rm`, `mv`, `cp` o `chmod` sobre rutas históricas, `touch`, `chattr`, redirecciones hacia rutas históricas, `sudo`/`su`, `find -delete` o `-exec`, montajes o `remount`, `systemctl start|stop|mask|enable|disable`, descargas, instalación, SQL, y todo subcomando modificador de VirtualBox listado en la fase P.

## 7. Evidencias y hashes que deben conservarse

| Evidencia | Origen | Cuándo se hashea | Dónde se conserva |
|---|---|---|---|
| Salidas `00`-`12` de `VBoxManage` (`.argv`, `.stdout`, `.stderr`, `.exit`) y `20`-`23` | Host (fase P) | al capturar, `Get-FileHash` de cada archivo | Carpeta de evidencias del host, fuera del repositorio |
| SHA-256, tamaño y fecha de cada medio y del `.vbox` **antes** | Host (P6) | antes del primer arranque | Expediente |
| Copia de medios y `.vbox` (solo si D1-B se autoriza) y su hash | Host (P5) | al copiar; hash origen = hash copia | Otro volumen; no se registra ni arranca |
| `VBox.log`, `VBox.log.1..3` (copia de lectura) | Host (P4) | al copiar, **antes de arrancar** | Carpeta de evidencias del host |
| `~/ps-f2a-<UTC>/` completo: capturas `g01`-`g64`, `RESULT.txt`, manifiesto `g98-evid-hashes`, sello `g99-seal` | Invitado (fase I) | el manifiesto cubre todo salvo `g98`/`g99`; el sello cubre el manifiesto; la **raíz** (hashes de `g99-seal.*`) se transcribe aparte | Fuera de la VM según D2; el expediente guarda la raíz y la lista de hashes |
| Capturas de pantalla de la consola con los hashes (si D2 las usa) | Host | al tomar | Carpeta de evidencias del host |
| Salidas `30`-`31`, hashes de medios y `.vbox` **después**, bitácoras nuevas | Host (fase Z) | al capturar, registrados **aparte** de los previos | Carpeta de evidencias nueva del host |
| Acta de F2a: operador, hora UTC de cada fase, versiones, UUID, resultado de cada comprobación | Manual | al cierre | Expediente; firma del custodio solo si existe |

Ningún secreto, credencial ni contenido de `.bash_history` fuera de las líneas filtradas se almacena en el repositorio.

## 8. Criterios obligatorios para detenerse

Cualquiera detiene el procedimiento; se conserva lo capturado, se registra el motivo y no se continúa sin nueva autorización.

1. **S01** La VM no figura, el nombre o el UUID no coinciden, o es la VM histórica del baseline.
2. **S02** `VMState` distinto de `poweroff` antes de empezar, o señal de que la VM se arrancó sin autorización.
3. **S03** Algún adaptador distinto de `none`/`null`, o clave de red ausente en la salida.
4. **S04** Carpetas compartidas, portapapeles o arrastrar/soltar habilitados, USB o escritorio remoto activos.
5. **S05** Instantáneas inesperadas, medios compartidos con otra VM, o medios que no se pueden identificar con UUID y ruta.
6. **S06** Versión de VirtualBox o del Extension Pack distinta de la esperada.
7. **S07** RAM libre del host o espacio de disco por debajo de los umbrales D3.
8. **S08** Falta un `.exit`, es no numérico, o difiere del esperado en una orden crítica.
9. **S09** La protección D1 elegida no está aplicada y verificada antes de arrancar; o se pretende copiar o crear una instantánea **sin** autorización expresa, sin espacio verificado o con medios sin identificar.
10. **S10** El hash de un medio o del `.vbox` cambió entre dos lecturas con la VM apagada.
11. **S11** Hay que usar privilegios elevados o escribir fuera de la carpeta de evidencias nueva.
12. **S12** Una orden prohibida (sección 6) o fuera de la lista cerrada de PLAN §4.7.5 se ejecutó o estuvo a punto de ejecutarse.
13. **S13** Recepción (contadores rx) en una interfaz distinta de `lo` en `g14a` o `g14b`; cualquier contador de esas interfaces distinto entre `g14a` y `g14b`; o dirección o ruta por defecto. (Transmisión distinta de cero en un adaptador `null` desde el arranque, sin cambio entre capturas, se registra como hallazgo; no prueba salida.)
14. **S14** `ps-apt-run1` o `ps-apt-run2` no existen, o tienen entradas con `mtime` o `ctime` posteriores a `2026-11-06T17:29:00Z` sin explicación (`g47a`, `g47b` o `g47c` no vacíos), o cambian entre la lectura inicial y la final de F2a.
15. **S15** `apt`/`libapt-pkg6.0t64` instalados con versión distinta de `2.8.3`, o `dpkg --verify` informa diferencias (se registra como hallazgo y se detiene la interpretación).
16. **S16** Una tarea automática modificó `/var/cache/apt` o `/var/lib/apt` durante la sesión: se continúa solo con lo ya capturado y la caché del sistema se marca como no representativa del estado previo.
17. **S17** Una orden pide confirmación interactiva o muestra errores de permiso en una ruta histórica.
18. **S18** No se puede sacar la evidencia por el canal D2 aprobado.
19. **S19** Discrepancia entre este checklist, `PLAN-PRUEBA-OFFLINE.md` y lo observado, o ambigüedad sobre qué está autorizado.
20. **S20** El directorio de evidencias de F2a ya existe, está dentro de una ruta protegida o se parece a un `<RUN>` de F2/F4; o un `<RUN>` de F2/F4 (en ruta canónica) es, está dentro de o contiene `ps-apt-run1`, `ps-apt-run2` o `/var/cache/apt`, tiene un componente `ps-f2a-*` o lleva la marca `.f2a-evidencia`.

## 9. Riesgos, límites y validación de las plantillas

- **El arranque no es una operación sin escrituras** (PLAN §4.7.4): modifica el disco del invitado, sus registros y metadatos, puede ejecutar tareas automáticas de APT pendientes y rota `VBox.log`. La protección previa (D1) preserva el estado anterior; la inspección documenta el posterior.
- **Leer un directorio puede actualizar su `atime`** según las opciones de montaje; el contenido, `mtime` y `ctime` no cambian y por eso se comparan antes y después. Evitarlo del todo exigiría instantánea o montaje de solo lectura (cambios de infraestructura).
- **Canal de salida (D2) sin resolver:** sin él F2a no puede cerrarse con evidencia hasheada fuera del invitado.
- **No confirmado:** nombres de clave de `--machinereadable`, ruta de `VBoxManage`, comportamiento de `dpkg --verify` y de `journalctl` sin privilegios, y el análisis de fecha de `find -newermt` con `Z`. Las comprobaciones fallan cerradas.
- **Qué pudo verificarse de las plantillas en el entorno de revisión:** los bloques Bash de PLAN (F2/F4, F2a y verificador del cierre) pasan `bash -n`. Con datos **sintéticos** se probaron: (1) el corte por `mtime` y por `ctime`, con archivos construidos a propósito (uno con solo `ctime` posterior, otro con solo `mtime` posterior): `-newermt` solo habría omitido el primero; (2) el cierre `g98`/`g99`, incluidos el camino de aborto, el intento tardío de sobrescribir y cinco manipulaciones (archivo alterado, archivo añadido, manifiesto alterado, sello alterado, `ABORT.txt` tardío), todas detectadas; (3) la comparación de contadores de red con diez muestras de `/proc/net/dev`; (4) las funciones de guarda `f2a_evid_ok` y `f2a_allowed`; (5) el script de F2/F4 con órdenes simuladas (30 casos), incluida su guarda de `<RUN>` por ruta canónica y límites de directorio (descendientes, `..`, enlaces simbólicos, hermanas y nombres parecidos). Nada de esto ejecutó F2a ni inspeccionó el laboratorio. **No pudo verificarse:** la sintaxis de ningún bloque PowerShell (no hay PowerShell en el entorno; solo una comprobación estructural de paréntesis y llaves), `shellcheck` (no disponible), el comportamiento de `find -newerct`, `journalctl`, `dpkg --verify` y del formato de `VBoxManage --machinereadable` en el laboratorio, la protección por modo de `EVID` frente a un usuario sin privilegios (las pruebas se hicieron como `root`) ni nada contra VirtualBox o el invitado.
- Este checklist **no** establece la causa histórica del exit 100, **no** autoriza instalar, descargar ni modificar producción, y `S06` sigue **NOT CERTIFIED**.
