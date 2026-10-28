-- Solo datos ficticios. No usa schema.sql ni restauraciones.
CREATE TABLE empresas (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE usuarios (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE cont_entidades (
 id INT NOT NULL PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL,
 nombre VARCHAR(200) NOT NULL, activa TINYINT NOT NULL DEFAULT 1,
 UNIQUE KEY uq_entidad_empresa (empresa_id,id),
 FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
CREATE TABLE auditoria (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, empresa_id INT NULL,
 usuario VARCHAR(100) NULL, accion VARCHAR(80) NOT NULL, modulo VARCHAR(40) NULL,
 detalle TEXT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT INTO empresas VALUES (7),(8);
INSERT INTO usuarios VALUES (4);
INSERT INTO cont_entidades VALUES (9,7,'A','Libro ficticio A',1),(10,7,'B','Libro ficticio B',1),(11,8,'C','Libro ficticio C',1);
