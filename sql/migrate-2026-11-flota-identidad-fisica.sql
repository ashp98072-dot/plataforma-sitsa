-- Propuesta manual: NO fusiona, mueve IDs, cambia propiedad ni reasigna historicos.
-- Todos los registros locales siguen existiendo. Solo APROBADA agrupa selectores.
CREATE TABLE flota_identidades_fisicas (
 id INT AUTO_INCREMENT PRIMARY KEY, placa_comparable VARCHAR(40) NOT NULL,
 tipo_unidad VARCHAR(40) NOT NULL, chasis_comparable VARCHAR(80) NOT NULL,
 estado VARCHAR(20) NOT NULL DEFAULT 'PROPUESTA' CHECK(estado IN ('PROPUESTA','APROBADA')),
 creado_por INT NOT NULL, motivo VARCHAR(1000) NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_identidad_real(placa_comparable,tipo_unidad,chasis_comparable),
 FOREIGN KEY(creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE flota_identidad_miembros (
 vehiculo_id INT PRIMARY KEY, identidad_id INT NOT NULL, empresa_id INT NOT NULL,
 snapshot LONGTEXT NOT NULL CHECK(JSON_VALID(snapshot)),
 FOREIGN KEY(vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE RESTRICT,
 FOREIGN KEY(empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
 FOREIGN KEY(identidad_id) REFERENCES flota_identidades_fisicas(id) ON DELETE RESTRICT,
 KEY ix_identidad_empresa(identidad_id,empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE flota_identidad_empresas (
 identidad_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY(identidad_id,empresa_id),
 FOREIGN KEY(identidad_id) REFERENCES flota_identidades_fisicas(id) ON DELETE RESTRICT,
 FOREIGN KEY(empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE flota_identidad_aprobaciones (
 identidad_id INT NOT NULL, empresa_id INT NOT NULL, administrador_id INT NOT NULL,
 evidencia VARCHAR(1000) NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(identidad_id,empresa_id),
 FOREIGN KEY(identidad_id,empresa_id) REFERENCES flota_identidad_empresas(identidad_id,empresa_id) ON DELETE RESTRICT,
 FOREIGN KEY(administrador_id) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
DELIMITER //
CREATE TRIGGER fifi_nueva BEFORE INSERT ON flota_identidades_fisicas FOR EACH ROW
BEGIN
 IF NEW.estado<>'PROPUESTA' OR NEW.chasis_comparable NOT REGEXP '^[A-Z0-9]{6,32}$' OR NEW.chasis_comparable REGEXP '^(.)\\1+$' OR NEW.chasis_comparable IN ('DESCONOCIDO','PENDIENTE','SINDATO','NOAPLICA') OR CHAR_LENGTH(TRIM(NEW.motivo))<10 THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Identidad fisica requiere propuesta e identificadores reales'; END IF;
END//
CREATE TRIGGER fifm_validar BEFORE INSERT ON flota_identidad_miembros FOR EACH ROW
BEGIN
 DECLARE e INT; DECLARE p VARCHAR(40); DECLARE t VARCHAR(40); DECLARE s VARCHAR(80); DECLARE vigente INT;
 SELECT empresa_id,REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(placa)),'‐','-'),'‑','-'),'–','-'),'—','-'),'[[:space:]-]',''),tipo_unidad,REGEXP_REPLACE(UPPER(TRIM(chasis)),'[[:space:]]',''),activo
 INTO e,p,t,s,vigente FROM flota_vehiculos WHERE id=NEW.vehiculo_id LOCK IN SHARE MODE;
 IF e IS NULL OR e<>NEW.empresa_id OR vigente<>1 OR EXISTS(SELECT 1 FROM flota_identidad_aprobaciones WHERE identidad_id=NEW.identidad_id) OR NOT EXISTS(SELECT 1 FROM flota_identidades_fisicas WHERE id=NEW.identidad_id AND estado='PROPUESTA' AND placa_comparable=p AND tipo_unidad=t AND chasis_comparable=s) OR EXISTS(SELECT 1 FROM flota_vehiculos_fusiones WHERE origen_id=NEW.vehiculo_id OR destino_id=NEW.vehiculo_id) THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Miembro incompatible, no vigente o alias previo'; END IF;
END//
CREATE TRIGGER fifm_empresas AFTER INSERT ON flota_identidad_miembros FOR EACH ROW
BEGIN
 INSERT IGNORE INTO flota_identidad_empresas(identidad_id,empresa_id) VALUES(NEW.identidad_id,NEW.empresa_id);
 INSERT IGNORE INTO flota_identidad_empresas(identidad_id,empresa_id) SELECT NEW.identidad_id,empresa_propietaria_id FROM flota_vehiculos WHERE id=NEW.vehiculo_id AND tipo_propiedad='EMPRESA' AND empresa_propietaria_id IS NOT NULL;
END//
CREATE TRIGGER fifm_inmutable BEFORE UPDATE ON flota_identidad_miembros FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Miembro fisico inmutable'; END//
CREATE TRIGGER fifm_no_borrar BEFORE DELETE ON flota_identidad_miembros FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Miembro fisico auditado no se elimina'; END//
CREATE TRIGGER fife_no_borrar BEFORE DELETE ON flota_identidad_empresas FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Aprobacion empresarial requerida no se elimina'; END//
CREATE TRIGGER fife_inmutable BEFORE UPDATE ON flota_identidad_empresas FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Empresa requerida inmutable'; END//
CREATE TRIGGER fifa_validar BEFORE INSERT ON flota_identidad_aprobaciones FOR EACH ROW
BEGIN
 IF NOT EXISTS(SELECT 1 FROM flota_identidades_fisicas WHERE id=NEW.identidad_id AND estado='PROPUESTA') OR NOT EXISTS(SELECT 1 FROM usuarios WHERE id=NEW.administrador_id AND activo=1 AND rol_global='Admin') OR CHAR_LENGTH(TRIM(NEW.evidencia))<10 THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Aprobacion requiere administrador vigente y evidencia'; END IF;
END//
CREATE TRIGGER fifa_inmutable BEFORE UPDATE ON flota_identidad_aprobaciones FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Aprobacion fisica inmutable'; END//
CREATE TRIGGER fifa_no_borrar BEFORE DELETE ON flota_identidad_aprobaciones FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Aprobacion fisica no se elimina'; END//
CREATE TRIGGER fifi_aprobar BEFORE UPDATE ON flota_identidades_fisicas FOR EACH ROW
BEGIN
 IF OLD.estado<>'PROPUESTA' OR NEW.estado<>'APROBADA' OR NOT(NEW.id<=>OLD.id) OR NOT(NEW.placa_comparable<=>OLD.placa_comparable) OR NOT(NEW.tipo_unidad<=>OLD.tipo_unidad) OR NOT(NEW.chasis_comparable<=>OLD.chasis_comparable) OR NOT(NEW.creado_por<=>OLD.creado_por) OR NOT(NEW.motivo<=>OLD.motivo) OR NOT(NEW.creado_en<=>OLD.creado_en) OR (SELECT COUNT(*) FROM flota_identidad_miembros WHERE identidad_id=OLD.id)<2 OR EXISTS(SELECT 1 FROM flota_identidad_empresas e LEFT JOIN flota_identidad_aprobaciones a ON a.identidad_id=e.identidad_id AND a.empresa_id=e.empresa_id WHERE e.identidad_id=OLD.id AND a.identidad_id IS NULL) THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Faltan aprobaciones empresariales o identidad inmutable'; END IF;
END//
CREATE TRIGGER fifi_no_borrar BEFORE DELETE ON flota_identidades_fisicas FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Identidad fisica auditada no se elimina'; END//
CREATE TRIGGER fifv_identidad BEFORE UPDATE ON flota_vehiculos FOR EACH ROW
BEGIN
 IF (NOT(NEW.empresa_id<=>OLD.empresa_id) OR NOT(NEW.placa<=>OLD.placa) OR NOT(NEW.tipo_unidad<=>OLD.tipo_unidad) OR NOT(NEW.chasis<=>OLD.chasis) OR NOT(NEW.tipo_propiedad<=>OLD.tipo_propiedad) OR NOT(NEW.empresa_propietaria_id<=>OLD.empresa_propietaria_id) OR NOT(NEW.propietario_externo<=>OLD.propietario_externo)) AND EXISTS(SELECT 1 FROM flota_identidad_miembros WHERE vehiculo_id=OLD.id) THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Identidad fisica propuesta o aprobada: requiere revision independiente'; END IF;
END//
-- Mismos nombres/contrato que el postcheck de guardas de #608 para la nueva FK.
CREATE TRIGGER ffi_2abd957034829d58fcc789b21f6ed7e4 BEFORE INSERT ON flota_identidad_miembros FOR EACH ROW
BEGIN
 DECLARE alias_id INT DEFAULT NULL;
 SELECT f.origen_id INTO alias_id FROM flota_vehiculos v LEFT JOIN flota_vehiculos_fusiones f ON f.origen_id=v.id WHERE v.id=NEW.vehiculo_id LOCK IN SHARE MODE;
 IF alias_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Seleccione la unidad principal: ID fusionado'; END IF;
END//
CREATE TRIGGER ffu_2abd957034829d58fcc789b21f6ed7e4 BEFORE UPDATE ON flota_identidad_miembros FOR EACH ROW
BEGIN
 IF NOT(NEW.vehiculo_id<=>OLD.vehiculo_id) AND EXISTS(SELECT 1 FROM flota_vehiculos_fusiones WHERE origen_id=NEW.vehiculo_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Seleccione la unidad principal: ID fusionado'; END IF;
END//
DELIMITER ;
