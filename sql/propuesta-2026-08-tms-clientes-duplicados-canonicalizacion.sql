-- TMS-CLIENTES-DUPLICADOS-CANONICALIZACION-1 — PROPUESTA, NO EJECUTADA.
--
-- empresa_id = 1.
--
-- Objetivo: mover el bridge administrativo (clientes.tms_cliente_id) de
-- 3 clientes TMS duplicados/huérfanos hacia sus canónicos reales, para
-- que Facturación (FACT-1) vea los viajes Cerrados de esos clientes como
-- pendientes de facturación. NO se borra ningún registro. NO se tocan
-- viajes/rutas/ubicaciones/contactos (siguen referenciando el mismo
-- tms_clientes.id canónico que ya tenían).
--
-- ADVERTENCIA DE PROCEDENCIA DE LOS DATOS: este archivo se generó SIN
-- acceso directo a la base de datos de producción desde esta sesión (el
-- entorno local no tiene credenciales de producción). Los IDs
-- canónicos/duplicados y los bridges de abajo son los que el usuario
-- reportó como "confirmados" en el ticket de migración — NO fueron
-- re-verificados de forma independiente por esta sesión contra datos en
-- vivo. Por eso el PASO 0 de este archivo es obligatorio: vuelve a
-- confirmar en producción, justo antes de continuar, que nada cambió
-- desde que se reportaron esos IDs. Si algún resultado del PASO 0 no
-- coincide con lo documentado aquí, DETENTE y no continúes.
--
-- ================================================================
-- Mapeo canónico <- duplicado (empresa_id = 1)
-- ================================================================
--   CALSA      canónico tms_clientes.id = 70   <- duplicado id = 105
--   CAEX CAEX  canónico tms_clientes.id = 86   <- duplicado id = 104
--   AJEMALLA   canónico tms_clientes.id = 91   <- duplicado id = 100
--
-- Bridges administrativos afectados (clientes.id -> tms_clientes.id):
--   clientes.id 54 : 105 -> 70
--   clientes.id 53 : 104 -> 86
--   clientes.id 49 : 100 -> 91
--
-- Reportados sin referencias en viajes/rutas/ubicaciones/contactos:
-- tms_clientes.id 100, 104, 105. Estos NO se tocan salvo por el reporte
-- del PASO 0/POST-CHECK (no se borran, no se marcan Inactivo — ver más
-- abajo por qué NO se decide eso aquí).
--
-- Tablas descubiertas que referencian tms_clientes.id (FK real
-- REFERENCES tms_clientes(id), ver sql/schema.sql y
-- sql/migrate-2026-08-viat-1-cliente-ubicaciones.sql /
-- sql/migrate-2026-08-viat-4-contactos-rutas.sql):
--   tms_planes_viaje.cliente_id        (el viaje en sí)
--   tms_cliente_ubicaciones.cliente_id (VIAT-1 — ubicaciones guardadas)
--   tms_cliente_contactos.cliente_id   (VIAT-4 — contactos)
--   tms_cliente_rutas.cliente_id       (VIAT-4 — rutas guardadas;
--     tms_cliente_ruta_paradas referencia tms_cliente_rutas.id, no
--     cliente_id directo, así que queda cubierta transitivamente)
-- NINGUNA de estas 4 tablas se modifica en este archivo.
--
-- ¿Por qué 100/104/105 NO se marcan Inactivo aquí?
-- tms_clientes.estado SÍ se sincroniza en escritura desde `clientes`
-- (ver syncTmsCliente en src/lib/clientes/repository.ts) pero no se
-- encontró ningún SELECT en el código que FILTRE tms_clientes por
-- estado='Activo' — sin precedente claro de efecto visible. Por
-- instrucción explícita del ticket ("si no hay precedente claro, NO
-- hacerlo"), este archivo no lo incluye. Quedan como maestros huérfanos
-- — reportados, no tocados.
--
-- ================================================================
-- AJUSTE FINAL DE EJECUCIÓN (PR #157) — por qué un procedimiento
-- temporal en vez de START TRANSACTION / COMMIT en peticiones separadas
-- ================================================================
-- El modelo anterior (Bloque A sin COMMIT, revisar resultados, ejecutar
-- COMMIT/ROLLBACK como una sentencia SEPARADA) depende de que
-- phpMyAdmin conserve la MISMA conexión/sesión MySQL entre esa
-- ejecución y la siguiente — algo que no se debe asumir (pool de
-- conexiones, timeout de sesión, nueva pestaña, etc. pueden abrir una
-- conexión distinta, donde START TRANSACTION ya no aplica y un COMMIT
-- suelto no tiene nada que confirmar).
--
-- Corrección: la escritura completa (verificación de precondición +
-- datos maestros + bridges) se ejecuta en UN SOLO envío a phpMyAdmin,
-- dentro de un procedimiento almacenado TEMPORAL — MariaDB no permite
-- IF/SIGNAL fuera de un bloque BEGIN...END de una rutina almacenada, así
-- que es la forma más simple y compatible (MariaDB 11.x) de lograr
-- "verificar y abortar sin escribir nada" en una sola sentencia SQL
-- (CALL) sin depender de lógica en el cliente (PHP/phpMyAdmin) ni de
-- una segunda petición.
--
-- "Temporal" aquí significa: el procedimiento se CREA, se LLAMA una
-- vez, y se BORRA (DROP PROCEDURE) al final del mismo script — no queda
-- como objeto persistente del esquema tras una ejecución exitosa. Si la
-- precondición falla, el procedimiento hace ROLLBACK y lanza SIGNAL
-- (error visible en phpMyAdmin); en ese caso, el DROP PROCEDURE final
-- podría no ejecutarse en esa misma corrida (phpMyAdmin detiene el lote
-- al ver un error) — el procedimiento quedaría temporalmente en el
-- esquema, sin ejecutar NINGUNA escritura de datos (el ROLLBACK ya
-- ocurrió antes del SIGNAL). Es inofensivo dejarlo así: no hace nada por
-- sí solo, y el propio script empieza con `DROP PROCEDURE IF EXISTS`,
-- así que una segunda corrida (tras corregir lo que haya fallado) lo
-- limpia automáticamente. No se crea ningún trigger, function ni event
-- — solo esta única PROCEDURE, de vida efímera.

-- ================================================================
-- PASO 0 — SOLO LECTURA (ejecutar primero, en su propia petición,
-- revisar resultados ANTES de continuar con el bloque de migración)
-- ================================================================

SELECT * FROM tms_clientes
WHERE empresa_id = 1 AND id IN (70,86,91,100,104,105)
ORDER BY nombre, id;

SELECT cliente_id, COUNT(*) AS viajes,
       MIN(fecha_plan) AS primer_viaje, MAX(fecha_plan) AS ultimo_viaje
FROM tms_planes_viaje
WHERE empresa_id = 1 AND cliente_id IN (70,86,91,100,104,105)
GROUP BY cliente_id;

SELECT cliente_id, COUNT(*) AS ubicaciones
FROM tms_cliente_ubicaciones
WHERE empresa_id = 1 AND cliente_id IN (70,86,91,100,104,105)
GROUP BY cliente_id;

SELECT cliente_id, COUNT(*) AS contactos
FROM tms_cliente_contactos
WHERE empresa_id = 1 AND cliente_id IN (70,86,91,100,104,105)
GROUP BY cliente_id;

SELECT cliente_id, COUNT(*) AS rutas
FROM tms_cliente_rutas
WHERE empresa_id = 1 AND cliente_id IN (70,86,91,100,104,105)
GROUP BY cliente_id;

SELECT id, empresa_id, nombre, tms_cliente_id
FROM clientes
WHERE empresa_id = 1 AND tms_cliente_id IN (70,86,91,100,104,105);

SELECT f.cliente_id, c.nombre, COUNT(*) AS facturas
FROM fact_facturas f
JOIN clientes c ON c.id = f.cliente_id AND c.empresa_id = f.empresa_id
WHERE f.empresa_id = 1 AND c.tms_cliente_id IN (70,86,91,100,104,105)
GROUP BY f.cliente_id, c.nombre;

-- Si CUALQUIER resultado de arriba no coincide con lo documentado en el
-- encabezado (otros bridges, referencias nuevas en 100/104/105,
-- facturas ya emitidas para 49/53/54), DETENTE — no ejecutes el bloque
-- de migración de abajo con datos desactualizados.

-- ================================================================
-- BLOQUE DE MIGRACIÓN — ejecutar completo, EN UNA SOLA PETICIÓN a
-- phpMyAdmin (seleccionar TODO este bloque, desde DELIMITER $$ hasta
-- DELIMITER ; al final, y correrlo de una vez).
--
-- TODO-O-NADA sin depender de una segunda conexión: la precondición
-- global se verifica DENTRO de la misma transacción/procedimiento que
-- hace las escrituras. Si falla, hace ROLLBACK y aborta con SIGNAL
-- ANTES de cualquier UPDATE — nunca deja una escritura parcial. Si pasa,
-- hace los 3 UPDATE de datos maestros + el UPDATE de bridges y hace
-- COMMIT, todo en la misma ejecución, sin esperar una decisión humana
-- entre medio.
-- ================================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_migrar_tms_clientes_dup_1 $$

CREATE PROCEDURE sp_migrar_tms_clientes_dup_1()
BEGIN
  DECLARE v_bridges_ok INT DEFAULT 0;
  DECLARE v_maestros_ok INT DEFAULT 0;
  DECLARE v_dup_referencias INT DEFAULT 0;
  DECLARE v_bridge_rows INT DEFAULT 0;

  START TRANSACTION;

  -- --- Precondición global (dentro de la transacción — bloquea las
  -- filas relevantes con FOR UPDATE mientras se verifica, para que
  -- ninguna otra sesión las modifique entre el chequeo y el UPDATE).

  -- 1) Los 3 bridges deben existir EXACTAMENTE como se documentaron.
  SELECT COUNT(*) INTO v_bridges_ok
  FROM clientes
  WHERE empresa_id = 1
    AND (
      (id = 54 AND tms_cliente_id = 105) OR
      (id = 53 AND tms_cliente_id = 104) OR
      (id = 49 AND tms_cliente_id = 100)
    )
  FOR UPDATE;

  -- 2) Los 6 tms_clientes involucrados deben seguir existiendo (bloquea
  -- también las filas canónicas, se van a escribir a continuación).
  SELECT COUNT(*) INTO v_maestros_ok
  FROM tms_clientes
  WHERE empresa_id = 1 AND id IN (70,86,91,100,104,105)
  FOR UPDATE;

  -- 3) Los duplicados siguen sin referencias en las 4 tablas conocidas.
  SELECT
    (SELECT COUNT(*) FROM tms_planes_viaje WHERE empresa_id = 1 AND cliente_id IN (100,104,105))
    + (SELECT COUNT(*) FROM tms_cliente_rutas WHERE empresa_id = 1 AND cliente_id IN (100,104,105))
    + (SELECT COUNT(*) FROM tms_cliente_ubicaciones WHERE empresa_id = 1 AND cliente_id IN (100,104,105))
    + (SELECT COUNT(*) FROM tms_cliente_contactos WHERE empresa_id = 1 AND cliente_id IN (100,104,105))
  INTO v_dup_referencias;

  IF v_bridges_ok <> 3 OR v_maestros_ok <> 6 OR v_dup_referencias <> 0 THEN
    ROLLBACK;
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Precondición global NO cumplida — migración abortada, NINGÚN dato fue modificado. Revisa PASO 0 y vuelve a intentar solo tras confirmar los datos.';
  END IF;

  -- --- A) datos maestros: rellenar SOLO lo que esté NULL en el
  -- canónico (nit/telefono/direccion) — COALESCE nunca sobrescribe un
  -- valor no NULL ya existente en el canónico. 0 filas afectadas por
  -- cualquiera de estos 3 UPDATE es normal (no había nada que copiar).

  UPDATE tms_clientes AS canon
  JOIN tms_clientes AS dup ON dup.id = 105
  SET
    canon.nit       = COALESCE(canon.nit, dup.nit),
    canon.telefono  = COALESCE(canon.telefono, dup.telefono),
    canon.direccion = COALESCE(canon.direccion, dup.direccion)
  WHERE canon.id = 70 AND canon.empresa_id = 1 AND dup.empresa_id = 1;

  UPDATE tms_clientes AS canon
  JOIN tms_clientes AS dup ON dup.id = 104
  SET
    canon.nit       = COALESCE(canon.nit, dup.nit),
    canon.telefono  = COALESCE(canon.telefono, dup.telefono),
    canon.direccion = COALESCE(canon.direccion, dup.direccion)
  WHERE canon.id = 86 AND canon.empresa_id = 1 AND dup.empresa_id = 1;

  UPDATE tms_clientes AS canon
  JOIN tms_clientes AS dup ON dup.id = 100
  SET
    canon.nit       = COALESCE(canon.nit, dup.nit),
    canon.telefono  = COALESCE(canon.telefono, dup.telefono),
    canon.direccion = COALESCE(canon.direccion, dup.direccion)
  WHERE canon.id = 91 AND canon.empresa_id = 1 AND dup.empresa_id = 1;

  -- --- B) bridges: los 3 en UNA sola sentencia UPDATE con CASE — el
  -- WHERE repite la condición exacta ya verificada arriba (defensa en
  -- profundidad, redundante con la precondición pero barata).

  UPDATE clientes
  SET tms_cliente_id = CASE id
    WHEN 54 THEN 70
    WHEN 53 THEN 86
    WHEN 49 THEN 91
  END
  WHERE empresa_id = 1
    AND (
      (id = 54 AND tms_cliente_id = 105) OR
      (id = 53 AND tms_cliente_id = 104) OR
      (id = 49 AND tms_cliente_id = 100)
    );

  SET v_bridge_rows = ROW_COUNT();
  IF v_bridge_rows <> 3 THEN
    ROLLBACK;
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El UPDATE de bridges no afectó exactamente 3 filas — migración abortada, NINGÚN dato fue modificado (incluye los datos maestros de este mismo intento).';
  END IF;

  COMMIT;
