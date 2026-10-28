-- Únicamente instancia nueva verificada; todos los datos son ficticios.
CREATE TABLE empresas(id INT PRIMARY KEY,activa TINYINT NOT NULL,modulos_json TEXT) ENGINE=InnoDB;
CREATE TABLE usuarios(id INT PRIMARY KEY,username VARCHAR(100),rol_global VARCHAR(40),activo TINYINT,acceso_todas_empresas TINYINT) ENGINE=InnoDB;
CREATE TABLE usuario_empresa(usuario_id INT,empresa_id INT,PRIMARY KEY(usuario_id,empresa_id)) ENGINE=InnoDB;
CREATE TABLE usuario_modulo(usuario_id INT,empresa_id INT NULL,modulo VARCHAR(40),puede_ver TINYINT) ENGINE=InnoDB;
CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT NOT NULL,codigo VARCHAR(40),nombre VARCHAR(100),activa TINYINT NOT NULL,UNIQUE KEY(empresa_id,id),FOREIGN KEY(empresa_id) REFERENCES empresas(id)) ENGINE=InnoDB;
CREATE TABLE cont_cuentas(id INT PRIMARY KEY,empresa_id INT,entidad_id INT,codigo VARCHAR(40),activa TINYINT,UNIQUE KEY uq_cuenta_entidad(empresa_id,entidad_id,codigo),UNIQUE KEY(empresa_id,entidad_id,id),CONSTRAINT fk_cont_cuenta_entidad FOREIGN KEY(empresa_id,entidad_id) REFERENCES cont_entidades(empresa_id,id)) ENGINE=InnoDB;
CREATE TABLE cont_asientos(id INT PRIMARY KEY AUTO_INCREMENT,empresa_id INT,entidad_id INT,fecha DATE,numero VARCHAR(40),glosa VARCHAR(500),estado VARCHAR(40),creado_por VARCHAR(100),UNIQUE KEY uq_asiento_entidad(empresa_id,entidad_id,numero),UNIQUE KEY(empresa_id,entidad_id,id),CONSTRAINT fk_cont_asiento_entidad FOREIGN KEY(empresa_id,entidad_id) REFERENCES cont_entidades(empresa_id,id)) ENGINE=InnoDB;
CREATE TABLE cont_asiento_detalle(id INT PRIMARY KEY AUTO_INCREMENT,empresa_id INT,entidad_id INT,asiento_id INT,cuenta_id INT,debe DECIMAL(14,2),haber DECIMAL(14,2),CONSTRAINT fk_cont_detalle_asiento_ambito FOREIGN KEY(empresa_id,entidad_id,asiento_id) REFERENCES cont_asientos(empresa_id,entidad_id,id),CONSTRAINT fk_cont_detalle_cuenta_ambito FOREIGN KEY(empresa_id,entidad_id,cuenta_id) REFERENCES cont_cuentas(empresa_id,entidad_id,id)) ENGINE=InnoDB;
CREATE TABLE auditoria(id INT PRIMARY KEY AUTO_INCREMENT,empresa_id INT,usuario VARCHAR(100),accion VARCHAR(80),modulo VARCHAR(40),detalle MEDIUMTEXT,creado_en DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
INSERT INTO empresas VALUES(7,1,'["contabilidad"]'),(8,1,'["contabilidad"]');
INSERT INTO usuarios VALUES(41,'lab-operador','Contabilidad',1,0),(42,'lab-aprobador','Admin',1,0),(43,'lab-denegado','Admin',1,0);
INSERT INTO usuario_empresa VALUES(41,7),(42,7);
INSERT INTO cont_entidades VALUES(9,7,'A','Libro ficticio A',1),(10,7,'B','Libro ficticio B',1),(11,8,'C','Libro ficticio C',1);
INSERT INTO cont_cuentas VALUES(1,7,9,'A',1),(2,7,9,'B',1),(3,7,10,'A',1),(4,7,10,'B',1);

CREATE TABLE cont_cxc(id INT PRIMARY KEY,empresa_id INT,entidad_id INT,CONSTRAINT fk_cont_cxc_entidad FOREIGN KEY(empresa_id,entidad_id) REFERENCES cont_entidades(empresa_id,id)) ENGINE=InnoDB;
CREATE TABLE cont_cxp(id INT PRIMARY KEY,empresa_id INT,entidad_id INT,CONSTRAINT fk_cont_cxp_entidad FOREIGN KEY(empresa_id,entidad_id) REFERENCES cont_entidades(empresa_id,id)) ENGINE=InnoDB;
