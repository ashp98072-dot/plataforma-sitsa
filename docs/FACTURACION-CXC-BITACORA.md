# Bitácora de Facturación + Cuentas por cobrar

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tests + MariaDB 11.8.9 desechable local). No probado con datos reales. **Sin cambio de esquema ni migración.**

## Discovery
| Pregunta | Hallazgo |
|---|---|
| Infraestructura | Tabla `auditoria` (`empresa_id, usuario, accion, modulo, detalle, creado_en`; sin usuario_id ni entidad_id) y `registrarAuditoriaTx(conn, …)` (INSERT sin transacción propia: el llamador decide; **solo inserta**, nunca actualiza ni borra). Ya hay un precedente de lectura sobre ella ("Bitácora del viaje": `listarAuditoriaPlan`, filtra por prefijo en `detalle`) |
| Eventos ya existentes en Facturación | `crear_factura`, `editar_factura_borrador`, `emitir_factura`, `anular_factura`, `registrar_pago` (en `facturas.ts`) y `confirmar_ingreso_bancario` / `anular_confirmacion_bancaria` (`confirmaciones-bancarias.ts`). Todos dentro de la **misma transacción** del movimiento (rollback conjunto) |
| Lo que les faltaba | usuario ID, entidad, número visible de la factura, qué cambió (edición), medio/referencia/saldo (cobro), motivo (anulación; ni siquiera existía el campo), y **ninguna pantalla para leerlos** |
| `fact_pagos` y el actor | `registrado_por` = ID del usuario (ya se conservaba); `fact_facturas.actualizado_por` guarda el último editor, no el historial |
| ¿Reutilizar sin segunda bitácora? | **Sí.** No hace falta tabla nueva ni columnas: se estandariza el `detalle` y se consulta por prefijo/JSON |
| ¿Cambio de esquema? | **No es necesario.** Propuesta opcional a futuro (no implementada, requiere autorización): agregar a `auditoria` columnas `usuario_id INT NULL`, `entidad_id INT NULL`, `objeto_tipo VARCHAR(30) NULL`, `objeto_id BIGINT NULL` + índice `(empresa_id, objeto_tipo, objeto_id)` para consultar sin `LIKE`/regex |

## Formato del evento
`detalle = «<texto legible que empieza por "Factura #<id> "> | #BIT <JSON>»`. Los eventos históricos (solo texto) siguen siendo válidos y se leen. El JSON (v1) contiene solo campos explícitos y acotados: `facturaId, usuarioId, numero, entidadId, monto, medioPago (≤40), referencia (≤120), motivo (≤500), cambios[{campo, antes, despues}]` (valores ≤200). Nunca contraseñas, tokens, NIT ni cuerpos de solicitud (probado).

## Eventos (todos con empresa, usuario, usuario ID, fecha/hora, factura, número visible y entidad)
| Acción | Qué se registra |
|---|---|
| `crear_factura` (Creó borrador) | número, entidad, monto total, resumen de líneas/viajes |
| `editar_factura_borrador` (Editó borrador) | **diferencias** antes→después de: cliente, entidad, número, fecha, nº de líneas, subtotal, IVA, % IVA, total, % de retención de IVA esperada (solo informativo; no se tocó ninguna fórmula) |
| `emitir_factura` (Emitió factura) | número final, fecha, monto, entidad; estado Borrador→Emitida (y número/fecha si cambiaron al emitir) |
| `anular_factura` (Anuló factura) | número, monto, entidad, estado Emitida/Borrador→Anulada y **motivo** (opcional, ≤500; nuevo campo en el endpoint y en la pantalla) |
| `registrar_pago` (Registró cobro) | monto, medio, referencia, número, entidad, **saldo antes→después** |
| `confirmar_ingreso_bancario` / `anular_confirmacion_bancaria` | enriquecidos con usuario ID, entidad/monto/referencia o motivo |
No hay reversión de cobros (no existe); por eso no se registra.

## Consulta
* **Factura:** `GET /facturacion/facturas/[id]/bitacora` → panel «Bitácora de la factura» (en el detalle). Permiso propio: acción `facturacion:ver_bitacora` (**sin equivalencia por rol**; ver/emitir/anular/pagar no la concede). Acotado por empresa de la sesión.
* **CxC:** `GET /contabilidad/cxc/bitacora?entidad=` → pestaña **Bitácora** en Contabilidad → Cuentas por cobrar (filtros: acción, usuario, fechas, paginación). Permiso propio `cxc_bitacora` (catálogo «Ver bitácora de movimientos de CxC», requiere `cxc_ver`); **no** exige Facturación, y ver CxC tampoco la concede. Trae los eventos de las facturas **de ese libro** (la entidad se toma de la factura, así también aparecen los eventos anteriores a esta bitácora).
* Formato visible: `19/10/2026 10:42 · admin · Registró cobro TEST-CXC-001 · Q1,000.00 · Transferencia · PRUEBA-CXC-001`.

## Transaccionalidad
Movimiento + evento en la misma transacción (`tx`/`transaccion`): si el movimiento hace rollback no queda evento, y si el evento falla se deshace el movimiento (probado con un trigger que fuerza el fallo). Los eventos son append-only: ningún código hace UPDATE/DELETE sobre `auditoria` (verificado por prueba).

## Límites / riesgos
* La consulta por factura usa `LIKE 'Factura #<id> %'` y la de CxC una expresión regular con unión a `fact_facturas`; ambas recorren los eventos de la empresa (índice por `empresa_id`). Suficiente hoy; el esquema opcional de arriba lo resolvería.
* El permiso `facturacion:ver_bitacora` y `cxc_bitacora` no los trae ningún rol: hay que asignarlos.
* La hora es la del servidor de base de datos (`creado_en`).
* El panel de pagos del detalle de Facturación (`facturas-panel.tsx`) sigue usando `Number(texto)` para el monto (no se tocó; ver fix de CxC #495).
