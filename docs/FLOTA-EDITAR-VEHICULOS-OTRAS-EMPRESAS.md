# Flota — edición de vehículos compartidos / de otras empresas

Base: `98c94c7be4a0284e73c830e285b0c7f9834c59a6`. **Sin SQL** (el permiso se guarda como una fila más de `usuario_modulo`, `modulo VARCHAR(40)`; la clave tiene 30 caracteres).

## Causa del bloqueo
- **UI:** `empezarEdicion()` en `src/app/e/[slug]/flota/flota-client.tsx` salía con «Este vehículo es compartido; solo la empresa dueña puede editarlo.» cuando `v.esDueno === false`
  (`esDueno = empresa del vehículo === empresa activa`, calculado por `GET /flota/vehiculos`). El enlace «Editar» de la lista se mostraba igualmente.
- **Backend:** el bloqueo estaba **solo en la UI**. `PATCH /flota/vehiculos` buscaba el vehículo con `obtenerVehiculoAccesible` (propio o compartido con la empresa activa) y, salvo
  `reiniciarKilometraje`, `accesoEmpresaIds` y `tipoUnidad`, **aceptaba la edición de un vehículo compartido por API** (y el `UPDATE` iba solo por `WHERE id = ?`). Es decir: la regla
  «solo la dueña» no se hacía cumplir en el servidor. Este cambio la hace cumplir y, a la vez, abre la excepción por permiso.

## Regla nueva (única, en `src/lib/flota/edicion-vehiculo.ts`, usada por backend y UI)
`puedeEditarVehiculo = esEmpresaPropietaria  OR  (permiso «flota_vehiculos_otras_empresas:editar» AND el vehículo es accesible desde la empresa activa)`.
«Accesible» es la **regla real ya existente** (`obtenerVehiculoAccesible` / `listarVehiculosAccesibles`, `src/lib/flota/acceso.ts`): el vehículo es propio de la empresa activa o está explícitamente compartido con ella (`flota_vehiculo_acceso`). No es una condición paralela.
**El usuario NO necesita acceso directo a la empresa propietaria** (decisión de negocio): basta que el vehículo esté compartido y visible en la empresa activa. Esto **no es acceso global**: un vehículo de otra empresa que no esté compartido con la activa, o de otro tenant, no es accesible (404) y no se puede editar aunque se manipulen ids.
Sin `if usuario === …` ni `if rol === …`: la autoridad es el permiso. Admin lo tiene por el catálogo global (bypass administrativo ya existente); cualquier otro usuario lo recibe desde Usuarios.

## Permiso
- Clave `flota_vehiculos_otras_empresas` (acción `editar`), en `PLATAFORMA_PERMISIBLES`, grupo «Flota / Predios», depende del módulo de empresa `flota`.
  Etiqueta «Editar vehículos de otras empresas» + descripción en la matriz de Usuarios («Permite modificar datos de vehículos pertenecientes a otras empresas del mismo entorno corporativo…»).
- **Ningún rol lo trae por defecto** (no se abre la edición cruzada a todos); Admin lo recibe por catálogo. Es asignable a cualquier rol con acceso a Flota (CoordinadorPredios, CoordinadorCompras, Operaciones, etc.).
- **No existe un rol «Encargado de Taller»** en `ROLES` (`src/lib/roles.ts`): el encargado de taller es un usuario con otro rol (típicamente Predios). Un Admin debe marcarle «Editar vehículos de otras empresas» (y darle acceso a las empresas propietarias). No se creó un rol nuevo.

## Backend (`PATCH /api/empresas/[slug]/flota/vehiculos`)
1. Reconsulta el vehículo en la BD (`obtenerVehiculoAccesible` con la empresa activa de la **sesión**); 404 si no es accesible. La empresa propietaria sale de esa fila: **nunca** de un `empresa_id` del cliente (se ignora).
2. `decidirEdicionVehiculo`: propietaria ⇒ edita; otra empresa ⇒ solo con el permiso **y** vehículo accesible desde la empresa activa (el hecho de haberlo encontrado con `obtenerVehiculoAccesible`). Si no hay permiso: **403**. Un vehículo no accesible ni siquiera se encuentra: **404**.
3. La única operación permitida sin la regla sigue siendo **enviar / sacar de taller** de una unidad compartida (`{id, enTaller, motivoTaller}`): cada acción conserva su permiso (`flota_vehiculos:editar`) y no se amplía nada.
4. Siguen siendo solo de la dueña, **aun con el permiso**: cambiar con quién se comparte (`accesoEmpresaIds`), el tipo de unidad (`tipoUnidad`) y limpiar kilometraje (`reiniciarKilometraje`) → 403. Dar de baja / eliminar / papelería no cambian (solo la dueña; `DELETE` ya filtraba por `empresa_id`).
5. Los campos del formulario normal (placa, marca, modelo, año, descripción, color, kilometraje, intervalos, filtros, rin, medida, aceite, notas, estado/activo) se editan igual que una edición normal; `filtros` ahora también por la regla (antes solo la dueña).
6. **La propiedad no cambia:** el `UPDATE` nunca asigna `empresa_id` y se acota por `WHERE id = ? AND empresa_id = <propietaria real>` (también el fallback). El vehículo conserva su empresa dueña, el indicador «compartida» y sus accesos.
7. **Auditoría:** solo la edición transversal (la de la propia empresa y la operación de taller no cambian), una vez: `editar_vehiculo_otra_empresa` / módulo `flota_vehiculos`, con vehículo, empresa propietaria, empresa activa y usuario (la fecha/hora la pone la tabla `auditoria`).

`GET /flota/vehiculos` devuelve ahora, por vehículo, `puedeEditar` (la misma decisión) y `puedeEditarOtrasEmpresas`; así la UI nunca ofrece una acción que el backend rechazará.

## UI
- Sin permiso: «Editar» no se ofrece en vehículos de otras empresas (se muestra «Solo empresa dueña», con la explicación) y, si se intenta, el mensaje de siempre.
- Con permiso: «Editar» abre el formulario con un aviso informativo (no un error): «Vehículo propiedad de {empresa}. Tienes permiso para editar vehículos compartidos de otras empresas.» Se ocultan lo que solo define la dueña (tipo de unidad, empresas con las que se comparte, Dar de baja, Eliminar y papelería) y esos datos no viajan.

## Taller, servicios e historial (coherencia)
Antes: Taller podía **enviar a taller, registrar servicio y ver historial** de un vehículo compartido (esas rutas usan `obtenerVehiculoAccesible` y su propio permiso `flota_servicios`) pero **no editar** sus datos. Ahora puede editarlo si tiene el permiso nuevo.
Esas acciones **no cambian** y siguen usando cada una su permiso; el permiso nuevo no las amplía.

## Pruebas
`src/lib/flota/edicion-vehiculos-multiempresa.test.ts`: A propietaria; B sin permiso (403 en API y operación de taller aún disponible); C con permiso (incluye propiedad intacta, `empresa_id` del cliente ignorado y filtros); D Encargado de Taller con permiso en varias empresas;
E Admin; 2 Taller sin acceso directo a la propietaria; 4 vehículo no compartido (404); 5 otro tenant (guard / 404); 6 propiedad intacta; 7 operaciones solo-dueña; H UI; auditoría; catálogo (no se concede por defecto, asignable, descripción, grupo). `acceso-vehiculo-edicion.test.ts` ejecuta la regla real de `obtenerVehiculoAccesible` con una base simulada.
