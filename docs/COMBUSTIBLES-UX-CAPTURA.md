# Combustibles: captura separada y proveedores buscables

Base: main después de #473. Sin cambios a permisos, conciliación, cálculos monetarios ni esquema.

- Alta en `/e/[slug]/combustibles/nuevo`, guard servidor `requireTenantFlotaCombustible(slug, "registrar")`. También POST conserva su guard granular. Ver sin Registrar no entrega formulario por URL directa.
- Principal muestra enlaces Registrar vale y Estaciones conforme a capacidades de #473. Ya no monta alta inline; edición PENDIENTE sigue reutilizando el formulario. Revisión, resumen e historial/conciliación no cambian.
- Guardar/cancelar el alta navega una vez a Combustibles, sin refresh duplicado. Si falla guardar, permanece en el formulario con error y datos.
- Se reutiliza `CatalogoSearchSelect` **sin modificarlo** para proveedor en vale, proveedor al crear/editar estación y filtro por proveedor en estaciones. Input solo busca; select nativo elige ID real y conserva teclado nativo. Sin nombre manual. IDs controlados se envían como campos ocultos; validación server-side del catálogo/tenant permanece. Se conserva selección histórica ausente/inactiva al editar, no se agregan otras opciones inactivas.
- Estación sigue siendo selector activo por proveedor y empresa; cambiar proveedor limpia la estación incompatible. No cambia referencia nullable ni snapshot `gasolinera`.
- Se elimina toda captura de `viajeId` del formulario (visible y oculta). Campo omitido en POST produce NULL; en PATCH conserva `viaje_id` leído del vale bloqueado por empresa/id, nunca de texto del navegador. El contrato API sigue aceptando valor explícito como antes para clientes existentes; no se implementa derivación C-2. Se mantienen validaciones viaje/empresa/unidad. Cambiar a unidad incompatible no elimina el vínculo: devuelve error.

Sin SQL/migraciones/índices/FKs/backfill ni ejecución productiva. No se cambia catálogo de proveedores (`compras_proveedores`) ni se crea otro. Pruebas locales: búsqueda/IDs, render de formulario/listado, guards de nueva página, persistencia de viaje omitido y regresión de permisos/Combustibles. No equivalen a QA manual de navegador productivo.
