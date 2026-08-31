# C2 — transición a libros separados de KT y Mónaco

Estado: C2A aplicada manualmente por el usuario; C2B implementa la separación funcional.
Base revisada: C1, merge ccf5ef1. No se consultó producción.

## Entrega C2A — preparación, no aislamiento

Archivo manual: sql/migrate-2026-08-contabilidad-entidad-preparacion.sql.
Añade entidad_id opcional a las cinco tablas contables y empresa_id opcional
al detalle, más índices no únicos por empresa/entidad. schema.sql contiene las
mismas definiciones para instalaciones nuevas. No ejecutar schema.sql sobre
producción como sustituto de la migración.

No elimina filas, no asigna entidades, no cambia unicidad ni las FKs existentes.
Los INSERT anteriores omiten los campos nuevos y siguen funcionando con NULL.
No hay selector nuevo ni separación efectiva en esta entrega. CxC/CxP utilizan
SELECT *: sus respuestas pueden incluir entidad_id: null después de aplicar
la migración; los consumidores revisados toleran ese campo adicional.

Requiere MariaDB con ADD COLUMN/INDEX IF NOT EXISTS (destino indicado: 11.8).
Referencia de sintaxis:
https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table
IF NOT EXISTS comprueba nombres, no equivalencia de tipos o composición del índice.
Revisar SHOW CREATE TABLE y respaldo antes de aplicarla. Si la tabla no existe,
el ALTER falla: no se crean esquemas parciales automáticamente desde la aplicación.
Si una sentencia falla, otras anteriores pueden haber quedado aplicadas; no hay
rollback global de DDL. Revisar el error y repetir solo tras comprobar el esquema.

La aplicación es manual y NO se ejecutó en esta entrega. Las pruebas son estáticas
de alcance y equivalencia de definiciones, más regresión del código; no sustituyen
ejecutar la migración dos veces en una copia MariaDB y comprobar sus restricciones.
No habilitar escritura de ambas entidades hasta completar C2B: guard/selector,
restricciones compuestas, corte y actualización de la limpieza. No quitar aún
uq_cuenta/uq_asiento ni suponer que los campos opcionales garantizan aislamiento.

## Alcance confirmado en código

Antes de C2A las cinco tablas cont_cuentas, cont_asientos, cont_asiento_detalle,
cont_cxc y cont_cxp no tienen columnas de identidad contable. El detalle se relaciona con
asiento/cuenta por id. Los cuatro endpoints y la pantalla principal operan por
empresa_id. Limpiar Contabilidad borra todas esas filas de la empresa operativa.
El catálogo cont_entidades y sus asignaciones no separan los movimientos.

## Modelo objetivo

- Mantener el tenant operativo kt-monaco y los catálogos operativos existentes.
- Incorporar entidad_id a cuentas, asientos y obligaciones. Detalles deben quedar
  vinculados al mismo tenant y entidad que su asiento y cuenta; diseñar claves
  compuestas para impedir referencias cruzadas también en la base de datos.
- Validar tenant + permiso efectivo de Contabilidad + entidad activa + asignación.
  Admin mantiene administración dentro del tenant autorizado. Para escribir,
  exigir además acceso de edición a la entidad; no basta con conocer su id.
- Código de cuenta y número de asiento pasan a ámbito de entidad cuando toda
  escritura y lectura esté adaptada. No quitar antes la unicidad actual.
- No introducir numeración por período hasta aprobar el diseño de períodos C3.
- Mónaco histórico 00 y actual 08 siguen siendo una entidad con lotes de origen
  diferenciados, no dos saldos que se sumen automáticamente.

## Transición sin clasificación silenciosa

1. Confirmar si la migración de entidades 2B fue aplicada. Configurar las razones
   sociales y accesos de forma explícita. No suponer ids fijos ni crearlas al leer.
2. Inventariar datos existentes en una copia autorizada: cantidades, relaciones,
   cuentas utilizadas por partidas, obligaciones y posibles referencias cruzadas.
   No se ha realizado este inventario de filas en producción.
3. Aprobar el tratamiento de registros actuales. No interpretar «son pruebas»
   como permiso para borrarlos o atribuirlos a una razón social.
4. Preparar migración aditiva manual: campos inicialmente opcionales para no
   romper el código anterior; índices/FKs tras verificar compatibilidad. No
   asignar valor por defecto a KT ni sustituir todavía las claves únicas.
5. Preparar clasificación revisable. Una partida completa y todas sus cuentas
   deben ser compatibles con la entidad elegida. Si una cuenta fue usada por
   partidas de ambas entidades, no dividir ni duplicar automáticamente: requiere
   resolución explícita con preservación de trazabilidad y conciliación.
