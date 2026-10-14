# TMS — Liquidación de viajes · FASE 0B: cierre de decisiones

Estado: **DECISIONES + PROPUESTA. NO IMPLEMENTADO.** Sin SQL, sin migraciones, sin datos, sin backfill, sin merge. Continúa
[TMS-LIQUIDACION-VIAJES-0-DISCOVERY.md](TMS-LIQUIDACION-VIAJES-0-DISCOVERY.md) (§25: 22 preguntas). Base: `main` en `e2add53e`.
No mezcla RRHH/Vacaciones, ni FEL/INFILE, ni contabilidad general.

Clasificación: **A** = se resuelve técnicamente con una recomendación segura · **B** = requiere confirmación del negocio ·
**C** = se deja configurable (con valor por defecto seguro). «Bloquea» indica la **primera fase** que no puede cerrarse sin la decisión.

## 0. Decisiones base ya aceptadas (no se reabren)

1. Liquidación = dimensión separada del estado operativo del viaje. 2. Estados iniciales: sin registro · `REPORTE_RECIBIDO` · `LIQUIDADO`.
3. No reutilizar «Pendiente de cierre». 4. Amarillo = reporte recibido / pendiente de liquidar. 5. Liquidado = superficie normal del tema + badge.
6. Sin blanco literal en modo oscuro. 7. Históricos no se marcan liquidados. 8. Fecha de activación por empresa. 9. Cierre posterior a la
activación exige liquidación. 10. El PDF no cierra viaje. 11. Tarifa base, cargos facturables y costos reales son conceptos separados.
12. Costos reales se consultan, no se recapturan. 13. Se reutiliza `plan_id` de fondos/gastos. 14. Cuadrilla programada ≠ real: snapshot propio.
15. Fuera de alcance: FEL/INFILE y contabilidad general.

## 1. Tabla de las 22 decisiones

| # | Tema | Clase | Resolución propuesta (resumen) | Bloquea |
|---|---|---|---|---|
| 1 | Qué es el «reporte recibido» y qué se registra | **B**/C | Mínimo técnico: confirmación + fecha/hora + usuario + observación opcional. Qué es físicamente: negocio | Fase 2 (texto/UX), **no** Fase 1 |
| 2 | ¿Confirmar sin llegada registrada? | **A**/C | **Advertir, no bloquear** (bloquear solo `Cerrado`/`Cancelado`); configurable a bloqueo | Ninguna |
| 3 | Quién confirma / liquida / cierra | **B** | Tres permisos separados, sin concesión por rol; segregación obligatoria opcional (C) | Fase 2 (asignación de usuarios) |
| 4 | Renombrar el badge «Pendiente de cierre» | **A** | Renombrar **solo la etiqueta** visible a «Llegada registrada»; el campo `pendienteCierre` no cambia | Ninguna (confirmar redacción) |
| 5 | Colores | **A** | Resuelta por las preferencias 4–6; solo falta validar el tono en revisión visual | Ninguna |
| 6 | Edición rápida tras reporte/liquidación | **A** | Permitida en `REPORTE_RECIBIDO`/`EN_AJUSTE`; bloqueada en `LIQUIDADO` salvo notas | Fase 3 |
| 7 | Reapertura | **A** (viaje cerrado: **B**) | `LIQUIDADO → EN_AJUSTE → LIQUIDADO`, con versión y evento append-only; reabrir un viaje **Cerrado** queda fuera | Fase 3 (solo la parte de Cerrado, fuera de alcance) |
| 8 | Corrección de km | **B**/A | Sin sobrescribir `flota_viajes`; la liquidación **copia** y advierte | Ninguna |
| 9 | Cierre manual saltándose la liquidación | **A**/C | **No** se salta por defecto; la liquidación mínima es ligera; excepción con permiso+motivo, **apagada** | **Fase 5** |
| 10 | Incidencias | **B** | Texto libre opcional por ahora; catálogo solo si negocio lo define | Ninguna |
| 11 | Quién captura / aprueba cargos | **B** | Capturar = `viajes_liquidar`; aprobar = permiso propio; ¿mismo usuario? configurable | **Fase 4** |
| 12 | Tipos, IVA y moneda de cargos | **B** (IVA) · C (tipos) · A (moneda) | **IVA: pregunta obligatoria de negocio, sin decidir.** Tipos: catálogo en código. Moneda: GTQ | **Fase 4 y 7** |
| 13 | Facturar el cargo en la misma factura / aparte | **B** | Hallazgo: `UNIQUE(plan_id)` en `fact_factura_viajes` impide una 2.ª factura con el mismo viaje | **Fase 7** |
| 14 | Significado de «Liquidada» en fondos | **B** | Sin acoplamiento: la liquidación del viaje **no** cambia estados de fondos | Fase 6 |
| 15 | Fondos/gastos posteriores a liquidar/cerrar | **A** (liquidado) · **B** (cerrado) | Ver §8 | Fase 6 |
| 16 | Combustible/cuadrilla compartidos por varios viajes | **B**/A | Una línea por viaje (explícito); sin prorrateo automático | Fase 6 |
| 17 | Costo por integrante de cuadrilla | **B** | **No** inventarlo: snapshot sin costo; cuadre de personas y montos globales | Fase 6 (valorización) |
| 18 | «Viáticos» y «Peajes» como categorías | **A** (viáticos) · **B** (peajes) | Viáticos se leen de `tms_viaticos`; peajes: nueva categoría o «Arbitrios» | Fase 6 |
| 19 | Fecha de activación e históricos | **A**/C | Config por empresa, `NULL` = apagado; gate por `fecha_plan >= activación` | Valor concreto: **go-live**, no Fase 1 |
| 20 | Margen ingreso − costo | **B**/C | Modelo preparado; **no** se muestra en esta etapa salvo decisión | Ninguna |
| 21 | Exportar/imprimir liquidación | **B** | PDF/Excel como salida, nunca transición | Ninguna |
| 22 | Viajes tercerizados | **B**/A | Mismo flujo; el snapshot incluye `tipo_viaje` y `costo_tercerizado` (lectura) | Ninguna |

