-- RUTAS-TARIFARIO-HISTORIAL-1
-- Aplicación MANUAL (MariaDB 11.8, mismo motor que el resto del
-- proyecto). NO se ejecuta automáticamente. Aditiva y reejecutable
-- (CREATE TABLE IF NOT EXISTS) — correr este script más de una vez es
-- seguro, no duplica nada ni falla la segunda vez. Sin DROP, sin borrar
-- ni modificar datos existentes.
--
-- Revisado el esquema real antes de diseñar esto (ver
-- sql/schema.sql:781-806, sql/migrate-2026-09-rutas-personal-tarifario.sql):
-- `tms_cliente_rutas.tarifa_referencia` YA EXISTE como valor VIGENTE
-- actual — se mantiene sin cambios, sigue siendo el valor rápido que ya
-- lee todo el código existente (ruta-defaults.ts, cotizaciones.ts,
-- rutas-export-excel.ts, rutas-import.ts). NO existía ninguna estructura
-- equivalente a un historial de cambios — se crea `tms_cliente_ruta_tarifas`
-- (nombre sugerido por el ticket), append-only: cada fila es un cambio de
-- tarifa que YA ocurrió, nunca se actualiza ni se borra una fila desde la
-- aplicación (ver src/lib/tms/cliente-rutas.ts, registrarCambioTarifaTx).
--
-- Por qué una tabla nueva y no reutilizar `auditoria` (ya existe en el
-- proyecto): auditoria.detalle es texto libre sin estructura — no permite
-- consultar "tarifa vigente en la fecha X" ni listar el historial
-- ordenado con sus columnas propias (tarifa/moneda/vigente_desde/motivo)
-- sin parsear texto. Mismo criterio ya usado por tms_viaticos (snapshot
-- estructurado) en vez de solo auditoria.
--
-- `usuario_id` referencia `usuarios` (tabla GLOBAL, sin empresa_id — ver
-- usuario_firmas en sql/propuesta-2026-08-usuario-firmas.sql) — mismo
-- criterio ya usado en SOLICITUD-FONDOS-PDF-AUTORIZADO-1
-- (tms_solicitudes_fondo.solicitante_usuario_id): FK de una sola columna
-- a usuarios(id), nunca compuesta con empresa_id. `usuario_nombre` es el
-- SNAPSHOT del nombre real al momento del cambio (igual criterio que
-- autorizante_nombre en Solicitudes de Fondo) — un cambio de nombre
-- posterior del usuario nunca debe alterar el historial ya escrito.

CREATE TABLE IF NOT EXISTS tms_cliente_ruta_tarifas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  ruta_id INT NOT NULL,
  tarifa DECIMAL(12,2) NOT NULL,
  moneda VARCHAR(10) NOT NULL DEFAULT 'GTQ',
  vigente_desde DATE NOT NULL,
  motivo VARCHAR(300) NULL,
  usuario_id INT NULL,
  usuario_nombre VARCHAR(200) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tmsclirutatarifas_ruta (empresa_id, ruta_id, vigente_desde DESC, id DESC),
  CONSTRAINT fk_tmsclirutatarifas_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsclirutatarifas_ruta_ambito
    FOREIGN KEY (empresa_id, ruta_id) REFERENCES tms_cliente_rutas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsclirutatarifas_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
