# Facturación de viajes — Fase 1: viaje cerrado → viaje facturable → borrador de factura

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE (tsc, ESLint, pruebas con base de datos simulada, build). NO probado contra la base real ni con usuarios. NO aprobado para producción.**

Esta fase **no emite FEL**: no conecta con INFILE ni con la SAT, no usa credenciales FEL, no genera UUID/serie/número FEL, no crea pólizas ni cuentas por cobrar. Un test de arquitectura (`src/lib/facturacion/sin-fel-fase1.test.ts`) lo exige sobre el código del flujo.

Contexto: la auditoría de Milenium (`docs/AUDITORIA-MILENIUM-CONTABILIDAD-FACTURACION.md`) concluye que Milenium no conoce el concepto de «viaje» y que se factura a mano con texto libre. Esta fase conecta el viaje de la plataforma con un borrador de factura estructurado.

---

## 1. Hallazgo del discovery: ya existía FACT-1, se REUTILIZÓ

Antes de escribir código se inspeccionó el repositorio. **`fact_facturas`, `fact_factura_viajes` y `fact_pagos` ya existen y están en uso** (`sql/migrate-2026-08-fact-1-facturas-pagos.sql`; confirmadas como aplicadas en `docs/AUDITORIA-MIGRACIONES-ESTADO-REAL.md`), junto con su API, su pantalla (Operaciones → Facturación clientes), permisos granulares y auditoría. Por eso **no se creó ninguna entidad «documento por facturar»**: el borrador de factura de FACT-1 (`estado_admin = 'Borrador'`) **es** el documento por facturar. Crear otra tabla habría sido un segundo sistema de facturación paralelo.

| Pedido de la fase | Ya existía (FACT-1) | Se agregó (FACT-2) |
|---|---|---|
| Viaje facturable = Cerrado, del cliente, sin factura viva | `condicionesViajesPendientes`, `UNIQUE(plan_id)`, bridge `clientes.tms_cliente_id` | + tarifa comercial > 0, + ruta/destino identificable, + moneda única |
| Pantalla «Viajes por facturar» | pestaña «Viajes pendientes» | + columnas ruta, origen → destino, piloto, estado; + filtro por ruta |
| Selección de varios viajes del mismo cliente | `evaluarSeleccion` (UI) + validación en servidor | + misma moneda |
| Borrador de factura | `crearFactura` / `actualizarFacturaBorrador` | + líneas estructuradas, IVA desglosado, snapshots |
| Anti doble facturación | `FOR UPDATE` + `UNIQUE(plan_id)` | + bloqueo en orden estable, + defensa ante el duplicado en el INSERT, + conflicto de concurrencia como 409 |
| Cancelar borrador / liberar viajes | `anularFactura` (borra los vínculos) | etiqueta «Cancelar borrador» en la UI |
| Permisos | `requireTenantFacturacion` con `ver`/`crear`/`editar`/`emitir`/`anular`/`pagos` | endpoint de preview con `crear` |
| Auditoría | `registrarAuditoriaTx` | + totales, IVA, moneda y viajes en el detalle |
| Preview sin escritura | — | `previsualizarFactura` + `POST …/facturas/preview` |
| Cálculo de IVA | — | `src/lib/facturacion/impuestos.ts` |

## 2. Qué se creó

**Código**
- `src/lib/facturacion/impuestos.ts` — cálculo de IVA con `decimal.js` y la política vigente encapsulada.
- `src/lib/facturacion/borrador-calculo.ts` — lógica **pura** (sin DB): elegibilidad de un viaje, descripción de línea, totales. La comparten crear, editar y la vista previa, así que **no pueden divergir**.
- `previsualizarFactura` y la validación compartida en `src/lib/facturacion/facturas.ts`.
- `POST /api/empresas/[slug]/facturacion/facturas/preview`.
- UI: columnas y filtro de ruta en «Viajes pendientes»; paso «Previsualizar» antes de «Guardar borrador»; detalle del borrador con base/IVA/total por línea y resumen.

**SQL (solo propuesto, NO ejecutado)** — ver §9
- `sql/migrate-2026-10-fact-2-borrador-snapshots-iva.sql`
- `sql/preflight-2026-10-fact-2-borrador-snapshots-iva.sql` (solo lectura)

**No se creó**: ninguna tabla nueva, ningún estado nuevo, ninguna columna booleana «facturable».

## 3. «Facturable» se DERIVA, no se guarda

Un viaje es facturable cuando se cumple **todo** lo siguiente (una sola definición en SQL para el listado, el contador y el KPI, y su equivalente en `evaluarPlanFacturable` para el servidor):

