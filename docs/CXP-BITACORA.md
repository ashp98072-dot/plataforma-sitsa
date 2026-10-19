# Bitácora de Cuentas por pagar (CxP) — discovery y alcance

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (no probado manualmente en navegador, no aprobado para producción). Sin cambio de esquema ni SQL.

## Discovery (qué existía)

La infraestructura de auditoría (`auditoria` + `registrarAuditoriaTx`, solo INSERT, dentro de la transacción del llamador) ya estaba integrada en CxP:

| Operación | Acción en `auditoria` | Transaccional | Actor / empresa / entidad | Antes→después / motivo |
|---|---|---|---|---|
| Registrar factura de proveedor | `cxp_registrar_factura` | sí (mismo `commit`) | usuario, `usuarioId`, empresa, `entidadId` | importes e ISR calculados |
| Anular factura | `cxp_anular_factura` | sí | idem | motivo (≥3 car.), `antes/despues` |
| Registrar pago | `cxp_registrar_pago` | sí | idem | monto, medio, referencia, aplicaciones |
| Reversar pago | `cxp_reversar_pago` | sí | idem | motivo (≥3 car.), `antes/despues`, aplicaciones |
| Configuración fiscal del proveedor | `cxp_crear/actualizar_config_proveedor` | sí | idem | `antes` y `despues` completos |

Lo que **faltaba**: (1) una pantalla/consulta para leerlos, (2) un permiso para verlos, (3) en anulación/pago/reversión no constaban el documento, el proveedor, el total ni (en reversión) medio y referencia.

**No existe** edición de facturas de proveedor ni reversión parcial: no se inventan eventos para ellas.

## Qué se agregó

* Solo lectura sobre `auditoria`: `src/lib/contabilidad/cxp/bitacora.ts`. Siempre acotada por **empresa** (sesión) y **entidad** (ámbito); `detalle` es JSON y se filtra por `$.entidadId` (filas no JSON se descartan).
* Los eventos nuevos **agregan** campos al JSON (no se quita ninguno): anulación → `proveedorId, documento, total, neto`; pago → `documento` por aplicación; reversión → `fechaPago, medioPago, referencia`, `documento` por aplicación. Los eventos históricos se completan al leer (documento/proveedor/total desde `cxp_facturas` y `compras_proveedores`, siempre acotados por empresa y entidad).
* `GET /api/empresas/[slug]/contabilidad/cxp/bitacora` (filtros: acción, usuario, fechas, página) y pestaña **Bitácora** en Contabilidad → Cuentas por pagar.
* Permiso propio **`cxp_bitacora`** (acción de catálogo `cxp_ver_bitacora`, requiere `cxp_ver`). Ver facturas/pagos, registrar, anular o reversar **no** lo concede; ningún rol lo trae por defecto (Admin lo recibe).

## Contabilidad general y bancos (sin cambios)

* `asientos`, `eventos`, `registros` y `entidades` de Contabilidad **ya auditan** (`registrarAuditoriaTx` en `asientos.ts`, `eventos.ts`, `registros.ts`, `entidades.ts`). No tienen pantalla de historial; agregarla es otra decisión de alcance.
* **Bancos**: no hay en Contabilidad un módulo de movimientos bancarios. Las confirmaciones bancarias de cobros ya están cubiertas en la bitácora de Facturación/CxC.

## Fuera de alcance
Reglas fiscales, ISR, retención de IVA, nuevos flujos bancarios, SQL productivo.

## Opcional (requiere autorización, no implementado)
Columnas indexables (`usuario_id`, `entidad_id`, `objeto_tipo`, `objeto_id`) en `auditoria` evitarían el `JSON_EXTRACT` sobre todas las filas de la empresa; hoy basta para el volumen actual.
