-- PROPUESTA MANUAL, independiente de #616/#620. Solo tablas nuevas; sin backfill.
-- Un nombre reportado NO acredita una persona, empleo ni relación contractual.
CREATE TABLE flota_cb2_pilotos_reportados (
 id INT NOT NULL AUTO_INCREMENT,
 empresa_id INT NOT NULL,
 normalizacion_version SMALLINT NOT NULL DEFAULT 1,
 nombre_normalizado VARCHAR(768) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 nombre_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 nombre_muestra VARCHAR(255) NOT NULL,
 estado VARCHAR(30) NOT NULL DEFAULT 'REPORTADO_CONFIRMADO',
 creado_por INT NOT NULL,
 creado_en DATETIME(6) NOT NULL,
 PRIMARY KEY(id),
 UNIQUE KEY uq_cb2pr_ambito(empresa_id,id),
 UNIQUE KEY uq_cb2pr_nombre(empresa_id,normalizacion_version,nombre_hash),
 CONSTRAINT fk_cb2pr_empresa FOREIGN KEY(empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_cb2pr_actor FOREIGN KEY(creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ck_cb2pr_version CHECK(normalizacion_version=1),
 CONSTRAINT ck_cb2pr_estado CHECK(estado='REPORTADO_CONFIRMADO'),
 CONSTRAINT ck_cb2pr_nombre CHECK(CHAR_LENGTH(nombre_normalizado)>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE flota_cb2_consumo_piloto_reportado (
 empresa_id INT NOT NULL,
 proveedor_id INT NOT NULL,
 consumo_id INT NOT NULL,
 piloto_reportado_id INT NOT NULL,
 PRIMARY KEY(empresa_id,proveedor_id,consumo_id),
 KEY ix_cb2cpr_piloto(empresa_id,piloto_reportado_id),
 CONSTRAINT fk_cb2cpr_consumo FOREIGN KEY(empresa_id,proveedor_id,consumo_id) REFERENCES flota_cb2_consumos(empresa_id,proveedor_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_cb2cpr_piloto FOREIGN KEY(empresa_id,piloto_reportado_id) REFERENCES flota_cb2_pilotos_reportados(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Equivalencias confirmadas. No altera empleados ni consumos históricos.
CREATE TABLE flota_cb2_pilotos_equivalencias (
 empresa_id INT NOT NULL,
 normalizacion_version SMALLINT NOT NULL DEFAULT 1,
 nombre_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 nombre_normalizado VARCHAR(768) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 empleado_id INT NULL,
 piloto_reportado_id INT NULL,
 requiere_revision TINYINT NOT NULL DEFAULT 0,
 confirmado_por INT NOT NULL,
 confirmado_en DATETIME(6) NOT NULL,
 PRIMARY KEY(empresa_id,normalizacion_version,nombre_hash),
 CONSTRAINT fk_cb2pe_empresa FOREIGN KEY(empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_cb2pe_empleado FOREIGN KEY(empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_cb2pe_reportado FOREIGN KEY(empresa_id,piloto_reportado_id) REFERENCES flota_cb2_pilotos_reportados(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_cb2pe_actor FOREIGN KEY(confirmado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ck_cb2pe_revision CHECK(requiere_revision IN (0,1)),
 CONSTRAINT ck_cb2pe_version CHECK(normalizacion_version=1),
 CONSTRAINT ck_cb2pe_destino CHECK((empleado_id IS NOT NULL)+(piloto_reportado_id IS NOT NULL)=1),
 CONSTRAINT ck_cb2pe_nombre CHECK(CHAR_LENGTH(nombre_normalizado)>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