END $$

DELIMITER ;

CALL sp_migrar_tms_clientes_dup_1();

DROP PROCEDURE IF EXISTS sp_migrar_tms_clientes_dup_1;

-- Si ves un error "Precondición global NO cumplida" o "no afectó
-- exactamente 3 filas": NINGÚN dato fue modificado (el ROLLBACK ya
-- ocurrió antes del error) — no hace falta ni conviene reintentar sin
-- antes averiguar por qué falló. El procedimiento temporal puede haber
-- quedado sin borrar en ese caso (ver nota "AJUSTE FINAL DE EJECUCIÓN"
-- arriba) — es inofensivo; el DROP PROCEDURE IF EXISTS del inicio lo
-- limpia en la siguiente corrida.
--
-- Si NO hay error: la migración se aplicó completa (datos maestros +
-- los 3 bridges) y ya se hizo COMMIT. Continúa con el POST-CHECK.

-- ================================================================
-- POST-CHECK (solo lectura — ejecutar DESPUÉS del bloque de migración
-- de arriba, en su propia petición)
-- ================================================================

-- Bridges movidos:
SELECT id, empresa_id, nombre, tms_cliente_id
FROM clientes
WHERE empresa_id = 1 AND id IN (49,53,54);
-- Esperado: 54->70, 53->86, 49->91.