**Resumen (22):** **7** resolubles técnicamente (A: #2, 4, 5, 6, 7, 9, 19; #7 y #9 conservan un componente de negocio/configuración), **2** mixtas A/B
(#15, #18), **13** requieren negocio (B: #1, 3, 8, 10, 11, 12, 13, 14, 16, 17, 20, 21, 22). Llevan además un componente **configurable** (C): #1, 2, 3, 9, 11, 12, 15, 19, 20.
**Ninguna decisión de negocio bloquea la Fase 1**, siempre que se aprueben las recomendaciones A de este documento.

## 2. Detalle por decisión

### D01 · Qué es el reporte recibido [B/C]
- **Impacto técnico:** define qué campos guarda la confirmación; el modelo mínimo (fecha/hora, usuario, observación) cubre cualquier respuesta.
- **Riesgo:** pedir de más (km, firmas, adjuntos) vuelve lenta la mañana operativa; pedir de menos pierde trazabilidad.
- **Recomendación:** `reporte_recibido_en/por` + observación opcional (≤500). Sin adjunto obligatorio.
- **Alternativa:** adjuntar el PDF/imagen del reporte (reutiliza `guardarUpload`), opcional, en una fase posterior.
- **Bloquea:** no.

### D02 · Confirmar sin llegada registrada [A/C]
- **Impacto:** el sistema **no** exige que el piloto registre llegada en el portal (cierre manual ya existe porque muchos viajes nunca la registran).
- **Riesgo:** bloquear detiene la operación; permitir sin aviso oculta datos faltantes.
- **Recomendación:** **bloqueo duro** solo si `Cerrado`/`Cancelado`. **Advertencias con confirmación explícita**: sin llegada registrada, sin salida
  registrada (`Programado`/`Cargado`), sin km. La advertencia reconocida queda en el evento.
- **Alternativa (C):** `reporte_requiere_llegada` por empresa (default apagado) para bloquear.
- **Bloquea:** no.

### D03 · Responsables [B]
- **Impacto:** solo asignación de permisos; los tres son filas separadas (ver §13).
- **Riesgo:** que quien confirma, liquida y cierra sea siempre la misma persona anula el control; que no haya nadie anula el flujo.
- **Recomendación:** permisos separados sin concesión por rol (patrón `entregas`/`viajes_cerrar`); **no** forzar personas distintas al inicio.
- **Alternativa (C):** `liquidacion_segregacion` (confirmante ≠ liquidador ≠ cierre), apagada por defecto.
- **Bloquea:** no (se asignan al desplegar).

### D04 · Badge «Pendiente de cierre» [A]
- **Impacto:** cambio de etiqueta en `badgeEstado` (UI), sin tocar API ni `pendienteCierre`.
- **Riesgo:** dos amarillos con significados distintos en la misma fila.
- **Recomendación:** etiqueta «Llegada registrada»; mantener su color ámbar de **badge** (la fila amarilla es del reporte/liquidación).
- **Alternativa:** conservar el texto y diferenciar con icono.
- **Bloquea:** no; confirmar la palabra con Operaciones.

### D05 · Colores [A]
- **Impacto:** tokens CSS nuevos en `globals.css` (claro/oscuro); fondo completo de `<tr>`; selección y hover como capas independientes.
- **Riesgo:** contraste insuficiente en 10 px (`--muted`) o selección invisible.
- **Recomendación:** `REPORTE_RECIBIDO` y `EN_AJUSTE` = amarillo; `LIQUIDADO` = superficie normal + badge «Liquidado»; sin registro = normal + «—».
  Verificar contraste ≥ 4.5:1 de texto normal y muted en ambos temas antes de fusionar.
- **Alternativa:** borde izquierdo verde discreto en `LIQUIDADO`.
- **Bloquea:** no.

### D06 · Edición rápida tras reporte/liquidación [A]
- **Impacto:** el snapshot `esperado` de edición rápida incorpora `estadoLiquidacion` y `version`; el backend rechaza campos económicos/recursos en `LIQUIDADO`.
- **Riesgo:** editar tarifa/personal/viáticos de un viaje ya liquidado invalida el snapshot.
- **Recomendación:** `REPORTE_RECIBIDO`/`EN_AJUSTE`: todo lo actual sigue permitido (la liquidación toma el snapshot **al liquidar**). `LIQUIDADO`: solo notas;
  para lo demás, reabrir. La edición rápida de la mañana **no cambia** para viajes sin reporte.
- **Alternativa:** bloquear desde `REPORTE_RECIBIDO` (más estricto, más fricción).
- **Bloquea:** Fase 3.

### D07 · Reapertura [A; viaje Cerrado → B]
- **Impacto:** modelo en §6.
- **Riesgo:** sobrescribir `liquidado_por/en` pierde historia; permitir reabrir tras facturar rompe la cadena (el viaje `Cerrado` ya es facturable).
- **Recomendación:** `LIQUIDADO → EN_AJUSTE → LIQUIDADO`, solo si el plan **no** está `Cerrado`; permiso propio; motivo obligatorio.
- **Alternativa:** reabrir también `Cerrado` (requeriría liberar facturación y revertir cierre: otro ticket).
- **Bloquea:** no para Fase 1.

### D08 · Corrección de km [B/A]
- **Impacto:** si se permite, hace falta una columna de «km confirmados» y su historial; si no, solo se copian los de `flota_viajes`.
- **Riesgo:** editar `flota_viajes` desde liquidación contamina el odómetro/mantenimiento de Flota.
- **Recomendación:** **no** tocar `flota_viajes`; copiar `km_salida/llegada` y horas al snapshot; advertir si faltan o `llegada < salida`.
- **Alternativa:** campo `km_confirmados` nullable en la liquidación, con motivo, solo si negocio lo pide.
- **Bloquea:** no.

### D09 · Cierre manual sin liquidación [A/C]
- **Impacto:** el gate vive en un solo lugar (§7); la excepción añadiría permiso y evento.
- **Riesgo:** una excepción abierta vacía la regla; un bloqueo sin salida paraliza la liberación de unidades.
- **Recomendación:** **sin** excepción por defecto: la «liquidación mínima» (§4) es ligera y no exige costos ni cargos, así que el flujo manual sigue siendo rápido.
- **Alternativa (C):** `viajes_cierre_sin_liquidacion` (permiso + motivo ≥ 5), apagado y auditado, para emergencias operativas.
- **Bloquea:** Fase 5 (se decide antes de tocar el cierre).

### D10 · Incidencias [B]
- **Impacto:** texto libre = una columna; catálogo = tabla/lista y reportes.
- **Riesgo:** un catálogo prematuro que no calza con la operación.
- **Recomendación:** texto libre opcional (≤1000) en la liquidación; las evidencias del piloto ya existen.
- **Alternativa:** catálogo en código (como `CATEGORIAS_GASTO`) tras definirlo con negocio.
- **Bloquea:** no.

### D11 · Captura y aprobación de cargos [B]
- **Impacto:** dos permisos y dos transiciones (`BORRADOR → APROBADO/ANULADO`).
- **Riesgo:** que cualquiera apruebe cargos cobrables al cliente.
- **Recomendación:** capturar con `viajes_liquidar:editar`; aprobar con `viajes_cargos_aprobar`; sin obligar personas distintas (C).
- **Alternativa:** un solo permiso para ambos.
- **Bloquea:** Fase 4.

### D12 · Tipos, IVA y moneda de cargos [B (IVA) / C / A]
- **Impacto:** `precio_incluye_iva` determina la línea de factura sugerida.
- **Riesgo:** inventar el tratamiento de IVA genera facturas incorrectas (FACT-4 lo exige **por línea**).
- **Recomendación:** **IVA = pregunta obligatoria de negocio, sin valor por defecto.** En Fase 4 el cargo guarda `monto` neto de decisión y la columna de IVA
  se agrega **cuando se decida**; hasta entonces el cargo no se sugiere a facturación. Tipos: catálogo en código (Espera, Cuadrilla cobrada, Maniobra,
  Desvío, Otro) extensible. Moneda: solo GTQ (igual que facturación).
- **Alternativa:** columna `precio_incluye_iva` nullable («no definido») desde el inicio.
- **Bloquea:** Fase 4 y 7.

### D13 · Facturar el cargo [B]
- **Impacto técnico verificado:** `fact_factura_viajes` tiene `UNIQUE(plan_id)`: un viaje solo puede estar en **una** factura viva. Un cargo aprobado **después**
  de facturar el viaje no puede entrar con la referencia del viaje a otra factura.
- **Riesgo:** cobrar menos al cliente o romper la unicidad.
- **Recomendación:** que el flujo lo evite: liquidación (con cargos aprobados) → cierre → facturación. Cargos tardíos: decisión de negocio (nota de débito /
  línea sin viaje / reabrir).
- **Alternativa:** vincular cargo a la línea (`factura_linea_id`) y permitir líneas «de servicio» sin plan.
- **Bloquea:** Fase 7.

### D14 · «Liquidada» en fondos [B]
- **Impacto:** si se quisiera exigir fondos liquidados para liquidar el viaje, habría acoplamiento entre módulos.
- **Riesgo:** bloquear la liquidación por una solicitud administrativa ajena.
- **Recomendación:** **sin acoplamiento**: solicitudes de fondo `Pendiente`/`Autorizada` con `plan_id` generan **advertencia**, no bloqueo.
- **Alternativa:** exigir que no haya solicitudes `Pendiente` del viaje (bloqueo suave configurable).
- **Bloquea:** Fase 6.

### D15 · Fondos/gastos posteriores [A/B] → ver §8.

### D16 · Costos compartidos [B/A]
- **Recomendación:** una línea por viaje (cada una con su `plan_id`); sin prorrateo automático. **Riesgo:** un solo combustible para dos viajes distorsiona el cuadre.
  **Alternativa:** asistente de prorrateo (genera N líneas). **Bloquea:** Fase 6.

### D17 · Costo por integrante [B]
- **Recomendación:** no inventarlo; el snapshot de cuadrilla **no** lleva costo. **Riesgo:** valorizar con una tarifa supuesta contamina márgenes.
  **Alternativa:** columna `costo` nullable lista para cuando exista la regla. **Bloquea:** valorización en Fase 6.

### D18 · Viáticos y peajes [A/B]
- **Recomendación:** viáticos **no** son categoría: el cuadre lee `tms_viaticos` (`monto_asignado` por estado). Peajes: negocio decide entre agregar «Peajes» al
  catálogo fijo (cambio aditivo en código) o seguir con «Arbitrios»/«Otros». **Riesgo:** dos categorías para lo mismo parten el cuadre. **Bloquea:** Fase 6.

### D19 · Activación e históricos [A/C]
- Ver §9. **Bloquea** solo la **fecha concreta** (decisión de despliegue), no el código.

### D20 · Margen [B/C]
- **Recomendación:** la liquidación congela componentes (tarifa, cargos, costos por origen) para que el margen sea calculable; no se muestra aún.
  **Riesgo:** exponer un margen incompleto (costos sin `plan_id`). **Bloquea:** no.

### D21 · Exportación [B]
- **Recomendación:** salida opcional en Fase 3+, solo lectura. **Riesgo:** interpretarla como cierre. **Bloquea:** no.

### D22 · Tercerizados [B/A]
- **Recomendación:** mismo flujo (reporte → liquidación → cierre). El snapshot copia `tipo_viaje`, `costo_tercerizado`, piloto/unidad externos. **Riesgo:**
  que la liquidación al proveedor externo sea otro proceso. **Bloquea:** no.

## 3. Flujo final propuesto

```
PROGRAMACIÓN ─▶ OPERACIÓN ─▶ REPORTE RECIBIDO ─▶ LIQUIDACIÓN ─▶ CIERRE ─▶ REPORTES / FACTURACIÓN
 (plan-form,     (salida,      (confirmación       (snapshots,    (normal | manual |   (viajes Cerrados
  edición         llegada,      humana; amarillo)   cargos,        masivo | período;    ya facturables)
  rápida)         cuadrilla)                        cuadre)        exige LIQUIDADO)
                                    ▲                   │
                                    └── EN_AJUSTE ◀─────┘  (reapertura con motivo; solo antes de Cerrado)
```

El estado operativo (`Programado … Cerrado`) sigue gobernando edición y cierre; la liquidación **añade precondiciones**, nunca estados al viaje.

## 4. Requisitos para LIQUIDADO (mínimos)

| Categoría | Elementos |
|---|---|
| **Obligatorios (bloquean)** | (1) Liquidación en `REPORTE_RECIBIDO` o `EN_AJUSTE`; (2) plan no `Cancelado`/`Cerrado`; (3) `tarifa_comercial` no nula (Q0.00 válida; es la misma exigencia del cierre, para no crear un viaje «liquidado pero no cerrable»); (4) **cuadrilla real** tomada (puede ser idéntica a la programada, o vacía si no hubo); (5) sin cargos en `BORRADOR` (aprobar o anular) *[desde Fase 4]*; (6) `version`/snapshot coincide (concurrencia) |
| **Advertencias (requieren «reconozco»)** | sin llegada/salida registrada; sin km o `km_llegada < km_salida`; sin horas; sin evidencias; cuadrilla real ≠ programada; viáticos sin entregar/liquidar; solicitudes de fondo o gastos `Pendiente` con `plan_id`; diferencias de combustible/cuadrilla > umbral; tercerizado sin `costo_tercerizado` |
| **Opcionales** | observaciones, incidencias (texto), cargos adicionales (cero es válido) |
| **No exigibles hoy** | km corregidos, firma del encargado, adjunto del reporte, costo por integrante, fondos «Liquidada» |

Todo lo que no es obligatorio se **advierte y se registra** (qué advertencias se reconocieron), nunca se bloquea sin evidencia de negocio.

## 5. Propuesta de estados

| Estado | Almacenado | Color | Acciones |
|---|---|---|---|
| *(sin registro)* | no | normal + «—» | Confirmar reporte |
| `REPORTE_RECIBIDO` | sí | **amarillo** + «Reporte recibido» | Liquidar; edición permitida |
| `LIQUIDADO` | sí | normal + «Liquidado» | Cerrar; Reabrir |
| `EN_AJUSTE` | sí | **amarillo** + «En ajuste» | Re-liquidar |

Almacenar con `VARCHAR` + `CHECK` (patrón de PR B/FEL), versión entera y `UNIQUE (empresa_id, plan_id)`. Sin estado «pendiente de reporte» almacenado (se deriva).

## 6. Reapertura (modelo)

`LIQUIDADO → EN_AJUSTE` (acción **Reabrir**: usuario, fecha, **motivo obligatorio ≥ 5**, `version + 1`) → `EN_AJUSTE → LIQUIDADO` (**re-liquidar**: nuevo
snapshot, `version + 1`). Cada transición inserta un evento **append-only** (`tms_viaje_liquidacion_eventos`: plan, evento, estado antes/después, versión,
usuario, motivo, advertencias reconocidas, snapshot JSON en los eventos `LIQUIDAR`). La cabecera guarda solo el estado **vigente**; las versiones anteriores
viven inmutables en los eventos. Reglas: solo si el plan no está `Cerrado`/`Cancelado`; si hay cierre en curso se serializa con el mismo lock del plan; **nunca**
`UPDATE` que borre `liquidado_por/en` anterior ni `DELETE`. Justificación frente a «REABIERTO»: `EN_AJUSTE` describe el trabajo pendiente y no sugiere que la
liquidación anterior dejó de existir.

## 7. Regla exacta de cierre

```
exigeLiquidacion(plan) = empresa.liquidacion_obligatoria_desde IS NOT NULL
                         AND plan.fecha_plan >= empresa.liquidacion_obligatoria_desde
cerrar normal | manual | masivo | período  ⇒  si exigeLiquidacion(plan): liquidacion.estado = 'LIQUIDADO'
```

- Aplica a `cerrarViaje` y `cerrarViajeManual` (los masivos y por período heredan), en **las dos copias de la regla**: funciones puras de
  `cierre-viaje-shared.ts` (UI, candidatos, masivo) y `UPDATE` SQL (con `EXISTS … LIQUIDADO` bajo el lock del plan). Mensajes: «El viaje no está liquidado».
- `EN_AJUSTE` y `REPORTE_RECIBIDO` **no** cierran. El cierre **no** modifica la liquidación (queda inmutable al `Cerrado`).
- Cierre masivo/período: los no elegibles aparecen en `omitidos` con el motivo (comportamiento ya existente).
- Despliegue seguro: sin fecha configurada = **comportamiento actual intacto**.

## 8. Fondos/gastos posteriores (opciones y recomendación)

| Opción | Trazabilidad | Fricción | Veredicto |
|---|---|---|---|
| Permitir sin más | Mala (el snapshot queda desactualizado en silencio) | Nula | No |
| Exigir reapertura siempre | Excelente | Alta (otra área solicita fondos sin saber el estado) | Solo opcional |
| Bloquear tras `Cerrado` | Buena (cerrado es inmutable) | Media (reintegros tardíos) | **B** |
| Ajustes formales | Excelente | Requiere diseño propio | Futuro |

**Recomendación:** (a) **`REPORTE_RECIBIDO`/`EN_AJUSTE`**: permitido; entra en la liquidación al liquidar. (b) **`LIQUIDADO`**: **permitido pero marcado**
como «movimiento posterior a la liquidación»: el cuadre lo muestra aparte y la liquidación exhibe un aviso con conteo/monto para decidir reabrir. Detección
sin tablas nuevas: el snapshot guarda por origen `max(id)` y totales; el cuadre compara con lo vigente. Configurable a **bloqueo** (C). (c) **`Cerrado`/`Cancelado`**:
**no** aceptar `plan_id` nuevos en líneas/gastos (consistente con inmutabilidad del cierre) — **B**: negocio confirma si existen reintegros tardíos legítimos
(en ese caso, «ajuste formal» como fase futura). Nunca se alteran filas existentes de fondos para «corregir».

## 9. Históricos

- **Cierre:** viajes con `fecha_plan < activación` (o empresa sin fecha) siguen con las reglas actuales: **no** exigen liquidación y no se inventa ninguna.
- **Visual:** sin fila de liquidación ⇒ fila normal + «—» (tooltip «Sin liquidación registrada»); **nunca** «Liquidado». Los `Cerrado` previos no cambian.
- **Activación:** `liquidacion_obligatoria_desde` (DATE NULL) por empresa, con permiso propio y auditoría; al cambiarla se muestra el conteo de viajes abiertos
  afectados. Mover la fecha **antes** endurece retroactivamente viajes abiertos; moverla **después** los exime: ambas acciones quedan auditadas (C).
- Viajes en vuelo con `fecha_plan >= activación` entran al flujo nuevo. Sin backfill, sin «todos los cerrados = liquidados».

## 10. Cargos adicionales — campos mínimos

`tms_viaje_cargos_adicionales` (nuevo, **Fase 4**): `id`, `empresa_id`, `plan_id` (FK compuesta), `concepto` (tipo de catálogo) + `descripcion`
(observación), `monto` DECIMAL(12,2) > 0 + `moneda` GTQ, `estado` `BORRADOR/APROBADO/ANULADO`, `creado_por/en`, `aprobado_por/en`, `anulado_por/en/motivo`,
`clave_envio` + `huella` (`UNIQUE (empresa_id, clave_envio)`, patrón `idempotencia-envio.ts`), `version`. **Sin** columna de IVA hasta la decisión D12.
Se anulan, no se borran; cada cambio genera evento. `total_facturable = tarifa_comercial + Σ cargos APROBADOS` (calculado, no almacenado).

## 11. Cuadrilla real — snapshot

`tms_viaje_liquidacion_cuadrilla` (**Fase 3**): una fila por persona, ligada a la versión de liquidación. Campos: `tipo` (INTERNO/EXTERNO), `id_empleado`
(NULL para externo), `nombre` (**copiado**), `identificacion`, `telefono`, `origen` (`PROGRAMADA` | `AGREGADA`), `presente` (0/1), `observacion`.
- Las personas programadas se **copian** al iniciar la liquidación con `origen=PROGRAMADA`; quien no fue = `presente=0`; quien se suma = `AGREGADA`. Así el snapshot
  contiene **programada y real** sin depender de que `tms_plan_cuadrilla` cambie (se reemplaza por DELETE+INSERT) ni de que el empleado cambie de nombre.
- **Sin costo, sin tarifa, sin cantidad** (una fila = una persona). Se agregará `costo` nullable solo cuando el negocio defina la regla (D17).
- Si el viaje no tiene cuadrilla, el snapshot vacío es válido (obligatorio «tomarlo», no «tener integrantes»).

## 12. Reportes / cuadres

| Cuadre | Se puede calcular **hoy** con | Faltante para que sea real |
|---|---|---|
| Combustible solicitado vs gastado | Líneas de fondo `categoria='Combustible'`+`plan_id` (solicitudes `Autorizada`/`Liquidada`) vs `tms_gastos_operativos` `Autorizada`+`activo` | `plan_id` obligatorio por categoría; litros/precio estructurados (`cantidad` es ambigua); emparejar línea ↔ gasto (rendición); prorrateo |
| Combustible vs liquidado | Snapshot de la liquidación | La liquidación (Fase 3) |
| Cuadrilla: personas programada vs real | `tms_plan_cuadrilla` vs snapshot real | Fase 3 |
| Cuadrilla: monto solicitado/gastado | Fondos+gastos `Cuadrilla`/`Auxiliar extra` por `plan_id` | Costo por integrante (D17) |
| Viáticos | `tms_viaticos` (`monto_asignado`, estado) por viaje | — (ya calculable) |
| Otros gastos por categoría | `reportes-gastos.ts` ya agrupa por viaje | Cobertura de `plan_id` |
| Tarifa base vs cargos | `tarifa_comercial` + cargos aprobados | Fase 4 |
| Ingreso vs costo (margen) | Tarifa + cargos vs gastos+viáticos | IVA de cargos, costos sin `plan_id`, decisión D20 |

Regla transversal: **no sumar** «solicitado» y «gastado» (la misma erogación puede estar en ambos y en «Reintegro de gastos»); los movimientos sin `plan_id`
aparecen como «sin viaje».

## 13. Permisos (convención real del repositorio)

Convención verificada [CONFIRMADO]: id de fila `VARCHAR(40)` en `usuario_modulo`, formato `<área>_<acción>` en minúsculas (`viajes_cerrar`, `viaticos_liquidar`,
`gastos_autorizar`); se declara en `PLATAFORMA_PERMISIBLES` (`permisos-shared.ts`), con etiqueta en la función de labels («Viajes: cerrar administrativamente»), en el
catálogo con `agregar("programacion", accion(fila, acción, etiqueta, E))` y con un guard `requireTenant…` modelado en `requireTenantViajesCerrar`. El flag
`puedeEditar` significa «puede actuar». Ningún rol nuevo lo recibe por defecto (patrón de `entregas_*`).

| Fila propuesta | Acción / etiqueta | Quién actúa |
|---|---|---|
| `viajes_confirmar_reporte` | `confirmar_reporte` — «Confirmar reporte recibido del viaje» | Encargado de la mañana |
| `viajes_liquidar` | `liquidar` — «Liquidar viajes» (incluye capturar cargos) | Liquidador |
| `viajes_liquidacion_reabrir` | `reabrir_liquidacion` — «Reabrir liquidación de un viaje» | Jefe/Gerente (a asignar) |
| `viajes_cargos_aprobar` | `aprobar_cargos` — «Aprobar cargos adicionales» | Jefe/Gerente (a asignar) |
| `viajes_liquidacion_config` | `configurar_liquidacion` — «Configurar fecha de activación» | Administración |

`viajes_cerrar` **no cambia**. Longitudes ≤ 40. Hay que sumar pruebas de catálogo/persistencia (como las de `permisos-catalogo.test.ts`). Asignación inicial a
JefeOperaciones/GerenteOperaciones: **B**.

## 14. Riesgos

1. Gate de cierre mal desplegado paraliza cierres masivos → fecha apagada por defecto, pruebas de SQL vs función pura, despliegue por empresa.
2. Doble significado de «liquidado» (fondos, viáticos, viaje) → etiquetas y documentación en UI.
3. Snapshots incompletos → reporte «liquidado» que cambia con el tiempo.
4. Doble conteo solicitado/gastado.
5. Dependencia de `plan_id` opcional: cuadres subestimados por movimientos sin viaje.
6. `UNIQUE(plan_id)` en `fact_factura_viajes` vs cargos tardíos (D13).
7. Edición rápida y liquidación en carrera → `esperado` ampliado y locks en orden único (plan → liquidación → hijos).
8. Accesibilidad del amarillo (modo oscuro, daltonismo) → badge de texto obligatorio.
9. Alcance: tocar cuatro módulos a la vez → fases separadas con aprobación.
10. Cambiar la fecha de activación retroactivamente → permiso, auditoría y conteo previo.

## 15. Fases ajustadas tras 0B

| Fase | Alcance (sin UI salvo indicación) | Decisiones que necesita |
|---|---|---|
| **1** | `tms_viaje_liquidaciones` + eventos + config de activación; dominio idempotente (confirmar, reabrir); permisos (catálogo); pruebas DB/concurrencia | Aprobar las recomendaciones A de este documento |
| 2 | UI: confirmar reporte, columna/badge, color de fila, advertencias | D01, D03, D04, D05 |
| 3 | Liquidar + snapshot de cuadrilla/km/tarifa + reapertura + edición rápida protegida | D06, D08, D10 |
| 4 | Cargos adicionales (captura/aprobación) | D11, **D12** |
| 5 | Gate de cierre normal/manual/masivo/período | D09, D19 (fecha) |
| 6 | Cuadres combustible/cuadrilla/viáticos y `plan_id` por categoría | D14–D18 |
| 7 | Facturación: líneas sugeridas desde cargos | D12, **D13** |

## 16. Confirmaciones

**No hay implementación, ni SQL, ni migraciones, ni datos reales, ni backfill, ni cambios a RRHH/Vacaciones (PR #452 no se toca), ni FEL/INFILE, ni
contabilidad, ni PR ni merge.** Este documento solo propone; cada fase requiere autorización explícita.
