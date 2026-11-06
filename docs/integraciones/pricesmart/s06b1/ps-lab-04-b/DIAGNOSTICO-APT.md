# PS-LAB-04-B — Diagnóstico del exit 100 con `--no-download`

Fase 1 (auditoría y diseño). **No se ejecutó APT, no se descargó ni instaló nada en el laboratorio, no se tocó la VM.** Solo se leyeron el expediente, las evidencias ya existentes y código fuente público de APT (consultado desde el entorno de investigación). Este documento no aprueba perfiles ni certifica S06 (`S06 NOT CERTIFIED`).

## 1. Qué se revisó

| Elemento | Resultado |
|---|---|
| Rama / commit | `claude/vibrant-curie-tjnthr`, `HEAD = fb5769f53aa41a7d7eab8ba16294abdcd7a5831d`. Los cuatro documentos de `ps-lab-04-a` modificados por ese commit son idénticos al commit autorizado. |
| Paquete de evidencias | SHA-256 recalculado `18cad66c…7789` (coincide); 17/17 hashes individuales coinciden con `PS-LAB-APT-CORE-CIERRE.json`. Extracción fuera del repositorio. |
| `manifest.proposed.json` (escenario `core`) | 10 paquetes, 11,008,492 bytes, `payload_acquired: false` en los 10. |
| JSON históricos y scripts | Leídos, **no modificados**. |
| Código fuente de APT | Ver sección 3 (Ubuntu `2.7.14build2` y `2.8.4ubuntu0.1`; `2.8.3` no obtenible). |

## 2. Hechos comprobados con las evidencias existentes

| ID | Hecho | Fuente |
|---|---|---|
| H1 | El `argv` de la prueba formal y el del diagnóstico son idénticos salvo `--no-download` (mismos 10 argumentos, mismas preferencias). | `core-simulation.argv.json` vs `core-diagnostic.argv.json` |
| H2 | En la corrida formal el resolvedor termina bien (`broken count: 0`, `Done`) y **después** aparece `E: No se pudieron obtener algunos archivos…`. No hay ninguna línea `Inst`/`Conf` ni el bloque "Se instalarán los siguientes paquetes NUEVOS". | `core-simulation.stdout/.stderr` |
| H3 | Con las mismas entradas y sin `--no-download`, el diagnóstico produce 10 `Inst`, 10 `Conf`, 0 `Remv` en dos ejecuciones idénticas, exit 0. | `core-diagnostic.*` (run1, run2) |
| H4 | Exit 100 de la formal: consta solo en el informe de cierre y el audit (no hay archivo de exit code propio). Una única ejecución formal (`run1`). | `PS-LAB-APT-CORE-CIERRE.json` |
| H5 | `apt.conf` declara rutas absolutas privadas por run, incluida `Dir::Cache::archives`. | `apt.conf` |
| H6 | El expediente marca `payload_acquired: false` para los 10 paquetes del perfil. | `manifest.proposed.json` |
| H7 | El baseline histórico (status de 690 paquetes) instala `apt`/`libapt-pkg6.0t64` `2.8.3`. | `state/status`, `preferences.core.candidate` |

## 3. Código fuente de APT: qué está confirmado y con qué alcance

Todo se leyó en el entorno de investigación el 2026-11-06. **No se ejecutó APT ni se descargó nada al laboratorio**; los fuentes quedaron fuera del repositorio.

### 3.1 Fuentes y limitación sobre 2.8.3

| Fuente | Origen | SHA-256 |
|---|---|---|
| Ubuntu `apt_2.7.14build2.tar.xz` (noble, lanzamiento) | `archive.ubuntu.com/ubuntu/pool/main/a/apt/` | `7d4d0f2e…8410` (coincide con su `.dsc`) |
| Ubuntu `apt_2.8.4ubuntu0.1.tar.xz` (noble-security, sucesor de 2.8.3) | `archive.ubuntu.com/ubuntu/pool/main/a/apt/` | `727dc3be…01e3` (coincide con su `.dsc`) |
| Changelog Ubuntu de `apt 2.8.3` | `changelogs.ubuntu.com` | `ad3fd8fe…abef` |
| Upstream `Debian/apt` etiqueta `2.7.14` (espejo GitHub) | `raw.githubusercontent.com` | `private-install.cc` `b6251095…398c`; `acquire-item.cc` `0b9edfe3…040f` |

