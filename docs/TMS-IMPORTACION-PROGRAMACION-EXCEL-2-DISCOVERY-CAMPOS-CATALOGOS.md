# TMS — Importación masiva de Programación — Discovery de campos y catálogos de referencia (ajuste de alcance PR 2)

Estado: **discovery adicional. Sin código, sin rama, sin PR.** Responde al pedido de ampliar la plantilla con hojas de catálogo de referencia (`Vehiculos`, `Empleados`, `Clientes`, `Rutas`, `Instrucciones`) generadas dinámicamente, antes de tocar el parser.
Base: `main = bf25b3e11ecf50499af934735985505ea25b02f3` (confirmado exacto y sin drift antes de este discovery).
No se tocó `src/lib/rrhh/catalogos-nomina.ts`, no se tocó BD/esquema, no se crean planes.

---

## 1. Listado exacto de campos actuales de Programación (formulario + API)

Fuente: `schema` (Zod) de `POST`/`PATCH` en [planes/route.ts](../src/app/api/empresas/[slug]/tms/planes/route.ts:446) + el formulario real [plan-form.tsx](../src/app/e/[slug]/programacion/plan-form.tsx) + [ruta-defaults.ts](../src/lib/tms/ruta-defaults.ts) (qué se auto-copia al elegir una ruta).

| Campo (API) | Se captura hoy en el form manual | Clasificación para el Excel |
|---|---|---|
| `codigo` | No — lo genera el sistema (`PLAN-YYYYMMDD-###`) | **Interno.** Nunca en Excel (ya confirmado). |
| `fechaPlan` | Sí, campo de fecha | **Va en Excel** — "Fecha salida". |
| `horaCarga` | Sí, `Hora12Input` | **Va en Excel** — "Hora salida". |
| `tipoTraslado` | Sí, `<input>` de texto libre (sin catálogo cerrado, verificado: no hay `<select>`, es un input plano con placeholder "Ej. Carga completa, paquetería…") | **Va en Excel** — "Tipo traslado", texto libre (no hay lista cerrada que ofrecer como dropdown — ver §6). |
| `regresoEstimado` | Sí, `FechaHora12Input` | **Va en Excel** — "Fecha regreso estimado" + "Hora regreso estimado". |
| `tarifaComercial` | Sí, se autosugiere desde la tarifa predeterminada de la ruta si está vacío (`aplicarDefaultsRutaSinSobrescribir`), editable | **Va en Excel** — "Tarifa GTQ", pero **contrastada** contra la tarifa vigente del sistema (regla ya aprobada: diferencia = error bloqueante). |
| `tarifaId` | Se resuelve internamente al elegir una opción de tarifa del catálogo de la ruta | **Derivado automáticamente** — el importador resuelve la tarifa predeterminada activa de la ruta server-side; no se expone en Excel. |
| `costoOperativoReferencia` | **NO** — confirmado en el código: "TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que 'costo operativo' ya no se utiliza". El campo sigue existiendo en la API por compatibilidad histórica, pero ningún flujo activo lo captura ni lo copia. | **Queda fuera.** Campo muerto, no se reintroduce en el importador. |
| `referenciaCliente` | Existe en la API pero no localicé un input visible correspondiente en el flujo estándar del formulario (campo opcional, `max(160)`, uso puntual) | **Queda fuera de V1** — no estaba en la plantilla original aprobada, no lo agrego para no inventar alcance; si lo necesitas lo agregamos en una fase futura explícita. |
| `notas` | Sí, texto libre | **Va en Excel** — "Observaciones". |
| `clienteId` | Se resuelve internamente al elegir la ruta (`tms_cliente_rutas.cliente_id`) | **Derivado automáticamente** de "Código ruta" — nunca se busca por nombre/NIT (regla ya aprobada). |
| `clienteNombre` | Se autocompleta al elegir ruta, editable | **Va en Excel, pero SOLO como contraste** — "Cliente" (NIT si el cliente de la ruta lo tiene, si no nombre normalizado con advertencia). No decide el `clienteId`. |
| `placa` | Sí, texto (autocompletar con sugerencia de unidad recurrente de la ruta si está vacío) | **Va en Excel** — "Placa". |
| `pilotoNombre` / `auxiliarNombre(s)` (texto libre, personal sin vínculo RRHH) | Sí, como *fallback* cuando no hay `empleadoId` | **Queda fuera del Excel** — el importador NUNCA crea personal nuevo (regla ya aprobada), así que el camino "nombre libre" no aplica aquí; solo se acepta código de empleado existente. |
| `pilotoEmpleadoId` | Sí, selector vinculado a RRHH | **Va en Excel** — "Código piloto" (`empleados.codigo`). |
| `auxiliarEmpleadoId(s)` | Sí, hasta 8 en el sistema, aunque el form típico maneja pocos | **Va en Excel** — "Código auxiliar 1" / "Código auxiliar 2" (2 columnas, igual que la plantilla ya aprobada — el sistema soporta más, pero el Excel V1 se queda en 2 como ya se definió). |
| `lugarCarga` / `lugarDescarga` (arman las paradas Carga/Descarga si no viene `paradas[]`) | Se autocompletan SIEMPRE al elegir la ruta (`ruta.destinoDescripcion`/lugar de carga), editable | **Derivado automáticamente** de "Código ruta" — no hay columna en Excel; el importador copia exactamente lo que copiaría el formulario manual al elegir esa ruta. |
| `paradas[]` (estructuradas, hasta 20, con `tipo`/`requiereEvidencia`) | Se arma automáticamente (Carga + Descarga) al elegir ruta si el usuario no agregó paradas manuales | **Derivado automáticamente** — mismo criterio, 2 paradas (Carga/Descarga) generadas desde la ruta. No hay UI de paradas múltiples en el importador V1 (fuera de alcance; el 99% de los viajes manuales tampoco las usan más allá de las 2 automáticas). |
| `rutaId` | Sí, selector de ruta | **Va en Excel** — "Código ruta" (el identificador maestro). |
| `rutaCodigo` (historico, snapshot) | Se copia automáticamente al elegir la ruta (`ruta.codigo`) | **Derivado automáticamente** — es el mismo código que ya viene en la columna "Código ruta"; se congela como snapshot al crear el plan. |
| `lugarDescargaHistorico` | Se copia automáticamente al elegir la ruta (`ruta.destinoDescripcion`) — **confirmado que se sobrescribe siempre**, a diferencia de piloto/auxiliares que solo se sugieren si están vacíos | **Derivado automáticamente.** |
| `contactoNombreHistorico` / `contactoCargoHistorico` / `contactoTelefonoHistorico` | Se copian automáticamente al elegir la ruta (contacto asociado) | **Derivado automáticamente.** |
| `viaticosAsignados[]` | Se arma automáticamente para piloto + cada auxiliar CON vínculo RRHH, usando el monto por defecto configurado por puesto (`tms_viaticos_config`, editable en el form pero con el sugerido ya precargado) | **Derivado automáticamente** — ver §5, no hay columna de monto de viático en el Excel V1. |
| `estado` | No es un campo de creación — todo plan nuevo nace `'Programado'` (hardcodeado en el `INSERT`) | **Interno.** |

