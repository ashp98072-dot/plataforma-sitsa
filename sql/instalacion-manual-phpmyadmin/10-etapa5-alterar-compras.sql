-- ETAPA 5: canecas_compras: ref_auto (virtual) y UNIQUE de referencias con formato generado
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- No marque "Ignorar errores"; deje activada la casilla de claves foraneas. Si una sentencia da error, DETENGASE y use sql/recuperacion-canecas-simplificacion-solo-lectura.sql.
-- Falla (clave duplicada) si hay COMP-###### repetido dentro de una empresa: el preflight lo detecta antes.
--

-- GUARDA: si falla, MariaDB responde error 1242 (o 1146 si falta una tabla requerida) en esta sentencia y NO se ejecuta nada de la etapa 5. Significa: ejecute 09-verificar-etapa4.sql
SELECT CASE WHEN (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_productos' AND COLUMN_NAME='activo_unico')=1 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='ref_auto')=0 THEN 'GUARDA OK etapa 5' ELSE (SELECT 'DETENER: prerequisitos de la etapa 5 incompletos' UNION ALL SELECT 'ver ejecute 09-verificar-etapa4.sql') END AS guarda;

ALTER TABLE `u611730801_Plataforma`.canecas_compras
  ADD COLUMN ref_auto VARCHAR(250) GENERATED ALWAYS AS (IF(referencia REGEXP '^COMP-[0-9]{6,15}$', referencia, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_can_compra_ref_auto (empresa_id,ref_auto);
