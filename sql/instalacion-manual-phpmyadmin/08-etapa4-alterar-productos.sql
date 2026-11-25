-- ETAPA 4: canecas_productos: activo_unico (virtual) y UNIQUE (una caneca activa por empresa)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- No marque "Ignorar errores"; deje activada la casilla de claves foraneas. Si una sentencia da error, DETENGASE y use sql/recuperacion-canecas-simplificacion-solo-lectura.sql.
-- Falla (clave duplicada) si alguna empresa tiene mas de una caneca activa: el preflight lo detecta antes.
--

-- GUARDA: si falla, MariaDB responde error 1242 en esta sentencia y NO se ejecuta nada de la etapa 4. Significa: ejecute 07-verificar-etapa3.sql
SELECT CASE WHEN (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='doc_auto')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico')=0 THEN 'GUARDA OK etapa 4' ELSE (SELECT 'DETENER: prerequisitos de la etapa 4 incompletos' UNION ALL SELECT 'ver ejecute 07-verificar-etapa3.sql') END AS guarda;

ALTER TABLE `u611730801_Plataforma`.canecas_productos
  ADD COLUMN activo_unico TINYINT(1) GENERATED ALWAYS AS (IF(activo = 1, 1, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_can_producto_activo_unico (empresa_id,activo_unico);
