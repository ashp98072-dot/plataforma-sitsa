-- TMS-PROGRAMACION-LOTE-1 (PR A) — trazabilidad de origen de planes creados por lote.
--
-- ADITIVA y no destructiva: solo CREATE TABLE IF NOT EXISTS (segura de repetir). No altera tms_planes_viaje.
-- NO ejecutada por este PR. Correr antes: preflight-2026-09-tms-plan-origen.sql.
--
-- Una fila por plan CREADO desde una copia (tipo 'COPIA'; el PR B agregará 'PLANTILLA' con su propia columna
-- de referencia mediante un ALTER aditivo). NO hay UNIQUE sobre (plan_origen_id, fecha_destino): un plan destino
-- CANCELADO no debe impedir volver a copiar. El anti-duplicado lo hace la aplicación, bajo el candado por
-- empresa, considerando solo copias cuyo plan destino NO esté Cancelado; el índice de abajo sirve a esa consulta:
--   WHERE empresa_id = ? AND tipo = 'COPIA' AND fecha_destino = ? AND plan_origen_id IN (...)
--
-- FKs: empresa CASCADE; plan_id CASCADE (si el plan se elimina, su trazabilidad se va con él);
-- plan_origen_id SET NULL (si el plan origen se elimina, se conserva el registro histórico del intento).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS tms_plan_origen (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  plan_origen_id INT NULL,
  fecha_destino DATE NOT NULL,
  creado_por VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plan_origen_plan (plan_id),
  INDEX idx_plan_origen_dup (empresa_id, tipo, fecha_destino, plan_origen_id),
  INDEX idx_plan_origen_origen (plan_origen_id),
  CONSTRAINT fk_plan_origen_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_origen_plan FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE CASCADE,
  CONSTRAINT fk_plan_origen_origen FOREIGN KEY (plan_origen_id) REFERENCES tms_planes_viaje(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
