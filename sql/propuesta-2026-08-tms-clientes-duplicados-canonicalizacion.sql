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
-- vuelve a confirmar en producción, justo antes de continuar, que nada
-- cambió desde que se reportaron esos IDs. Si algún resultado del
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
-- Estos NO se tocan salvo por el reporte del PASO 0/POST-CHECK (no se
-- borran, no se marcan Inactivo — ver más abajo por qué NO se decide eso
-- aquí).
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
-- NINGUNA de estas 4 tablas se modifica en este archivo — el objetivo es
-- EXCLUSIVAMENTE mover el bridge en `clientes` (+ rellenar datos
-- maestros NULL en el canónico). Nunca se mueven filas de estas 4 tablas
-- (los duplicados 100/104/105 no tienen filas ahí según lo reportado;
-- los canónicos 70/86/91 conservan las suyas intactas, sin tocarlas).
--
-- ¿Por qué 100/104/105 NO se marcan Inactivo aquí?
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
--
-- ================================================================
-- TODO-O-NADA (ajuste pre-merge PR #157): datos maestros + bridges
-- DENTRO de la MISMA transacción
-- ================================================================
-- Versión anterior de este archivo copiaba los datos maestros ANTES de
-- START TRANSACTION — eso permitía una migración parcial (datos
-- maestros ya modificados + un bridge que falla + ROLLBACK del bridge =
-- los datos maestros quedan modificados igual, sin que se haya movido
-- ningún bridge). Corregido: el PASO 0 sigue siendo solo lectura y
-- FUERA de la transacción (es diagnóstico, no escribe nada); todo lo
-- demás que escribe — datos maestros Y bridges — vive dentro de UNA
-- sola transacción (Bloque A). El COMMIT/ROLLBACK, sin embargo, NO es
-- automático (ver ajuste pre-ejecución más abajo, en el Bloque A): es
-- una sentencia manual separada que el usuario decide y ejecuta después
-- de revisar la verificación intermedia.

-- ================================================================
-- PASO 0 — RE-CONFIRMAR ANTES DE CONTINUAR (solo lectura, FUERA de
-- cualquier transacción)
-- ================================================================
-- Ejecutar y comparar contra lo documentado arriba. Si CUALQUIERA de
-- estos resultados no coincide (otros bridges, referencias nuevas en
-- 100/104/105, facturas ya emitidas para 49/53/54), DETENTE — no
-- continúes con la transacción de abajo usando datos desactualizados.

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

-- ================================================================
-- BLOQUE A — TRANSACCIÓN, SIN COMMIT (datos maestros + bridges,
-- TODO-O-NADA)
-- ================================================================
-- Ajuste pre-ejecución PR #157: este bloque NO contiene ningún COMMIT
-- ni ROLLBACK activo — termina en la verificación intermedia (parte C)
-- y se detiene ahí a propósito. El COMMIT/ROLLBACK real es una
-- sentencia SEPARADA que el usuario ejecuta manualmente después de
-- revisar los resultados de este bloque (ver el bloque de instrucciones
-- justo después de la parte C, más abajo) — nunca automático, para que
-- ejecutar "todo el archivo de una vez" en phpMyAdmin no confirme nada
-- sin que el usuario lo haya decidido explícitamente.

START TRANSACTION;

-- --- A) datos maestros: rellenar SOLO lo que esté NULL en el canónico
-- (nit/telefono/direccion) — COALESCE nunca sobrescribe un valor no
-- NULL ya existente en el canónico. Si ambos lados ya coinciden o son
-- NULL, estos UPDATE son no-op (0 filas afectadas es normal y
-- esperado aquí — ver punto 3 de la nota de affectedRows más abajo).
-- Mismo criterio simétrico para los 3 pares.

UPDATE tms_clientes AS canon
JOIN tms_clientes AS dup ON dup.id = 105
SET
  canon.nit       = COALESCE(canon.nit, dup.nit),
  canon.telefono  = COALESCE(canon.telefono, dup.telefono),
  canon.direccion = COALESCE(canon.direccion, dup.direccion)
WHERE canon.id = 70 AND canon.empresa_id = 1 AND dup.empresa_id = 1;
-- affectedRows: 0 o 1, AMBOS son resultados válidos — 0 si no había
-- ningún campo NULL que rellenar. NO exigir 1 aquí.

UPDATE tms_clientes AS canon
JOIN tms_clientes AS dup ON dup.id = 104
SET
  canon.nit       = COALESCE(canon.nit, dup.nit),
  canon.telefono  = COALESCE(canon.telefono, dup.telefono),
  canon.direccion = COALESCE(canon.direccion, dup.direccion)
