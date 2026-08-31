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
-- entorno local no tiene credenciales de producción — ver diagnóstico
-- previo). Los IDs canónicos/duplicados y los bridges de abajo son los
-- que el usuario reportó como "confirmados" en el ticket de migración —
-- NO fueron re-verificados de forma independiente por esta sesión contra
-- datos en vivo. Por eso el PASO 0 de este archivo es obligatorio:
-- vuelve a confirmar en producción, justo antes de correr el PASO 2, que
-- nada cambió desde que se reportaron esos IDs. Si algún resultado del
-- PASO 0 no coincide con lo documentado aquí, DETENTE y no continúes con
-- los pasos siguientes.
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
-- Reportados (por el usuario, ver advertencia arriba) sin referencias en
-- viajes/rutas/ubicaciones/contactos: tms_clientes.id 100, 104, 105.
-- Estos NO se tocan salvo por el reporte del PASO 0 (no se borran, no se
-- marcan Inactivo — ver PARTE 4 más abajo, por qué NO se decide eso
-- aquí).
--
-- Tablas descubiertas que referencian tms_clientes.id (FK real
-- REFERENCES tms_clientes(id), ver sql/schema.sql y
-- sql/migrate-2026-08-viat-1-cliente-ubicaciones.sql /
-- sql/migrate-2026-08-viat-4-contactos-rutas.sql):
--   tms_planes_viaje.cliente_id       (el viaje en sí)
--   tms_cliente_ubicaciones.cliente_id (VIAT-1 — ubicaciones guardadas)
--   tms_cliente_contactos.cliente_id   (VIAT-4 — contactos)
--   tms_cliente_rutas.cliente_id       (VIAT-4 — rutas guardadas;
--     tms_cliente_ruta_paradas referencia tms_cliente_rutas.id, no
--     cliente_id directo, así que queda cubierta transitivamente)
-- Ninguna de estas 4 tablas se modifica en este archivo — el objetivo es
-- EXCLUSIVAMENTE mover el bridge en `clientes`, nunca estas referencias
-- (los duplicados 100/104/105 no tienen filas ahí según lo reportado; los
-- canónicos 70/86/91 conservan las suyas intactas, sin tocarlas).
--
-- ================================================================
-- PARTE 4 — duplicados 100/104/105: por qué NO se marcan Inactivo aquí
-- ================================================================
-- tms_clientes.estado SÍ se sincroniza en escritura desde `clientes`
-- (ver syncTmsCliente en src/lib/clientes/repository.ts, que hace
-- `UPDATE tms_clientes SET ... estado = ? WHERE id = ?` cada vez que se
-- guarda un cliente administrativo vinculado) — pero no se encontró
-- ningún SELECT en el código que FILTRE tms_clientes por
-- `estado = 'Activo'` (ni el catálogo de /tms/catalogos, ni el selector
-- de cliente de Programación). Es decir: se escribe, pero no hay
-- precedente de que se LEA/filtre — no hay evidencia de que marcarlos
-- Inactivo cambie ningún comportamiento visible hoy. Por instrucción
-- explícita del ticket ("si no hay precedente claro, NO hacerlo"), este
-- archivo NO incluye ningún UPDATE de estado para 100/104/105. Quedan
-- como maestros huérfanos (sin bridge, sin referencias) — reportados,
-- no tocados. Si más adelante se decide desactivarlos, sería un ticket
-- aparte con su propia autorización explícita.

-- ================================================================
-- PASO 0 — RE-CONFIRMAR ANTES DE CONTINUAR (solo lectura)
-- ================================================================
-- Ejecutar y comparar contra lo documentado arriba. Si CUALQUIERA de
-- estos resultados no coincide (otros bridges, referencias nuevas en
-- 100/104/105, facturas ya emitidas para 49/53/54), DETENTE — no
-- ejecutes el PASO 2 con datos desactualizados.

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
JOIN clientes c ON c.id = f.cliente_id
WHERE f.empresa_id = 1 AND c.tms_cliente_id IN (70,86,91,100,104,105)
GROUP BY f.cliente_id, c.nombre;

-- ================================================================
-- PARTE 2 — preservar datos maestros (nit/telefono/direccion)
-- ================================================================
-- COALESCE-based: NUNCA sobrescribe un valor no NULL ya existente en el
-- canónico. Si ambos lados ya tienen el mismo valor o ambos son NULL,
-- estos UPDATE son no-op (no cambian nada) — seguros de ejecutar sin
-- conocer de antemano el contenido exacto de cada fila. Se aplica el
-- MISMO criterio simétrico a los 3 pares, aunque el ticket solo esperaba
-- un cambio real en CALSA (70 <- 105).

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