6. Durante el corte, detener escrituras contables y limpieza, clasificar en
   transacciones y conciliar antes/después. DDL se trata separadamente: no asumir
   que una transacción revierte una migración de esquema.
7. Activar selector obligatorio de entidad en las cuatro operaciones y aplicar
   el guard en cada endpoint. Sin selección no consultar «todas» por defecto.
   No mezclar filas sin clasificar en listados normales; mantener revisión
   restringida para ellas si el tratamiento aprobado requiere conservarlas.
8. Cuando no queden ambiguos, imponer restricciones finales y cambiar unicidad.
   Reanudar operación solo después de comprobar la versión desplegada y reglas.

La preparación nullable por sí sola NO constituye aislamiento. C2B exige escoger
una entidad, valida acceso en servidor y filtra todas las consultas/escrituras por
empresa y entidad. Un despliegue parcial bloquea escrituras con HTTP 503 hasta que
se aplique manualmente `migrate-2026-08-contabilidad-entidad-integridad.sql`; no
existe fallback al libro compartido. Los registros antiguos con entidad NULL se
conservan, pero no aparecen ni se atribuyen silenciosamente a KT o Mónaco.

## Superficies a actualizar juntas

- APIs cuentas/asientos/CxC/CxP, servicios de altas y registro de partidas.
- Selector y formularios de la pantalla principal; listado de cuentas según entidad.
- Catálogo/accesos: revocación/desactivación comprobada en cada operación; evaluar
  locks para que autorización y escritura no compitan con cambios de acceso.
- Limpieza: no conservar un borrado por tenant que aparente actuar sobre una
  entidad seleccionada. Separar alcance y confirmación, proteger libros definitivos.
- Pruebas existentes y futuras importaciones. Facturación todavía no genera aquí
  asientos: su futura integración debe indicar entidad, documento origen y clave
  idempotente. No duplicar pagos ni crear un puente automático en C2.

## Pruebas de aceptación

- Cuenta de Mónaco rechazada en partida KT, incluso enviando id conocido.
- Usuario asignado a KT no consulta/escribe Mónaco; revocación y solo lectura se respetan.
- Mismo código en entidades distintas, duplicado rechazado dentro de una entidad.
- Sin entidad, entidad ajena/inactiva o esquema incompleto: error controlado sin escritura.
- Seleccionar entidad limpia los datos de la anterior; no filtra únicamente en UI.
- Clasificación preserva cantidades, debe/haber y saldos; falla completa ante conflicto.
- Limpieza no afecta otra entidad, ni permite omitir el alcance desde el request.
- Pruebas reales de restricciones y concurrencia en copia MariaDB, además de unitarias.

## Decisión aprobada: empezar desde cero conservando clientes

El usuario aprobó descartar las pruebas contables de KT/Mónaco y empezar de cero,
conservando sus clientes. No es autorización para borrar otras empresas ni módulos.
No se hará backfill de esas pruebas hacia KT o Mónaco. La limpieza aún NO se ha
ejecutado ni verificado en producción.

La función existente limpiarContabilidad elimina exclusivamente cont_asiento_detalle
(mediante sus asientos de la empresa), cont_asientos, cont_cxc, cont_cxp y
cont_cuentas. Todas sus operaciones usan la misma transacción, junto con auditoría.
No modifica clientes, tms_clientes, facturas, pagos de Facturación, viajes, RRHH,
cont_entidades ni cont_entidad_usuarios. Esta conclusión corresponde al código
revisado; no se inspeccionaron triggers ni divergencias de esquema en producción.

Procedimiento de preparación: respaldo recuperable, detener escrituras contables,
Administración → Limpiar módulo → empresa KT/Mónaco → Contabilidad. No seleccionar
Clientes ni Facturación ni Operaciones. Usar la frase de confirmación indicada por
la pantalla. Verificar después cuentas/asientos/CxC/CxP vacíos y clientes/facturas
intactos. Conservar esta distinción: reiniciar el libro no liquida ni borra facturas
o pagos existentes en Facturación; su incorporación contable futura requiere corte
y conciliación para no omitir ni duplicar saldos.

Antes de C2 se debe confirmar la aplicación de la migración 2B. La migración final
de separación no debe borrar automáticamente registros ni asumir que están vacíos;
si aparecen nuevas pruebas durante la preparación, debe detener el corte y avisar.

La entrega C2A añade el archivo de migración manual, su equivalente en schema.sql
y pruebas estáticas; no cambia rutas ni permisos, no importa Milenium y no atribuye
registros existentes a KT/Mónaco. No ejecuta la limpieza autorizada.