WHERE canon.id = 86 AND canon.empresa_id = 1 AND dup.empresa_id = 1;
-- affectedRows: 0 o 1, ambos válidos (ver arriba).

UPDATE tms_clientes AS canon
JOIN tms_clientes AS dup ON dup.id = 100
SET
  canon.nit       = COALESCE(canon.nit, dup.nit),
  canon.telefono  = COALESCE(canon.telefono, dup.telefono),
  canon.direccion = COALESCE(canon.direccion, dup.direccion)
WHERE canon.id = 91 AND canon.empresa_id = 1 AND dup.empresa_id = 1;
-- affectedRows: 0 o 1, ambos válidos (ver arriba).

-- --- B) bridges: mover clientes.tms_cliente_id del duplicado al
-- canónico. El WHERE incluye `tms_cliente_id = <valor actual
-- esperado>` como guarda de concurrencia — si otra sesión ya lo movió
-- entretanto, esto afecta 0 filas en vez de pisar un cambio ajeno.

UPDATE clientes
SET tms_cliente_id = 70
WHERE id = 54
  AND empresa_id = 1
  AND tms_cliente_id = 105;
-- affectedRows ESPERADO = 1 (exactamente). Si no, ROLLBACK — ver parte D.

UPDATE clientes
SET tms_cliente_id = 86
WHERE id = 53
  AND empresa_id = 1
  AND tms_cliente_id = 104;
-- affectedRows ESPERADO = 1 (exactamente). Si no, ROLLBACK — ver parte D.

UPDATE clientes
SET tms_cliente_id = 91
WHERE id = 49
  AND empresa_id = 1
  AND tms_cliente_id = 100;
-- affectedRows ESPERADO = 1 (exactamente). Si no, ROLLBACK — ver parte D.

-- --- C) verificación intermedia (todavía SIN COMMIT — esta sesión ya
-- ve sus propios cambios sin confirmar; otras sesiones aún no).
-- Ejecuta estas 2 consultas y COMPÁRALAS con lo esperado ANTES de
-- decidir COMMIT o ROLLBACK:

-- Datos maestros del canónico — nit/telefono/direccion nunca deben
-- haber PERDIDO un valor que ya tenían (solo pudieron GANAR uno que
-- antes era NULL, comparando contra el PASO 0 de arriba):
SELECT id, nombre, nit, telefono, direccion FROM tms_clientes
WHERE empresa_id = 1 AND id IN (70,86,91);

-- Bridges — deben mostrar exactamente 54->70, 53->86, 49->91:
SELECT id, empresa_id, nombre, tms_cliente_id
FROM clientes
WHERE empresa_id = 1 AND id IN (49,53,54);

-- ================================================================
-- FIN DEL BLOQUE A — DETENTE AQUÍ. NO hay COMMIT ni ROLLBACK activos
-- en este bloque a propósito (ajuste pre-ejecución PR #157): si el
-- usuario corre TODO el archivo/bloque de una sola vez en phpMyAdmin,
-- MariaDB NO debe confirmar nada automáticamente antes de que el
-- usuario revise los resultados de arriba.
--
-- Revisa manualmente, ANTES de continuar:
--   - los 3 UPDATE de la parte B (bridges) reportaron "1 row affected"
--     cada uno (los 3 UPDATE de la parte A, datos maestros, pueden
--     legítimamente reportar "0 rows affected" — eso es válido, no es
--     motivo de ROLLBACK);
--   - la verificación intermedia de arriba coincide con lo esperado:
--     nit/telefono/direccion de 70/86/91 sin haber PERDIDO ningún valor
--     que ya tenían (comparar contra el PASO 0), y los bridges
--     49/53/54 ya muestran 91/86/70.
--
-- Solo entonces, ejecuta manualmente UNA sola sentencia (nunca ambas):
--
--   SI TODO ES CORRECTO, ejecutar DESPUÉS:
--   COMMIT;
--
--   SI ALGO NO COINCIDE, ejecutar EN VEZ DE COMMIT:
--   ROLLBACK;
--
-- El resto de este archivo (POST-CHECK y FACT-1, ambos solo lectura) se
-- ejecuta DESPUÉS de haber corrido el COMMIT/ROLLBACK de arriba.

-- ================================================================
-- POST-CHECK (solo lectura — ejecutar DESPUÉS de haber hecho COMMIT;
-- manualmente, ver arriba. Si se hizo ROLLBACK, este bloque mostrará
-- los datos SIN cambiar: es normal y esperado, no reintentar nada sin
-- diagnosticar primero por qué falló el Bloque A.)
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
-- reales (Cerrado, sin factura, cliente_id con bridge) — no dependen de
-- este cambio salvo que su cliente_id sea 100/104/105, en cuyo caso
-- este mismo cambio los destraba igual que a CALSA.
