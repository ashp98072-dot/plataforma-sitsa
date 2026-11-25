-- ETAPA 1: crear la tabla canecas_secuencias (vacia)
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- ETAPA DE ESCRITURA (DDL no transaccional en MariaDB). Requisitos: respaldo restaurable verificado, Canecas sin escrituras, autorizacion expresa.
-- No marque "Ignorar errores"; deje activada la casilla de claves foraneas. Si una sentencia da error, DETENGASE y use sql/recuperacion-canecas-simplificacion-solo-lectura.sql.
--

-- GUARDA: si falla, MariaDB responde error 1242 en esta sentencia y NO se ejecuta nada de la etapa 1. Significa: ejecute 01-verificar-previo.sql y revise cada fila
SELECT CASE WHEN (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_ventas')=1 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_productos')=1 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_compras')=1 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='empresas')=1 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='u611730801_Plataforma' AND TABLE_NAME='canecas_secuencias')=0 AND (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='u611730801_Plataforma' AND TRIGGER_NAME IN ('trg_can_venta_bu','trg_can_venta_bd'))=2 THEN 'GUARDA OK etapa 1' ELSE (SELECT 'DETENER: prerequisitos de la etapa 1 incompletos' UNION ALL SELECT 'ver ejecute 01-verificar-previo.sql y revise cada fila') END AS guarda;

CREATE TABLE `u611730801_Plataforma`.canecas_secuencias (
  empresa_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  ultimo BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id,tipo),
  CONSTRAINT chk_can_secuencia CHECK (ultimo >= 0),
  CONSTRAINT fk_can_secuencia_empresa FOREIGN KEY (empresa_id) REFERENCES `u611730801_Plataforma`.empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