**El paquete fuente `apt 2.8.3` no pudo obtenerse.** Ya no está en el pool de `archive.ubuntu.com` ni de `security.ubuntu.com` (solo `2.7.14build2` y `2.8.4ubuntu0.1`), y Launchpad redirige a `launchpadlibrarian.net`, bloqueado en el entorno de investigación. Por tanto **ningún comportamiento está confirmado leyendo directamente el código de 2.8.3.**

### 3.2 Acotamiento de 2.8.3 entre dos versiones oficiales de Ubuntu

Cronología del changelog: `2.7.14` → `2.8.0` → `2.8.1` → `2.8.2` → **`2.8.3`** → `2.8.4ubuntu0.1`.

| Archivo de APT | `2.7.14build2` frente a `2.8.4ubuntu0.1` |
|---|---|
| `apt-private/private-install.cc` | **idéntico** (y a upstream 2.7.14) |
| `apt-pkg/acquire-item.cc` | **idéntico** (y a upstream 2.7.14) |
| `apt-pkg/packagemanager.cc` | **idéntico** |
| `cmdline/apt-get.cc` | **idéntico** |
| `apt-private/private-cmndline.cc` | **idéntico** |
| `apt-pkg/contrib/cmndline.cc` | **idéntico** |
| `apt-pkg/contrib/fileutl.cc` | **idéntico** (`508b2f39…`) |
| `apt-pkg/acquire.cc` | difiere en 4 líneas (un `Warning` pasa a mensaje de depuración); no interviene en este flujo |

Las entradas de changelog `2.8.0`-`2.8.3` (claves de firma, `ResolveByKeep`, `apt-ftparchive`, pruebas, traducciones) y la de `2.8.4ubuntu0.1` (seguridad en métodos de descarga, límites de memoria) **no mencionan** descarga de archivos, caché, simulación, `--no-download` ni `--print-uris`.

**Nivel de confirmación:** que `2.8.3` se comporte igual es una **inferencia de alta confianza por acotamiento** (idéntico en las versiones que la rodean y sin cambios documentados), **no una confirmación directa**. Tampoco se verificó que el binario instalado en el laboratorio corresponda a esas fuentes (E1).

### 3.3 Comportamientos

Confirmado en el código de Ubuntu `2.7.14build2` y `2.8.4ubuntu0.1` (idénticos). Líneas de `private-install.cc` (PI) y `acquire-item.cc` (AI):

| ID | Comportamiento | Ubicación |
|---|---|---|
| C1 | Para cada paquete a instalar APT crea un `pkgAcqArchive` (`packagemanager.cc:97`, invocado desde PI `:179`). El nombre esperado en caché es `QuoteString(nombre,"_:") _ QuoteString(versión,"_:") _ QuoteString(arch,"_:.") .deb`: **el epoch se codifica `:`→`%3a`.** | AI `:3464` |
| C2 | Hay "acierto de caché" si existe `Dir::Cache::Archives/<nombre>` y su **tamaño** es igual al `Size` de `Packages`; entonces `Local=true`, `Complete=true`. **No se comprueba el hash en este punto.** | AI `:3497-3505` |
| C3 | Si el archivo existe con **otro tamaño, APT lo borra** (`unlink`); si el archivo de `partial/` es mayor que `Size`, también. Ver sección 3.4. | AI `:3511`, `:3519-3520` |
| C4 | Sin acierto, el ítem queda `Local=false` y se encola para descarga. | AI `:3537-3538` |
| C5 | Con `APT::Get::Download=false`, antes de simular APT quita del `Fetcher` todo ítem no local; si alguno queda `Complete=false` marca `Missing` y, sin `--fix-missing`, devuelve `Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?`. | PI `:183-206` |
| C6 | Esa comprobación ocurre **antes** de la rama de simulación y antes de imprimir el resumen de paquetes nuevos. | PI `:179-206` frente a `:283-297` |
| C7 | Sin `--no-download`, la simulación retorna sin ejecutar el `Fetcher`: no descarga y **no comprueba que los archivos existan**. | PI `:283-297` |
| C8 | `--print-uris` se evalúa después de la rama de simulación: combinado con `-s` **no imprime URI**. | PI `:283-297`, `:344` |
| C9 | `Debug::pkgAcqArchive::NoQueue=true` marca todo ítem como completo y local sin comprobar nada. **No es válida para una prueba formal.** | AI `:3527-3536` |
| C10 | `--no-download` ⇒ `APT::Get::Download=false`: la opción booleana `--download` (`private-cmndline.cc:276`) admite el prefijo `no-` (`cmndline.cc:147-178`). El exit 100 ante un error de APT sigue documentado en `apt-get(8)` y no se inspeccionó en código. | `private-cmndline.cc:276`, `cmndline.cc` |
| C11 | `RemoveFile` es un `unlink` directo, sin consultar `Simulate`; devuelve éxito si el archivo no existe y solo emite un `Warning` si el `unlink` falla. | `fileutl.cc:205-218` |
| C12 | En simulación **no** se llama a `Fetcher.GetLock`, que es lo que crea y ajusta (`chmod`, `chown`) `partial/`. Sin simulación ni `--print-uris` sí se llama. | PI `:160-165`, `acquire.cc:96-165` |
| C13 | Descartar los ítems del `Fetcher` no toca archivos: el destructor solo desregistra el ítem y `Finished()` solo vacía el nombre. | AI `:790-794`, `:860-862`, `:3584-3590` |