### Campo que preguntaste explícitamente y **no existe**: "días de ruta"

Revisé `tms_cliente_rutas`, el resto del esquema TMS y el formulario de Programación/Rutas: **no existe ningún concepto de "días de la semana" o recurrencia programada** (ni columna `dias_semana`, ni `frecuencia`, ni nada equivalente). Cada plan/viaje es un evento puntual con su propia fecha; no hay programación recurrente semanal en el sistema hoy. No es algo que pueda derivar ni inventar — si lo necesitas, sería una funcionalidad nueva fuera del alcance de esta importación.

---

## 2. Esquema final propuesto de hojas del Excel

```
Programacion    -> los 13 campos ya aprobados, una fila = un viaje a crear.
Rutas           -> catálogo de referencia (solo lectura).
Vehiculos       -> catálogo de referencia (solo lectura).
Empleados       -> catálogo de referencia (solo lectura).
Clientes        -> catálogo de referencia (solo lectura).
Instrucciones   -> guía de llenado (mismo rol que "AYUDA" en el importador de Rutas).
```

Orden de tabs sugerido: `Programacion` primero (la hoja de trabajo), luego los 4 catálogos, `Instrucciones` al final — igual jerarquía visual que espera un usuario que ya conoce el importador de Rutas (dato de trabajo primero, ayuda al final).

**Nunca son fuente de verdad al importar.** El parser (PR 2, este PR) NO lee `Rutas`/`Vehiculos`/`Empleados`/`Clientes` en absoluto — solo lee `Programacion`. Esas 4 hojas existen exclusivamente para que Excel les muestre al usuario, al momento de llenar, qué códigos/placas/nombres son válidos HOY — nunca se reenvían al backend ni se usan para nada en el parser o en la futura validación (PR 4/5), que siempre revalida contra BD fresca. Si el usuario edita/borra/inventa datos en esas 4 hojas, esa edición no tiene ningún efecto: el backend solo lee la hoja `Programacion`.

