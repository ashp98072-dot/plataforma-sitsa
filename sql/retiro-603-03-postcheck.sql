-- SOLO LECTURA. No ejecutado. En una consulta nueva, tras resultado confirmado.
SELECT COUNT(*) AS debe_ser_cero FROM flota_vehiculos WHERE id=603;
SELECT * FROM flota_vehiculos WHERE id=1297 AND empresa_id=1 AND BINARY placa=BINARY 'C-035BXR';
SELECT * FROM tms_solicitud_fondo_lineas WHERE vehiculo_id=1297 ORDER BY id;
SELECT * FROM tms_unidades WHERE flota_vehiculo_id=1297 ORDER BY id;
SELECT COUNT(*) AS fondos_debe_ser_13 FROM tms_solicitud_fondo_lineas WHERE vehiculo_id=1297;
SELECT COUNT(*) AS tms_debe_ser_1 FROM tms_unidades WHERE flota_vehiculo_id=1297;
SELECT * FROM auditoria WHERE accion='retiro_duplicado_603' AND modulo='flota_vehiculos' ORDER BY id DESC;
-- Exportar y comparar TODAS las columnas y PK con el preflight, no solo los conteos.
-- Repetir inventario y SELECT generados por 01: cero relaciones numéricas al 603.
-- El nuevo evento de auditoría sí menciona 603: conservarlo, no borrarlo para
-- hacer pasar el barrido textual. Cualquier otro positivo nuevo exige detenerse.
-- Verificar catálogos con lectura autorizada: 603 ausente, 1297 disponible para KT.