### 3.4 ¿Puede la comprobación de caché modificar o borrar archivos durante una simulación?

**Sí, en dos casos concretos**, confirmados por el código (C3 + C11 + C6):

1. Un archivo `Dir::Cache::Archives/<nombre>` cuyo tamaño ≠ `Size` se **elimina**.
2. Un archivo `Dir::Cache::Archives/partial/<nombre>` mayor que `Size` se **elimina**.

Ocurre en `pkgAcqArchive` al construirse (desde `GetArchives`, `PI:179`), antes del retorno de la simulación, y con o sin `--no-download`. No se encontró ninguna referencia a `Simulate` en `fileutl.cc` ni en `acquire-item.cc`.

Fuera de esos dos casos, el análisis del código no encontró otras escrituras en la caché de archivos durante la simulación (C12, C13). **Alcance:** solo se auditó el camino de `pkgAcqArchive` y `InstallPackages`; no se auditó el resto del flujo (carga de la caché de paquetes, `extended_states`, etc.), por lo que se exige control por hash del árbol completo del `<RUN>` antes y después (plan, sección 3).

**Mitigación diseñada (a validar en la fase autorizada):**
- Ejecutar **sin privilegios elevados**; root ignora los permisos del directorio.
- Directorio de archivos y `partial/` con modo `0555`: el `unlink` falla con `EACCES` y APT solo emite el aviso `Problem unlinking the file …` sin borrar. Ese aviso en stderr es en sí mismo evidencia de un tamaño incorrecto.
- Los modos `0444` de los archivos **no** protegen por sí solos: borrar depende de los permisos del directorio.
- Nunca usar cachés históricas ni la del sistema como directorio de trabajo (plan, sección 3).

## 4. Inferencia (no es observación directa)

H1 + H2 + H3 + C5/C6 implican que:

1. La causa **no está en el resolvedor, los pins ni los candidatos**: el mismo plan se resuelve en el diagnóstico. El fallo está en el paso que comprueba la disponibilidad local de los `.deb`.
2. Con la lógica común de Ubuntu `2.7.14build2` y `2.8.4ubuntu0.1` (`2.8.3`, inferida por acotamiento, sección 3.2), ese mensaje aparece **en la ruta `--no-download` cuando al menos uno de los ítems no fue satisfecho por un archivo con nombre y tamaño exactos en el directorio de archivos efectivo**.
3. La ausencia de `<RUN>/cache/archives/*.deb` (H6) es la explicación más consistente, pero el paquete de evidencias **no incluye el listado de ese directorio**, y el error agregado no dice qué ítems fallaron. Sigue siendo **hipótesis no confirmada**; esta fase solo la refina de "ausencia de `.deb`" a "ítem(s) no satisfechos por la comprobación nombre+tamaño en el directorio efectivo", con varias subcausas posibles (matriz, sección 5).
4. **Reproducir con caché vacía no es demostrar la causa histórica.** Una futura corrida con caché vacía que termine en exit 100 demostraría que ese estado es *suficiente* para producir el error (el mecanismo), pero **no** prueba qué contenía la caché en la ejecución de `run1`. La causa histórica solo se demuestra con evidencia de aquel momento, o con evidencia posterior etiquetada como indirecta (por ejemplo, un listado actual de `ps-apt-run1/cache/archives` más prueba de que no cambió desde entonces). Sin ello, la causa histórica permanece como hipótesis aunque el mecanismo se reproduzca.

