# Placas duplicadas entre empresas: eliminar, identidad física e historial

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (mensaje de eliminación y pruebas) · diagnóstico SQL **pendiente de ejecutar** por el propietario · no hay migraciones, fusiones ni cambios de datos.

## Por qué existen dos fichas con la misma placa
La unicidad de `flota_vehiculos` es `(empresa_id, placa)`: la misma placa puede existir una vez por empresa. Una ficha propia de otra empresa y una ficha compartida pueden coincidir en placa sin que nada las relacione. **La placa por sí sola no demuestra que sea la misma unidad física.**

## Por qué no se puede eliminar
- **Ficha compartida (la empresa activa no es dueña):** la interfaz bloquea («Solo la empresa dueña puede eliminar este vehículo») y la API solo opera sobre `empresa_id = empresa activa`.
- **Ficha propia con registros que la referencian:** claves foráneas `ON DELETE RESTRICT` (líneas de solicitudes de fondos, gastos operativos, líneas de requerimientos de compra, membresías de identidad física…) hacen fallar el `DELETE`. Antes devolvía un 500 genérico; ahora devuelve **409** con el tipo de registro y la alternativa («Dar de baja» o Identidades físicas). La transacción se revierte igual que antes; no se borra nada.
- También bloquean: historial de multas (409 existente) y viaje abierto (409 existente).
- Eliminar definitivamente borra viajes, lecturas, servicios y filtros de la ficha: **no es la vía para consolidar duplicados.**

## Cómo consolidar sin mover historial (identidad física, M3)
1. Cada empresa dueña registra el **chasis real** de su ficha con respaldo documental (tarjeta de circulación). Sin chasis válido (6–32 caracteres alfanuméricos, no repetido, no «DESCONOCIDO/PENDIENTE/SINDATO/NOAPLICA») no se puede proponer: lo exigen `verificarIdentidad` y el trigger `fifi_nueva`.
2. Un administrador con acceso a ambas fichas **inspecciona y propone** la identidad (Flota → Combustibles CB2 → Identidades físicas).
3. El administrador de **cada** empresa dueña **aprueba** con evidencia. Solo con todas las aprobaciones pasa a `APROBADA`; se vuelve a comprobar que no haya operaciones abiertas.
4. Si los chasis son distintos o los tipos difieren, **son unidades distintas** que comparten placa: no se unen.

El control de las cinco parejas conocidas (651/1300, 602/1296, 603/1297, 684/1301, 638/1299) se hace con `sql/diagnostico-2026-11-flota-placas-duplicadas-parejas.sql` (solo lectura); su sección B da un veredicto por pareja sin asumir identidad.

## Una sola unidad en catálogos e importador Shell
Con una identidad **aprobada**, `catalogoSinAlias` deja **una opción por identidad** en: catálogo CB2 (importador Shell), combustible de Staff, disponibilidad de Operaciones y catálogos TMS. Cada empresa ve su **propia** ficha como representante (si no tiene, la accesible de menor ID). Los ID históricos siguen resolviendo a la unidad canónica. El catálogo administrativo de Flota/Predios sigue listando todas las fichas (con el aviso de posibles duplicados): es a propósito.

## Qué se conserva (historial)
La identidad física **no reasigna ni borra nada** (`historicosReasignados = 0`): kilometraje (`flota_lecturas`, `km_actual`), mantenimiento (`flota_servicios`, filtros), combustible (`flota_cb2_*`), TMS (`tms_unidades`, `tms_planes_viaje`) y fondos (`tms_solicitud_fondo_lineas`) permanecen en la ficha y empresa originales con sus claves intactas. Las consultas de historial siempre filtran por `empresa_id`: **una empresa no ve el historial de otra** aunque comparta identidad (p. ej., la empresa dueña de la ficha con 0 km no ve los kilómetros de la otra). Cada aprobación queda en `flota_identidad_aprobaciones` y en la auditoría.

## Riesgos
- Registrar un chasis equivocado podría vincular unidades distintas: por eso se exige documento y la aprobación de ambas empresas.
- Aprobar con viajes u operaciones abiertas está bloqueado.
- Este cambio no toca M1, M2, M3 ni CB2.

## Cómo se evitan duplicados nuevos al COMPARTIR (bloqueo suave)
Crear una ficha ya se bloquea si la placa existe en la empresa o corresponde a una unidad compartida vigente. Faltaba el caso inverso: **compartir** una ficha con una empresa que ya tiene la suya con la misma placa dejaba dos fichas visibles sin que nadie lo decidiera.

- Al **editar un vehículo** y agregar empresas con acceso, el servidor revisa solo los accesos **nuevos**. Si la empresa destino ya tiene una ficha **propia y activa** con la misma placa comparable y ambas no están unidas por una **identidad física aprobada**, responde **409** con el código `PLACA_REPETIDA_AL_COMPARTIR` y un aviso que remite a Identidades físicas.
- La pantalla pide **confirmación explícita**; solo con ella se reintenta con `confirmarPlacaRepetida`. La decisión queda en auditoría (`compartir_con_placa_repetida`). Es un bloqueo *suave* a propósito: para proponer una identidad física hace falta acceso a ambas fichas, así que impedir compartir sin salida crearía un callejón sin salida.
- En la **importación de Excel** no hay diálogo: la fila se reporta con el error y no se comparte.
- No se bloquea lo legítimo: comparticiones ya existentes, fichas inactivas, placas distintas, identidad aprobada entre ambas fichas y empresas sin ficha con esa placa pasan sin aviso. El mensaje solo nombra a la empresa que la persona eligió; nunca IDs ni datos de las fichas de otra empresa.
- Límites: las escrituras directas por SQL fuera de la aplicación no pasan por esta guarda.

## Vista previa de conflictos antes de vincular
`sql/vista-previa-2026-11-flota-conflictos-pareja.sql` (solo lectura) muestra, para dos fichas: dependencias por tabla, qué se conserva, choques que impedirían unificarlas (vales CB2 repetidos, periodos de multas, unidades TMS distintas, chasis) y operaciones abiertas que bloquean la identidad. Es informativa: no unifica ni reasigna nada.

