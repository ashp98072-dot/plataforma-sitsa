-- Solo lectura. Diagnóstico previo a instalar el catálogo propio de proveedores de Canecas.
-- Lee compras_proveedores únicamente para que una persona decida el mapeo; la aplicación no depende de esa tabla.
SELECT DATABASE() AS base, VERSION() AS version;
-- 1) ¿Existen compras históricas? (no se asume que canecas_compras esté vacía)
SELECT COUNT(*) AS compras_totales, MIN(creado_en) AS primera, MAX(creado_en) AS ultima FROM canecas_compras;
-- 2) Proveedores de Compras usados por compras de Canecas, por empresa (candidatos a mapeo manual).
SELECT c.empresa_id, c.proveedor_id, p.nombre_comercial AS proveedor_en_compras, p.nit, COUNT(*) AS compras
  FROM canecas_compras c LEFT JOIN compras_proveedores p ON p.empresa_id = c.empresa_id AND p.id = c.proveedor_id
 GROUP BY c.empresa_id, c.proveedor_id, p.nombre_comercial, p.nit ORDER BY c.empresa_id, compras DESC;
-- 3) Tras instalar: compras que aún requieren mapeo manual (columna creada por la migración).
-- SELECT empresa_id, COUNT(*) AS compras_sin_proveedor_de_canecas FROM canecas_compras WHERE canecas_proveedor_id IS NULL GROUP BY empresa_id;