## 5. Matriz de causas posibles

| ID | Hipótesis | ¿Compatible con la evidencia? | Cómo comprobarla sin instalar ni descargar |
|---|---|---|---|
| A1 | Caché vacía: no hay `.deb` | Sí, la más consistente (H6) | Para la **ejecución histórica**: listado de la caché de entonces (E3-hist), solo con integridad probada. Para el **mecanismo**: F2 (caché vacía) y el control positivo F4 |
| A2 | Hay `.deb` pero con nombre distinto al de APT | Posible: 4 de los 10 llevan epoch (`1%3a…`) y su nombre en repositorio no lo lleva (sección 7) | Comparar listado real con los 10 nombres esperados (E3 + E4) |
| A3 | Hay `.deb` con tamaño distinto a `Size` | Posible; además APT los **borraría** (C3, C11) | Listado antes/después y comparación de tamaños con el manifiesto (E3) |
| A4 | El directorio efectivo no es el esperado (`APT_CONFIG` no aplicado, ruta relativa, entorno heredado) | No descartable: el `argv` no incluye `-c` y no hay volcado de configuración | `apt-config dump` bajo el mismo entorno y registro del entorno de ejecución (E1, E2) |
| A5 | Caché parcial: unos sí y otros no | Posible; el mensaje es agregado | Listado frente a los 10 nombres esperados (E3 + E4) |
| A6 | Los archivos existen pero no son legibles/`stat` falla | Posible | Listado con modo/propietario y usuario efectivo de la prueba (E3, E5) |
| A7 | Diferencia entre el APT del laboratorio y el código leído | Poco probable (código idéntico en las versiones vecinas, sección 3.2) pero no descartada: la versión instalada no está registrada | Versión, origen y hash del binario/paquete del laboratorio (E1) |
| A8 | Fallo de resolvedor, pins o candidatos | **Descartada** por H1-H3 | — |
| A9 | Índices `Packages` o URI de repositorio | **Descartada como causa directa**: la comprobación de caché no consulta la red; los índices solo aportan `Filename`, `Size` y hashes | — (los índices sí deben estar íntegros, E6) |
| A10 | Errores distintos (`Can't find a source…`, `has no Size information`) | **Descartada**: son mensajes distintos del observado | — |

## 6. Plan resuelto frente a archivos disponibles

- **El diagnóstico (sin `--no-download`) demuestra** que, con estos índices, pins y status, APT puede calcular un plan consistente (C7). **No demuestra** que los archivos necesarios existan.
- **La prueba formal, si pasara, demostraría** que para los 10 ítems hay en el directorio efectivo un archivo con el nombre y tamaño esperados (C2). **No demostraría**: integridad por hash (APT no la comprueba en ese punto), autenticidad de los `.deb`, ni que `dpkg` pueda desempaquetarlos, ni scripts de mantenedor, orden real de configuración, ELF, servicios, backup ni S06.
- La integridad debe comprobarse por separado contra el `sha256` y `size_bytes` del manifiesto, que provienen de `Packages` autenticados por `InRelease` en PS-LAB-04.
- Un PASS formal futuro **tampoco autoriza** instalar ni modificar producción.

## 7. Nombres esperados en caché (derivados de C1 y del manifiesto, no ejecutados)

Calculados con la regla de C1 a partir de `manifest.proposed.json`. Atención: en 4 de 10 el nombre en caché **difiere** del nombre de archivo en el repositorio.

