-- DIAGNÓSTICO DE SOLO LECTURA — programaciones TMS duplicadas (TMS-PROGRAMACION-DUPLICADA-1).
-- Solo SELECT / SET de variables de sesión / PREPARE de SELECT. No escribe, no crea tablas, no borra. Se puede ejecutar en phpMyAdmin (pestaña SQL).
--
-- Qué comprueba (para la fecha indicada, p. ej. el 19/11/2026 con los pares PLAN-20261119-001..033 vs 034..066):
--   R1  Resumen del día por empresa/estado (cuántos planes hay, rango de códigos e ids).
--   R2  PARES de planes con la MISMA empresa+fecha+cliente+ruta+hora+unidad+piloto (+auxiliares, origen y trazas de creación), con IDs reales.
--       Un par solo es "candidato" a copia: NO se supone que dos rutas iguales sean duplicados; compare las columnas de R2 antes de concluir.
--   R3  Relaciones de CADA plan de esos pares (paradas, auxiliares, viáticos, evidencias, gastos, viaje de Flota, factura, liquidación):
--       un plan con relaciones operativas/financieras NO es una copia descartable.
--   R4  Cómo se crearon: auditoría del lote (copiar_programacion / importar_programacion) con usuario y hora, y filas de tms_plan_origen.
--
-- NOTA: tms_planes_viaje NO tiene columnas creado_en/creado_por. La hora y el usuario de creación salen de tms_plan_origen (copias) y de la
-- auditoría del lote (R4); para el resto, el orden de `id` es el único indicio temporal.
--
-- USO: ajuste SOLO @fecha (y @empresa si quiere limitarlo a una empresa; NULL = todas) y @esquema (NULL = base seleccionada). Ejecute todo el script.
-- Si alguna tabla opcional no existe en su instalación (p. ej. fact_factura_viajes), la sentencia R3 falla SOLO ella: quite esa línea del UNION.
SET @esquema = NULL;
SET @fecha   = '2026-11-19';
SET @empresa = NULL;

SET @db = COALESCE(@esquema, DATABASE());
SET @ok = IFNULL(@db REGEXP '^[A-Za-z0-9_]+$' AND EXISTS(SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = @db)
              AND @fecha REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND (@empresa IS NULL OR @empresa REGEXP '^[0-9]+$'), 0);
SET @pref = IF(@ok, CONCAT('`', @db, '`.'), NULL);
SET @prefijo_codigo = CONCAT('PLAN-', REPLACE(@fecha, '-', ''), '-%');

SELECT IF(@ok, CONCAT('OK: se leerá el esquema ', @db, ' para la fecha ', @fecha), 'PARAMETROS_INVALIDOS (esquema inexistente, fecha no AAAA-MM-DD o empresa no numérica)') AS verificacion;

