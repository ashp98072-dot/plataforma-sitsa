# Seguimiento PR #522: selector y edición

## C-035BXR / vale 15094

Auditoría exclusivamente de código; no se ejecutó SQL ni se consultó producción.
Por tanto **no está confirmado si la unidad real tiene una o varias filas**.
Los casos con ese número de vale/placa en pruebas son reproducciones sintéticas,
no datos extraídos de producción.

Actualización posterior del solicitante: confirmado que 1297/KT es el camión real
y 603/FRESCOFRESH su duplicado. La afirmación anterior describe el límite de la
revisión inicial, no el estado actual del caso. Preparación de retiro, sin ejecutar:
[FLOTA-RETIRO-603-AUDITORIA.md](./FLOTA-RETIRO-603-AUDITORIA.md).

Cadena: `/flota/combustible/catalogos` → `catalogosCombustible` →
`flota_vehiculos` con el predicado central propio/compartido → vista de revisión
CB2 o formulario del vale → opciones de unidad. La consulta usa EXISTS, no JOIN
con accesos: varios permisos no multiplican filas. La clave física de placa es
`UNIQUE(empresa_id, placa)`, por lo que dos empresas administradoras pueden tener
dos IDs con la misma placa y ambos resultar accesibles. Además, variantes de
espacios/guiones pueden representar la misma matrícula sin violar ese índice.
Los selectores anteriores mostraban solo placa/descripción, por lo que dos IDs
parecían una única opción repetida. El formulario de vales también incorpora su
vehículo histórico si su ID no está en el catálogo activo: misma placa con otro
ID no debe reemplazar silenciosamente la referencia histórica.

Corrección: una opción por ID numérico; dos IDs con la misma placa comparable se
conservan con “Registro #… · placa repetida, verificar unidad”. Se reutiliza
`placaComparable`, sin quitar prefijos. Dos registros de matrícula completa siguen
requiriendo elección manual; no se modifica la validación CB2 ni se autopropone
una identidad por similitud. Una abreviada ambigua conserva su rechazo existente.

Diagnóstico seguro, sin SQL adicional ni mutaciones:

- La respuesta del catálogo autorizado incluye `diagnosticoVehiculos.idsRepetidos`
  (mismo ID repetido en la respuesta) y `posiblesDuplicados` (placa comparable y
  lista de IDs distintos, candidatos a revisión humana).
- GET de vehículos incluye `posiblesDuplicados` para todos los vehículos ya
  accesibles, incluidos inactivos; el listado muestra aviso e ID en esas filas.
- No consulta ni revela filas inaccesibles. No hay endpoint global, búsqueda por
  empresas ajenas, conteos sobre otros tenants ni cambios de permisos.
- Para cerrar el diagnóstico productivo, un operador autorizado debe inspeccionar
  esas respuestas en su sesión: dos IDs demuestran dos registros; mismo ID
  repetido apunta a respuesta/consulta. Si el catálogo actual no contiene la unidad
  histórica, comparar su ID autorizado del vale, no solo la placa. Este paso no
  se realizó por las restricciones de la tarea. Identificar filas no demuestra por
  sí solo que representen el mismo vehículo físico; requiere evidencia humana.

No se elimina, fusiona, renumera ni reasocia ningún vehículo, consumo o evidencia.
No se agrega migración: los tres scripts originales del PR permanecen separados,
pendientes de auditoría y sin ejecutar.

## Formulario y seguridad

La empresa administradora permanece en `empresa_id`, con los mismos permisos y
responsabilidad de abastecimientos/históricos. El propietario documental sigue
independiente. Al pasar de externo a propio se selecciona la administradora de
la unidad (no la primera del catálogo); nombre externo y tipo se conservan al
alternar en el borrador. Motocicletas particulares de mensajeros pueden registrarse
sin cuenta de usuario ni empresa propietaria interna, aunque trabajen para otros.

Se conserva el borrador general al guardar propietario; los campos generales,
filtros y accesos tienen una instantánea para detectar cambios pendientes. Cerrar,
abrir otra unidad o una nueva requiere confirmar el descarte; recargar/cerrar
pestaña o seguir enlaces avisa. Una escritura de propiedad en curso bloquea esas
salidas. Ante 409 se actualiza la consulta, conservando el borrador; “Restablecer
solo propietario” permite adoptar el valor/revisión consultados sin perder marca,
notas, kilometraje, filtros u otros cambios. La revisión capturada nunca se avanza
automáticamente sobre un conflicto. Cambiar de pestaña dentro del mismo componente
no borra el formulario. No se persiste el borrador en almacenamiento del navegador.

Se conservan flag apagada por defecto, guard/permisos, origen, bloqueo de fila,
revisión monotónica, validación servidor y auditoría transaccional del PR original.

## Verificación de esta revisión

- 560 pruebas aprobadas, 20 omitidas por configuración existente; 54 archivos
  aprobados y uno omitido. Suite: acceso/edición/permisos/eliminación de vehículos,
  propiedad, catálogo/vale y pruebas de biblioteca e interfaz CB2.
- Dos pruebas DOM agotaron 5 segundos con paralelismo amplio; la misma suite pasó
  completa con `--maxWorkers=2`, sin cambiar timeout ni omitir casos.
- ESLint pasa en los nuevos/auxiliares modificados. `flota-client.tsx` conserva
  exactamente ocho errores preexistentes `react-hooks/set-state-in-effect`, con
  comparación automatizada de reglas/mensajes frente al commit anterior del PR.
- TypeScript `tsc --noEmit --incremental false` y `git diff --check` aprobados.
- Los datos y conexiones de pruebas son simulados; no se creó ni utilizó ninguna
  base de datos, no se ejecutó SQL y no se consultaron los registros productivos.
