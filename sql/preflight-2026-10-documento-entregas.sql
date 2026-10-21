-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — Control de entrega de documentos (PR 1: base común)
-- Archivo: sql/preflight-2026-10-documento-entregas.sql
--
-- NO modifica nada: solo SELECT. Ejecutar manualmente y revisar ANTES de sql/migrate-2026-10-documento-entregas.sql.
--
-- ESQUEMA EXPLÍCITO: usa `TABLE_SCHEMA = 'u611730801_Plataforma'` y tablas calificadas; no depende de DATABASE() ni del
-- esquema activo de la sesión. Sin ROW_COUNT(). En otra base (pruebas), reemplazar el nombre del esquema en todo el archivo.
--
-- LA COMPUERTA (consulta 7) ES CONSERVADORA: cualquier requisito que no se cumpla EXACTAMENTE => 'DETENER'. No asume tipos
-- (p. ej. int(11) con signo) ni motor: los comprueba. 'LISTO PARA MIGRAR' no garantiza que el CREATE TABLE no pueda fallar por
-- algo que este script no ve (permisos del usuario de BD, espacio, bloqueos), pero cubre lo conocido.
-- =====================================================================

-- 1) Entorno: versión (se requiere MariaDB >= 10.2.1 por CHECK y columnas generadas PERSISTENT) y existencia de las tablas.
SELECT VERSION() AS version_bd,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
         AND TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas', 'tms_solicitudes_fondo', 'tms_gastos_operativos',
                            'compras_requerimientos', 'auditoria')) AS tablas_requeridas_esperado_7,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
         AND TABLE_NAME = 'documento_entregas') AS documento_entregas_ya_existe_esperado_0;

-- 2) Motor de las tablas (todas deben ser InnoDB: FK y FOR UPDATE lo requieren).
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
  AND TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas', 'tms_solicitudes_fondo', 'tms_gastos_operativos',
                     'compras_requerimientos', 'auditoria')
ORDER BY TABLE_NAME;

-- 3) Columnas destino de las FK: deben ser INT CON SIGNO (igual que las nuevas columnas INT) y PRIMARY KEY. Se muestra el
--    tipo real; la compuerta lo exige por DATA_TYPE = 'int' y sin 'unsigned', no por el ancho de visualización. También se
--    muestra usuarios.rol_global (el snapshot de rol del emisor/receptor SISTEMA es NOT NULL porque esta columna lo es).
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
  AND ((TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas') AND COLUMN_NAME = 'id')
       OR (TABLE_NAME = 'usuarios' AND COLUMN_NAME IN ('rol_global', 'nombre', 'username')))
ORDER BY TABLE_NAME, COLUMN_NAME;

-- 4) firmas_electronicas: usuario_id debe admitir NULL (firmante presencial sin usuario), deben existir las 20 columnas que
--    inserta crearFirmaInterna (incluidas las 4 de imagen) y ser lo bastante largas para los valores nuevos.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'firmas_electronicas'
  AND COLUMN_NAME IN ('empresa_id', 'usuario_id', 'empleado_id', 'accion', 'modulo', 'entidad_tipo', 'entidad_id',
                      'fecha_hora_servidor', 'hash_payload', 'payload_canonico', 'ip', 'user_agent', 'metodo', 'resultado',
                      'codigo_firma', 'version', 'imagen_ruta', 'imagen_nombre_original', 'imagen_mime', 'imagen_tamano')
ORDER BY COLUMN_NAME;

-- 5) Columnas que leen los adaptadores de documentos y la auditoría.
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
  AND ((TABLE_NAME IN ('tms_solicitudes_fondo', 'compras_requerimientos') AND COLUMN_NAME IN ('id', 'empresa_id', 'codigo', 'estado'))
       OR (TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME IN ('id', 'empresa_id', 'codigo', 'estado', 'activo'))
       OR (TABLE_NAME = 'auditoria' AND COLUMN_NAME IN ('empresa_id', 'usuario', 'accion', 'modulo', 'detalle')))
