-- SOLO LECTURA. La primera consulta inspecciona la estructura, sin confiar en IF NOT EXISTS.
-- Todas las filas, incluida RESULTADO, deben decir APTO. Si alguna dice DETENER,
-- no usar el modulo. Las consultas de datos posteriores requieren las seis tablas y
-- pueden fallar si la estructura esta incompleta: ese error tambien significa DETENER.
-- El listado incluye tipos, signo, nulabilidad, AUTO_INCREMENT, indices unicos,
-- definiciones CHECK y FKs con columnas, tablas y reglas de borrado y actualizacion.
WITH
tablas AS (
 SELECT 'canecas_productos' tabla
 UNION ALL SELECT 'canecas_ubicaciones'
 UNION ALL SELECT 'canecas_saldos'
 UNION ALL SELECT 'canecas_compras'
 UNION ALL SELECT 'canecas_recepciones'
 UNION ALL SELECT 'canecas_movimientos'
),
columnas AS (
 SELECT 'canecas_productos' tabla,'id' columna,'int' tipo,'NO' nullable,'YES' auto_inc
 UNION ALL SELECT 'canecas_productos','empresa_id','int','NO','NO'
 UNION ALL SELECT 'canecas_productos','codigo','varchar(80)','NO','NO'
 UNION ALL SELECT 'canecas_productos','nombre','varchar(200)','NO','NO'
 UNION ALL SELECT 'canecas_productos','marca','varchar(160)','NO','NO'
 UNION ALL SELECT 'canecas_productos','presentacion','varchar(160)','NO','NO'
 UNION ALL SELECT 'canecas_productos','capacidad','decimal(12,3)','NO','NO'
 UNION ALL SELECT 'canecas_productos','unidad_capacidad','varchar(40)','NO','NO'
 UNION ALL SELECT 'canecas_productos','unidad_inventario','varchar(40)','NO','NO'
 UNION ALL SELECT 'canecas_productos','activo','tinyint(1)','NO','NO'
 UNION ALL SELECT 'canecas_ubicaciones','id','int','NO','YES'
 UNION ALL SELECT 'canecas_ubicaciones','empresa_id','int','NO','NO'
 UNION ALL SELECT 'canecas_ubicaciones','nombre','varchar(160)','NO','NO'
 UNION ALL SELECT 'canecas_ubicaciones','activo','tinyint(1)','NO','NO'
 UNION ALL SELECT 'canecas_saldos','empresa_id','int','NO','NO'
 UNION ALL SELECT 'canecas_saldos','producto_id','int','NO','NO'
 UNION ALL SELECT 'canecas_saldos','ubicacion_id','int','NO','NO'
 UNION ALL SELECT 'canecas_saldos','fisico','int','NO','NO'
 UNION ALL SELECT 'canecas_saldos','reservado','int','NO','NO'
 UNION ALL SELECT 'canecas_compras','id','int','NO','YES'
 UNION ALL SELECT 'canecas_compras','empresa_id','int','NO','NO'
 UNION ALL SELECT 'canecas_compras','proveedor_id','int','NO','NO'
 UNION ALL SELECT 'canecas_compras','referencia','varchar(250)','NO','NO'
 UNION ALL SELECT 'canecas_compras','producto_id','int','NO','NO'
 UNION ALL SELECT 'canecas_compras','cantidad','int','NO','NO'
 UNION ALL SELECT 'canecas_compras','creado_por','int','NO','NO'
 UNION ALL SELECT 'canecas_compras','creado_en','datetime','NO','NO'
 UNION ALL SELECT 'canecas_compras','clave_operacion','char(36)','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','id','int','NO','YES'
 UNION ALL SELECT 'canecas_recepciones','empresa_id','int','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','compra_id','int','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','ubicacion_id','int','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','recibido_por_empleado_id','int','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','clave_operacion','char(36)','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','cantidad','int','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','estado','varchar(20)','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','creado_por','int','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','creado_en','datetime','NO','NO'
 UNION ALL SELECT 'canecas_recepciones','confirmado_por','int','YES','NO'
 UNION ALL SELECT 'canecas_recepciones','confirmado_en','datetime','YES','NO'
 UNION ALL SELECT 'canecas_movimientos','id','bigint','NO','YES'
 UNION ALL SELECT 'canecas_movimientos','empresa_id','int','NO','NO'
 UNION ALL SELECT 'canecas_movimientos','producto_id','int','NO','NO'
 UNION ALL SELECT 'canecas_movimientos','ubicacion_id','int','NO','NO'
 UNION ALL SELECT 'canecas_movimientos','tipo','varchar(30)','NO','NO'
 UNION ALL SELECT 'canecas_movimientos','cantidad','int','NO','NO'
 UNION ALL SELECT 'canecas_movimientos','recepcion_id','int','YES','NO'
 UNION ALL SELECT 'canecas_movimientos','movimiento_reversado_id','bigint','YES','NO'
 UNION ALL SELECT 'canecas_movimientos','documento','varchar(250)','NO','NO'
 UNION ALL SELECT 'canecas_movimientos','motivo','varchar(500)','YES','NO'
 UNION ALL SELECT 'canecas_movimientos','usuario_id','int','NO','NO'
 UNION ALL SELECT 'canecas_movimientos','creado_en','datetime','NO','NO'
),
indices_esperados AS (
 SELECT 'canecas_productos' tabla,'PRIMARY' indice,'id' columnas
 UNION ALL SELECT 'canecas_productos','uq_can_producto_empresa_id','empresa_id,id'
 UNION ALL SELECT 'canecas_productos','uq_can_producto_codigo','empresa_id,codigo'
 UNION ALL SELECT 'canecas_productos','uq_can_producto_presentacion','empresa_id,nombre,marca,presentacion,capacidad,unidad_capacidad'
 UNION ALL SELECT 'canecas_ubicaciones','PRIMARY','id'
 UNION ALL SELECT 'canecas_ubicaciones','uq_can_ubicacion_empresa_id','empresa_id,id'
 UNION ALL SELECT 'canecas_ubicaciones','uq_can_ubicacion_nombre','empresa_id,nombre'
 UNION ALL SELECT 'canecas_saldos','PRIMARY','empresa_id,producto_id,ubicacion_id'
 UNION ALL SELECT 'canecas_compras','PRIMARY','id'
 UNION ALL SELECT 'canecas_compras','uq_can_compra_empresa_id','empresa_id,id'
 UNION ALL SELECT 'canecas_compras','uq_can_compra_clave','empresa_id,clave_operacion'
 UNION ALL SELECT 'canecas_recepciones','PRIMARY','id'
 UNION ALL SELECT 'canecas_recepciones','uq_can_recepcion_empresa_id','empresa_id,id'
 UNION ALL SELECT 'canecas_recepciones','uq_can_recepcion_clave','empresa_id,clave_operacion'
 UNION ALL SELECT 'canecas_movimientos','PRIMARY','id'
 UNION ALL SELECT 'canecas_movimientos','uq_can_movimiento_empresa_id','empresa_id,id'
 UNION ALL SELECT 'canecas_movimientos','uq_can_movimiento_recepcion','empresa_id,recepcion_id'
),
fk_esperadas AS (
 SELECT 'canecas_productos' tabla,'fk_can_producto_empresa' nombre,'empresa_id' columnas,'empresas' referida,'id' columnas_ref,'RESTRICT' borrado
 UNION ALL SELECT 'canecas_ubicaciones','fk_can_ubicacion_empresa','empresa_id','empresas','id','RESTRICT'
 UNION ALL SELECT 'canecas_saldos','fk_can_saldo_producto','empresa_id,producto_id','canecas_productos','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_saldos','fk_can_saldo_ubicacion','empresa_id,ubicacion_id','canecas_ubicaciones','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_compras','fk_can_compra_proveedor','empresa_id,proveedor_id','compras_proveedores','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_compras','fk_can_compra_producto','empresa_id,producto_id','canecas_productos','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_compras','fk_can_compra_usuario','creado_por','usuarios','id','RESTRICT'
 UNION ALL SELECT 'canecas_recepciones','fk_can_recepcion_compra','empresa_id,compra_id','canecas_compras','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_recepciones','fk_can_recepcion_empleado','empresa_id,recibido_por_empleado_id','empleados','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_recepciones','fk_can_recepcion_ubicacion','empresa_id,ubicacion_id','canecas_ubicaciones','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_recepciones','fk_can_recepcion_creador','creado_por','usuarios','id','RESTRICT'
 UNION ALL SELECT 'canecas_recepciones','fk_can_recepcion_confirmador','confirmado_por','usuarios','id','RESTRICT'
 UNION ALL SELECT 'canecas_movimientos','fk_can_movimiento_producto','empresa_id,producto_id','canecas_productos','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_movimientos','fk_can_movimiento_ubicacion','empresa_id,ubicacion_id','canecas_ubicaciones','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_movimientos','fk_can_movimiento_recepcion','empresa_id,recepcion_id','canecas_recepciones','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_movimientos','fk_can_movimiento_reversado','empresa_id,movimiento_reversado_id','canecas_movimientos','empresa_id,id','RESTRICT'
 UNION ALL SELECT 'canecas_movimientos','fk_can_movimiento_usuario','usuario_id','usuarios','id','RESTRICT'
),
checks_esperados AS (
 SELECT 'canecas_productos' tabla,'chk_can_capacidad' nombre,'capacidad>0' expresion
 UNION ALL SELECT 'canecas_saldos','chk_can_saldo','fisico>=0andreservado>=0andreservado<=fisico'
 UNION ALL SELECT 'canecas_compras','chk_can_compra_cantidad','cantidad>0'
 UNION ALL SELECT 'canecas_recepciones','chk_can_recepcion_cantidad','cantidad>0'
 UNION ALL SELECT 'canecas_recepciones','chk_can_recepcion_estado','estado=''borrador''andconfirmado_porisnullandconfirmado_enisnullorestado=''confirmada''andconfirmado_porisnotnullandconfirmado_enisnotnull'
 UNION ALL SELECT 'canecas_movimientos','chk_can_movimiento_cantidad','cantidad<>0'
), referencias AS (
 SELECT 'empresas' tabla, 'id' columna UNION ALL SELECT 'usuarios','id'
 UNION ALL SELECT 'empleados','id' UNION ALL SELECT 'empleados','empresa_id'
 UNION ALL SELECT 'compras_proveedores','id' UNION ALL SELECT 'compras_proveedores','empresa_id'
), indices AS (
 SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') columnas,
 SUM(SUB_PART IS NOT NULL OR COLUMN_NAME IS NULL) incompleto FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA=DATABASE() GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE
), fk AS (
 SELECT k.TABLE_NAME,k.CONSTRAINT_NAME, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION SEPARATOR ',') columnas,
 MAX(k.REFERENCED_TABLE_NAME) referida, GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION SEPARATOR ',') columnas_ref,
 MAX(r.DELETE_RULE) borrado,MAX(r.UPDATE_RULE) actualizacion
 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
 WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY k.TABLE_NAME,k.CONSTRAINT_NAME
), pruebas AS (
 SELECT 'MariaDB 11.8.9 validada' prueba, VERSION() REGEXP '^11[.]8[.]9-MariaDB' ok
 UNION ALL SELECT 'claves foraneas activas',@@foreign_key_checks=1
 UNION ALL SELECT 'CHECK activo',@@check_constraint_checks=1
 UNION ALL SELECT CONCAT('tabla InnoDB: ',t.tabla),EXISTS(SELECT 1 FROM information_schema.TABLES x WHERE x.TABLE_SCHEMA=DATABASE() AND x.TABLE_NAME=t.tabla AND x.TABLE_TYPE='BASE TABLE' AND x.ENGINE='InnoDB' AND x.TABLE_COLLATION='utf8mb4_unicode_ci') FROM tablas t
 UNION ALL SELECT CONCAT('referencia InnoDB: ',t.tabla),EXISTS(SELECT 1 FROM information_schema.TABLES x WHERE x.TABLE_SCHEMA=DATABASE() AND x.TABLE_NAME=t.tabla AND x.TABLE_TYPE='BASE TABLE' AND x.ENGINE='InnoDB') FROM (SELECT 'empresas' tabla UNION ALL SELECT 'usuarios' UNION ALL SELECT 'empleados' UNION ALL SELECT 'compras_proveedores') t
 UNION ALL SELECT CONCAT('referencia INT firmado NOT NULL: ',e.tabla,'.',e.columna),EXISTS(SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.columna AND c.DATA_TYPE='int' AND c.COLUMN_TYPE NOT LIKE '%unsigned%' AND c.IS_NULLABLE='NO') FROM referencias e
 UNION ALL SELECT CONCAT('indice de referencia: ',e.tabla,'(',e.columnas,')'),EXISTS(SELECT 1 FROM indices i WHERE i.TABLE_NAME=e.tabla AND i.NON_UNIQUE=0 AND i.columnas=e.columnas AND i.incompleto=0) FROM (SELECT 'empresas' tabla,'id' columnas UNION ALL SELECT 'usuarios','id' UNION ALL SELECT 'empleados','empresa_id,id' UNION ALL SELECT 'compras_proveedores','empresa_id,id' UNION ALL SELECT 'compras_proveedores','empresa_id,nombre_normalizado' UNION ALL SELECT 'compras_proveedores','empresa_id,nit_normalizado') e
 UNION ALL SELECT CONCAT('columna: ',e.tabla,'.',e.columna),EXISTS(SELECT 1 FROM information_schema.COLUMNS c
 WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.columna AND c.IS_NULLABLE=e.nullable
 AND IF(e.auto_inc='YES',c.EXTRA LIKE '%auto_increment%',c.EXTRA NOT LIKE '%auto_increment%')
 AND IF(e.tipo IN ('int','bigint'),c.DATA_TYPE=e.tipo AND c.COLUMN_TYPE NOT LIKE '%unsigned%',LOWER(c.COLUMN_TYPE)=e.tipo)
 AND IF(e.tipo LIKE 'varchar%' OR e.tipo LIKE 'char%',c.COLLATION_NAME='utf8mb4_unicode_ci',1)) FROM columnas e
 UNION ALL SELECT CONCAT('valor inicial: ',e.tabla,'.',e.columna),EXISTS(SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.columna AND REPLACE(c.COLUMN_DEFAULT,CHAR(39),'')=e.valor) FROM (SELECT 'canecas_productos' tabla,'marca' columna,'' valor UNION ALL SELECT 'canecas_productos','activo','1' UNION ALL SELECT 'canecas_ubicaciones','activo','1' UNION ALL SELECT 'canecas_saldos','fisico','0' UNION ALL SELECT 'canecas_saldos','reservado','0' UNION ALL SELECT 'canecas_recepciones','estado','BORRADOR') e
 UNION ALL SELECT CONCAT('indice unico: ',e.tabla,'.',e.indice),EXISTS(SELECT 1 FROM indices i WHERE i.TABLE_NAME=e.tabla AND i.INDEX_NAME=e.indice AND i.NON_UNIQUE=0 AND i.columnas=e.columnas AND i.incompleto=0) FROM indices_esperados e
 UNION ALL SELECT 'compras sin unicidad comercial adicional',NOT EXISTS(SELECT 1 FROM indices i WHERE i.TABLE_NAME='canecas_compras' AND i.NON_UNIQUE=0 AND NOT EXISTS(SELECT 1 FROM indices_esperados e WHERE e.tabla=i.TABLE_NAME AND e.indice=i.INDEX_NAME))
 UNION ALL SELECT CONCAT('FK: ',e.tabla,'.',e.nombre),EXISTS(SELECT 1 FROM fk f WHERE f.TABLE_NAME=e.tabla AND f.CONSTRAINT_NAME=e.nombre AND f.columnas=e.columnas AND f.referida=e.referida AND f.columnas_ref=e.columnas_ref AND f.borrado=e.borrado AND f.actualizacion='RESTRICT') FROM fk_esperadas e
 UNION ALL SELECT CONCAT('CHECK: ',e.tabla,'.',e.nombre),EXISTS(SELECT 1 FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME WHERE c.CONSTRAINT_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.CONSTRAINT_NAME=e.nombre AND t.CONSTRAINT_TYPE='CHECK' AND REGEXP_REPLACE(LOWER(c.CHECK_CLAUSE),'[[:space:]`]','')=e.expresion) FROM checks_esperados e
)
SELECT prueba,IF(ok=1,'APTO','DETENER') estado FROM pruebas
UNION ALL SELECT 'RESULTADO',IF(COUNT(*)>0 AND MIN(COALESCE(ok,0))=1,'APTO','DETENER') FROM pruebas;

