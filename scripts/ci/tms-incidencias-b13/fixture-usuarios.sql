-- [LAB B13] Tabla de apoyo MÍNIMA, SOLO para el laboratorio desechable. NO es esquema de producción.
-- Reproduce los tipos de sql/schema.sql (CREATE TABLE IF NOT EXISTS usuarios: id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(80) NOT NULL UNIQUE), que es lo que usa
-- la clave foránea fk_tmspr_usuario del SQL bajo prueba. Una prueba compara estos tipos con los de schema.sql.
CREATE TABLE usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  nombre VARCHAR(200) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
