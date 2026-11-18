-- Solo lectura; se esperan seis tablas InnoDB y ninguna diferencia en saldos.
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos') ORDER BY TABLE_NAME;
SELECT s.empresa_id,s.producto_id,s.ubicacion_id,s.fisico,COALESCE(SUM(m.cantidad),0) AS libro
FROM canecas_saldos s LEFT JOIN canecas_movimientos m ON m.empresa_id=s.empresa_id AND m.producto_id=s.producto_id AND m.ubicacion_id=s.ubicacion_id
GROUP BY s.empresa_id,s.producto_id,s.ubicacion_id,s.fisico HAVING s.fisico <> COALESCE(SUM(m.cantidad),0);
SELECT m.empresa_id,m.producto_id,m.ubicacion_id,SUM(m.cantidad) AS libro FROM canecas_movimientos m
LEFT JOIN canecas_saldos s ON s.empresa_id=m.empresa_id AND s.producto_id=m.producto_id AND s.ubicacion_id=m.ubicacion_id
WHERE s.empresa_id IS NULL GROUP BY m.empresa_id,m.producto_id,m.ubicacion_id;
SELECT r.empresa_id,r.id FROM canecas_recepciones r LEFT JOIN canecas_movimientos m ON m.empresa_id=r.empresa_id AND m.recepcion_id=r.id
WHERE (r.estado='CONFIRMADA' AND (m.id IS NULL OR m.cantidad<>r.cantidad)) OR (r.estado='BORRADOR' AND m.id IS NOT NULL);
