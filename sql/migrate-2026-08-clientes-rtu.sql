-- Agrega el número de RTU al catálogo compartido de clientes.
-- Aplicación manual segura para MariaDB 11.x.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS rtu VARCHAR(60) NULL AFTER nit;
