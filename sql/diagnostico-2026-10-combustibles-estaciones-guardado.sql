-- DIAGNÓSTICO DE SOLO LECTURA — «no se puede guardar una Estación de combustible» en producción.
-- NO modifica nada (solo SELECT/SHOW). NO ejecutado por esta rama: lo corre el responsable contra la BD objetivo y comparte los resultados.
-- Contexto: con el esquema del repositorio el flujo guarda (probado en MariaDB 11.8.9 desechable). Si falla en producción, la causa
-- depende de algo que SOLO se ve allí. Cada bloque dice qué buscar. DETENER ante cualquier divergencia; no corregir sin revisión.

-- 0) Motor y modo SQL (un modo estricto distinto, o una versión distinta, cambia errores de CHECK/FK/longitud).
SELECT VERSION() AS version, @@sql_mode AS sql_mode, @@character_set_database AS charset_bd, @@collation_database AS collation_bd;

-- 1) ¿Existe la tabla y con QUÉ definición? Debe tener: id, empresa_id, proveedor_id, nombre VARCHAR(150), direccion VARCHAR(500) NULL,
--    activo TINYINT(1), creado_por_usuario_id, actualizado_por_usuario_id, creado_en, actualizado_en; UNIQUE (empresa_id,proveedor_id,id);
--    FK (empresa_id,proveedor_id) -> compras_proveedores(empresa_id,id); CHECKs activo y nombre.
SHOW CREATE TABLE flota_combustible_estaciones;
SHOW INDEX FROM flota_combustible_estaciones;

-- 2) Columnas realmente presentes (el INSERT del servicio usa estas 7).
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_combustible_estaciones'
   AND COLUMN_NAME IN ('empresa_id','proveedor_id','nombre','direccion','activo','creado_por_usuario_id','actualizado_por_usuario_id');
-- Esperado: 7 filas. Menos de 7 = columna ausente → el POST falla con «Unknown column» (el servicio ahora responde 503 con mensaje claro).

-- 3) Restricciones: FKs y CHECKs de la tabla (debe existir fk_fce_proveedor compuesta, no una FK solo por proveedor_id).
SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS columnas,
       GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS referenciadas
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_combustible_estaciones' AND REFERENCED_TABLE_NAME IS NOT NULL
 GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_NAME;
SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_combustible_estaciones';

-- 4) Tabla padre: la FK compuesta exige índice/UNIQUE (empresa_id, id) en compras_proveedores y `activo`.
SHOW INDEX FROM compras_proveedores;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_proveedores' AND COLUMN_NAME IN ('id','empresa_id','nombre_comercial','activo');

-- 5) Auditoría: el POST escribe en `auditoria` dentro de la misma transacción; si esa inserción falla, el guardado entero se revierte.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auditoria';
-- Esperado: accion VARCHAR(80) (o más), modulo VARCHAR(40) (o más), detalle TEXT. Acciones usadas: crear_estacion_combustible (25),
-- editar_estacion_combustible, desactivar_estacion_combustible (31), reactivar_estacion_combustible; modulo = flota_combustible (17).

-- 6) Estado de los datos: estaciones existentes, proveedores activos por empresa y proveedores inactivos que alguien podría estar eligiendo.
SELECT empresa_id, COUNT(*) AS estaciones, SUM(activo = 1) AS activas FROM flota_combustible_estaciones GROUP BY empresa_id;
SELECT empresa_id, COUNT(*) AS proveedores, SUM(activo = 1) AS activos FROM compras_proveedores GROUP BY empresa_id;

-- 7) ¿Hay vales que ya usan estaciones? (una estación usada no puede cambiar de proveedor).
SELECT COUNT(*) AS vales_con_estacion FROM flota_combustible_cargas WHERE estacion_id IS NOT NULL;

-- 8) Permisos del usuario que no puede guardar (sustituir :usuario_id). El POST exige la acción `gestionar_estaciones`.
--    Con la matriz V2 debe existir la fila `flota_combustible_gestionar_estaciones` con puede_ver=1 (o la equivalencia legacy puede_editar=1 en `flota_combustible`)
--    y la base `flota_combustible` con puede_ver=1.
SELECT modulo, empresa_id, puede_ver, puede_crear, puede_editar, puede_eliminar
  FROM usuario_modulo
 WHERE usuario_id = :usuario_id
   AND (modulo IN ('flota_combustible','permisos_acciones_v2') OR modulo LIKE 'flota_combustible\_%');