-- Canónicos (70/86/91) conservan sus referencias intactas — mismos
-- conteos que en el PASO 0, este archivo no las tocó:
SELECT cliente_id, COUNT(*) AS viajes FROM tms_planes_viaje
WHERE empresa_id = 1 AND cliente_id IN (70,86,91) GROUP BY cliente_id;
SELECT cliente_id, COUNT(*) AS ubicaciones FROM tms_cliente_ubicaciones
WHERE empresa_id = 1 AND cliente_id IN (70,86,91) GROUP BY cliente_id;
SELECT cliente_id, COUNT(*) AS contactos FROM tms_cliente_contactos
WHERE empresa_id = 1 AND cliente_id IN (70,86,91) GROUP BY cliente_id;
SELECT cliente_id, COUNT(*) AS rutas FROM tms_cliente_rutas
WHERE empresa_id = 1 AND cliente_id IN (70,86,91) GROUP BY cliente_id;

-- Duplicados 100/104/105 — DEBEN seguir en 0 referencias en las 4
-- tablas (nadie les movió nada, ni antes ni ahora):
SELECT cliente_id, COUNT(*) AS viajes FROM tms_planes_viaje
WHERE empresa_id = 1 AND cliente_id IN (100,104,105) GROUP BY cliente_id;
SELECT cliente_id, COUNT(*) AS rutas FROM tms_cliente_rutas
WHERE empresa_id = 1 AND cliente_id IN (100,104,105) GROUP BY cliente_id;
SELECT cliente_id, COUNT(*) AS ubicaciones FROM tms_cliente_ubicaciones
WHERE empresa_id = 1 AND cliente_id IN (100,104,105) GROUP BY cliente_id;
SELECT cliente_id, COUNT(*) AS contactos FROM tms_cliente_contactos
WHERE empresa_id = 1 AND cliente_id IN (100,104,105) GROUP BY cliente_id;
-- Esperado en las 4: 0 filas (GROUP BY no devuelve fila si el COUNT es 0).

