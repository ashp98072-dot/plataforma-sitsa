# Propietario y vehículos externos

## Auditoría y decisión

La edición anterior solo guardaba un alias libre en `empresa_activo`; no había
un propietario documental independiente. `flota_vehiculos.empresa_id` participa
en permisos, unicidad de placa, filtros, servicios y validaciones CB2. Transferirlo
implicaría cambiar el ámbito de acceso y romper relaciones existentes.

Se conserva `empresa_id` como empresa administradora. El propietario se representa
con `tipo_propiedad`, `empresa_propietaria_id` o `propietario_externo`; no concede
acceso. En unidades antiguas, EMPRESA y propietario interno NULL significan
propietario inicial = empresa administradora. Los alias anteriores se conservan;
no se interpretan ni convierten automáticamente en empresas. Revisarlos al activar.
`tipo_vehiculo` describe motocicleta/automóvil/etc. sin cambiar la clasificación
operativa existente `tipo_unidad` (VEHICULO/CABEZAL/TC).

## Uso y permisos

Registrar vehículo incorpora el selector; externo requiere nombre y tipo, sin
empresa propietaria interna. El odómetro puede desactivarse si no aplica.
Editar vehículo muestra el propietario actual. **Confirmar y guardar propietario**
guarda exclusivamente la propiedad; **Guardar cambios** conserva la edición general
existente. Una confirmación explica que los históricos mantienen su responsable.
No enviar cambios pendientes de propiedad al guardar los datos generales.

Se reutiliza `flota_vehiculos:crear` / `editar`, incluidos los bypass Admin ya
existentes. Además, solo la empresa administradora puede cambiar propiedad;
el permiso transversal para editar vehículos compartidos no autoriza transferencias
documentales. No cambia la política global ni el acceso compartido existente.
Los externos no muestran controles para conceder nuevos accesos en esta interfaz;
convertir un vehículo no borra sus accesos anteriores.

Servidor: empresa y actor derivados del guard, validación de origen, parámetros
SQL, empresa propietaria existente/activa (se puede conservar una propietaria
inactiva), bloqueo de fila y `revision_propiedad` monotónica. Una revisión antigua
devuelve 409, incluso en reintento tras pérdida de respuesta; recargar antes de
decidir nuevamente. No se promete idempotencia con devolución de respuesta original.
Cambio y auditoría antes/después usan la misma transacción; un fallo aborta ambos.
La propiedad, creación y filtros iniciales se guardan atómicamente.

CB2 no necesita otra fuente de vehículos: sus catálogos y validación reutilizan
la empresa administradora y los accesos ya existentes. El consumo conserva
`ctx.empresaId`, vehículo, fecha, galones, importe y moneda originales. No se
actualizan consumos, importaciones, asociaciones, gastos, servicios ni evidencias.
Una motocicleta corresponde a una sola fila dentro de la empresa administradora,
independientemente de para cuántas empresas trabaje su propietario.

## Migración y activación manual (pendientes, no ejecutadas)

1. Mantener `FLOTA_PROPIEDAD_EXTERNA` ausente o distinta de `1`. Desplegar código
   compatible con esquema previo: la consulta adicional se omite con flag apagada.
   Origen permitido: `FLOTA_PUBLIC_ORIGIN`, por defecto `https://novalvion.com`;
   debe ser un origen HTTPS exacto, sin ruta. Desarrollo local admite localhost.
2. Operador autorizado revisa backup/restauración, versión MariaDB 11.8, tamaños,
   espacio y ventana DDL. Revisar `scripts/flota-propiedad-01-preflight.sql`, solo
   lectura. Exigir InnoDB y tipos compatibles: `empresas.id` INT firmado, tabla
   auditoría transaccional y columnas nuevas ausentes. Ante diferencias, detenerse.
3. Ejecutar **solo si posteriormente se autoriza** la única sentencia de
   `scripts/flota-propiedad-02-expand.sql`. No hay DELIMITER, rutinas, backfill ni
   migración original CB2. No deshabilitar FK/CHECK. Ante error o desconexión,
   detenerse e inspeccionar SHOW CREATE TABLE; nunca reejecutar a ciegas.
4. Punto de parada: revisar `scripts/flota-propiedad-03-postcheck.sql` por separado.
   Comprobar cinco columnas, índice, FK, CHECK, conteo conservado, cero inválidos.
   Activar flag únicamente tras auditoría y postcheck aprobados y todos los nodos
   con código nuevo. No permitir escrituras con versiones antiguas durante activación.

MariaDB documenta ALTER atómico para InnoDB y CHECK aplicados por el servidor;
eso no convierte DDL y verificaciones en una transacción conjunta ni elimina
esperas por bloqueos. Referencias:
[ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table),
[CHECK](https://mariadb.com/docs/server/reference/sql-statements/data-definition/constraint).

Recuperación: apagar flag y detener altas/ediciones de vehículos antes de volver
a código antiguo. Conservar columnas y auditoría: el código antiguo no conoce la
propiedad externa y muestra alias/empresa administradora, por lo que no es una
interfaz válida para operar estas unidades. No entregar DROP ni restaurar backup
automáticamente; corregir hacia adelante tras inspección. El DDL puede bloquear o
reconstruir tabla; requiere ventana y decisión operativa previa. Ningún script ha
sido ejecutado ni se ha validado contra una base real.

## Validación

Pruebas puras y conexiones simuladas: propietario de C-558BSJ, alta externa,
cambio de tipo, revisión obsoleta, permisos HTTP, origen, actor/tenant, rollback
de escritura/auditoría/commit, catálogo CB2 y regresiones multiempresa existentes.
La aceptación sobre C-558BSJ real debe realizarla el operador después de autorizar
la migración; esta entrega no consulta ni modifica esa unidad productiva.

Resultados locales: 418 pruebas aprobadas, 20 omitidas por configuración existente
(33 archivos aprobados, uno omitido). Se ejecutaron los tres archivos nuevos
`propiedad*.test.ts`, regresiones de acceso/edición/permisos/eliminación de vehículos
y la carpeta `src/lib/flota/cb2`. TypeScript `tsc --noEmit --incremental false` pasa.
ESLint pasa en servicio, rutas, componente de propiedad, filtros y pruebas nuevos.
El cliente general conserva ocho errores preexistentes `react-hooks/set-state-in-effect`:
comparación de ESLint contra su contenido en main confirma mismas reglas/mensajes,
sin nuevos errores; no se corrigen hooks ajenos al alcance.

Archivos: servicio `src/lib/flota/propiedad.ts`, ruta `/vehiculos/propiedad`,
enriquecimiento del GET de vehículos, componente `propiedad-fields.tsx`, integración
en `flota-client.tsx`, conexión transaccional opcional en `filtros.ts`, tres archivos
de pruebas y los tres scripts separados mencionados arriba. Ningún cambio a CB2,
Contabilidad, Empleados, Fondos, importadores ni esquemas de inicialización automática.
