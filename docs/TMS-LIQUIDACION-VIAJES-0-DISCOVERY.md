# TMS — Liquidación de viajes, cargos adicionales y cuadre con fondos: DISCOVERY y diseño

Estado: **DISCOVERY + PROPUESTA. NO IMPLEMENTADO.** Cero SQL ejecutado, cero migraciones, cero datos, cero backfill, cero cambios
productivos. Base: `main` en `e2add53e` (merge de #451). Ninguna sección de este documento está aprobada: cada fase de §23 es
un PR aparte con autorización previa.

Etiquetas: **[CONFIRMADO]** = verificado en código/SQL de `main`. **[INFERENCIA]** = deducción razonable, a validar. **[PENDIENTE]** =
decisión de negocio que no puede tomarse desde el código. Las rutas y nombres propuestos son **provisionales**.

## 0. Hallazgos que cambian el planteamiento

1. **El vínculo fondos ↔ viaje YA existe.** `tms_solicitud_fondo_lineas.plan_id` y `tms_gastos_operativos.plan_id` son columnas
   NULL con FK compuesta `(empresa_id, plan_id) → tms_planes_viaje(empresa_id, id)`. No hay que crear la relación: hay que **usarla**
   (obligatoriedad por categoría, reportes, cuadre). [CONFIRMADO §8–9]
2. **«Pendiente de cierre» ya existe y significa otra cosa.** Hoy es un valor **calculado** (no almacenado): el viaje no está
   Cerrado/Cancelado y hay una llegada registrada por el piloto en `flota_viajes` (`estado='cerrado'`). Ya tiene badge ámbar
   en la tabla. «Reporte recibido» (nuevo) es una confirmación humana distinta de «llegada técnica». [CONFIRMADO §1]
3. **Tres «liquidado» ya coexisten**: `tms_solicitudes_fondo.estado='Liquidada'`, `tms_viaticos.estado='LIQUIDADO'` y el permiso
   `viaticos_liquidar`. Un cuarto significado (liquidación del viaje) exige **nombre y UI inequívocos** para no confundir. [CONFIRMADO]
4. **La tabla ya es blanca en modo claro.** Las filas usan `bg-[var(--card)]` (`#ffffff` claro / `#121a28` oscuro). «Blanco = liquidado»
   literal destruye el contraste en modo oscuro (texto `#e8eef7` sobre blanco). Ver §12. [CONFIRMADO]
5. **La facturación ya admite varias líneas por viaje con descripción y precio libres (FACT-4).** Los cargos adicionales pueden
   alimentar líneas **sin cambiar el modelo de factura**. [CONFIRMADO §10]
6. **La cuadrilla programada se reemplaza (DELETE + INSERT) al editar**, sin historial. La realidad de la liquidación necesita su
   propio snapshot. [CONFIRMADO §7]
7. **Los viáticos y los peajes no son categorías de fondos.** `CATEGORIAS_GASTO` no incluye «Viáticos» ni «Peajes» (los viáticos son
   el módulo `tms_viaticos`; peajes ≈ «Arbitrios»/«Otros»). [CONFIRMADO §8]
8. **Un viaje ya puede Cerrarse sin ninguna liquidación**, y los cierres masivo y «de período» comparten el mismo servicio.
   Cualquier gate de liquidación debe aplicarse en **un solo lugar compartido**. [CONFIRMADO §4]

## 1. Flujo ACTUAL exacto: Programación → Planes/Viajes → cierre

| Paso | Dónde | Qué hace | Estado de `tms_planes_viaje.estado` |
|---|---|---|---|
| 1 | `/e/[slug]/programacion` (`plan-form`, importación Excel, copia) | Crea/edita el plan: cliente, ruta, unidad, TC, piloto, auxiliares, cuadrilla, paradas, tarifa, viáticos | `Programado` |
| 2 | Edición rápida (`/tms/planes/edicion-rapida{,/validar}`) | Corrige piloto, auxiliares, unidad, TC, **tarifa** y **viáticos** con snapshot de concurrencia `esperado`; permiso `programacion:editar` | sin cambio |
| 3 | Marcar «Cargado» (opcional) | El vehículo está cargado y aún no sale | `Cargado` |
| 4 | Portal/Flota: el piloto registra **salida** (`marcarPlanEnRuta`) | `flota_viajes` abierto con `km_salida`, `hora_salida` | `En ruta` |
| 5 | Portal/Flota: el piloto registra **llegada** | `flota_viajes.estado='cerrado'`, `km_llegada`, `hora_llegada`. **Ya no cambia el estado del plan** (regla OPS-1 corregida) | sin cambio → aparece como `pendienteCierre` (calculado) |
| 6 | `/e/[slug]/planes` («Cerrar viaje») → `cerrarViaje` | `UPDATE … estado='Cerrado', cerrado_por, cerrado_en` condicional | `Cerrado` |
| 6b | «Cierre manual» → `cerrarViajeManual` | Cierra sin llegada física; fuerza `flota_viajes` abierto a `cerrado` sin inventar km; `cierre_manual=1` + motivo | `Cerrado` |
| 6c | «Cerrar seleccionados» / «Cierre manual masivo» (≤200) y «Cierre del período» (día/semana/mes) | Itera **secuencialmente** sobre 6/6b | `Cerrado` |
| 7 | Facturación (`/facturacion`) | Solo viajes `Cerrado` sin factura viva, con tarifa > 0, GTQ y ruta identificable | — |

Notas [CONFIRMADO]: `Descargado` es un estado **legado** (ya no se asigna automáticamente; sigue siendo cerrable). El «período» del cierre
por período es solo una **agrupación de fechas** (`resolverPeriodoPlanes`), no un cierre contable. Editar está bloqueado en
`Cerrado`/`Cancelado`; `En ruta` admite solo notas salvo «pendiente de cierre» (`ESTADOS_SOLO_NOTAS`).

## 2. Tablas y campos actuales implicados

| Tabla | Campos relevantes | Relación con la liquidación |
|---|---|---|
| `tms_planes_viaje` | `estado`, `tarifa_comercial` (NULL = sin tarifa), `tarifa_id`/`tarifa_nombre_historico`/`tarifa_monto_historico`/`tarifa_moneda_historico`, `costo_operativo_referencia`, `costo_tercerizado`, `tipo_viaje`, `cerrado_por/en`, `cierre_manual*`, `notas`, `regreso_estimado` | Cabecera del viaje. `UNIQUE (empresa_id, id)` ya existe (`uq_tmsplanes_empresa_id`) |
| `flota_viajes` | `plan_id`, `km_salida`, `km_llegada`, `hora_salida`, `hora_llegada`, `observaciones`, `estado` | Hecho físico del piloto (km y horas). `km_recorridos` se **deriva** |
| `tms_evidencias` | por `plan_id` (conteo en la lista) | Evidencias del piloto |
| `tms_plan_cuadrilla` | `plan_id`, `orden`, `tipo` INTERNO/EXTERNO, `id_empleado`, `nombre`, `identificacion`, `telefono` | Cuadrilla **programada**; sin costo ni historial |
| `tms_plan_auxiliares`, `tms_plan_pilotos_adicionales` | personal de a bordo | Distinto de cuadrilla; sustenta viáticos |
| `tms_viaticos` | `plan_id`, `personal_id`, `rol`, `monto_sugerido`, `monto_asignado`, `estado` PROGRAMADO→AUTORIZADO→ENTREGADO→LIQUIDADO | Costo de viáticos por persona |
| `tms_solicitudes_fondo` / `_lineas` | línea: `categoria`, `monto`, `plan_id` (NULL), `vehiculo_id`, `empleado_id`, `fecha_viaje`; cabecera `estado` Pendiente/Autorizada/Rechazada/Liquidada | Dinero **solicitado** (estimado) |
| `tms_gastos_operativos` | `plan_id` (NULL), `categoria`, `monto`, `estado` Pendiente/Autorizada/Rechazada, `activo`, `tiene_factura` | Dinero **gastado/incurrido** |
| `fact_factura_viajes`, `fact_factura_lineas`, `fact_factura_linea_viajes` | `plan_id` único, `monto_asignado`; líneas libres con `cantidad × precio_unitario`, `clasificacion`, `precio_incluye_iva` | Ingreso facturado |

## 3. Estados actuales

`tms_planes_viaje.estado` (VARCHAR libre validado en aplicación) [CONFIRMADO]:
`Programado` → `Cargado` (opcional) → `En ruta` → (`Descargado` legado) → `Cerrado`; o `Cancelado`. Derivados (no almacenados):
`pendienteCierre` (llegada registrada y no cerrado/cancelado) y `atrasado` (regreso estimado vencido sin llegada; mutuamente excluyentes).
Estados de facturación/cobro se **derivan** de `fact_*` (`Pendiente de facturación`, `En borrador de factura`, `Facturado`, `Sin pagos`,
`Pago parcial`, `Cobrado`).

## 4. Cierre manual y masivo actuales

| Pieza | Regla [CONFIRMADO] | Concurrencia |
|---|---|---|
| `cerrarViaje` (normal) | Estado `Descargado`, o `En ruta`/`Cargado` **con** llegada registrada; exige `tarifa_comercial IS NOT NULL` (Q0.00 cuenta) | UPDATE condicional + `affectedRows` en transacción con auditoría `cerrar_viaje` |
| `cerrarViajeManual` | Desde `Programado`/`Cargado`/`En ruta`; motivo 5–500; exige tarifa; cierra `flota_viajes` abierto sin tocar km; `cierre_manual=1` | `SELECT … FOR UPDATE` del plan y de `flota_viajes`; auditoría `cerrar_viaje_manual` |
| `cerrarViajesMasivo` | ≤200 ids; valida elegibilidad **antes** con las mismas funciones puras (`cierre-viaje-shared.ts`); luego llama a las anteriores **una por una**; resumen `cierre_masivo_viajes` | Por viaje; un fallo no detiene el lote (`cerrados/omitidos/errores`) |
| `cerrarViajesMasivoPorPeriodo` | Resuelve candidatos por período/filtros en servidor y procesa en lotes de 200 | Igual |
| Permiso | `viajes_cerrar:editar` (fila propia; `requireTenantViajesCerrar`), nunca por rol | — |

**Implicación:** la regla de elegibilidad vive en **funciones puras** (`puedeCerrarNormalmente`, `puedeCerrarManualmente`, `motivoNoCierre*`)
usadas por UI, masivo y períodos, y además duplicada en los `UPDATE` SQL (hay una prueba que impide que diverjan). Un gate de
liquidación debe añadirse **en ambos sitios** y probarse igual.

Impacto en disponibilidad [CONFIRMADO/INFERENCIA]: el cierre manual cierra `flota_viajes` abierto precisamente para no bloquear la unidad;
la disponibilidad se alimenta de estado del plan y de `flota_viajes`. El gate de liquidación **no debe** impedir liberar la unidad por
fuerza mayor → pregunta §25-9.

## 5. Edición rápida actual

Permite cambiar **piloto, auxiliares, unidad, TC, tarifa (catálogo o manual) y viáticos** de filas visibles; no toca fecha, hora, estado,
ruta, cliente ni paradas. Usa un snapshot `esperado` (estado, fecha, piloto, auxiliares, unidad, TC, tarifa, viáticos) y rechaza con 409 si
la BD cambió; máximo 200 filas; permiso `programacion:editar` (`requireTenantProgramacion`). **Debe preservarse intacta** [PENDIENTE: confirmar si
tras «reporte recibido» sigue siendo editable → §25-6]. No edita cuadrilla.

## 6. Tarifa hoy

- `tarifa_comercial DECIMAL(12,2) NULL`: «monto realmente cobrado (editable como override)». Se llena desde el catálogo de tarifas de la ruta
  (`tarifa_id` + snapshots `tarifa_*_historico`) o manualmente. **Sin tarifa no se puede cerrar** (PLANES-TARIFA-CIERRE-1). [CONFIRMADO]
- La tarifa **no** lleva tratamiento de IVA: el IVA se decide **por línea de factura** (`precio_incluye_iva`). [CONFIRMADO]
- Al facturar, `monto_asignado` por defecto = `tarifa_comercial` y puede ajustarse por línea (queda en auditoría «Montos ajustados»). [CONFIRMADO]
- Referencias de **costo** ya presentes en el plan: `costo_operativo_referencia` (snapshot estimado de la ruta) y `costo_tercerizado`
  (informativo). No son costo real. [CONFIRMADO]

## 7. Cuadrilla actual

`tms_plan_cuadrilla` (independiente de auxiliares): internos (empleado activo) y externos (nombre/identificación/teléfono), únicos
`(plan_id, id_empleado)` y `(plan_id, orden)`. Se escribe con **DELETE + INSERT** completo desde Programación; se lee con `FOR UPDATE`
en la edición. Tiene PDF/Excel de programación. **No** hay costo por integrante, **no** hay historial, **no** hay «real vs programada».
Se bloquea al `Cerrado`/`Cancelado`. [CONFIRMADO] Cuadrilla ≠ auxiliares (que sí generan viáticos).

## 8. Solicitudes de fondos y categorías actuales

- **Catálogo fijo en código** (`CATEGORIAS_GASTO`, compartido con Gastos): Combustible, Hospedaje, Parqueo, Cuadrilla, Auxiliar extra,
  Mantenimiento, Arbitrios, Transporte, Comida, Aceite, Medicamento, Bonificación, Reintegro de gastos, Otros. **No** hay «Viáticos» ni
  «Peajes». [CONFIRMADO]
- Solicitud: `Pendiente → Autorizada → Liquidada` o `Rechazada`; líneas con categoría, monto, método de pago, empleado/vehículo/cliente y
  **`plan_id` opcional** (snapshot de cliente y fecha del viaje si se indica). Idempotencia de envío y control de entrega (PR 1/2) ya existen. [CONFIRMADO]
- «Liquidada» en fondos = estado de la solicitud tras autorizarse; **no** compara contra gasto real. [CONFIRMADO por código; semántica de negocio a validar §25-14]
- Gasto operativo: objeto distinto (lo ya incurrido), `plan_id` opcional, `Pendiente/Autorizada/Rechazada`, `activo`. Reporte existente
  agrupa por viaje (`reportes-gastos.ts`, «Sin viaje»). [CONFIRMADO]

## 9. Vínculo actual fondos ↔ viaje

Existe a **nivel de línea** (solicitudes) y de **gasto**, opcional, con FK compuesta por empresa. Faltantes [CONFIRMADO]:
(a) ninguna regla exige `plan_id` por categoría; (b) una línea puede apuntar a un plan ya `Cerrado` (solo se valida pertenencia a la empresa);
(c) no hay reporte «solicitado vs gastado» por viaje; (d) una compra de combustible compartida por dos viajes no tiene prorrateo;
(e) el mismo dinero puede aparecer como línea de fondo **y** como gasto operativo (y «Reintegro de gastos»).

## 10. Facturación actual desde viajes

Facturable = `Cerrado` + sin `fact_factura_viajes` + cliente puente + `tarifa_comercial > 0` + GTQ + ruta identificable. FACT-4: viajes →
**líneas editables y agrupables** (descripción libre, cantidad × precio, clasificación SERVICIO/BIEN, IVA propio); un viaje puede estar en
varias líneas y **todo viaje debe estar en ≥ 1 línea**. Planes/Viajes ya muestra estado, No. factura, monto, total, cobrado y saldo (JOIN 1:1 por
`UNIQUE(plan_id)`). `Cerrado` es hoy el único hito que habilita facturar. [CONFIRMADO]

**¿Debe facturar tarifa base + cargos?** Sí, como **líneas adicionales sugeridas** (no mezclando el cargo dentro del precio de la línea de tarifa).
Puntos de integración futuros (sin tocarlos ahora): `condicionesViajesPendientes`/`evaluarPlanFacturable` (qué hace facturable al viaje),
`crearFactura`/`previsualizarFactura` (líneas sugeridas), `detalleAjustesMonto` (trazabilidad), y un vínculo `cargo → línea` para no facturar dos
veces. **Independiente de FEL/INFILE** (pausado): todo lo anterior ocurre antes de cualquier certificación.

## 11. Propuesta: estados de liquidación (dimensión separada)

**No tocar `tms_planes_viaje.estado`.** La liquidación es una dimensión administrativa/financiera propia (1:1 con el viaje):

| Estado de liquidación | Cómo se representa | Significado |
|---|---|---|
| *(sin fila)* | ausencia de registro | Sin reporte confirmado. Para viajes históricos significa «**sin liquidación registrada**», nunca «liquidado» |
| `REPORTE_RECIBIDO` | fila con ese estado | El encargado confirmó que el piloto entregó su reporte; pendiente de liquidar → **amarillo** |
| `LIQUIDADO` | fila con ese estado | Liquidación validada y congelada (snapshots) |
| `REABIERTA` *(opcional)* | evento en el historial, estado vuelve a `REPORTE_RECIBIDO` | Corrección antes del cierre, con motivo y quién |

`PENDIENTE_REPORTE` del ejemplo se **deriva** (no se almacena): viaje activo sin fila. Ventaja: no hay un segundo ciclo de vida que contradiga el
del viaje; el estado del viaje sigue gobernando edición/cierre y la liquidación solo agrega **precondiciones**. Compatibilidad entre dimensiones:
`Cancelado` ⇒ no admite liquidación; `Cerrado` ⇒ liquidación inmutable (excepto lectura).

## 12. Propuesta: colores y UX

**Componente exacto:** `src/app/e/[slug]/planes/planes-viajes-client.tsx`, `<tr … bg-[var(--card)]>` (fila de viaje, ~L1316) — el **mismo**
componente sirve a `/planes` (operativo) y `/reportes/viajes` (consulta). Tokens de tema en `src/app/globals.css` (`[data-theme="dark"|"light"]`;
**no** se usa el variante `dark:` de Tailwind: hay que definir variables CSS).

- Fondo **completo** de la fila (`<tr>` + sus celdas heredan), sin tocar el color del texto.
- **Amarillo** = `REPORTE_RECIBIDO`. Tokens nuevos propuestos (a verificar con contraste real al implementar):
  `--fila-pendiente-liquidar`: claro `#fff7d1` / oscuro `rgba(234,179,8,.16)` sobre `--card` (≈ `#343223`).
  Contraste estimado de `--text`: ≈ 16:1 (claro) y ≈ 10:1 (oscuro); `--muted` (10 px) sobre claro ≈ 4.6:1 (límite: usar `#fffbeb` si hace falta).
- **«Blanco» = superficie por defecto del tema** (`--card`: blanco en claro; tarjeta oscura en oscuro). Un blanco literal en oscuro es **inviable**
  (texto claro sobre blanco ≈ 1.2:1). Equivalente visual en oscuro: la superficie normal.
- **Problema de significado:** filas «sin reporte» y «liquidadas» quedarían **idénticas**. Recomendación: agregar una columna/badge
  **«Liquidación»** (texto: `Reporte recibido` / `Liquidado` / `—`) además del color (nunca solo color, accesibilidad), y opcionalmente un borde
  izquierdo discreto en `LIQUIDADO`. No inventar más colores sin aprobación §25-5.
- Interacciones que **no deben perderse**: hoy no hay hover ni resaltado de selección (solo checkbox). Propuesta: selección con `box-shadow: inset 3px 0 0
  var(--accent)` + hover como capa `background-image: linear-gradient(var(--nav-hover), var(--nav-hover))`, ambos **independientes** del fondo.
- Badges existentes: `Pendiente de cierre` (`bg-amber-600`) ya es ámbar; sobre fila amarilla se vería redundante → renombrar a «Llegada registrada»
  o mantenerlo con el nuevo badge de liquidación para eliminar la ambigüedad (§25-4). Los badges llevan `text-white` con fondo propio: legibles sobre ambos fondos.
- Filas expandidas (`--panel`) y cabeceras de grupo (`--thead`) **no** se tiñen.

## 13. Propuesta mínima de tablas/campos (sin SQL, a revisar)

Reutilizar lo que ya existe; **solo** crear lo inexistente:

| Objeto nuevo | Contenido mínimo | Por qué no existe ya |
|---|---|---|
| `tms_viaje_liquidaciones` (1:1 con plan) | `empresa_id`, `plan_id` (FK compuesta, `UNIQUE (empresa_id, plan_id)`), `estado` (`REPORTE_RECIBIDO`/`LIQUIDADO`), `reporte_recibido_por/en` (usuario_id), `reporte_observaciones`, `liquidado_por/en`, `version`, **snapshots al liquidar**: `tarifa_base`, `moneda`, `total_cargos_aprobados`, `costo_total_snapshot` (opcional) | No hay hito ni responsable de liquidación |
| `tms_viaje_liquidacion_eventos` (append-only) | `plan_id`, `evento` (CONFIRMAR_REPORTE, LIQUIDAR, REABRIR, …), `estado_antes/despues`, `usuario_id`, `motivo`, `creado_en` | `auditoria` es texto libre; la reapertura sobreescribiría `liquidado_por/en` |
| `tms_viaje_cargos_adicionales` | ver §14 | No existe |
| `tms_viaje_liquidacion_cuadrilla` | copia editable de la cuadrilla **real**: `tipo`, `id_empleado`/`nombre`, `origen` (PROGRAMADA/AGREGADA), `presente` | La programada se reemplaza al editar y no tiene historial |
| Config por empresa: fecha de activación | `liquidacion_obligatoria_desde` (DATE NULL) | Para no exigir liquidación a lo histórico sin backfill |

**No crear (ya existen):** km (`flota_viajes`), observaciones (`tms_planes_viaje.notas`, `flota_viajes.observaciones`), tarifa
(`tarifa_comercial`+snapshots), vínculo fondos↔viaje (`plan_id`), costos (`tms_gastos_operativos`, `tms_viaticos`, líneas de fondos),
incidencias estructuradas (solo evidencias; **faltan**, §25-10). Los costos reales **no** se re-capturan: la liquidación los **consulta**
y solo congela un total/snapshot al liquidar.

Mapa «dato de liquidación → ya existe / falta»: fecha-hora y usuario liquidador **faltan**; reporte recibido **falta**; km **existen** (del
piloto; ¿se corrigen? §25-8); observaciones **existen**; incidencias **faltan**; tarifa aplicada **existe**; cargos adicionales **faltan**;
cuadrilla real **falta**; otros gastos **existen** (gastos/viáticos/fondos por `plan_id`).

## 14. Modelo de cargos adicionales

`tms_viaje_cargos_adicionales`: `empresa_id`, `plan_id` (FK compuesta), `tipo` (catálogo fijo en código, igual que `CATEGORIAS_GASTO`: Espera,
Cuadrilla cobrada, Maniobra, Desvío, Otro servicio — **a confirmar**), `descripcion`, `cantidad`, `precio_unitario`, `monto` (derivado,
Decimal), `moneda`, `precio_incluye_iva` (**§25-12**), `estado` (`BORRADOR`/`APROBADO`/`ANULADO`), `aprobado_por/en`, `anulado_por/en/motivo`,
`clave_envio` (idempotencia) y trazabilidad a línea de factura (`factura_linea_id` NULL, futuro). **Múltiples por viaje; nunca se borran: se anulan.**

```
total_facturable_viaje = tarifa_base (tarifa_comercial) + Σ cargos_adicionales en estado APROBADO
```

## 15. Diferencia tarifa / cargo / costo

| Concepto | Qué es | Fuente | Va al cliente |
|---|---|---|---|
| **A. Tarifa base** | Precio contractual del viaje | `tms_planes_viaje.tarifa_comercial` | Sí |
| **B. Cargo adicional** | Servicio extra **cobrable** al cliente | `tms_viaje_cargos_adicionales` (nuevo) | Sí, solo `APROBADO` |
| **C. Costo/gasto real** | Lo que la empresa pagó | `tms_gastos_operativos`, `tms_viaticos`, líneas de fondo | **No** (nunca automático) |

Un costo extra **no** genera cargo; un cargo **no** exige un costo. Margen futuro = `total_facturable − costo real` (cálculo de reportes; **sin**
contabilidad general). Para no mezclar monedas/IVA, la liquidación congela cada componente por separado.

## 16. Vincular fondos ↔ viaje

1. **Reutilizar** `plan_id` de línea y de gasto (ya con FK compuesta). Sin tabla puente nueva.
2. **Obligatoriedad configurable por categoría** (propuesta): `Combustible` y `Cuadrilla` (y quizá `Auxiliar extra`, `Parqueo`, `Arbitrios`) piden `plan_id`
   cuando la solicitud es «de viaje»; las administrativas (`Mantenimiento`, `Otros`, requerimientos de oficina) siguen sin viaje. Implementar como regla de
   aplicación con mensaje claro, **no** como CHECK (la categoría es dato en código).
3. Reglas de integridad: el `plan_id` debe ser de la misma empresa (ya validado); **no** admitir líneas nuevas sobre planes `Cerrado`/`Cancelado`
   (decisión §25-15); línea con `plan_id` y `vehiculo_id` coherentes (aviso, no bloqueo).
4. Combustible compartido por varios viajes: **una línea por viaje** (prorrateo explícito) para que el cuadre cierre por viaje (§25-16).

## 17. Cuadre de combustible (diseño de reporte, sin implementar)

Por viaje/plan/período, categoría = `Combustible`:

| Columna | Fuente | Notas |
|---|---|---|
| Solicitado | Σ líneas `categoria='Combustible'` con `plan_id` en solicitudes `Autorizada`/`Liquidada` | Excluir `Pendiente`/`Rechazada` (o mostrarlas aparte) |
| Gastado | Σ `tms_gastos_operativos` `categoria='Combustible'`, `plan_id`, `estado='Autorizada'`, `activo=1` | Evita doble conteo con «Reintegro de gastos» |
| Liquidado | Snapshot de la liquidación | Congela la cifra aceptada |
| Diferencias | Solicitado − Gastado; Gastado − Liquidado | Signo y umbral por definir |

Riesgo: una misma erogación como línea y como gasto → el reporte debe emparejar o separar «solicitado» de «gastado», **nunca sumarlos**.

## 18. Cuadre de cuadrilla (diseño de reporte, sin implementar)

Comparar **tres** cosas: (1) cuadrilla **programada** (`tms_plan_cuadrilla`), (2) cuadrilla **real** (snapshot de la liquidación, con diferencia
marcada: agregó/quitó/reemplazó), (3) fondos solicitados `categoria='Cuadrilla'` y gasto real `Cuadrilla`/`Auxiliar extra`, más el **cargo
cobrado al cliente** (si es «Cuadrilla cobrada»). La programada **no** se asume real. Falta una tarifa/costo por integrante para valorizar
(§25-17); sin ella el cuadre es de **personas** y de **montos globales**.

## 19. Permisos

Patrón real [CONFIRMADO]: catálogo en `src/lib/permisos-catalogo.ts`; filas propias (`viajes_cerrar` con flag `puedeEditar`); acciones de
control (`fondos_entrega_emitir`, `viaticos_liquidar`) **no se conceden por rol**. Hoy: edición rápida = `programacion:editar`; cierre manual,
masivo y de período = `viajes_cerrar:editar`.

Propuesta (nombres a seguir el patrón `viajes_*`, **provisionales**): `viajes_confirmar_reporte`, `viajes_liquidar`, `viajes_cargos_aprobar`
(y capturar cargo con `programacion:editar` o `viajes_liquidar`, §25-11). Todas separadas de `viajes_cerrar`; ninguna por rol por defecto;
el servidor **no** debe exigir que sean personas distintas, pero sí permitirlo y auditarlo (¿segregación obligatoria? §25-11).

## 20. Auditoría

Cada transición en la **misma transacción** que el cambio (`registrarAuditoriaTx`, módulo `tms`) + fila en
`tms_viaje_liquidacion_eventos`: confirmar reporte (quién/cuándo), liquidar (quién/cuándo, snapshots), reabrir (motivo), crear/aprobar/anular cargo
(valores antes/después), cierre (ya existe `cerrar_viaje*`). Corrección = **nuevo evento**, nunca `UPDATE` que borre el anterior ni `DELETE`.
La relación con fondos se audita al crear/editar la línea (ya existe auditoría de fondos) y en el snapshot de liquidación (ids de origen).

## 21. Concurrencia

| Escenario | Diseño propuesto (patrones ya usados en el repo) |
|---|---|
| Dos usuarios liquidando el mismo viaje | `UNIQUE (empresa_id, plan_id)` + `UPDATE … WHERE estado='REPORTE_RECIBIDO' AND version=?` (`affectedRows`); el segundo recibe 409 con el estado actual |
| Liquidar mientras otro edita (cuadrilla, tarifa, cargos, edición rápida) | Orden de locks único: **plan `FOR UPDATE` → liquidación → hijos**. La edición rápida ya compara `esperado`; añadir `estado de liquidación` y `version` al snapshot |
| Cierre mientras se liquida | El cierre lee el estado de liquidación **bajo el mismo lock del plan** dentro de su transacción; se serializa con la liquidación. Gate en SQL (`EXISTS … LIQUIDADO`) y en la función pura |
| Cierre masivo | Itera por viaje; cada uno re-evalúa el gate; resultados `omitidos` con motivo (ya soportado) |
| Cargos duplicados | `clave_envio` por `(empresa_id, clave)` + huella (patrón de `idempotencia-envio.ts` / fondos); anular = transición condicional |
| Relación fondos↔viaje duplicada | No aplica (columna, no tabla). El riesgo real es doble conteo en el cuadre → regla de reporte (§17) |
| Cargo aprobado vs liquidación en curso | Cargos modificables solo si la liquidación **no** está `LIQUIDADO`; liquidar bloquea los cargos `BORRADOR` pendientes (o exige resolverlos) |

Pruebas necesarias en su momento: MariaDB desechable con carreras reales (misma técnica que PR 2 de entregas) y mutaciones.

## 22. Históricos

- Viajes `Cerrado` existentes: **no** se les asigna liquidación ni se infiere «liquidado». Se muestran como «**Sin liquidación registrada (histórico)**».
- Sin backfill. Gate de cierre por **fecha de activación por empresa** (`liquidacion_obligatoria_desde`): los planes con `fecha_plan` anterior (o los
  ya cerrados) se rigen por las reglas actuales. Alternativa a evaluar: acción explícita «marcar sin liquidación (no aplica)» auditada, solo si el negocio
  la necesita para ordenar reportes.
- Viajes en vuelo al activar (Programado/En ruta con fecha ≥ activación) **sí** entran al flujo nuevo.
- `cierre_manual=1` sigue siendo un dato de cierre, no de liquidación.

## 23. Fases recomendadas (cada una, un PR con aprobación previa)

| Fase | Alcance | Riesgo |
|---|---|---|
| **0** | Respuestas de negocio §25 (sin código) | — |
| **1** | Modelo + dominio **sin UI**: tablas, servicios idempotentes, auditoría, pruebas DB/concurrencia, preflight/verify | Medio (nuevas tablas) |
| **2** | «Confirmar reporte» + columna/badge de liquidación + color de fila + permiso `viajes_confirmar_reporte` | Bajo–medio (UI compartida con `/reportes/viajes`) |
| **3** | «Liquidar» (snapshots tarifa/cuadrilla real/km/costos) + reapertura | Medio |
| **4** | Cargos adicionales: captura, aprobación, total facturable (solo lectura) | Medio |
| **5** | **Gate de cierre** (normal, manual, masivo, período) con fecha de activación | **Alto** (toca el cierre productivo) |
| **6** | Reportes/cuadres combustible y cuadrilla; obligatoriedad de `plan_id` por categoría | Medio |
| **7** | Integración con facturación (líneas sugeridas desde cargos, vínculo cargo→línea) | Medio–alto; independiente de FEL |

## 24. Riesgos

1. **Gate de cierre mal desplegado** bloquea la operación diaria (cierres masivos). Mitigar con fecha de activación y feature por empresa.
2. **Confundir «Liquidada» (fondos)/«LIQUIDADO» (viáticos) con la liquidación del viaje** → errores de negocio y de reportes.
3. **Doble conteo** solicitado + gastado en los cuadres.
4. **Color como único portador de significado** (accesibilidad, modo oscuro, daltonismo).
5. **Datos que cambian después de liquidar** (tarifa, cuadrilla, viáticos, líneas de fondo tardías): sin snapshots el reporte «liquidado» cambia con el tiempo.
6. **Cuadrilla programada reemplazada** por edición: perder la comparación si no se congela antes.
7. **Costo compartido entre viajes** (combustible, cuadrilla) sin regla de prorrateo.
8. **Cargos sin IVA/moneda definidos** → facturación inconsistente con FACT-4.
9. **Permisos demasiado amplios** (quien liquida también cierra y aprueba cargos) → riesgo de control interno.
10. **Alcance**: tocar Planes/Viajes, Fondos, Gastos, Facturación y Cuadrilla a la vez; por eso las fases.

## 25. Preguntas de negocio pendientes

1. **«Reporte recibido»**: ¿qué es físicamente (papel, PDF, hoja firmada)? ¿Se registra algo del reporte (km finales, comentarios) o solo «recibido»?
2. ¿Puede confirmarse el reporte **sin llegada registrada** en el portal? ¿Y en viajes de cierre manual / tercerizados?
3. ¿Quién confirma el reporte, quién liquida y quién cierra (roles/personas)? ¿Pueden ser la misma persona?
4. ¿Se renombra el badge actual «Pendiente de cierre» (llegada registrada) para no chocar con «pendiente de liquidación»?
5. **Colores**: ¿aprueban amarillo + superficie normal + badge de texto? ¿Algún color para «liquidado» además del blanco/normal? ¿Y para «sin reporte»?
6. ¿Después de «reporte recibido» siguen permitidas edición rápida y edición de tarifa/cuadrilla/viáticos? ¿Y después de «liquidado»?
7. ¿Se puede **reabrir** una liquidación? ¿Con qué permiso y hasta cuándo (antes del cierre)? ¿Y reabrir un viaje **cerrado**?
8. ¿El encargado puede **corregir km** o se toma lo registrado por el piloto? ¿Hay tolerancia/umbral de diferencia?
9. ¿El cierre manual/forzado (unidad bloqueada) puede **saltarse** la liquidación, o también la exige? ¿Excepción con motivo?
10. ¿Qué **incidencias** hay que registrar (retraso, daño, merma…)? ¿texto libre o catálogo?
11. ¿Quién puede capturar y quién aprobar **cargos adicionales**? ¿Requiere evidencia/aceptación del cliente?
12. Cargos: ¿tipos exactos? ¿precio con IVA incluido o agregado? ¿moneda distinta de GTQ? ¿se facturan siempre o a veces solo se registran?
13. ¿Un cargo se factura en la **misma factura** que el viaje? ¿Puede facturarse un cargo aprobado después de facturado el viaje (factura aparte)?
14. «Liquidada» en solicitudes de fondo: ¿significa que el dinero se **rindió/comprobó** o solo que se entregó? ¿Debe vincularse a la liquidación del viaje?
15. ¿Se permite agregar fondos/gastos a un viaje **ya liquidado/cerrado**? ¿Cómo se trata el desfase en el cuadre?
16. Combustible/cuadrilla compartidos por varios viajes: ¿una línea por viaje o prorrateo automático?
17. ¿Hay **costo por integrante** de cuadrilla (tarifa diaria/por viaje)? ¿Cuadrilla interna y externa se pagan igual?
18. ¿«Viáticos» y «Peajes» deben ser categorías de fondos o se mantiene viáticos como módulo propio y peajes dentro de «Arbitrios»/«Otros»?
19. **Históricos**: ¿fecha de activación por empresa? ¿Qué se hace con los viajes en curso ese día? ¿Se necesita «no aplica» explícito?
20. ¿El margen (ingreso − costo) se mostrará por viaje en esta etapa o solo se deja el modelo preparado?
21. ¿La liquidación debe poder **imprimirse/exportarse** (PDF/Excel) y con qué contenido? (el PDF es salida, no transición.)
22. ¿Existen viajes **tercerizados** con liquidación distinta (costo_tercerizado, proveedor)?

## 26. Fuera de alcance de este documento

Implementación, SQL, backfill, cambios a facturación/FEL/contabilidad, cambios a Fondos/Gastos, y cualquier merge o despliegue. Este documento
es la base para pedir las decisiones de §25 y autorizar la Fase 1.