---

## 3. Columnas de `Programacion` (sin cambios — confirmado que no hay que inventar ninguna)

Las 13 columnas siguen siendo exactamente las ya aprobadas — el repaso de campos de §1 no encontró ningún campo activo del formulario manual que debiera agregarse como columna nueva (lugar de descarga, contactos y paradas se derivan de la ruta; viáticos se derivan del puesto; costo operativo está muerto; referenciaCliente no estaba en el alcance aprobado):

1. `Fecha salida`
2. `Hora salida`
3. `Código ruta`
4. `Cliente` (NIT si el cliente de la ruta lo tiene registrado; si no, nombre — solo contraste)
5. `Código piloto`
6. `Placa`
7. `Código auxiliar 1`
8. `Código auxiliar 2`
9. `Tipo traslado`
10. `Tarifa GTQ`
11. `Fecha regreso estimado`
12. `Hora regreso estimado`
13. `Observaciones`

---

## 4. Columnas de cada hoja catálogo

Cada catálogo expone **solo registros válidos/activos según las mismas reglas que ya usa Programación hoy** — nunca inactivos, nunca de otra empresa.

### `Rutas` (fuente: `tms_cliente_rutas`, `activo = 1`, de la empresa actual)

| Columna | Origen |
|---|---|
| Código ruta | `tms_cliente_rutas.codigo` |
| Nombre / descripción | `tms_cliente_rutas.nombre` |
| Cliente | nombre del cliente asociado (`tms_clientes.nombre` vía `cliente_id`) |
| NIT del cliente | `tms_clientes.nit` (puede venir vacío — el usuario verá directamente si esa ruta tiene NIT o no, para saber qué escribir en la columna "Cliente" de `Programacion`) |
| Tarifa vigente (Q) | monto de la tarifa predeterminada activa (`tarifasActivasDeRuta`/`tarifa_referencia` sincronizado) — el mismo valor contra el que se contrastará bloqueantemente la columna "Tarifa GTQ" |
| Destino habitual | `tms_cliente_rutas.destino_descripcion` (referencia informativa, ayuda a confirmar que es la ruta correcta) |

Esta hoja es la que más reduce errores: el usuario ve, antes de escribir nada, exactamente qué tarifa espera el sistema para esa ruta — la misma que después se validará de forma bloqueante.

### `Vehiculos` (fuente: `listarDisponibilidadVehiculos`, mismo criterio que ya usa Programación)

| Columna | Origen |
|---|---|
| Placa | `placa` |
| Marca / Modelo | `marca`, `modelo` |
| Estado actual | `estadoDisponibilidad` (disponible / en_taller / en_ruta / inactivo) — **a título informativo**: la disponibilidad real se revalida en el momento de importar, no en el momento de descargar la plantilla (puede cambiar entre ambos momentos, ver riesgos §7) |
| Propia / compartida | `esPropio` → "Propia" / empresa dueña si es compartida |

Se filtra a `activo = true` (se excluyen inactivas) pero **se incluyen las que están "en_ruta"/"en_taller" en este momento**, marcadas como tal — excluirlas del catálogo sería engañoso, porque para cuando el usuario suba el archivo esa unidad puede estar libre. La columna "Estado actual" dejará claro que es una fotografía del momento de la descarga, no una garantía.

### `Empleados` (fuente: `empleados`, `estado = 'Activo'`, de la empresa actual)

| Columna | Origen |
|---|---|
| Código | `empleados.codigo` |
| Nombre | `empleados.nombre` |
| Categoría operativa | `empleados.categoria_ops` (Piloto / Auxiliar / Bodega / Administrativo / Otro) |

**Hallazgo a confirmar contigo:** `personalDesdeEmpleado` (la función que resuelve piloto/auxiliar) **no filtra por `categoria_ops`** — hoy, técnicamente, el código de CUALQUIER empleado activo (incluso "Bodega" o "Administrativo") es aceptado como piloto o auxiliar si alguien lo escribe, tanto en el formulario manual como en el futuro importador (mismo comportamiento, no lo cambio aquí porque sería alterar una regla de negocio existente sin autorización). Para que el catálogo de referencia sea realmente útil y no ruidoso, propongo **filtrar la hoja `Empleados` a `categoria_ops IN ('Piloto', 'Auxiliar')`** — es una curación de la hoja de ayuda únicamente, no una validación nueva del importador ni un cambio de la regla real del sistema. Confírmame si prefieres mostrar TODOS los empleados activos en su lugar (más fiel al comportamiento real, pero menos útil para llenar la plantilla).

