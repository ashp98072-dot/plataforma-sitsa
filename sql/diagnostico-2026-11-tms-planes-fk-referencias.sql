-- DIAGNÓSTICO SOLO LECTURA (SELECT/SHOW) — ER_NO_REFERENCED_ROW_2 al crear viajes (individual y copia masiva).
-- Ejecutar en phpMyAdmin (Hostinger), bloque por bloque. No modifica nada.
-- Sustituir 7 por el empresa_id de Kuiqtrans/Logiservicios Mónaco y las fechas si hace falta.

-- 1) Llaves foráneas REALES de tms_planes_viaje en producción (¿hay alguna que el repo no declara?).
SELECT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, rc.DELETE_RULE
  FROM information_schema.KEY_COLUMN_USAGE kcu
  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
    ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.TABLE_NAME = kcu.TABLE_NAME
 WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.TABLE_NAME = 'tms_planes_viaje' AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
 ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION;

-- 2) Viajes de origen (13/11/2026) cuyas referencias YA NO existen: la copia los reutiliza y la FK correspondiente falla.
SELECT p.id, p.codigo,
       (p.tc_vehiculo_id IS NOT NULL AND v.id IS NULL)                         AS tc_inexistente,
       (p.vehiculo_solicitado_perfil_id IS NOT NULL AND pf.id IS NULL)         AS perfil_inexistente_o_de_otra_empresa,
       (p.unidad_id IS NOT NULL AND u.id IS NULL)                              AS unidad_inexistente,
       (p.piloto_id IS NOT NULL AND pi.id IS NULL)                             AS piloto_inexistente,
       (p.auxiliar_id IS NOT NULL AND au.id IS NULL)                           AS auxiliar_inexistente,
       (p.cliente_id IS NOT NULL AND c.id IS NULL)                             AS cliente_inexistente,
       (p.lugar_carga_id IS NOT NULL AND lc.id IS NULL)                        AS lugar_carga_inexistente,
       (p.lugar_descarga_id IS NOT NULL AND ld.id IS NULL)                     AS lugar_descarga_inexistente
  FROM tms_planes_viaje p
  LEFT JOIN flota_vehiculos v ON v.id = p.tc_vehiculo_id
  LEFT JOIN tms_cotizacion_costeo_perfiles pf ON pf.empresa_id = p.empresa_id AND pf.id = p.vehiculo_solicitado_perfil_id
  LEFT JOIN tms_unidades u ON u.id = p.unidad_id
  LEFT JOIN tms_personal pi ON pi.id = p.piloto_id
  LEFT JOIN tms_personal au ON au.id = p.auxiliar_id
  LEFT JOIN tms_clientes c ON c.id = p.cliente_id
  LEFT JOIN tms_lugares lc ON lc.id = p.lugar_carga_id
  LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id
 WHERE p.empresa_id = 7 AND p.fecha_plan = '2026-11-13'
HAVING tc_inexistente + perfil_inexistente_o_de_otra_empresa + unidad_inexistente + piloto_inexistente + auxiliar_inexistente
     + cliente_inexistente + lugar_carga_inexistente + lugar_descarga_inexistente > 0;

-- 3) Perfiles de costeo de la empresa (la FK compuesta exige (empresa_id, id) existente y único).
SELECT empresa_id, id, codigo, nombre, activo FROM tms_cotizacion_costeo_perfiles WHERE empresa_id = 7 ORDER BY id;
SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_cotizacion_costeo_perfiles'
 GROUP BY INDEX_NAME, NON_UNIQUE;

-- 4) Último error de llave foránea que registró InnoDB (requiere privilegio PROCESS; muestra la restricción y la fila exactas).
SHOW ENGINE INNODB STATUS;
