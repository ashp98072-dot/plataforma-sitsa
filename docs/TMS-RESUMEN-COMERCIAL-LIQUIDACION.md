# TMS — Fase 5: Resumen comercial de liquidación por viaje

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local** (tsc, ESLint, pruebas unitarias y de BD contra MariaDB 11.8.9
desechable). No probado manualmente en navegador; no aprobado para producción. **Sin SQL, sin migración, sin backfill, sin escrituras.**

## Secuencia de negocio (confirmada, no modificada)

Viaje realizado → Reporte recibido → Ajustes / cargos adicionales → Cerrar viaje → Liquidar → **Facturación / reportes**.

Esta fase es la **base de lectura** para esa última etapa: consolida lo comercial de un viaje en un solo lugar. No factura, no
emite FEL, no crea asientos, no calcula impuestos y no cambia estados.

## 1. Discovery — qué existe en el modelo [CONFIRMADO en código]

| Concepto | Fuente | Observación |
|---|---|---|
| **A. Tarifa base** | `tms_planes_viaje.tarifa_comercial` (+ `tarifa_moneda_historico`) | Valor comercial del viaje; el snapshot de tarifa es informativo. |
| **B. Cargos adicionales** | `tms_viaje_cargos_adicionales` (`activo = 1` = vigente) | Fase 4. Anulado ⇒ `activo = 0` y no suma. |
| **C. Gastos reales** | `tms_gastos_operativos` (`plan_id`, `cantidad × monto`, `estado`, `activo`) | Hay flujo de autorización: `Pendiente / Autorizada / Rechazada`; `estado IS NULL` = histórico **para siempre** (decisión GASTOS fase 6). |
| **Anticipos** | `tms_solicitud_fondo_lineas.plan_id` ← `tms_solicitudes_fondo.estado` | Es lo **solicitado**; no tiene vínculo con los gastos. **No es gasto real.** |
| Costo tercerizado | `tms_planes_viaje.costo_tercerizado` | Solo viajes Tercerizados; informativo. |
| Snapshot de liquidación | `tms_viaje_liquidacion_eventos.snapshot_json` (LIQUIDADO/RELIQUIDADO) | Lleva tarifa y, desde la Fase 4, `operativo.cargos`. Los anteriores **no** traen cargos. |
| Facturación | `fact_factura_viajes` UNIQUE(`plan_id`) | **No se toca ni se lee** en el resumen. |

## 2. Decisiones

1. **Servicio único** `obtenerResumenLiquidacionViaje(empresaId, planId, { incluirCostos })` (`src/lib/tms/resumen-liquidacion.ts`) y
   su parte pura `resumen-liquidacion-shared.ts` (segura para cliente). Lote para listados: `resumenComercialDePlanes`
   (reutiliza `resumenCargosDePlanes`, **una** consulta agrupada por plan; sin N+1).
2. **Subtotal comercial = tarifa base + cargos vigentes**, aritmética exacta (Decimal), etiquetado **«Subtotal comercial (antes de
   impuestos)»**. Nunca «total factura». **No hay IVA** (`tratamientoIva: "PENDIENTE"`): ni se suma, ni se resta, ni se asume incluido.
3. **Los costos no pueden entrar al subtotal por construcción**: `construirBloqueComercial` no tiene costos como parámetro; una
   prueba de mutación (sumar el costo al subtotal) hace fallar la prueba de BD.
4. **Costos internos = bloque separado**, solo informativo:
   - `costoRegistrado` = gastos **activos y Autorizados** (por categoría).
   - **No incluidos** y reportados aparte: Pendientes, Rechazados, Históricos (`estado IS NULL`) e inactivos (ni se cuentan).
   - **Anticipos de fondo**: lo solicitado por estado de la solicitud; jamás se suma al costo.
   - Costo tercerizado: informativo, aparte.
5. **Margen informativo: NO implementado.** No existe un costo interno real y completo por viaje (viáticos programados vs. reales,
   combustible de Flota sin vínculo por viaje, pagos a terceros, anticipos ≠ gasto). Un margen con costos parciales sería engañoso.
   El resumen declara `margen: { disponible: false, motivo }` y la pantalla lo explica.
6. **Fuente de importes y consistencia histórica**: el resumen muestra los datos **actuales** (tarifa + cargos vigentes) y, aparte,
   lo **congelado** por la última liquidación (snapshot append-only existente; **no se crea un snapshot nuevo**):
   `snapshotComercial { version, liquidadoEn, tarifaBase, incluyeCargos, cargosTotal, subtotalComercial, difiereDelActual }`.
   - Liquidado antes de la Fase 4 ⇒ `incluyeCargos: false`: **no se infiere** un total congelado.
   - `EN_AJUSTE` ⇒ «Sujeto a cambios»; `LIQUIDADO` ⇒ «finalizado». Si lo actual difiere de lo congelado se marca `difiereDelActual`.
   - No se modifica ningún dato histórico.