### `Clientes` (fuente: `tms_clientes`, `estado = 'Activo'`, de la empresa actual)

| Columna | Origen |
|---|---|
| Nombre | `tms_clientes.nombre` |
| NIT | `tms_clientes.nit` (puede venir vacío) |

Ayuda a que el usuario copie el NIT/nombre exacto que espera el sistema para la columna "Cliente" de `Programacion` — no se usa para resolver nada, solo para reducir el error de tipeo que dispararía el error bloqueante de contraste.

### `Instrucciones`

Mismo rol que la hoja "AYUDA" del importador de Rutas (que sí soporta hoy este patrón — confirmado leyendo `rutas-import-excel.ts`): tabla `Campo` / `Qué debe escribir`, cubriendo las 13 columnas, más:
- formatos de fecha/hora aceptados (`YYYY-MM-DD`, hora 24h `HH:mm` o 12h `hh:mm AM/PM`);
- aviso explícito: "Código ruta, Código piloto, Código auxiliar y Placa deben existir previamente en el sistema — esta importación **nunca crea** rutas, clientes, empleados, pilotos, auxiliares ni unidades nuevas";
- aviso: "una misma ruta puede repetirse varias veces con pilotos/unidades diferentes";
- aviso: "las hojas Rutas/Vehiculos/Empleados/Clientes son solo de referencia — editarlas no tiene ningún efecto, el sistema siempre revalida contra la base de datos real al importar";
- aviso: "la columna Cliente es de contraste — el cliente real del viaje lo determina el Código ruta, no lo que escriba aquí".

---

## 5. Viáticos: qué entra exactamente

**Ninguna columna de viático en `Programacion` para V1.** Confirmado en el formulario manual: al crear un plan, el monto de viático de piloto/cada auxiliar se deriva SIEMPRE del monto por defecto configurado por puesto (`tms_viaticos_config`, una fila por `puesto` — "Piloto"/"Auxiliar" — por empresa), aplicado automáticamente vía `viaticosAsignados`/`sincronizarViaticosPlan`. El formulario manual muestra ese sugerido con opción de editarlo antes de guardar, pero **nada obliga a especificarlo** — si no se manda, igual se aplica el default.

Para el importador: cada plan creado por Excel recibirá el viático por defecto de su puesto exactamente igual que si se hubiera creado a mano sin tocar el campo de monto — **no hay override por fila en el Excel V1** (no estaba en las 13 columnas aprobadas y agregarlo ahora sería ampliar alcance sin que lo hayas pedido). Si más adelante quieres poder overridear el viático por fila, es un cambio de alcance a decidir explícitamente en una fase futura.

---

## 6. Listas desplegables (data validation) propuestas

Técnicamente viable con ExcelJS via **rangos con nombre (named ranges) a nivel de libro**, no fórmulas de lista inline — es el patrón más confiable para validación cruzada de hojas (ver riesgos §7):

| Columna en `Programacion` | Lista desplegable desde | Rango con nombre propuesto |
|---|---|---|
| Código ruta | `Rutas!A` (columna Código) | `LISTA_RUTAS` |
| Placa | `Vehiculos!A` (columna Placa) | `LISTA_PLACAS` |
| Código piloto | `Empleados!A` (columna Código, filtrado a categoría Piloto si aplicamos el filtro de §4) | `LISTA_PILOTOS` |
| Código auxiliar 1 / 2 | `Empleados!A` (columna Código, filtrado a categoría Auxiliar) | `LISTA_AUXILIARES` |

**No propongo dropdown para "Cliente"** — es una columna de contraste (NIT o nombre, cualquiera de los dos es válido según lo que tenga el cliente), forzar una lista ahí sería más confuso que útil. **No propongo dropdown para "Tipo traslado"** — confirmado en §1 que no existe ningún catálogo cerrado de tipos en el sistema hoy; inventar una lista cerrada aquí sería inventar una regla de negocio que no existe.

El **dropdown es solo una ayuda de UX en Excel** — el parser (y más adelante el backend) nunca confían en que el valor tecleado provenga de la lista; se valida igual como si no existiera el dropdown (el usuario puede pegar un valor a mano que no esté en la lista, y el parser/backend lo tratan como cualquier otro texto a validar).

