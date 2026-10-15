# Estaciones de combustible

Catálogo independiente en `/e/[slug]/combustibles/estaciones`, enlazado desde Combustibles. Proveedor sigue siendo `compras_proveedores`; estación es su sucursal, nunca otro catálogo de proveedores.

## Modelo e integridad

`flota_combustible_estaciones`: id, empresa_id, proveedor_id (INT signed), nombre VARCHAR(150), direccion VARCHAR(500) nullable, activo TINYINT(1), creado_por_usuario_id/actualizado_por_usuario_id nullable, creado_en/actualizado_en DATETIME. InnoDB, utf8mb4_unicode_ci. CHECK activo 0/1 y nombre no vacío. UNIQUE (empresa_id, proveedor_id, id), índice de listado por empresa/proveedor/activo/nombre. FKs a empresas y al proveedor compuesto (empresa_id,id), RESTRICT en actualización/borrado.

`flota_combustible_cargas.estacion_id` INT nullable + índice y FK compuesta (empresa_id,proveedor_id,estacion_id). Impide referencias cruzadas de empresa/proveedor. No permite borrado físico de estaciones usadas. Una estación utilizada no cambia de proveedor; crear otra. No hay endpoint DELETE.

## Históricos y captura

- No backfill ni cambios al texto `gasolinera` existente.
- Nuevos vales pueden no tener estación catalogada; sin selección, ID/texto quedan NULL. No se acepta texto libre del navegador como snapshot.
- Con selección, servidor valida empresa/proveedor/actividad y copia nombre a `gasolinera`.
- Edición conserva ID y snapshot si estación/proveedor no cambian, incluso estación inactiva/renombrada. Quitar la referencia conserva texto histórico; elegir otra estación toma nuevo snapshot.
- Selector solo ofrece estaciones activas del proveedor; al cambiar proveedor limpia selección incompatible. Histórico fuera del catálogo se muestra explícitamente.
- Revisión, mensual y conciliación siguen usando datos y texto persistidos. No cambian cálculos ni estados.

## Seguridad/API

GET `/api/empresas/[slug]/flota/combustible/estaciones` (filtros proveedorId, buscar, activo=1/0/todos), POST estaciones y PATCH estaciones/[id]: acción `gestionar_estaciones` de Combustibles. Catálogo activo para captura: `flota_combustible:ver`. Ver mapa y transición legacy en `COMBUSTIBLES-PERMISOS-GRANULARES.md`. Guard existente exige módulo TMS. Tenant y actor vienen de sesión/guard, no del body. Auditoría transaccional existente; bloqueo proveedor→estación consistente con escritura de vales.

## Despliegue manual

1. Ejecutar **solo lectura** `sql/preflight-2026-10-combustibles-estaciones.sql` sobre BD objetivo: validar tipos INT signed, InnoDB, índices padre, ausencia/compatibilidad de objetos. Si tabla ya existe, inspeccionar SHOW CREATE TABLE como indica el archivo. DETENER ante divergencias.
2. Solo con aprobación aplicar `sql/migrate-2026-10-combustibles-estaciones.sql`. Crea catálogo y agrega referencia nullable; sin DML/seeds/backfill. IF NOT EXISTS evita recreación, no corrige definiciones divergentes. No altera las migraciones históricas C-1 ni schema.sql compartido; instalaciones nuevas también deben aplicar esta migración.
3. Ejecutar `sql/verificar-2026-10-combustibles-estaciones.sql`: revisar FKs/índices, conteo de vales/textos sin pérdida y cero referencias inválidas.
4. Desplegar código después de migración verificada. No hay DDL en requests/build ni fallback que oculte una migración faltante.

Sintaxis, reejecución, conservación de registros/textos y FK probadas en MariaDB **11.8.9 desechable**, no en producción. Esta rama no ejecuta SQL productivo. Verificación física y aplicación manual pendientes de autorización externa.
