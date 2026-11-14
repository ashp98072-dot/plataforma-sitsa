-- PROPUESTA MANUAL. No se ejecuta desde la aplicación. Sin backfill ni cambios en consumos.
-- Requiere CB2 y Fondos instalados; una repetición debe fallar, no ocultar instalación parcial.
-- Reutiliza uq_fondolin_c2a_empresa_id (empresa_id,id), instalado por C2A.
-- Ejecutar solo si el preflight acredita ese índice y la compatibilidad de las FK.
CREATE TABLE flota_cb2_fondos_vinculos (
 empresa_id INT NOT NULL,
 proveedor_id INT NOT NULL,
 consumo_id INT NOT NULL,
 linea_id INT NOT NULL,
 revision_asignacion INT NOT NULL,
 snapshot LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 motivo VARCHAR(1000) NOT NULL,
 creado_por INT NOT NULL,
 creado_en DATETIME(6) NOT NULL,
 PRIMARY KEY(empresa_id,proveedor_id,consumo_id),
 KEY ix_cb2fv_linea(empresa_id,linea_id),
 CONSTRAINT fk_cb2fv_consumo FOREIGN KEY(empresa_id,proveedor_id,consumo_id) REFERENCES flota_cb2_consumos(empresa_id,proveedor_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_cb2fv_linea FOREIGN KEY(empresa_id,linea_id) REFERENCES tms_solicitud_fondo_lineas(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_cb2fv_actor FOREIGN KEY(creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ck_cb2fv_snapshot CHECK(JSON_VALID(snapshot)),
 CONSTRAINT ck_cb2fv_revision CHECK(revision_asignacion>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
