-- SOLO LABORATORIO AISLADO: datos y esquema sinteticos; no ejecutar en bases existentes.
CREATE TABLE empresas (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, activa TINYINT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE usuarios (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, activo TINYINT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE compras_proveedores (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL,
 nombre_comercial VARCHAR(200) NOT NULL, activo TINYINT NOT NULL,
 UNIQUE KEY uq_compras_proveedor_empresa (empresa_id,id),
 CONSTRAINT fk_cb_proveedores_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
 ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE flota_vehiculos (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL,
 UNIQUE KEY uq_flota_vehiculos_empresa_id (empresa_id,id)
) ENGINE=InnoDB;
CREATE TABLE flota_vehiculo_acceso (
 vehiculo_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY (vehiculo_id,empresa_id)
) ENGINE=InnoDB;
CREATE TABLE flota_combustible_cargas (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE flota_combustible_conciliaciones (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL,
 proveedor_id INT NULL, perfil_parser VARCHAR(40) NULL, archivo_sha256 CHAR(64) NULL,
 UNIQUE KEY uq_fcci_archivo (empresa_id,proveedor_id,archivo_sha256),
 UNIQUE KEY uq_fcci_empresa_id (empresa_id,id),
 CONSTRAINT fk_fcci_proveedor FOREIGN KEY (empresa_id,proveedor_id)
 REFERENCES compras_proveedores(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE flota_combustible_conciliacion_filas (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL,
 conciliacion_id INT NOT NULL, clave_operacion CHAR(64) NULL,
 UNIQUE KEY uq_fccif_empresa_import_id (empresa_id,conciliacion_id,id),
 KEY idx_fccif_clave (empresa_id,clave_operacion),
 CONSTRAINT fk_fccif_importacion FOREIGN KEY (empresa_id,conciliacion_id)
 REFERENCES flota_combustible_conciliaciones(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE auditoria (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NULL,
 usuario VARCHAR(100) NULL, accion VARCHAR(80) NOT NULL, modulo VARCHAR(40) NULL, detalle TEXT NULL
) ENGINE=InnoDB;
INSERT INTO empresas VALUES (1,1),(2,1);
INSERT INTO usuarios VALUES (1,1);
INSERT INTO compras_proveedores VALUES (1,1,'SINTETICO_A',1),(2,1,'SINTETICO_B',1),(3,2,'SINTETICO_C',1);
INSERT INTO flota_vehiculos VALUES (1,1),(2,2);
INSERT INTO flota_vehiculo_acceso VALUES (2,1);
