-- SOLO LECTURA. Ejecutar conectado a la base de destino; no cambia datos ni sesión.
-- Usar una cuenta con visibilidad completa de tablas e indices del esquema elegido.
-- Cada fila debe decir APTO, incluida la fila RESULTADO. DETENER exige corregir
-- el esquema y repetir; la migración NO debe usarse para corregir divergencias.
-- Compatibilidad validada aquí: MariaDB 11.8.9. Otras versiones requieren ensayo previo.
-- Ejecutar primero esta consulta de motor. Si dice DETENER, no ejecutar el resto:
-- las variables y el catálogo siguientes son específicos de MariaDB.
SELECT DATABASE() AS base_actual, VERSION() AS version,
       IF(DATABASE() IS NOT NULL AND VERSION() REGEXP '^11[.]8[.]9-MariaDB','APTO','DETENER') AS estado_motor;
-- Ejecutar el resto solo si el motor dice APTO, en la misma sesión de instalación.
WITH requeridas AS (
 SELECT 'empresas' tabla, 'id' columna UNION ALL SELECT 'usuarios','id'
 UNION ALL SELECT 'empleados','id' UNION ALL SELECT 'empleados','empresa_id'
 UNION ALL SELECT 'compras_proveedores','id' UNION ALL SELECT 'compras_proveedores','empresa_id'
), indices AS (
 SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
        GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') columnas,
        SUM(SUB_PART IS NOT NULL OR COLUMN_NAME IS NULL) incompleto
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
 GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE
), columnas_app AS (
 SELECT 'usuarios' tabla,'username' columna UNION ALL SELECT 'empleados','nombre' UNION ALL SELECT 'empleados','estado'
 UNION ALL SELECT 'compras_proveedores','nombre_comercial' UNION ALL SELECT 'compras_proveedores','nombre_normalizado'
 UNION ALL SELECT 'compras_proveedores','razon_social' UNION ALL SELECT 'compras_proveedores','nit'
 UNION ALL SELECT 'compras_proveedores','nit_normalizado' UNION ALL SELECT 'compras_proveedores','direccion'
 UNION ALL SELECT 'compras_proveedores','telefono' UNION ALL SELECT 'compras_proveedores','correo'
 UNION ALL SELECT 'compras_proveedores','contacto_nombre' UNION ALL SELECT 'compras_proveedores','contacto_telefono'
 UNION ALL SELECT 'compras_proveedores','contacto_correo' UNION ALL SELECT 'compras_proveedores','metodo_pago_habitual'
 UNION ALL SELECT 'compras_proveedores','banco' UNION ALL SELECT 'compras_proveedores','numero_cuenta'
 UNION ALL SELECT 'compras_proveedores','tipo_cuenta' UNION ALL SELECT 'compras_proveedores','titular_cuenta'
 UNION ALL SELECT 'compras_proveedores','dias_credito' UNION ALL SELECT 'compras_proveedores','observaciones'
 UNION ALL SELECT 'compras_proveedores','activo' UNION ALL SELECT 'compras_proveedores','creado_por'
 UNION ALL SELECT 'compras_proveedores','actualizado_por' UNION ALL SELECT 'auditoria','empresa_id'
 UNION ALL SELECT 'auditoria','usuario' UNION ALL SELECT 'auditoria','accion' UNION ALL SELECT 'auditoria','modulo'
 UNION ALL SELECT 'auditoria','detalle'
), pruebas AS (
 SELECT 'base seleccionada' prueba, DATABASE() IS NOT NULL ok
 UNION ALL SELECT 'MariaDB 11.8.9 validada', VERSION() REGEXP '^11[.]8[.]9-MariaDB'
 UNION ALL SELECT 'comprobación de claves foráneas activa', @@foreign_key_checks=1
 UNION ALL SELECT 'comprobación de CHECK activa', @@check_constraint_checks=1
 UNION ALL SELECT CONCAT('tabla InnoDB: ',t.tabla), EXISTS (
   SELECT 1 FROM information_schema.TABLES x WHERE x.TABLE_SCHEMA=DATABASE()
   AND x.TABLE_NAME=t.tabla AND x.TABLE_TYPE='BASE TABLE' AND x.ENGINE='InnoDB')
 FROM (SELECT 'empresas' tabla UNION ALL SELECT 'usuarios' UNION ALL SELECT 'empleados' UNION ALL SELECT 'compras_proveedores' UNION ALL SELECT 'auditoria') t
 UNION ALL SELECT CONCAT('INT firmado NOT NULL: ',r.tabla,'.',r.columna), EXISTS (
   SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=DATABASE()
   AND c.TABLE_NAME=r.tabla AND c.COLUMN_NAME=r.columna AND c.DATA_TYPE='int'
   AND c.COLUMN_TYPE NOT LIKE '%unsigned%' AND c.IS_NULLABLE='NO') FROM requeridas r
 UNION ALL SELECT CONCAT('columna operativa: ',e.tabla,'.',e.columna), EXISTS (
   SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=DATABASE()
   AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.columna) FROM columnas_app e
 UNION ALL SELECT CONCAT('índice único completo: ',i.tabla,'(',i.columnas,')'), EXISTS (
   SELECT 1 FROM indices x WHERE x.TABLE_NAME=i.tabla AND x.NON_UNIQUE=0
   AND x.columnas=i.columnas AND x.incompleto=0)
 FROM (SELECT 'empresas' tabla,'id' columnas UNION ALL SELECT 'usuarios','id'
       UNION ALL SELECT 'empleados','empresa_id,id' UNION ALL SELECT 'compras_proveedores','empresa_id,id'
       UNION ALL SELECT 'compras_proveedores','empresa_id,nombre_normalizado'
       UNION ALL SELECT 'compras_proveedores','empresa_id,nit_normalizado') i
 UNION ALL SELECT 'sin tablas ni vistas canecas_ preexistentes', NOT EXISTS (
   SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND LEFT(TABLE_NAME,8)='canecas_')
)
SELECT prueba, IF(ok=1,'APTO','DETENER') estado FROM pruebas
UNION ALL SELECT 'RESULTADO', IF(COUNT(*)>0 AND MIN(COALESCE(ok,0))=1,'APTO','DETENER') FROM pruebas;