7. **Permisos**: la parte comercial usa la visibilidad del listado de viajes (`programacion:ver` o `tms:ver`). Los costos exigen
   `requireTenantGastos(slug, "ver")` (el mismo guard de Gastos y Fondos). Sin él, el servicio **ni ejecuta** el SQL de gastos/fondos y la
   respuesta lleva `costosAutorizado: false, costos: null` (filtrado en backend, no en UI). No hay permisos nuevos.
8. **Tenant**: toda consulta lleva `empresa_id` de la sesión; el cuerpo/URL no puede cambiarla; un viaje de otra empresa es 404.

## 3. Qué se entrega

| Pieza | Archivo |
|---|---|
| Lógica pura (tipos, aritmética, etiquetas) | `src/lib/tms/resumen-liquidacion-shared.ts` |
| Servicio de lectura + lote | `src/lib/tms/resumen-liquidacion.ts` |
| Endpoint `GET /api/empresas/[slug]/tms/planes/[id]/resumen-liquidacion` | `src/app/api/empresas/[slug]/tms/planes/[id]/resumen-liquidacion/route.ts` |
| Sección «Resumen de liquidación» en el detalle del viaje | `src/components/tms/resumen-liquidacion-viaje.tsx` + `planes-viajes-client.tsx` |
| Columnas «Cargos» y «Subtotal com.» en Planes/Viajes y en el reporte | `reportes-viajes.ts` (`cargosAdicionales`, `subtotalComercial`) |
| Excel: columnas separadas al final | `reportes/viajes/export/route.ts` |

Excel (al final; no se reubica ninguna columna existente): **Cargos adicionales**, **Subtotal comercial (antes de impuestos)**,
**Estado liquidación**. La tarifa base sigue en «Valor del viaje». Costos/gastos **no** se exportan. PDF/JPG: **no se modifican**
(no se garantiza limpieza visual sin una revisión de maquetación; queda fuera de esta fase).

## 4. Campos incluidos / excluidos

- **Incluidos**: planId, código, estado del viaje, fecha, cliente, ruta (código/origen/destino), tarifa base, moneda, cargos
  vigentes (lista + total), subtotal comercial, estado y versión de liquidación, snapshot congelado, y (con permiso) costos internos
  separados.
- **Excluidos a propósito**: IVA/impuestos, total de factura, estado de facturación/FEL, asientos o cuentas, viáticos, combustible de
  Flota, fondos como costo real, qué gastos serían trasladables al cliente, margen.

## 5. Riesgos y reglas de negocio aún bloqueadas

1. **IVA de los cargos adicionales y de la tarifa**: sin definición de negocio/fiscal; el subtotal es «antes de impuestos».
2. **Costo real por viaje**: sin regla para viáticos reales, combustible por viaje y pagos a terceros ⇒ **no hay margen**.
3. **Gastos trasladables al cliente**: ninguno se traslada al subtotal; hace falta una regla explícita (qué categorías, con qué marca).
4. **Gastos históricos (`estado IS NULL`)** quedan fuera del costo registrado por decisión previa; se muestran como «históricos».
5. **Snapshots anteriores a la Fase 4** no tienen cargos: la comparación solo aplica a liquidaciones posteriores.
6. El endpoint hace 1 consulta de plan + 1 de liquidación + 1 de cargos + 1 de snapshot (+3 de costos solo con permiso): es de **detalle
   por viaje**; los listados usan el lote.

## 6. Pruebas

- Puras: aritmética exacta, sin IVA, sin NaN, estados, etiquetas y que los costos no son parámetro del bloque comercial.
- Endpoint: permisos, id inválido, empresa de la sesión, con/sin gastos, 404 por otra empresa, solo GET.
- BD (MariaDB 11.8.9 desechable, SQL real de Fase 1 y 4): tarifa sin cargos, tarifa + cargos exactos, cargo anulado, otra empresa,
  sin liquidación / REPORTE_RECIBIDO / LIQUIDADO / EN_AJUSTE con snapshot, sin tarifa, costos (autorizado/pendiente/rechazado/
  histórico/inactivo/anticipos/tercerizado) con y sin permiso (el SQL de gastos ni se ejecuta), lote en **una** consulta, y
  **no escribe nada** (huella idéntica de plan, liquidación, eventos, cargos, gastos, fondos, facturación, FEL, contabilidad, auditoría).
- Reportes/Excel/UI: cargos por lote (anti N+1), sin consulta de gastos, columnas al final, cableado de la pantalla.
- Mutación: sumar el costo al subtotal es detectado por la prueba de BD.