-- Las consultas siguientes deben devolver cero filas.
SELECT s.empresa_id,s.producto_id,s.ubicacion_id,s.fisico,COALESCE(SUM(m.cantidad),0) AS libro
FROM canecas_saldos s LEFT JOIN canecas_movimientos m ON m.empresa_id=s.empresa_id AND m.producto_id=s.producto_id AND m.ubicacion_id=s.ubicacion_id
GROUP BY s.empresa_id,s.producto_id,s.ubicacion_id,s.fisico HAVING s.fisico <> COALESCE(SUM(m.cantidad),0);
SELECT m.empresa_id,m.producto_id,m.ubicacion_id,SUM(m.cantidad) AS libro FROM canecas_movimientos m
LEFT JOIN canecas_saldos s ON s.empresa_id=m.empresa_id AND s.producto_id=m.producto_id AND s.ubicacion_id=m.ubicacion_id
WHERE s.empresa_id IS NULL GROUP BY m.empresa_id,m.producto_id,m.ubicacion_id;
SELECT r.empresa_id,r.id FROM canecas_recepciones r LEFT JOIN canecas_movimientos m ON m.empresa_id=r.empresa_id AND m.recepcion_id=r.id
LEFT JOIN canecas_compras c ON c.empresa_id=r.empresa_id AND c.id=r.compra_id
WHERE (r.estado='CONFIRMADA' AND (m.id IS NULL OR c.id IS NULL OR m.cantidad<>r.cantidad OR m.producto_id<>c.producto_id OR m.ubicacion_id<>r.ubicacion_id OR m.tipo<>'ENTRADA' OR NOT (m.usuario_id <=> r.confirmado_por) OR m.documento<>c.referencia OR r.confirmado_en IS NULL))
   OR (r.estado='BORRADOR' AND (m.id IS NOT NULL OR r.confirmado_por IS NOT NULL OR r.confirmado_en IS NOT NULL))
   OR r.estado NOT IN ('BORRADOR','CONFIRMADA');
