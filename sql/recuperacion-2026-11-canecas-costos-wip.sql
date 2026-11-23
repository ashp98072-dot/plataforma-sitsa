-- BORRADOR SOLO LECTURA: diagnóstico posterior a instalación parcial o fallo.
-- No reejecutar DDL ni borrar tablas, capas, valoraciones o movimientos automáticamente.
-- Suspender escrituras de Canecas y conservar respaldo verificable antes de decidir reparación.
SELECT DATABASE() AS base_seleccionada,VERSION() AS servidor,CURRENT_USER() AS usuario_efectivo;
-- El conteo de metadatos no demuestra que las definiciones sean correctas ni que
-- una tabla esté vacía. Ningún resultado autoriza por sí solo ejecutar DDL.
SELECT CASE
 WHEN DATABASE() IS NULL THEN 'DETENER_SIN_BASE'
 WHEN (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_compras','canecas_productos') AND TABLE_TYPE='BASE TABLE') <> 2 THEN 'DETENER_BASE_INCOMPATIBLE'
 WHEN (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_valoraciones_iniciales','canecas_capas_costo','canecas_gastos_posteriores') AND (TABLE_TYPE<>'BASE TABLE' OR ENGINE<>'InnoDB')) > 0 THEN 'DETENER_OBJETO_INCOMPATIBLE'
 WHEN objetos.columnas=0 AND objetos.tablas_nuevas=0 AND objetos.disparadores=0 THEN 'SIN_OBJETOS_REVISAR_PREFLIGHT'
 WHEN objetos.columnas=5 AND objetos.tablas_nuevas=3 AND objetos.disparadores=7 THEN 'OBJETOS_PRESENTES_REVISAR_POSTCHECK_Y_DATOS'
 ELSE 'DETENER_INSTALACION_PARCIAL'
 END AS estado,
 objetos.columnas, objetos.tablas_nuevas, objetos.disparadores
FROM (SELECT
 (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='canecas_compras' AND COLUMN_NAME IN ('precio_unitario_centavos','gastos_centavos','moneda')) OR (TABLE_NAME='canecas_productos' AND COLUMN_NAME IN ('precio_venta_referencia_centavos','precio_venta_referencia_moneda')))) AS columnas,
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_valoraciones_iniciales','canecas_capas_costo','canecas_gastos_posteriores')) AS tablas_nuevas,
 (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('can_compra_costos_inmutables','can_capa_costo_inmutable','can_capa_no_borrar','can_gasto_no_editar','can_gasto_no_borrar','can_valoracion_no_editar','can_valoracion_no_borrar')) AS disparadores
) objetos;
SELECT TABLE_NAME,TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_compras','canecas_productos','canecas_valoraciones_iniciales','canecas_capas_costo','canecas_gastos_posteriores') ORDER BY TABLE_NAME;
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='canecas_compras' AND COLUMN_NAME IN ('precio_unitario_centavos','gastos_centavos','moneda')) OR (TABLE_NAME='canecas_productos' AND COLUMN_NAME IN ('precio_venta_referencia_centavos','precio_venta_referencia_moneda'))) ORDER BY TABLE_NAME,COLUMN_NAME;
SELECT TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_valoraciones_iniciales','canecas_capas_costo','canecas_gastos_posteriores') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('can_compra_costos_inmutables','can_capa_costo_inmutable','can_capa_no_borrar','can_gasto_no_editar','can_gasto_no_borrar','can_valoracion_no_editar','can_valoracion_no_borrar') ORDER BY TRIGGER_NAME;
-- Si existen registros, planificar conciliación y compensaciones aprobadas; preservar documentos y eventos.
-- Si el resultado de TABLES confirma que existen las tres tablas, consultar los conteos siguientes por separado:
-- SELECT COUNT(*) AS capas FROM canecas_capas_costo;
-- SELECT COUNT(*) AS valoraciones FROM canecas_valoraciones_iniciales;
-- SELECT COUNT(*) AS gastos FROM canecas_gastos_posteriores;
-- Comprobar también si hay precios de compra o precios de referencia distintos de NULL antes de considerar cualquier retirada.
-- Si faltan objetos: comparar sus definiciones existentes con la migración revisada y preparar un parche de avance específico.
-- Si hay datos nuevos: mantener escrituras suspendidas, respaldar y conciliar saldos, capas y gastos antes de aprobar reparación.
-- No volver a habilitar el código anterior para escribir: podría crear movimientos sin sus capas de costo.
