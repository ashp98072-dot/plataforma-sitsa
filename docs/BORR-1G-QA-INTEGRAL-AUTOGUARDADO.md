# BORR-1g — QA integral de autoguardado, recuperación e idempotencia

**Estado: NO APROBADO PARA MERGE** mientras el hallazgo **F-02 (P1)** siga abierto (ver §9). El PR contiene solo pruebas y este expediente; **no se modificó ningún código productivo**.
Todo lo medido es **simulado** (happy-dom + fake-indexeddb + `fetch` simulado). **No hay validación en navegador real ni contra Hostinger.**

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
| **Nuevas (BORR-1g)** | `qa-integral-autoguardado.dom.test.ts` (68 pruebas: 21 escenarios × 3 módulos + 5 cruzadas), `qa-limites-lineas.dom.test.ts` (7: 6 pasan + 1 `fails` documentando F-02) |

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
| F Compras 500 (coherencia backend/adaptador/botón; 501 no se aplica a medias) | truncamiento | ✔ | — | — | **N** |
| F Fondos 39/40/41/101, #569 intacta | truncamiento | — | ✔ | — | E + **N** (estático) |
| F Gastos 101/250/1000 | truncamiento | — | — | ✔ | E + **N** |
| F clics simultáneos en el límite | truncamiento silencioso | **✘ F-02** | ✔ (#569) | n/a | **N** |
| G1–G5 cruzadas (3 módulos a la vez) | contaminación entre módulos | ✔ | ✔ | ✔ | **N** |
Los 3 módulos × (preferencia «no guardar», IndexedDB/cuota, borrador inválido, versión incompatible, error de persistencia) quedan cubiertos entre las columnas anteriores.

## 4. Resultados por módulo (Fases B–F, simulados)
Los 21 escenarios del driver (B/C/D/E) pasan en **Compras, Fondos y Gastos** (63/63) y se suman a las suites propias de cada módulo. Límites: ver §3 (F) y §9 (F-02).

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

## 8. Evidencia de idempotencia y no duplicación
Para los tres módulos (E1–E5): clave registrada antes del POST y coincidente con la enviada; 3 envíos simultáneos → 1 POST; IndexedDB roto → 0 POST; 5xx → congelado, reintento con **mismo cuerpo y misma clave**, éxito → borrador limpio; 409 conservado/liberado según contrato; recarga en estado incierto → 0 POST, clave y contenido intactos; conflicto con otra pestaña durante el envío → 0 POST. Gastos: creación confirmada + fallo del comprobante → el reintento solo sube el archivo (0 POST adicional; pruebas de BORR-1f).

## 9. Hallazgos
| ID | Sev. | Módulo | Descripción | Evidencia |
|---|---|---|---|---|
| **F-02** | **P1 (abierto)** | Compras | El botón «+ Agregar línea» solo se protege con `disabled`; `setLineas(a => [...a, …])` no tiene guarda funcional y `construirPayload` hace `slice(0, 500)`. Con varios clics en el mismo lote de eventos en la línea 499, la pantalla supera 500 líneas y el borrador guarda 500 mostrando «Guardado» (pérdida silenciosa; además el backend rechazaría >500). Fondos no lo sufre (#569 añadió la guarda). | `qa-limites-lineas.dom.test.ts` F6 (`it.fails`: el comportamiento correcto falla) y F6b (caracterización: pantalla > 500, guardadas = 500) |
| F-01 | P2 | Compras | El 409 de `POST /compras/requerimientos` mezcla ConflictoIdempotencia, factura duplicada y bloqueo concurrente; BORR-1d lo trata como rechazo definitivo (libera el intento conservando la clave). No hay duplicación posible (el servidor protege la clave) pero un 409 por clave ya usada no pasa a «reconciliación». | E4 (Compras) |
| F-03 | P3 | Los 3 | Las comprobaciones son simuladas; `console` y tiempos de las pruebas pesadas (500 líneas) dependen de la carga. | — |
**Nota de alcance de F-02:** en un navegador real React vacía los eventos discretos de forma síncrona entre clics, de modo que un doble clic humano probablemente ya vea el botón deshabilitado; la prueba lo reproduce con eventos agrupados (`act`). Sigue siendo un camino de truncamiento silencioso en el adaptador, de ahí P1 hasta decidir. **No se corrigió aquí (el PR es solo QA).** Ticket separado propuesto: guarda funcional en Compras (`actual.length >= 500 ? actual : [...]`) y, de forma defensiva, que `construirPayload` no recorte (error visible en su lugar), con prueba que invierta F6.

## 10. Limitaciones y pruebas no ejecutadas
- Sin navegador real: existe el panel de navegador del entorno, pero no hay un servidor de la aplicación con base de datos de prueba y sesión disponibles para esta tarea (y está prohibido usar producción); por eso **no se afirma validación de navegador real**. Pendiente: prueba manual de dos pestañas reales, cierre de sesión real y `BroadcastChannel` real.
- Sin pruebas contra MariaDB ni Hostinger; el backend se leyó (contratos) pero no se ejecutó.
- Los escenarios con `fabricaCanal: null` validan el control definitivo por CAS, no el aviso por BroadcastChannel (cubierto aparte en las pruebas del núcleo).
- Fondos y Compras no se probaron con 1000 líneas en DOM (coste); sí con 101 (Fondos), 499/500 (Compras) y 1000 en puras (Gastos).
- Sin pruebas de rendimiento ni de accesibilidad; IndexedDB no cifra (limitación de diseño documentada).

## 11. Riesgos residuales
F-02 abierto; reconciliación manual tras recargar en estado incierto (no existe consulta por clave en ninguna API); posible cierre de pestaña entre la creación confirmada y marcarla completada; el comprobante de Gastos no sobrevive a una recarga (por diseño); dependencia de timeouts en entornos cargados.

## 12. Recomendación técnica
1. **No aprobar BORR-1g para merge** hasta decidir F-02: abrir un ticket de corrección separado para Compras (guarda funcional + no truncar en silencio) y, tras él, invertir la prueba F6/F6b.
2. Evaluar F-01 (distinguir el 409 de idempotencia del de factura duplicada, p. ej. con un código de error estable en la respuesta) en una fase con autorización de cambio de API.
3. Antes de producción: prueba manual en navegador real y propuesta de un endpoint de consulta por clave para reconciliar envíos inciertos.
4. No iniciar otra fase de desarrollo sin autorización.
