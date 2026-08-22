-- RRHH — Múltiples supervisores por empleado
--
-- Aditivo, no destructivo. No borra ni modifica empleados.supervisor_id.
--
-- empleado_supervisores: tabla puente N a N entre empleados. Reemplaza a
-- empleados.supervisor_id como fuente de verdad para las lecturas nuevas
-- (listarSubordinados, autorización de horas extra), pero supervisor_id se
-- sigue escribiendo en paralelo (= primer supervisor de la lista, o NULL si
-- no hay ninguno) como compatibilidad legado mientras se migran las
-- lecturas restantes. Ver src/lib/rrhh/empleados.ts
-- (sincronizarSupervisoresEmpleado).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + backfill con NOT EXISTS (seguro
-- de re-ejecutar tantas veces como haga falta).

SET NAMES utf8mb4;
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS empleado_supervisores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  supervisor_id INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_empsup_relacion (empresa_id, empleado_id, supervisor_id),
  INDEX idx_empsup_empleado (empresa_id, empleado_id),
  INDEX idx_empsup_supervisor (empresa_id, supervisor_id),
  CONSTRAINT fk_empsup_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_empsup_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_empsup_supervisor FOREIGN KEY (supervisor_id) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill: cada empleado con supervisor_id ya asignado bajo el modelo
-- anterior queda representado también en la tabla puente, sin duplicar si
-- la migración se corre más de una vez.
INSERT INTO empleado_supervisores (empresa_id, empleado_id, supervisor_id)
SELECT e.empresa_id, e.id, e.supervisor_id
FROM empleados e
WHERE e.supervisor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM empleado_supervisores es
    WHERE es.empresa_id = e.empresa_id
      AND es.empleado_id = e.id
      AND es.supervisor_id = e.supervisor_id
  );
