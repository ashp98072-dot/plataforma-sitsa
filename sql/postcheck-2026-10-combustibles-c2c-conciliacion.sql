-- C-2C — POSTCHECK (SOLO LECTURA). Ejecutar tras la migracion. Todos los conteos de "problemas" deben ser 0.
SELECT COUNT(*) AS columnas_c2c_presentes_esperado_8 FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_combustible_conciliacion_filas'
   AND COLUMN_NAME IN ('estado_c2c','modo_c2c','carga_vinculada_id','carga_sugerida_id','diferencias_c2c','calculado_en','confirmado_por_usuario_id','confirmado_en');
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas, MAX(NON_UNIQUE) AS no_unico FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_combustible_conciliacion_filas' AND INDEX_NAME IN ('uq_fccif_vinculo','idx_fccif_c2c','idx_fccif_sugerida') GROUP BY INDEX_NAME;
SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_combustible_conciliacion_filas'
   AND CONSTRAINT_NAME IN ('fk_fccif_vinculo','fk_fccif_sugerida','fk_fccif_confirmo','chk_fccif_estado_c2c','chk_fccif_modo_c2c','chk_fccif_vinculo_estado','chk_fccif_diferencias_json');
-- Nada cambio en datos existentes: antes de operar, filas con valores C-2C = 0.
SELECT COUNT(*) AS filas_con_datos_c2c_sin_operar FROM flota_combustible_conciliacion_filas WHERE estado_c2c IS NOT NULL OR carga_vinculada_id IS NOT NULL;
-- Integridad logica (deben ser 0 siempre):
SELECT COUNT(*) AS vinculos_de_otra_empresa FROM flota_combustible_conciliacion_filas f JOIN flota_combustible_cargas c ON c.id = f.carga_vinculada_id WHERE c.empresa_id <> f.empresa_id;
SELECT COUNT(*) AS vinculos_de_otro_proveedor FROM flota_combustible_conciliacion_filas f
  JOIN flota_combustible_conciliaciones h ON h.empresa_id = f.empresa_id AND h.id = f.conciliacion_id
  JOIN flota_combustible_cargas c ON c.id = f.carga_vinculada_id WHERE c.proveedor_id <> h.proveedor_id OR c.proveedor_id IS NULL;
SELECT COUNT(*) AS vinculos_en_filas_no_canonicas FROM flota_combustible_conciliacion_filas WHERE carga_vinculada_id IS NOT NULL AND (duplicado_de_linea_id IS NOT NULL OR estado_parseo IN ('INVALIDA','IGNORADA'));
SELECT COUNT(*) AS vales_vinculados_mas_de_una_vez FROM (SELECT carga_vinculada_id FROM flota_combustible_conciliacion_filas WHERE carga_vinculada_id IS NOT NULL GROUP BY empresa_id, carga_vinculada_id HAVING COUNT(*) > 1) x;