| Regla | Dónde |
|---|---|
| Pertenece a la empresa de la sesión | `p.empresa_id = ?` — y en servidor el viaje se relee con `empresa_id` del actor |
| Está **Cerrado** (cierre administrativo, `viajes_cerrar`) | `p.estado = 'Cerrado'` |
| Su cliente TMS está vinculado a un cliente de Facturación | `cli.id IS NOT NULL` (puente `clientes.tms_cliente_id`) |
| **Tarifa comercial válida** (> 0) | `p.tarifa_comercial > 0` — *nuevo* |
| **Ruta válida**: tiene código de ruta o un destino identificable | *nuevo* |
| Sin factura viva (Borrador o Emitida) | `NOT EXISTS` sobre `fact_factura_viajes` |
| Misma moneda que el resto de la factura | validado al agrupar |

Por qué derivado y no un booleano: anular o cancelar una factura **borra** su fila en `fact_factura_viajes`, así que «no existe fila» ya significa «libre». Un booleano redundante podría quedar desincronizado; la derivación no puede.

«Cancelada/reemplazada que aún bloquee»: no existe ese caso en este modelo, porque anular borra los vínculos. «Marcado como facturado externamente»: ver §8.

El **estado** y la **empresa** no son filtros de la pantalla: el estado siempre es `Cerrado` y la empresa siempre es la de la sesión. Los filtros son cliente, fecha desde/hasta y ruta (código o destino).

## 4. Estados

Se mantienen los de FACT-1; no se introdujo ninguno nuevo.

| Estado | Significado hoy |
|---|---|
| `Borrador` | Documento por facturar. Editable. Sin número, sin fecha de emisión. Reserva sus viajes. |
| `Emitida` | Emisión **interna** de FACT-1 (número y fecha capturados a mano). **No es FEL.** Congelada; admite pagos. |
| `Anulada` | Borrador cancelado o factura anulada. Libera los viajes. Equivale al «CANCELADO» pedido. |

Extensión futura (no implementada, no hay ninguna columna ni lógica para ellos): `LISTO_PARA_EMITIR`, `EMITIDO_EXTERNO` (convivencia con Milenium), `EMITIDO_FEL`. Debe decidirse con Contabilidad si «Emitida» pasa a significar «emitida con certificación» o si se crea un estado aparte.

## 5. Cálculo de IVA

`calcularTotalesLinea({ montoLinea, porcentajeIva, precioIncluyeIva })` y `calcularTotalesFactura({ montosLinea, … })` en `impuestos.ts`.

- Aritmética decimal (`decimal.js`), redondeo half-up a 2 decimales.
- Con IVA incluido: `base = round(total / 1.12)` e `IVA = total − base`, así `base + IVA = total` exacto. `112.00 → 100.00 + 12.00`; `100.00 → 89.29 + 10.71`; `1000.00 → 892.86 + 107.14`.
- **El total del documento es la suma de las líneas ya redondeadas**, no un recálculo sobre el gran total. Ejemplo: 3 × Q100.00 → subtotal 267.87 + IVA 32.13 = 300.00 (calcular sobre el total daría 267.86). Es lo que el usuario ve línea por línea y suma exacto al pie.
- `monto_total` sigue siendo el **total con IVA**, así que pagos, saldos y KPIs de FACT-1 no cambian.
- **Política vigente** (`POLITICA_IVA_FACTURACION`): 12 % y `precioIncluyeIva = true`. Es un valor único e inmutable, **no una decisión cerrada**: cada borrador guarda la política con la que se calculó (`porcentaje_iva`, `precio_incluye_iva`), y cambiarla es cambiar ese valor.

## 6. Prevención de doble facturación

Capas, de la más débil a la más fuerte:
1. **UI**: no ofrece viajes ya facturados ni mezcla clientes/monedas (no es una defensa; solo ayuda).
2. **Servidor, siempre**: crear y editar **releen** cada viaje de la base (nunca confían en el payload) y revalidan cliente, empresa, estado, tarifa, ruta, moneda y vínculo.
3. **Transacción con `FOR UPDATE`** sobre cada viaje, en **orden ascendente de id** (dos usuarios con viajes en común toman los bloqueos en el mismo orden, así no se interbloquean). La fila del viaje es el punto de serialización: el segundo usuario espera al primero y luego ve el vínculo.
4. **`UNIQUE(plan_id)` en `fact_factura_viajes`** (ya existente): si algo se colara entre validar e insertar, la base rechaza el duplicado y la aplicación lo devuelve como **409**, con rollback completo (no queda factura a medias).
5. Un deadlock o `lock wait timeout` se devuelve como **409 reintentable**, no como error 500.