-- Verificar qué quedó (comparar contra el PASO 0 de arriba: nit/telefono/
-- direccion de 70/86/91 nunca deben haber perdido un valor que ya
-- tenían, solo pudieron GANAR un valor que antes era NULL):
SELECT id, nombre, nit, telefono, direccion FROM tms_clientes
WHERE empresa_id = 1 AND id IN (70,86,91);

-- ================================================================
-- PARTE 3 — mover los bridges administrativos (transacción)
-- ================================================================
-- IMPORTANTE (fuera de un script con rollback automático como
-- registrarEntregaViatico, phpMyAdmin corre esto en una sesión con
-- autocommit deshabilitado por el START TRANSACTION explícito): ejecuta
-- las 3 líneas UPDATE, y ANTES de ejecutar el COMMIT del final revisa en
-- el resultado de phpMyAdmin que las 3 digan "1 row affected" (o corre
-- el SELECT de verificación intermedio, comentado abajo, si tu
-- phpMyAdmin no muestra el conteo por sentencia). Si CUALQUIERA no
-- afectó exactamente 1 fila, ejecuta ROLLBACK; en vez del COMMIT; y
-- reporta el resultado antes de reintentar nada.

START TRANSACTION;

UPDATE clientes
SET tms_cliente_id = 70
WHERE id = 54
  AND empresa_id = 1
  AND tms_cliente_id = 105;
-- affectedRows esperado = 1.

UPDATE clientes
SET tms_cliente_id = 86
WHERE id = 53
  AND empresa_id = 1
  AND tms_cliente_id = 104;
-- affectedRows esperado = 1.

UPDATE clientes
SET tms_cliente_id = 91
WHERE id = 49
  AND empresa_id = 1
  AND tms_cliente_id = 100;
-- affectedRows esperado = 1.

-- Verificación intermedia OPCIONAL (dentro de la misma transacción, ya
-- ve los cambios sin haber hecho COMMIT todavía) — si alguna fila NO
-- coincide con lo esperado, usa ROLLBACK en vez de COMMIT:
-- SELECT id, nombre, tms_cliente_id FROM clientes WHERE id IN (49,53,54);

COMMIT;
-- Si algo salió mal arriba: ROLLBACK; (en vez de este COMMIT).

-- ================================================================
-- PASO 5 — POST-CHECK (solo lectura, después del COMMIT)
-- ================================================================

-- Bridges movidos:
SELECT id, empresa_id, nombre, tms_cliente_id
FROM clientes
WHERE id IN (49,53,54);
-- Esperado: 54->70, 53->86, 49->91.

-- Canónicos conservan sus referencias intactas (mismos conteos que en
-- el PASO 0 — este archivo no las tocó):
SELECT cliente_id, COUNT(*) AS viajes FROM tms_planes_viaje
WHERE empresa_id = 1 AND cliente_id IN (70,86,91) GROUP BY cliente_id;
SELECT cliente_id, COUNT(*) AS ubicaciones FROM tms_cliente_ubicaciones
WHERE empresa_id = 1 AND cliente_id IN (70,86,91) GROUP BY cliente_id;
SELECT cliente_id, COUNT(*) AS contactos FROM tms_cliente_contactos
WHERE empresa_id = 1 AND cliente_id IN (70,86,91) GROUP BY cliente_id;
SELECT cliente_id, COUNT(*) AS rutas FROM tms_cliente_rutas
WHERE empresa_id = 1 AND cliente_id IN (70,86,91) GROUP BY cliente_id;

-- Duplicados 100/104/105 siguen con 0 referencias (nadie les movió nada):
SELECT cliente_id, COUNT(*) AS viajes FROM tms_planes_viaje
WHERE empresa_id = 1 AND cliente_id IN (100,104,105) GROUP BY cliente_id;

-- Ningún otro bridge quedó apuntando por error a un duplicado:
SELECT id, empresa_id, nombre, tms_cliente_id
FROM clientes
WHERE empresa_id = 1 AND tms_cliente_id IN (100,104,105);
-- Esperado: 0 filas.

-- ================================================================
-- PASO 6 — FACT-1: reproducir "viajes pendientes de facturación"
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
-- Esperado: PLAN-20260901-004 (CALSA) aparece. PLAN-20260901-003 y
-- PLAN-20260901-001 aparecen también SI están Cerrados, sin factura y su
-- propio cliente_id tiene bridge (no dependen de este cambio salvo que
-- su cliente_id sea 100/104/105 — en ese caso, este mismo cambio los
-- destraba igual que a CALSA).
