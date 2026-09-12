-- GASTOS-COMPROBANTE-404-1 — discovery (SOLO LECTURA).
--
-- Objetivo: confirmar el estado exacto en base de datos del gasto id=9
-- de kt-monaco antes de decidir cualquier acción sobre su comprobante.
-- Este archivo NO contiene ningún UPDATE/INSERT/DELETE — es un SELECT,
-- seguro de ejecutar contra producción sin ningún efecto sobre los datos.
--
-- Claude no tiene acceso directo a la base de producción desde este
-- entorno (las credenciales locales de .env.local son un placeholder de
-- desarrollo, no las reales) — ejecutar manualmente y devolver el
-- resultado.

-- 1) Estado completo del gasto id=9 (empresa kt-monaco) — el campo que
--    importa para el 404 es `factura_ruta_relativa`: esa es la ruta que
--    el endpoint /comprobante intenta leer del disco.
SELECT
  g.id, g.empresa_id, e.slug AS empresa_slug,
  g.categoria, g.descripcion, g.monto, g.activo,
  g.tiene_factura,
  g.factura_ruta_relativa,
  g.factura_nombre_original,
  g.factura_mime,
  g.factura_tamano,
  g.creado_por, g.creado_en, g.actualizado_en
FROM tms_gastos_operativos g
JOIN empresas e ON e.id = g.empresa_id
WHERE g.id = 9;

-- 2) Si la fila anterior no aparece con empresa_id de kt-monaco, confirmar
--    el slug real de esa empresa (para descartar que "id=9" en la URL
--    corresponda a otra empresa):
SELECT id, slug, nombre FROM empresas WHERE slug = 'kt-monaco';

-- 3) Contexto: cuántos gastos de esta empresa tienen tiene_factura=1 pero
--    factura_ruta_relativa NULL (inconsistencia de datos, no debería
--    haber ninguno) — y cuántos con tiene_factura=1 y ruta poblada
--    (candidatos a haber sufrido el mismo problema que el gasto 9, si el
--    archivo físico también se perdió en algún redeploy anterior a esta
--    corrección):
SELECT
  SUM(tiene_factura = 1 AND factura_ruta_relativa IS NULL) AS inconsistentes_sin_ruta,
  SUM(tiene_factura = 1 AND factura_ruta_relativa IS NOT NULL) AS con_ruta_poblada,
  COUNT(*) AS total_gastos
FROM tms_gastos_operativos g
JOIN empresas e ON e.id = g.empresa_id
WHERE e.slug = 'kt-monaco';

-- 4) Lista completa de gastos de kt-monaco con comprobante registrado en
--    BD (para que, junto con el acceso a disco/File Manager de Hostinger,
--    se pueda verificar cuáles archivos físicos siguen existiendo):
SELECT g.id, g.factura_ruta_relativa, g.factura_nombre_original, g.creado_en
FROM tms_gastos_operativos g
JOIN empresas e ON e.id = g.empresa_id
WHERE e.slug = 'kt-monaco' AND g.tiene_factura = 1
ORDER BY g.id;
