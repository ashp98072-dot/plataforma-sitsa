# Canecas — ventas, reportes comerciales y cierre de proveedores históricos (borrador)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (pruebas en MariaDB 11.8.9 mediante GitHub Actions). **NO PROBADO en producción. NO APROBADO PARA PRODUCCIÓN.** Nada de esto se ha ejecutado en Hostinger.

## Ventas
Una venta registra: cliente exclusivo de Canecas (de la empresa y activo), fecha, documento, producto, ubicación de la que sale, cantidad en canecas, precio por caneca en Q, importe total (precio × cantidad), costo FIFO real, utilidad bruta (importe − costo), usuario y estado (`ACTIVA` / `ANULADA`) con quién y cuándo anuló.
- **Atomicidad:** la venta y la salida FIFO se hacen en una sola transacción (`registrarVenta` reutiliza `ejecutarSalidaFifo` dentro de la misma conexión). Si algo falla, no queda ni salida ni venta.
- **Sin sobreventa:** el saldo se bloquea (`FOR UPDATE`) y se rechaza lo que exceda la existencia disponible (`SALDO_INSUFICIENTE`). Con unidades reservadas se rechaza (`RESERVAS_PENDIENTES`).
- **Sin duplicados:** `clave_operacion` única por empresa. Reintento con los mismos datos devuelve la misma venta (también si dos reintentos llegan a la vez); con otros datos, `CLAVE_REUTILIZADA`.
- **Venta ≠ salida de inventario:** una salida FIFO sin venta no genera ingresos. Una salida enlazada a una venta no puede revertirse por separado (409): se anula la venta.
- **Anulación controlada:** `anularVenta` reversa la salida (restaura exactamente las capas y el inventario), marca la venta `ANULADA` con motivo y responsable y es idempotente. Nada se borra: triggers impiden borrar y modificar ventas (salvo la transición a anulada, que luego es inmutable).
- **Costo desconocido:** si las capas a consumir no tienen costo, la venta se rechaza (`COSTO_PENDIENTE`): nunca se presenta una utilidad calculada con costos desconocidos. Los reportes avisan cuántas canecas siguen sin costo.
- **Moneda:** GTQ interno (`CHECK moneda='GTQ'`); la interfaz muestra Q. Precio mayor que Q0.00, con hasta dos decimales.
- **Permisos:** `canecas_ventas` (registrar, anular, ajustes y reportes). Costo y utilidad solo con el permiso de costos (`canecas_compras`); sin él se omiten en respuestas, historial y reportes.

## Ejemplo de utilidad (compras con costos distintos)
Compra A: 10 canecas a Q80.00. Compra B: 10 canecas a Q100.00 con Q10.00 de gastos (Q101.00 por unidad).
- Venta 1: 8 canecas a Q95.00 → importe Q760.00; costo FIFO 8 × Q80.00 = Q640.00; **utilidad Q120.00**.
- Venta 2: 6 canecas a Q120.00 → importe Q720.00; costo FIFO 2 × Q80.00 + 4 × Q101.00 = Q564.00; **utilidad Q156.00**.
- Período: ingresos Q1,480.00 − costo de ventas Q1,204.00 = **utilidad bruta Q276.00**. Las compras del período fueron Q1,810.00: **no** es el costo de ventas.
- Si la venta 1 se anula: ingresos Q720.00, costo Q564.00, utilidad Q156.00; las 8 canecas regresan al inventario con su costo original.
Tras un ajuste 20→25 (compra de 20 a Q100.00 = Q2,000.00), cada caneca cuesta Q80.00: vender 10 a Q100.00 deja costo Q800.00 y utilidad Q200.00.

## Reportes comerciales (filtros: fechas, producto y cliente)
Canecas compradas (por fecha de la compra), recibidas (recepciones confirmadas), extras y merma (ajustes vigentes), vendidas, existencias actuales, ingresos netos de ventas, costo de las unidades vendidas, utilidad bruta e historial de ventas y anulaciones.
- Utilidad bruta = ingresos de ventas **activas** − costo FIFO de esas mismas ventas (las anuladas no cuentan; se informan aparte).
- «Compras del período» es informativo y nunca se mezcla con el costo de ventas. Compras sin costo conocido se avisan y no suman.
- Las existencias son las actuales (no las de fin del período). Con un cliente seleccionado solo se muestran indicadores de ventas.

## Ajuste de canecas
Es el nombre visible de la redistribución (los nombres técnicos internos no cambian). Campos: compra, ubicación, canecas que quedan y motivo. Se puede revertir mientras las canecas del ajuste no se hayan vendido ni vuelto a ajustar.

## Cierre de proveedores históricos
Las compras históricas se conservan. La pantalla «Proveedores históricos» muestra el proveedor anterior solo como dato de lectura (`historico-proveedores.ts`, único acceso de Canecas a Compras y solo con SELECT) y permite asignar manualmente un proveedor exclusivo de Canecas. Cada asignación queda en `canecas_compras_mapeo_proveedor` (quién y cuándo, inmutable). No se reasigna nada automáticamente y no se elimina ninguna columna ni clave antigua.

## Migración, contrato e instalación controlada (no ejecutar sin respaldo, contrato revisado y autorización)
`sql/migrate-2026-11-canecas-ventas-wip.sql` crea solo `canecas_ventas`, `canecas_compras_mapeo_proveedor` y 4 triggers; no modifica tablas ni datos existentes. Orden: fase 1 → costos → salidas → redistribución → catálogos → ventas.
```sh
node scripts/ci/canecas/ejecutar-ventas-controlado.mjs --ejecutar
```
Comprueba versión 11.8.9 y privilegios (SELECT, CREATE, INDEX, REFERENCES, TRIGGER), toma el bloqueo cooperativo, activa modos estrictos, exige toda la cadena instalada contra sus contratos, ejecuta 6 DDL por separado deteniéndose ante cualquier advertencia y compara el contrato posterior (`contrato-ventas-mariadb-11.8.9.json`, generado en MariaDB 11.8.9). Idempotente. Ante error queda una instalación parcial: no reintentar; ejecutar `sql/recuperacion-canecas-ventas-solo-lectura.sql` y restaurar el respaldo. El código requiere las tablas: instalar antes de desplegar.

## Decisiones pendientes
1. Las ventas con costo desconocido se rechazan; si negocio necesita venderlas y completar el costo después, requiere una regla contable aparte.
2. Fecha de las compras en reportes: se usa la fecha de registro de la compra.
3. La contracción de la relación anterior de proveedores (retirar la FK) queda para cuando todas las compras estén asignadas (`verificarMapeoProveedoresCompleto` es la compuerta).
4. Devoluciones parciales no existen: se anula la venta completa.
