-- Versionada, revisión antes de aplicar. NO ejecutada por requests. Sin backfill ni cambios de IDs históricos.
-- Requiere el esquema CB2 vigente. Aplicar una sola vez; no activar D2 con esta migración.
CREATE TABLE flota_cb2_externos_pilotos (
 id INT NOT NULL AUTO_INCREMENT, empresa_id INT NOT NULL, referencia VARCHAR(160) NOT NULL,
 referencia_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, nombre VARCHAR(160) NOT NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_cb2ep_ambito(empresa_id,id), UNIQUE KEY uq_cb2ep_ref(empresa_id,referencia_hash),
 FOREIGN KEY(empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE flota_cb2_externos_unidades (
 id INT NOT NULL AUTO_INCREMENT, empresa_id INT NOT NULL, referencia VARCHAR(160) NOT NULL,
 referencia_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, placa VARCHAR(160) NOT NULL,
 tipo VARCHAR(20) NOT NULL, descripcion VARCHAR(160) NOT NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_cb2eu_ambito(empresa_id,id), UNIQUE KEY uq_cb2eu_ref(empresa_id,referencia_hash),
 CHECK(tipo IN ('VEHICULO','MOTOCICLETA')), FOREIGN KEY(empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE flota_cb2_externos_asociaciones (
 id INT NOT NULL AUTO_INCREMENT, empresa_id INT NOT NULL, piloto_id INT NOT NULL, unidad_id INT NOT NULL,
 relacion VARCHAR(20) NOT NULL, evidencia VARCHAR(160) NOT NULL, estado VARCHAR(20) NOT NULL,
 revision INT NOT NULL DEFAULT 0, creado_por INT NOT NULL, verificado_por INT NULL,
 PRIMARY KEY(id), UNIQUE KEY uq_cb2ea_ambito(empresa_id,id), UNIQUE KEY uq_cb2ea_pair(empresa_id,piloto_id,unidad_id),
 FOREIGN KEY(empresa_id,piloto_id) REFERENCES flota_cb2_externos_pilotos(empresa_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(empresa_id,unidad_id) REFERENCES flota_cb2_externos_unidades(empresa_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 FOREIGN KEY(verificado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
 CHECK(estado IN ('PENDIENTE','VERIFICADA','REVOCADA')),
 CHECK(relacion IN ('CONTRATISTA','INDEPENDIENTE','TERCERIZADO')),
 CHECK(estado <> 'VERIFICADA' OR (verificado_por IS NOT NULL AND verificado_por <> creado_por))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
ALTER TABLE flota_cb2_consumos
 MODIFY vehiculo_id INT NULL,
 ADD asociacion_externa_id INT NULL,
 ADD identidad_externa LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
 ADD CONSTRAINT fk_cb2c_externo FOREIGN KEY(empresa_id,asociacion_externa_id) REFERENCES flota_cb2_externos_asociaciones(empresa_id,id) ON DELETE RESTRICT,
 ADD CONSTRAINT ck_cb2c_unidad_tipo CHECK ((vehiculo_id IS NOT NULL AND asociacion_externa_id IS NULL AND identidad_externa IS NULL) OR (vehiculo_id IS NULL AND empleado_id IS NULL AND asociacion_externa_id IS NOT NULL AND identidad_externa IS NOT NULL AND JSON_VALID(identidad_externa)));
