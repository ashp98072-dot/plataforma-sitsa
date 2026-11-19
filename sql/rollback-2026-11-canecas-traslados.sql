-- ROLLBACK SOLO SI TODAS LAS TABLAS ESTÁN VACÍAS. No revierte movimientos ni saldos.
-- Suspender escrituras y respaldar antes. Si hay datos, detenerse y diseñar una
-- reversión operativa auditada; nunca descartar un traslado o documento emitido.
DELIMITER //
CREATE PROCEDURE can_tras_rollback_vacio()
BEGIN
 IF EXISTS (SELECT 1 FROM canecas_traslados LIMIT 1)
 OR EXISTS (SELECT 1 FROM canecas_traslado_partidas LIMIT 1)
 OR EXISTS (SELECT 1 FROM canecas_traslado_recepciones LIMIT 1)
 OR EXISTS (SELECT 1 FROM canecas_traslado_recepcion_partidas LIMIT 1)
 OR EXISTS (SELECT 1 FROM canecas_traslado_documentos LIMIT 1)
 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Rollback detenido: existen datos de traslados';
 ELSE
  DROP TRIGGER can_tras_doc_no_update;
  DROP TRIGGER can_tras_doc_no_delete;
  DROP TABLE canecas_traslado_documentos;
  DROP TABLE canecas_traslado_recepcion_partidas;
  DROP TABLE canecas_traslado_recepciones;
  DROP TABLE canecas_traslado_partidas;
  DROP TABLE canecas_traslados;
 END IF;
END//
DELIMITER ;
CALL can_tras_rollback_vacio();
DROP PROCEDURE can_tras_rollback_vacio;