-- R1) Resumen del día.
SET @q = IF(@ok, REPLACE('SELECT p.empresa_id, p.estado, p.tipo_viaje, COUNT(*) AS planes, MIN(p.codigo) AS primer_codigo, MAX(p.codigo) AS ultimo_codigo, MIN(p.id) AS id_min, MAX(p.id) AS id_max
  FROM §tms_planes_viaje p WHERE p.fecha_plan = @fecha AND (@empresa IS NULL OR p.empresa_id = @empresa)
  GROUP BY p.empresa_id, p.estado, p.tipo_viaje ORDER BY p.empresa_id, p.estado, p.tipo_viaje', '§', @pref), 'SELECT 1 AS sin_ejecutar');
PREPARE r1 FROM @q; EXECUTE r1; DEALLOCATE PREPARE r1;

-- R2) Pares candidatos a duplicado (a = el de menor id, b = el posterior). Una fila por par.
SET @q = IF(@ok, REPLACE('SELECT a.empresa_id, a.id AS id_a, a.codigo AS codigo_a, a.estado AS estado_a, b.id AS id_b, b.codigo AS codigo_b, b.estado AS estado_b,
  b.id - a.id AS distancia_id, a.fecha_plan, LEFT(a.hora_carga, 5) AS hora, a.cliente_id, a.ruta_id, a.ruta_codigo_historico AS ruta, a.unidad_id, ua.placa AS unidad, a.piloto_id, a.tipo_viaje,
  (SELECT GROUP_CONCAT(x.personal_id ORDER BY x.personal_id) FROM §tms_plan_auxiliares x WHERE x.plan_id = a.id) AS auxiliares_a,
  (SELECT GROUP_CONCAT(x.personal_id ORDER BY x.personal_id) FROM §tms_plan_auxiliares x WHERE x.plan_id = b.id) AS auxiliares_b,
  (a.tarifa_comercial <=> b.tarifa_comercial) AS misma_tarifa, (a.regreso_estimado <=> b.regreso_estimado) AS mismo_regreso, (a.notas <=> b.notas) AS mismas_notas,
  oa.tipo AS origen_a_tipo, oa.plan_origen_id AS origen_a_plan, poa.fecha_plan AS origen_a_fecha, oa.creado_por AS creado_por_a, oa.creado_en AS creado_en_a,
  ob.tipo AS origen_b_tipo, ob.plan_origen_id AS origen_b_plan, pob.fecha_plan AS origen_b_fecha, ob.creado_por AS creado_por_b, ob.creado_en AS creado_en_b
  FROM §tms_planes_viaje a
  JOIN §tms_planes_viaje b ON b.empresa_id = a.empresa_id AND b.fecha_plan = a.fecha_plan AND b.id > a.id
       AND b.cliente_id <=> a.cliente_id AND b.ruta_id <=> a.ruta_id AND LEFT(b.hora_carga, 5) <=> LEFT(a.hora_carga, 5)
       AND b.unidad_id <=> a.unidad_id AND b.piloto_id <=> a.piloto_id AND b.tipo_viaje = a.tipo_viaje
  LEFT JOIN §tms_unidades ua ON ua.id = a.unidad_id
  LEFT JOIN §tms_plan_origen oa ON oa.plan_id = a.id LEFT JOIN §tms_planes_viaje poa ON poa.id = oa.plan_origen_id
  LEFT JOIN §tms_plan_origen ob ON ob.plan_id = b.id LEFT JOIN §tms_planes_viaje pob ON pob.id = ob.plan_origen_id
  WHERE a.fecha_plan = @fecha AND (@empresa IS NULL OR a.empresa_id = @empresa)
  ORDER BY a.empresa_id, a.codigo, b.codigo', '§', @pref), 'SELECT 1 AS sin_ejecutar');
PREPARE r2 FROM @q; EXECUTE r2; DEALLOCATE PREPARE r2;

-- R3) Relaciones de cada plan que participa en algún par (hijos operativos y financieros). 0 en todo = candidato razonable a copia sin consecuencias.
SET @q = IF(@ok, REPLACE('WITH par AS (
    SELECT a.id AS plan_id FROM §tms_planes_viaje a JOIN §tms_planes_viaje b ON b.empresa_id = a.empresa_id AND b.fecha_plan = a.fecha_plan AND b.id <> a.id
      AND b.cliente_id <=> a.cliente_id AND b.ruta_id <=> a.ruta_id AND LEFT(b.hora_carga, 5) <=> LEFT(a.hora_carga, 5) AND b.unidad_id <=> a.unidad_id AND b.piloto_id <=> a.piloto_id AND b.tipo_viaje = a.tipo_viaje
    WHERE a.fecha_plan = @fecha AND (@empresa IS NULL OR a.empresa_id = @empresa) GROUP BY a.id)
  SELECT p.empresa_id, p.id AS plan_id, p.codigo, p.estado,
    (SELECT COUNT(*) FROM §tms_plan_paradas x WHERE x.plan_id = p.id) AS paradas,
    (SELECT COUNT(*) FROM §tms_plan_auxiliares x WHERE x.plan_id = p.id) AS auxiliares,
    (SELECT COUNT(*) FROM §tms_viaticos x WHERE x.plan_id = p.id) AS viaticos,
    (SELECT COUNT(*) FROM §tms_evidencias x WHERE x.plan_id = p.id) AS evidencias,
    (SELECT COUNT(*) FROM §tms_gastos_operativos x WHERE x.plan_id = p.id) AS gastos,
    (SELECT COUNT(*) FROM §flota_viajes x WHERE x.plan_id = p.id) AS viajes_flota,
    (SELECT COUNT(*) FROM §fact_factura_viajes x WHERE x.plan_id = p.id) AS facturas,
    (SELECT COUNT(*) FROM §tms_viaje_liquidaciones x WHERE x.plan_id = p.id) AS liquidaciones,
    (SELECT COUNT(*) FROM §tms_viaje_cargos_adicionales x WHERE x.plan_id = p.id) AS cargos_adicionales,
    (SELECT COUNT(*) FROM §tms_solicitudes_cliente x WHERE x.plan_id = p.id) AS solicitudes_cliente,
    (SELECT COUNT(*) FROM §tms_plan_origen x WHERE x.plan_origen_id = p.id) AS copias_que_nacieron_de_este
  FROM §tms_planes_viaje p JOIN par ON par.plan_id = p.id ORDER BY p.empresa_id, p.codigo', '§', @pref), 'SELECT 1 AS sin_ejecutar');
PREPARE r3 FROM @q; EXECUTE r3; DEALLOCATE PREPARE r3;

-- R4) Cómo se crearon: auditoría de lotes (usuario y hora) que mencionan códigos del día, o importaciones/copias recientes (ventana de 45 días antes de la fecha).
SET @q = IF(@ok, REPLACE('SELECT au.id, au.empresa_id, au.usuario, au.accion, au.creado_en, LEFT(au.detalle, 400) AS detalle
  FROM §auditoria au
  WHERE au.modulo = ''tms'' AND (@empresa IS NULL OR au.empresa_id = @empresa)
    AND ((au.accion IN (''copiar_programacion'', ''importar_programacion'') AND au.creado_en >= DATE_SUB(@fecha, INTERVAL 45 DAY) AND au.creado_en < DATE_ADD(@fecha, INTERVAL 3 DAY))
         OR au.detalle LIKE CONCAT(''%'', SUBSTRING(@prefijo_codigo, 1, CHAR_LENGTH(@prefijo_codigo) - 1), ''%''))
  ORDER BY au.creado_en, au.id', '§', @pref), 'SELECT 1 AS sin_ejecutar');
PREPARE r4 FROM @q; EXECUTE r4; DEALLOCATE PREPARE r4;