-- Relaciones huerfanas y entre empresas, incluso si las FKs se desactivaron al cargar datos.
SELECT 'movimiento',m.id FROM canecas_movimientos m LEFT JOIN canecas_productos p ON p.empresa_id=m.empresa_id AND p.id=m.producto_id LEFT JOIN canecas_ubicaciones u ON u.empresa_id=m.empresa_id AND u.id=m.ubicacion_id LEFT JOIN canecas_recepciones r ON r.empresa_id=m.empresa_id AND r.id=m.recepcion_id LEFT JOIN canecas_movimientos rev ON rev.empresa_id=m.empresa_id AND rev.id=m.movimiento_reversado_id LEFT JOIN usuarios us ON us.id=m.usuario_id WHERE p.id IS NULL OR u.id IS NULL OR (m.recepcion_id IS NOT NULL AND r.id IS NULL) OR (m.movimiento_reversado_id IS NOT NULL AND rev.id IS NULL) OR us.id IS NULL
UNION ALL SELECT 'saldo',s.producto_id FROM canecas_saldos s LEFT JOIN canecas_productos p ON p.empresa_id=s.empresa_id AND p.id=s.producto_id LEFT JOIN canecas_ubicaciones u ON u.empresa_id=s.empresa_id AND u.id=s.ubicacion_id WHERE p.id IS NULL OR u.id IS NULL
UNION ALL SELECT 'compra',c.id FROM canecas_compras c LEFT JOIN canecas_productos p ON p.empresa_id=c.empresa_id AND p.id=c.producto_id LEFT JOIN compras_proveedores pr ON pr.empresa_id=c.empresa_id AND pr.id=c.proveedor_id LEFT JOIN usuarios us ON us.id=c.creado_por WHERE p.id IS NULL OR pr.id IS NULL OR us.id IS NULL
UNION ALL SELECT 'recepcion',r.id FROM canecas_recepciones r LEFT JOIN canecas_compras c ON c.empresa_id=r.empresa_id AND c.id=r.compra_id LEFT JOIN canecas_ubicaciones u ON u.empresa_id=r.empresa_id AND u.id=r.ubicacion_id LEFT JOIN empleados e ON e.empresa_id=r.empresa_id AND e.id=r.recibido_por_empleado_id LEFT JOIN usuarios cr ON cr.id=r.creado_por LEFT JOIN usuarios co ON co.id=r.confirmado_por WHERE c.id IS NULL OR u.id IS NULL OR e.id IS NULL OR cr.id IS NULL OR (r.confirmado_por IS NOT NULL AND co.id IS NULL)
UNION ALL SELECT 'producto',p.id FROM canecas_productos p LEFT JOIN empresas e ON e.id=p.empresa_id WHERE e.id IS NULL
UNION ALL SELECT 'ubicacion',u.id FROM canecas_ubicaciones u LEFT JOIN empresas e ON e.id=u.empresa_id WHERE e.id IS NULL;
SELECT c.empresa_id,c.id,c.cantidad, SUM(r.cantidad) AS recibido FROM canecas_compras c
JOIN canecas_recepciones r ON r.empresa_id=c.empresa_id AND r.compra_id=c.id AND r.estado='CONFIRMADA'
GROUP BY c.empresa_id,c.id,c.cantidad HAVING SUM(r.cantidad)>c.cantidad;
SELECT empresa_id,producto_id,ubicacion_id,fisico,reservado FROM canecas_saldos
WHERE fisico<0 OR reservado<0 OR reservado>fisico;