La **vista previa no reserva nada**: no abre transacción, no usa `FOR UPDATE`, no audita, no llama a `asegurarVinculosTmsClientes` (que escribe). Una preview correcta **no garantiza** que el viaje siga libre al guardar; por eso guardar revalida todo.

## 7. Snapshots («congelar datos»)

Al crear el borrador se guardan (columnas nuevas, ver §9):

- **Cliente** (en `fact_facturas`): nombre fiscal (razón social, o nombre comercial si no hay), NIT y dirección.
- **Por línea** (en `fact_factura_viajes`): código del viaje, fecha del viaje, código de ruta, origen, destino, descripción, cantidad (1), monto capturado, base, IVA, total.
- **Documento**: moneda, subtotal, IVA, porcentaje de IVA y si el precio incluía IVA.

Lectura: el detalle prefiere **siempre** lo congelado (`COALESCE(snapshot, dato vivo)`); el dato vivo solo rellena filas anteriores a FACT-2. El listado también muestra el nombre congelado del cliente.

Edición del borrador: **no refresca lo congelado**. Las líneas que siguen en el borrador conservan su fotografía y el cliente conserva la suya si no cambió de cliente. Se re-fotografía únicamente lo nuevo (viaje agregado, cliente cambiado, o filas anteriores a FACT-2 que no tenían snapshot).

Descripción de línea: `Servicio de transporte – {origen} → {destino} – {dd/mm/aaaa}`. El destino congelado del viaje (`lugar_descarga_historico`) manda sobre el catálogo vivo; lo desconocido se muestra como «—». Hay una línea por viaje y `viaje_id` se conserva como referencia estructurada (`plan_id`).

## 8. Convivencia futura con Milenium — «Facturado externamente» (NO implementado)

Hoy no existe nada equivalente en el repositorio. Se **documenta, no se implementa**, porque exige una tabla nueva y decisiones de Contabilidad. Diseño propuesto:

- Tabla aparte `fact_viaje_facturado_externo` (`empresa_id`, `plan_id` **UNIQUE**, `origen` — `MILENIUM`/otro —, `referencia`, `fecha_factura`, `observacion`, `registrado_por`, `creado_en`, y baja lógica con motivo).
- La condición de «facturable» (§3) agregaría un `NOT EXISTS` contra esa tabla; así sigue derivado.
- **No** modelarlo como una `fact_facturas` en estado `Emitida` con número externo: contaminaría KPIs, pagos y cobranza con documentos que viven en otro sistema.
- Preguntas para Contabilidad: ¿quién puede marcar/desmarcar?, ¿se permite deshacer?, ¿se carga la historia en bloque (con revisión previa) o viaje por viaje?, ¿cómo se concilia con el riesgo de doble facturación entre sistemas?

## 9. SQL que habría que aplicar (NO ejecutado)

**El código FACT-2 lee y escribe las columnas nuevas: el SQL debe aplicarse ANTES de desplegar.** Si se despliega sin aplicarlo, crear/editar borradores y leer facturas fallarán con «Unknown column». (No se agregó un modo degradado a propósito: guardar una factura sin su snapshot sería un fallo silencioso sobre datos financieros.)

Orden: (1) correr `preflight-2026-10-fact-2-borrador-snapshots-iva.sql` (solo lectura) y revisar; (2) aplicar `migrate-2026-10-fact-2-borrador-snapshots-iva.sql`; (3) desplegar.

