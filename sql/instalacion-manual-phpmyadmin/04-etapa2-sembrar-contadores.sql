-- ETAPA 2: sembrar los contadores con el maximo historico por empresa y tipo (INSERT solo en la tabla nueva)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- No marque "Ignorar errores"; deje activada la casilla de claves foraneas. Si una sentencia da error, DETENGASE y use sql/recuperacion-canecas-simplificacion-solo-lectura.sql.
-- No renumera ni modifica ningun documento existente; no rellena huecos.
--

-- GUARDA: si falla, MariaDB responde error 1242 (o 1146 si falta una tabla requerida) en esta sentencia y NO se ejecuta nada de la etapa 2. Significa: ejecute 03-verificar-etapa1.sql
SELECT CASE WHEN (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_secuencias')=1 AND (SELECT COUNT(*) FROM `u611730801_Plataforma`.canecas_secuencias)=0 THEN 'GUARDA OK etapa 2' ELSE (SELECT 'DETENER: prerequisitos de la etapa 2 incompletos' UNION ALL SELECT 'ver ejecute 03-verificar-etapa1.sql') END AS guarda;

INSERT INTO `u611730801_Plataforma`.canecas_secuencias (empresa_id,tipo,ultimo)
SELECT e.id, t.tipo, COALESCE(h.maximo, 0)
FROM `u611730801_Plataforma`.empresas e
CROSS JOIN (SELECT 'COMPRA' AS tipo UNION ALL SELECT 'PRODUCTO' UNION ALL SELECT 'VENTA') t
LEFT JOIN (
  SELECT empresa_id, 'COMPRA' AS tipo, MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(referencia)), '^COMP[ _-]?', '') AS UNSIGNED)) AS maximo FROM `u611730801_Plataforma`.canecas_compras WHERE UPPER(TRIM(referencia)) REGEXP '^COMP[ _-]?[0-9]{1,15}$' GROUP BY empresa_id
  UNION ALL SELECT empresa_id, 'VENTA', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(documento)), '^VTA[ _-]?', '') AS UNSIGNED)) FROM `u611730801_Plataforma`.canecas_ventas WHERE UPPER(TRIM(documento)) REGEXP '^VTA[ _-]?[0-9]{1,15}$' GROUP BY empresa_id
  UNION ALL SELECT empresa_id, 'PRODUCTO', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(codigo)), '^CAN[ _-]?', '') AS UNSIGNED)) FROM `u611730801_Plataforma`.canecas_productos WHERE UPPER(TRIM(codigo)) REGEXP '^CAN[ _-]?[0-9]{1,15}$' GROUP BY empresa_id
) h ON h.empresa_id = e.id AND h.tipo = t.tipo;