ORDER BY TABLE_NAME, COLUMN_NAME;

-- 6) Nombres que la migración va a crear: ninguno debe existir ya en el esquema (esperado: 0 filas).
SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
  AND CONSTRAINT_NAME IN ('uq_de_empresa_id', 'uq_de_empresa_clave', 'uq_de_pendiente',
                          'fk_de_empresa', 'fk_de_emisor', 'fk_de_receptor', 'fk_de_operador', 'fk_de_cerrado_por',
                          'fk_de_firma_emision', 'fk_de_firma_recepcion',
                          'chk_de_modulo', 'chk_de_entidad_tipo', 'chk_de_etapas', 'chk_de_modo', 'chk_de_estado',
                          'chk_de_recepcion', 'chk_de_cierre', 'chk_de_rechazo_sistema', 'chk_de_receptor_no_emisor',
                          'chk_de_firmas_distintas', 'chk_de_huella');

-- 7) COMPUERTA. Cada columna es un requisito y su valor esperado es el de la condición IF de abajo; 'LISTO PARA MIGRAR' solo si
--     TODAS coinciden. Cualquier otro valor => 'DETENER' (revisar la columna que no coincide y las consultas 1-6).
SELECT c.*,
       IF(c.mariadb_10_2_o_superior = 1
          AND c.tablas_requeridas = 7
          AND c.tablas_innodb = 7
          AND c.ids_fk_int_con_signo_pk = 3
          AND c.firmas_usuario_id_nullable = 1
          AND c.firmas_columnas_insert = 20
          AND c.firmas_longitudes_ok = 4
          AND c.auditoria_columnas = 5
          AND c.columnas_adaptadores = 13
          AND c.documento_entregas_existe = 0
          AND c.constraints_con_nombre_ocupado = 0
          AND c.indices_con_nombre_ocupado = 0,
          'LISTO PARA MIGRAR', 'DETENER: hay columnas distintas del valor esperado (ver nombre de columna)') AS compuerta