| Nombre esperado en `Dir::Cache::Archives` | Tamaño (bytes) | SHA-256 (manifiesto, prefijo) | ¿Difiere del nombre del repositorio? |
|---|---:|---|---|
| `nginx_1.24.0-2ubuntu7.19_amd64.deb` | 524,926 | `b9c3476a504c` | no |
| `nginx-common_1.24.0-2ubuntu7.19_all.deb` | 45,340 | `e105e2ea8029` | no |
| `age_1.1.1-1ubuntu0.24.04.3_amd64.deb` | 1,629,868 | `22ed034e16d8` | no |
| `acl_2.3.2-1build1.1_amd64.deb` | 39,398 | `0beec20d005b` | no |
| `mariadb-server-core_1%3a11.8.9+maria~ubu2404_amd64.deb` | 7,465,168 | `6b5bc12e0789` | **sí** (`mariadb-server-core_11.8.9+maria~ubu2404_amd64.deb`) |
| `mariadb-client-core_1%3a11.8.9+maria~ubu2404_amd64.deb` | 1,110,502 | `6c13673b21c2` | **sí** |
| `mariadb-common_1%3a11.8.9+maria~ubu2404_all.deb` | 4,082 | `29eeda5bc677` | **sí** |
| `liburing2_2.5-1build1_amd64.deb` | 21,092 | `c2aef62accee` | no |
| `libmariadb3_1%3a11.8.9+maria~ubu2404_amd64.deb` | 161,370 | `a73cfb1ea723` | **sí** |
| `mysql-common_5.8+1.1.0build1_all.deb` | 6,746 | `2a9ed286f4a7` | no |

Suma: 11,008,492 bytes, igual al total declarado. Los hashes completos están en el manifiesto.

## 8. Diferencias entre la prueba formal y el diagnóstico

| Aspecto | Formal (`--no-download`) | Diagnóstico (sin la opción) |
|---|---|---|
| Argumentos | idénticos + `--no-download` | base |
| Resolución | idéntica (H1-H3) | idéntica |
| Comprobación de caché de `.deb` | **Sí**, antes de simular (C5, C6) | **No** (C7) |
| Si faltan archivos | Error, exit 100, sin plan (H2) | Sin efecto, exit 0 |
| Qué prueba | Plan + disponibilidad local por nombre y tamaño | Solo plan |
| Valor para el criterio de aceptación | Es el criterio formal | Auxiliar |

## 9. Inventario de evidencias faltantes

"Requiere APT" indica que producirlo implica ejecutar APT y, por tanto, necesita autorización de fase.

| ID | Evidencia | Discrimina | Requiere APT |
|---|---|---|---|
| E1 | Versión y origen del paquete `apt`/`libapt-pkg` y hash del binario `apt-get` del laboratorio | A7 | No (`dpkg-query`, `sha256sum`) |
| E2 | Entorno exacto de ejecución (`APT_CONFIG`, variables, usuario efectivo, locale) y volcado de `apt-config dump` | A4 | Parcial |
| E3 | Listado con `stat` (nombre, tamaño, modo, propietario) de `Dir::Cache::Archives` y `partial/`, antes y después de cada corrida | A1, A2, A3, A5, A6 | No |
| E3-hist | Inventario **solo lectura** de las cachés históricas (`ps-apt-run1/cache/archives`, `run2`, y la del sistema) tal como están hoy, con fechas de modificación; es evidencia indirecta de lo que había en `run1` | A1 (histórica) | No |
| E4 | Los 10 nombres esperados (sección 7) y sus hashes de control | A2, A5 | No |
| E5 | Archivo de exit code por comando | H4 | No |
| E6 | Hash de índices, `lists/` y `sources.list` usados en cada run | A9 | No |
| E7 | `apt-cache policy` de los 10 paquetes bajo la misma configuración | A8 | Sí |
| E8 | Evidencia pasiva de ausencia de red (estado de interfaz, contadores `/proc/net/dev` antes y después) | no descarga | No |
| E9 | Una segunda ejecución formal independiente | reproducibilidad del bloqueo (hoy N=1) | Sí |
| E10 | Hash del `core.args` y del `preferences.core.candidate` usados | integridad de entradas | No |

## 10. Clasificación final de esta fase

- **Demostrado:** H1-H7 (evidencias) y C1-C13 (código de Ubuntu `2.7.14build2` y `2.8.4ubuntu0.1`, idénticos entre sí).
- **Inferido por acotamiento, sin lectura directa:** que `apt 2.8.3` se comporte igual (sección 3.2).
- **Inferido con alta consistencia, no confirmado:** que la causa próxima sea la comprobación de caché por nombre y tamaño y que la causa de fondo sea la ausencia de `.deb` (A1).
- **No demostrado:** cuál subcausa (A1-A7); la causa de la ejecución histórica; la versión exacta del APT del laboratorio; que no hubo tráfico de red (afirmación del operador); el contenido real de `Dir::Cache::Archives`.
- La hipótesis de ausencia de `.deb` sigue siendo **hipótesis no confirmada** como causa de la ejecución histórica; reproducir el fallo con caché vacía solo demostraría el mecanismo.
