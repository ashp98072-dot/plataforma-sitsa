-- Instalación manual únicamente tras preflight y autorización. No modifica históricos.
CREATE TABLE flota_cb2_placas_equivalencias (
 empresa_id INT NOT NULL,
 proveedor_id INT NOT NULL,
 placa_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 placa_normalizada VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 placa_original VARCHAR(255) NOT NULL,
 vehiculo_id INT NOT NULL,
 motivo VARCHAR(1000) NOT NULL,
 creado_por INT NOT NULL,
 creado_en DATETIME(6) NOT NULL,
 revocado_por INT NULL,
 revocado_en DATETIME(6) NULL,
 PRIMARY KEY (empresa_id, proveedor_id, placa_hash),
 CONSTRAINT fk_cb2placa_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
 CONSTRAINT fk_cb2placa_proveedor FOREIGN KEY (empresa_id,proveedor_id) REFERENCES compras_proveedores(empresa_id,id),
 CONSTRAINT fk_cb2placa_vehiculo FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id),
 CONSTRAINT fk_cb2placa_creado FOREIGN KEY (creado_por) REFERENCES usuarios(id),
 CONSTRAINT fk_cb2placa_revocado FOREIGN KEY (revocado_por) REFERENCES usuarios(id),
 CONSTRAINT ck_cb2placa_revocacion CHECK ((revocado_por IS NULL AND revocado_en IS NULL) OR (revocado_por IS NOT NULL AND revocado_en IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