FROM (
  SELECT
    IF(VERSION() LIKE '%MariaDB%'
       AND (CAST(SUBSTRING_INDEX(REPLACE(VERSION(), '5.5.5-', ''), '.', 1) AS UNSIGNED) > 10
            OR (CAST(SUBSTRING_INDEX(REPLACE(VERSION(), '5.5.5-', ''), '.', 1) AS UNSIGNED) = 10
                AND CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(REPLACE(VERSION(), '5.5.5-', ''), '.', 2), '.', -1) AS UNSIGNED) >= 2)),
       1, 0) AS mariadb_10_2_o_superior,
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas', 'tms_solicitudes_fondo', 'tms_gastos_operativos',
                         'compras_requerimientos', 'auditoria')) AS tablas_requeridas,
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND ENGINE = 'InnoDB'
      AND TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas', 'tms_solicitudes_fondo', 'tms_gastos_operativos',
                         'compras_requerimientos', 'auditoria')) AS tablas_innodb,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME IN ('empresas', 'usuarios', 'firmas_electronicas') AND COLUMN_NAME = 'id'
      AND DATA_TYPE = 'int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND COLUMN_KEY = 'PRI') AS ids_fk_int_con_signo_pk,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'firmas_electronicas' AND COLUMN_NAME = 'usuario_id' AND IS_NULLABLE = 'YES') AS firmas_usuario_id_nullable,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'firmas_electronicas'
      AND COLUMN_NAME IN ('empresa_id', 'usuario_id', 'empleado_id', 'accion', 'modulo', 'entidad_tipo', 'entidad_id',
                          'fecha_hora_servidor', 'hash_payload', 'payload_canonico', 'ip', 'user_agent', 'metodo', 'resultado',
                          'codigo_firma', 'version', 'imagen_ruta', 'imagen_nombre_original', 'imagen_mime',
                          'imagen_tamano')) AS firmas_columnas_insert,
    -- 'ENTREGAR_DOCUMENTO' (18), 'REQUERIMIENTO_COMPRA' (20), 'COMPRAS' (7), 'FIRMA_MANUSCRITA' (15): deben caber.
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'firmas_electronicas'
      AND ((COLUMN_NAME = 'accion' AND CHARACTER_MAXIMUM_LENGTH >= 18)
        OR (COLUMN_NAME = 'entidad_tipo' AND CHARACTER_MAXIMUM_LENGTH >= 20)
        OR (COLUMN_NAME = 'modulo' AND CHARACTER_MAXIMUM_LENGTH >= 7)
        OR (COLUMN_NAME = 'metodo' AND CHARACTER_MAXIMUM_LENGTH >= 15))) AS firmas_longitudes_ok,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'auditoria'
      AND COLUMN_NAME IN ('empresa_id', 'usuario', 'accion', 'modulo', 'detalle')) AS auditoria_columnas,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND ((TABLE_NAME IN ('tms_solicitudes_fondo', 'compras_requerimientos') AND COLUMN_NAME IN ('id', 'empresa_id', 'codigo', 'estado'))
        OR (TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME IN ('id', 'empresa_id', 'codigo', 'estado', 'activo')))) AS columnas_adaptadores,
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas') AS documento_entregas_existe,
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
      AND CONSTRAINT_NAME IN ('uq_de_empresa_id', 'uq_de_empresa_clave', 'uq_de_pendiente',
                              'fk_de_empresa', 'fk_de_emisor', 'fk_de_receptor', 'fk_de_operador', 'fk_de_cerrado_por',
                              'fk_de_firma_emision', 'fk_de_firma_recepcion',
                              'chk_de_modulo', 'chk_de_entidad_tipo', 'chk_de_etapas', 'chk_de_modo', 'chk_de_estado',
                              'chk_de_recepcion', 'chk_de_cierre', 'chk_de_rechazo_sistema', 'chk_de_receptor_no_emisor',
                              'chk_de_firmas_distintas', 'chk_de_huella')) AS constraints_con_nombre_ocupado,
    (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND INDEX_NAME IN ('uq_de_empresa_id', 'uq_de_empresa_clave', 'uq_de_pendiente', 'idx_de_documento', 'idx_de_bandeja')) AS indices_con_nombre_ocupado
) c;

-- Las consultas 8-10 son INFORMATIVAS y van después de la compuerta: si faltara una tabla o columna, la compuerta ya respondió
-- DETENER antes de que alguna de ellas pueda fallar.

-- 8) Permisos: ninguna fila con los nombres nuevos debería existir todavía (esperado: 0). Informativo — la asignación es manual.
SELECT modulo, COUNT(*) AS filas
FROM u611730801_Plataforma.usuario_modulo
WHERE modulo IN ('documentos_entregas', 'fondos_entrega_emitir', 'gastos_entrega_emitir', 'compras_entrega_emitir',
                 'entregas_area_tesoreria', 'entregas_area_contabilidad', 'entregas_presencial', 'entregas_anular')
GROUP BY modulo;

-- 9) Firmas existentes con las acciones nuevas (esperado: 0 — nadie las ha usado todavía).
SELECT accion, COUNT(*) AS firmas
FROM u611730801_Plataforma.firmas_electronicas
WHERE accion IN ('ENTREGAR_DOCUMENTO', 'RECIBIR_DOCUMENTO')
GROUP BY accion;

-- 10) Volumen: documentos que hoy ADMITIRÍAN una entrega (no se crea ninguna entrega para ellos: históricos intactos).
SELECT 'FONDOS' AS modulo, COUNT(*) AS documentos FROM u611730801_Plataforma.tms_solicitudes_fondo WHERE estado IN ('Autorizada', 'Liquidada')
UNION ALL
SELECT 'GASTOS', COUNT(*) FROM u611730801_Plataforma.tms_gastos_operativos WHERE estado = 'Autorizada' AND activo = 1
UNION ALL
SELECT 'COMPRAS', COUNT(*) FROM u611730801_Plataforma.compras_requerimientos WHERE estado = 'Autorizada';