---

## 7. Riesgos técnicos (ExcelJS / validaciones / catálogos dinámicos)

- **Named ranges cross-sheet vs. fórmulas inline**: ExcelJS soporta `dataValidation: { type: "list", formulae: [...] }`, y una fórmula puede apuntar a otra hoja (`Rutas!$A$2:$A$500`) directamente. Sin embargo, el patrón más robusto entre versiones de Excel es declarar el rango como **nombre definido a nivel de libro** (`workbook.definedNames`) y usar ese nombre en `formulae` — evita inconsistencias de comportamiento entre Excel de escritorio, Excel web y LibreOffice al momento de abrir el archivo. Se usará ese patrón.
- **Tamaño variable del catálogo**: cada empresa tiene un número distinto de rutas/vehículos/empleados/clientes activos. El rango con nombre debe cubrir un margen razonable por encima del conteo real (p. ej., hasta 2000 filas) para que el catálogo pueda crecer sin regenerar la plantilla — las filas sobrantes quedan en blanco, lo que en Excel simplemente agrega entradas vacías al final de la lista desplegable (inofensivo, no bloquea nada).
- **Catálogos vacíos**: si una empresa nueva todavía no tiene rutas o empleados activos, la hoja de referencia y el dropdown quedan vacíos — no debe romper la generación de la plantilla (un `dataValidation` con rango vacío no genera error en Excel, solo un dropdown sin opciones).
- **Desincronización entre "cuándo se descarga" y "cuándo se sube"**: los catálogos de referencia son una fotografía del momento de la descarga. Una placa que aparecía "Disponible" al descargar puede no estarlo al importar (alguien más la usó mientras tanto) — esto ya está cubierto por la revalidación obligatoria contra BD fresca en la fase de importación (fuera de alcance de este PR 2), pero vale dejarlo explícito: el catálogo de referencia NUNCA debe interpretarse como garantía, solo como ayuda de llenado — ya está redactado así en la hoja `Instrucciones`.
- **Peso del archivo**: agregar 4 hojas de catálogo aumenta el tamaño del `.xlsx` generado dinámicamente frente a la plantilla estática actual de Rutas. Para empresas con catálogos grandes (cientos de rutas/empleados), sigue siendo trivial en términos de bytes (texto plano en celdas), no se anticipa un problema real de tamaño.
- **Generación dinámica en cada `GET`**: a diferencia del importador de Rutas (plantilla fija), esta plantilla debe reconsultar 4 catálogos en cada descarga — son consultas ya usadas en otras partes del sistema (`listarDisponibilidadVehiculos`, consultas simples a `tms_clientes`/`empleados`/`tms_cliente_rutas`), de bajo costo, pero es una diferencia de comportamiento a tener presente (la descarga de plantilla deja de ser instantánea/estática y pasa a depender de la BD — sigue siendo una operación de solo lectura, sin impacto de escritura).
- **Primera vez que este proyecto usa dropdown cross-sheet**: el importador de Rutas hoy solo usa `dataValidation` de tipo `decimal` (rango numérico) dentro de la misma hoja — nunca una lista (`type: "list"`) ni una referencia entre hojas. Es una técnica nueva para este código base (aunque estándar en ExcelJS/OOXML); se probará explícitamente en los tests del PR correspondiente antes de darla por buena.

---

## Resumen de decisiones que necesito confirmes antes de implementar

1. **Hoja `Empleados`**: ¿la filtro a `categoria_ops IN ('Piloto','Auxiliar')` (más útil para llenar la plantilla) o muestro TODOS los empleados activos (más fiel al comportamiento real y permisivo del sistema)?
2. **Confirmas el esquema de 6 hojas** (`Programacion`, `Rutas`, `Vehiculos`, `Empleados`, `Clientes`, `Instrucciones`) y que ninguna columna nueva se agrega a `Programacion` más allá de las 13 ya aprobadas.
3. **Confirmas que no hay override de viático por fila** en el Excel V1 (se aplica siempre el default por puesto, igual que el formulario manual cuando no se toca ese campo).

Con tu confirmación, recién ahí implemento PR 2 (plantilla dinámica de 6 hojas + parser + tests), siguiendo exactamente el resto de reglas ya acordadas (sin BD en el parser salvo la propia generación de catálogos de referencia para la plantilla, sin validación de catálogo en el parser, límite 500 filas, etc.).
