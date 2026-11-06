# BORR-1g — QA integral de autoguardado, recuperación e idempotencia

**Estado actual: CERRADO CON RIESGOS DOCUMENTADOS** (tras BORR-1d-FIX-01 / PR #571 y BORR-1g-CIERRE-FIX-01). No hay hallazgos P0/P1 abiertos ni defectos funcionales conocidos de pérdida silenciosa o duplicación. Los riesgos residuales están en §11. El PR original (#570) contiene solo pruebas y este expediente; **ningún cambio de BORR-1g modifica código productivo**.
Todo lo medido es **simulado** (happy-dom + fake-indexeddb + `fetch` simulado). **No hay validación en navegador real ni contra Hostinger** (pendiente, ver §10).

> *Trazabilidad histórica.* La primera versión de este expediente (PR #570, SHA `5c2d61e6`) declaró **NO APROBADO PARA MERGE** por el hallazgo F-02 (P1), reproducido entonces con las pruebas F6 (`it.fails`) y F6b (caracterización). #571 lo corrigió; las pruebas F2/F6/F6b se convirtieron en pruebas positivas en BORR-1g-CIERRE-FIX-01 y la carrera de E3 se estabilizó. Las cifras de §7 conservan la medición original; el estado actual de la comparación se añade en §7b.

## 1. SHA base
`0ca4036d538ca23c17ca11a67b80a7ea3110d19d` (merge de #569), comprobado como HEAD real de `origin/main` antes de crear la rama `feature/borr-1g-qa-integral-autoguardado`.

## 2. Inventario (Fase A)
| Pieza | Archivos |
|---|---|
| Núcleo y controles de concurrencia | `src/lib/borradores/{nucleo,controlador,almacen-indexeddb,coordinacion,canal,payload,estado-guardado}.ts` (CAS por revisión, marca/época de purga, un solo guardado en vuelo, BroadcastChannel solo avisa) |
| Hook / UI compartida | `use-borrador-local.ts`, `src/components/borradores/*` |
| Compras | `requerimiento-form-client.tsx`, `requerimiento-autoguardado.tsx`, adaptador `requerimiento-borrador.ts`, envío `requerimiento-borrador-envio.ts`; POST `/compras/requerimientos` (clave `clave_idempotencia`, máx. 500 líneas) |
| Fondos | `fondos/page.tsx`, `fondo-autoguardado.tsx`, `fondo-borrador.ts`, `fondo-borrador-envio.ts`; POST `/tms/fondos` (`claveIdempotencia`, **máx. 40**) |
| Gastos | `gastos/page.tsx`, `gasto-autoguardado.tsx`, `gasto-borrador.ts`, `gasto-borrador-envio.ts`, `gastos-envio-cliente.ts` (crear + comprobante); POST `/tms/gastos` (sin tope de líneas) |
| Suites existentes | 15 de núcleo (`src/lib/borradores`, `src/components/borradores`), DOM de los 3 módulos (31 / 39 / 34), puras (`requerimiento-borrador` 14, `fondo-borrador` 13, `gasto-borrador` 13), idempotencia, `errores-formulario`, `formularios-wiring` |
| **Nuevas (BORR-1g)** | `qa-integral-autoguardado.dom.test.ts` (68 pruebas: 21 escenarios × 3 módulos + 5 cruzadas), `qa-limites-lineas.dom.test.ts` (7, todas positivas; F2/F6/F6b reescritas tras #571, sin `it.fails`) |

**Contratos de idempotencia revisados:** Compras — clave opcional en backend, misma clave+mismo contenido → original, distinto → 409; **el 409 de Compras también significa factura duplicada o bloqueo concurrente (nada se creó)**. Fondos/Gastos — mismo contrato; el 409 de POST es siempre `ConflictoIdempotencia`. Gastos: crear y subir el comprobante son operaciones distintas.

## 3. Matriz de cobertura
Leyenda: **E** = ya existía (BORR-1d/1e/1f/núcleo), **N** = nueva en 1g (los tres módulos con el mismo escenario), ✔ pasa.
| Esc. | Riesgo | Compras | Fondos | Gastos | Origen |
|---|---|---|---|---|---|
| B1 formulario vacío / abrir-cerrar | borradores innecesarios | ✔ | ✔ | ✔ | E + **N** (B1) |
| B2 autoguardado | pérdida | ✔ | ✔ | ✔ | E |
| B3 ediciones consecutivas → última versión | versión intermedia final | ✔ | ✔ | ✔ | **N** |
| B4–B6 cerrar/reabrir, recargar, recuperar voluntaria | restauración automática | ✔ | ✔ | ✔ | E (+ 25/32) |
| B7/B13 recuperar sobre lo recién capturado, rechazar | sobrescritura | ✔ | ✔ | ✔ | E + **N** |
| B8 descartar con confirmación | borrado accidental | ✔ | ✔ | ✔ | E |
| B9–B10 valores exactos y orden de líneas | precisión / orden | ✔ | ✔ | ✔ | E + pruebas puras |
| B11 catálogos revalidados | selección obsoleta enviada | ✔ | ✔ | ✔ | E |
| B12 payload dañado / versión futura | restauración parcial | ✔ | ✔ | ✔ | E (dañado) + **N** (futura) |
| B14 almacenamiento falla → sin falso «Guardado» | persistencia falsa | ✔ | ✔ | ✔ | E + **N** (B14, B14b) |
| B15 payload excesivo | pérdida / falso guardado | ✔ | ✔ | ✔ | E (F/G) + **N** (Compras) |
| C1 pestaña antigua tras descarte | resurrección | ✔ | ✔ | ✔ | **N** |
| C2 ediciones simultáneas / divergentes / remota inválida | sobrescritura silenciosa | ✔ | ✔ | ✔ | E + **N** |
| C3 conflicto durante un envío | POST con borrador divergente | ✔ | ✔ | ✔ | **N** |
| C4/C5 guardado tardío tras logout y tras purga | resurrección | ✔ | ✔ | ✔ | E + **N** |
| D1 usuario/empresa distintos | exposición cruzada | ✔ | ✔ | ✔ | E + **N** |
| D2 sin secretos en IndexedDB; autoguardado sin backend | fuga | ✔ | ✔ | ✔ | **N** (volcado crudo de IndexedDB) |
| D3 sesión expirada durante el envío (401) | borrado/duplicación | ✔ | ✔ | ✔ | E + **N** |
| D4 logout sin purga | pérdida | ✔ | ✔ | ✔ | **N** |
| E1 registro previo, clave válida, doble clic | duplicación | ✔ | ✔ | ✔ | E + **N** |
| E2 fallo al persistir el intento → sin POST | duplicación | ✔ | ✔ | ✔ | E + **N** |
| E3 incierto: congelado, misma clave y cuerpo, limpia al confirmar | duplicación / pérdida de clave | ✔ | ✔ | ✔ | E + **N** |
| E4 409 según contrato | reintento inseguro / bloqueo incorrecto | ✔ (ver F-01) | ✔ | ✔ | **N** |
| E5 recarga durante estado incierto: 0 POST | duplicación | ✔ | ✔ | ✔ | E + **N** |
| Gastos: creado + comprobante falla → reintento solo sube | segundo gasto | — | — | ✔ | E (BORR-1f) |
| F Compras 500 (coherencia backend/adaptador/botón; 501 y 600 se restauran íntegras pero no son enviables) | truncamiento | ✔ | — | — | **N** |
| F Fondos 39/40/41/101, #569 intacta | truncamiento | — | ✔ | — | E + **N** (estático) |
| F Gastos 101/250/1000 | truncamiento | — | — | ✔ | E + **N** |
| F clics simultáneos en el límite | truncamiento silencioso | ✔ (F-02 resuelto por #571) | ✔ (#569) | n/a | **N** |
| G1–G5 cruzadas (3 módulos a la vez) | contaminación entre módulos | ✔ | ✔ | ✔ | **N** |
Los 3 módulos × (preferencia «no guardar», IndexedDB/cuota, borrador inválido, versión incompatible, error de persistencia) quedan cubiertos entre las columnas anteriores.

## 4. Resultados por módulo (Fases B–F, simulados)
Los 21 escenarios del driver (B/C/D/E) pasan en **Compras, Fondos y Gastos** (63/63) y se suman a las suites propias de cada módulo. Límites: ver §3 (F) y §9.

## 5. Resultados cruzados (Fase G, 5/5)
G1 tres borradores coexisten con identidades distintas · G2 recuperar uno no escribe en los otros y descartar uno conserva los demás (revisiones intactas) · G3 enviar Gastos no limpia ni altera Compras/Fondos (0 POST ajenos) · G4 cambiar de empresa aísla los tres · G5 la purga elimina los tres y las pestañas vivas no los recrean.

## 6. Pruebas de mutación (todas detectadas)
| Riesgo | Mutación aplicada al código productivo | Detectada por |
|---|---|---|
| Truncamiento | `slice(0,100)` en Fondos / en Gastos | puras, QA-F (F3/F4), DOM de líneas (4 y 4 pruebas) |
| Duplicación | no registrar el intento antes del POST | E1/E2 × 3 módulos, puras, DOM de cada módulo |
| Pérdida de clave | `adoptarClave` siempre falso / liberar el intento borra la clave | puras, DOM de reutilización de clave, 401 × 3 |
| Aislamiento | la clave del borrador ignora la empresa | núcleo (3), D1, DOM «otra empresa» |
| Falso «Guardado» | tras un error de escritura se despacha `guardado_ok` | B14, B14b y B15 × 3 módulos |
| Clasificación | 409 definitivo en Gastos | puras + E4 |

## 7. Comparación contra `main` (suite completa)
`main` limpio (`0ca4036d`) **35 fallos / 14342 pruebas / 1009 omitidas**; rama **35 / 14417 / 1009**. Conjuntos de fallos **idénticos** (0 exclusivos de la rama, 0 exclusivos de `main`); +75 pruebas nuevas (68 + 7, de ellas 1 `fails` esperado). Los 35 son heredados (guardas de diff RRHH/SQL, `flota/cb2`, `factura-emitida`, pricesmart, etc.; varios intermitentes por timeouts bajo carga); ninguno atribuible a esta rama.
Clasificación: *heredados* — guardas que comparan contra SHAs antiguos; *intermitentes* — `flota/cb2/*` (timeouts de 5 s, pasan en aislado en `main` y en la rama, evidencia de BORR-1e/1f); *regresiones de la rama* — ninguna; *defectos de prueba* — ninguno abierto. No se declara «sin regresiones» por un pase aislado: se comparó el conjunto completo bajo la misma carga.

## 7b. Comparación posterior a #571 y al cierre
Medición sobre `0862cdcf` (HEAD tras #569–#571) contra `59aef47a` (antes de #569), misma carga: 35 → 41 fallos. Los 6 adicionales se explican por nombre y causa: 3 pruebas obsoletas F2/F6/F6b (F-04, **defecto de prueba**, determinista), E3 de Compras (F-05, **defecto de prueba**, carrera, pasa 3/3 en aislado) y 2 de `flota/cb2` (`consumos-registrados`, `pilotos-automaticos`: **intermitentes** por carga, `STACK_TRACE_ERROR`, pasan 8/8 en aislado en ambas ramas). 0 fallos exclusivos de la base. Ningún **defecto funcional** ni regresión de producción. Los 35 restantes son heredados (guardas de diff RRHH/SQL, etc.). Tras BORR-1g-CIERRE-FIX-01 se eliminan los 4 defectos de prueba; los 2 intermitentes de `flota/cb2` no pertenecen a este frente.

## 8. Evidencia de idempotencia y no duplicación
Para los tres módulos (E1–E5): clave registrada antes del POST y coincidente con la enviada; 3 envíos simultáneos → 1 POST; IndexedDB roto → 0 POST; 5xx → congelado, reintento con **mismo cuerpo y misma clave**, éxito → borrador limpio; 409 conservado/liberado según contrato; recarga en estado incierto → 0 POST, clave y contenido intactos; conflicto con otra pestaña durante el envío → 0 POST. Gastos: creación confirmada + fallo del comprobante → el reintento solo sube el archivo (0 POST adicional; pruebas de BORR-1f).

## 9. Hallazgos (estado final)
| ID | Sev. | Módulo | Estado | Descripción y evidencia |
|---|---|---|---|---|
| F-01 | P2 | Compras | **PENDIENTE NO BLOQUEANTE** | El 409 de `POST /compras/requerimientos` tiene **cuatro causas** en `guardarRequerimiento`: (1) factura repetida dentro del propio payload; (2) factura duplicada contra la BD; (3) bloqueo concurrente del proveedor («otra operación en curso»); (4) `ConflictoIdempotencia` (la clave ya se usó con otro contenido). En (1)–(3) el INSERT se revierte y no se crea nada: tratarlo como rechazo definitivo (libera el intento conservando la clave) es correcto. Solo (4) significa que ya existe un documento con esa clave; el servidor lo resuelve **antes** de cualquier otra comprobación y su mensaje indica «Revisa el listado antes de volver a intentarlo». No se encontró un camino de interfaz que lo alcance: tras una respuesta incierta el contenido queda congelado, tras recargar el envío se bloquea, y la revisión compartida (CAS) del borrador impide que una segunda pestaña envíe otro contenido con la misma clave. **No hay pérdida ni duplicación posibles** (el servidor protege la clave). Condición: si la migración de idempotencia de Compras no estuviera aplicada, el servidor opera en modo legado y un reintento tras una creación confirmada da 409 «factura duplicada» (sin duplicación por sí solo; es una limitación de esa migración, no de este cambio). Corregirlo exigiría un código de error estable en la API (cambio de contrato, fuera de alcance). Evidencia: E4 (Compras) caracteriza el comportamiento actual. |
| F-02 | P1 | Compras | **RESUELTO** por PR #571 (BORR-1d-FIX-01) | Guarda funcional en `setLineas`, sin `slice`, borrador heredado de >500 líneas recuperado íntegro con envío bloqueado. Evidencia: `requerimiento-limite-lineas.dom.test.ts` (5 mutaciones detectadas) y, en este expediente, F2/F6/F6b ahora positivas: tres clics agrupados desde 499 → exactamente 500 y botón deshabilitado; líneas persistidas = líneas del formulario (mismo contenido y orden); 501 y 600 se restauran íntegras pero no son enviables. |
| F-03 | P3 | Los 3 | **RESIDUAL** | Las pruebas pesadas (500 líneas) y algunas ajenas (`flota/cb2`) fallan por timeout bajo carga y pasan en aislado en `main` y en la rama. |
| F-04 | — | Pruebas | **RESUELTO** | F2, F6 y F6b de `qa-limites-lineas.dom.test.ts` describían el defecto F-02 ya corregido y fallaban siempre en `main` tras fusionar #571 antes que #570. Reescritas como pruebas positivas; sin `it.fails`. |
| F-05 | — | Pruebas | **RESUELTO** | E3 (Compras) leía `fieldset.disabled` y `estadoEnvio` inmediatamente tras aparecer el aviso de reconciliación (carrera de un render/transacción); ahora usa `hasta(...)`. Se mantienen todas las comprobaciones funcionales. |
**Reconciliación manual tras una respuesta incierta (comportamiento implementado en los tres módulos).** Ninguna API ofrece consulta por clave. Si el resultado de un envío es incierto (red, 5xx, 408/425/429 y, en Fondos/Gastos, 409): en la misma página se puede reintentar **exactamente el mismo contenido con la misma clave** (el servidor devuelve la creación original); tras recargar, el borrador queda en «reconciliación pendiente»: no se puede recuperar ni descartar y **no se envía otro documento**; el usuario debe revisar el listado para saber si la operación se creó. Hasta que exista un endpoint de consulta por clave, ese borrador no se libera.

## 10. Limitaciones y pruebas no ejecutadas
- Sin navegador real: existe el panel de navegador del entorno, pero no hay un servidor de la aplicación con base de datos de prueba y sesión disponibles para esta tarea (y está prohibido usar producción); por eso **no se afirma validación de navegador real**. Pendiente: prueba manual de dos pestañas reales, cierre de sesión real y `BroadcastChannel` real.
- Sin pruebas contra MariaDB ni Hostinger; el backend se leyó (contratos) pero no se ejecutó.
- Los escenarios con `fabricaCanal: null` validan el control definitivo por CAS, no el aviso por BroadcastChannel (cubierto aparte en las pruebas del núcleo).
- Fondos y Compras no se probaron con 1000 líneas en DOM (coste); sí con 101 (Fondos), 499/500 (Compras) y 1000 en puras (Gastos).
- Sin pruebas de rendimiento ni de accesibilidad; IndexedDB no cifra (limitación de diseño documentada).

## 11. Riesgos residuales
F-01 (409 de Compras, P2, sin pérdida ni duplicación); reconciliación manual tras recargar en estado incierto (no existe consulta por clave en ninguna API); posible cierre de pestaña entre la creación confirmada y marcarla completada; el comprobante de Gastos no sobrevive a una recarga (por diseño); dependencia de timeouts en entornos cargados.

## 12. Recomendación técnica
1. **BORR-1g puede considerarse cerrado con riesgos documentados.** «Cerrado» no equivale a aprobación para producción ni a un despliegue autorizado.
2. Antes de producción: prueba manual en navegador real (dos pestañas, cierre de sesión real, `BroadcastChannel`, almacenamiento lleno) y verificar en Hostinger el estado de las migraciones de idempotencia.
3. Futuro, con autorización de cambio de API: endpoint de consulta por clave para liberar la reconciliación manual y un código de error estable para distinguir el 409 de idempotencia en Compras (F-01).
4. No iniciar otra fase de desarrollo sin autorización.
