# Planes / Viajes — Vehículo solicitado + navegación horizontal en PC

## Discovery del dato «Vehículo solicitado»
- **Se guarda ya, en el viaje:** `tms_planes_viaje.vehiculo_solicitado_perfil_id` (FK compuesta `(empresa_id, perfil)` → `tms_cotizacion_costeo_perfiles`) **y** `tms_planes_viaje.vehiculo_solicitado_nombre` (**fotografía** del nombre al elegirlo). Migración existente: `sql/migrate-2026-10-programacion-vehiculo-solicitado.sql` (ya en el repo y en `schema.sql`).
- **Cómo llega:** Programación (`plan-form.tsx`) lo envía como `vehiculoSolicitadoPerfilId`; `POST/PATCH /tms/planes` resuelve el perfil activo de la empresa y escribe id + nombre. `GET /tms/planes` y el reporte ya lo seleccionan (`p.vehiculo_solicitado_perfil_id, p.vehiculo_solicitado_nombre`, con reintento sin columnas si la migración no está aplicada) y el cliente de Planes / Viajes ya lo recibe como `vehiculoSolicitado`.
- **Conclusión: NO hace falta SQL, JOIN ni snapshot nuevo.** Solo mostrar el campo ya existente.
- **Histórico:** al mostrar la fotografía guardada en el viaje, el valor no cambia si después se renombra/desactiva el perfil, se cambia la ruta o la unidad asignada (son datos independientes; los viajes anteriores a la funcionalidad muestran «—», nunca se infiere de la unidad).
- **Tarifa/cobro:** la tarifa comercial es independiente de este campo (se guarda aparte); este ticket no toca cálculos de tarifa, cierre, liquidación, facturación ni cobro.

## Cambios
1. **Columna `Vehículo solicitado`** entre `Ruta` y `Placa / Unidad` (antes aparecía como una línea «Solicitado: …» bajo la placa). Cabecera con ayuda: lo pedido comercialmente por el cliente; `Placa / Unidad` = unidad que realmente hace el viaje. Aplica también al modo reporte (misma tabla).
2. **Barra horizontal fija (`TablaConBarraHorizontal`)**: barra «proxy» `sticky bottom-0` que solo aparece si hay desborde horizontal **y** la tabla está en pantalla, solo en ≥ 1024 px (tablet/móvil usan el dedo). Sincroniza ambos sentidos copiando `scrollLeft` **solo si difiere** (sin timers ni banderas, sin bucles); no toca el scroll vertical; la barra nativa del contenedor se conserva como respaldo.
3. **Columnas fijas a la izquierda** (≥ 1024 px): `Sel.` (si existe), `Código`, `Fecha`, `Cliente`; anchos fijos (≈ 26–29 rem), fondo opaco heredado de la fila (normal, amarilla de liquidación pendiente, hover). Las filas de grupo (colSpan) no cambian. Por debajo de 1024 px no se fija nada.
4. **Encabezado sticky — evaluado, NO implementado.** `<thead>` ya traía `sticky top-0`, pero con un contenedor `overflow-x:auto` el `sticky` se ancla al contenedor (que no tiene scroll vertical), así que es inoperante. Hacerlo efectivo exige o (a) darle a la tabla su propio scroll vertical (altura máxima + `overflow-y`), lo que **cambia el scroll vertical**, o (b) un encabezado flotante clonado y sincronizado en ancho/scroll (más frágil). Se deja para un ticket aparte; la barra fija resuelve el problema principal.

## Validación visual
Harness estático con el CSS real y la misma lógica de sincronización (viewport 1280 px, oscuro): columnas fijas en `left` exactos (0/2.5/12/17.75 rem con Sel.), fondo opaco incluso en filas amarillas, barra pegada al borde inferior, rueda → barra y arrastre de barra → tabla con el mismo `scrollLeft` y sin bucle de eventos, `scrollY` intacto; a 900 px `position: static` (no se fija nada).
