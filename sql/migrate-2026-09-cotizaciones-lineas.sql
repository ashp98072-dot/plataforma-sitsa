-- COTIZACIONES — varias rutas/viajes por cotización, cada una con su propio precio.
-- MariaDB 11.8 / InnoDB / utf8mb4. Migración ADITIVA (tabla nueva). NO fue ejecutada por este PR.
--
-- La cotización (tms_cotizaciones) conserva SIN CAMBIOS sus columnas actuales
-- (origen_texto, destino_texto, unidad_descripcion, tarifa_cotizada, incluye_iva):
-- pasan a representar la LÍNEA PRINCIPAL (orden 1) de la propuesta. El costeo
-- interno (cotizacion-costeo-servicio.ts) sigue leyendo exclusivamente esas
-- columnas — no cambia, no se le agrega ninguna noción de "varias líneas".
--
-- Esta tabla nueva guarda SOLO las líneas ADICIONALES (orden 2 en adelante)
-- de la misma cotización — p.ej. varios destinos de una misma ruta, cada uno
-- con su propio precio (mismo caso real: 4 destinos PriceSmart, un renglón
-- por destino, cada uno Q937.50).
--
-- tms_cotizacion_lineas
--   id                   PK.
--   empresa_id           aislamiento multiempresa (igual patrón que el resto
--                        del esquema); además de la FK simple a empresas,
--                        una FK compuesta (empresa_id, cotizacion_id) contra
--                        tms_cotizaciones(empresa_id, id) impide que una línea
--                        quede asociada a una cotización de OTRA empresa.
--   cotizacion_id        cotización dueña de la línea.
--   orden                2, 3, 4… (1 es siempre la línea principal, implícita
--                        en la propia cotización, nunca en esta tabla).
--   origen_texto / destino_texto / unidad_descripcion / tarifa_cotizada
--                        mismos campos y mismo significado que sus homólogos
--                        en tms_cotizaciones, para que el PDF y el costeo no
--                        necesiten dos formatos distintos.
--
-- Sin DROP, sin ALTER sobre tablas existentes, sin UPDATE/INSERT/DELETE.
-- Ejecutar SOLO después de revisar sql/preflight-2026-09-cotizaciones-lineas.sql
-- (resultado APLICAR). Debe aplicarse ANTES de desplegar el código de este PR:
-- la creación/edición de cotizaciones con varias líneas ya usa esta tabla.

CREATE TABLE IF NOT EXISTS tms_cotizacion_lineas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cotizacion_id INT NOT NULL,
  orden INT NOT NULL,
  origen_texto VARCHAR(300) NULL,
  destino_texto VARCHAR(300) NULL,
  unidad_descripcion VARCHAR(160) NULL,
  tarifa_cotizada DECIMAL(12,2) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cotizacion_lineas_empresa_id (empresa_id, id),
  UNIQUE KEY uq_cotizacion_lineas_orden (empresa_id, cotizacion_id, orden),
  INDEX idx_cotizacion_lineas_cotizacion (empresa_id, cotizacion_id),
  CONSTRAINT fk_cotlineas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cotlineas_cotizacion_ambito FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
