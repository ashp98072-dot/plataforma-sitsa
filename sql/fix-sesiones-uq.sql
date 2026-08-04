-- Parche rápido: solo lo que falló en phpMyAdmin (índice uq_sesion).
-- Pega esto en la pestaña SQL de u611730801_Plataforma y ejecuta.

-- 1) Índice no-único para que las FK no dependan de uq_sesion
ALTER TABLE sesiones_trabajo
  ADD INDEX idx_sesion_emp_fecha (empresa_id, id_empleado, fecha_jornada);

-- 2) Ahora sí se puede quitar el UNIQUE
ALTER TABLE sesiones_trabajo DROP INDEX uq_sesion;

-- 3) Normalizar estados viejos
UPDATE sesiones_trabajo SET estado = 'ABIERTA' WHERE estado IN ('En curso', 'en curso');
UPDATE sesiones_trabajo SET estado = 'CERRADA' WHERE estado IN ('Cerrada', 'cerrada');
