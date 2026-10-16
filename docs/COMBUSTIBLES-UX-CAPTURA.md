# Combustibles: captura separada y proveedores buscables

Base: main después de #473. Sin cambios a permisos, conciliación, cálculos monetarios ni esquema.

- Alta en `/e/[slug]/combustibles/nuevo`, guard servidor `requireTenantFlotaCombustible(slug, "registrar")`. También POST conserva su guard granular. Ver sin Registrar no entrega formulario por URL directa.
- Principal muestra enlaces Registrar vale y Estaciones conforme a capacidades de #473. Ya no monta alta inline; edición PENDIENTE sigue reutilizando el formulario. Revisión, resumen e historial/conciliación no cambian.
- Guardar/cancelar el alta navega una vez a Combustibles, sin refresh duplicado. Si falla guardar, permanece en el formulario con error y datos.
- Se reutiliza `CatalogoSearchSelect` **sin modificarlo** para proveedor en vale, proveedor al crear/editar estación y filtro por proveedor en estaciones. Input solo busca; select nativo elige ID real y conserva teclado nativo. Sin nombre manual. IDs controlados se envían como campos ocultos; validación server-side del catálogo/tenant permanece. Se conserva selección histórica ausente/inactiva al editar, no se agregan otras opciones inactivas.
- Estación sigue siendo selector activo por proveedor y empresa; cambiar proveedor limpia la estación incompatible. No cambia referencia nullable ni snapshot `gasolinera`.
- Se elimina toda captura de `viajeId` del formulario (visible y oculta). Campo omitido en POST produce NULL; en PATCH conserva `viaje_id` leído del vale bloqueado por empresa/id, nunca de texto del navegador. El contrato API sigue aceptando valor explícito como antes para clientes existentes; no se implementa derivación C-2. Se mantienen validaciones viaje/empresa/unidad. Cambiar a unidad incompatible no elimina el vínculo: devuelve error.

Sin SQL/migraciones/índices/FKs/backfill ni ejecución productiva. No se cambia catálogo de proveedores (`compras_proveedores`) ni se crea otro. Pruebas locales: búsqueda/IDs, render de formulario/listado, guards de nueva página, persistencia de viaje omitido y regresión de permisos/Combustibles. No equivalen a QA manual de navegador productivo.

## Ajuste posterior (vale ↔ estación): proveedor derivado, unidad y estación buscables

Base: `main` = `af11a7ba` (C-2B). **Sin SQL, migración, índice, FK ni backfill.** No toca `solicitud_fondo_linea_id`, importaciones HALEL, huellas, conciliaciones ni tablas C-2B.

- **Registrar vale ya NO muestra Proveedor.** Campos: Unidad / placa, Número de vale, Fecha de consumo, Combustible, Galones, Monto, Kilometraje,
  Estación / gasolinera, Evidencia, Observaciones y Solicitud de fondo. Esto **reemplaza** lo dicho arriba sobre «proveedor en vale» y «cambiar
  proveedor limpia la estación».
- **El proveedor se DERIVA de la estación en el servidor** (`guardarCombustibleStaff`): se lee `flota_combustible_estaciones` por empresa+id, se bloquea el
  proveedor y se revalida bajo bloqueo (empresa, proveedor, actividad). `proveedorId` sigue aceptándose solo por compatibilidad: si llega y no
  coincide con el de la estación, **se rechaza** («La estación no pertenece al proveedor indicado.»); nunca se persiste tal cual. Se conserva el orden de
  bloqueos proveedor → vale → estación.
- **Vale nuevo = estación catalogada obligatoria** (necesitamos proveedor confiable para conciliación C-2B/C-2C). Sin estación: «Selecciona la
  estación de combustible…». Si la empresa no tiene estaciones activas, el formulario muestra **«Debes registrar primero la estación de combustible.»**
  con enlace a `/e/[slug]/combustibles/estaciones` y deshabilita Guardar. **No se crean estaciones desde el vale.**
- **Históricos intactos:** un vale sin estación puede editarse sin ella y **conserva `gasolinera` y `proveedor_id`** (incluso NULL en los del portal);
  un vale con estación no puede quedarse sin ella; elegir otra estación recalcula proveedor y snapshot; omitir `estacionId` conserva los tres. Una estación
  inactiva se mantiene en el vale que ya la tenía, pero no se puede elegir en uno nuevo. Sin backfill.
- **Selector buscable de Unidad / placa** (`CatalogoSearchSelect`, «Buscar placa o unidad...»): busca por placa y descripción; se ve «Placa · descripción»;
  conserva la unidad histórica («… (histórico)»); sin nombre manual.
- **Selector buscable de Estación / gasolinera** («Buscar estación o proveedor...»): se ve «Estación · Proveedor» (sin IDs); busca por nombre, proveedor y
  dirección/referencia; solo activas en vales nuevos; conserva la estación histórica por su nombre. El catálogo (`/catalogos`) ahora trae
  `proveedorNombre` y `direccion` de cada estación (sin endpoint nuevo). `/catalogos` responde siempre JSON (antes un fallo daba 500 vacío).
- El mantenimiento de **Estaciones conserva el proveedor** (vínculo a `compras_proveedores`), su filtro, nombre, dirección y activo/inactivo.
