-- ETAPA 3: canecas_ventas: direccion_entrega, CHECK, doc_auto y UNIQUE (una sola sentencia ALTER)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- No marque "Ignorar errores"; deje activada la casilla de claves foraneas. Si una sentencia da error, DETENGASE y use sql/recuperacion-canecas-simplificacion-solo-lectura.sql.
--

-- GUARDA: si falla, MariaDB responde error 1242 (o 1146 si falta una tabla requerida) en esta sentencia y NO se ejecuta nada de la etapa 3. Significa: ejecute 05-verificar-etapa2.sql
SELECT CASE WHEN (SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_secuencias)=(SELECT COUNT(*)*3 FROM `u611730801_Plataforma`.empresas) AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega')=0 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='doc_auto')=0 THEN 'GUARDA OK etapa 3' ELSE (SELECT 'DETENER: prerequisitos de la etapa 3 incompletos' UNION ALL SELECT 'ver ejecute 05-verificar-etapa2.sql') END AS guarda;

ALTER TABLE `u611730801_Plataforma`.canecas_ventas
  ADD COLUMN direccion_entrega VARCHAR(500) NULL AFTER ubicacion_id,
  ADD CONSTRAINT chk_can_venta_direccion CHECK (direccion_entrega IS NULL OR CHAR_LENGTH(TRIM(direccion_entrega)) > 0),
  ADD COLUMN doc_auto VARCHAR(250) GENERATED ALWAYS AS (IF(documento REGEXP '^VTA-[0-9]{6,15}$', documento, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_can_venta_doc_auto (empresa_id,doc_auto);