La migración es aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`, MariaDB), todo `NULL`/`DEFAULT`, sin backfill, sin tocar índices ni FKs:
- `fact_facturas`: `moneda` (default `GTQ`), `subtotal`, `iva_monto`, `porcentaje_iva`, `precio_incluye_iva`, `cliente_nombre_snapshot`, `cliente_nit_snapshot`, `cliente_direccion_snapshot`.
- `fact_factura_viajes`: `codigo_viaje_snapshot`, `fecha_viaje_snapshot`, `ruta_codigo_snapshot`, `origen_snapshot`, `destino_snapshot`, `descripcion`, `cantidad` (default 1), `base_monto`, `iva_monto`, `total_linea`.

Facturas y borradores anteriores quedan con snapshot `NULL` y se muestran como siempre (solo `monto_total` / `monto_asignado`). Reversión: las columnas son opcionales; basta desplegar la versión anterior del código y, si se quisiera, `DROP COLUMN` (acción destructiva: solo con autorización).

## 10. Permisos y auditoría

Se reutilizan los permisos granulares de `facturacion` (no se creó ninguno):

| Acción pedida | Permiso | Endpoint |
|---|---|---|
| Ver viajes por facturar | `facturacion:ver` | `GET …/facturacion/viajes-pendientes` |
| Previsualizar / crear borrador | `facturacion:crear` | `POST …/facturas/preview`, `POST …/facturas` |
| Editar borrador | `facturacion:editar` | `PATCH …/facturas/[id]` |
| Cancelar borrador | `facturacion:anular` (el mismo permiso que anula una factura) | `POST …/facturas/[id]/anular` |

Si se quiere un permiso distinto para «cancelar borrador» frente a «anular factura emitida» hay que ampliar el catálogo de permisos: no se hizo en esta fase.

Auditoría (`auditoria`, módulo `facturacion`): crear y editar registran usuario, empresa, cantidad de viajes, moneda, subtotal, IVA, política, total y códigos de los viajes; anular registra la cancelación. No se guardan NIT ni dirección del cliente en la bitácora.

## 11. Decisiones tomadas y puntos para Contabilidad

1. **Política de IVA** (12 % incluido en el precio) — *pendiente de confirmar*: ¿`tarifa_comercial` incluye IVA? Si no, cambiar `POLITICA_IVA_FACTURACION`. Nada más cambia.
2. **Tarifa comercial obligatoria.** Antes un viaje sin tarifa podía facturarse en cero (había una prueba que lo exigía); ahora **no es facturable** hasta que tenga tarifa > 0. Aún se puede ajustar el monto de una línea, pero la tarifa de base debe existir. Cambio de comportamiento respecto de FACT-1: confirmar que no hay viajes legítimos sin tarifa que hoy se facturen a mano.
3. **Ruta válida = código de ruta o destino identificable.** Se eligió ese criterio porque un viaje armado a mano en Programación puede no tener ruta de catálogo; exigir ruta de catálogo ocultaría viajes facturables. Si Contabilidad exige ruta de catálogo, se endurece en `evaluarPlanFacturable` y en la condición SQL.
4. **Moneda**: se toma de `tarifa_moneda_historico` (vacío = GTQ). Una factura admite una sola moneda; mezclar se bloquea con explicación. El total de la base está pensado para quetzales: el IVA guatemalteco en otra moneda requiere decisión fiscal.
5. **Piloto visible** en «Viajes pendientes»: solo el **nombre**, a pedido de esta fase. FACT-1 lo había excluido a propósito (Facturación «no necesita ni debe ver» datos operativos) y una prueba lo verificaba; se reemplazó por una que permite únicamente el nombre y sigue excluyendo auxiliares, evidencias, paradas y GPS. Si el criterio de privacidad prevalece, es quitar un campo.
6. **Emisor legal**: aún no existe como dato (la configuración fiscal de la empresa está en el cuestionario `fact_empresa_perfil`, sin campos estructurados). Dentro de una empresa el emisor es la propia empresa, por lo que la regla «mismo emisor» se cumple por construcción; cuando haya varios emisores por empresa habrá que añadirla.
7. **Cancelar = anular** (mismo estado, mismo endpoint, mismo permiso). Ver §10.
8. **Rutas de API**: se adaptaron al patrón real del repositorio (`/api/empresas/[slug]/facturacion/…`), no a las rutas conceptuales del ticket; no se duplicó `GET/POST borradores` porque `facturas` ya es el recurso del borrador.

## 12. Qué queda pendiente para FEL (fuera de esta fase)

Sin FEL todavía: emisión/certificación con INFILE (endpoint, autenticación, sandbox e idempotencia oficial **sin confirmar**), serie/número/UUID, XML certificado, anulación fiscal, notas de crédito, almacenamiento seguro de credenciales (nunca en texto claro), proveedor FEL simulado para pruebas, pólizas contables, cuentas por cobrar, y la convivencia con Milenium (§8). Ver `docs/FEL-INFILE-*` y la auditoría de Milenium.

## 13. Verificación y límites

- **Hecho**: `tsc --noEmit`, ESLint, `git diff --check`, `npm run build` y toda la suite de vitest (resultado y comparación con `origin/main` en el PR).
- **Pruebas nuevas**: IVA y redondeo; elegibilidad del viaje; preview sin escritura; creación con snapshot; doble uso del mismo viaje (secuencial y por carrera en el INSERT); deadlock → 409; orden de bloqueo; cancelar libera viajes; snapshots no cambian al editar cliente/ruta; permisos; multiempresa; arquitectura sin FEL.
- **No hecho / pendiente**: la base de datos de las pruebas es una **simulación en memoria**; **no se probó contra MariaDB** (bloqueos reales, `UNIQUE`, collations, rendimiento de los `LEFT JOIN` nuevos) ni con dos sesiones simultáneas reales. No se probó la interfaz en un navegador con datos (esta sesión no tiene credenciales de base de datos). Hace falta una prueba manual en un ambiente de desarrollo/pruebas con el SQL aplicado antes de considerarlo **PROBADO**.
