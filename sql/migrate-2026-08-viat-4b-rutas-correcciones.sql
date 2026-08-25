-- VIAT-4b — correcciones a VIAT-4 tras revisar el Excel real
-- ("PROGRAMACION AGOSTO 2026 ACTUALIZADA.xlsx", hoja "CODIGOS DATA": 147
-- registros, 147 códigos únicos, 0 duplicados — el código funciona como
-- identificador GLOBAL del catálogo, no por cliente).
--
-- IMPORTANTE: la migración VIAT-4 (migrate-2026-08-viat-4-contactos-
-- rutas.sql) YA FUE APLICADA MANUALMENTE EN PRODUCCIÓN — este archivo es
-- una migración INCREMENTAL NUEVA, no se modifica retroactivamente la
-- anterior. Aditiva donde es posible (B y C); el cambio de índice único
-- (A) no es aditivo (reemplaza una restricción existente) y NO se ejecuta
-- automáticamente — esta migración, como todas las de SITSA, NO se
-- ejecuta en runtime ni se ejecutó en este entorno.

-- ============================================================
-- A) Índice único de tms_cliente_rutas.codigo: por EMPRESA, no por
-- cliente (VIAT-4 lo dejó por cliente sin poder verificar el dato real
-- en ese momento; el Excel real confirma que es global).
--
-- VERIFICAR ANTES DE EJECUTAR (obligatorio) — si esta consulta devuelve
-- alguna fila, el ALTER de abajo fallará por códigos duplicados entre
-- clientes distintos bajo el índice global nuevo y hay que resolver esos
-- casos primero (renombrar código o fusionar) antes de aplicar el ALTER:
--
--   SELECT empresa_id, codigo, COUNT(*) AS filas
--   FROM tms_cliente_rutas
--   GROUP BY empresa_id, codigo
--   HAVING COUNT(*) > 1;
--
-- Si la migración VIAT-4 se aplicó hace poco y todavía no se cargaron
-- rutas reales (o todas ya son únicas por construcción), esta consulta
-- debe devolver cero filas.
-- ============================================================
ALTER TABLE tms_cliente_rutas
  DROP INDEX uq_tmsclirutas_codigo,
  ADD UNIQUE KEY uq_tmsclirutas_codigo (empresa_id, codigo);

-- ============================================================
-- B) Descripción operativa completa del destino en la ruta MAESTRA.
-- Columna DISTINTA de tms_cliente_ruta_paradas (paradas estructuradas,
-- con orden) — el Excel real guarda el destino como texto libre
-- descriptivo (formato tipo "RUTA-X - punto1-punto2-punto3-punto4",
-- máx. 64 caracteres en la muestra real), no como una lista de paradas
-- discretas. Las paradas estructuradas se
-- mantienen intactas y siguen existiendo en paralelo.
-- ============================================================
ALTER TABLE tms_cliente_rutas
  ADD COLUMN IF NOT EXISTS destino_descripcion VARCHAR(300) NULL AFTER lugar_carga_texto;

-- ============================================================
-- C) Fotografía histórica en el VIAJE — se agregan a las columnas de
-- VIAT-4 (ruta_id, ruta_codigo_historico) el destino y el contacto
-- usados en el momento, para que:
--   - el reporte tradicional (Lugar de Descarga) use SIEMPRE el texto
--     histórico del viaje, nunca "primera parada" ni un recálculo desde
--     la ruta viva;
--   - si el contacto/supervisor del cliente cambia después, un viaje ya
--     coordinado no muestre retroactivamente a la persona nueva.
-- contacto_cliente_id de la ruta sigue siendo la referencia informativa
-- (ya existente vía tms_cliente_rutas.contacto_cliente_id); estas
-- columnas son la COPIA de nombre/cargo/teléfono en ese momento.
-- ============================================================
ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS lugar_descarga_historico VARCHAR(300) NULL AFTER ruta_codigo_historico,
  ADD COLUMN IF NOT EXISTS contacto_nombre_historico VARCHAR(160) NULL AFTER lugar_descarga_historico,
  ADD COLUMN IF NOT EXISTS contacto_cargo_historico VARCHAR(120) NULL AFTER contacto_nombre_historico,
  ADD COLUMN IF NOT EXISTS contacto_telefono_historico VARCHAR(80) NULL AFTER contacto_cargo_historico;