-- Ningún otro bridge quedó apuntando por error a un duplicado:
SELECT id, empresa_id, nombre, tms_cliente_id
FROM clientes
WHERE empresa_id = 1 AND tms_cliente_id IN (100,104,105);
-- Esperado: 0 filas.

-- ================================================================
-- FACT-1: reproducir "viajes pendientes de facturación"
-- (misma condición que listarViajesPendientes /
-- condicionesViajesPendientes en src/lib/facturacion/facturas.ts —
-- Cerrado + sin fact_factura_viajes + bridge cli.id IS NOT NULL)
-- ================================================================
SELECT p.id, p.codigo, p.cliente_id, p.tarifa_comercial, cli.id AS clientes_id
FROM tms_planes_viaje p
LEFT JOIN clientes cli ON cli.tms_cliente_id = p.cliente_id AND cli.empresa_id = p.empresa_id
WHERE p.empresa_id = 1
  AND p.estado = 'Cerrado'
  AND NOT EXISTS (SELECT 1 FROM fact_factura_viajes ffv WHERE ffv.plan_id = p.id)
  AND cli.id IS NOT NULL
ORDER BY p.fecha_plan, p.codigo;
-- Esperado (mínimo): PLAN-20260901-004, cliente_id = 70 (CALSA, bridge
-- clientes.id 54 -> 70 tras el COMMIT) aparece como pendiente si está
-- Cerrado y sin fact_factura_viajes. PLAN-20260901-003 y
-- PLAN-20260901-001 aparecen también SI cumplen las mismas condiciones
-- reales (Cerrado, sin factura, cliente_id con bridge).
