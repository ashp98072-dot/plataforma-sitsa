-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — Control de entrega de documentos (PR 1: base común)
-- Archivo: sql/preflight-2026-10-documento-entregas.sql
--
-- NO modifica nada: solo SELECT. Ejecutar manualmente y revisar ANTES de sql/migrate-2026-10-documento-entregas.sql.
--
-- ESQUEMA EXPLÍCITO: usa `TABLE_SCHEMA = 'u611730801_Plataforma'` y tablas calificadas; no depende de DATABASE() ni del
-- esquema activo de la sesión. Sin ROW_COUNT(). En otra base (pruebas), reemplazar el nombre del esquema en todo el archivo.
-- =====================================================================

-- 1) Entorno: versión (CHECK aplicado desde MariaDB 10.2.1; producción 11.8) y existencia de las tablas referenciadas.
SELECT VERSION() AS version_bd,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
         AND TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas', 'tms_solicitudes_fondo', 'tms_gastos_operativos',
                            'compras_requerimientos', 'auditoria')) AS tablas_requeridas_7,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
         AND TABLE_NAME = 'documento_entregas') AS documento_entregas_ya_existe;

-- 2) Motor de las tablas referenciadas por FK (todas deben ser InnoDB).
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas')
ORDER BY TABLE_NAME;

-- 3) Tipos de las columnas destino de las FK (deben ser INT con el MISMO signo que las nuevas: `int(11)`).
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
  AND ((TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas') AND COLUMN_NAME = 'id')
       OR (TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'rol_global'))
ORDER BY TABLE_NAME, COLUMN_NAME;

-- 4) firmas_electronicas: usuario_id debe admitir NULL (firmante presencial sin usuario) y deben existir las columnas de imagen.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'firmas_electronicas'
  AND COLUMN_NAME IN ('usuario_id', 'accion', 'modulo', 'entidad_tipo', 'entidad_id', 'metodo',
                      'imagen_ruta', 'imagen_nombre_original', 'imagen_mime', 'imagen_tamano')
ORDER BY COLUMN_NAME;

-- 5) Columnas que leen los adaptadores (codigo/estado y, en Gastos, activo).
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
  AND ((TABLE_NAME IN ('tms_solicitudes_fondo', 'tms_gastos_operativos', 'compras_requerimientos') AND COLUMN_NAME IN ('codigo', 'estado', 'empresa_id'))
       OR (TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'activo'))
ORDER BY TABLE_NAME, COLUMN_NAME;

-- 6) Nombres de restricciones/índices: ninguno de los nuevos debe existir ya en el esquema (esperado: 0 filas).
SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
  AND (CONSTRAINT_NAME LIKE 'fk\_de\_%' OR CONSTRAINT_NAME LIKE 'chk\_de\_%' OR CONSTRAINT_NAME LIKE 'uq\_de\_%');

-- 7) Permisos: ninguna fila con los nombres nuevos debería existir todavía (esperado: 0). Informativo — la asignación es manual.
SELECT modulo, COUNT(*) AS filas
FROM u611730801_Plataforma.usuario_modulo
WHERE modulo IN ('documentos_entregas', 'fondos_entrega_emitir', 'gastos_entrega_emitir', 'compras_entrega_emitir',
                 'entregas_area_tesoreria', 'entregas_area_contabilidad', 'entregas_presencial', 'entregas_anular')
GROUP BY modulo;

-- 8) Firmas existentes con las acciones nuevas (esperado: 0 — nadie las ha usado todavía).
SELECT accion, COUNT(*) AS firmas
FROM u611730801_Plataforma.firmas_electronicas
WHERE accion IN ('ENTREGAR_DOCUMENTO', 'RECIBIR_DOCUMENTO')
GROUP BY accion;

-- 9) Volumen informativo: documentos que hoy ADMITIRÍAN una entrega (no se crea ninguna entrega para ellos: históricos intactos).
SELECT 'FONDOS' AS modulo, COUNT(*) AS documentos FROM u611730801_Plataforma.tms_solicitudes_fondo WHERE estado IN ('Autorizada', 'Liquidada')
UNION ALL
SELECT 'GASTOS', COUNT(*) FROM u611730801_Plataforma.tms_gastos_operativos WHERE estado = 'Autorizada' AND activo = 1
UNION ALL
SELECT 'COMPRAS', COUNT(*) FROM u611730801_Plataforma.compras_requerimientos WHERE estado = 'Autorizada';

-- 10) COMPUERTA: 'LISTO PARA MIGRAR' solo si existen las 7 tablas, documento_entregas NO existe, firmas_electronicas.usuario_id
--     admite NULL, existen sus columnas de imagen y no hay restricciones con los nombres nuevos.
SELECT IF(
         (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
           AND TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas', 'tms_solicitudes_fondo', 'tms_gastos_operativos',
                              'compras_requerimientos', 'auditoria')) = 7
         AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
               AND TABLE_NAME = 'documento_entregas') = 0
         AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
               AND TABLE_NAME = 'firmas_electronicas' AND COLUMN_NAME = 'usuario_id' AND IS_NULLABLE = 'YES') = 1
         AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
               AND TABLE_NAME = 'firmas_electronicas'
               AND COLUMN_NAME IN ('imagen_ruta', 'imagen_nombre_original', 'imagen_mime', 'imagen_tamano')) = 4
         AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
               AND (CONSTRAINT_NAME LIKE 'fk\_de\_%' OR CONSTRAINT_NAME LIKE 'chk\_de\_%' OR CONSTRAINT_NAME LIKE 'uq\_de\_%')) = 0,
       'LISTO PARA MIGRAR', 'DETENER: revisar resultados 1-6') AS compuerta;
